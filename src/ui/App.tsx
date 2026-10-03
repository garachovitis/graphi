// Application shell: document state, file operations, commands, layout.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useEditor } from '@tiptap/react'
import { EditorState } from '@tiptap/pm/state'
import type { Editor, JSONContent } from '@tiptap/core'
import { editorExtensions } from '../editor/extensions'
import { paginationConfig, requestRelayout } from '../editor/Pagination'
import { layoutStore } from '../editor/layoutStore'
import { DEFAULT_SETTINGS, mmToPx, normalizeSettings, type DocSettings } from '../model/settings'
import { applyDesign } from '../model/styles'
import { userDefaultDesign, type DocTheme } from '../model/themes'
import { pageCss, printCss, surfaceCss } from '../model/docCss'
import { TEMPLATES } from '../model/templates'
import { baseName, kindOf, type Kind } from '../io/kinds'
import type { Loaded } from '../io/formats'
import type { JSONContent as JC } from '@tiptap/core'
import type { DocSettings as DS } from '../model/settings'

// Converters (docx, jszip, marked…) are loaded on first use to keep start-up fast.
const io = () => import('../io/formats')
const loadFile = async (name: string, data: Uint8Array) => (await io()).loadFile(name, data)
const serialize = async (kind: Kind, doc: JC, s: DS, pages: Map<number, number>) => (await io()).serialize(kind, doc, s, pages)
import { blobToDataUrl, loadImage } from '../io/images'
import { canSaveInPlace, isNative, onLaunchFiles, platform, type PageSpec } from '../platform'
import { captureFormat, applyFormat, type PaintedFormat } from '../editor/format'
import { Ribbon } from './Ribbon'
import { Canvas, isReflow } from './Canvas'
import { StatusBar } from './StatusBar'
import { Backstage, type BackstagePage } from './Backstage'
import { FindBar } from './FindBar'
import { ProofPanel, ProofPopover } from './ProofPanel'
import { proofConfig, setProofConfig, setProofPanelOpen } from '../editor/Proofing'
import { Dialogs, type DialogState } from './dialogs'
import { Toasts, toast } from './toast'
import { TrainingCoach, lessonDoc } from './Training'
import { WelcomeDialog } from './WelcomeDialog'
import { t, tAll, fmtDate, setLang, useLang } from '../i18n'

export interface DesignPreview { theme?: DocTheme; styleSet?: string }

/** A blank document in the user's default design (Design ▸ Set as Default). */
export function blankSettings(): DocSettings {
  const d = userDefaultDesign()
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...(d ? { theme: d.theme, styleSet: d.styleSet } : {}) })
}

export interface FileInfo { path: string | null; name: string; kind: Kind | null }

export interface AppApi {
  editor: Editor
  settings: DocSettings
  setSettings: (s: DocSettings) => void
  /** Live preview of a theme / style set while the pointer rests on a gallery item (null ends it). */
  previewDesign: (p: DesignPreview | null) => void
  file: FileInfo
  dirty: boolean
  view: 'print' | 'web'
  setView: (v: 'print' | 'web') => void
  zoom: number
  setZoom: (z: number) => void
  showRuler: boolean
  setShowRuler: (b: boolean) => void
  showMarks: boolean
  setShowMarks: (b: boolean) => void
  /** proofing underlines as you type */
  spellcheck: boolean
  setSpellcheck: (b: boolean) => void
  /** proofing side panel (Review ▸ Spelling & Grammar, F7) */
  proofOpen: boolean
  setProofOpen: (b: boolean) => void
  openDialog: (d: DialogState) => void
  openFind: (mode: 'find' | 'replace') => void
  openBackstage: (p: BackstagePage) => void
  painter: PaintedFormat | null
  startPainter: () => void
  run: (cmd: string) => void
  insertImageFiles: (files: File[] | FileList, pos?: number) => void
  pickImage: () => void
  newFromTemplate: (id: string) => void
  openFile: () => void
  openPath: (p: string) => void
  save: () => Promise<boolean>
  saveAs: (kind: Kind) => Promise<boolean>
  exportPdf: () => void
  print: () => void
  /** File ▸ Training lesson is running */
  training: string | null
  startTraining: (lessonId?: string) => void
}

const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
const GAP = 20

