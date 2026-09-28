// Dev runner: starts the Vite dev server, then launches Electron pointed at it.
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import electronPath from 'electron'

const server = await createServer({ configFile: 'vite.config.ts' })
await server.listen()
const url = server.resolvedUrls.local[0]
console.log(`[dev] vite ready at ${url}`)

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
})
child.on('close', async (code) => {
  await server.close()
  process.exit(code ?? 0)
})
