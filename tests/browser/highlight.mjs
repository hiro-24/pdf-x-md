import { chromium } from 'playwright'
import { APP } from '../app-url.mjs'
const PDF = new URL('../fixtures/simple.pdf', import.meta.url).pathname
let bad = 0
const check = (l, a, e) => { const ok = String(a) === String(e); if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}: ${a}${ok ? '' : ` (expected ${e})`}`) }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('dialog', (d) => d.accept().catch(() => {}))

await page.goto(APP)
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.setInputFiles('input[type=file][accept*="pdf"]', PDF)
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('#page-1 .textLayer span').length >= 3, null, { timeout: 60000 })

// --- the strip under the page is gone, its markers now float over the page ---
check('no strip under the page', await page.locator('.lane__foot').count(), 0)
check('no per-page number', await page.locator('.page-num').count(), 0)
check('the row is exactly the page', await page.evaluate(() => {
  const row = document.querySelector('#page-1 .lane--pdf').getBoundingClientRect()
  const canvas = document.querySelector('#page-1 canvas').getBoundingClientRect()
  return Math.round(row.height - canvas.height)
}), 0)

// --- selecting text still opens the highlight popup over the page ---
const span = page.locator('#page-1 .textLayer span').nth(1)
const box = await span.boundingBox()
await page.mouse.move(box.x + 2, box.y + box.height / 2)
await page.mouse.down()
await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 8 })
await page.mouse.up()
await page.waitForSelector('.page-popup', { timeout: 10000 })
check('selection popup opens', await page.locator('.page-popup').count(), 1)
await page.locator('.page-popup .swatch--yellow').click()
await page.waitForTimeout(500)
check('highlight created', await page.locator('#page-1 .hl').count(), 1)
check('highlight sits on the page', await page.evaluate(() => {
  const h = document.querySelector('#page-1 .hl').getBoundingClientRect()
  const c = document.querySelector('#page-1 canvas').getBoundingClientRect()
  return h.top >= c.top - 1 && h.bottom <= c.bottom + 1 && h.left >= c.left - 1 && h.right <= c.right + 1
}), 'true')

// --- the floating markers appear, and do not swallow the page's own clicks ---
await page.locator('#page-1 .add-note').click()
await page.waitForTimeout(400)
await page.locator('#page-1 .note__editor').fill('# 見出し\n\n本文')
await page.keyboard.press('Escape')
await page.locator('.toolbar button', { hasText: 'しおり' }).first().click()
await page.waitForTimeout(700)
check('both markers float over the page', await page.locator('#page-1 .lane__badges .lane__mark, #page-1 .lane__badges .peek').count(), 2)
check('the markers stay inside the page', await page.evaluate(() => {
  const b = document.querySelector('#page-1 .lane__badges').getBoundingClientRect()
  const c = document.querySelector('#page-1 canvas').getBoundingClientRect()
  return b.top >= c.top && b.right <= c.right && b.bottom <= c.bottom
}), 'true')
check('the strip does not creep back', await page.locator('#page-1 .lane__foot').count(), 0)

// Text under the markers is still selectable: the row lets clicks through.
check('the badge row is click-through', await page.evaluate(() =>
  getComputedStyle(document.querySelector('#page-1 .lane__badges')).pointerEvents), 'none')
check('but the peek button is not', await page.evaluate(() =>
  getComputedStyle(document.querySelector('#page-1 .peek')).pointerEvents), 'auto')

// --- and the page really is bigger than the strip allowed ---
await page.evaluate(() => document.getElementById('page-2').scrollIntoView({ block: 'start' }))
await page.waitForTimeout(700)
const fit = await page.evaluate(() => {
  const c = document.querySelector('#page-2 canvas').getBoundingClientRect()
  return { top: Math.round(c.top), bottom: Math.round(c.bottom), win: window.innerHeight }
})
console.log('    page 2 when jumped to:', JSON.stringify(fit))
check('a jumped-to page starts under the toolbar', fit.top, 64)
check('and its bottom is still on screen', fit.bottom <= fit.win, 'true')
check('with no wasted band below it', fit.win - fit.bottom <= 8, 'true')

// --- everything survives a reload ---
await page.reload()
await page.waitForSelector('.doc-table__open')
await page.locator('.doc-table__open').first().click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForTimeout(1500)
check('highlight persisted', await page.locator('#page-1 .hl').count(), 1)
check('markers persisted', await page.locator('#page-1 .lane__badges .peek').count(), 1)

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
