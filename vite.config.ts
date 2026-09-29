import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))

// Strict CSP for the packaged app only (the dev server needs inline HMR scripts).
const CSP = "default-src 'self'; img-src 'self' data: blob: https: http:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self' https: http:"
const csp = () => ({
  name: 'grafi-csp',
  apply: 'build' as const,
  transformIndexHtml: (html: string) =>
    html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
})

// Spelling dictionaries as lazily loaded JS chunks (a plain script import works everywhere:
// Electron's file://, the PWA offline cache, iOS / Android WebViews).
//  virtual:dict/el — the LibreOffice el_GR word list (828k fully inflected forms), sorted by
//                    UTF-16 code unit for binary search, gzip + base64 (~3.4 MB instead of 19 MB)
//  virtual:dict/en — Hunspell en_US .aff/.dic for nspell
const dictionaries = (): Plugin => {
  const PREFIX = 'virtual:dict/'
  const dir = (lang: string) => resolve(ROOT, 'node_modules', `dictionary-${lang}`)
  const gz = (s: string) => gzipSync(Buffer.from(s, 'utf8'), { level: 9 }).toString('base64')
  return {
    name: 'grafi-dictionaries',
    resolveId: (id) => (id.startsWith(PREFIX) ? `\0${id}` : undefined),
    load(id) {
      if (!id.startsWith(`\0${PREFIX}`)) return
      const lang = id.slice(PREFIX.length + 1)
      if (lang === 'el') {
        const words = readFileSync(resolve(dir('el'), 'index.dic'), 'utf8').split('\n').slice(1).map((w) => w.trim()).filter(Boolean)
        const sorted = [...new Set(words)].sort()
        return `export default ${JSON.stringify(gz(sorted.join('\n')))}`
      }
      if (lang === 'en') {
        const aff = readFileSync(resolve(dir('en'), 'index.aff'), 'utf8')
        const dic = readFileSync(resolve(dir('en'), 'index.dic'), 'utf8')
        return `export const aff = ${JSON.stringify(gz(aff))}\nexport const dic = ${JSON.stringify(gz(dic))}`
      }
    },
  }
}

// base './' so the built index.html loads from file:// inside Electron.
export default defineConfig({
  base: './',
  plugins: [react(), csp(), dictionaries()],
  server: { port: 5199, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 4000 },
})
