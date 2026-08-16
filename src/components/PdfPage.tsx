import { useEffect, useRef, useState } from 'react'
import { pdfjs, type PDFDocument } from '../pdf'
import { HIGHLIGHT_COLORS, type Highlight, type HighlightColor, type Rect } from '../types'

interface Size {
  width: number
  height: number
}

interface Props {
  pdf: PDFDocument
  pageNumber: number
  scale: number
  /** Render for real, or just hold the space? Driven by the parent's viewport observer. */
  visible: boolean
  /** Page size at scale 1, used until this page has been measured for real. */
  fallbackSize: Size
  highlights: Highlight[]
  onMeasure: (page: number, size: Size) => void
  onCreateHighlight: (page: number, rects: Rect[], text: string, color: HighlightColor) => void
  onRecolorHighlight: (id: string, color: HighlightColor) => void
  onDeleteHighlight: (id: string) => void
  onQuote: (page: number, text: string) => void
}

/** A pending text selection, or an existing highlight the user clicked on. */
type Popup =
  | { kind: 'selection'; rects: Rect[]; text: string; x: number; y: number }
  | { kind: 'highlight'; highlight: Highlight; x: number; y: number }

/**
 * `Range.getClientRects()` hands back one rect per text fragment, so a selection
 * that spans styled runs produces a ragged pile of boxes. Collapse them into one
 * box per visual line.
 */
function mergeIntoLines(rects: Rect[]): Rect[] {
  const lines: Rect[] = []
  for (const rect of rects) {
    const line = lines.find(
      (candidate) => Math.abs(candidate.y - rect.y) < rect.h * 0.5 && Math.abs(candidate.h - rect.h) < rect.h * 0.5,
    )
    if (!line) {
      lines.push({ ...rect })
      continue
    }
    const left = Math.min(line.x, rect.x)
    const right = Math.max(line.x + line.w, rect.x + rect.w)
    const top = Math.min(line.y, rect.y)
    const bottom = Math.max(line.y + line.h, rect.y + rect.h)
    line.x = left
    line.y = top
    line.w = right - left
    line.h = bottom - top
  }
  return lines.sort((a, b) => a.y - b.y || a.x - b.x)
}

/** How long a page keeps its bitmap after scrolling out of range. */
const EVICT_DELAY = 8000

const contains = (rect: Rect, x: number, y: number) =>
  x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h

