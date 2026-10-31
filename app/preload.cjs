// 预加载：只暴露壳层能力，渲染层拿不到 node。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shell', {
  get: () => ipcRenderer.invoke('shell:get'),
  set: (patch) => ipcRenderer.invoke('shell:set', patch),
  dragBegin: () => ipcRenderer.send('win:drag-begin'),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  moveBy: (dx, dy) => ipcRenderer.send('win:move', { dx, dy }),
  setPassThrough: (v) => ipcRenderer.send('win:pass-through', v),
  resizeBegin: (edge) => ipcRenderer.send('win:resize-begin', edge),
  resizeMove: (dx, dy) => ipcRenderer.send('win:resize-move', { dx, dy }),
  resizeEnd: () => ipcRenderer.send('win:resize-end'),
  panel: (opts) => ipcRenderer.send('win:panel', opts),
  center: () => ipcRenderer.send('win:center'),
  quit: () => ipcRenderer.send('shell:quit'),
  devtools: () => ipcRenderer.send('shell:devtools'),
  openHarness: () => ipcRenderer.send('shell:harness'),
  onClickThrough: (fn) => ipcRenderer.on('shell:click-through', (_e, v) => fn(v)),
  // 全局光标位置（窗口外也有），跟随要覆盖整个桌面
  onCursor: (fn) => ipcRenderer.on('cursor:pos', (_e, p) => fn(p)),
  // DSH 工作状态（主进程轮询状态文件后推过来）：{ state, task, tool, at }
  onAgentStatus: (fn) => ipcRenderer.on('agent:status', (_e, s) => fn(s)),
  // 动作录制：存 / 列 / 读（JSON 在 userData/recordings）
  recSave: (name, data) => ipcRenderer.invoke('rec:save', name, data),
  recList: () => ipcRenderer.invoke('rec:list'),
  recLoad: (name) => ipcRenderer.invoke('rec:load', name),
  // 动作编辑器：动作 JSON 存取 + 打开编辑窗口
  actionsSave: (data) => ipcRenderer.invoke('actions:save', data),
  actionsLoad: () => ipcRenderer.invoke('actions:load'),
  openEditor: () => ipcRenderer.send('shell:editor'),
})
