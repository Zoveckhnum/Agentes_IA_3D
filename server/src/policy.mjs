import { ApiError } from './values.mjs'
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const changed = (before, after) => new Set([...Object.keys(before || {}), ...Object.keys(after || {})].filter(k => !same(before?.[k], after?.[k])))
const only = (keys, allowed) => [...keys].every(k => allowed.includes(k))
const quality = data => data?.qualityStatus === 'passed' || (data?.qualityReport === true && data?.qualityStatus === 'report')
const member = (id, uid) => id.startsWith(`${uid}_`) || id.endsWith(`_${uid}`)
export function canRead(actor, path) {
  if (!actor || actor.mustChangePassword) return false
  const [root, id, child] = path.split('/')
  const admin = actor.role === 'admin', active = admin || actor.role === 'empleado', worker = actor.worker === true
  switch (root) {
    case 'users': return active || worker || actor.uid === id
    case 'tasks': case 'config': return active || worker
    case 'invites': return admin || actor.email === id
    case 'agents': case 'discussions': case 'posts': return active || worker
    case 'worklog': return active
    case 'chats': return active && member(id || '', actor.uid) && (!child || child === 'messages')
    case 'agentChats': return (admin || worker) && (!child || child === 'mensajes')
    default: return false
  }
}
export async function authorizeWrite(actor, operation, before, after, lookup) {
  if (!actor || actor.mustChangePassword) throw new ApiError(403, 'permission-denied')
  const [root, id, child] = operation.path.split('/')
  const create = !before && after, deleting = !after
  const admin = actor.role === 'admin', employee = actor.role === 'empleado', active = admin || employee
  const keys = changed(before, after)
  let allowed = false
  switch (root) {
    case 'users': {
      if (deleting) allowed = admin && actor.uid !== id && before?.isSuper !== true
      else if (create) allowed = actor.uid === id && after.email === actor.email && after.role === 'pending' && !after.isSuper
      else if (admin) allowed = (actor.isSuper || (!keys.has('isSuper') && (!keys.has('role') || (before.role !== 'admin' && after.role !== 'admin')))) && (!before?.isSuper || actor.uid === id) && !keys.has('email')
      else allowed = actor.uid === id && after.email === actor.email && only(keys, ['name', 'photo', 'phone', 'contactEmail', 'bio', 'position', 'color', 'lastSeen', 'look'])
      if (keys.has('contactEmail') && (typeof after?.contactEmail !== 'string' || after.contactEmail.length > 320 || (after.contactEmail !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(after.contactEmail)))) allowed = false
      if (after && !['admin', 'empleado', 'pending'].includes(after.role)) allowed = false
      if(keys.has('executiveRole')&&(!admin||!actor.isSuper||actor.worker||create||deleting))allowed=false
      if(after?.executiveRole!==undefined&&!['ceo',null].includes(after.executiveRole))allowed=false
      if (before?.isSuper && (deleting || after?.isSuper !== true || after?.role !== 'admin')) allowed = false
      break
    }
    case 'tasks': {
      const protectedFields = ['officePause','humanApprovalRequests','humanApprovalHistory','autoLoopOwner', 'autoLoopExpiresAt', 'autoLoopAttempts', 'qualityReviews', 'qualityRevision', 'qualityManifest', 'qualityCheckedAt', 'qualityReport', 'agentOutput', 'projectSnapshot', 'projectBranch', 'projectHead']
      const inputsChanged = [...keys].some(k => ['tarea', 'descripcion', 'feedback', 'links', 'asignado', 'projectId'].includes(k))
      if (deleting) { allowed = admin; break }
      if (create) {
        allowed = (active || (actor.worker && !!await lookup(`agents/${after.asignado}`))) && after.createdBy === actor.email && !(after.projectId && after.estado === 'completada') && !protectedFields.some(k => Object.hasOwn(after, k))
        break
      }
      allowed = admin || (employee && (before.asignado === actor.uid || before.createdBy === actor.email || (before.estado === 'pendiente' && after.asignado === actor.uid))) || (actor.worker && before.asignado === after.asignado && !!await lookup(`agents/${before.asignado}`))
      if (!actor.worker && ([...keys].some(k => protectedFields.includes(k)) || (keys.has('qualityStatus') && after.qualityStatus !== 'pending') || (Object.hasOwn(before, 'qualityStatus') && inputsChanged && after.qualityStatus !== 'pending'))) allowed = false
      if (keys.has('createdAt')) allowed = false
      if (keys.has('officePause') || before.officePause) allowed = false
      if (after.estado === 'completada' && ((after.projectId && !quality(after)) || (Object.hasOwn(before, 'qualityStatus') && (!quality(before) || !quality(after) || inputsChanged)))) allowed = false
      if (after.estado === 'completada' && (after.humanApprovalRequests?.length || ['needs_approval','approval_blocked'].includes(after.agentStatus))) allowed = false
      break
    }
    case 'config': allowed = admin || (actor.worker && id === 'agentWorker'); break
    case 'invites': allowed = admin || (deleting && actor.email === id); if (after && (!['admin', 'empleado', 'pending'].includes(after.role) || (after.role === 'admin' && !actor.isSuper))) allowed = false; break
    case 'agents': allowed = admin || (actor.worker && create); break
    case 'worklog': allowed = admin || (employee && !deleting && after?.uid === actor.uid && id.startsWith(`${actor.uid}_`)); break
    case 'discussions': case 'posts': {
      const authorField = root === 'posts' ? 'authorUid' : 'uid'
      allowed = deleting ? admin || (active && before?.[authorField] === actor.uid) : create ? active && after[authorField] === actor.uid : admin || (active && (before?.[authorField] === actor.uid || only(keys, ['likes'])))
      if (!create && after && keys.has(authorField)) allowed = false
      break
    }
    case 'chats':
      allowed = active && member(id, actor.uid) && !deleting
      if (child) allowed = allowed && create && after.from === actor.uid
      if (!child && after?.participants) allowed = allowed && after.participants.length === 2 && [...after.participants].sort().join('_') === id
      break
    case 'agentChats':
      allowed = child === 'mensajes' && (deleting ? admin : create ? actor.worker || (admin && after.from === 'humano') : actor.worker)
      break
  }
  if (!allowed) throw new ApiError(403, 'permission-denied')
}
