import { useMemo, useRef, useState } from 'react'
import DocTable, { titleOf, type Sort, type SortKey } from './DocTable'
import type { DocSummary, Tag, TagColor } from '../types'

interface Props {
  docs: DocSummary[]
  busy: string | null
  error: string | null
  /** Whether the browser promised not to evict this library; null until asked. */
  persisted: boolean | null
  vaultStatus: 'unsupported' | 'off' | 'blocked' | 'ready'
  /** Name of the connected folder, for showing which one it is. */
  vaultName: string | null
  onConnectVault: () => void
  onUnlockVault: () => void
  onDisconnectVault: () => void
  palette: Tag[]
  /** docId -> every word of that document's notes and highlights. */
  searchIndex: Map<string, string>
  noteCounts: Map<string, number>
  onOpenFile: (file: File) => void
  onOpenDoc: (id: string) => void
  onDeleteDoc: (id: string) => void
  onRenameDoc: (id: string, title: string) => void
  onToggleTag: (id: string, name: string) => void
  onCreateTag: (tag: Tag) => void
  onRecolorTag: (name: string, color: TagColor) => void
  onRequestCover: (id: string) => Promise<string | null>
}

export default function Library({
  docs,
  busy,
  error,
  persisted,
  vaultStatus,
  vaultName,
  palette,
  searchIndex,
  noteCounts,
  onConnectVault,
  onUnlockVault,
  onDisconnectVault,
  onOpenFile,
  onOpenDoc,
  onDeleteDoc,
  onRenameDoc,
  onToggleTag,
  onCreateTag,
  onRecolorTag,
  onRequestCover,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [query, setQuery] = useState('')
  const [activeTags, setActiveTags] = useState<string[]>([])
  const [sort, setSort] = useState<Sort>({ key: 'opened', dir: 'desc' })

  const toggleFilter = (name: string) =>
    setActiveTags((current) => (current.includes(name) ? current.filter((n) => n !== name) : [...current, name]))

  const visible = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const matches = docs.filter((doc) => {
      // Tag filters stack: a document has to carry all of the selected ones.
      if (!activeTags.every((name) => (doc.tags ?? []).includes(name))) return false
      if (!terms.length) return true
      const haystack = [titleOf(doc), doc.name, ...(doc.tags ?? []), searchIndex.get(doc.id) ?? '']
        .join('\n')
        .toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })

    const sign = sort.dir === 'asc' ? 1 : -1
    return matches.sort((a, b) => {
      switch (sort.key) {
        case 'title':
          return sign * titleOf(a).localeCompare(titleOf(b), 'ja')
        case 'pages':
          return sign * (a.pageCount - b.pageCount)
        case 'notes':
          return sign * ((noteCounts.get(a.id) ?? 0) - (noteCounts.get(b.id) ?? 0))
        case 'added':
          return sign * (a.addedAt - b.addedAt)
        default:
          return sign * (a.lastOpenedAt - b.lastOpenedAt)
      }
    })
  }, [docs, query, activeTags, sort, searchIndex, noteCounts])

  const sortBy = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'title' ? 'asc' : 'desc' },
    )

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
          className={`dropzone${dragging ? ' is-active' : ''}${docs.length ? ' is-compact' : ''}`}
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
          {busy ? (
            <span>{busy}</span>
          ) : (
            <span>{docs.length ? '＋ PDF を追加（ドロップ、またはクリック）' : 'PDF をドロップ、またはクリックして選択'}</span>
          )}
        </div>

        {error && <p className="library__error">{error}</p>}

        {docs.length > 0 && (
          <>
            <div className="library__controls">
              <input
                className="search"
                type="search"
                value={query}
                placeholder="タイトル・タグ・メモの中身を検索"
                onChange={(event) => setQuery(event.target.value)}
              />
              <span className="library__count">
                {visible.length === docs.length ? `${docs.length} 件` : `${visible.length} / ${docs.length} 件`}
              </span>
            </div>

            {palette.length > 0 && (
              <div className="tag-filters">
                {palette.map((tag) => (
                  <button
                    key={tag.name}
                    type="button"
                    className={`tag tag--${tag.color}${activeTags.includes(tag.name) ? ' is-on' : ''}`}
                    onClick={() => toggleFilter(tag.name)}
                  >
                    {tag.name}
                  </button>
                ))}
                {activeTags.length > 0 && (
                  <button type="button" className="tag-filters__clear" onClick={() => setActiveTags([])}>
                    絞り込みを解除
                  </button>
                )}
              </div>
            )}

            {visible.length > 0 ? (
              <DocTable
                docs={visible}
                palette={palette}
                noteCounts={noteCounts}
                sort={sort}
                onSort={sortBy}
                onOpen={onOpenDoc}
                onRename={onRenameDoc}
                onToggleTag={onToggleTag}
                onCreateTag={onCreateTag}
                onRecolorTag={onRecolorTag}
                onFilterTag={toggleFilter}
                onDelete={onDeleteDoc}
                onRequestCover={onRequestCover}
              />
            ) : (
              <p className="library__empty">条件に合う PDF がありません。</p>
            )}
          </>
        )}

        <section className={`vault vault--${vaultStatus}`}>
          {vaultStatus === 'ready' && (
            <>
              <div className="vault__text">
                <strong>同期フォルダ: {vaultName}</strong>
                <span>
                  メモは編集のたびにこのフォルダへ書き出されます。ブラウザのデータが消えても、同じ PDF
                  を入れ直せば元に戻ります。
                </span>
              </div>
              <button type="button" onClick={onDisconnectVault}>
                解除
              </button>
            </>
          )}

          {vaultStatus === 'blocked' && (
            <>
              <div className="vault__text">
                <strong>同期フォルダへのアクセスが切れています</strong>
                <span>
                  Chrome はセッションをまたぐと許可を落とすことがあります。{vaultName} への書き込みを再許可してください。
                </span>
              </div>
              <button type="button" className="is-primary" onClick={onUnlockVault}>
                再接続
              </button>
            </>
          )}

          {vaultStatus === 'off' && (
            <>
              <div className="vault__text">
                <strong>メモの保存先フォルダを決める</strong>
                <span>
                  選んだフォルダに <code>.notes.json</code> と <code>.md</code>{' '}
                  を自動保存します。iCloud Drive や Dropbox の中を選べば、バックアップと他の PC
                  との同期もそのまま手に入ります。
                </span>
              </div>
              <button type="button" className="is-primary" onClick={onConnectVault}>
                フォルダを選ぶ
              </button>
            </>
          )}

          {vaultStatus === 'unsupported' && (
            <div className="vault__text">
              <strong>このブラウザではフォルダ同期を使えません</strong>
              <span>
                フォルダへの自動保存は Chrome と Edge のみ対応しています。ここでは PDF
                を開いたあと「書き出し → JSON でバックアップ」で手動保存してください。
              </span>
            </div>
          )}
        </section>

        <p className="library__note">
          PDF 本体とメモの作業用コピーは、このブラウザの中（IndexedDB）に保存されます。外部には一切送信しません。
          {persisted === true && ' このデータは永続保存の対象になっています。'}
          {persisted === false && ' 空き容量が不足すると、ブラウザの判断で削除される場合があります。'}
        </p>
      </div>
    </div>
  )
}
