import { randomUUID } from 'node:crypto'
import { mkdirSync, openSync, writeFileSync, closeSync, unlinkSync, lstatSync, realpathSync, readdirSync, statfsSync } from 'node:fs'
import { join } from 'node:path'

export function checkStorage(directories, maxBytes = 2 * 1024 ** 3) {
  let bytes = 0
  function walk(dir) {
    const stat = lstatSync(dir)
    if(stat.isSymbolicLink()) return // Never traverse links to another workspace.
    if(stat.isDirectory()) for(const name of readdirSync(dir)) walk(join(dir,name))
    else bytes += stat.size
    if(bytes > maxBytes) throw new Error('El motor alcanzó su presupuesto de almacenamiento.')
  }
  for(const dir of directories) walk(dir)
  const free=statfsSync(directories[0])
  if(free.bavail * free.bsize < 1024 ** 3) throw new Error('El motor requiere al menos 1 GiB libre.')
  return bytes
}

export function acquireLoopLock(directory) {
  mkdirSync(directory, { recursive: true })
  if (lstatSync(directory).isSymbolicLink()) throw new Error('La carpeta del motor no puede ser un enlace.')
  const file = join(realpathSync.native(directory), 'worker.lock')
  // Deliberately fail closed after a forced kill. An operator must inspect the PID.
  const fd = openSync(file, 'wx')
  writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }))
  return () => { closeSync(fd); unlinkSync(file) }
}

export function admittedTask(task, policy, now = Date.now()) {
  if(!/^[\w-]{1,100}$/.test(task.id || '')) return false
  const created = task.createdAt?.toMillis?.() ?? (task.createdAt?.seconds ? task.createdAt.seconds * 1000 : Date.parse(task.createdAt))
  if (!Number.isFinite(created) || created < Date.parse(policy.acceptAfter)) return false
  if (task.autoLoopOwner && (!Number.isFinite(Date.parse(task.autoLoopExpiresAt)) || Date.parse(task.autoLoopExpiresAt) > now)) return false
  return (task.autoLoopAttempts || 0) < policy.maxAttempts
}

export function createTaskLease({ task, read, compareUpdate, ttlMs = 120000, renewMs = 30000, now = Date.now, onLost = () => {}, checkBudget = () => {} }) {
  const owner = randomUUID(), abort = new AbortController()
  let timer, released = false, renewing = false
  const check = () => { if (released || abort.signal.aborted) throw new Error('La asignación de la tarea dejó de ser válida.') }
  const unchanged = fresh => ['asignado', 'projectId', 'cliente', 'tarea', 'descripcion', 'feedback', 'links'].every(key => (fresh[key] || '') === (task[key] || ''))
  async function patch(data) { check(); await compareUpdate(task.id, data, { autoLoopOwner: owner }) }
  async function renew() {
    if (released || renewing) return
    renewing = true
    try {
      checkBudget()
      const fresh = await read(task.id)
      if (fresh.autoLoopOwner !== owner || fresh.estado !== 'en_progreso' || fresh.timerPaused || !unchanged(fresh)) throw new Error('La tarea fue pausada o reasignada.')
      await patch({ autoLoopExpiresAt: new Date(now() + ttlMs).toISOString() })
    } catch { abort.abort(); onLost() }
    finally { renewing = false }
  }
  return {
    owner, signal: abort.signal,
    async claim() {
      if (task.autoLoopOwner && (!Number.isFinite(Date.parse(task.autoLoopExpiresAt)) || Date.parse(task.autoLoopExpiresAt) > now())) throw new Error('La tarea ya está asignada.')
      const expected = Object.fromEntries(['asignado','projectId','cliente','tarea','descripcion','feedback','links'].map(key=>[key,task[key]??null]))
      await compareUpdate(task.id, { autoLoopOwner: owner, autoLoopExpiresAt: new Date(now() + ttlMs).toISOString(), autoLoopAttempts: (task.autoLoopAttempts || 0) + 1, estado: 'en_progreso', agentStatus: 'running' }, { ...expected, estado: task.estado, autoLoopOwner: task.autoLoopOwner || null, autoLoopExpiresAt: task.autoLoopExpiresAt || null, autoLoopAttempts: task.autoLoopAttempts ?? null })
      timer = setInterval(renew, renewMs); timer.unref()
    },
    patch,
    async verify() { check(); const fresh = await read(task.id); if (fresh.autoLoopOwner !== owner || fresh.estado !== 'en_progreso' || fresh.timerPaused || !unchanged(fresh)) { abort.abort(); throw new Error('La tarea cambió durante la ejecución.') } },
    async release() {
      clearInterval(timer)
      if (!released) { try { await compareUpdate(task.id, { autoLoopOwner: null, autoLoopExpiresAt: null }, { autoLoopOwner: owner }) } finally { released = true; abort.abort() } }
    },
    stop() { abort.abort() },
  }
}

export function validateLoopPolicy(policy) {
  if (policy?.format !== 'stackbi-auto-loop-v1' || !Number.isFinite(Date.parse(policy.acceptAfter)) || !Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 3 || !Number.isInteger(policy.maxTasksPerDay) || policy.maxTasksPerDay < 1 || policy.maxTasksPerDay > 100 || !['tasks-only', 'disabled'].includes(policy.mode)) throw new Error('Política Auto-loop inválida.')
  return policy
}
