import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // pdf.js ships its worker as an ESM bundle; keep it out of dep pre-bundling
  // so the `?url` import resolves to the real file.
  optimizeDeps: { exclude: ['pdfjs-dist'] },
})
