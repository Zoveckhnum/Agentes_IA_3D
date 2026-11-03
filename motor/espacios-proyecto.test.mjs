import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import { execFileSync } from 'node:child_process'
import { prepareProject, validateProjectId, taskBranch, repositoryUrl } from './espacios-proyecto.mjs'

function fixture(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agentes-espacios-')))
  t.after(() => {
    const parent = realpathSync.native(tmpdir())
    assert.ok(relative(parent, resolve(root)).startsWith('agentes-espacios-'))
    rmSync(root, { recursive: true, force: true })
  })
  return root
}
const git = (args, cwd) => execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
// Sustituye exclusivamente la descarga remota por un repositorio local real.
async function localClone(args, cwd) {
  const index = args.indexOf('clone')
  if (index < 0) return git(args, cwd)
  const target = args.at(-1), origin = args.at(-2)
  mkdirSync(target)
  git(['init', '-b', 'main'], target)
  git(['remote', 'add', 'origin', origin], target)
  git(['-c', 'user.name=Pruebas', '-c', 'user.email=pruebas@example.invalid', 'commit', '--allow-empty', '-m', 'Inicial'], target)
  return ''
}

test('identificadores y destinos rechazan escapes, opciones, dispositivos Windows y URLs con credenciales', () => {
  for (const id of ['../app', 'C:\\Windows', '--force', 'CON', 'nul', 'com1', 'a/b', '']) assert.throws(() => validateProjectId(id))
  for (const id of ['../main', '--force', 'main;echo', 'a\nb', 'NUL']) assert.throws(() => taskBranch(id))
  for (const repo of ['https://usuario:clave@github.com/a/b', '../a', '-a/b', 'a/b/c', 'a/..']) assert.throws(() => repositoryUrl(repo))
  assert.equal(taskBranch('tarea-123'), 'agent/tarea-123')
  assert.equal(repositoryUrl('equipo/producto'), 'https://github.com/equipo/producto.git')
})

test('prepara un repositorio independiente y una rama de tarea sin push ni ejecutar hooks', async t => {
  const root = fixture(t), calls = []
  const args = { root, id: 'demo', github: 'equipo/demo', taskId: 't-1', git: async (a, cwd) => { calls.push(a); return localClone(a, cwd) } }
  const prepared = await prepareProject(args)
  assert.equal(prepared.cwd, join(root, 'products', 'demo'))
  assert.equal(git(['branch', '--show-current'], prepared.cwd), 'agent/t-1')
  assert.equal(realpathSync.native(git(['rev-parse', '--show-toplevel'], prepared.cwd)), realpathSync.native(prepared.cwd))
  assert.ok(calls.every(a => a.includes('protocol.file.allow=never') && a.some(x => x.startsWith('core.hooksPath='))))
  assert.ok(!calls.some(a => a.includes('push') || a.includes('reset') || a.includes('clean')))
  await prepareProject(args)
  assert.equal(calls.filter(a => a.includes('clone')).length, 1)
})

test('preserva cambios pendientes y rechaza repositorios de otro origen o ramas anteriores', async t => {
  const root = fixture(t)
  const args = { root, id: 'demo', github: 'equipo/demo', taskId: 't-1', git: localClone }
  const { cwd } = await prepareProject(args)
  writeFileSync(join(cwd, '.git', 'hooks', 'post-checkout'), '#!/bin/sh\nexit 77\n', { mode: 0o755 })
  await prepareProject({ ...args, taskId: 't-2' })
  await assert.rejects(prepareProject(args), /rama de tarea ya existe/)
  writeFileSync(join(cwd, 'pendiente.txt'), 'Trabajo sin guardar')
  await assert.rejects(prepareProject({ ...args, taskId: 't-3' }), /cambios pendientes/)
  assert.equal(git(['branch', '--show-current'], cwd), 'agent/t-2')
  await assert.rejects(prepareProject({ ...args, github: 'otro/destino' }), /otro origen/)
})

test('rechaza carpetas existentes ajenas y junctions antes de invocar Git', async t => {
  const root = fixture(t)
  mkdirSync(join(root, 'products', 'demo'), { recursive: true })
  const args = { root, id: 'demo', github: 'equipo/demo', taskId: 't-1', git: () => { throw new Error('Git no debería ejecutarse') } }
  await assert.rejects(prepareProject(args), /repositorio independiente/)
  mkdirSync(join(root, 'externo'))
  symlinkSync(join(root, 'externo'), join(root, 'products', 'enlace'), 'junction')
  await assert.rejects(prepareProject({ ...args, id: 'enlace' }), /enlace/)
})
