// On-device dictation: microphone → 16 kHz → voice-activity segmentation → speech model (worker).
// A pause (or 25 s of continuous speech) closes a phrase, which is transcribed with punctuation and
// inserted. While the user is still speaking the phrase so far is re-transcribed a few times a second
// and shown in grey at the caret, so the words appear as they are said (where the model is fast enough).
import workletUrl from './capture.worklet.ts?worker&url'
import type { FromWorker, ToWorker } from './asr.worker'
import type { Dtype, ModelDef } from './model'
import { cleanTranscript, type DictLang } from './text'
import { FRAME, Segmenter, downsampler } from './vad'
import { platform } from '../platform'

/** Error codes shown to the user (see `dict.err.*` in i18n). */
export type DictError = 'permission' | 'nomic' | 'gpu' | 'model' | 'failed'

export interface Sink {
  /** Words still being recognised (grey at the caret, may change). */
  interim(text: string): void
  /** A finished phrase to insert. */
  final(text: string): void
  /** Microphone level 0…1, ~33 times a second. */
  level(v: number): void
  /** Model download / load progress 0…1. */
  progress(phase: 'download' | 'load', v: number): void
  /** Transcribing speech already heard. */
  busy(b: boolean): void
  error(e: DictError): void
}
export interface Session { stop(): Promise<void> }

// Live previews re-run the whole phrase so far; only worth it while the GPU answers quickly.
const PREVIEW_EVERY = 450
const PREVIEW_MAX_MS = 1200
const MIN_PREVIEW_FRAMES = 12 // 360 ms of speech before the first grey words

// One worker per window; it keeps the model in memory between sessions and is dropped when idle
// or when the user switches to the other model.
const IDLE_MS = 10 * 60_000
let worker: Worker | null = null
let workerModel = ''
let ready: Promise<void> | null = null
let idleTimer = 0
let warmMs = Infinity // time of the warm-up run: tells whether live previews can keep up
const listeners = new Set<(m: FromWorker) => void>()

function getWorker(model: ModelDef, dtype: Dtype, expectMb: number, sink: Sink) {
  clearTimeout(idleTimer)
  if (worker && workerModel !== model.id + dtype) { worker.terminate(); worker = null }
  if (!worker) {
    workerModel = model.id + dtype
    worker = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<FromWorker>) => listeners.forEach((l) => l(e.data))
    ready = null
  }
  if (!ready) {
    ready = new Promise<void>((resolve, reject) => {
      const l = (m: FromWorker) => {
        // Files report one by one; measure against the whole model so the bar never jumps back.
        if (m.type === 'progress') sink.progress(expectMb > 1 ? 'download' : 'load', Math.min(1, m.loaded / Math.max(m.total, expectMb * 1e6)))
        else if (m.type === 'loading') sink.progress('load', 1)
        else if (m.type === 'ready') { warmMs = m.ms; listeners.delete(l); resolve() }
        else if (m.type === 'error' && m.id == null) { listeners.delete(l); reject(new Error(m.message)) }
      }
      listeners.add(l)
    })
    worker.postMessage({ type: 'load', repo: model.repo, rev: model.rev, dtype, host: platform.speechModel.host, gen: model.gen('el') } satisfies ToWorker)
    ready.catch(() => { worker?.terminate(); worker = null; ready = null })
  }
  return ready
}

