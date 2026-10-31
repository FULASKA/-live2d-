/**
 * 视口层 —— 「窗口尺寸 A」与「模型尺寸 B」的绑定。
 *
 * 规格（用户定稿）：
 *   A（窗口大小）与 B（live2d 大小）绑定：改窗口 → 模型等比缩放，不会变形也不会被裁；
 *   同时 B 的缩放与位置相对窗口又是独立自由度，可以单独调大/调小、上下挪。
 * 所以内部拆成两个量：
 *   base  = 窗口对模型的 contain 比例（A 变化时自动重算，这就是「绑定」）
 *   zoom  = 用户对模型的相对缩放（独立，默认 1）
 *   最终 scale = base * zoom
 * 位置同理：窗口中心 + 归一化偏移（-1..1，1 = 半个窗口），窗口变化时模型不会掉出画面。
 *
 * 这一层不碰渲染内核细节，只算 numbers，便于在无 GPU 环境单测。
 */

export function createViewport({ model, app, margin = 0.95 } = {}) {
  const view = {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    mode: 'contain', // contain | cover | height
    margin,
    // 镜像：把模型水平翻转（「镜像摇摆」这类惊喜动效用），
    // 反算坐标全走 model.scale.x 的符号，所以热区命中/气泡定位自动跟着翻，别在这里取绝对值
    flipX: false,
  }

  const size = () => ({ w: app.screen.width || 1, h: app.screen.height || 1 })

  const modelSize = () => {
    const im = model.internalModel
    return { mw: im.originalWidth || 1, mh: im.originalHeight || 1 }
  }

  function baseScale() {
    const { w, h } = size()
    const { mw, mh } = modelSize()
    if (view.mode === 'cover') return Math.max(w / mw, h / mh)
    if (view.mode === 'height') return h / mh
    return Math.min(w / mw, h / mh) * view.margin
  }

  /** 把当前 view 状态写到 pixi 显示对象上 */
  function apply() {
    const { w, h } = size()
    const s = baseScale() * view.zoom
    model.scale.set(view.flipX ? -s : s, s)
    model.position.set(w / 2 + (view.offsetX * w) / 2, h / 2 + (view.offsetY * h) / 2)
    return { scale: s, x: model.position.x, y: model.position.y }
  }

  /** 窗口尺寸变化：改渲染器尺寸并重排。A→B 的绑定就发生在这一句里 */
  function resize(w, h) {
    const W = Math.max(1, Math.round(w))
    const H = Math.max(1, Math.round(h))
    if (app.screen.width !== W || app.screen.height !== H) app.renderer.resize(W, H)
    return apply()
  }

  /** 直接观察容器尺寸（ResizeObserver），不依赖 pixi 的 resizeTo 插件时序 */
  function observe(el) {
    const sync = () => {
      const r = el.getBoundingClientRect()
      resize(r.width || el.clientWidth || 1, r.height || el.clientHeight || 1)
    }
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    sync()
    return () => ro.disconnect()
  }

  return {
    view, apply, resize, observe, baseScale, size, modelSize,
    set(patch = {}) { Object.assign(view, patch); return apply() },
    /** 归一化坐标（相对窗口 0..1）→ 屏幕像素，交给区域判定 */
    toScreen(nx, ny) { const { w, h } = size(); return { x: nx * w, y: ny * h } },
    /** 屏幕像素 → 模型坐标（像素换算，不受 pixi 变换影响，测边界时更直观） */
    toModelLocal(x, y) {
      const s = model.scale.x || 1
      const { mw, mh } = modelSize()
      const bounds = model.getBounds()
      return {
        x: (x - model.position.x) / s + mw / 2,
        y: (y - model.position.y) / s + mh / 2,
        bounds,
      }
    },
    /** 模型坐标 → 屏幕像素（画热区叠层用） */
    modelToScreen(mx, my) {
      const s = model.scale.x || 1
      const { mw, mh } = modelSize()
      return {
        x: model.position.x + (mx - mw / 2) * s,
        y: model.position.y + (my - mh / 2) * s,
      }
    },
    /** 指针事件坐标 → 模型坐标（自动抵消 canvas 的 CSS 尺寸与渲染尺寸差异） */
    clientToModel(clientX, clientY) {
      const el = app.canvas
      const rect = el.getBoundingClientRect()
      const kx = (app.screen.width || rect.width) / (rect.width || 1)
      const ky = (app.screen.height || rect.height) / (rect.height || 1)
      const sx = (clientX - rect.left) * kx
      const sy = (clientY - rect.top) * ky
      const s = model.scale.x || 1
      const { mw, mh } = modelSize()
      return { x: (sx - model.position.x) / s + mw / 2, y: (sy - model.position.y) / s + mh / 2 }
    },
  }
}
