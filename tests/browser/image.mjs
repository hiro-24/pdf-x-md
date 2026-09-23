// Pictures inside a note: chosen, pasted or dropped, and still there tomorrow.
import { chromium } from 'playwright'
import { APP } from '../app-url.mjs'
const PDF = new URL('../fixtures/simple.pdf', import.meta.url).pathname
let bad = 0
const check = (l, a, e) => { const ok = String(a) === String(e); if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}: ${JSON.stringify(a)}${ok ? '' : ` (expected ${JSON.stringify(e)})`}`) }

/** A 40x24 PNG, so a rendered one can be told from a broken one by its size. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAACgAAAAYCAIAAAAH5iiXAAAAKElEQVR4nGO4E2AzIIhh1OJRi0ctHrV41OJRi0ctHrV41OJRi4ePxQAsO0ZM9Mf+yQAAAABJRU5ErkJggg=='

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('dialog', (d) => d.accept().catch(() => {}))

const editor = page.locator('#page-1 .note__editor')
const body = () => editor.inputValue()
const preview = page.locator('#page-1 .note__preview')
const shown = () => page.evaluate(() => {
  const img = document.querySelector('#page-1 .note__preview img')
  if (!img) return null
  return { w: img.naturalWidth, h: img.naturalHeight, blob: img.getAttribute('src')?.startsWith('blob:') }
})
/** Hand the editor a file the way the clipboard or a drag would. */
const deliver = (kind, base64) => page.evaluate(([event, data]) => {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
  const file = new File([bytes], '写真.png', { type: 'image/png' })
  const carrier = new DataTransfer()
  carrier.items.add(file)
  const target = document.querySelector('#page-1 .note__editor')
  target.focus()
  target.dispatchEvent(event === 'paste'
    ? new ClipboardEvent('paste', { clipboardData: carrier, bubbles: true, cancelable: true })
    : new DragEvent('drop', { dataTransfer: carrier, bubbles: true, cancelable: true }))
}, [kind, base64])

await page.goto(APP)
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.setInputFiles('input[type=file][accept*="pdf"]', PDF)
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('#page-1 .textLayer span').length >= 3, null, { timeout: 60000 })
await page.locator('#page-1 .add-note').click()
await page.waitForSelector('#page-1 .note__editor')

// --- the button, which is the discoverable way in ---
check('the editor offers a picture button', await page.locator('#page-1 .note__image-button').count(), 1)
await editor.fill('# 図')
await page.locator('#page-1 .note__editor').focus()
await page.evaluate(() => {
  const t = document.querySelector('#page-1 .note__editor')
  t.setSelectionRange(t.value.length, t.value.length)
})
await page.setInputFiles('#page-1 .note__assist input[type=file]', {
  name: '図版.png', mimeType: 'image/png', buffer: Buffer.from(PNG, 'base64'),
})
await page.waitForTimeout(700)
const written = await body()
check('a reference is written into the note', /^# 図\n!\[図版\]\(img:[a-z0-9]+\.png\)\n$/.test(written), 'true')
check('and the caret stayed in the editor',
  await page.evaluate(() => document.activeElement?.className), 'note__editor')

// --- and it is a picture, not a line of text, once read back ---
await page.locator('#page-1 .note__tools button', { hasText: 'プレビュー' }).click()
await preview.waitFor()
await page.waitForTimeout(600)
check('the preview shows it at its real size', JSON.stringify(await shown()), JSON.stringify({ w: 40, h: 24, blob: true }))

// --- pasting is how a screenshot actually arrives ---
await page.locator('#page-1 .note__tools button', { hasText: '編集' }).click()
await editor.waitFor()
await editor.fill('貼り付け')
await deliver('paste', PNG)
await page.waitForTimeout(700)
check('a pasted image lands on its own line', /^貼り付け\n!\[写真\]\(img:[a-z0-9]+\.png\)\n$/.test(await body()), 'true')
const pasted = (await body()).match(/img:([^)]+)/)[1]

// --- dropping one in works the same ---
await editor.fill('放り込み')
await deliver('drop', PNG)
await page.waitForTimeout(700)
check('a dropped image lands too', /^放り込み\n!\[写真\]\(img:[a-z0-9]+\.png\)\n$/.test(await body()), 'true')
check('and gets a name of its own', (await body()).includes(pasted), false)

// --- what is kept is the name, not the bytes ---
check('the note body stays small', (await body()).length < 60, 'true')
check('the bytes are in their own store', await page.evaluate(async () => {
  const db = await new Promise((ok) => { const r = indexedDB.open('pdf-note-app'); r.onsuccess = () => ok(r.result) })
  const rows = await new Promise((ok) => { const t = db.transaction('images').objectStore('images').getAll(); t.onsuccess = () => ok(t.result) })
  return rows.length >= 3 && rows.every((row) => row.blob instanceof Blob)
}), true)

// --- and they survive a reload ---
await editor.fill(`# 図\n![図版](img:${(await page.evaluate(async () => {
  const db = await new Promise((ok) => { const r = indexedDB.open('pdf-note-app'); r.onsuccess = () => ok(r.result) })
  return await new Promise((ok) => { const t = db.transaction('images').objectStore('images').getAllKeys(); t.onsuccess = () => ok(t.result[0]) })
}))})\n`)
await page.waitForTimeout(700)
await page.reload()
await page.waitForSelector('.doc-table__open')
await page.locator('.doc-table__open').first().click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForSelector('#page-1 .note__preview', { timeout: 60000 })
await page.waitForTimeout(1200)
check('the picture comes back after a reload', JSON.stringify(await shown()), JSON.stringify({ w: 40, h: 24, blob: true }))

// --- a reference to something that is gone says so, rather than breaking ---
await preview.dblclick()
await editor.waitFor()
await editor.fill('![消えた](img:nosuch.png)')
await page.waitForTimeout(700)
await page.locator('#page-1 .note__tools button', { hasText: 'プレビュー' }).click()
await page.waitForTimeout(600)
check('a missing picture is named, not left broken',
  (await page.locator('#page-1 .markdown__gone').innerText()).includes('nosuch.png'), 'true')

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
