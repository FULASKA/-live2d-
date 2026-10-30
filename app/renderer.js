// Live2D Stage —— 应用渲染层（透明窗口里的角色）。
// 只做「角色 + 互动 + 设置」，验证台的调试面板不在这里。
import { createStage } from '../src/stage/engine.js'
import { createLayerStack } from '../src/stage/layers.js'
import { createViewport } from '../src/stage/viewport.js'
import { createGaze } from '../src/stage/gaze.js'
import { createRegionStore, createRegionInput, seedRegions } from '../src/stage/regions.js'
import { createReactions, DEFAULT_REACTIONS } from '../src/stage/reactions.js'
import { createPetSway } from '../src/stage/pet-sway.js'

const $ = (s) => document.querySelector(s)
const TOGGLE_SET = new Set(['胸口衣服', '裙子切换', '脱鞋', '尾巴开关'])

/** 浏览器里打开 /app/ 时没有 Electron 预加载：给一套空壳，方便无头验证渲染 */
const shell = window.shell || {
  get: async () => ({ width: 520, height: 760, zoom: 1, gaze: true, strength: 1, alwaysOnTop: false, clickThrough: false }),
  set: async (patch) => patch,
  moveBy: () => {},
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
  mask: null, maskAt: 0, ignoring: false, pointerDown: false,
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

async function main() {
  try {
    state.settings = await shell.get()
    state.caps = await fetch('/api/capabilities').then((r) => r.json())
    await bootStage()
    bootRegions()
    bindPanel()
    bindWindowDrag()
    bindResizeHandles()
    bindReactionEditor()
    bindPassThrough()
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
  stage.onBeforePhysics(() => state.layers.applyPhysics())

  state.reactions = createReactions({
    layers: state.layers,
    expressionDefs: state.caps.expressions,
    onEvent: (e) => { if (e.type === 'warn') console.warn('[reaction]', e.text) },
  })

  state.gaze = createGaze({
    param: stage.param,
    options: { enabled: state.settings.gaze !== false, strength: Number(state.settings.strength ?? 1) },
  })

  // 抚摸晃动：蹭头时额外叠一层摆动（gaze 先定方向，这层再叠幅度）
  state.petSway = createPetSway({
    param: stage.param,
    options: { gain: Number(state.settings.petGain ?? 1.6) },
  })

  let lastT = performance.now()
  stage.onBeforeUpdate(() => {
    const now = performance.now()
    const dt = Math.min(120, Math.max(1, now - lastT))
    lastT = now
    state.gaze.apply(dt)
    state.layers.apply()
    state.petSway.apply(dt)
  })

  const viewport = createViewport({ model: stage.model, app: stage.app })
  state.viewport = viewport
  viewport.observe($('#stage'))
  viewport.set({ zoom: Number(state.settings.zoom) || 1 })

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
  })
  // 桌面级跟随：主进程持续读全局光标位置，窗口外也能看过去
  shell.onCursor?.((p) => lookFromClient(p.x, p.y))
}

function bootRegions() {
  const key = state.caps.model.name
  state.store = createRegionStore([])
  const loaded = state.store.load(key)
  const bands = ['头', '胸', '腰', '裙摆', '腿', '脚', '尾巴']
  const missing = loaded ? bands.filter((n) => !state.store.all.some((r) => r.name === n)) : bands
  if (!loaded || missing.length) {
    const seeded = seedRegions({
      core: state.stage.core,
      internalModel: state.stage.model.internalModel,
      displayNames: { get: (i) => { try { return state.caps.parts.find((p) => p.id === state.stage.core.getPartId(i).getString().s)?.name || '' } catch { return '' } } },
      canvas: state.stage.modelSize(),
    })
    for (const r of state.store.all.slice()) state.store.remove(r.id)
    for (const r of seeded) state.store.add({ ...r, reaction: DEFAULT_REACTIONS[r.name] || {} })
    state.store.save(key)
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
      if (ev.type === 'tap' && ev.region) state.reactions.apply(ev.region, 'tap')
      if (ev.type === 'pet' && ev.region) {
        // 反应只在第一步触发（否则每组会反复重建）；晃动每一步都续，才是「跟着滑动在晃」
        if (ev.step === 1) state.reactions.apply(ev.region, 'pet')
        state.petSway?.trigger(ev.region.name)
      }
    },
  })
  state.regionInput.attach($('#stage'))
}

/** 通用「按住拖动 = 搬窗口」绑定 */
function dragWindow(el, { canStart, ignore } = {}) {
  let dragging = false
  let lastX = 0
  let lastY = 0
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    if (ignore?.(e)) return
    if (canStart && !canStart(e)) return
    dragging = true
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

function refreshMask(force = false) {
  const now = performance.now()
  if (!force && state.mask && now - state.maskAt < 700) return state.mask
  const m = state.stage?.alphaMask?.(MASK_SCALE)
  if (m) { state.mask = m; state.maskAt = now }
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
  const apply = () => {
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
  // 验证钩子（和 harness 里的 __reaction 一样，只为无头检查）
  window.__layout = () => ({
    win: [window.innerWidth, window.innerHeight],
    offsetX: state.viewport?.view.offsetX ?? null,
    model: state.stage ? [Math.round(state.stage.model.position.x), Math.round(state.stage.model.position.y)] : null,
    gaze: state.gaze?.state?.().target ?? null,
    gazeLast: window.__gazeLast || null,
    sway: state.petSway?.state?.() ?? null,
    angles: state.stage ? ['ParamAngleX', 'ParamAngleY', 'ParamAngleZ'].map((id) => Math.round(state.stage.param.get(id) * 10) / 10) : null,
  })
  window.__pass = {
    bodyAt,
    refreshMask,
    sway: (name) => state.petSway?.trigger(name),
    charRight: () => Math.round(charRightClient()),
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
  // 角色铺满窗口后，角色身上几乎处处是热区：空白处拖动 + ✥ 手柄 + 面板标题栏，三条路都能搬
  dragWindow(stage, { canStart: (e) => !state.regionInput?.pressed?.region && bodyAt(e.clientX, e.clientY) })
  dragWindow($('#tool-move'))
  stage.addEventListener('pointerdown', () => hideTools())
}

// ---------- 右键工具条（✥ 搬窗口 / ⚙ 设置 / × 收起） ----------
function showTools(x, y) {
  const t = $('#tools')
  t.classList.remove('hidden')
  const r = t.getBoundingClientRect()
  const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8)
  const top = Math.min(Math.max(8, y - r.height - 14), window.innerHeight - r.height - 8)
  t.style.left = `${Math.round(left)}px`
  t.style.top = `${Math.round(top)}px`
}
function hideTools() { $('#tools').classList.add('hidden') }

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
    showTools(e.clientX, e.clientY)
  })
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    show(false)
    hideTools()
  })
  $('#panel-close').onclick = () => show(false)
  $('#tool-settings').onclick = () => { hideTools(); show(true) }
  $('#tool-hide').onclick = () => hideTools()

  const s = state.settings
  syncSizeReadout()
  $('#zoom').value = Number(s.zoom) || 1
  $('#gaze').checked = s.gaze !== false
  $('#strength').value = Number(s.strength ?? 1)
  $('#top').checked = !!s.alwaysOnTop
  $('#click-through').checked = !!s.clickThrough

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
