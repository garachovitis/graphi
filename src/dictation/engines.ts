// Speech engines behind one interface. Which one runs depends on the host:
//   • native  — iOS SFSpeechRecognizer / Android SpeechRecognizer (GrafiDictation plugin); punctuates itself
//   • web     — the browser's Web Speech API (Chrome/Edge → Google, Safari → Apple); streaming, online
//   • whisper — OpenAI Whisper running locally (WebGPU / WASM, ./whisper.ts); private, offline, punctuates.
//               The only choice in Electron, where Chromium's Web Speech has no Google key and always fails.
import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { isMobileApp, isNative } from '../platform'
import type { DictLang } from './text'

export type EngineId = 'native' | 'web' | 'whisper'

/** Error codes shown to the user (see `dict.err.*` in i18n). */
export type DictError = 'permission' | 'nomic' | 'network' | 'language' | 'unsupported' | 'model' | 'failed'

export interface Sink {
  /** Words still being recognised (shown greyed at the caret, may change). */
  interim(text: string): void
  /** A finished phrase to insert. */
  final(text: string): void
  /** Microphone level 0…1, when the engine can tell. */
  level?(v: number): void
  /** Model download / load progress 0…1 (on-device engine only). */
  progress?(phase: 'download' | 'load', v: number): void
  /** The engine is transcribing audio it already heard. */
  busy?(b: boolean): void
  error(e: DictError): void
}

export interface StartOpts { lang: DictLang; autoPunct: boolean }
export interface Session { stop(): Promise<void> }
export interface Engine { id: EngineId; start(o: StartOpts, sink: Sink): Promise<Session> }

const BCP47: Record<DictLang, string> = { el: 'el-GR', en: 'en-US' }

// ───────────── Web Speech API ─────────────
const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition

const webSpeech: Engine = {
  id: 'web',
  async start(o, sink) {
    const rec = new SR()
    rec.lang = BCP47[o.lang]
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1
    let active = true
    let startedAt = 0
    let quickEnds = 0
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) sink.final(r[0].transcript.trim())
        else interim += r[0].transcript
      }
      sink.interim(interim.trim())
    }
    rec.onerror = (e: any) => {
      const map: Record<string, DictError> = {
        'not-allowed': 'permission', 'service-not-allowed': 'permission', 'audio-capture': 'nomic',
        network: 'network', 'language-not-supported': 'language',
      }
      // no-speech / aborted: Chrome gives up after a quiet spell; onend restarts it.
      if (map[e.error]) { active = false; sink.error(map[e.error]) }
    }
    // Chrome ends a "continuous" session after silence or ~60 s; keep listening until the user stops,
    // but don't spin if it keeps ending immediately (engine refusing without an error).
    rec.onend = () => {
      sink.interim('')
      if (!active) return
      quickEnds = performance.now() - startedAt < 1000 ? quickEnds + 1 : 0
      if (quickEnds >= 5) { active = false; sink.error('failed'); return }
      startedAt = performance.now()
      try { rec.start() } catch { /* already starting */ }
    }
    startedAt = performance.now()
    rec.start()
    return {
      async stop() {
        active = false
        try { rec.stop() } catch { /* not started */ }
      },
    }
  },
}

// ───────────── Native (Capacitor) ─────────────
interface GrafiDictationPlugin {
  available(o: { lang: string }): Promise<{ available: boolean; onDevice?: boolean }>
  start(o: { lang: string; punctuation: boolean }): Promise<void>
  stop(): Promise<void>
  addListener(ev: 'partial' | 'final', cb: (d: { text: string }) => void): Promise<PluginListenerHandle>
  addListener(ev: 'level', cb: (d: { level: number }) => void): Promise<PluginListenerHandle>
  addListener(ev: 'error', cb: (d: { code: string }) => void): Promise<PluginListenerHandle>
}
const GrafiDictation = registerPlugin<GrafiDictationPlugin>('GrafiDictation')

const nativeEngine: Engine = {
  id: 'native',
  async start(o, sink) {
    const lang = BCP47[o.lang]
    const { available } = await GrafiDictation.available({ lang }).catch(() => ({ available: false }))
    if (!available) { sink.error('language'); return { stop: async () => {} } }
    const subs = await Promise.all([
      GrafiDictation.addListener('partial', (d) => sink.interim(d.text)),
      GrafiDictation.addListener('final', (d) => { sink.interim(''); sink.final(d.text) }),
      GrafiDictation.addListener('level', (d) => sink.level?.(d.level)),
      GrafiDictation.addListener('error', (d) => sink.error((['permission', 'nomic', 'network', 'language'].includes(d.code) ? d.code : 'failed') as DictError)),
    ])
    const off = () => subs.forEach((s) => s.remove())
    try {
      await GrafiDictation.start({ lang, punctuation: o.autoPunct })
    } catch (e: any) {
      off()
      sink.error(/permission|denied|authori/i.test(String(e?.message ?? e)) ? 'permission' : 'failed')
      return { stop: async () => {} }
    }
    return { async stop() { await GrafiDictation.stop().catch(() => {}); off() } }
  },
}

// ───────────── Whisper (lazy: pulls in transformers.js only when used) ─────────────
const whisperEngine: Engine = {
  id: 'whisper',
  async start(o, sink) { return (await import('./whisper')).startWhisper(o, sink) },
}

/** Engines this host can run, best default first. */
export function availableEngines(): EngineId[] {
  if (isMobileApp) return ['native']
  const out: EngineId[] = []
  if (SR && !isNative) out.push('web')
  if (typeof WebAssembly === 'object' && 'mediaDevices' in navigator && typeof AudioWorkletNode === 'function') out.push('whisper')
  return out
}

export const engine = (id: EngineId): Engine => (id === 'native' ? nativeEngine : id === 'web' ? webSpeech : whisperEngine)
