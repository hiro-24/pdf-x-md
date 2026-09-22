// Dragging the gutter moves the page in from its edge, on either side.
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
  await page.waitForTimeout(500)
}
const where = () => page.evaluate(() => {
  const track = document.querySelector('#page-1 .row__track')
  const box = document.querySelector('#page-1 .pdf-page').getBoundingClientRect()
  const grip = document.querySelector('#page-1 .lane__grip')
  return { left: Math.round(box.left), right: Math.round(track.clientWidth - box.right),
    gutter: Math.round(parseFloat(getComputedStyle(document.querySelector('.pages')).getPropertyValue('--page-gutter'))),
    grip: grip ? Math.round(grip.getBoundingClientRect().width) : null }
})
/** Drag the grip by dx, in real pointer events. */
const dragBy = async (dx) => {
  const grip = await page.locator('#page-1 .lane__grip').boundingBox()
  const y = grip.y + grip.height / 2
  await page.mouse.move(grip.x + grip.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 + dx, y, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(500)
}

await page.goto(APP)
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.setInputFiles('input[type=file][accept*="pdf"]', BIG)
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('#page-1 .textLayer span').length >= 3, null, { timeout: 60000 })

const auto = await where()
console.log('    automatic:', JSON.stringify(auto))
check('the grip covers the gutter', auto.grip, auto.gutter)

// --- dragging right moves a left-hand page right ---
await dragBy(120)
let now = await where()
check('the page followed the drag', now.left, auto.left + 120)
check('and the gutter went with it', now.gutter, auto.gutter + 120)

// --- what is set by hand is remembered ---
await page.reload()
await page.waitForSelector('.doc-table__open')
await page.locator('.doc-table__open').first().click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForTimeout(1500)
check('the position survives a reload', (await where()).left, auto.left + 120)

// --- and a double click hands it back to the worked-out figure ---
await page.locator('#page-1 .lane__grip').dblclick()
await page.waitForTimeout(600)
check('double click restores the automatic position', (await where()).left, auto.left)

// --- the same handle works with the page on the right, and mirrors ---
await pin('右')
const autoRight = await where()
check('the automatic inset is the same on the right', autoRight.right, auto.left)
await dragBy(-150)
now = await where()
check('dragging left moves a right-hand page left', now.right, autoRight.right + 150)
check('the page itself moved', now.left, autoRight.left - 150)

// --- it cannot be dragged so far that a note stops fitting ---
await dragBy(-2000)
now = await where()
const room = await page.evaluate(() => {
  const track = document.querySelector('#page-1 .row__track')
  const box = document.querySelector('#page-1 .lane--pdf').getBoundingClientRect()
  return Math.round(track.clientWidth - box.width)
})
check(`a note still has room beside it (${room}px)`, room >= 300, 'true')

// --- nor squeezed below the minimum the other way ---
await dragBy(2000)
check('and it stops at the minimum', (await where()).right, 24)

await page.locator('#page-1 .lane__grip').dblclick()
await page.waitForTimeout(600)
await pin('なし')
check('no handle when the page is not held anywhere', await page.locator('#page-1 .lane__grip').count(), 0)

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
