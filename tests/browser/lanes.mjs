// The pinned page: notes scroll past it rather than pushing it off screen.
import { chromium } from 'playwright'
import { APP } from '../app-url.mjs'
const BIG = new URL('../fixtures/big.pdf', import.meta.url).pathname
let bad = 0
const check = (l, a, e) => { const ok = String(a) === String(e); if (!ok) bad += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}: ${a}${ok ? '' : ` (expected ${e})`}`) }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

const pin = async (side) => {
  await page.locator('.toolbar__group button', { hasText: side }).click()
  await page.waitForTimeout(400)
}
const geom = () => page.evaluate(() => {
  const track = document.querySelector('#page-1 .row__track')
  const box = (sel, i = 0) => {
    const el = document.querySelectorAll(`#page-1 ${sel}`)[i]
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }
  }
  return { scrollLeft: Math.round(track.scrollLeft), clientWidth: Math.round(track.clientWidth),
    pinned: track.classList.contains('is-pinned'), right: track.classList.contains('is-pinned-right'),
    pdf: box('.lane--pdf'), canvas: box('canvas'), notes: [0, 1, 2].map((i) => box('.lane--note', i)) }
})
const slideRight = async () => {
  await page.evaluate(() => { document.querySelector('#page-1 .row__track').scrollLeft = 99999 })
  await page.waitForTimeout(400)
}
/** Beside a right-hand page the lane runs the other way and scrollLeft counts
 *  down from zero, so "the far end" is the most negative position. */
const slideAway = async () => {
  await page.evaluate(() => { document.querySelector('#page-1 .row__track').scrollLeft = -99999 })
  await page.waitForTimeout(400)
}
const rest = async () => {
  await page.evaluate(() => { document.querySelector('#page-1 .row__track').scrollLeft = 0 })
  await page.waitForTimeout(400)
}
/**
 * Bring a note up against the page, using the browser's own scrolling.
 *
 * Nothing in the app drives this any more - the button that stepped note by
 * note is gone - but the guarantee it relied on still has to hold: a note
 * brought into view settles flush against the pinned page, never half behind
 * it. That is `scroll-padding` doing the work, which is the browser's, so the
 * browser is what drives it here. Reversed lanes snap to the other edge.
 */
const bring = async (index, side) => {
  await page.evaluate(([i, inline]) => {
    document.querySelectorAll('#page-1 .lane--note')[i].scrollIntoView({ inline, block: 'nearest', behavior: 'smooth' })
  }, [index, side === 'right' ? 'end' : 'start'])
  await stopped()
}
/** Smooth scrolling takes as long as it takes, and snapping happens after it.
 *  Two readings the same is the lane having finished with both. */
const stopped = async () => {
  let last = null
  for (let i = 0; i < 40; i += 1) {
    const now = await page.evaluate(() => Math.round(document.querySelector('#page-1 .row__track').scrollLeft))
    if (now === last) return
    last = now
    await page.waitForTimeout(150)
  }
}
const inset = () => page.evaluate(() =>
  Math.round(document.querySelector('#page-1 canvas').getBoundingClientRect().left))

await page.goto(APP)
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

// --- a note brought into view lands clear of the page, not half behind it ---
await page.evaluate(() => { document.querySelector('#page-1 .row__track').scrollLeft = 0 })
await page.waitForTimeout(300)
await bring(1, 'left')
g = await geom()
const landed = g.notes.filter(Boolean).find((n) => n.left >= g.pdf.right - 2 && n.right <= g.clientWidth + 2)
check('a whole note lands beside the page', landed !== undefined, 'true')
// Notes are meant to slide *behind* the pinned page; what must not happen is
// settling with a sliver of one showing beside it.
check('the note beside the page starts flush against it', Math.abs(landed.left - g.pdf.right) <= 2, 'true')

// --- held against the right edge instead: the mirror image, not a half-mirror ---
await rest()
await pin('右')
await rest()
g = await geom()
check('the track says which edge', [g.pinned, g.right].join(','), 'true,true')
check('the page moved to the right', g.pdf.right, g.clientWidth)
check('the first note is the one against the page', g.notes[0].right, g.pdf.left)
check('and the next queues up away from it', g.notes[1].right < g.notes[0].right, 'true')
check('no count is stamped on the page', await page.locator('#page-1 .peek').count(), 0)

// Reaching further along the lane still brings each note against the page.
await bring(1, 'right')
g = await geom()
check('the second note comes against the page', g.notes[1].right, g.pdf.left)
check('and the first slides behind it', g.notes[0].left >= g.pdf.left - 2, 'true')
await bring(2, 'right')
g = await geom()
check('and the third after it', g.notes[2].right, g.pdf.left)

await slideAway()
g = await geom()
check('the page holds the right edge at the far end', g.pdf.right, g.clientWidth)
check('and keeps its full width', g.pdf.width > 600, 'true')
await rest()

