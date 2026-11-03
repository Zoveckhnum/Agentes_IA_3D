import test from 'node:test'
import assert from 'node:assert/strict'
import { retentionPlan } from '../tools/backup-plan.mjs'
const entry = (date, bytes = 100) => ({ name: `AgentesIA3D-${date.replaceAll('-', '').slice(0, 8)}T030000000Z.bak`, bytes, createdAt: `${date}T03:00:00.000Z`, verified: true })
test('la retención conserva generaciones diarias, semanales y mensuales sin duplicar', () => {
  const backups = Array.from({ length: 95 }, (_, i) => { const date = new Date('2026-11-03T00:00:00Z'); date.setUTCDate(date.getUTCDate() - i); return entry(date.toISOString().slice(0, 10)) })
  const plan = retentionPlan(backups, 2000)
  assert.ok(plan.keep.includes(backups[0].name)); assert.ok(plan.keep.includes(backups[1].name))
  assert.ok(plan.keep.length <= 13); assert.ok(plan.remove.length > 80); assert.equal(new Set(plan.keep).size, plan.keep.length)
})
test('el presupuesto elimina generaciones antiguas sin tocar las dos recientes', () => {
  const backups = [entry('2026-11-03', 80), entry('2026-11-02', 80), entry('2026-11-01', 80)]
  const plan = retentionPlan(backups, 180)
  assert.equal(plan.bytes, 160); assert.deepEqual(plan.remove, [backups[2].name])
})
test('una cuota incompatible con las dos últimas copias falla sin generar un plan de borrado', () => {
  assert.throws(() => retentionPlan([entry('2026-11-03', 100), entry('2026-11-02', 100)], 150))
})
test('se rechazan rutas externas y manifiestos no verificados', () => {
  assert.throws(() => retentionPlan([{ ...entry('2026-11-03'), name: '../otro.bak' }]))
  assert.throws(() => retentionPlan([{ ...entry('2026-11-03'), verified: false }]))
})
