// The pinned page: notes scroll past it rather than pushing it off screen.
import { chromium } from 'playwright'
const BIG = new URL('../fixtures/big.pdf', import.meta.url).pathname
let bad = 0
const check = (l, a, e) => { const ok = String(a) === String(e); if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}: ${a}${ok ? '' : ` (expected ${e})`}`) }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const geom = () => page.evaluate(() => {
  const track = document.querySelector('#page-1 .row__track')
  const box = (sel, i = 0) => {
    const el = document.querySelectorAll(`#page-1 ${sel}`)[i]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }
  }
  return { scrollLeft: Math.round(track.scrollLeft), clientWidth: Math.round(track.clientWidth),
    pinned: track.classList.contains('is-pinned'), pdf: box('.lane--pdf'),
    notes: [0, 1, 2].map((i) => box('.lane--note', i)) }
})
const slideRight = async () => {
  await page.evaluate(() => { document.querySelector('#page-1 .row__track').scrollLeft = 99999 })
  await page.waitForTimeout(400)
}
const inset = () => page.evaluate(() =>
  Math.round(document.querySelector('#page-1 canvas').getBoundingClientRect().left))

await page.goto('http://localhost:5173')
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.setInputFiles('input[type=file][accept*="pdf"]', BIG)
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('#page-1 .textLayer span').length >= 3, null, { timeout: 60000 })

for (let i = 0; i < 3; i += 1) {
  await page.locator('#page-1 .add-note').click()
  await page.waitForTimeout(400)
  await page.locator('#page-1 .note__editor').last().fill(`# メモ ${i + 1}\n\n本文 ${i + 1}`)
  await page.waitForTimeout(200)
  await page.keyboard.press('Escape')
}
await page.waitForTimeout(600)

// --- a note you just added has to be readable, not tucked behind the page ---
{
  const g = await geom()
  const fresh = g.notes.filter(Boolean).at(-1)
  check('a new note lands clear of the page', fresh.left >= g.pdf.right - 2, 'true')
  check('and inside the window', fresh.right <= g.clientWidth + 2, 'true')
}

// --- the complaint: three notes used to push the page off the left edge ---
let g = await geom()
check('pinned by default', g.pinned, true)
check('page still on screen after adding notes', g.pdf.left >= 0, 'true')
check('a note sits beside it, not under it', g.notes.find((n) => n && n.left >= g.pdf.right - 1) !== undefined, 'true')

await slideRight()
g = await geom()
check('page holds its place at the far right', g.pdf.left, 0)
check('and keeps its full width', g.pdf.width > 600, 'true')

// --- the peek button lands a note clear of the page, not half behind it ---
await page.evaluate(() => { document.querySelector('#page-1 .row__track').scrollLeft = 0 })
await page.waitForTimeout(300)
await page.locator('#page-1 .peek').click()
await page.waitForTimeout(900)
g = await geom()
const landed = g.notes.filter(Boolean).find((n) => n.left >= g.pdf.right - 2 && n.right <= g.clientWidth + 2)
check('peek lands a whole note beside the page', landed !== undefined, 'true')
// Notes are meant to slide *behind* the pinned page; what must not happen is
// settling with a sliver of one showing beside it.
check('the note beside the page starts flush against it', Math.abs(landed.left - g.pdf.right) <= 2, 'true')

// --- the escape hatch still works, and is remembered ---
await page.locator('.toolbar button', { hasText: 'ページ固定' }).click()
await page.waitForTimeout(300)
await slideRight()
check('turning it off lets the page slide away', (await geom()).pdf.left < 0, 'true')
await page.reload()
await page.waitForSelector('.doc-table__open')
await page.locator('.doc-table__open').first().click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForTimeout(1500)
check('the choice survives a reload', (await geom()).pinned, false)
await page.locator('.toolbar button', { hasText: 'ページ固定' }).click()
await page.waitForTimeout(300)
check('and turning it back on sticks', (await geom()).pinned, true)

// --- the page is inset from the edge, by more when there is room to spare ---
await page.evaluate(() => { document.querySelector('#page-1 .row__track').scrollLeft = 0 })
await page.waitForTimeout(400)
const wide = await inset()
check(`page sits well in from the edge on a wide window (${wide}px)`, wide >= 120, 'true')
await page.setViewportSize({ width: 1280, height: 1000 })
await page.waitForTimeout(800)
check('and falls back to the minimum when space is tight', await inset(), 24)
check('still pinned there', (await geom()).pinned, true)
await page.setViewportSize({ width: 1600, height: 1000 })
await page.waitForTimeout(800)
check('the inset comes back with the width', await inset(), wide)

// --- a window too narrow for both falls back rather than hiding the notes ---
await page.setViewportSize({ width: 760, height: 1000 })
await page.waitForTimeout(800)
check('narrow window unpins', (await geom()).pinned, false)
await page.setViewportSize({ width: 1600, height: 1000 })
await page.waitForTimeout(800)
check('and pins again when there is room', (await geom()).pinned, true)

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
