import { useRef, useState } from 'react'
import type { DocSummary } from '../types'

interface Props {
  docs: DocSummary[]
  busy: string | null
  error: string | null
  onOpenFile: (file: File) => void
  onOpenDoc: (id: string) => void
  onDeleteDoc: (id: string) => void
}

const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })

export default function Library({ docs, busy, error, onOpenFile, onOpenDoc, onDeleteDoc }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const takeFiles = (files: FileList | null) => {
    const file = [...(files ?? [])].find((candidate) => candidate.type === 'application/pdf' || /\.pdf$/i.test(candidate.name))
    if (file) onOpenFile(file)
  }

  return (
    <div className="library">
      <div className="library__inner">
        <h1 className="library__title">PDF Note</h1>
        <p className="library__lede">
          PDF は縦にスクロール。メモを付けたいページは<strong>横にスクロール</strong>すると、そのページ専用の
          Markdown が並びます。
        </p>

        <div
          className={`dropzone${dragging ? ' is-active' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            takeFiles(event.dataTransfer.files)
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click()
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(event) => {
              takeFiles(event.target.files)
              event.target.value = ''
            }}
          />
          {busy ? <span>{busy}</span> : <span>PDF をドロップ、またはクリックして選択</span>}
        </div>

        {error && <p className="library__error">{error}</p>}

        {docs.length > 0 && (
          <>
            <h2 className="library__subtitle">最近開いた PDF</h2>
            <ul className="doc-list">
              {docs.map((doc) => (
                <li key={doc.id} className="doc-list__item">
                  <button type="button" className="doc-list__open" onClick={() => onOpenDoc(doc.id)}>
                    <span className="doc-list__name">{doc.name}</span>
                    <span className="doc-list__meta">
                      {doc.pageCount} ページ・{formatSize(doc.size)}・{formatDate(doc.lastOpenedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="doc-list__delete"
                    title="ライブラリから削除（メモも消えます）"
                    onClick={() => {
                      if (confirm(`「${doc.name}」とそのメモをすべて削除しますか？`)) onDeleteDoc(doc.id)
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="library__note">
          PDF もメモもこのブラウザの中（IndexedDB）にだけ保存されます。外部には一切送信しません。
        </p>
      </div>
    </div>
  )
}
