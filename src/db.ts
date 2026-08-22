import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { DocRecord, DocSummary, Highlight, Note, Tag } from './types'

interface Schema extends DBSchema {
  docs: {
    key: string
    value: DocRecord
    indexes: { 'by-last-opened': number }
  }
  notes: {
    key: string
    value: Note
    indexes: { 'by-doc': string }
  }
  highlights: {
    key: string
    value: Highlight
    indexes: { 'by-doc': string }
  }
  /** Small key/value bag. Holds the sync folder handle, which IndexedDB can
   *  store directly - a FileSystemDirectoryHandle is structured-cloneable. */
  settings: {
    key: string
    value: unknown
  }
}

const DB_NAME = 'pdf-note-app'
const DB_VERSION = 2

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null

function db() {
  dbPromise ??= openDB<Schema>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        const docs = database.createObjectStore('docs', { keyPath: 'id' })
        docs.createIndex('by-last-opened', 'lastOpenedAt')

        const notes = database.createObjectStore('notes', { keyPath: 'id' })
        notes.createIndex('by-doc', 'docId')

        const highlights = database.createObjectStore('highlights', { keyPath: 'id' })
        highlights.createIndex('by-doc', 'docId')
      }
      if (oldVersion < 2) {
        database.createObjectStore('settings')
      }
    },
  })
  return dbPromise
}

const stripBlob = ({ blob: _blob, ...rest }: DocRecord): DocSummary => rest

/**
 * Ask the browser to treat this origin's storage as persistent. Without it the
 * whole library is "best effort" data that can be evicted when the disk fills
 * up. Chrome usually grants this silently once the site has been used a little.
 */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  return (await navigator.storage.persisted()) || navigator.storage.persist()
}

/* ---------------------------------------------------------------- documents */

export async function listDocs(): Promise<DocSummary[]> {
  const all = await (await db()).getAll('docs')
  return all.map(stripBlob).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
}

export async function getDoc(id: string): Promise<DocRecord | undefined> {
  return (await db()).get('docs', id)
}

export async function putDoc(doc: DocRecord): Promise<void> {
  await (await db()).put('docs', doc)
}

export async function updateDoc(id: string, patch: Partial<Omit<DocRecord, 'id'>>): Promise<void> {
  const database = await db()
  const doc = await database.get('docs', id)
  if (!doc) return
  await database.put('docs', { ...doc, ...patch })
}

export async function touchDoc(id: string): Promise<void> {
  await updateDoc(id, { lastOpenedAt: Date.now() })
}

/**
 * Find a previously imported copy of a file the user just dropped in, so their
 * notes reattach instead of a second, empty entry appearing beside the first.
 */
export async function matchDoc(
  fingerprint: string | null,
  name: string,
  size: number,
): Promise<DocSummary | undefined> {
  const all = await (await db()).getAll('docs')

  // The PDF's own id survives renaming, so it is the better signal.
  if (fingerprint) {
    const match = all.find((doc) => doc.fingerprint === fingerprint)
    if (match) return stripBlob(match)
  }

  // Fall back to name+size only for records stored before fingerprints existed.
  // A record that has a fingerprint and didn't match is genuinely a different
  // document, and silently pinning old notes to it would be worse than a copy.
  const legacy = all.find((doc) => !doc.fingerprint && doc.name === name && doc.size === size)
  return legacy ? stripBlob(legacy) : undefined
}

export async function deleteDoc(id: string): Promise<void> {
  const database = await db()
  const tx = database.transaction(['docs', 'notes', 'highlights'], 'readwrite')
  const noteIds = await tx.objectStore('notes').index('by-doc').getAllKeys(id)
  const highlightIds = await tx.objectStore('highlights').index('by-doc').getAllKeys(id)
  await Promise.all([
    tx.objectStore('docs').delete(id),
    ...noteIds.map((key) => tx.objectStore('notes').delete(key)),
    ...highlightIds.map((key) => tx.objectStore('highlights').delete(key)),
    tx.done,
  ])
}

/* -------------------------------------------------------------------- notes */

export async function listNotes(docId: string): Promise<Note[]> {
  const notes = await (await db()).getAllFromIndex('notes', 'by-doc', docId)
  return notes.sort((a, b) => a.page - b.page || a.order - b.order)
}

export async function putNote(note: Note): Promise<void> {
  await (await db()).put('notes', note)
}

export async function putNotes(notes: Note[]): Promise<void> {
  const database = await db()
  const tx = database.transaction('notes', 'readwrite')
  await Promise.all([...notes.map((note) => tx.store.put(note)), tx.done])
}

export async function deleteNote(id: string): Promise<void> {
  await (await db()).delete('notes', id)
}

/* --------------------------------------------------------------- highlights */

export async function listHighlights(docId: string): Promise<Highlight[]> {
  return (await db()).getAllFromIndex('highlights', 'by-doc', docId)
}

export async function putHighlight(highlight: Highlight): Promise<void> {
  await (await db()).put('highlights', highlight)
}

export async function deleteHighlight(id: string): Promise<void> {
  await (await db()).delete('highlights', id)
}

/* ----------------------------------------------------------------- settings */

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await db()).get('settings', key) as Promise<T | undefined>
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put('settings', value, key)
}

export async function deleteSetting(key: string): Promise<void> {
  await (await db()).delete('settings', key)
}

/* -------------------------------------------------------------- annotations */

/** Swap in a whole set of notes and highlights, as a restore or a folder sync does. */
export async function replaceAnnotations(docId: string, notes: Note[], highlights: Highlight[]): Promise<void> {
  const database = await db()
  const tx = database.transaction(['notes', 'highlights'], 'readwrite')
  const staleNotes = await tx.objectStore('notes').index('by-doc').getAllKeys(docId)
  const staleHighlights = await tx.objectStore('highlights').index('by-doc').getAllKeys(docId)
  await Promise.all([
    ...staleNotes.map((key) => tx.objectStore('notes').delete(key)),
    ...staleHighlights.map((key) => tx.objectStore('highlights').delete(key)),
  ])
  await Promise.all([
    ...notes.map((note) => tx.objectStore('notes').put(note)),
    ...highlights.map((highlight) => tx.objectStore('highlights').put(highlight)),
    tx.done,
  ])
}

/* ------------------------------------------------------------------- search */

/**
 * Every note and highlight in the library, flattened per document. The library
 * screen searches note text, so it needs all of it up front - these are small
 * text records, and reading them beats keeping a separate index in sync.
 */
export async function searchIndex(): Promise<Map<string, string>> {
  const database = await db()
  const [notes, highlights] = await Promise.all([database.getAll('notes'), database.getAll('highlights')])
  const index = new Map<string, string>()
  const append = (docId: string, text: string) => {
    if (!text.trim()) return
    index.set(docId, index.has(docId) ? `${index.get(docId)}\n${text}` : text)
  }
  for (const note of notes) append(note.docId, note.body)
  for (const highlight of highlights) append(highlight.docId, highlight.text)
  return index
}

/** How many notes each document has, for the library's count column. */
export async function noteCounts(): Promise<Map<string, number>> {
  const notes = await (await db()).getAll('notes')
  const counts = new Map<string, number>()
  for (const note of notes) counts.set(note.docId, (counts.get(note.docId) ?? 0) + 1)
  return counts
}

/* --------------------------------------------------------------------- tags */

const TAGS_KEY = 'tags'

export async function getTags(): Promise<Tag[]> {
  return (await getSetting<Tag[]>(TAGS_KEY)) ?? []
}

export async function setTags(tags: Tag[]): Promise<void> {
  await setSetting(TAGS_KEY, tags)
}
