// Live2D Stage —— 应用渲染层（透明窗口里的角色）。
// 只做「角色 + 互动 + 设置」，验证台的调试面板不在这里。
import { createStage } from '../src/stage/engine.js'
import { createLayerStack } from '../src/stage/layers.js'
import { createViewport } from '../src/stage/viewport.js'
import { createGaze } from '../src/stage/gaze.js'
import { createRegionStore, createRegionInput, seedRegions, faceRegions, createFaceZoneReader, createHandZoneReader } from '../src/stage/regions.js'
import { createReactions, DEFAULT_REACTIONS } from '../src/stage/reactions.js'
import { createPetSway } from '../src/stage/pet-sway.js'
import { createFacePinch } from '../src/stage/face-pinch.js'
import { createLife } from '../src/stage/life.js'
import { createMouth } from '../src/stage/mouth.js'
import { createIdleFaces } from '../src/stage/idle-faces.js'
import { createCapture } from '../src/stage/capture.js'
import { createPosture } from '../src/stage/posture.js'
import { createPoses } from '../src/stage/poses.js'
import { createBubble } from '../src/stage/bubble.js'
import { createProfiler } from '../src/stage/perf.js'

const $ = (s) => document.querySelector(s)
const perf = createProfiler()
const TOGGLE_SET = new Set(['胸口衣服', '裙子切换', '脱鞋', '尾巴开关'])

/**
 * 分区互动时的嘴形（情绪覆盖）。
 * 表情包只驱动眼/脸，嘴由 mouth.js 单独驱动 —— 所以「被摸到哪个部位」的差别主要靠这里表达。
 * 字段是**相对待机嘴的偏移**：open 张开、form 嘴形（负=下撇/嫌弃，正=笑）、smile 嘴角、funnel 圆唇。
 */
const REGION_MOUTH = {
  胸: { open: 0.04, form: -0.45, ms: 2400 },
  腰: { open: 0.10, form: -0.35, ms: 2600 },
  裙摆: { open: 0.08, form: -0.62, ms: 3200 },          // 嫌弃：嘴角下撇、不情愿地微张嘴
  腿: { open: 0.26, form: 0.10, funnel: 0.30, ms: 2600 }, // 发晕：嘴微微张开、有点呆
  脚: { open: 0.50, form: 0.55, smile: 0.85, ms: 3200 },  // 被挠痒：忍不住笑出来
  头: { open: 0.10, form: 0.22, smile: 0.30, ms: 2200 },
  // 手被碰：小小的不好意思（嘴微微张开、笑意一点点），跟脚那种「被挠痒」区分开
  左手: { open: 0.12, form: 0.26, smile: 0.32, ms: 2000 },
  右手: { open: 0.12, form: 0.26, smile: 0.32, ms: 2000 },
}

/** 浏览器里打开 /app/ 时没有 Electron 预加载：给一套空壳，方便无头验证渲染 */
const shell = window.shell || {
  get: async () => ({ width: 520, height: 760, zoom: 1, gaze: true, strength: 1, alwaysOnTop: false, clickThrough: false }),
  set: async (patch) => patch,
  moveBy: () => {},
  dragBegin: () => {},
  dragEnd: () => {},
  setPassThrough: () => {},
  resizeBegin: () => {},
  resizeMove: () => {},
  resizeEnd: () => {},
  panel: () => {},
  center: () => {},
  quit: () => {},
  devtools: () => {},
  openHarness: () => {},
  onClickThrough: () => {},
}

const state = {
  caps: null, stage: null, layers: null, viewport: null, gaze: null,
  store: null, regionInput: null, reactions: null, settings: null,
  mask: null, maskAt: 0, maskPending: false, windowDragging: false, middleDragging: false,
  ignoring: false, pointerDown: false,
  physics: { inputs: new Set(), outputs: new Set() },
}

function toast(text, ms = 1800) {
  let el = $('#toast')
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el) }
  el.textContent = text
  el.classList.add('show')
  clearTimeout(toast._t)
  toast._t = setTimeout(() => el.classList.remove('show'), ms)
}

// ---------- 性能浮层（F3 开关；统计常驻，探针用 window.__perf.snapshot()） ----------
window.__perf = perf
function bootPerfOverlay() {
  state.stage?.ticker?.add?.(() => perf.frame())
  let el = null
  let timer = 0
  const paint = () => {
    if (!el) return
    const s = perf.snapshot(false)
    const row = (k, label) => (s[k] ? `<span>${label} <b>${s[k].avg.toFixed(1)}</b>ms · max ${s[k].max.toFixed(1)} · ${s[k].n}次</span>` : '')
    el.innerHTML = `<b>${s.fps.toFixed(1)} fps</b><br>` +
      row('dt', '帧间隔') + row('pre', '每帧逻辑') + row('pass', '穿透判定') +
      row('mask', '遮罩重建') + row('face', '脸部热区')
  }
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F3') return
    e.preventDefault()
    if (el) { el.remove(); el = null; clearInterval(timer); timer = 0; return }
    el = document.createElement('div')
    el.id = 'perf'
    document.body.appendChild(el)
    timer = setInterval(paint, 250)
    paint()
  })
}

async function main() {
  try {
    state.settings = await shell.get()
    state.caps = await fetch('/api/capabilities').then((r) => r.json())
    await bootStage()
    bootRegions()
    // 对话气泡：漫画式挂在头顶右侧（设置里可切左侧），角色移动/换尺寸时跟着走
    state.bubble = createBubble({
      el: $('#bubble'),
      anchor: () => regionScreenBox('头'),
      side: state.settings.bubbleSide === 'left' ? 'left' : 'right',
    })
    setInterval(() => { if (state.bubble?.visible) state.bubble.reposition() }, 250)
    bindPanel()
    bindWindowDrag()
    bindToolsDismiss()
    bindResizeHandles()
    bindReactionEditor()
    bindPassThrough()
    bootPerfOverlay()
    document.title = `stage · ${state.caps.model.name}`
  } catch (e) {
    console.error(e)
    toast(`启动失败：${e.message}`, 6000)
  }
}

async function loadPhysicsFlow() {
  const empty = { inputs: new Set(), outputs: new Set() }
  try {
    const modelUrl = new URL(state.caps.model.url, location.href).href
    const model = await fetch(modelUrl).then((r) => r.json())
    const rel = model?.FileReferences?.Physics
    if (!rel) return empty
    const phys = await fetch(new URL(rel, modelUrl).href).then((r) => r.json())
    const inputs = new Set()
    const outputs = new Set()
    for (const s of phys.PhysicsSettings || []) {
      for (const i of s.Input || []) if (i?.Source?.Id) inputs.add(i.Source.Id)
      for (const o of s.Output || []) if (o?.Destination?.Id) outputs.add(o.Destination.Id)
    }
    return { inputs, outputs }
  } catch { return empty }
}

