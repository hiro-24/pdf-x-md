import { useEffect, useRef, useState } from 'react'

/** How long the hint stays up. The fade in styles.css (`resume-out`) starts
 *  half a second before this and ends on it. */
export const HINT_MS = 5000

interface Props {
  page: number
  onTop: () => void
  /** Time is up. */
  onGone: () => void
}

/**
 * "Resumed at p.N", with a way back to the start.
 *
 * It holds still while the pointer is on it or the button has focus: a reader
 * reaching for 先頭へ at the four-and-a-half second mark would otherwise have
 * it fade out from under the cursor, and the click land on the page behind.
 * The countdown pauses rather than restarts, and the fade pauses with it
 * (`animation-play-state` in styles.css), so the two still end together.
 *
 * The timer, not the fade, is what removes it - with reduced motion there is
 * no fade to wait for.
 */
export default function ResumeHint({ page, onTop, onGone }: Props) {
  const [pointed, setPointed] = useState(false)
  const [focused, setFocused] = useState(false)
  const left = useRef(HINT_MS)
  const held = pointed || focused

  useEffect(() => {
    if (held) return
    const started = performance.now()
    const timer = setTimeout(onGone, left.current)
    return () => {
      clearTimeout(timer)
      left.current = Math.max(0, left.current - (performance.now() - started))
    }
  }, [held, onGone])

  return (
    <div
      className="resume"
      role="status"
      // over/out, not enter/leave. React builds enter/leave out of the `out`
      // event of whatever the pointer was on before, and when the hint comes up
      // under a pointer that is resting there, that event does not always reach
      // it - the fade would pause on :hover while the timer took the hint away
      // anyway. `over` is the browser's own event and always arrives.
      onPointerOver={() => setPointed(true)}
      onPointerOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPointed(false)
      }}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      <span>
        前回の続き <strong>p.{page}</strong> から開きました
      </span>
      <button type="button" onClick={onTop}>
        先頭へ
      </button>
    </div>
  )
}
