// Live2D Stage —— Electron 主进程。
//
// 形态：**无边框 / 透明 / 贴角色的独立软件**（不是嵌在 DSH 里）。
//   - 内置同一个静态服务（src/server/stage-server.mjs），窗口加载 http://127.0.0.1:<port>/app/
//   - 窗口尺寸 A 与模型尺寸 B 分离：A 改窗口大小，B 只改模型缩放（渲染层 zoom），互不牵连
//   - 穿透模式：win.setIgnoreMouseEvents(true, { forward: true })，用全局快捷键 Ctrl+Alt+L 找回
//   - 退出：Ctrl+Alt+Q（穿透态下也能用）
import { app, BrowserWindow, ipcMain, globalShortcut, shell, screen } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createStageServer } from '../src/server/stage-server.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_MODEL = 'C:/Users/33153/Desktop/DeepSeek免费公皮/DeepSeek/大肥鱼.model3.json'

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
  petGain: 1.6,
  alwaysOnTop: true,
  clickThrough: false,
  model: process.env.STAGE_MODEL || DEFAULT_MODEL,
}

let settings = { ...DEFAULTS }
let win = null
let srv = null
let token = 'local-app'

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
    await writeFile(settingsFile(), JSON.stringify(settings, null, 2))
  } catch (e) { console.error('[settings] 保存失败', e) }
}

// 渲染层按角色轮廓实时开关的穿透（区别于手动全窗穿透 settings.clickThrough）
let dynamicIgnore = false

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
}

// 拖窗口轮廓改大小：无边框窗口没法靠系统边框，渲染层的八个把手发增量，这里按边缘锚点算 bounds
let resizeBase = null
let panelDelta = 0 // 为设置面板临时加宽的像素（存盘时不算进去）
function wireResize() {
  ipcMain.on('win:resize-begin', (_e, edge) => {
    if (!win) return
    const [x, y] = win.getPosition()
    const [w, h] = win.getSize()
    resizeBase = { edge: String(edge || 'se'), x, y, w, h }
  })
  ipcMain.on('win:resize-move', (_e, { dx = 0, dy = 0 } = {}) => {
    if (!win || !resizeBase) return
    const MIN_W = 220
    const MIN_H = 220
    const b = resizeBase
    let { x, y, w, h } = b
    if (b.edge.includes('e')) w = Math.max(MIN_W, Math.round(b.w + dx))
    if (b.edge.includes('s')) h = Math.max(MIN_H, Math.round(b.h + dy))
    if (b.edge.includes('w')) { w = Math.max(MIN_W, Math.round(b.w - dx)); x = b.x + (b.w - w) }
    if (b.edge.includes('n')) { h = Math.max(MIN_H, Math.round(b.h - dy)); y = b.y + (b.h - h) }
    win.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: h })
    settings.width = w
    settings.height = h
  })
  ipcMain.on('win:resize-end', () => {
    resizeBase = null
    // 存的是「收起面板时的宽度」：面板宽度是临时的，不该跟着进配置文件
    if (win && panelDelta) settings.width = Math.max(220, win.getContentSize()[0] - panelDelta)
    saveSettings()
  })

  // 面板展开/收起：按增量临时改宽度，不写 settings（下次启动仍是紧凑窗）
  ipcMain.on('win:panel', (_e, { dx = 0 } = {}) => {
    if (!win || !dx) return
    const [w, h] = win.getContentSize()
    const { workArea } = screen.getPrimaryDisplay()
    const maxW = Math.max(220, workArea.width - 8)
    const next = Math.max(220, Math.min(maxW, Math.round(w + dx)))
    win.setContentSize(next, h)
    panelDelta += next - w
  })
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
    return { ...settings }
  })
  ipcMain.on('win:move', (_e, { dx = 0, dy = 0 } = {}) => {
    if (!win) return
    const [x, y] = win.getPosition()
    win.setPosition(Math.round(x + dx), Math.round(y + dy))
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
  srv = await createStageServer({ root: ROOT, model: settings.model, token, port: 0 })
  console.log(`[stage] ${srv.url}/app/  （窗口尺寸 A=${settings.width}×${settings.height}）`)
  wireIpc()
  wireResize()
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
