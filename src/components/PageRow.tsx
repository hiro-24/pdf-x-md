import { memo, useEffect, useRef, useState } from 'react'
import PdfPage from './PdfPage'
import NoteCard, { type PendingQuote } from './NoteCard'
import { laneOffset } from '../lib/lane'
import type { PDFDocument } from '../pdf'
import type { Highlight, HighlightColor, Note, Rect } from '../types'

interface Props {
  pdf: PDFDocument
  pageNumber: number
  scale: number
  pinPage: boolean
  notes: Note[]
  highlights: Highlight[]
  bookmarked: boolean
  fallbackSize: { width: number; height: number }
  autoFocusNoteId: string | null
  /** Set when a quote is bound for a note on this page. */
  quoteTarget: { noteId: string; quote: PendingQuote } | null
  onMeasure: (page: number, size: { width: number; height: number }) => void
  onViewChange: (page: number, inView: boolean) => void
  onAddNote: (page: number) => void
  onChangeNote: (id: string, body: string) => void
  onDeleteNote: (id: string) => void
  onMoveNote: (id: string, direction: -1 | 1) => void
  onCreateHighlight: (page: number, rects: Rect[], text: string, color: HighlightColor) => void
  onRecolorHighlight: (id: string, color: HighlightColor) => void
  onDeleteHighlight: (id: string) => void
  onQuote: (page: number, text: string) => void
}

/** Render pages this many px outside the viewport so scrolling doesn't hit blanks. */
const PRERENDER_MARGIN = 1200

function PageRow(props: Props) {
  const { pdf, pageNumber, scale, pinPage, notes, highlights, bookmarked, fallbackSize, autoFocusNoteId, quoteTarget } =
    props
  const rowRef = useRef<HTMLElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const row = rowRef.current
    if (!row) return

    const renderObserver = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: `${PRERENDER_MARGIN}px 0px`,
    })
    renderObserver.observe(row)

    // Safety net. When a note card mounts, the row's layout shifts under the
    // observer, and Chrome occasionally samples the transient geometry, reports
    // "gone", and never reports the row's return - leaving a page blank while it
    // sits in plain sight. Re-check the real rectangle while we believe a row is
    // off-screen; it costs one measurement per hidden row per second.
    const recheck = setInterval(() => {
      const rect = row.getBoundingClientRect()
      const inRange = rect.bottom > -PRERENDER_MARGIN && rect.top < window.innerHeight + PRERENDER_MARGIN
      setVisible((current) => (current === inRange ? current : inRange))
    }, 1000)

    // A second, much tighter band tells the toolbar which page you're reading.
    // It reports leaving as well as entering: with tall rows two pages can share
    // the band, and only tracking arrivals leaves the indicator on the wrong one.
    const currentObserver = new IntersectionObserver(
      ([entry]) => props.onViewChange(pageNumber, entry.isIntersecting),
      { rootMargin: '-45% 0px -45% 0px' },
    )
    currentObserver.observe(row)

    return () => {
      clearInterval(recheck)
      renderObserver.disconnect()
      currentObserver.disconnect()
      props.onViewChange(pageNumber, false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNumber])

  /**
   * Step to the next note rather than by a fixed distance. A fixed step has to
   * guess how much of the track the reader can actually see, and beside a
   * pinned page that guess is wrong by the width of the page - it lands you on
   * a note that is half behind it.
   */
  const scrollLane = (direction: -1 | 1) => {
    const track = trackRef.current
    if (!track) return
    const stops = [...track.querySelectorAll<HTMLElement>('.lane--note, .lane--add')].map((lane) =>
      laneOffset(track, lane),
    )
    const next =
      direction > 0
        ? stops.find((left) => left > track.scrollLeft + 1)
        : [...stops].reverse().find((left) => left < track.scrollLeft - 1)
    track.scrollTo({ left: next ?? (direction > 0 ? track.scrollWidth : 0), behavior: 'smooth' })
  }

  return (
    <section ref={rowRef} className="row" id={`page-${pageNumber}`} data-page={pageNumber}>
      <div ref={trackRef} className={`row__track${pinPage ? ' is-pinned' : ''}`}>
        <div className="lane lane--pdf">
          <PdfPage
            pdf={pdf}
            pageNumber={pageNumber}
            scale={scale}
            visible={visible}
            fallbackSize={fallbackSize}
            highlights={highlights}
            onMeasure={props.onMeasure}
            onCreateHighlight={props.onCreateHighlight}
            onRecolorHighlight={props.onRecolorHighlight}
            onDeleteHighlight={props.onDeleteHighlight}
            onQuote={props.onQuote}
          />
          <div className="lane__foot">
            <span className="page-num">p.{pageNumber}</span>
            {bookmarked && (
              <span className="lane__mark" title="しおりを挟んだページ">
                🔖
              </span>
            )}
            {notes.length > 0 && (
              <button type="button" className="peek" onClick={() => scrollLane(1)}>
                メモ {notes.length} 件 →
              </button>
            )}
          </div>
        </div>

        {notes.map((note, index) => (
          <div className="lane lane--note" key={note.id}>
            <NoteCard
              note={note}
              index={index}
              count={notes.length}
              autoFocus={note.id === autoFocusNoteId}
              pendingQuote={quoteTarget?.noteId === note.id ? quoteTarget.quote : null}
              onChange={props.onChangeNote}
              onDelete={props.onDeleteNote}
              onMove={props.onMoveNote}
            />
          </div>
        ))}

        <div className="lane lane--add">
          <button type="button" className="add-note" onClick={() => props.onAddNote(pageNumber)}>
            <span className="add-note__plus">＋</span>
            <span>p.{pageNumber} にメモを追加</span>
          </button>
        </div>
      </div>
    </section>
  )
}

export default memo(PageRow)
