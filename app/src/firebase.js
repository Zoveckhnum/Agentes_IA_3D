import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from 'firebase/auth'
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore'
import { FIREBASE_CONFIG } from './config.js'

if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.projectId) {
  console.error('Falta la configuración de Firebase en app/.env. Ejecuta npm run setup desde la raíz.')
}

const app = initializeApp(FIREBASE_CONFIG)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
export const useEmulators = import.meta.env.VITE_USE_EMULATORS === 'true'
if (useEmulators) {
  if (!FIREBASE_CONFIG.projectId.startsWith('demo-')) throw new Error('El modo local requiere un projectId demo-.')
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
}