async function bootStage() {
  const stage = await createStage({
    container: $('#stage'),
    modelUrl: state.caps.model.url,
  })
  state.stage = stage

  state.physics = await loadPhysicsFlow()
  state.layers = createLayerStack({
    param: stage.param,
    part: stage.part,
    isPhysicsInput: (id) => state.physics.inputs.has(id) && !state.physics.outputs.has(id),
  })
  // （姿势与物理输入的写入点在下面统一注册：必须在物理之前）

  state.reactions = createReactions({
    layers: state.layers,
    expressionDefs: state.caps.expressions,
    onEvent: (e) => { if (e.type === 'warn') console.warn('[reaction]', e.text) },
  })

  state.gaze = createGaze({
    param: stage.param,
    // 身体角度交给 posture 层（脊柱链），视线只管眼珠与头
    options: { enabled: state.settings.gaze !== false, strength: Number(state.settings.strength ?? 1), body: 0, bodyRoll: 0 },
  })

  // 姿态链：头 → 胸 → 腰 逐级跟随（弹簧 + 过冲），并且喂给物理权重最高的输入
  state.posture = createPosture({
    param: stage.param,
    gaze: state.gaze,
    options: { strength: Number(state.settings.strength ?? 1) },
  })

  // 抚摸晃动：蹭头时额外叠一层摆动（gaze 先定方向，这层再叠幅度）
  state.petSway = createPetSway({
    param: stage.param,
    options: { gain: Number(state.settings.petGain ?? 1.6) },
  })

  // 捏脸：按住「脸」热区拖动 → 鼓脸/单边鼓/抖脸盘
  // 伪面捕驱动：把「我们的姿态」翻译成模型的**面捕捉取通道**
  // （AngleX/Y/Z、PositionX/Y、ParamBreath、JawOpen…），物理链才会整条活起来
  state.capture = createCapture({ param: stage.param })

  // 捏脸：按住「脸」热区拖动 → 鼓脸/单边鼓/抖脸盘 + 身体前倾放大
  state.facePinch = createFacePinch({
    param: stage.param,
    options: {
      // 用户手动开了「前倾」时，捏脸就不再抢 LeanInput
      leanBlocked: () => !!state.layers?.hasExpression('前倾'),
    },
  })

  // 活气层：耳朵扑棱 / 头发惯性 / 耳环摆动（读回物理值再叠加，写在物理之后）
  state.life = createLife({ param: stage.param })
  // 嘴：呼吸微动 + 说话音节（模型 LipSync 组是空的，这是唯一驱动源）
  state.mouth = createMouth({ param: stage.param })
  // 随机小表情：笑 / 吐舌头 / 吐舌头+单眼笑，待机时自己冒出来
  state.idleFaces = createIdleFaces({ param: stage.param })
  // 终点姿势：举手 / 竖手指 / 狗尾草（数值取自模型自带的 motion3 末帧），过渡自己补
  state.poses = createPoses({ layers: state.layers })

  let lastT = performance.now()
  let frameDt = 1000 / 60
  const motionState = { x: null, y: null, vx: 0, vy: 0, ax: 0, ay: 0 }
  const tickDt = () => {
    const now = performance.now()
    frameDt = Math.min(120, Math.max(1, now - lastT))
    lastT = now
  }

  /**
   * 窗口/角色的位移加速度 → 惯性冲击。
   * 拖动窗口时（左键按住角色搬窗），角色的头发、耳环、
   * 裙摆会「被甩」——这才是拖动时最出效果的那一下。窗口坐标变化由 screenX/Y 读到。
   */
  const updateMotion = (dtMs) => {
    // 用「角色在屏幕上的位置」做微分：窗口被搬 + 角色在窗口内被挪，两条路都能触发惯性。
    const x = window.screenX + (state.stage?.model?.position?.x || 0)
    const y = window.screenY + (state.stage?.model?.position?.y || 0)
    if (motionState.x == null) { motionState.x = x; motionState.y = y; return }
    // 中键移动不做物理（用户要求：纯位移，不产生惯性冲击）
    if (state.middleDragging) {
      motionState.x = x
      motionState.y = y
      motionState.vx = 0
      motionState.vy = 0
      state.life?.motion(0, 0)
      state.capture?.motion(0, 0)
      return
    }
    const dt = Math.max(0.008, dtMs / 1000)
    const vx = (x - motionState.x) / dt
    const vy = (y - motionState.y) / dt
    const ax = (vx - motionState.vx) / dt
    const ay = (vy - motionState.vy) / dt
    motionState.x = x
    motionState.y = y
    motionState.vx = vx
    motionState.vy = vy
    // 平滑一层：窗口坐标是整数，直接微分会有尖刺
    motionState.ax = motionState.ax * 0.6 + ax * 0.4
    motionState.ay = motionState.ay * 0.6 + ay * 0.4
    state.life?.motion(motionState.ax, motionState.ay)
    state.capture?.motion(motionState.vx, motionState.vy)
  }

  // ① 物理之前：喂物理输入 + 摆姿势。
  // 物理的输入就是「头部角度 / 呼吸 / 前倾」（physics3 实测 19 处引用），
  // 而我们原来在物理**之后**才写这些角度 —— 等于让物理永远在算静止的模型，
  // 头发、耳朵、耳环的物理全部僵死，这就是「没有物理效果」的真正原因。
  stage.onBeforePhysics(() => {
    tickDt()
    updateMotion(frameDt)
    // 姿势值要先钉进 layers，applyPhysics 才会把物理输入一起喂进去
    state.poses?.apply(frameDt)
    state.layers.applyPhysics()
    state.facePinch?.applyPhysics()
    perf.time('pre', () => {
      state.gaze?.apply(frameDt)
      state.petSway?.apply(frameDt)
      state.facePinch?.applyPosture(frameDt)
      // 脊柱链：胸/腰跟随（喂给物理权重最高的 ParamBodyAngleX/Z）
      state.posture?.apply(frameDt)
      // 姿态摆好之后，翻译成面捕捉取通道（物理要吃的就是这些）
      state.capture?.apply(frameDt)
    })
  })

  // ② 物理之后：表情 / 嘴 / 活气 / 鼓脸。
  // 活气层要「读回物理刚算出的值再加偏移」，所以必须晚于物理。
  stage.onBeforeUpdate(() => {
    perf.time('post', () => {
      state.layers.apply()
      state.mouth?.apply(frameDt)
      state.idleFaces?.apply(frameDt)
      state.life?.apply(frameDt)
      state.facePinch?.apply(frameDt)
    })
  })

  // ---------- 标定探针（开发期用：单参数覆写 / 物理读回采样） ----------
  window.__probe = {
    /** 覆写一个参数（持续生效，直到 clear） */
    param(id, v, blend = 'Overwrite') {
      state.layers.removeSource('probe')
      state.layers.addExpression('probe', [{ Id: id, Value: v, Blend: blend }], { fade: 0, source: 'probe' })
    },
    /** 一组参数同时覆写 */
    params(list, blend = 'Overwrite') {
      state.layers.removeSource('probe')
      state.layers.addExpression('probe', list.map(([Id, Value]) => ({ Id, Value, Blend: blend })), { fade: 0, source: 'probe' })
    },
    clear() { state.layers.removeSource('probe') },
    /** 诊断：直接写核心参数并立刻读回（判断「写不进去」还是「写完又被覆盖」） */
    setRead(id, v) {
      const idx = state.stage.param.index(id)
      const before = state.stage.param.get(id)
      state.stage.param.set(id, v)
      const after = state.stage.param.get(id)
      return { id, idx, before, after }
    },
    /** 诊断：在 beforeModelUpdate 末尾（各层写完之后）读一次 */
    readAtUpdate(id) {
      return new Promise((resolve) => {
        const off = state.stage.onBeforeUpdate(() => { const v = state.stage.param.get(id); off(); resolve(v) })
      })
    },
    /** 诊断：一次分层写入，在物理前/更新前各读一次值（判断写点与覆盖） */
    traceWrite(id, v) {
      state.layers.removeSource('probe')
      state.layers.addExpression('probe', [{ Id: id, Value: v, Blend: 'Overwrite' }], { fade: 0, source: 'probe' })
      return new Promise((resolve) => {
        const out = []
        const offPre = state.stage.onBeforePhysics(() => out.push(['pre', state.stage.param.get(id)]))
        const offPost = state.stage.onBeforeUpdate(() => out.push(['post', state.stage.param.get(id)]))
        setTimeout(() => {
          offPre(); offPost(); state.layers.removeSource('probe')
          resolve({ out: out.slice(0, 6), isIn: state.physics.inputs.has(id), isOut: state.physics.outputs.has(id) })
        }, 150)
      })
    },
    // ---- 捏脸 / 活气 / 嘴的探针 ----
    pinch(side = 'L', px = 320) { state.facePinch?.grab(side); state.facePinch?.move(px, 0) },
    pinchEnd() { state.facePinch?.release() },
    pinchState: () => state.facePinch?.state() ?? null,
    flap(side = 'L', amp = 1) { state.life?.flap(side, amp) },
    life: () => state.life?.state() ?? null,
    talk(v = 0) { state.mouth?.speak(v) },
    /** 直接触发某个部位的情绪嘴形（截图/验证用，等价于摸到那个部位） */
    mood(name) {
      const m = REGION_MOUTH[name]
      if (m) state.mouth?.setMood(m, m.ms)
      return m ? { name, ...m } : null
    },
    moods: () => Object.keys(REGION_MOUTH),
    clearMood() { state.mouth?.clearMood() },
    faces: () => state.idleFaces?.presets() ?? [],
    face(name) { return state.idleFaces?.trigger(name) ?? null },
    faceState: () => state.idleFaces?.state() ?? null,
    /** 终点姿势：预设清单 / 切换 / 状态（数值来自模型自带 motion3 末帧） */
    poses: () => state.poses?.presets() ?? [],
    pose(name, ms = 260) { return state.poses?.set(name, ms) ?? false },
    poseState: () => state.poses?.state() ?? null,
    /** 气泡：说一句 / 换文字 / 收起 / 读状态（验证自适应排版用） */
    bubble(text, st) {
      if (!state.bubble) return null
      if (text == null) { state.bubble.hide(); return null }
      state.bubble.show(String(text), { state: st })
      return state.bubble.state()
    },
    bubbleHide() { state.bubble?.hide() },
    bubbleState: () => state.bubble?.state() ?? null,
    bubbleSide(side) { state.bubble?.setSide(side) },
    /** 读一个像素的 RGBA（判断眼睛有没有闭：虹膜是蓝的，闭眼是皮肤色） */
    pixel: (x, y) => state.stage?.sampleAlpha?.(x, y) ?? null,
    mouth: () => state.mouth?.state() ?? null,
    earNow: () => ['LEar1', 'LEar2', 'LEar3', 'REar1', 'ParamMouthOpenY', 'LeanInput', 'ParamAngleZ']
      .map((id) => `${id}=${Math.round((state.stage.param.get(id) || 0) * 100) / 100}`).join(' '),
    read: (id) => state.stage.param.get(id),
    /** 参数的定义区间（判断某个值是不是「超出范围被钳住」） */
    info: (id) => state.stage.param.info(id),
    /** 当前左右脸热区的包围盒（模型像素）——用来量化「仰头让脸变宽」 */
    faceBox() {
      const rs = (state.store?.all || []).filter((r) => r.name === '左脸' || r.name === '右脸')
      if (!rs.length) return null
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const r of rs) {
        for (const p of r.points || []) {
          if (p[0] < minX) minX = p[0]
          if (p[0] > maxX) maxX = p[0]
          if (p[1] < minY) minY = p[1]
          if (p[1] > maxY) maxY = p[1]
        }
      }
      return { w: Math.round(maxX - minX), h: Math.round(maxY - minY), y: Math.round((minY + maxY) / 2) }
    },
    /** 物理输出参数在 onBeforeUpdate（物理之后）还有没有值？
     *  有值 → 可以「叠加」；读到 0 → 只能整层接管。
     */
    physicsSample(ids = ['LEar1', 'LEar2', 'LEar3', 'FrontHairY1', 'SideHairY1', 'LateHairY1'], frames = 90) {
      return new Promise((resolve) => {
        const acc = {}
        for (const id of ids) acc[id] = { min: Infinity, max: -Infinity, n: 0, last: null }
        let left = frames
        const off = state.stage.onBeforeUpdate(() => {
          for (const id of ids) {
            const v = state.stage.param.get(id)
            if (v == null) continue
            const a = acc[id]
            if (v < a.min) a.min = v
            if (v > a.max) a.max = v
            a.last = Math.round(v * 100) / 100
            a.n += 1
          }
          if (--left <= 0) {
            off()
            for (const id of ids) {
              acc[id].min = Math.round(acc[id].min * 100) / 100
              acc[id].max = Math.round(acc[id].max * 100) / 100
            }
            resolve(acc)
          }
        })
      })
    },
    /** 物理「算之前」这一瞬看到的参数值 —— 判断物理到底吃到了什么 */
    preSample(ids = ['ParamAngleZ', 'ParamAngleY', 'ParamAngleX', 'ParamBreath', 'LeanInput', 'LEar1', 'FrontHairY1'], frames = 60) {
      return new Promise((resolve) => {
        const acc = {}
        for (const id of ids) acc[id] = { min: Infinity, max: -Infinity, n: 0 }
        let left = frames
        const off = state.stage.onBeforePhysics(() => {
          for (const id of ids) {
            const v = state.stage.param.get(id)
            if (v == null) continue
            const a = acc[id]
            if (v < a.min) a.min = v
            if (v > a.max) a.max = v
            a.n += 1
          }
          if (--left <= 0) {
            off()
            for (const id of ids) {
              acc[id].min = Math.round(acc[id].min * 10) / 10
              acc[id].max = Math.round(acc[id].max * 10) / 10
            }
            resolve(acc)
          }
        })
      })
    },
    phys: () => state.stage.physicsInfo(),
    cap: () => state.capture?.state() ?? null,
    posture: () => state.posture?.state() ?? null,
    motion: () => ({
      vx: Math.round(motionState.vx), vy: Math.round(motionState.vy),
      ax: Math.round(motionState.ax), ay: Math.round(motionState.ay),
      life: state.life?.state?.().ext ?? null,
    }),
    /** 用 shell.moveBy 摇窗口，模拟拖动带来的加速度（CDP 移动不了真实窗口） */
    shakeWindow(px = 36, steps = 24, interval = 40) {
      let i = 0
      const id = setInterval(() => {
        shell.moveBy(i % 2 ? px : -px, 0)
        if (++i >= steps) clearInterval(id)
      }, interval)
    },
    /** 关掉桌面光标反馈，让探针的合成鼠标事件不被真实光标覆盖 */
    desktopGaze(on) { window.__noDesktopGaze = !on },
    /** 在物理之前强行钉住某些参数（测物理响应用） */
    holdPre(list) {      state._holdPreOff?.()
      state._holdPreOff = state.stage.onBeforePhysics(() => {
        for (const [id, v] of list) state.stage.param.set(id, v)
      })
    },
    holdPreOff() { state._holdPreOff?.(); state._holdPreOff = null },
    /** 关掉自制活气层，用来单独观察模型自带物理 */
    lifeOff() { state.life.set({ windAmp: 0, windAmpX: 0, earTremor: 0, earAmp: 0, jewelAmp: 0, inertiaX: 0, inertiaY: 0, earMin: 9999, earMax: 9999 }) },
    lifeOn() { state.life.set({ windAmp: 0.035, windAmpX: 0.02, earTremor: 0.012, earAmp: 1, jewelAmp: 0.3, inertiaX: 0.85, inertiaY: 1, earMin: 5.5, earMax: 13 }) },
  }

  const viewport = createViewport({ model: stage.model, app: stage.app })
  state.viewport = viewport
  viewport.observe($('#stage'))
  const clampOff = (v) => Math.max(-1.5, Math.min(1.5, Number(v) || 0))
  viewport.set({
    zoom: Number(state.settings.zoom) || 1,
    offsetX: clampOff(state.settings.offsetX),
    offsetY: clampOff(state.settings.offsetY),
  })

  // 窗口坐标为「客户端像素」，窗口外的点会是负数/越界值，正是我们要的方向。
  // 参考半径按「半个屏幕」给，所以鼠标跑到窗口外、桌面任何角落都有明确方向感。
  const lookFromClient = (cx, cy) => {
    const r = stage.canvas.getBoundingClientRect()
    const sw = stage.app.screen.width, sh = stage.app.screen.height
    const dpr = sw / Math.max(1, r.width)
    const sx = ((cx - r.left) / Math.max(1, r.width)) * sw
    const sy = ((cy - r.top) / Math.max(1, r.height)) * sh
    const halfW = Math.max(r.width / 2, (window.screen?.width || r.width) / 2) * dpr
    const halfH = Math.max(r.height / 2, (window.screen?.height || r.height) / 2) * dpr
    const m = stage.model
    state.gaze.setTargetFromScreen(sx, sy, m.position.x, m.position.y, halfW, halfH)
    window.__gazeLast = { cx: Math.round(cx), cy: Math.round(cy) }
  }

  window.addEventListener('pointermove', (e) => {
    lookFromClient(e.clientX, e.clientY)
    // 抚摸中的位移（客户端像素）→ 头摆
    const lastC = state.lastClient
    state.lastClient = { x: e.clientX, y: e.clientY }
    if (state.petArmed && lastC) {
      state.petSway?.move(e.clientX - lastC.x, e.clientY - lastC.y, window.innerWidth, window.innerHeight)
    }
  })
  // 桌面级跟随：主进程持续读全局光标位置，窗口外也能看过去
  shell.onCursor?.((p) => { if (!window.__noDesktopGaze) lookFromClient(p.x, p.y) })
}

