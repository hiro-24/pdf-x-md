import { useRef, useState, type CSSProperties } from 'react'
import NoteEditor from './NoteEditor'
import { firstLine } from '../lib/markdown-edit'
import type { Note } from '../types'

interface Props {
  /** Every whole-document note, in tab order. */
  notes: Note[]
  /** Which one is showing. Null means the first, or a blank one if there are none. */
  shownId: string | null
  /** The edge it hangs off - always the one away from the page. */
  side: 'left' | 'right'
  width: number
  /** Widest it may get before it would start covering the page. */
  maxWidth: number
  onSelect: (id: string) => void
  onAdd: () => void
  onDelete: (id: string) => void
  /** With no id, this is the blank one: writing into it is what makes it. */
  onChange: (id: string | null, body: string) => void
  onResize: (width: number) => void
  onClose: () => void
}

export const MIN_WIDTH = 280
export const DEFAULT_WIDTH = 420
/** Enough of a name to tell one tab from another without crowding the row. */
const TAB_CHARS = 14

const PLACEHOLDER =
  'この本全体のまとめ。\n\nページごとのメモと違って、どのページを読んでいても\nここに書けます。\n\n- 1行目がタブの名前になります\n- ⌘/Ctrl+Enter でプレビュー'

/**
 * Notes for the whole document, rather than for a page.
 *
 * Page notes are read beside the page they belong to, which is what makes them
 * useful and also what makes them the wrong place to draw a book together: the
 * summary you are building while you read belongs to no single page. So these
 * float over the reading area, on the side away from the page, and stay put
 * while the pages go by underneath.
 *
 * There can be several - a book is not always one thread - and they are told
 * apart by their first line, which is the title the way it is in a notebook.
 */
export default function DocNote({
  notes, shownId, side, width, maxWidth, onSelect, onAdd, onDelete, onChange, onResize, onClose,
}: Props) {
  const [editing, setEditing] = useState(true)
  const rootRef = useRef<HTMLElement>(null)

  const shown = notes.find((note) => note.id === shownId) ?? notes[0] ?? null
  // The blank one keeps the same key as it becomes real, so that the first
  // keystroke does not rebuild the field underneath the reader's hands.
  const fieldKey = shownId ?? 'new'

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

  const remove = () => {
    if (!shown) return
    if (shown.body.trim() && !confirm(`「${firstLine(shown.body) || '無題'}」を削除しますか？`)) return
    onDelete(shown.id)
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
          <button type="button" className="is-danger" onClick={remove} disabled={!shown} title="このまとめを削除">
            削除
          </button>
          <button type="button" onClick={onClose} title="閉じる (m)">
            ✕
          </button>
        </div>
      </header>

      <div className="doc-note__tabs">
        {(notes.length ? notes : [null]).map((note) => (
          <button
            key={note?.id ?? 'new'}
            type="button"
            className={(note?.id ?? null) === (shown?.id ?? null) ? 'is-on' : ''}
            onClick={() => note && onSelect(note.id)}
            title={note ? firstLine(note.body) || '無題' : '無題'}
          >
            {(note ? firstLine(note.body) : '').slice(0, TAB_CHARS) || '無題'}
          </button>
        ))}
        <button type="button" className="doc-note__add" onClick={onAdd} title="まとめを追加">
          ＋
        </button>
      </div>

      <NoteEditor
        key={fieldKey}
        body={shown?.body ?? ''}
        editing={editing}
        autoFocus
        placeholder={PLACEHOLDER}
        onChange={(body) => onChange(shown?.id ?? null, body)}
        onDone={() => setEditing(false)}
        onEdit={() => setEditing(true)}
      />
    </aside>
  )
}
