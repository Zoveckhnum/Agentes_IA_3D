// Compatibility for the document operations this application actually uses.
// SQL, authorization and transactions remain exclusively on the server.
let transport = async () => { throw new Error('Cliente SQL sin configurar') }
export const db = Object.freeze({ kind: 'database', path: '' })
export function configureTransport(fn) { transport = fn }
export class Timestamp {
  constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds }
  static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6) }
  static fromDate(date) { return Timestamp.fromMillis(date.getTime()) }
  static now() { return Timestamp.fromMillis(Date.now()) }
  toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6 }
  toDate() { return new Date(this.toMillis()) }
  toJSON() { return { $type: 'timestamp', seconds: this.seconds, nanoseconds: this.nanoseconds } }
  isEqual(other) { return other?.seconds === this.seconds && other?.nanoseconds === this.nanoseconds }
}
export function revive(value) {
  if (!value || typeof value !== 'object') return value
  if (value.$type === 'timestamp') return new Timestamp(value.seconds, value.nanoseconds)
  if (Array.isArray(value)) return value.map(revive)
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]))
}
const ref = (kind, parent, segments) => {
  const path = [parent.path, ...segments].filter(Boolean).join('/')
  return { kind, path, id: path.split('/').at(-1) }
}
export const collection = (parent, ...segments) => ref('collection', parent, segments)
export const doc = (parent, ...segments) => ref('document', parent, segments.length ? segments : [crypto.randomUUID()])
export const where = (field, op, value) => ({ constraint: 'filter', field, op, value })
export const orderBy = (field, direction = 'asc') => ({ constraint: 'order', field, direction })
export const limit = count => ({ constraint: 'limit', count })
export function query(parent, ...constraints) {
  const result = { ...parent, filters: [...(parent.filters || [])], order: [...(parent.order || [])] }
  for (const c of constraints) {
    if (c.constraint === 'filter') result.filters.push({ field: c.field, op: c.op, value: c.value })
    else if (c.constraint === 'order') result.order.push({ field: c.field, direction: c.direction })
    else if (c.constraint === 'limit') result.limit = c.count
    else throw new Error('Restricción no compatible')
  }
  return result
}
export const serverTimestamp = () => ({ $op: 'timestamp' })
export const increment = value => ({ $op: 'increment', value })
export const arrayUnion = (...values) => ({ $op: 'union', values })
export const arrayRemove = (...values) => ({ $op: 'remove', values })
export const deleteField = () => ({ $op: 'delete' })
export function encode(value) {
  if (value instanceof Date) { if (!Number.isFinite(value.getTime())) throw new Error('Fecha inválida'); return Timestamp.fromDate(value).toJSON() }
  if (value instanceof Timestamp) return value.toJSON()
  if (Array.isArray(value)) return value.map(encode)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]))
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Valor no compatible con documentos SQL')
  return value
}
const snapshotDocument = (path, value) => ({ id: path.split('/').at(-1), ref: { kind: 'document', path, id: path.split('/').at(-1) }, exists: () => value !== null, data: () => value === null ? undefined : revive(structuredClone(value)) })
export function snapshot(result) {
  if (result.kind === 'document') return snapshotDocument(result.path, result.data)
  const docs = result.documents.map(d => snapshotDocument(d.path, d.data))
  return { docs, size: docs.length, empty: !docs.length, forEach: fn => docs.forEach(fn) }
}
export async function getDoc(reference) { return snapshot(await transport('/data/read', { method: 'POST', body: reference })) }
export const getDocs = getDoc
function commit(operations) { return transport('/data/commit', { method: 'POST', body: { id: crypto.randomUUID(), operations: encode(operations) } }) }
export const setDoc = (reference, data, options = {}) => commit([{ type: 'set', path: reference.path, data, merge: options.merge === true }])
export const updateDoc = (reference, data) => commit([{ type: 'update', path: reference.path, data }])
export const deleteDoc = reference => commit([{ type: 'delete', path: reference.path }])
export async function addDoc(reference, data) { const created = doc(reference); await setDoc(created, data); return created }
export function writeBatch() {
  const operations = []
  let used = false
  const batch = {
    set(reference, data, options = {}) { if (used) throw new Error('El batch ya se envió'); operations.push({ type: 'set', path: reference.path, data, merge: options.merge === true }); return batch },
    update(reference, data) { if (used) throw new Error('El batch ya se envió'); operations.push({ type: 'update', path: reference.path, data }); return batch },
    delete(reference) { if (used) throw new Error('El batch ya se envió'); operations.push({ type: 'delete', path: reference.path }); return batch },
    async commit() { if (used) throw new Error('El batch ya se envió'); used = true; if (!operations.length) return; return commit(operations) },
  }
  return batch
}
export function onSnapshot(reference, callback, onError = () => {}) {
  let stopped = false, timer, previous, failures = 0, controller
  async function poll() {
    if (stopped) return
    controller = new AbortController()
    try {
      const result = await transport('/data/read', { method: 'POST', body: reference, signal: controller.signal })
      if (stopped) return
      const serialized = JSON.stringify(result)
      failures = 0
      if (serialized !== previous) { previous = serialized; callback(snapshot(result)) }
    } catch (error) { if (!stopped) { failures++; onError(error) } }
    finally { if (!stopped) timer = setTimeout(poll, Math.min(30000, 2000 * 2 ** Math.min(failures, 4))) }
  }
  void poll()
  return () => { stopped = true; clearTimeout(timer); controller?.abort() }
}