/** 捏脸时的表情反馈：＞＜ + 脸红（独立 source，松手整组撤掉，不干扰分区反应） */const PINCH_EXPRS = ['＞＜', '脸红']
function pinchExpressions(on) {
  if (!state.layers) return
  if (!on) { state.layers.removeSource('pinch'); return }
  for (const n of PINCH_EXPRS) {
    const def = (state.caps.expressions || []).find((e) => e.name === n)
    if (def) state.layers.addExpression(n, def.params, { source: 'pinch' })
  }
}

function bootRegions() {
  const key = state.caps.model.name
  state.store = createRegionStore([])
  const bands = ['头', '胸', '腰', '裙摆', '腿', '脚', '尾巴']
  // 部件 id → 显示名走 Map：原来每次都是一次 148 项线性查找，采样期被调用上百次
  const partNameById = new Map((state.caps.parts || []).map((p) => [p.id, p.name]))
  const names = {
    get: (i) => {
      try { return partNameById.get(state.stage.core.getPartId(i).getString().s) || '' } catch { return '' }
    },
  }
  const loaded = state.store.load(key)
  const missing = loaded ? bands.filter((n) => !state.store.all.some((r) => r.name === n)) : bands
  if (!loaded || missing.length) {
    const seeded = seedRegions({
      core: state.stage.core,
      internalModel: state.stage.model.internalModel,
      displayNames: names,
      canvas: state.stage.modelSize(),
    })
    for (const r of state.store.all.slice()) state.store.remove(r.id)
    for (const r of seeded) state.store.add({ ...r, reaction: DEFAULT_REACTIONS[r.name] || {} })
    state.store.save(key)
  }

  // 脸部热区（捏脸用）：左右各一个，眼睛以上仍归头部；老档案（单个「脸」）自动迁移
  const FACE_V = 3
  const old = state.store.all.filter((r) => r.name === '脸' || r.name === '左脸' || r.name === '右脸')
  const needFace = old.length !== 2 || old.some((r) => r.v !== FACE_V)
  if (needFace) {
    for (const r of old) state.store.remove(r.id)
    for (const fr of faceRegions({
      core: state.stage.core,
      internalModel: state.stage.model.internalModel,
      displayNames: names,
      canvas: state.stage.modelSize(),
    })) {
      state.store.add({ ...fr, v: FACE_V, reaction: {} })
    }
    state.store.save(key)
  }

  // 手部热区（左手/右手）：两只手垂在裙摆两侧、又会随身体摆，固定矩形必然错位，
  // 所以和脸一样按网格周期重算。老的档案没有这两块，自动补，不动别的热区。
  const HAND_V = 1
  const oldHands = state.store.all.filter((r) => r.name === '左手' || r.name === '右手')
  const needHands = oldHands.length !== 2 || oldHands.some((r) => r.v !== HAND_V)
  const handReader = createHandZoneReader({
    core: state.stage.core,
    internalModel: state.stage.model.internalModel,
    displayNames: names,
    canvas: state.stage.modelSize(),
  })
  state.handReader = handReader
  if (needHands) {
    for (const r of oldHands) state.store.remove(r.id)
    let fresh = []
    try { fresh = handReader.read() } catch { fresh = [] }
    for (const fr of fresh) {
      state.store.add({ ...fr, v: HAND_V, reaction: DEFAULT_REACTIONS[fr.name] || {} })
    }
    if (fresh.length) state.store.save(key)
  }

  // 左/右脸热区要**跟着变形走**：前倾这类动作会让脸整体下移，
  // 热区若固定在初始位置就会「摸脸点到胸」。这里按当前蒙皮顶点周期重算（只改内存，不改存档）。
  function startFaceRegionTracking(partNames) {
    // 索引表缓存一次，之后每次只取那几个 drawable 的顶点（原来每次都要全量扫 715 个）
    const reader = createFaceZoneReader({
      core: state.stage.core,
      internalModel: state.stage.model.internalModel,
      displayNames: partNames,
      canvas: state.stage.modelSize(),
    })
    state.faceReader = reader
    setInterval(() => {
      const cur = state.store.all.filter((r) => r.name === '左脸' || r.name === '右脸')
      if (cur.length === 2) {
        let fresh = []
        perf.time('face', () => {
          try { fresh = reader.read() } catch { fresh = [] }
        })
        if (fresh.length === 2) {
          for (const r of cur) {
            const f = fresh.find((x) => x.name === r.name)
            if (f) r.points = f.points
          }
        }
      }
      // 手和脸用同一个心跳：各自缓存索引表，单次都是亚毫秒级
      const hands = state.store.all.filter((r) => r.name === '左手' || r.name === '右手')
      if (hands.length === 2) {
        let freshHands = []
        perf.time('hand', () => {
          try { freshHands = state.handReader.read() } catch { freshHands = [] }
        })
        if (freshHands.length === 2) {
          for (const r of hands) {
            const f = freshHands.find((x) => x.name === r.name)
            if (f) r.points = f.points
          }
        }
      }
    }, 80)
  }

  state.regionInput = createRegionInput({
    store: state.store,
    viewport: state.viewport,
    canvas: $('#stage'),
    isNear: (sp) => {
      const s = state.stage.size()
      const m = 8
      return sp.x >= -m && sp.y >= -m && sp.x <= s.width + m && sp.y <= s.height + m
    },
    onEvent: (ev) => {
      const name = ev.region?.name
      const isHand = name === '左手' || name === '右手'
      // 点手 = 竖手指（抬起/放下），不再走表情反应；摸手还是 ＞＜ + 脸红
      if (ev.type === 'tap' && isHand) {
        const next = state.poses?.toggle('竖手指')
        toast(next === '竖手指' ? '竖手指' : '手放下')
      } else if (ev.type === 'tap' && name && name !== '脸') state.reactions.apply(ev.region, 'tap')
      if (ev.type === 'pet' && name && name !== '脸' && ev.step === 1) {
        state.reactions.apply(ev.region, 'pet')
        // 摸到不同部位，嘴给一个对应的情绪（表情包只改眼/脸，嘴是我们这层驱动的）
        const mood = REGION_MOUTH[name]
        if (mood) state.mouth?.setMood(mood, mood.ms)
      }
      // 被点/被摸的时候，耳朵跟着扑棱一下（平时它自己每 6~13 秒也会扑棱）
      if (name === '头' && (ev.type === 'tap' || (ev.type === 'pet' && ev.step === 1))) {
        state.life?.flap(Math.random() < 0.5 ? 'L' : 'R', 1)
      }
      // 只有头会「跟着手摆」：按下起记位移，滑动按 50% 转成角度；其它部位不再弹
      if (name === '头') {
        if (ev.type === 'down' || (ev.type === 'pet' && !state.petArmed)) {
          state.petArmed = true
          state.lastClient = null
          state.petSway?.start('头')
        } else if (ev.type === 'up' || ev.type === 'petEnd') {
          state.petArmed = false
          state.petSway?.release()
        }
      }
      // 捏脸：按住脸拖 → 鼓脸
      // 捏脸：左右各一半热区，按住哪边捏哪边（方向不再参与判定）
      if (name === '左脸' || name === '右脸') {
        if (ev.type === 'down') {
          state.facePinch?.grab(name === '右脸' ? 'R' : 'L')
          pinchExpressions(true)
        } else if (ev.type === 'dragMove') {
          // ev.dx/dy 是模型坐标，换成客户端像素再交给捏脸层（maxPull 是按像素定的）
          const k = state.stage?.model?.scale?.x || 1
          state.facePinch?.move((ev.dx || 0) * k, (ev.dy || 0) * k)
        } else if (ev.type === 'up') {
          state.facePinch?.release()
          pinchExpressions(false)
        }
      }
      // 手在哪的偏摆已废弃：现在由 pointermove 的位移驱动（见上方 petArmed）
    },
  })
  state.regionInput.attach($('#stage'))
  startFaceRegionTracking(names)
}

