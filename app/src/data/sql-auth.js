import { configureTransport, db } from '../../../shared/sql-document-client.mjs'
export const auth = { currentUser: null, listeners: new Set(), remember: false }
export { db }
export async function request(path, { body, signal, ...options } = {}) {
  const timeout = AbortSignal.timeout(20000)
  const response = await fetch(`/api${path}`, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  const result = await response.json()
  if (!response.ok) { const error = new Error(result.error?.message || 'No se pudo completar la operación.'); error.code = result.error?.code || 'unavailable'; throw error }
  return result
}
configureTransport(request)
function notify(user) { auth.currentUser = user; for (const listener of auth.listeners) listener(user) }
export function onAuthStateChanged(_auth, fn) {
  auth.listeners.add(fn)
  if (auth.currentUser) queueMicrotask(() => auth.listeners.has(fn) && fn(auth.currentUser))
  else request('/auth/me').then(r => { if (auth.listeners.has(fn)) { auth.currentUser = r.user; fn(r.user) } }).catch(() => { if (auth.listeners.has(fn)) fn(null) })
  return () => auth.listeners.delete(fn)
}
export async function signInWithEmailAndPassword(_auth, email, password) {
  const result = await request('/auth/login', { method: 'POST', body: { email, password, remember: auth.remember } })
  notify(result.user)
  return result
}
export async function signOut() {
  try { await request('/auth/logout', { method: 'POST', body: {} }) } finally { notify(null) }
}
export const requestSecurityCode = body => request('/auth/security/request', { method: 'POST', body })
async function finishCredentialChange(onConfirmed) {
  try { await onConfirmed?.() } finally { notify(null) }
}
export async function changePassword(password, verification = {}, onConfirmed) {
  await request('/auth/password', { method: 'POST', body: { ...verification, password } })
  await finishCredentialChange(onConfirmed)
}
export async function changeLoginEmail(verification, onConfirmed) {
  await request('/auth/email', { method: 'POST', body: verification })
  await finishCredentialChange(onConfirmed)
}
export const browserLocalPersistence = 'local'
export const browserSessionPersistence = 'session'
export async function setPersistence(_auth, persistence) { auth.remember = persistence === browserLocalPersistence }
export async function signInWithPopup() { const error = new Error('Usa el acceso local con correo y contraseña.'); error.code = 'auth/operation-not-allowed'; throw error }
