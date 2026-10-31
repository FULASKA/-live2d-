// Live2D Stage —— Electron 主进程。
//
// 形态：**无边框 / 透明 / 贴角色的独立软件**（不是嵌在 DSH 里）。
//   - 内置同一个静态服务（src/server/stage-server.mjs），窗口加载 http://127.0.0.1:<port>/app/
//   - 窗口尺寸 A 与模型尺寸 B 分离：A 改窗口大小，B 只改模型缩放（渲染层 zoom），互不牵连
//   - 穿透模式：win.setIgnoreMouseEvents(true, { forward: true })，用全局快捷键 Ctrl+Alt+L 找回
//   - 退出：Ctrl+Alt+Q（穿透态下也能用）
import { app, BrowserWindow, ipcMain, globalShortcut, shell, screen, dialog } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { createStageServer } from '../src/server/stage-server.mjs'

// 控制台管道断开时（从终端/脚本启动后终端关闭）console.log 会抛 EPIPE，
// 不接住会弹「A JavaScript error occurred in the main process」并崩溃。
for (const s of [process.stdout, process.stderr]) {
  try { s.on('error', (e) => { if (e && e.code === 'EPIPE') return }) } catch {}
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 便携/测试：STAGE_HOME 覆盖用户数据目录（设置文件跟着走，可做干净环境）
if (process.env.STAGE_HOME) { try { mkdirSync(process.env.STAGE_HOME, { recursive: true }); app.setPath('userData', process.env.STAGE_HOME) } catch {} }
// 启动参数：--model "路径\model3.json"（自动化安装 / 快捷方式用）
const ARG_MODEL = (() => { const i = process.argv.indexOf('--model'); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : null })()
const DEV_MODEL = 'C:/Users/33153/Desktop/DeepSeek免费公皮/DeepSeek/大肥鱼.model3.json'
// 模型目录：放在 exe 旁边的 model/（完整版内置；发布版用户把自己的模型丢进去即可，不用配绝对路径）
const EXE_DIR = path.dirname(app.getPath('exe'))
const MODEL_DIRS = [path.join(EXE_DIR, 'model'), path.join(ROOT, 'model')]

/** 目录里挑一个 *.model3.json：优先「大肥鱼」，否则第一个 */
function pickModelIn(dir) {
  try {
    const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.model3.json')).sort()
    if (!files.length) return null
    return path.join(dir, files.find((f) => f.startsWith('大肥鱼')) || files[0])
  } catch { return null }
}

/** 设置里的 model：相对路径按 exe 所在目录解析（配置里只存相对路径，换机不用改） */
function fromSettings() {
  if (!settings.model) return null
  const abs = path.isAbsolute(settings.model) ? settings.model : path.resolve(EXE_DIR, settings.model)
  return existsSync(abs) ? abs : null
}

/** 解析模型路径：设置 → exe 旁 model/ → 包内 resources/app/model → 环境变量 → 开发机内置 */
function resolveModel() {
  const fromCfg = fromSettings()
  if (fromCfg) return fromCfg
  for (const dir of MODEL_DIRS) { const f = pickModelIn(dir); if (f) return f }
  if (process.env.STAGE_MODEL && existsSync(process.env.STAGE_MODEL)) return process.env.STAGE_MODEL
  if (existsSync(DEV_MODEL)) return DEV_MODEL
  return null
}

/** 启动时拿模型：找不到就弹选择框（发布包不带模型）；取消返回 null */
async function resolveModelOrPick() {
  const found = resolveModel()
  if (found) return found
  const r = await dialog.showOpenDialog({
    title: '选择 Live2D 模型（.model3.json）',
    properties: ['openFile'],
    filters: [{ name: 'Live2D 模型', extensions: ['model3.json'] }],
  })
  return r.canceled ? null : (r.filePaths[0] || null)
}

const DEFAULTS = {
  width: 520,
  height: 760,
  x: null,          // 窗口位置（首次启动按屏幕右上角摆）
  y: null,
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  gaze: true,
  strength: 1,
  headGain: 1.25,   // 转头幅度（ParamAngleX/Y 的增益倍数），设置窗口可调
  petGain: 1.6,
  idle: true,        // 待机动作（常驻微摆 + 随机成套动作 + 小台词）
  idleSpeed: 1,      // 待机频率倍数（越大换动作越勤）
  alwaysOnTop: true,
  clickThrough: false,
  bubble: true,          // 气泡总开关
  border: false,         // 显示窗口边框（拖边框缩放；关掉后回到纯角色）
  padY: 0.02,            // 上下留白（0–0.2，占画布高度比例）；越小边框越贴角色
  bodyShape: 0,          // 体型：0 默认 / 0.4 体型1 / 1 体型2（Clothes2 参数，设置里拉条调）
  dragPhysics: true,     // 拖拽物理：拖动窗口时让模型自己的物理跟着甩（类似 VTS 的拖拽物理演算）
  autoStart: false,      // 开机自启（Windows 登录时启动舞台）
  model: null,           // 启动时由 resolveModel() 决定（发布版没有模型，要用户选）
}

let settings = { ...DEFAULTS }
let win = null
let srv = null
let token = 'local-app'

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) { app.quit() } else {
  app.on('second-instance', () => { try { if (win) { win.show(); win.focus() } } catch {} })
}

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

