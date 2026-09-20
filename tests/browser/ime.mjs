// The Enter that settles a Japanese conversion must not be acted on as well.
//
// It reaches the page as a real keydown - key "Enter", keyCode 13 - and only
// `isComposing` tells it apart from the Enter that means "done". The
// conversion is driven through CDP, which is the path a real IME takes into
// the renderer: `imeSetComposition` puts an unsettled reading in the field,
// the key arrives carrying no text of its own (the IME ate the character),
// and `insertText` commits.
//
// A bare textarea is measured first, as a control. Whatever the browser itself
// does with this sequence, the app must do no more.
import { chromium } from 'playwright'
const PDF = new URL('../fixtures/simple.pdf', import.meta.url).pathname
let bad = 0
const check = (l, a, e) => { const ok = String(a) === String(e); if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}: ${JSON.stringify(a)}${ok ? '' : ` (expected ${JSON.stringify(e)})`}`) }

const ENTER = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }
/** Composition helpers for one page. */
const ime = (page, cdp) => ({
  /** Put an unsettled reading in the focused field. */
  convert: async (text) => {
    await cdp.send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
    await page.waitForTimeout(150)
  },
  /** Press the Enter that settles it, and let the IME commit. */
  settle: async (text) => {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...ENTER })
    await cdp.send('Input.insertText', { text })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...ENTER })
    await page.waitForTimeout(400)
  },
})

const browser = await chromium.launch({ channel: 'chrome' })

// --- control: a textarea with nothing of ours on it -----------------------
{
  const bare = await browser.newPage()
  await bare.setContent('<textarea id="t"></textarea>')
  await bare.locator('#t').focus()
  const cdp = await bare.context().newCDPSession(bare)
  const { convert, settle } = ime(bare, cdp)
  await convert('りんご')
  check('the reading shows while converting', await bare.locator('#t').inputValue(), 'りんご')
  await settle('りんご')
  check('a plain textarea gains nothing from the settling Enter', await bare.locator('#t').inputValue(), 'りんご')
  await bare.keyboard.press('Enter')
  await bare.waitForTimeout(150)
  check('and takes a real Enter as a newline', await bare.locator('#t').inputValue(), 'りんご\n')
  await bare.close()
}

const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('dialog', (d) => d.accept().catch(() => {}))
const { convert, settle } = ime(page, await page.context().newCDPSession(page))
const realEnter = async () => { await page.keyboard.press('Enter'); await page.waitForTimeout(400) }

await page.goto('http://localhost:5173')
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.waitForSelector('.dropzone')
await page.setInputFiles('input[type=file][accept*="pdf"]', PDF)
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('#page-1 .textLayer span').length >= 3, null, { timeout: 60000 })

// --- a list in a note: the reported bug -----------------------------------
await page.locator('#page-1 .add-note').click()
await page.waitForSelector('#page-1 .note__editor')
const editor = page.locator('#page-1 .note__editor')
const body = () => editor.inputValue()

await editor.focus()
await page.keyboard.type('- ')
await convert('りんご')
await settle('りんご')
check('settling a conversion does not start a second item', await body(), '- りんご')
check('and the editor stays open', await page.locator('#page-1 .note__editor').count(), 1)

await realEnter()
check('a real Enter still carries the list on', await body(), '- りんご\n- ')
await convert('みかん')
await settle('みかん')
check('the next item settles the same way', await body(), '- りんご\n- みかん')
await realEnter()
await convert('ぶどう')
await settle('ぶどう')
check('and on again', await body(), '- りんご\n- みかん\n- ぶどう')

// Escape belongs to the conversion too - it cancels that, not the editing.
await convert('かき')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check('Escape during a conversion leaves the editor open', await page.locator('#page-1 .note__editor').count(), 1)

await page.locator('.toolbar__back').click()
await page.waitForSelector('.doc-table')

// --- renaming a document --------------------------------------------------
const row = page.locator('.doc-table tbody tr').first()
await row.hover()
await row.locator('.doc-table__rename-btn').click()
await page.waitForSelector('.doc-table__rename')
await page.locator('.doc-table__rename').fill('')
await page.locator('.doc-table__rename').focus()
await convert('読書')
await settle('読書')
check('settling a title does not commit it', await page.locator('.doc-table__rename').count(), 1)
check('the words so far are kept', await page.locator('.doc-table__rename').inputValue(), '読書')
await page.keyboard.type('メモ')
await realEnter()
check('a real Enter commits the whole title',
  await row.locator('.doc-table__open').first().innerText(), '読書メモ')

// --- the tag menu on a document -------------------------------------------
await row.hover()
await row.locator('.tag-cell__add').click()
await page.waitForSelector('.tagpicker')
await page.locator('.tagpicker__search').focus()
await convert('重要')
await settle('重要')
check('settling a tag name does not create the tag', await page.locator('.tagpicker__list .tag').count(), 0)
await realEnter()
check('a real Enter creates it', await page.locator('.tagpicker__list .tag', { hasText: '重要' }).count(), 1)

// Escape here is listened for on the document, which the menu needs - so it
// has to know about conversions too.
await convert('あとで')
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check('Escape during a conversion leaves the menu open', await page.locator('.tagpicker').count(), 1)
// With a real IME that Escape has cancelled the conversion; here it is settled
// instead, since CDP has no conversion to cancel. Either way nothing is being
// converted any more, and Escape goes back to closing the menu.
await settle('あとで')
check('settling in the search box creates nothing either',
  await page.locator('.tagpicker__list .tag', { hasText: 'あとで' }).count(), 0)
await page.keyboard.press('Escape')
await page.waitForTimeout(300)
check('and once nothing is being converted, Escape closes it', await page.locator('.tagpicker').count(), 0)

// --- the tag table --------------------------------------------------------
await page.locator('.tag-filters__manage').click()
await page.waitForSelector('.tag-table')
const named = (name) => page.locator('.tag-table tbody tr', { has: page.locator('.tag', { hasText: name }) })
await page.locator('.tag-table__name').focus()
await convert('あとで')
await settle('あとで')
check('settling here does not add a half-typed tag', await named('あとで').count(), 0)
check('and what was typed is kept', await page.locator('.tag-table__name').inputValue(), 'あとで')
await page.keyboard.type('読む')
await realEnter()
check('a real Enter adds the finished name', await named('あとで読む').count(), 1)

await named('あとで読む').locator('.tag-table__desc-view').click()
await page.waitForSelector('.tag-table__desc')
await page.locator('.tag-table__desc').focus()
await convert('いつか')
await settle('いつか')
check('settling a description keeps the field open', await page.locator('.tag-table__desc').count(), 1)
await page.keyboard.type('読む本')
await realEnter()
check('and a real Enter saves it',
  await named('あとで読む').locator('.tag-table__desc-view').innerText(), 'いつか読む本')

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
