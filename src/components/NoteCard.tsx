import { useEffect, useRef, useState } from 'react'
import Markdown from './Markdown'
import type { Note } from '../types'

export interface PendingQuote {
  text: string
  /** Bumped on every quote request so repeats of the same text still fire. */
  nonce: number
}

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
}

const SAVE_DELAY = 400

export default function NoteCard({ note, index, count, autoFocus, pendingQuote, onChange, onDelete, onMove }: Props) {
  // The textarea owns the text while you type; the store catches up on a timer.
  const [draft, setDraft] = useState(note.body)
  const [editing, setEditing] = useState(autoFocus || note.body.trim() === '')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // preventScroll: the card is already placed where the reader is looking, and
    // letting the browser scroll to it yanks the page out from under them.
    if (autoFocus) textareaRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  useEffect(() => {
    if (draft === note.body) return
    const timer = setTimeout(() => onChange(note.id, draft), SAVE_DELAY)
    return () => clearTimeout(timer)
  }, [draft, note.body, note.id, onChange])

  // Text sent over from the PDF pane gets appended as a blockquote.
  const lastNonce = useRef(pendingQuote?.nonce ?? 0)
  useEffect(() => {
    if (!pendingQuote || pendingQuote.nonce === lastNonce.current) return
    lastNonce.current = pendingQuote.nonce
    const block = pendingQuote.text
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n')
    setDraft((current) => (current.trim() ? `${current.replace(/\s*$/, '')}\n\n${block}\n\n` : `${block}\n\n`))
    setEditing(true)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus({ preventScroll: true })
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length
      textarea.scrollTop = textarea.scrollHeight
    })
  }, [pendingQuote])

  const flush = () => {
    if (draft !== note.body) onChange(note.id, draft)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.currentTarget.blur()
      setEditing(false)
      return
    }
    // Cmd/Ctrl+Enter is the usual "I'm done writing" gesture.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      flush()
      setEditing(false)
    }
  }

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
          <button
            type="button"
            onClick={() => {
              flush()
              setEditing((value) => !value)
            }}
          >
            {editing ? 'プレビュー' : '編集'}
          </button>
          <button
            type="button"
            className="is-danger"
            onClick={() => {
              if (draft.trim() === '' || confirm('このメモを削除しますか？')) onDelete(note.id)
            }}
            title="削除"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="note__body">
        {editing ? (
          <textarea
            ref={textareaRef}
            className="note__editor"
            value={draft}
            placeholder={'# 見出し\n\n- Markdown で書けます\n- ⌘/Ctrl+Enter でプレビュー'}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={flush}
            onKeyDown={handleKeyDown}
          />
        ) : (
          <div className="note__preview" onDoubleClick={() => setEditing(true)}>
            <Markdown>{draft}</Markdown>
          </div>
        )}
      </div>
    </article>
  )
}
