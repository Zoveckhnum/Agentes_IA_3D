import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dependencyReady, continuation, stageInputs } from './continuidad.mjs'

test('la etapa siguiente espera una entrega válida y nunca adelanta QA pendiente o fallido', () => {
  const t = { estado: 'en_espera', agentStatus: 'done' }
  assert.equal(dependencyReady(t), true)
  assert.equal(dependencyReady(t, true), false)
  for (const qualityStatus of ['pending', 'failed', 'blocked']) assert.equal(dependencyReady({ ...t, qualityStatus }), false)
  assert.equal(dependencyReady({ ...t, qualityStatus: 'passed' }, true), true)
  assert.equal(dependencyReady({ ...t, estado: 'en_revision', qualityStatus: 'passed' }), false)
  assert.equal(dependencyReady({ ...t, agentStatus: 'error' }), false)
  assert.equal(dependencyReady(undefined), false)
  const report = { ...t, qualityStatus: 'report', qualityReport: true }
  assert.equal(dependencyReady(report), true)
  assert.equal(dependencyReady(report, true), false)
  assert.equal(dependencyReady({ ...report, qualityReport: false }), false)
  assert.equal(dependencyReady({ ...report, qualityStatus: 'blocked' }), false)
})

test('delegar conserva el objetivo y crea una continuación persistente, idempotente y limitada', () => {
  const context = { request: 'Implementar y guardar en GitHub y Drive', inputs: ['previa'], depth: 0 }
  const a = continuation('telegram:123', ['datos', 'diseno'], context, 'coordinador')
  assert.deepEqual(a, continuation('telegram:123', ['datos', 'diseno'], context, 'coordinador'))
  assert.deepEqual(a.dependsOn, ['previa', 'datos', 'diseno'])
  assert.deepEqual(a.inputTaskIds, ['previa', 'datos', 'diseno'])
  assert.equal(a.coordinationRequest, context.request)
  assert.equal(a.coordinationDepth, 1)
  assert.equal(a.asignado, 'coordinador')
  assert.equal(a.estado, 'pendiente')
  assert.throws(() => continuation('x', ['y'], { ...context, depth: 8 }, 'c'), /etapas/)
})

test('traspasa archivos y evidencia sin acceder a otras tareas ni copiar secretos o entradas recursivas', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentes-continuidad-'))
  const source = join(root, 'datos'), target = join(root, 'siguiente')
  mkdirSync(join(source, 'insumos'), { recursive: true })
  writeFileSync(join(source, 'ventas.csv'), 'dato ficticio')
  writeFileSync(join(source, '.env'), 'NO COPIAR')
  writeFileSync(join(source, 'insumos', 'anterior.txt'), 'NO DUPLICAR')
  const tasks = new Map([['datos', { tarea: 'CSV', agentOutput: 'Listo', qualityStatus: 'passed' }]])
  stageInputs(root, ['datos'], target, tasks)
  assert.equal(readFileSync(join(target, 'insumos/datos/ventas.csv'), 'utf8'), 'dato ficticio')
  assert.throws(() => readFileSync(join(target, 'insumos/datos/.env')))
  assert.throws(() => readFileSync(join(target, 'insumos/datos/insumos/anterior.txt')))
  assert.match(readFileSync(join(target, 'insumos/datos/revision.json'), 'utf8'), /passed/)
  writeFileSync(join(target, 'insumos/datos/obsoleto.txt'), 'archivo de etapa anterior')
  stageInputs(root, ['datos'], target, tasks)
  assert.equal(existsSync(join(target, 'insumos/datos/obsoleto.txt')), false)
  assert.throws(() => stageInputs(root, ['../escape'], target, tasks), /inválido/)
  tasks.get('datos').qualityManifest = [{ path: 'ventas.csv', hash: 'incorrecto' }]
  assert.throws(() => stageInputs(root, ['datos'], target, tasks), /cambió/)
})

test('rechaza un destino enlazado antes de crear o escribir fuera de la tarea', () => {
  const root = mkdtempSync(join(tmpdir(), 'agentes-continuidad-links-'))
  const outside = join(root, 'externo'), source = join(root, 'datos'), target = join(root, 'siguiente')
  for (const dir of [outside, source, target]) mkdirSync(dir)
  writeFileSync(join(source, 'ventas.csv'), 'dato')
  symlinkSync(outside, join(target, 'insumos'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => stageInputs(root, ['datos'], target, new Map([['datos', {}]])), /inválido/)
  assert.equal(existsSync(join(outside, 'datos')), false)
})
