/** 热区读取器：按当前蒙皮顶点实时算脸/手包围盒，以及首次播种的分段热区。 */
import { convexHull, simplify, polygonBounds } from './geometry.js'

const SEED_GROUPS = {
  head: ['头', '脸', '脸底', '五官', '脖子', '耳朵', '发饰', '女仆发饰', '前发', '眉毛', '眼眶', '眼球', '眼白', '嘴', '鼻子'],
  chest: ['胸衣', '胸', '领子', '肩膀花边-变q'],
  waist: ['腰部衣服'],
  skirt: ['短裙', '长裙', '短裙后', '长裙后', '长裙蝴蝶结', '身后蝴蝶结'],
  legs: ['腿', '左腿', '右腿'],
  tail: ['尾巴', '狗尾草'],
}

const SKIP_KEYS = ['组', '文件夹', '图层', '画布', '.psd', '.png']

/** 把数值夹在区间内（手/脚热区的余量要保证不越出画布） */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/**
 * 脸部热区（捏脸用）：按「脸 / 脸底」部件包围盒取**眼睛以下**的椭圆，
 * 再从中间竖着一分为二 → 「左脸」「右脸」各一个热区（z 都高于头）。
 * 一分为二的好处：按住哪边就捏哪边，不会因为拖拽方向判错而鼓错边。
 */
export function faceRegions({ core, internalModel, displayNames, canvas }) {
  const W = canvas?.width || 3749
  const H = canvas?.height || 7697
  const indices = faceDrawableIndices(core, displayNames)
  const b = faceBounds(indices, { core, internalModel, W, H })
  if (!b) return []
  const { minX, minY, maxX, maxY } = b

  return zonePoints(b)
}

/**
 * 额头热区：脸包围盒的**上半段**（眼睛线以上），点一下切换 常态 / 爱心眼 / 眼镜。
 * 层级给到 9：压过「头」(7) 和左/右脸(8)，额头才有独立点击。
 */
export function foreheadRegion({ core, internalModel, displayNames, canvas }) {
  const W = canvas?.width || 3749
  const H = canvas?.height || 7697
  const indices = faceDrawableIndices(core, displayNames)
  const b = faceBounds(indices, { core, internalModel, W, H })
  if (!b) return []
  return [{ name: '额头', z: 9, points: foreheadPoints(b) }]
}

/** 脸包围盒 → 上半段矩形（额头） */
function foreheadPoints(b) {
  const h = b.maxY - b.minY
  const w = b.maxX - b.minX
  const x0 = Math.round(b.minX + w * 0.1)
  const x1 = Math.round(b.maxX - w * 0.1)
  const y0 = Math.round(b.minY + h * 0.03)
  const y1 = Math.round(b.minY + h * 0.44)   // 到眼睛线为止，不抢眼睛
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
}

/** 包围盒 → 左右两个下半脸椭圆（原几何，抽出来给缓存读取器复用） */function zonePoints({ minX, minY, maxX, maxY }) {
  const top = minY + (maxY - minY) * 0.46 // 眼睛以上归头部热区
  const cx = (minX + maxX) / 2
  const cy = (top + maxY) / 2
  const rx = ((maxX - minX) / 2) * 0.9
  const ry = ((maxY - top) / 2) * 1.02
  const N = 14

  const half = (from, to) => {
    const pts = []
    for (let k = 0; k <= N; k++) {
      const a = from + ((to - from) * k) / N
      pts.push([Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry)])
    }
    return pts
  }

  return [
    { name: '左脸', z: 8, points: half(Math.PI / 2, (Math.PI * 3) / 2) },
    { name: '右脸', z: 8, points: half(-Math.PI / 2, Math.PI / 2) },
  ]
}

/**
 * 「脸 / 脸底」部件下的 drawable 索引表。
 *
 * 这里是曾经的主线程灾难现场：原实现每次采样都遍历全部 715 个 drawable，
 * 对每个都调一次 displayNames.get() —— 而那个 get 是 148 个部件的线性查找，
 * 于是单次采样 ~99ms，按 120ms 周期重算时每秒吃掉 0.8 秒（实测 fps 26.9）。
 * 映射本身是静态的，所以部件判定结果按部件索引缓存，只对真正相关的几个 drawable 取顶点。
 */
