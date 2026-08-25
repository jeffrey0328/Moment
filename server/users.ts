import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const scrypt = promisify(crypto.scrypt)
const USERNAME_PATTERN = /^(?:[\u4e00-\u9fa5]|[a-zA-Z0-9_-]){2,32}$/
const KEY_LENGTH = 64

export type StoredUser = {
  id: string
  username: string
  passwordHash: string
  salt: string
  createdAt: string
}

type UserFile = { users: Record<string, StoredUser> }

let memory: UserFile = { users: {} }
let loaded = false
let queue: Promise<unknown> = Promise.resolve()

function storePaths() {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data')
  return { dir, file: path.join(dir, 'users.json') }
}

export function normalizeUsername(value: string) {
  const trimmed = value.trim()
  if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) return trimmed.toLowerCase()
  return trimmed
}

export function inviteRequired() {
  return Boolean(process.env.SYNC_INVITE_CODE)
}

function inviteMatches(code: unknown) {
  const expected = process.env.SYNC_INVITE_CODE
  if (!expected) return true
  if (typeof code !== 'string' || !code) return false
  const left = Buffer.from(code)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

async function hashPassword(password: string, salt: string) {
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer
  return derived.toString('base64url')
}

async function ensureLoaded() {
  if (loaded) return
  loaded = true
  const { file } = storePaths()
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as UserFile
    memory = { users: parsed.users && typeof parsed.users === 'object' ? parsed.users : {} }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('读取同步账号失败，将使用空账号表', error)
    }
    memory = { users: {} }
  }
}

async function persist() {
  const { dir, file } = storePaths()
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(memory, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

function enqueue<T>(task: () => Promise<T>) {
  const run = queue.then(task, task)
  queue = run.then(() => undefined, () => undefined)
  return run
}

export async function registerUser(username: string, password: string, inviteCode?: unknown) {
  if (!USERNAME_PATTERN.test(username.trim())) throw new Error('用户名需为 2–32 个汉字、字母、数字、下划线或短横线')
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw new Error('密码长度需为 8–128 个字符')
  if (!inviteMatches(inviteCode)) throw new Error('邀请码不正确')

  const normalized = normalizeUsername(username)
  const salt = crypto.randomBytes(16).toString('base64url')
  const passwordHash = await hashPassword(password, salt)
  const user: StoredUser = {
    id: crypto.randomUUID(),
    username: normalized,
    passwordHash,
    salt,
    createdAt: new Date().toISOString(),
  }

  return enqueue(async () => {
    await ensureLoaded()
    if (memory.users[normalized]) throw new Error('该用户名已被注册')
    memory.users[normalized] = user
    await persist()
    return { id: user.id, username: user.username }
  })
}

export async function authenticateUser(username: string, password: string) {
  if (typeof password !== 'string' || !password) throw new Error('用户名或密码不正确')
  const normalized = normalizeUsername(username)
  const dummySalt = 'dummy-salt-for-timing'
  return enqueue(async () => {
    await ensureLoaded()
    const user = memory.users[normalized]
    const hash = await hashPassword(password, user?.salt || dummySalt)
    if (!user || hash !== user.passwordHash) throw new Error('用户名或密码不正确')
    return { id: user.id, username: user.username }
  })
}

export async function resetUserStoreForTests(options?: { deleteFile?: boolean }) {
  await enqueue(async () => {
    memory = { users: {} }
    loaded = false
    if (options?.deleteFile === false) return
    const { file } = storePaths()
    await fs.unlink(file).catch(() => undefined)
  })
}
