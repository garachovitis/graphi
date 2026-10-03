// Graphi — the on-device speech model for Home ▸ Dictate (src/dictation).
// The renderer has no network, so it reads the model through `grafi-model://`, served here from
// <userData>/models. A missing file is downloaded from Hugging Face once — only after the user agreed
// in the consent dialog, only the files listed below, only at the pinned revision — and kept on disk;
// afterwards dictation works offline. Keep MODEL in step with src/dictation/model.ts.
'use strict'

const { app, protocol, session, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const SCHEME = 'grafi-model'
const MODEL = {
  repo: 'onnx-community/cohere-transcribe-03-2026-ONNX',
  rev: '31b1c6211c9000d76b077ddd23b74c9090badeba',
}
const FILES = new Set([
  'config.json', 'generation_config.json', 'preprocessor_config.json', 'processor_config.json', 'tokenizer.json', 'tokenizer_config.json',
  ...['q4f16', 'q4'].flatMap((d) => ['encoder_model', 'decoder_model_merged'].flatMap((n) => [`onnx/${n}_${d}.onnx`, `onnx/${n}_${d}.onnx_data`])),
])

const CORS = { 'access-control-allow-origin': '*' }
const dir = () => path.join(app.getPath('userData'), 'models', MODEL.repo.replace('/', '--'), MODEL.rev)
const local = (f) => path.join(dir(), ...f.split('/'))
let allowed = false // set by the consent dialog, for this run of the app
const inflight = new Map() // file → download promise, so two requests never write the same file

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
  if (!m || m[1] !== MODEL.repo || m[2] !== MODEL.rev || !FILES.has(m[3])) return new Response(null, { status: 404, headers: CORS })
  const f = m[3]
  const file = local(f)
  if (inflight.has(f)) await inflight.get(f).catch(() => {})
  const st = await fs.stat(file).catch(() => null)
  if (st) return fromDisk(file, st.size)
  if (!allowed) return new Response(null, { status: 403, headers: CORS })

  // Download in a separate, cookie-less session (the default one blocks all traffic), straight to a
  // .part file that becomes the real file only when complete; the renderer reads the same bytes as they arrive.
  const res = await session.fromPartition('grafi-model-download', { cache: false })
    .fetch(`https://huggingface.co/${MODEL.repo}/resolve/${MODEL.rev}/${f}`, { credentials: 'omit', redirect: 'follow' })
  if (!res.ok || !res.body) return new Response(null, { status: res.status || 502, headers: CORS })
  const [toDisk, toPage] = res.body.tee()
  const part = `${file}.part`
  const job = (async () => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await pipeline(Readable.fromWeb(toDisk), fsSync.createWriteStream(part))
    await fs.rename(part, file)
  })().catch((e) => fs.rm(part, { force: true }).then(() => { throw e }))
  inflight.set(f, job)
  job.catch(() => {}).finally(() => inflight.delete(f))
  const len = res.headers.get('content-length')
  return new Response(toPage, { headers: { ...CORS, 'content-type': 'application/octet-stream', ...(len ? { 'content-length': len } : {}) } })
}

function setupModel() {
  session.defaultSession.protocol.handle(SCHEME, (req) => serve(req).catch(() => new Response(null, { status: 500, headers: CORS })))
  /** Which of these files are not on disk yet. */
  ipcMain.handle('model:missing', (_e, files) =>
    (Array.isArray(files) ? files : []).filter((f) => typeof f === 'string' && FILES.has(f) && !fsSync.existsSync(local(f))))
  ipcMain.handle('model:allow', () => { allowed = true })
  ipcMain.handle('model:remove', async () => {
    allowed = false
    await fs.rm(path.join(app.getPath('userData'), 'models'), { recursive: true, force: true })
  })
}

module.exports = { registerModelScheme, setupModel, MODEL_HOST: `${SCHEME}://hf/` }
