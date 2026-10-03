// Speech recognition off the UI thread: transformers.js + ONNX Runtime on WebGPU.
// Desktop reads the model through the main process (`host`, files kept on disk); the web build
// fetches it from Hugging Face once and keeps it in Cache Storage.
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
// The WebGPU bundle embeds the runtime's JS; only the binary is fetched, from the app itself
// (strict CSP, and no CDN: works offline once the model is there).
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import type { Dtype } from './model'

env.allowLocalModels = false
env.backends.onnx.wasm!.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href } as any

export type ToWorker =
  | { type: 'load'; repo: string; rev: string; dtype: Dtype; host: string | null; gen: Gen }
  | { type: 'run'; id: number; audio: Float32Array; gen: Gen }
/** The model's generation options (language…); see ModelDef.gen. */
type Gen = Record<string, unknown>
export type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'loading' }
  | { type: 'ready'; ms: number }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; message: string; id?: number }

let asr: AutomaticSpeechRecognitionPipeline | null = null
const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m)
// ~6 tokens a second is fast speech; the cap stops a runaway decode on noise (Whisper's limit is 448).
const opts = (gen: Gen, samples: number) => ({ ...gen, max_new_tokens: Math.min(440, 24 + Math.ceil((samples / 16000) * 8)) })

async function load({ repo, rev, dtype, host, gen }: Extract<ToWorker, { type: 'load' }>) {
  if (host) { env.remoteHost = host; env.useBrowserCache = false } // the disk is the cache
  const files = new Map<string, [number, number]>()
  asr = await pipeline('automatic-speech-recognition', repo, {
    revision: rev,
    device: 'webgpu',
    dtype: dtype as any,
    progress_callback: (p: any) => {
      if (p.status === 'progress' && p.total) {
        files.set(p.file, [p.loaded, p.total])
        let loaded = 0, total = 0
        files.forEach(([a, b]) => { loaded += a; total += b })
        post({ type: 'progress', loaded, total })
      } else if (p.status === 'ready') post({ type: 'loading' })
    },
  }) as AutomaticSpeechRecognitionPipeline
  // Compile the GPU shaders now, not on the user's first sentence; the second run shows the real speed.
  const silence = new Float32Array(16000)
  await asr(silence, opts(gen, 0) as any)
  const t = performance.now()
  await asr(silence, opts(gen, 0) as any)
  post({ type: 'ready', ms: performance.now() - t })
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data
  try {
    if (m.type === 'load') await load(m)
    else if (m.type === 'run') {
      if (!asr) throw new Error('model not loaded')
      const out = await asr(m.audio, opts(m.gen, m.audio.length) as any)
      post({ type: 'result', id: m.id, text: (Array.isArray(out) ? out[0] : out).text })
    }
  } catch (err: any) {
    post({ type: 'error', message: String(err?.message ?? err), id: m.type === 'run' ? m.id : undefined })
  }
}
