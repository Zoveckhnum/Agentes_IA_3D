import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { FIREBASE_CONFIG } from './config.js'
import { useLocalSql } from './data/mode.js'
import * as local from './data/sql-auth.js'

if (!useLocalSql && (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.projectId)) {
  console.error('Falta la configuración de Firebase en app/.env. Ejecuta npm run setup desde la raíz.')
}

const app = useLocalSql ? null : initializeApp(FIREBASE_CONFIG)
export const auth = useLocalSql ? local.auth : getAuth(app)
export const db = useLocalSql ? local.db : getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
export const useEmulators = !useLocalSql && import.meta.env.VITE_USE_EMULATORS === 'true'
if (useEmulators) {
  if (!FIREBASE_CONFIG.projectId.startsWith('demo-')) throw new Error('El modo local requiere un projectId demo-.')
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
