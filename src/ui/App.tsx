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
import { Canvas } from './Canvas'
import { StatusBar } from './StatusBar'
import { Backstage, type BackstagePage } from './Backstage'
import { FindBar } from './FindBar'
import { Dialogs, type DialogState } from './dialogs'
import { Toasts, toast } from './toast'
import { TrainingCoach, lessonDoc } from './Training'
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
  spellcheck: boolean
  setSpellcheck: (b: boolean) => void
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

export function App() {
  // Re-render the whole UI when the display language changes.
  const lang = useLang()
  const [settings, setSettingsRaw] = useState<DocSettings>(blankSettings)
  const [file, setFile] = useState<FileInfo>(() => ({ path: null, name: t('app.docName', { n: String(untitled) }), kind: null }))
  const [dirty, setDirty] = useState(false)
  const [view, setView] = useState<'print' | 'web'>('print')
  const [zoom, setZoomRaw] = useState(1)
  const [showRuler, setShowRuler] = useState(true)
  const [showMarks, setShowMarks] = useState(false)
  const [spellcheck, setSpellcheck] = useState(true)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [find, setFind] = useState<null | 'find' | 'replace'>(null)
  const [backstage, setBackstage] = useState<BackstagePage | null>(null)
  const [painter, setPainter] = useState<PaintedFormat | null>(null)
  const [training, setTraining] = useState<string | null>(null)
  const [trainingRun, setTrainingRun] = useState(0)
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
      attributes: { class: 'doc-surface', spellcheck: 'true', 'aria-label': t('app.docAria') },
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
    editor?.view.dom.setAttribute('spellcheck', String(spellcheck))
  }, [editor, spellcheck])

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
    platform.setWindowState({ title: `${title} — Grafi`, dirty, filePath: file.path })
  }, [file, dirty, settings.title])

  // Manual zoom disables "fit page width" (the default on phones).
  const autoFit = useRef(window.innerWidth < 820)
  const setZoom = useCallback((z: number) => {
    autoFit.current = false
    setZoomRaw(Math.min(5, Math.max(0.1, Math.round(z * 100) / 100)))
  }, [])

  useEffect(() => {
    const fit = () => {
      if (window.innerWidth >= 820 || !autoFit.current) return
      const pageW = mmToPx(settings.width)
      setZoomRaw(Math.max(0.2, Math.floor(((window.innerWidth - 12) / pageW) * 100) / 100))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [settings.width])

  // ───────────── document lifecycle ─────────────
  const loadInto = useCallback((loaded: Loaded, info: FileInfo) => {
    if (!editor) return
    const s = normalizeSettings(loaded.settings)
    applyDesign(s.styleSet, s.theme)
    setPreview(null)
    setSettingsRaw(s)
    if (loaded.doc) editor.commands.setContent(loaded.doc, { emitUpdate: false })
    else editor.commands.setContent(loaded.html || '', { emitUpdate: false })
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
    } else {
      // Word opens a new window for a new document.
      if (tpl.id === 'blank') platform.newWindow()
      else start()
    }
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

  const beforeOutput = async () => {
    setBackstage(null)
    editor?.commands.clearSearch()
    requestRelayout()
    await new Promise((r) => setTimeout(r, 180))
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
    await beforeOutput()
    // The PDF's Title comes from document.title: the document's name, not the window's "● … — Grafi".
    const winTitle = document.title
    document.title = settings.title || baseName(file.name)
    const bytes = await platform.renderPdf(pageSpecRef.current()).finally(() => { document.title = winTitle })
    if (!bytes) { await platform.print(pageSpecRef.current()); return }
    const res = await platform.save({ suggestedName: `${baseName(file.name)}.pdf`, kind: 'pdf', data: bytes, askPath: true })
    if (res) toast(t('app.pdfExported', { name: res.name }))
  }, [file, settings.title])
  const exportPdfRef = useRef(exportPdf)
  exportPdfRef.current = exportPdf

  const print = useCallback(async () => {
    await beforeOutput()
    const r = await platform.print(pageSpecRef.current())
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
      case 'zoomIn': setZoomRaw((z) => ZOOMS.find((x) => x > z + 0.001) ?? z); break
      case 'zoomOut': setZoomRaw((z) => [...ZOOMS].reverse().find((x) => x < z - 0.001) ?? z); break
      case 'zoomReset': setZoomRaw(1); break
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
      case 'shortcuts': setDialog({ type: 'shortcuts' }); break
      case 'lang:el': setLang('el'); break
      case 'lang:en': setLang('en'); break
    }
  }, [editor, newFromTemplate, openFile, save, saveAs, exportPdf, print, pickImage])

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
    platform.closeNow()
  }), [])
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty
  const fileRef = useRef(file); fileRef.current = file

  // Browser build: keyboard shortcuts that Electron handles through the native menu.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') { setFind(null); setBackstage(null) }
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

  // Crash-safety: periodic local recovery snapshot.
  useEffect(() => {
    if (!editor) return
    const id = setInterval(() => {
      if (!dirtyRef.current) return
      try {
        localStorage.setItem('grafi:recovery', JSON.stringify({ at: Date.now(), name: fileRef.current.name, settings, content: editor.getJSON() }))
      } catch { /* quota / private mode */ }
    }, 30000)
    return () => clearInterval(id)
  }, [editor, settings])

  // Automation / testing handle (dev server, Electron self-test, on-device self-test).
  ;(window as any).__grafi = { editor, settings, setSettings: setSettingsRaw, layoutStore }

  // Placeholder & other decorations are computed per transaction: refresh them in the new language.
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta('i18n', lang))
    // Keep the untitled name in step while the document is still untouched.
    setFile((f) => (!f.path && !f.kind && tAll('app.docName').some((n) => f.name === n.replace('{n}', String(untitled))) ? { ...f, name: t('app.docName', { n: String(untitled) }) } : f))
  }, [lang, editor])

  if (!editor) return null

  const api: AppApi = {
    editor, settings, setSettings, previewDesign: setPreview, file, dirty, view, setView, zoom, setZoom, showRuler, setShowRuler, showMarks, setShowMarks,
    spellcheck, setSpellcheck, openDialog: setDialog, openFind: setFind, openBackstage: setBackstage, painter, startPainter, run,
    insertImageFiles, pickImage, newFromTemplate, openFile, openPath, save, saveAs, exportPdf, print, training, startTraining,
  }

  return (
    <div className={`app${painter ? ' painting' : ''}`}>
      <Ribbon api={api} />
      <div className="workspace">
        <Canvas api={api} />
        {find && <FindBar editor={editor} mode={find} setMode={setFind} onClose={() => { setFind(null); editor.commands.clearSearch(); editor.commands.focus() }} />}
      </div>
      <StatusBar api={api} />
      {backstage && <Backstage api={api} page={backstage} setPage={setBackstage} onClose={() => { setBackstage(null); editor.commands.focus() }} />}
      {training && <TrainingCoach key={`${training}-${trainingRun}`} api={api} lessonId={training} hidden={!!backstage} onClose={() => { setTraining(null); editor.commands.focus() }} />}
      <Dialogs api={api} dialog={dialog} close={() => { setDialog(null); editor.commands.focus() }} />
      <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp" multiple className="hidden-input"
        onChange={(e) => { if (e.target.files) insertImageFiles(e.target.files, pendingImagePos.current); e.target.value = '' }} />
      <Toasts />
    </div>
  )
}
