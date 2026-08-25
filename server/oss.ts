import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'

export type GetObjectResult = {
  stream: Readable
  contentType?: string
  contentLength?: number
}

export type PutBody = Buffer | { stream: Readable; size: number }

export interface ObjectStorage {
  get(key: string): Promise<GetObjectResult | undefined>
  put(key: string, body: PutBody, options: { contentType: string; contentLength: number }): Promise<void>
}

export function ossConfigured() {
  return Boolean(process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET && process.env.OSS_BUCKET && process.env.OSS_REGION)
}

export function objectPrefix(userId: string) {
  const prefix = (process.env.OSS_PREFIX || 'shiguang').split('/').filter(Boolean).join('/')
  return `${prefix}/${userId}`
}

export function manifestKey(userId: string) {
  return `${objectPrefix(userId)}/.shiguang-manifest-v1.json`
}

export function attachmentKey(userId: string, noteId: string, attachmentId: string, extension: string) {
  return `${objectPrefix(userId)}/shiguang-${noteId}-${attachmentId}${extension}`
}

export function assertOwnedKey(userId: string, key: string) {
  if (key !== manifestKey(userId) && !key.startsWith(`${objectPrefix(userId)}/shiguang-`)) {
    throw new Error('不允许访问同步目录之外的文件')
  }
  if (key.includes('..') || key.includes('\\')) throw new Error('不允许访问同步目录之外的文件')
}

export function remoteDirLabel(userId?: string) {
  if (process.env.SYNC_STORAGE === 'fs' && !ossConfigured()) {
    return userId ? `本地对象/${objectPrefix(userId)}/` : `本地对象/${process.env.OSS_PREFIX || 'shiguang'}/<账号>/`
  }
  const bucket = process.env.OSS_BUCKET || 'bucket'
  return userId ? `oss://${bucket}/${objectPrefix(userId)}/` : `oss://${bucket}/${process.env.OSS_PREFIX || 'shiguang'}/<账号>/`
}

export function createMemoryStorage(): ObjectStorage {
  const objects = new Map<string, { body: Buffer; contentType?: string }>()
  return {
    async get(key) {
      const stored = objects.get(key)
      if (!stored) return undefined
      return {
        stream: Readable.from(stored.body),
        contentType: stored.contentType,
        contentLength: stored.body.length,
      }
    },
    async put(key, body, options) {
      const buffer = await readPutBody(body, options.contentLength)
      objects.set(key, { body: buffer, contentType: options.contentType })
    },
  }
}

export function createFileStorage(root: string): ObjectStorage {
  return {
    async get(key) {
      const target = safePath(root, key)
      try {
        const body = await fs.readFile(target)
        const typeFile = `${target}.type`
        const contentType = await fs.readFile(typeFile, 'utf8').catch(() => undefined)
        return { stream: Readable.from(body), contentType, contentLength: body.length }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
    async put(key, body, options) {
      const target = safePath(root, key)
      await fs.mkdir(path.dirname(target), { recursive: true })
      const buffer = await readPutBody(body, options.contentLength)
      await fs.writeFile(target, buffer)
      if (options.contentType) await fs.writeFile(`${target}.type`, options.contentType)
    },
  }
}

export function createOssStorage(): ObjectStorage {
  if (!ossConfigured()) throw new Error('请先完成 .env 中的阿里云 OSS 配置')
  return {
    async get(key) {
      const response = await ossRequest('GET', key)
      if (response.status === 404) return undefined
      await assertOssOk(response)
      const lengthHeader = response.headers.get('content-length')
      if (!response.body) return undefined
      return {
        stream: Readable.fromWeb(response.body as never),
        contentType: response.headers.get('content-type') || undefined,
        contentLength: lengthHeader ? Number(lengthHeader) : undefined,
      }
    },
    async put(key, body, options) {
      const buffer = await readPutBody(body, options.contentLength)
      const response = await ossRequest('PUT', key, buffer, options.contentType)
      await assertOssOk(response)
    },
  }
}

export function signOssRequest(method: string, resource: string, date: string, contentType = '') {
  const stringToSign = `${method}\n\n${contentType}\n${date}\n${resource}`
  const signature = crypto.createHmac('sha1', process.env.OSS_ACCESS_KEY_SECRET || '').update(stringToSign).digest('base64')
  return `OSS ${process.env.OSS_ACCESS_KEY_ID}:${signature}`
}

function ossBase() {
  const bucket = process.env.OSS_BUCKET || ''
  const endpoint = (process.env.OSS_ENDPOINT || '').replace(/\/$/, '')
  if (endpoint) {
    return { origin: endpoint, pathStyle: true, bucket }
  }
  return { origin: `https://${bucket}.${process.env.OSS_REGION}.aliyuncs.com`, pathStyle: false, bucket }
}

function objectUrl(key: string) {
  const { origin, pathStyle, bucket } = ossBase()
  return pathStyle ? `${origin}/${bucket}/${key}` : `${origin}/${key}`
}

async function ossRequest(method: 'GET' | 'PUT', key: string, body?: Buffer, contentType = '') {
  const date = new Date().toUTCString()
  const resource = `/${process.env.OSS_BUCKET}/${key}`
  const headers: Record<string, string> = {
    Date: date,
    Authorization: signOssRequest(method, resource, date, contentType),
  }
  if (contentType) headers['Content-Type'] = contentType
  if (body) headers['Content-Length'] = String(body.length)
  return fetch(objectUrl(key), { method, headers, body })
}

async function assertOssOk(response: Response) {
  if (response.ok) return
  const text = await response.text().catch(() => '')
  const code = text.match(/<Code>([^<]+)<\/Code>/)?.[1]
  const message = text.match(/<Message>([^<]+)<\/Message>/)?.[1]
  throw new Error(`阿里云 OSS 接口错误：${message || code || `HTTP ${response.status}`}`)
}

async function readPutBody(body: PutBody, contentLength: number) {
  if (Buffer.isBuffer(body)) return body
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of body.stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    chunks.push(buffer)
    size += buffer.length
  }
  if (size !== contentLength) {
    // Allow callers that pass an upper bound from multer; still persist what was read.
  }
  return Buffer.concat(chunks, size)
}

function safePath(root: string, key: string) {
  const resolvedRoot = path.resolve(root)
  const target = path.resolve(resolvedRoot, key)
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('不允许访问同步目录之外的文件')
  }
  return target
}
