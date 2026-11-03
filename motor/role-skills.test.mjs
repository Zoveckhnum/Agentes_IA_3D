import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { createRoleSkillContext, validateRoleCatalog, verifySkillBundle, roleSummary } from './role-skills.mjs'
import { effectiveRole, effectiveAgentRole } from '../shared/role-profile.mjs'
import { reviewDelivery } from './calidad.mjs'
const catalog = JSON.parse(readFileSync(new URL('../roles/catalogo.json', import.meta.url), 'utf8'))
const lock = JSON.parse(readFileSync(new URL('../roles/skills.lock.json', import.meta.url), 'utf8'))
const hash = text => createHash('sha256').update(text).digest('hex')

test('todos los roles tienen contratos completos y sus bundles fijados se verifican sin red', () => {
  validateRoleCatalog(catalog, lock)
  for (const id of Object.keys(catalog.roles)) {
    const context = createRoleSkillContext(id)
    assert.deepEqual(context.skills.map(s=>s.id), catalog.roles[id].skills)
    assert.ok(context.skills.every(s=>s.source.startsWith('https://skills.sh/') && s.commit.length===40))
    assert.ok(context.text.includes(catalog.roles[id].entregables[0]))
  }
  assert.equal(new Set(Object.values(catalog.roles).flatMap(r=>r.skills)).size, Object.keys(lock.skills).length)
})

test('especialidades separan React, SQL, procesos, datos y QA independiente', () => {
  assert.ok(catalog.roles.frontend_portales.skills.includes('vercel-react-best-practices'))
  assert.ok(catalog.roles.sql_dba.skills.includes('sql-code-review'))
  assert.ok(catalog.roles.devops.skills.includes('powershell-windows'))
  assert.ok(catalog.roles.ingenieria_datos.skills.includes('pandas-pro'))
  assert.ok(catalog.roles.mejora_continua.skills.includes('process-optimization'))
  assert.equal(catalog.roles.qa_software.qualityReviewer, true)
  assert.ok(!createRoleSkillContext('frontend_portales').text.includes('powershell-windows/SKILL.md'))
  assert.ok(!createRoleSkillContext('qa_datos').text.includes('hyperframes-cli'))
})

test('una misión particular no sustituye skills, especialidad ni requisitos de QA', () => {
  const profile = effectiveRole(catalog, 'frontend_portales', { id: 'devops', mision: 'Contexto particular', skills: ['powershell-windows'], qualityReviewers: [], qualityReviewer: true, coordinador: true })
  assert.equal(profile.id, 'frontend_portales')
  assert.equal(profile.mision, catalog.roles.frontend_portales.mision)
  assert.equal(profile.misionPersonalizada, 'Contexto particular')
  assert.deepEqual(profile.skills, catalog.roles.frontend_portales.skills)
  assert.deepEqual(profile.qualityReviewers, ['qa_software'])
  assert.equal(profile.qualityReviewer, false)
  assert.equal(profile.coordinador, false)
  assert.equal(effectiveAgentRole(catalog, { rol: 'sql_dba' }, { rol: 'devops' }).id, 'sql_dba')
  assert.equal(effectiveAgentRole(catalog, {}, { rol: 'devops' }).id, 'devops')
  const sqlBrief = roleSummary(effectiveAgentRole(catalog, { rol: 'sql_dba' }, { rol: 'devops' }))
  assert.ok(sqlBrief.includes(catalog.roles.sql_dba.actividades[0]))
  assert.ok(!sqlBrief.includes('PowerShell'))
})

test('rechaza roles desconocidos, skills desconocidas y autorrevisión', () => {
  assert.throws(()=>createRoleSkillContext('no_existe'), /no registrado/)
  const invalid = structuredClone(catalog)
  invalid.roles.sql_dba.skills.push('sin-revisar')
  assert.throws(()=>validateRoleCatalog(invalid, lock), /no registrada/)
  const self = structuredClone(catalog)
  self.roles.qa_datos.qualityReviewers = ['qa_datos']
  assert.throws(()=>validateRoleCatalog(self, lock), /no independiente/)
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'role-bundle-'))
  const bundle = join(directory, 'roles/vendor/example')
  mkdirSync(bundle, { recursive: true })
  const text = '---\nname: example\ndescription: Una guía de pruebas\n---\nReferencia revisada.'
  writeFileSync(join(bundle, 'SKILL.md'), text)
  const entry = { repo: 'owner/repo', commit: 'a'.repeat(40), name: 'example', localDirectory: 'roles/vendor/example', directoryUrl: 'https://skills.sh/owner/repo/example', files: { 'SKILL.md': hash(text) } }
  return { directory, bundle, entry, cleanup: ()=>rmSync(directory, { recursive: true, force: true }) }
}

test('cambios y archivos añadidos a una skill bloquean su uso antes de ejecutar el modelo', () => {
  const f = fixture()
  try {
    assert.equal(verifySkillBundle(f.directory, 'example', f.entry).files, 1)
    writeFileSync(join(f.bundle, 'SKILL.md'), 'contenido cambiado')
    assert.throws(()=>verifySkillBundle(f.directory, 'example', f.entry), /cambió/)
    writeFileSync(join(f.bundle, 'inject.mjs'), 'throw new Error()')
    assert.throws(()=>verifySkillBundle(f.directory, 'example', f.entry), /manifiesto/)
  } finally { f.cleanup() }
})

test('rechaza destinos fuera de vendor y enlaces antes de leer su contenido', () => {
  const f = fixture()
  try {
    assert.throws(()=>verifySkillBundle(f.directory, 'example', { ...f.entry, localDirectory: '../otro' }), /ruta válida/)
    assert.throws(()=>verifySkillBundle(f.directory, 'example', { ...f.entry, directoryUrl: 'https://otro.example/skill' }), /procedencia/)
    mkdirSync(join(f.directory, 'linked-source'))
    symlinkSync(join(f.directory, 'linked-source'), join(f.bundle, 'references'), process.platform==='win32'?'junction':'dir')
    assert.throws(()=>verifySkillBundle(f.directory, 'example', f.entry), /enlazados/)
  } finally { f.cleanup() }
})

test('la revisión QA usa el rol del revisor y bloquea la entrega si no hay revisor independiente', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'role-qa-'))
  const cwd = join(directory, 'delivery')
  mkdirSync(cwd)
  writeFileSync(join(cwd, 'entrega.txt'), 'Entrega sintética')
  const author = { id: 'author', rol: 'frontend_portales', name: 'Autor' }
  const reviewer = { id: 'reviewer', rol: 'qa_software', name: 'Revisor', active: true }
  const profile = agent => effectiveAgentRole(catalog, agent)
  const calls = []
  const runCodex = async (_prompt, _cwd, options) => {
    calls.push(options)
    return { code: 0, json: { result: JSON.stringify({ verdict: 'passed', summary: 'Prueba simulada', evidence: ['Entrega sintética observada'], issues: [] }) } }
  }
  try {
    const options = { cwd, task: { tarea: 'Verificar entrega sintética' }, author, requiredRoles: ['qa_software'], agents: [author, reviewer], profile, runCodex, result: 'Entrega' }
    const verified = await reviewDelivery(options)
    assert.equal(verified.qualityStatus, 'passed')
    assert.equal(calls[0].roleId, 'qa_software')
    assert.deepEqual(calls[0].tools, [])
    calls.length = 0
    const blocked = await reviewDelivery({ ...options, agents: [author] })
    assert.equal(blocked.qualityStatus, 'blocked')
    assert.equal(calls.length, 0)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