async function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(await readFile(settingsFile(), 'utf8')) }
  } catch { /* 首次启动：用默认 */ }
  settings.clickThrough = false // 上次退出时若在穿透态，重启一律恢复正常，避免「点不到」
}
async function saveSettings() {
  try {
    await mkdir(path.dirname(settingsFile()), { recursive: true })
    // 模型路径：在 exe 目录内就存相对路径（打包后换目录/换机不用改配置）
    const out = { ...settings }
    if (out.model) {
      const rel = path.relative(EXE_DIR, out.model)
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) out.model = rel.replace(/\\/g, '/')
    }
    await writeFile(settingsFile(), JSON.stringify(out, null, 2), 'utf8')
  } catch (e) { console.error('[settings] 保存失败', e) }
}

// 渲染层按角色轮廓实时开关的穿透（区别于手动全窗穿透 settings.clickThrough）
let dynamicIgnore = false

/** 开机自启：写 Windows 登录启动项。开发模式跳过，免得把 electron.exe 写进系统 */
function applyAutoStart() {
  try {
    if (!app.isPackaged) return
    app.setLoginItemSettings({ openAtLogin: !!settings.autoStart, path: process.execPath, args: [] })
  } catch (e) { console.error('[autostart]', e && e.message) }
}

function applyWindowSettings() {
  if (!win) return
  win.setAlwaysOnTop(!!settings.alwaysOnTop, 'screen-saver')
  win.setIgnoreMouseEvents(!!settings.clickThrough || dynamicIgnore, { forward: true })
}

async function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  win = new BrowserWindow({
    width: settings.width,
    height: settings.height,
    x: Number.isFinite(settings.x) ? Math.round(settings.x) : (workArea ? Math.round(workArea.x + workArea.width - settings.width - 40) : undefined),
    y: Number.isFinite(settings.y) ? Math.round(settings.y) : (workArea ? Math.round(workArea.y + 40) : undefined),
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: path.join(ROOT, 'assets', 'app.ico'),
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'app', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  })
  win.setBackgroundColor('#00000000')
  win.once('ready-to-show', () => win.show())
  // 拖动的「收尾」不能只靠渲染层发 drag-end：页面重载/失焦时那个事件不会来，
  // 定时器会残留并持续把窗口拽向光标。
  win.webContents.on('did-start-loading', stopWindowDrag)
  win.on('blur', stopWindowDrag)

  // 位置记忆：搬完窗口 500ms 后落盘（拖动过程中不写，避免每帧 IO）
  let moveTimer = null
  win.on('moved', () => {
    if (!win || win.isDestroyed()) return
    const [x, y] = win.getPosition()
    settings.x = x
    settings.y = y
    if (moveTimer) clearTimeout(moveTimer)
    moveTimer = setTimeout(() => { moveTimer = null; saveSettings() }, 500)
  })
  await win.loadURL(`${srv.url}/app/`)
  applyWindowSettings()
  win.on('closed', () => { win = null })
  startAgentStatusFeed(win)
}

