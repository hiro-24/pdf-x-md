import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import Library from './components/Library'
import PageRow from './components/PageRow'
import { loadPdf, type PDFDocument } from './pdf'
import * as db from './db'
import { laneOffset } from './lib/lane'
import { download, toMarkdown } from './lib/markdown-export'
import { adoptBundle, bundleStamp, mergePalettes, parseBundle, stampOf, toBundle, toPaletteFile } from './lib/bundle'
import {
  findBundle,
  permissionState,
  pickFolder,
  readPalette,
  requestAccess,
  vaultSupported,
  writeBundle,
  writePalette,
} from './lib/vault'
import { renderCover } from './lib/thumbnail'
import { TAG_COLORS, type Bookmark, type DocSummary, type Highlight, type HighlightColor, type Note, type Rect, type Tag, type TagColor } from './types'

/** Where the sync folder handle lives between sessions. */
const VAULT_KEY = 'vault-dir'
/** Whether the page stays put while notes scroll past it. */
const PIN_KEY = 'pin-page'
/** Below this there is no point pinning: the note would have nowhere to sit. */
const MIN_NOTE_WIDTH = 300
/** Breathing room between the page and the first note lane. */
const PAGE_TRAIL = 20
/** How far in from the window's left edge the page sits, and the least it ever
 *  gets. The inset is half of whatever a full note leaves over, so a wide window
 *  doesn't strand the page against the edge with the notes floating off right. */
const MIN_GUTTER = 24
const MAX_GUTTER = 200
/** Width a note lane aims for. The CSS clamps to the same figure. */
const NOTE_WIDTH = 560

type VaultStatus = 'unsupported' | 'off' | 'blocked' | 'ready'

const uid = () => crypto.randomUUID()

const ZOOM_STEPS = [0.5, 0.65, 0.8, 1, 1.25, 1.5, 2, 2.5, 3]

/** Height of the sticky toolbar plus the vertical breathing room around a page.
 *  The 18 is the row's scroll-margin under the toolbar, plus 2px of slack. */
const CHROME_HEIGHT = 48 + 18

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

/**
 * Turn a PDF's embedded title into something worth showing, or nothing.
 * Producers leave all sorts of debris in this field: the source document's
 * filename, the URL a page was printed from, or a literal "untitled".
 */
function cleanTitle(raw: string | undefined): string | null {
  let title = raw?.trim() ?? ''
  // "Microsoft Word - 論文最終版.docx" and friends: the useful part is in the middle.
  title = title.replace(/^(microsoft\s+(word|powerpoint|excel)|adobe\s+\w+)\s*-\s*/i, '')
  title = title.replace(/\.(pdf|docx?|pptx?|xlsx?|tex|indd|pages)$/i, '').trim()
  if (title.length < 2) return null
  if (/^untitled$/i.test(title)) return null
  // A URL or a scheme is the browser's print job showing through, not a title.
  if (/^(about|https?|file|data|chrome|blob):/i.test(title)) return null
  return title
}

