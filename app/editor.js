// 动作编辑器（重写版）：HTML 控件叠在真渲染预览上。
//
// 这一版解决的问题：
//   1. 预览只能 contain 铺满、模型被裁也没法调 → 现在有「大小 / 左右 / 上下」三条滑块，
//      也能直接在预览里拖、滚轮缩放、双击复位，并且能一键写进舞台设置。
//   2. 以前 renderAll 被半路替换、名字输入框是运行时插进去的 → 现在每个区块各渲染各的。
//   3. 拖参数滑块看不到效果 → 现在拖动会立刻在当前时间落一个关键帧并写进模型。
//
// 存储：优先 shell IPC（userData/actions.json），浏览器里回落 localStorage。
// 预览视图（大小/位置）单独存在 localStorage，重开编辑器保持上次的取景。

import { createStage } from '../src/stage/engine.js'
import { createViewport } from '../src/stage/viewport.js'
import { allPresetActions } from '../src/stage/action-presets.js'

const $ = (s) => document.querySelector(s)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const STORE_KEY = 'live2d-editor/actions/v1'
const VIEW_KEY = 'live2d-editor/view/v1'

// 模型里这些参数的名字不直观（「2. 抚胸」「Lean Input」「光2/光4」），
// 给它补一层中文别名，搜索和治疗都用得上 —— 用户按直觉搜「前倾」「换手」就能找到。
const PARAM_ALIAS = {
  Movement1: '狗尾草',
  Movement2: '抚胸 举手',
  Movement3: '竖食指',
  LeanInput: '前倾 后仰 凑近',
  Param50: '前倾权重',
  Param56: '换手A 光2',
  Param57: '换手B 光4',
  Param38: '双手开关',
  Param35: '手臂开关',
  Param25: '右手Z',
  Param59: '大臂透视',
  Param60: '左小臂',
  Param61: '左手腕',
  Param62: '左大臂',
}
const aliasOf = (id) => PARAM_ALIAS[id] || ''
const haystackOf = (p) => `${p.name} ${p.id} ${aliasOf(p.id)}`.toLowerCase()

const S = {
  caps: null,
  stage: null,
  viewport: null,
  actions: [],
  cur: null,
  time: 0,
  playing: false,
  view: { zoom: 1, offsetX: 0, offsetY: 0 },
  clip: null,          // 复制下来的关键帧值
  saveTimer: 0,
  rafId: 0,
  toastTimer: 0,
}

/* ───────────────────────── 小工具 ───────────────────────── */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))

function toast(msg) {
  const el = $('#toast')
  el.textContent = msg
  el.classList.add('on')
  clearTimeout(S.toastTimer)
  S.toastTimer = setTimeout(() => el.classList.remove('on'), 1600)
}

const infoOf = (id) => S.stage?.param?.info(id) ?? { min: -1, max: 1, default: 0 }

/** 某个参数在时间 t 的值：关键帧之间线性插值，两端取端点值 */
function valueAt(action, id, t) {
  if (!action) return null
  const pts = []
  for (const k of action.keys) if (k.values && k.values[id] != null) pts.push([k.t, k.values[id]])
  if (!pts.length) return null
  pts.sort((a, b) => a[0] - b[0])
  if (t <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i += 1) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1]
      const [t1, v1] = pts[i]
      const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
      return v0 + (v1 - v0) * k
    }
  }
  return pts[pts.length - 1][1]
}

const keyAt = (action, t) => action?.keys.find((k) => Math.abs(k.t - t) < 0.5) || null

/** 找到时间 t 的关键帧，没有就建一个（拖动滑块时自动落关键帧） */
function ensureKey(action, t) {
  const hit = keyAt(action, t)
  if (hit) return hit
  const k = { t: Math.round(t), values: {} }
  action.keys.push(k)
  action.keys.sort((a, b) => a.t - b.t)
  return k
}

/* ───────────────────────── 视图（大小 / 位置） ───────────────────────── */

function loadView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null')
    if (v && typeof v === 'object') {
      S.view = {
        zoom: clamp(Number(v.zoom) || 1, 0.3, 3),
        offsetX: clamp(Number(v.offsetX) || 0, -1, 1),
        offsetY: clamp(Number(v.offsetY) || 0, -1, 1),
      }
    }
  } catch { /* 没存过：用默认 */ }
}

