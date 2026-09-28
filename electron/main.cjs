// Grafi — Electron main process.
// Responsibilities: windows, native menus, file dialogs & I/O, printing, PDF export,
// spell-check context menu, OS file associations, recent documents.
'use strict'

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const { t, setLang, getLang, LANG_NAMES } = require('./i18n.cjs')

const isMac = process.platform === 'darwin'
const DEV_ICON = path.join(__dirname, '../build/icon.png')
const DEV_URL = process.env.VITE_DEV_SERVER_URL
const OPENABLE = ['.docx', '.grafi', '.worder', '.html', '.htm', '.txt', '.md', '.odt']

/** @type {Set<BrowserWindow>} */
const windows = new Set()
/** Files requested before the app was ready (macOS open-file, argv). */
const pendingOpen = []
/** Windows that already confirmed they may close. */
const closeApproved = new WeakSet()
/** Set while the user is quitting the app (Cmd+Q / menu), so approved closes continue the quit. */
let quitting = false

// ───────────────────────── recent files ─────────────────────────
const recentFile = () => path.join(app.getPath('userData'), 'recent.json')
function readRecent() {
  try { return JSON.parse(fsSync.readFileSync(recentFile(), 'utf8')) } catch { return [] }
}
function addRecent(p) {
  const list = [p, ...readRecent().filter((x) => x !== p)].slice(0, 15)
  try { fsSync.writeFileSync(recentFile(), JSON.stringify(list)) } catch { /* ignore */ }
  app.addRecentDocument(p)
  buildMenu()
}

// ───────────────────────── UI language ─────────────────────────
// The renderer owns the choice (File ▸ Options); we keep a copy so menus are right at start-up.
const prefsFile = () => path.join(app.getPath('userData'), 'prefs.json')
function readPrefs() {
  try { return JSON.parse(fsSync.readFileSync(prefsFile(), 'utf8')) } catch { return {} }
}
function applyLanguage(l) {
  if (l === getLang()) return
  setLang(l)
  try { fsSync.writeFileSync(prefsFile(), JSON.stringify({ ...readPrefs(), lang: l })) } catch { /* ignore */ }
  buildMenu()
}

// ───────────────────────── windows ─────────────────────────
function createWindow(openPath) {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Grafi',
    // Packaged builds take the icon from electron-builder; this covers `npm run dev` on Windows / Linux.
    ...(app.isPackaged ? {} : { icon: DEV_ICON }),
    backgroundColor: '#1ab3ac',
    // The app's own brand-coloured bar is the title bar; OS window controls sit on top of it.
    titleBarStyle: 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 12, y: 11 } }
      : { titleBarOverlay: { color: '#1ab3ac', symbolColor: '#ffffff', height: 36 } }),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })
  windows.add(win)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => windows.delete(win))

  // Ask the renderer whether the document may be closed (unsaved changes).
  win.on('close', (e) => {
    if (closeApproved.has(win)) return
    e.preventDefault()
    win.webContents.send('app:request-close')
  })

  // External links open in the system browser; never navigate the editor window away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return
    e.preventDefault()
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url)
  })

  win.webContents.on('context-menu', (_e, params) => showContextMenu(win, params))

  if (openPath) {
    win.webContents.once('did-finish-load', () => sendOpenPath(win, openPath))
  }

  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  return win
}

async function sendOpenPath(win, p) {
  try {
    const data = await fs.readFile(p)
    win.webContents.send('file:opened', { path: p, name: path.basename(p), data: new Uint8Array(data) })
    addRecent(p)
  } catch (err) {
    dialog.showErrorBox('Grafi', `${t('openFailed')}\n${p}\n\n${err.message}`)
  }
}

function focusedOrFirst() {
  return BrowserWindow.getFocusedWindow() || [...windows][0] || null
}

function openInWindow(p) {
  const win = focusedOrFirst()
  if (!win) return createWindow(p)
  // The renderer decides: reuse this window if its document is pristine, otherwise spawn a new one.
  win.webContents.send('file:open-request', p)
}

