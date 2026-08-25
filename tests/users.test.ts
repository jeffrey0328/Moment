import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { authenticateUser, registerUser, resetUserStoreForTests } from '../server/users.ts'

test('registerUser persists accounts and rejects duplicates', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-users-'))
  process.env.DATA_DIR = dir
  delete process.env.SYNC_INVITE_CODE
  t.after(async () => {
    await resetUserStoreForTests()
    await fs.rm(dir, { recursive: true, force: true })
  })
  await resetUserStoreForTests()

  const created = await registerUser('Alice', 'password-1')
  assert.equal(created.username, 'alice')
  await resetUserStoreForTests({ deleteFile: false })

  await assert.rejects(() => registerUser('alice', 'password-2'), /已被注册/)
  const user = await authenticateUser('Alice', 'password-1')
  assert.equal(user.id, created.id)
  await assert.rejects(() => authenticateUser('alice', 'wrong-password'), /用户名或密码不正确/)
})

test('registerUser requires invite code when configured', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-users-'))
  process.env.DATA_DIR = dir
  process.env.SYNC_INVITE_CODE = 'secret-invite'
  t.after(async () => {
    delete process.env.SYNC_INVITE_CODE
    await resetUserStoreForTests()
    await fs.rm(dir, { recursive: true, force: true })
  })
  await resetUserStoreForTests()

  await assert.rejects(() => registerUser('bob', 'password-1'), /邀请码不正确/)
  const created = await registerUser('bob', 'password-1', 'secret-invite')
  assert.equal(created.username, 'bob')
})
