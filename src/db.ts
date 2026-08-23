import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Bookmark, DocRecord, DocSummary, Highlight, Note, Tag } from './types'

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
  bookmarks: {
    key: string
    value: Bookmark
    indexes: { 'by-doc': string }
  }
  /** Cover images, keyed by document id. Kept out of `docs` so that listing the
   *  library doesn't drag a pile of bitmaps along with it. */
  thumbs: {
    key: string
    value: Blob
  }
}

const DB_NAME = 'pdf-note-app'
const DB_VERSION = 4

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
      if (oldVersion < 3) {
        database.createObjectStore('thumbs')
      }
      if (oldVersion < 4) {
        database.createObjectStore('bookmarks', { keyPath: 'id' }).createIndex('by-doc', 'docId')
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

/** Fields a sync has to date, so that a stale folder copy can't overwrite them. */
const META_FIELDS = ['lastPage', 'title', 'tags'] as const

export async function updateDoc(id: string, patch: Partial<Omit<DocRecord, 'id'>>): Promise<void> {
  const database = await db()
  const doc = await database.get('docs', id)
  if (!doc) return
  // Stamp here rather than at every call site: forgetting one would silently
  // let an older copy of the reading position win the next sync.
  // An explicit `metaAt` in the patch is a stamp adopted from elsewhere; keep it.
  const touchesMeta = patch.metaAt === undefined && META_FIELDS.some((field) => field in patch && patch[field] !== doc[field])
  await database.put('docs', { ...doc, ...patch, ...(touchesMeta ? { metaAt: Date.now() } : {}) })
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
  await database.delete('thumbs', id)
  const tx = database.transaction(['docs', 'notes', 'highlights', 'bookmarks'], 'readwrite')
  const noteIds = await tx.objectStore('notes').index('by-doc').getAllKeys(id)
  const highlightIds = await tx.objectStore('highlights').index('by-doc').getAllKeys(id)
  const bookmarkIds = await tx.objectStore('bookmarks').index('by-doc').getAllKeys(id)
  await Promise.all([
    tx.objectStore('docs').delete(id),
    ...noteIds.map((key) => tx.objectStore('notes').delete(key)),
    ...highlightIds.map((key) => tx.objectStore('highlights').delete(key)),
    ...bookmarkIds.map((key) => tx.objectStore('bookmarks').delete(key)),
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
const TAGS_STAMP_KEY = 'tags-saved-at'

export async function getTags(): Promise<Tag[]> {
  return (await getSetting<Tag[]>(TAGS_KEY)) ?? []
}

/** When the palette last changed here, for deciding which side of a sync wins. */
export async function getTagsStamp(): Promise<number> {
  return (await getSetting<number>(TAGS_STAMP_KEY)) ?? 0
}

export async function setTags(tags: Tag[], savedAt: number = Date.now()): Promise<void> {
  await setSetting(TAGS_KEY, tags)
  await setSetting(TAGS_STAMP_KEY, savedAt)
}

/* ------------------------------------------------------------------ covers */

export async function getThumb(docId: string): Promise<Blob | undefined> {
  return (await db()).get('thumbs', docId)
}

export async function putThumb(docId: string, blob: Blob): Promise<void> {
  await (await db()).put('thumbs', blob, docId)
}

export async function deleteThumb(docId: string): Promise<void> {
  await (await db()).delete('thumbs', docId)
}

/* --------------------------------------------------------------- bookmarks */

export async function listBookmarks(docId: string): Promise<Bookmark[]> {
  const marks = await (await db()).getAllFromIndex('bookmarks', 'by-doc', docId)
  return marks.sort((a, b) => a.page - b.page || a.createdAt - b.createdAt)
}

export async function putBookmark(mark: Bookmark): Promise<void> {
  await (await db()).put('bookmarks', mark)
}

export async function deleteBookmark(id: string): Promise<void> {
  await (await db()).delete('bookmarks', id)
}

export async function replaceBookmarks(docId: string, marks: Bookmark[]): Promise<void> {
  const database = await db()
  const tx = database.transaction('bookmarks', 'readwrite')
  const stale = await tx.store.index('by-doc').getAllKeys(docId)
  await Promise.all(stale.map((key) => tx.store.delete(key)))
  await Promise.all([...marks.map((mark) => tx.store.put(mark)), tx.done])
}
