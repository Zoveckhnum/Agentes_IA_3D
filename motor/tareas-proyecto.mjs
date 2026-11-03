import { mkdirSync, openSync, closeSync, unlinkSync, existsSync, lstatSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'
import { createHash } from 'node:crypto'
import { prepareRepository, checkedDirectory, validateProjectId, taskBranch, gitOptions, runGit } from './espacios-proyecto.mjs'
import { snapshotFiles } from './calidad.mjs'
import { safeFile } from './integraciones.mjs'

const OMIT = new Set(['.agentes', 'dist', 'build', '.next', 'coverage'])
export const projectFiles = cwd => snapshotFiles(cwd, OMIT)
export const fileRevision = files => createHash('sha256').update(JSON.stringify(files.map(({ path, hash }) => ({ path, hash })))).digest('hex')

export async function projectTaskUnchanged(workspace, revision) {
  return fileRevision(projectFiles(workspace.cwd)) === revision
    && await workspace.command(['rev-parse', 'HEAD']) === workspace.head
    && await workspace.command(['branch', '--show-current']) === workspace.branch
}

export async function openProjectTask({ root, projectId, github, taskId, git = runGit }) {
  validateProjectId(projectId)
  const branch = taskBranch(taskId)
  root = realpathSync(root)
  const local = checkedDirectory(root, '.local'); mkdirSync(local, { recursive: true })
  const locks = checkedDirectory(local, 'project-locks'); mkdirSync(locks, { recursive: true })
  const lock = join(locks, `${projectId}.lock`)
  let descriptor
  try { descriptor = openSync(lock, 'wx', 0o600) }
  catch { throw new Error('El proyecto está ocupado o bloqueado. Revisa el motor antes de reintentar.') }
  let released = false
  const release = () => { if (!released) { released = true; closeSync(descriptor); unlinkSync(lock) } }
  try {
    const repository = await prepareRepository({ root, id: projectId, github, git })
    const products = realpathSync(join(root, 'products'))
    const runs = checkedDirectory(products, '.tareas'); mkdirSync(runs, { recursive: true })
    const projectRuns = checkedDirectory(runs, projectId); mkdirSync(projectRuns, { recursive: true })
    const cwd = checkedDirectory(projectRuns, taskId)
    const command = (args, directory = cwd) => git([...gitOptions(), ...args], directory)
    if (!existsSync(cwd)) {
      const branches = await command(['for-each-ref', '--format=%(refname:short)', `refs/heads/${branch}`], repository.cwd)
      if (branches.split(/\r?\n/).includes(branch)) throw new Error('La rama de esta tarea existe fuera de su espacio. Revisa el repositorio antes de continuar.')
      await command(['worktree', 'add', '--no-checkout', '-b', branch, cwd, 'HEAD'], repository.cwd)
      await command(['checkout', 'HEAD'])
    }
    checkedDirectory(projectRuns, taskId)
    const metadata = join(cwd, '.git')
    if (!existsSync(metadata) || lstatSync(metadata).isSymbolicLink() || !lstatSync(metadata).isFile()) throw new Error('El espacio debe ser un worktree administrado, sin enlaces.')
    const top = realpathSync(await command(['rev-parse', '--show-toplevel']))
    const common = realpathSync(resolve(cwd, await command(['rev-parse', '--git-common-dir'])))
    if (relative(cwd, top) || relative(realpathSync(join(repository.cwd, '.git')), common)) throw new Error('El espacio de tarea pertenece a otro repositorio.')
    if (await command(['branch', '--show-current']) !== branch) throw new Error('La rama del espacio de tarea fue cambiada. Se requiere revisión.')
    const state = checkedDirectory(cwd, '.agentes'); mkdirSync(state, { recursive: true })
    return { cwd, state, branch, head: await command(['rev-parse', 'HEAD']), command, release }
  } catch (error) { release(); throw error }
}

// Copia inmutable para insumos y QA; las rutas se derivan del ID, nunca de Firestore.
export function archiveProject(cwd, taskRoot) {
  const files = projectFiles(cwd)
  for (const file of files) safeFile(cwd, file.path)
  // Una carpeta nueva por revisión evita mezclar archivos de intentos anteriores.
  const revision = fileRevision(files)
  const archiveRoot = checkedDirectory(realpathSync(taskRoot), 'revisiones')
  mkdirSync(archiveRoot, { recursive: true })
  const archive = checkedDirectory(archiveRoot, revision)
  const created = !existsSync(archive)
  mkdirSync(archive, { recursive: true })
  if (created) {
    for (const file of files) {
      const target = join(archive, file.path)
      mkdirSync(resolve(target, '..'), { recursive: true })
      writeFileSync(target, file.content, { flag: 'wx' })
    }
  }
  if (fileRevision(projectFiles(archive)) !== revision) throw new Error('El archivo de revisión cambió o está incompleto.')
  return { cwd: archive, revision, files }
}

export function taskInputDirectory(root, id, task) {
  if (!/^[\w-]+$/.test(id)) throw new Error('ID de insumo inválido.')
  const taskRoot = checkedDirectory(realpathSync(root), id)
  if (!task.projectSnapshot) return taskRoot
  if (!/^[a-f0-9]{64}$/.test(task.projectSnapshot)) throw new Error('Revisión de proyecto inválida.')
  const revisions = checkedDirectory(taskRoot, 'revisiones')
  return checkedDirectory(revisions, task.projectSnapshot)
}
