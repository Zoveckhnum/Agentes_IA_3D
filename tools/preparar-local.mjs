// Configuración de demostración. No sobrescribe una instalación existente.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { configuredRules } from './reglas.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const writeNew = (file, content) => {
  const path = join(root, file)
  if (existsSync(path)) { console.log(`Conservado: ${file}`); return }
  writeFileSync(path, content)
  console.log(`Creado: ${file}`)
}
mkdirSync(join(root, '.local'), { recursive: true })
writeNew('app/.env', `VITE_APP_NAME=Stackbi Office
VITE_COMPANY_NAME=Mi oficina local
VITE_SUPER_ADMIN_EMAIL=admin@oficina.local
VITE_APP_URL=http://127.0.0.1:5173
VITE_FIREBASE_API_KEY=demo-local-key
VITE_FIREBASE_AUTH_DOMAIN=demo-agentes-ia-3d.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=demo-agentes-ia-3d
VITE_USE_EMULATORS=true
`)
writeNew('motor/.env', `AGENT_EMAIL=robot@oficina.local
AGENT_PASSWORD=solo-emulador-local
FIREBASE_API_KEY=demo-local-key
FIREBASE_PROJECT_ID=demo-agentes-ia-3d
USE_EMULATORS=true
# Vacío: usa el modelo predeterminado de tu cuenta Codex.
CODEX_MODEL=
# API opcional; vacío: usa la sesión de codex login.
CODEX_API_KEY=
TELEGRAM_BOT_TOKEN=
TELEGRAM_OWNER_ID=
`)
writeNew('motor/negocio.json', JSON.stringify({
  nombre: 'Mi oficina local', descripcion: 'Equipo de agentes de IA para mis proyectos.',
  tono: 'Claro y directo', idioma: 'español', color: '#4700E0',
  dueno: { nombre: 'Administrador', email: 'admin@oficina.local' },
  equipo: [
    { nombre: 'Coordinador', rol: 'coordinador' },
    { nombre: 'Redacción', rol: 'copies_redes' },
    { nombre: 'Investigación', rol: 'investigacion' },
  ], agentes: {},
}, null, 2) + '\n')
const rules = readFileSync(join(root, 'firestore.rules'), 'utf8')
writeFileSync(join(root, '.local/firestore.rules'), configuredRules(rules, { owner: 'admin@oficina.local', robot: 'robot@oficina.local', emulator: true }))
if (!existsSync(join(root, '.local/data/firebase-export-metadata.json'))) {
  mkdirSync(join(root, '.local/data'), { recursive: true })
}
console.log('Configuración local lista. Instala dependencias en app/ y motor/. Después: npm run local')
