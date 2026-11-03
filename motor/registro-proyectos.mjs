import { readFileSync, writeFileSync, existsSync, lstatSync, openSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { validateProjectId, repositoryUrl } from './espacios-proyecto.mjs'

export const registryFile = new URL('proyectos.json', import.meta.url)

export function normalizeRepository(value) {
  if (typeof value !== 'string') throw new Error('Indica propietario/repositorio o una URL HTTPS de GitHub.')
  let repo = value.trim()
  if (repo.startsWith('https://')) {
    const url = new URL(repo)
    if (url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash) throw new Error('Usa una URL de GitHub sin credenciales ni parámetros.')
    repo = url.pathname.replace(/^\//, '').replace(/\/$/, '')
  }
  return repositoryUrl(repo).slice('https://github.com/'.length, -4)
}

// La ruta es inyectable solo desde código para pruebas; no se expone al agente.
export function registerProject({ id, github = '', nombre = '' }, file = registryFile) {
  validateProjectId(id)
  const repo = github === '' ? '' : normalizeRepository(github)
  if (typeof nombre !== 'string' || nombre.length > 160 || /[\r\n\x00-\x1f]/.test(nombre)) throw new Error('Nombre de proyecto inválido (máximo 160 caracteres, una línea).')
  const path = file instanceof URL ? fileURLToPath(file) : file
  const lock = `${path}.lock`, temporary = `${path}.${randomUUID()}.tmp`
  let descriptor
  try { descriptor = openSync(lock, 'wx', 0o600) }
  catch { throw new Error('El registro está ocupado o no se puede escribir. Intenta de nuevo; no se cambió ningún destino.') }
  try {
    let all = {}
    if (existsSync(path)) {
      if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error('El registro debe ser un archivo local sin enlaces.')
      try { all = JSON.parse(readFileSync(path, 'utf8')) }
      catch { throw new Error('El registro no contiene JSON válido. No se sobrescribió.') }
      if (!all || typeof all !== 'object' || Array.isArray(all)) throw new Error('El registro debe contener un objeto de proyectos.')
    }
    const previous = Object.hasOwn(all, id) ? all[id] : null
    if (previous && String(previous.github || '').toLowerCase() !== repo.toLowerCase()) throw new Error('El ID ya tiene otro destino. Usa otro ID para conservar su historial.')
    const entry = { ...previous, nombre: nombre.trim() || previous?.nombre || id, github: previous?.github || repo }
    Object.defineProperty(all, id, { value: entry, enumerable: true, configurable: true, writable: true })
    writeFileSync(temporary, JSON.stringify(all, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
    // No devolver configuración adicional, como el nombre de variables de tokens.
    return { proyecto: id, nombre: entry.nombre, github: entry.github, estado: previous ? 'actualizado' : 'registrado', remotoVerificado: false }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
    closeSync(descriptor)
    unlinkSync(lock)
  }
}
