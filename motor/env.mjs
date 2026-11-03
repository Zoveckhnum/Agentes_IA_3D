import { readFileSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'

export function loadMotorEnv() {
  const file = fileURLToPath(new URL('.env', import.meta.url))
  if (!existsSync(file)) {
    if (process.env.AGENTES_DATA_BACKEND === 'sql') return { ...process.env }
    throw new Error('Falta motor/.env. Ejecuta npm run setup desde la raíz.')
  }
  const integrations = new URL('integraciones.env', import.meta.url)
  return {
    ...parseEnv(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')),
    ...(existsSync(integrations) ? Object.fromEntries(Object.entries(parseEnv(readFileSync(integrations, 'utf8'))).filter(([, v]) => v.trim())) : {}),
    ...process.env,
  }
}
