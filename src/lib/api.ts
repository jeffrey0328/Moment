import { Capacitor } from '@capacitor/core'

const configuredBase = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '')

export function apiUrl(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return configuredBase ? `${configuredBase}${normalized}` : normalized
}

export function hasApiEndpoint() {
  if (configuredBase) return true
  if (typeof window !== 'undefined' && window.momentDesktop?.isDesktop) return false
  if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) return false
  return ['http:', 'https:'].includes(window.location.protocol)
}