/** Teardown, not failure: the reader closed the document mid-render. */
function isTeardown(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false
  return (
    cause.name === 'RenderingCancelledException' ||
    cause.name === 'AbortException' ||
    cause.message === 'Transport destroyed'
  )
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
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [zoomIndex, setZoomIndex] = useState(3)
  const [fitMode, setFitMode] = useState<FitMode>('page')
  const [fitScale, setFitScale] = useState(1)
  // On by default: notes are read *against* the page, and letting the page
  // scroll away turns the lane into a plain list of notes with no subject.
  const [pinPage, setPinPage] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [panelOpen, setPanelOpen] = useState(false)
  const [autoFocusNoteId, setAutoFocusNoteId] = useState<string | null>(null)
  const [quoteTarget, setQuoteTarget] = useState<{ page: number; noteId: string; quote: { text: string; nonce: number } } | null>(null)

  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [vaultDir, setVaultDir] = useState<FileSystemDirectoryHandle | null>(null)
  const [vaultStatus, setVaultStatus] = useState<VaultStatus>(vaultSupported ? 'off' : 'unsupported')
  const [menuOpen, setMenuOpen] = useState(false)
  const [palette, setPalette] = useState<Tag[]>([])
  const [searchIndex, setSearchIndex] = useState<Map<string, string>>(new Map())
  const [noteCounts, setNoteCounts] = useState<Map<string, number>>(new Map())
  /** True while we are scrolling back to the remembered page on open. */
  const [restoring, setRestoring] = useState(false)
  /** Page to announce as "resumed at", briefly, so the jump isn't a mystery. */
  const [resumeHint, setResumeHint] = useState<number | null>(null)

  const pageSizes = useRef(new Map<number, Size>())
  const nonce = useRef(0)
  /** Pages currently crossing the middle of the window; the lowest one is "current". */
  const pagesInBand = useRef(new Set<number>())
  /** Page to scroll to once the rows for a freshly opened document are laid out. */
  const restoreTo = useRef<number | null>(null)
  /** Read by the folder writer, which must not re-run on every scroll. */
  const currentPageRef = useRef(1)
  /** Newest local stamp on lastPage/title/tags, kept here for the same reason. */
  const metaAtRef = useRef(0)
  const jsonInputRef = useRef<HTMLInputElement>(null)
  /** docId -> object URL for its cover, so a second hover is instant. */
  const coverUrls = useRef(new Map<string, string>())
  /** present() runs above savePalette in the file; the ref bridges the gap. */
  const savePaletteRef = useRef<(tags: Tag[]) => Promise<void>>(async () => {})

  const scale = fitMode === 'manual' ? ZOOM_STEPS[zoomIndex] : fitScale

  useEffect(() => {
    db.listDocs().then(setDocs).catch(console.error)
    db.getTags().then(setPalette).catch(console.error)
    db.getSetting<boolean>(PIN_KEY).then((value) => value !== undefined && setPinPage(value), console.error)
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

  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const covers = coverUrls.current
  useEffect(() => () => covers.forEach((url) => URL.revokeObjectURL(url)), [covers])

  // Rebuilt on the way back to the library, so counts and note search reflect
  // whatever was just written in the reader.
  useEffect(() => {
    if (active) return
    db.searchIndex().then(setSearchIndex).catch(console.error)
    db.noteCounts().then(setNoteCounts).catch(console.error)
  }, [active])

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
    let [loadedNotes, loadedHighlights, loadedMarks] = await Promise.all([
      db.listNotes(doc.id),
      db.listHighlights(doc.id),
      db.listBookmarks(doc.id),
    ])

    // The sync folder is the copy that outlives this browser profile. If it holds
    // work newer than what IndexedDB has - another machine, or site data cleared
    // and the PDF dropped back in - take the folder's version.
    if (vaultDir && vaultStatus === 'ready') {
      try {
        const stored = await findBundle(vaultDir, doc.fingerprint ?? null, doc.name)

        // Annotations are decided edit-against-edit. Weighing them against the
        // file's `savedAt` would hand the folder every comparison: that stamp is
        // written a beat *after* the edit it carries, and a document with no
        // notes at all has no edit time to weigh at all.
        if (stored && bundleStamp(stored) > stampOf(loadedNotes, loadedHighlights, loadedMarks)) {
          const adopted = adoptBundle(stored, doc.id)
          loadedNotes = adopted.notes.sort((a, b) => a.page - b.page || a.order - b.order)
          loadedHighlights = adopted.highlights
          loadedMarks = adopted.bookmarks.sort((a, b) => a.page - b.page)
          await db.replaceAnnotations(doc.id, loadedNotes, loadedHighlights)
          await db.replaceBookmarks(doc.id, loadedMarks)
        }

        // The reading position, title and tags run on their own clock - they
        // change without a note being touched, and the folder only learns of
        // them when something else triggers a write. So they get their own
        // comparison, or reading on for an hour would be undone on reopening.
        if (stored && (stored.doc.metaAt ?? 0) > (doc.metaAt ?? 0)) {
          effective = {
            ...doc,
            lastPage: stored.doc.lastPage || doc.lastPage,
            title: stored.doc.title || doc.title,
            tags: stored.doc.tags ?? doc.tags,
            metaAt: stored.doc.metaAt,
          }
          await db.updateDoc(doc.id, {
            lastPage: effective.lastPage,
            title: effective.title,
            tags: effective.tags,
            metaAt: effective.metaAt,
          })
          // Tags arriving from another machine need a colour here to show up.
          const known = await db.getTags()
          const fresh = (effective.tags ?? []).filter((name) => !known.some((tag) => tag.name === name))
          if (fresh.length) {
            await savePaletteRef.current([
              ...known,
              ...fresh.map((name, i) => ({ name, color: TAG_COLORS[(known.length + i) % TAG_COLORS.length] })),
            ])
          }
        }
      } catch (cause) {
        console.error('同期フォルダから読み込めませんでした', cause)
      }
    }

    setNotes(loadedNotes)
    setHighlights(loadedHighlights)
    setBookmarks(loadedMarks)

    const first = await pdf.getPage(1)
    const base = first.getViewport({ scale: 1 })
    pagesInBand.current.clear()
    pageSizes.current = new Map()

    metaAtRef.current = effective.metaAt ?? 0
    const startPage = Math.min(Math.max(effective.lastPage ?? 1, 1), pdf.numPages)
    setCurrentPage(startPage)
    restoreTo.current = startPage > 1 ? startPage : null
    setRestoring(startPage > 1)
    setResumeHint(startPage > 1 ? startPage : null)
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
            if (renamed) {
              // The bytes changed, so the stored cover is of the old version.
              const stale = coverUrls.current.get(existing.id)
              if (stale) URL.revokeObjectURL(stale)
              coverUrls.current.delete(existing.id)
              await db.deleteThumb(existing.id)
              renderCover(pdf)
                .then((cover) => cover && db.putThumb(existing.id, cover))
                .catch(() => {})
            }
          }
          await present({ ...existing, name: file.name, size: file.size, fingerprint, pageCount: pdf.numPages }, pdf)
          return
        }

        // Many PDFs carry a real title in their metadata; it beats the filename
        // as a starting point, but only when it isn't junk left by the producer.
        let title = file.name.replace(/\.pdf$/i, '')
        try {
          const info = (await pdf.getMetadata()).info as { Title?: string } | undefined
          title = cleanTitle(info?.Title) ?? title
        } catch {
          // Metadata is optional; the filename is a perfectly good fallback.
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
          title,
          tags: [],
          metaAt: Date.now(),
        }
        await db.putDoc({ ...doc, blob: file })
        // The document is already parsed here, so the cover is nearly free.
        // Fire and forget: if closing the document cancels it, the first hover
        // in the library renders the cover instead.
        renderCover(pdf)
          .then((cover) => cover && db.putThumb(doc.id, cover))
          .catch((cause) => {
            if (!isTeardown(cause)) console.error('表紙を作れませんでした', cause)
          })
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

  /**
   * Write the reading position out now instead of waiting on the debounces -
   * the reader is leaving. The folder gets it too: its copy of the position is
   * otherwise only as fresh as the last note edit, which is no use at all to
   * the machine that picks the document up next.
   */
  const flushPosition = useCallback(() => {
    if (!active) return
    const at = Date.now()
    metaAtRef.current = at
    const doc = { ...active.doc, lastPage: currentPageRef.current, metaAt: at }
    db.updateDoc(doc.id, { lastPage: doc.lastPage, metaAt: at }).catch(console.error)
    if (vaultDir && vaultStatus === 'ready') {
      writeBundle(
        vaultDir,
        toBundle(doc, notes, highlights, bookmarks),
        toMarkdown(doc, notes, highlights, bookmarks),
      ).catch((cause) => console.error('同期フォルダに書けませんでした', cause))
    }
  }, [active, notes, highlights, bookmarks, vaultDir, vaultStatus])

  const closeDoc = useCallback(() => {
    flushPosition()
    active?.pdf.loadingTask.destroy().catch(() => {})
    setActive(null)
    setNotes([])
    setHighlights([])
    setBookmarks([])
    setQuoteTarget(null)
  }, [active, flushPosition])

  /**
   * Hand back a cover for the library's hover preview. Imports render one up
   * front, but documents added before covers existed - or opened on another
   * machine - are rendered here, once, on the first look.
   */
  const requestCover = useCallback(async (id: string): Promise<string | null> => {
    const cached = coverUrls.current.get(id)
    if (cached) return cached

    let blob = await db.getThumb(id)
    if (!blob) {
      const record = await db.getDoc(id)
      if (!record) return null
      const task = loadPdf(await record.blob.arrayBuffer())
      try {
        blob = (await renderCover(await task.promise)) ?? undefined
        if (blob) await db.putThumb(id, blob)
      } catch (cause) {
        if (!isTeardown(cause)) console.error('表紙を作れませんでした', cause)
        return null
      } finally {
        await task.destroy().catch(() => {})
      }
    }
    if (!blob) return null

    const url = URL.createObjectURL(blob)
    coverUrls.current.set(id, url)
    return url
  }, [])

  /* ------------------------------------------------------ library metadata */

  const renameDoc = useCallback(async (id: string, title: string) => {
    await db.updateDoc(id, { title })
    setDocs(await db.listDocs())
  }, [])

  const toggleTag = useCallback(async (id: string, name: string) => {
    const record = await db.getDoc(id)
    if (!record) return
    const current = record.tags ?? []
    const tags = current.includes(name) ? current.filter((tag) => tag !== name) : [...current, name]
    await db.updateDoc(id, { tags })
    setDocs(await db.listDocs())
  }, [])

  /** Store the palette, show it, and mirror it to the sync folder. */
  const savePalette = useCallback(
    async (tags: Tag[]) => {
      const savedAt = Date.now()
      await db.setTags(tags, savedAt)
      setPalette(tags)
      if (vaultDir && vaultStatus === 'ready') {
        writePalette(vaultDir, toPaletteFile(tags, savedAt)).catch((cause) =>
          console.error('タグの色を同期フォルダに書けませんでした', cause),
        )
      }
    },
    [vaultDir, vaultStatus],
  )

  // Assigned in an effect, not during render: writing a ref while rendering is
  // not safe under StrictMode's double invocation.
  useEffect(() => {
    savePaletteRef.current = savePalette
  }, [savePalette])

  const recolorTag = useCallback(
    async (name: string, color: TagColor) => {
      await savePalette((await db.getTags()).map((tag) => (tag.name === name ? { ...tag, color } : tag)))
    },
    [savePalette],
  )

  const createTag = useCallback(
    async (tag: Tag) => {
      const current = await db.getTags()
      if (current.some((existing) => existing.name === tag.name)) return
      await savePalette([...current, tag])
    },
    [savePalette],
  )

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

  // Reconcile the palette with the folder as soon as it is usable. Tag names are
  // unioned so neither machine loses one; only the colour of a name both sides
  // already know is settled by the timestamp.
  useEffect(() => {
    if (!vaultDir || vaultStatus !== 'ready') return
    let cancelled = false

    const reconcile = async () => {
      const [local, localStamp, remote] = await Promise.all([db.getTags(), db.getTagsStamp(), readPalette(vaultDir)])
      if (cancelled) return

      const merged = mergePalettes(local, localStamp, remote?.tags ?? [], remote?.savedAt ?? 0)
      const stamp = Math.max(localStamp, remote?.savedAt ?? 0)

      if (JSON.stringify(merged) !== JSON.stringify(local)) {
        await db.setTags(merged, stamp)
        if (!cancelled) setPalette(merged)
      }
      // Only write when the folder is actually out of date, so opening the app
      // doesn't churn the file (and the cloud sync behind it) every time.
      if (!remote || JSON.stringify(merged) !== JSON.stringify(remote.tags)) {
        await writePalette(vaultDir, toPaletteFile(merged, stamp))
      }
    }

    reconcile().catch((cause) => console.error('タグの色を同期できませんでした', cause))
    return () => {
      cancelled = true
    }
  }, [vaultDir, vaultStatus])

  /**
   * Mirror the open document into the folder. Deliberately not keyed on
   * `currentPage`: every scroll pause would rewrite two files for no gain, so
   * the page number rides along with whatever edit triggers the next write.
   */
  useEffect(() => {
    if (!active || !vaultDir || vaultStatus !== 'ready') return
    const timer = setTimeout(() => {
      const doc = { ...active.doc, lastPage: currentPageRef.current, metaAt: metaAtRef.current }
      writeBundle(
        vaultDir,
        toBundle(doc, notes, highlights, bookmarks),
        toMarkdown(doc, notes, highlights, bookmarks),
      ).catch((cause) => {
        console.error('同期フォルダに書けませんでした', cause)
        setVaultStatus('blocked')
      })
    }, 1200)
    return () => clearTimeout(timer)
  }, [active, notes, highlights, bookmarks, vaultDir, vaultStatus])

  /* ------------------------------------------------------ backup / restore */

  const exportJson = useCallback(() => {
    if (!active) return
    const doc = { ...active.doc, lastPage: currentPageRef.current }
    const name = `${doc.name.replace(/\.pdf$/i, '')}.notes.json`
    download(name, JSON.stringify(toBundle(doc, notes, highlights, bookmarks), null, 2), 'application/json')
  }, [active, notes, highlights, bookmarks])

  const importJson = useCallback(
    async (file: File) => {
      if (!active) return
      setError(null)
      try {
        const bundle = parseBundle(await file.text())
        const count = bundle.notes.length + bundle.highlights.length + (bundle.bookmarks?.length ?? 0)
        if (!confirm(`「${active.doc.name}」のメモとハイライトを、このファイルの内容（${count} 件）で置き換えます。よろしいですか？`)) return
        const adopted = adoptBundle(bundle, active.doc.id)
        const restored = adopted.notes.sort((a, b) => a.page - b.page || a.order - b.order)
        await db.replaceAnnotations(active.doc.id, restored, adopted.highlights)
        await db.replaceBookmarks(active.doc.id, adopted.bookmarks)
        setNotes(restored)
        setHighlights(adopted.highlights)
        setBookmarks(adopted.bookmarks.sort((a, b) => a.page - b.page))
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

    let frame = 0
    let steady = 0
    let previousTop = -1
    const deadline = performance.now() + 2000
    // Aiming once isn't enough. The rows are laid out at the old zoom for a
    // frame or two while fit-to-window is computed, and every page is a little
    // shorter than its final height, so a single jump lands short by that error
    // times the page number - a page or two into a short PDF, far more into a
    // long one. Re-aim each frame until the target stops moving.
    const settle = () => {
      const row = document.getElementById(`page-${page}`)
      if (row) {
        // Cleared only once a scroll has actually run: clearing it up front
        // would let StrictMode's discarded first pass eat the restore.
        restoreTo.current = null
        const top = Math.round(row.getBoundingClientRect().top + window.scrollY)
        steady = top === previousTop ? steady + 1 : 0
        previousTop = top
        row.scrollIntoView({ block: 'start' })
        syncCurrentPage()
      }
      if (steady < 3 && performance.now() < deadline) frame = requestAnimationFrame(settle)
      else stop()
    }

    // Whoever reaches for the wheel has overruled us; stop pulling them back.
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
    const stop = () => {
      cancelAnimationFrame(frame)
      restoreTo.current = null
      setRestoring(false)
      for (const name of events) window.removeEventListener(name, stop)
    }
    for (const name of events) window.addEventListener(name, stop, { passive: true })

    frame = requestAnimationFrame(settle)
    return stop
  }, [active, syncCurrentPage])

  useEffect(() => {
    if (resumeHint == null) return
    const timer = setTimeout(() => setResumeHint(null), 5000)
    return () => clearTimeout(timer)
  }, [resumeHint])

  // Remember the page, but not the pages that flick past during the restore.
  useEffect(() => {
    if (!active || restoring) return
    const timer = setTimeout(() => {
      const at = Date.now()
      metaAtRef.current = at
      db.updateDoc(active.doc.id, { lastPage: currentPage, metaAt: at }).catch(console.error)
    }, 800)
    return () => clearTimeout(timer)
  }, [active, currentPage, restoring])

  // Closing the tab doesn't wait for the debounce above, so flush on the way out.
  useEffect(() => {
    if (!active) return
    const flush = () => {
      if (document.visibilityState === 'hidden') flushPosition()
    }
    document.addEventListener('visibilitychange', flush)
    return () => document.removeEventListener('visibilitychange', flush)
  }, [active, flushPosition])

  const removeDoc = useCallback(
    async (id: string) => {
      const cover = coverUrls.current.get(id)
      if (cover) URL.revokeObjectURL(cover)
      coverUrls.current.delete(id)
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
      // Aim at the card rather than at the end of the track: with the page
      // pinned, the far end can leave the new note sitting behind it.
      requestAnimationFrame(() => {
        const track = document.querySelector<HTMLElement>(`#page-${page} .row__track`)
        const lanes = track?.querySelectorAll<HTMLElement>('.lane--note')
        const fresh = lanes?.[lanes.length - 1]
        if (track && fresh) track.scrollTo({ left: laneOffset(track, fresh), behavior: 'smooth' })
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

  /* -------------------------------------------------------------- bookmarks */

  /** Drop a bookmark on this page, or lift the one already there. */
  const toggleBookmark = useCallback(
    (page: number) => {
      if (!active) return
      const existing = bookmarks.find((mark) => mark.page === page)
      if (existing) {
        setBookmarks((current) => current.filter((mark) => mark.id !== existing.id))
        db.deleteBookmark(existing.id).catch(console.error)
        return
      }
      const mark: Bookmark = {
        id: uid(),
        docId: active.doc.id,
        page,
        label: '',
        createdAt: Date.now(),
      }
      setBookmarks((current) => [...current, mark].sort((a, b) => a.page - b.page))
      db.putBookmark(mark).catch(console.error)
    },
    [active, bookmarks],
  )

  const labelBookmark = useCallback((id: string, label: string) => {
    setBookmarks((current) => {
      const next = current.map((mark) => (mark.id === id ? { ...mark, label } : mark))
      const updated = next.find((mark) => mark.id === id)
      if (updated) db.putBookmark(updated).catch(console.error)
      return next
    })
  }, [])

  const removeBookmark = useCallback((id: string) => {
    setBookmarks((current) => current.filter((mark) => mark.id !== id))
    db.deleteBookmark(id).catch(console.error)
  }, [])

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

  const jumpTo = useCallback(
    (page: number) => {
      // Gliding to the next page keeps your bearings. Gliding across thirty of
      // them just makes you watch the pages you skipped, so those jump outright.
      const behavior: ScrollBehavior = Math.abs(page - currentPageRef.current) > 3 ? 'auto' : 'smooth'
      document.getElementById(`page-${page}`)?.scrollIntoView({ behavior, block: 'start' })
      requestAnimationFrame(syncCurrentPage)
    },
    [syncCurrentPage],
  )

  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'n') {
        event.preventDefault()
        addNote(currentPage)
      } else if (event.key === 'b') {
        event.preventDefault()
        toggleBookmark(currentPage)
      } else if (event.key === 'j') {
        jumpTo(Math.min(active.doc.pageCount, currentPage + 1))
      } else if (event.key === 'k') {
        jumpTo(Math.max(1, currentPage - 1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [active, currentPage, addNote, jumpTo, toggleBookmark])

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
        palette={palette}
        searchIndex={searchIndex}
        noteCounts={noteCounts}
        onRenameDoc={renameDoc}
        onToggleTag={toggleTag}
        onCreateTag={createTag}
        onRecolorTag={recolorTag}
        onRequestCover={requestCover}
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
  const bookmarkedPages = new Set(bookmarks.map((mark) => mark.page))
  const marked = bookmarkedPages.has(currentPage)

  const pageWidth = Math.round(active.baseSize.width * scale)
  const gutter = Math.round(
    Math.min(MAX_GUTTER, Math.max(MIN_GUTTER, (viewportWidth - pageWidth - NOTE_WIDTH - MIN_GUTTER - PAGE_TRAIL) / 2)),
  )
  const pdfLane = pageWidth + gutter + PAGE_TRAIL
  // Pinning is only a kindness while a note still fits beside the page. Past
  // that it would hide the notes behind the page, which is the same complaint
  // from the other side, so a very narrow window gets the sliding lane back.
  const pinned = pinPage && viewportWidth - pdfLane >= MIN_NOTE_WIDTH

  return (
    <div className="app">
      <header className="toolbar">
        <button type="button" className="toolbar__back" onClick={closeDoc} title="ライブラリへ戻る">
          ←
        </button>
        <span className="toolbar__name" title={active.doc.name}>
          {active.doc.title?.trim() || active.doc.name.replace(/\.pdf$/i, '')}
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
          className={pinned ? 'is-on' : ''}
          onClick={() =>
            setPinPage((value) => {
              void db.setSetting(PIN_KEY, !value).catch(console.error)
              return !value
            })
          }
          title="横スクロール中もページを左端に固定する"
        >
          ページ固定
        </button>

        <button type="button" onClick={() => addNote(currentPage)} title="現在のページにメモを追加 (n)">
          ＋ メモ
        </button>

        <button
          type="button"
          className={marked ? 'is-on' : ''}
          onClick={() => toggleBookmark(currentPage)}
          title={marked ? `p.${currentPage} のしおりを外す (b)` : `p.${currentPage} にしおりを挟む (b)`}
        >
          {marked ? '🔖' : '🏷'} しおり
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
                      toMarkdown(active.doc, notes, highlights, bookmarks),
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
          しおり・メモ ({bookmarks.length + annotatedPages.length})
        </button>
      </header>

      <main
        className="pages"
        style={{ '--pdf-lane': `${pdfLane}px`, '--page-gutter': `${gutter}px` } as CSSProperties}
      >
        {Array.from({ length: active.doc.pageCount }, (_, index) => index + 1).map((page) => (
          <PageRow
            key={page}
            pdf={active.pdf}
            pageNumber={page}
            scale={scale}
            pinPage={pinned}
            notes={notesByPage.get(page) ?? EMPTY}
            highlights={highlightsByPage.get(page) ?? EMPTY}
            bookmarked={bookmarkedPages.has(page)}
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

      {resumeHint != null && (
        <div className="resume" role="status">
          <span>
            前回の続き <strong>p.{resumeHint}</strong> から開きました
          </span>
          <button
            type="button"
            onClick={() => {
              setResumeHint(null)
              jumpTo(1)
            }}
          >
            先頭へ
          </button>
        </div>
      )}

      {panelOpen && (
        <aside className="panel">
          <header className="panel__head">
            <strong>しおりとメモ</strong>
            <button type="button" onClick={() => setPanelOpen(false)}>
              ✕
            </button>
          </header>
          <div className="panel__body">
            <section className="panel__marks">
              <h3 className="panel__section">しおり</h3>
              {bookmarks.length === 0 && (
                <p className="panel__empty">
                  ツールバーの「しおり」か <kbd>b</kbd> で、読んでいるページに挟めます。
                </p>
              )}
              {bookmarks.map((mark) => (
                <div key={mark.id} className="mark">
                  <button type="button" className="mark__page" onClick={() => jumpTo(mark.page)}>
                    p.{mark.page}
                  </button>
                  <input
                    className="mark__label"
                    value={mark.label}
                    placeholder="名前をつける"
                    onChange={(event) => labelBookmark(mark.id, event.target.value)}
                  />
                  <button type="button" className="mark__remove" title="外す" onClick={() => removeBookmark(mark.id)}>
                    ✕
                  </button>
                </div>
              ))}
            </section>

            <h3 className="panel__section">メモ・ハイライト</h3>
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
