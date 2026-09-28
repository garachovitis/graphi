import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Strict CSP for the packaged app only (the dev server needs inline HMR scripts).
const CSP = "default-src 'self'; img-src 'self' data: blob: https: http:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self' https: http:"
const csp = () => ({
  name: 'grafi-csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

// base './' so the built index.html loads from file:// inside Electron.
export default defineConfig({
  base: './',
  plugins: [react(), csp()],
  server: { port: 5199, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
})