/** 通用「按住拖动 = 搬窗口」绑定 */function dragWindow(el, { canStart, ignore } = {}) {
  let dragging = false
  let lastX = 0
  let lastY = 0
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    if (ignore?.(e)) return
    if (canStart && !canStart(e)) return
    dragging = true
    state.windowDragging = true
    lastX = e.screenX
    lastY = e.screenY
    el.classList.add('dragging')
    try { el.setPointerCapture(e.pointerId) } catch {}
  })
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const dx = e.screenX - lastX
    const dy = e.screenY - lastY
    if (!dx && !dy) return
    lastX = e.screenX
    lastY = e.screenY
    shell.moveBy(dx, dy)
  })
  const end = (e) => {
    dragging = false
    state.windowDragging = false
    el.classList.remove('dragging')
    try { el.releasePointerCapture(e.pointerId) } catch {}
  }
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
  return el
}

// ---------- 透明处穿透：只让「角色轮廓」接收鼠标 ----------
// 窗口是矩形，透明区本来也吃鼠标：停在空白处，后面的桌面/窗口点不到；
// 空白处按下还能把整块看不见的窗口拖走 —— 这就是「隐藏的窗口边缘」。
// 做法：把当前帧渲染成缩略 alpha 掩码，指针不在角色身上就让点击穿过去。
const MASK_SCALE = 4
// 掩码几乎全空 = 没渲染出来，这种情况下永远保持可点，别把窗口弄成点不动的死窗
const MASK_MIN_COVERAGE = 0.004

