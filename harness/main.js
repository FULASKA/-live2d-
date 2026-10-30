// 验证台：证明「能力枚举 / 动作下发 / 参数内省 / 视线跟随」四条通路可用。
// 只依赖 PROTOCOL.md 的接口，不含产品 UI。

const CDN = {
  core: 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
  pixi: 'https://unpkg.com/pixi.js@6.5.10/dist/browser/pixi.min.js',
  live2d: 'https://unpkg.com/pixi-live2d-display@0.4.0/dist/cubism4.min.js',
}
const $ = (s) => document.querySelector(s)
const TOKEN = new URLSearchParams(location.search).get('token') || 'dev-token'

const state = {
  caps: null, model: null, app: null,
  held: new Map(),        // 受控参数（模拟 L5 覆盖层）
  exprs: [],              // L2 表情层：可叠多层，后应用者覆盖同参数
  gaze: true, intensity: 0.6,
  log: [],
  stateMap: {
    thinking: { expression: '圈圈眼' }, working: { expression: '加载' },
    waiting: { expression: '流冷汗' }, success: { expression: '爱心眼' }, error: { expression: '流泪' },
  },
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('加载失败: ' + src))
    document.head.appendChild(s)
  })
}

function pushLog(kind, text) {
  state.log.unshift({ kind, text, t: new Date().toLocaleTimeString() })
  state.log.length = Math.min(state.log.length, 80)
  renderLog()
}
function renderLog() {
  $('#log').innerHTML = state.log.map((e) => `<div class="ev"><b>${e.kind}</b> ${e.text} <span style="float:right">${e.t}</span></div>`).join('')
}

async function boot() {
  try {
    const caps = await fetch('/api/capabilities').then((r) => r.json())
    state.caps = caps
    renderMeta()
    renderLists()
  } catch (e) {
    $('#meta').innerHTML = `<div class="warn">拿不到能力清单：${e.message}</div>`
  }

  try {
    await loadScript('/vendor/live2dcubismcore.min.js').catch(() => loadScript(CDN.core))
    pushLog('core', 'Cubism Core 就绪')
  } catch (e) {
    $('#meta').innerHTML = '<div class="warn">缺 Cubism Core。<br>跑 <code>node scripts/fetch-core.mjs</code>，或联网后刷新（会走官方 CDN）。</div>'
    return
  }
  await loadScript(CDN.pixi)
  await loadScript(CDN.live2d)
  await bootStage()
}

async function bootStage() {
  const PIXI = window.PIXI
  const stageEl = $('#stage')
  const q0 = new URLSearchParams(location.search)
  const app = new PIXI.Application({
    view: $('#cv'), backgroundAlpha: q0.get('bg') ? 1 : 0, antialias: true,
    autoDensity: true, resolution: window.devicePixelRatio || 1, resizeTo: stageEl,
  })
  if (q0.get('bg')) app.renderer.backgroundColor = parseInt(q0.get('bg').replace('#', ''), 16)
  state.app = app

  try {
    const model = await PIXI.live2d.Live2DModel.from(state.caps.model.url)
    state.model = model
    model.anchor.set(0.5, 0.5)
    app.stage.addChild(model)
    layout()
    window.addEventListener('resize', layout)
    requestAnimationFrame(layout)
    app.renderer.on?.('resize', layout)
    pushLog('model', `已加载 ${state.caps.model.name}`)
    introspect()
    if (model.internalModel.on) {
      // 事件名先探一遍：不同版本的 pixi-live2d-display 钩子位置不一样
      state.evCounts = {}
      for (const ev of ['beforeModelUpdate', 'beforeMotionUpdate', 'afterMotionUpdate', 'afterModelUpdate']) {
        model.internalModel.on(ev, () => { state.evCounts[ev] = (state.evCounts[ev] || 0) + 1 })
      }
    }
    // 真正的叠层点：coreModel.update() 之前一瞬（这里的写入不会被后续步骤还原）
    const cm = model.internalModel.coreModel
    const origUpdate = cm.update.bind(cm)
    cm.update = () => { applyLayers(); origUpdate() }
    hookPointer()
    applyDeepLink()
    app.ticker.add(() => { state.frames = (state.frames || 0) + 1; $('#fps').textContent = `FPS ${app.ticker.FPS.toFixed(0)}` })
  } catch (e) {
    pushLog('error', '模型加载失败: ' + e.message)
    $('#meta').innerHTML = `<div class="warn">模型加载失败：${e.message}</div>`
  }

  $('#gaze').onchange = (e) => { state.gaze = e.target.checked }
  $('#gaze-int').oninput = (e) => { state.intensity = Number(e.target.value) }
  $('#checker').onchange = (e) => stageEl.classList.toggle('checker', e.target.checked)
  $('#send-state').onclick = () => sendState($('#state-sel').value)
}