function faceDrawableIndices(core, displayNames) {
  const n = core.getDrawableCount()
  const byParent = new Map()
  const out = []
  for (let i = 0; i < n; i++) {
    let parent = -1
    try { parent = core.getDrawableParentPartIndex(i) } catch { parent = -1 }
    if (parent < 0) continue
    let hit = byParent.get(parent)
    if (hit === undefined) {
      const name = displayNames?.get?.(parent) || ''
      hit = /^脸$|^脸底$/.test(name)
      byParent.set(parent, hit)
    }
    if (hit) out.push(i)
  }
  return out
}

/** 给定 drawable 子集，算当前帧的包围盒（透视变形后跟着走） */
function faceBounds(indices, { core, internalModel, W, H }) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let k = 0; k < indices.length; k++) {
    const i = indices[k]
    if (!(core.getDrawableOpacity(i) > 0.05)) continue
    let vtx
    try { vtx = internalModel.getDrawableVertices(i) } catch { continue }
    if (!vtx || vtx.length < 6) continue
    for (let t = 0; t < vtx.length; t += 2) {
      const x = vtx[t], y = vtx[t + 1]
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      if (x < -W || x > W * 2 || y < -H || y > H * 2) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

/**
 * 脸部热区读取器：每帧级的反复采样走这里（索引表缓存，单次 ~1ms 量级）。
 * drawable 数量或部件数量变化时自动重扫一次（换装/换模型时兜底）。
 */
export function createFaceZoneReader({ core, internalModel, displayNames, canvas }) {
  const W = canvas?.width || 3749
  const H = canvas?.height || 7697
  let indices = null
  let sig = ''
  return {
    read() {
      const s = `${core.getDrawableCount()}/${core.getPartCount()}`
      if (!indices || s !== sig) {
        indices = faceDrawableIndices(core, displayNames)
        sig = s
      }
      const b = faceBounds(indices, { core, internalModel, W, H })
      return b ? zonePoints(b) : []
    },
    /** 命中的 drawable 数量，探针用来确认映射正确 */
    count() {
      return indices ? indices.length : -1
    },
    /** 额头热区（跟脸一起重算；拿不到返回 null，调用方保留旧几何） */
    readForehead() {
      const s = `${core.getDrawableCount()}/${core.getPartCount()}`
      if (!indices || s !== sig) {
        indices = faceDrawableIndices(core, displayNames)
        sig = s
      }
      const b = faceBounds(indices, { core, internalModel, W, H })
      return b ? foreheadPoints(b) : null
    },
  }
}

/**
 * 手部热区读取器：左右手各一块，跟着网格走。
 *
 * 为什么不能像腰/裙摆那样写死在某个 y 段：两只手本来就垂在裙摆两侧，
 * 大臂/小臂/手腕又都在参数链上（LArm/LForearm/LWrist…），身体一摆、头一转手就跟着动。
 * 固定矩形要么盖不到手，要么把手外的裙子也算进去。
 *
 * 模型里「手」是一个部件、两坨网格（左右各一只），所以按整体包围盒的中线切两半：
 * 中线两侧必然各是一只手，取各自包围盒加一点余量就是热区。
 */
export function createHandZoneReader({ core, internalModel, displayNames, canvas }) {
  const W = canvas?.width || 3749
  const H = canvas?.height || 7697
  let indices = null
  let sig = ''

  /** 「手」部件下的 drawable 索引表（部件名判定结果按部件缓存，别每次全量扫 715 个） */
  const collect = () => {
    const n = core.getDrawableCount()
    const byParent = new Map()
    const out = []
    for (let i = 0; i < n; i++) {
      let parent = -1
      try { parent = core.getDrawableParentPartIndex(i) } catch { parent = -1 }
      if (parent < 0) continue
      let hit = byParent.get(parent)
      if (hit === undefined) {
        hit = /^手$|^手指/.test(displayNames?.get?.(parent) || '')
        byParent.set(parent, hit)
      }
      if (hit) out.push(i)
    }
    return out
  }

  const box = (pts) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of pts) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    return { minX, minY, maxX, maxY }
  }

  // 上一帧两只手的中心：抬手这类动作会让一只手靠近中线，
  // 只按中线切分可能把「左/右」判反 —— 用上一帧的位置做连续性校正。
  const last = { left: null, right: null }

  return {
    /** 读当前帧的双手热区（模型画布像素）；拿不到就返回 []，调用方保留旧几何 */
    read() {
      const s = `${core.getDrawableCount()}/${core.getPartCount()}`
      if (!indices || s !== sig) {
        indices = collect()
        sig = s
      }
      const pts = []
      for (let k = 0; k < indices.length; k++) {
        const i = indices[k]
        if (!(core.getDrawableOpacity(i) > 0.05)) continue
        let vtx
        try { vtx = internalModel.getDrawableVertices(i) } catch { continue }
        if (!vtx || vtx.length < 6) continue
        for (let t = 0; t < vtx.length; t += 2) {
          const x = vtx[t], y = vtx[t + 1]
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue
          if (x < -W || x > W * 2 || y < -H || y > H * 2) continue
          pts.push([x, y])
        }
      }
      if (pts.length < 12) return []
      const all = box(pts)
      const midX = (all.minX + all.maxX) / 2
      let left = [], right = []
      for (const p of pts) (p[0] < midX ? left : right).push(p)
      if (left.length < 6 || right.length < 6) return []

      const center = (cluster) => {
        const b = box(cluster)
        return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]
      }
      let [lc, rc] = [center(left), center(right)]
      // 连续性：抬手时一只手会离开原位、甚至跨过中线，按上一帧认人比按 x 排序稳
      if (last.left && last.right) {
        const keep = Math.hypot(lc[0] - last.left[0], lc[1] - last.left[1]) + Math.hypot(rc[0] - last.right[0], rc[1] - last.right[1])
        const swap = Math.hypot(rc[0] - last.left[0], rc[1] - last.left[1]) + Math.hypot(lc[0] - last.right[0], lc[1] - last.right[1])
        if (swap < keep * 0.9) {
          ;[left, right] = [right, left]
          ;[lc, rc] = [center(left), center(right)]
        }
      }
      last.left = lc
      last.right = rc

      const out = []
      for (const [name, cluster] of [['左手', left], ['右手', right]]) {
        const b = box(cluster)
        // 余量按手本身大小给，手指边缘不贴死
        const pad = Math.max(10, Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08)
        const coords = {
          x0: clamp(Math.round(b.minX - pad), 0, W),
          y0: clamp(Math.round(b.minY - pad), 0, H),
          x1: clamp(Math.round(b.maxX + pad), 0, W),
          y1: clamp(Math.round(b.maxY + pad), 0, H),
        }
        out.push({
          name,
          z: 8, // 压过裙摆(4)/腰(5)/胸(6)：手垂在裙子前面，摸到手就该算手
          points: [
            [coords.x0, coords.y0], [coords.x1, coords.y0],
            [coords.x1, coords.y1], [coords.x0, coords.y1],
          ],
        })
      }
      return out
    },
    count() { return indices ? indices.length : -1 },
  }
}