export default function PdfPage({
  pdf,
  pageNumber,
  scale,
  visible,
  fallbackSize,
  highlights,
  onMeasure,
  onCreateHighlight,
  onRecolorHighlight,
  onDeleteHighlight,
  onQuote,
}: Props) {
  const pageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>(fallbackSize)
  const [rendered, setRendered] = useState(false)
  /** Scale the canvas currently holds, so re-entering the viewport is free. */
  const paintedScale = useRef<number | null>(null)
  const [popup, setPopup] = useState<Popup | null>(null)

  useEffect(() => {
    if (!visible || paintedScale.current === scale) return

    let cancelled = false
    let renderTask: pdfjs.RenderTask | null = null
    let textLayer: pdfjs.TextLayer | null = null

    const run = async () => {
      const page = await pdf.getPage(pageNumber)
      if (cancelled) return

      const base = page.getViewport({ scale: 1 })
      const measured = { width: base.width, height: base.height }
      setSize(measured)
      onMeasure(pageNumber, measured)

      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      const container = textRef.current
      if (!canvas || !container) return

      // Render at device resolution so text stays crisp on retina displays,
      // but cap it - a 3x canvas of an A4 page at 200% is a lot of memory.
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(viewport.width * dpr)
      canvas.height = Math.round(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`

      renderTask = page.render({
        canvas,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      })
      await renderTask.promise
      if (cancelled) return

      container.replaceChildren()
      textLayer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent(),
        container,
        viewport,
      })
      await textLayer.render()
      if (cancelled) return
      pdfjs.setLayerDimensions(container, viewport)
      paintedScale.current = scale
      setRendered(true)
    }

    run().catch((error: unknown) => {
      // All normal teardown: the page scrolled away, or the document was closed
      // while pages further down were still being drawn.
      const name = error instanceof Error ? error.name : ''
      const message = error instanceof Error ? error.message : ''
      if (name === 'RenderingCancelledException' || name === 'AbortException') return
      if (message === 'Transport destroyed') return
      console.error(`page ${pageNumber} failed to render`, error)
    })

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
    }
  }, [pdf, pageNumber, scale, visible, onMeasure])

  // Scrolled away: eventually drop the bitmap and the text nodes so long
  // documents don't accumulate hundreds of canvases. Not immediately, though -
  // a flick of the scroll wheel routinely takes a page out and straight back,
  // and dropping it there just flashes a blank placeholder at the reader.
  useEffect(() => {
    if (visible) return
    setPopup(null)
    const timer = setTimeout(() => {
      setRendered(false)
      paintedScale.current = null
      const canvas = canvasRef.current
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
      textRef.current?.replaceChildren()
    }, EVICT_DELAY)
    return () => clearTimeout(timer)
  }, [visible])

  const width = size.width * scale
  const height = size.height * scale

  const handleMouseUp = (event: React.MouseEvent) => {
    const container = pageRef.current
    if (!container) return
    const box = container.getBoundingClientRect()
    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ''

    // A drag that produced text: offer to highlight or quote it.
    if (selection && !selection.isCollapsed && text) {
      const range = selection.getRangeAt(0)
      if (container.contains(range.commonAncestorContainer)) {
        const rects = mergeIntoLines(
          [...range.getClientRects()]
            .filter((rect) => rect.width > 1 && rect.height > 1)
            .map((rect) => ({
              x: (rect.left - box.left) / box.width,
              y: (rect.top - box.top) / box.height,
              w: rect.width / box.width,
              h: rect.height / box.height,
            })),
        )
        if (rects.length) {
          const last = rects[rects.length - 1]
          setPopup({ kind: 'selection', rects, text, x: last.x * box.width, y: (last.y + last.h) * box.height })
          return
        }
      }
    }

    // A plain click: if it landed on a highlight, open that highlight's menu.
    const x = (event.clientX - box.left) / box.width
    const y = (event.clientY - box.top) / box.height
    const hit = highlights.find((highlight) => highlight.rects.some((rect) => contains(rect, x, y)))
    setPopup(hit ? { kind: 'highlight', highlight: hit, x: x * box.width, y: y * box.height } : null)
  }

  const dismiss = () => {
    setPopup(null)
    window.getSelection()?.removeAllRanges()
  }

  return (
    <div
      ref={pageRef}
      className="pdf-page"
      style={
        {
          width,
          height,
          '--total-scale-factor': scale,
          '--scale-round-x': '1px',
          '--scale-round-y': '1px',
        } as React.CSSProperties
      }
      onMouseDown={() => setPopup(null)}
      onMouseUp={handleMouseUp}
    >
      <canvas ref={canvasRef} className="pdf-page__canvas" />

      <div className="pdf-page__highlights" aria-hidden>
        {highlights.map((highlight) =>
          highlight.rects.map((rect, index) => (
            <span
              key={`${highlight.id}-${index}`}
              className={`hl hl--${highlight.color}`}
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`,
              }}
            />
          )),
        )}
      </div>

      <div ref={textRef} className="textLayer" />

      {!rendered && (
        <div className="pdf-page__placeholder">
          <span>{pageNumber}</span>
        </div>
      )}

      {popup && (
        <div
          className="page-popup"
          style={{ left: popup.x, top: popup.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
        >
          {popup.kind === 'selection' ? (
            <>
              <div className="page-popup__colors">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`swatch swatch--${color}`}
                    title={`${color} でハイライト`}
                    onClick={() => {
                      onCreateHighlight(pageNumber, popup.rects, popup.text, color)
                      dismiss()
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                className="page-popup__action"
                onClick={() => {
                  onQuote(pageNumber, popup.text)
                  dismiss()
                }}
              >
                メモに引用
              </button>
            </>
          ) : (
            <>
              <div className="page-popup__colors">
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`swatch swatch--${color}${popup.highlight.color === color ? ' is-current' : ''}`}
                    title={`${color} に変更`}
                    onClick={() => {
                      onRecolorHighlight(popup.highlight.id, color)
                      dismiss()
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                className="page-popup__action"
                onClick={() => {
                  onQuote(pageNumber, popup.highlight.text)
                  dismiss()
                }}
              >
                メモに引用
              </button>
              <button
                type="button"
                className="page-popup__action page-popup__action--danger"
                onClick={() => {
                  onDeleteHighlight(popup.highlight.id)
                  dismiss()
                }}
              >
                削除
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
