import type { Note } from '../types'

const DB_NAME = 'shiguang-notes'
const DB_VERSION = 1
const NOTES = 'notes'
const BLOBS = 'blobs'
const META = 'meta'

let dbPromise: Promise<IDBDatabase> | null = null

function openDatabase() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(NOTES)) db.createObjectStore(NOTES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS)
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return dbPromise
}

async function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function listNotes(): Promise<Note[]> {
  const db = await openDatabase()
  const tx = db.transaction(NOTES, 'readonly')
  const notes = await requestResult(tx.objectStore(NOTES).getAll() as IDBRequest<Note[]>)
  return notes.filter((note) => !note.deletedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function putNote(note: Note) {
  const db = await openDatabase()
  const tx = db.transaction(NOTES, 'readwrite')
  tx.objectStore(NOTES).put(note)
  await transactionDone(tx)
}

export async function putNotes(notes: Note[]) {
  const db = await openDatabase()
  const tx = db.transaction(NOTES, 'readwrite')
  const store = tx.objectStore(NOTES)
  notes.forEach((note) => store.put(note))
  await transactionDone(tx)
}

export async function getAllNotesIncludingDeleted(): Promise<Note[]> {
  const db = await openDatabase()
  return requestResult(db.transaction(NOTES, 'readonly').objectStore(NOTES).getAll() as IDBRequest<Note[]>)
}

export async function putAttachmentBlob(key: string, blob: Blob) {
  const db = await openDatabase()
  const tx = db.transaction(BLOBS, 'readwrite')
  tx.objectStore(BLOBS).put(blob, key)
  await transactionDone(tx)
}

export async function getAttachmentBlob(key: string): Promise<Blob | undefined> {
  const db = await openDatabase()
  return requestResult(db.transaction(BLOBS, 'readonly').objectStore(BLOBS).get(key))
}

export async function setMeta<T>(key: string, value: T) {
  const db = await openDatabase()
  const tx = db.transaction(META, 'readwrite')
  tx.objectStore(META).put(value, key)
  await transactionDone(tx)
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDatabase()
  return requestResult(db.transaction(META, 'readonly').objectStore(META).get(key))
}

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

