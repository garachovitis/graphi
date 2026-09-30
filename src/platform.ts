// Platform bridge. One UI, three hosts:
//   • Electron desktop (macOS / Windows / Linux) via the preload bridge,
//   • Capacitor mobile (iOS / Android) via native plugins,
//   • plain web / PWA (File System Access API where available, downloads otherwise).
import { Capacitor, registerPlugin } from '@capacitor/core'
import { t, type Key } from './i18n'

export interface OpenedFile { path: string | null; name: string; data: Uint8Array }
export interface SaveOpts { filePath?: string | null; suggestedName: string; kind: string; data: Uint8Array; askPath?: boolean }
export interface SavedFile { path: string | null; name: string }
export interface FetchedImage { data: Uint8Array; type: string }

interface NativeBridge {
  platform: string
  openDialog(): Promise<OpenedFile | null>
  readFile(p: string): Promise<OpenedFile>
  saveFile(o: SaveOpts): Promise<SavedFile | null>
  renderPdf(): Promise<Uint8Array>
  print(): Promise<{ success: boolean; reason?: string }>
  /** PNG snapshot of the window at device resolution (colour scope). */
  captureWindow?(): Promise<Uint8Array>
  setWindowState(s: { title: string; dirty: boolean; filePath: string | null }): Promise<void>
  newWindow(p?: string): Promise<void>
  closeNow(): Promise<void>
  cancelClose(): Promise<void>
  confirmUnsaved(name: string): Promise<'save' | 'discard' | 'cancel'>
  showError(m: string): Promise<void>
  recent(): Promise<string[]>
  openExternal(u: string): Promise<void>
  fetchImage(u: string): Promise<FetchedImage>
  reveal(p: string): Promise<void>
  onMenu(cb: (cmd: string) => void): () => void
  onFileOpened(cb: (f: OpenedFile) => void): () => void
  onOpenRequest(cb: (p: string) => void): () => void
  onRequestClose(cb: () => void): () => void
  /** UI language for the native menus and dialogs. */
  setLanguage?(lang: string): Promise<void>
}

const native: NativeBridge | undefined = (window as any).grafiNative

/** Page geometry handed to native printers (mm) plus header/footer templates. */
export interface PageSpec {
  name: string; width: number; height: number; top: number; right: number; bottom: number; left: number
  header: string; footer: string; headerAlign: string; footerAlign: string; differentFirstPage: boolean
  headerDistance: number; footerDistance: number
}

// ───────────── Capacitor (iOS / Android) ─────────────
export const isMobileApp = Capacitor.isNativePlatform()
const mobileOS = Capacitor.getPlatform() // 'ios' | 'android' | 'web'
type Rect = { x: number; y: number; w: number; h: number }
interface GrafiPrintPlugin {
  exportPdf(o: PageSpec & { rects?: Rect[] }): Promise<{ data: string; pages: number }>
  print(o: PageSpec & { rects?: Rect[] }): Promise<{ completed?: boolean }>
}
const GrafiPrint = registerPlugin<GrafiPrintPlugin>('GrafiPrint')

const b64 = (u8: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}
/**
 * iOS: WebKit's print formatter lays the page out at its own width and shrinks it (~86 %),
 * which leaves wide side margins. Instead every on-screen page sheet is captured as a vector
 * PDF (WKWebView.createPDF) and scaled natively to the exact paper size — identical to the
 * screen and to the desktop PDF. The capture mode unclips the scroller and hides the chrome.
 */
async function withPageRects<T>(page: PageSpec, run: (o: PageSpec & { rects: Rect[] }) => Promise<T>): Promise<T> {
  const root = document.documentElement
  const pm = document.querySelector('.ProseMirror') as HTMLElement | null
  const spell = pm?.getAttribute('spellcheck')
  ;(document.activeElement as HTMLElement | null)?.blur?.()
  window.getSelection()?.removeAllRanges()
  pm?.setAttribute('spellcheck', 'false')
  root.classList.add('pdf-capture')
  try {
    window.scrollTo(0, 0)
    await new Promise((r) => setTimeout(r, 120))
    const sheets = [...document.querySelectorAll('.page-sheet')] as HTMLElement[]
    const rects = document.querySelector('.layout-web') ? [] : sheets.map((el) => {
      const b = el.getBoundingClientRect()
      return { x: b.left + window.scrollX, y: b.top + window.scrollY, w: b.width, h: b.height }
    })
    return await run({ ...page, rects })
  } finally {
    root.classList.remove('pdf-capture')
    if (spell == null) pm?.removeAttribute('spellcheck'); else pm?.setAttribute('spellcheck', spell)
  }
}

