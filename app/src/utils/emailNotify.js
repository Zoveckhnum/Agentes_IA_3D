import { BRAND } from '../config.js'
import { db } from '../firebase.js'
import { doc, getDoc } from '../data/firestore.js'

// Config de EmailJS guardada en Firestore: config/emailjs
// { serviceId, templateId, publicKey }
// Si el doc no existe, los emails simplemente no se envían (sin errores).
let cachedConfig = null

async function getEmailConfig() {
  if (cachedConfig !== null) return cachedConfig
  try {
    const snap = await getDoc(doc(db, 'config', 'emailjs'))
    cachedConfig = snap.exists() ? snap.data() : false
  } catch (e) {
    cachedConfig = false
  }
  return cachedConfig
}

// Envía email de "tarea asignada". Fire-and-forget: nunca rompe el guardado.
export async function sendTaskAssignedEmail({ toEmail, toName, taskName, cliente, prioridad, vencimiento, assignedBy }) {
  try {
    const cfg = await getEmailConfig()
    if (!cfg || !cfg.serviceId || !cfg.templateId || !cfg.publicKey) return false

    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: cfg.serviceId,
        template_id: cfg.templateId,
        user_id: cfg.publicKey,
        template_params: {
          to_email: toEmail,
          to_name: toName || '',
          task_name: taskName,
          cliente: cliente || '—',
          prioridad: prioridad || 'media',
          vencimiento: vencimiento || 'Sin fecha límite',
          assigned_by: assignedBy || 'El equipo',
          app_url: BRAND.url,
        },
      }),
    })
    return res.ok
  } catch (e) {
    console.error('email notify error', e)
    return false
  }
}