/** 可复现的视觉验证钩子：?expr=圈圈眼&motion=2&param=ParamAngleX:20&checker=0 */
function applyDeepLink() {
  const q = new URLSearchParams(location.search)
  const { model } = state
  if (q.get('expr')) {
    for (const n of q.get('expr').split(',')) addExpression(n.trim())
    pushLog('deep', `表情 ${q.get('expr')}`)
    setTimeout(() => {
      const cm = state.model?.internalModel.coreModel
      if (!cm) return
      const probe = ['key1', 'key3', 'key4', 'key5', 'key6', 'key7']
        .map((id) => `${id}=${Number(cm.getParameterValueById(id) ?? NaN).toFixed(2)}`)
      pushLog('check', `expr 生效: ${probe.join(' ')}`)
      if (!q.get('steps')) document.title = `DBG frames=${state.frames || 0} layers=${state.layerCount || 0} expr=${state.exprs.map((x) => x.name).join('+') || '-'} ${probe.join(' ')}`
    }, 1200)
  }
  if (q.get('motion')) {
    const i = Number(q.get('motion'))
    const m = state.caps.motions.filter((x) => x.group === 'Action')[i]
    if (m) { playMotion(m, 0) }
  }
  if (q.get('param')) {
    for (const kv of q.get('param').split(',')) {
      const [id, v] = kv.split(':')
      if (id && v != null) { state.held.set(id, Number(v)); }
    }
    applyHeld(); renderHeld()
  }
  if (q.get('checker') === '0') $('#stage').classList.remove('checker')

  // 确定性步进：无头浏览器只渲一帧，用这个手动推进 N 帧再取样（也可当 CI 钩子）
  if (q.get('steps')) {
    const n = Math.max(1, Number(q.get('steps')) || 60)
    for (let i = 0; i < n; i++) { model.internalModel.update(1 / 60); state.frames = (state.frames || 0) + 1 }
    state.app.renderer.render(state.app.stage)
    const cm = model.internalModel.coreModel
    const idx = cm.getParameterIndex?.('key3')
    const rng = idx != null && idx >= 0 ? [cm.getParameterMinimumValue?.(idx), cm.getParameterMaximumValue?.(idx), cm.getParameterDefaultValue?.(idx)] : 'no-idx'
    state.dbg = { ...(state.dbg || {}), idx, rng, value: cm.getParameterValueById('key3'), layer: state.dbgLayer }
    const probe = ['key1', 'key3', 'key4', 'key5', 'key6', 'key7']
      .map((id) => `${id}=${Number(cm.getParameterValueById(id) ?? NaN).toFixed(2)}`)
    const before = cm.getParameterValueById('key3')
    cm.setParameterValueById('key3', 0.77)
    const afterSet = cm.getParameterValueById('key3')
    model.internalModel.update(1 / 60)
    const afterUpdate = cm.getParameterValueById('key3')
    pushLog('check', `持久性 before=${before} set=${afterSet} afterUpdate=${afterUpdate}`)
    document.title = `DBG steps=${n} persist=${before}/${afterSet}/${afterUpdate} dbg=${JSON.stringify(state.dbg || {})} ${probe.join(' ')}`
  }
}