function resetHistory(editor: Editor) {
  // A fresh EditorState with the same doc & plugins clears undo history (e.g. after opening a file).
  const s = editor.state
  editor.view.updateState(EditorState.create({ doc: s.doc, plugins: s.plugins, selection: s.selection }))
}

let untitled = 1

// Recovery snapshots: one key per window/tab. A live window with unsaved changes refreshes its
// snapshot every RECOVERY_EVERY ms, so an older one belongs to a session that is gone.
const RECOVERY_PREFIX = 'grafi:recovery:'
const RECOVERY_KEY = RECOVERY_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
const RECOVERY_EVERY = 30000
const dropRecovery = (key: string) => { try { localStorage.removeItem(key) } catch { /* private mode */ } }
const WELCOME_KEY = 'grafi:welcome:v1'

function isFirstOpen() {
  try { return localStorage.getItem(WELCOME_KEY) !== 'seen' } catch { return true }
}

interface Recovery { at: number; name: string; settings: DocSettings; content: JSONContent }
function takeAbandonedRecovery(): Recovery | null {
  let best: Recovery | null = null
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(RECOVERY_PREFIX) || k === 'grafi:recovery')
    for (const k of keys) {
      if (k === RECOVERY_KEY) continue
      let r: Recovery | null = null
      try { r = JSON.parse(localStorage.getItem(k) || 'null') } catch { /* corrupt */ }
      if (r && Date.now() - r.at < RECOVERY_EVERY * 2) continue // another open window
      localStorage.removeItem(k)
      if (r?.content && (!best || r.at > best.at)) best = r
    }
  } catch { /* storage unavailable */ }
  return best
}

