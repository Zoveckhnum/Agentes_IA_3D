import { db } from '../firebase.js'
import { doc, setDoc, increment, serverTimestamp } from '../data/firestore.js'

// Clave del día local: YYYY-MM-DD
export function todayKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Acumula segundos trabajados del usuario en el día actual.
// Doc id determinístico uid_fecha → un doc por usuario por día, sin índices compuestos.
export async function logWork(uid, seconds) {
  if (!uid || !seconds || seconds <= 0) return
  try {
    await setDoc(doc(db, 'worklog', `${uid}_${todayKey()}`), {
      uid,
      date: todayKey(),
      seconds: increment(seconds),
      updatedAt: serverTimestamp(),
    }, { merge: true })
  } catch (e) {
    console.error('worklog error', e)
  }
}

// Acumula segundos de conexión (esté o no trabajando en una tarea).
// Lo llama el heartbeat de presencia cada minuto.
export async function logOnline(uid, seconds = 60) {
  if (!uid) return
  try {
    const hour = String(new Date().getHours()).padStart(2, '0')
    await setDoc(doc(db, 'worklog', `${uid}_${todayKey()}`), {
      uid,
      date: todayKey(),
      onlineSeconds: increment(seconds),
      // Actividad por hora del día: permite ver de qué hora a qué hora estuvo activo
      hours: { [hour]: increment(seconds) },
      updatedAt: serverTimestamp(),
    }, { merge: true })
  } catch (e) {
    console.error('onlinelog error', e)
  }
}
