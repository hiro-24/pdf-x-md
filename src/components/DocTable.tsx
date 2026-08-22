import { useEffect, useRef, useState } from 'react'
import TagPicker from './TagPicker'
import CoverPreview from './CoverPreview'
import type { DocSummary, Tag } from '../types'

/** Long enough that running the cursor down the table doesn't render covers. */
const HOVER_DELAY = 260

export type SortKey = 'title' | 'pages' | 'notes' | 'opened' | 'added'
export interface Sort {
  key: SortKey
  dir: 'asc' | 'desc'
}

interface Props {
  docs: DocSummary[]
  palette: Tag[]
  noteCounts: Map<string, number>
  sort: Sort
  onSort: (key: SortKey) => void
  onOpen: (id: string) => void
  onRename: (id: string, title: string) => void
  onToggleTag: (id: string, name: string) => void
  onCreateTag: (tag: Tag) => void
  onFilterTag: (name: string) => void
  onDelete: (id: string) => void
  /** Resolves to an object URL for the cover, rendering it if this is the first look. */
  onRequestCover: (id: string) => Promise<string | null>
}

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'title', label: 'タイトル', className: 'col-title' },
  { key: 'pages', label: 'ページ', className: 'col-num' },
  { key: 'notes', label: 'メモ', className: 'col-num' },
  { key: 'opened', label: '最終閲覧', className: 'col-date' },
]

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' })

export const titleOf = (doc: DocSummary) => doc.title?.trim() || doc.name.replace(/\.pdf$/i, '')

export default function DocTable(props: Props) {
  const { docs, palette, noteCounts, sort } = props
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [picking, setPicking] = useState<{ id: string; anchor: DOMRect } | null>(null)
  const [hover, setHover] = useState<{ id: string; anchor: DOMRect; src: string | null } | null>(null)
  const hoverTimer = useRef<number | null>(null)

  useEffect(() => () => window.clearTimeout(hoverTimer.current ?? undefined), [])

  const openCover = (id: string, anchor: DOMRect) => {
    window.clearTimeout(hoverTimer.current ?? undefined)
    hoverTimer.current = window.setTimeout(async () => {
      setHover({ id, anchor, src: null })
      const src = await props.onRequestCover(id)
      // The cursor may have moved on while the page was rendering.
      setHover((current) => (current?.id === id ? { ...current, src } : current))
    }, HOVER_DELAY)
  }

  const closeCover = () => {
    window.clearTimeout(hoverTimer.current ?? undefined)
    setHover(null)
  }

  const colorOf = (name: string) => palette.find((tag) => tag.name === name)?.color ?? 'gray'

  const commit = (doc: DocSummary) => {
    setEditing(null)
    const next = draft.trim()
    if (next && next !== titleOf(doc)) props.onRename(doc.id, next)
  }

  return (
    <div className="table-wrap">
      <table className="doc-table">
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key} className={column.className}>
                <button type="button" onClick={() => props.onSort(column.key)}>
                  {column.label}
                  <span className="doc-table__arrow">{sort.key === column.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
                </button>
              </th>
            ))}
            <th className="col-tags">タグ</th>
            <th className="col-actions" />
          </tr>
        </thead>
        <tbody>
          {docs.map((doc) => (
            <tr key={doc.id}>
              <td className="col-title">
                {editing === doc.id ? (
                  <input
                    className="doc-table__rename"
                    value={draft}
                    autoFocus
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => commit(doc)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commit(doc)
                      if (event.key === 'Escape') setEditing(null)
                    }}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className="doc-table__open"
                      onClick={() => props.onOpen(doc.id)}
                      onMouseEnter={(event) => openCover(doc.id, event.currentTarget.getBoundingClientRect())}
                      onMouseLeave={closeCover}
                      onFocus={(event) => openCover(doc.id, event.currentTarget.getBoundingClientRect())}
                      onBlur={closeCover}
                    >
                      {titleOf(doc)}
                    </button>
                    <button
                      type="button"
                      className="doc-table__rename-btn"
                      title="タイトルを変更"
                      onClick={() => {
                        setDraft(titleOf(doc))
                        setEditing(doc.id)
                      }}
                    >
                      ✎
                    </button>
                    {/* The filename is still worth showing when the title has drifted from it. */}
                    {titleOf(doc) !== doc.name.replace(/\.pdf$/i, '') && (
                      <span className="doc-table__file" title={doc.name}>
                        {doc.name}
                      </span>
                    )}
                  </>
                )}
              </td>
              <td className="col-num">{doc.pageCount}</td>
              <td className="col-num">{noteCounts.get(doc.id) || ''}</td>
              <td className="col-date">{formatDate(doc.lastOpenedAt)}</td>
              <td className="col-tags">
                <div className="tag-cell">
                  {(doc.tags ?? []).map((name) => (
                    <button
                      key={name}
                      type="button"
                      className={`tag tag--${colorOf(name)}`}
                      title={`「${name}」で絞り込む`}
                      onClick={() => props.onFilterTag(name)}
                    >
                      {name}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="tag-cell__add"
                    title="タグを付ける"
                    onClick={(event) =>
                      setPicking(
                        picking?.id === doc.id
                          ? null
                          : { id: doc.id, anchor: event.currentTarget.getBoundingClientRect() },
                      )
                    }
                  >
                    ＋
                  </button>
                  {picking?.id === doc.id && (
                    <TagPicker
                      anchor={picking.anchor}
                      palette={palette}
                      applied={doc.tags ?? []}
                      onToggle={(name) => props.onToggleTag(doc.id, name)}
                      onCreate={props.onCreateTag}
                      onClose={() => setPicking(null)}
                    />
                  )}
                </div>
              </td>
              <td className="col-actions">
                <button
                  type="button"
                  className="doc-table__delete"
                  title="ライブラリから削除（メモも消えます）"
                  onClick={() => {
                    if (confirm(`「${titleOf(doc)}」とそのメモをすべて削除しますか？`)) props.onDelete(doc.id)
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hover && <CoverPreview anchor={hover.anchor} src={hover.src} />}
    </div>
  )
}
