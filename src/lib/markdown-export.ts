import type { Bookmark, DocSummary, Highlight, Note } from '../types'

const quote = (text: string) =>
  text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')

/** Flatten a document's notes and highlights into one readable Markdown file. */
export function toMarkdown(
  doc: DocSummary,
  notes: Note[],
  highlights: Highlight[],
  bookmarks: Bookmark[] = [],
): string {
  // Page 0 is the note for the document as a whole, and it reads as the opening
  // of the file rather than as a page in it.
  const docNote = notes.find((note) => note.page === 0 && note.body.trim())
  const pages = [
    ...new Set([...notes.map((n) => n.page).filter((page) => page > 0), ...highlights.map((h) => h.page)]),
  ].sort((a, b) => a - b)

  const out: string[] = [`# ${doc.title?.trim() || doc.name.replace(/\.pdf$/i, '')}`, '']

  if (docNote) out.push('## まとめ', '', docNote.body.trim(), '')

  if (bookmarks.length) {
    out.push('## しおり', '')
    for (const mark of bookmarks) out.push(`- p.${mark.page}${mark.label ? ` — ${mark.label}` : ''}`)
    out.push('')
  }

  for (const page of pages) {
    out.push(`## p.${page}`, '')

    for (const highlight of highlights.filter((h) => h.page === page)) {
      out.push(quote(highlight.text), '')
    }

    for (const note of notes.filter((n) => n.page === page).sort((a, b) => a.order - b.order)) {
      if (note.body.trim()) out.push(note.body.trim(), '')
    }
  }

  return out.join('\n')
}

export function download(filename: string, contents: string, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([contents], { type: `${type};charset=utf-8` }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
