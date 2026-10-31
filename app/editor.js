// 动作编辑器：在独立的页面里「摆一个终点 / 几个关键帧」，预览用真渲染，存成 JSON。
//
// 为什么单独开页面：舞台窗口只有角色那么大，塞不下参数列表和时间轴；
// 而且编辑时应该看到干净的预览，不该被气泡/面板挡着。
//
// 存储：优先走壳层 IPC 存 userData/actions.json；在普通浏览器里打开时回落到 localStorage。

import { createStage } from '../src/stage/engine.js'
import { createViewport } from '../src/stage/viewport.js'

const $ = (s) => document.querySelector(s)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const STORE_KEY = 'live2d-editor/actions/v1'

let caps = null
let stage = null
let viewport = null
let actions = []
let cur = null
let time = 0
let playing = false
let rafId = 0
let saveTimer = 0

// ---------- 参数值工具 ----------
const infoOf = (id) => stage?.param?.info(id) ?? { min: -1, max: 1, default: 0 }

function valueAt(action, id, t) {
  const pts = []
  for (const k of action.keys) if (k.values && k.values[id] != null) pts.push([k.t, k.values[id]])
  if (!pts.length) return null
  pts.sort((a, b) => a[0] - b[0])
  if (t <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) {
      const [t0, v0] = pts[i - 1]
      const [t1, v1] = pts[i]
      const k = t1 === t0 ? 0 : (t - t0) / (t1 - t0)
      return v0 + (v1 - v0) * k
    }
  }
  return pts[pts.length - 1][1]
}

function keyAt(action, t) {
  return action.keys.find((k) => Math.abs(k.t - t) < 0.5) || null
}

function ensureKey(action, t) {
  let k = keyAt(action, t)
  if (k) return k
  k = { t: Math.round(t), values: {} }
  action.keys.push(k)
  action.keys.sort((a, b) => a.t - b.t)
  return k
}

// ---------- 舞台预览 ----------
async function bootPreview() {
  const modelUrl = new URL(caps.model.url, location.href).href
  stage = await createStage({
    container: $('#preview'),
    modelUrl,
    backgroundAlpha: 0,
    autoStart: true,
  })
  // 每帧把「当前时间的关键帧值」写进模型。
  // 必须走引擎的 onBeforeUpdate：直接 internalModel.on('beforeModelUpdate') 拿不到内核真正
  // 用的那个发射器（实测写了完全没反应），别改回去。
  stage.onBeforeUpdate(() => {
    if (!cur) return
    for (const id of cur.params) {
      const v = valueAt(cur, id, time)
      if (v != null) stage.param.set(id, v)
    }
  })
  // 预览按 contain 铺满容器（和舞台同一套视口逻辑，位置/缩放不会各写一套）
  viewport = createViewport({ model: stage.model, app: stage.app })
  viewport.observe($('#preview'))
}

// ---------- 动作数据 ----------
function newAction(name = '新动作') {
  return {
    id: `a${Date.now().toString(36)}`,
    name,
    trigger: 'manual',
    duration: 1200,
    params: [],
    keys: [{ t: 0, values: {} }],
  }
}

function loadJSON(data) {
  if (!data || !Array.isArray(data.actions)) return false
  actions = data.actions
  return true
}

async function saveAll() {
  const payload = { version: 1, actions }
  try { await window.shell?.actionsSave?.(payload) } catch {}
  try { localStorage.setItem(STORE_KEY, JSON.stringify(payload)) } catch {}
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveAll, 400)
}

async function bootData() {
  let data = null
  try { data = await window.shell?.actionsLoad?.() } catch {}
  if (!loadJSON(data)) {
    try { data = JSON.parse(localStorage.getItem(STORE_KEY) || 'null') } catch {}
    loadJSON(data)
  }
  if (!actions.length) actions = [newAction('待机招手')]
  cur = actions[0]
}

