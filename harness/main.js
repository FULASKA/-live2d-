// 验证台：能力枚举 / 双路动作 / 参数叠加 / 视线与身体跟随 / 分区互动 / 命中反查。
// 只依赖 PROTOCOL.md 的接口 + src/stage 的内核适配层，不含产品 UI。

import { createStage, MotionPriority, csmText } from '../src/stage/engine.js'
import { createLayerStack } from '../src/stage/layers.js'
import { createViewport } from '../src/stage/viewport.js'
import { createGaze } from '../src/stage/gaze.js'
import { createRegionStore, createRegionInput, seedRegions } from '../src/stage/regions.js'

const $ = (s) => document.querySelector(s)
const TOKEN = new URLSearchParams(location.search).get('token') || 'dev-token'

const state = {
  caps: null, stage: null, layers: null, viewport: null, gaze: null,
  store: null, regionInput: null,
  editor: { mode: null, points: [] },
  gazeOn: true, intensity: 1,
  log: [],
  frames: 0,
  stateMap: {
    thinking: { expression: '圈圈眼' }, working: { expression: '加载' },
    waiting: { expression: '流冷汗' }, success: { expression: '爱心眼' }, error: { expression: '流泪' },
  },
}

/**
 * 默认反馈：一个区域 × 一种手势 = 一个「动作组」。
 * 规则：同一时刻只允许一个组在场（切换，不是叠加）；toggle 型（换装/脱鞋/尾巴）再点一次同组 = 收回。
 * expr 数组是有序的：后加的层覆盖同参数 —— 腰部的 ＞＜→流泪→流冷汗 必须按这个顺序，
 * 才能保住眉毛变化而不被眼睛覆盖。
 */
const DEFAULT_REACTIONS = {
  头: { tap: { toggle: '爱心眼' }, pet: { expr: ['＞＜', '脸红'] } },
  胸: { tap: { toggle: '胸口衣服' }, pet: { expr: ['屑屑眼'] } },
  腰: { tap: { expr: ['＞＜'] }, pet: { expr: ['＞＜', '流泪', '流冷汗'] } },
  裙摆: { tap: { toggle: '裙子切换' }, pet: { expr: ['黑脸', '屑屑眼', '竖食指开'] } },
  腿: { tap: { expr: ['加载'] }, pet: { expr: ['加载', '脸红'] } },
  // 大笑本模型没有预设（理论上得靠面捕皮，未做），所以脚部滑动只到流泪
  脚: { tap: { toggle: '脱鞋' }, pet: { expr: ['流泪'] } },
  尾巴: { tap: { toggle: '尾巴开关' } },
}

function pushLog(kind, text) {
  state.log.unshift({ kind, text, t: new Date().toLocaleTimeString() })
  state.log.length = Math.min(state.log.length, 60)
  $('#log').innerHTML = state.log
    .map((e) => `<div class="ev"><b>${e.kind}</b> ${e.text} <span style="float:right">${e.t}</span></div>`)
    .join('')
}

// ---------- 启动 ----------
async function boot() {
  try {
    state.caps = await fetch('/api/capabilities').then((r) => r.json())
    renderMeta()
    renderLists()
  } catch (e) {
    $('#meta').innerHTML = `<div class="warn">拿不到能力清单：${e.message}</div>`
    return
  }
  await bootStage()
}

