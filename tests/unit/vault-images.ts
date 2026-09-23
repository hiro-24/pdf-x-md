// Pictures reaching the sync folder, and coming back from it.
//
// The real folder is a FileSystemDirectoryHandle, which only a person clicking
// a picker can hand over - so the folder here is a fake one, in memory. What is
// being checked is the app's side of the bargain: that a picture is written
// once, that it is written under the name the note refers to it by, and that it
// can be read back into a browser that has the notes but not the bytes.
import { readImage, writeBundle, IMAGE_DIR } from '../../src/lib/vault'
import { toBundle } from '../../src/lib/bundle'
import type { DocSummary, Note } from '../../src/types'

let bad = 0
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`)
}

/* ------------------------------------------------------------- a fake folder */

class Dir {
  files = new Map<string, Blob>()
  dirs = new Map<string, Dir>()

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name)) {
      if (!options?.create) throw new Error(`no such file: ${name}`)
      this.files.set(name, new Blob([]))
    }
    const files = this.files
    return {
      getFile: async () => files.get(name)!,
      createWritable: async () => ({
        write: async (data: Blob | string) => {
          files.set(name, typeof data === 'string' ? new Blob([data]) : data)
        },
        close: async () => {},
      }),
    }
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    if (!this.dirs.has(name)) {
      if (!options?.create) throw new Error(`no such folder: ${name}`)
      this.dirs.set(name, new Dir())
    }
    return this.dirs.get(name)!
  }
}

const doc: DocSummary = {
  id: 'd1', name: '資料.pdf', size: 1, pageCount: 4, addedAt: 0, lastOpenedAt: 0, fingerprint: 'f1',
}
const note = (body: string, page = 1): Note =>
  ({ id: `n${page}`, docId: 'd1', page, body, order: 0, createdAt: 0, updatedAt: 0 })

const bytes = (text: string) => new Blob([text], { type: 'image/png' })
/** Counts what the folder actually asked for, so "written once" is checkable. */
const source = (have: Record<string, string>) => {
  const asked: string[] = []
  return {
    asked,
    fetch: async (name: string) => {
      asked.push(name)
      return name in have ? bytes(have[name]) : null
    },
  }
}

const write = (dir: Dir, notes: Note[], from: ReturnType<typeof source>) =>
  writeBundle(dir as unknown as FileSystemDirectoryHandle, toBundle(doc, notes, []), 'markdown', from.fetch)

/* ---------------------------------------------------------------- the checks */

{
  const dir = new Dir()
  const from = source({ 'a1.png': 'ぴくせる' })
  await write(dir, [note('# 図\n![](img:a1.png)')], from)

  check('the picture is written under its own name',
    [...(dir.dirs.get(IMAGE_DIR)?.files.keys() ?? [])], ['a1.png'])
  check('and the notes file is still there', [...dir.files.keys()], ['資料.notes.json', '資料.notes.md'])
  check('it was asked for once', from.asked, ['a1.png'])

  // Saving again must not re-write it: a note is saved on every pause in
  // typing, and a screenshot is not small.
  const again = source({ 'a1.png': 'ぴくせる' })
  await write(dir, [note('# 図\n![](img:a1.png)')], again)
  check('saving again does not ask for it again', again.asked, [])
}

{
  const dir = new Dir()
  const from = source({ 'a1.png': 'ひとつめ', 'b2.jpg': 'ふたつめ' })
  await write(dir, [note('![](img:a1.png)'), note('![x](img:b2.jpg) と ![y](img:a1.png)', 2)], from)
  check('every picture the notes mention is written',
    [...(dir.dirs.get(IMAGE_DIR)?.files.keys() ?? [])].sort(), ['a1.png', 'b2.jpg'])
  check('and each one only once', from.asked.sort(), ['a1.png', 'b2.jpg'])
}

{
  const dir = new Dir()
  const from = source({})
  await write(dir, [note('![](img:gone.png)')], from)
  check('a picture nobody has is simply skipped',
    [...(dir.dirs.get(IMAGE_DIR)?.files.keys() ?? [])], [])
  check('the notes are written all the same', dir.files.has('資料.notes.json'), true)
}

{
  const dir = new Dir()
  await write(dir, [note('なにも貼っていないメモ')], source({}))
  check('no pictures, no folder', dir.dirs.has(IMAGE_DIR), false)
}

{
  // The other side: a browser with the notes but not the bytes.
  const dir = new Dir()
  await write(dir, [note('![](img:a1.png)')], source({ 'a1.png': 'ぴくせる' }))
  const back = await readImage(dir as unknown as FileSystemDirectoryHandle, 'a1.png')
  check('a written picture reads back', await back?.text(), 'ぴくせる')
  check('one that was never there reads as nothing',
    await readImage(dir as unknown as FileSystemDirectoryHandle, 'nosuch.png'), null)
  check('and so does a folder with no pictures in it',
    await readImage(new Dir() as unknown as FileSystemDirectoryHandle, 'a1.png'), null)
}

console.log(bad ? `\n${bad} FAILED` : '\nall passed')
process.exit(bad ? 1 : 0)
