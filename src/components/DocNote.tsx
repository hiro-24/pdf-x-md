import { useRef, useState, type CSSProperties } from 'react'
import NoteEditor from './NoteEditor'

interface Props {
  body: string
  /** The edge it hangs off - always the one away from the page. */
  side: 'left' | 'right'
  width: number
  /** Widest it may get before it would start covering the page. */
  maxWidth: number
  onChange: (body: string) => void
  onResize: (width: number) => void
  onClose: () => void
}

export const MIN_WIDTH = 280
export const DEFAULT_WIDTH = 420

const PLACEHOLDER =
  'この本全体のまとめ。\n\nページごとのメモと違って、どのページを読んでいても\nここに書けます。\n\n- Markdown で書けます\n- ⌘/Ctrl+Enter でプレビュー'

/**
 * One note for the whole document, rather than for a page.
 *
 * Page notes are read beside the page they belong to, which is what makes them
 * useful and also what makes them the wrong place to draw a book together: the
 * summary you are building while you read belongs to no single page. So this
 * one floats over the reading area, on the side away from the page, and stays
 * put while the pages go by underneath.
 */
export default function DocNote({ body, side, width, maxWidth, onChange, onResize, onClose }: Props) {
  const [editing, setEditing] = useState(true)
  const rootRef = useRef<HTMLElement>(null)

  /** Drag the inner edge. Written straight to the element: putting the width
   *  through state would re-render the editor on every frame of the drag. */
  const startResize = (event: React.PointerEvent) => {
    const root = rootRef.current
    if (!root || event.button !== 0) return
    event.preventDefault()
    const from = root.getBoundingClientRect().width
    const startX = event.clientX
    const toward = side === 'right' ? -1 : 1
    let latest = from

    const move = (moved: PointerEvent) => {
      latest = Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, from + (moved.clientX - startX) * toward)))
      root.style.setProperty('--doc-note-w', `${latest}px`)
    }
    const drop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', drop)
      onResize(latest)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', drop)
  }

  return (
    <aside
      ref={rootRef}
      className={`doc-note doc-note--${side}`}
      style={{ '--doc-note-w': `${Math.min(maxWidth, width)}px` } as CSSProperties}
    >
      <div
        className="doc-note__grip"
        onPointerDown={startResize}
        onDoubleClick={() => onResize(DEFAULT_WIDTH)}
        title="ドラッグで幅を変える（ダブルクリックで戻す）"
      />
      <header className="doc-note__head">
        <strong>まとめ</strong>
        <div className="note__tools">
          <button type="button" onClick={() => setEditing((value) => !value)}>
            {editing ? 'プレビュー' : '編集'}
          </button>
          <button type="button" onClick={onClose} title="閉じる (m)">
            ✕
          </button>
        </div>
      </header>

      <NoteEditor
        body={body}
        editing={editing}
        autoFocus
        placeholder={PLACEHOLDER}
        onChange={onChange}
        onDone={() => setEditing(false)}
        onEdit={() => setEditing(true)}
      />
    </aside>
  )
}
