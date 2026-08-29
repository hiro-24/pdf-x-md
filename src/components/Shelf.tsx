import { useEffect, useRef, useState } from 'react'
import { titleOf } from './DocTable'
import type { DocSummary, Tag } from '../types'

/** Start the cover a screenful early, so scrolling rarely lands on a blank. */
const PRELOAD_MARGIN = '400px 0px'

interface Props {
  docs: DocSummary[]
  palette: Tag[]
  noteCounts: Map<string, number>
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  /** Resolves to an object URL, rendering the cover if this is the first look. */
  onRequestCover: (id: string) => Promise<string | null>
}

interface TileProps extends Omit<Props, 'docs'> {
  doc: DocSummary
}

function Tile({ doc, palette, noteCounts, onOpen, onDelete, onRequestCover }: TileProps) {
  const ref = useRef<HTMLElement>(null)
  const [src, setSrc] = useState<string | null>(null)
  /** A ref, not state: setting state here would re-run the effect below, and its
   *  cleanup would cancel the very request that had just been made. */
  const asked = useRef(false)

  // Ask only for what is nearly on screen. A shelf of documents imported before
  // covers existed would otherwise re-parse every PDF the moment it opened.
  useEffect(() => {
    const tile = ref.current
    if (!tile) return
    let alive = true

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || asked.current) return
        asked.current = true
        observer.disconnect()
        onRequestCover(doc.id).then((url) => {
          if (alive) setSrc(url)
        }, console.error)
      },
      { rootMargin: PRELOAD_MARGIN },
    )
    observer.observe(tile)

    return () => {
      alive = false
      observer.disconnect()
    }
  }, [doc.id, onRequestCover])

  const title = titleOf(doc)
  const notes = noteCounts.get(doc.id) ?? 0
  const tags = (doc.tags ?? [])
    .map((name) => palette.find((tag) => tag.name === name))
    .filter((tag): tag is Tag => Boolean(tag))

  return (
    <article ref={ref} className="tile">
      <button type="button" className="tile__cover" onClick={() => onOpen(doc.id)} title={title}>
        {src ? (
          <img src={src} alt="" loading="lazy" />
        ) : (
          // Not a spinner: most covers arrive in a frame or two from IndexedDB,
          // and a flashing placeholder on every tile is worse than a quiet one.
          <span className="tile__blank">{title}</span>
        )}
        {notes > 0 && <span className="tile__notes">メモ {notes}</span>}
      </button>

      <div className="tile__body">
        <button type="button" className="tile__title" onClick={() => onOpen(doc.id)}>
          {title}
        </button>
        <div className="tile__meta">
          <span>{doc.pageCount} ページ</span>
          <button
            type="button"
            className="tile__delete"
            title="この PDF を削除"
            onClick={() => {
              if (confirm(`「${title}」を削除します。メモとハイライトも消えます。よろしいですか？`)) onDelete(doc.id)
            }}
          >
            削除
          </button>
        </div>
        {tags.length > 0 && (
          <div className="tile__tags">
            {tags.map((tag) => (
              <span key={tag.name} className={`tag tag--${tag.color}`} title={tag.description?.trim() || undefined}>
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}

/** The library as a shelf of covers, for finding a book by its face. */
export default function Shelf({ docs, ...rest }: Props) {
  return (
    <div className="shelf">
      {docs.map((doc) => (
        <Tile key={doc.id} doc={doc} {...rest} />
      ))}
    </div>
  )
}
