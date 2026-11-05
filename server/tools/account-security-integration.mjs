import assert from 'node:assert/strict'
import { sql } from '../src/db.mjs'

// Called exclusively from integration-test.mjs against its temporary database.
export async function verifyAccountSecurity({ database, call, password, messages, config }) {
  const pool = await database.pool()
  let assertions = 0
  const check = (actual, expected) => { assert.equal(actual, expected); assertions++ }
  const request = (who, purpose = 'email', email = 'changed@test.invalid') => call('/api/auth/security/request', { purpose, email, currentPassword: password }, who)
  const cool = async uid => new sql.Request(pool).input('uid', sql.NVarChar(128), uid).query('UPDATE app.AccountVerifications SET CreatedAt=DATEADD(minute,-2,SYSUTCDATETIME()) WHERE Uid=@uid')
  check((await call('/api/auth/password', { password: password + '-bypass' }, 'employee')).status, 400)
  check((await call('/api/auth/security/request', { purpose: 'email', email: 'changed@test.invalid', currentPassword: 'wrong' }, 'employee')).status, 401)
  check((await request('employee', 'email', 'owner@test.invalid')).status, 409)
  const first = await request('employee')
  check(first.status, 200)
  check(first.json.requiresCurrentCode, true)
  check('code' in first.json, false)
  check(messages.at(-2).to, 'employee@test.invalid')
  check(messages.at(-1).to, 'changed@test.invalid')
  check((await request('employee')).status, 429)
  const currentCode = messages.at(-2).code, code = messages.at(-1).code
  const body = { id: first.json.id, code, currentCode }
  check((await call('/api/auth/email', body, 'owner')).status, 400)
  check((await call('/api/auth/password', { id: body.id, code, password: password + '-other' }, 'employee')).status, 400)
  const stored = (await new sql.Request(pool).input('id', sql.UniqueIdentifier, body.id).query('SELECT CodeHash,CurrentCodeHash FROM app.AccountVerifications WHERE Id=@id')).recordset[0]
  check(stored.CodeHash.includes(code), false)
  check(stored.CurrentCodeHash.includes(currentCode), false)
  for (let attempt = 0; attempt < 5; attempt++) check((await call('/api/auth/email', { ...body, currentCode: currentCode === '00000000' ? '11111111' : '00000000' }, 'employee')).status, 400)
  check((await call('/api/auth/email', body, 'employee')).status, 400)
  await cool('employee')
  const second = await request('employee')
  check(second.status, 200)
  check((await call('/api/auth/email', body, 'employee')).status, 400)
  const secondBody = { id: second.json.id, code: messages.at(-1).code, currentCode: messages.at(-2).code }
  await new sql.Request(pool).input('id', sql.UniqueIdentifier, secondBody.id).query('UPDATE app.AccountVerifications SET ExpiresAt=DATEADD(second,-1,SYSUTCDATETIME()) WHERE Id=@id')
  check((await call('/api/auth/email', secondBody, 'employee')).status, 400)
  await cool('employee')
  // Preserve task ownership and profile metadata when the login email changes.
  await new sql.Request(pool).query("UPDATE app.Documents SET Payload=JSON_MODIFY(Payload,'$.createdBy',N'employee@test.invalid') WHERE Path=N'tasks/shared'")
  const third = await request('employee')
  check(third.status, 200)
  const valid = { id: third.json.id, code: messages.at(-1).code, currentCode: messages.at(-2).code }
  const race = await Promise.all([call('/api/auth/email', valid, 'employee'), call('/api/auth/email', valid, 'employee')])
  check(race.filter(v => v.status === 200).length, 1)
  check((await call('/api/auth/me', undefined, 'employee')).status, 401)
  check((await call('/api/auth/login', { email: 'changed@test.invalid', password }, 'employee')).status, 200)
  const me = (await call('/api/auth/me', undefined, 'employee')).json.user
  check(me.uid, 'employee'); check(me.emailVerified, true)
  const doc = await call('/api/data/read', { kind: 'document', path: 'users/employee' }, 'employee')
  check(doc.json.data.email, 'changed@test.invalid')
  check((await new sql.Request(pool).query("SELECT JSON_VALUE(Payload,'$.createdBy') AS Email FROM app.Documents WHERE Path=N'tasks/shared'")).recordset[0].Email, 'changed@test.invalid')
  check((await call('/api/auth/email', valid, 'employee')).status, 400)
  config.failSecurityMail = true
  const failed = await request('other', 'password')
  check(failed.status, 500)
  const last = (await new sql.Request(pool).query("SELECT TOP(1) Id FROM app.AccountVerifications WHERE Uid=N'other' ORDER BY CreatedAt DESC")).recordset[0]
  check((await call('/api/auth/password', { id: last.Id, code: '00000000', password: password + '-changed' }, 'other')).status, 400)
  config.failSecurityMail = false
  // Operator recovery is limited to the unverified demo owner and one approved destination.
  await new sql.Request(pool).query("UPDATE app.Accounts SET Email=N'admin@oficina.local',EmailVerified=0 WHERE Uid=N'owner'; UPDATE app.Documents SET Payload=JSON_MODIFY(Payload,'$.email',N'admin@oficina.local') WHERE Path=N'users/owner'")
  const version = (await new sql.Request(pool).query("SELECT CredentialVersion AS Version FROM app.Accounts WHERE Uid=N'owner'")).recordset[0].Version
  config.ownerEmailRecovery = { sourceEmail: 'admin@oficina.local', targetEmail: 'real-owner@test.invalid', credentialVersion: version, expiresAt: new Date(Date.now() + 3600e3).toISOString() }
  const startCount = messages.length
  check((await request('owner', 'email', 'unapproved@test.invalid')).status, 409)
  check(messages.length, startCount)
  const recovery = await request('owner', 'email', 'real-owner@test.invalid')
  check(recovery.status, 200)
  check(recovery.json.requiresCurrentCode, false)
  check(messages.length, startCount + 1)
  check(messages.at(-1).to, 'real-owner@test.invalid')
  const recoveryBody = { id: recovery.json.id, code: messages.at(-1).code }
  check((await call('/api/auth/email', { ...recoveryBody, skipCurrentCode: true }, 'other')).status, 400)
  config.ownerEmailRecovery.expiresAt = new Date(Date.now() - 1000).toISOString()
  check((await call('/api/auth/email', recoveryBody, 'owner')).status, 400)
  config.ownerEmailRecovery.expiresAt = new Date(Date.now() + 3600e3).toISOString()
  check((await call('/api/auth/email', recoveryBody, 'owner')).status, 200)
  check((await call('/api/auth/me', undefined, 'owner')).status, 401)
  check((await call('/api/auth/login', { email: 'real-owner@test.invalid', password }, 'owner')).status, 200)
  const recovered = (await call('/api/auth/me', undefined, 'owner')).json.user
  check(recovered.uid, 'owner'); check(recovered.emailVerified, true)
  check((await call('/api/auth/email', recoveryBody, 'owner')).status, 400)
  await cool('owner')
  // After activation, even the owner must prove possession of both real addresses.
  const next = await request('owner', 'email', 'second-owner@test.invalid')
  check(next.status, 200); check(next.json.requiresCurrentCode, true)
  check((await call('/api/auth/email', { id: next.json.id, code: messages.at(-1).code, skipCurrentCode: true }, 'owner')).status, 400)
  return assertions
}
