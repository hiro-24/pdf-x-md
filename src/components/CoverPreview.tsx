import { createPortal } from 'react-dom'
import { COVER_WIDTH } from '../lib/thumbnail'

interface Props {
  /** Screen rect of the title being hovered, to hang the card off. */
  anchor: DOMRect
  /** Object URL of the cover, or null while it is still being rendered. */
  src: string | null
}

/** Roughly A4 - only used to reserve space before the image arrives. */
const PLACEHOLDER_HEIGHT = Math.round(COVER_WIDTH * 1.414)

export default function CoverPreview({ anchor, src }: Props) {
  // Prefers the gutter to the left of the table: opening to the right would
  // cover the very row being inspected. Rendered through a portal so the
  // table's scroll box can't clip it.
  const margin = 14
  const toLeft = anchor.left - COVER_WIDTH - margin
  const left = toLeft >= 8 ? toLeft : Math.min(anchor.right + margin, window.innerWidth - COVER_WIDTH - 8)
  const top = Math.max(8, Math.min(anchor.top - 20, window.innerHeight - PLACEHOLDER_HEIGHT - 24))

  return createPortal(
    <div className="cover" style={{ left, top, width: COVER_WIDTH }}>
      {src ? (
        <img className="cover__img" src={src} alt="" width={COVER_WIDTH} />
      ) : (
        <div className="cover__loading" style={{ height: PLACEHOLDER_HEIGHT }}>
          表紙を生成中…
        </div>
      )}
    </div>,
    document.body,
  )
}
