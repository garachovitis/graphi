// Grafi — preload: exposes a minimal, typed bridge to the renderer (see src/platform.ts).
'use strict'
const { contextBridge, ipcRenderer } = require('electron')

function on(channel, cb) {
  const handler = (_e, ...args) => cb(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('grafiNative', {
  platform: process.platform,
  openDialog: () => ipcRenderer.invoke('file:open-dialog'),
  readFile: (p) => ipcRenderer.invoke('file:read', p),
  saveFile: (opts) => ipcRenderer.invoke('file:save', opts),
  renderPdf: () => ipcRenderer.invoke('pdf:render'),
  print: () => ipcRenderer.invoke('print'),
  captureWindow: () => ipcRenderer.invoke('screen:capture'),
  setWindowState: (s) => ipcRenderer.invoke('win:state', s),
  newWindow: (p) => ipcRenderer.invoke('win:new', p),
  closeNow: () => ipcRenderer.invoke('win:close-now'),
  cancelClose: () => ipcRenderer.invoke('win:close-cancel'),
  confirmUnsaved: (name) => ipcRenderer.invoke('dialog:unsaved', name),
  showError: (m) => ipcRenderer.invoke('dialog:error', m),
  recent: () => ipcRenderer.invoke('recent:list'),
  openExternal: (u) => ipcRenderer.invoke('shell:open', u),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  setLanguage: (l) => ipcRenderer.invoke('app:lang', l),
  onMenu: (cb) => on('menu', cb),
  onFileOpened: (cb) => on('file:opened', cb),
  onOpenRequest: (cb) => on('file:open-request', cb),
  onRequestClose: (cb) => on('app:request-close', cb),
})
