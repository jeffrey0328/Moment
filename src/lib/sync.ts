import { getAllNotesIncludingDeleted, getAttachmentBlob, putNote, putNotes, setMeta } from './db'
import type { CloudStatus, Note } from '../types'
import { apiUrl, hasApiEndpoint, oauthReturnUrl } from './api'
import { isNativeMobile, mobileOAuthReturnUrl, openMobileOAuth } from './native'

const MANIFEST_VERSION = 1

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  if (!hasApiEndpoint()) throw new Error('原生安装包尚未配置同步后端地址')
  const response = await fetch(apiUrl(url), { credentials: 'include', ...options })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error || `请求失败（${response.status}）`)
  }
  return response.json() as Promise<T>
}

export function getCloudStatus() {
  if (!hasApiEndpoint()) return Promise.resolve<CloudStatus>({ configured: false, connected: false })
  return api<CloudStatus>('/api/status')
}

export function connectBaidu() {
  const returnTo = oauthReturnUrl() || mobileOAuthReturnUrl()
  const target = new URL(apiUrl('/api/auth/baidu'), window.location.href)
  if (returnTo) target.searchParams.set('return_to', returnTo)
  if (window.momentDesktop?.isDesktop) window.open(target.toString(), '_blank', 'noopener,noreferrer')
  else if (isNativeMobile()) void openMobileOAuth(target.toString())
  else window.location.href = target.toString()
}

export async function disconnectBaidu() {
  await api('/api/auth/baidu/disconnect', { method: 'POST' })
}

export async function syncNow(onProgress?: (value: number) => void): Promise<Note[]> {
  if (!navigator.onLine) throw new Error('当前离线，内容已保存在本机')

  const local = await getAllNotesIncludingDeleted()
  const remote = await api<{ notes: Note[]; updatedAt?: string }>('/api/sync/manifest')
  const merged = mergeNotes(local, remote.notes || [])
  await putNotes(merged)

  const active = merged.filter((note) => !note.deletedAt)
  let completed = 0
  const total = active.reduce((count, note) => count + note.attachments.filter((item) => item.localKey && !item.remotePath).length, 0)

  for (const note of active) {
    let changed = false
    for (const attachment of note.attachments) {
      if (!attachment.localKey || attachment.remotePath) continue
      const blob = await getAttachmentBlob(attachment.localKey)
      if (!blob) continue
      const form = new FormData()
      form.append('file', blob, attachment.name)
      form.append('noteId', note.id)
      form.append('attachmentId', attachment.id)
      const result = await api<{ remotePath: string }>('/api/sync/upload', { method: 'POST', body: form })
      attachment.remotePath = result.remotePath
      completed += 1
      onProgress?.(total ? Math.round(completed / total * 90) : 90)
      changed = true
    }
    if (changed) await putNote(note)
  }

  const manifest = {
    version: MANIFEST_VERSION,
    updatedAt: new Date().toISOString(),
    notes: merged.map(stripLocalFields),
  }
  await api('/api/sync/manifest', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(manifest),
  })
  await setMeta('lastSyncAt', manifest.updatedAt)
  onProgress?.(100)
  return merged.filter((note) => !note.deletedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function stripLocalFields(note: Note): Note {
  return {
    ...note,
    attachments: note.attachments.map(({ localKey: _localKey, ...attachment }) => attachment),
  }
}

export function mergeNotes(local: Note[], remote: Note[]) {
  const map = new Map<string, Note>()
  for (const note of [...local, ...remote]) {
    const current = map.get(note.id)
    if (!current || note.updatedAt > current.updatedAt) {
      const localMatch = local.find((item) => item.id === note.id)
      map.set(note.id, {
        ...note,
        attachments: note.attachments.map((attachment) => {
          const localAttachment = localMatch?.attachments.find((item) => item.id === attachment.id)
          return { ...attachment, localKey: localAttachment?.localKey, remotePath: attachment.remotePath || localAttachment?.remotePath }
        }),
      })
    }
  }
  return [...map.values()]
}
