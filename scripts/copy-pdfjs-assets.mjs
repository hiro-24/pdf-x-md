// pdf.js needs a few asset bundles at runtime that are NOT part of the JS build:
//   cmaps          - character maps for CJK (essential for Japanese PDFs)
//   standard_fonts - the 14 standard PDF fonts, for files that don't embed them
//   wasm           - JPEG2000 / JBIG2 / openjpeg decoders
//   iccs           - ICC colour profiles
// Vite only serves/copies what lives in public/, so mirror them there.
import { cp, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const src = join(root, 'node_modules', 'pdfjs-dist')
const dest = join(root, 'public', 'pdfjs')

const DIRS = ['cmaps', 'standard_fonts', 'wasm', 'iccs']

const exists = async (p) => !!(await stat(p).catch(() => null))

if (!(await exists(src))) {
  console.error('pdfjs-dist is not installed - run `npm install` first.')
  process.exit(1)
}

await mkdir(dest, { recursive: true })
for (const dir of DIRS) {
  const from = join(src, dir)
  if (!(await exists(from))) continue
  await cp(from, join(dest, dir), { recursive: true })
}
console.log(`pdf.js assets copied to ${dest}`)
