import test from 'node:test'
import assert from 'node:assert/strict'
import { auth, changeLoginEmail, changePassword } from '../src/data/sql-auth.js'

test('el cambio confirmado permite mostrar el aviso antes de notificar el cierre local', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const operation of [notice => changeLoginEmail({ id: 'synthetic' }, notice), notice => changePassword('synthetic-password', {}, notice)]) {
      const events = [], user = { uid: 'test-user' }
      auth.currentUser = user
      const listener = value => events.push(value === null ? 'signed-out' : 'signed-in')
      auth.listeners.add(listener)
      let finishNotice
      globalThis.fetch = async () => ({ ok: true, json: async () => { events.push('server-confirmed'); return { ok: true } } })
      const change = operation(() => { events.push('notice-shown'); return new Promise(resolve => { finishNotice = resolve }) })
      await new Promise(setImmediate)
      assert.deepEqual(events, ['server-confirmed', 'notice-shown'])
      assert.equal(auth.currentUser, user)
      finishNotice()
      await change
      assert.deepEqual(events, ['server-confirmed', 'notice-shown', 'signed-out'])
      assert.equal(auth.currentUser, null)
      auth.listeners.delete(listener)
    }
  } finally { globalThis.fetch = originalFetch; auth.currentUser = null }
})

test('un código rechazado conserva la sesión y no muestra confirmación de éxito', async () => {
  const originalFetch = globalThis.fetch
  const user = { uid: 'test-user' }
  auth.currentUser = user
  let notice = false
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: { code: 'auth/invalid-code', message: 'Código no válido' } }) })
  try {
    await assert.rejects(changeLoginEmail({}, () => { notice = true }), error => error.code === 'auth/invalid-code')
    assert.equal(notice, false)
    assert.equal(auth.currentUser, user)
  } finally { globalThis.fetch = originalFetch; auth.currentUser = null }
})

test('un fallo del aviso visual no impide cerrar una sesión ya invalidada', async () => {
  const originalFetch = globalThis.fetch
  auth.currentUser = { uid: 'test-user' }
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true }) })
  try {
    await assert.rejects(changeLoginEmail({}, () => { throw new Error('Synthetic visual failure') }), /Synthetic visual failure/)
    assert.equal(auth.currentUser, null)
  } finally { globalThis.fetch = originalFetch; auth.currentUser = null }
})
