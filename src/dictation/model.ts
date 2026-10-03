// The on-device speech model: Cohere Transcribe 03-2026 (Cohere Labs, Apache-2.0, 2B parameters),
// ONNX export by onnx-community. Chosen for Greek: the lowest Greek error rate of any open model
// (FLEURS WER ≈ 9 %, Whisper large-v3 ≈ 11.5 %), punctuation and capitals built in, Greek and English.
// It runs on the GPU (WebGPU); the voice never leaves the device. Pinned to one revision so what the
// user agreed to download is exactly what runs. Keep in step with electron/model.cjs.
import { platform } from '../platform'

export const MODEL = {
  repo: 'onnx-community/cohere-transcribe-03-2026-ONNX',
  rev: '31b1c6211c9000d76b077ddd23b74c9090badeba',
  provider: 'Cohere Labs',
  name: 'Cohere Transcribe 03-2026',
  license: 'Apache-2.0',
}

/** 4-bit weights with half-precision maths where the GPU has it, plain 4-bit otherwise. */
export type Dtype = 'q4f16' | 'q4'
const MB: Record<Dtype, number> = { q4f16: 1540, q4: 2130 }

const CONFIG = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'processor_config.json', 'tokenizer.json', 'tokenizer_config.json']
export const modelFiles = (d: Dtype) =>
  [...CONFIG, ...['encoder_model', 'decoder_model_merged'].flatMap((n) => [`onnx/${n}_${d}.onnx`, `onnx/${n}_${d}.onnx_data`])]
const hfUrl = (f: string) => `https://huggingface.co/${MODEL.repo}/resolve/${MODEL.rev}/${f}`

let dtypeP: Promise<Dtype | null> | null = null
/** null: no WebGPU here, so the model can't run at a usable speed. */
export function pickDtype() {
  return dtypeP ??= (async () => {
    try {
      const a = await (navigator as any).gpu?.requestAdapter({ powerPreference: 'high-performance' })
      if (a) return a.features.has('shader-f16') ? 'q4f16' : 'q4'
    } catch { /* no WebGPU */ }
    return null
  })()
}

/** Megabytes still to download before dictation can start (0 = ready, also offline). */
export async function downloadMb(d: Dtype): Promise<number> {
  const files = modelFiles(d)
  const missing = await platform.speechModel.missing(files, hfUrl)
  // The weights are the bulk; a missing config file alone still means a (tiny) download.
  return !missing.length ? 0 : missing.some((f) => f.endsWith('_data')) ? MB[d] : 1
}

export const allowDownload = () => platform.speechModel.allow()
export async function removeModel() {
  const d = await pickDtype()
  await platform.speechModel.remove(d ? modelFiles(d) : [], hfUrl)
}
