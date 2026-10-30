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
  center: () => {},
  quit: () => {},
  devtools: () => {},
  openHarness: () => {},
  onClickThrough: () => {},
}

const state = {
  caps: null, stage: null, layers: null, viewport: null, gaze: null,
  store: null, regionInput: null, reactions: null, settings: null,
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

function bindWindowDrag() {
  const stage = $('#stage')
  // 角色铺满窗口后，角色身上几乎处处是热区：空白处拖动 + ✥ 手柄 + 面板标题栏，三条路都能搬
  dragWindow(stage, { canStart: () => !state.regionInput?.pressed?.region })
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