async function bootStage() {
  try {
    const stage = await createStage({
      container: $('#stage'),
      modelUrl: state.caps.model.url,
      verbose: new URLSearchParams(location.search).has('verbose'),
    })
    state.stage = stage
    // 物理输入清单：前倾 / 换装这类表情写的是物理输入参数，必须早于 physics.evaluate 写入
    state.physics = await loadPhysicsFlow()
    state.layers = createLayerStack({
      param: stage.param,
      part: stage.part,
      // 只把「物理输入且不是物理输出」的参数走前写点；
      // ParamAngle* / ParamBodyAngle* 这类既入又出的参数仍按旧路径写，避免被物理回算冲掉
      isPhysicsInput: (id) => state.physics.inputs.has(id) && !state.physics.outputs.has(id),
    })
    stage.onBeforePhysics(() => state.layers.applyPhysics())
    const q0 = new URLSearchParams(location.search)
    state.gaze = createGaze({
      param: stage.param,
      options: { invertX: q0.has('invertX'), invertY: q0.has('invertY') },
    })

    // 分层顺序：先 L1 跟随，再 L2/L5（后写覆盖先写）
    let lastT = performance.now()
    stage.onBeforeUpdate(() => {
      const now = performance.now()
      const dt = Math.min(120, Math.max(1, now - lastT))
      lastT = now
      if (state.gazeOn) state.gaze.apply(dt)
      state.layers.apply()
    })
    // 帧内取样：唯一能读到「真正送进绘制」的值的位置
    stage.onBeforeUpdate(() => {
      window.__frameParams = {
        key2: stage.param.get('key2'), key7: stage.param.get('key7'),
        eyeX: stage.param.get('ParamEyeBallX'), eyeY: stage.param.get('ParamEyeBallY'),
        angleX: stage.param.get('ParamAngleX'), angleY: stage.param.get('ParamAngleY'), angleZ: stage.param.get('ParamAngleZ'),
        bodyX: stage.param.get('ParamBodyAngleX'), bodyY: stage.param.get('ParamBodyAngleY'),
      }
    })

    const viewport = createViewport({ model: stage.model, app: stage.app })
    state.viewport = viewport
    viewport.observe($('#stage'))

    stage.app.ticker.add(() => {
      state.frames = stage.clocks().frames
      $('#fps').textContent = `FPS ${stage.ticker.FPS.toFixed(0)}`
      drawOverlay()
    })

    pushLog('model', `已加载 ${state.caps.model.name}（Cubism 5 内核）`)
    introspect()
    bootRegions()
    hookPointer()
    bindControls()
    applyDeepLink()

    window.__stage = state
    window.__reaction = applyReaction
    window.__ready = true
    document.title = `ready ${state.caps.model.name}`
  } catch (e) {
    pushLog('error', `模型加载失败：${e.message}`)
    $('#meta').innerHTML = `<div class="warn">模型加载失败：${e.message}</div>`
    window.__error = e.message
  }
}

