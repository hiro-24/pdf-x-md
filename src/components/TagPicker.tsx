import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ColorGrid from './ColorGrid'
import { nextColor } from '../lib/palette'
import { converting } from '../lib/ime'
import type { Tag, TagColor } from '../types'

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

export default function TagPicker({ anchor, palette, applied, onToggle, onCreate, onRecolor, onClose }: Props) {
  const [query, setQuery] = useState('')
  /** Whose colour grid is open, and the swatch it hangs off. DRAFT means the
   *  tag being created. */
  const [colorFor, setColorFor] = useState<{ name: string; anchor: DOMRect } | null>(null)
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

  // On the document, not on the search box: once you have clicked a swatch or
  // the create button the box no longer has focus, and Escape did nothing.
  // It backs out one layer at a time - the colour grid first, then the menu.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape during a conversion cancels the conversion, not the menu.
      if (converting(event) || event.key !== 'Escape') return
      if (colorFor) setColorFor(null)
      else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [colorFor, onClose])

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
    setColorFor(null)
  }

  /** Reopening on the same swatch closes it; on another, moves there. */
  const toggleGrid = (name: string, swatch: HTMLElement) =>
    setColorFor((current) => (current?.name === name ? null : { name, anchor: swatch.getBoundingClientRect() }))

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
          if (converting(event)) return
          if (event.key === 'Enter') {
            event.preventDefault()
            if (trimmed && !exact) create()
            else if (matches.length === 1) onToggle(matches[0].name)
          }
        }}
      />

      {/* The grid is placed from a rect taken when it opened, so scrolling the
          list out from under it would leave it stranded. */}
      <div className="tagpicker__list" onScroll={() => setColorFor(null)}>
        {matches.map((tag) => (
          <div key={tag.name} className="tagpicker__row">
            <label className="tagpicker__item">
              <input type="checkbox" checked={applied.includes(tag.name)} onChange={() => onToggle(tag.name)} />
              <span className={`tag tag--${tag.color}`} title={tag.description?.trim() || undefined}>
                {tag.name}
              </span>
            </label>
            <button
              type="button"
              className={`dot dot--${tag.color} dot--pick`}
              title="色を変える"
              onClick={(event) => toggleGrid(tag.name, event.currentTarget)}
            />
            {colorFor?.name === tag.name && (
              <ColorGrid
                anchor={colorFor.anchor}
                current={tag.color}
                onPick={(color) => {
                  onRecolor(tag.name, color)
                  setColorFor(null)
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
            onClick={(event) => toggleGrid(DRAFT, event.currentTarget)}
          />
          {colorFor?.name === DRAFT && (
            <ColorGrid
              anchor={colorFor.anchor}
              current={newColor}
              onPick={(color) => {
                setDraftColor(color)
                setColorFor(null)
              }}
            />
          )}
        </div>
      )}
    </div>,
    document.body,
  )
}
