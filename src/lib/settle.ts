/** Anything here means the reader has taken over; stop pulling them back. */
const GIVE_UP_ON = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const

interface Options {
  /** Runs after each re-aim, to keep the page indicator honest. */
  onStep: () => void
  /** Runs once the row has stopped moving, or the budget has run out. */
  onDone?: () => void
  /** How long to keep correcting. */
  budget?: number
}

/**
 * Put a page row at the top of the window and hold it there while the layout
 * settles underneath it.
 *
 * Aiming once is not enough. A row that has not been rendered yet stands at a
 * placeholder height, so every page between here and the target is a little
 * short and the jump lands before it - by a page or two in a short document,
 * further in a long one. The same happens on open, where the rows are laid out
 * at the old zoom for a frame or two while fit-to-window is worked out.
 *
 * Returns a function that stops the correction early.
 */
export function settleOn(page: number, { onStep, onDone, budget = 2000 }: Options): () => void {
  let frame = 0
  let steady = 0
  let previousTop = -1
  const deadline = performance.now() + budget

  const stop = () => {
    cancelAnimationFrame(frame)
    for (const name of GIVE_UP_ON) window.removeEventListener(name, stop)
    onDone?.()
  }

  const step = () => {
    const row = document.getElementById(`page-${page}`)
    if (row) {
      const top = Math.round(row.getBoundingClientRect().top + window.scrollY)
      steady = top === previousTop ? steady + 1 : 0
      previousTop = top
      row.scrollIntoView({ block: 'start' })
      onStep()
    }
    if (steady < 3 && performance.now() < deadline) frame = requestAnimationFrame(step)
    else stop()
  }

  for (const name of GIVE_UP_ON) window.addEventListener(name, stop, { passive: true })
  frame = requestAnimationFrame(step)
  return stop
}
