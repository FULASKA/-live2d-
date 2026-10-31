// 预加载：只暴露壳层能力，渲染层拿不到 node。
//
// 三个页面共用这一份：舞台（覆盖层）/ 设置窗口 / 动作编辑器。
// 舞台窗口额外提供「全局光标 + DSH 状态 + 穿透」；设置窗口只用到 get/set/stageRpc。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shell', {
  // ---- 设置（主进程持有，改动会广播给所有窗口）----
  get: () => ipcRenderer.invoke('shell:get'),
  set: (patch) => ipcRenderer.invoke('shell:set', patch),
  onSettings: (fn) => ipcRenderer.on('shell:changed', (_e, s) => fn(s)),

  // ---- 舞台窗口的指令通道（设置窗口用它改反应、读快照、导出补丁）----
  stageRpc: (op, payload) => ipcRenderer.invoke('stage:rpc', op, payload),
  chooseModel: () => ipcRenderer.invoke('model:choose'),

  // ---- 窗口搬运 / 尺寸 / 轮廓 ----
  dragBegin: () => ipcRenderer.send('win:drag-begin'),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  moveBy: (dx, dy) => ipcRenderer.send('win:move', { dx, dy }),
  // 窗口尺寸跟随角色：渲染层算尺寸，主进程保持中心不变地改
  fit: (w, h) => ipcRenderer.send('win:fit', { w, h }),
  // 拖边框缩放：报告按下的边，主进程按全局光标改 bounds（比例锁定）
  scaleBegin: (edge) => ipcRenderer.send('win:scale-begin', edge),
  scaleEnd: () => ipcRenderer.send('win:scale-end'),
  center: () => ipcRenderer.send('win:center'),
  setPassThrough: (v) => ipcRenderer.send('win:pass-through', v),
  onClickThrough: (fn) => ipcRenderer.on('shell:click-through', (_e, v) => fn(v)),

  // ---- 子窗口 ----
  openSettings: () => ipcRenderer.send('shell:settings'),
  openEditor: () => ipcRenderer.send('shell:editor'),
  openHarness: () => ipcRenderer.send('shell:harness'),
  quit: () => ipcRenderer.send('shell:quit'),
  devtools: () => ipcRenderer.send('shell:devtools'),

  // ---- 舞台专用：全局光标位置 + DSH 工作状态 ----
  onCursor: (fn) => ipcRenderer.on('cursor:pos', (_e, p) => fn(p)),
  onAgentStatus: (fn) => ipcRenderer.on('agent:status', (_e, s) => fn(s)),

  // ---- 文件：动作 JSON / 改动补丁（都放 userData，跟应用一起搬走）----
  actionsSave: (data) => ipcRenderer.invoke('actions:save', data),
  actionsLoad: () => ipcRenderer.invoke('actions:load'),
  patchSave: (data) => ipcRenderer.invoke('patch:save', data),
  patchLoad: () => ipcRenderer.invoke('patch:load'),
})
