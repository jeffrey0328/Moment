const configuredBase = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '')

export function apiUrl(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return configuredBase ? `${configuredBase}${normalized}` : normalized
}

export function hasApiEndpoint() {
  return Boolean(configuredBase) || ['http:', 'https:'].includes(window.location.protocol)
}

export function oauthReturnUrl() {
  if (window.momentDesktop?.isDesktop) return 'moment://oauth-complete'
  return undefined
}
