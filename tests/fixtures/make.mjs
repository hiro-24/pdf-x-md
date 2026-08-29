// Generates the PDFs the browser suites read. They are built rather than
// committed: a few hundred KB of binary in the repo to say "five pages of
// Japanese text" is a poor trade, and Chrome can print them in a second.
import { chromium } from 'playwright'
import { existsSync } from 'node:fs'

const here = (name) => new URL(name, import.meta.url).pathname

const pages = (count, heading) =>
  Array.from({ length: count }, (_, i) => {
    const n = i + 1
    return `<section style="page-break-after:always;padding:70px;font-family:'Hiragino Sans',sans-serif">
      <h1>${heading(n)}</h1>
      <p>これは ${n} ページ目の本文です。ページ ${n} の内容がここに書かれています。</p>
      <p>ページ${n}の二段落目。テキストレイヤーの語数を稼ぐための文章です。長めに書いておきます。</p>
    </section>`
  }).join('')

/** Build the fixtures, skipping any that are already there. */
export async function makeFixtures({ force = false } = {}) {
  const wanted = [
    { file: 'simple.pdf', title: 'simple', count: 5, heading: (n) => `セクション ${n}` },
    { file: 'big.pdf', title: '長い資料', count: 40, heading: (n) => `第${n}章 見出し` },
  ].filter((spec) => force || !existsSync(here(spec.file)))
  if (!wanted.length) return

  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage()
  for (const spec of wanted) {
    await page.setContent(`<title>${spec.title}</title><body>${pages(spec.count, spec.heading)}</body>`)
    await page.pdf({ path: here(spec.file), format: 'A4' })
    console.log(`fixtures: ${spec.file}`)
  }
  await browser.close()
}

if (import.meta.url === `file://${process.argv[1]}`) await makeFixtures({ force: process.argv.includes('--force') })