export function App() {
  // Re-render the whole UI when the display language changes.
  const lang = useLang()
  const [settings, setSettingsRaw] = useState<DocSettings>(blankSettings)
  const [file, setFile] = useState<FileInfo>(() => ({ path: null, name: t('app.docName', { n: String(untitled) }), kind: null }))
  const [dirty, setDirty] = useState(false)
  // Phones open in the reflowing mobile view; tablets and desktops in print layout.
  const [view, setView] = useState<'print' | 'web'>(() => (window.matchMedia('(max-width: 599px)').matches ? 'web' : 'print'))
  const viewRef = useRef(view)
  viewRef.current = view
  const [zoom, setZoomRaw] = useState(1)
  const [showRuler, setShowRuler] = useState(false)
  const [showMarks, setShowMarks] = useState(false)
  const [spellcheck, setSpellcheckRaw] = useState(() => proofConfig().live)
  const setSpellcheck = useCallback((b: boolean) => { setProofConfig({ live: b }); setSpellcheckRaw(b) }, [])
  const [proofOpen, setProofOpen] = useState(false)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [find, setFind] = useState<null | 'find' | 'replace'>(null)
  const [backstage, setBackstage] = useState<BackstagePage | null>(null)
  const [painter, setPainter] = useState<PaintedFormat | null>(null)
  const [training, setTraining] = useState<string | null>(null)
  const [trainingRun, setTrainingRun] = useState(0)
  const [showWelcome, setShowWelcome] = useState(isFirstOpen)
  const [, force] = useReducer((x: number) => x + 1, 0)
  const pristine = useRef(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const pendingImagePos = useRef<number | undefined>(undefined)

  const [preview, setPreview] = useState<DesignPreview | null>(null)
  const setSettings = useCallback((s: DocSettings) => {
    setPreview(null)
    setSettingsRaw(s)
    setDirty(true)
    pristine.current = false
  }, [])

  // Design (style set + theme) must be applied before children render the gallery / CSS.
  // A gallery hover previews a design without committing it (Word's live preview).
  const designSet = preview?.styleSet ?? settings.styleSet
  const designTheme = preview?.theme ?? settings.theme
  useMemo(() => applyDesign(designSet, designTheme), [designSet, designTheme])

  const insertImageFilesRef = useRef<(files: File[] | FileList, pos?: number) => void>(() => {})

  const editor = useEditor({
    extensions: editorExtensions(),
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    // Touch devices: don't pop the on-screen keyboard until the user taps the page.
    autofocus: window.matchMedia('(pointer: coarse)').matches ? false : 'start',
    editorProps: {
      attributes: { class: 'doc-surface', spellcheck: 'false', 'aria-label': t('app.docAria') },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'))
        // Prefer rich HTML (e.g. from Word) when present; images alone → insert as pictures.
        if (files.length && !event.clipboardData?.getData('text/html')) {
          insertImageFilesRef.current(files)
          return true
        }
        return false
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false
        const files = [...(event.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'))
        if (!files.length) return false
        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
        insertImageFilesRef.current(files, pos)
        return true
      },
    },
    onUpdate: () => {
      setDirty(true)
      pristine.current = false
    },
  })

  // Re-render the chrome on every transaction (active states), batched per frame.
  useEffect(() => {
    if (!editor) return
    let t = 0
    const h = () => { if (!t) t = window.setTimeout(() => { t = 0; force() }, 16) }
    editor.on('transaction', h)
    const unsub = layoutStore.subscribe(h)
    return () => { editor.off('transaction', h); unsub(); clearTimeout(t) }
  }, [editor])

  useEffect(() => {
    // Lets CSS leave room for the OS window controls drawn over our title bar.
    const p = (window as any).grafiNative?.platform
    if (p) document.documentElement.dataset.platform = p
  }, [])

  useEffect(() => {
    // Graphi's own checker (editor/Proofing.ts) replaces the browser's: one set of underlines, same on every platform.
    editor?.view.dom.setAttribute('spellcheck', 'false')
  }, [editor])

  useEffect(() => { setProofPanelOpen(proofOpen) }, [proofOpen])

  // Document CSS + pagination geometry.
  useEffect(() => {
    let el = document.getElementById('doc-css') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'doc-css'
      document.head.appendChild(el)
    }
    el.textContent = `${surfaceCss({ headingNumbers: settings.headingNumbers })}\n${pageCss(settings)}\n${printCss(view === 'print')}`
    const pageH = mmToPx(settings.height)
    layoutStore.setNumbering(settings.headingNumbers)
    paginationConfig.enabled = view === 'print'
    paginationConfig.pitch = pageH + GAP
    // 1px safety so Chromium's print engine never breaks earlier than we do.
    paginationConfig.contentHeight = mmToPx(settings.height - settings.margins.top - settings.margins.bottom) - 1
    requestRelayout()
  }, [settings, view, lang, designSet, designTheme])

  useEffect(() => {
    paginationConfig.scale = zoom
    requestRelayout()
  }, [zoom])

  useEffect(() => {
    const title = `${file.name}${settings.title && settings.title !== file.name ? ` — ${settings.title}` : ''}`
    platform.setWindowState({ title: `${title} — Graphi`, dirty, filePath: file.path })
  }, [file, dirty, settings.title])

  // Manual zoom disables "fit page width" (the default on phones).
  const autoFit = useRef(true)
  const setZoom = useCallback((z: number) => {
    autoFit.current = false
    setZoomRaw(Math.min(5, Math.max(0.1, Math.round(z * 100) / 100)))
  }, [])

  useEffect(() => {
    const fit = () => {
      if (!autoFit.current) return
      if (window.innerWidth >= 820 || isReflow(view)) { setZoomRaw(1); return }
      const pageW = mmToPx(settings.width)
      setZoomRaw(Math.max(0.2, Math.floor(((window.innerWidth - 12) / pageW) * 100) / 100))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [settings.width, view])

  // ───────────── document lifecycle ─────────────
  const loadInto = useCallback((loaded: Loaded, info: FileInfo) => {
    if (!editor) return
    const s = normalizeSettings(loaded.settings)
    applyDesign(s.styleSet, s.theme)
    setPreview(null)
    setSettingsRaw(s)
    if (loaded.doc) editor.commands.setContent(loaded.doc, { emitUpdate: false })
    else editor.commands.setContent(loaded.html || '', { emitUpdate: false, parseOptions: loaded.preserveWhitespace ? { preserveWhitespace: true } : undefined })
    resetHistory(editor)
    if (!window.matchMedia('(pointer: coarse)').matches) editor.commands.focus('start')
    setFile(info)
    setDirty(false)
    pristine.current = false
    setBackstage(null)
    setTraining(null)
    for (const w of loaded.warnings) toast(w, 'warn')
  }, [editor])

  const openBytes = useCallback(async (name: string, data: Uint8Array, path: string | null) => {
    try {
      const loaded = await loadFile(name, data)
      const kind = kindOf(name)
      loadInto(loaded, { path: kind === 'pdf' ? null : path, name, kind })
    } catch (e: any) {
      platform.error(`${t('app.openFailed', { name })}\n\n${e?.message || e}`)
    }
  }, [loadInto])

  const isPristine = () => pristine.current && !dirty && !file.path

  const openFile = useCallback(async () => {
    const f = await platform.open()
    if (!f) return
    if (!isPristine() && isNative && f.path) return platform.newWindow(f.path)
    if (!isPristine() && !isNative && dirty) {
      const ans = await platform.confirmUnsaved(file.name)
      if (ans === 'cancel') return
    }
    openBytes(f.name, f.data, f.path)
  }, [openBytes, dirty, file])

  const openPath = useCallback(async (p: string) => {
    if (!isPristine()) return platform.newWindow(p)
    const f = await platform.read(p)
    openBytes(f.name, f.data, f.path)
  }, [openBytes, dirty, file])

  const newFromTemplate = useCallback((id: string) => {
    if (!editor) return
    const tpl = TEMPLATES.find((t) => t.id === id) || TEMPLATES[0]
    const start = () => {
      untitled++
      // Templates without a theme get the one their style set was designed with.
      const s = tpl.id === 'blank' ? blankSettings() : normalizeSettings({ ...DEFAULT_SETTINGS, theme: undefined, ...(tpl.settings || {}) } as Partial<DocSettings>)
      loadInto({ doc: tpl.doc(), settings: s, warnings: [] }, { path: null, name: t('app.docName', { n: String(untitled) }), kind: null })
      pristine.current = tpl.id === 'blank'
    }
    if (isPristine() || !isNative) {
      if (!isPristine() && dirty) {
        platform.confirmUnsaved(file.name).then((a) => { if (a !== 'cancel') start() })
        return
      }
      start()
    } else if (tpl.id === 'blank') {
      // Word opens a new window for a new document.
      platform.newWindow()
    } else if (dirty) {
      platform.confirmUnsaved(file.name).then(async (a) => {
        if (a === 'cancel') return
        if (a === 'save' && !(await saveRef.current())) return
        start()
      })
    } else start()
  }, [editor, loadInto, dirty, file])

  const startTraining = useCallback(async (lessonId = 'l1') => {
    if (!editor) return
    // Restarting the lesson itself never needs a "discard changes?" question.
    const isLesson = tAll('app.trainingName').includes(file.name) && !file.path
    if (dirty && !isPristine() && !isLesson) {
      const a = await platform.confirmUnsaved(file.name)
      if (a === 'cancel') return
      if (a === 'save' && !(await saveRef.current())) return
    }
    loadInto({ doc: lessonDoc(lessonId), settings: normalizeSettings({ ...DEFAULT_SETTINGS }), warnings: [] }, { path: null, name: t('app.trainingName'), kind: null })
    setTraining(lessonId)
    setTrainingRun((n) => n + 1) // restarting the same level starts its coach afresh
  }, [editor, loadInto, dirty, file])

  const currentJson = (): JSONContent => editor!.getJSON()

  const saveAs = useCallback(async (kind: Kind): Promise<boolean> => {
    if (!editor) return false
    if (kind === 'pdf') { exportPdfRef.current(); return false }
    try {
      const data = await serialize(kind, currentJson(), settings, layoutStore.headingPages)
      const res = await platform.save({ suggestedName: `${baseName(file.name)}.${kind}`, kind, data, askPath: true })
      if (!res) return false
      setFile({ path: res.path, name: res.name, kind })
      setDirty(false)
      setBackstage(null)
      toast(t('app.saved', { name: res.name }))
      if (kind === 'txt' || kind === 'md' || kind === 'html') toast(t('app.lossy'), 'warn')
      return true
    } catch (e: any) {
      platform.error(`${t('app.saveFailed')}\n\n${e?.message || e}`)
      return false
    }
  }, [editor, settings, file])

  const save = useCallback(async (): Promise<boolean> => {
    if (!editor) return false
    if (!file.kind || !canSaveInPlace(file.path)) return saveAs(file.kind && file.kind !== 'pdf' ? file.kind : 'docx')
    try {
      const data = await serialize(file.kind, currentJson(), settings, layoutStore.headingPages)
      await platform.save({ filePath: file.path, suggestedName: file.name, kind: file.kind, data })
      setDirty(false)
      toast(t('app.saved', { name: file.name }))
      return true
    } catch (e: any) {
      platform.error(`${t('app.saveFailed')}\n\n${e?.message || e}`)
      return false
    }
  }, [editor, settings, file, saveAs])

  /** Prepares the canvas for print / PDF; the returned function restores the mobile view. */
  const beforeOutput = async () => {
    setBackstage(null)
    editor?.commands.clearSearch()
    const back = isReflow(viewRef.current) ? viewRef.current : null
    if (back) setView('print') // paper output always comes from the paginated pages
    requestRelayout()
    await new Promise((r) => setTimeout(r, back ? 500 : 180))
    return () => { if (back) setView(back) }
  }

  const pageSpec = (): PageSpec => {
    const hf = settings.hf
    const fill = (s: string) => s.replaceAll('{title}', settings.title || '').replaceAll('{date}', fmtDate())
    return {
      name: baseName(file.name), width: settings.width, height: settings.height, ...settings.margins,
      header: fill(hf.headerText), footer: fill(hf.footerText), headerAlign: hf.headerAlign, footerAlign: hf.footerAlign,
      differentFirstPage: hf.differentFirstPage, headerDistance: hf.headerDistance, footerDistance: hf.footerDistance,
    }
  }
  const pageSpecRef = useRef(pageSpec)
  pageSpecRef.current = pageSpec

  const exportPdf = useCallback(async () => {
    const restore = await beforeOutput()
    // The PDF's Title comes from document.title: the document's name, not the window's "● … — Graphi".
    const winTitle = document.title
    document.title = settings.title || baseName(file.name)
    const bytes = await platform.renderPdf(pageSpecRef.current()).finally(() => { document.title = winTitle })
    if (!bytes) { await platform.print(pageSpecRef.current()).finally(restore); return }
    restore()
    const res = await platform.save({ suggestedName: `${baseName(file.name)}.pdf`, kind: 'pdf', data: bytes, askPath: true })
    if (res) toast(t('app.pdfExported', { name: res.name }))
  }, [file, settings.title])
  const exportPdfRef = useRef(exportPdf)
  exportPdfRef.current = exportPdf

  const print = useCallback(async () => {
    const restore = await beforeOutput()
    const r = await platform.print(pageSpecRef.current()).finally(restore)
    if (!r.success && r.reason && r.reason !== 'cancelled') toast(t('app.printFailed', { reason: r.reason }), 'warn')
  }, [])

  // ───────────── images ─────────────
  const insertImageFiles = useCallback(async (files: File[] | FileList, pos?: number) => {
    if (!editor) return
    const colW = mmToPx(settings.width - settings.margins.left - settings.margins.right)
    for (const f of [...files]) {
      if (!f.type.startsWith('image/')) continue
      if (f.size > 25 * 1024 * 1024) { toast(t('app.imageTooBig', { name: f.name }), 'warn'); continue }
      const src = await blobToDataUrl(f)
      let width: number | null = null
      let height: number | null = null
      try {
        const img = await loadImage(src)
        width = img.naturalWidth
        height = img.naturalHeight
        if (width > colW) { height = Math.round((height * colW) / width); width = Math.round(colW) }
      } catch { /* keep natural */ }
      const node = { type: 'image', attrs: { src, alt: f.name.replace(/\.[^.]+$/, ''), width, height, wrap: 'topBottom', align: 'center' } }
      const chain = editor.chain().focus()
      if (pos != null) chain.insertContentAt(pos, node).run()
      else chain.insertContent(node).run()
    }
  }, [editor, settings])
  insertImageFilesRef.current = insertImageFiles

  const pickImage = useCallback(() => {
    pendingImagePos.current = undefined
    fileInput.current?.click()
  }, [])

  // ───────────── format painter ─────────────
  const startPainter = useCallback(() => {
    if (!editor) return
    if (painter) { setPainter(null); return }
    setPainter(captureFormat(editor))
  }, [editor, painter])

  useEffect(() => {
    if (!editor || !painter) return
    const up = () => {
      setTimeout(() => {
        if (!editor.state.selection.empty) {
          applyFormat(editor, painter)
          setPainter(null)
        }
      }, 0)
    }
    editor.view.dom.addEventListener('mouseup', up)
    return () => editor.view.dom.removeEventListener('mouseup', up)
  }, [editor, painter])

  // ───────────── command router (menus, shortcuts, ribbon) ─────────────
  const run = useCallback((cmd: string) => {
    if (!editor) return
    const inField = () => {
      const a = document.activeElement as HTMLElement | null
      return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') && !a.closest('.ProseMirror')
    }
    const c = () => editor.chain().focus()
    switch (cmd) {
      case 'new': newFromTemplate('blank'); break
      case 'open': openFile(); break
      case 'save': save(); break
      case 'saveAs': setBackstage('saveas'); break
      case 'exportPdf': exportPdf(); break
      case 'exportDocx': saveAs('docx'); break
      case 'exportOdt': saveAs('odt'); break
      case 'exportHtml': saveAs('html'); break
      case 'exportMd': saveAs('md'); break
      case 'exportTxt': saveAs('txt'); break
      case 'print': print(); break
      case 'undo': if (inField()) document.execCommand('undo'); else c().undo().run(); break
      case 'redo': if (inField()) document.execCommand('redo'); else c().redo().run(); break
      case 'find': setFind('find'); break
      case 'replace': setFind('replace'); break
      case 'viewPrint': setView('print'); break
      case 'viewWeb': setView('web'); break
      case 'toggleRuler': setShowRuler((x) => !x); break
      case 'toggleMarks': setShowMarks((x) => !x); break
      case 'zoomIn': autoFit.current = false; setZoomRaw((z) => ZOOMS.find((x) => x > z + 0.001) ?? z); break
      case 'zoomOut': autoFit.current = false; setZoomRaw((z) => [...ZOOMS].reverse().find((x) => x < z - 0.001) ?? z); break
      case 'zoomReset': setZoom(1); break
      case 'pageBreak': c().setPageBreak().run(); break
      case 'tableDialog': setDialog({ type: 'table' }); break
      case 'image': pickImage(); break
      case 'link': setDialog({ type: 'link' }); break
      case 'symbol': setDialog({ type: 'symbol' }); break
      case 'toc': c().insertTableOfContents().run(); break
      case 'headerFooter': setDialog({ type: 'headerFooter' }); break
      case 'fontDialog': setDialog({ type: 'font' }); break
      case 'paragraphDialog': setDialog({ type: 'paragraph' }); break
      case 'pageSetup': setDialog({ type: 'pageSetup' }); break
      case 'wordCount': setDialog({ type: 'wordCount' }); break
      case 'proofing': setProofOpen((o) => !o); break
      case 'shortcuts': setDialog({ type: 'shortcuts' }); break
      case 'lang:el': setLang('el'); break
      case 'lang:en': setLang('en'); break
    }
  }, [editor, newFromTemplate, openFile, save, saveAs, exportPdf, print, pickImage, setZoom])

  const runRef = useRef(run)
  runRef.current = run

  // Native menu → commands; OS "open file" events; close confirmation.
  useEffect(() => {
    const offs = [
      platform.onMenu((cmd) => runRef.current(cmd)),
      platform.onFileOpened((f) => openBytes(f.name, f.data, f.path)),
      platform.onOpenRequest((p) => openPath(p)),
    ]
    onLaunchFiles((f) => openBytes(f.name, f.data, f.path))
    return () => offs.forEach((o) => o())
  }, [openBytes, openPath])

  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => platform.onRequestClose(async () => {
    if (!dirtyRef.current) return platform.closeNow()
    const ans = await platform.confirmUnsaved(fileRef.current.name)
    if (ans === 'cancel') return platform.cancelClose()
    if (ans === 'save' && !(await saveRef.current())) return platform.cancelClose()
    dropRecovery(RECOVERY_KEY)
    platform.closeNow()
  }), [])
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty
  const fileRef = useRef(file); fileRef.current = file

  // Browser build: keyboard shortcuts that Electron handles through the native menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') { setFind(null); setBackstage(null) }
      // F7 = Spelling & Grammar, as in Word (Electron's menu owns it on desktop)
      if (e.key === 'F7' && !isNative && !mod) { e.preventDefault(); runRef.current('proofing') }
      if (!mod) return
      const k = e.key.toLowerCase()
      const map: Record<string, string> = isNative
        ? {}
        : { s: e.shiftKey ? 'saveAs' : 'save', o: 'open', p: 'print', f: 'find', h: 'replace', k: 'link', d: 'fontDialog' }
      if (!isNative && e.shiftKey && k === 'e') map.e = 'exportPdf'
      const cmd = map[k]
      if (cmd) { e.preventDefault(); runRef.current(cmd) }
    }
    const warn = (e: BeforeUnloadEvent) => { if (!isNative && dirtyRef.current) e.preventDefault() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', warn) }
  }, [])

  // Crash-safety: periodic local recovery snapshot while there are unsaved changes.
  useEffect(() => {
    if (!editor) return
    const id = setInterval(() => {
      if (!dirtyRef.current) return
      try {
        localStorage.setItem(RECOVERY_KEY, JSON.stringify({ at: Date.now(), name: fileRef.current.name, settings, content: editor.getJSON() }))
      } catch { /* quota / private mode */ }
    }, RECOVERY_EVERY)
    return () => clearInterval(id)
  }, [editor, settings])
  useEffect(() => { if (!dirty) dropRecovery(RECOVERY_KEY) }, [dirty])

  // Offer the snapshot of a session that ended with unsaved changes (crash, killed tab…).
  useEffect(() => {
    if (!editor) return
    const found = takeAbandonedRecovery()
    if (!found) return
    toast(t('app.recovered', { name: found.name }), 'warn', {
      label: t('app.restore'),
      run: () => {
        loadInto({ doc: found.content, settings: found.settings, warnings: [] }, { path: null, name: found.name, kind: null })
        setDirty(true)
      },
    }, 20000)
  }, [editor, loadInto])

  // Automation handle for the dev harness and the on-device self-test; not in release builds.
  if (import.meta.env.DEV || import.meta.env.VITE_GRAFI_SELFTEST) (window as any).__grafi = { editor, settings, setSettings: setSettingsRaw, layoutStore }

  // Placeholder & other decorations are computed per transaction: refresh them in the new language.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('i18n', lang))
    // Keep the untitled name in step while the document is still untouched.
    setFile((f) => (!f.path && !f.kind && tAll('app.docName').some((n) => f.name === n.replace('{n}', String(untitled))) ? { ...f, name: t('app.docName', { n: String(untitled) }) } : f))
  }, [lang, editor])

  if (!editor) return null

  const closeWelcome = () => {
    try { localStorage.setItem(WELCOME_KEY, 'seen') } catch { /* private mode */ }
    setShowWelcome(false)
  }

  const openTrainingFromWelcome = () => {
    closeWelcome()
    setBackstage('training')
  }

  const api: AppApi = {
    editor, settings, setSettings, previewDesign: setPreview, file, dirty, view, setView, zoom, setZoom, showRuler, setShowRuler, showMarks, setShowMarks,
    spellcheck, setSpellcheck, proofOpen, setProofOpen, openDialog: setDialog, openFind: setFind, openBackstage: setBackstage, painter, startPainter, run,
    insertImageFiles, pickImage, newFromTemplate, openFile, openPath, save, saveAs, exportPdf, print, training, startTraining,
  }

  return (
    <div className={`app${painter ? ' painting' : ''}`}>
      <Ribbon api={api} />
      <div className="workspace">
        <Canvas api={api} />
        {find && <FindBar editor={editor} mode={find} setMode={setFind} onClose={() => { setFind(null); editor.commands.clearSearch(); editor.commands.focus() }} />}
        {proofOpen && <ProofPanel api={api} onClose={() => { setProofOpen(false); editor.commands.focus() }} />}
      </div>
      <ProofPopover api={api} panelOpen={proofOpen} openPanel={() => setProofOpen(true)} />
      <StatusBar api={api} />
      {backstage && <Backstage api={api} page={backstage} setPage={setBackstage} onClose={() => { setBackstage(null); editor.commands.focus() }} />}
      {training && <TrainingCoach key={`${training}-${trainingRun}`} api={api} lessonId={training} hidden={!!backstage} onClose={() => { setTraining(null); editor.commands.focus() }} />}
      <Dialogs api={api} dialog={dialog} close={() => { setDialog(null); editor.commands.focus() }} />
      {showWelcome && <WelcomeDialog onTraining={openTrainingFromWelcome} onClose={closeWelcome} />}
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp" multiple className="hidden-input"
        onChange={(e) => { if (e.target.files) insertImageFiles(e.target.files, pendingImagePos.current); e.target.value = '' }} />
      <Toasts />
    </div>
  )
}