export async function startSession(o: { model: ModelDef; lang: DictLang; dtype: Dtype; downloadMb: number; signal: AbortSignal }, sink: Sink): Promise<Session> {
  const none = { stop: async () => {} }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  } catch (e: any) {
    sink.error(e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError' ? 'nomic' : 'permission')
    return none
  }
  const release = () => stream.getTracks().forEach((t) => t.stop())

  // Capture starts now, while the model loads: the meter shows the mic works, and speech from the
  // first second is kept and transcribed once the model is ready.
  const ctx = new AudioContext()
  const down = downsampler(ctx.sampleRate)
  try {
    await ctx.audioWorklet.addModule(workletUrl)
  } catch {
    release(); ctx.close()
    sink.error('failed')
    return none
  }
  const src = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'grafi-capture')
  src.connect(node)
  node.connect(ctx.destination) // silent; keeps the node pulled by the audio graph

  let loaded = false
  let seq = 0
  const pending = new Map<number, 'final' | number>() // job id → 'final' or the phrase a preview belongs to
  const sentAt = new Map<number, number>()
  const queued: Float32Array[] = [] // phrases finished before the model was ready
  let previewBusy = false
  let finalsLeft = 0
  let drained: (() => void) | null = null
  let finalMs = Infinity // how long the last phrase took to transcribe
  let lastPreview = 0
  let phraseId = 0
  const vad = new Segmenter()

  const send = (audio: Float32Array, kind: 'final' | number) => {
    const id = ++seq
    pending.set(id, kind)
    if (kind === 'final') { finalsLeft++; sink.busy(true); sentAt.set(id, performance.now()) }
    worker!.postMessage({ type: 'run', id, audio, gen: o.model.gen(o.lang) } satisfies ToWorker, [audio.buffer])
  }
  const onMsg = (m: FromWorker) => {
    if ((m.type !== 'result' && m.type !== 'error') || m.id == null || !pending.has(m.id)) return
    const kind = pending.get(m.id)!
    pending.delete(m.id)
    const text = m.type === 'result' ? cleanTranscript(m.text) : ''
    if (kind === 'final') {
      finalMs = performance.now() - (sentAt.get(m.id) ?? performance.now())
      sentAt.delete(m.id)
      sink.interim('')
      if (text) sink.final(text)
      if (--finalsLeft === 0) { sink.busy(false); drained?.() }
    } else {
      previewBusy = false
      if (kind === phraseId && vad.speaking && text) sink.interim(text)
    }
  }
  listeners.add(onMsg)

  const onFrame = (f: Float32Array) => {
    const r = vad.push(f)
    sink.level(r.level)
    if (r.phrase !== undefined) {
      phraseId++
      if (!r.phrase) return
      if (loaded) send(r.phrase, 'final')
      else queued.push(r.phrase)
    } else if (loaded && vad.speaking && !previewBusy && !finalsLeft && vad.frames > MIN_PREVIEW_FRAMES
      && Math.min(finalMs, warmMs * 3) < PREVIEW_MAX_MS && performance.now() - lastPreview > PREVIEW_EVERY) {
      previewBusy = true
      lastPreview = performance.now()
      send(vad.current(), phraseId)
    }
  }
  let carry = new Float32Array(0)
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const x = down(e.data)
    const all = new Float32Array(carry.length + x.length)
    all.set(carry); all.set(x, carry.length)
    let i = 0
    for (; i + FRAME <= all.length; i += FRAME) onFrame(all.slice(i, i + FRAME))
    carry = all.slice(i)
  }
  let stopped = false
  const shutdown = () => {
    node.port.onmessage = null
    src.disconnect(); node.disconnect(); release(); ctx.close()
  }
  stream.getAudioTracks()[0]?.addEventListener('ended', () => { if (!stopped) sink.error('nomic') })
  // Stopped while the model was still loading: free the microphone at once.
  o.signal.addEventListener('abort', () => { if (!stopped) { stopped = true; shutdown(); listeners.delete(onMsg) } })

  try {
    await getWorker(o.model, o.dtype, o.downloadMb, sink)
  } catch {
    if (!stopped) { stopped = true; shutdown(); listeners.delete(onMsg); sink.error('model') }
    return none
  }
  if (stopped) return none
  loaded = true
  queued.splice(0).forEach((p) => send(p, 'final'))

  return {
    async stop() {
      stopped = true
      shutdown()
      if (vad.speaking) {
        const last = vad.close()
        if (last) send(last, 'final')
      }
      // Let the last phrase land before reporting "stopped".
      if (finalsLeft) await Promise.race([new Promise<void>((r) => { drained = r }), new Promise((r) => setTimeout(r, 30_000))])
      listeners.delete(onMsg)
      sink.interim('')
      idleTimer = window.setTimeout(() => { worker?.terminate(); worker = null; ready = null }, IDLE_MS)
    },
  }
}
