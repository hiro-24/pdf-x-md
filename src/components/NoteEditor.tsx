import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Markdown from './Markdown'
import { converting } from '../lib/ime'
import {
  BULLET, HEADING, NUMBER, QUOTE, TASK,
  continueList, shiftLines, toggleLines, toggleWrap, type Field,
} from '../lib/markdown-edit'
import { insertImage, isImage } from '../lib/note-image'

export interface PendingQuote {
  text: string
  /** Bumped on every quote request so repeats of the same text still fire. */
  nonce: number
}

interface Props {
  body: string
  /** Writing, or reading back what was written. Owned by whoever frames this. */
  editing: boolean
  autoFocus?: boolean
  placeholder?: string
  pendingQuote?: PendingQuote | null
  onChange: (body: string) => void
  /** ⌘/Ctrl+Enter or Escape: the reader is done writing for now. */
  onDone: () => void
  /** Double-clicking what was written goes back to writing it. */
  onEdit: () => void
  /** Every keystroke, for a frame that needs to know before the save lands.
   *  Keep it to a ref: called this often, state would re-render per key. */
  onDraft?: (body: string) => void
  /** Keep an image and answer with the name the Markdown should point at.
   *  Absent where there is nowhere to keep one. */
  onAddImage?: (file: File) => Promise<string | null>
}

const SAVE_DELAY = 400

/** The formatting buttons, in the order they sit above the editor. */
const ASSISTS: { label: string; title: string; run: (field: Field) => Field }[] = [
  { label: 'H', title: '見出し', run: (f) => toggleLines(f, HEADING) },
  { label: 'B', title: '太字', run: (f) => toggleWrap(f, '**') },
  { label: '•', title: '箇条書き', run: (f) => toggleLines(f, BULLET) },
  { label: '1.', title: '番号つきの箇条書き', run: (f) => toggleLines(f, NUMBER) },
  { label: '☑', title: 'チェックボックス', run: (f) => toggleLines(f, TASK) },
  { label: '❝', title: '引用', run: (f) => toggleLines(f, QUOTE) },
  { label: '‹›', title: 'コード', run: (f) => toggleWrap(f, '`') },
]

/**
 * A Markdown field: the formatting buttons, the textarea, and the rendered
 * version of what is in it.
 *
 * The text belongs to the textarea while you type and reaches the store on a
 * timer, so that a note on a forty page document is not a write per keystroke.
 */
