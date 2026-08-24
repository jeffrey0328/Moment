import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeNotes } from '../src/lib/merge.ts'
import type { Note } from '../src/types.ts'

function note(partial: Partial<Note> & Pick<Note, 'id' | 'updatedAt'>): Note {
  return {
    text: '',
    createdAt: partial.updatedAt,
    source: 'typed',
    attachments: [],
    ...partial,
  }
}

test('mergeNotes keeps the newer record and local attachment blobs', () => {
  const local = note({
    id: 'a',
    updatedAt: '2026-08-18T10:00:00.000Z',
    text: '本机旧稿',
    attachments: [{ id: 'img', name: '1.jpg', mime: 'image/jpeg', size: 12, kind: 'image', localKey: 'blob-1' }],
  })
  const remote = note({
    id: 'a',
    updatedAt: '2026-08-18T12:00:00.000Z',
    text: '云端新稿',
    attachments: [{ id: 'img', name: '1.jpg', mime: 'image/jpeg', size: 12, kind: 'image', remotePath: 'shiguang/user-a/shiguang-a-img.jpg' }],
  })

  const [merged] = mergeNotes([local], [remote])
  assert.equal(merged.text, '云端新稿')
  assert.equal(merged.attachments[0]?.localKey, 'blob-1')
  assert.equal(merged.attachments[0]?.remotePath, 'shiguang/user-a/shiguang-a-img.jpg')
})

test('mergeNotes treats a newer tombstone as deleted', () => {
  const local = note({ id: 'b', updatedAt: '2026-08-18T09:00:00.000Z', text: '还在' })
  const remote = note({ id: 'b', updatedAt: '2026-08-18T11:00:00.000Z', text: '还在', deletedAt: '2026-08-18T11:00:00.000Z' })
  const [merged] = mergeNotes([local], [remote])
  assert.equal(merged.deletedAt, '2026-08-18T11:00:00.000Z')
})