function bindControls() {
  $('#gaze').onchange = (e) => {
    state.gazeOn = e.target.checked
    state.gaze.set({ enabled: e.target.checked })
  }
  $('#gaze-int').oninput = (e) => {
    state.intensity = Number(e.target.value)
    state.gaze.set({ strength: state.intensity })
  }
  $('#show-regions').onchange = () => drawOverlay()
  $('#checker').onchange = (e) => $('#stage').classList.toggle('checker', e.target.checked)
  $('#send-state').onclick = () => sendState($('#state-sel').value)

  $('#region-auto').onclick = () => autoSeed(true)
  $('#region-clear').onclick = () => {
    for (const r of state.store.all.slice()) state.store.remove(r.id)
    saveProfile()
    renderRegions()
    pushLog('region', '清空全部热区')
  }
  $('#region-export').onclick = () => {
    const blob = new Blob([JSON.stringify(state.store.toJSON(state.caps.model.name), null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${state.caps.model.name}.profile.json`
    a.click()
    URL.revokeObjectURL(a.href)
    pushLog('profile', '档案已导出')
  }
  $('#region-draw').onclick = () => toggleDraw()
  window.addEventListener('keydown', (e) => {
    if (state.editor.mode !== 'draw') return
    if (e.key === 'Enter') finishDraw()
    if (e.key === 'Escape') { state.editor.points = []; pushLog('editor', '取消画区域'); drawOverlay() }
  })
  $('#stage').addEventListener('dblclick', () => { if (state.editor.mode === 'draw') finishDraw() })
  $('#stage').addEventListener('pointerdown', (e) => {
    if (state.editor.mode !== 'draw') return
    const p = state.viewport.clientToModel(e.clientX, e.clientY)
    state.editor.points.push([p.x, p.y])
    pushLog('editor', `顶点 ${state.editor.points.length}`)
    drawOverlay()
  })
}

// ---------- 跟随（L1） ----------
function hookPointer() {
  window.addEventListener('pointermove', (e) => {
    const { stage } = state
    if (!stage || !state.gazeOn) return
    const r = stage.canvas.getBoundingClientRect()
    const sw = stage.app.screen.width, sh = stage.app.screen.height
    const sx = ((e.clientX - r.left) / r.width) * sw
    const sy = ((e.clientY - r.top) / r.height) * sh
    // 归一化以**角色中心**为原点，而不是窗口中心：模型被拖动/偏置后方向也不会歪
    const m = stage.model
    state.gaze.setTargetFromScreen(sx, sy, m.position.x, m.position.y, sw / 2, sh / 2)
  })
}

// ---------- 运行时内省 ----------
function introspect() {
  const { stage, caps } = state
  const byId = new Map(caps.params.map((p) => [p.id, p]))
  state.runtimeParams = stage.param.ids.map((id) => {
    const info = stage.param.info(id)
    return { id, name: byId.get(id)?.name || id, group: byId.get(id)?.group || null, ...info }
  })
  pushLog('inspect', `运行时参数 ${stage.param.count} 个 / 部件 ${stage.part.count} 个`)

  const core = stage.core
  const n = core.getDrawableCount()
  const masked = core.getDrawableMaskCounts ? Array.from(core.getDrawableMaskCounts()).filter((x) => x > 0).length : 0
  pushLog('inspect', `网格 ${n} 个 · 带遮罩 ${masked} · 画布 ${stage.modelSize().width}×${stage.modelSize().height}`)
  if (core.getMultiplyColor) {
    let nonWhite = 0
    for (let i = 0; i < n; i++) {
      try {
        const c = core.getMultiplyColor(i)
        if (c && (c.r < 0.99 || c.g < 0.99 || c.b < 0.99)) nonWhite++
      } catch {}
    }
    pushLog('inspect', `非白乘法色网格 ${nonWhite}/${n}（换核后应大于 0）`)
  }
  const groups = (() => {
    try { return Object.keys(stage.model.internalModel.motionManager.definitions || {}) } catch { return [] }
  })()
  if (groups.length) pushLog('inspect', `动作组：${groups.join(', ')}`)
  renderParams()
}

// ---------- 分区互动 ----------
function partNameGetter() {
  const byId = new Map(state.caps.parts.map((p) => [p.id, p.name]))
  const core = state.stage.core
  return {
    get: (index) => byId.get(csmText(core.getPartId(index))) || '',
  }
}

function autoSeed(reset = false) {
  const { stage, store } = state
  const seeded = seedRegions({
    core: stage.core,
    internalModel: stage.model.internalModel,
    displayNames: partNameGetter(),
    canvas: stage.modelSize(),
  })
  if (reset) for (const r of store.all.slice()) store.remove(r.id)
  for (const r of seeded) store.add({ ...r, reaction: DEFAULT_REACTIONS[r.name] || {} })
  saveProfile()
  renderRegions()
  pushLog('region', `自动铺出 ${seeded.length} 个热区：${seeded.map((r) => r.name).join('、')}`)
  drawOverlay()
}

const BAND_NAMES = ['头', '胸', '腰', '裙摆', '腿', '脚', '尾巴']

function bootRegions() {
  const key = state.caps.model.name
  state.store = createRegionStore([])
  const loaded = state.store.load(key)
  // 旧档案（旧的五段自动铺）要重铺：缺段说明是上一版自动铺的，不是用户手画的
  const missing = loaded ? BAND_NAMES.filter((n) => !state.store.all.some((r) => r.name === n)) : BAND_NAMES
  if (!loaded || missing.length) {
    autoSeed(true)
    pushLog('region', `重铺热区（${loaded ? '旧布局缺 ' + missing.join('/') : '首次'}）`)
  } else {
    renderRegions()
    pushLog('region', `读到档案：${state.store.all.length} 个热区`)
  }

  state.regionInput = createRegionInput({
    store: state.store,
    viewport: state.viewport,
    canvas: $('#stage'),
    // 透明像素 = 穿透：热区几何盖到背景时，点击不该被吃掉。
    // 读不到像素（gl 异常 / 无头软渲染偶尔为空）时**放行** —— 不能因为采样失败把整块互动锁死。
    isOpaque: (p) => {
      const sp = state.viewport.modelToScreen(p.x, p.y)
      const { alpha } = state.stage.sampleAlpha(sp.x, sp.y)
      if (alpha == null) return true
      return alpha > 12
    },
    // 起手范围 = 应用窗口边界（最终形态是贴住角色的无边框透明窗口）。
    // 窗口外的事件根本进不来，所以这道判定在成品里天然成立；这里按舞台尺寸兜底。
    isNear: (sp) => {
      const s = state.stage.size()
      const m = 8
      return sp.x >= -m && sp.y >= -m && sp.x <= s.width + m && sp.y <= s.height + m
    },
    onEvent: onRegionEvent,
  })
  state.regionInput.attach($('#stage'))
}

function onRegionEvent(ev) {
  if (state.editor.mode) return
  const r = ev.region
  switch (ev.type) {
    case 'tap':
      if (r) applyReaction(r, 'tap')
      break
    case 'pet':
      if (r && ev.step === 1) applyReaction(r, 'pet')
      break
    case 'down':
      if (r) {
        // 命中诊断：alpha 是「透明穿透」那一关的判据，点不动时先看这个数
        const sp = state.viewport.modelToScreen(ev.point.x, ev.point.y)
        const a = state.stage.sampleAlpha(sp.x, sp.y)
        pushLog('hit', `按下 ${r.name} · alpha=${a.alpha == null ? 'null' : a.alpha}`)
      }
      break
    case 'dragStart':
      pushLog('gesture', `${r ? r.name : '背景'} · 拖动（产品里 = 移动窗口 / 区域拖拽，可配）`)
      break
    case 'up':
      if (ev.kind === 'drag' && !r) pushLog('gesture', '背景拖动 → 视为窗口移动')
      break
    case 'enter':
      if (r) $('#region-hint').textContent = `悬停：${r.name}`
      break
    case 'leave':
      $('#region-hint').textContent = ''
      break
  }
}

/**
 * 读 physics3.json 的输入/输出清单。
 * 物理输入必须早于 physics.evaluate 写（engine.onBeforePhysics）；
 * 既入又出的参数（ParamAngle* / ParamBodyAngle*）仍走旧路径，免得被物理回算冲掉。
 */
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
    pushLog('inspect', `物理输入 ${inputs.size} · 输出 ${outputs.size}（前倾类表情走前写点）`)
    return { inputs, outputs }
  } catch (e) {
    pushLog('warn', `物理清单读不到：${e.message}`)
    return empty
  }
}

// ---------- 分区互动：动作组（切换，不叠加） ----------
const REACTION_SOURCE = 'reaction'
const REACTION_TTL = 6000
const active = { group: null, timer: 0 }

/** 把当前动作组整个撤掉（表情层按 source 清，其它层不动） */
function clearReactionGroup(reason) {
  if (active.timer) { clearTimeout(active.timer); active.timer = 0 }
  const removed = state.layers?.removeSource(REACTION_SOURCE) || []
  active.group = null
  if (removed.length) {
    renderExprChips()
    pushLog('expr', `− ${removed.join(' + ')}${reason ? `（${reason}）` : ''}`)
  }
}

function applyReaction(region, kind) {
  if (!region) return
  const rx = region.reaction?.[kind] || DEFAULT_REACTIONS[region.name]?.[kind]
  if (!rx) return
  const gid = `${region.name}:${kind}`
  const wanted = []
  if (rx.toggle) wanted.push(rx.toggle)
  for (const name of rx.expr || (rx.expression ? [rx.expression] : [])) wanted.push(name)

  // 同一个开关组再点一次 → 收回（换装 / 脱鞋 / 尾巴这类）
  if (active.group === gid && rx.toggle) {
    clearReactionGroup('再点收回')
    pushLog('region', `${region.name} · ${kind} → 收回 ${rx.toggle}`)
    return
  }

  // 切组：只撤掉新组里没有的层。两边都有的（腿:点击 的「加载」→ 腿:滑动 的「加载+脸红」）
  // 原地保留 —— 移除再重建会让表情的动画/淡入从头开始，看起来就是「被重置了一次」。
  if (active.timer) { clearTimeout(active.timer); active.timer = 0 }
  const keep = new Set(wanted)
  const removed = state.layers.removeSourceExcept(REACTION_SOURCE, keep)
  active.group = gid

  const added = []
  for (const name of wanted) {
    if (addExpression(name, { source: REACTION_SOURCE })) added.push(name)
  }
  if (removed.length) {
    renderExprChips()
    pushLog('expr', `− ${removed.join(' + ')}（切换动作组）`)
  }
  const kept = wanted.filter((n) => !added.includes(n))

  if (rx.motion) {
    const m = state.caps.motions.find((x) => x.name === rx.motion)
    if (m) playMotion(m)
  }
  const shown = [
    ...added,
    ...kept.map((n) => `${n}（续）`),
  ].join(' + ')
  pushLog('region', `${region.name} · ${kind} → ${shown || (rx.motion || '（无预设）')}`)
  if (!rx.toggle) active.timer = setTimeout(() => clearReactionGroup('到时'), REACTION_TTL)
}

function saveProfile() {
  if (state.store) state.store.save(state.caps.model.name)
}

function renderRegions() {
  const list = (state.store?.all || []).slice().sort((a, b) => b.z - a.z)
  $('#n-region').textContent = list.length
  // 开关型表情（换装/脱鞋/尾巴）用 toggle 语义，其余按纯表情组
  const TOGGLE_SET = new Set(['胸口衣服', '裙子切换', '脱鞋', '尾巴开关'])
  const opts = (sel) => ['（无）', ...state.caps.expressions.map((e) => e.name)]
    .map((n) => `<option value="${n === '（无）' ? '' : n}" ${(sel || '') === (n === '（无）' ? '' : n) ? 'selected' : ''}>${n}</option>`).join('')
  const tapOf = (r) => r.reaction?.tap?.toggle || (r.reaction?.tap?.expr || [])[0] || ''
  const petOf = (r) => (r.reaction?.pet?.expr || []).join('+')

  $('#regions').innerHTML = list.map((r) => `
    <div class="item" data-r="${r.id}" style="gap:6px">
      <span class="nm" style="flex:0 0 46px">${r.name}</span>
      <select data-exp="${r.id}" title="点击反应" style="flex:1;min-width:0;background:#12141a;border:1px solid var(--line);border-radius:5px;color:var(--fg);font-size:11px">${opts(tapOf(r))}</select>
      <span class="tag" data-pet="${r.id}" title="滑动反应" style="max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${petOf(r) || '—'}</span>
      <span class="chip ghost" data-del="${r.id}" title="删除">×</span>
    </div>`).join('') || '<div class="meta">还没有热区，点「自动铺热区」或用「画区域」自己画</div>'

  $('#regions').querySelectorAll('[data-exp]').forEach((el) => (el.onchange = () => {
    const r = state.store.all.find((x) => x.id === el.dataset.exp)
    const name = el.value
    if (!name) { delete r.reaction.tap }
    else r.reaction.tap = TOGGLE_SET.has(name) ? { toggle: name } : { expr: [name] }
    saveProfile()
    pushLog('region', `${r.name} 点击 → ${name || '（无）'}`)
  }))
  $('#regions').querySelectorAll('[data-del]').forEach((el) => (el.onclick = () => {
    state.store.remove(el.dataset.del)
    saveProfile()
    renderRegions()
    drawOverlay()
  }))
}

function toggleDraw() {
  if (state.editor.mode === 'draw') { state.editor.mode = null; state.editor.points = [] }
  else { state.editor.mode = 'draw'; state.editor.points = [] }
  $('#region-draw').classList.toggle('on', state.editor.mode === 'draw')
  $('#region-hint').textContent = state.editor.mode === 'draw'
    ? '点击加顶点 · 回车/双击闭合 · Esc 取消'
    : ''
  drawOverlay()
}

function finishDraw() {
  const pts = state.editor.points
  if (pts.length < 3) { pushLog('editor', '至少 3 个点'); return }
  const r = state.store.add({ name: `区域${state.store.all.length + 1}`, points: pts, z: 20 })
  state.editor.points = []
  state.editor.mode = null
  $('#region-draw').classList.remove('on')
  $('#region-hint').textContent = ''
  saveProfile()
  renderRegions()
  pushLog('editor', `新建 ${r.name}（${pts.length} 顶点）`)
  drawOverlay()
}

// ---------- 热区叠层 ----------
function drawOverlay() {
  const c = $('#overlay')
  if (!c || !state.viewport) return
  const host = $('#stage')
  const dpr = window.devicePixelRatio || 1
  const w = host.clientWidth, h = host.clientHeight
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
  }
  const ctx = c.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  if (!state.store || !$('#show-regions').checked) return

  const hovered = state.regionInput?.hovered
  const pressed = state.regionInput?.pressed?.region
  const trace = (points) => {
    points.forEach(([mx, my], i) => {
      const p = state.viewport.modelToScreen(mx, my)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.closePath()
  }

  for (const r of state.store.all) {
    const on = r === hovered || r === pressed
    ctx.beginPath()
    trace(r.points)
    for (const h of r.holes || []) trace(h)
    ctx.fillStyle = on ? 'rgba(120,180,255,0.30)' : 'rgba(120,180,255,0.05)'
    // evenodd：洞（与其它热区的交集）要真的空出来，不是盖上去
    ctx.fill('evenodd')
    ctx.lineWidth = on ? 2.5 : 1
    ctx.strokeStyle = on ? 'rgba(170,215,255,1)' : 'rgba(120,170,230,0.5)'
    if (on) { ctx.shadowColor = 'rgba(120,180,255,0.9)'; ctx.shadowBlur = 8 }
    ctx.stroke()
    ctx.shadowBlur = 0
    const b = r.points.reduce((a, [x, y]) => ({ x: a.x + x, y: a.y + y }), { x: 0, y: 0 })
    const c0 = state.viewport.modelToScreen(b.x / r.points.length, b.y / r.points.length)
    ctx.font = '11px system-ui'
    ctx.textAlign = 'center'
    if (on) {
      const w = ctx.measureText(r.name).width + 12
      ctx.fillStyle = 'rgba(10,14,22,0.85)'
      ctx.beginPath()
      ctx.roundRect(c0.x - w / 2, c0.y - 9, w, 18, 5)
      ctx.fill()
    }
    ctx.fillStyle = on ? '#e8f2ff' : 'rgba(190,215,245,0.75)'
    ctx.fillText(r.name, c0.x, c0.y + 4)
  }

  if (state.editor.points.length) {
    ctx.beginPath()
    trace(state.editor.points)
    ctx.strokeStyle = '#ffd166'
    ctx.lineWidth = 2
    ctx.stroke()
    for (const [mx, my] of state.editor.points) {
      const p = state.viewport.modelToScreen(mx, my)
      ctx.fillStyle = '#ffd166'
      ctx.beginPath()
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// ---------- 动作通路 ----------
async function postAction(action, extra = {}) {
  const body = { id: crypto.randomUUID(), source: 'user', priority: 'NORMAL', fade: 0.3, action, ...extra }
  try {
    const r = await fetch('/api/action', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-stage-token': TOKEN }, body: JSON.stringify(body),
    })
    const j = await r.json()
    pushLog('bus', `${b2s(action)} → accepted(${j.effectivePriority})`)
  } catch (e) { pushLog('warn', '总线不可达: ' + e.message) }
}
const b2s = (a) => (a.kind === 'expression' ? `表情:${a.name ?? '清除'}` : `${a.name ?? a.kind}`)

const indexInGroup = (m) => state.caps.motions.filter((x) => x.group === m.group).findIndex((x) => x.file === m.file)

async function playMotion(m) {
  const { stage } = state
  if (!stage) return pushLog('warn', '模型未加载')
  const idx = indexInGroup(m)
  if (idx < 0) return pushLog('warn', `动作不在组内：${m.name}`)
  await stage.motion(m.group, idx, { priority: MotionPriority.FORCE })
  pushLog('motion', `${m.name}（${m.group}#${idx}）`)
  postAction({ kind: 'motion', name: m.name, group: m.group, index: idx })
}

// ---------- 表情叠加（L2） ----------
function addExpression(name, { fade = 0.3, source = 'manual' } = {}) {
  const def = state.caps.expressions.find((e) => e.name === name)
  if (!def) { pushLog('warn', `没有表情：${name}`); return false }
  const ok = state.layers.addExpression(name, def.params, { fade, source })
  if (ok) pushLog('expr', `+ ${name}（${def.params.length} 参数）`)
  renderExprChips()
  return ok
}

function removeExpression(name) {
  if (state.layers.removeExpression(name)) { pushLog('expr', `− ${name}`); renderExprChips() }
}

function clearExpressions() {
  const n = state.layers.clearExpressions()
  renderExprChips()
  pushLog('expr', `清空 ${n} 层`)
}

function renderExprChips() {
  const names = state.layers?.expressions() || []
  $('#n-expr-on').textContent = names.length
  $('#expr-chips').innerHTML = names.length
    ? names.map((x) => `<span class="chip" data-x="${x}">${x} ×</span>`).join('') + '<span class="chip ghost" data-clear="1">清空</span>'
    : '<span class="meta">点左侧表情加入叠加</span>'
  $('#expr-chips').querySelectorAll('[data-x]').forEach((el) => (el.onclick = () => removeExpression(el.dataset.x)))
  $('#expr-chips').querySelector('[data-clear]')?.addEventListener('click', clearExpressions)
  $('#expressions').querySelectorAll('[data-e]').forEach((el) => {
    const e = state.caps.expressions[Number(el.dataset.e)]
    el.classList.toggle('on', names.includes(e.name))
  })
}

function playExpression(e) {
  if (!state.stage) return pushLog('warn', '模型未加载')
  if (state.layers.hasExpression(e.name)) removeExpression(e.name)
  else addExpression(e.name)
  postAction({ kind: 'expression', name: e.name })
}

// ---------- 状态回传（演示） ----------
function sendState(s) {
  const mapped = state.stateMap[s] || {}
  if (mapped.expression) addExpression(mapped.expression, { fade: 0.25 })
  postAction(
    { kind: 'state', state: s, map: mapped },
    { source: 'state', priority: s === 'waiting' ? 'FORCE' : 'NORMAL', ttlMs: s === 'success' || s === 'error' ? 4000 : 0 },
  )
  pushLog('state', `${s} → ${mapped.expression || '（未配）'}`)
}

// ---------- 可复现钩子 ----------
// ?expr=…&motion=2&param=…&steps=30&hit=x,y&regionhit=x,y&tap=x,y&reaction=头:tap;腰:tap&hidepart=…
function applyDeepLink() {
  const q = new URLSearchParams(location.search)
  const { stage, layers, viewport } = state

  if (q.get('bg')) {
    $('#stage').classList.remove('checker')
    $('#stage').style.background = q.get('bg')
    $('#checker').checked = false
  }
  if (q.get('regions') === '0') { $('#show-regions').checked = false; $('#region-hint').textContent = '' }
  if (q.get('gaze') === '0') { $('#gaze').checked = false; state.gazeOn = false; state.gaze.set({ enabled: false }) }
  if (q.get('expr')) {
    for (const n of q.get('expr').split(',')) addExpression(n.trim())
    pushLog('deep', `表情 ${q.get('expr')}`)
  }
  if (q.get('motion')) {
    const list = state.caps.motions.filter((x) => x.group === 'Action')
    const m = list[Number(q.get('motion'))]
    if (m) playMotion(m)
  }
  if (q.get('param')) {
    for (const kv of q.get('param').split(',')) {
      const [id, v] = kv.split(':')
      if (!id || v == null) continue
      if (layers.hold(id, Number(v))) pushLog('deep', `钉住 ${id}=${v}`)
    }
    renderHeld()
  }
  for (const id of (q.get('hidepart') || '').split(',').filter(Boolean)) {
    if (layers.setPart(id, 0)) pushLog('probe', `隐藏部件 ${id}`)
  }
  if (q.get('zoom')) viewport.set({ zoom: Number(q.get('zoom')) })
  if (q.get('offset')) {
    const [ox = 0, oy = 0] = q.get('offset').split(',').map(Number)
    viewport.set({ offsetX: ox, offsetY: oy })
  }

  // 分区动作组回归：?reaction=头:tap;腰:tap（按顺序触发，用来验证「切换不叠加」）
  if (q.get('reaction')) {
    for (const spec of q.get('reaction').split(';').filter(Boolean)) {
      const [name, kind = 'tap'] = spec.split(':')
      const r = state.store.all.find((x) => x.name === name)
      if (r) applyReaction(r, kind)
      else pushLog('warn', `没有热区：${name}`)
      // 两次反应之间推进若干帧（验证「同名表情是否被重置重播」）
      if (q.get('reactiongap')) stage.step(Math.max(1, Number(q.get('reactiongap')) || 10))
    }
  }

  // 热区命中反查（屏幕坐标，相对 stage 左上角）：标定/回归用
  if (q.get('regionhit') || q.get('tap')) {
    const [sx, sy] = (q.get('regionhit') || q.get('tap')).split(',').map(Number)
    const p = viewport.toModelLocal(sx, sy)
    let r = state.store.hit(p.x, p.y)
    const { alpha } = stage.sampleAlpha(sx, sy)
    const opaque = (alpha ?? 0) > 12
    if (r && !opaque) r = null   // 透明处穿透，不算命中
    pushLog('region', `(${sx},${sy}) → 模型(${Math.round(p.x)},${Math.round(p.y)}) alpha=${alpha} 命中：${r ? r.name : '无'}`)
    if (q.get('tap')) {
      if (r) applyReaction(r, 'tap')
      document.title = `TAP ${r ? r.name : 'miss'}`
    }
  }

  // 命中反查（网格级）
  if (q.get('hit')) {
    const [sx, sy] = q.get('hit').split(',').map(Number)
    const p = stage.toModel(sx, sy)
    const core = stage.core
    const n = core.getDrawableCount()
    const order = core.getDrawableRenderOrders ? core.getDrawableRenderOrders() : []
    const hits = []
    for (let i = 0; i < n; i++) {
      const idx = core.getDrawableVertexIndices(i)
      const vtx = stage.model.internalModel.getDrawableVertices(i)
      if (!idx || !vtx) continue
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 2, b = idx[t + 1] * 2, c = idx[t + 2] * 2
        if (pointInTri(p.x, p.y, vtx[a], vtx[a + 1], vtx[b], vtx[b + 1], vtx[c], vtx[c + 1])) {
          hits.push({ i, id: String(core.getDrawableId(i).getString().s), order: order[i] })
          break
        }
      }
    }
    hits.sort((x, y) => (x.order ?? 0) - (y.order ?? 0))
    pushLog('hit', `(${sx},${sy}) 命中 ${hits.length} 个网格`)
    for (const h of hits.slice(-6)) pushLog('hit', `#${h.i} ${h.id} order=${h.order}`)
    document.title = `HIT ${hits.length} ${hits.slice(-2).map((h) => h.id).join(' ')}`
  }

  if (q.get('steps')) {
    const n = Math.max(1, Number(q.get('steps')) || 60)
    stage.step(n)
    const probe = ['key2', 'key7']
      .map((id) => `${id}=${Number(stage.param.get(id) ?? NaN).toFixed(2)}`)
    pushLog('check', `步进 ${n} 帧 · ${probe.join(' ')}`)
    const info = state.layers.inspect()
    document.title = `DBG steps=${n} layers=${info.layers.map((l) => l.name).join('+') || '-'} ${probe.join(' ')}`
  }
  drawOverlay()
}

function pointInTri(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

// ---------- 面板渲染 ----------
function renderMeta() {
  const c = state.caps
  $('#meta').innerHTML = `${c.model.name}<br>参数 ${c.params.length} · 部件 ${c.parts.length}<br>动作 ${c.motions.length} · 表情 ${c.expressions.length}`
  $('#n-param').textContent = c.params.length
  $('#n-motion').textContent = c.motions.length
  $('#n-exp').textContent = c.expressions.length
}

function renderLists() {
  const c = state.caps
  $('#motions').innerHTML = c.motions
    .map((m, i) => `<div class="item" data-m="${i}"><span class="nm">${m.name}</span><span class="tag">${m.duration ? m.duration.toFixed(1) + 's' : ''}</span></div>`)
    .join('')
  $('#expressions').innerHTML = c.expressions.map((e, i) => `<div class="item" data-e="${i}"><span class="nm">${e.name}</span></div>`).join('')

  $('#motions').querySelectorAll('[data-m]').forEach((el) => (el.onclick = () => {
    el.parentElement.querySelectorAll('.item').forEach((x) => x.classList.remove('on'))
    el.classList.add('on')
    playMotion(c.motions[Number(el.dataset.m)])
  }))
  $('#expressions').querySelectorAll('[data-e]').forEach((el) => (el.onclick = () => playExpression(c.expressions[Number(el.dataset.e)])))

  $('#q').oninput = () => {
    const q = $('#q').value.trim().toLowerCase()
    const hit = (s) => !q || s.toLowerCase().includes(q)
    document.querySelectorAll('#motions .item').forEach((el) => (el.style.display = hit(c.motions[Number(el.dataset.m)].name) ? '' : 'none'))
    document.querySelectorAll('#expressions .item').forEach((el) => (el.style.display = hit(c.expressions[Number(el.dataset.e)].name) ? '' : 'none'))
    document.querySelectorAll('#params .item').forEach((el) => (el.style.display = hit(el.dataset.id) || hit(el.dataset.name) ? '' : 'none'))
  }
}

const paramSource = () => (state.runtimeParams?.length ? state.runtimeParams : state.caps.params)

function renderParams() {
  const list = paramSource()
  $('#n-param').textContent = list.length
  $('#params').innerHTML = list
    .map((p, i) => `<div class="item" data-i="${i}" data-id="${p.id}" data-name="${p.name}"><span class="nm">${p.name}</span><span class="tag">${p.id}</span></div>`)
    .join('')
  $('#params').querySelectorAll('[data-i]').forEach((el) => (el.onclick = () => {
    el.classList.toggle('on')
    if (el.classList.contains('on')) holdParam(list[Number(el.dataset.i)])
    else { state.layers.release(el.dataset.id); renderHeld() }
  }))
}

function holdParam(p) {
  const cur = state.stage?.param.get(p.id) ?? p.default ?? 0
  if (p.min == null || p.max == null) { pushLog('warn', `${p.id} 缺范围，无法受控`); return }
  state.layers.hold(p.id, cur)
  renderHeld()
}

function renderHeld() {
  const held = state.layers?.held() || []
  $('#held').innerHTML = held
    .map(([id, v]) => {
      const p = paramSource().find((x) => x.id === id) || { id, min: -1, max: 1, name: id }
      return `<div class="item"><span class="nm" style="flex:0 0 78px;color:var(--dim)">${p.name}</span>
      <span class="slider"><input type="range" data-id="${id}" min="${p.min}" max="${p.max}" step="${(p.max - p.min) / 200 || 0.01}" value="${v}">
      <span class="val" data-val="${id}">${Number(v).toFixed(2)}</span></span></div>`
    })
    .join('') || '<div class="meta">点左侧参数加入受控列表</div>'

  $('#held').querySelectorAll('input[type=range]').forEach((el) => (el.oninput = () => {
    const v = Number(el.value)
    state.layers.hold(el.dataset.id, v)
    $('#held').querySelector(`[data-val="${el.dataset.id}"]`).textContent = v.toFixed(2)
  }))
  $('#params').querySelectorAll('[data-i]').forEach((el) => el.classList.toggle('on', held.some(([id]) => id === el.dataset.id)))
}

boot()
