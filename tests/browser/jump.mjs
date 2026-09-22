// Jumping to a page has to land on that page. Rows that have not rendered yet
// stand at a placeholder height, so a single scrollIntoView lands short by that
// error times the distance - which is why this is checked over long distances
// and straight after opening, before anything has been drawn.
import { chromium } from 'playwright'
import { APP } from '../app-url.mjs'
const BIG = new URL('../fixtures/big.pdf', import.meta.url).pathname
let bad = 0
const check = (l, a, e) => { const ok = String(a) === String(e); if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}: ${a}${ok ? '' : ` (expected ${e})`}`) }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const cur = async () => (await page.locator('.toolbar__page').textContent()).trim()
const topOf = (n) => page.evaluate((p) =>
  Math.round(document.getElementById(`page-${p}`).getBoundingClientRect().top), n)
const toTop = async () => {
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(700)
}
const openPanel = async () => {
  if (await page.locator('.panel').count()) return
  await page.locator('.toolbar button', { hasText: 'しおり・メモ' }).click()
  await page.waitForSelector('.panel')
}
/** Click a bookmark chip and give the correction time to run. */
const jump = async (n) => {
  await page.locator('.panel__marks .mark__page', { hasText: `p.${n}` }).click()
  await page.waitForTimeout(2600)
}

await page.goto(APP)
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.setInputFiles('input[type=file][accept*="pdf"]', BIG)
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('#page-1 .textLayer span').length >= 3, null, { timeout: 60000 })

// Marks at a short hop and a long one. The short one glides, the long one does
// not, and the two take different paths through jumpTo.
for (const n of [4, 30]) {
  await page.locator(`#page-${n}`).scrollIntoViewIfNeeded()
  // Wait for the toolbar to agree which page this is. `b` marks whatever the
  // app calls the current page, and the scroll settles in its own time - a
  // fixed wait guesses wrong under load and marks the page next door.
  await page.waitForFunction((p) => document.querySelector('.toolbar__page')?.textContent.trim().startsWith(`p.${p} `),
    n, { timeout: 20000 })
  await page.keyboard.press('b')
  await page.waitForTimeout(500)
}
await openPanel()
check('both pages marked', await page.locator('.panel__marks .mark').count(), 2)
// Named, not just counted: a mark on the wrong page would otherwise show up
// much later as a click that waits for a chip that was never there.
check('and on the pages they were made on',
  (await page.locator('.panel__marks .mark__page').allInnerTexts()).join(' '), 'p.4 p.30')

// --- a short hop, which glides ---
await toTop()
check('back at the top', await cur(), 'p.1 / 40')
await jump(4)
check('a short jump lands on its page', await cur(), 'p.4 / 40')
check('and puts the row under the toolbar', await topOf(4), 64)

// --- a long one, which does not ---
await toTop()
await jump(30)
check('a long jump lands on its page', await cur(), 'p.30 / 40')
check('and puts that row under the toolbar', await topOf(30), 64)

// --- the hard case: jump before anything below the fold has been drawn ---
await page.reload()
await page.waitForSelector('.doc-table__open')
await page.locator('.doc-table__open').first().click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForTimeout(1200)
await toTop()
await openPanel()
await jump(30)
check('a jump on a freshly opened document lands too', await cur(), 'p.30 / 40')
check('with the row where it belongs', await topOf(30), 64)

// --- and the reader can still overrule it ---
await toTop()
await page.locator('.panel__marks .mark__page', { hasText: 'p.30' }).click()
await page.waitForTimeout(120)
await page.mouse.wheel(0, -1200)
await page.waitForTimeout(2600)
check('scrolling away during the correction wins', (await cur()) !== 'p.30 / 40', 'true')

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
