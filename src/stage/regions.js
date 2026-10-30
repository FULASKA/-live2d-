/**
 * 分区（Region）—— 角色身上的可交互热区。
 *
 * 坐标空间：**模型画布像素**（本模型 3749×7697，与 PSD 同尺寸，可直接对图层）。
 *   - 原点左上、y 轴向下，与 internalModel.getDrawableVertices() 同一坐标系。
 *   - 好处：模型怎么缩放/移动，区域都不用重算；换分辨率也不用改数据。
 *
 * 三条设计约束（来自 SPEC）：
 *   1. 区域由用户编辑，不写死 —— 这里只给「自动铺初稿」的便利，最终以用户画的为准。
 *   2. 叠加即优先级 —— z 大的先命中（脸压在胸上，胸口那块就不该抢点击）。
 *   3. 手势要区分「点 / 抚摸 / 拖动」，拖动还要与窗口移动区分（由上层决定语义）。
 *
 * 这一层只管几何与手势，不决定「点了之后演什么」。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** 射线法：点是否在多边形内（支持凹多边形） */
export function pointInPolygon(px, py, points) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0], yi = points[i][1]
    const xj = points[j][0], yj = points[j][1]
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function polygonBounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/** Andrew 单调链凸包；用于把一堆网格顶点收成一个顺手的热区轮廓 */
export function convexHull(points) {
  if (points.length < 3) return points.slice()
  const pts = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

/** 顶点太多时抽稀：保留转角明显的点，热区不必精确到发丝 */
function simplify(points, tolerance = 6) {
  if (points.length <= 8) return points
  const out = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const [ax, ay] = out[out.length - 1]
    const [bx, by] = points[i]
    const [cx, cy] = points[i + 1]
    const area = Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2
    const base = Math.hypot(cx - ax, cy - ay) || 1
    if (area / base > tolerance) out.push(points[i])
  }
  out.push(points[points.length - 1])
  return out
}

export function createRegionStore(initial = []) {
  let regions = initial.slice()

  const api = {
    get all() { return regions },
    /** z 大的优先；同 z 时后加入的优先（后画 = 更靠前）。holes 里的洞不算命中 */
    hit(mx, my) {
      let found = null
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i]
        if (!pointInPolygon(mx, my, r.points)) continue
        if (r.holes && r.holes.some((h) => pointInPolygon(mx, my, h))) continue
        if (!found || r.z > found.region.z || (r.z === found.region.z && i > found.index)) {
          found = { region: r, index: i }
        }
      }
      return found ? found.region : null
    },
    add(region) {
      const r = {
        id: region.id || `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`,
        name: region.name || '新区域',
        points: region.points.map(([x, y]) => [Math.round(x), Math.round(y)]),
        // 洞（差集）：尾巴被身体各段挡住的区域，形状上就不该与它们重叠
        holes: (region.holes || []).map((h) => h.map(([x, y]) => [Math.round(x), Math.round(y)])),
        z: region.z ?? 1,
        reaction: region.reaction || {},
      }
      regions.push(r)
      return r
    },
    remove(id) {
      const i = regions.findIndex((r) => r.id === id)
      if (i >= 0) regions.splice(i, 1)
      return i >= 0
    },
    update(id, patch) {
      const r = regions.find((x) => x.id === id)
      if (r) Object.assign(r, patch)
      return r
    },
    replaceAll(list) { regions = list.slice() },
    toJSON(modelKey) {
      return { schemaVersion: 2, model: modelKey, regions }
    },
    storageKey(modelKey) { return `live2d-stage/profile/v2/${modelKey}` },
    save(modelKey) {
      try { localStorage.setItem(api.storageKey(modelKey), JSON.stringify(api.toJSON(modelKey))); return true } catch { return false }
    },
    load(modelKey) {
      try {
        const raw = localStorage.getItem(api.storageKey(modelKey))
        if (!raw) return false
        return api.loadJSON(JSON.parse(raw))
      } catch { return false }
    },
    loadJSON(json) {
      if (!json || !Array.isArray(json.regions)) return false
      regions = json.regions
      return true
    },
  }
  return api
}

/**
 * 自动铺初稿：按部件名收集顶点，再用包围盒成矩形（尾巴用凸包，因为它是弯的）。
 *
 * 为什么不用凸包铺全身：凸包会把手臂、裙摆这些外扩的网格都算进去，
 * 结果每个热区都是覆盖半个身体的大四边形，互相叠成一团，反而不可用。
 * 矩形虽然朴素，但可预测、好拖动，也正是「用户随手改」的起点。
 * （PSD 与画布同尺寸，后续可直接吃图层蒙版得到贴合轮廓的形状。）
 */