// ---------- DSH 工作状态：读桥接插件写的状态文件，推给渲染层 ----------
// 插件（dsh-live2d-bridge）在 DSH 侧监听 session/event，原子写 ~/.dsh/live2d/status.json；
// 这里只做「文件变了就转发」，不解析业务、不阻塞界面。文件不在 = DSH 侧没装插件，舞台按空闲处理。
const AGENT_STATUS_FILE = path.join(app.getPath('home'), '.dsh', 'live2d', 'status.json')

// 外部控制入口的发现文件：端口随机、token 只有主进程知道，agent/CLI 从这里读。
// 不做「退出即删」—— 留下的旧端口比消失的文件更容易被排查（连不上就能判断没开）。
const ENDPOINT_FILE = path.join(app.getPath('home'), '.dsh', 'live2d', 'endpoint.json')
async function writeEndpoint() {
  try {
    await mkdir(path.dirname(ENDPOINT_FILE), { recursive: true })
    await writeFile(ENDPOINT_FILE, JSON.stringify({
      url: srv.url,
      port: srv.port,
      token,
      pid: process.pid,
      model: settings.model,
      protocol: 1,
      at: Date.now(),
    }, null, 2))
  } catch (e) { console.warn('[endpoint] 写入失败', e?.message || e) }
}
function startAgentStatusFeed(target) {
  let lastSig = ''
  let lastAt = 0
  const tick = async () => {
    if (!target || target.isDestroyed()) return
    try {
      const st = await stat(AGENT_STATUS_FILE).catch(() => null)
      if (!st) { lastSig = ''; return }
      const sig = `${st.mtimeMs}:${st.size}`
      if (sig === lastSig) return
      lastSig = sig
      const raw = await readFile(AGENT_STATUS_FILE, 'utf8')
      let snap = null
      try { snap = JSON.parse(raw) } catch { return }
      if (!snap || typeof snap !== 'object') return
      const at = Number(snap.at || 0)
      if (at && at === lastAt) return
      lastAt = at
      target.webContents.send('agent:status', {
        state: snap.state ?? null,
        task: snap.task ?? null,
        tool: snap.tool ?? null,
        at: at || Date.now(),
      })
    } catch {}
  }
  setInterval(tick, 400).unref?.()
  tick()
}

// 窗口尺寸跟随角色：尺寸由渲染层按「模型画布 × 角色大小」算好，这里只负责
// **保持中心不变**地改大小（角色在窗口里是居中 contain，所以改完依然居中）；
// 贴近屏幕边缘时按工作区夹一下，不会把窗口推出屏幕。
// ---------- 拖边框缩放 ----------
// 渲染层只报告「按下了哪条边」，真正的尺寸跟全局光标走（窗口在被移动时，
// 窗口内坐标会漂，只有屏幕坐标是稳的）。比例由起始窗口锁定，拖角/拖边都等比。
let borderDrag = null

function stopBorderDrag(save = true) {
  if (!borderDrag) return
  clearInterval(borderDrag.timer)
  clearTimeout(borderDrag.guard)
  borderDrag = null
  if (save && win && !win.isDestroyed()) {
    const [w, h] = win.getSize()
    settings.width = w
    settings.height = h
    saveSettings()
  }
}

