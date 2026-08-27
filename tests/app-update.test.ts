import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AddressInfo } from 'node:net'
import { createApp } from '../server/app.ts'
import { createMemoryStorage } from '../server/oss.ts'
import {
  compareVersions,
  downloadsFromAssets,
  manifestFromGithub,
  resetAppUpdateCacheForTests,
  resolveAppUpdate,
} from '../server/app-update.ts'
import { resetUserStoreForTests } from '../server/users.ts'

test('compareVersions orders dotted versions', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0)
  assert.equal(compareVersions('v1.2.0', '1.1.9') > 0, true)
  assert.equal(compareVersions('1.0.10', '1.0.9') > 0, true)
  assert.equal(compareVersions('1.0.0-beta', '1.0.1') < 0, true)
})

test('downloadsFromAssets maps GitHub release files to platforms', () => {
  const downloads = downloadsFromAssets([
    { name: 'Moment-1.2.3-Android.apk', browser_download_url: 'https://example.com/android.apk' },
    { name: 'Moment-1.2.3-Windows-x64.exe', browser_download_url: 'https://example.com/windows.exe' },
    { name: 'Moment-1.2.3-Windows-x64.exe.blockmap', browser_download_url: 'https://example.com/windows.exe.blockmap' },
    { name: 'latest.yml', browser_download_url: 'https://example.com/latest.yml' },
    { name: 'Moment-1.2.3-macOS-arm64.dmg', browser_download_url: 'https://example.com/mac.dmg' },
    { name: 'Moment-1.2.3-Linux-x64.AppImage', browser_download_url: 'https://example.com/linux.AppImage' },
  ])
  assert.equal(downloads.android, 'https://example.com/android.apk')
  assert.equal(downloads.windows, 'https://example.com/windows.exe')
  assert.equal(downloads.macos, 'https://example.com/mac.dmg')
  assert.equal(downloads.linux, 'https://example.com/linux.AppImage')
})

test('manifestFromGithub strips the v prefix and keeps release notes', () => {
  const manifest = manifestFromGithub({
    tag_name: 'v2.0.1',
    body: '修复同步失败',
    html_url: 'https://github.com/jeffrey0328/Moment/releases/tag/v2.0.1',
    published_at: '2026-08-27T00:00:00Z',
    assets: [{ name: 'Moment-2.0.1-Android.apk', browser_download_url: 'https://example.com/app.apk' }],
  })
  assert.equal(manifest.version, '2.0.1')
  assert.equal(manifest.notes, '修复同步失败')
  assert.equal(manifest.source, 'github')
  assert.equal(manifest.downloads.android, 'https://example.com/app.apk')
})

test('resolveAppUpdate prefers DATA_DIR/app-update.json', async () => {
  resetAppUpdateCacheForTests()
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-update-'))
  await fs.writeFile(path.join(dir, 'app-update.json'), JSON.stringify({
    version: '9.9.9',
    notes: '本地覆盖',
    downloads: { android: 'https://cdn.example.com/Moment.apk' },
  }))
  try {
    const manifest = await resolveAppUpdate({
      dataDir: dir,
      packageVersion: '1.0.0',
      fetchImpl: async () => { throw new Error('should not hit network') },
    })
    assert.equal(manifest.version, '9.9.9')
    assert.equal(manifest.source, 'file')
    assert.equal(manifest.downloads.android, 'https://cdn.example.com/Moment.apk')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('resolveAppUpdate reads GitHub latest when no local override exists', async () => {
  resetAppUpdateCacheForTests()
  const manifest = await resolveAppUpdate({
    packageVersion: '1.0.0',
    repo: 'jeffrey0328/Moment',
    fetchImpl: async (input) => {
      assert.match(String(input), /repos\/jeffrey0328\/Moment\/releases\/latest/)
      return new Response(JSON.stringify({
        tag_name: 'v1.4.0',
        body: '应用内更新',
        html_url: 'https://github.com/jeffrey0328/Moment/releases/tag/v1.4.0',
        assets: [
          { name: 'Moment-1.4.0-Android.apk', browser_download_url: 'https://github.com/jeffrey0328/Moment/releases/download/v1.4.0/Moment-1.4.0-Android.apk' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })
  assert.equal(manifest.version, '1.4.0')
  assert.equal(manifest.source, 'github')
  assert.ok(manifest.downloads.android?.endsWith('.apk'))
})

test('resolveAppUpdate falls back to package version when GitHub has no release', async () => {
  resetAppUpdateCacheForTests()
  const manifest = await resolveAppUpdate({
    packageVersion: '1.0.0',
    fetchImpl: async () => new Response('Not Found', { status: 404 }),
  })
  assert.equal(manifest.version, '1.0.0')
  assert.equal(manifest.source, 'package')
})

test('GET /api/app-update returns the local override', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moment-api-update-'))
  const previous = {
    DATA_DIR: process.env.DATA_DIR,
    APP_SECRET: process.env.APP_SECRET,
  }
  process.env.DATA_DIR = dir
  process.env.APP_SECRET = 'unit-test-app-secret-32-bytes-min'
  await resetUserStoreForTests()
  resetAppUpdateCacheForTests()
  await fs.writeFile(path.join(dir, 'app-update.json'), JSON.stringify({
    version: '3.2.1',
    notes: '接口测试',
    releaseUrl: 'https://example.com/releases/3.2.1',
    downloads: { windows: 'https://example.com/Moment-3.2.1-Windows-x64.exe' },
  }))
  const app = createApp({ storage: createMemoryStorage() })
  const server = http.createServer(app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/app-update`)
    assert.equal(response.status, 200)
    const body = await response.json() as { version: string; source: string; downloads: { windows?: string } }
    assert.equal(body.version, '3.2.1')
    assert.equal(body.source, 'file')
    assert.equal(body.downloads.windows, 'https://example.com/Moment-3.2.1-Windows-x64.exe')
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    await resetUserStoreForTests()
    await fs.rm(dir, { recursive: true, force: true })
    process.env.DATA_DIR = previous.DATA_DIR
    process.env.APP_SECRET = previous.APP_SECRET
    resetAppUpdateCacheForTests()
  }
})