/**
 * 分区初稿：六段竖切片 + 尾巴差集。
 *
 * 为什么不再拿每个部件的包围盒直接出框：
 *   头发垂到腰、裙摆盖住腿，部件包围盒互相穿插，直接出框会得到一堆斜叠的大四边形，
 *   点击互相抢。这里改成「先按解剖锚点定横向分界，再按部位取横向范围」：
 *   锚点全部来自模型自己的网格（脖子下缘 / 胸衣下缘 / 短裙下缘 / 鞋底），
 *   缩放、换姿势都不会漂。
 *
 * 本模型实测锚点（画布 3749×7697）：头顶 935 · 脖子下缘 2012 · 胸衣下缘 2849
 *   腰/裙分界 ≈3622（短裙上缘 + 45% 裙高）· 短裙下缘 4433 · 鞋口 ≈6662 · 鞋底 7334
 */
const SEED_GROUPS = {
  head: ['头', '脸', '脸底', '五官', '脖子', '耳朵', '发饰', '女仆发饰', '前发', '眉毛', '眼眶', '眼球', '眼白', '嘴', '鼻子'],
  chest: ['胸衣', '胸', '领子', '肩膀花边-变q'],
  waist: ['腰部衣服'],
  skirt: ['短裙', '长裙', '短裙后', '长裙后', '长裙蝴蝶结', '身后蝴蝶结'],
  legs: ['腿', '左腿', '右腿'],
  tail: ['尾巴', '狗尾草'],
}

const SKIP_KEYS = ['组', '文件夹', '图层', '画布', '.psd', '.png']

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

/**
 * 手势识别：按下 → 移动 → 抬起，判定点按 / 抚摸 / 拖动。
 * 阈值用**模型画布像素**，与缩放无关。
 */
