// What a note looks like read back: equations drawn, code coloured, and the
// things that only look like either left alone.
import { chromium } from 'playwright'
import { APP } from '../app-url.mjs'
const PDF = new URL('../fixtures/simple.pdf', import.meta.url).pathname
let bad = 0
const check = (l, a, e) => { const ok = String(a) === String(e); if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}: ${JSON.stringify(a)}${ok ? '' : ` (expected ${JSON.stringify(e)})`}`) }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
const warnings = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
  if (m.type() === 'warning') warnings.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('dialog', (d) => d.accept().catch(() => {}))

const editor = page.locator('#page-1 .note__editor')
const preview = page.locator('#page-1 .note__preview')
/** Write a note and read it back the way the reader would. */
const render = async (text) => {
  if (!(await editor.count())) {
    await preview.dblclick()
    await editor.waitFor()
  }
  await editor.fill(text)
  await page.locator('#page-1 .note__tools button', { hasText: 'プレビュー' }).click()
  await preview.waitFor()
}
const inPreview = (fn, arg) => page.evaluate(([source, a]) => {
  const root = document.querySelector('#page-1 .note__preview .markdown')
  return new Function('root', 'arg', `return (${source})(root, arg)`)(root, a)
}, [fn.toString(), arg])

await page.goto(APP)
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.setInputFiles('input[type=file][accept*="pdf"]', PDF)
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('#page-1 .textLayer span').length >= 3, null, { timeout: 60000 })
await page.locator('#page-1 .add-note').click()
await page.waitForSelector('#page-1 .note__editor')

// --- math in a line, and math on its own ---
await render([
  '質量とエネルギー $E = mc^2$ の関係。',
  '',
  '$$',
  '\\int_0^1 x^2 \\, dx = \\frac{1}{3}',
  '$$',
  '',
  '```math',
  '\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}',
  '```',
].join('\n'))
check('inline math is drawn, in the line it was written in', await inPreview((root) => {
  const k = root.querySelector('p .katex')
  return Boolean(k) && !k.closest('.katex-display')
}), true)
check('and its dollars are gone from the text', await inPreview((root) => root.querySelector('p').innerText.includes('$')), false)
check('$$ on lines of their own is display math', await inPreview((root) => root.querySelectorAll('.katex-display').length), 2)
check('a ```math block is drawn too, not shown as code', await inPreview((root) => root.querySelectorAll('pre').length), 0)
check('the fraction is a fraction, not the letters of \\frac',
  await inPreview((root) => root.querySelectorAll('.katex-display .mfrac').length > 0 && !root.innerText.includes('\\frac')), true)

await page.evaluate(() => document.fonts.ready)
check('KaTeX\'s own fonts are shipped and loaded', await page.evaluate(() =>
  [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'KaTeX_Main' && f.status === 'loaded')), true)

// --- things that only look like math ---
await render('価格は \\$100 と \\$200。式は `$x$` と書く。')
check('an escaped dollar is a dollar', await inPreview((root) => [root.querySelectorAll('.katex').length, root.innerText.includes('$100 と $200')]), [0, true])
check('dollars inside inline code are left as typed', await inPreview((root) => root.querySelector('code').textContent), '$x$')

// --- Japanese inside an equation, which strict LaTeX would refuse ---
warnings.length = 0
await render('$v = \\frac{距離}{時間}$')
check('Japanese in math still draws', await inPreview((root) => root.querySelectorAll('.katex .mfrac').length), 1)
check('and does not fill the console with warnings', warnings.filter((w) => /katex|strict|unicode/i.test(w)).length, 0)

// --- a mistake is shown as the source, in red, not as a blank or a crash ---
await render('壊れた式 $\\frac{1}{$ のあとも続く')
const broken = await inPreview((root) => {
  const e = root.querySelector('.katex-error')
  return e && { text: e.textContent, why: e.getAttribute('title') ?? '', colour: getComputedStyle(e).color }
})
check('a broken equation keeps its source', broken?.text, '\\frac{1}{')
check('with KaTeX\'s reason on hover', /ParseError/.test(broken?.why ?? ''), true)
check('in the theme\'s colour, not KaTeX\'s inline red', broken?.colour, 'rgb(194, 65, 45)')
check('and the text after it is still there', await inPreview((root) => root.innerText.includes('のあとも続く')), true)

// --- code that names its language is coloured ---
await render([
  '```ts',
  'const answer: number = 42 // 答え',
  'function greet(name: string) { return `hi ${name}` }',
  '```',
  '',
  '```',
  'const plain = 1',
  '```',
  '',
  '```mermaid',
  'graph TD; A-->B',
  '```',
].join('\n'))
const blocks = await inPreview((root) => [...root.querySelectorAll('pre code')].map((code) => ({
  tokens: code.querySelectorAll('[class^="hljs-"]').length,
  text: code.textContent,
})))
check('every block is still there', blocks.length, 3)
check('the labelled one is split into tokens', blocks[0]?.tokens > 4, true)
check('its text is untouched by the colouring', blocks[0]?.text.startsWith('const answer: number = 42 // 答え'), true)
check('an unlabelled block is not guessed at', blocks[1]?.tokens, 0)
check('a language the highlighter does not know is shown plain', [blocks[2]?.tokens, blocks[2]?.text.trim()], [0, 'graph TD; A-->B'])

const colours = () => inPreview((root) => {
  const of = (sel) => { const el = root.querySelector(sel); return el && getComputedStyle(el).color }
  return { keyword: of('.hljs-keyword'), comment: of('.hljs-comment'), number: of('.hljs-number'), text: of('pre code') }
})
const light = await colours()
check('keywords are coloured', light.keyword, 'rgb(207, 34, 46)')
check('comments recede into the muted text colour', light.comment, 'rgb(111, 109, 102)')
check('a keyword does not look like the rest of the code', light.keyword !== light.text, true)

await page.emulateMedia({ colorScheme: 'dark' })
const dark = await colours()
check('dark mode has its own keyword colour', dark.keyword, 'rgb(255, 123, 114)')
check('and its own number colour', dark.number, 'rgb(121, 192, 255)')
await page.emulateMedia({ colorScheme: 'light' })

// --- a long equation scrolls inside the note instead of widening it ---
const wide = Array.from({ length: 40 }, (_, i) => `x_{${i}}`).join(' + ')
await render(`$$\n${wide}\n$$`)
const fit = await inPreview((root) => {
  const d = root.querySelector('.katex-display')
  const note = root.closest('.note__preview')
  return { scrolls: d.scrollWidth > d.clientWidth, noteFits: note.scrollWidth <= note.clientWidth + 1 }
})
check('a long equation scrolls on its own', fit.scrolls, true)
check('and the note does not grow sideways', fit.noteFits, true)

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