export function seedRegions({ core, internalModel, displayNames, canvas }) {
  const partName = (index) => displayNames?.get?.(index) || ''
  const n = core.getDrawableCount()
  const W = canvas?.width || 3749
  const H = canvas?.height || 7697

  const groupKeys = Object.keys(SEED_GROUPS)
  const groupOf = (name) => {
    for (const g of groupKeys) if (SEED_GROUPS[g].some((k) => name.includes(k))) return g
    return null
  }

  /** 逐网格收集顶点：既攒凸包点（尾巴），也攒每个部件的包围盒（定锚点用） */
  const ptsByGroup = new Map(groupKeys.map((g) => [g, []]))
  const boxByName = new Map()
  for (let i = 0; i < n; i++) {
    let parent = -1
    try { parent = core.getDrawableParentPartIndex(i) } catch { parent = -1 }
    if (parent < 0) continue
    const name = partName(parent)
    if (!name || SKIP_KEYS.some((k) => name.includes(k))) continue
    if (!(core.getDrawableOpacity(i) > 0.05)) continue
    let vtx
    try { vtx = internalModel.getDrawableVertices(i) } catch { continue }
    if (!vtx || vtx.length < 6) continue
    const g = groupOf(name)
    if (!g) continue
    const b = boxByName.get(name) || { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    const pts = ptsByGroup.get(g)
    for (let t = 0; t < vtx.length; t += 2) {
      const x = vtx[t], y = vtx[t + 1]
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      // 明显离谱的顶点（未初始化的蒙皮点）不要
      if (x < -W || x > W * 2 || y < -H || y > H * 2) continue
      if (x < b.minX) b.minX = x
      if (x > b.maxX) b.maxX = x
      if (y < b.minY) b.minY = y
      if (y > b.maxY) b.maxY = y
      pts.push([x, y])
    }
    boxByName.set(name, b)
  }

  const boxOf = (names) => {
    const o = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const nm of names) {
      const b = boxByName.get(nm)
      if (!b || !Number.isFinite(b.minX)) continue
      if (b.minX < o.minX) o.minX = b.minX
      if (b.maxX > o.maxX) o.maxX = b.maxX
      if (b.minY < o.minY) o.minY = b.minY
      if (b.maxY > o.maxY) o.maxY = b.maxY
    }
    return o
  }

  const bodyNames = [...boxByName.keys()].filter((nm) => !SEED_GROUPS.tail.some((k) => nm.includes(k)))
  const body = boxOf(bodyNames)
  const head = boxOf(SEED_GROUPS.head)
  const chest = boxOf(SEED_GROUPS.chest)
  const waist = boxOf(SEED_GROUPS.waist)
  const skirtAll = boxOf(SEED_GROUPS.skirt)
  // 腰/裙的分界只认「前裙」：长裙/身后蝴蝶结的网格会往上拉到胸口，
  // 用它算分界会把腰段压成一条 300px 的细带（实测过一次）。
  const skirtFront = boxOf(['短裙', '短裙后'])
  const skirt = Number.isFinite(skirtFront.minY) && skirtFront.maxY > skirtFront.minY ? skirtFront : skirtAll
  const legs = boxOf(SEED_GROUPS.legs)
  if (!Number.isFinite(body.minY) || !Number.isFinite(skirt.minY) || !Number.isFinite(legs.minY)) return []

  const neckY = Math.max(head.maxY, 0)                      // 脖子下缘 ≈ 2012
  const chestY = Math.max(chest.maxY, neckY + 1)            // 胸衣下缘 ≈ 2849
  const waistY = skirt.minY + (skirt.maxY - skirt.minY) * 0.45  // 腰/裙分界 ≈ 3622
  const skirtBottom = skirt.maxY                            // 短裙下缘 ≈ 4433
  const footY = legs.maxY - (legs.maxY - body.minY) * 0.105 // 鞋口 ≈ 6662

  const rect = (x0, y0, x1, y1) => [
    [Math.round(x0), Math.round(y0)], [Math.round(x1), Math.round(y0)],
    [Math.round(x1), Math.round(y1)], [Math.round(x0), Math.round(y1)],
  ]

  // 六段：z 大者优先命中（头压胸、裙摆压腿）
  const bands = [
    { name: '头', z: 7, x0: head.minX, x1: head.maxX, y0: body.minY, y1: neckY },
    { name: '胸', z: 6, x0: chest.minX, x1: chest.maxX, y0: neckY, y1: chestY },
    { name: '腰', z: 5, x0: waist.minX, x1: waist.maxX, y0: chestY, y1: waistY },
    { name: '裙摆', z: 4, x0: skirt.minX, x1: skirt.maxX, y0: waistY, y1: skirtBottom },
    { name: '腿', z: 3, x0: legs.minX, x1: legs.maxX, y0: skirtBottom, y1: footY },
    { name: '脚', z: 3, x0: legs.minX, x1: legs.maxX, y0: footY, y1: legs.maxY },
  ]

  const out = []
  const bodyRects = []
  for (const b of bands) {
    if (!(b.y1 - b.y0 > 8 && b.x1 - b.x0 > 8)) continue
    const points = rect(b.x0, b.y0, b.x1, b.y1)
    bodyRects.push(points)
    out.push({ name: b.name, z: b.z, points, holes: [], reaction: {} })
  }

  // 尾巴：保持原来的凸包形状，但把已被身体各段占住的区域挖成洞（交集删除）
  const tailPts = ptsByGroup.get('tail')
  if (tailPts && tailPts.length >= 8) {
    const hull = simplify(convexHull(tailPts), 12)
    if (hull.length >= 3) {
      const tb = polygonBounds(hull)
      const holes = bodyRects.filter((r) => {
        const b = polygonBounds(r)
        return !(b.maxX <= tb.minX || b.minX >= tb.maxX || b.maxY <= tb.minY || b.minY >= tb.maxY)
      })
      out.push({ name: '尾巴', z: 1, points: hull, holes, reaction: {} })
    }
  }
  return out
}
