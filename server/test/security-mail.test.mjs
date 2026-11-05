import test from 'node:test'
import assert from 'node:assert/strict'
import { createSecurityMailer } from '../src/security-mail.mjs'
import { createAccountSecurity, approvedDemoRecovery } from '../src/account-security.mjs'

test('Brevo envía el código solo al destinatario indicado y mantiene la clave en la cabecera', async () => {
  let sent
  const mail = createSecurityMailer({ apiKey: 'synthetic-only', sender: 'sender@test.invalid' }, async (url, options) => { sent = { url, ...options }; return { ok: true } })
  await mail({ to: 'person@test.invalid', purpose: 'password', code: '12345678' })
  assert.equal(sent.url, 'https://api.brevo.com/v3/smtp/email')
  assert.equal(sent.headers['api-key'], 'synthetic-only')
  const body = JSON.parse(sent.body)
  assert.deepEqual(body.to, [{ email: 'person@test.invalid' }])
  assert.ok(body.textContent.includes('12345678'))
  assert.ok(body.textContent.includes('10 minutos'))
  assert.ok(!sent.body.includes('synthetic-only'))
})

test('los fallos del proveedor no exponen su respuesta ni dejan pasar el envío', async () => {
  const mail = createSecurityMailer({ apiKey: 'synthetic-only', sender: 'sender@test.invalid' }, async () => ({ ok: false, text: () => 'private provider payload' }))
  await assert.rejects(mail({ to: 'person@test.invalid', purpose: 'email', code: '12345678' }), error => error.status === 503 && !error.message.includes('private'))
  let network = false
  const missing = createSecurityMailer({}, async () => { network = true })
  await assert.rejects(missing({}), error => error.status === 503)
  assert.equal(network, false)
})

test('la verificación rechaza al robot y falla cerrada sin secreto configurado', async () => {
  const service = createAccountSecurity({}, {})
  await assert.rejects(service.request({ worker: true }, {}), error => error.status === 403)
  await assert.rejects(service.confirm({ uid: 'user' }, {}, 'password'), error => error.status === 503)
})

test('la recuperación inicial exige autorización vigente, propietario, cuenta local y versión exacta', () => {
  const now = Date.now(), target = 'real@test.invalid'
  const account = { Uid: 'owner', Email: 'admin@oficina.local', EmailVerified: false, CredentialVersion: 2 }
  const config = { ownerUid: 'owner', ownerEmailRecovery: { sourceEmail: account.Email, targetEmail: target, credentialVersion: 2, expiresAt: new Date(now + 10000).toISOString() } }
  assert.equal(approvedDemoRecovery(config, account, target, now), true)
  for (const change of [{ Uid: 'other' }, { Email: 'other@oficina.local' }, { Email: 'admin@test.invalid' }, { EmailVerified: true }, { CredentialVersion: 3 }]) {
    assert.equal(approvedDemoRecovery(config, { ...account, ...change }, target, now), false)
  }
  assert.equal(approvedDemoRecovery(config, account, 'unapproved@test.invalid', now), false)
  assert.equal(approvedDemoRecovery(config, account, target, now + 20000), false)
  assert.equal(approvedDemoRecovery({}, account, target, now), false)
})
