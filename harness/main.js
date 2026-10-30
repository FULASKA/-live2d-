// 验证台：证明「能力枚举 / 双路动作 / 参数叠加 / 视线跟随 / 命中反查」几条通路可用。
// 只依赖 PROTOCOL.md 的接口 + src/stage 的内核适配层，不含产品 UI。
//
// 内核已换：pixi.js 8 + untitled-pixi-live2d-engine（Cubism 5）。
// 旧页（pixi6 + pixi-live2d-display）已删除 —— 它不认乘法色，鼻子是黑块、瞳孔丢色。

import { createStage, MotionPriority } from '../src/stage/engine.js'
import { createLayerStack } from '../src/stage/layers.js'
import { createViewport } from '../src/stage/viewport.js'

const $ = (s) => document.querySelector(s)
const TOKEN = new URLSearchParams(location.search).get('token') || 'dev-token'

const state = {
  caps: null, stage: null, layers: null, viewport: null,
  gaze: true, intensity: 0.6,
  log: [],
  frames: 0,
  stateMap: {
    thinking: { expression: '圈圈眼' }, working: { expression: '加载' },
    waiting: { expression: '流冷汗' }, success: { expression: '爱心眼' }, error: { expression: '流泪' },
  },
}

function pushLog(kind, text) {
  state.log.unshift({ kind, text, t: new Date().toLocaleTimeString() })
  state.log.length = Math.min(state.log.length, 80)
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
    state.layers = createLayerStack({ param: stage.param, part: stage.part })
    stage.onBeforeUpdate(() => state.layers.apply())
    // 帧内取样：写在 coreModel.update() 之前一刻，这是唯一能读到「真正送进绘制」的值的位置
    stage.onBeforeUpdate(() => {
      window.__frameParams = {
        key1: stage.param.get('key1'), key2: stage.param.get('key2'), key7: stage.param.get('key7'),
        headZ: stage.param.get('ParamAngleZ'),
        eyeX: stage.param.get('ParamEyeBallX'), eyeY: stage.param.get('ParamEyeBallY'),
      }
    })

    const viewport = createViewport({ model: stage.model, app: stage.app })
    state.viewport = viewport
    viewport.observe($('#stage'))

    stage.app.ticker.add(() => {
      state.frames = stage.clocks().frames
      $('#fps').textContent = `FPS ${stage.ticker.FPS.toFixed(0)}`
    })

    pushLog('model', `已加载 ${state.caps.model.name}（Cubism 5 内核）`)
    introspect()
    hookPointer()
    bindControls()
    applyDeepLink()

    // 自动化入口（无头验证脚本用）：等这个标记再截图/取样
    window.__stage = state
    window.__ready = true
    document.title = `ready ${state.caps.model.name}`
  } catch (e) {
    pushLog('error', `模型加载失败：${e.message}`)
    $('#meta').innerHTML = `<div class="warn">模型加载失败：${e.message}</div>`
    window.__error = e.message
  }
}

function bindControls() {
  $('#gaze').onchange = (e) => { state.gaze = e.target.checked }
  $('#gaze-int').oninput = (e) => { state.intensity = Number(e.target.value) }
  $('#checker').onchange = (e) => $('#stage').classList.toggle('checker', e.target.checked)
  $('#send-state').onclick = () => sendState($('#state-sel').value)
}

