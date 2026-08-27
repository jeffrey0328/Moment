const { app, BrowserWindow, ipcMain, net, protocol, session, shell } = require('electron')
const { createWriteStream, existsSync } = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

protocol.registerSchemesAsPrivileged([{
  scheme: 'moment-app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}])

let mainWindow

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
      if (['https:', 'http:'].includes(target.protocol)) void shell.openExternal(url)
    } catch { /* Ignore malformed links. */ }
    return { action: 'deny' }
  })

  mainWindow.loadURL(appUrl())
}

function downloadUpdate(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const request = net.request(url)
    request.on('redirect', (_status, _method, redirectUrl) => {
      try {
        if (new URL(redirectUrl).protocol !== 'https:') {
          request.abort()
          reject(new Error('更新地址必须使用 HTTPS'))
          return
        }
      } catch {
        request.abort()
        reject(new Error('更新地址无效'))
        return
      }
      request.followRedirect()
    })
    request.on('response', (response) => {
      if ((response.statusCode || 0) >= 400) {
        reject(new Error(`下载失败（${response.statusCode}）`))
        return
      }
      const total = Number(response.headers['content-length'] || 0)
      let received = 0
      const file = createWriteStream(dest)
      response.on('data', (chunk) => {
        received += chunk.length
        file.write(chunk)
        if (total > 0) onProgress(Math.min(99, Math.round((received / total) * 100)))
      })
      response.on('end', () => {
        file.end(() => {
          onProgress(100)
          resolve()
        })
      })
      response.on('error', (error) => {
        file.destroy()
        reject(error)
      })
    })
    request.on('error', reject)
    request.end()
  })
}

ipcMain.handle('app-update:version', () => app.getVersion())

ipcMain.handle('app-update:install', async (event, url) => {
  if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('更新地址无效')
  const ext = path.extname(new URL(url).pathname) || (process.platform === 'win32' ? '.exe' : '')
  const dest = path.join(app.getPath('temp'), `Moment-update${ext || '.bin'}`)
  await downloadUpdate(url, dest, (percent) => {
    event.sender.send('app-update:progress', percent)
  })
  const openError = await shell.openPath(dest)
  if (openError) throw new Error(openError)
  setTimeout(() => app.quit(), 500)
  return { ok: true }
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
