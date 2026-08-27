import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import { clearSession, encodeSession, readSession, requireSession, saveSession, type UserSession } from './auth.js'
import { authenticateUser, inviteRequired, registerUser } from './users.js'
import { resolveAppUpdate } from './app-update.js'
import {
  assertOwnedKey,
  attachmentKey,
  createFileStorage,
  createOssStorage,
  manifestKey,
  ossConfigured,
  remoteDirLabel,
  type ObjectStorage,
} from './oss.js'

export type CreateAppOptions = {
  storage?: ObjectStorage
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express()
  const upload = multer({ dest: os.tmpdir(), limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 512) * 1024 * 1024 } })
  let fileStorage: ObjectStorage | undefined
  let ossStorage: ObjectStorage | undefined

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
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS')
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })
  app.use(cookieParser())
  app.use(express.json({ limit: '12mb' }))

  const configured = () => Boolean(process.env.APP_SECRET) && (Boolean(options.storage) || process.env.SYNC_STORAGE === 'fs' || ossConfigured())

  function getStorage(): ObjectStorage {
    if (options.storage) return options.storage
    if (process.env.SYNC_STORAGE === 'fs') {
      fileStorage ||= createFileStorage(path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'objects'))
      return fileStorage
    }
    ossStorage ||= createOssStorage()
    return ossStorage
  }

  function statusPayload(req: express.Request) {
    const session = configured() ? readSession(req) : undefined
    return {
      configured: configured(),
      connected: Boolean(session),
      accountName: session?.username,
      remoteDir: remoteDirLabel(session?.userId),
      inviteRequired: inviteRequired(),
    }
  }

  function sendSession(res: express.Response, user: { id: string; username: string }) {
    const session: UserSession = { userId: user.id, username: user.username }
    saveSession(res, session)
    return res.json({
      ok: true,
      session: encodeSession(session),
      accountName: user.username,
      remoteDir: remoteDirLabel(user.id),
    })
  }

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })

  app.get('/api/app-update', async (_req, res) => {
    try {
      res.json(await resolveAppUpdate())
    } catch (error) {
      sendError(res, error)
    }
  })

  app.get('/api/status', (req, res) => {
    res.json(statusPayload(req))
  })

  app.post('/api/auth/register', async (req, res) => {
    try {
      if (!configured()) return res.status(503).json({ error: '请先完成 .env 中的阿里云 OSS 配置' })
      const user = await registerUser(String(req.body?.username || ''), String(req.body?.password || ''), req.body?.inviteCode)
      sendSession(res, user)
    } catch (error) {
      sendAuthError(res, error)
    }
  })

  app.post('/api/auth/login', async (req, res) => {
    try {
      if (!configured()) return res.status(503).json({ error: '请先完成 .env 中的阿里云 OSS 配置' })
      const user = await authenticateUser(String(req.body?.username || ''), String(req.body?.password || ''))
      sendSession(res, user)
    } catch (error) {
      sendAuthError(res, error)
    }
  })

  app.post('/api/auth/logout', (_req, res) => {
    clearSession(res)
    res.json({ ok: true })
  })

  app.get('/api/sync/manifest', async (req, res) => {
    try {
      const session = requireSession(req)
      const download = await getStorage().get(manifestKey(session.userId))
      if (!download) return res.json({ version: 1, notes: [] })
      const text = await streamToString(download.stream)
      const manifest = JSON.parse(text) as { version?: number; notes?: unknown[] }
      res.json({ ...manifest, notes: Array.isArray(manifest.notes) ? manifest.notes : [] })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.put('/api/sync/manifest', async (req, res) => {
    try {
      const session = requireSession(req)
      const body = Buffer.from(JSON.stringify(req.body, null, 2))
      await getStorage().put(manifestKey(session.userId), body, { contentType: 'application/json', contentLength: body.length })
      res.json({ ok: true })
    } catch (error) {
      sendError(res, error)
    }
  })

  app.post('/api/sync/upload', upload.single('file'), async (req, res) => {
    const file = req.file
    try {
      if (!file) return res.status(400).json({ error: '缺少上传文件' })
      const session = requireSession(req)
      const noteId = safeSegment(String(req.body.noteId || 'note'))
      const attachmentId = safeSegment(String(req.body.attachmentId || crypto.randomUUID()))
      const extension = path.extname(file.originalname).slice(0, 12).replace(/[^.a-zA-Z0-9]/g, '')
      const remotePath = attachmentKey(session.userId, noteId, attachmentId, extension)
      const body = await fs.readFile(file.path)
      await getStorage().put(remotePath, body, {
        contentType: file.mimetype || 'application/octet-stream',
        contentLength: body.length,
      })
      res.json({ remotePath })
    } catch (error) {
      sendError(res, error)
    } finally {
      if (file) await fs.unlink(file.path).catch(() => undefined)
    }
  })

  app.get('/api/sync/media', async (req, res) => {
    try {
      const session = requireSession(req)
      const remotePath = String(req.query.path || '')
      assertOwnedKey(session.userId, remotePath)
      const download = await getStorage().get(remotePath)
      if (!download) return res.status(404).json({ error: '云端附件不存在' })
      if (download.contentType) res.setHeader('Content-Type', download.contentType)
      if (download.contentLength) res.setHeader('Content-Length', String(download.contentLength))
      res.setHeader('Cache-Control', 'private, max-age=3600')
      download.stream.pipe(res)
    } catch (error) {
      sendError(res, error)
    }
  })

  return app
}

export function attachStatic(app: express.Express) {
  const distDir = fileURLToPath(new URL('../dist', import.meta.url))
  app.use(express.static(distDir))
  app.use((_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || crypto.randomUUID()
}

function sendAuthError(res: express.Response, error: unknown) {
  const message = error instanceof Error ? error.message : '登录失败'
  const status = message.includes('已被注册') ? 409
    : message.includes('邀请码') ? 403
      : message.includes('用户名需') || message.includes('密码长度') ? 400
        : message.includes('用户名或密码') ? 401
          : 400
  res.status(status).json({ error: message })
}

function sendError(res: express.Response, error: unknown) {
  const message = error instanceof Error ? error.message : '服务暂时不可用'
  const status = message.includes('请先登录') ? 401 : 502
  res.status(status).json({ error: message })
}

async function streamToString(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}
