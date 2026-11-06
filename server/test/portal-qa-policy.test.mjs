import test from 'node:test'
import assert from 'node:assert/strict'
import {authorizeWrite} from '../src/policy.mjs'
test('usuario no puede forjar revisión exclusiva, presupuesto ni historial QA',async()=>{
 const actor={uid:'employee',email:'employee@example.test',role:'empleado'},before={asignado:actor.uid,createdBy:actor.email,estado:'en_espera'}
 for(const [key,value] of Object.entries({portalQaOnly:{requestId:'fake'},portalQaLastRequest:'fake',qualityHistory:[],qualityCorrectionCount:0})){
  await assert.rejects(authorizeWrite(actor,{type:'update',path:'tasks/test',data:{[key]:value}},before,{...before,[key]:value},async()=>null),e=>e.status===403)
 }
})
