import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/app.ts'
import { createMemoryStorage } from '../server/oss.ts'
import { resetUserStoreForTests } from '../server/users.ts'

async function withServer(run: (base: string) => Promise<void>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-api-'))
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    APP_SECRET: process.env.APP_SECRET,
    SYNC_INVITE_CODE: process.env.SYNC_INVITE_CODE,
    SYNC_STORAGE: process.env.SYNC_STORAGE,
  }
  process.env.DATA_DIR = dir
  process.env.APP_SECRET = 'unit-test-app-secret-32-bytes-min'
  delete process.env.SYNC_INVITE_CODE
  delete process.env.SYNC_STORAGE
  await resetUserStoreForTests()
  const app = createApp({ storage: createMemoryStorage() })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await resetUserStoreForTests()
    await fs.rm(dir, { recursive: true, force: true })
    process.env.DATA_DIR = previous.DATA_DIR
    process.env.APP_SECRET = previous.APP_SECRET
    process.env.SYNC_INVITE_CODE = previous.SYNC_INVITE_CODE
    process.env.SYNC_STORAGE = previous.SYNC_STORAGE
  }
}

test('register, upload, and read back a private manifest', async () => {
  await withServer(async (base) => {
    const register = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'carol', password: 'password-1' }),
    })
    assert.equal(register.status, 200)
    const cookie = register.headers.get('set-cookie')
    assert.ok(cookie?.includes('shiguang_session='))
    const payload = await register.json() as { session: string; accountName: string }
    assert.equal(payload.accountName, 'carol')

    const empty = await fetch(`${base}/api/sync/manifest`, { headers: { cookie: cookie! } })
    assert.deepEqual(await empty.json(), { version: 1, notes: [] })

    const saved = await fetch(`${base}/api/sync/manifest`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', cookie: cookie! },
      body: JSON.stringify({ version: 1, notes: [{ id: 'n1', text: 'hello', attachments: [] }] }),
    })
    assert.equal(saved.status, 200)

    const loaded = await fetch(`${base}/api/sync/manifest`, { headers: { cookie: cookie! } })
    const manifest = await loaded.json() as { notes: Array<{ text: string }> }
    assert.equal(manifest.notes[0]?.text, 'hello')

    const other = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'dave', password: 'password-2' }),
    })
    const otherCookie = other.headers.get('set-cookie')
    const otherManifest = await fetch(`${base}/api/sync/manifest`, { headers: { cookie: otherCookie! } })
    assert.deepEqual(await otherManifest.json(), { version: 1, notes: [] })
  })
})
