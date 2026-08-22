import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { TAG_COLORS, type Tag, type TagColor } from '../types'

const WIDTH = 244
const MAX_HEIGHT = 340

/** Stands in for the not-yet-created tag when its colour is being chosen. */
const DRAFT = '\u0000draft'

interface Props {
  /** Screen rect of the button that opened this, to hang the menu off. */
  anchor: DOMRect
  /** Every tag in the library, so the menu can offer the ones not yet applied. */
  palette: Tag[]
  /** Tag names on this document. */
  applied: string[]
  onToggle: (name: string) => void
  onCreate: (tag: Tag) => void
  onRecolor: (name: string, color: TagColor) => void
  onClose: () => void
}

/** The nine colours, as a row of dots. */
function ColorGrid({ current, onPick }: { current: TagColor; onPick: (color: TagColor) => void }) {
  return (
    <div className="colorgrid">
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

/** Give a new tag a colour that isn't already crowding the palette. */
function nextColor(palette: Tag[]): TagColor {
  const used = new Map<TagColor, number>()
  for (const tag of palette) used.set(tag.color, (used.get(tag.color) ?? 0) + 1)
  return [...TAG_COLORS].sort((a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0))[0]
}

export default function TagPicker({ anchor, palette, applied, onToggle, onCreate, onRecolor, onClose }: Props) {
  const [query, setQuery] = useState('')
  /** Which tag's colour grid is open; DRAFT means the one being created. */
  const [editingColor, setEditingColor] = useState<string | null>(null)
  const [draftColor, setDraftColor] = useState<TagColor | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Close on an outside click, the way Gmail's label menu does.
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const trimmed = query.trim()
  const matches = useMemo(
    () => palette.filter((tag) => tag.name.toLowerCase().includes(trimmed.toLowerCase())),
    [palette, trimmed],
  )
  const exact = palette.some((tag) => tag.name.toLowerCase() === trimmed.toLowerCase())

  // A sensible colour is picked for you, but you can override it before creating.
  const newColor = draftColor ?? nextColor(palette)

  const create = () => {
    if (!trimmed || exact) return
    onCreate({ name: trimmed, color: newColor })
    onToggle(trimmed)
    setQuery('')
    setDraftColor(null)
    setEditingColor(null)
  }

  // The table scrolls, so an absolutely positioned menu would be clipped by it.
  // Fixed coordinates in a portal keep the menu out of every ancestor's box.
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8))
  const below = window.innerHeight - anchor.bottom
  const style: React.CSSProperties =
    below < MAX_HEIGHT && anchor.top > below
      ? { left, bottom: window.innerHeight - anchor.top + 6 }
      : { left, top: anchor.bottom + 6 }

  return createPortal(
    <div className="tagpicker" ref={rootRef} style={style}>
      <input
        ref={inputRef}
        className="tagpicker__search"
        value={query}
        placeholder="タグを検索、または新規作成"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
          if (event.key === 'Enter') {
            event.preventDefault()
            if (trimmed && !exact) create()
            else if (matches.length === 1) onToggle(matches[0].name)
          }
        }}
      />

      <div className="tagpicker__list">
        {matches.map((tag) => (
          <div key={tag.name} className="tagpicker__row">
            <label className="tagpicker__item">
              <input type="checkbox" checked={applied.includes(tag.name)} onChange={() => onToggle(tag.name)} />
              <span className={`tag tag--${tag.color}`}>{tag.name}</span>
            </label>
            <button
              type="button"
              className={`dot dot--${tag.color} dot--pick`}
              title="色を変える"
              onClick={() => setEditingColor(editingColor === tag.name ? null : tag.name)}
            />
            {editingColor === tag.name && (
              <ColorGrid
                current={tag.color}
                onPick={(color) => {
                  onRecolor(tag.name, color)
                  setEditingColor(null)
                }}
              />
            )}
          </div>
        ))}
        {matches.length === 0 && !trimmed && <p className="tagpicker__empty">まだタグがありません</p>}
      </div>

      {trimmed && !exact && (
        <div className="tagpicker__row tagpicker__row--new">
          <button type="button" className="tagpicker__create" onClick={create}>
            「{trimmed}」を新しいタグとして作成
          </button>
          <button
            type="button"
            className={`dot dot--${newColor} dot--pick`}
            title="作成する色を選ぶ"
            onClick={() => setEditingColor(editingColor === DRAFT ? null : DRAFT)}
          />
          {editingColor === DRAFT && (
            <ColorGrid
              current={newColor}
              onPick={(color) => {
                setDraftColor(color)
                setEditingColor(null)
              }}
            />
          )}
        </div>
      )}
    </div>,
    document.body,
  )
}
