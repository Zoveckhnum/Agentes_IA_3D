// Read-only diagnostic: never imports or starts the task execution loop.
import { initializeApp, getAuth, signInWithEmailAndPassword, getFirestore, collection, getDocs } from '../motor/firebase-adapter.mjs'
if (process.env.AGENTES_DATA_BACKEND !== 'sql') throw new Error('Este diagnóstico requiere el paquete CMS del motor SQL')
await signInWithEmailAndPassword(getAuth(initializeApp({})))
const db = getFirestore()
const counts = {}
for (const name of ['tasks', 'agents']) counts[name] = (await getDocs(collection(db, name))).size
console.log(JSON.stringify({ ok: true, mode: 'read-only', counts }))
