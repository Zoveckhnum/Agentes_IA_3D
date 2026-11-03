import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { registerProject, normalizeRepository } from './registro-proyectos.mjs'

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agentes-registro-')))
  t.after(() => {
    assert.ok(relative(realpathSync(tmpdir()), root).startsWith('agentes-registro-'))
    rmSync(root, { recursive: true, force: true })
  })
  return { root, file: join(root, 'proyectos.json') }
}

test('registra un destino local desde URL y preserva la configuración existente', t => {
  const { root, file } = fixture(t)
  writeFileSync(file, JSON.stringify({ previo: { github: 'equipo/previo', tokenEnv: 'GITHUB_TOKEN_EQUIPO' } }))
  const result = registerProject({ id: 'demo', github: 'https://github.com/equipo/demo.git', nombre: 'Demostración' }, file)
  assert.equal(result.github, 'equipo/demo')
  assert.equal(result.remotoVerificado, false)
  const all = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(all.previo.tokenEnv, 'GITHUB_TOKEN_EQUIPO')
  assert.equal(all.demo.nombre, 'Demostración')
  registerProject({ id: 'previo', github: 'equipo/previo', nombre: 'Actualizado' }, file)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).previo.tokenEnv, 'GITHUB_TOKEN_EQUIPO')
  assert.deepEqual(readdirSync(root), ['proyectos.json'])
})

test('no reasigna destinos ni sobrescribe registros corruptos u ocupados', t => {
  const { file } = fixture(t)
  registerProject({ id: 'demo', github: 'equipo/demo' }, file)
  const before = readFileSync(file, 'utf8')
  assert.throws(() => registerProject({ id: 'demo', github: 'otro/repo' }, file), /otro destino/)
  assert.equal(readFileSync(file, 'utf8'), before)
  writeFileSync(`${file}.lock`, '')
  assert.throws(() => registerProject({ id: 'otro', github: 'otro/repo' }, file), /ocupado/)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('rechaza registros inválidos sin reemplazarlos y permite IDs que coinciden con propiedades heredadas', t => {
  const { file } = fixture(t)
  writeFileSync(file, '{invalido')
  assert.throws(() => registerProject({ id: 'demo', github: 'equipo/demo' }, file), /JSON válido/)
  assert.equal(readFileSync(file, 'utf8'), '{invalido')
  writeFileSync(file, '{}')
  registerProject({ id: 'constructor', github: 'equipo/demo' }, file)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).constructor.github, 'equipo/demo')
})

test('rechaza credenciales, otros proveedores y rutas de repositorio ambiguas', () => {
  for (const value of ['https://usuario:clave@github.com/a/b', 'https://gitlab.com/a/b', 'https://github.com/a/b?token=oculto', 'git@github.com:a/b', '../repo', 'a/b/c', 'https://github.com/a/b#main']) assert.throws(() => normalizeRepository(value))
  assert.equal(normalizeRepository('equipo/demo.git'), 'equipo/demo')
})