function wireBorderDrag() {
  ipcMain.on('win:scale-begin', (_e, edge = 'se') => {
    if (!win || win.isDestroyed()) return
    stopBorderDrag(false)
    const start = win.getBounds()
    const ratio = start.width / start.height
    const tick = () => {
      if (!win || win.isDestroyed() || !borderDrag) return
      const p = screen.getCursorScreenPoint()
      const e = borderDrag.edge
      let w
      if (/[ew]/.test(e)) w = /e/.test(e) ? p.x - start.x : start.x + start.width - p.x
      else {
        const hh = /s/.test(e) ? p.y - start.y : start.y + start.height - p.y
        w = hh * ratio
      }
      w = Math.round(Math.max(240, Math.min(1600, w)))
      const h = Math.round(w / ratio)
      const x = /w/.test(e) ? start.x + start.width - w : /e/.test(e) ? start.x : Math.round(start.x + (start.width - w) / 2)
      const y = /n/.test(e) ? start.y + start.height - h : /s/.test(e) ? start.y : Math.round(start.y + (start.height - h) / 2)
      win.setBounds({ x, y, width: w, height: h })
    }
    borderDrag = {
      edge: String(edge),
      timer: setInterval(tick, 16),
      // 兜底：pointerup 丢了也不能让窗口一直跟着鼠标缩
      guard: setTimeout(() => stopBorderDrag(true), 30000),
    }
    tick()
  })
  ipcMain.on('win:scale-end', () => stopBorderDrag(true))
}

function wireFit() {
  ipcMain.on('win:fit', (_e, size = {}) => {
    if (!win || win.isDestroyed()) return
    const W = Math.max(180, Math.round(Number(size.w) || 0))
    const H = Math.max(220, Math.round(Number(size.h) || 0))
    const b = win.getBounds()
    const cx = Math.round(b.x + b.width / 2)
    const cy = Math.round(b.y + b.height / 2)
    const { workArea } = screen.getDisplayNearestPoint({ x: cx, y: cy })
    const x = Math.min(Math.max(Math.round(cx - W / 2), workArea.x), workArea.x + workArea.width - W)
    const y = Math.min(Math.max(Math.round(cy - H / 2), workArea.y), workArea.y + workArea.height - H)
    if (b.width !== W || b.height !== H || b.x !== x || b.y !== y) {
      win.setBounds({ x, y, width: W, height: H })
      // 只有尺寸真的变了才落盘 + 广播：否则「广播 → 渲染层重新 fit → 又广播」会打成死循环，
      // 每次循环都会把渲染层按轮廓做的居中修正冲掉。
      settings.width = W
      settings.height = H
      settings.x = x
      settings.y = y
      saveSettings()
      broadcastSettings()
    }
  })
}

// 中键搬窗口：主进程按全局光标锚点搬（读系统光标是绝对量，不会像事件增量那样累积漂移）
let dragTimer = null
let dragBase = null
// 结束拖动：任何「可能收不到 drag-end」的情况（页面重载、焦点丢失、窗口销毁）都要停掉，
// 否则这个 16ms 定时器会一直把窗口往光标位置拽 —— 表现为窗口自己慢慢漂移。
function stopWindowDrag() {
  if (dragTimer) clearInterval(dragTimer)
  dragTimer = null
  dragBase = null
}
function wireWindowDrag() {
  ipcMain.on('win:drag-begin', () => {
    if (!win) return
    stopWindowDrag()
    const q = screen.getCursorScreenPoint()
    const [x, y] = win.getPosition()
    dragBase = { cx: q.x, cy: q.y, x, y }
    if (dragTimer) clearInterval(dragTimer)
    dragTimer = setInterval(() => {
      if (!win || win.isDestroyed() || !dragBase) return
      const p = screen.getCursorScreenPoint()
      win.setPosition(Math.round(dragBase.x + (p.x - dragBase.cx)), Math.round(dragBase.y + (p.y - dragBase.cy)))
    }, 16)
  })
  ipcMain.on('win:drag-end', () => {
    stopWindowDrag()
    if (win && !win.isDestroyed()) {
      const [x, y] = win.getPosition()
      settings.x = x
      settings.y = y
      saveSettings()
    }
  })
}

