import type { DocSummary, Highlight, Note } from '../types'

const quote = (text: string) =>
  text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')

/** Flatten a document's notes and highlights into one readable Markdown file. */
export function toMarkdown(doc: DocSummary, notes: Note[], highlights: Highlight[]): string {
  const pages = [...new Set([...notes.map((n) => n.page), ...highlights.map((h) => h.page)])].sort((a, b) => a - b)

  const out: string[] = [`# ${doc.name.replace(/\.pdf$/i, '')}`, '']

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
