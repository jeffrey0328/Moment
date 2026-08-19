import type { Note } from '../types'

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
