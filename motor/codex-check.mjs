import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadMotorEnv } from './env.mjs'
import { createCodexRunner } from './codex-runner.mjs'

const cwd = fileURLToPath(new URL('trabajos/verificacion-codex/', import.meta.url))
mkdirSync(cwd, { recursive: true })
const res = await createCodexRunner(loadMotorEnv(), { timeoutMs: 90_000 })(
  'Responde exactamente CODEX_OK. No uses herramientas.', cwd, { tools: [], maxTurns: 1 },
)
if (res.code !== 0 || res.json.result.trim() !== 'CODEX_OK') {
  console.error('No se pudo verificar Codex:', res.err || 'Respuesta inesperada.')
  console.error('Desde la raíz: npm run codex -- login. También puedes configurar CODEX_API_KEY en motor/.env.')
  process.exitCode = 1
} else console.log('Codex OK: autenticación y respuesta verificadas.')