export default function NoteEditor({
  body, editing, autoFocus, placeholder, pendingQuote, onChange, onDone, onEdit, onDraft, onAddImage,
}: Props) {
  const [draft, setDraft] = useState(body)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Held in refs so the save timer does not restart every time whoever frames
  // this re-renders - scrolling the document would otherwise keep pushing the
  // save into the future.
  const latest = useRef({ draft, body, onChange })
  const onDraftRef = useRef(onDraft)
  useLayoutEffect(() => {
    latest.current = { draft, body, onChange }
    onDraftRef.current = onDraft
  })
  const flush = () => {
    const { draft: text, body: saved, onChange: save } = latest.current
    if (text !== saved) save(text)
  }

  useEffect(() => {
    // preventScroll: the card is already placed where the reader is looking, and
    // letting the browser scroll to it yanks the page out from under them.
    if (autoFocus) textareaRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  useEffect(() => {
    onDraftRef.current?.(draft)
  }, [draft])

  useEffect(() => {
    if (draft === body) return
    const timer = setTimeout(flush, SAVE_DELAY)
    return () => clearTimeout(timer)
  }, [draft, body])

  // Whatever is in the field when writing stops is what gets kept.
  useEffect(() => {
    if (!editing) return
    return flush
  }, [editing])

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
    onEdit()
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      textarea.focus({ preventScroll: true })
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length
      textarea.scrollTop = textarea.scrollHeight
    })
  }, [pendingQuote])

  /** Run an edit over the textarea's own text and put the caret back after. */
  const apply = (run: (field: Field) => Field) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const next = run({ value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd })
    setDraft(next.value)
    // The new text only reaches the textarea on the next render, so the
    // selection has to wait for it.
    requestAnimationFrame(() => {
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(next.start, next.end)
    })
  }

  /** Keep the image, then write a line pointing at it where the caret is. */
  const takeImage = async (file: File) => {
    if (!onAddImage || !isImage(file.type)) return
    const name = await onAddImage(file)
    const textarea = textareaRef.current
    if (!name || !textarea) return
    const next = insertImage(
      { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd },
      name,
      file.name.replace(/\.[^.]+$/, ''),
    )
    setDraft(next.value)
    requestAnimationFrame(() => {
      textarea.focus({ preventScroll: true })
      textarea.setSelectionRange(next.start, next.end)
    })
  }
  /** The first image in whatever was handed over; the rest of a drop is text. */
  const imageFrom = (files: FileList | null | undefined) =>
    files && [...files].find((file) => isImage(file.type))

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // While the IME is converting, the keys belong to the conversion.
    if (converting(event)) return
    if (event.key === 'Escape') {
      event.currentTarget.blur()
      onDone()
      return
    }
    // Tab indents instead of leaving the field. Taking a key away from moving
    // focus is only fair because there is another way out, and Escape is it.
    if (event.key === 'Tab') {
      event.preventDefault()
      const textarea = event.currentTarget
      const next = shiftLines(
        { value: textarea.value, start: textarea.selectionStart, end: textarea.selectionEnd },
        event.shiftKey,
      )
      setDraft(next.value)
      requestAnimationFrame(() => textarea.setSelectionRange(next.start, next.end))
      return
    }
    // Cmd/Ctrl+Enter is the usual "I'm done writing" gesture.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      onDone()
      return
    }
    // Enter inside a list carries the list on, and ends it on an empty item.
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      const textarea = event.currentTarget
      const next = continueList({
        value: textarea.value,
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
      })
      if (!next) return
      event.preventDefault()
      setDraft(next.value)
      requestAnimationFrame(() => textarea.setSelectionRange(next.start, next.end))
    }
  }

  return (
    <>
      {editing && (
        <div className="note__assist">
          {ASSISTS.map((assist) => (
            <button
              key={assist.label}
              type="button"
              title={assist.title}
              // Keep the click from taking focus: the selection in the textarea
              // is the thing being formatted.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => apply(assist.run)}
            >
              {assist.label}
            </button>
          ))}
          {onAddImage && (
            <>
              <button
                type="button"
                className="note__image-button"
                title="画像を入れる（貼り付けや、放り込むのでも入ります）"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => fileRef.current?.click()}
              >
                🖼
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void takeImage(file)
                }}
              />
            </>
          )}
        </div>
      )}

      <div className="note__body">
        {editing ? (
          <textarea
            ref={textareaRef}
            className="note__editor"
            value={draft}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={flush}
            onKeyDown={handleKeyDown}
            onPaste={(event) => {
              const file = imageFrom(event.clipboardData.files)
              if (!file) return
              event.preventDefault()
              void takeImage(file)
            }}
            // Without this the browser opens the dropped file instead, which
            // throws away whatever was being written. Mid-drag only the kinds
            // are readable - the files themselves arrive with the drop.
            onDragOver={(event) => {
              const carrying = [...event.dataTransfer.items].some(
                (item) => item.kind === 'file' && isImage(item.type),
              )
              if (carrying) event.preventDefault()
            }}
            onDrop={(event) => {
              const file = imageFrom(event.dataTransfer.files)
              if (!file) return
              event.preventDefault()
              void takeImage(file)
            }}
          />
        ) : (
          <div className="note__preview" onDoubleClick={onEdit}>
            <Markdown>{draft}</Markdown>
          </div>
        )}
      </div>
    </>
  )
}