const MASK_TTL = 700
function refreshMask(force = false) {
  const now = performance.now()
  if (!force) {
    if (state.mask && now - state.maskAt < MASK_TTL) return state.mask
    // 不在这里重画：挂个待办，等这一帧画完之后直接读回来（见 bindPassThrough 里的 afterRender）。
    // 事件回调里插一次渲染会打乱帧节奏，窗口正在拖动时尤其明显（虚影/闪烁）。
    state.maskPending = true
    return state.mask
  }
  const m = perf.time('mask', () => state.stage?.alphaMask?.(MASK_SCALE, (k, ms) => perf.mark(`m.${k}`, ms)))
  if (m) { state.mask = m; state.maskAt = now; state.maskPending = false }
  return state.mask
}

/** 客户端坐标是否落在角色身上；拿不到掩码一律当作「在」——宁可点得到 */
function bodyAt(x, y) {
  const m = state.mask
  if (!m || m.coverage < MASK_MIN_COVERAGE) return true
  const r = state.stage.canvas.getBoundingClientRect()
  const sx = (x - r.left) / Math.max(1, r.width)
  const sy = (y - r.top) / Math.max(1, r.height)
  if (sx < 0 || sy < 0 || sx > 1 || sy > 1) return false
  const cx = Math.min(m.w - 1, Math.floor(sx * m.w))
  const cy = Math.min(m.h - 1, Math.floor(sy * m.h))
  // 一个小膨胀：边缘抖一两格不算离开角色，免得边沿闪烁
  for (let dy = -1; dy <= 1; dy++) {
    const ny = cy + dy
    if (ny < 0 || ny >= m.h) continue
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx
      if (nx < 0 || nx >= m.w) continue
      if (m.data[ny * m.w + nx] > 8) return true
    }
  }
  return false
}

/** 指针在面板/工具条这类 HTML 控件上时一律算「要接收」 */
function overUi(x, y) {
  const el = document.elementFromPoint(x, y)
  return !!el && el.tagName !== 'CANVAS'
}

