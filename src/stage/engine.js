/**
 * 渲染内核适配层 —— 全项目唯一允许直接碰渲染内核的地方。
 *
 * 内核选型：pixi.js 8 + untitled-pixi-live2d-engine（Cubism 5 运行库）
 *
 * 换核心理由（实测结论，别再回头用旧的）：
 *   旧内核 pixi-live2d-display@0.4 走 Cubism 4 管线，不认逐网格的乘法色/滤色。
 *   本模型是 moc3 v5，鼻子阴影靠乘法色实现 —— 旧内核把它画成一整块实心（黑/白视内核而定），
 *   瞳孔同时丢色变成灰白圈。新内核是官方 Cubism 5 框架的封装，乘法色原生支持，画面即正确。
 *   经过：验证台 alt2 页在真机 GPU 上确认「瞳孔有、鼻子正常、脸无错位」→ 主线换核。
 *
 * 分层责任：这里只暴露「模型原语」——参数、部件、动作、表情、命中、更新时钟。
 * 优先级 / 叠加 / 冲突规则在 layers.js 与 actions.js，绝不下沉到这里。
 * 这样日后若要换成官方 Cubism 5 SDK 直写渲染循环，只需要重写本文件。
 */

/** 与内核 MotionPriority 对齐（0 NONE / 1 IDLE / 2 NORMAL / 3 FORCE） */
export const MotionPriority = { NONE: 0, IDLE: 1, NORMAL: 2, FORCE: 3 }

const CORE_GLOBAL = 'Live2DCubismCore'
const DEFAULT_CORE = '/vendor/live2dcubismcore.min.js'

let pluginRegistered = false

/**
 * 内核里的 ID 是 csmString，不是 JS 字符串；不同版本取值路径不一致，统一在这里兜住。
 * 已知形态：{ getString(): { s: 'ParamAngleX' } }
 */
export function csmText(handle) {
  if (handle == null) return ''
  if (typeof handle === 'string') return handle
  const s = typeof handle.getString === 'function' ? handle.getString() : handle
  if (typeof s === 'string') return s
  return (s && s.s) || ''
}

/**
 * 加载官方 Cubism Core。
 * 注意：Core 是 Live2D 的专有二进制，不得打包进本仓库（许可证禁止再分发），
 * 开发期由 scripts/fetch-core.mjs 下到 vendor/，发布时由启动器首次运行下载。
 */
export async function loadCore(url = DEFAULT_CORE) {
  if (globalThis[CORE_GLOBAL]) return true
  await new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = url
    s.async = true
    s.onload = () => resolve(true)
    s.onerror = () => reject(new Error(`Cubism Core 加载失败：${url}`))
    document.head.appendChild(s)
  }).catch(() => {})
  return Boolean(globalThis[CORE_GLOBAL])
}

/**
 * 建舞台。
 * @param {object} o
 * @param {HTMLElement} o.container 画布挂载点（尺寸即窗口尺寸 A）
 * @param {string} o.modelUrl model3.json 的 URL
 * @param {number} [o.backgroundAlpha=0] 0 = 全透明（纯净播放的前提）
 * @returns {Promise<object>} 舞台句柄
 */
