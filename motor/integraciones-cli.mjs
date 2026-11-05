import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { once } from 'node:events'
import { api, credentialsDir, projects, githubClient, driveToken, driveClient } from './integraciones.mjs'
import { loadMotorEnv } from './env.mjs'
import { registerProject } from './registro-proyectos.mjs'

mkdirSync(credentialsDir, { recursive: true })
const integrations = new URL('integraciones.env', import.meta.url)
if (!existsSync(integrations)) copyFileSync(new URL('integraciones.env.example', import.meta.url), integrations)

async function loginDrive() {
  const clientFile = new URL('google-oauth.json', credentialsDir)
  if (!existsSync(clientFile)) throw new Error('Descarga el cliente OAuth de escritorio de Google y guárdalo en motor/credenciales/google-oauth.json. Consulta docs/INTEGRACIONES.md.')
  const c = JSON.parse(readFileSync(clientFile, 'utf8')).installed
  if (!c?.client_id) throw new Error('El JSON debe corresponder a un cliente OAuth de tipo escritorio.')
  const state = randomBytes(32).toString('hex'), verifier = randomBytes(48).toString('base64url')
  let resolveCode, rejectCode
  const received = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject })
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1')
    if (u.pathname !== '/callback' || u.searchParams.get('state') !== state) { res.writeHead(400).end('Solicitud invalida.'); return }
    if (u.searchParams.has('error')) { res.end('Autorizacion cancelada. Vuelve a la terminal.'); rejectCode(new Error('Google no autorizó el acceso.')); return }
    const code = u.searchParams.get('code')
    if (!code) { res.writeHead(400).end('Falta codigo.'); return }
    res.end('Autorizacion recibida. Vuelve a la terminal para comprobar el resultado.'); resolveCode(code)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const redirect = `http://127.0.0.1:${server.address().port}/callback`
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({ client_id: c.client_id, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/drive.file', access_type: 'offline', prompt: 'consent', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })
  console.log('Abre esta dirección en el navegador DE ESTE PC y autoriza tu cuenta personal:\n' + url)
  const timer = setTimeout(() => rejectCode(new Error('Autorización vencida. Ejecuta drive:login otra vez.')), 5 * 60_000)
  try {
    const code = await received
    const token = await api('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret || '', code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' }) })
    if (!token.refresh_token) throw new Error('No se recibió acceso persistente. Revoca el acceso de esta app en Google y vuelve a autorizar.')
    const drive = driveClient(token.access_token)
    const roots = await drive('/files?' + new URLSearchParams({ q: "trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='agentesRoot' and value='v1' }", fields: 'files(id)', pageSize: '100' }))
    const folder = roots.files[0] || await drive('/files', 'POST', { name: 'Stackbi Office', mimeType: 'application/vnd.google-apps.folder', appProperties: { agentesRoot: 'v1' } })
    writeFileSync(new URL('google-token.json', credentialsDir), JSON.stringify({ refresh_token: token.refresh_token, root: folder.id }), { mode: 0o600 })
    console.log('Drive conectado. Carpeta privada: https://drive.google.com/drive/folders/' + folder.id)
  } finally { clearTimeout(timer); server.close() }
}
async function check() {
  const env = loadMotorEnv()
  const checks = [
    ['Telegram', async () => {
      if (!env.TELEGRAM_BOT_TOKEN) return 'PENDIENTE: token del bot'
      const call = method => api(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`)
      const me = await call('getMe'), hook = await call('getWebhookInfo')
      if (!me.ok || !hook.ok) throw new Error('Telegram rechazó la consulta.')
      if (hook.result.url) return 'BLOQUEADO: hay un webhook activo; elimínalo con Bot API antes de usar polling'
      return env.TELEGRAM_OWNER_ID ? `OK: @${me.result.username}; falta prueba de mensaje desde tu cuenta` : 'PENDIENTE: envía /start al bot y configura TELEGRAM_OWNER_ID'
    }],
    ['GitHub', async () => {
      const entries = Object.entries(projects()).filter(([, p]) => p.github)
      if (!entries.length) return 'PENDIENTE: al menos un proyecto con repositorio'
      for (const [, p] of entries) { const repo = await githubClient(env, p.tokenEnv)(p.github, ''); if (repo.permissions?.push === false) throw new Error('La cuenta no tiene permiso de escritura en un repositorio.') }
      return `OK: acceso a ${entries.length} repositorio(s); escritura y PR se validan con una entrega de prueba`
    }],
    ['Google Drive', async () => {
      const { access, root } = await driveToken()
      await driveClient(access)(`/files/${encodeURIComponent(root)}?fields=id,name`)
      return 'OK: acceso persistente a la carpeta de la app'
    }],
  ]
  let ready = true
  for (const [name, fn] of checks) {
    try { const result = await fn(); console.log(`${name}: ${result}`); if (!result.startsWith('OK')) ready = false }
    catch (e) { ready = false; console.log(`${name}: PENDIENTE — ${e.message}`) }
  }
  if (!ready && process.argv.includes('--strict')) process.exitCode = 1
}
try {
  const command = process.argv[2]
  if (command === 'drive-login') await loginDrive()
  else if (command === 'check') await check()
  else if (command === 'proyecto') {
    const [id, repo, ...name] = process.argv.slice(3)
    if (!id || !repo || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || (repo !== '-' && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))) throw new Error('Uso: npm run proyecto -- id propietario/repositorio Nombre del proyecto. Usa - para solo Drive.')
    registerProject({ id, github: repo === '-' ? '' : repo, nombre: name.join(' ') })
    console.log(`Proyecto ${id} registrado. No se ha creado ni modificado ningún repositorio remoto.`)
  } else throw new Error('Comandos: check, drive-login, proyecto.')
} catch (error) { console.error(error.message); process.exitCode = 1 }