export function createRegionInput({ store, viewport, onEvent, canvas, isOpaque, isNear }) {
  // 阈值按**画布宽度比例**给，与窗口缩放、模型分辨率都无关。
  // 一开始按「画布像素绝对值」定过，结果屏幕上动 8px 就被当成拖动 —— 太容易误判。
  const { width: canvasW = 1 } = viewport.modelSize?.() || {}
  const cfg = {
    tapMaxMove: canvasW * 0.02,   // 手抖范围内 → 点按
    tapMaxMs: 420,
    dragMinMove: canvasW * 0.08,  // 超过角色宽度的 8% → 拖动（与窗口移动区分）
    petStep: canvasW * 0.03,      // 抚摸每走这么远报一次
  }

  let pressed = null
  let hovered = null

  const modelPoint = (clientX, clientY) => viewport.clientToModel(clientX, clientY)

  /** 指针的舞台内坐标（给「离角色多远」这类屏幕空间判定用） */
  const stagePoint = (clientX, clientY) => {
    const r = canvas?.getBoundingClientRect?.() || { left: 0, top: 0 }
    return { x: clientX - r.left, y: clientY - r.top }
  }

  /**
   * 命中判定：几何命中之后还要过「不透明像素」这一关。
   * 热区是矩形/凸包，边界必然盖到透明背景；规格要求落在透明处算穿透，
   * 所以这里用引擎的 alpha 采样兜底（只在按下这种低频时机做，不进移动路径）。
   */
  /**
   * 命中判定。
   * - 悬停（hover）只做几何命中：高亮要「指哪亮哪」，不该被像素采样卡掉；
   *   而且读像素要先渲染一帧，放进移动路径会把帧率拖死。
   * - 按下（down）才过「不透明像素」这一关：落在透明处视为穿透（规格要求）。
   */
  const hitAt = (clientX, clientY, { gate = false } = {}) => {
    const p = modelPoint(clientX, clientY)
    let region = store.hit(p.x, p.y)
    let opaque = true
    if (region && gate && isOpaque) {
      opaque = isOpaque(p)
      if (!opaque) region = null
    }
    return { p, region, opaque }
  }

  const emit = (type, payload) => onEvent && onEvent({ type, ...payload })

  const onPointerMove = (e) => {
    const { p, region } = hitAt(e.clientX, e.clientY)
    if (pressed) {
      const dx = p.x - pressed.last.x
      const dy = p.y - pressed.last.y
      const dist = Math.hypot(dx, dy)
      pressed.moved += dist
      pressed.stepDist += dist
      pressed.last = p

      // 起手在热区外、滑进来也算数：否则「手不会每次都精准落在热区里」会让触发率很低。
      // 采纳规则：
      //   a) 起点在区外 → 第一次真的按在角色身上（不透明）时采纳；
      //   b) 已采纳后，只允许**更高 z** 的热区接管（尾巴 z=1 是兜底，扫过尾巴边缘再摸到腰/腿，
      //      应该算腰/腿的）；反过来在头/胸里滑动不会被低层热区抢走。
      const target = pressed.region
      const canAdopt = !target || (pressed.entered && region && region.z > target.z)
      if (region && canAdopt && region !== target && pressed.nearBody) {
        const visible = target ? true : (!isOpaque || isOpaque(p))
        if (visible) {
          pressed.region = region
          pressed.regionId = region.id
          pressed.entered = true
          pressed.stepDist = 0
          // 换目标 = 新的一串抚摸，步数从头记（上层只在 step===1 时触发*反应*，
          // 否则扫过尾巴那一格就把序号用掉了，真正摸到腰时不会触发）
          pressed.petSteps = 0
        }
      }
      if (pressed.regionId && region && region.id === pressed.regionId && pressed.stepDist >= cfg.petStep) {
        pressed.stepDist = 0
        pressed.petSteps += 1
        emit('pet', { region, point: p, step: pressed.petSteps })
      }

      // 拖动判定：位移超过阈值就认为在拖（先到先得）；从区外滑进来的不算拖区域
      if (pressed.moved > cfg.dragMinMove && !pressed.dragging && !pressed.entered) {
        pressed.dragging = true
        emit('dragStart', { region: pressed.region, point: p })
      }
      if (pressed.dragging) emit('dragMove', { region: pressed.region, point: p, dx, dy })
      emit('move', { region, point: p })
      return
    }
    if ((region?.id || null) !== (hovered?.id || null)) {
      if (hovered) emit('leave', { region: hovered, point: p })
      if (region) emit('enter', { region, point: p })
      hovered = region
    }
    emit('hover', { region, point: p })
  }

  const onPointerDown = (e) => {
    const { p, region } = hitAt(e.clientX, e.clientY, { gate: true })
    // 起手在热区外时，先看「离角色够不够近」：远处横拖是搬窗口，不该算抚摸
    let nearBody = true
    if (!region && isNear) {
      try { nearBody = isNear(stagePoint(e.clientX, e.clientY)) !== false } catch { nearBody = true }
    }
    pressed = { region, regionId: region?.id, start: p, last: p, moved: 0, stepDist: 0, entered: false, nearBody, t0: performance.now(), petSteps: 0, dragging: false, pointerId: e.pointerId }
    // 合成事件（测试/无头）里 pointerId 不是活跃指针，capture 会抛 —— 拦掉，别让后续逻辑断链
    try { canvas?.setPointerCapture?.(e.pointerId) } catch {}
    emit('down', { region, point: p })
  }

  const onPointerUp = (e) => {
    if (!pressed) return
    const dt = performance.now() - pressed.t0
    // 连续抚摸过多次 → 即使位移够大也算抚摸（人在顺毛，不是要把角色拖走）
    // 从区外滑进来的（entered）同样归为抚摸：没有「抓取起点」，谈不上拖区域
    const kind = pressed.dragging
      ? 'drag'
      : pressed.petSteps >= 3 || pressed.entered
        ? 'pet'
        : pressed.moved <= cfg.tapMaxMove && dt <= cfg.tapMaxMs
          ? 'tap'
          : 'pet'
    const region = pressed.region
    emit('up', { region, kind, moved: pressed.moved, duration: dt, point: pressed.last })
    if (kind === 'tap') emit('tap', { region, point: pressed.start })
    else if (kind === 'pet') emit('petEnd', { region, steps: pressed.petSteps })
    else emit('dragEnd', { region, moved: pressed.moved })
    try { canvas?.releasePointerCapture?.(pressed.pointerId) } catch {}
    pressed = null
  }

  const onPointerCancel = () => { pressed = null }

  return {
    attach(el) {
      el.addEventListener('pointermove', onPointerMove)
      el.addEventListener('pointerdown', onPointerDown)
      el.addEventListener('pointerup', onPointerUp)
      el.addEventListener('pointercancel', onPointerCancel)
      return () => {
        el.removeEventListener('pointermove', onPointerMove)
        el.removeEventListener('pointerdown', onPointerDown)
        el.removeEventListener('pointerup', onPointerUp)
        el.removeEventListener('pointercancel', onPointerCancel)
      }
    },
    get pressed() { return pressed },
    get hovered() { return hovered },
    cfg,
  }
}
