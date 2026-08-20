import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Library from './components/Library'
import PageRow from './components/PageRow'
import { loadPdf, type PDFDocument } from './pdf'
import * as db from './db'
import { download, toMarkdown } from './lib/markdown-export'
import { adoptBundle, parseBundle, stampOf, toBundle } from './lib/bundle'
import { findBundle, permissionState, pickFolder, requestAccess, vaultSupported, writeBundle } from './lib/vault'
import type { DocSummary, Highlight, HighlightColor, Note, Rect } from './types'

/** Where the sync folder handle lives between sessions. */
const VAULT_KEY = 'vault-dir'

type VaultStatus = 'unsupported' | 'off' | 'blocked' | 'ready'

const uid = () => crypto.randomUUID()

const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5, 3]

/** Height of the sticky toolbar plus the vertical breathing room around a page. */
const CHROME_HEIGHT = 48 + 46

/** 'page' keeps a whole page on screen, which is what makes one row = one screenful. */
type FitMode = 'page' | 'width' | 'manual'

/**
 * Step off the current (possibly fitted) scale onto the manual zoom ladder, so
 * the first click after "全体" moves one notch instead of jumping.
 */
function stepZoom(scale: number, delta: -1 | 1): number {
  let nearest = 0
  for (let i = 1; i < ZOOM_STEPS.length; i += 1) {
    if (Math.abs(ZOOM_STEPS[i] - scale) < Math.abs(ZOOM_STEPS[nearest] - scale)) nearest = i
  }
  return Math.min(ZOOM_STEPS.length - 1, Math.max(0, nearest + delta))
}

