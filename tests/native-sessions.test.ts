import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { BaiduToken } from '../server/auth.ts'
import { consumeNativeSession, createNativeSession, resetNativeSessionStoreForTests } from '../server/native-sessions.ts'

function sampleToken(suffix: string): BaiduToken {
  return {
    accessToken: `access-${suffix}`,
    refreshToken: `refresh-${suffix}`,
    expiresAt: Date.now() + 60 * 60 * 1000,
  }
}

test('native sessions survive process-local reloads via disk', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-sessions-'))
  process.env.DATA_DIR = dir
  t.after(async () => {
    await resetNativeSessionStoreForTests()
    await fs.rm(dir, { recursive: true, force: true })
  })
  await resetNativeSessionStoreForTests()

  const token = sampleToken('disk')
  const code = await createNativeSession(token)
  await resetNativeSessionStoreForTests({ deleteFile: false })

  const restored = await consumeNativeSession(code)
  assert.deepEqual(restored, token)
  assert.equal(await consumeNativeSession(code), undefined)
})

test('native sessions are one-time and expire from storage', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-sessions-'))
  process.env.DATA_DIR = dir
  t.after(async () => {
    await resetNativeSessionStoreForTests()
    await fs.rm(dir, { recursive: true, force: true })
  })
  await resetNativeSessionStoreForTests()

  const code = await createNativeSession(sampleToken('once'))
  assert.ok(await consumeNativeSession(code))
  assert.equal(await consumeNativeSession(code), undefined)
})