function bindPassThrough() {
  let pending = null
  let queued = false
  // 按住期间一概不穿透：滑出轮廓那一刻若忽略鼠标，pointerup 会丢，抚摸/拖动就卡在按下态
  const down = () => { state.pointerDown = true }
  const up = () => { state.pointerDown = false }
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
  window.addEventListener('blur', up)
  const applyNow = () => {
    queued = false
    if (!pending || !state.settings) return
    // 判据三条：
    //   1. 指针在面板/工具条/浮标上 → 一律接收（否则勾了穿透连面板都点不动）
    //   2. 手动穿透模式 → 角色也穿（UI 之外一律忽略）
    //   3. 常态 → 按住不穿，其余按角色轮廓掩码
    let want
    const el = document.elementFromPoint(pending.x, pending.y)
    const onHandle = !!el && !!el.classList && el.classList.contains('rz')
    if (el && el.tagName !== 'CANVAS' && !onHandle) want = false
    else if (state.settings.clickThrough) want = true
    else if (onHandle) want = false   // 贴着边角才能抓住、改窗口大小
    else want = !state.pointerDown && !bodyAt(pending.x, pending.y)
    if (want === state.ignoring) return
    state.ignoring = want
    shell.setPassThrough(want)
  }
  const apply = () => perf.time('pass', applyNow)
  // 勾选/取消穿透后立刻按当前指针重算，不必等鼠标晃一下
  state.recomputePass = () => { if (pending) apply() }
  window.addEventListener('pointermove', (e) => {
    pending = { x: e.clientX, y: e.clientY }
    refreshMask()
    if (queued) return
    queued = true
    requestAnimationFrame(apply)
  })
  window.addEventListener('resize', () => refreshMask(true))
  refreshMask(true)
  // 掩码读回挂在「每帧画完」之后：只读像素，不额外渲染。
  // 拖动窗口期间先攒着（轮廓没变，读了也没人用），拖动结束自然补上。
  state.stage?.afterRender?.(() => {
    if (!state.maskPending || state.windowDragging) return
    state.maskPending = false
    const m = perf.time('mask', () => state.stage.captureMask?.(MASK_SCALE, (k, ms) => perf.mark(`m.${k}`, ms)))
    if (m) { state.mask = m; state.maskAt = performance.now() }
  })
  // 验证钩子（和 harness 里的 __reaction 一样，只为无头检查）
  window.__layout = () => ({
    win: [window.innerWidth, window.innerHeight],
    pos: [Math.round(window.screenX), Math.round(window.screenY)],
    offsetX: state.viewport?.view.offsetX ?? null,
    model: state.stage ? [Math.round(state.stage.model.position.x), Math.round(state.stage.model.position.y)] : null,
    gaze: state.gaze?.state?.().target ?? null,
    gazeLast: window.__gazeLast || null,
    sway: state.petSway?.state?.() ?? null,
    angles: state.stage ? ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'].map((id) => Math.round(state.stage.param.get(id) * 10) / 10) : null,
    lean: state.stage ? Math.round(state.stage.param.get('LeanInput') * 10) / 10 : null,
  })
  window.__pass = {
    bodyAt,
    refreshMask,
    sway: (name) => state.petSway?.trigger(name),
    charRight: () => Math.round(charRightClient()),
    face: () => state.facePinch?.state() ?? null,
    faceCenter: () => {
      const r = state.store?.all?.find((x) => x.name === '脸')
      if (!r || !r.points?.length) return null
      const cx = r.points.reduce((s, p) => s + p[0], 0) / r.points.length
      const cy = r.points.reduce((s, p) => s + p[1], 0) / r.points.length
      const st = state.stage
      const cr = st.canvas.getBoundingClientRect()
      const sc = st.model.scale.x
      const ms = st.modelSize()
      return {
        x: cr.left + st.model.position.x + (cx - ms.width / 2) * sc,
        y: cr.top + st.model.position.y + (cy - ms.height / 2) * sc,
      }
    },
    regions: () => (state.store?.all || []).map((r) => ({ name: r.name, z: r.z })),
    /** 当前在场的表情层（验证「摸手不该出竖食指」用） */
    exprs: () => state.layers?.inspect?.() ?? null,
    handBoxes: () => (state.store?.all || []).filter((r) => r.name === '左手' || r.name === '右手').map((r) => {
      const xs = (r.points || []).map((p) => p[0])
      const ys = (r.points || []).map((p) => p[1])
      return { name: r.name, z: r.z, minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
    }),
    handCount: () => state.handReader?.count?.() ?? -1,
    /** 热区 → 客户端像素矩形（调热区位置用） */
    screenBox: (name) => regionScreenBox(name),
    leanState: () => {
      const def = (state.caps?.expressions || []).find((x) => x.name === '前倾')
      const keys = def ? Object.keys(def.params) : []
      return {
        def: def ? def.params : null,
        active: !!state.layers?.hasExpression?.('前倾'),
        values: keys.map((k) => [k, state.stage?.param.get(k), state.stage?.param.info(k)?.min, state.stage?.param.info(k)?.max]),
      }
    },
    tryLean: () => toggleLean(),
    cheekTest: (s) => state.facePinch?.test(s),
    faceVerts: () => {
      // 「脸」部件所有网格顶点的平均坐标（看变形是否真的动）
      const core = state.stage.core
      const im = state.stage.model.internalModel
      let sx = 0, sy = 0, n2 = 0
      const n = core.getDrawableCount()
      for (let i = 0; i < n; i++) {
        let parent = -1
        try { parent = core.getDrawableParentPartIndex(i) } catch { continue }
        if (parent < 0) continue
        let name = ''
        try { name = state.caps.parts.find((p) => p.id === core.getPartId(parent).getString().s)?.name || '' } catch {}
        if (!/^脸$|^脸底$/.test(name)) continue
        let v = null
        try { v = im.getDrawableVertices(i) } catch { continue }
        if (!v) continue
        for (let k = 0; k < v.length; k += 2) { sx += v[k]; sy += v[k + 1]; n2++ }
      }
      return n2 ? { x: Math.round(sx / n2), y: Math.round(sy / n2), n: n2 } : null
    },
    regionAt: (x, y) => regionAtClient(x, y)?.name ?? null,
    regionCenter: (name) => {
      const r = state.store?.all?.find((x) => x.name === name)
      if (!r || !r.points?.length) return null
      const mx = r.points.reduce((s, p) => s + p[0], 0) / r.points.length
      const my = r.points.reduce((s, p) => s + p[1], 0) / r.points.length
      return state.viewport.modelToScreen(mx, my)
    },
    regionDebug: (x, y) => {
      const p = state.viewport.clientToModel(x, y)
      const rows = (state.store?.all || []).map((r) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        for (const [px, py] of r.points || []) {
          if (px < minX) minX = px
          if (px > maxX) maxX = px
          if (py < minY) minY = py
          if (py > maxY) maxY = py
        }
        return { name: r.name, z: r.z, minX: Math.round(minX), minY: Math.round(minY), maxX: Math.round(maxX), maxY: Math.round(maxY) }
      })
      return { model: { x: Math.round(p.x), y: Math.round(p.y) }, rows }
    },
    zoom: (z) => state.viewport.set({ zoom: z }),
    pinchTest: (dx, dy) => { state.facePinch.grab(); state.facePinch.move(dx, dy) },
    pinchReset: () => state.facePinch.release(),
    mask: () => state.mask && { w: state.mask.w, h: state.mask.h, coverage: +state.mask.coverage.toFixed(4) },
    state: () => ({ ignoring: state.ignoring, clickThrough: state.settings?.clickThrough, pointerDown: state.pointerDown }),
  }
}

// ---------- 穿透模式 ----------
// 手动穿透时角色区完全不可点（连右键都进不来），所以必须留一个「鼠标也能点到」的退路：
// 面板/工具条本身仍然接收鼠标，再加一个常驻浮标一键恢复。
function setClickThrough(on) {
  state.settings.clickThrough = !!on
  const box = $('#click-through')
  if (box) box.checked = !!on
  if (on) showPassHint()
  else hidePassHint()
  state.recomputePass?.()
  shell.set({ clickThrough: !!on })
  if (on) toast('穿透已开：角色不可点，点下方「恢复鼠标」或按 Ctrl+Alt+L', 4000)
}

function showPassHint() {
  let el = $('#pass-hint')
  if (!el) {
    el = document.createElement('div')
    el.id = 'pass-hint'
    el.innerHTML = '<span>穿透中</span><button id="pass-restore" type="button">恢复鼠标</button>'
    el.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);' +
      'display:flex;gap:8px;align-items:center;padding:7px 10px 7px 14px;border-radius:999px;' +
      'background:rgba(16,20,34,.94);border:1px solid rgba(120,150,255,.45);color:#dfe6ff;' +
      'font:12px/1 system-ui,sans-serif;z-index:9999;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.45)'
    const btn = el.querySelector('#pass-restore')
    btn.style.cssText = 'all:unset;cursor:pointer;padding:5px 10px;border-radius:999px;' +
      'background:#5a7cff;color:#fff;font:12px/1 system-ui,sans-serif'
    btn.onclick = () => setClickThrough(false)
    document.body.appendChild(el)
  }
  el.style.display = 'flex'
}

function hidePassHint() {
  const el = $('#pass-hint')
  if (el) el.style.display = 'none'
}

