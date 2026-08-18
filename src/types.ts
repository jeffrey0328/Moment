export type AttachmentKind = 'image' | 'video'

export interface NoteAttachment {
  id: string
  name: string
  mime: string
  size: number
  kind: AttachmentKind
  localKey?: string
  remotePath?: string
}

export interface Note {
  id: string
  text: string
  createdAt: string
  updatedAt: string
  source: 'typed' | 'voice'
  attachments: NoteAttachment[]
  deletedAt?: string
}

export interface CloudStatus {
  configured: boolean
  connected: boolean
  accountName?: string
  remoteDir?: string
}

export type SyncPhase = 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'unconfigured'

