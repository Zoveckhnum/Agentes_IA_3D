import test from 'node:test'
import assert from 'node:assert/strict'
import { databaseConfig } from '../src/config.mjs'
import { applyMutation, applyQuery, documentPath } from '../src/values.mjs'
import { canRead, authorizeWrite } from '../src/policy.mjs'
import { firestoreValue } from '../tools/import-firebase.mjs'
import { passwordDigest, verifyPassword } from '../src/passwords.mjs'
import { Timestamp, encode, revive, configureTransport, doc, db, writeBatch, onSnapshot } from '../../shared/sql-document-client.mjs'

const env = { CORE_DB_SERVER: 'sql.stackbi.com.mx', CORE_DB_PORT: '1433', CORE_DB_NAME: 'AgentesIA3D', CORE_DB_ODBC_DRIVER: 'ODBC Driver 18 for SQL Server', CORE_DB_TRUSTED_CONNECTION: 'true', CORE_DB_ENCRYPT: 'true', CORE_DB_TRUST_SERVER_CERTIFICATE: 'false' }
test('la configuración SQL rechaza políticas inseguras y genera una cadena sin credenciales', () => {
  for (const [key, value] of [['CORE_DB_ENCRYPT', 'false'], ['CORE_DB_TRUSTED_CONNECTION', 'false'], ['CORE_DB_TRUST_SERVER_CERTIFICATE', 'true'], ['CORE_DB_PORT', '1433;UID=x']]) assert.throws(() => databaseConfig({ ...env, [key]: value }))
  const config = databaseConfig(env)
  assert.match(config.connectionString, /Encrypt=Yes;TrustServerCertificate=No/)
  assert.doesNotMatch(config.connectionString, /(?:UID|PWD|Password|User ID)=/i)
  assert.equal(config.pool.max, 3)
})
test('fechas JS y timestamps migrados conservan tiempo y nanosegundos', () => {
  const original = new Date('2026-11-03T10:20:30.123Z')
  const converted = encode({ date: original })
  assert.equal(revive(converted).date.toDate().getTime(), original.getTime())
  const precise = firestoreValue({ timestampValue: '2026-11-03T10:20:30.123456789Z' })
  assert.equal(precise.nanoseconds, 123456789)
  assert.equal(Timestamp.fromMillis(original.getTime()).toMillis(), original.getTime())
})
test('int64 y valores especiales de Firestore se preservan sin redondear', () => {
  assert.deepEqual(firestoreValue({ integerValue: '9223372036854775807' }), { $type: 'int64', value: '9223372036854775807' })
  assert.deepEqual(firestoreValue({ doubleValue: 'NaN' }), { $type: 'double', value: 'NaN' })
})
test('incrementos, mapas anidados, arrays y deleteField conservan semántica', () => {
  const initial = { hours: { '08': 2 }, seconds: 4, list: ['a'], remove: true }
  const merged = applyMutation(initial, { type: 'set', merge: true, data: { hours: { '09': { $op: 'increment', value: 3 } }, seconds: { $op: 'increment', value: 5 } } })
  assert.deepEqual(merged.hours, { '08': 2, '09': 3 }); assert.equal(merged.seconds, 9)
  const updated = applyMutation(merged, { type: 'update', data: { 'hours.08': { $op: 'increment', value: 1 }, list: { $op: 'union', values: ['a', 'b'] }, remove: { $op: 'delete' } } })
  assert.equal(updated.hours['08'], 3); assert.deepEqual(updated.list, ['a', 'b']); assert.equal('remove' in updated, false)
  assert.throws(() => applyMutation(null, { type: 'update', data: {} }))
})
test('se rechaza contaminación de prototipos y rutas ajenas a la API', () => {
  assert.throws(() => applyMutation({}, { type: 'update', data: JSON.parse('{"__proto__.admin":true}') }))
  assert.throws(() => documentPath('users/../private/admin'))
  assert.throws(() => documentPath('credentials/secret'))
  assert.equal({}.admin, undefined)
})
test('filtros y orden de timestamps son consistentes con la app', () => {
  const docs = [{ path: 'tasks/a', data: { estado: 'pendiente', date: Timestamp.fromMillis(100).toJSON() } }, { path: 'tasks/b', data: { estado: 'pendiente', date: Timestamp.fromMillis(200).toJSON() } }]
  assert.equal(applyQuery(docs, { filters: [{ field: 'estado', op: '==', value: 'pendiente' }], order: [{ field: 'date', direction: 'desc' }], limit: 1 })[0].path, 'tasks/b')
})
const employee = { uid: 'employee', email: 'employee@test.invalid', role: 'empleado' }
const admin = { uid: 'admin', email: 'admin@test.invalid', role: 'admin', isSuper: true }
const worker = { uid: 'worker', email: 'worker@test.invalid', worker: true }
const lookup = async path => path === 'agents/agent' ? {} : null