function layout() {
  const { model, app } = state
  if (!model) return
  const el = $('#stage')
  // 先对齐渲染器尺寸：resizeTo 的回调可能晚于首次 layout
  const w = el.clientWidth || app.renderer.screen.width
  const h = el.clientHeight || app.renderer.screen.height
  if (w && h && (app.renderer.screen.width !== w || app.renderer.screen.height !== h)) {
    app.renderer.resize(w, h)
  }
  const sw = app.renderer.screen.width || w, sh = app.renderer.screen.height || h
  const mw = model.internalModel.originalWidth || model.width || 1
  const mh = model.internalModel.originalHeight || model.height || 1
  const s = Math.min(sw / mw, sh / mh) * 0.95
  model.scale.set(s)
  model.position.set(sw / 2, sh / 2)
}

function hookPointer() {
  window.addEventListener('pointermove', (e) => {
    const { model, app } = state
    if (!model || !state.gaze) return
    const r = $('#cv').getBoundingClientRect()
    const sw = app.renderer.screen.width, sh = app.renderer.screen.height
    const tx = ((e.clientX - r.left) / r.width) * sw
    const ty = ((e.clientY - r.top) / r.height) * sh
    // 强度 = 目标点向中心收缩的比例（后续由 gaze.intensity 参数化在 core 里）
    const k = state.intensity
    model.focus(sw / 2 + (tx - sw / 2) * k, sh / 2 + (ty - sh / 2) * k)
  })
}

