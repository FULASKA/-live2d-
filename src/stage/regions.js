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
    /** z 大的优先；同 z 时后加入的优先（后画 = 更靠前） */
    hit(mx, my) {
      let found = null
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i]
        if (!pointInPolygon(mx, my, r.points)) continue
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
      return { schemaVersion: 1, model: modelKey, regions }
    },
    storageKey(modelKey) { return `live2d-stage/profile/${modelKey}` },
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
const SEED_GROUPS = [
  { name: '头', z: 6, shape: 'box', keys: ['头', '脸', '五官', '眉毛', '眼眶', '眼球', '眼白', '嘴', '鼻子', '耳', '前发', '后发', '发', '呆毛'] },
  { name: '胸', z: 4, shape: 'box', keys: ['胸衣', '胸', '领子'] },
  { name: '腰', z: 3, shape: 'box', keys: ['腰', '短裙', '长裙'] },
  { name: '腿', z: 2, shape: 'box', keys: ['腿'] },
  { name: '尾巴', z: 1, shape: 'hull', keys: ['尾巴', '狗尾草'] },
]

const SKIP_KEYS = ['组', '文件夹', '图层', '画布', '.psd', '.png']

export function seedRegions({ core, internalModel, displayNames, canvas }) {
  const partName = (index) => displayNames?.get?.(index) || ''
  const buckets = SEED_GROUPS.map((g) => ({ ...g, pts: [] }))
  const n = core.getDrawableCount()
  const W = canvas?.width || 3749
  const H = canvas?.height || 7697

  for (let i = 0; i < n; i++) {
    let parent = -1
    try { parent = core.getDrawableParentPartIndex(i) } catch { parent = -1 }
    if (parent < 0) continue
    const name = partName(parent)
    if (!name || SKIP_KEYS.some((k) => name.includes(k))) continue
    const op = core.getDrawableOpacity(i)
    if (!(op > 0.05)) continue
    let vtx
    try { vtx = internalModel.getDrawableVertices(i) } catch { continue }
    if (!vtx || vtx.length < 6) continue

    for (const g of buckets) {
      if (!g.keys.some((k) => name.includes(k))) continue
      for (let t = 0; t < vtx.length; t += 2) {
        const x = vtx[t], y = vtx[t + 1]
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        // 明显离谱的顶点（未初始化的蒙皮点）不要
        if (x < -W || x > W * 2 || y < -H || y > H * 2) continue
        g.pts.push([x, y])
      }
      break
    }
  }

  const out = []
  const boxes = []
  for (const g of buckets) {
    if (g.pts.length < 8) continue
    if (g.shape === 'hull') {
      const points = simplify(convexHull(g.pts), 10)
      if (points.length >= 3) out.push({ name: g.name, z: g.z, points, reaction: {} })
      continue
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const [x, y] of g.pts) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    boxes.push({ name: g.name, z: g.z, minX, maxX, minY, maxY })
  }

  // 上下分带：按各部位包围盒的重心排成「头 → 胸 → 腰 → 腿」，再用相邻重心的中点切分。
  // 不能直接拿某个部位的 maxY 去裁下一个的 minY —— 网格包围盒常被衣服/裙摆拉长，
  // 会裁出只有几像素的残条（实测胸口就只剩过 5px）。分带对「网格抖动」更稳定。
  const byName = new Map(boxes.map((b) => [b.name, b]))
  const order = ['头', '胸', '腰', '腿'].map((n) => byName.get(n)).filter(Boolean)
  order.sort((a, b) => (a.minY + a.maxY) / 2 - (b.minY + b.maxY) / 2)
  const bands = new Map()
  for (let i = 0; i < order.length; i++) {
    const b = order[i]
    const c = (b.minY + b.maxY) / 2
    const prev = i > 0 ? ((order[i - 1].minY + order[i - 1].maxY) / 2 + c) / 2 : b.minY
    const next = i < order.length - 1
      ? (c + (order[i + 1].minY + order[i + 1].maxY) / 2) / 2
      : b.maxY
    bands.set(b.name, [Math.min(prev, c), Math.max(next, c)])
  }

  for (const b of boxes) {
    const [top, bottom] = bands.get(b.name) || [b.minY, b.maxY]
    if (!(bottom - top > 4 && b.maxX - b.minX > 4)) continue
    out.push({
      name: b.name, z: b.z, reaction: {},
      points: [[b.minX, top], [b.maxX, top], [b.maxX, bottom], [b.minX, bottom]],
    })
  }
  return out
}

/**
 * 手势识别：按下 → 移动 → 抬起，判定点按 / 抚摸 / 拖动。
 * 阈值用**模型画布像素**，与缩放无关。
 */
export function createRegionInput({ store, viewport, onEvent, canvas, isOpaque }) {
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

  /**
   * 命中判定：几何命中之后还要过「不透明像素」这一关。
   * 热区是矩形/凸包，边界必然盖到透明背景；规格要求落在透明处算穿透，
   * 所以这里用引擎的 alpha 采样兜底（只在按下这种低频时机做，不进移动路径）。
   */
  const hitAt = (clientX, clientY) => {
    const p = modelPoint(clientX, clientY)
    let region = store.hit(p.x, p.y)
    let opaque = true
    if (region && isOpaque) {
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
      pressed.last = p
      if (pressed.moved > cfg.petStep && pressed.regionId && region && region.id === pressed.regionId) {
        pressed.petSteps += 1
        emit('pet', { region, point: p, step: pressed.petSteps })
      }
      // 拖动判定：位移超过阈值就认为在拖（先到先得，之后按拖动持续上报）
      if (pressed.moved > cfg.dragMinMove && !pressed.dragging) {
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
    const { p, region } = hitAt(e.clientX, e.clientY)
    pressed = { region, regionId: region?.id, start: p, last: p, moved: 0, t0: performance.now(), petSteps: 0, dragging: false, pointerId: e.pointerId }
    canvas?.setPointerCapture?.(e.pointerId)
    emit('down', { region, point: p })
  }

  const onPointerUp = (e) => {
    if (!pressed) return
    const dt = performance.now() - pressed.t0
    // 连续抚摸过多次 → 即使位移够大也算抚摸（人在顺毛，不是要把角色拖走）
    const kind = pressed.petSteps >= 3
      ? 'pet'
      : pressed.dragging || pressed.moved > cfg.dragMinMove
        ? 'drag'
        : pressed.moved <= cfg.tapMaxMove && dt <= cfg.tapMaxMs
          ? 'tap'
          : 'pet'
    const region = pressed.region
    emit('up', { region, kind, moved: pressed.moved, duration: dt, point: pressed.last })
    if (kind === 'tap') emit('tap', { region, point: pressed.start })
    else if (kind === 'pet') emit('petEnd', { region, steps: pressed.petSteps })
    else emit('dragEnd', { region, moved: pressed.moved })
    canvas?.releasePointerCapture?.(pressed.pointerId)
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
