// On-device dictation with Whisper: microphone → 16 kHz → voice-activity segmentation → worker.
// Each pause (or 25 s of continuous speech) closes a phrase, which Whisper transcribes with punctuation
// and capitals. On WebGPU the phrase in progress is also transcribed every second for live grey text.
import workletUrl from './capture.worklet.ts?worker&url'
import type { FromWorker, Plan, ToWorker } from './whisper.worker'
import type { Session, Sink, StartOpts } from './engines'
import { cleanTranscript } from './text'

const RATE = 16000
const FRAME = 480 // 30 ms
const PREROLL = 10 // frames kept from before speech starts (300 ms)
const END_SILENCE = 24 // frames of quiet that end a phrase (720 ms)
const MAX_FRAMES = Math.floor(25_000 / 30) // Whisper's window is 30 s
const MIN_VOICED = 8 // shorter blips (clicks, breaths) are dropped
const PARTIAL_EVERY = 1000

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
        else if (m.type === 'ready') { listeners.delete(l); resolve() }
        else if (m.type === 'error' && m.id == null) { listeners.delete(l); reject(new Error(m.message)) }
      }
      listeners.add(l)
    })
    pickPlan().then(({ model, device, dtype }) => worker!.postMessage({ type: 'load', plan: { model, device, dtype } } satisfies ToWorker))
    ready.catch(() => { worker?.terminate(); worker = null; ready = null })
  }
  return ready
}

/** Streaming box-filter downsampler to 16 kHz (enough anti-aliasing for speech). */
function downsampler(from: number) {
  const ratio = from / RATE
  let acc = 0, n = 0, pos = 0
  return (x: Float32Array) => {
    if (ratio <= 1) return x
    const out = new Float32Array(Math.ceil(x.length / ratio) + 1)
    let k = 0
    for (let i = 0; i < x.length; i++) {
      acc += x[i]; n++; pos++
      if (pos >= ratio) { pos -= ratio; out[k++] = acc / n; acc = 0; n = 0 }
    }
    return out.subarray(0, k)
  }
}

const concat = (frames: Float32Array[]) => {
  const out = new Float32Array(frames.reduce((s, f) => s + f.length, 0))
  let o = 0
  for (const f of frames) { out.set(f, o); o += f.length }
  return out
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
  let finalsLeft = 0
  let drained: (() => void) | null = null
  const onMsg = (m: FromWorker) => {
    if ((m.type !== 'result' && m.type !== 'error') || m.id == null || !pending.has(m.id)) return
    const kind = pending.get(m.id)!
    pending.delete(m.id)
    const text = m.type === 'result' ? cleanTranscript(m.text) : ''
    if (kind === 'final') {
      if (text) { sink.interim(''); sink.final(text) }
      if (--finalsLeft === 0) { sink.busy?.(false); drained?.() }
    } else {
      previewBusy = false
      if (kind === segId && speaking && text) sink.interim(text)
    }
  }
  listeners.add(onMsg)
  const send = (audio: Float32Array, kind: 'final' | number) => {
    const id = ++seq
    pending.set(id, kind)
    worker!.postMessage({ type: 'run', id, audio, lang: o.lang } satisfies ToWorker, [audio.buffer])
  }

  // Voice activity: energy against an adaptive noise floor.
  let noise = 0.003
  let speaking = false
  let segId = 0
  let seg: Float32Array[] = []
  let voiced = 0
  let quiet = 0
  let lastPreview = 0
  const pre: Float32Array[] = []
  const closeSegment = () => {
    const frames = seg.slice(0, seg.length - Math.max(0, quiet - 7)) // keep ~200 ms of the trailing pause
    const enough = voiced >= MIN_VOICED
    speaking = false; seg = []; voiced = 0; quiet = 0; segId++
    sink.interim('')
    if (!enough) return
    finalsLeft++
    sink.busy?.(true)
    send(concat(frames), 'final')
  }
  const onFrame = (f: Float32Array) => {
    let e = 0
    for (let i = 0; i < f.length; i++) e += f[i] * f[i]
    const rms = Math.sqrt(e / f.length)
    sink.level?.(Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-9) + 60) / 50)))
    const isVoice = rms > Math.max(noise * 3, 0.008)
    if (!speaking) {
      noise = Math.max(0.001, noise * 0.95 + rms * 0.05)
      pre.push(f)
      if (pre.length > PREROLL) pre.shift()
      if (isVoice && ++voiced >= 2) { speaking = true; seg = [...pre]; pre.length = 0; quiet = 0 }
      else if (!isVoice) voiced = 0
      return
    }
    seg.push(f)
    if (isVoice) { voiced++; quiet = 0 } else quiet++
    if (quiet >= END_SILENCE || seg.length >= MAX_FRAMES) closeSegment()
    else if (plan.device === 'webgpu' && !previewBusy && !finalsLeft && seg.length > 40 && performance.now() - lastPreview > PARTIAL_EVERY) {
      previewBusy = true
      lastPreview = performance.now()
      send(concat(seg), segId)
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
      if (speaking) closeSegment()
      // Let the last phrase land before reporting "stopped".
      if (finalsLeft) await Promise.race([new Promise<void>((r) => { drained = r }), new Promise((r) => setTimeout(r, 30_000))])
      listeners.delete(onMsg)
      sink.interim('')
      idleTimer = window.setTimeout(() => { worker?.terminate(); worker = null; ready = null }, IDLE_MS)
    },
  }
}
