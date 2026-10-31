// 设置窗口。
//
// 分工：
//   - 纯设置项（尺寸/缩放/跟随/气泡/置顶/穿透）走 shell.set → 主进程存盘并广播 → 覆盖层立即生效；
//     设置窗口自己不持有任何状态，也不直接碰模型。
//   - 需要舞台内部状态的（热区反应表、导出补丁）走 shell.stageRpc，舞台窗口是唯一真相。
const $ = (s) => document.querySelector(s)

const shell = window.shell || {
  get: async () => ({}),
  set: async (p) => p,
  stageRpc: async () => ({ ok: false, error: 'no bridge' }),
  center: () => {},
  openEditor: () => {},
  openHarness: () => {},
  quit: () => {},
}

let settings = {}
let meta = null

function status(text, warn = false) {
  const el = $('#status')
  if (!el) return
  el.textContent = text || ''
  el.classList.toggle('warn', !!warn)
  clearTimeout(status._t)
  if (text) status._t = setTimeout(() => { el.textContent = '' }, 3600)
}

async function rpc(op, payload) {
  const r = await shell.stageRpc?.(op, payload)
  if (!r || r.ok === false) {
    status(r?.error || '舞台窗口没响应，先把角色启动起来', true)
    return null
  }
  return r.value
}

/** 滑块连续拖动时别每帧写盘：攒 120ms 发一次 */
function debounce(fn, ms = 120) {
  let t = 0
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
}

const pushSettings = (patch) => shell.set(patch)
const pushSettingsSoon = debounce((patch) => shell.set(patch))

function paint() {
  const w = Math.round(Number(settings.width) || 0)
  const h = Math.round(Number(settings.height) || 0)
  $('#size-readout').textContent = w && h ? `${w} × ${h}` : '— × —'

  const zoom = Number(settings.zoom) || 1
  setRange('#zoom', zoom)
  $('#zoom-readout').textContent = `${Math.round(zoom * 100)}%`
  setRange('#strength', Number(settings.strength ?? 1))
  setRange('#pet-gain', Number(settings.petGain ?? 1.6))

  setCheck('#gaze', settings.gaze !== false)
  setCheck('#bubble-on', settings.bubble !== false)
  setCheck('#top', !!settings.alwaysOnTop)
  setCheck('#click-through', !!settings.clickThrough)
  if (document.activeElement !== $('#bubble-side')) {
    $('#bubble-side').value = settings.bubbleSide === 'left' ? 'left' : 'right'
  }
}

function setRange(sel, v) {
  const el = $(sel)
  if (el && document.activeElement !== el) el.value = v
}
function setCheck(sel, on) {
  const el = $(sel)
  if (el) el.checked = !!on
}

// ---------- 分区反应 ----------
function rxCurrent() {
  const region = meta?.reactions?.[$('#rx-region').value]
  const rx = region?.[$('#rx-kind').value]
  return {
    mode: rx?.toggle ? 'toggle' : 'expr',
    picked: new Set(rx?.toggle ? [rx.toggle] : (rx?.expr || [])),
  }
}

function renderReactions() {
  const box = $('#rx-exprs')
  const cur = rxCurrent()
  $('#rx-mode').value = cur.mode
  const exprs = meta?.exprs || []
  box.innerHTML = exprs.map((n) => (
    `<label><input type="checkbox" value="${n}"${cur.picked.has(n) ? ' checked' : ''}>${n}</label>`
  )).join('') || '<span class="hint">舞台还没报表情清单</span>'
  box.querySelectorAll('input').forEach((inp) => {
    inp.onchange = () => {
      let picked = [...box.querySelectorAll('input:checked')].map((i) => i.value)
      // 切换型只能用一个表情：后勾的顶替前面的
      if ($('#rx-mode').value === 'toggle' && picked.length > 1) {
        picked = [picked[picked.length - 1]]
        box.querySelectorAll('input').forEach((i) => { i.checked = i.value === picked[0] })
      }
      void sendReaction(picked)
    }
  })
}

async function sendReaction(exprs) {
  const mode = $('#rx-mode').value
  const picked = exprs || [...$('#rx-exprs').querySelectorAll('input:checked')].map((i) => i.value)
  const v = await rpc('reaction', {
    region: $('#rx-region').value,
    kind: $('#rx-kind').value,
    exprs: mode === 'toggle' ? picked.slice(0, 1) : picked,
    mode,
  })
  if (v?.reactions) {
    meta.reactions = v.reactions
    renderReactions()
  }
}

async function loadMeta() {
  meta = await rpc('meta')
  const sel = $('#rx-region')
  if (meta?.regions?.length) {
    const keep = sel.value
    sel.innerHTML = meta.regions.map((n) => `<option>${n}</option>`).join('')
    if (meta.regions.includes(keep)) sel.value = keep
    renderReactions()
  }
}

// ---------- 事件 ----------
function wire() {
  $('#zoom').oninput = (e) => {
    const zoom = Number(e.target.value)
    $('#zoom-readout').textContent = `${Math.round(zoom * 100)}%`
    pushSettingsSoon({ zoom })
  }
  $('#strength').oninput = (e) => pushSettingsSoon({ strength: Number(e.target.value) })
  $('#pet-gain').oninput = (e) => pushSettingsSoon({ petGain: Number(e.target.value) })
  $('#gaze').onchange = (e) => pushSettings({ gaze: !!e.target.checked })
  $('#bubble-on').onchange = (e) => pushSettings({ bubble: !!e.target.checked })
  $('#bubble-side').onchange = (e) => pushSettings({ bubbleSide: e.target.value === 'left' ? 'left' : 'right' })
  $('#top').onchange = (e) => pushSettings({ alwaysOnTop: !!e.target.checked })
  $('#click-through').onchange = (e) => pushSettings({ clickThrough: !!e.target.checked })

  $('#rx-region').onchange = () => renderReactions()
  $('#rx-kind').onchange = () => renderReactions()
  $('#rx-mode').onchange = () => void sendReaction()
  $('#rx-reset').onclick = async () => {
    const region = $('#rx-region').value
    const v = await rpc('reactionReset', { region })
    if (v?.reactions) { meta.reactions = v.reactions; renderReactions() }
    status(`${region} 反应已恢复默认`)
  }

  $('#open-editor').onclick = () => shell.openEditor?.()
  $('#patch-export').onclick = async () => {
    const v = await rpc('patchExport')
    if (v?.ok) status('改动补丁已保存（stage-patch.json）')
    else if (v) status('补丁保存失败', true)
  }

  $('#win-center').onclick = () => { shell.center?.(); status('覆盖层已居中') }
  $('#open-harness').onclick = () => shell.openHarness?.()
  $('#quit').onclick = () => shell.quit?.()
}

async function boot() {
  settings = (await shell.get?.()) || {}
  paint()
  shell.onSettings?.((next) => { settings = next || settings; paint() })
  wire()
  await loadMeta()
}

void boot()
