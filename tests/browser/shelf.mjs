import { chromium } from 'playwright'
const PDF = new URL('../fixtures/simple.pdf', import.meta.url).pathname
const BIG = new URL('../fixtures/big.pdf', import.meta.url).pathname
let bad = 0
const check = (l, a, e) => { const ok = String(a) === String(e); if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}: ${a}${ok ? '' : ` (expected ${e})`}`) }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('dialog', (d) => d.accept().catch(() => {}))

const load = async (file) => {
  await page.setInputFiles('input[type=file][accept*="pdf"]', file)
  await page.waitForSelector('.toolbar', { timeout: 60000 })
  await page.locator('.toolbar__back').click()
  await page.waitForSelector('.doc-table')
}
const tileFor = (title) => page.locator('.tile', { has: page.locator('.tile__title', { hasText: title }) })

await page.goto('http://localhost:5173')
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.waitForSelector('.dropzone')
await load(PDF)
await load(BIG)

// --- switching to the shelf ---
check('the table is the starting view', await page.locator('.doc-table').count(), 1)
check('a switch is offered', await page.locator('.viewswitch').count(), 1)
await page.locator('.viewswitch button', { hasText: '表紙' }).click()
await page.waitForSelector('.shelf')
check('shelf replaces the table', await page.locator('.doc-table').count(), 0)
check('a tile per document', await page.locator('.tile').count(), 2)

// --- the covers actually arrive, and are the real page-1 renders ---
await page.waitForFunction(() => {
  const imgs = [...document.querySelectorAll('.tile__cover img')]
  return imgs.length === 2 && imgs.every((img) => img.complete && img.naturalWidth > 0)
}, null, { timeout: 30000 })
const covers = await page.evaluate(() => [...document.querySelectorAll('.tile__cover img')].map((img) => ({
  loaded: img.complete && img.naturalWidth > 0, w: img.naturalWidth, h: img.naturalHeight })))
console.log('    covers:', JSON.stringify(covers))
check('both covers decoded', covers.every((c) => c.loaded), 'true')
check('and are portrait', covers.every((c) => c.h > c.w), 'true')
check('drawn at 2x the 200px width', covers.every((c) => c.w === 400), 'true')

// --- a tile carries what the row carried ---
check('title shown', (await tileFor('長い資料').locator('.tile__title').innerText()).trim(), '長い資料')
check('page count shown', (await tileFor('長い資料').locator('.tile__meta').innerText()).includes('40 ページ'), 'true')
check('no note badge without notes', await tileFor('長い資料').locator('.tile__notes').count(), 0)

// --- clicking a cover opens that document ---
await tileFor('長い資料').locator('.tile__cover').click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
check('the cover opens its own document', (await page.locator('.toolbar__name').innerText()).trim(), '長い資料')
await page.locator('#page-1 .add-note').click()
await page.waitForTimeout(400)
await page.locator('#page-1 .note__editor').fill('# メモ\n\n本文')
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
await page.locator('.toolbar__back').click()
await page.waitForSelector('.shelf')
check('coming back lands on the shelf, not the table', await page.locator('.shelf').count(), 1)
check('note badge appears', (await tileFor('長い資料').locator('.tile__notes').innerText()).trim(), 'メモ 1')

// --- search and tag filters still narrow the shelf ---
await page.locator('.search').fill('長い')
await page.waitForTimeout(400)
check('search narrows the shelf', await page.locator('.tile').count(), 1)
await page.locator('.search').fill('存在しない題名')
await page.waitForTimeout(400)
check('an empty result says so', await page.locator('.library__empty').count(), 1)
await page.locator('.search').fill('')
await page.waitForTimeout(400)

// --- the shelf can be reordered without column headings ---
check('a sort control is offered', await page.locator('.shelf__sort select').count(), 1)
await page.locator('.shelf__sort select').selectOption('title:asc')
await page.waitForTimeout(400)
const order = await page.evaluate(() => [...document.querySelectorAll('.tile__title')].map((t) => t.textContent.trim()))
check('titles sort ascending', order.join(','), 'simple,長い資料')
await page.locator('.shelf__sort select').selectOption('notes:desc')
await page.waitForTimeout(400)
check('most-annotated first', (await page.evaluate(() =>
  document.querySelector('.tile__title').textContent.trim())), '長い資料')

// --- the choice of view is remembered ---
await page.reload()
await page.waitForSelector('.library__inner')
await page.waitForTimeout(900)
check('the shelf comes back after a reload', await page.locator('.shelf').count(), 1)
check('and its covers with it', await page.locator('.tile__cover img').count(), 2)

// --- deleting from a tile ---
await tileFor('simple').hover()
await tileFor('simple').locator('.tile__delete').click()
await page.waitForTimeout(800)
check('the tile is gone', await page.locator('.tile').count(), 1)
await page.locator('.viewswitch button', { hasText: '表' }).first().click()
await page.waitForSelector('.doc-table')
check('and gone from the table too', await page.locator('.doc-table tbody tr').count(), 1)

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