// ---------- 窗口轮廓拖拽改大小 ----------
function syncSizeReadout() {
  const el = $('#size-readout')
  if (el) el.textContent = `${window.innerWidth} × ${window.innerHeight}`
}

function bindResizeHandles() {
  document.querySelectorAll('.rz').forEach((el) => {
    const edge = el.dataset.edge
    let last = null
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      last = { x: e.screenX, y: e.screenY }
      try { el.setPointerCapture(e.pointerId) } catch {}
      shell.resizeBegin(edge)
    })
    el.addEventListener('pointermove', (e) => {
      if (!last) return
      shell.resizeMove(e.screenX - last.x, e.screenY - last.y)
    })
    const end = (e) => {
      if (!last) return
      last = null
      shell.resizeEnd()
      try { el.releasePointerCapture(e.pointerId) } catch {}
      syncSizeReadout()
      refreshMask(true)
    }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  })
  window.addEventListener('resize', () => {
    syncSizeReadout()
    refreshMask(true)
  })
  syncSizeReadout()
}

// ---------- 面板展开时贴到角色右侧，不挡角色 ----------
const PANEL_W = 292      // 面板总宽（262 + 左右内边距）
const PANEL_GAP = 14     // 面板左缘与角色右缘的间距
const PANEL_PAD = 10     // 面板右侧留白
let panelBaseOffset = null
let panelDelta = 0       // 为面板临时加宽了多少（关面板要收回）

/** 角色轮廓在窗口内的右边界（客户端像素）：取 alpha 掩码最右侧的实心像素 */
function charRightClient() {
  const st = state.stage
  if (!st) return window.innerWidth
  const r = st.canvas.getBoundingClientRect()
  const m = state.mask || refreshMask(true)
  if (!m) return r.right
  for (let x = m.w - 1; x >= 0; x--) {
    for (let y = 0; y < m.h; y++) {
      if (m.data[y * m.w + x] > 8) return r.left + ((x + 1) / m.w) * r.width
    }
  }
  return r.right
}

/** 等窗口尺寸真正落定再回调（resize 事件 + 兜底定时） */
function afterWindowResize(done) {
  let called = false
  const finish = () => {
    if (called) return
    called = true
    window.removeEventListener('resize', finish)
    done()
  }
  window.addEventListener('resize', finish)
  setTimeout(finish, 240)
}

/**
 * 面板贴着角色右缘展开：先按角色实际右边界算面板位置，
 * 只有当「角色 + 间距 + 面板」放不下时才把窗口往右长，长多少算多少。
 * 加宽后模型用 offset 补偿回原位，所以角色屏幕位置不动。
 */
function setPanelExpanded(open) {
  const panel = $('#panel')
  const W0 = Math.max(1, window.innerWidth)
  const o = state.viewport?.view.offsetX ?? 0

  if (open) {
    panelBaseOffset = o
    const left = Math.round(charRightClient() + PANEL_GAP)
    panel.style.left = `${left}px`
    panel.style.right = 'auto'
    const need = left + PANEL_W + PANEL_PAD
    panelDelta = Math.max(0, need - W0)
    if (panelDelta > 0) shell.panel({ dx: panelDelta })
    afterWindowResize(() => {
      if (panelDelta > 0) {
        const w1 = Math.max(1, window.innerWidth)
        state.viewport.set({ offsetX: (o * W0 - panelDelta) / w1 })
      }
      // 重建掩码供后续判定用；面板位置只按展开前算的那次为准（否则待机摆尾会把面板推来推去）
      refreshMask(true)
      syncSizeReadout()
    })
  } else {
    panel.style.left = ''
    panel.style.right = ''
    const dx = -panelDelta
    panelDelta = 0
    if (dx) shell.panel({ dx })
    afterWindowResize(() => {
      state.viewport.set({ offsetX: panelBaseOffset ?? 0 })
      syncSizeReadout()
      refreshMask(true)
    })
  }
}

function bindWindowDrag() {
  const stage = $('#stage')
  // 左键按住角色拖 = 搬窗口（按在分区上不算）；中键另有一套（见 bindMiddleDrag）
  dragWindow(stage, { canStart: (e) => !state.regionInput?.pressed?.region && bodyAt(e.clientX, e.clientY) })
  bindMiddleDrag(stage)
}

/**
 * 中键拖动：
 *   - 设置面板关着 → 搬窗口（主进程按全局光标锚点搬，不会累积漂移）
 *   - 设置面板开着 → 把角色在窗口里挪（改模型偏移，松手写进 settings）
 * 注意：中键移动**不喂物理**（不产生惯性冲击），纯位移。
 */
function bindMiddleDrag(stage) {
  let st = null
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 1) return
    e.preventDefault()
    hideTools()
    const panelOpen = !$('#panel').classList.contains('hidden')
    const v = state.viewport.view
    st = {
      mode: panelOpen ? 'model' : 'window',
      x: e.screenX,
      y: e.screenY,
      o: { offsetX: v.offsetX, offsetY: v.offsetY },
    }
    state.middleDragging = true
    if (!panelOpen) { state.windowDragging = true; shell.dragBegin() }
    try { stage.setPointerCapture(e.pointerId) } catch {}
  })
  stage.addEventListener('pointermove', (e) => {
    if (!st) return
    const dx = e.screenX - st.x
    const dy = e.screenY - st.y
    if (st.mode === 'window') return
    const w = Math.max(1, window.innerWidth)
    const h = Math.max(1, window.innerHeight)
    const clampOff = (v) => Math.max(-0.9, Math.min(0.9, v))
    state.viewport.set({
      offsetX: clampOff(st.o.offsetX + (2 * dx) / w),
      offsetY: clampOff(st.o.offsetY + (2 * dy) / h),
    })
  })
  const end = (e) => {
    if (!st) return
    const mode = st.mode
    st = null
    state.middleDragging = false
    try { stage.releasePointerCapture(e.pointerId) } catch {}
    if (mode === 'model') {
      const v = state.viewport.view
      shell.set({ offsetX: v.offsetX, offsetY: v.offsetY })
      refreshMask(true)
    } else {
      state.windowDragging = false
      shell.dragEnd()
    }
  }
  stage.addEventListener('pointerup', end)
  stage.addEventListener('pointercancel', end)
}

// ---------- 右键弹窗：设置 / 退出（固定窗口右上角，不挡角色） ----------
function showTools() { $('#tools').classList.remove('hidden') }
function hideTools() { $('#tools').classList.add('hidden') }

/** 客户端坐标 → 命中的热区 */
function regionAtClient(x, y) {
  if (!state.store || !state.viewport) return null
  const p = state.viewport.clientToModel(x, y)
  return state.store.hit(p.x, p.y)
}

/**
 * 热区 → 客户端像素矩形（气泡定位 / 面板联动都用它）。
 * 换算方式与角色在窗口里的实际位置一致：canvas rect + 模型偏移 + 缩放。
 */
function regionScreenBox(name) {
  const r = state.store?.all?.find((x) => x.name === name)
  if (!r || !r.points?.length || !state.stage) return null
  const xs = r.points.map((p) => p[0])
  const ys = r.points.map((p) => p[1])
  const cr = state.stage.canvas.getBoundingClientRect()
  const sc = state.stage.model.scale.x
  const ms = state.stage.modelSize()
  const sx = (mx) => cr.left + state.stage.model.position.x + (mx - ms.width / 2) * sc
  const sy = (my) => cr.top + state.stage.model.position.y + (my - ms.height / 2) * sc
  return {
    left: sx(Math.min(...xs)), top: sy(Math.min(...ys)),
    right: sx(Math.max(...xs)), bottom: sy(Math.max(...ys)),
    width: (Math.max(...xs) - Math.min(...xs)) * sc,
    height: (Math.max(...ys) - Math.min(...ys)) * sc,
  }
}

