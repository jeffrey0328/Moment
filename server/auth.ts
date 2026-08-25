import crypto from 'node:crypto'
import type { Request, Response } from 'express'

export interface UserSession {
  userId: string
  username: string
}

const SESSION_COOKIE = 'shiguang_session'

function key() {
  const secret = process.env.APP_SECRET
  if (!secret) throw new Error('缺少 APP_SECRET')
  return crypto.createHash('sha256').update(secret).digest()
}

function encrypt(value: object) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

function decrypt<T>(value: string): T | undefined {
  try {
    const data = Buffer.from(value, 'base64url')
    const iv = data.subarray(0, 12)
    const tag = data.subarray(12, 28)
    const encrypted = data.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv)
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString()) as T
  } catch {
    return undefined
  }
}

function cookieOptions() {
  const production = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' as const : 'lax' as const,
    path: '/',
  }
}

export function encodeSession(session: UserSession) {
  return encrypt(session)
}

export function readSession(req: Request): UserSession | undefined {
  const raw = req.cookies?.[SESSION_COOKIE]
  if (raw) {
    const session = decrypt<UserSession>(raw)
    if (session?.userId && session.username) return session
  }
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    const session = decrypt<UserSession>(header.slice(7).trim())
    if (session?.userId && session.username) return session
  }
  return undefined
}

export function saveSession(res: Response, session: UserSession) {
  res.cookie(SESSION_COOKIE, encrypt(session), { ...cookieOptions(), maxAge: 180 * 24 * 60 * 60 * 1000 })
}

export function clearSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions())
}

export function requireSession(req: Request): UserSession {
  const session = readSession(req)
  if (!session) throw new Error('请先登录同步账号')
  return session
}
