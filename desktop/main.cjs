const { app, BrowserWindow, net, protocol, session, shell } = require('electron')
const { existsSync } = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

protocol.registerSchemesAsPrivileged([{
  scheme: 'moment-app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])

let mainWindow
let authWindow

function localAppUrl() {
  return 'moment-app://app/index.html'
}

function appUrl() {
  const remote = process.env.MOMENT_WEB_URL?.trim()
  if (!remote) return localAppUrl()
  const parsed = new URL(remote)
  const isLocalDev = parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !isLocalDev) throw new Error('MOMENT_WEB_URL 必须使用 HTTPS')
  return parsed.toString()
}

function isAllowedMainNavigation(rawUrl) {
  const target = new URL(rawUrl)
  const initial = new URL(appUrl())
  return target.origin === initial.origin
}

function finishOAuth(rawUrl) {
  if (!rawUrl.startsWith('moment://oauth-complete')) return false
  const nativeCode = new URL(rawUrl).searchParams.get('native_code')
  authWindow?.close()
  authWindow = undefined
  const destination = new URL(appUrl())
  if (nativeCode) destination.searchParams.set('native_code', nativeCode)
  mainWindow?.loadURL(destination.toString())
  return true
}

function createAuthWindow(authUrl) {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.focus()
    return
  }
  const apiOrigin = new URL(authUrl).origin
  const allowedOrigins = new Set([apiOrigin, 'https://openapi.baidu.com', 'http://localhost:8787'])
  authWindow = new BrowserWindow({
    width: 520,
    height: 720,
    parent: mainWindow,
    modal: false,
    show: false,
    title: '连接百度网盘',
    backgroundColor: '#f2f6f8',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
  authWindow.once('ready-to-show', () => authWindow?.show())
  authWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (finishOAuth(targetUrl)) return event.preventDefault()
    try {
      if (!allowedOrigins.has(new URL(targetUrl).origin)) event.preventDefault()
    } catch {
      event.preventDefault()
    }
  })
  authWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  authWindow.on('closed', () => { authWindow = undefined })
  authWindow.loadURL(authUrl)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 880,
    minHeight: 620,
    show: false,
    title: '拾光记',
    backgroundColor: '#f2f6f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedMainNavigation(targetUrl)) event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (target.protocol === 'https:' && target.pathname.endsWith('/api/auth/baidu')) createAuthWindow(url)
      else if (['https:', 'http:'].includes(target.protocol)) void shell.openExternal(url)
    } catch { /* Ignore malformed links. */ }
    return { action: 'deny' }
  })

  mainWindow.loadURL(appUrl())
}

app.setAsDefaultProtocolClient('moment')
app.on('open-url', (event, url) => {
  event.preventDefault()
  finishOAuth(url)
})

app.whenReady().then(async () => {
  protocol.handle('moment-app', (request) => {
    const requestUrl = new URL(request.url)
    const distRoot = path.resolve(__dirname, '..', 'dist')
    const relativePath = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html'
    let target = path.resolve(distRoot, relativePath)
    if (!target.startsWith(`${distRoot}${path.sep}`) || !existsSync(target)) target = path.join(distRoot, 'index.html')
    return net.fetch(pathToFileURL(target).toString())
  })

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const origin = new URL(webContents.getURL()).origin
    callback(permission === 'media' && origin === new URL(appUrl()).origin)
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
