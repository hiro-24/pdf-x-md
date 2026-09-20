// Bookmarks: deliberate markers, as distinct from the implicit reading position.
import { chromium } from 'playwright'
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

const cur = async () => (await page.locator('.toolbar__page').textContent()).trim()
const markButton = page.locator('.toolbar button', { hasText: 'しおり' }).first()
const isOn = async () => ((await markButton.getAttribute('class')) ?? '').includes('is-on')
const openPanel = async () => {
  if (await page.locator('.panel').count()) return
  await page.locator('.toolbar button', { hasText: 'しおり・メモ' }).click()
  await page.waitForSelector('.panel')
}

await page.goto('http://localhost:5173')
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.setInputFiles('input[type=file][accept*="pdf"]', PDF)
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('#page-1 .textLayer span').length >= 3, null, { timeout: 60000 })

await page.locator('#page-2').scrollIntoViewIfNeeded()
await page.waitForTimeout(1200)
check('reading page 2', await cur(), 'p.2 / 5')

await markButton.click()
await page.waitForTimeout(500)
check('page marked in the lane', await page.locator('#page-2 .lane__mark').count(), 1)
check('toolbar shows it is marked', await isOn(), true)

await page.locator('#page-3').scrollIntoViewIfNeeded()
await page.waitForTimeout(1200)
check('toolbar resets on an unmarked page', await isOn(), false)

await page.locator('#page-4').scrollIntoViewIfNeeded()
// The moment the toolbar says p.4 - not a beat later. `b` used to be handled
// by a listener built one render behind the toolbar, so a key pressed in that
// gap marked the page before this one.
await page.waitForFunction(() => document.querySelector('.toolbar__page')?.textContent.trim().startsWith('p.4 '),
  null, { timeout: 20000 })
await page.keyboard.press('b')
await page.waitForTimeout(500)
check('keyboard b marks the page', await page.locator('#page-4 .lane__mark').count(), 1)

await openPanel()
check('both listed', await page.locator('.panel__marks .mark').count(), 2)
check('listed in page order',
  (await page.locator('.panel__marks .mark__page').allInnerTexts()).map((t) => t.trim()).join(','), 'p.2,p.4')

await page.locator('#page-1').scrollIntoViewIfNeeded()
await page.waitForTimeout(1000)
await page.locator('.panel__marks .mark__page', { hasText: 'p.4' }).click()
await page.waitForTimeout(1200)
check('jumps to the bookmark', await cur(), 'p.4 / 5')

await page.locator('.panel__marks .mark', { hasText: 'p.4' }).locator('.mark__label').fill('ここから再開')
await page.waitForTimeout(800)

// Shortcuts stay out of the way while a field has focus, so step off it first.
await page.locator('.panel__head strong').click()
await page.keyboard.press('b')
await page.waitForTimeout(600)
check('toggling removes it', await page.locator('.panel__marks .mark').count(), 1)
check('and the lane marker goes', await page.locator('#page-4 .lane__mark').count(), 0)

// Put it back, with a label, and check both survive a reload.
await page.keyboard.press('b')
await page.waitForTimeout(400)
await page.locator('.panel__marks .mark', { hasText: 'p.4' }).locator('.mark__label').fill('ここから再開')
await page.locator('.panel__head strong').click()
await page.waitForTimeout(900)
await page.reload()
await page.waitForSelector('.doc-table__open')
await page.locator('.doc-table__open').first().click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForTimeout(1500)
await openPanel()
check('bookmark persisted', await page.locator('.panel__marks .mark', { hasText: 'p.4' }).count(), 1)
check('label persisted',
  await page.locator('.panel__marks .mark', { hasText: 'p.4' }).locator('.mark__label').inputValue(), 'ここから再開')

// --- and they travel in the JSON backup ---
const download = page.waitForEvent('download')
await page.locator('.toolbar button', { hasText: '書き出し' }).click()
await page.locator('.menu button', { hasText: 'JSON でバックアップ' }).click()
const file = await download
const bundle = JSON.parse(await (await import('node:fs/promises')).readFile(await file.path(), 'utf8'))
check('backup carries the bookmark', bundle.bookmarks.length, 2)
check('with its label', bundle.bookmarks.find((m) => m.page === 4).label, 'ここから再開')
check('and no docId leaks out', 'docId' in bundle.bookmarks[0], false)

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
