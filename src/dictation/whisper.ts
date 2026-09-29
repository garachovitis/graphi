// On-device dictation with Whisper: microphone → 16 kHz → voice-activity segmentation → worker.
// Each pause (or 25 s of continuous speech) closes a phrase, which Whisper transcribes with punctuation
// and capitals. On WebGPU the phrase in progress is also transcribed every second for live grey text.
import workletUrl from './capture.worklet.ts?worker&url'
import type { FromWorker, Plan, ToWorker } from './whisper.worker'
import type { Session, Sink, StartOpts } from './engines'
import { cleanTranscript } from './text'
import { FRAME, Segmenter, downsampler } from './vad'

// Live previews re-run the whole phrase; only worth it where the model answers quickly.
const PREVIEW_EVERY = 1000
const PREVIEW_MAX_MS = 1500

// Greek needs a large model: large-v3-turbo is the smallest Whisper that writes Greek reliably.
// It needs WebGPU; plain CPU (WASM) gets whisper-small, slower and less accurate but usable.
const TURBO = 'onnx-community/whisper-large-v3-turbo'
const PLANS: Record<'gpu16' | 'gpu' | 'cpu', Plan & { mb: number; files: string[] }> = {
  gpu16: { model: TURBO, device: 'webgpu', dtype: { encoder_model: 'q4f16', decoder_model_merged: 'q4f16' }, mb: 565, files: ['encoder_model_q4f16', 'decoder_model_merged_q4f16'] },
  gpu: { model: TURBO, device: 'webgpu', dtype: { encoder_model: 'q4', decoder_model_merged: 'q4' }, mb: 760, files: ['encoder_model_q4', 'decoder_model_merged_q4'] },
  cpu: { model: 'onnx-community/whisper-small', device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, mb: 250, files: ['encoder_model_quantized', 'decoder_model_merged_quantized'] },
}

let planP: Promise<typeof PLANS.cpu> | null = null
function pickPlan() {
  return planP ??= (async () => {
    try {
      const a = await (navigator as any).gpu?.requestAdapter()
      if (a) return a.features.has('shader-f16') ? PLANS.gpu16 : PLANS.gpu
    } catch { /* no WebGPU */ }
    return PLANS.cpu
  })()
}

/** Megabytes still to download before on-device dictation can start (0 = ready offline). */
export async function whisperDownloadMb(): Promise<number> {
  const p = await pickPlan()
  try {
    const cache = await caches.open('transformers-cache')
    const hits = await Promise.all(p.files.map((f) => cache.match(`https://huggingface.co/${p.model}/resolve/main/onnx/${f}.onnx`)))
    if (hits.every(Boolean)) return 0
  } catch { /* no Cache Storage: transformers.js re-downloads each time */ }
  return p.mb
}

// One worker per window; it keeps the model in memory between sessions and is dropped when idle.
const IDLE_MS = 5 * 60_000
let worker: Worker | null = null
let ready: Promise<void> | null = null
let idleTimer = 0
let warmMs = Infinity // time of the warm-up run: tells whether live previews can keep up
const listeners = new Set<(m: FromWorker) => void>()

function getWorker(sink: Sink) {
  clearTimeout(idleTimer)
  if (!worker) {
    worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<FromWorker>) => listeners.forEach((l) => l(e.data))
    ready = null
  }
  if (!ready) {
    ready = new Promise<void>((resolve, reject) => {
      const files = new Map<string, [number, number]>()
      const l = (m: FromWorker) => {
        if (m.type === 'progress') {
          files.set(m.file, [m.loaded, m.total])
          let got = 0, all = 0
          files.forEach(([a, b]) => { got += a; all += b })
          sink.progress?.('download', all ? got / all : 0)
        } else if (m.type === 'loading') sink.progress?.('load', 0)
        else if (m.type === 'ready') { warmMs = m.ms; listeners.delete(l); resolve() }
        else if (m.type === 'error' && m.id == null) { listeners.delete(l); reject(new Error(m.message)) }
      }
      listeners.add(l)
    })
    pickPlan().then(({ model, device, dtype }) => worker!.postMessage({ type: 'load', plan: { model, device, dtype } } satisfies ToWorker))
    ready.catch(() => { worker?.terminate(); worker = null; ready = null })
  }
  return ready
}

