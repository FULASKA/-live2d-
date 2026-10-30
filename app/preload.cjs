// 预加载：只暴露壳层能力，渲染层拿不到 node。
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('shell', {
  get: () => ipcRenderer.invoke('shell:get'),
  set: (patch) => ipcRenderer.invoke('shell:set', patch),
  moveBy: (dx, dy) => ipcRenderer.send('win:move', { dx, dy }),
  setPassThrough: (v) => ipcRenderer.send('win:pass-through', v),
  center: () => ipcRenderer.send('win:center'),
  quit: () => ipcRenderer.send('shell:quit'),
  devtools: () => ipcRenderer.send('shell:devtools'),
  openHarness: () => ipcRenderer.send('shell:harness'),
  onClickThrough: (fn) => ipcRenderer.on('shell:click-through', (_e, v) => fn(v)),
})
