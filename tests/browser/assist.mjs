// The note editor's formatting buttons, driven through the real textarea.
import { chromium } from 'playwright'
import { APP } from '../app-url.mjs'
const PDF = new URL('../fixtures/simple.pdf', import.meta.url).pathname
let bad = 0
const check = (l, a, e) => { const ok = String(a) === String(e); if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}: ${JSON.stringify(a)}${ok ? '' : ` (expected ${JSON.stringify(e)})`}`) }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('dialog', (d) => d.accept().catch(() => {}))

const editor = page.locator('#page-1 .note__editor')
const press = async (label) => {
  await page.locator('.note__assist button', { hasText: label }).first().click()
  await page.waitForTimeout(250)
}
const body = () => editor.inputValue()
/** Select a run of text inside the textarea by its offsets. */
const select = (start, end) =>
  page.evaluate(([a, b]) => {
    const t = document.querySelector('#page-1 .note__editor')
    t.focus()
    t.setSelectionRange(a, b)
  }, [start, end])

await page.goto(APP)
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.setInputFiles('input[type=file][accept*="pdf"]', PDF)
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('#page-1 .textLayer span').length >= 3, null, { timeout: 60000 })
await page.locator('#page-1 .add-note').click()
await page.waitForSelector('#page-1 .note__editor')

check('the buttons are there while editing', await page.locator('.note__assist button').count(), 8)
check('seven of them shape the text, one takes a picture',
  await page.locator('.note__assist button:not(.note__image-button)').count(), 7)

// --- a fresh note is empty, and that is where the first button gets pressed ---
check('the new note starts empty', await body(), '')
await press('\u2022')
check('a bullet starts the list on an empty note', await body(), '- ')
await page.keyboard.type('りんご')
await page.waitForTimeout(200)
check('and typing carries on after it, not over it', await body(), '- りんご')
await page.keyboard.press('Enter')
await page.keyboard.type('みかん')
await page.waitForTimeout(200)
check('the list keeps going', await body(), '- りんご\n- みかん')

await editor.fill('')
await select(0, 0)
await press('H')
check('a heading on an empty note too', await body(), '## ')
await editor.fill('')
await select(0, 0)
await press('\u2611')
check('and a checkbox', await body(), '- [ ] ')

// --- a button acts on the line the caret is on ---
await editor.fill('買うもの')
await select(2, 2)
await press('•')
check('a bullet goes on the line', await body(), '- 買うもの')
await press('•')
check('pressing it again takes it off', await body(), '買うもの')

// --- and on every line the selection touches ---
await editor.fill('りんご\nみかん\nぶどう')
await select(1, 9)
await press('1.')
check('numbers count up across the selection', await body(), '1. りんご\n2. みかん\n3. ぶどう')
await press('•')
check('switching to bullets converts rather than stacking', await body(), '- りんご\n- みかん\n- ぶどう')

// --- wrapping keeps the words selected, so you can keep formatting ---
await editor.fill('これは大事です')
await select(3, 5)
await press('B')
check('bold wraps the selection', await body(), 'これは**大事**です')
check('and the words stay selected', await page.evaluate(() => {
  const t = document.querySelector('#page-1 .note__editor')
  return t.value.slice(t.selectionStart, t.selectionEnd)
}), '大事')
await press('B')
check('pressing it again unwraps', await body(), 'これは大事です')

// --- the caret keeps its place, so the textarea does not lose focus ---
await editor.fill('見出し')
await select(3, 3)
await press('H')
check('a heading', await body(), '## 見出し')
check('focus stayed in the editor', await page.evaluate(() =>
  document.activeElement?.className), 'note__editor')

await editor.fill('やること')
await select(4, 4)
await press('☑')
check('a checkbox', await body(), '- [ ] やること')

// --- Enter carries a list on, and an empty item ends it ---
await editor.fill('')
await editor.type('- りんご')
await page.keyboard.press('Enter')
await page.keyboard.type('みかん')
await page.waitForTimeout(200)
check('Enter carries the bullet on', await body(), '- りんご\n- みかん')
await page.keyboard.press('Enter')
await page.waitForTimeout(200)
await page.keyboard.press('Enter')
await page.waitForTimeout(250)
check('a second Enter ends the list', await body(), '- りんご\n- みかん\n')

await editor.fill('')
await editor.type('1. ひとつ')
await page.keyboard.press('Enter')
await page.keyboard.type('ふたつ')
await page.waitForTimeout(200)
check('numbered lists count on', await body(), '1. ひとつ\n2. ふたつ')

// --- Tab indents, and does not walk out of the field ---
await editor.fill('')
await editor.type('- りんご')
await page.keyboard.press('Tab')
await page.waitForTimeout(250)
check('Tab nests the item', await body(), '    - りんご')
check('and the caret is still in the field',
  await page.evaluate(() => document.activeElement?.className), 'note__editor')
await page.keyboard.type('\nみかん')
await page.waitForTimeout(250)
check('the list carries on at the same depth', await body(), '    - りんご\n    - みかん')
await page.keyboard.press('Shift+Tab')
await page.waitForTimeout(250)
check('shift+Tab brings it back', await body(), '    - りんご\n- みかん')

await editor.fill('ふつうの文')
await select(5, 5)
await page.keyboard.press('Tab')
await page.waitForTimeout(250)
check('outside a list it is four spaces at the caret', await body(), 'ふつうの文    ')

await editor.fill('りんご\nみかん')
await select(1, 9)
await page.keyboard.press('Tab')
await page.waitForTimeout(250)
check('a selection moves every line it touches', await body(), '    りんご\n    みかん')
check('and stays selected, so Tab can be pressed again', await page.evaluate(() => {
  const t = document.querySelector('#page-1 .note__editor')
  return t.value.slice(t.selectionStart, t.selectionEnd)
}), '    りんご\n    みかん')

// --- plain text is left to Enter, and shift+Enter always is ---
await editor.fill('')
await editor.type('ただの文')
await page.keyboard.press('Enter')
await page.keyboard.type('つぎ')
await page.waitForTimeout(200)
check('plain text is left alone', await body(), 'ただの文\nつぎ')

// --- what was written is what gets saved and rendered ---
await editor.fill('- りんご\n- みかん')
await page.waitForTimeout(700)
await page.locator('#page-1 .note__tools button', { hasText: 'プレビュー' }).click()
await page.waitForSelector('#page-1 .note__preview')
check('the list renders', await page.locator('#page-1 .note__preview li').count(), 2)
check('no buttons in preview', await page.locator('.note__assist').count(), 0)

await page.reload()
await page.waitForSelector('.doc-table__open')
await page.locator('.doc-table__open').first().click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForTimeout(1500)
check('and it survives a reload', await page.locator('#page-1 .note__preview li').count(), 2)

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
