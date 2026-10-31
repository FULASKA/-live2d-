// Live2D Stage —— 应用渲染层（透明窗口里的角色）。
// 只做「角色 + 互动 + 设置」，验证台的调试面板不在这里。
import { createStage } from '../src/stage/engine.js'
import { createLayerStack } from '../src/stage/layers.js'
import { createViewport } from '../src/stage/viewport.js'
import { createGaze } from '../src/stage/gaze.js'
import { createPoseBus } from '../src/stage/pose-bus.js'
import { createIdleMotions } from '../src/stage/idle-motions.js'
import { createTickle } from '../src/stage/tickle.js'
import { createRegionStore, createRegionInput, seedRegions, faceRegions, foreheadRegion, createFaceZoneReader, createHandZoneReader } from '../src/stage/regions.js'
import { createReactions, DEFAULT_REACTIONS } from '../src/stage/reactions.js'
import { createPetSway } from '../src/stage/pet-sway.js'
import { createFacePinch } from '../src/stage/face-pinch.js'
import { createLife } from '../src/stage/life.js'
import { createMouth } from '../src/stage/mouth.js'
import { createIdleFaces } from '../src/stage/idle-faces.js'
import { createCapture } from '../src/stage/capture.js'
import { createPosture } from '../src/stage/posture.js'
import { createPoses, POSES, OFFICIAL_POSES } from '../src/stage/poses.js'
import { PHRASES } from '../src/stage/phrases.js'
import { createBubble } from '../src/stage/bubble.js'
import { createAgentLink } from '../src/stage/agent-link.js'
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
  腰: { open: 0.42, form: 0.5, smile: 0.8, ms: 2800 },    // 被挠痒：和脚一样忍不住笑
  裙摆: { open: 0.08, form: -0.62, ms: 3200 },          // 嫌弃：嘴角下撇、不情愿地微张嘴
  腿: { open: 0.26, form: 0.10, funnel: 0.30, ms: 2600 }, // 发晕：嘴微微张开、有点呆
  脚: { open: 0.50, form: 0.55, smile: 0.85, ms: 3200 },  // 被挠痒：忍不住笑出来
  头: { open: 0.10, form: 0.22, smile: 0.30, ms: 2200 },
  // 手被碰：小小的不好意思（嘴微微张开、笑意一点点），跟脚那种「被挠痒」区分开
  左手: { open: 0.12, form: 0.26, smile: 0.32, ms: 2000 },
  右手: { open: 0.12, form: 0.26, smile: 0.32, ms: 2000 },
  // 摸到胯：嘴上不情愿（下撇、抿着），配黑脸
  胯: { open: 0.08, form: -0.55, ms: 3600 },
}

/** 浏览器里打开 /app/ 时没有 Electron 预加载：给一套空壳，方便无头验证渲染 */
const shell = window.shell || {
  get: async () => ({ width: 520, height: 760, zoom: 1, gaze: true, strength: 1, alwaysOnTop: false, clickThrough: false }),
  set: async (patch) => patch,
  moveBy: () => {},
  dragBegin: () => {},
  dragEnd: () => {},
  setPassThrough: () => {},
  fit: () => {},
  openSettings: () => {},
  onSettings: () => {},
  stageRpc: async () => ({ ok: false }),
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

// ---------- 控制总线：agent / 脚本 → 舞台，舞台 → agent ----------
// 下行：SSE /api/events 收动作；上行：POST /api/feedback 报互动、POST /api/snapshot 报状态。
// 舞台不认「agent 是谁」——DSH 插件、命令行、别的脚本走同一个入口。
const BUS_HOLD_MS = 2500

function postJSON(url, body, token) {
  try {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-stage-token': token },
      body: JSON.stringify(body),
    }).catch(() => null)
  } catch { return null }
}

/** 上行反馈：只报「真的发生了什么」，悬停/移动不刷日志 */
function emitFeedback(ev, token) {
  if (!token) return
  postJSON('/api/feedback', ev, token)
}

/** 下行动作：kind 见 docs/PROTOCOL.md。改这里 = 扩协议，记得同步文档。 */
function applyAction(msg) {
  const a = msg.action || {}
  const action = String(a.action || a.kind || '')
  const fade = Number(msg.fade ?? a.fade ?? 0.3)
  const agent = state.settings?.token
  switch (action) {
    case 'say': {
      const text = String(a.text ?? '')
      if (!text || !state.bubble) break
      state.bubble.show(text, { state: a.state || 'idle' })
      state.agentLink?.cancelHide?.()
      const ms = Number(a.ms ?? 0)
      // 显式指令优先于「工作状态」气泡：否则 DSH 状态轮询两秒后就把这句话盖掉
      state.busOwnUntil = performance.now() + Math.max(ms, 2500)
      if (ms > 0) setTimeout(() => { if (state.bubble?.text === text) state.bubble.hide() }, ms)
      break
    }
    case 'expression': {
      const name = a.name ? String(a.name) : ''
      state.layers?.removeSource('bus')
      if (!name) break
      const def = (state.caps.expressions || []).find((e) => e.name === name)
      if (!def) { console.warn('[bus] 没有这个表情:', name); break }
      state.layers?.addExpression(name, def.params, { source: 'bus', fade })
      break
    }
    case 'pose': {
      if (!a.name) { state.poses?.release(Number(fade) * 1000 || 240); break }
      state.poses?.set(String(a.name), Number(a.ms) || 320)
      break
    }
    case 'look': {
      // 临时接管视线：hold 结束前不再跟鼠标（否则下一帧就被桌面坐标盖掉）
      state.agentLookUntil = performance.now() + (Number(a.ms) || BUS_HOLD_MS)
      state.gaze?.setTarget(Number(a.x ?? 0), Number(a.y ?? 0))
      break
    }
    case 'idle': {
      const mode = String(a.mode || (a.name ? 'play' : 'pause'))
      if (mode === 'play') state.idle?.trigger(a.name ? String(a.name) : undefined)
      else if (mode === 'pause') state.idle?.pause(Number(a.ms) || 5000)
      else if (mode === 'resume') state.idle?.resume?.()
      break
    }
    case 'state': {
      // 复用 DSH 联动那条路：气泡文案 / 表情 / 小动作的映射都在 agent-link.js
      state.agentLink?.apply({ state: a.state ?? null, at: Date.now(), task: a.task ?? null })
      break
    }
    case 'stop': {
      const scope = String(a.scope || 'all')
      if (scope === 'all' || scope === 'expression') state.layers?.removeSource('bus')
      if (scope === 'all') { state.poses?.release(); state.bubble?.hide() }
      break
    }
    default: break
  }
  // 动作执行完立刻刷新快照 + 打一条回执，agent 侧不用等下一次心跳
  state.busSnap?.()
  emitFeedback({ type: 'action-done', gesture: action, detail: msg.id || null, at: null }, agent)
}