export async function createStage(o = {}) {
  const {
    container, modelUrl,
    backgroundAlpha = 0, antialias = true,
    resolution = Math.min(window.devicePixelRatio || 1, 2),
    autoStart = true,
    verbose = false,
  } = o

  const log = verbose ? (...a) => console.log('[stage]', ...a) : () => {}

  if (!container) throw new Error('createStage 缺少 container')
  if (!modelUrl) throw new Error('createStage 缺少 modelUrl')
  if (!(await loadCore(o.coreUrl))) {
    throw new Error('缺少 Cubism Core：先跑 node scripts/fetch-core.mjs，或检查 /vendor 挂载')
  }
  log('core ready')

  const PIXI = await import('pixi.js')
  const engine = await import('untitled-pixi-live2d-engine/cubism')
  log('modules ready', Object.keys(engine).slice(0, 5).join(','))
  if (!pluginRegistered) {
    PIXI.extensions.add(engine.Live2DPlugin)
    pluginRegistered = true
  }

  const app = new PIXI.Application()
  const rect = container.getBoundingClientRect()
  await app.init({
    backgroundAlpha,
    antialias,
    autoDensity: true,
    resolution,
    autoStart,
    width: Math.max(1, Math.round(rect.width || 1)),
    height: Math.max(1, Math.round(rect.height || 1)),
  })
  app.canvas.style.display = 'block'
  app.canvas.style.width = '100%'
  app.canvas.style.height = '100%'
  container.appendChild(app.canvas)
  log('app ready', app.screen.width, app.screen.height)

  // autoHitTest / autoFocus 关掉：指针交给上层（视线强度、遮挡穿透都要自己算），不让内核抢
  log('model load start', modelUrl)
  const model = await engine.Live2DModel.from(modelUrl, { autoHitTest: false, autoFocus: false })
  log('model load done', model.internalModel?.originalWidth, model.internalModel?.originalHeight)
  model.anchor.set(0.5, 0.5)
  app.stage.addChild(model)

  const internal = model.internalModel
  const core = internal.coreModel

  // ---------- 每帧钩子：内核在 coreModel.update() 之前一刻发这个事件 ----------
  // 这是官方层级里最后一个能改参数的位置；之后立刻按参数算顶点并绘制。
  const beforeHooks = new Set()
  internal.on('beforeModelUpdate', () => {
    for (const fn of beforeHooks) {
      try { fn() } catch (e) { console.error('[layer] hook 失败', e) }
    }
  })

  const clocks = { ms: 0, frames: 0 }

  /** 推进时钟（内核在渲染时才真正消费 delta） */
  const advance = (dtMs) => {
    clocks.ms += dtMs
    clocks.frames += 1
    model.update(dtMs)
  }

  /** 手动步进：停掉自动 ticker，逐帧「推进 + 渲染」，用于无头/CI 与可复现截图 */
  const step = (frames = 1, dtMs = 1000 / 60) => {
    app.stop()
    for (let i = 0; i < frames; i++) {
      advance(dtMs)
      app.renderer.render(app.stage)
    }
    return clocks
  }

  /** 只渲染不推进（参数改动后的即时预览） */
  const renderOnce = () => app.renderer.render(app.stage)

  // ---------- 参数 ----------
  const param = (() => {
    const ids = []
    const indexOf = new Map()
    const n = core.getParameterCount()
    for (let i = 0; i < n; i++) {
      const id = csmText(core.getParameterId(i))
      ids.push(id)
      indexOf.set(id, i)
    }
    const has = (id) => indexOf.has(id)
    return {
      ids,
      count: ids.length,
      index: (id) => (indexOf.has(id) ? indexOf.get(id) : -1),
      has,
      info(id) {
        const i = indexOf.get(id)
        if (i == null) return null
        return { id, index: i, min: core.getParameterMinimumValue(i), max: core.getParameterMaximumValue(i), default: core.getParameterDefaultValue(i) }
      },
      get: (id) => (has(id) ? core.getParameterValueByIndex(indexOf.get(id)) : null),
      set: (id, v) => { const i = indexOf.get(id); if (i != null) core.setParameterValueByIndex(i, v) },
      add: (id, v) => { const i = indexOf.get(id); if (i != null) core.addParameterValueByIndex(i, v) },
      snapshot() {
        const out = {}
        for (const id of ids) out[id] = param.get(id)
        return out
      },
    }
  })()

  // ---------- 部件（分区互动与「隐藏部件」都用它） ----------
  const part = (() => {
    const ids = []
    const indexOf = new Map()
    const n = core.getPartCount()
    for (let i = 0; i < n; i++) {
      const id = csmText(core.getPartId(i))
      ids.push(id)
      indexOf.set(id, i)
    }
    return {
      ids,
      count: ids.length,
      index: (id) => (indexOf.has(id) ? indexOf.get(id) : -1),
      has: (id) => indexOf.has(id),
      get: (id) => (indexOf.has(id) ? core.getPartOpacityByIndex(indexOf.get(id)) : null),
      set: (id, v) => { const i = indexOf.get(id); if (i != null) core.setPartOpacityByIndex(i, v) },
    }
  })()

  // ---------- 动作 / 表情（原语；谁的优先级更高由上层定） ----------
  const motion = (group, index, { loop, priority = MotionPriority.FORCE, expression, onFinish } = {}) =>
    model.motion(group, index, priority, { loop, expression, onFinish })

  const stopMotions = () => model.stopMotions()

  /** 内核自带的表情通道（单层，会与动作绑定的表情互相覆盖）；叠加层在 layers.js */
  const setExpression = (id) => model.expression(id)

  // ---------- 几何 ----------
  const modelSize = () => ({ width: internal.originalWidth, height: internal.originalHeight })

  /** 屏幕坐标 → 模型坐标（区域判定用） */
  const toModel = (x, y) => {
    const p = new PIXI.Point(x, y)
    model.toModelPosition(p)
    return p
  }

  /** 本模型没有 HitAreas，命中靠区域表；保留内核命中做交叉验证 */
  const hitTest = (x, y) => model.hitTest(x, y)

  const size = () => ({ width: app.screen.width, height: app.screen.height })

  /**
   * 采样某点是否被角色覆盖（alpha）。给「透明处穿透 / 不透明处才互动」用。
   * 做法是先强制渲染一帧再 readPixels —— 只在点击这类低频事件上调用，不进每帧路径。
   * @returns {{alpha:number|null, error?:string}} alpha 0..255，null 表示取不到
   */
  const sampleAlpha = (x, y) => {
    try {
      app.renderer.render(app.stage)
      const gl = app.renderer.gl
      const res = app.renderer.resolution || 1
      const px = Math.round(x * res)
      const py = Math.round(app.renderer.height - y * res - 1)
      if (px < 0 || py < 0 || px >= app.renderer.width || py >= app.renderer.height) return { alpha: 0 }
      const buf = new Uint8Array(4)
      gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf)
      return { alpha: buf[3], rgba: [buf[0], buf[1], buf[2], buf[3]] }
    } catch (e) {
      return { alpha: null, error: String(e && e.message || e) }
    }
  }

  const resize = (w, h) => {
    const W = Math.max(1, Math.round(w))
    const H = Math.max(1, Math.round(h))
    if (app.screen.width !== W || app.screen.height !== H) app.renderer.resize(W, H)
    return size()
  }

  return {
    PIXI, engine, app, model, core,
    canvas: app.canvas,
    param, part,
    clocks: () => ({ ...clocks }),
    advance, step, renderOnce,
    start: () => app.start(),
    stop: () => app.stop(),
    ticker: app.ticker,
    onBeforeUpdate(fn) { beforeHooks.add(fn); return () => beforeHooks.delete(fn) },
    motion, stopMotions, setExpression,
    modelSize, size, resize, toModel, hitTest, sampleAlpha,
    focus: (x, y, instant) => model.focus(x, y, instant),
    destroy() {
      beforeHooks.clear()
      app.destroy({ removeView: true }, { children: true })
    },
  }
}
