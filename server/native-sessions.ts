import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { BaiduToken } from './auth.js'

const TTL_MS = 2 * 60 * 1000

type NativeSession = { token: BaiduToken; expiresAt: number }

let memory = new Map<string, NativeSession>()
let loaded = false
let queue: Promise<unknown> = Promise.resolve()

function storePaths() {
  const dir = process.env.DATA_DIR || path.join(process.cwd(), 'data')
  return { dir, file: path.join(dir, 'native-sessions.json') }
}

function prune(now = Date.now()) {
  for (const [code, session] of memory) {
    if (session.expiresAt <= now) memory.delete(code)
  }
}

async function ensureLoaded() {
  if (loaded) return
  loaded = true
  const { file } = storePaths()
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, NativeSession>
    memory = new Map(Object.entries(parsed).filter(([, session]) => session.expiresAt > Date.now()))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('读取原生授权会话失败，将使用空会话表', error)
    }
    memory = new Map()
  }
}

async function persist() {
  const { dir, file } = storePaths()
  await fs.mkdir(dir, { recursive: true })
  prune()
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(Object.fromEntries(memory)), 'utf8')
  await fs.rename(tmp, file)
}

function enqueue<T>(task: () => Promise<T>) {
  const run = queue.then(task, task)
  queue = run.then(() => undefined, () => undefined)
  return run
}

export async function createNativeSession(token: BaiduToken) {
  const code = crypto.randomBytes(32).toString('base64url')
  await enqueue(async () => {
    await ensureLoaded()
    memory.set(code, { token, expiresAt: Date.now() + TTL_MS })
    await persist()
  })
  return code
}

export async function consumeNativeSession(code: string) {
  return enqueue(async () => {
    await ensureLoaded()
    prune()
    const session = memory.get(code)
    memory.delete(code)
    await persist()
    if (!session || session.expiresAt <= Date.now()) return undefined
    return session.token
  })
}

export async function resetNativeSessionStoreForTests(options?: { deleteFile?: boolean }) {
  await enqueue(async () => {
    memory = new Map()
    loaded = false
    if (options?.deleteFile === false) return
    const { file } = storePaths()
    await fs.unlink(file).catch(() => undefined)
  })
}
