import { chromium } from 'playwright'
const PDF = new URL('../fixtures/simple.pdf', import.meta.url).pathname
const BIG = new URL('../fixtures/big.pdf', import.meta.url).pathname
let bad = 0
const check = (l, a, e) => { const ok = String(a) === String(e); if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}: ${a}${ok ? '' : ` (expected ${e})`}`) }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
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
const rowFor = (name) => page.locator('.tag-table tbody tr', { has: page.locator('.tag', { hasText: name }) })

await page.goto('http://localhost:5173')
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.waitForSelector('.dropzone')
await load(PDF)
await load(BIG)

// --- reachable before any tag exists, which is the whole point ---
check('manage button offered with an empty palette', await page.locator('.tag-filters__manage').count(), 1)
await page.locator('.tag-filters__manage').click()
await page.waitForSelector('.tag-table')
check('table opens', await page.locator('.tag-table').count(), 1)
check('only the new-tag row so far', await page.locator('.tag-table tbody tr').count(), 1)

// --- adding a tag, with a colour chosen up front ---
await page.locator('.tag-table__name').fill('重要')
await page.locator('.tag-table__new .dot--pick').click()
await page.waitForSelector('.colorgrid')
await page.locator('.colorgrid .dot--pink').click()
await page.waitForTimeout(300)
check('grid closes after picking', await page.locator('.colorgrid').count(), 0)
await page.locator('.tag-table__add').click()
await page.waitForTimeout(500)
check('tag added', await rowFor('重要').count(), 1)
check('in the colour chosen', (await rowFor('重要').locator('.tag').getAttribute('class')).includes('tag--pink'), 'true')
check('the name box cleared', await page.locator('.tag-table__name').inputValue(), '')
check('and it reached the filter bar', await page.locator('.tag-filters .tag', { hasText: '重要' }).count(), 1)

// Enter adds too, without reaching for the button.
await page.locator('.tag-table__name').fill('あとで読む')
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
check('Enter adds as well', await rowFor('あとで読む').count(), 1)

// --- a name already in use is refused rather than silently merged ---
await page.locator('.tag-table__name').fill('重要')
await page.waitForTimeout(200)
check('duplicate name flagged', await page.locator('.tag-table__taken').count(), 1)
check('and the add button is off', await page.locator('.tag-table__add').isDisabled(), true)
await page.locator('.tag-table__name').fill('')
await page.waitForTimeout(200)
check('an empty name is refused too', await page.locator('.tag-table__add').isDisabled(), true)

// --- changing a colour from the table ---
await rowFor('重要').locator('.dot--pick').click()
await page.waitForSelector('.colorgrid')
await page.locator('.colorgrid .dot--teal').click()
await page.waitForTimeout(500)
check('recoloured in the table', (await rowFor('重要').locator('.tag').getAttribute('class')).includes('tag--teal'), 'true')
check('and on the filter chip', (await page.locator('.tag-filters .tag', { hasText: '重要' }).getAttribute('class')).includes('tag--teal'), 'true')

// --- descriptions ---
await rowFor('重要').locator('.tag-table__desc-view').click()
await page.waitForSelector('.tag-table__desc')
await page.locator('.tag-table__desc').fill('再読するもの')
await page.keyboard.press('Enter')
await page.waitForTimeout(500)
check('description shown', (await rowFor('重要').locator('.tag-table__desc-view').innerText()).trim(), '再読するもの')
check('the other tag is untouched', (await rowFor('あとで読む').locator('.tag-table__desc-view').innerText()).trim(), '説明を書く')
check('it becomes the chip tooltip', await page.locator('.tag-filters .tag', { hasText: '重要' }).getAttribute('title'), '再読するもの')

await rowFor('あとで読む').locator('.tag-table__desc-view').click()
await page.locator('.tag-table__desc').fill('捨てる予定')
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
check('Escape abandons the edit', (await rowFor('あとで読む').locator('.tag-table__desc-view').innerText()).trim(), '説明を書く')

// --- the usage column counts documents, not uses ---
const doc = page.locator('.doc-table tbody tr').first()
await doc.hover()
await doc.locator('.tag-cell__add').click()
await page.waitForSelector('.tagpicker')
await page.locator('.tagpicker__list .tagpicker__item', { hasText: '重要' }).click()
await page.waitForTimeout(400)
check('the menu carries the description', await page.locator('.tagpicker__list .tag', { hasText: '重要' }).getAttribute('title'), '再読するもの')
await page.locator('.library__title').click()
await page.waitForTimeout(400)
check('usage counted', (await rowFor('重要').locator('.col-num').innerText()).trim(), '1')
check('an unused tag shows nothing', (await rowFor('あとで読む').locator('.col-num').innerText()).trim(), '')

// --- everything survives a reload ---
await page.reload()
await page.waitForSelector('.doc-table')
await page.waitForTimeout(900)
await page.locator('.tag-filters__manage').click()
await page.waitForSelector('.tag-table')
check('colour persisted', (await rowFor('重要').locator('.tag').getAttribute('class')).includes('tag--teal'), 'true')
check('description persisted', (await rowFor('重要').locator('.tag-table__desc-view').innerText()).trim(), '再読するもの')
check('usage persisted', (await rowFor('重要').locator('.col-num').innerText()).trim(), '1')

// --- deleting takes the tag off the documents too ---
await rowFor('重要').locator('.tag-table__delete').click()
await page.waitForTimeout(700)
check('tag gone from the table', await rowFor('重要').count(), 0)
check('gone from the filter bar', await page.locator('.tag-filters .tag', { hasText: '重要' }).count(), 0)
check('gone from the document row', await page.locator('.doc-table .tag-cell .tag', { hasText: '重要' }).count(), 0)
await page.reload()
await page.waitForSelector('.doc-table')
await page.waitForTimeout(900)
check('and stays gone', await page.locator('.tag-filters .tag', { hasText: '重要' }).count(), 0)

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
