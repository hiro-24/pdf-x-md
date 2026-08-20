import { useRef, useState } from 'react'
import type { DocSummary } from '../types'

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
  onOpenFile: (file: File) => void
  onOpenDoc: (id: string) => void
  onDeleteDoc: (id: string) => void
}

const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const formatDate = (ms: number) =>
  new Date(ms).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })

export default function Library({
  docs,
  busy,
  error,
  persisted,
  vaultStatus,
  vaultName,
  onConnectVault,
  onUnlockVault,
  onDisconnectVault,
  onOpenFile,
  onOpenDoc,
  onDeleteDoc,
}: Props) {
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
