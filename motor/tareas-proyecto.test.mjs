import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { openProjectTask, archiveProject, taskInputDirectory, projectFiles, fileRevision, projectTaskUnchanged } from './tareas-proyecto.mjs'
import { stageInputs, continuation } from './continuidad.mjs'
import { reviewDelivery } from './calidad.mjs'

const git = (args, cwd) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agentes-proyecto-')))
  t.after(() => {
    assert.ok(relative(realpathSync(tmpdir()), root).startsWith('agentes-proyecto-'))
    rmSync(root, { recursive: true, force: true })
  })
  const repo = join(root, 'products/demo')
  mkdirSync(repo, { recursive: true })
  git(['init', '-b', 'main'], repo)
  git(['remote', 'add', 'origin', 'https://github.com/equipo/demo.git'], repo)
  writeFileSync(join(repo, 'app.js'), 'export const ventas = 1\n')
  git(['add', 'app.js'], repo)
  git(['-c', 'user.name=Pruebas', '-c', 'user.email=pruebas@example.invalid', 'commit', '-m', 'Base'], repo)
  const taskRoot = join(root, 'trabajos/origen')
  mkdirSync(taskRoot, { recursive: true })
  return { root, repo, taskRoot, args: { root, projectId: 'demo', github: 'equipo/demo', taskId: 'origen', git: async (args, cwd) => git(args, cwd) } }
}

test('el agente escribe en su worktree, preserva el checkout del dueño y retoma correcciones sin borrar cambios', async t => {
  const { args, repo } = fixture(t)
  const task = await openProjectTask(args)
  try {
    assert.equal(task.branch, 'agent/origen')
    writeFileSync(join(task.cwd, 'app.js'), 'export const ventas = 2\n')
    assert.match(readFileSync(join(repo, 'app.js'), 'utf8'), /ventas = 1/)
    assert.equal(git(['branch', '--show-current'], repo), 'main')
    await assert.rejects(openProjectTask({ ...args, taskId: 'paralela' }), /ocupado/)
  } finally { task.release() }
  const resumed = await openProjectTask(args)
  try { assert.match(readFileSync(join(resumed.cwd, 'app.js'), 'utf8'), /ventas = 2/) }
  finally { resumed.release() }
  const next = await openProjectTask({ ...args, taskId: 'siguiente' })
  try { assert.match(readFileSync(join(next.cwd, 'app.js'), 'utf8'), /ventas = 1/) }
  finally { next.release() }
})

test('QA y las etapas siguientes usan archivos archivados y detectan alteraciones posteriores', async t => {
  const { root, taskRoot, args } = fixture(t)
  const task = await openProjectTask(args)
  try {
    writeFileSync(join(task.cwd, 'app.js'), 'export const ventas = 2\n')
    writeFileSync(join(task.state, 'tarea.md'), 'Contexto interno')
    const archive = archiveProject(task.cwd, taskRoot)
    assert.equal(await projectTaskUnchanged(task, archive.revision), true)
    assert.equal(existsSync(join(archive.cwd, '.git')), false)
    assert.equal(existsSync(join(archive.cwd, '.agentes')), false)
    const quality = await reviewDelivery({ cwd: archive.cwd, task: { tarea: 'Validar ventas' }, author: { id: 'autor' }, requiredRoles: ['qa'], agents: [{ id: 'revisor', name: 'QA' }], profile: () => ({ id: 'qa', qualityReviewer: true }), result: 'Implementado', runCodex: async (_, cwd) => {
      assert.match(readFileSync(join(cwd, 'app.js'), 'utf8'), /ventas = 2/)
      return { code: 0, json: { result: JSON.stringify({ verdict: 'passed', summary: 'Validado', evidence: ['Archivo de la revisión comprobado'], issues: [] }) } }
    } })
    assert.equal(quality.qualityStatus, 'passed')
    const recorded = { tarea: 'Ventas', projectId: 'demo', projectSnapshot: archive.revision, ...quality }
    const tasks = new Map([['origen', recorded]])
    const target = join(root, 'trabajos/siguiente')
    stageInputs(join(root, 'trabajos'), ['origen'], target, tasks)
    assert.match(readFileSync(join(target, 'insumos/origen/app.js'), 'utf8'), /ventas = 2/)
    writeFileSync(join(task.cwd, 'app.js'), 'Cambio durante QA')
    assert.notEqual(fileRevision(projectFiles(task.cwd)), archive.revision)
    assert.equal(await projectTaskUnchanged(task, archive.revision), false)
    assert.match(readFileSync(join(archive.cwd, 'app.js'), 'utf8'), /ventas = 2/)
    writeFileSync(join(archive.cwd, 'app.js'), 'Archivo alterado')
    assert.throws(() => stageInputs(join(root, 'trabajos'), ['origen'], target, tasks), /cambió/)
    writeFileSync(join(task.cwd, 'app.js'), 'export const ventas = 2\n')
    assert.throws(() => archiveProject(task.cwd, taskRoot), /cambió o está incompleto/)
    git(['switch', '-c', 'rama-ajena'], task.cwd)
    assert.equal(await projectTaskUnchanged(task, archive.revision), false)
    git(['switch', task.branch], task.cwd)
    git(['-c', 'user.name=Pruebas', '-c', 'user.email=pruebas@example.invalid', 'commit', '--allow-empty', '-m', 'Commit durante QA'], task.cwd)
    assert.equal(await projectTaskUnchanged(task, archive.revision), false)
  } finally { task.release() }
})

test('bloquea destinos enlazados, referencias falsas y archivos con credenciales antes de archivar', async t => {
  const { root, args, taskRoot } = fixture(t)
  const task = await openProjectTask(args)
  try {
    writeFileSync(join(task.cwd, 'clave.txt'), '-----BEGIN PRIVATE KEY-----')
    assert.throws(() => archiveProject(task.cwd, taskRoot), /credencial/)
    assert.throws(() => taskInputDirectory(join(root, 'trabajos'), 'origen', { projectSnapshot: '../fuera' }), /inválida/)
  } finally { task.release() }
  const projectRuns = join(root, 'products/.tareas/demo')
  symlinkSync(args.root, join(projectRuns, 'enlace'), 'junction')
  await assert.rejects(openProjectTask({ ...args, taskId: 'enlace' }), /enlace/)
  assert.equal(existsSync(join(root, '.local/project-locks/demo.lock')), false)
})

test('la continuación conserva el proyecto de la solicitud', () => {
  assert.equal(continuation('solicitud', ['origen'], { request: 'Mejorar ventas', projectId: 'demo' }, 'coordinador').projectId, 'demo')
})