function saveView() {
  try { localStorage.setItem(VIEW_KEY, JSON.stringify(S.view)) } catch {}
}

function setView(patch, { silent = false } = {}) {
  Object.assign(S.view, patch)
  S.view.zoom = clamp(S.view.zoom, 0.3, 3)
  S.view.offsetX = clamp(S.view.offsetX, -1, 1)
  S.view.offsetY = clamp(S.view.offsetY, -1, 1)
  S.viewport?.set({ ...S.view })
  renderView()
  saveView()
  if (!silent) hintOnce()
}

function renderView() {
  $('#v-zoom').value = String(S.view.zoom)
  $('#v-x').value = String(S.view.offsetX)
  $('#v-y').value = String(S.view.offsetY)
  $('#v-zoom-out').textContent = `${S.view.zoom.toFixed(2)}×`
  $('#v-x-out').textContent = S.view.offsetX.toFixed(2)
  $('#v-y-out').textContent = S.view.offsetY.toFixed(2)
}

let hintDone = false
function hintOnce() {
  if (hintDone) return
  hintDone = true
  const el = $('#preview-hint')
  el.style.transition = 'opacity .4s'
  el.style.opacity = '0'
}

/* ───────────────────────── 预览 ───────────────────────── */

async function bootPreview() {
  const modelUrl = new URL(S.caps.model.url, location.href).href
  S.stage = await createStage({
    container: $('#preview'),
    modelUrl,
    backgroundAlpha: 0,
    autoStart: true,
  })
  S.viewport = createViewport({ model: S.stage.model, app: S.stage.app })
  S.viewport.observe($('#preview'))

  // 每帧把「当前时间的关键帧值」写进模型。
  // 必须走引擎的 onBeforeUpdate：直接 internalModel.on('beforeModelUpdate') 拿不到内核真正
  // 用的那个发射器（实测写了完全没反应），别改回去。
  //
  // ⚠️ LeanInput / 手臂链这些是**物理输入**：物理算完之后再写，物理已经用旧值算过一遍，
  // 表现就是「前倾调了没反应」。所以两边都要写：物理前写一次让物理按新值算，物理后再写一次
  // 保证画面看到的就是这个值（和舞台的 pose-bus 同一个套路）。
  const writeParams = () => {
    const cur = S.cur
    if (!cur) return
    for (const id of cur.params) {
      const v = valueAt(cur, id, S.time)
      if (v != null) S.stage.param.set(id, v)
    }
  }
  S.stage.onBeforePhysics(writeParams)
  S.stage.onBeforeUpdate(writeParams)

  setView({ ...S.view }, { silent: true })
}

/* ───────────────────────── 动作数据 ───────────────────────── */

function newAction(name = '新动作') {
  return {
    id: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    name,
    trigger: 'manual',
    duration: 1200,
    lines: [],
    params: [],
    keys: [{ t: 0, values: {} }],
  }
}

function loadJSON(data) {
  if (!data || !Array.isArray(data.actions) || !data.actions.length) return false
  S.actions = data.actions.map((a) => ({
    ...a,
    keys: Array.isArray(a.keys) && a.keys.length ? a.keys : [{ t: 0, values: {} }],
    params: Array.isArray(a.params) ? a.params : [],
    lines: Array.isArray(a.lines) ? a.lines.filter((x) => typeof x === 'string' && x.trim()) : [],
    duration: Math.max(100, Number(a.duration) || 1200),
  }))
  return true
}

async function saveAll() {
  const payload = { version: 1, actions: S.actions }
  try { await window.shell?.actionsSave?.(payload) } catch {}
  try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)) } catch {}
}

function scheduleSave() {
  clearTimeout(S.saveTimer)
  S.saveTimer = setTimeout(saveAll, 350)
}

