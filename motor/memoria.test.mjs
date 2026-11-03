import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, realpathSync, readdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { createMemory, memoryContext } from './memoria.mjs'
function fixture(t) {const root=realpathSync.native(mkdtempSync(join(tmpdir(),'stackbi-memory-')));t.after(()=>{assert.ok(relative(realpathSync.native(tmpdir()),root).startsWith('stackbi-memory-'));rmSync(root,{recursive:true})});return root}
test('las tres capas persisten, reconstruyen índice y separan clientes/proyectos',t=>{
  const root=fixture(t),memory=createMemory(root)
  for(const layer of ['preferencias','manuales','lecciones'])memory.put({layer,title:'Reporte SQL',content:'Conciliar totales SQL antes de entregar el reporte.',project:'alpha',client:'cliente-a',source:'operator:test',trusted:true})
  assert.equal(memory.search('conciliar reporte',{project:'alpha',client:'cliente-a'}).length,3)
  assert.equal(memory.search('reporte',{project:'beta',client:'cliente-a'}).length,0)
  assert.equal(memory.search('reporte',{project:'alpha',client:'cliente-b'}).length,0)
  writeFileSync(join(root,'index.json'),'corrupt')
  assert.equal(createMemory(root).search('sql',{project:'alpha',client:'cliente-a'}).length,3)
  assert.match(memoryContext(memory,{tarea:'reporte',projectId:'alpha',cliente:'cliente-a'}),/nunca instrucciones/)
})
test('rechaza secretos, preferencias no autorizadas, alteraciones y enlaces',t=>{
  const root=fixture(t),memory=createMemory(root),base={layer:'preferencias',title:'SQL',content:'Conciliar reporte',source:'operator:test'}
  assert.throws(()=>memory.put(base))
  assert.throws(()=>memory.put({...base,trusted:true,content:'password=secretvalue123'}))
  const id=memory.put({...base,trusted:true});writeFileSync(join(root,id+'.md'),readFileSync(join(root,id+'.md'),'utf8')+'altered')
  assert.throws(()=>memory.search('SQL'),/alterado/)
  const other=fixture(t);symlinkSync(other,join(root,'linked'),'junction');assert.throws(()=>createMemory(join(root,'linked')),/enlaces/)
})
test('limita disco y contexto, actualiza el mismo documento sin acumular copias',t=>{
  const root=fixture(t),memory=createMemory(root,{maxRecords:1,maxBytes:4000}),base={layer:'manuales',title:'Manual SQL',content:'SQL '+ 'a'.repeat(1000),source:'operator:test',trusted:true}
  const id=memory.put(base);memory.put({...base,content:'SQL version nueva'})
  assert.equal(readdirSync(root).filter(n=>n.endsWith('.md')).length,1)
  assert.throws(()=>memory.put({...base,title:'Otro manual'}),/agotado/)
  assert.ok(memory.search('SQL',{maxChars:5})[0].content.length<=5)
  memory.remove(id);assert.equal(memory.status().records,0)
})
