import type { PDFDocument } from '../pdf'

/** Rendered width in CSS pixels; drawn at 2x so it stays sharp on retina. */
export const COVER_WIDTH = 200
const SCALE_FACTOR = 2

/**
 * Draw page 1 as the document's cover. Generated once when a PDF is imported
 * (or on first hover for older entries) and cached in IndexedDB - re-parsing a
 * whole PDF just to show a hover preview would be far too slow.
 */
export async function renderCover(pdf: PDFDocument): Promise<Blob | null> {
  const page = await pdf.getPage(1)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: (COVER_WIDTH * SCALE_FACTOR) / base.width })

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)

  const context = canvas.getContext('2d')
  if (!context) return null
  // Pages are drawn without a background, and JPEG has no alpha: without this
  // the whole cover comes out black.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  await page.render({ canvas, viewport }).promise
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
}
