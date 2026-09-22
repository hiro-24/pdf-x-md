import { chromium } from 'playwright'
import { APP } from '../app-url.mjs'
const PDF = new URL('../fixtures/simple.pdf', import.meta.url).pathname
let bad = 0
const check = (l, a, e) => { const ok = String(a) === String(e); if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}: ${a}${ok ? '' : ` (expected ${e})`}`) }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('dialog', (d) => d.accept().catch(() => {}))

const classOf = (loc) => loc.getAttribute('class')

await page.goto(APP)
// Start from nothing: a palette left over from another run changes which tag is
// first in the menu, and the auto-assigned colour along with it.
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.waitForSelector('.dropzone')
await page.setInputFiles('input[type=file][accept*="pdf"]', PDF)
await page.waitForSelector('.toolbar', { timeout: 30000 })
await page.locator('.toolbar__back').click()
await page.waitForSelector('.doc-table')

const row = page.locator('.doc-table tbody tr').first()
await row.hover()
await row.locator('.tag-cell__add').click()
await page.waitForSelector('.tagpicker')

// --- choosing a colour before the tag exists ------------------------------
await page.locator('.tagpicker__search').fill('重要')
await page.waitForSelector('.tagpicker__row--new')
const autoDot = page.locator('.tagpicker__row--new .dot--pick')
const autoColor = (await classOf(autoDot)).match(/dot--(\w+)/g)[0]
console.log('auto-assigned colour:', autoColor)
check('a colour is proposed', autoColor.startsWith('dot--'), 'true')

await autoDot.click()
await page.waitForSelector('.colorgrid')
check('grid offers nine colours', await page.locator('.colorgrid .dot').count(), 9)
check('current colour is marked', await page.locator('.colorgrid .dot.is-current').count(), 1)

await page.locator('.colorgrid .dot--pink').click()
await page.waitForTimeout(300)
check('grid closes after picking', await page.locator('.colorgrid').count(), 0)
check('proposed colour switched to pink', (await classOf(autoDot)).includes('dot--pink'), 'true')

await page.locator('.tagpicker__create').click()
await page.waitForTimeout(600)
check('tag created in the chosen colour', (await classOf(row.locator('.tag-cell > .tag'))).includes('tag--pink'), 'true')

// --- changing an existing tag's colour ------------------------------------
const existingDot = page.locator('.tagpicker__list .dot--pick').first()
await existingDot.click()
await page.waitForSelector('.colorgrid')
await page.locator('.colorgrid .dot--teal').click()
await page.waitForTimeout(600)
check('chip recoloured', (await classOf(row.locator('.tag-cell > .tag'))).includes('tag--teal'), 'true')
check('menu entry recoloured too', (await classOf(page.locator('.tagpicker__list .tag'))).includes('tag--teal'), 'true')

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check('filter chip recoloured', (await classOf(page.locator('.tag-filters .tag'))).includes('tag--teal'), 'true')

// --- it has to survive a reload -------------------------------------------
await page.reload()
await page.waitForSelector('.doc-table')
await page.waitForTimeout(900)
check('colour persisted', (await classOf(page.locator('.tag-filters .tag'))).includes('tag--teal'), 'true')
check('and on the row', (await classOf(page.locator('.tag-cell > .tag'))).includes('tag--teal'), 'true')

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