// ───────────────────────── context menu (spell-check) ─────────────────────────
function showContextMenu(win, params) {
  const m = []
  if (params.misspelledWord) {
    for (const s of params.dictionarySuggestions.slice(0, 6)) {
      m.push({ label: s, click: () => win.webContents.replaceMisspelling(s) })
    }
    if (!params.dictionarySuggestions.length) m.push({ label: t('noSuggestions'), enabled: false })
    m.push({
      label: t('addToDictionary'),
      click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord),
    })
    m.push({ type: 'separator' })
  }
  if (params.linkURL && /^https?:/i.test(params.linkURL)) {
    m.push({ label: t('openLink'), click: () => shell.openExternal(params.linkURL) })
    m.push({ type: 'separator' })
  }
  if (params.isEditable) {
    m.push({ label: t('cut'), role: 'cut', enabled: params.editFlags.canCut })
    m.push({ label: t('copy'), role: 'copy', enabled: params.editFlags.canCopy })
    m.push({ label: t('paste'), role: 'paste', enabled: params.editFlags.canPaste })
    m.push({ label: t('pasteText'), role: 'pasteAndMatchStyle', enabled: params.editFlags.canPaste })
    m.push({ type: 'separator' })
    m.push({ label: t('font'), click: () => win.webContents.send('menu', 'fontDialog') })
    m.push({ label: t('paragraph'), click: () => win.webContents.send('menu', 'paragraphDialog') })
    m.push({ label: t('link'), click: () => win.webContents.send('menu', 'link') })
    m.push({ type: 'separator' })
    m.push({ label: t('selectAll'), role: 'selectAll' })
  } else if (params.selectionText) {
    m.push({ label: t('copy'), role: 'copy' })
  }
  if (m.length) Menu.buildFromTemplate(m).popup({ window: win })
}

// ───────────────────────── application menu ─────────────────────────
function send(cmd) {
  return () => {
    const win = focusedOrFirst()
    if (win) win.webContents.send('menu', cmd)
  }
}