// The page should be the same distance in from its edge whichever side it is on.
await pin('左')
await rest()
const fromLeft = (await geom()).canvas.left
await pin('右')
await rest()
g = await geom()
check('inset from the right matches the inset from the left', g.clientWidth - g.canvas.right, fromLeft)

// A note added while the page is on the right must come to rest against it.
await page.locator('#page-1 .add-note').click()
await page.waitForTimeout(900)
await page.locator('#page-1 .note__editor').last().fill('# 右固定で追加\n\n本文')
await page.keyboard.press('Escape')
await page.waitForTimeout(700)
g = await geom()
const added = await page.evaluate(() => {
  const lanes = document.querySelectorAll('#page-1 .lane--note')
  const r = lanes[lanes.length - 1].getBoundingClientRect()
  return { left: Math.round(r.left), right: Math.round(r.right) }
})
check('a new note lands against the right-hand page', added.right, g.pdf.left)
check('and inside the window', added.left >= -2, 'true')
await rest()

// --- the escape hatch still works, and the side is remembered ---
await pin('なし')
await slideRight()
g = await geom()
check('turning it off lets the page slide away', g.pdf.left < 0, 'true')
check('and drops both classes', [g.pinned, g.right].join(','), 'false,false')

await pin('右')
await page.reload()
await page.waitForSelector('.doc-table__open')
await page.locator('.doc-table__open').first().click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForTimeout(1500)
g = await geom()
check('the side survives a reload', [g.pinned, g.right].join(','), 'true,true')
await pin('左')
g = await geom()
check('and switching back sticks', [g.pinned, g.right].join(','), 'true,false')

// --- a setting written before the page could pin right still means "left" ---
await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('pdf-note-app')
  r.onsuccess = () => {
    const tx = r.result.transaction('settings', 'readwrite')
    tx.objectStore('settings').put(true, 'pin-page')
    tx.oncomplete = () => { r.result.close(); res() }
  }
}))
await page.reload()
await page.waitForSelector('.doc-table__open')
await page.locator('.doc-table__open').first().click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForTimeout(1500)
g = await geom()
check('an old true setting reads as the left edge', [g.pinned, g.right].join(','), 'true,false')

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
// Resizing settles over several frames (the fit-to-window pass runs first), so
// wait for the class rather than guessing at a duration.
const resize = async (width, expect) => {
  await page.setViewportSize({ width, height: 1000 })
  await page
    .waitForFunction((want) => document.querySelector('#page-1 .row__track').classList.contains('is-pinned') === want,
      expect, { timeout: 10000 })
    .catch(() => {})
}
await resize(760, false)
check('narrow window unpins', (await geom()).pinned, false)
await resize(1600, true)
check('and pins again when there is room', (await geom()).pinned, true)
await pin('右')
await resize(760, false)
check('a right-hand page unpins on a narrow window too', (await geom()).right, false)
await resize(1600, true)
check('and comes back to the right, not the left', (await geom()).right, true)

// --- a row with nothing beside the page still holds it against the edge ---
// `sticky` needs something to scroll, and a page with no notes has nothing. The
// page used to sit wherever flex put it, which was the left - on most pages,
// since most pages have no notes. Only the page being pinned to the right made
// that visible, because on the left flex happened to already be correct.
await page.locator('#page-2').scrollIntoViewIfNeeded()
await page.waitForTimeout(1000)
const bare = () => page.evaluate(() => {
  const row = document.getElementById('page-2')
  const track = row.querySelector('.row__track')
  const lane = row.querySelector('.lane--pdf').getBoundingClientRect()
  return { notes: row.querySelectorAll('.lane--note').length,
    scrolls: track.scrollWidth > track.clientWidth,
    left: Math.round(lane.left), right: Math.round(lane.right), width: Math.round(track.clientWidth) }
})
let b = await bare()
check('the row has no notes, so nothing to scroll', [b.notes, b.scrolls].join(','), '0,false')
check('the bare row still holds the page on the right', b.right, b.width)
await pin('左')
b = await bare()
check('and on the left when asked', b.left, 0)

// The page has to be the same distance in from its edge on a row with notes and
// on one without, or scrolling down would shuffle it about.
// Measured on the page's box rather than on its canvas: a row that is off
// screen keeps the bitmap it was last drawn with, and only redraws when it
// comes back. The box is laid out from the current zoom either way, and the box
// is what "where the page sits" means.
const insetOf = (id) => page.evaluate((n) => {
  const b = document.querySelector(`#page-${n} .pdf-page`).getBoundingClientRect()
  const w = document.querySelector(`#page-${n} .row__track`).clientWidth
  return { left: Math.round(b.left), right: Math.round(w - b.right) }
}, id)

await pin('右')
await page.waitForTimeout(700)
check('a bare row and a noted row sit at the same inset',
  (await insetOf(2)).right, (await insetOf(1)).right)
await pin('左')
await page.waitForTimeout(700)
check('same on the left', (await insetOf(2)).left, (await insetOf(1)).left)

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
