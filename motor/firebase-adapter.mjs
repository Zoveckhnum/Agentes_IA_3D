import * as firebaseApp from 'firebase/app'
import * as firebaseAuth from 'firebase/auth'
import * as firebaseData from 'firebase/firestore'
import * as local from '../shared/sql-document-client.mjs'
const useSql = process.env.AGENTES_DATA_BACKEND === 'sql'
const provider = useSql ? local : firebaseData
if (useSql) {
  const base = process.env.AGENTES_API_ORIGIN
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base || '') || !process.env.WORKER_API_TOKEN) throw new Error('El motor SQL requiere API loopback y autorización protegida')
  local.configureTransport(async (path, { body, signal, ...options } = {}) => {
    const response = await fetch(`${base}/api${path}`, { ...options, headers: { Authorization: `Bearer ${process.env.WORKER_API_TOKEN}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) })
    const result = await response.json()
    if (!response.ok) { const error = new Error(result.error?.message || 'Error en API local'); error.code = result.error?.code || 'unavailable'; throw error }
    return result
  })
}
export const initializeApp = config => useSql ? {} : firebaseApp.initializeApp(config)
export const getAuth = app => useSql ? {} : firebaseAuth.getAuth(app)
export async function signInWithEmailAndPassword(auth, email, password) {
  if (!useSql) return firebaseAuth.signInWithEmailAndPassword(auth, email, password)
  const response = await fetch(`${process.env.AGENTES_API_ORIGIN}/api/auth/me`, { headers: { Authorization: `Bearer ${process.env.WORKER_API_TOKEN}` }, signal: AbortSignal.timeout(10000) })
  if (!response.ok) throw new Error('No se pudo autenticar el motor en la API local')
  const result = await response.json()
  if (!result.user?.worker) throw new Error('La API no reconoció la identidad del motor')
  return result
}
export const connectAuthEmulator = (...args) => { if (useSql) throw new Error('No se admiten emuladores en modo SQL'); return firebaseAuth.connectAuthEmulator(...args) }
export const getFirestore = app => useSql ? local.db : firebaseData.getFirestore(app)
export const connectFirestoreEmulator = (...args) => { if (useSql) throw new Error('No se admiten emuladores en modo SQL'); return firebaseData.connectFirestoreEmulator(...args) }
export const collection = (...args) => provider.collection(...args)
export const doc = (...args) => provider.doc(...args)
export const query = (...args) => provider.query(...args)
export const where = (...args) => provider.where(...args)
export const orderBy = (...args) => provider.orderBy(...args)
export const limit = (...args) => provider.limit(...args)
export const onSnapshot = (...args) => provider.onSnapshot(...args)
export const getDoc = (...args) => provider.getDoc(...args)
export const getDocs = (...args) => provider.getDocs(...args)
export const setDoc = (...args) => provider.setDoc(...args)
export const addDoc = (...args) => provider.addDoc(...args)
export const updateDoc = (...args) => provider.updateDoc(...args)
export const serverTimestamp = (...args) => provider.serverTimestamp(...args)
export const increment = (...args) => provider.increment(...args)
export const writeBatch = (...args) => provider.writeBatch(...args)
