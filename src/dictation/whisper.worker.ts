// Whisper inference off the UI thread (transformers.js + ONNX Runtime, WebGPU or WASM).
// Model files come from the Hugging Face hub once and stay in the browser's Cache Storage.
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
// The WebGPU bundle embeds the runtime's JS; only the binary is fetched. Served by the app, not a CDN
// (strict CSP, works offline once the model is cached).
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'

env.allowLocalModels = false
env.backends.onnx.wasm!.wasmPaths = { wasm: new URL(ortWasm, self.location.href).href } as any

export interface Plan { model: string; device: 'webgpu' | 'wasm'; dtype: Record<string, string> }
export type ToWorker =
  | { type: 'load'; plan: Plan }
  | { type: 'run'; id: number; audio: Float32Array; lang: 'el' | 'en' }
export type FromWorker =
  | { type: 'progress'; file: string; loaded: number; total: number }
  | { type: 'loading' }
  | { type: 'ready'; ms: number }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; message: string; id?: number }

let asr: AutomaticSpeechRecognitionPipeline | null = null
const post = (m: FromWorker) => (self as unknown as Worker).postMessage(m)

async function load(plan: Plan) {
  const fromNet = new Set<string>()
  asr = await pipeline('automatic-speech-recognition', plan.model, {
    device: plan.device,
    dtype: plan.dtype as any,
    progress_callback: (p: any) => {
      // Only files fetched from the network count as a download (cached ones report progress too).
      if (p.status === 'download') fromNet.add(p.file)
      if (p.status === 'progress' && p.total && fromNet.has(p.file)) post({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total })
      if (p.status === 'done' && fromNet.has(p.file)) fromNet.delete(p.file)
      if (p.status === 'ready' || (p.status === 'done' && !fromNet.size)) post({ type: 'loading' })
    },
  }) as AutomaticSpeechRecognitionPipeline
  // Compile the GPU shaders now, not on the user's first sentence; the second run shows the real speed.
  await asr(new Float32Array(16000), { language: 'greek', task: 'transcribe' } as any)
  const t = performance.now()
  await asr(new Float32Array(16000), { language: 'greek', task: 'transcribe' } as any)
  post({ type: 'ready', ms: performance.now() - t })
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data
  try {
    if (m.type === 'load') await load(m.plan)
    else if (m.type === 'run') {
      if (!asr) throw new Error('model not loaded')
      const out = await asr(m.audio, { language: m.lang === 'el' ? 'greek' : 'english', task: 'transcribe' } as any)
      post({ type: 'result', id: m.id, text: (Array.isArray(out) ? out[0] : out).text })
    }
  } catch (err: any) {
    post({ type: 'error', message: String(err?.message ?? err), id: m.type === 'run' ? m.id : undefined })
  }
}
