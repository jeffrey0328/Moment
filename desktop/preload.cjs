const { contextBridge } = require('electron')

contextBridge.exposeInMainWorld('momentDesktop', Object.freeze({
  isDesktop: true,
  platform: process.platform,
}))

