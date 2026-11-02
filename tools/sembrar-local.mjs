import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { root } from './emuladores.mjs'

// Importa el SDK instalado para el motor, sin otra copia de Firebase.
const require = createRequire(new URL('../motor/package.json', import.meta.url))
const firebaseModule = name => import(pathToFileURL(require.resolve(name)).href)
const { initializeApp, deleteApp } = await firebaseModule('firebase/app')
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = await firebaseModule('firebase/auth')
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, serverTimestamp, terminate } = await firebaseModule('firebase/firestore')

export async function seedLocal({ reserveIds = [] } = {}) {
  const projectId = 'demo-agentes-ia-3d'
  const apiKey = 'demo-local-key'
  // Solo endpoints de loopback; nunca crea usuarios en Firebase real.
  for (const email of ['admin@oficina.local', 'robot@oficina.local']) {
    const res = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'solo-emulador-local', returnSecureToken: true }),
    })
    const data = await res.json()
    if (!res.ok && data.error?.message !== 'EMAIL_EXISTS') throw new Error(`No se pudo crear ${email}: ${data.error?.message}`)
  }
  const app = initializeApp({ apiKey, projectId }, `seed-${Date.now()}`)
  const auth = getAuth(app), db = getFirestore(app)
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', 8080)
  try {
    const { user } = await signInWithEmailAndPassword(auth, 'admin@oficina.local', 'solo-emulador-local')
    await setDoc(doc(db, 'users', user.uid), {
      email: user.email, name: 'Administrador', role: 'admin', createdAt: serverTimestamp(),
    }, { merge: true })
    const file = join(root, 'motor/negocio.json')
    const business = JSON.parse(readFileSync(file, 'utf8'))
    const cat = JSON.parse(readFileSync(join(root, 'roles/catalogo.json'), 'utf8'))
    business.agentes ||= {}
    for (const id of reserveIds) {
      const ref = doc(db, 'agents', id)
      if ((await getDoc(ref)).exists()) await setDoc(ref, { active: false }, { merge: true })
    }
    for (const [index, agent] of (business.equipo || []).entries()) {
      const id = agent.id || `local-agente-${index + 1}`
      const role = cat.roles[agent.rol]
      if (!role) throw new Error(`Rol desconocido: ${agent.rol}`)
      const ref = doc(db, 'agents', id)
      if (!(await getDoc(ref)).exists()) await setDoc(ref, {
        name: agent.nombre, rol: agent.rol, role: role.nombre, bio: role.descripcion || '',
        mission: agent.mision || role.mision || '', photo: '', look: agent.look || {},
        ...(role.coordinador ? { kind: 'coordinador' } : {}),
        active: true, order: index, breakUntil: null, breakType: null,
        createdAt: serverTimestamp(), createdBy: user.email,
      })
      agent.id = id
      business.agentes[id] ||= { rol: agent.rol, carpeta: agent.nombre }
    }
    writeFileSync(file, JSON.stringify(business, null, 2) + '\n')
    console.log('Usuarios locales y equipo preparados.')
  } finally { await terminate(db); await deleteApp(app) }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await seedLocal()
}
