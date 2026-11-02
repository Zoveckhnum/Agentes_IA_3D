// Genera la configuración para un proyecto Firebase real. Para emuladores: npm run setup.
// Uso: node tools/configurar.mjs instalacion.json
//
// instalacion.json (lo puede escribir Codex durante la entrevista; NO lleva contraseñas):
// {
//   "negocio": { "nombre", "descripcion", "identidad", "tono", "color", "idioma", "logo" },
//   "dueno": { "nombre", "email" },
//   "app": { "nombre": "Nombre de la app" },
//   "firebase": { "apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId" },
//   "robotEmail": "correo+agentes@gmail.com",
//   "equipo": [ { "nombre", "rol", "especialidad?", "mision?", "descripcion?", "look?" } ]
// }
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configuredRules } from './reglas.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = process.argv[2]
if (!file || !existsSync(file)) { console.error('Uso: node tools/configurar.mjs instalacion.json'); process.exit(1) }
const r = JSON.parse(readFileSync(file, 'utf8'))
const fb = r.firebase || {}
const need = (v, name) => { if (!v || String(v).startsWith('PEGA_AQUI')) { console.error(`Falta ${name} en ${file}`); process.exit(1) } return v }
need(fb.apiKey, 'firebase.apiKey'); need(fb.projectId, 'firebase.projectId'); need(r.dueno?.email, 'dueno.email'); need(r.robotEmail, 'robotEmail')

const cat = JSON.parse(readFileSync(join(ROOT, 'roles', 'catalogo.json'), 'utf8'))
r.equipo ||= JSON.parse(readFileSync(join(ROOT, 'roles', 'equipo-bi.json'), 'utf8'))
for (const a of r.equipo || []) if (!cat.roles[a.rol]) { console.error(`Rol desconocido "${a.rol}" para ${a.nombre}. Roles: ${Object.keys(cat.roles).join(', ')}`); process.exit(1) }

const color = r.negocio?.color || '#4700E0'
const url = r.app?.url || 'http://127.0.0.1:5173'
// Valida antes de tocar archivos y conserva la instalación previa fuera de Git.
const cloudRules = configuredRules(readFileSync(join(ROOT, 'firestore.rules'), 'utf8'), { owner: r.dueno.email, robot: r.robotEmail })
const backup = join(ROOT, 'motor', 'credenciales', 'antes-nube')
mkdirSync(backup, { recursive: true })
for (const [path, name] of [['app/.env', 'app.env'], ['motor/.env', 'motor.env'], ['motor/negocio.json', 'negocio.json']]) {
  if (existsSync(join(ROOT, path)) && !existsSync(join(backup, name))) copyFileSync(join(ROOT, path), join(backup, name))
}

// app/.env (valores públicos)
writeFileSync(join(ROOT, 'app', '.env'), [
  `VITE_APP_NAME=${r.app?.nombre || `${r.negocio?.nombre || 'Mi'} · Oficina IA`}`,
  `VITE_COMPANY_NAME=${r.negocio?.nombre || 'Mi empresa'}`,
  `VITE_BRAND_COLOR="${color}"`,
  `VITE_LOGO_URL=${r.negocio?.logo || '/logo.svg'}`,
  `VITE_APP_URL=${url}`,
  `VITE_SUPER_ADMIN_EMAIL=${r.dueno.email.toLowerCase()}`,
  'VITE_USE_EMULATORS=false',
  `VITE_FIREBASE_API_KEY=${fb.apiKey}`,
  `VITE_FIREBASE_AUTH_DOMAIN=${fb.authDomain || `${fb.projectId}.firebaseapp.com`}`,
  `VITE_FIREBASE_PROJECT_ID=${fb.projectId}`,
  `VITE_FIREBASE_STORAGE_BUCKET=${fb.storageBucket || `${fb.projectId}.firebasestorage.app`}`,
  `VITE_FIREBASE_MESSAGING_SENDER_ID=${fb.messagingSenderId || ''}`,
  `VITE_FIREBASE_APP_ID=${fb.appId || ''}`,
  '',
].join('\n'))

// motor/.env: conserva contraseña y Telegram si ya existían
const motorEnv = join(ROOT, 'motor', '.env')
const prev = {}
if (existsSync(motorEnv)) for (const l of readFileSync(motorEnv, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) prev[m[1]] = m[2] }
writeFileSync(motorEnv, [
  `AGENT_EMAIL=${r.robotEmail}`,
  `AGENT_PASSWORD=${prev.USE_EMULATORS !== 'true' && prev.AGENT_EMAIL === r.robotEmail ? prev.AGENT_PASSWORD || 'PEGA_AQUI_LA_CONTRASENA' : 'PEGA_AQUI_LA_CONTRASENA'}`,
  'USE_EMULATORS=false',
  `CODEX_MODEL=${prev.CODEX_MODEL || ''}`,
  `CODEX_API_KEY=${prev.CODEX_API_KEY || ''}`,
  `OPENAI_API_KEY=${prev.OPENAI_API_KEY || ''}`,
  `FIREBASE_API_KEY=${fb.apiKey}`,
  `FIREBASE_AUTH_DOMAIN=${fb.authDomain || `${fb.projectId}.firebaseapp.com`}`,
  `FIREBASE_PROJECT_ID=${fb.projectId}`,
  `FIREBASE_STORAGE_BUCKET=${fb.storageBucket || `${fb.projectId}.firebasestorage.app`}`,
  `FIREBASE_MESSAGING_SENDER_ID=${fb.messagingSenderId || ''}`,
  `FIREBASE_APP_ID=${fb.appId || ''}`,
  `TELEGRAM_BOT_TOKEN=${prev.TELEGRAM_BOT_TOKEN || ''}`,
  `TELEGRAM_OWNER_ID=${prev.TELEGRAM_OWNER_ID || ''}`,
  '',
].join('\n'))

// motor/negocio.json: conserva agentes ya creados
const negPath = join(ROOT, 'motor', 'negocio.json')
const old = existsSync(negPath) ? JSON.parse(readFileSync(negPath, 'utf8')) : {}
const created = new Map((old.equipo || []).filter(a => a.id).map(a => [a.nombre, a.id]))
writeFileSync(negPath, JSON.stringify({
  nombre: r.negocio?.nombre || '', descripcion: r.negocio?.descripcion || '', identidad: r.negocio?.identidad || '',
  tono: r.negocio?.tono || '', color, idioma: r.negocio?.idioma || 'español',
  dueno: { nombre: r.dueno.nombre || '', email: r.dueno.email.toLowerCase() },
  equipo: (r.equipo || []).map(a => ({ ...a, ...(created.get(a.nombre) ? { id: created.get(a.nombre) } : {}) })),
  agentes: old.agentes || {},
}, null, 2) + '\n')

// Reglas de Firestore con el correo del robot
mkdirSync(join(ROOT, '.local'), { recursive: true })
writeFileSync(join(ROOT, '.local', 'firestore.cloud.rules'), cloudRules)

// Proyecto de Firebase para el CLI
writeFileSync(join(ROOT, '.firebaserc'), JSON.stringify({ projects: { default: fb.projectId } }, null, 2) + '\n')

console.log('Configuración lista:')
console.log('  app/.env, motor/.env (falta la contraseña del robot si dice PEGA_AQUI), motor/negocio.json, .local/firestore.cloud.rules, .firebaserc')
console.log(`  URL de la app: ${url}`)
console.log(`  Agentes a crear: ${(r.equipo || []).map(a => `${a.nombre} (${cat.roles[a.rol].nombre})`).join(', ') || 'ninguno'}`)