/** First non-empty line of a note, with Markdown syntax stripped for the index. */
function firstLine(body: string): string {
  const line = body.split('\n').find((candidate) => candidate.trim() !== '') ?? ''
  return line
    .replace(/^\s*(#{1,6}|>|[-*+]|\d+\.)\s*/, '')
    .replace(/[*_`]/g, '')
    .trim()
}

interface Size {
  width: number
  height: number
}

interface Active {
  doc: DocSummary
  pdf: PDFDocument
  baseSize: Size
}

/**
 * Group by page while preserving array identity for pages whose contents didn't
 * change, so `memo(PageRow)` can actually skip work when one note is edited.
 */
function useGroupedByPage<T extends { page: number }>(items: T[]): Map<number, T[]> {
  const previous = useRef<Map<number, T[]>>(new Map())
  return useMemo(() => {
    const next = new Map<number, T[]>()
    for (const item of items) {
      const bucket = next.get(item.page)
      if (bucket) bucket.push(item)
      else next.set(item.page, [item])
    }
    for (const [page, bucket] of next) {
      const old = previous.current.get(page)
      if (old && old.length === bucket.length && old.every((value, index) => value === bucket[index])) {
        next.set(page, old)
      }
    }
    previous.current = next
    return next
  }, [items])
}

const EMPTY: never[] = []

export default function App() {
  const [docs, setDocs] = useState<DocSummary[]>([])
  const [active, setActive] = useState<Active | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [zoomIndex, setZoomIndex] = useState(3)
  const [fitMode, setFitMode] = useState<FitMode>('page')
  const [fitScale, setFitScale] = useState(1)
  const [pinPage, setPinPage] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [panelOpen, setPanelOpen] = useState(false)
  const [autoFocusNoteId, setAutoFocusNoteId] = useState<string | null>(null)
  const [quoteTarget, setQuoteTarget] = useState<{ page: number; noteId: string; quote: { text: string; nonce: number } } | null>(null)

  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [vaultDir, setVaultDir] = useState<FileSystemDirectoryHandle | null>(null)
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>(vaultSupported ? 'off' : 'unsupported')
  const [menuOpen, setMenuOpen] = useState(false)
  /** True while we are scrolling back to the remembered page on open. */
  const [restoring, setRestoring] = useState(false)

  const pageSizes = useRef(new Map<number, Size>())
  const nonce = useRef(0)
  /** Pages currently crossing the middle of the window; the lowest one is "current". */
  const pagesInBand = useRef(new Set<number>())
  /** Page to scroll to once the rows for a freshly opened document are laid out. */
  const restoreTo = useRef<number | null>(null)
  /** Read by the folder writer, which must not re-run on every scroll. */
  const currentPageRef = useRef(1)
  const jsonInputRef = useRef<HTMLInputElement>(null)

  const scale = fitMode === 'manual' ? ZOOM_STEPS[zoomIndex] : fitScale

  useEffect(() => {
    db.listDocs().then(setDocs).catch(console.error)
    db.requestPersistence().then(setPersisted, () => setPersisted(false))

    if (!vaultSupported) return
    db.getSetting<FileSystemDirectoryHandle>(VAULT_KEY)
      .then(async (dir) => {
        if (!dir) return
        setVaultDir(dir)
        // Chrome keeps the handle but often drops the grant between sessions;
        // re-asking needs a click, so the UI shows a "reconnect" button.
        setVaultStatus((await permissionState(dir)) === 'granted' ? 'ready' : 'blocked')
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    currentPageRef.current = currentPage
  }, [currentPage])

  /* ------------------------------------------------------------- fit width */

  useEffect(() => {
    if (!active || fitMode === 'manual') return
    const update = () => {
      // Cap the PDF lane at 62% of the window so a note is always partly visible
      // beside it on wide screens; below that, use most of the width.
      const available = Math.min(window.innerWidth - 96, Math.max(window.innerWidth * 0.62, 560))
      const byWidth = available / active.baseSize.width
      if (fitMode === 'width') {
        setFitScale(Math.max(0.2, byWidth))
        return
      }
      // 'page': the whole page has to fit too, so that one row is one screenful
      // and a note card is never taller than the window.
      const byHeight = (window.innerHeight - CHROME_HEIGHT) / active.baseSize.height
      setFitScale(Math.max(0.2, Math.min(byWidth, byHeight)))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [active, fitMode])

  /* --------------------------------------------------------- open / close */

  /** Load a document's annotations, reset per-document view state, show it. */
  const present = useCallback(
    async (doc: DocSummary, pdf: PDFDocument) => {
    let effective = doc
    let [loadedNotes, loadedHighlights] = await Promise.all([db.listNotes(doc.id), db.listHighlights(doc.id)])

    // The sync folder is the copy that outlives this browser profile. If it holds
    // work newer than what IndexedDB has - another machine, or site data cleared
    // and the PDF dropped back in - take the folder's version.
    if (vaultDir && vaultStatus === 'ready') {
      try {
        const stored = await findBundle(vaultDir, doc.fingerprint ?? null, doc.name)
        if (stored && stored.savedAt > stampOf(loadedNotes, loadedHighlights)) {
          const adopted = adoptBundle(stored, doc.id)
          loadedNotes = adopted.notes.sort((a, b) => a.page - b.page || a.order - b.order)
          loadedHighlights = adopted.highlights
          await db.replaceAnnotations(doc.id, loadedNotes, loadedHighlights)
          effective = { ...doc, lastPage: stored.doc.lastPage || doc.lastPage }
          await db.updateDoc(doc.id, { lastPage: effective.lastPage })
        }
      } catch (cause) {
        console.error('同期フォルダから読み込めませんでした', cause)
      }
    }

    setNotes(loadedNotes)
    setHighlights(loadedHighlights)

    const first = await pdf.getPage(1)
    const base = first.getViewport({ scale: 1 })
    pagesInBand.current.clear()
    pageSizes.current = new Map()

    const startPage = Math.min(Math.max(effective.lastPage ?? 1, 1), pdf.numPages)
    setCurrentPage(startPage)
    restoreTo.current = startPage > 1 ? startPage : null
    setRestoring(startPage > 1)
    setQuoteTarget(null)
    setActive({ doc: effective, pdf, baseSize: { width: base.width, height: base.height } })

    await db.touchDoc(doc.id)
    setDocs(await db.listDocs())
    },
    [vaultDir, vaultStatus],
  )

  const openDoc = useCallback(
    async (id: string) => {
      setBusy('読み込み中…')
      setError(null)
      try {
        const record = await db.getDoc(id)
        if (!record) throw new Error('ファイルが見つかりませんでした')
        const buffer = await record.blob.arrayBuffer()
        const pdf = await loadPdf(buffer).promise
        const { blob: _blob, ...summary } = record
        await present({ ...summary, pageCount: pdf.numPages }, pdf)
      } catch (cause) {
        console.error(cause)
        setError(cause instanceof Error ? cause.message : 'PDF を開けませんでした')
      } finally {
        setBusy(null)
      }
    },
    [present],
  )

  const openFile = useCallback(
    async (file: File) => {
      setBusy('PDF を解析中…')
      setError(null)
      try {
        const buffer = await file.arrayBuffer()
        // Parse once and keep the result: re-opening the same bytes in a second
        // worker costs seconds on a large PDF for no benefit.
        const pdf = await loadPdf(buffer).promise
        const fingerprint = pdf.fingerprints[0] ?? null

        // Dropping in a file that is already in the library reopens it. Making a
        // second entry instead would strand every note taken on the first one.
        const existing = await db.matchDoc(fingerprint, file.name, file.size)
        if (existing) {
          const renamed = existing.name !== file.name || existing.size !== file.size
          if (renamed || !existing.fingerprint) {
            await db.updateDoc(existing.id, {
              fingerprint,
              // Re-dropping a changed file means "use this version from now on".
              ...(renamed ? { name: file.name, size: file.size, blob: file } : {}),
            })
          }
          await present({ ...existing, name: file.name, size: file.size, fingerprint, pageCount: pdf.numPages }, pdf)
          return
        }

        const doc: DocSummary = {
          id: uid(),
          name: file.name,
          size: file.size,
          pageCount: pdf.numPages,
          addedAt: Date.now(),
          lastOpenedAt: Date.now(),
          fingerprint,
          lastPage: 1,
        }
        await db.putDoc({ ...doc, blob: file })
        await present(doc, pdf)
      } catch (cause) {
        console.error(cause)
        setError(cause instanceof Error ? cause.message : 'PDF を読み込めませんでした')
      } finally {
        setBusy(null)
      }
    },
    [present],
  )

  const closeDoc = useCallback(() => {
    setActive((current) => {
      if (current) db.updateDoc(current.doc.id, { lastPage: currentPage }).catch(console.error)
      current?.pdf.loadingTask.destroy().catch(() => {})
      return null
    })
    setNotes([])
    setHighlights([])
    setQuoteTarget(null)
  }, [currentPage])

  /* ------------------------------------------------------------ sync folder */

  const connectVault = useCallback(async () => {
    setError(null)
    try {
      const dir = await pickFolder()
      if (!dir) return
      await db.setSetting(VAULT_KEY, dir)
      setVaultDir(dir)
      setVaultStatus('ready')
    } catch (cause) {
      console.error(cause)
      setError('フォルダを開けませんでした')
    }
  }, [])

  const unlockVault = useCallback(async () => {
    if (!vaultDir) return
    setVaultStatus((await requestAccess(vaultDir)) ? 'ready' : 'blocked')
  }, [vaultDir])

  const disconnectVault = useCallback(async () => {
    await db.deleteSetting(VAULT_KEY)
    setVaultDir(null)
    setVaultStatus('off')
  }, [])

  /**
   * Mirror the open document into the folder. Deliberately not keyed on
   * `currentPage`: every scroll pause would rewrite two files for no gain, so
   * the page number rides along with whatever edit triggers the next write.
   */
  useEffect(() => {
    if (!active || !vaultDir || vaultStatus !== 'ready') return
    const timer = setTimeout(() => {
      const doc = { ...active.doc, lastPage: currentPageRef.current }
      writeBundle(vaultDir, toBundle(doc, notes, highlights), toMarkdown(doc, notes, highlights)).catch((cause) => {
        console.error('同期フォルダに書けませんでした', cause)
        setVaultStatus('blocked')
      })
    }, 1200)
    return () => clearTimeout(timer)
  }, [active, notes, highlights, vaultDir, vaultStatus])

  /* ------------------------------------------------------ backup / restore */

  const exportJson = useCallback(() => {
    if (!active) return
    const doc = { ...active.doc, lastPage: currentPageRef.current }
    const name = `${doc.name.replace(/\.pdf$/i, '')}.notes.json`
    download(name, JSON.stringify(toBundle(doc, notes, highlights), null, 2), 'application/json')
  }, [active, notes, highlights])

  const importJson = useCallback(
    async (file: File) => {
      if (!active) return
      setError(null)
      try {
        const bundle = parseBundle(await file.text())
        const count = bundle.notes.length + bundle.highlights.length
        if (!confirm(`「${active.doc.name}」のメモとハイライトを、このファイルの内容（${count} 件）で置き換えます。よろしいですか？`)) return
        const adopted = adoptBundle(bundle, active.doc.id)
        const restored = adopted.notes.sort((a, b) => a.page - b.page || a.order - b.order)
        await db.replaceAnnotations(active.doc.id, restored, adopted.highlights)
        setNotes(restored)
        setHighlights(adopted.highlights)
      } catch (cause) {
        console.error(cause)
        setError(cause instanceof Error ? cause.message : 'バックアップを読み込めませんでした')
      }
    },
    [active],
  )

  /* -------------------------------------------------------- resume position */

  /**
   * Read the page indicator straight off the layout. IntersectionObserver is
   * fine while the reader scrolls, but it samples during the frame that performs
   * a programmatic jump, so its records describe where we were, not where we
   * landed - and on an otherwise idle page nothing forces it to look again.
   */
  const syncCurrentPage = useCallback(() => {
    const middle = window.innerHeight / 2
    const band = pagesInBand.current
    band.clear()
    for (const row of document.querySelectorAll<HTMLElement>('.row')) {
      const rect = row.getBoundingClientRect()
      if (rect.bottom < middle || rect.top > middle) continue
      band.add(Number(row.dataset.page))
    }
    if (band.size) setCurrentPage(Math.min(...band))
  }, [])

  // Jump back to where the reader left off, once the rows exist to scroll to.
  useEffect(() => {
    const page = restoreTo.current
    if (!active || page == null) return
    // Two frames: the first commits the rows, the second lays them out. The
    // target is only cleared once the scroll actually runs - clearing it up here
    // would make StrictMode's discarded first pass eat the restore.
    const frame = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        restoreTo.current = null
        document.getElementById(`page-${page}`)?.scrollIntoView({ block: 'start' })
        syncCurrentPage()
        window.setTimeout(() => {
          syncCurrentPage()
          setRestoring(false)
        }, 400)
      }),
    )
    return () => cancelAnimationFrame(frame)
  }, [active, syncCurrentPage])

  // Remember the page, but not the pages that flick past during the restore.
  useEffect(() => {
    if (!active || restoring) return
    const timer = setTimeout(() => {
      db.updateDoc(active.doc.id, { lastPage: currentPage }).catch(console.error)
    }, 800)
    return () => clearTimeout(timer)
  }, [active, currentPage, restoring])

  // Closing the tab doesn't wait for the debounce above, so flush on the way out.
  useEffect(() => {
    if (!active) return
    const flush = () => {
      if (document.visibilityState === 'hidden') {
        db.updateDoc(active.doc.id, { lastPage: currentPage }).catch(console.error)
      }
    }
    document.addEventListener('visibilitychange', flush)
    return () => document.removeEventListener('visibilitychange', flush)
  }, [active, currentPage])

  const removeDoc = useCallback(
    async (id: string) => {
      await db.deleteDoc(id)
      setDocs(await db.listDocs())
      if (active?.doc.id === id) closeDoc()
    },
    [active, closeDoc],
  )

  /* ------------------------------------------------------------------ notes */

  const addNote = useCallback(
    (page: number) => {
      if (!active) return null
      const siblings = notes.filter((note) => note.page === page)
      const note: Note = {
        id: uid(),
        docId: active.doc.id,
        page,
        body: '',
        order: siblings.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      setNotes((current) => [...current, note])
      setAutoFocusNoteId(note.id)
      db.putNote(note).catch(console.error)
      // Bring the new card into view; the row's track has to catch up first.
      requestAnimationFrame(() => {
        const track = document.querySelector<HTMLElement>(`#page-${page} .row__track`)
        track?.scrollTo({ left: track.scrollWidth, behavior: 'smooth' })
      })
      return note
    },
    [active, notes],
  )

  const changeNote = useCallback((id: string, body: string) => {
    setNotes((current) => {
      const next = current.map((note) => (note.id === id ? { ...note, body, updatedAt: Date.now() } : note))
      const updated = next.find((note) => note.id === id)
      if (updated) db.putNote(updated).catch(console.error)
      return next
    })
  }, [])

  const deleteNote = useCallback((id: string) => {
    setNotes((current) => current.filter((note) => note.id !== id))
    db.deleteNote(id).catch(console.error)
  }, [])

  const moveNote = useCallback((id: string, direction: -1 | 1) => {
    setNotes((current) => {
      const target = current.find((note) => note.id === id)
      if (!target) return current
      const siblings = current.filter((note) => note.page === target.page).sort((a, b) => a.order - b.order)
      const index = siblings.findIndex((note) => note.id === id)
      const swapWith = index + direction
      if (swapWith < 0 || swapWith >= siblings.length) return current

      const reordered = [...siblings]
      ;[reordered[index], reordered[swapWith]] = [reordered[swapWith], reordered[index]]
      const renumbered = reordered.map((note, order) => ({ ...note, order, updatedAt: Date.now() }))
      db.putNotes(renumbered).catch(console.error)

      const byId = new Map(renumbered.map((note) => [note.id, note]))
      return current.map((note) => byId.get(note.id) ?? note)
    })
  }, [])

  /** Send selected PDF text into the page's last note, creating one if needed. */
  const quote = useCallback(
    (page: number, text: string) => {
      const existing = notes.filter((note) => note.page === page).sort((a, b) => a.order - b.order)
      const target = existing.at(-1) ?? addNote(page)
      if (!target) return
      nonce.current += 1
      setQuoteTarget({ page, noteId: target.id, quote: { text, nonce: nonce.current } })
    },
    [notes, addNote],
  )

  /* ------------------------------------------------------------- highlights */

  const createHighlight = useCallback(
    (page: number, rects: Rect[], text: string, color: HighlightColor) => {
      if (!active) return
      const highlight: Highlight = {
        id: uid(),
        docId: active.doc.id,
        page,
        rects,
        text,
        color,
        createdAt: Date.now(),
      }
      setHighlights((current) => [...current, highlight])
      db.putHighlight(highlight).catch(console.error)
    },
    [active],
  )

  const recolorHighlight = useCallback((id: string, color: HighlightColor) => {
    setHighlights((current) => {
      const next = current.map((highlight) => (highlight.id === id ? { ...highlight, color } : highlight))
      const updated = next.find((highlight) => highlight.id === id)
      if (updated) db.putHighlight(updated).catch(console.error)
      return next
    })
  }, [])

  const removeHighlight = useCallback((id: string) => {
    setHighlights((current) => current.filter((highlight) => highlight.id !== id))
    db.deleteHighlight(id).catch(console.error)
  }, [])

  /* -------------------------------------------------------------- plumbing */

  const measure = useCallback((page: number, size: Size) => {
    pageSizes.current.set(page, size)
  }, [])

  const viewChange = useCallback((page: number, inView: boolean) => {
    const band = pagesInBand.current
    if (inView) band.add(page)
    else band.delete(page)
    if (band.size) setCurrentPage(Math.min(...band))
  }, [])

  const notesByPage = useGroupedByPage(notes)
  const highlightsByPage = useGroupedByPage(highlights)

  const jumpTo = useCallback((page: number) => {
    document.getElementById(`page-${page}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'n') {
        event.preventDefault()
        addNote(currentPage)
      } else if (event.key === 'j') {
        jumpTo(Math.min(active.doc.pageCount, currentPage + 1))
      } else if (event.key === 'k') {
        jumpTo(Math.max(1, currentPage - 1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, currentPage, addNote, jumpTo])

  /* ----------------------------------------------------------------- render */

  if (!active) {
    return (
      <Library
        docs={docs}
        busy={busy}
        error={error}
        persisted={persisted}
        vaultStatus={vaultStatus}
        vaultName={vaultDir?.name ?? null}
        onConnectVault={connectVault}
        onUnlockVault={unlockVault}
        onDisconnectVault={disconnectVault}
        onOpenFile={openFile}
        onOpenDoc={openDoc}
        onDeleteDoc={removeDoc}
      />
    )
  }

  const annotatedPages = [...new Set([...notes.map((n) => n.page), ...highlights.map((h) => h.page)])].sort(
    (a, b) => a - b,
  )

  return (
    <div className="app">
      <header className="toolbar">
        <button type="button" className="toolbar__back" onClick={closeDoc} title="ライブラリへ戻る">
          ←
        </button>
        <span className="toolbar__name" title={active.doc.name}>
          {active.doc.name}
        </span>

        <span className="toolbar__page">
          p.{currentPage} / {active.doc.pageCount}
        </span>

        <div className="toolbar__group">
          <button
            type="button"
            onClick={() => {
              setZoomIndex(stepZoom(scale, -1))
              setFitMode('manual')
            }}
            title="縮小"
          >
            −
          </button>
          <span className="toolbar__zoom">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            onClick={() => {
              setZoomIndex(stepZoom(scale, 1))
              setFitMode('manual')
            }}
            title="拡大"
          >
            ＋
          </button>
          <button
            type="button"
            className={fitMode === 'page' ? 'is-on' : ''}
            onClick={() => setFitMode('page')}
            title="1ページ全体を画面に収める"
          >
            全体
          </button>
          <button
            type="button"
            className={fitMode === 'width' ? 'is-on' : ''}
            onClick={() => setFitMode('width')}
            title="横幅に合わせる"
          >
            幅
          </button>
        </div>

        <button
          type="button"
          className={pinPage ? 'is-on' : ''}
          onClick={() => setPinPage((value) => !value)}
          title="横スクロール中もページを左端に固定する"
        >
          ページ固定
        </button>

        <button type="button" onClick={() => addNote(currentPage)} title="現在のページにメモを追加 (n)">
          ＋ メモ
        </button>

        <div className="toolbar__menu">
          <button
            type="button"
            className={menuOpen ? 'is-on' : ''}
            onClick={() => setMenuOpen((value) => !value)}
            title="書き出しとバックアップ"
          >
            書き出し ▾
          </button>
          {menuOpen && (
            <>
              <div className="menu__scrim" onClick={() => setMenuOpen(false)} />
              <div className="menu">
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    download(
                      `${active.doc.name.replace(/\.pdf$/i, '')}.md`,
                      toMarkdown(active.doc, notes, highlights),
                    )
                  }}
                >
                  Markdown で書き出す
                  <small>読む用。読み戻しはできません</small>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    exportJson()
                  }}
                >
                  JSON でバックアップ
                  <small>メモとハイライトを完全な形で保存</small>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    jsonInputRef.current?.click()
                  }}
                >
                  JSON から復元…
                  <small>このPDFのメモを置き換えます</small>
                </button>
              </div>
            </>
          )}
        </div>
        <input
          ref={jsonInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void importJson(file)
          }}
        />

        <button type="button" className={panelOpen ? 'is-on' : ''} onClick={() => setPanelOpen((value) => !value)}>
          メモ一覧 ({annotatedPages.length})
        </button>
      </header>

      <main className="pages">
        {Array.from({ length: active.doc.pageCount }, (_, index) => index + 1).map((page) => (
          <PageRow
            key={page}
            pdf={active.pdf}
            pageNumber={page}
            scale={scale}
            pinPage={pinPage}
            notes={notesByPage.get(page) ?? EMPTY}
            highlights={highlightsByPage.get(page) ?? EMPTY}
            fallbackSize={pageSizes.current.get(page) ?? active.baseSize}
            autoFocusNoteId={autoFocusNoteId}
            quoteTarget={quoteTarget?.page === page ? { noteId: quoteTarget.noteId, quote: quoteTarget.quote } : null}
            onMeasure={measure}
            onViewChange={viewChange}
            onAddNote={addNote}
            onChangeNote={changeNote}
            onDeleteNote={deleteNote}
            onMoveNote={moveNote}
            onCreateHighlight={createHighlight}
            onRecolorHighlight={recolorHighlight}
            onDeleteHighlight={removeHighlight}
            onQuote={quote}
          />
        ))}
      </main>

      {panelOpen && (
        <aside className="panel">
          <header className="panel__head">
            <strong>メモ一覧</strong>
            <button type="button" onClick={() => setPanelOpen(false)}>
              ✕
            </button>
          </header>
          <div className="panel__body">
            {annotatedPages.length === 0 && <p className="panel__empty">まだメモもハイライトもありません。</p>}
            {annotatedPages.map((page) => (
              <section key={page} className="panel__page">
                <button type="button" className="panel__jump" onClick={() => jumpTo(page)}>
                  p.{page}
                </button>
                {(highlightsByPage.get(page) ?? EMPTY).map((highlight) => (
                  <p key={highlight.id} className={`panel__hl panel__hl--${highlight.color}`}>
                    {highlight.text}
                  </p>
                ))}
                {(notesByPage.get(page) ?? EMPTY).map((note) => (
                  <p key={note.id} className="panel__note">
                    {firstLine(note.body) || '（空のメモ）'}
                  </p>
                ))}
              </section>
            ))}
          </div>
        </aside>
      )}
    </div>
  )
}
