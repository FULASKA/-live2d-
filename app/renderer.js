// Live2D Stage —— 应用渲染层（透明窗口里的角色）。
// 只做「角色 + 互动 + 设置」，验证台的调试面板不在这里。
import { createStage } from '../src/stage/engine.js'
import { createLayerStack } from '../src/stage/layers.js'
import { createViewport } from '../src/stage/viewport.js'
import { createGaze } from '../src/stage/gaze.js'
import { createRegionStore, createRegionInput, seedRegions } from '../src/stage/regions.js'
import { createReactions, DEFAULT_REACTIONS } from '../src/stage/reactions.js'

const $ = (s) => document.querySelector(s)
const TOGGLE_SET = new Set(['胸口衣服', '裙子切换', '脱鞋', '尾巴开关'])

/** 浏览器里打开 /app/ 时没有 Electron 预加载：给一套空壳，方便无头验证渲染 */
const shell = window.shell || {
  get: async () => ({ width: 520, height: 760, zoom: 1, gaze: true, strength: 1, alwaysOnTop: false, clickThrough: false }),
  set: async (patch) => patch,
  moveBy: () => {},
  setPassThrough: () => {},
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

  let lastT = performance.now()
  stage.onBeforeUpdate(() => {
    const now = performance.now()
    const dt = Math.min(120, Math.max(1, now - lastT))
    lastT = now
    state.gaze.apply(dt)
    state.layers.apply()
  })

  const viewport = createViewport({ model: stage.model, app: stage.app })
  state.viewport = viewport
  viewport.observe($('#stage'))
  viewport.set({ zoom: Number(state.settings.zoom) || 1 })

  window.addEventListener('pointermove', (e) => {
    const r = stage.canvas.getBoundingClientRect()
    const sw = stage.app.screen.width, sh = stage.app.screen.height
    const sx = ((e.clientX - r.left) / r.width) * sw
    const sy = ((e.clientY - r.top) / r.height) * sh
    const m = stage.model
    state.gaze.setTargetFromScreen(sx, sy, m.position.x, m.position.y, sw / 2, sh / 2)
  })
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
      if (ev.type === 'pet' && ev.region && ev.step === 1) state.reactions.apply(ev.region, 'pet')
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

/** 指针在面板/工具条这类 HTML 控件上时一律算「要接收」，否则设置面板会点不动 */
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
    if (!pending || !state.settings || state.settings.clickThrough) return
    const want = !state.pointerDown && !overUi(pending.x, pending.y) && !bodyAt(pending.x, pending.y)
    if (want === state.ignoring) return
    state.ignoring = want
    shell.setPassThrough(want)
  }
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
  window.__pass = {
    bodyAt,
    refreshMask,
    mask: () => state.mask && { w: state.mask.w, h: state.mask.h, coverage: +state.mask.coverage.toFixed(4) },
    state: () => ({ ignoring: state.ignoring, clickThrough: state.settings?.clickThrough, pointerDown: state.pointerDown }),
  }
}

function bindWindowDrag() {
  const stage = $('#stage')
  // 角色铺满窗口后，角色身上几乎处处是热区：空白处拖动 + ✥ 手柄 + 面板标题栏，三条路都能搬
  dragWindow(stage, { canStart: (e) => !state.regionInput?.pressed?.region && bodyAt(e.clientX, e.clientY) })
  dragWindow($('#tool-move'))
  dragWindow($('#panel-head'), { ignore: (e) => !!e.target.closest('.close') })
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

function bindPanel() {
  const panel = $('#panel')
  const show = (on) => panel.classList.toggle('hidden', on === undefined ? !panel.classList.contains('hidden') : !on)

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
  $('#win-w').value = Math.round(s.width)
  $('#win-h').value = Math.round(s.height)
  $('#zoom').value = Number(s.zoom) || 1
  $('#gaze').checked = s.gaze !== false
  $('#strength').value = Number(s.strength ?? 1)
  $('#top').checked = !!s.alwaysOnTop
  $('#click-through').checked = !!s.clickThrough

  $('#win-apply').onclick = async () => {
    const width = Math.max(200, Math.min(2400, Number($('#win-w').value) || 520))
    const height = Math.max(200, Math.min(1600, Number($('#win-h').value) || 760))
    state.settings = await shell.set({ width, height })
    toast(`窗口 ${width}×${height}`)
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
    shell.set({ strength })
  }
  $('#top').onchange = (e) => shell.set({ alwaysOnTop: e.target.checked })
  $('#click-through').onchange = (e) => {
    shell.set({ clickThrough: e.target.checked })
    if (e.target.checked) toast('穿透已开：Ctrl+Alt+L 找回', 4000)
  }
  shell.onClickThrough((v) => {
    $('#click-through').checked = v
    toast(v ? '穿透已开：Ctrl+Alt+L 找回' : '穿透已关', 2600)
  })
  $('#open-harness').onclick = () => shell.openHarness()
  $('#quit').onclick = () => shell.quit()
}

main()