function buildMenu() {
  const recent = readRecent().filter((p) => fsSync.existsSync(p))
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: t('file'),
      submenu: [
        { label: t('newDoc'), accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { label: t('open'), accelerator: 'CmdOrCtrl+O', click: send('open') },
        {
          label: t('recent'),
          submenu: recent.length
            ? recent.map((p) => ({ label: path.basename(p), sublabel: p, click: () => openInWindow(p) }))
            : [{ label: t('empty'), enabled: false }],
        },
        { type: 'separator' },
        { label: t('save'), accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: t('saveAs'), accelerator: 'CmdOrCtrl+Shift+S', click: send('saveAs') },
        {
          label: t('export'),
          submenu: [
            { label: 'PDF…', accelerator: 'CmdOrCtrl+Shift+E', click: send('exportPdf') },
            { label: 'Word (.docx)…', click: send('exportDocx') },
            { label: 'OpenDocument (.odt)…', click: send('exportOdt') },
            { label: 'HTML…', click: send('exportHtml') },
            { label: 'Markdown…', click: send('exportMd') },
            { label: t('plainText'), click: send('exportTxt') },
          ],
        },
        { type: 'separator' },
        { label: t('pageSetup'), click: send('pageSetup') },
        { label: t('print'), accelerator: 'CmdOrCtrl+P', click: send('print') },
        { type: 'separator' },
        isMac ? { label: t('close'), role: 'close' } : { label: t('exit'), role: 'quit' },
      ],
    },
    {
      label: t('edit'),
      submenu: [
        { label: t('undo'), accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: t('redo'), accelerator: isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y', click: send('redo') },
        { type: 'separator' },
        { label: t('cut'), role: 'cut' },
        { label: t('copy'), role: 'copy' },
        { label: t('paste'), role: 'paste' },
        { label: t('pasteText'), role: 'pasteAndMatchStyle' },
        { label: t('selectAll'), role: 'selectAll' },
        { type: 'separator' },
        { label: t('find'), accelerator: 'CmdOrCtrl+F', click: send('find') },
        { label: t('replace'), accelerator: isMac ? 'Cmd+Alt+F' : 'Ctrl+H', click: send('replace') },
      ],
    },
    {
      label: t('view'),
      submenu: [
        { label: t('printLayout'), click: send('viewPrint') },
        { label: t('webLayout'), click: send('viewWeb') },
        { type: 'separator' },
        { label: t('ruler'), click: send('toggleRuler') },
        { label: t('marks'), accelerator: 'CmdOrCtrl+Shift+8', click: send('toggleMarks') },
        { type: 'separator' },
        { label: t('zoomIn'), accelerator: 'CmdOrCtrl+Alt+=', click: send('zoomIn') },
        { label: t('zoomOut'), accelerator: 'CmdOrCtrl+Alt+-', click: send('zoomOut') },
        { label: t('actualSize'), accelerator: 'CmdOrCtrl+Alt+0', click: send('zoomReset') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('fullScreen') },
        ...(DEV_URL ? [{ role: 'toggleDevTools' }, { role: 'reload' }] : []),
      ],
    },
    {
      label: t('insert'),
      submenu: [
        { label: t('pageBreak'), accelerator: 'CmdOrCtrl+Enter', click: send('pageBreak') },
        { label: t('table'), click: send('tableDialog') },
        { label: t('pictures'), click: send('image') },
        { label: t('link'), accelerator: 'CmdOrCtrl+K', click: send('link') },
        { label: t('symbol'), click: send('symbol') },
        { label: t('toc'), click: send('toc') },
        { label: t('headerFooter'), click: send('headerFooter') },
      ],
    },
    {
      label: t('format'),
      submenu: [
        { label: t('font'), accelerator: 'CmdOrCtrl+D', click: send('fontDialog') },
        { label: t('paragraph'), click: send('paragraphDialog') },
        { label: t('pageSetup'), click: send('pageSetup') },
      ],
    },
    {
      label: t('tools'),
      submenu: [
        { label: t('wordCount'), accelerator: 'CmdOrCtrl+Shift+G', click: send('wordCount') },
        {
          label: t('spellLang'),
          submenu: [
            { label: t('spellElEn'), click: () => setSpellLangs(['el', 'en-US']) },
            { label: t('spellEl'), click: () => setSpellLangs(['el']) },
            { label: t('spellEnUS'), click: () => setSpellLangs(['en-US']) },
            { label: t('spellEnGB'), click: () => setSpellLangs(['en-GB']) },
          ],
        },
        {
          label: t('displayLang'),
          submenu: Object.entries(LANG_NAMES).map(([id, name]) => ({
            label: name, type: 'radio', checked: getLang() === id, click: send(`lang:${id}`),
          })),
        },
      ],
    },
    { role: 'windowMenu', label: t('window') },
    {
      role: 'help',
      label: t('help'),
      submenu: [{ label: t('shortcuts'), click: send('shortcuts') }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function setSpellLangs(langs) {
  // macOS uses the native OS spell checker and ignores language selection.
  if (isMac) return
  const available = session.defaultSession.availableSpellCheckerLanguages
  session.defaultSession.setSpellCheckerLanguages(langs.filter((l) => available.includes(l)))
}

// ───────────────────────── IPC ─────────────────────────
// Built on demand so the names follow the current UI language.
const filters = () => ({
  docx: { name: t('fDocx'), extensions: ['docx'] },
  grafi: { name: t('fGrafi'), extensions: ['grafi', 'worder'] },
  odt: { name: t('fOdt'), extensions: ['odt'] },
  html: { name: t('fHtml'), extensions: ['html', 'htm'] },
  md: { name: 'Markdown', extensions: ['md'] },
  txt: { name: t('fTxt'), extensions: ['txt'] },
  pdf: { name: 'PDF', extensions: ['pdf'] },
})

ipcMain.handle('file:open-dialog', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const F = filters()
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: t('allDocs'), extensions: OPENABLE.map((x) => x.slice(1)) },
      F.docx, F.odt, F.grafi, F.html, F.md, F.txt,
    ],
  })
  if (res.canceled || !res.filePaths[0]) return null
  const p = res.filePaths[0]
  const data = await fs.readFile(p)
  addRecent(p)
  return { path: p, name: path.basename(p), data: new Uint8Array(data) }
})

ipcMain.handle('file:read', async (_e, p) => {
  const data = await fs.readFile(p)
  addRecent(p)
  return { path: p, name: path.basename(p), data: new Uint8Array(data) }
})

/** Save bytes. If `path` is given and `dialog` is false, write directly; otherwise show a save dialog. */
ipcMain.handle('file:save', async (e, { filePath, suggestedName, kind, data, askPath }) => {
  let target = filePath
  if (askPath || !target) {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showSaveDialog(win, {
      defaultPath: suggestedName,
      filters: [filters()[kind] || filters().docx],
    })
    if (res.canceled || !res.filePath) return null
    target = res.filePath
  }
  await fs.writeFile(target, Buffer.from(data))
  if (kind !== 'pdf') addRecent(target)
  return { path: target, name: path.basename(target) }
})

