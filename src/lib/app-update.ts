import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { apiUrl, hasApiEndpoint } from './api'

export type AppPlatform = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'web'

export type AppUpdateManifest = {
  version: string
  notes: string
  publishedAt?: string
  releaseUrl?: string
  source: 'file' | 'feed' | 'github' | 'package'
  downloads: Partial<Record<AppPlatform, string>>
}

export type AppUpdateCheck = {
  current: string
  latest: string
  available: boolean
  notes: string
  releaseUrl?: string
  downloadUrl?: string
  platform: AppPlatform
  inAppInstall: boolean
}

type MomentAppUpdatePlugin = {
  downloadAndInstall(options: { url: string }): Promise<void>
  addListener(eventName: 'progress', listener: (event: { percent: number }) => void): Promise<PluginListenerHandle>
}

const MomentAppUpdate = registerPlugin<MomentAppUpdatePlugin>('MomentAppUpdate')
const DEFAULT_REPO = (import.meta.env.VITE_APP_UPDATE_REPO || 'jeffrey0328/Moment').trim()

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

export function detectAppPlatform(): AppPlatform {
  if (Capacitor.getPlatform() === 'android') return 'android'
  if (Capacitor.getPlatform() === 'ios') return 'ios'
  const desktop = window.momentDesktop
  if (desktop?.isDesktop) {
    if (desktop.platform === 'win32') return 'windows'
    if (desktop.platform === 'darwin') return 'macos'
    return 'linux'
  }
  return 'web'
}

export async function currentAppVersion() {
  try {
    if (Capacitor.isNativePlatform()) {
      const info = await App.getInfo()
      if (info.version) return normalizeVersion(info.version)
    }
  } catch {
    // Fall through to the version baked into the web bundle.
  }
  try {
    if (window.momentDesktop?.getVersion) {
      return normalizeVersion(await window.momentDesktop.getVersion())
    }
  } catch {
    // Fall through to the bundled version.
  }
  return normalizeVersion(__APP_VERSION__)
}

export async function fetchAppUpdateManifest(): Promise<AppUpdateManifest> {
  if (hasApiEndpoint()) {
    try {
      const response = await fetch(apiUrl('/api/app-update'), { credentials: 'include' })
      if (response.ok) return await response.json() as AppUpdateManifest
    } catch {
      // Native packages without a reachable API still check GitHub Releases.
    }
  }
  return fetchGithubLatest()
}

export async function checkAppUpdate(): Promise<AppUpdateCheck> {
  const platform = detectAppPlatform()
  const [current, manifest] = await Promise.all([currentAppVersion(), fetchAppUpdateManifest()])
  const latest = normalizeVersion(manifest.version || current)
  const downloadUrl = manifest.downloads[platform]
  return {
    current,
    latest,
    available: compareVersions(latest, current) > 0,
    notes: manifest.notes || '',
    releaseUrl: manifest.releaseUrl,
    downloadUrl,
    platform,
    inAppInstall: Boolean(downloadUrl) && ['android', 'windows', 'macos', 'linux'].includes(platform),
  }
}

export async function applyAppUpdate(update: AppUpdateCheck, onProgress?: (percent: number) => void) {
  if (update.inAppInstall && update.downloadUrl) {
    await installNativeUpdate(update.platform, update.downloadUrl, onProgress)
    return
  }
  if (update.platform === 'web' && !update.releaseUrl && !update.downloadUrl) {
    window.location.reload()
    return
  }
  const page = update.releaseUrl || update.downloadUrl || `https://github.com/${DEFAULT_REPO}/releases/latest`
  if (Capacitor.isNativePlatform()) {
    await Browser.open({ url: page })
    return
  }
  window.open(page, '_blank', 'noopener')
}

async function installNativeUpdate(platform: AppPlatform, url: string, onProgress?: (percent: number) => void) {
  if (platform === 'android') {
    const handle = await MomentAppUpdate.addListener('progress', (event) => onProgress?.(event.percent))
    try {
      await MomentAppUpdate.downloadAndInstall({ url })
    } finally {
      await handle.remove()
    }
    return
  }
  if (!window.momentDesktop?.installUpdate) throw new Error('当前桌面壳不支持应用内更新')
  const stop = window.momentDesktop.onUpdateProgress?.(onProgress || (() => undefined))
  try {
    await window.momentDesktop.installUpdate(url)
  } finally {
    stop?.()
  }
}

async function fetchGithubLatest(): Promise<AppUpdateManifest> {
  const response = await fetch(`https://api.github.com/repos/${DEFAULT_REPO}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'shiguang-notes-app-update',
    },
  })
  if (response.status === 404) {
    return { version: __APP_VERSION__, notes: '', source: 'package', downloads: {} }
  }
  if (!response.ok) throw new Error('暂时无法检查更新')
  const release = await response.json() as {
    tag_name?: string
    body?: string | null
    html_url?: string
    published_at?: string
    assets?: Array<{ name?: string; browser_download_url?: string }>
  }
  const downloads: AppUpdateManifest['downloads'] = {}
  for (const asset of release.assets || []) {
    const name = String(asset.name || '').toLowerCase()
    const url = asset.browser_download_url
    if (!url) continue
    if (name.endsWith('.apk')) downloads.android = url
    else if (name.endsWith('.exe') && name.includes('windows')) downloads.windows = url
    else if ((name.endsWith('.dmg') || name.endsWith('.pkg')) && (name.includes('mac') || name.includes('darwin'))) downloads.macos = url
    else if ((name.endsWith('.appimage') || name.endsWith('.deb')) && name.includes('linux')) downloads.linux = url
    else if (name.endsWith('.ipa')) downloads.ios = url
  }
  return {
    version: normalizeVersion(String(release.tag_name || '')),
    notes: String(release.body || '').trim(),
    publishedAt: release.published_at,
    releaseUrl: release.html_url,
    source: 'github',
    downloads,
  }
}

function versionParts(value: string) {
  const core = normalizeVersion(value).split('.')
  return [0, 1, 2].map((index) => Number.parseInt(core[index] || '0', 10) || 0)
}
