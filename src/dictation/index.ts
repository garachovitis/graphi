// Dictation controller: one session per window, shared by the ribbon button, the shortcut and the
// floating bar. The first use asks before downloading the model (DictationConsent); preferences persist locally.
import { useSyncExternalStore } from 'react'
import type { Editor } from '@tiptap/core'
import { getLang } from '../i18n'
import type { DictError, Session, Sink } from './engine'
import type { DictLang, RenderOpts } from './text'
import { MODELS, allowDownload, downloadMb, pickDtype, type Dtype, type ModelId } from './model'
import { insertDictation } from '../editor/Dictation'

export type { DictError }
export interface DictPrefs { lang: DictLang; autoPunct: boolean; model: ModelId }
export type Phase = 'idle' | 'consent' | 'starting' | 'download' | 'loading' | 'listening' | 'finishing'
export interface DictState {
  phase: Phase
  /** Download / load progress 0…1. */
  progress: number
  /** Transcribing speech already heard. */
  busy: boolean
  error: DictError | null
  /** Megabytes each model still needs, while asking for consent. */
  consentMb: Record<ModelId, number>
  help: boolean
}

const PREFS_KEY = 'grafi:dictation'
function readPrefs(): DictPrefs {
  const d: DictPrefs = { lang: getLang() === 'en' ? 'en' : 'el', autoPunct: true, model: 'lite' }
  try { return { ...d, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } } catch { return d }
}

let prefs = readPrefs()
let state: DictState = { phase: 'idle', progress: 0, busy: false, error: null, consentMb: { lite: 0, best: 0 }, help: false }
const listeners = new Set<() => void>()
const set = (p: Partial<DictState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

let session: Session | null = null
let abort: AbortController | null = null
let editor: Editor | null = null
let dtype: Dtype | null = null
let run = 0 // bumps on every start/stop so late callbacks from an old session are ignored

const opts = (): RenderOpts => ({ lang: prefs.lang, autoPunct: prefs.autoPunct })
export { MODELS }

// The caret's sound wave: the last few levels as CSS variables on the editor, read by the bars of
// the caret widget (editor/Dictation.ts). ~33 updates a second, so no React and no transaction.
const BARS = 5
const levels: number[] = Array(BARS).fill(0)
function showLevel(v: number) {
  levels.shift(); levels.push(v)
  const el = editor && !editor.isDestroyed ? editor.view.dom as HTMLElement : null
  levels.forEach((l, i) => el?.style.setProperty(`--dict-l${i}`, l.toFixed(2)))
}

function sinkFor(id: number): Sink {
  const live = () => id === run && !!editor && !editor.isDestroyed
  return {
    interim: (text) => { if (live()) editor!.commands.setDictationInterim(text, opts()) },
    final: (text) => {
      if (!live() || !text) return
      if (!insertDictation(editor!, text, opts())) void stop()
    },
    level: (v) => { if (id === run) showLevel(v) },
    progress: (phase, v) => { if (id === run && state.phase !== 'listening') set({ phase: phase === 'download' ? 'download' : 'loading', progress: v }) },
    busy: (b) => { if (id === run) set({ busy: b }) },
    error: (e) => { if (id === run) { set({ error: e }); void stop() } },
  }
}

async function begin(ed: Editor, mb: number) {
  const my = ++run
  editor = ed
  abort = new AbortController()
  set({ phase: 'starting', error: null, progress: 0, busy: false })
  ed.commands.setDictationActive(true)
  try {
    const { startSession } = await import('./engine')
    const s = await startSession({ model: MODELS[prefs.model], lang: prefs.lang, dtype: dtype!, downloadMb: mb, signal: abort.signal }, sinkFor(my))
    if (my !== run || state.error) { await s.stop(); return }
    session = s
    set({ phase: 'listening', progress: 1 })
  } catch {
    if (my === run) { set({ error: 'failed' }); void stop() }
  }
}

export const dictation = {
  get prefs() { return prefs },
  setPrefs(p: Partial<DictPrefs>) {
    const restart = state.phase === 'listening' && editor && (p.lang !== undefined && p.lang !== prefs.lang || p.model !== undefined && p.model !== prefs.model)
    prefs = { ...prefs, ...p }
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
    listeners.forEach((l) => l())
    if (restart) { const ed = editor!; void stop().then(() => dictation.start(ed)) }
  },
  async start(ed: Editor) {
    if (state.phase !== 'idle') return
    dtype = await pickDtype()
    if (!dtype || !navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode !== 'function') { set({ error: 'gpu' }); return }
    const mb = await downloadMb(MODELS[prefs.model], dtype)
    // The model is a large one-time download from a third party: ask first, every time it is missing,
    // and let the user pick the light or the accurate one.
    if (mb > 1) {
      editor = ed
      const [lite, best] = await Promise.all([downloadMb(MODELS.lite, dtype), downloadMb(MODELS.best, dtype)])
      set({ phase: 'consent', consentMb: { lite, best }, error: null })
      return
    }
    await begin(ed, mb)
  },
  /** The user agreed to download (or start with) this model. */
  async acceptDownload(model: ModelId) {
    if (state.phase !== 'consent' || !editor) return
    const mb = state.consentMb[model]
    dictation.setPrefs({ model })
    await allowDownload()
    set({ phase: 'idle' })
    void begin(editor, mb)
  },
  declineDownload() { if (state.phase === 'consent') { set({ phase: 'idle' }); editor?.commands.focus() } },
  toggle(ed: Editor) { return state.phase === 'idle' ? dictation.start(ed) : stop() },
  stop: () => stop(),
  dismissError: () => set({ error: null }),
  toggleHelp: (b?: boolean) => set({ help: b ?? !state.help }),
}

async function stop() {
  if (state.phase === 'consent') { set({ phase: 'idle' }); return }
  const s = session
  session = null
  abort?.abort()
  abort = null
  if (s) {
    // The last phrase may still be transcribing: let it land before cutting the session off.
    set({ phase: 'finishing' })
    try { await s.stop() } catch { /* already gone */ }
  }
  run++
  if (editor && !editor.isDestroyed) {
    editor.commands.setDictationInterim('', opts())
    editor.commands.setDictationActive(false)
  }
  set({ phase: 'idle', busy: false, progress: 0 })
}

export function useDictation(): DictState {
  return useSyncExternalStore(subscribe, () => state)
}
/** Re-render on preference changes too (menus show the current language). */
export function useDictPrefs(): DictPrefs {
  useSyncExternalStore(subscribe, () => prefs)
  return prefs
}
