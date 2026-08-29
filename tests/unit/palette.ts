import { mergePalettes, toPaletteFile, parsePaletteFile } from '../../src/lib/bundle'
import { readPalette, writePalette } from '../../src/lib/vault'
import type { Tag } from '../../src/types'

function fakeDir() {
  const files = new Map<string, string>()
  return { files, kind: 'directory' as const, name: 'v',
    async getFileHandle(n: string, o?: { create?: boolean }) {
      if (!files.has(n) && !o?.create) throw new DOMException('nope', 'NotFoundError')
      return { async getFile() { return { text: async () => files.get(n) ?? '' } },
        async createWritable() { let b = ''; return { write: async (t: string) => void (b += t), close: async () => void files.set(n, b) } } }
    },
    async *values() { for (const n of files.keys()) yield { kind: 'file' as const, name: n } },
  } as unknown as FileSystemDirectoryHandle & { files: Map<string, string> }
}

let bad = 0
const check = (l: string, a: unknown, e: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(e)
  if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${ok ? '' : `\n        got ${JSON.stringify(a)}\n        want ${JSON.stringify(e)}`}`)
}
const t = (name: string, color: Tag['color']): Tag => ({ name, color })

const run = async () => {
  // colour conflicts go to the newer side
  check('newer remote wins the colour',
    mergePalettes([t('重要', 'red')], 100, [t('重要', 'teal')], 200), [t('重要', 'teal')])
  check('newer local keeps the colour',
    mergePalettes([t('重要', 'red')], 300, [t('重要', 'teal')], 200), [t('重要', 'red')])

  // but names are never dropped, whichever side is older
  check('tags only on the older side survive',
    mergePalettes([t('A', 'red'), t('ローカル限定', 'blue')], 100, [t('A', 'teal')], 200).map((x) => x.name).sort(),
    ['A', 'ローカル限定'])
  check('tags only on the remote survive too',
    mergePalettes([t('A', 'red')], 300, [t('A', 'teal'), t('別PC限定', 'pink')], 200).map((x) => x.name).sort(),
    ['A', '別PC限定'])

  check('empty remote is a no-op', mergePalettes([t('A', 'red')], 100, [], 0), [t('A', 'red')])
  check('empty local adopts the remote', mergePalettes([], 0, [t('A', 'pink')], 5), [t('A', 'pink')])

  // round trip through the folder
  const dir = fakeDir()
  await writePalette(dir, toPaletteFile([t('重要', 'pink'), t('あとで読む', 'teal')], 42))
  check('written under a name findBundle ignores', [...dir.files.keys()], ['_tags.json'])
  const back = await readPalette(dir)
  check('colours round trip', back?.tags, [t('重要', 'pink'), t('あとで読む', 'teal')])
  check('stamp round trips', back?.savedAt, 42)

  // descriptions ride along with the tag they belong to
  const d = (name: string, color: Tag['color'], description: string): Tag => ({ name, color, description })
  const dir2 = fakeDir()
  await writePalette(dir2, toPaletteFile([d('重要', 'pink', '再読するもの')], 7))
  check('descriptions round trip through the folder', (await readPalette(dir2))?.tags, [d('重要', 'pink', '再読するもの')])
  check('the newer side brings its description',
    mergePalettes([d('重要', 'red', '古い説明')], 100, [d('重要', 'teal', '新しい説明')], 200),
    [d('重要', 'teal', '新しい説明')])
  check('a tag only on the other machine keeps its description',
    mergePalettes([t('A', 'red')], 300, [d('別PC限定', 'pink', '向こうで書いた')], 200).map((x) => x.description ?? ''),
    ['向こうで書いた', ''])
  check('an empty newer remote still keeps the local tag and its description',
    mergePalettes([d('重要', 'red', 'x')], 100, [], 200), [d('重要', 'red', 'x')])

  dir.files.set('_tags.json', '{ broken')
  check('a corrupt file reads as absent', await readPalette(dir), null)
  try { parsePaletteFile('{"app":"other"}'); check('foreign file rejected', 'no throw', 'throws') }
  catch { check('foreign file rejected', 'throws', 'throws') }

  console.log(bad ? `\n${bad} FAILED` : '\nall passed')
  process.exit(bad ? 1 : 0)
}
void run()
