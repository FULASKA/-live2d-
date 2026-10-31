/** 分区输入：指针事件 → tap / pet / drag 事件流。 */

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
    // 只认左键：中键是搬窗口/挪角色，不该被当成互动
    if (e.button !== 0) return
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
