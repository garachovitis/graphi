// The on-device speech models, both running on the GPU (WebGPU) — the voice never leaves the device.
// The user picks one when it is first downloaded (and later from Home ▸ Dictate ▸ arrow):
//   lite — OpenAI Whisper large-v3 turbo (MIT), ~0.56 GB. The best Greek for its size (FLEURS WER ≈ 13 %),
//          but it always encodes a 30 s window, so each phrase takes ~3 s and there is no live grey text.
//   best — Cohere Transcribe 03-2026 (Apache-2.0), ~1.5 GB. The best open model for Greek (WER ≈ 9 %),
//          time grows with the phrase length (~1.4 s for 10 s of speech), fast enough for live text.
// Both write punctuation and capitals, in Greek and English. Each is pinned to one revision so what the
// user agreed to download is exactly what runs. Keep in step with electron/model.cjs.
import { platform } from '../platform'
import type { DictLang } from './text'

export type ModelId = 'lite' | 'best'
/** 4-bit weights with half-precision maths where the GPU has it, plain 4-bit otherwise. */
export type Dtype = 'q4f16' | 'q4'

export interface ModelDef {
  id: ModelId
  repo: string
  rev: string
  provider: string
  name: string
  license: string
  mb: Record<Dtype, number>
  files(d: Dtype): string[]
  /** Generation options for one phrase in the given language. */
  gen(lang: DictLang): Record<string, unknown>
}

const TOKENIZER = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json']

export const MODELS: Record<ModelId, ModelDef> = {
  lite: {
    id: 'lite',
    repo: 'onnx-community/whisper-large-v3-turbo',
    rev: '360ebcde2559d60bb474678be3c1de9ef347d01a',
    provider: 'OpenAI',
    name: 'Whisper large-v3 turbo',
    license: 'MIT',
    mb: { q4f16: 565, q4: 760 },
    files: (d) => [...TOKENIZER, `onnx/encoder_model_${d}.onnx`, `onnx/decoder_model_merged_${d}.onnx`],
    gen: (lang) => ({ language: lang === 'el' ? 'greek' : 'english', task: 'transcribe' }),
  },
  best: {
    id: 'best',
    repo: 'onnx-community/cohere-transcribe-03-2026-ONNX',
    rev: '31b1c6211c9000d76b077ddd23b74c9090badeba',
    provider: 'Cohere Labs',
    name: 'Cohere Transcribe 03-2026',
    license: 'Apache-2.0',
    mb: { q4f16: 1540, q4: 2130 },
    files: (d) => [...TOKENIZER, 'processor_config.json',
      ...['encoder_model', 'decoder_model_merged'].flatMap((n) => [`onnx/${n}_${d}.onnx`, `onnx/${n}_${d}.onnx_data`])],
    gen: (lang) => ({ language: lang }),
  },
}

const hfUrl = (m: ModelDef) => (f: string) => `https://huggingface.co/${m.repo}/resolve/${m.rev}/${f}`

let dtypeP: Promise<Dtype | null> | null = null
/** null: no WebGPU here, so no model can run at a usable speed. */
export function pickDtype() {
  return dtypeP ??= (async () => {
    try {
      const a = await (navigator as any).gpu?.requestAdapter({ powerPreference: 'high-performance' })
      if (a) return a.features.has('shader-f16') ? 'q4f16' : 'q4'
    } catch { /* no WebGPU */ }
    return null
  })()
}

/** Megabytes still to download before dictation can start with this model (0 = ready, also offline). */
export async function downloadMb(m: ModelDef, d: Dtype): Promise<number> {
  const missing = await platform.speechModel.missing(m.repo, m.files(d), hfUrl(m))
  // The weights are the bulk; a missing config file alone still means a (tiny) download.
  return !missing.length ? 0 : missing.some((f) => f.includes('/')) ? m.mb[d] : 1
}

export const allowDownload = () => platform.speechModel.allow()
/** Removes every downloaded model from this device. */
export async function removeModels() {
  const d = await pickDtype()
  for (const m of Object.values(MODELS)) await platform.speechModel.remove(d ? m.files(d) : [], hfUrl(m))
}
