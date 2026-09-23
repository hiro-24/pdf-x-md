import { useRef, useState } from 'react'
import NoteEditor, { type PendingQuote } from './NoteEditor'
import type { Note } from '../types'

export type { PendingQuote }

interface Props {
  note: Note
  index: number
  count: number
  /** Newly created notes open straight into the editor. */
  autoFocus: boolean
  pendingQuote: PendingQuote | null
  onChange: (id: string, body: string) => void
  onDelete: (id: string) => void
  onMove: (id: string, direction: -1 | 1) => void
  onAddImage: (file: File) => Promise<string | null>
}

const PLACEHOLDER = '# 見出し\n\n- Markdown で書けます\n- 上のボタンか、箇条書きの続きは Enter で\n- ⌘/Ctrl+Enter でプレビュー'

/** One note on one page: the writing surface, with its place in the row. */
export default function NoteCard({
  note, index, count, autoFocus, pendingQuote, onChange, onDelete, onMove, onAddImage,
}: Props) {
  const [editing, setEditing] = useState(autoFocus || note.body.trim() === '')
  /** What is in the field right now, which the saved copy lags by a moment.
   *  Deleting asks the reader first, and it has to ask about what they see. */
  const draft = useRef(note.body)

  return (
    <article className="note">
      <header className="note__bar">
        <span className="note__label">
          メモ {index + 1}/{count}
        </span>
        <div className="note__tools">
          <button type="button" onClick={() => onMove(note.id, -1)} disabled={index === 0} title="左へ">
            ←
          </button>
          <button type="button" onClick={() => onMove(note.id, 1)} disabled={index === count - 1} title="右へ">
            →
          </button>
          <button type="button" onClick={() => setEditing((value) => !value)}>
            {editing ? 'プレビュー' : '編集'}
          </button>
          <button
            type="button"
            className="is-danger"
            onClick={() => {
              if (draft.current.trim() === '' || confirm('このメモを削除しますか？')) onDelete(note.id)
            }}
            title="削除"
          >
            ✕
          </button>
        </div>
      </header>

      <NoteEditor
        body={note.body}
        editing={editing}
        autoFocus={autoFocus}
        placeholder={PLACEHOLDER}
        pendingQuote={pendingQuote}
        onChange={(body) => onChange(note.id, body)}
        onDone={() => setEditing(false)}
        onEdit={() => setEditing(true)}
        onDraft={(body) => (draft.current = body)}
        onAddImage={onAddImage}
      />
    </article>
  )
}
