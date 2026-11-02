import { readFileSync, existsSync, realpathSync, statSync } from 'node:fs'
import { resolve, relative, isAbsolute, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { loadMotorEnv } from './env.mjs'

export const credentialsDir = new URL('credenciales/', import.meta.url)
export const projectsFile = new URL('proyectos.json', import.meta.url)
export function projects() {
  return existsSync(projectsFile) ? JSON.parse(readFileSync(projectsFile, 'utf8')) : {}
}
export function project(id) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id)) throw new Error('ID de proyecto inválido.')
  const p = projects()[id]
  if (!p) throw new Error('Proyecto no registrado. Usa npm run proyecto -- ID PROPIETARIO/REPO.')
  return p
}
export async function api(url, options = {}) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(45_000), redirect: 'error' })
  // No mostramos cuerpos de errores ni URLs con credenciales.
  if (!res.ok) throw new Error(`La integración respondió HTTP ${res.status}. Revisa permisos y configuración.`)
  return res.status === 204 ? null : res.json()
}
export function safeFile(cwd, path) {
  if (isAbsolute(path) || path.split(/[\\/]/).some(p => p === '..' || /^(\.env.*|\.git|credenciales|node_modules)$/i.test(p))) throw new Error('Archivo no permitido.')
  const root = realpathSync(cwd), full = realpathSync(resolve(root, path))
  const rel = relative(root, full)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || !statSync(full).isFile()) throw new Error('El archivo debe estar dentro de la tarea.')
  if (statSync(full).size > 10 * 1024 * 1024) throw new Error('Máximo 10 MB por archivo en esta integración.')
  const bytes = readFileSync(full)
  const text = bytes.toString('utf8')
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|"refresh_token"\s*:|(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?\S{20,}/i.test(text)) throw new Error('Posible credencial en el archivo. Retírala antes de almacenarlo.')
  return { bytes, name: basename(full), path: rel.replaceAll('\\', '/') }
}
export function githubClient(env = loadMotorEnv(), tokenEnv = 'GITHUB_TOKEN') {
  if (!/^GITHUB_TOKEN(?:_[A-Z0-9_]+)?$/.test(tokenEnv)) throw new Error('Nombre de variable de token inválido.')
  if (!env[tokenEnv]) throw new Error(`Falta ${tokenEnv} en motor/integraciones.env.`)
  return (repo, path, method = 'GET', body) => {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Repositorio inválido; usa propietario/repositorio.')
    return api(`https://api.github.com/repos/${repo}${path}`, {
      method, headers: { Authorization: `Bearer ${env[tokenEnv]}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  }
}
export async function githubRead(id, path = '') {
  const p = project(id), gh = githubClient(loadMotorEnv(), p.tokenEnv)
  if (path.split('/').some(x => x === '..' || x.startsWith('.env'))) throw new Error('Ruta no permitida.')
  return gh(p.github, '/contents/' + path.split('/').map(encodeURIComponent).join('/'))
}
export async function githubDraft(id, cwd, paths, title) {
  const p = project(id), gh = githubClient(loadMotorEnv(), p.tokenEnv)
  if (!paths.length || paths.length > 30) throw new Error('Selecciona entre 1 y 30 archivos.')
  const files = paths.map(path => safeFile(cwd, path))
  if (files.some(f => f.path.toLowerCase().startsWith('.github/'))) throw new Error('Esta integración no modifica workflows ni configuración de GitHub.')
  const repo = await gh(p.github, '')
  const base = await gh(p.github, `/git/ref/heads/${encodeURIComponent(repo.default_branch)}`)
  const commit = await gh(p.github, `/git/commits/${base.object.sha}`)
  // Una rama nueva por entrega: no sobrescribe revisiones anteriores ni ramas del usuario.
  const branch = `agentes/${id}/${Date.now()}-${createHash('sha256').update(cwd).digest('hex').slice(0, 8)}`
  const tree = []
  for (const f of files) {
    const blob = await gh(p.github, '/git/blobs', 'POST', { content: f.bytes.toString('base64'), encoding: 'base64' })
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha })
  }
  const built = await gh(p.github, '/git/trees', 'POST', { base_tree: commit.tree.sha, tree })
  const saved = await gh(p.github, '/git/commits', 'POST', { message: title.slice(0, 200), tree: built.sha, parents: [base.object.sha] })
  await gh(p.github, '/git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: saved.sha })
  const pr = await gh(p.github, '/pulls', 'POST', { title: title.slice(0, 200), head: branch, base: repo.default_branch, draft: true, body: 'Entrega de agentes para revisión humana. Consulta el resultado de QA en la plataforma antes de integrar. No implica aprobación de producción.' })
  return { url: pr.html_url, branch, commit: saved.sha }
}
export async function driveToken() {
  const file = new URL('google-token.json', credentialsDir)
  const clientFile = new URL('google-oauth.json', credentialsDir)
  if (!existsSync(file) || !existsSync(clientFile)) throw new Error('Google Drive pendiente: ejecuta npm run drive:login.')
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  const client = JSON.parse(readFileSync(clientFile, 'utf8')).installed
  if (!client || !saved.refresh_token) throw new Error('Falta autorización OAuth de escritorio.')
  const tokens = await api('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret || '', refresh_token: saved.refresh_token, grant_type: 'refresh_token' }) })
  return { access: tokens.access_token, root: saved.root }
}
export function driveClient(access) {
  return (path, method = 'GET', body) => api('https://www.googleapis.com/drive/v3' + path, { method, headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
}
async function driveProject(id, create = false) {
  const p = project(id), { access, root } = await driveToken(), drive = driveClient(access)
  if (!/^[A-Za-z0-9_-]+$/.test(root || '')) throw new Error('Carpeta raíz de Drive inválida. Repite drive:login.')
  const q = `'${root}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='project' and value='${id}' }`
  const folders = await drive('/files?' + new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '100' }))
  let folder = folders.files[0]
  if (!folder && create) folder = await drive('/files', 'POST', { name: p.nombre || id, mimeType: 'application/vnd.google-apps.folder', parents: [root], appProperties: { project: id } })
  return { drive, access, folder }
}
export async function driveList(id) {
  const { drive, folder } = await driveProject(id)
  if (!folder) return { files: [] }
  return drive('/files?' + new URLSearchParams({ q: `'${folder.id}' in parents and trashed = false`, fields: 'nextPageToken,files(id,name,webViewLink,modifiedTime)', orderBy: 'modifiedTime desc', pageSize: '100' }))
}
export async function driveUpload(id, cwd, path) {
  const f = safeFile(cwd, path), { access, folder } = await driveProject(id, true)
  const boundary = 'agentes_' + createHash('sha256').update(String(Date.now())).digest('hex')
  const metadata = { name: `${new Date().toISOString().replaceAll(':', '-')}-${f.name}`, parents: [folder.id], appProperties: { project: id, sha256: createHash('sha256').update(f.bytes).digest('hex') } }
  const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`), f.bytes, Buffer.from(`\r\n--${boundary}--\r\n`)])
  return api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', { method: 'POST', headers: { Authorization: `Bearer ${access}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body })
}
