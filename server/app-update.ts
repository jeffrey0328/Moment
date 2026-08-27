import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type AppUpdatePlatform = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'web'

export type AppUpdateManifest = {
  version: string
  notes: string
  publishedAt?: string
  releaseUrl?: string
  source: 'file' | 'feed' | 'github' | 'package'
  downloads: Partial<Record<AppUpdatePlatform, string>>
}

export type GithubReleaseAsset = {
  name?: string
  browser_download_url?: string
}

export type GithubRelease = {
  tag_name?: string
  body?: string | null
  html_url?: string
  published_at?: string
  assets?: GithubReleaseAsset[]
}

export type ResolveAppUpdateOptions = {
  dataDir?: string
  feedUrl?: string
  repo?: string
  githubToken?: string
  packageVersion?: string
  fetchImpl?: typeof fetch
  now?: () => number
}

type CacheEntry = { expiresAt: number; manifest: AppUpdateManifest }

const CACHE_MS = 10 * 60 * 1000
let cache: CacheEntry | undefined

export function resetAppUpdateCacheForTests() {
  cache = undefined
}

export function normalizeVersion(value: string) {
  return value.trim().replace(/^v/i, '').split(/[+-]/)[0] || '0.0.0'
}

export function compareVersions(left: string, right: string) {
  const a = versionParts(left)
  const b = versionParts(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1
    if (a[index] < b[index]) return -1
  }
  return 0
}

export function pickDownloadUrl(assets: GithubReleaseAsset[] | undefined, platform: AppUpdatePlatform) {
  const files = (assets || []).filter((asset) => {
    const name = String(asset.name || '').toLowerCase()
    const url = String(asset.browser_download_url || '')
    return Boolean(url) && !name.endsWith('.blockmap') && !name.endsWith('.yml') && !name.endsWith('.yaml')
  })
  const match = files.find((asset) => assetMatchesPlatform(String(asset.name || ''), platform))
  return match?.browser_download_url
}

export function downloadsFromAssets(assets: GithubReleaseAsset[] | undefined) {
  const downloads: AppUpdateManifest['downloads'] = {}
  const platforms: AppUpdatePlatform[] = ['android', 'windows', 'macos', 'linux', 'ios']
  for (const platform of platforms) {
    const url = pickDownloadUrl(assets, platform)
    if (url) downloads[platform] = url
  }
  return downloads
}

export function manifestFromGithub(release: GithubRelease): AppUpdateManifest {
  return {
    version: normalizeVersion(String(release.tag_name || '')),
    notes: String(release.body || '').trim(),
    publishedAt: release.published_at,
    releaseUrl: release.html_url,
    source: 'github',
    downloads: downloadsFromAssets(release.assets),
  }
}

export async function resolveAppUpdate(options: ResolveAppUpdateOptions = {}): Promise<AppUpdateManifest> {
  const now = options.now?.() ?? Date.now()
  const packageVersion = options.packageVersion || await readPackageVersion()
  const fallback: AppUpdateManifest = {
    version: packageVersion,
    notes: '',
    source: 'package',
    downloads: {},
  }

  const dataDir = options.dataDir || process.env.DATA_DIR || path.join(process.cwd(), 'data')
  const fromFile = await readLocalManifest(dataDir)
  if (fromFile) return fromFile

  const feedUrl = options.feedUrl || process.env.APP_UPDATE_FEED?.trim()
  if (feedUrl) {
    try {
      const fromFeed = await readFeedManifest(feedUrl, options.fetchImpl || fetch)
      return remember(fromFeed, now, options)
    } catch {
      // Continue to GitHub / package version if the custom feed is unreachable.
    }
  }

  if (cache && cache.expiresAt > now && !options.fetchImpl) return cache.manifest

  const repo = (options.repo || process.env.APP_UPDATE_REPO || 'jeffrey0328/Moment').trim()
  try {
    const fromGithub = await readGithubManifest(repo, options)
    if (fromGithub.version) return remember(fromGithub, now, options)
  } catch {
    // No GitHub release yet, or the API is rate-limited.
  }

  return remember(fallback, now, options)
}

function remember(manifest: AppUpdateManifest, now: number, options: ResolveAppUpdateOptions) {
  if (!options.fetchImpl && !options.dataDir && !options.feedUrl) {
    cache = { expiresAt: now + CACHE_MS, manifest }
  }
  return manifest
}

function versionParts(value: string) {
  const core = normalizeVersion(value).split('.')
  return [0, 1, 2].map((index) => Number.parseInt(core[index] || '0', 10) || 0)
}

function assetMatchesPlatform(name: string, platform: AppUpdatePlatform) {
  const lower = name.toLowerCase()
  if (platform === 'android') return lower.endsWith('.apk') && (lower.includes('android') || lower.includes('apk'))
  if (platform === 'windows') return lower.endsWith('.exe') && lower.includes('windows')
  if (platform === 'macos') return (lower.endsWith('.dmg') || lower.endsWith('.pkg')) && (lower.includes('mac') || lower.includes('darwin') || lower.includes('osx'))
  if (platform === 'linux') return (lower.endsWith('.appimage') || lower.endsWith('.deb')) && lower.includes('linux')
  if (platform === 'ios') return lower.endsWith('.ipa')
  return false
}

async function readPackageVersion() {
  try {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url))
    const raw = await fs.readFile(pkgPath, 'utf8')
    const pkg = JSON.parse(raw) as { version?: string }
    return pkg.version || '0.0.0'
  } catch {
    return process.env.npm_package_version || '0.0.0'
  }
}

async function readLocalManifest(dataDir?: string) {
  if (!dataDir) return undefined
  try {
    const raw = await fs.readFile(path.join(dataDir, 'app-update.json'), 'utf8')
    return normalizeManifest(JSON.parse(raw), 'file')
  } catch {
    return undefined
  }
}

async function readFeedManifest(feedUrl: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl(feedUrl, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`更新源返回 ${response.status}`)
  return normalizeManifest(await response.json(), 'feed')
}

async function readGithubManifest(repo: string, options: ResolveAppUpdateOptions) {
  const fetchImpl = options.fetchImpl || fetch
  const token = options.githubToken || process.env.APP_UPDATE_GITHUB_TOKEN || process.env.GITHUB_TOKEN
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'shiguang-notes-app-update',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, { headers })
  if (response.status === 404) {
    return { version: '', notes: '', source: 'github' as const, downloads: {} }
  }
  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)
  const release = await response.json() as GithubRelease
  return manifestFromGithub(release)
}

function normalizeManifest(raw: unknown, source: AppUpdateManifest['source']): AppUpdateManifest {
  const value = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  const downloadsRaw = (value.downloads && typeof value.downloads === 'object') ? value.downloads as Record<string, unknown> : {}
  const downloads: AppUpdateManifest['downloads'] = {}
  for (const platform of ['android', 'ios', 'windows', 'macos', 'linux', 'web'] as AppUpdatePlatform[]) {
    const url = downloadsRaw[platform]
    if (typeof url === 'string' && url.startsWith('https://')) downloads[platform] = url
  }
  return {
    version: normalizeVersion(String(value.version || '')),
    notes: String(value.notes || '').trim(),
    publishedAt: typeof value.publishedAt === 'string' ? value.publishedAt : undefined,
    releaseUrl: typeof value.releaseUrl === 'string' ? value.releaseUrl : undefined,
    source,
    downloads,
  }
}
