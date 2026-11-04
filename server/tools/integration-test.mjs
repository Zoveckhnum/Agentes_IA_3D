import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { createDatabase, sql } from '../src/db.mjs'
import { databaseConfig } from '../src/config.mjs'
import { migrateSchema } from './migrate-schema.mjs'
import { passwordDigest } from '../src/passwords.mjs'
import { createApplication } from '../src/main.mjs'
import {verifyOfficeIntegration} from '../../office/sql-integration.mjs'

const name = `AgentesIA3D_Test_${randomBytes(5).toString('hex')}`
const master = createDatabase(databaseConfig({ ...process.env, CORE_DB_NAME: 'master' }))
let database, server, created = false, assertions = 0
const check = (actual, expected) => { assert.equal(actual, expected); assertions++ }
try {
  await new sql.Request(await master.pool()).query(`IF DB_ID('${name}') IS NOT NULL THROW 50000,'La base de prueba ya existe',1; CREATE DATABASE [${name}];`)
  created = true
  database = createDatabase(databaseConfig({ ...process.env, CORE_DB_NAME: name }))
  await migrateSchema(database)
  await migrateSchema(database)
  const pool = await database.pool()
  const password = randomBytes(24).toString('base64url'), digest = await passwordDigest(password)
  for (const [uid, role, rotate] of [['owner', 'admin', false], ['employee', 'empleado', false], ['other', 'empleado', false], ['pending', 'pending', true]]) {
    await new sql.Request(pool).input('uid', sql.NVarChar(128), uid).input('email', sql.NVarChar(320), `${uid}@test.invalid`).input('digest', sql.VarChar(300), digest).input('rotate', sql.Bit, rotate)
      .query('INSERT INTO app.Accounts(Uid,Email,PasswordDigest,MustChangePassword) VALUES(@uid,@email,@digest,@rotate)')
    await new sql.Request(pool).input('path', sql.NVarChar(450), `users/${uid}`).input('uid', sql.NVarChar(200), uid).input('payload', sql.NVarChar(sql.MAX), JSON.stringify({ email: `${uid}@test.invalid`, role }))
      .query("INSERT INTO app.Documents(Path,CollectionPath,DocumentId,Payload) VALUES(@path,N'users',@uid,@payload)")
  }
  const seed = async (path, data) => { const parts = path.split('/'); await new sql.Request(pool).input('path', sql.NVarChar(450), path).input('collection', sql.NVarChar(400), parts.slice(0, -1).join('/')).input('id', sql.NVarChar(200), parts.at(-1)).input('payload', sql.NVarChar(sql.MAX), JSON.stringify(data)).query('INSERT INTO app.Documents(Path,CollectionPath,DocumentId,Payload) VALUES(@path,@collection,@id,@payload)') }
  await seed('agents/agent', { name: 'Synthetic test agent' })
  await seed('tasks/shared', { asignado: 'agent', createdBy: 'owner@test.invalid', estado: 'pendiente', counter: 0 })
  await seed('chats/employee_other/messages/one', { text: 'private', from: 'employee' })
  await seed('chats/other_owner/messages/two', { text: 'not-for-employee', from: 'owner' })
  const config = { origin: '', secureCookies: false, workerToken: randomBytes(48).toString('base64url'), workerUid: 'worker', workerEmail: 'worker@test.invalid', ownerUid: 'owner', maxDocuments: 5000, maxBodyBytes: 2 * 1024 * 1024 }
  const app = createApplication(database, config)
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  config.origin = `http://127.0.0.1:${server.address().port}`
  const cookies = {}
  async function call(path, body, who, headers = {}) {
    const response = await fetch(`${config.origin}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/json', ...(who ? { Cookie: cookies[who] || '' } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) })
    const json = await response.json()
    const cookie = response.headers.get('set-cookie')
    if (who && cookie) cookies[who] = cookie.split(';')[0]
    return { status: response.status, json }
  }
  check((await call('/api/auth/me')).status, 401)
  for (const who of ['owner', 'employee', 'pending']) check((await call('/api/auth/login', { email: `${who}@test.invalid`, password }, who)).status, 200)
  check((await call('/api/data/read', { kind: 'collection', path: 'tasks' }, 'pending')).status, 403)
  check((await call('/api/data/read', { kind: 'collection', path: 'tasks' }, 'owner', { Origin: 'https://untrusted.invalid' })).status, 403)
  const read = (path, who = 'owner') => call('/api/data/read', { kind: 'document', path }, who)
  const commit = (operations, who = 'owner', id = randomUUID(), headers) => call('/api/data/commit', { id, operations }, who, headers)
  const photoUrl = 'https://example.invalid/avatar.png'
  check((await commit([{ type: 'update', path: 'agents/agent', data: { photo: photoUrl } }])).status, 200)
  check((await read('agents/agent')).json.data.photo, photoUrl)
  const uploadedPhoto = 'data:image/jpeg;base64,/9j/2Q=='
  check((await commit([{ type: 'update', path: 'agents/agent', data: { photo: uploadedPhoto } }])).status, 200)
  check((await read('agents/agent')).json.data.photo, uploadedPhoto)
  check((await commit([{ type: 'update', path: 'users/employee', data: { role: 'admin' } }], 'employee')).status, 403)
  check((await read('chats/other_owner/messages/two', 'employee')).status, 403)
  check((await read('chats/employee_other/messages/one', 'employee')).status, 200)
  const failed = await commit([{ type: 'set', path: 'tasks/atomic-rollback', data: { estado: 'pendiente', createdBy: 'owner@test.invalid' } }, { type: 'delete', path: 'users/owner' }])
  check(failed.status, 403); check((await read('tasks/atomic-rollback')).json.data, null)
  const increment = [{ type: 'update', path: 'tasks/shared', data: { counter: { $op: 'increment', value: 1 } } }]
  const id = randomUUID()
  check((await commit(increment, 'owner', id)).status, 200)
  check((await commit(increment, 'owner', id)).json.duplicate, true)
  check((await read('tasks/shared')).json.data.counter, 1)
  const simultaneous = await Promise.all(Array.from({ length: 9 }, () => commit(increment, null, randomUUID(), { Authorization: `Bearer ${config.workerToken}` })))
  for (const r of simultaneous) check(r.status, 200)
  check((await read('tasks/shared')).json.data.counter, 10)
  const leaseHeaders = { Authorization: `Bearer ${config.workerToken}` }
  const claim = owner => call('/api/data/commit', { id: randomUUID(), operations: [{ type: 'update', path: 'tasks/shared', data: { autoLoopOwner: owner } }], preconditions: [{ path: 'tasks/shared', expected: { autoLoopOwner: null } }] }, null, leaseHeaders)
  const claims = await Promise.all([claim('worker-one'), claim('worker-two')])
  check(claims.filter(r => r.status === 200).length, 1)
  check(claims.filter(r => r.status === 409).length, 1)
  const owner = (await read('tasks/shared')).json.data.autoLoopOwner
  check((await commit([{ type: 'update', path: 'tasks/shared', data: { counter: 999 } }], null, randomUUID(), leaseHeaders)).status, 409)
  check((await call('/api/data/commit', { id: randomUUID(), operations: [{ type: 'update', path: 'tasks/shared', data: { counter: 999 } }], preconditions: [{ path: 'tasks/shared', expected: { autoLoopOwner: 'stale-worker' } }] }, null, leaseHeaders)).status, 409)
  check((await read('tasks/shared')).json.data.counter, 10)
  check((await commit([{ type: 'update', path: 'tasks/shared', data: { autoLoopOwner: null } }])).status, 403)
  check((await call('/api/data/commit', { id: randomUUID(), operations: [{ type: 'update', path: 'tasks/shared', data: { autoLoopOwner: null } }], preconditions: [{ path: 'tasks/shared', expected: { autoLoopOwner: owner } }] }, null, leaseHeaders)).status, 200)
  check((await fetch(config.origin + '/api/worker/capabilities', { headers: leaseHeaders })).status, 200)
  check((await fetch(config.origin + '/api/worker/capabilities', { headers: { Cookie: cookies.owner } })).status, 403)
  check((await commit([{ type: 'update', path: 'tasks/shared', data: { humanApprovalHistory: [{ status: 'executed' }] } }])).status, 403)
  check((await commit([{ type: 'update', path: 'tasks/shared', data: { humanApprovalRequests: ['synthetic-request'], agentStatus: 'needs_approval' } }], null, randomUUID(), leaseHeaders)).status, 200)
  check((await commit([{ type: 'update', path: 'tasks/shared', data: { estado: 'completada' } }])).status, 403)
  check((await commit([{ type: 'update', path: 'tasks/shared', data: { humanApprovalRequests: [], agentStatus: 'done' } }], null, randomUUID(), leaseHeaders)).status, 200)
  const invitation = await commit([{ type: 'set', path: 'invites/new@test.invalid', data: { role: 'empleado' } }])
  check(invitation.status, 200)
  const token = invitation.json.invitations[0].token
  const registration = { email: 'new@test.invalid', token, password }
  check((await call('/api/auth/register', registration)).status, 200)
  check((await call('/api/auth/register', registration)).status, 400)
  check((await call('/api/auth/login', { email: 'new@test.invalid', password }, 'new')).status, 200)
  const newUser = (await call('/api/auth/me', undefined, 'new')).json.user
  check((await read(`users/${newUser.uid}`, 'new')).json.data.role, 'empleado')
  const changed = password + '-changed'
  check((await call('/api/auth/password', { password: changed }, 'pending')).status, 200)
  check((await call('/api/auth/me', undefined, 'pending')).status, 401)
  check((await call('/api/auth/login', { email: 'pending@test.invalid', password: changed }, 'pending')).status, 200)
  check((await call('/api/data/read', { kind: 'collection', path: 'tasks' }, 'pending')).status, 403)
  check((await commit([{type:'update',path:'users/employee',data:{executiveRole:'ceo'}}],'employee')).status,403)
  check((await commit([{type:'update',path:'users/owner',data:{executiveRole:'ceo'}}],null,randomUUID(),leaseHeaders)).status,403)
  check((await commit([{type:'update',path:'users/owner',data:{executiveRole:'ceo'}}])).status,200)
  assertions+=await verifyOfficeIntegration({database,config,cookies,password})
  await new sql.Request(pool).query("UPDATE dbo.SchemaMigrations SET SHA256=REPLICATE('0',64) WHERE Name='001-initial.sql'")
  await assert.rejects(migrateSchema(database), /migración aplicada/); assertions++
  const invalidConfig = databaseConfig(process.env)
  invalidConfig.connectionString = invalidConfig.connectionString.replace('Server={tcp:sql.stackbi.com.mx,1433}', 'Server={tcp:127.0.0.1,1433}')
  const wrongCertificate = createDatabase(invalidConfig)
  try { await assert.rejects(wrongCertificate.pool(), error => error.code === -2146893022 || /SSL Provider|certificate|certificado|principal|entidad/i.test(error.message)); assertions++ } finally { await wrongCertificate.close().catch(() => {}) }
  console.log(JSON.stringify({ event: 'sql_integration_verified', assertions, data: 'synthetic isolated database', concurrency: true, rollback: true, permissions: true, invitations: true, certificateMismatchRejected: true }))
} finally {
  if (server) await new Promise(resolve => server.close(resolve))
  if (database) await database.close().catch(() => {})
  if (created && /^AgentesIA3D_Test_[a-f0-9]{10}$/.test(name)) await new sql.Request(await master.pool()).query(`ALTER DATABASE [${name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${name}];`)
  await master.close()
}