// ---------- 渲染 ----------
function renderActions() {
  const ul = $('#act-list')
  ul.innerHTML = actions.map((a) => `
    <li data-id="${a.id}" class="${a === cur ? 'on' : ''}">
      <span>${esc(a.name)}</span><small>${a.duration}ms</small>
    </li>`).join('')
  ul.onclick = (e) => {
    const li = e.target.closest('li')
    if (!li) return
    const a = actions.find((x) => x.id === li.dataset.id)
    if (!a) return
    cur = a
    time = 0
    playing = false
    renderAll()
  }
}

function renderTimeline() {
  const dur = Math.max(100, Math.round(cur.duration))
  $('#time').max = dur
  $('#time').value = Math.min(time, dur)
  $('#time-readout').textContent = `${Math.round(time)} / ${dur} ms`
  $('#keys').innerHTML = cur.keys.map((k) => `
    <button data-t="${k.t}" class="${Math.abs(k.t - time) < 1 ? 'on' : ''}">${k.t}ms</button>`).join('')
  $('#keys').onclick = (e) => {
    const b = e.target.closest('button')
    if (!b) return
    time = Number(b.dataset.t)
    playing = false
    renderAll()
  }
}

function renderParams() {
  // 右侧完整参数表
  const q = $('#param-search').value.trim().toLowerCase()
  const list = (caps.params || []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q))
  const used = new Set(cur.params)
  $('#param-list').innerHTML = list.slice(0, 400).map((p) => `
    <li data-id="${p.id}" class="${used.has(p.id) ? 'on' : ''}"><span>${esc(p.name)}</span><small>${esc(p.id)}</small></li>`).join('')
  $('#param-list').onclick = (e) => {
    const li = e.target.closest('li')
    if (!li) return
    const id = li.dataset.id
    if (cur.params.includes(id)) cur.params = cur.params.filter((x) => x !== id)
    else cur.params.push(id)
    scheduleSave()
    renderParams()
    renderActiveParams()
  }

  // 已选参数：每行一个滑块（改的是当前关键帧）
  renderActiveParams()
}

function renderActiveParams() {
  const box = $('#param-active')
  box.innerHTML = cur.params.map((id) => {
    const info = infoOf(id)
    const v = valueAt(cur, id, time) ?? info.default ?? 0
    const name = caps.params.find((p) => p.id === id)?.name || id
    return `<div class="pa" data-id="${id}">
      <div class="top"><b title="${esc(id)}">${esc(name)}</b><i>${Number(v).toFixed(3)}</i></div>
      <div class="bar">
        <input type="range" min="${info.min}" max="${info.max}" step="${(info.max - info.min) / 1000}" value="${v}">
        <button data-del="${id}">×</button>
      </div>
    </div>`
  }).join('')
  box.oninput = (e) => {
    const wrap = e.target.closest('.pa')
    if (!wrap || e.target.type !== 'range') return
    const id = wrap.dataset.id
    const val = Number(e.target.value)
    const k = ensureKey(cur, time)
    k.values[id] = val
    wrap.querySelector('i').textContent = val.toFixed(3)
    scheduleSave()
  }
  box.onclick = (e) => {
    const b = e.target.closest('button[data-del]')
    if (!b) return
    const id = b.dataset.del
    cur.params = cur.params.filter((x) => x !== id)
    for (const k of cur.keys) delete k.values[id]
    scheduleSave()
    renderParams()
  }
}

function renderAll() {
  renderActions()
  renderTimeline()
  renderParams()
  if (cur) {
    const dur = Math.max(100, Math.round(cur.duration))
    $('#time').max = dur
  }
}

// ---------- 播放 ----------
function tick(now) {
  if (!playing) return
  const dt = tick.last ? now - tick.last : 16
  tick.last = now
  time += dt
  if (time > cur.duration) time = 0
  $('#time').value = time
  $('#time-readout').textContent = `${Math.round(time)} / ${Math.round(cur.duration)} ms`
  rafId = requestAnimationFrame(tick)
}

