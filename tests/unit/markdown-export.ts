// What the exported Markdown file looks like.
import { toMarkdown } from '../../src/lib/markdown-export'
import type { Bookmark, DocSummary, Highlight, Note } from '../../src/types'

let bad = 0
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`)
}

const doc: DocSummary = {
  id: 'd1', name: '資料.pdf', size: 1, pageCount: 40, addedAt: 0, lastOpenedAt: 0, title: '読み物',
}
const note = (page: number, body: string, order = 0): Note =>
  ({ id: `n${page}-${body}`, docId: 'd1', page, body, order, createdAt: 0, updatedAt: 0 })
const high = (page: number, text: string): Highlight =>
  ({ id: `h${page}`, docId: 'd1', page, rects: [], text, color: 'yellow', createdAt: 0 })
const mark = (page: number): Bookmark => ({ id: `b${page}`, docId: 'd1', page, label: '', createdAt: 0 })

const out = (notes: Note[], highlights: Highlight[] = [], bookmarks: Bookmark[] = []) =>
  toMarkdown(doc, notes, highlights, bookmarks).split('\n').filter((line) => line !== '')

check('the title comes from the document', out([]), ['# 読み物'])

check('a page note goes under its page', out([note(3, 'みっつめ')]), ['# 読み物', '## p.3', 'みっつめ'])

// The whole-document note is filed under page 0, and reads as the opening of
// the file rather than as a page in it.
check('the document note opens the file',
  out([note(0, 'この本の話'), note(3, 'みっつめ')]),
  ['# 読み物', '## まとめ', 'この本の話', '## p.3', 'みっつめ'])

check('it never shows up as a page', out([note(0, 'この本の話')]), ['# 読み物', '## まとめ', 'この本の話'])

check('several of them come out in tab order',
  out([note(0, 'ふたつめ', 1), note(0, 'ひとつめ', 0)]),
  ['# 読み物', '## まとめ', 'ひとつめ', 'ふたつめ'])

check('an empty one is left out', out([note(0, '   '), note(3, 'みっつめ')]), ['# 読み物', '## p.3', 'みっつめ'])

check('bookmarks still come before the pages',
  out([note(0, 'まとめ文'), note(2, 'ふたつめ')], [], [mark(2)]),
  ['# 読み物', '## まとめ', 'まとめ文', '## しおり', '- p.2', '## p.2', 'ふたつめ'])

check('highlights are quoted under their page',
  out([], [high(5, '引いた文')]),
  ['# 読み物', '## p.5', '> 引いた文'])

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
