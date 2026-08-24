import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import { attachmentKey, assertOwnedKey, createOssStorage, manifestKey, objectPrefix, signOssRequest } from '../server/oss.ts'

test('object keys stay under the account prefix', () => {
  process.env.OSS_PREFIX = 'shiguang'
  const userId = '11111111-1111-1111-1111-111111111111'
  assert.equal(objectPrefix(userId), 'shiguang/11111111-1111-1111-1111-111111111111')
  assert.equal(manifestKey(userId), 'shiguang/11111111-1111-1111-1111-111111111111/.shiguang-manifest-v1.json')
  assert.equal(attachmentKey(userId, 'note', 'img', '.jpg'), 'shiguang/11111111-1111-1111-1111-111111111111/shiguang-note-img.jpg')
  assert.doesNotThrow(() => assertOwnedKey(userId, manifestKey(userId)))
  assert.throws(() => assertOwnedKey(userId, 'shiguang/other/.shiguang-manifest-v1.json'), /不允许访问/)
  assert.throws(() => assertOwnedKey(userId, `${objectPrefix(userId)}/../secret`), /不允许访问/)
})

test('createOssStorage signs requests and round-trips objects', async (t) => {
  process.env.OSS_REGION = 'oss-cn-hangzhou'
  process.env.OSS_BUCKET = 'shiguang-test'
  process.env.OSS_ACCESS_KEY_ID = 'testid'
  process.env.OSS_ACCESS_KEY_SECRET = 'testsecret'
  process.env.OSS_PREFIX = 'shiguang'
  const objects = new Map<string, Buffer>()

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    const key = decodeURIComponent(url.pathname.replace(/^\/shiguang-test\//, ''))
    const date = String(req.headers.date || '')
    const contentType = String(req.headers['content-type'] || '')
    const expected = signOssRequest(req.method || 'GET', `/shiguang-test/${key}`, date, contentType)
    if (req.headers.authorization !== expected) {
      res.statusCode = 403
      res.end('<Error><Code>SignatureDoesNotMatch</Code><Message>bad signature</Message></Error>')
      return
    }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        objects.set(key, Buffer.concat(chunks))
        res.statusCode = 200
        res.end()
      })
      return
    }
    const body = objects.get(key)
    if (!body) {
      res.statusCode = 404
      res.end('<Error><Code>NoSuchKey</Code></Error>')
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/plain')
    res.end(body)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('mock OSS did not bind a port')
  process.env.OSS_ENDPOINT = `http://127.0.0.1:${address.port}`
  t.after(() => {
    server.close()
    delete process.env.OSS_ENDPOINT
  })

  const storage = createOssStorage()
  const key = 'shiguang/user/.shiguang-manifest-v1.json'
  await storage.put(key, Buffer.from('{"notes":[]}'), { contentType: 'application/json', contentLength: 12 })
  const got = await storage.get(key)
  assert.ok(got)
  const chunks: Buffer[] = []
  for await (const chunk of got.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  assert.equal(Buffer.concat(chunks).toString(), '{"notes":[]}')
  assert.equal(await storage.get('missing'), undefined)
})
