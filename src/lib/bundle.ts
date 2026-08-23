import type { Bookmark, DocSummary, Highlight, Note, Tag } from '../types'

/**
 * The portable form of a document's annotations: what gets written to the sync
 * folder and what the JSON backup contains. `docId` is deliberately dropped -
 * it is local to one browser profile, and the fingerprint is what identifies
 * the PDF anywhere else.
 */
export interface Bundle {
  app: 'pdf-note-app'
  version: number
  savedAt: number
  doc: {
    name: string
    fingerprint: string | null
    pageCount: number
    lastPage: number
    title?: string
    /** Tag names. Colours live in the library palette, not in each document. */
    tags?: string[]
    /** When this machine last changed lastPage/title/tags. Absent in bundles
     *  written before the field existed, which then simply never win. */
    metaAt?: number
  }
  notes: Omit<Note, 'docId'>[]
  highlights: Omit<Highlight, 'docId'>[]
  /** Optional: bundles written before bookmarks existed simply don't have it. */
  bookmarks?: Omit<Bookmark, 'docId'>[]
}

export const BUNDLE_VERSION = 1

export function toBundle(
  doc: DocSummary,
  notes: Note[],
  highlights: Highlight[],
  bookmarks: Bookmark[] = [],
): Bundle {
  return {
    app: 'pdf-note-app',
    version: BUNDLE_VERSION,
    savedAt: Date.now(),
    doc: {
      name: doc.name,
      fingerprint: doc.fingerprint ?? null,
      pageCount: doc.pageCount,
      lastPage: doc.lastPage ?? 1,
      title: doc.title,
      tags: doc.tags ?? [],
      metaAt: doc.metaAt ?? 0,
    },
    notes: notes.map(({ docId: _docId, ...note }) => note),
    highlights: highlights.map(({ docId: _docId, ...highlight }) => highlight),
    bookmarks: bookmarks.map(({ docId: _docId, ...mark }) => mark),
  }
}

/** Newest edit in a set of annotations, for deciding which side of a sync wins. */
export function stampOf(
  notes: readonly { updatedAt: number }[],
  highlights: readonly { createdAt: number }[],
  bookmarks: readonly { createdAt: number }[] = [],
): number {
  let latest = 0
  for (const note of notes) latest = Math.max(latest, note.updatedAt)
  for (const highlight of highlights) latest = Math.max(latest, highlight.createdAt)
  for (const mark of bookmarks) latest = Math.max(latest, mark.createdAt)
  return latest
}

/**
 * The same measure taken from a bundle's own contents. Deliberately *not*
 * `bundle.savedAt`: that records when the file was written, which is always a
 * moment later than the edit it contains, so comparing it against a local edit
 * time would hand every tie to the folder.
 */
export function bundleStamp(bundle: Bundle): number {
  return stampOf(bundle.notes, bundle.highlights, bundle.bookmarks ?? [])
}

export function parseBundle(text: string): Bundle {
  const value: unknown = JSON.parse(text)
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as Bundle).app !== 'pdf-note-app' ||
    !Array.isArray((value as Bundle).notes) ||
    !Array.isArray((value as Bundle).highlights)
  ) {
    throw new Error('このアプリのバックアップファイルではありません')
  }
  return value as Bundle
}

/** Re-attach a bundle to a document in this browser. Note ids are kept: they are
 *  uuids, so re-importing the same bundle twice overwrites rather than duplicates. */
export function adoptBundle(
  bundle: Bundle,
  docId: string,
): { notes: Note[]; highlights: Highlight[]; bookmarks: Bookmark[] } {
  return {
    notes: bundle.notes.map((note) => ({ ...note, docId })),
    highlights: bundle.highlights.map((highlight) => ({ ...highlight, docId })),
    bookmarks: (bundle.bookmarks ?? []).map((mark) => ({ ...mark, docId })),
  }
}

/* ------------------------------------------------------------------ palette */

/** The library's tag colours, as written to `_tags.json` in the sync folder. */
export interface PaletteFile {
  app: 'pdf-note-app'
  kind: 'palette'
  version: number
  savedAt: number
  tags: Tag[]
}

export function toPaletteFile(tags: Tag[], savedAt: number): PaletteFile {
  return { app: 'pdf-note-app', kind: 'palette', version: BUNDLE_VERSION, savedAt, tags }
}

export function parsePaletteFile(text: string): PaletteFile {
  const value: unknown = JSON.parse(text)
  const file = value as PaletteFile
  if (typeof value !== 'object' || value === null || file.app !== 'pdf-note-app' || !Array.isArray(file.tags)) {
    throw new Error('タグの定義ファイルではありません')
  }
  return file
}

/**
 * Union the two palettes by tag name. Whole-file last-write-wins would drop
 * tags created on the other machine since the last sync, so only the *colour*
 * of a name both sides know is decided by the timestamp.
 */
export function mergePalettes(local: Tag[], localStamp: number, remote: Tag[], remoteStamp: number): Tag[] {
  const winner = remoteStamp > localStamp ? remote : local
  const loser = remoteStamp > localStamp ? local : remote

  const merged = new Map<string, Tag>()
  for (const tag of loser) merged.set(tag.name, tag)
  for (const tag of winner) merged.set(tag.name, tag)
  return [...merged.values()]
}
