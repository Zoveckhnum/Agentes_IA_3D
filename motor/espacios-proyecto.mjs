import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute, join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { devNull } from 'node:os'

const execute = promisify(execFile)
const SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/
const TASK = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i

export function validateProjectId(id) {
  if (typeof id !== 'string' || !SLUG.test(id) || RESERVED.test(id)) throw new Error('ID de proyecto inválido o reservado por Windows.')
  return id
}

export function taskBranch(taskId) {
  if (typeof taskId !== 'string' || !TASK.test(taskId) || RESERVED.test(taskId)) throw new Error('ID de tarea inválido o reservado por Windows.')
  return `agent/${taskId}`
}

export function repositoryUrl(repo) {
  if (typeof repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repo)) throw new Error('Repositorio inválido; usa propietario/repositorio de GitHub.')
  return `https://github.com/${repo.replace(/\.git$/i, '')}.git`
}

// Rechaza junctions y enlaces antes de crear o usar los directorios administrados.
export function checkedDirectory(parent, name) {
  const target = resolve(parent, name)
  const rel = relative(parent, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Ruta de proyecto fuera del directorio autorizado.')
  if (existsSync(target)) {
    const stat = lstatSync(target)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('El directorio del proyecto no puede ser un enlace ni un archivo.')
    if (relative(parent, realpathSync(target)) !== rel) throw new Error('Destino de proyecto inválido.')
  } else {
    // existsSync devuelve false para enlaces rotos; lstat permite detectarlos.
    try { lstatSync(target); throw new Error('Destino de proyecto inválido.') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return target
}

export async function runGit(args, cwd) {
  try {
    const { stdout } = await execute('git', args, {
      cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true,
    })
    return stdout.trim()
  } catch {
    // stderr puede contener URLs, credenciales o mensajes de un servidor remoto.
    throw new Error('Git no completó la operación. Comprueba acceso, rama y estado del repositorio local. No se ha publicado ningún cambio.')
  }
}

export const gitOptions = () => ['-c', `core.hooksPath=${devNull}`, '-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never']

export async function prepareRepository({ root, id, github, git = runGit }) {
  validateProjectId(id)
  const remote = repositoryUrl(github)
  const workspace = realpathSync(resolve(root))
  const products = checkedDirectory(workspace, 'products')
  mkdirSync(products, { recursive: true })
  const cwd = checkedDirectory(products, id)
  // Todas las operaciones son argumentos estructurados; nunca se invoca un shell.
  const options = gitOptions()
  const command = (args, dir = cwd) => git([...options, ...args], dir)
  const created = !existsSync(cwd)
  if (created) {
    // Sin checkout: la primera escritura de archivos se hace después de validar Git.
    await command(['clone', '--no-checkout', '--no-recurse-submodules', '--', remote, cwd], products)
  }
  checkedDirectory(products, id)
  const gitDir = checkedDirectory(cwd, '.git')
  if (!existsSync(gitDir)) throw new Error('El destino existe pero no es un repositorio independiente. Consérvalo y usa otro ID.')
  const top = await command(['rev-parse', '--show-toplevel'])
  if (relative(realpathSync(cwd), realpathSync(top))) {
    if(process.env.APP_CI_GIT_DIAG==='true') console.error(JSON.stringify({event:'ci_git_path_mismatch',expected:realpathSync(cwd),actual:realpathSync(top),gitEnvironmentKeys:Object.keys(process.env).filter(n=>n.startsWith('GIT_'))}))
    throw new Error('El repositorio no coincide con el directorio del proyecto.')
  }
  const origin = await command(['remote', 'get-url', 'origin'])
  if (origin !== remote) throw new Error('El repositorio local tiene otro origen. No se cambiará automáticamente.')
  if (created) await command(['checkout', '--detach', 'HEAD'])
  const status = await command(['status', '--porcelain', '--untracked-files=all'])
  if (status) throw new Error('El proyecto tiene cambios pendientes. Guárdalos antes de preparar otra tarea.')
  return { cwd, remote }
}

export async function prepareProject({ root, id, github, taskId, git = runGit }) {
  const branch = taskBranch(taskId)
  const { cwd, remote } = await prepareRepository({ root, id, github, git })
  const command = args => git([...gitOptions(), ...args], cwd)
  const current = await command(['branch', '--show-current'])
  if (current === branch) return { cwd, branch, remote }
  const branches = await command(['for-each-ref', '--format=%(refname:short)', `refs/heads/${branch}`])
  if (branches.split(/\r?\n/).includes(branch)) throw new Error('La rama de tarea ya existe. Revísala antes de reutilizarla.')
  await command(['switch', '--no-guess', '-c', branch])
  return { cwd, branch, remote }
}