async function bootData() {
  let data = null
  try { data = await window.shell?.actionsLoad?.() } catch {}
  if (!loadJSON(data)) {
    try { data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch {}
    loadJSON(data)
  }
  // 内置姿势 / 待机动作也搬进左栏：第一次打开时补齐，之后它们就是普通动作，可以随便改
  const have = new Set(S.actions.map((a) => a.id))
  let added = 0
  for (const preset of allPresetActions()) {
    if (have.has(preset.id)) continue
    S.actions.push(preset)
    added += 1
  }
  if (added) scheduleSave()
  if (!S.actions.length) S.actions = [newAction('待机招手')]
  S.cur = S.actions[0]
}

/* ───────────────────────── 渲染 ───────────────────────── */

function renderList() {
  const ul = $('#act-list')
  ul.innerHTML = S.actions.map((a) => `
    <li data-id="${esc(a.id)}" class="${a === S.cur ? 'on' : ''}">
      <span>${esc(a.name || '未命名')}</span><small>${Math.round(a.duration)}ms</small>
    </li>`).join('')
}

let fieldsFor = null

function renderFields() {
  const a = S.cur
  if (!a) return
  const nameEl = $('#act-name')
  const durEl = $('#act-dur')
  const linesEl = $('#act-lines')
  // 切到别的动作时强制刷新（输入框可能还端着焦点，否则会显示上一个动作的配字）
  const force = fieldsFor !== a
  fieldsFor = a
  if (force || document.activeElement !== nameEl) nameEl.value = a.name || ''
  if (force || document.activeElement !== durEl) durEl.value = String(Math.round(a.duration))
  if (force || document.activeElement !== linesEl) linesEl.value = (a.lines || []).join('\n')
}

/* 试播台词气泡：播放时随机出一句，跟动作一起看效果 */
function showRandomLine() {
  const el = $('#line-bubble')
  const lines = S.cur?.lines || []
  if (!lines.length) { el.classList.remove('on'); return }
  el.textContent = lines[Math.floor(Math.random() * lines.length)]
  el.classList.add('on')
}
function hideLine() {
  $('#line-bubble').classList.remove('on')
}

function renderTimeline() {
  const a = S.cur
  if (!a) return
  const dur = Math.max(100, Math.round(a.duration))
  S.time = clamp(S.time, 0, dur)
  $('#time').max = String(dur)
  $('#time').value = String(S.time)
  $('#time-readout').textContent = `${Math.round(S.time)} / ${dur} ms`
  $('#keys').innerHTML = a.keys
    .slice()
    .sort((x, y) => x.t - y.t)
    .map((k) => `<button data-t="${k.t}" class="${Math.abs(k.t - S.time) < 1 ? 'on' : ''}">${k.t}ms</button>`)
    .join('')
  const hasKey = Math.abs((keyAt(a, S.time)?.t ?? -999) - S.time) < 1
  const tag = $('#key-state')
  tag.textContent = hasKey ? '当前是关键帧' : '当前不是关键帧（拖参数会自动建）'
  tag.classList.toggle('on', hasKey)
}

function renderParams() {
  const q = ($('#param-search').value || '').trim().toLowerCase()
  const all = S.caps?.params || []
  // 搜索也认中文别名：「前倾」能找到 LeanInput、「换手」能找到 Param56/57
  const list = all.filter((p) => !q || haystackOf(p).includes(q))
  const used = new Set(S.cur?.params || [])
  $('#param-count').textContent = q ? `${list.length}/${all.length}` : `${all.length} 个`
  $('#param-list').innerHTML = list.slice(0, 500).map((p) => {
    const alias = aliasOf(p.id)
    return `
    <li data-id="${esc(p.id)}" class="${used.has(p.id) ? 'on' : ''}">
      <span>${esc(p.name)}${alias ? `<em>${esc(alias)}</em>` : ''}</span><small>${esc(p.id)}</small>
    </li>`
  }).join('')
  renderActiveParams()
}

function renderActiveParams() {
  const box = $('#param-active')
  const cur = S.cur
  const ids = cur?.params || []
  if (!ids.length) {
    box.innerHTML = '<div class="empty">还没有参数：在下面列表点一个</div>'
    return
  }
  box.innerHTML = ids.map((id) => {
    const info = infoOf(id)
    const v = valueAt(cur, id, S.time) ?? info.default ?? 0
    const def = S.caps?.params.find((p) => p.id === id)
    const name = def?.name || id
    const alias = aliasOf(id)
    const step = (info.max - info.min) / 1000 || 0.001
    return `<div class="pa" data-id="${esc(id)}">
      <div class="top">
        <b title="${esc(id)}">${esc(name)}${alias ? `<em>${esc(alias)}</em>` : ''}<small>${esc(id)}</small></b>
        <i>${Number(v).toFixed(3)}</i>
      </div>
      <div class="bar">
        <input type="range" min="${info.min}" max="${info.max}" step="${step}" value="${v}">
        <button data-del="${esc(id)}" title="从本动作移除这个参数">×</button>
      </div>
    </div>`
  }).join('')
}

function renderAll() {
  renderList()
  renderFields()
  renderTimeline()
  renderParams()
  renderView()
}

/* ───────────────────────── 播放 ───────────────────────── */

function tick(now) {
  if (!S.playing || !S.cur) return
  const dt = tick.last ? now - tick.last : 16
  tick.last = now
  S.time += dt
  const dur = Math.max(100, Math.round(S.cur.duration))
  if (S.time > dur) { S.time = 0; showRandomLine() }
  $('#time').value = String(S.time)
  $('#time-readout').textContent = `${Math.round(S.time)} / ${dur} ms`
  const hasKey = Math.abs((keyAt(S.cur, S.time)?.t ?? -999) - S.time) < 1
  if (hasKey) renderTimeline()
  S.rafId = requestAnimationFrame(tick)
}

function setPlaying(on) {
  S.playing = !!on
  $('#play').textContent = S.playing ? '⏸ 暂停' : '▶ 播放'
  if (S.playing) {
    tick.last = 0
    showRandomLine()
    S.rafId = requestAnimationFrame(tick)
  } else {
    cancelAnimationFrame(S.rafId)
    hideLine()
    renderTimeline()
    renderActiveParams()
  }
}

/* ───────────────────────── 事件绑定 ───────────────────────── */

function bindView() {
  const apply = (patch, extra = {}) => {
    setView(patch, extra)
    // 正在拖动参数滑块时不要重渲染右栏（会打断输入焦点）
    if (S.playing) return
    renderActiveParams()
  }
  $('#v-zoom').oninput = (e) => apply({ zoom: Number(e.target.value) })
  $('#v-x').oninput = (e) => apply({ offsetX: Number(e.target.value) })
  $('#v-y').oninput = (e) => apply({ offsetY: Number(e.target.value) })
  $('#v-reset').onclick = () => {
    apply({ zoom: 1, offsetX: 0, offsetY: 0 })
    toast('预览已复位')
  }

  // 预览里拖动 → 移动模型；滚轮 → 缩放；双击 → 复位
  const wrap = $('#preview')
  let drag = null
  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const rect = wrap.getBoundingClientRect()
    drag = { x: e.clientX, y: e.clientY, ox: S.view.offsetX, oy: S.view.offsetY, w: rect.width || 1, h: rect.height || 1 }
    wrap.classList.add('dragging')
    wrap.setPointerCapture?.(e.pointerId)
    hintOnce()
  })
  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return
    const dx = (e.clientX - drag.x) / drag.w * 2
    const dy = (e.clientY - drag.y) / drag.h * 2
    setView({ offsetX: drag.ox + dx, offsetY: drag.oy + dy }, { silent: true })
  })
  const endDrag = (e) => {
    if (!drag) return
    drag = null
    wrap.classList.remove('dragging')
    try { wrap.releasePointerCapture?.(e.pointerId) } catch {}
    renderActiveParams()
  }
  wrap.addEventListener('pointerup', endDrag)
  wrap.addEventListener('pointercancel', endDrag)
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault()
    const k = Math.exp(-e.deltaY * 0.0012)
    setView({ zoom: S.view.zoom * k }, { silent: true })
  }, { passive: false })
  wrap.addEventListener('dblclick', () => {
    setView({ zoom: 1, offsetX: 0, offsetY: 0 })
    toast('已复位')
  })
}

