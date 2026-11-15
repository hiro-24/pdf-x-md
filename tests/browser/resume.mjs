// Reopening a document lands back where the reader left off.
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

const cur = async () => (await page.locator('.toolbar__page').textContent()).trim()
const offBy = async (n) => page.evaluate((p) =>
  Math.round(document.getElementById(`page-${p}`).getBoundingClientRect().top), n)
const stored = () => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('pdf-note-app')
  r.onsuccess = () => {
    const g = r.result.transaction('docs').objectStore('docs').getAll()
    g.onsuccess = () => { res(g.result.map((d) => ({ lastPage: d.lastPage, metaAt: d.metaAt }))); r.result.close() }
  }
}))
/** Wait for the toolbar to say which page it is on. */
const showing = (n) =>
  page.waitForFunction((p) => document.querySelector('.toolbar__page')?.textContent.trim().startsWith(`p.${p} `),
    n, { timeout: 20000 }).catch(() => {})
/**
 * Wait for the debounced write of the reading position to land.
 *
 * Looped here rather than in `waitForFunction`: a page function that returns a
 * Promise hands back an object, and an object is truthy, so the wait succeeds
 * on its first call without anyone looking at what the database said.
 */
const recorded = async (n) => {
  for (let i = 0; i < 40; i += 1) {
    if ((await stored())[0]?.lastPage === n) return
    await page.waitForTimeout(250)
  }
}
/** The hint's lifetime, from ResumeHint.tsx. */
const HINT_MS = 5000
/** Let the hint's own time run out, counted from when it was seen. The hint went
 *  up no later than that, so past this it would have gone had nothing held it. */
const outlast = async (seenAt) => page.waitForTimeout(Math.max(0, seenAt + HINT_MS + 500 - Date.now()))
/**
 * A point inside the resume hint, worked out before it exists: it sits centred,
 * `bottom` px above the window's edge. Read from the stylesheet so this follows
 * the CSS rather than repeating it.
 */
const hintSpot = async () => {
  const bottom = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) if (rule.selectorText === '.resume') return parseFloat(rule.style.bottom)
      } catch {
        // A sheet from another origin keeps its rules to itself.
      }
    }
    return NaN
  })
  const { width, height } = page.viewportSize()
  return { x: width / 2, y: height - bottom - 8 }
}
/**
 * Open the first document from the library with the pointer resting where the
 * resume hint will come up, so the hint holds still for as long as the test
 * needs it.
 *
 * Under CDP, pdf.js can hold the main thread for most of the five seconds the
 * hint is up. Checking the landing first and clicking 先頭へ second used to
 * race the fade and lose about one run in two; even hover() after the hint
 * appeared took up to 4.2s to land, since it waits for frames that pdf.js is
 * holding up. A pointer that is already there costs no round trip at all.
 */
const openHeld = async (spot) => {
  await page.locator('.doc-table__open').first().click()
  await page.mouse.move(spot.x, spot.y)
  await page.waitForSelector('.resume', { timeout: 60000 })
  return Date.now()
}
/** Reopen after a reload, returning the hint's text and when it was seen. */
const reopen = async (spot) => {
  await page.reload()
  await page.waitForSelector('.doc-table__open')
  const seenAt = await openHeld(spot)
  const text = await page.locator('.resume').innerText({ timeout: 20000 }).catch(() => '')
  await page.waitForTimeout(1200)
  return { text: text.replace(/\s+/g, ' '), seenAt }
}

await page.goto(APP)
await page.evaluate(() => indexedDB.deleteDatabase('pdf-note-app'))
await page.reload()
await page.setInputFiles('input[type=file][accept*="pdf"]', BIG)
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.waitForFunction(() => document.querySelectorAll('#page-1 .textLayer span').length >= 3, null, { timeout: 60000 })
check('opens at page 1', await cur(), 'p.1 / 40')
check('no hint on a first read', await page.locator('.resume').count(), 0)

// --- deep into a long document, the case a single jump used to undershoot ---
await page.locator('#page-31').scrollIntoViewIfNeeded()
await showing(31)
check('reading page 31', await cur(), 'p.31 / 40')
// The position is written 800ms after the scrolling stops, so wait for the
// write rather than for a guess at how long the scrolling took.
await recorded(31)
check('page recorded', (await stored())[0].lastPage, 31)
check('position is stamped', (await stored())[0].metaAt > 0, 'true')

const spot = await hintSpot()
const { text: hint, seenAt } = await reopen(spot)
check(`says where it resumed ("${hint}")`, hint.includes('p.31'), 'true')
await showing(31)
check('resumes on page 31', await cur(), 'p.31 / 40')
check('lands on the row, not near it', Math.abs(await offBy(31)) <= 72, 'true')

// --- the hint waits while the pointer is on it ---
await outlast(seenAt)
check('the hint stays while the pointer is on it', await page.locator('.resume').count(), 1)

// --- and offers a way back ---
await page.locator('.resume button').click()
await page.waitForTimeout(900)
check('先頭へ goes to page 1', await cur(), 'p.1 / 40')
check('hint dismissed', await page.locator('.resume').count(), 0)

// --- leaving via the back button flushes the position immediately ---
await page.locator('#page-17').scrollIntoViewIfNeeded()
await page.waitForTimeout(300)
await page.locator('.toolbar__back').click()
await page.waitForSelector('.doc-table, .shelf')
check('back button flushed the page', (await stored())[0].lastPage, 17)

await page.locator('.doc-table__open').first().click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
await showing(17)
check('reopening within the session resumes', await cur(), 'p.17 / 40')

// --- a reader who scrolls during the restore is not dragged back ---
await page.locator('#page-25').scrollIntoViewIfNeeded()
await recorded(25)
await page.reload()
await page.waitForSelector('.doc-table__open')
await page.locator('.doc-table__open').first().click()
await page.waitForSelector('.toolbar', { timeout: 60000 })
await page.mouse.wheel(0, 400)
await page.waitForTimeout(1500)
check('a scroll during the restore wins', (await cur()) !== 'p.25 / 40' || Math.abs(await offBy(25)) > 0, 'true')

// --- left alone, the hint disappears on its own ---
// The pointer is still where it clicked the table, well clear of the hint.
await page.waitForSelector('.resume', { state: 'detached', timeout: HINT_MS + 10000 }).catch(() => {})
check('hint clears itself', await page.locator('.resume').count(), 0)

// --- held, it waits; let go, and it goes ---
await page.locator('.toolbar__back').click()
await page.waitForSelector('.doc-table')
await outlast(await openHeld(spot))
check('a pointed-at hint outlasts its five seconds', await page.locator('.resume').count(), 1)
// The summary is the hint's sibling in the viewer. Opening it while the hint is
// up once gave the two the same React key - an error on the console, which
// fails this suite. Holding the hint makes that moment certain to happen here.
await page.keyboard.press('m')
await page.waitForSelector('.doc-note')
check('the summary opens with the hint still up', await page.locator('.resume').count(), 1)
await page.mouse.move(40, 500)
await page.waitForSelector('.resume', { state: 'detached', timeout: HINT_MS + 10000 }).catch(() => {})
check('once the pointer leaves, it goes', await page.locator('.resume').count(), 0)

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors')
await browser.close()
process.exit(bad ? 1 : 0)
