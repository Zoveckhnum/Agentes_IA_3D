export const roots = new Set(['users', 'tasks', 'agents', 'config', 'invites', 'discussions', 'posts', 'worklog', 'chats', 'agentChats'])
const blockedKeys = new Set(['__proto__', 'prototype', 'constructor'])
export class ApiError extends Error {
  constructor(status, code, message = 'No se pudo completar la operación.') { super(message); this.status = status; this.code = code }
}
export function documentPath(path, collection = false) {
  if (typeof path !== 'string' || path.length > (collection ? 400 : 450)) throw new ApiError(400, 'invalid-argument')
  const parts = path.split('/')
  if (!parts.length || parts.some(p => !p || p.length > 200 || p === '.' || p === '..' || /[\u0000-\u001f]/.test(p) || blockedKeys.has(p))) throw new ApiError(400, 'invalid-argument')
  if ((parts.length % 2 === 1) !== collection || !roots.has(parts[0])) throw new ApiError(400, 'invalid-argument')
  if (parts.length > 2 && !(parts.length === (collection ? 3 : 4) && ((parts[0] === 'chats' && parts[2] === 'messages') || (parts[0] === 'agentChats' && parts[2] === 'mensajes')))) throw new ApiError(400, 'invalid-argument')
  return parts
}
export function validateValue(value, depth = 0, transforms = false) {
  if (depth > 20) throw new ApiError(400, 'invalid-argument')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (Array.isArray(value)) { if (value.length > 10000) throw new ApiError(413, 'resource-exhausted'); for (const v of value) validateValue(v, depth + 1, transforms); return }
  if (!value || typeof value !== 'object') throw new ApiError(400, 'invalid-argument')
  if (value.$op && !transforms) throw new ApiError(400, 'invalid-argument')
  for (const [key, item] of Object.entries(value)) {
    if (blockedKeys.has(key) || key.length > 256) throw new ApiError(400, 'invalid-argument')
    validateValue(item, depth + 1, transforms)
  }
}
export const timestamp = (date = new Date()) => ({ $type: 'timestamp', seconds: Math.floor(date.getTime() / 1000), nanoseconds: (date.getTime() % 1000) * 1e6 })
export const comparable = v => v?.$type === 'timestamp' ? v.seconds * 1000 + v.nanoseconds / 1e6 : v
export function fieldValue(value, path) { return path.split('.').reduce((v, p) => v?.[p], value) }
function transform(value, old, now) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (value.$op === 'timestamp') return timestamp(now)
    if (value.$op === 'increment') { if (typeof value.value !== 'number' || !Number.isFinite(value.value)) throw new ApiError(400, 'invalid-argument'); const result = (typeof old === 'number' ? old : 0) + value.value; if (!Number.isFinite(result)) throw new ApiError(400, 'invalid-argument'); return result }
    if (['union', 'remove'].includes(value.$op)) {
      if (!Array.isArray(value.values)) throw new ApiError(400, 'invalid-argument')
      const previous = Array.isArray(old) ? old : []
      const keys = new Set(value.values.map(v => JSON.stringify(v)))
      return value.$op === 'remove' ? previous.filter(v => !keys.has(JSON.stringify(v))) : [...new Map([...previous, ...value.values].map(v => [JSON.stringify(v), structuredClone(v)])).values()]
    }
    if (value.$op) throw new ApiError(400, 'invalid-argument')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transform(v, old?.[k], now)]))
  }
  if (Array.isArray(value)) return value.map(v => transform(v, undefined, now))
  return value
}
function merge(base, change, now, dotted = false) {
  const output = structuredClone(base)
  for (const [key, value] of Object.entries(change)) {
    const segments = dotted ? key.split('.') : [key]
    if (segments.some(p => !p || blockedKeys.has(p))) throw new ApiError(400, 'invalid-argument')
    let parent = output
    for (const segment of segments.slice(0, -1)) { if (!parent[segment] || typeof parent[segment] !== 'object' || Array.isArray(parent[segment])) parent[segment] = {}; parent = parent[segment] }
    const leaf = segments.at(-1)
    if (value?.$op === 'delete') delete parent[leaf]
    else if (!dotted && value && typeof value === 'object' && !Array.isArray(value) && !value.$op && !value.$type) parent[leaf] = merge(parent[leaf] && typeof parent[leaf] === 'object' ? parent[leaf] : {}, value, now)
    else parent[leaf] = transform(value, parent[leaf], now)
  }
  return output
}
export function applyMutation(old, operation, now = new Date()) {
  if (!['set', 'update', 'delete'].includes(operation.type)) throw new ApiError(400, 'invalid-argument')
  if (operation.type === 'delete') return null
  if (!operation.data || typeof operation.data !== 'object' || Array.isArray(operation.data)) throw new ApiError(400, 'invalid-argument')
  validateValue(operation.data, 0, true)
  if (operation.type === 'update' && !old) throw new ApiError(404, 'not-found')
  const result = operation.type === 'update' ? merge(old, operation.data, now, true) : operation.merge ? merge(old || {}, operation.data, now) : transform(operation.data, old, now)
  validateValue(result)
  if (Buffer.byteLength(JSON.stringify(result)) > 1024 * 1024) throw new ApiError(413, 'resource-exhausted')
  return result
}
export function applyQuery(documents, spec) {
  const filters = spec.filters || [], order = spec.order || []
  if (!Array.isArray(filters) || filters.length > 8 || !Array.isArray(order) || order.length > 3) throw new ApiError(400, 'invalid-argument')
  let result = documents.filter(d => filters.every(f => {
    if (typeof f.field !== 'string' || f.field.length > 256) throw new ApiError(400, 'invalid-argument')
    const a = comparable(fieldValue(d.data, f.field)), b = comparable(f.value)
    switch (f.op) {
      case '==': return JSON.stringify(a) === JSON.stringify(b)
      case '!=': return a !== undefined && JSON.stringify(a) !== JSON.stringify(b)
      case '>=': return a !== undefined && a >= b
      case '<=': return a !== undefined && a <= b
      case '>': return a !== undefined && a > b
      case '<': return a !== undefined && a < b
      case 'array-contains': return Array.isArray(a) && a.some(v => JSON.stringify(v) === JSON.stringify(b))
      default: throw new ApiError(400, 'invalid-argument')
    }
  }))
  result = result.filter(d => order.every(o => typeof o.field === 'string' && fieldValue(d.data, o.field) !== undefined))
  result.sort((a, b) => {
    for (const o of order) { if (!['asc', 'desc'].includes(o.direction)) throw new ApiError(400, 'invalid-argument'); const av = comparable(fieldValue(a.data, o.field)), bv = comparable(fieldValue(b.data, o.field)); const c = av === bv ? 0 : av == null ? -1 : bv == null ? 1 : av < bv ? -1 : 1; if (c) return o.direction === 'desc' ? -c : c }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  })
  if (spec.limit !== undefined) { if (!Number.isInteger(spec.limit) || spec.limit < 1 || spec.limit > 5000) throw new ApiError(400, 'invalid-argument'); result = result.slice(0, spec.limit) }
  return result
}
