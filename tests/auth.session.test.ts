import assert from 'node:assert/strict'
import test from 'node:test'
import type { Request } from 'express'
import { encodeSession, readSession, type UserSession } from '../server/auth.ts'

const session: UserSession = {
  userId: 'user-1',
  username: 'alice',
}

test('readSession accepts an encrypted Bearer session for native WebView', () => {
  process.env.APP_SECRET = 'unit-test-app-secret-32-bytes-min'
  const req = {
    cookies: {},
    headers: { authorization: `Bearer ${encodeSession(session)}` },
  } as Request
  assert.deepEqual(readSession(req), session)
})

test('readSession prefers a valid cookie over Authorization', () => {
  process.env.APP_SECRET = 'unit-test-app-secret-32-bytes-min'
  const cookieSession = { ...session, username: 'from-cookie' }
  const req = {
    cookies: { shiguang_session: encodeSession(cookieSession) },
    headers: { authorization: `Bearer ${encodeSession(session)}` },
  } as Request
  assert.deepEqual(readSession(req), cookieSession)
})
