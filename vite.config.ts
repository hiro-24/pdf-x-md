import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Pinned, and deliberately not Vite's default 5173.
  //
  // A port is an origin, and an origin is a storage area: everything the app
  // keeps - the PDFs, the notes, the tags, the permission to write to the sync
  // folder - lives under the exact URL it was first opened at. Without
  // strictPort, a taken 5173 makes Vite quietly serve 5174 instead, and the
  // next start goes back to 5173 to find an empty library. That happened, with
  // the real work sitting at 5174; this is why the app lives there now. Moving
  // it back would mean adding every PDF again, since the folder mirrors the
  // notes but not the PDFs themselves.
  //
  // strictPort makes a clash an error you can read instead of a library you
  // cannot find. The tests run their own server on 5175 (tests/run.mjs).
  server: { port: 5174, strictPort: true },
  // pdf.js ships its worker as an ESM bundle; keep it out of dep pre-bundling
  // so the `?url` import resolves to the real file.
  optimizeDeps: { exclude: ['pdfjs-dist'] },
})
