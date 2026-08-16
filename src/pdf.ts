import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const assets = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href

export type PDFDocument = pdfjs.PDFDocumentProxy
export type PDFPage = pdfjs.PDFPageProxy

export function loadPdf(data: ArrayBuffer): pdfjs.PDFDocumentLoadingTask {
  return pdfjs.getDocument({
    data,
    // Japanese and other CJK documents need the character maps to map glyphs
    // back to text; without these, text selection returns garbage.
    cMapUrl: assets('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: assets('standard_fonts'),
    wasmUrl: assets('wasm'),
    iccUrl: assets('iccs'),
  })
}

export { pdfjs }
