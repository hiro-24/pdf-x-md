// Which side of a sync wins: annotations by content, everything else by metaAt.
import { bundleStamp, stampOf, toBundle, type Bundle } from '../../src/lib/bundle'
import type { Bookmark, DocSummary, Highlight, Note } from '../../src/types'

let bad = 0
const check = (l: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e)
  if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${ok ? '' : `\n        got ${JSON.stringify(a)}\n        want ${JSON.stringify(e)}`}`)
}

const note = (updatedAt: number): Note =>
  ({ id: 'n', docId: 'd', page: 1, order: 0, body: 'x', createdAt: updatedAt, updatedAt }) as Note
const mark = (createdAt: number): Bookmark => ({ id: 'b', docId: 'd', page: 3, label: '', createdAt })
const doc = (over: Partial<DocSummary> = {}): DocSummary =>
  ({ id: 'd', name: 'a.pdf', size: 1, pageCount: 40, addedAt: 0, lastOpenedAt: 0,
     fingerprint: 'fp', lastPage: 1, title: 'a', tags: [], ...over }) as DocSummary

/** The rule present() applies to annotations. */
const adoptsNotes = (stored: Bundle, local: { notes: Note[]; highlights: Highlight[]; bookmarks: Bookmark[] }) =>
  bundleStamp(stored) > stampOf(local.notes, local.highlights, local.bookmarks)
/** The rule present() applies to the reading position, title and tags. */
const adoptsMeta = (stored: Bundle, local: DocSummary) => (stored.doc.metaAt ?? 0) > (local.metaAt ?? 0)

const empty = { notes: [] as Note[], highlights: [] as Highlight[], bookmarks: [] as Bookmark[] }

// --- annotations: content against content, never against the write time ---

// The regression: writeBundle stamps savedAt a beat after the edit it carries,
// so a savedAt comparison made the folder win every single open.
const written = toBundle(doc(), [note(1_000)], [], [])
written.savedAt = 9_999_999
check('a late savedAt does not beat identical notes', adoptsNotes(written, { ...empty, notes: [note(1_000)] }), false)
check('a genuinely newer note is adopted', adoptsNotes(toBundle(doc(), [note(2_000)], [], []), { ...empty, notes: [note(1_000)] }), true)
check('an older note is not', adoptsNotes(toBundle(doc(), [note(500)], [], []), { ...empty, notes: [note(1_000)] }), false)

// The case that made resume look dead: a document nobody has annotated. Local
// content stamps at 0, so any savedAt at all used to win.
const blank = toBundle(doc(), [], [], [])
blank.savedAt = Date.now()
check('an empty folder copy never wins over empty local', adoptsNotes(blank, empty), false)

// Site data cleared, PDF dropped back in: the folder is all that is left.
check('the folder wins when local is empty', adoptsNotes(toBundle(doc(), [note(1_000)], [], []), empty), true)

// A bookmark alone counts as work.
check('bookmarks count towards the stamp', adoptsNotes(toBundle(doc(), [], [], [mark(3_000)]), { ...empty, notes: [note(1_000)] }), true)

// Bundles written before bookmarks existed have no such field.
const legacy = toBundle(doc(), [note(1_000)], [], [])
delete (legacy as { bookmarks?: unknown }).bookmarks
check('a bundle without bookmarks still measures', bundleStamp(legacy), 1_000)

// --- reading position, title and tags: their own clock ---

check('a fresher folder position is adopted',
  adoptsMeta(toBundle(doc({ lastPage: 31, metaAt: 5_000 }), [], [], []), doc({ lastPage: 12, metaAt: 4_000 })), true)
check('a stale folder position is refused',
  adoptsMeta(toBundle(doc({ lastPage: 3, metaAt: 4_000 }), [], [], []), doc({ lastPage: 31, metaAt: 9_000 })), false)
check('a tie leaves the local position alone',
  adoptsMeta(toBundle(doc({ metaAt: 7_000 }), [], [], []), doc({ metaAt: 7_000 })), false)
check('an unstamped bundle never wins',
  adoptsMeta({ ...toBundle(doc(), [], [], []), doc: { ...toBundle(doc(), [], [], []).doc, metaAt: undefined } },
    doc({ metaAt: 1 })), false)
check('an unstamped local record yields to a stamped folder',
  adoptsMeta(toBundle(doc({ metaAt: 1 }), [], [], []), doc({ metaAt: undefined })), true)

// The two decisions are independent: reading on without touching a note has to
// carry the position across even though the annotations are untouched.
const readOn = toBundle(doc({ lastPage: 31, metaAt: 8_000 }), [note(1_000)], [], [])
check('position moves while annotations stay put',
  [adoptsNotes(readOn, { ...empty, notes: [note(1_000)] }), adoptsMeta(readOn, doc({ lastPage: 1, metaAt: 2_000 }))],
  [false, true])

check('toBundle carries the stamp', toBundle(doc({ metaAt: 4_242 }), [], [], []).doc.metaAt, 4_242)
check('toBundle defaults it to zero', toBundle(doc({ metaAt: undefined }), [], [], []).doc.metaAt, 0)

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
