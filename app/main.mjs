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
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  gaze: true,
  strength: 1,
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

function applyWindowSettings() {
  if (!win) return
  win.setAlwaysOnTop(!!settings.alwaysOnTop, 'screen-saver')
  win.setIgnoreMouseEvents(!!settings.clickThrough, { forward: true })
}

async function createWindow() {
  const { workArea } = screen.getPrimaryDisplay()
  win = new BrowserWindow({
    width: settings.width,
    height: settings.height,
    x: workArea ? Math.round(workArea.x + workArea.width - settings.width - 40) : undefined,
    y: workArea ? Math.round(workArea.y + 40) : undefined,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
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
  await win.loadURL(`${srv.url}/app/`)
  applyWindowSettings()
  win.on('closed', () => { win = null })
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
  ipcMain.on('shell:quit', () => app.quit())
  ipcMain.on('shell:devtools', () => win?.webContents.toggleDevTools())
  ipcMain.on('shell:harness', () => shell.openExternal(`${srv.url}/harness/`))
}

// ---------- 生命周期 ----------
app.whenReady().then(async () => {
  await loadSettings()
  srv = await createStageServer({ root: ROOT, model: settings.model, token, port: 0 })
  console.log(`[stage] ${srv.url}/app/  （窗口尺寸 A=${settings.width}×${settings.height}）`)
  wireIpc()
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
  globalShortcut.unregisterAll()
  srv?.close?.()
  app.quit()
})