const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function mobileSave(o: SaveOpts): Promise<SavedFile | null> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const inPlace = o.filePath?.startsWith('cap:') && !o.askPath
  const name = inPlace ? o.filePath!.slice(4) : o.suggestedName
  const res = await Filesystem.writeFile({ path: name, data: b64(o.data), directory: Directory.Documents, recursive: true })
  if (!inPlace) {
    // "Save as / Export": let the user put it anywhere (Files, Drive, mail…).
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share({ title: name, files: [res.uri], dialogTitle: t('plat.share') })
    } catch { /* user dismissed the sheet — the file is still in Documents */ }
  }
  return { path: `cap:${name}`, name }
}

export const isNative = !!native
export const isMac = native ? native.platform === 'darwin' : /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl+'

const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  pdf: 'application/pdf',
  html: 'text/html',
  md: 'text/markdown',
  txt: 'text/plain',
  grafi: 'application/json',
}

// ───────────── Web: File System Access API (Chrome / Edge) → real open & save-in-place ─────────────
const fsa = typeof window !== 'undefined' && 'showSaveFilePicker' in window
const handles = new Map<string, any>()
let handleSeq = 0
const keepHandle = (h: any) => { const id = `fsa:${++handleSeq}:${h.name}`; handles.set(id, h); return id }
// Descriptions are either an i18n key (translated when the picker opens) or a fixed name.
const PICKER_TYPES: Record<string, { description: Key | string; accept: Record<string, string[]> }> = {
  docx: { description: 'plat.docx', accept: { 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'] } },
  odt: { description: 'plat.odt', accept: { 'application/vnd.oasis.opendocument.text': ['.odt'] } },
  grafi: { description: 'plat.grafi', accept: { 'application/json': ['.grafi'] } },
  pdf: { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } },
  html: { description: 'HTML', accept: { 'text/html': ['.html'] } },
  md: { description: 'Markdown', accept: { 'text/markdown': ['.md'] } },
  txt: { description: 'plat.txt', accept: { 'text/plain': ['.txt'] } },
}
const pickerType = (kind: string) => {
  const p = PICKER_TYPES[kind]
  return p && { ...p, description: p.description.startsWith('plat.') ? t(p.description as Key) : p.description }
}

async function fsaOpen(): Promise<OpenedFile | null> {
  try {
    const [h] = await (window as any).showOpenFilePicker({
      types: [{ description: t('plat.docs'), accept: { 'application/octet-stream': ['.docx', '.odt', '.grafi', '.worder', '.html', '.htm', '.txt', '.md'] } }],
    })
    const f: File = await h.getFile()
    return { path: keepHandle(h), name: f.name, data: new Uint8Array(await f.arrayBuffer()) }
  } catch { return null }
}

async function fsaSave(o: SaveOpts): Promise<SavedFile | null> {
  let h = o.filePath && !o.askPath ? handles.get(o.filePath) : null
  let path = o.filePath || null
  if (!h) {
    try {
      h = await (window as any).showSaveFilePicker({ suggestedName: o.suggestedName, types: PICKER_TYPES[o.kind] ? [pickerType(o.kind)] : undefined })
    } catch { return null }
    path = keepHandle(h)
  }
  const w = await h.createWritable()
  await w.write(o.data)
  await w.close()
  return { path, name: h.name }
}

/** Files handed to an installed PWA by the OS ("Open with Graphi"). */
export function onLaunchFiles(cb: (f: OpenedFile) => void) {
  const lq = (window as any).launchQueue
  if (!lq) return
  lq.setConsumer(async (params: any) => {
    for (const h of params.files || []) {
      const f: File = await h.getFile()
      cb({ path: keepHandle(h), name: f.name, data: new Uint8Array(await f.arrayBuffer()) })
    }
  })
}

/** Can `save()` write back to this path without asking? */
export const canSaveInPlace = (path: string | null) => !!path && (isNative || handles.has(path) || path.startsWith('cap:'))

function browserOpen(): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.docx,.odt,.grafi,.worder,.html,.htm,.txt,.md'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return resolve(null)
      resolve({ path: null, name: f.name, data: new Uint8Array(await f.arrayBuffer()) })
    }
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

