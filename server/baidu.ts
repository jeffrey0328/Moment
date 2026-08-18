import crypto from 'node:crypto'
import fs from 'node:fs/promises'

type BaiduResponse = {
  errno?: number
  errmsg?: string
  error_msg?: string
  request_id?: string | number
}

type FileItem = { fs_id: number | string; path: string; server_filename: string; size: number }
type ListResponse = BaiduResponse & { list?: FileItem[] }
type MetaResponse = BaiduResponse & { list?: Array<FileItem & { dlink: string }> }
type PrecreateResponse = BaiduResponse & { uploadid?: string; return_type?: number; block_list?: number[]; file?: { path: string; fs_id: number } }
type UploadPartResponse = BaiduResponse & { md5?: string }
type CreateResponse = BaiduResponse & { path?: string; fs_id?: number; md5?: string; size?: number }

const API = 'https://pan.baidu.com/rest/2.0/xpan'
const UPLOAD_API = 'https://d.pcs.baidu.com/rest/2.0/pcs/superfile2'
const CHUNK_SIZE = 4 * 1024 * 1024

export function remoteDir() {
  const configured = process.env.BAIDU_REMOTE_DIR || '/apps/拾光记'
  return `/${configured.split('/').filter(Boolean).join('/')}`
}

export function manifestPath() {
  return `${remoteDir()}/.shiguang-manifest-v1.json`
}

export async function listFiles(accessToken: string): Promise<FileItem[]> {
  const query = new URLSearchParams({
    method: 'list', access_token: accessToken, dir: remoteDir(), order: 'time', desc: '1', start: '0', limit: '1000', web: '0',
  })
  const response = await fetch(`${API}/file?${query}`)
  const payload = await response.json() as ListResponse
  assertBaidu(payload, response)
  return payload.list || []
}

export async function downloadByPath(accessToken: string, path: string) {
  if (path !== manifestPath() && !path.startsWith(`${remoteDir()}/shiguang-`)) throw new Error('不允许访问同步目录之外的文件')
  const files = await listFiles(accessToken)
  const file = files.find((item) => item.path === path)
  if (!file) return undefined
  const query = new URLSearchParams({ method: 'filemetas', access_token: accessToken, fsids: JSON.stringify([Number(file.fs_id)]), dlink: '1', extra: '0' })
  const response = await fetch(`${API}/multimedia?${query}`)
  const meta = await response.json() as MetaResponse
  assertBaidu(meta, response)
  const dlink = meta.list?.[0]?.dlink
  if (!dlink) throw new Error('百度网盘未返回下载地址')
  const separator = dlink.includes('?') ? '&' : '?'
  const download = await fetch(`${dlink}${separator}access_token=${encodeURIComponent(accessToken)}`, { headers: { 'User-Agent': 'pan.baidu.com' } })
  if (!download.ok) throw new Error(`下载失败（${download.status}）`)
  return download
}

export async function uploadBuffer(accessToken: string, path: string, buffer: Buffer) {
  return uploadChunks(accessToken, path, buffer.length, async (offset, length) => buffer.subarray(offset, offset + length))
}

export async function uploadFile(accessToken: string, path: string, localPath: string, size: number) {
  const handle = await fs.open(localPath, 'r')
  try {
    return await uploadChunks(accessToken, path, size, async (offset, length) => {
      const buffer = Buffer.alloc(length)
      const result = await handle.read(buffer, 0, length, offset)
      return buffer.subarray(0, result.bytesRead)
    })
  } finally {
    await handle.close()
  }
}

async function uploadChunks(accessToken: string, path: string, size: number, read: (offset: number, length: number) => Promise<Buffer> | Buffer) {
  const chunks: Buffer[] = []
  const hashes: string[] = []
  const count = Math.max(1, Math.ceil(size / CHUNK_SIZE))
  for (let index = 0; index < count; index += 1) {
    const chunk = await read(index * CHUNK_SIZE, Math.min(CHUNK_SIZE, Math.max(0, size - index * CHUNK_SIZE)))
    chunks.push(chunk)
    hashes.push(crypto.createHash('md5').update(chunk).digest('hex'))
  }

  const preForm = new URLSearchParams({ path, size: String(size), isdir: '0', autoinit: '1', rtype: '3', block_list: JSON.stringify(hashes) })
  const preResponse = await fetch(`${API}/file?method=precreate&access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: preForm,
  })
  const pre = await preResponse.json() as PrecreateResponse
  assertBaidu(pre, preResponse)
  if (pre.return_type === 2 && pre.file) return pre.file
  if (!pre.uploadid) throw new Error('百度网盘未返回 uploadid')

  const uploadedHashes: string[] = []
  for (let index = 0; index < chunks.length; index += 1) {
    const query = new URLSearchParams({ method: 'upload', access_token: accessToken, type: 'tmpfile', path, uploadid: pre.uploadid, partseq: String(index) })
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(chunks[index])]), `part-${index}`)
    const response = await fetch(`${UPLOAD_API}?${query}`, { method: 'POST', body: form })
    const payload = await response.json() as UploadPartResponse
    assertBaidu(payload, response)
    uploadedHashes.push(payload.md5 || hashes[index])
  }

  const createForm = new URLSearchParams({ path, size: String(size), isdir: '0', rtype: '3', uploadid: pre.uploadid, block_list: JSON.stringify(uploadedHashes) })
  const createResponse = await fetch(`${API}/file?method=create&access_token=${encodeURIComponent(accessToken)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: createForm,
  })
  const created = await createResponse.json() as CreateResponse
  assertBaidu(created, createResponse)
  return created
}

function assertBaidu(payload: BaiduResponse, response: Response) {
  if (!response.ok || (typeof payload.errno === 'number' && payload.errno !== 0)) {
    const detail = payload.errmsg || payload.error_msg || `HTTP ${response.status}`
    throw new Error(`百度网盘接口错误：${detail}${payload.errno !== undefined ? `（${payload.errno}）` : ''}`)
  }
}