function bootBus() {
  const token = state.settings?.token
  const port = state.settings?.port
  if (!token || !port) {
    console.warn('[bus] 缺少 token/port：外部控制不可用')
    return
  }
  const snap = () => {
    if (!state.bubble) return
    postJSON('/api/snapshot', {
      model: state.caps?.model?.name || null,
      agent: state.agentLink?.state() ?? null,
      bubble: state.bubble.state(),
      idle: state.idle?.state() ?? null,
      pose: state.poses?.state() ?? null,
      // 当前挂着的表情层（source=bus 的是外部指令，agent 的是 DSH 状态）
      exprs: (state.layers?.inspect?.()?.layers || []).map((l) => `${l.source}:${l.name}`),
      look: state.agentLookUntil > performance.now() ? 'agent' : 'cursor',
    }, token)
  }
  state.seenActions = state.seenActions || new Set()
  const handle = (msg) => {
    if (!msg || msg.type !== 'action') return
    if (msg.id) {
      if (state.seenActions.has(msg.id)) return
      state.seenActions.add(msg.id)
      if (state.seenActions.size > 120) state.seenActions.delete(state.seenActions.values().next().value)
    }
    try { applyAction(msg) } catch (err) { console.warn('[bus] 动作失败', err) }
  }
  try {
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`)
    es.onmessage = (e) => {
      let msg = null
      try { msg = JSON.parse(e.data) } catch { return }
      // hello 带回连接的最近动作（页面刚重载也能补齐）
      if (msg.type === 'hello') { for (const a of msg.actions || []) handle({ ...a, type: 'action' }); return }
      handle(msg)
    }
    es.onerror = () => { /* 服务端 retry:2000，EventSource 自己重连 */ }
    state.bus = es
  } catch (e) { console.warn('[bus] 连接失败', e) }
  state.busSnap = snap
  snap()
  state.busTimer = setInterval(snap, 4000)
}

async function main() {
  try {
    state.settings = await shell.get()
    state.caps = await fetch('/api/capabilities').then((r) => r.json())
    // 先吃「改动补丁」：姿势/台词/反应/热区都能被覆盖，用户拿原模型也能复现我们的改动
    await applyStagePatch()
    await bootStage()
    bootRegions()
    // 窗口尺寸跟角色绑定：模型尺寸拿到了，立刻把窗口收成刚好包住角色的样子
    applyFit(true)
    // 对话气泡：贴窗口右上角（选左侧就贴左上角），窗口本身刚好包住角色，所以等于贴在头斜上方
    state.bubble = createBubble({
      el: $('#bubble'),
      side: 'right', // 位置固定贴右上角（自定义左右已移除）
      corner: true,
      // 冒泡时动嘴：按字数估时长（约 145ms/字 + 起止），念完自动收
      onSpeak: (text) => {
        // null = 气泡收起：闭嘴，回到呼吸的常态
        if (text == null) { state.mouth?.stop?.(); return }
        const n = Array.from(String(text)).length
        const ms = Math.max(600, Math.min(4200, 160 + n * 145))
        state.mouth?.talk?.(ms)
      },
    })
    setInterval(() => { if (state.bubble?.visible) state.bubble.reposition() }, 200)
    // DSH 联动：状态 → 气泡台词 / 表情 / 小动作（状态文件由主进程轮询后推过来）
    state.agentLink = createAgentLink({
      bubble: state.bubble,
      layers: state.layers,
      expressions: state.caps.expressions || [],
      poses: state.poses,
      life: state.life,
      mouth: state.mouth,
    })
    shell.onAgentStatus?.((snap) => {
      // 外部指令刚说过的台词有优先权（时长见 applyAction 的 say）
      if (performance.now() < (state.busOwnUntil || 0)) return
      state.agentLink?.apply(snap)
    })
    bindSettings()
    bindTools()
    bindWindowDrag()
    bindToolsDismiss()
    bindFrame()
    bindPassThrough()
    state.bubble.setScale(bubbleScale())
    applyBorder(!!state.settings.border)
    bootPerfOverlay()
    bootBus()
    document.title = `stage · ${state.caps.model.name}`
  } catch (e) {
    console.error(e)
    toast(`启动失败：${e.message}`, 6000)
  }
}

/**
 * 改动补丁（stage-patch.json）。
 *
 * 定位：我们**不发布改过的模型**，只发布「我们这层加了什么」——
 * 姿势、台词、分区反应、热区几何。下载者拿自己的原模型 + 这个补丁，
 * 行为就和我们改完一样，不需要二次改膜。
 *
 * 注意：moc3 里的绘制顺序、手臂活动范围这类改不了的东西不在补丁范围内，
 * 那必须重新出模型（补丁里只记录 model 名字，做兼容提示）。
 */
async function applyStagePatch() {
  let p = null
  try { p = await shell.patchLoad?.() } catch { p = null }
  if (!p || typeof p !== 'object') return null
  state.patch = p
  if (p.poses && typeof p.poses === 'object') Object.assign(POSES, p.poses)
  if (p.phrases && typeof p.phrases === 'object') Object.assign(PHRASES, p.phrases)
  if (p.reactions && typeof p.reactions === 'object') Object.assign(DEFAULT_REACTIONS, p.reactions)
  if (p.model && state.caps?.model?.name && p.model !== state.caps.model.name) {
    toast(`补丁是为「${p.model}」做的，当前模型是「${state.caps.model.name}」`, 5000)
  }
  return p
}

/** 导出当前改动：姿势 + 台词 + 反应 + 热区（不含模型本体） */
async function exportStagePatch() {
  if (!state.caps) return null
  const data = {
    version: 1,
    model: state.caps.model.name,
    exportedAt: new Date().toISOString(),
    poses: POSES,
    phrases: PHRASES,
    reactions: DEFAULT_REACTIONS,
    regions: state.store ? { schemaVersion: 2, model: state.caps.model.name, regions: state.store.all } : null,
  }
  const r = await shell.patchSave?.(data)
  toast(r?.ok ? '改动补丁已保存（stage-patch.json）' : '补丁保存失败')
  return r
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
    onClear: () => state.agentLink?.reapply?.(),
  })

  // 姿态总线：头/身角度的唯一写入者（物理前后各写一次，各层只累加）
  state.poseBus = createPoseBus({ param: stage.param })

  state.gaze = createGaze({
    param: stage.param,
    bus: state.poseBus,
    // 身体角度交给 posture 层（脊柱链），视线只管眼珠与头
    options: {
      enabled: state.settings.gaze !== false,
      strength: Number(state.settings.strength ?? 1),
      headGain: Number(state.settings.headGain ?? 1.25),
      body: 0, bodyRoll: 0,
    },
  })

  // 姿态链：头 → 胸 → 腰 逐级跟随（弹簧 + 过冲），并且喂给物理权重最高的输入
  state.posture = createPosture({
    param: stage.param,
    gaze: state.gaze,
    bus: state.poseBus,
    options: { strength: Number(state.settings.strength ?? 1) },
  })

  // 抚摸晃动：蹭头时额外叠一层摆动（gaze 先定方向，这层再叠幅度）
  state.petSway = createPetSway({
    param: stage.param,
    bus: state.poseBus,
    options: { gain: Number(state.settings.petGain ?? 1.6) },
  })

  // 伪面捕驱动：把「我们的姿态」翻译成模型的**面捕捉取通道**
  // （AngleX/Y/Z、PositionX/Y、ParamBreath、JawOpen…），物理链才会整条活起来
  state.capture = createCapture({ param: stage.param, bus: state.poseBus })

  // 活气层：耳朵扑棱 / 头发惯性 / 耳环摆动（读回物理值再叠加，写在物理之后）
  // 要早于捏脸创建 —— 捏脸时借它做「耳朵快速扑棱」
  state.life = createLife({ param: stage.param })

  // 捏脸：按住「脸」热区拖动 → 鼓脸/单边鼓/抖脸盘 + 身体前倾放大
  state.facePinch = createFacePinch({
    param: stage.param,
    bus: state.poseBus,
    life: state.life,
    options: {
      // 用户手动开了「前倾」时，捏脸就不再抢 LeanInput
      leanBlocked: () => !!state.layers?.hasExpression('前倾'),
    },
  })

  // 痒痒的：摸脚 / 摸腰时的躲痒小动作（胸腔骨盆快抖 + 两侧小臂摆 + 两只耳朵扑腾）
  state.tickle = createTickle({
    bus: state.poseBus,
    life: state.life,
    onHold: (id, v) => { if (v == null) state.layers?.release(id); else state.layers?.hold(id, v) },
  })
  // 嘴：呼吸微动 + 说话音节（模型 LipSync 组是空的，这是唯一驱动源）
  state.mouth = createMouth({ param: stage.param })
  // 随机小表情：笑 / 吐舌头 / 吐舌头+单眼笑，待机时自己冒出来
  state.idleFaces = createIdleFaces({ param: stage.param })
  // 终点姿势：举手 / 竖手指 / 狗尾草（数值取自模型自带的 motion3 末帧），过渡自己补
  state.poses = createPoses({ layers: state.layers })

  // 待机动作：桌面没人互动时自己在动（常驻微摆 + 随机成套动作，部分带小台词）
  let idleLineTimer = 0
  state.idle = createIdleMotions({
    bus: state.poseBus,
    param: stage.param,
    life: state.life,
    idleFaces: state.idleFaces,
    options: { enabled: state.settings.idle !== false, speed: Number(state.settings.idleSpeed ?? 1) },
    // 成套动作的「道具」：姿势 / 表情 / 嘴型 / 风，开始时挂上、结束时撤掉
    onStart: (name, r) => {
      if (r.pose) state.poses?.set(r.pose, 360)
      for (const n of r.exprs || []) {
        const def = (state.caps.expressions || []).find((e) => e.name === n)
        if (def) state.layers?.addExpression(n, def.params, { source: 'idle-exp', fade: 0.28 })
      }
      if (r.mouth) state.mouth?.setMood(r.mouth, r.ms)
      if (r.gust) state.life?.gust?.(r.gust, r.ms)
    },
    onFinish: (name, r) => {
      if (r.pose) state.poses?.release(420)
      if (r.exprs?.length) state.layers?.removeSource('idle-exp')
      if (r.mouth) state.mouth?.clearMood()
    },
    // 物理输出参数（左臂 Z 等）用 hold 写绝对值；null = 释放
    onHold: (id, v) => {
      if (v == null) state.layers?.release(id)
      else state.layers?.hold(id, v)
    },
    // 小台词用气泡；正在显示 DSH 状态（thinking/working/…）时不抢话
    onLine: (text, ms = 4200) => {
      const b = state.bubble
      if (!b) return
      if (state.settings.bubble === false) return
      const st = b.state?.()
      if (st?.visible && st.state && st.state !== 'idle') return
      b.show(text, { state: 'idle' })
      emitFeedback({ type: 'idle-line', detail: text }, state.settings?.token)
      clearTimeout(idleLineTimer)
      idleLineTimer = setTimeout(() => { if (b.state?.().state === 'idle') b.hide() }, ms)
    },
  })

  let lastT = performance.now()
  let frameDt = 1000 / 60
  const motionState = { x: null, y: null, vx: 0, vy: 0, ax: 0, ay: 0 }
  // 拖拽物理的身体位移（弹簧状态：rx/ry 当前偏移，vrx/vry 速度）
  const dragShape = { rx: 0, ry: 0, vrx: 0, vry: 0 }
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
    // 拖动中优先用「抓取向量」（pointermove 的实时位移速度）；窗口跟着鼠标走时，
    // 用窗口坐标做差分几乎恒为 0，物理自然要等到松手才动 —— 这就是之前「拖完才甩」的原因
    const dragV = state.windowDragging && state.dragVec && performance.now() - state.dragVec.t < 120 ? state.dragVec : null
    const vx = dragV ? dragV.vx : (x - motionState.x) / dt
    const vy = dragV ? dragV.vy : (y - motionState.y) / dt
    const ax = Math.max(-20000, Math.min(20000, (vx - motionState.vx) / dt))
    const ay = Math.max(-20000, Math.min(20000, (vy - motionState.vy) / dt))
    motionState.x = x
    motionState.y = y
    motionState.vx = vx
    motionState.vy = vy
    // 平滑一层：窗口坐标是整数，直接微分会有尖刺
    motionState.ax = motionState.ax * 0.6 + ax * 0.4
    motionState.ay = motionState.ay * 0.6 + ay * 0.4
    state.life?.motion(motionState.ax, motionState.ay)
    state.capture?.motion(motionState.vx, motionState.vy)
    // 拖拽物理演算：拖动速度 → 身体位移（弹簧跟随，松手有余震），
    // 喂给 physics3 的 `ParamBodyAngleRX`（既入又出）→ 模型自带的头发/衣服/耳朵物理整条甩起来。
    if (state.settings.dragPhysics !== false) {
      const targetX = Math.max(-10, Math.min(10, -motionState.vx * 0.02))
      const targetY = Math.max(-7, Math.min(7, -motionState.vy * 0.014))
      // 弹簧-阻尼：stiffness 越大跟得越紧，damping 越大越快停
      // 拖的时候跟得紧（高阻尼），松手后低阻尼自由回弹：余震约 0.5–0.7 秒才收住
      const stiff = 45
      const damp = state.windowDragging ? 18 : 5.5
      dragShape.vrx += ((targetX - dragShape.rx) * stiff - dragShape.vrx * damp) * dt
      dragShape.vry += ((targetY - dragShape.ry) * stiff - dragShape.vry * damp) * dt
      dragShape.rx += dragShape.vrx * dt
      dragShape.ry += dragShape.vry * dt
      state.poseBus?.add('ParamBodyAngleRX', dragShape.rx)
      state.poseBus?.add('ParamBodyAngleRY', dragShape.ry)
    }
  }

  // ① 物理之前：喂物理输入 + 摆姿势。
  // 物理的输入就是「头部角度 / 呼吸 / 前倾」（physics3 实测 19 处引用），
  // 而我们原来在物理**之后**才写这些角度 —— 等于让物理永远在算静止的模型，
  // 头发、耳朵、耳环的物理全部僵死，这就是「没有物理效果」的真正原因。
  stage.onBeforePhysics(() => {
    state.poseBus?.clear()   // 新的一帧：清掉上一帧的姿态累计
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
      // 待机动作：常驻微摆 + 随机成套动作（叠加在同一份姿态里）
      state.idle?.apply(frameDt)
      // 痒痒的：躲痒小动作（摸脚/摸腰时）
      state.tickle?.apply(frameDt)
      // 姿态摆好之后，翻译成面捕捉取通道（物理要吃的就是这些）
      state.capture?.apply(frameDt)
    })
    // 各层只累加了增量，这里统一写成参数，物理拿到的就是这份合成姿态
    state.poseBus?.flush()
  })

  // ② 物理之后：表情 / 嘴 / 活气 / 鼓脸。
  // 物理会把 ParamAngle* / ParamBodyAngle* 当输出重算，所以姿态要在这里再写一次 ——
  // 但写的是**同一份合成姿态**（总线里的累计值），不是某一层的旧值，谁也不会盖掉谁。
  stage.onBeforeUpdate(() => {
    perf.time('post', () => {
      state.layers.apply()
      state.mouth?.apply(frameDt)
      state.idleFaces?.apply(frameDt)
      state.life?.apply(frameDt)
      state.facePinch?.apply(frameDt)
      // 放在最后：表情层可能也写过这些角度，姿态合成值优先级最高
      state.poseBus?.flush()
    })
  })

  // ---------- 标定探针（开发期用：单参数覆写 / 物理读回采样） ----------
  installProbes({ motionState })

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
    // agent 正在指定视线（look 动作）时不抢镜，hold 到期自动交还鼠标
    if (performance.now() < (state.agentLookUntil || 0)) return
    // 捏脸时保持正脸：视线不再跟着鼠标转，否则鼓脸会转到侧面看不见
    if (state.facePinch?.state?.()?.side) return
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
  shell.onCursor?.((p) => {
    window.__cursorLast = p // 诊断用：看主进程推来的到底是什么坐标
    if (!window.__noDesktopGaze) lookFromClient(p.x, p.y)
  })
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

/**
 * 摸胯时的神态：眼睛只睁一半 + 眯眼 + 眉毛「\ /」+ 瞳孔收紧。
 * （模型没有「瞳孔缩放」参数，只有 PupilX/PupilY 透视位移，所以缩瞳用眯眼 + 收缩上下眼睑近似）
 */
const CROTCH_FACE = [
  { Id: 'ParamEyeLOpen', Value: 0.52, Blend: 'Overwrite' },
  { Id: 'ParamEyeROpen', Value: 0.52, Blend: 'Overwrite' },
  { Id: 'LEyeSquint', Value: 0.35, Blend: 'Add' },
  { Id: 'REyeSquint', Value: 0.35, Blend: 'Add' },
  { Id: 'ParamBrowLY', Value: -0.25, Blend: 'Add' },
  { Id: 'ParamBrowRY', Value: -0.25, Blend: 'Add' },
  { Id: 'ParamBrowLAngle', Value: -0.8, Blend: 'Add' },
  { Id: 'ParamBrowRAngle', Value: 0.8, Blend: 'Add' },
]
function crotchFace(on) {
  if (!state.layers) return
  if (!on) { try { state.layers.removeSource('crotch-face') } catch {}; return }
  try { state.layers.addExpression('胯部神态', CROTCH_FACE, { source: 'crotch-face', fade: 0.28 }) } catch {}
}

/**
 * 模型三态：常态 → 爱心眼 → 黑框眼镜（点额头循环）。
 * source 独立（'mode'），不和分区反应 / agent 表情互相覆盖。
 */
const MODE_LIST = ['常态', '爱心眼', '黑框眼镜']
let modeName = '常态'
function applyMode(name) {
  const next = MODE_LIST.includes(name) ? name : '常态'
  modeName = next
  if (!state.layers) return next
  // 三态互斥：爱心眼 / 眼镜不管来自哪一层（额头循环、点头部的 switch 层、手动按钮）都先清掉，
  // 否则爱心眼会一直挂在脸上，切回常态也消不掉
  for (const n of ['爱心眼', '黑框眼镜']) {
    try { state.layers.removeExpression(n) } catch {}
  }
  try { state.layers.removeSource('mode') } catch {}
  if (next !== '常态') {
    const def = (state.caps?.expressions || []).find((e) => e.name === next)
    if (def) {
      try { state.layers.addExpression(next, def.params, { source: 'mode', fade: 0.22 }) } catch {}
    }
  }
  return next
}
function cycleMode() {
  const i = MODE_LIST.indexOf(modeName)
  return applyMode(MODE_LIST[(i + 1) % MODE_LIST.length])
}

/**
 * 体型：模型用 `Clothes2` 参数切（默认体型 0 / 体型1 0.4 / 体型2 1）。
 * 原包是三个表达式，这里改成连续拉条，设置里拖到哪里就是哪里。
 */
function applyBodyShape(v) {
  const val = Math.max(0, Math.min(1, Number(v) || 0))
  state.bodyShape = val
  if (!state.layers) return val
  try { state.layers.removeSource('body') } catch {}
  try { state.layers.addExpression('体型', [{ Id: 'Clothes2', Value: val, Blend: 'Add' }], { source: 'body', fade: 0.25 }) } catch {}
  return val
}

/** 触摸动作 → 台词档（tap / pet 分开；脚和腰的 pet 由「痒痒的」统一说话，这里不重复） */
const TOUCH_PHRASE = {
  头: { tap: 'head', pet: 'head' },
  胸: { tap: 'chest', pet: 'chest' },
  腰: { tap: 'waistTap' },
  裙摆: { tap: 'skirt', pet: 'skirt' },
  腿: { tap: 'legs', pet: 'legs' },
  脚: { tap: 'foot' },
  左手: { pet: 'handPet' },
  右手: { pet: 'handPet' },
  胯: { tap: 'crotchTap' },
  尾巴: { tap: 'tail', pet: 'tailPet' },
}

/**
 * 热区迁移表。
 * 每条 = 「这几个热区应该有几块、当前版本号是多少、不够或过旧时怎么重建」。
 * 以前是三个手写的 if 链堆在 bootRegions 里（脸 V3 / 手 V1 / 胯 V1），加一个热区就要
 * 再抄一段；现在加新热区只是往表里加一条。
 */
const ZONE_MIGRATIONS = [
  {
    // 脸部热区（捏脸用）：左右各一个，眼睛以上仍归头部；老档案（单个「脸」）自动迁移
    names: ['左脸', '右脸'],
    version: 3,
    build: ({ core, internalModel, displayNames, canvas }) => (
      faceRegions({ core, internalModel, displayNames, canvas }).map((r) => ({ ...r, reaction: {} }))
    ),
  },
  {
    // 手部热区：两只手垂在裙摆两侧、又会随身体摆，固定矩形必然错位，所以按网格周期重算
    names: ['左手', '右手'],
    version: 1,
    build: ({ handReader }) => handReader.read().map((r) => ({ ...r, reaction: DEFAULT_REACTIONS[r.name] || {} })),
  },
  {
    // 额头热区：点一下切换 常态 / 爱心眼 / 眼镜（层级压过「头」，才抢得到点击）
    names: ['额头'],
    version: 1,
    build: ({ core, internalModel, displayNames, canvas }) => (
      foreheadRegion({ core, internalModel, displayNames, canvas }).map((r) => ({ ...r, reaction: {} }))
    ),
  },
  {
    // 胯部热区：模型自带参数里手臂够不到胯（±1 只能挪 ~400px），所以单独划一块
    names: ['胯'],
    version: 1,
    build: ({ canvas }) => {
      const cx = canvas.width / 2
      const halfW = canvas.width * 0.11
      const x0 = Math.round(cx - halfW), x1 = Math.round(cx + halfW)
      const y0 = Math.round(canvas.height * 0.415), y1 = Math.round(canvas.height * 0.505)
      return [{ name: '胯', z: 6, points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], reaction: DEFAULT_REACTIONS['胯'] || {} }]
    },
  },
]

function migrateZones(ctx) {
  for (const m of ZONE_MIGRATIONS) {
    const cur = state.store.all.filter((r) => m.names.includes(r.name))
    const upToDate = cur.length === m.names.length && cur.every((r) => r.v === m.version)
    if (upToDate) continue
    for (const r of cur) state.store.remove(r.id)
    let fresh = []
    try { fresh = m.build(ctx) || [] } catch (e) {
      // 迁移失败不要静默：以前这里 catch 成空数组，直接把热区丢掉且毫无痕迹
      console.warn('[zones] 迁移失败', m.names.join('/'), e)
      continue // 保留旧的热区，下次启动再试
    }
    for (const z of fresh) state.store.add({ ...z, v: m.version })
    if (fresh.length) state.store.save(ctx.key)
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
  // 补丁里的热区优先落地（用户拿原模型 + 补丁即可复现同一套热区）
  if (state.patch?.regions?.regions?.length) state.store.loadJSON(state.patch.regions)
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

  // 手部热区读取器：迁移与周期重算共用同一个（索引表内部缓存）
  const handReader = createHandZoneReader({
    core: state.stage.core,
    internalModel: state.stage.model.internalModel,
    displayNames: names,
    canvas: state.stage.modelSize(),
  })
  state.handReader = handReader

  // 热区版本迁移（脸 V3 / 手 V1 / 胯 V1）：缺了就补，版本旧了就重建，不改动其它热区
  migrateZones({
    key,
    handReader,
    core: state.stage.core,
    internalModel: state.stage.model.internalModel,
    displayNames: names,
    canvas: state.stage.modelSize(),
  })

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
      // 额头跟着脸一起重算（前倾/歪头时整张脸会移动）
      const fore = state.store.all.find((r) => r.name === '额头')
      if (fore) {
        try { const pts = reader.readForehead?.(); if (pts) fore.points = pts } catch {}
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
      const rawName = ev.region?.name
      // 额头热区只管「点击切三态」；抚摸/拖动仍按头部处理，否则滑动摸头会被额头吃掉
      const name = rawName === '额头' && ev.type !== 'tap' ? '头' : rawName
      // 上行反馈：真正发生的互动（点 / 摸第一步 / 拖）才报，避免移动刷屏
      if (ev.type === 'tap' || (ev.type === 'pet' && ev.step === 1) || ev.type === 'dragStart' || ev.type === 'dragEnd') {
        const p = ev.point || {}
        emitFeedback({
          type: 'interaction',
          region: name || null,
          gesture: ev.type === 'tap' ? 'click' : ev.type === 'dragStart' || ev.type === 'dragEnd' ? 'drag' : 'pet',
          detail: ev.type === 'pet' ? `step ${ev.step}` : null,
          at: { x: Math.round(p.x ?? 0), y: Math.round(p.y ?? 0) },
        }, state.settings?.token)
      }
      const isHand = name === '左手' || name === '右手'
      // 一互动就让待机动作让位：不是暂停，而是彻底停掉当前动作（撤表情/姿势/固定参数），
      // 否则会出现「黑脸 + 打瞌睡半睁眼」这种叠出来的怪状态。
      // 只认真正的接触（按下 / 抚摸 / 拖拽），hover 不算 —— 鼠标停在角色身上不该冻结待机。
      if (ev.type === 'down' || ev.type === 'pet' || ev.type === 'dragStart') state.idle?.reset?.(2600)
      // 摸到别处就把「摸胯神态」收掉，不然半睁眼会挂到下一个动作上
      if (name !== '胯' && (ev.type === 'down' || ev.type === 'tap' || (ev.type === 'pet' && ev.step === 1))) {
        clearTimeout(state.crotchFaceHold)
        crotchFace(false)
      }
      // 摸胸：右手盖到胸口（举手姿势），表情走分区反应（屑屑眼）
      if (name === '胸' && ev.type === 'pet' && ev.step === 1) {
        state.poses?.set('举手', 320)
        clearTimeout(state.chestHold)
        state.chestHold = setTimeout(() => { state.poses?.release(420) }, 3600)
      }
      // 摸胯：黑脸 + 脸红 + 护住（举手手型）+ 右转头低头微缩，气泡说「变态」那套
      if (name === '胯' && ev.type === 'pet' && ev.step === 1) {
        state.poses?.set('护胯', 340, { holdExtras: true })
        state.bubble?.say('crotch', { ms: 4200 })
        crotchFace(true)
        clearTimeout(state.crotchFaceHold)
        state.crotchFaceHold = setTimeout(() => crotchFace(false), 4200)
        clearTimeout(state.crotchHold)
        state.crotchHold = setTimeout(() => { state.poses?.release(420) }, 4200)
      }
      // 点额头 = 模型三态循环：常态 → 爱心眼 → 黑框眼镜
      if (ev.type === 'tap' && name === '额头') {
        const m = cycleMode()
        toast(`表情：${m}`)
      // 点手 = 竖手指（抬起/放下），不再走表情反应；摸手还是 ＞＜ + 脸红
      } else if (ev.type === 'tap' && isHand) {
        const next = state.poses?.toggle('竖手指')
        toast(next === '竖手指' ? '竖手指' : '手放下')
        state.bubble?.say('hand', { ms: 2400 })
      } else if (ev.type === 'tap' && name && name !== '脸') {
        state.reactions.apply(ev.region, 'tap')
        const k = TOUCH_PHRASE[name]?.tap
        if (k) state.bubble?.say(k, { ms: 2400 })
      }
      if (ev.type === 'pet' && name && name !== '脸' && ev.step === 1) {
        // 额头抚摸回退成「头」之后，反应表也要按「头」查，否则 ＞＜ / 脸红 出不来
        const rxRegion = ev.region?.name && ev.region.name !== name ? { ...ev.region, name } : ev.region
        state.reactions.apply(rxRegion, 'pet')
        // 脚 / 腰 = 被挠痒：痒痒的动作 + 躲痒台词；其它部位按映射各说一句
        if (name === '脚' || name === '腰') {
          state.tickle?.start()
          state.bubble?.say('tickle', { ms: 2600 })
        } else {
          const k = TOUCH_PHRASE[name]?.pet
          if (k) state.bubble?.say(k, { ms: 2600 })
        }
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
          // 正脸：视线回中，鼓脸才看得见
          state.gaze?.setTarget?.(0, 0)
          pinchExpressions(true)
          state.bubble?.say('pinch', { ms: 2000 })
        } else if (ev.type === 'dragMove') {
          // ev.dx/dy 是模型坐标，换成客户端像素再交给捏脸层（maxPull 是按像素定的）
          // 镜像期间 scale.x 是负的，取绝对值，不然拖动方向会反
          const k = Math.abs(state.stage?.model?.scale?.x || 1)
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
    // 抓取向量：按事件时间算实时速度（px/s），拖拽物理直接吃这份，而不是等窗口坐标的帧间差分
    const now = performance.now()
    const dtEv = Math.max(0.004, (now - (state.dragVec?.t || now - 16)) / 1000)
    const cap = 6000
    state.dragVec = { vx: Math.max(-cap, Math.min(cap, dx / dtEv)), vy: Math.max(-cap, Math.min(cap, dy / dtEv)), t: now }
    shell.moveBy(dx, dy)
  })
  const end = (e) => {
    dragging = false
    state.windowDragging = false
    state.dragVec = null
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

// ---------- 透明处穿透 ----------
// 判据三条：
//   1. 指针落在工具条 / 「恢复鼠标」浮标这些 HTML 控件上 → 一律接收（否则开了穿透连按钮都点不到）
//   2. 手动穿透模式 → 角色也将鼠标穿透（UI 之外一律忽略）
//   3. 常态 → 按住期间不穿透，其余看角色轮廓掩码
// 注意：窗口尺寸不再手拖，所以没有「轮廓把手」这一类必须接收的例外了。
function createPassThrough() {
  let pending = null
  let queued = false
  let timer = 0

  /** 当前指针位置该不该穿透；没坐标时给 null（不改变现状） */
  function decide() {
    if (!pending || !state.settings) return null
    // 显示窗口边框时整窗接收鼠标：边框把手要能拖，不能把鼠标漏给桌面
    if (state.borderOn) return false
    const el = document.elementFromPoint(pending.x, pending.y)
    if (el && el.tagName !== 'CANVAS') return false
    if (state.settings.clickThrough) return true
    return !state.pointerDown && !bodyAt(pending.x, pending.y)
  }

  function applyNow() {
    queued = false
    const want = decide()
    if (want == null || want === state.ignoring) return
    state.ignoring = want
    shell.setPassThrough(want)
  }

  return {
    track(x, y) {
      pending = { x, y }
      refreshMask()
      if (queued) return
      queued = true
      // 用 16ms 定时而不是 rAF：窗口被完全遮挡时 rAF 会停，判定就永远不更新
      clearTimeout(timer)
      timer = setTimeout(() => perf.time('pass', applyNow), 16)
    },
    /** 勾选/取消穿透、松手之后立刻按当前指针重算，不必等鼠标再晃一下 */
    recompute() { if (pending) perf.time('pass', applyNow) },
    /** 只算不应用（验证/调试用）：给定坐标下的穿透判定结果 */
    decideAt(x, y) {
      const keep = pending
      pending = { x, y }
      const want = decide()
      pending = keep
      return want
    },
  }
}

/**
 * 按住期间一概不穿透：滑出轮廓那一刻若忽略鼠标，pointerup 会丢，抚摸/拖动就卡在按下态。
 */
function bindPointerHeld() {
  const down = () => { state.pointerDown = true }
  const up = () => { state.pointerDown = false }
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
  window.addEventListener('blur', up)
}

/** 轮廓掩码读回：挂在「每帧画完」之后，只读像素、不额外渲染；拖窗口期间先攒着 */
function startMaskCapture() {
  state.stage?.afterRender?.(() => {
    if (!state.maskPending || state.windowDragging) return
    state.maskPending = false
    const m = perf.time('mask', () => state.stage.captureMask?.(MASK_SCALE, (k, ms) => perf.mark(`m.${k}`, ms)))
    if (m) { state.mask = m; state.maskAt = performance.now() }
  })
}

function bindPassThrough() {
  const pass = createPassThrough()
  state.passThrough = pass // 调试/验证入口（__pass.passAt）
  state.recomputePass = () => pass.recompute()
  bindPointerHeld()
  window.addEventListener('pointermove', (e) => pass.track(e.clientX, e.clientY))
  // 松手时指针可能已经在轮廓外，重算一次才不会停在「按下态不穿透」
  window.addEventListener('pointerup', () => pass.recompute())
  window.addEventListener('resize', () => refreshMask(true))
  startMaskCapture()
  refreshMask(true)
}

// ---------- 穿透模式 ----------
// 手动穿透时角色区完全不可点（连右键都进不来），所以必须留一个「鼠标也能点到」的退路：
// 面板/工具条本身仍然接收鼠标，再加一个常驻浮标一键恢复。
function setClickThrough(on) {
  applyPassState(on) // 单向落到界面，不触发设置回写（广播那条路自己会进来）
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

// ---------- 窗口跟随角色（尺寸 = 模型画布 × 角色大小）----------
// 视口固定 contain、zoom 恒为 1：窗口多大，角色就多大 —— 「角色大小与窗口大小比例绑定」
// 在数值上的含义是窗口尺寸由模型画布推导，而不是反过来测角色包围盒（后者会形成正反馈）。
const FIT_BASE_W = 540      // zoom = 1 时角色的屏幕宽度（窗口再留出气泡余量）
const FIT_PAD_X = 0.12      // 左右各 6%：够气泡挂在头侧，又不会把角色缩太小
// 上下留白：设置里可调（0–18%）。默认 2% —— 边框刚好包住角色，不再上下各空 9%
const FIT_PAD_Y_DEFAULT = 0.02
const padY = () => {
  const v = Number(state.settings?.padY)
  return Math.max(0, Math.min(0.2, Number.isFinite(v) ? v : FIT_PAD_Y_DEFAULT))
}

function fitSize() {
  const ms = state.stage?.modelSize?.()
  if (!ms?.width || !ms?.height) return null
  const k = (FIT_BASE_W / ms.width) * (Number(state.settings?.zoom) || 1)
  return {
    w: Math.round(ms.width * k * (1 + FIT_PAD_X)),
    h: Math.round(ms.height * k * (1 + padY())),
  }
}

let fitTimer = 0
// 上一次已经下发过的窗口尺寸：尺寸没变就不再发 IPC（以前每 100ms 发一次，主进程每发一次都会把窗口挪 1px）
let lastFitSize = { w: 0, h: 0 }
const BODY_BANDS = ['头', '胸', '腰', '裙摆', '腿', '脚']

/**
 * 身体中心（模型坐标）：只取静态的躯干/四肢热区包围盒，**不含尾巴和手**——
 * 尾巴和头发一直在摆，用真实轮廓去量会把角色越推越偏，而且每次浮动都不一样。
 */
function bodyAnchor() {
  const rs = (state.store?.all || []).filter((r) => BODY_BANDS.includes(r.name) && r.points?.length)
  if (!rs.length) return null
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const r of rs) {
    for (const [x, y] of r.points) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY }
}

/**
 * 居中的归一化偏移——**纯几何算，不做任何运行时测量**。
 *
 * 视口是 contain：scale = min(W/mw, H/mh) × 0.95。窗口的长宽比被 FIT_PAD 固定，
 * 所以永远是「高度受限」那一支，scale/H = 0.95/mh，于是：
 *   offsetY = -2 × (身体中心y/mh − 0.5) × 0.95
 *   offsetX = -2 × (身体中心x/mw − 0.5) × 0.95 × (1+FIT_PAD_Y)/(1+FIT_PAD_X)
 * 全是模型常量，和窗口大小、缩放、测量时机都无关 —— 不会出现「切一次尺寸就偏一次」。
 */
function centerOffsets() {
  const b = bodyAnchor()
  const ms = state.stage?.modelSize?.()
  if (!b || !ms?.width || !ms?.height) return { x: 0, y: 0 }
  const fx = b.x / ms.width - 0.5
  const fy = b.y / ms.height - 0.5
  const k = 2 * 0.95 // 2 × 视口 margin
  const clamp = (n) => Math.max(-0.4, Math.min(0.4, n))
  return {
    x: clamp((-k * fx * (1 + padY())) / (1 + FIT_PAD_X)),
    y: clamp(-k * fy),
  }
}

/** 重算并下发窗口尺寸（连发合并 70ms，滚轮狂滚也不会打爆往主进程的 IPC） */
function applyFit(now = false) {
  const size = fitSize()
  if (!size) return
  const send = () => {
    fitTimer = 0
    const o = centerOffsets()
    state.viewport?.set({ zoom: 1, offsetX: o.x, offsetY: o.y })
    if (size.w !== lastFitSize.w || size.h !== lastFitSize.h) {
      lastFitSize = { w: size.w, h: size.h }
      shell.fit?.(size.w, size.h)
    }
    state.bubble?.reposition()
  }
  clearTimeout(fitTimer)
  if (now) { send(); return }
  fitTimer = setTimeout(send, 70)
}

// ---------- 窗口边框 / 等比缩放 ----------
// 窗口、角色、气泡共用同一比例：窗口高 = 模型高 × (540/宽) × (1+PAD) × zoom，
// 所以「当前 zoom」可以直接由窗口高度反推。拖边框改的是窗口尺寸，三者一起变。
// 气泡比例除以基准 0.8，让默认大小和旧版视觉一致。
const UI_BASE_ZOOM = 0.8

function refWindowHeight() {
  const ms = state.stage?.modelSize?.()
  if (!ms?.width || !ms?.height) return null
  return ms.height * (FIT_BASE_W / ms.width) * (1 + padY())
}
function zoomFromWindow() {
  const ref = refWindowHeight()
  if (!ref) return Number(state.settings?.zoom) || 1
  return window.innerHeight / ref
}
function bubbleScale() {
  // ×1.06：比旧版大一号（用户反馈气泡框偏小）
  return Math.max(0.4, Math.min(2.5, (zoomFromWindow() / UI_BASE_ZOOM) * 1.06))
}

function applyBorder(on) {
  state.borderOn = !!on
  $('#frame')?.classList.toggle('hidden', !on)
  if (on) {
    // 边框要能接鼠标：这期间不做「透明处穿透」
    state.ignoring = false
    shell.setPassThrough?.(false)
  }
  state.recomputePass?.()
}

function endScale() {
  if (!state.scaleEdge) return
  state.scaleEdge = null
  shell.scaleEnd?.()
  const z = Math.max(0.2, Math.min(3, Math.round(zoomFromWindow() * 1000) / 1000))
  if (Math.abs(z - (Number(state.settings?.zoom) || 1)) > 0.002) shell.set?.({ zoom: z })
}

function bindFrame() {
  const f = $('#frame')
  if (!f) return
  const edges = ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']
  f.innerHTML = edges.map((e) => `<div class="fh ${e}" data-edge="${e}"></div>`).join('')
  for (const h of f.querySelectorAll('.fh')) {
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      state.scaleEdge = h.dataset.edge
      shell.scaleBegin?.(state.scaleEdge)
      try { h.setPointerCapture(e.pointerId) } catch {}
    })
  }
  window.addEventListener('pointerup', endScale)
  window.addEventListener('pointercancel', endScale)
  window.addEventListener('blur', endScale)
  window.addEventListener('resize', () => {
    state.bubble?.setScale(bubbleScale())
    state.bubble?.reposition()
  })
}

function bindWindowDrag() {
  const stage = $('#stage')
  // 左键按住角色拖 = 搬窗口（按在分区上不算）；中键另有一套（见 bindMiddleDrag）
  dragWindow(stage, { canStart: (e) => !state.regionInput?.pressed?.region && bodyAt(e.clientX, e.clientY) })
  bindMiddleDrag(stage)
  // 兜底：页面卸载/失焦时收不到 pointerup，主进程的拖动定时器必须显式停掉
  window.addEventListener('pagehide', () => shell.dragEnd())
  window.addEventListener('blur', () => shell.dragEnd())
}

/**
 * 中键拖动 = 搬窗口（和左键拖角色同一套：主进程按全局光标锚点搬，不累积漂移）。
 * 中键移动**不喂物理**（不产生惯性冲击），纯位移。
 */
function bindMiddleDrag(stage) {
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 1) return
    e.preventDefault()
    hideTools()
    state.middleDragging = true
    shell.dragBegin()
    try { stage.setPointerCapture(e.pointerId) } catch {}
  })
  const end = (e) => {
    if (!state.middleDragging) return
    state.middleDragging = false
    try { stage.releasePointerCapture(e.pointerId) } catch {}
    shell.dragEnd()
    refreshMask(true)
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

/**
 * 头部右键：前倾做成**开关**（点一次开、再点一次关）。
 * 以**图层实际状态**为准（不存本地布尔）——否则设置里切过、或者被 exprClear 清掉之后，
 * 开关会显示「关」而模型其实还开着（反过来也有）。
 */
function toggleLean() {
  const def = (state.caps.expressions || []).find((x) => x.name === '前倾')
  if (!def) { toast('模型没有「前倾」表情'); return }
  const on = !!state.layers?.hasExpression?.('前倾')
  if (on) {
    state.layers.removeExpression('前倾')
    toast('前倾：关')
  } else {
    state.layers.addExpression('前倾', def.params, { source: 'lean' })
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

// ---------- 分区反应：改的是热区上的 reaction，reactions.apply 优先用它 ----------
// 反应存在热区上（region.reaction），reactions.apply 优先用它，其次才回落到 DEFAULT_REACTIONS。
// 所以这里改完直接 store.save()，重启保留。
function applyReaction(regionName, kind, { exprs = [], mode = 'expr' } = {}) {
  const region = state.store?.all?.find((r) => r.name === regionName)
  if (!region) return false
  const next = { ...(region.reaction || {}) }
  if (!exprs.length) delete next[kind]
  else next[kind] = mode === 'toggle' ? { toggle: exprs[0] } : { expr: exprs }
  region.reaction = next
  state.store.save(state.caps.model.name)
  return true
}

/** 热区反应快照：设置窗口拿它渲染勾选框 */
function reactionsSnapshot() {
  return Object.fromEntries((state.store?.all || []).map((r) => [r.name, r.reaction || {}]))
}

/**
 * 设置窗口 → 舞台窗口的 RPC（主进程用 executeJavaScript 调进来）。
 * 只处理「需要舞台内部状态」的三类事：读快照 / 改热区反应 / 导出补丁。
 * 纯设置项（缩放、跟随、气泡、置顶…）走主进程广播，不经过这里。
 */
async function stageRpc(op, payload) {
  if (op === 'meta') {
    return {
      model: state.caps?.model?.name || '',
      regions: (state.store?.all || []).map((r) => r.name),
      exprs: (state.caps?.expressions || []).map((e) => e.name),
      reactions: reactionsSnapshot(),
      poses: Object.keys(POSES).map((name) => ({ name, official: OFFICIAL_POSES.includes(name) })),
      bodyShape: state.bodyShape ?? 0,
      active: {
        exprs: (state.layers?.inspect?.()?.layers || []).map((l) => l.name),
        pose: state.poses?.state?.()?.active ?? null,
      },
    }
  }
  if (op === 'expr') {
    const name = String(payload?.name || '')
    const def = (state.caps?.expressions || []).find((e) => e.name === name)
    if (!def) return { error: `没有这个表情：${name}` }
    if (state.layers?.hasExpression?.(name)) state.layers.removeExpression(name)
    else state.layers?.addExpression(name, def.params, { source: 'manual', fade: 0.25 })
    return {
      active: {
        exprs: (state.layers?.inspect?.()?.layers || []).map((l) => l.name),
        pose: state.poses?.state?.()?.active ?? null,
      },
    }
  }
  if (op === 'pose') {
    const name = String(payload?.name || '')
    if (!POSES[name]) return { error: `没有这个姿势：${name}` }
    state.poses?.set(name, 320)
    return { active: { exprs: (state.layers?.inspect?.()?.layers || []).map((l) => l.name), pose: state.poses?.state?.()?.active ?? null } }
  }
  if (op === 'exprClear') {
    for (const s of ['manual', 'mode', 'bus', 'agent', 'idle-exp', 'pinch', 'crotch-face']) state.layers?.removeSource(s)
    state.poses?.release(360)
    return { active: { exprs: [], pose: '默认手' } }
  }
  if (op === 'reaction') {
    const { region, kind = 'tap', exprs = [], mode = 'expr' } = payload || {}
    applyReaction(region, kind === 'pet' ? 'pet' : 'tap', { exprs, mode })
    return { reactions: reactionsSnapshot() }
  }
  if (op === 'reactionReset') {
    const region = state.store?.all?.find((r) => r.name === payload?.region)
    if (region) {
      const d = DEFAULT_REACTIONS[payload.region]
      region.reaction = d ? JSON.parse(JSON.stringify(d)) : {}
      state.store.save(state.caps.model.name)
    }
    return { reactions: reactionsSnapshot() }
  }
  if (op === 'body') return { bodyShape: applyBodyShape(payload?.value) }
  if (op === 'patchExport') return exportStagePatch()
  if (op === 'mode') return { mode: applyMode(payload?.name) }
  return null
}
window.__stageRpc = stageRpc

// ---------- 设置同步：主进程广播 → 舞台立即生效 ----------
function applyPassState(on) {
  state.settings = state.settings || {}
  state.settings.clickThrough = !!on
  if (on) showPassHint()
  else hidePassHint()
  state.recomputePass?.()
}

/**
 * 把设置值落到各层。
 * 有意的**单向**：只读 settings、绝不回写 —— 否则「广播 → apply → shell.set → 广播」会打环。
 */
function applySettings(next) {
  if (!next || typeof next !== 'object') return
  state.settings = { ...state.settings, ...next }

  const zoom = Number(state.settings.zoom)
  if (Number.isFinite(zoom)) applyFit() // zoom = 角色大小：窗口尺寸跟着它重算

  const strength = Number(state.settings.strength ?? 1)
  state.gaze?.set({ enabled: state.settings.gaze !== false, strength, headGain: Number(state.settings.headGain ?? 1.25) })
  state.posture?.set({ strength })
  state.petSway?.set({ gain: Number(state.settings.petGain ?? 1.6) })
  state.idle?.set({ enabled: state.settings.idle !== false, speed: Number(state.settings.idleSpeed ?? 1) })

  const bubbleOn = state.settings.bubble !== false
  if (!bubbleOn && state.bubble?.visible) state.bubble.hide()
  else if (bubbleOn && !state.bubble?.visible && state.bubble?.text) state.bubble.show()
  state.bubble?.setScale(bubbleScale())
  applyBorder(state.settings.border === true)
  // 体型（Clothes2）跟设置走：0 默认 / 0.4 体型1 / 1 体型2
  applyBodyShape(state.settings.bodyShape ?? 0)

  applyPassState(!!state.settings.clickThrough)
}

function bindSettings() {
  shell.onSettings?.((next) => applySettings(next))
  shell.onClickThrough?.((v) => applyPassState(!!v))
}

// ---------- 右键工具条：设置窗口 / 退出（角色铺满窗口后，这是唯一入口） ----------
function bindTools() {
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    // 头部 / 脸部右键 = 前倾开关，不弹菜单（避免和互动打架）
    const r = regionAtClient(e.clientX, e.clientY)
    if (r && (r.name === '头' || r.name === '左脸' || r.name === '右脸')) { toggleLean(); return }
    showTools()
  })
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideTools()
  })
  $('#tool-settings')?.addEventListener('click', () => { hideTools(); shell.openSettings?.() })
  $('#tool-quit')?.addEventListener('click', () => shell.quit())
}

/**
 * 调试探针（window.__probe / window.__pass）。
 *
 * 从 bootStage 与 bindPassThrough 里搬出来的：它们是开发期工具，不该和启动流程、
 * 穿透状态机缠在同一个函数里。除 motionState（惯性数值）外，全部依赖模块作用域。
 */
function installProbes({ motionState } = {}) {
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
    /** 待机动作：清单 / 立刻播一个（不传名字则随机）/ 状态 */
    idleList: () => state.idle?.routines() ?? [],
    idlePlay(name) { return state.idle?.trigger(name) ?? null },
    idleState: () => state.idle?.state() ?? null,
    /** 痒痒的：立刻来一段（验证躲痒动作） */
    tickle() { state.tickle?.start(); return state.tickle?.state() ?? null },
    tickleState: () => state.tickle?.state() ?? null,
    /** 模型三态：常态 / 爱心眼 / 黑框眼镜 */
    mode(name) { return { mode: applyMode(name) } },
    modeState: () => ({ mode: modeName, list: MODE_LIST }),
    cycleMode: () => ({ mode: cycleMode() }),
    /** 视口状态（含镜像 flipX，验证镜像摇摆用） */
    viewport: () => ({ ...state.viewport?.view }),
    /** 摸胯神态（半睁眼 + 眯眼 + 八字眉）单独验证 */
    crotchFace(on = true) { crotchFace(on); return true },
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
    /** 说一句预设台词（thinking / working / waiting / success / error / head / hand …） */
    say(key, ms = 0) { return state.bubble?.say(key, { ms }) ?? null },
    /** 模拟一条 DSH 状态（不接插件时也能验证联动） */
    agent(snap) { state.agentLink?.apply(snap) },
    agentState: () => state.agentLink?.state() ?? null,
    // ---- 改动补丁 ----
    patchExport: () => exportStagePatch(),
    patchState: () => state.patch ? { model: state.patch.model, poses: Object.keys(state.patch.poses || {}), phrases: Object.keys(state.patch.phrases || {}), regions: state.patch.regions?.regions?.length ?? 0 } : null,
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

  window.__pass = {
    bodyAt,
    refreshMask,
    // 表情/姿势层现状（排查「动作被谁盖了」用）
    layers: () => state.layers?.inspect?.() ?? null,
    // 活气层：眨眼计数 / 耳朵 / 风；伪面捕：呼吸值
    life: () => state.life?.state?.() ?? null,
    capture: () => state.capture?.state?.() ?? null,
    // 清掉所有表情来源 + 收回姿势（QA 用，避免上一轮试的参数残留）
    exprClear() {
      for (const s of ['bus', 'agent', 'idle-exp', 'probe', 'lean', 'manual', 'mode', 'body', 'pinch', 'crotch-face']) state.layers?.removeSource(s)
      state.poses?.release(0)
    },
    captureSet: (patch) => state.capture?.set(patch) ?? null,
    blink: () => state.life?.blinkNow?.() ?? null,
    lifeSet: (patch) => state.life?.set?.(patch) ?? null,
    gust: (amp = 2, ms = 2600) => state.life?.gust?.(amp, ms) ?? null,
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
    /** 绘制顺序排查：按部件名列出 drawable 的序号与不透明度（判断手有没有被裙子盖住） */
    partOpacity(name) {
      const st = state.stage
      const p = (state.caps.parts || []).find((x) => x.name === name)
      if (!st || !p) return null
      return st.part?.get?.(p.id) ?? null
    },
    partSet(name, v) {
      const st = state.stage
      const p = (state.caps.parts || []).find((x) => x.name === name)
      if (!st || !p) return false
      st.part?.set?.(p.id, v)
      return true
    },
    drawables(filter) {
      const out = []
      const core = state.stage?.core
      if (!core) return out
      for (let i = 0; i < core.getDrawableCount(); i++) {
        let parent = -1
        try { parent = core.getDrawableParentPartIndex(i) } catch { continue }
        if (parent < 0) continue
        let name = ''
        try {
          const pid = core.getPartId(parent).getString().s
          name = state.caps.parts.find((p) => p.id === pid)?.name || ''
        } catch {}
        if (filter && !name.includes(filter)) continue
        out.push({ i, part: name, op: Math.round((core.getDrawableOpacity(i) || 0) * 100) / 100 })
      }
      return out
    },
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
    /** 视口状态（缩放/偏移/实际像素缩放）—— 排查「窗口跟着角色」时的落点 */
    view: () => (state.viewport ? { ...state.viewport.view, scale: state.stage?.model?.scale?.x ?? null } : null),
    dragState: () => ({ dragging: !!state.windowDragging, vec: state.dragVec || null }),
    leanToggle: () => { toggleLean(); return !!state.layers?.hasExpression?.('前倾') },
    /** 跟随层的内部状态（平滑后的眼/头/身），排查「头不转」时看它到底是没算还是有被覆盖 */
    gazeState: () => state.gaze?.state?.() ?? null,
    gazeOpts: () => (state.gaze?.options ? { ...state.gaze.options } : null),
    /** 姿态总线的当前合成值（排查「写了没生效 / 谁盖了谁」时看这一份） */
    pose: () => state.poseBus?.snapshot?.() ?? null,
    bus: () => state.poseBus?.snapshot?.() ?? null,
    /** 关掉伪面捕通道（排查「写了 ParamAngleX 头不动」时用） */
    captureOff(on = true) {
      state.capture?.set(on
        ? { breathAmp: 0, yawGain: 0, pitchGain: 0, tiltGain: 0, posGain: 0, jawFromMouth: 0 }
        : { breathAmp: 0.4, yawGain: 0.4, pitchGain: 0.4, tiltGain: 1, posGain: 1, jawFromMouth: 1 })
      return state.capture?.options ?? null
    },
    /** 手动给一个跟随目标（-1..1，右/上为正）：不移动真实鼠标也能验证转头幅度 */
    gazeTarget(nx = 0, ny = 0) {
      state.gaze?.setTarget(Number(nx), Number(ny))
      return state.gaze?.state?.().target ?? null
    },
    /** 真实轮廓在窗口里的包围盒（客户端像素）+ 相对窗口中心的偏移 dx/dy */
    maskBox: () => {
      const m = state.mask || refreshMask(true)
      if (!m?.data) return null
      let minX = m.w, maxX = -1, minY = m.h, maxY = -1
      for (let y = 0; y < m.h; y++) {
        for (let x = 0; x < m.w; x++) {
          if (m.data[y * m.w + x] > 8) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (maxX < 0) return null
      const W = window.innerWidth
      const H = window.innerHeight
      const box = {
        left: +((minX / m.w) * W).toFixed(1),
        top: +((minY / m.h) * H).toFixed(1),
        right: +(((maxX + 1) / m.w) * W).toFixed(1),
        bottom: +(((maxY + 1) / m.h) * H).toFixed(1),
      }
      box.w = +(box.right - box.left).toFixed(1)
      box.h = +(box.bottom - box.top).toFixed(1)
      box.dx = +((box.left + box.right) / 2 - W / 2).toFixed(1)
      box.dy = +((box.top + box.bottom) / 2 - H / 2).toFixed(1)
      box.margin = { left: +box.left.toFixed(0), top: +box.top.toFixed(0), right: +(W - box.right).toFixed(0), bottom: +(H - box.bottom).toFixed(0) }
      return box
    },
    state: () => ({ ignoring: state.ignoring, clickThrough: state.settings?.clickThrough, pointerDown: state.pointerDown }),
    /** 给定客户端坐标的穿透判定（只算不应用，不受事件送达影响） */
    passAt: (x, y) => state.passThrough?.decideAt(x, y) ?? null,
  }

  // 布局 / 跟随的验证钩子（和 harness 里的 __reaction 一样，只为无头检查）
  window.__layout = () => ({
    win: [window.innerWidth, window.innerHeight],
    pos: [Math.round(window.screenX), Math.round(window.screenY)],
    offsetX: state.viewport?.view.offsetX ?? null,
    offsetY: state.viewport?.view.offsetY ?? null,
    model: state.stage ? [Math.round(state.stage.model.position.x), Math.round(state.stage.model.position.y)] : null,
    gaze: state.gaze?.state?.().target ?? null,
    sway: state.petSway?.state?.() ?? null,
    angles: state.stage ? ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'].map((id) => Math.round(state.stage.param.get(id) * 10) / 10) : null,
    lean: state.stage ? Math.round(state.stage.param.get('LeanInput') * 10) / 10 : null,
  })
}

main()
