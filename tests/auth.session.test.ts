import assert from 'node:assert/strict'
import test from 'node:test'
import type { Request } from 'express'
import { encodeSession, readToken, type BaiduToken } from '../server/auth.ts'

const token: BaiduToken = {
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
  expiresAt: 1_700_000_000_000,
}

test('readToken accepts an encrypted Bearer session for native WebView', () => {
  process.env.APP_SECRET = 'unit-test-app-secret-32-bytes-min'
  const req = {
    cookies: {},
    headers: { authorization: `Bearer ${encodeSession(token)}` },
  } as Request
  assert.deepEqual(readToken(req), token)
})

test('readToken prefers a valid cookie over Authorization', () => {
  process.env.APP_SECRET = 'unit-test-app-secret-32-bytes-min'
  const cookieToken = { ...token, accessToken: 'from-cookie' }
  const req = {
    cookies: { shiguang_baidu_token: encodeSession(cookieToken) },
    headers: { authorization: `Bearer ${encodeSession(token)}` },
  } as Request
  assert.deepEqual(readToken(req), cookieToken)
})
