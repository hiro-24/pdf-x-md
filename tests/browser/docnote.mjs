// One note for the whole document: written and read from any page.
import { chromium } from 'playwright'
const BIG = new URL('../fixtures/big.pdf', import.meta.url).pathname
let bad = 0
const check = (l, a, e) => { const ok = String(a) === String(e); if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}: ${JSON.stringify(a)}${ok ? '' : ` (expected ${JSON.stringify(e)})`}`) }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('dialog', (d) => d.accept().catch(() => {}))

const toggle = page.locator('.toolbar button', { hasText: 'まとめ' })
const editor = page.locator('.doc-note .note__editor')
const width = () => page.evaluate(() =>
  Math.round(document.querySelector('.doc-note').getBoundingClientRect().width))
const open = async () => { await toggle.click(); await page.waitForSelector('.doc-note') }

await page.goto('http://localhost:5173')
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.setInputFiles('input[type=file][accept*="pdf"]', BIG)
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('#page-1 .textLayer span').length >= 3, null, { timeout: 60000 })

check('the toolbar offers it', await toggle.count(), 1)
check('with no mark on it yet', (await toggle.innerText()).trim(), 'まとめ')
check('and nothing is open', await page.locator('.doc-note').count(), 0)

// --- it opens away from the page, which is pinned left by default ---
await open()
check('it opens on the side away from the page', await page.locator('.doc-note--right').count(), 1)
check('and starts ready to write', await editor.count(), 1)

await editor.fill('# 読書メモ\n\n- 一章は前提の話')
await page.waitForTimeout(700)
check('the toolbar says there is something in it', (await toggle.innerText()).trim(), 'まとめ ●')

// --- the whole point: it stays while the pages go by ---
await page.locator('#page-20').scrollIntoViewIfNeeded()
await page.waitForFunction(() => document.querySelector('.toolbar__page')?.textContent.trim().startsWith('p.20 '),
  null, { timeout: 20000 })
check('still open twenty pages later', await page.locator('.doc-note').count(), 1)
check('with what was written in it', await editor.inputValue(), '# 読書メモ\n\n- 一章は前提の話')

// It can be written into from there, too, with the same help as a page note:
// Enter at the end of an item carries the list on, so the `- ` is not retyped.
await editor.focus()
await page.keyboard.press('End')
await page.keyboard.type('\n二十章で結論')
await page.waitForTimeout(700)
check('the list carried on by itself', await editor.inputValue(),
  '# 読書メモ\n\n- 一章は前提の話\n- 二十章で結論')

// --- it is not a page note: no lane anywhere, no page in the index ---
check('no lane appeared on the page being read', await page.locator('#page-20 .lane--note').count(), 0)
check('nor on the first page', await page.locator('#page-1 .lane--note').count(), 0)
await page.locator('.toolbar button', { hasText: 'しおり・メモ' }).click()
await page.waitForSelector('.panel')
check('and it is not listed as a page', await page.locator('.panel__jump', { hasText: 'p.0' }).count(), 0)
check('the index does not count it', (await page.locator('.toolbar button', { hasText: 'しおり・メモ' }).innerText()).trim(),
  'しおり・メモ (0)')
check('opening the index closed the note, which shares its edge',
  await page.locator('.doc-note').count(), 0)

// --- closing and reopening keeps it, and so does a reload ---
await open()
check('reopening brings it back', await editor.inputValue(), '# 読書メモ\n\n- 一章は前提の話\n- 二十章で結論')

await page.reload()
await page.waitForSelector('.doc-table__open')
await page.locator('.doc-table__open').first().click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForTimeout(1500)
check('the mark survives a reload', (await toggle.innerText()).trim(), 'まとめ ●')
await open()
check('and so does the text', await editor.inputValue(), '# 読書メモ\n\n- 一章は前提の話\n- 二十章で結論')

// --- m toggles it, once the writing has been stepped away from ---
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
await page.keyboard.press('m')
await page.waitForTimeout(300)
check('m closes it', await page.locator('.doc-note').count(), 0)
await page.keyboard.press('m')
await page.waitForTimeout(300)
check('and opens it again', await page.locator('.doc-note').count(), 1)

// --- the width is draggable and remembered ---
const before = await width()
const grip = await page.locator('.doc-note__grip').boundingBox()
await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
await page.mouse.down()
await page.mouse.move(grip.x + grip.width / 2 - 140, grip.y + grip.height / 2, { steps: 10 })
await page.mouse.up()
await page.waitForTimeout(500)
check('dragging the inner edge widens it', await width(), before + 140)

await page.reload()
await page.waitForSelector('.doc-table__open')
await page.locator('.doc-table__open').first().click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForTimeout(1500)
await open()
check('the width is remembered', await width(), before + 140)

// --- pinning the page right moves the note to the other edge ---
await page.locator('.toolbar__group button', { hasText: '右' }).click()
await page.waitForTimeout(600)
check('the note moved away from the page', await page.locator('.doc-note--left').count(), 1)
check('and the index can now sit beside it', await page.locator('.doc-note--right').count(), 0)

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
