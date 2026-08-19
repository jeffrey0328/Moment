import crypto from 'node:crypto'
import type { Request, Response } from 'express'

export interface BaiduToken {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface TokenPayload {
  access_token: string
  refresh_token: string
  expires_in: number
  error?: string
  error_description?: string
}

const TOKEN_COOKIE = 'shiguang_baidu_token'
const STATE_COOKIE = 'shiguang_oauth_state'
const RETURN_COOKIE = 'shiguang_oauth_return'

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

export function createOAuthState(res: Response, returnTo?: string) {
  const state = crypto.randomBytes(24).toString('base64url')
  res.cookie(STATE_COOKIE, state, { ...cookieOptions(), maxAge: 10 * 60 * 1000 })
  if (returnTo) res.cookie(RETURN_COOKIE, returnTo, { ...cookieOptions(), maxAge: 10 * 60 * 1000 })
  return state
}

export function validateOAuthState(req: Request, res: Response, state: string) {
  const expected = req.cookies?.[STATE_COOKIE]
  res.clearCookie(STATE_COOKIE, cookieOptions())
  if (!expected || !state) return false
  const expectedBuffer = Buffer.from(expected)
  const stateBuffer = Buffer.from(state)
  return expectedBuffer.length === stateBuffer.length && crypto.timingSafeEqual(expectedBuffer, stateBuffer)
}

export function consumeOAuthReturn(req: Request, res: Response) {
  const returnTo = req.cookies?.[RETURN_COOKIE] as string | undefined
  res.clearCookie(RETURN_COOKIE, cookieOptions())
  return returnTo
}

export function encodeSession(token: BaiduToken) {
  return encrypt(token)
}

export function readToken(req: Request): BaiduToken | undefined {
  const raw = req.cookies?.[TOKEN_COOKIE]
  if (raw) {
    const token = decrypt<BaiduToken>(raw)
    if (token) return token
  }
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return decrypt<BaiduToken>(header.slice(7).trim())
  return undefined
}

export function saveToken(res: Response, token: BaiduToken) {
  res.cookie(TOKEN_COOKIE, encrypt(token), { ...cookieOptions(), maxAge: 180 * 24 * 60 * 60 * 1000 })
}

export function clearToken(res: Response) {
  res.clearCookie(TOKEN_COOKIE, cookieOptions())
}

export async function exchangeCode(code: string): Promise<BaiduToken> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: process.env.BAIDU_APP_KEY || '',
    client_secret: process.env.BAIDU_SECRET_KEY || '',
    redirect_uri: process.env.BAIDU_REDIRECT_URI || '',
  })
  return tokenRequest(params)
}

export async function getValidToken(req: Request, res: Response) {
  const token = readToken(req)
  if (!token) throw new Error('请先连接百度网盘')
  if (token.expiresAt > Date.now() + 5 * 60 * 1000) return token.accessToken
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
    client_id: process.env.BAIDU_APP_KEY || '',
    client_secret: process.env.BAIDU_SECRET_KEY || '',
  })
  const refreshed = await tokenRequest(params)
  saveToken(res, refreshed)
  return refreshed.accessToken
}

async function tokenRequest(params: URLSearchParams): Promise<BaiduToken> {
  const response = await fetch(`https://openapi.baidu.com/oauth/2.0/token?${params}`)
  const payload = await response.json() as TokenPayload
  if (!response.ok || payload.error || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || '百度授权失败')
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  }
}