export async function startWhisper(o: StartOpts, sink: Sink): Promise<Session> {
  const plan = await pickPlan()
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  } catch (e: any) {
    sink.error(e?.name === 'NotFoundError' || e?.name === 'OverconstrainedError' ? 'nomic' : 'permission')
    return { stop: async () => {} }
  }
  const release = () => stream.getTracks().forEach((t) => t.stop())

  try { await getWorker(sink) } catch {
    release()
    sink.error('model')
    return { stop: async () => {} }
  }

  // Jobs run one at a time in the worker; finished phrases always go before live previews.
  let seq = 0
  const pending = new Map<number, 'final' | number>() // id → 'final' or the segment a preview belongs to
  let previewBusy = false
  const sentAt = new Map<number, number>()
  let finalsLeft = 0
  let drained: (() => void) | null = null
  const onMsg = (m: FromWorker) => {
    if ((m.type !== 'result' && m.type !== 'error') || m.id == null || !pending.has(m.id)) return
    const kind = pending.get(m.id)!
    pending.delete(m.id)
    const text = m.type === 'result' ? cleanTranscript(m.text) : ''
    if (kind === 'final') {
      finalMs = performance.now() - (sentAt.get(m.id) ?? performance.now())
      sentAt.delete(m.id)
      if (text) { sink.interim(''); sink.final(text) }
      if (--finalsLeft === 0) { sink.busy?.(false); drained?.() }
    } else {
      previewBusy = false
      if (kind === segId && vad.speaking && text) sink.interim(text)
    }
  }
  listeners.add(onMsg)
  const send = (audio: Float32Array, kind: 'final' | number) => {
    const id = ++seq
    pending.set(id, kind)
    if (kind === 'final') { finalsLeft++; sink.busy?.(true); sentAt.set(id, performance.now()) }
    worker!.postMessage({ type: 'run', id, audio, lang: o.lang } satisfies ToWorker, [audio.buffer])
  }

  const vad = new Segmenter()
  let segId = 0
  let lastPreview = 0
  let finalMs = warmMs // how long the last phrase took to transcribe
  const onFrame = (f: Float32Array) => {
    const r = vad.push(f)
    sink.level?.(r.level)
    if (r.phrase !== undefined) {
      segId++
      sink.interim('')
      if (r.phrase) send(r.phrase, 'final')
    } else if (vad.speaking && plan.device === 'webgpu' && finalMs < PREVIEW_MAX_MS && !previewBusy && !finalsLeft
      && vad.frames > 40 && performance.now() - lastPreview > PREVIEW_EVERY) {
      previewBusy = true
      lastPreview = performance.now()
      send(vad.current(), segId)
    }
  }

  const ctx = new AudioContext()
  const down = downsampler(ctx.sampleRate)
  let carry = new Float32Array(0)
  try {
    await ctx.audioWorklet.addModule(workletUrl)
  } catch {
    release(); listeners.delete(onMsg); ctx.close()
    sink.error('unsupported')
    return { stop: async () => {} }
  }
  const src = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'grafi-capture')
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const x = down(e.data)
    const all = new Float32Array(carry.length + x.length)
    all.set(carry); all.set(x, carry.length)
    let i = 0
    for (; i + FRAME <= all.length; i += FRAME) onFrame(all.slice(i, i + FRAME))
    carry = all.slice(i)
  }
  src.connect(node)
  node.connect(ctx.destination) // silent; keeps the node pulled by the audio graph
  stream.getAudioTracks()[0]?.addEventListener('ended', () => sink.error('nomic'))

  return {
    async stop() {
      node.port.onmessage = null
      src.disconnect(); node.disconnect(); release(); ctx.close()
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