// Chromium paints the page margins (outside the root box) with the window's base colour,
// which is the brand teal (for a flash-free launch). Swap to white while printing.
async function onWhitePaper(e, fn) {
  const win = BrowserWindow.fromWebContents(e.sender)
  win?.setBackgroundColor('#ffffff')
  try { return await fn() } finally { win?.setBackgroundColor('#1ab3ac') }
}

ipcMain.handle('pdf:render', (e) => onWhitePaper(e, async () => {
  // Page size and margins come from the document's CSS @page rule (preferCSSPageSize).
  const buf = await e.sender.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    generateTaggedPDF: true,
    generateDocumentOutline: true,
  })
  return new Uint8Array(buf)
}))

// Colour "scope" (magnifier): a pixel-exact snapshot of this window to sample colours from.
ipcMain.handle('screen:capture', async (e) => {
  const img = await e.sender.capturePage()
  return new Uint8Array(img.toPNG())
})

ipcMain.handle('print', (e) => onWhitePaper(e, () => new Promise((resolve) => {
  e.sender.print({ silent: false, printBackground: true }, (success, reason) => resolve({ success, reason }))
})))

ipcMain.handle('win:state', (e, { title, dirty, filePath }) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  win.setTitle(title)
  if (isMac) {
    win.setDocumentEdited(!!dirty)
    win.setRepresentedFilename(filePath || '')
  }
})

ipcMain.handle('win:new', (_e, openPath) => { createWindow(openPath || undefined) })

ipcMain.handle('win:close-now', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  closeApproved.add(win)
  win.close()
  if (quitting) setImmediate(() => app.quit())
})

// The user pressed "Cancel" in the unsaved-changes prompt: abort any pending quit.
ipcMain.handle('win:close-cancel', () => { quitting = false })

ipcMain.handle('dialog:unsaved', async (e, name) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  const res = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [t('save'), t('dontSave'), t('cancel')],
    defaultId: 0,
    cancelId: 2,
    message: t('unsavedMessage', { name }),
    detail: t('unsavedDetail'),
  })
  return ['save', 'discard', 'cancel'][res.response]
})

ipcMain.handle('dialog:error', async (e, message) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  await dialog.showMessageBox(win, { type: 'error', message: 'Grafi', detail: String(message) })
})

ipcMain.handle('app:lang', (_e, l) => applyLanguage(l))
ipcMain.handle('recent:list', () => readRecent().filter((p) => fsSync.existsSync(p)))
ipcMain.handle('shell:open', (_e, url) => { if (/^(https?|mailto):/i.test(url)) shell.openExternal(url) })
ipcMain.handle('shell:reveal', (_e, p) => shell.showItemInFolder(p))

// ───────────────────────── lifecycle ─────────────────────────
if (process.env.GRAFI_SELFTEST) require('./selftest.cjs')(process.env.GRAFI_SELFTEST)

function fileArgs(argv) {
  return argv.slice(app.isPackaged ? 1 : 2).filter((a) => OPENABLE.includes(path.extname(a).toLowerCase()) && fsSync.existsSync(a))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const files = fileArgs(argv)
    if (files.length) files.forEach((f) => createWindow(f))
    else {
      const w = focusedOrFirst()
      if (w) { if (w.isMinimized()) w.restore(); w.focus() } else createWindow()
    }
  })

  app.on('open-file', (e, p) => {
    e.preventDefault()
    if (app.isReady()) openInWindow(p)
    else pendingOpen.push(p)
  })

  app.whenReady().then(() => {
    if (!app.isPackaged && isMac) app.dock?.setIcon(DEV_ICON)
    // Local Font Access API → real list of installed fonts in the font picker.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
      cb(permission === 'local-fonts' || permission === 'clipboard-read' || permission === 'clipboard-sanitized-write')
    })
    session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
      permission === 'local-fonts' || permission === 'clipboard-read' || permission === 'clipboard-sanitized-write')
    setLang(readPrefs().lang || 'el')
    setSpellLangs(['el', 'en-US'])
    buildMenu()

    const files = [...pendingOpen, ...fileArgs(process.argv)]
    if (files.length) files.forEach((f) => createWindow(f))
    else createWindow()

    app.on('activate', () => { if (!windows.size) createWindow() })
  })

  app.on('before-quit', () => { quitting = true })
  app.on('window-all-closed', () => { if (!isMac || quitting) app.quit() })
}