// ---------- 子窗口（设置 / 动作编辑器）----------
// 覆盖层窗口只负责角色：设置类界面一律开成独立普通窗口（可拖动、有标题栏、不进穿透层），
// 覆盖层也就不用为了塞面板临时改宽度——尺寸与内容从此解耦。
const childWins = new Map()
function openChild(key, { file, ...opts }) {
  const cur = childWins.get(key)
  if (cur && !cur.isDestroyed()) { cur.focus(); return cur }
  const w = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: '#0f131b',
    ...opts,
    webPreferences: {
      preload: path.join(ROOT, 'app', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // 子窗口被挡住也不能停帧（编辑器预览要一直播）
      backgroundThrottling: false,
    },
  })
  w.loadURL(`${srv.url}/app/${file}`)
  childWins.set(key, w)
  w.on('closed', () => { if (childWins.get(key) === w) childWins.delete(key) })
  return w
}

/** 设置变了广播给所有窗口：覆盖层按新值立即生效，设置窗口刷新读数 */
function broadcastSettings() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('shell:changed', { ...settings })
  }
}

// ---------- IPC ----------
function wireIpc() {
  ipcMain.handle('shell:get', () => ({ ...settings, token, port: srv?.port || null }))
  ipcMain.handle('shell:set', async (_e, patch = {}) => {
    settings = { ...settings, ...patch }
    if (patch.width || patch.height) {
      win?.setContentSize(Math.round(settings.width), Math.round(settings.height))
    }
    applyWindowSettings()
    await saveSettings()
    broadcastSettings()
    return { ...settings }
  })
  ipcMain.handle('model:choose', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: '选择 Live2D 模型（.model3.json）',
      properties: ['openFile'],
      filters: [{ name: 'Live2D 模型', extensions: ['model3.json'] }],
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false }
    settings.model = r.filePaths[0]
    await saveSettings()
    setTimeout(() => { app.relaunch(); app.exit(0) }, 60)
    return { ok: true, model: settings.model }
  })
  ipcMain.on('win:move', (_e, { dx = 0, dy = 0 } = {}) => {
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(Math.round(x + dx), Math.round(y + dy))
  })
  // ---------- 改动补丁：记录我们这层加的姿势/台词/反应/热区，发布时只发这个文件 ----------
  const patchFile = () => path.join(app.getPath('userData'), 'stage-patch.json')
  ipcMain.handle('patch:save', async (_e, data) => {
    try {
      await mkdir(path.dirname(patchFile()), { recursive: true })
      await writeFile(patchFile(), JSON.stringify(data, null, 2))
      return { ok: true, file: patchFile() }
    } catch (e) { return { ok: false, error: String(e?.message || e) } }
  })
  ipcMain.handle('patch:load', async () => {
    try { return JSON.parse(await readFile(patchFile(), 'utf8')) } catch { return null }
  })
  // ---------- 动作编辑器：存 / 读动作 JSON + 打开编辑窗口 ----------
  const actionsFile = () => path.join(app.getPath('userData'), 'actions.json')
  ipcMain.handle('actions:save', async (_e, data) => {
    try {
      await mkdir(path.dirname(actionsFile()), { recursive: true })
      await writeFile(actionsFile(), JSON.stringify(data, null, 2))
      return { ok: true, file: actionsFile() }
    } catch (e) { return { ok: false, error: String(e?.message || e) } }
  })
  ipcMain.handle('actions:load', async () => {
    try { return JSON.parse(await readFile(actionsFile(), 'utf8')) } catch { return null }
  })
  ipcMain.on('shell:editor', () => openChild('editor', {
    file: 'editor.html',
    width: 1240, height: 840, minWidth: 900, minHeight: 620,
    title: '动作编辑器 · Live2D Stage',
  }))
  ipcMain.on('shell:settings', () => openChild('settings', {
    file: 'settings.html',
    width: 432, height: 760, minWidth: 360, minHeight: 420,
    title: '设置 · Live2D Stage',
  }))
  // ---------- 设置窗口 → 舞台窗口的 RPC ----------
  // 设置窗口不重复加载模型：它只发指令、拿快照，真正的状态都在舞台窗口里。
  ipcMain.handle('stage:rpc', async (_e, op, payload) => {
    if (!win || win.isDestroyed()) return { ok: false, error: '舞台窗口还没起来' }
    try {
      const value = await win.webContents.executeJavaScript(
        `window.__stageRpc(${JSON.stringify(String(op || ''))}, ${JSON.stringify(payload ?? null)})`,
        true,
      )
      return { ok: true, value }
    } catch (e) {
      return { ok: false, error: String(e?.message || e) }
    }
  })
  ipcMain.on('win:center', () => {
    if (!win) return
    const { workArea } = screen.getPrimaryDisplay()
    const [w, h] = win.getSize()
    win.setPosition(Math.round(workArea.x + (workArea.width - w) / 2), Math.round(workArea.y + (workArea.height - h) / 2))
  })
  // 透明处穿透：渲染层拿 alpha 掩码判定指针在不在角色身上，不在就忽略鼠标
  // （forward: true 保证忽略鼠标时仍能收到 mousemove，挪回角色身上可以自己收回来）
  ipcMain.on('win:pass-through', (_e, v) => {
    if (dynamicIgnore !== !!v) console.log(`[pass] 忽略鼠标=${!!v}`)
    dynamicIgnore = !!v
    applyWindowSettings()
  })
  ipcMain.on('shell:quit', () => app.quit())
  ipcMain.on('shell:devtools', () => win?.webContents.toggleDevTools())
  ipcMain.on('shell:harness', () => shell.openExternal(`${srv.url}/harness/`))
}

