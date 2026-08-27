const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('momentDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app-update:version'),
  installUpdate: (url) => ipcRenderer.invoke('app-update:install', url),
  onUpdateProgress: (callback) => {
    const listener = (_event, percent) => callback(percent)
    ipcRenderer.on('app-update:progress', listener)
    return () => ipcRenderer.removeListener('app-update:progress', listener)
  },
}))
