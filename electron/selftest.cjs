// End-to-end self-test of the real main process + preload bridge.
// Runs only when GRAFI_SELFTEST=<output dir> is set:  GRAFI_SELFTEST=/tmp/x npx electron .
'use strict'
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

module.exports = function selftest(outDir) {
  app.on('browser-window-created', (_e, win) => {
    win.webContents.once('did-finish-load', async () => {
      const results = {}
      const js = (code) => win.webContents.executeJavaScript(code)
      try {
        await new Promise((r) => setTimeout(r, 2000))
        const docx = path.join(outDir, 'selftest.docx')
        results.bridge = await js('typeof window.grafiNative === "object" && window.grafiNative.platform')
        results.save = await js(`(async () => {
          const F = await import('/src/io/formats.ts')
          const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Αυτοέλεγχος Grafi' }] }] }
          const data = await F.serialize('docx', doc, (await import('/src/model/settings.ts')).DEFAULT_SETTINGS, new Map())
          return window.grafiNative.saveFile({ filePath: ${JSON.stringify(docx)}, suggestedName: 'selftest.docx', kind: 'docx', data })
        })()`)
        results.fileOnDisk = fs.existsSync(docx) && fs.statSync(docx).size
        results.read = await js(`window.grafiNative.readFile(${JSON.stringify(docx)}).then(f => ({ name: f.name, bytes: f.data.length }))`)
        results.reopen = await js(`(async () => {
          const F = await import('/src/io/formats.ts')
          const f = await window.grafiNative.readFile(${JSON.stringify(docx)})
          const l = await F.loadFile(f.name, f.data)
          return l.doc.content[0].content[0].text
        })()`)
        const pdf = await js('window.grafiNative.renderPdf().then(b => Array.from(b.slice(0, 5)))')
        results.pdfMagic = String.fromCharCode(...pdf)
        await js('window.grafiNative.setWindowState({ title: "Selftest — Grafi", dirty: true, filePath: null })')
        results.title = win.getTitle()
        results.recent = await js(`window.grafiNative.recent().then(r => r.includes(${JSON.stringify(docx)}))`)
        results.ok = results.bridge && results.fileOnDisk > 0 && results.reopen === 'Αυτοέλεγχος Grafi' && results.pdfMagic === '%PDF-' && results.recent
      } catch (err) {
        results.error = String(err && err.stack || err)
      }
      fs.writeFileSync(path.join(outDir, 'selftest.json'), JSON.stringify(results, null, 2))
      app.exit(0)
    })
  })
}