function bindUi() {
  // ---- 左栏：动作 ----
  $('#act-list').onclick = (e) => {
    const li = e.target.closest('li')
    if (!li) return
    const a = S.actions.find((x) => x.id === li.dataset.id)
    if (!a || a === S.cur) return
    S.cur = a
    S.time = 0
    setPlaying(false)
    renderAll()
  }
  $('#act-name').oninput = (e) => {
    if (!S.cur) return
    S.cur.name = e.target.value
    scheduleSave()
    renderList()
  }
  $('#act-dur').onchange = (e) => {
    if (!S.cur) return
    S.cur.duration = Math.max(100, Math.round(Number(e.target.value) || 1200))
    scheduleSave()
    renderTimeline()
  }
  // 配字：一行一句，播放时随机抽一句显示在预览气泡里
  $('#act-lines').oninput = (e) => {
    if (!S.cur) return
    S.cur.lines = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)
    scheduleSave()
  }
  $('#act-new').onclick = () => {
    const a = newAction(`动作 ${S.actions.length + 1}`)
    S.actions.push(a)
    S.cur = a
    S.time = 0
    setPlaying(false)
    scheduleSave()
    renderAll()
  }
  $('#act-dup').onclick = () => {
    if (!S.cur) return
    const a = JSON.parse(JSON.stringify(S.cur))
    a.id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
    a.name = `${S.cur.name} 副本`
    S.actions.push(a)
    S.cur = a
    scheduleSave()
    renderAll()
  }
  $('#act-del').onclick = () => {
    if (S.actions.length <= 1) { toast('至少留一个动作'); return }
    S.actions = S.actions.filter((a) => a !== S.cur)
    S.cur = S.actions[0]
    S.time = 0
    scheduleSave()
    renderAll()
  }
  $('#act-save').onclick = async () => {
    clearTimeout(S.saveTimer)
    await saveAll()
    toast(`已保存：${S.actions.length} 个动作`)
  }
  $('#act-export').onclick = () => {
    const blob = new Blob([JSON.stringify({ version: 1, actions: S.actions }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'live2d-actions.json'
    a.click()
    URL.revokeObjectURL(a.href)
    toast('已导出 live2d-actions.json')
  }
  $('#act-import').onchange = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const data = JSON.parse(await f.text())
      if (!loadJSON(data)) { toast('这个 JSON 里没有 actions 数组'); return }
      S.cur = S.actions[0]
      S.time = 0
      await saveAll()
      renderAll()
      toast(`导入成功：${S.actions.length} 个动作`)
    } catch { toast('JSON 读不了') }
    e.target.value = ''
  }

  // ---- 时间轴 ----
  $('#play').onclick = () => setPlaying(!S.playing)
  $('#time').oninput = (e) => {
    S.time = Number(e.target.value) || 0
    setPlaying(false)
    renderTimeline()
    renderActiveParams()
  }
  $('#keys').onclick = (e) => {
    const b = e.target.closest('button')
    if (!b) return
    S.time = Number(b.dataset.t) || 0
    setPlaying(false)
    renderTimeline()
    renderActiveParams()
  }
  $('#add-key').onclick = () => {
    if (!S.cur) return
    const k = ensureKey(S.cur, S.time)
    for (const id of S.cur.params) {
      if (k.values[id] == null) k.values[id] = valueAt(S.cur, id, S.time) ?? infoOf(id).default ?? 0
    }
    scheduleSave()
    renderTimeline()
    toast(`已在 ${Math.round(S.time)}ms 建关键帧`)
  }
  $('#del-key').onclick = () => {
    if (!S.cur) return
    const before = S.cur.keys.length
    S.cur.keys = S.cur.keys.filter((k) => Math.abs(k.t - S.time) > 0.5)
    if (!S.cur.keys.length) S.cur.keys = [{ t: 0, values: {} }]
    if (S.cur.keys.length === before) { toast('这个时间点没有关键帧'); return }
    scheduleSave()
    renderTimeline()
    renderActiveParams()
    toast('已删除关键帧')
  }

  // ---- 关键帧复制 / 粘贴（做循环动作不用一个个拖滑块）----
  const snapshotValues = (a, t) => {
    const out = {}
    for (const id of a.params) { const v = valueAt(a, id, t); if (v != null) out[id] = v }
    return out
  }
  $('#copy-key').onclick = () => {
    if (!S.cur) return
    const k = keyAt(S.cur, S.time)
    S.clip = k ? { ...k.values } : snapshotValues(S.cur, S.time)
    const n = Object.keys(S.clip || {}).length
    toast(n ? `已复制 ${Math.round(S.time)}ms 的 ${n} 个参数` : '这一帧没有可复制的值')
  }
  $('#paste-key').onclick = () => {
    if (!S.cur || !S.clip) { toast('先复制一帧再粘贴'); return }
    const k = ensureKey(S.cur, S.time)
    for (const [id, v] of Object.entries(S.clip)) {
      if (!S.cur.params.includes(id)) S.cur.params.push(id)
      k.values[id] = v
    }
    scheduleSave()
    renderAll()
    toast(`已粘贴到 ${Math.round(S.time)}ms`)
  }

  $('#param-search').oninput = () => renderParams()
  $('#param-list').onclick = (e) => {
    const li = e.target.closest('li')
    if (!li || !S.cur) return
    const id = li.dataset.id
    if (S.cur.params.includes(id)) {
      S.cur.params = S.cur.params.filter((x) => x !== id)
      for (const k of S.cur.keys) delete k.values[id]
    } else {
      S.cur.params.push(id)
      // 立刻在当前时间落一个值，避免加进来是空的
      const k = ensureKey(S.cur, S.time)
      if (k.values[id] == null) k.values[id] = infoOf(id).default ?? 0
    }
    scheduleSave()
    renderAll()
  }
  $('#param-active').oninput = (e) => {
    if (e.target.type !== 'range' || !S.cur) return
    const wrap = e.target.closest('.pa')
    if (!wrap) return
    const id = wrap.dataset.id
    const val = Number(e.target.value)
    // 拖动 = 当前时间的关键帧值；没有就自动建，所见即所得
    const k = ensureKey(S.cur, S.time)
    k.values[id] = val
    wrap.querySelector('i').textContent = val.toFixed(3)
    try { S.stage.param.set(id, val) } catch {}
    scheduleSave()
    if (!keyAt(S.cur, S.time)) renderTimeline()
  }
  $('#param-active').onclick = (e) => {
    const b = e.target.closest('button[data-del]')
    if (!b || !S.cur) return
    const id = b.dataset.del
    S.cur.params = S.cur.params.filter((x) => x !== id)
    for (const k of S.cur.keys) delete k.values[id]
    scheduleSave()
    renderAll()
  }

  // ---- 快捷键 ----
  window.addEventListener('keydown', (e) => {
    const el = e.target
    const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
    if (typing) return
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!S.playing) }
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); $('#del-key').click() }
    if (e.code === 'KeyK') { e.preventDefault(); $('#add-key').click() }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') { e.preventDefault(); $('#copy-key').click() }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') { e.preventDefault(); $('#paste-key').click() }
  })
}

/* ───────────────────────── 启动 ───────────────────────── */

async function main() {
  S.caps = await fetch('/api/capabilities').then((r) => r.json())
  loadView()
  await bootData()
  await bootPreview()
  bindView()
  bindUi()
  renderAll()
}

main().catch((e) => {
  document.body.innerHTML = `<pre style="padding:16px;color:#f88">编辑器启动失败：${esc(e.message)}\n\n${esc(e.stack || '')}</pre>`
  console.error(e)
})

// 开发期探针（无头验证用）
window.__editor = {
  get stage() { return S.stage },
  get cur() { return S.cur },
  get time() { return S.time },
  get view() { return { ...S.view } },
  setTime(t) { S.time = Number(t) || 0; renderTimeline(); renderActiveParams() },
  setView(patch) { setView(patch) },
  valueAt: (id, t) => valueAt(S.cur, id, t ?? S.time),
  readAtUpdate(id) {
    return new Promise((resolve) => {
      const off = S.stage.onBeforeUpdate(() => { off?.(); resolve(S.stage.param.get(id)) })
    })
  },
}