function browserDownload(o: SaveOpts): SavedFile {
  const blob = new Blob([o.data as BlobPart], { type: MIME[o.kind] || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = o.suggestedName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return { path: null, name: o.suggestedName }
}

export const platform = {
  open: (): Promise<OpenedFile | null> => (native ? native.openDialog() : fsa ? fsaOpen() : browserOpen()),
  read: (p: string) => native!.readFile(p),
  save: async (o: SaveOpts): Promise<SavedFile | null> =>
    native ? native.saveFile(o) : isMobileApp ? mobileSave(o) : fsa ? fsaSave(o) : browserDownload(o),
  /** PDF bytes (desktop, iOS), or null where the system print dialog provides "Save as PDF". */
  renderPdf: async (page: PageSpec): Promise<Uint8Array | null> => {
    if (native) return native.renderPdf()
    if (isMobileApp && mobileOS === 'ios') return unb64((await withPageRects(page, (o) => GrafiPrint.exportPdf(o))).data)
    return null
  },
  print: async (page: PageSpec): Promise<{ success: boolean; reason?: string }> => {
    if (native) return native.print()
    if (isMobileApp) {
      try { await (mobileOS === 'ios' ? withPageRects(page, (o) => GrafiPrint.print(o)) : GrafiPrint.print(page)); return { success: true } } catch (e: any) { return { success: false, reason: e?.message } }
    }
    window.print()
    return { success: true }
  },
  /** A snapshot of the app window for the colour scope, or null where none can be taken. */
  canCaptureWindow: () => !!native?.captureWindow || (!isMobileApp && !!navigator.mediaDevices?.getDisplayMedia),
  captureWindow: async (): Promise<ImageBitmap | null> => {
    if (native?.captureWindow) return createImageBitmap(new Blob([new Uint8Array(await native.captureWindow())], { type: 'image/png' }))
    if (isMobileApp || !navigator.mediaDevices?.getDisplayMedia) return null
    // Browsers: one frame of this tab (the browser asks the user to allow it).
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'browser' }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include',
    } as DisplayMediaStreamOptions)
    try {
      const video = document.createElement('video')
      video.muted = true
      video.srcObject = stream
      await video.play()
      // Let the permission prompt and the "sharing" bar get out of the way.
      await new Promise((r) => setTimeout(r, 350))
      return await createImageBitmap(video)
    } finally {
      stream.getTracks().forEach((tr) => tr.stop())
    }
  },
  setWindowState: (s: { title: string; dirty: boolean; filePath: string | null }) => {
    document.title = `${s.dirty ? '● ' : ''}${s.title}`
    return native?.setWindowState(s)
  },
  newWindow: (p?: string) => (native ? native.newWindow(p) : window.open(location.href, '_blank')),
  closeNow: () => native?.closeNow(),
  cancelClose: () => native?.cancelClose(),
  confirmUnsaved: async (name: string): Promise<'save' | 'discard' | 'cancel'> => {
    if (native) return native.confirmUnsaved(name)
    return window.confirm(t('plat.confirmDiscard', { name })) ? 'discard' : 'cancel'
  },
  error: async (m: string) => (native ? native.showError(m) : alert(m)),
  recent: async (): Promise<string[]> => (native ? native.recent() : []),
  openExternal: (u: string) => (native ? native.openExternal(u) : window.open(u, '_blank', 'noopener')),
  /**
   * Insert ▸ Pictures ▸ From a URL — the one place Graphi goes online, and only for an address the
   * user typed. On desktop the main process downloads it (the renderer has no network at all).
   */
  fetchImage: async (u: string): Promise<FetchedImage> => {
    if (native) return native.fetchImage(u)
    if (!/^https?:\/\//i.test(u)) throw new Error(t('dlg.notImage'))
    const res = await fetch(u, { credentials: 'omit', referrerPolicy: 'no-referrer' })
    if (!res.ok) throw new Error(String(res.status))
    const blob = await res.blob()
    return { data: new Uint8Array(await blob.arrayBuffer()), type: blob.type }
  },
  reveal: (p: string) => native?.reveal(p),
  onMenu: (cb: (cmd: string) => void) => native?.onMenu(cb) ?? (() => {}),
  onFileOpened: (cb: (f: OpenedFile) => void) => native?.onFileOpened(cb) ?? (() => {}),
  onOpenRequest: (cb: (p: string) => void) => native?.onOpenRequest(cb) ?? (() => {}),
  onRequestClose: (cb: () => void) => native?.onRequestClose(cb) ?? (() => {}),
}