/** 头部右键：前倾做成**开关**（点一次开、再点一次关），不再几秒后自己消失 */let leanOn = false
function toggleLean() {
  const def = (state.caps.expressions || []).find((x) => x.name === '前倾')
  if (!def) { toast('模型没有「前倾」表情'); return }
  if (leanOn) {
    state.layers.removeSource('lean')
    leanOn = false
    toast('前倾：关')
  } else {
    state.layers.addExpression('前倾', def.params, { source: 'lean' })
    leanOn = true
    toast('前倾：开')
  }
}

/** 点别处关掉弹窗（面板里例外：点面板不该收弹窗） */
function bindToolsDismiss() {
  window.addEventListener('pointerdown', (e) => {
    const t = $('#tools')
    if (!t || t.classList.contains('hidden')) return
    if (e.target?.closest?.('#tools')) return
    hideTools()
  }, true)
}

// ---------- 分区反应编辑器 ----------
// 反应存在热区上（region.reaction），reactions.apply 优先用它，其次才回落到 DEFAULT_REACTIONS。
// 所以这里改完直接 store.save()，重启保留。
function applyReaction(regionName, kind, { exprs = [], mode = 'expr' } = {}) {
  const region = state.store.all.find((r) => r.name === regionName)
  if (!region) return
  const next = { ...(region.reaction || {}) }
  if (mode === 'toggle') {
    if (!exprs.length) delete next[kind]
    else next[kind] = { toggle: exprs[0] }
  } else {
    if (!exprs.length) delete next[kind]
    else next[kind] = { expr: exprs }
  }
  region.reaction = next
  state.store.save(state.caps.model.name)
}

function bindReactionEditor() {
  const regionSel = $('#rx-region')
  const kindSel = $('#rx-kind')
  const modeSel = $('#rx-mode')
  const box = $('#rx-exprs')
  if (!regionSel || !box) return

  const regions = state.store.all.map((r) => r.name)
  regionSel.innerHTML = regions.map((n) => `<option>${n}</option>`).join('')
  const exprs = (state.caps.expressions || []).map((e) => e.name)

  const current = () => {
    const region = state.store.all.find((r) => r.name === regionSel.value)
    const kind = kindSel.value
    const rx = region?.reaction?.[kind]
    return {
      mode: rx?.toggle ? 'toggle' : 'expr',
      picked: new Set(rx?.toggle ? [rx.toggle] : (rx?.expr || [])),
    }
  }

  const render = () => {
    const cur = current()
    modeSel.value = cur.mode
    box.innerHTML = exprs.map((n) => (
      `<label><input type="checkbox" value="${n}"${cur.picked.has(n) ? ' checked' : ''}>${n}</label>`
    )).join('')
    box.querySelectorAll('input').forEach((inp) => {
      inp.onchange = () => {
        let picked = [...box.querySelectorAll('input:checked')].map((i) => i.value)
        // 切换型只能用一个表情：后勾的顶替前面的
        if (modeSel.value === 'toggle' && picked.length > 1) {
          picked = [picked[picked.length - 1]]
          box.querySelectorAll('input').forEach((i) => { i.checked = i.value === picked[0] })
        }
        applyReaction(regionSel.value, kindSel.value, { exprs: picked, mode: modeSel.value })
      }
    })
  }

  regionSel.onchange = render
  kindSel.onchange = render
  modeSel.onchange = () => {
    const picked = [...box.querySelectorAll('input:checked')].map((i) => i.value)
    const use = modeSel.value === 'toggle' ? picked.slice(0, 1) : picked
    applyReaction(regionSel.value, kindSel.value, { exprs: use, mode: modeSel.value })
    render()
  }
  $('#rx-reset').onclick = () => {
    const region = state.store.all.find((r) => r.name === regionSel.value)
    if (!region) return
    const d = DEFAULT_REACTIONS[regionSel.value]
    region.reaction = d ? JSON.parse(JSON.stringify(d)) : {}
    state.store.save(state.caps.model.name)
    render()
    toast(`${regionSel.value} 反应已恢复默认`)
  }
  render()
}

function bindPanel() {
  const panel = $('#panel')
  const isOpen = () => !panel.classList.contains('hidden')
  // 开：窗口向右长出一块面板位；关：收回。角色视觉位置不动，所以面板永远不压角色
  const show = (on) => {
    const open = on === undefined ? !isOpen() : !!on
    if (open === isOpen()) return
    panel.classList.toggle('hidden', !open)
    setPanelExpanded(open)
  }

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    // 头部 / 脸部捏脸区右键 = 触发「前倾」，不弹菜单（避免和互动打架）
    const r = regionAtClient(e.clientX, e.clientY)
    if (r && (r.name === '头' || r.name === '左脸' || r.name === '右脸')) { toggleLean(); return }
    showTools()
  })
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    show(false)
    hideTools()
  })
  $('#panel-close').onclick = () => show(false)
  $('#tool-settings').onclick = () => { hideTools(); show(true) }
  $('#tool-quit').onclick = () => shell.quit()

  const s = state.settings
  syncSizeReadout()
  $('#zoom').value = Number(s.zoom) || 1
  $('#gaze').checked = s.gaze !== false
  $('#strength').value = Number(s.strength ?? 1)
  $('#top').checked = !!s.alwaysOnTop
  $('#click-through').checked = !!s.clickThrough
  // 气泡：开关 + 挂哪一侧
  const bubbleOn = $('#bubble-on')
  const bubbleSide = $('#bubble-side')
  if (bubbleOn) {
    bubbleOn.checked = s.bubble !== false
    bubbleOn.onchange = (e) => {
      const on = !!e.target.checked
      state.settings.bubble = on
      shell.set({ bubble: on })
      if (!on) state.bubble?.hide()
      toast(on ? '气泡：开' : '气泡：关')
    }
  }
  if (bubbleSide) {
    bubbleSide.value = s.bubbleSide === 'left' ? 'left' : 'right'
    bubbleSide.onchange = (e) => {
      const side = e.target.value === 'left' ? 'left' : 'right'
      state.settings.bubbleSide = side
      shell.set({ bubbleSide: side })
      state.bubble?.setSide(side)
    }
  }

  $('#win-center').onclick = () => shell.center()

  $('#zoom').oninput = (e) => {
    const zoom = Number(e.target.value)
    state.viewport.set({ zoom })
    shell.set({ zoom })
    refreshMask(true)
  }
  $('#gaze').onchange = (e) => {
    state.gaze.set({ enabled: e.target.checked })
    shell.set({ gaze: e.target.checked })
  }
  $('#strength').oninput = (e) => {
    const strength = Number(e.target.value)
    state.gaze.set({ strength })
    state.posture?.set({ strength })
    shell.set({ strength })
  }
  const petGain = (v) => {
    state.petSway.set({ gain: v })
  }
  $('#pet-gain').value = Number(s.petGain ?? 1.6)
  $('#pet-gain').oninput = (e) => {
    const v = Number(e.target.value)
    petGain(v)
    shell.set({ petGain: v })
  }
  $('#top').onchange = (e) => shell.set({ alwaysOnTop: e.target.checked })
  $('#click-through').onchange = (e) => setClickThrough(e.target.checked)
  shell.onClickThrough((v) => setClickThrough(v))
  $('#open-harness').onclick = () => shell.openHarness()
  $('#quit').onclick = () => shell.quit()
}

main()