test('el contacto se puede editar sin cambiar la identidad de acceso ni los permisos', async () => {
  const before = { email: employee.email, role: 'empleado', name: 'Persona' }
  const contact = { contactEmail: 'contacto@test.invalid', phone: '+52 55 1234 5678' }
  for (const actor of [employee, admin, { ...admin, isSuper: false }]) {
    await authorizeWrite(actor, { path: 'users/employee' }, before, { ...before, ...contact }, lookup)
    await assert.rejects(authorizeWrite(actor, { path: 'users/employee' }, before, { ...before, email: contact.contactEmail }, lookup))
    for (const contactEmail of ['sin-arroba', 'a @test.invalid', null, 42, 'a'.repeat(321)]) {
      await assert.rejects(authorizeWrite(actor, { path: 'users/employee' }, before, { ...before, contactEmail }, lookup))
    }
    await authorizeWrite(actor, { path: 'users/employee' }, before, { ...before, contactEmail: '' }, lookup)
  }
  await assert.rejects(authorizeWrite(employee, { path: 'users/other' }, before, { ...before, ...contact }, lookup))
  await assert.rejects(authorizeWrite(employee, { path: 'users/employee' }, before, { ...before, ...contact, role: 'admin' }, lookup))
  await assert.rejects(authorizeWrite(worker, { path: 'users/employee' }, before, { ...before, ...contact }, lookup))
})

test('la UI no puede fabricar recibos humanos ni completar una operación pendiente', async () => {
  const before={asignado:'agent',createdBy:admin.email,estado:'en_espera',agentStatus:'needs_approval',humanApprovalRequests:['request-id']}
  await assert.rejects(authorizeWrite(admin,{path:'tasks/test'},before,{...before,humanApprovalRequests:[]},lookup))
  await assert.rejects(authorizeWrite(admin,{path:'tasks/test'},before,{...before,estado:'completada'},lookup))
  await assert.rejects(authorizeWrite(admin,{path:'tasks/test'},before,{...before,humanApprovalHistory:[{status:'executed'}]},lookup))
})
test('el usuario pendiente no puede leer tareas ni adquirir rol de administrador', async () => {
  const pending = { uid: 'new', email: 'new@test.invalid', role: 'pending' }
  assert.equal(canRead(pending, 'tasks/a'), false)
  await assert.rejects(authorizeWrite(pending, { path: 'users/new' }, null, { email: pending.email, role: 'admin' }, lookup))
  await assert.rejects(authorizeWrite(employee, { path: 'users/employee' }, { email: employee.email, role: 'empleado' }, { email: employee.email, role: 'admin' }, lookup))
})
test('los chats privados se limitan a sus participantes', () => {
  assert.equal(canRead(employee, 'chats/admin_employee/messages/a'), true)
  assert.equal(canRead(employee, 'chats/admin_other/messages/a'), false)
  assert.equal(canRead(employee, 'chats/notemployee_other/messages/a'), false)
})
test('un empleado no escribe en tareas ajenas ni falsifica el autor', async () => {
  await assert.rejects(authorizeWrite(employee, { path: 'tasks/a' }, { asignado: 'other', createdBy: 'other@test.invalid', estado: 'en_progreso' }, { asignado: 'other', createdBy: 'other@test.invalid', estado: 'completada' }, lookup))
  await assert.rejects(authorizeWrite(employee, { path: 'tasks/a' }, null, { createdBy: admin.email, estado: 'pendiente' }, lookup))
})
test('la cuenta del motor no puede modificar perfiles ni completar tareas sin QA', async () => {
  await assert.rejects(authorizeWrite(worker, { path: 'users/admin' }, { role: 'admin' }, { role: 'pending' }, lookup))
  const before = { asignado: 'agent', projectId: 'p', estado: 'en_progreso', qualityStatus: 'pending' }
  await assert.rejects(authorizeWrite(worker, { path: 'tasks/a' }, before, { ...before, estado: 'completada' }, lookup))
  await authorizeWrite(worker, { path: 'tasks/a' }, before, { ...before, agentStatus: 'running' }, lookup)
})
test('el dueño conserva su autoridad y no puede borrar su propia cuenta', async () => {
  await assert.rejects(authorizeWrite(admin, { path: 'users/admin' }, { role: 'admin' }, null, lookup))
})
test('las contraseñas se derivan con sal aleatoria y se verifica sin conservar texto plano', async () => {
  const password = 'una-clave-solo-de-prueba-4391'
  const first = await passwordDigest(password), second = await passwordDigest(password)
  assert.notEqual(first, second); assert.equal(await verifyPassword(password, first), true); assert.equal(await verifyPassword('incorrecta', first), false)
  assert.doesNotMatch(first, /una-clave/)
})
test('el batch envía las operaciones juntas y no puede reutilizarse', async () => {
  let received
  configureTransport(async (_path, options) => { received = options.body; return { ok: true } })
  const batch = writeBatch(db)
  batch.update(doc(db, 'tasks', 'one'), { count: { $op: 'increment', value: 1 } }); batch.delete(doc(db, 'tasks', 'two'))
  await batch.commit()
  assert.equal(received.operations.length, 2)
  await assert.rejects(batch.commit())
})
test('un listener dado de baja no entrega respuestas en vuelo', async () => {
  let finish, called = false
  configureTransport(() => new Promise(resolve => { finish = resolve }))
  const stop = onSnapshot(doc(db, 'users', 'u'), () => { called = true })
  stop(); finish({ kind: 'document', path: 'users/u', data: { name: 'test' } })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(called, false)
})