/** 运行时内省：参数真实范围只在这里拿得到 */
function introspect() {
  const { model, caps } = state
  const cm = model.internalModel.coreModel
  const ids = cm._parameterIds || []
  const min = cm._parameterMinimumValues, max = cm._parameterMaximumValues, def = cm._parameterDefaultValues
  const byId = new Map(caps.params.map((p) => [p.id, p]))
  state.runtimeParams = ids.map((id, i) => ({
    id,
    name: byId.get(id)?.name || id,
    group: byId.get(id)?.group || null,
    min: min ? min[i] : null, max: max ? max[i] : null, default: def ? def[i] : null,
    value: cm.getParameterValueById ? cm.getParameterValueById(id) : null,
  }))
  if (state.runtimeParams.length) {
    pushLog('inspect', `运行时参数 ${state.runtimeParams.length} 个（最小/最大/默认值已取到）`)
    renderParams()
  } else {
    pushLog('warn', '未取到运行时参数列表，参数面板退化为静态清单')
  }
  // 动作/表情是否真的注册上了
  const mm = model.internalModel.motionManager
  const groups = mm?.definitions ? Object.keys(mm.definitions) : []
  if (groups.length) pushLog('inspect', `动作组: ${groups.join(', ')}`)
  // 贴图与网格：黑块/空眼多半出在这两处
  const tex = model.textures || model.internalModel.textures || []
  const drawIds = cm._drawableIds || []
  pushLog('inspect', `贴图 ${tex.length} 张${tex[0]?.width ? ` / ${tex.map((t) => `${t.width}x${t.height}`).join(' ')}` : ''} · 网格 ${drawIds.length} 个`)
  state.inspect = { tex: tex.length, drawables: drawIds.length }
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
const b2s = (a) => a.kind === 'expression' ? `表情:${a.name ?? '清除'}` : `${a.name ?? a.kind}`

function playMotion(m, i) {
  const { model } = state
  if (!model) return pushLog('warn', '模型未加载')
  model.motion(m.group, indexInGroup(m, i), window.PIXI.live2d.MotionPriority.FORCE)
  postAction({ kind: 'motion', name: m.name, group: m.group })
}
const indexInGroup = (m) => state.caps.motions.filter((x) => x.group === m.group).findIndex((x) => x.file === m.file)

/** L2 表情层：支持多层叠加。同一参数由后应用的一层胜出（眼型组因此天然互斥） */
function addExpression(name, { fade = 0.3 } = {}) {
  const def = state.caps.expressions.find((e) => e.name === name)
  if (!def) { pushLog('warn', `没有表情: ${name}`); return false }
  if (state.exprs.some((x) => x.name === name)) return true
  state.exprs.push({ name, params: def.params, t0: state.fadeT || 0, fadeSec: Math.max(0, fade) })
  pushLog('expr', `+ ${name}（${def.params.length} 参数）`)
  renderExprChips()
  return true
}

function removeExpression(name) {
  const i = state.exprs.findIndex((x) => x.name === name)
  if (i >= 0) { state.exprs.splice(i, 1); pushLog('expr', `− ${name}`); renderExprChips() }
}

function toggleExpression(name) {
  if (state.exprs.some((x) => x.name === name)) removeExpression(name); else addExpression(name)
}

function clearExpressions() {
  state.exprs.length = 0
  renderExprChips()
  pushLog('expr', '清空')
}

function renderExprChips() {
  const host = $('#expr-chips')
  if (!host) return
  host.innerHTML = state.exprs.length
    ? state.exprs.map((x) => `<span class="chip" data-x="${x.name}">${x.name} ×</span>`).join('') +
      '<span class="chip ghost" data-clear="1">清空</span>'
    : '<span class="meta">点左侧表情加入叠加</span>'
  host.querySelectorAll('[data-x]').forEach((el) => el.onclick = () => removeExpression(el.dataset.x))
  host.querySelector('[data-clear]')?.addEventListener('click', clearExpressions)
}

/** 每帧在动作之后、coreModel.update 之前叠层：L2 表情（可多层）→ L5 受控参数 */
function applyLayers() {
  const { model } = state
  if (!model) return
  const cm = model.internalModel.coreModel
  for (const ex of state.exprs) {
    const k = ex.fadeSec > 0 ? Math.min(1, Math.max(0, ((state.fadeT || 0) - ex.t0) / ex.fadeSec)) : 1
    for (const p of ex.params) {
      const cur = cm.getParameterValueById(p.Id)
      if (cur == null) continue
      const blend = p.Blend || 'Overwrite'
      const target = blend === 'Multiply' ? cur * (1 + (p.Value - 1) * k)
        : blend === 'Add' ? cur + p.Value * k
          : cur + (p.Value - cur) * k
      cm.setParameterValueById(p.Id, target)
    }
  }
  for (const [id, v] of state.held) cm.setParameterValueById(id, v)
  state.fadeT = (state.fadeT || 0) + 1 / 60
  state.layerCount = (state.layerCount || 0) + 1
}

function playExpression(e) {
  const { model } = state
  if (!model) return pushLog('warn', '模型未加载')
  toggleExpression(e.name)
  postAction({ kind: 'expression', name: e.name })
}

function sendState(s) {
  const mapped = state.stateMap[s] || {}
  const { model } = state
  if (model && mapped.expression) addExpression(mapped.expression, { fade: 0.25 })
  postAction({ kind: 'state', state: s, map: mapped }, { source: 'state', priority: s === 'waiting' ? 'FORCE' : 'NORMAL', ttlMs: s === 'success' || s === 'error' ? 4000 : 0 })
  pushLog('state', `${s} → ${mapped.expression || '（未配）'}`)
}

// ---------- 渲染 ----------
function renderMeta() {
  const c = state.caps
  $('#meta').innerHTML = `${c.model.name}<br>参数 ${c.params.length} · 部件 ${c.parts.length}<br>动作 ${c.motions.length} · 表情 ${c.expressions.length}`
  $('#n-param').textContent = c.params.length
  $('#n-motion').textContent = c.motions.length
  $('#n-exp').textContent = c.expressions.length
}

function renderLists() {
  const c = state.caps
  $('#motions').innerHTML = c.motions.map((m, i) => `<div class="item" data-m="${i}"><span class="nm">${m.name}</span><span class="tag">${m.duration ? m.duration.toFixed(1) + 's' : ''}${m.loop ? ' ⟳' : ''}</span></div>`).join('')
  $('#expressions').innerHTML = c.expressions.map((e, i) => `<div class="item" data-e="${i}"><span class="nm">${e.name}</span></div>`).join('')
  $('#motions').querySelectorAll('[data-m]').forEach((el) => el.onclick = () => {
    el.parentElement.querySelectorAll('.item').forEach((x) => x.classList.remove('on')); el.classList.add('on')
    playMotion(c.motions[Number(el.dataset.m)], Number(el.dataset.m))
  })
  $('#expressions').querySelectorAll('[data-e]').forEach((el) => el.onclick = () => {
    const e = c.expressions[Number(el.dataset.e)]
    playExpression(e)
    el.classList.toggle('on', state.exprs.some((x) => x.name === e.name))
  })
  renderParams()
  $('#q').oninput = () => {
    const q = $('#q').value.trim().toLowerCase()
    const hit = (s) => !q || s.toLowerCase().includes(q)
    document.querySelectorAll('#motions .item').forEach((el) => { const m = c.motions[Number(el.dataset.m)]; el.style.display = hit(m.name) ? '' : 'none' })
    document.querySelectorAll('#expressions .item').forEach((el) => { const e = c.expressions[Number(el.dataset.e)]; el.style.display = hit(e.name) ? '' : 'none' })
    document.querySelectorAll('#params .item').forEach((el) => { el.style.display = hit(el.dataset.id) || hit(el.dataset.name) ? '' : 'none' })
  }
}

function paramSource() { return state.runtimeParams?.length ? state.runtimeParams : state.caps.params }

function renderParams() {
  const list = paramSource()
  $('#n-param').textContent = list.length
  $('#params').innerHTML = list.map((p, i) =>
    `<div class="item" data-i="${i}" data-id="${p.id}" data-name="${p.name}"><span class="nm">${p.name}</span><span class="tag">${p.id}</span></div>`).join('')
  $('#params').querySelectorAll('[data-i]').forEach((el) => el.onclick = () => {
    el.classList.toggle('on')
    if (el.classList.contains('on')) holdParam(list[Number(el.dataset.i)]); else state.held.delete(el.dataset.id), renderHeld()
  })
}

function holdParam(p) {
  if (p.min == null || p.max == null) { pushLog('warn', `${p.id} 缺范围，无法受控`); return }
  const cur = state.model?.internalModel.coreModel.getParameterValueById(p.id) ?? p.default ?? 0
  state.held.set(p.id, cur)
  renderHeld()
}

function renderHeld() {
  const host = $('#held')
  host.innerHTML = [...state.held.entries()].map(([id, v]) => {
    const p = paramSource().find((x) => x.id === id) || { id, min: -1, max: 1, name: id }
    return `<div class="item"><span class="nm" style="flex:0 0 78px;color:var(--dim)">${p.name}</span>
      <span class="slider"><input type="range" data-id="${id}" min="${p.min}" max="${p.max}" step="${(p.max - p.min) / 200}" value="${v}">
      <span class="val" data-val="${id}">${Number(v).toFixed(2)}</span></span></div>`
  }).join('') || '<div class="meta">点左侧参数加入受控列表</div>'
  host.querySelectorAll('input[type=range]').forEach((el) => el.oninput = () => {
    const v = Number(el.value)
    state.held.set(el.dataset.id, v)
    host.querySelector(`[data-val="${el.dataset.id}"]`).textContent = v.toFixed(2)
    applyHeld()
  })
}

function applyHeld() {
  const cm = state.model?.internalModel.coreModel
  if (!cm) return
  for (const [id, v] of state.held) cm.setParameterValueById(id, v)
}

boot()
