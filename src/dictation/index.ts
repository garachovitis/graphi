// Dictation controller: one session per window, shared by the ribbon button, the phone toolbar and
// the floating dictation bar. Engines are picked per host (see ./engines); preferences persist locally.
import { useSyncExternalStore } from 'react'
import type { Editor } from '@tiptap/core'
import { getLang } from '../i18n'
import { availableEngines, engine, type DictError, type EngineId, type Session, type Sink } from './engines'
import type { DictLang, RenderOpts } from './text'
import { insertDictation } from '../editor/Dictation'

export type { DictError, EngineId }
export interface DictPrefs { lang: DictLang; engine: EngineId | null; autoPunct: boolean }
export type Phase = 'idle' | 'consent' | 'starting' | 'download' | 'loading' | 'listening' | 'finishing'
export interface DictState {
  phase: Phase
  engine: EngineId | null
  /** Download progress 0…1 while phase is 'download'. */
  progress: number
  /** Transcribing speech already heard (on-device engine). */
  busy: boolean
  error: DictError | null
  /** Megabytes the on-device model needs, while asking for consent. */
  consentMb: number
  help: boolean
}

const PREFS_KEY = 'grafi:dictation'
function readPrefs(): DictPrefs {
  const d: DictPrefs = { lang: getLang(), engine: null, autoPunct: true }
  try { return { ...d, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') } } catch { return d }
}

let prefs = readPrefs()
let state: DictState = { phase: 'idle', engine: null, progress: 0, busy: false, error: null, consentMb: 0, help: false }
const listeners = new Set<() => void>()
const levelListeners = new Set<(v: number) => void>()
const set = (p: Partial<DictState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()) }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

let session: Session | null = null
let editor: Editor | null = null
let run = 0 // bumps on every start/stop so late callbacks from an old session are ignored

/** Engine used for the next session: the user's choice if this host has it, else the best default. */
export const engines = () => availableEngines()
const pickEngine = (): EngineId | null => {
  const all = availableEngines()
  return prefs.engine && all.includes(prefs.engine) ? prefs.engine : all[0] ?? null
}

/** The engine the next session will use. */
export const currentEngine = () => pickEngine()

const opts = (): RenderOpts => ({ lang: prefs.lang, autoPunct: prefs.autoPunct })

function sinkFor(id: number): Sink {
  const live = () => id === run && !!editor && !editor.isDestroyed
  return {
    interim: (text) => { if (live()) editor!.commands.setDictationInterim(text, opts()) },
    final: (text) => {
      if (!live() || !text) return
      if (!insertDictation(editor!, text, opts())) void stop()
    },
    level: (v) => { if (id === run) levelListeners.forEach((l) => l(v)) },
    progress: (phase, v) => { if (id === run) set({ phase: phase === 'download' ? 'download' : 'loading', progress: v }) },
    busy: (b) => { if (id === run) set({ busy: b }) },
    error: (e) => { if (id === run) { set({ error: e }); void stop() } },
  }
}

async function begin(ed: Editor, id: EngineId) {
  const my = ++run
  editor = ed
  set({ phase: 'starting', engine: id, error: null, progress: 0, busy: false })
  try {
    const s = await engine(id).start({ lang: prefs.lang, autoPunct: prefs.autoPunct }, sinkFor(my))
    if (my !== run || state.error) { await s.stop(); return }
    session = s
    set({ phase: 'listening' })
  } catch {
    if (my === run) set({ phase: 'idle', error: 'failed' })
  }
}

export const dictation = {
  get prefs() { return prefs },
  setPrefs(p: Partial<DictPrefs>) {
    const restart = state.phase === 'listening' && editor && (p.lang !== undefined && p.lang !== prefs.lang || p.engine !== undefined && p.engine !== prefs.engine)
    prefs = { ...prefs, ...p }
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode */ }
    listeners.forEach((l) => l())
    if (restart) { const ed = editor!; void stop().then(() => dictation.start(ed)) }
  },
  async start(ed: Editor) {
    const id = pickEngine()
    if (!id) { set({ error: 'unsupported' }); return }
    if (id === 'whisper') {
      const mb = await (await import('./whisper')).whisperDownloadMb()
      // The on-device model is a one-time download of hundreds of MB: ask first, as Word does for language packs.
      if (mb > 0) { editor = ed; set({ phase: 'consent', engine: id, consentMb: mb, error: null }); return }
    }
    await begin(ed, id)
  },
  /** The user agreed to download the on-device model. */
  acceptDownload() { if (state.phase === 'consent' && editor) void begin(editor, 'whisper') },
  toggle(ed: Editor) { return state.phase === 'idle' ? dictation.start(ed) : stop() },
  stop: () => stop(),
  dismissError: () => set({ error: null }),
  toggleHelp: (b?: boolean) => set({ help: b ?? !state.help }),
  onLevel(cb: (v: number) => void) { levelListeners.add(cb); return () => { levelListeners.delete(cb) } },
}

async function stop() {
  const s = session
  session = null
  if (s) {
    // The last phrase may still be transcribing: let it land before cutting the session off.
    set({ phase: 'finishing' })
    try { await s.stop() } catch { /* already gone */ }
  }
  run++
  if (editor && !editor.isDestroyed) editor.commands.setDictationInterim('', opts())
  set({ phase: 'idle', busy: false, progress: 0 })
}

export function useDictation(): DictState {
  return useSyncExternalStore(subscribe, () => state)
}
/** Re-render on preference changes too (menus show the current language / engine). */
export function useDictPrefs(): DictPrefs {
  useSyncExternalStore(subscribe, () => prefs)
  return prefs
}