function setPlaying(on) {
  playing = !!on
  $('#play').textContent = playing ? '⏸ 暂停' : '▶ 播放'
  if (playing) { tick.last = 0; rafId = requestAnimationFrame(tick) }
  else cancelAnimationFrame(rafId)
}

// ---------- 事件 ----------
function bindUi() {
  $('#play').onclick = () => setPlaying(!playing)
  $('#time').oninput = (e) => { time = Number(e.target.value); playing = false; renderTimeline(); }
  $('#add-key').onclick = () => {
    const k = ensureKey(cur, time)
    for (const id of cur.params) {
      if (k.values[id] == null) k.values[id] = valueAt(cur, id, time) ?? infoOf(id).default ?? 0
    }
    scheduleSave()
    renderTimeline()
  }
  $('#del-key').onclick = () => {
    cur.keys = cur.keys.filter((k) => Math.abs(k.t - time) > 0.5 || cur.keys.length <= 1)
    scheduleSave()
    renderTimeline()
  }
  $('#param-search').oninput = () => renderParams()

  $('#act-new').onclick = () => {
    const a = newAction(`动作 ${actions.length + 1}`)
    actions.push(a)
    cur = a
    time = 0
    scheduleSave()
    renderAll()
  }
  $('#act-dup').onclick = () => {
    const a = JSON.parse(JSON.stringify(cur))
    a.id = `a${Date.now().toString(36)}`
    a.name += ' 副本'
    actions.push(a)
    cur = a
    scheduleSave()
    renderAll()
  }
  $('#act-del').onclick = () => {
    if (actions.length <= 1) return
    actions = actions.filter((a) => a !== cur)
    cur = actions[0]
    scheduleSave()
    renderAll()
  }
  // 动作名 / 时长
  const nameRow = document.createElement('div')
  nameRow.className = 'row'
  nameRow.innerHTML = `<input id="act-name" placeholder="动作名"><input id="act-dur" type="number" min="100" step="50" title="时长 ms">`
  $('#left').insertBefore(nameRow, $('#act-list'))
  const syncName = () => {
    $('#act-name').value = cur.name
    $('#act-dur').value = cur.duration
  }
  const _renderAll = renderAll
  renderAll = () => {
    _renderAll()
    if ($('#act-name')) syncName()
  }
  $('#act-name').oninput = (e) => { cur.name = e.target.value; scheduleSave(); renderActions() }
  $('#act-dur').onchange = (e) => { cur.duration = Math.max(100, Number(e.target.value) || 1200); scheduleSave(); renderTimeline() }

  $('#act-export').onclick = () => {
    const blob = new Blob([JSON.stringify({ version: 1, actions }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'live2d-actions.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  $('#act-import').onchange = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    try {
      const data = JSON.parse(await f.text())
      if (loadJSON(data)) {
        cur = actions[0]
        scheduleSave()
        renderAll()
      }
    } catch { alert('JSON 读不了') }
  }
}

// ---------- 启动 ----------
async function main() {
  caps = await fetch('/api/capabilities').then((r) => r.json())
  await bootData()
  await bootPreview()
  bindUi()
  renderAll()
}

main().catch((e) => {
  document.body.innerHTML = `<pre style="padding:16px;color:#f88">编辑器启动失败：${esc(e.message)}</pre>`
  console.error(e)
})

// 开发期探针（无头验证用）：看当前动作、时间、以及某一帧真正写进模型的值
window.__editor = {
  get stage() { return stage },
  get cur() { return cur },
  get time() { return time },
  setTime(t) { time = t },
  valueAt: (id, t) => valueAt(cur, id, t ?? time),
  /** 在 update 之前那一刻读参数（事后读会被 loadParameters 还原，不可信） */
  readAtUpdate(id) {
    return new Promise((resolve) => {
      const off = stage.onBeforeUpdate(() => { off?.(); resolve(stage.param.get(id)) })
    })
  },
}
