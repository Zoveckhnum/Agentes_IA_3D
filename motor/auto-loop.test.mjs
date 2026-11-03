import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { createTaskLease, admittedTask, validateLoopPolicy, acquireLoopLock, checkStorage } from './auto-loop.mjs'

test('admisión excluye tareas antiguas, fechas desconocidas, asignaciones vigentes y exceso de intentos', () => {
  const now=Date.now(), policy=validateLoopPolicy({format:'stackbi-auto-loop-v1',acceptAfter:new Date(now-1000).toISOString(),maxAttempts:3,maxTasksPerDay:10,mode:'tasks-only'})
  const task={id:'task',createdAt:new Date(now).toISOString()}
  assert.equal(admittedTask(task,policy,now),true)
  for(const patch of [{createdAt:new Date(now-2000).toISOString()},{createdAt:null},{autoLoopAttempts:3},{autoLoopOwner:'other',autoLoopExpiresAt:new Date(now+1000).toISOString()},{autoLoopOwner:'other',autoLoopExpiresAt:'invalid'}])assert.equal(admittedTask({...task,...patch},policy,now),false)
  assert.equal(admittedTask({...task,autoLoopOwner:'old',autoLoopExpiresAt:new Date(now-1).toISOString()},policy,now),true)
  assert.throws(()=>validateLoopPolicy({...policy,maxAttempts:100}))
})

function storage(initial) {
  let data=structuredClone(initial)
  return {read:async()=>structuredClone(data),compareUpdate:async(_id,patch,expected)=>{for(const [key,value] of Object.entries(expected))if(JSON.stringify(data[key]??null)!==JSON.stringify(value))throw new Error('conflict');data={...data,...patch}},get:()=>data}
}
test('dos procesos no adquieren la misma tarea y un propietario antiguo no puede guardar resultados', async()=>{
  const task={id:'task',estado:'pendiente'},store=storage(task)
  const a=createTaskLease({task,...store}), b=createTaskLease({task,...store})
  await a.claim();await assert.rejects(b.claim(),/conflict/)
  await a.patch({result:'first'});await a.release()
  const c=createTaskLease({task:store.get(),...store});await c.claim()
  await assert.rejects(a.patch({result:'stale'}));assert.equal(store.get().result,'first')
  await c.release()
})
test('recupera una asignación vencida y cancela ante pausa o cambio del encargo',async()=>{
  const task={id:'t',estado:'en_progreso',tarea:'original',autoLoopOwner:'old',autoLoopExpiresAt:new Date(0).toISOString(),autoLoopAttempts:1},store=storage(task)
  const lease=createTaskLease({task,...store});await lease.claim()
  assert.equal(store.get().autoLoopAttempts,2)
  await store.compareUpdate('t',{tarea:'changed'},{autoLoopOwner:lease.owner})
  await assert.rejects(lease.verify());assert.equal(lease.signal.aborted,true)
  await lease.release()
})
test('un bloqueo local impide abrir otro motor y se libera al cerrar normalmente',()=>{
  const root=realpathSync.native(mkdtempSync(join(tmpdir(),'stackbi-loop-')))
  try {const release=acquireLoopLock(root);assert.throws(()=>acquireLoopLock(root));release();acquireLoopLock(root)();writeFileSync(join(root,'budget.txt'),'bytes exceed limit');assert.throws(()=>checkStorage([root],1),/presupuesto/)}
  finally {assert.ok(relative(realpathSync.native(tmpdir()),root).startsWith('stackbi-loop-'));rmSync(root,{recursive:true})}
})
