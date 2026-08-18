import 'dotenv/config'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import { Readable } from 'node:stream'
import { clearToken, consumeNativeSession, consumeOAuthReturn, createNativeSession, createOAuthState, exchangeCode, getValidToken, readToken, saveToken, validateOAuthState } from './auth.js'
import { downloadByPath, manifestPath, remoteDir, uploadBuffer, uploadFile } from './baidu.js'

const app = express()
const port = Number(process.env.PORT || 8787)
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 512) * 1024 * 1024 } })

app.disable('x-powered-by')
app.use((req, res, next) => {
  const origin = req.headers.origin
  const configuredOrigins = (process.env.NATIVE_CORS_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)
  const allowedOrigins = new Set([
    'moment-app://app',
    'capacitor://localhost',
    'https://localhost',
    'http://localhost',
    ...(process.env.APP_ORIGIN ? [process.env.APP_ORIGIN.replace(/\/$/, '')] : []),
    ...configuredOrigins,
  ])
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Vary', 'Origin')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(cookieParser())
app.use(express.json({ limit: '12mb' }))

const configured = () => Boolean(process.env.BAIDU_APP_KEY && process.env.BAIDU_SECRET_KEY && process.env.BAIDU_REDIRECT_URI && process.env.APP_SECRET)

app.get('/api/status', (req, res) => {
  res.json({ configured: configured(), connected: configured() && Boolean(readToken(req)), remoteDir: remoteDir() })
})

app.get('/api/auth/baidu', (_req, res) => {
  if (!configured()) return res.status(503).json({ error: '请先完成 .env 中的百度网盘应用配置' })
  const requestedReturn = typeof _req.query.return_to === 'string' ? _req.query.return_to : undefined
  const allowedReturns = new Set(['moment://oauth-complete', 'com.jeffrey.moment://oauth-complete'])
  const returnTo = requestedReturn && allowedReturns.has(requestedReturn) ? requestedReturn : undefined
  const state = createOAuthState(res, returnTo)
  const query = new URLSearchParams({
    response_type: 'code', client_id: process.env.BAIDU_APP_KEY!, redirect_uri: process.env.BAIDU_REDIRECT_URI!, scope: 'basic,netdisk', display: 'popup', state,
  })
  res.redirect(`https://openapi.baidu.com/oauth/2.0/authorize?${query}`)
})

app.get('/api/auth/baidu/callback', async (req, res) => {
  try {
    const code = String(req.query.code || '')
    const state = String(req.query.state || '')
    if (!validateOAuthState(req, res, state)) return res.status(400).send('授权状态校验失败，请返回应用重试。')
    if (!code) return res.status(400).send('没有收到授权码。')
    const token = await exchangeCode(code)
    const nativeReturn = consumeOAuthReturn(req, res)
    if (nativeReturn) {
      const returnUrl = new URL(nativeReturn)
      returnUrl.searchParams.set('native_code', createNativeSession(token))
      return res.redirect(returnUrl.toString())
    }
    saveToken(res, token)
    const appOrigin = (process.env.APP_ORIGIN || '').replace(/\/$/, '')
    res.redirect(appOrigin ? `${appOrigin}/?baidu=connected` : '/?baidu=connected')
  } catch (error) {
    res.status(502).send(error instanceof Error ? error.message : '百度授权失败')
  }
})

app.post('/api/auth/baidu/native-session', (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code : ''
  const token = consumeNativeSession(code)
  if (!token) return res.status(400).json({ error: '应用授权凭证已失效，请重新连接百度网盘' })
  saveToken(res, token)
  res.json({ ok: true })
})

app.post('/api/auth/baidu/disconnect', (_req, res) => {
  clearToken(res)
  res.json({ ok: true })
})

app.get('/api/sync/manifest', async (req, res) => {
  try {
    const accessToken = await getValidToken(req, res)
    const download = await downloadByPath(accessToken, manifestPath())
    if (!download) return res.json({ version: 1, notes: [] })
    const text = await download.text()
    const manifest = JSON.parse(text) as { version?: number; notes?: unknown[] }
    res.json({ ...manifest, notes: Array.isArray(manifest.notes) ? manifest.notes : [] })
  } catch (error) {
    sendError(res, error)
  }
})

app.put('/api/sync/manifest', async (req, res) => {
  try {
    const accessToken = await getValidToken(req, res)
    const body = Buffer.from(JSON.stringify(req.body, null, 2))
    const result = await uploadBuffer(accessToken, manifestPath(), body)
    res.json({ ok: true, result })
  } catch (error) {
    sendError(res, error)
  }
})

app.post('/api/sync/upload', upload.single('file'), async (req, res) => {
  const file = req.file
  try {
    if (!file) return res.status(400).json({ error: '缺少上传文件' })
    const accessToken = await getValidToken(req, res)
    const noteId = safeSegment(String(req.body.noteId || 'note'))
    const attachmentId = safeSegment(String(req.body.attachmentId || crypto.randomUUID()))
    const extension = path.extname(file.originalname).slice(0, 12).replace(/[^.a-zA-Z0-9]/g, '')
    const remotePath = `${remoteDir()}/shiguang-${noteId}-${attachmentId}${extension}`
    const result = await uploadFile(accessToken, remotePath, file.path, file.size)
    res.json({ remotePath, result })
  } catch (error) {
    sendError(res, error)
  } finally {
    if (file) await fs.unlink(file.path).catch(() => undefined)
  }
})

app.get('/api/sync/media', async (req, res) => {
  try {
    const accessToken = await getValidToken(req, res)
    const remotePath = String(req.query.path || '')
    const download = await downloadByPath(accessToken, remotePath)
    if (!download?.body) return res.status(404).json({ error: '云端附件不存在' })
    const contentType = download.headers.get('content-type')
    const contentLength = download.headers.get('content-length')
    if (contentType) res.setHeader('Content-Type', contentType)
    if (contentLength) res.setHeader('Content-Length', contentLength)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    Readable.fromWeb(download.body as never).pipe(res)
  } catch (error) {
    sendError(res, error)
  }
})

const distPath = fileURLToPath(new URL('../dist', import.meta.url))
app.use(express.static(distPath))
app.use((_req, res) => res.sendFile(path.join(distPath, 'index.html')))

app.listen(port, () => {
  console.log(`拾光记服务已启动：http://localhost:${port}`)
})

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || crypto.randomUUID()
}

function sendError(res: express.Response, error: unknown) {
  const message = error instanceof Error ? error.message : '服务暂时不可用'
  const status = message.includes('请先连接') ? 401 : 502
  res.status(status).json({ error: message })
}
