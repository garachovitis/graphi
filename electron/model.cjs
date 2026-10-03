// Graphi — the on-device speech models for Home ▸ Dictate (src/dictation).
// The renderer has no network, so it reads a model through `grafi-model://`, served here from
// <userData>/models. A missing file is downloaded from Hugging Face once — only after the user agreed
// in the consent dialog, only the files listed below, only at the pinned revision — and kept on disk;
// afterwards dictation works offline. Keep MODELS in step with src/dictation/model.ts.
'use strict'

const { app, protocol, session, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const SCHEME = 'grafi-model'
const TOKENIZER = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json']
const DTYPES = ['q4f16', 'q4']
const MODELS = [
  { // lite: Whisper large-v3 turbo
    repo: 'onnx-community/whisper-large-v3-turbo',
    rev: '360ebcde2559d60bb474678be3c1de9ef347d01a',
    files: new Set([...TOKENIZER, ...DTYPES.flatMap((d) => [`onnx/encoder_model_${d}.onnx`, `onnx/decoder_model_merged_${d}.onnx`])]),
  },
  { // best: Cohere Transcribe 03-2026
    repo: 'onnx-community/cohere-transcribe-03-2026-ONNX',
    rev: '31b1c6211c9000d76b077ddd23b74c9090badeba',
    files: new Set([...TOKENIZER, 'processor_config.json',
      ...DTYPES.flatMap((d) => ['encoder_model', 'decoder_model_merged'].flatMap((n) => [`onnx/${n}_${d}.onnx`, `onnx/${n}_${d}.onnx_data`]))]),
  },
]

const CORS = { 'access-control-allow-origin': '*' }
const root = () => path.join(app.getPath('userData'), 'models')
const local = (model, f) => path.join(root(), model.repo.replace('/', '--'), model.rev, ...f.split('/'))
let allowed = false // set by the consent dialog, for this run of the app
const inflight = new Map() // file path → download promise, so two requests never write the same file

/** Must run before `app.whenReady`. */
function registerModelScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
}

function fromDisk(file, size) {
  return new Response(Readable.toWeb(fsSync.createReadStream(file)), {
    headers: { ...CORS, 'content-type': 'application/octet-stream', 'content-length': String(size) },
  })
}

// grafi-model://hf/<repo>/resolve/<rev>/<file>  (transformers.js `remoteHost` + its default path template)
async function serve(req) {
  const m = decodeURIComponent(new URL(req.url).pathname).match(/^\/(.+?)\/resolve\/([^/]+)\/(.+)$/)
  const model = m && MODELS.find((x) => x.repo === m[1] && x.rev === m[2] && x.files.has(m[3]))
  if (!model) return new Response(null, { status: 404, headers: CORS })
  const f = m[3]
  const file = local(model, f)
  if (inflight.has(file)) await inflight.get(file).catch(() => {})
  const st = await fs.stat(file).catch(() => null)
  if (st) return fromDisk(file, st.size)
  if (!allowed) return new Response(null, { status: 403, headers: CORS })

  // Download in a separate, cookie-less session (the default one blocks all traffic), straight to a
  // .part file that becomes the real file only when complete; the renderer reads the same bytes as they arrive.
  const res = await session.fromPartition('grafi-model-download', { cache: false })
    .fetch(`https://huggingface.co/${model.repo}/resolve/${model.rev}/${f}`, { credentials: 'omit', redirect: 'follow' })
  if (!res.ok || !res.body) return new Response(null, { status: res.status || 502, headers: CORS })
  const [toDisk, toPage] = res.body.tee()
  const part = `${file}.part`
  const job = (async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await pipeline(Readable.fromWeb(toDisk), fsSync.createWriteStream(part))
    await fs.rename(part, file)
  })().catch((e) => fs.rm(part, { force: true }).then(() => { throw e }))
  inflight.set(file, job)
  job.catch(() => {}).finally(() => inflight.delete(file))
  const len = res.headers.get('content-length')
  return new Response(toPage, { headers: { ...CORS, 'content-type': 'application/octet-stream', ...(len ? { 'content-length': len } : {}) } })
}

function setupModel() {
  session.defaultSession.protocol.handle(SCHEME, (req) => serve(req).catch(() => new Response(null, { status: 500, headers: CORS })))
  /** Which of this model's files are not on disk yet. */
  ipcMain.handle('model:missing', (_e, repo, files) => {
    const model = MODELS.find((x) => x.repo === repo)
    return (Array.isArray(files) ? files : []).filter((f) => !model || typeof f !== 'string' || !model.files.has(f) || !fsSync.existsSync(local(model, f)))
  })
  ipcMain.handle('model:allow', () => { allowed = true })
  ipcMain.handle('model:remove', async () => {
    allowed = false
    await fs.rm(root(), { recursive: true, force: true })
  })
}

module.exports = { registerModelScheme, setupModel, MODEL_HOST: `${SCHEME}://hf/` }
