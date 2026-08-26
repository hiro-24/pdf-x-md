import { TAG_COLORS, type TagColor } from '../types'

/** The grid's own size, kept in step with .colorgrid in the stylesheet: five
 *  18px dots with 6px gaps, 8px of padding and a 1px border. */
const GRID_WIDTH = 132
const GRID_HEIGHT = 60

interface Props {
  /** Screen rect of the swatch that opened this, to hang the grid off. */
  anchor: DOMRect
  current: TagColor
  onPick: (color: TagColor) => void
}

/**
 * The nine colours, as a row of dots.
 *
 * Positioned against the viewport rather than against whatever opened it. Both
 * callers live inside a scroll box, and an absolutely placed grid is clipped by
 * it: clicking the swatch drew the grid somewhere you could neither see nor
 * click, which reads as the colours simply not being changeable.
 */
export default function ColorGrid({ anchor, current, onPick }: Props) {
  const left = Math.max(8, Math.min(anchor.right - GRID_WIDTH, window.innerWidth - GRID_WIDTH - 8))
  const room = window.innerHeight - anchor.bottom
  const top = room < GRID_HEIGHT + 8 ? anchor.top - GRID_HEIGHT - 4 : anchor.bottom + 4

  return (
    <div className="colorgrid" style={{ left, top }}>
      {TAG_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          className={`dot dot--${color}${color === current ? ' is-current' : ''}`}
          title={color}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  )
}
