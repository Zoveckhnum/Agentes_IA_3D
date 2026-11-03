import test from 'node:test'
import assert from 'node:assert/strict'
import { seedAdminProfile } from './perfil-local.mjs'
import { isReadyProfile } from '../app/src/utils/profile.js'

test('la presencia parcial o un perfil de otra cuenta no autorizan mostrar la oficina', () => {
  const profile = { uid: 'actual', email: 'admin@oficina.local', name: 'Nombre elegido', role: 'admin' }
  assert.equal(isReadyProfile(profile, 'actual'), true)
  assert.equal(isReadyProfile({ ...profile, role: 'pending' }, 'actual'), true)
  assert.equal(isReadyProfile(profile, 'otra'), false)
  assert.equal(isReadyProfile({ uid: 'actual', lastSeen: 'ahora' }, 'actual'), false)
  assert.equal(isReadyProfile({ uid: 'actual', email: profile.email }, 'actual'), false)
  assert.equal(isReadyProfile(null, 'actual'), false)
})

test('reiniciar conserva nombre, datos y fecha de creación personalizados', async () => {
  const existing = { email: 'admin@oficina.local', name: 'Nombre elegido', role: 'admin', bio: 'Mi perfil', createdAt: 'fecha-original' }
  const writes = []
  await seedAdminProfile({ ref: 'perfil', email: existing.email, getDoc: async () => ({ exists: () => true, data: () => existing }), setDoc: async (...args) => writes.push(args), serverTimestamp: () => 'fecha-nueva' })
  assert.equal(writes.length, 0, 'Un perfil existente no debe reinicializarse')
})

test('crea un administrador inicial y repara solo los permisos si ya existe', async () => {
  for (const exists of [false, true]) {
    const writes = []
    await seedAdminProfile({ ref: 'perfil', email: 'admin@oficina.local', getDoc: async () => ({ exists: () => exists, data: () => ({ role: 'pending', name: 'Mi nombre' }) }), setDoc: async (_, data, options) => writes.push({ data, options }), serverTimestamp: () => 'fecha-inicial' })
    assert.deepEqual(writes, [{ data: exists ? { role: 'admin' } : { email: 'admin@oficina.local', name: 'Administrador', role: 'admin', createdAt: 'fecha-inicial' }, options: { merge: true } }])
  }
})