// 全局光标 → 渲染层。跟随要覆盖整个桌面，所以不能只靠窗口内的 mousemove；
// 33ms 轮询 + 变化才发，空闲时零开销。
let cursorTimer = null
function startCursorFeed() {
  if (cursorTimer) return
  let last = null
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return
    const p = screen.getCursorScreenPoint()
    if (last && p.x === last.x && p.y === last.y) return
    last = p
    const [wx, wy] = win.getPosition()
    win.webContents.send('cursor:pos', { x: p.x - wx, y: p.y - wy })
  }, 33)
}
function stopCursorFeed() {
  if (cursorTimer) clearInterval(cursorTimer)
  cursorTimer = null
}

// ---------- 生命周期 ----------
app.whenReady().then(async () => {
  await loadSettings()
  settings.model = await resolveModelOrPick()
  if (!settings.model) {
    dialog.showErrorBox('缺少模型', '没有找到 Live2D 模型。请重新打开程序并选择 大肥鱼.model3.json（模型不随发布包分发）。')
    app.quit()
    return
  }
  await saveSettings()
  srv = await createStageServer({ root: ROOT, model: settings.model, token, port: 0 })
  await writeEndpoint()
  console.log(`[stage] ${srv.url}/app/  （窗口尺寸 A=${settings.width}×${settings.height}）`)
  wireIpc()
  wireFit()
  wireBorderDrag()
  wireWindowDrag()
  startCursorFeed()
  await createWindow()

  // 穿透态找回 / 退出：全局快捷键，即使窗口在忽略鼠标也能用
  globalShortcut.register('Control+Alt+L', () => {
    settings.clickThrough = !settings.clickThrough
    applyWindowSettings()
    saveSettings()
    win?.webContents.send('shell:click-through', settings.clickThrough)
  })
  globalShortcut.register('Control+Alt+Q', () => app.quit())

  app.on('activate', () => { if (!win) createWindow() })
})

app.on('window-all-closed', () => {
  stopCursorFeed()
  globalShortcut.unregisterAll()
  srv?.close?.()
  app.quit()
})
