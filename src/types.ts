export interface DocRecord {
  id: string
  name: string
  size: number
  pageCount: number
  /** The PDF itself. Stored as a Blob so every open gets a fresh ArrayBuffer -
   *  pdf.js detaches the buffer it is handed. */
  blob: Blob
  addedAt: number
  lastOpenedAt: number
  /**
   * pdf.js's own identity for the document (from the PDF's /ID). Lets us
   * recognise the same file when it is dropped in again, even after a rename.
   * Absent on records written before this was tracked.
   */
  fingerprint?: string | null
  /** 1-based page the reader was last on, so reopening resumes there. */
  lastPage?: number
  /**
   * What the reader calls this document. Seeded from the PDF's own metadata
   * title, falling back to the filename, and editable in the library table.
   */
  title?: string
  /** Tag names, not ids: names are what travel to another machine intact. */
  tags?: string[]
}

export const TAG_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const
export type TagColor = (typeof TAG_COLORS)[number]

/** A label in the library's palette. The name is the identity. */
export interface Tag {
  name: string
  color: TagColor
}

/** Summary of a document, without the (potentially huge) blob. */
export type DocSummary = Omit<DocRecord, 'blob'>

export interface Note {
  id: string
  docId: string
  /** 1-based page number this note is attached to. */
  page: number
  body: string
  /** Position within the page's horizontal lane. */
  order: number
  createdAt: number
  updatedAt: number
}

/** Rectangle in page-relative coordinates (0..1), so it survives zoom changes. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const HIGHLIGHT_COLORS = ['yellow', 'green', 'blue', 'pink'] as const
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number]

export interface Highlight {
  id: string
  docId: string
  page: number
  rects: Rect[]
  text: string
  color: HighlightColor
  createdAt: number
}

export interface DocBundle {
  doc: DocSummary
  notes: Note[]
  highlights: Highlight[]
}