// ---------- 视线跟随（L1，可叠加，不抢占任何层） ----------
function hookPointer() {
  window.addEventListener('pointermove', (e) => {
    const { stage } = state
    if (!stage || !state.gaze) return
    const r = stage.canvas.getBoundingClientRect()
    const sw = stage.app.screen.width, sh = stage.app.screen.height
    const tx = ((e.clientX - r.left) / r.width) * sw
    const ty = ((e.clientY - r.top) / r.height) * sh
    // 强度 = 目标点向画面中心收缩的比例：0 = 完全不跟，1 = 跟满
    const k = state.intensity
    stage.focus(sw / 2 + (tx - sw / 2) * k, sh / 2 + (ty - sh / 2) * k)
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

  const model = stage.model
  const tex = model.textures || []
  pushLog('inspect', `贴图 ${tex.length} 张${tex[0]?.source?.pixelWidth ? ` / ${tex.map((t) => `${t.source.pixelWidth}x${t.source.pixelHeight}`).join(' ')}` : ''}`)

  const core = stage.core
  const n = core.getDrawableCount()
  const ids = []
  for (let i = 0; i < n; i++) ids.push(String(core.getDrawableId(i).getString().s))
  const masked = core.getDrawableMaskCounts ? Array.from(core.getDrawableMaskCounts()).filter((x) => x > 0).length : 0
  pushLog('inspect', `网格 ${n} 个 · 带遮罩 ${masked}`)

  // 换核后必须复核的一件事：乘法色真的生效了（鼻子阴影不再变块）
  if (core.getMultiplyColor) {
    let nonWhite = 0
    const samples = []
    for (let i = 0; i < n; i++) {
      try {
        const c = core.getMultiplyColor(i)
        if (!c) continue
        if (c.r < 0.99 || c.g < 0.99 || c.b < 0.99) {
          nonWhite++
          if (samples.length < 6) samples.push(`${ids[i]}(${c.r.toFixed(2)},${c.g.toFixed(2)},${c.b.toFixed(2)})`)
        }
      } catch {}
    }
    pushLog('inspect', `非白乘法色网格 ${nonWhite}/${n}${samples.length ? ': ' + samples.join(' ') : ''}`)
  } else {
    pushLog('warn', '内核仍未暴露乘法色表面 API')
  }

  const groups = (() => {
    try { return Object.keys(state.stage.model.internalModel.motionManager.definitions || {}) } catch { return [] }
  })()
  if (groups.length) pushLog('inspect', `动作组：${groups.join(', ')}`)
  renderParams()
}

// ---------- 动作通路（内核原语 + 总线记录） ----------
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
function addExpression(name, { fade = 0.3 } = {}) {
  const def = state.caps.expressions.find((e) => e.name === name)
  if (!def) { pushLog('warn', `没有表情：${name}`); return false }
  const ok = state.layers.addExpression(name, def.params, { fade })
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

// ---------- 状态回传（L5 映射，演示用） ----------
function sendState(s) {
  const mapped = state.stateMap[s] || {}
  if (mapped.expression) addExpression(mapped.expression, { fade: 0.25 })
  postAction(
    { kind: 'state', state: s, map: mapped },
    { source: 'state', priority: s === 'waiting' ? 'FORCE' : 'NORMAL', ttlMs: s === 'success' || s === 'error' ? 4000 : 0 },
  )
  pushLog('state', `${s} → ${mapped.expression || '（未配）'}`)
}

// ---------- 可复现的验证钩子 ----------
// ?expr=圈圈眼,流泪&motion=2&param=ParamAngleX:20&steps=30&hit=400,300&hidepart=Part10
function applyDeepLink() {
  const q = new URLSearchParams(location.search)
  const { stage, layers, viewport } = state

  if (q.get('bg')) {
    const el = $('#stage')
    el.classList.remove('checker')
    el.style.background = q.get('bg')
    $('#checker').checked = false
  }
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
  for (const kv of (q.get('showpart') || '').split(',').filter(Boolean)) {
    const [id, v] = kv.split(':')
    if (layers.setPart(id, Number(v ?? 1))) pushLog('probe', `部件 ${id}=${v ?? 1}`)
  }
  if (q.get('zoom')) viewport.set({ zoom: Number(q.get('zoom')) })
  if (q.get('offset')) {
    const [ox = 0, oy = 0] = q.get('offset').split(',').map(Number)
    viewport.set({ offsetX: ox, offsetY: oy })
  }

  // 命中反查：?hit=x,y —— 从屏幕坐标反查哪些网格盖住了这个点（区域标定的基础）
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
          hits.push({ i, id: String(core.getDrawableId(i).getString().s), order: order[i], opacity: core.getDrawableOpacity(i) })
          break
        }
      }
    }
    hits.sort((x, y) => (x.order ?? 0) - (y.order ?? 0))
    pushLog('hit', `(${sx},${sy}) model=(${p.x.toFixed(0)},${p.y.toFixed(0)}) 命中 ${hits.length} 个`)
    for (const h of hits.slice(-6)) pushLog('hit', `#${h.i} ${h.id} op=${h.opacity.toFixed(2)} order=${h.order}`)
    document.title = `HIT ${hits.length} ${hits.slice(-2).map((h) => h.id).join(' ')}`
  }

  // 确定性步进：无头浏览器只渲一帧，用这个手动推进 N 帧再取样（也是 CI 钩子）
  if (q.get('steps')) {
    const n = Math.max(1, Number(q.get('steps')) || 60)
    stage.step(n)
    const core = stage.core
    const probe = ['key1', 'key3', 'key4', 'key5', 'key6', 'key7']
      .map((id) => `${id}=${Number(stage.param.get(id) ?? NaN).toFixed(2)}`)
    const before = stage.param.get('key3')
    stage.param.set('key3', 0.77)
    const afterSet = stage.param.get('key3')
    stage.step(1)
    const afterUpdate = stage.param.get('key3')
    pushLog('check', `步进 ${n} 帧 · 持久性 before=${before} set=${afterSet} afterUpdate=${afterUpdate}`)
    const info = state.layers.inspect()
    document.title = `DBG steps=${n} layers=${info.layers.map((l) => l.name).join('+') || '-'} conflicts=${info.conflictParams.length} ${probe.join(' ')}`
  }
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
    .map((m, i) => `<div class="item" data-m="${i}"><span class="nm">${m.name}</span><span class="tag">${m.duration ? m.duration.toFixed(1) + 's' : ''}${m.group === 'Idle' ? ' idle' : ''}</span></div>`)
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
  // 解绑的面板同步
  $('#params').querySelectorAll('[data-i]').forEach((el) => el.classList.toggle('on', held.some(([id]) => id === el.dataset.id)))
}

boot()
