// Prueba de integración: solo el emulador demo de loopback, nunca Firebase real.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(new URL('../motor/package.json', import.meta.url))
const sdk = name => import(pathToFileURL(require.resolve(name)).href)
const { initializeApp, deleteApp } = await sdk('firebase/app')
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword, deleteUser } = await sdk('firebase/auth')
const { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDocs, collection, deleteDoc, terminate } = await sdk('firebase/firestore')
const apps = []
function client(name) {
  const app = initializeApp({ apiKey: 'demo-local-key', projectId: 'demo-agentes-ia-3d' }, name)
  const auth = getAuth(app), db = getFirestore(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  apps.push({ app, db })
  return { auth, db }
}
const suffix = Date.now()
const admin = client(`rules-admin-${suffix}`), other = client(`rules-other-${suffix}`), robot = client(`rules-robot-${suffix}`)
let user
const taskId = `rules-test-${suffix}`, agentId = `rules-agent-${suffix}`
const denied = promise => assert.rejects(promise, e => e.code === 'permission-denied')
try {
  await signInWithEmailAndPassword(admin.auth, 'admin@oficina.local', 'solo-emulador-local')
  await signInWithEmailAndPassword(robot.auth, 'robot@oficina.local', 'solo-emulador-local')
  user = (await createUserWithEmailAndPassword(other.auth, `rules-${suffix}@test.local`, 'prueba-reglas-local')).user
  const own = doc(other.db, 'users', user.uid)
  await denied(setDoc(own, { email: user.email, role: 'admin' }))
  await setDoc(own, { email: user.email, role: 'pending', name: 'Prueba' })
  await denied(updateDoc(own, { role: 'admin' }))
  await updateDoc(own, { name: 'Nombre actualizado' })
  await denied(getDocs(collection(other.db, 'tasks')))
  await denied(getDocs(collection(other.db, 'users')))
  await setDoc(doc(admin.db, 'agents', agentId), { active: false, name: 'Prueba reglas' })
  const a = doc(admin.db, 'tasks', taskId), r = doc(robot.db, 'tasks', taskId)
  await setDoc(a, { asignado: agentId, tarea: 'Prueba de reglas', descripcion: '', estado: 'en_espera', qualityStatus: 'pending' })
  await denied(updateDoc(a, { estado: 'completada' }))
  await denied(updateDoc(a, { qualityStatus: 'passed' }))
  await updateDoc(r, { qualityStatus: 'passed' })
  await denied(updateDoc(a, { descripcion: 'Otro alcance' }))
  await updateDoc(a, { descripcion: 'Otro alcance', qualityStatus: 'pending', estado: 'en_revision' })
  await denied(updateDoc(a, { estado: 'completada' }))
  await updateDoc(r, { qualityStatus: 'passed', estado: 'en_espera' })
  await updateDoc(a, { estado: 'completada' })
  console.log('Reglas OK: sin autoascenso, datos restringidos y cierre condicionado a QA de la revisión vigente.')
} finally {
  if (user) { await deleteDoc(doc(admin.db, 'users', user.uid)).catch(() => {}); await deleteUser(user).catch(() => {}) }
  await deleteDoc(doc(admin.db, 'tasks', taskId)).catch(() => {})
  await deleteDoc(doc(admin.db, 'agents', agentId)).catch(() => {})
  for (const { app, db } of apps) { await terminate(db); await deleteApp(app) }
}
