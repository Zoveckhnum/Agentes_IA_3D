import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {reviewDelivery} from './calidad.mjs'
import {portalQualityCycle,exclusivePortalQa,outputHash} from './portal-quality-cycle.mjs'
const task={portalBridge:{integration:'iqualitys'},tarea:'Resumen de las entrevistas',projectId:''}
const verdict=(status,issues=[])=>({qualityStatus:status,qualityCheckedAt:new Date().toISOString(),qualityReviews:[{verdict:status,summary:'Revisión de prueba',evidence:['Fuente de prueba'],issues}]})

test('corrige dictamen incoherente una vez y conserva intentos sin inventar aprobación',async()=>{
 const cwd=mkdtempSync(join(tmpdir(),'portal-review-'));writeFileSync(join(cwd,'fuente.txt'),'Referencia ficticia')
 try{let calls=0;const q=await reviewDelivery({cwd,task,author:{id:'author'},agents:[{id:'qa',name:'QA'}],profile:()=>({id:'qa',qualityReviewer:true}),requiredRoles:['qa'],result:'Resumen de prueba',runCodex:async(prompt)=>{
  calls++;assert.match(prompt,/Revisión documental proporcional/)
  return{code:0,json:{result:JSON.stringify({verdict:'passed',summary:'Revisado',evidence:calls===1?[]:['fuente.txt: Referencia ficticia'],issues:[]})}}
 }})
 assert.equal(calls,2);assert.equal(q.qualityStatus,'passed');assert.equal(q.qualityReviews[0].attempts.length,2);assert.equal(q.qualityReviews[0].attempts[0].valid,false)
 }finally{rmSync(cwd,{recursive:true,force:true})}
})
test('dos dictámenes inválidos quedan bloqueados y conservan detalles',async()=>{
 const cwd=mkdtempSync(join(tmpdir(),'portal-review-'));try{
 let calls=0;const q=await reviewDelivery({cwd,task,author:{id:'author'},agents:[{id:'qa'}],profile:()=>({id:'qa',qualityReviewer:true}),requiredRoles:['qa'],result:'Resumen',runCodex:async()=>{calls++;return{code:0,json:{result:JSON.stringify({verdict:'passed',summary:'OK',evidence:[],issues:['Falta corregir referencia']})}}}})
 assert.equal(calls,2);assert.equal(q.qualityStatus,'blocked');assert.match(q.qualityReviews[0].attempts[0].response,/Falta corregir referencia/)
 }finally{rmSync(cwd,{recursive:true,force:true})}
})
test('defecto corregible devuelve al autor y se revisa la nueva entrega',async()=>{
 let reviews=0,authors=0;const stages=[]
 const r=await portalQualityCycle({task,result:'Original',review:async(text)=>{reviews++;assert.equal(text,reviews===1?'Original':'Corregido');return verdict(reviews===1?'failed':'passed',['Primera referencia incorrecta'].slice(reviews-1))},correct:async()=>{authors++;return{result:'Corregido'}},onStage:async s=>stages.push(s)})
 assert.equal(r.quality.qualityStatus,'passed');assert.equal(authors,1);assert.equal(r.corrections,1);assert.equal(r.quality.qualityHistory.length,2);assert.deepEqual(stages,['reviewing','correcting','reviewing'])
})
test('máximo dos correcciones y tres revisiones',async()=>{
 let authors=0,reviews=0;const r=await portalQualityCycle({task,result:'Original',review:async()=>{reviews++;return verdict('failed',['Defecto reproducible'])},correct:async()=>{authors++;return{result:'Intento '+authors}}})
 assert.equal(authors,2);assert.equal(reviews,3);assert.equal(r.quality.qualityStatus,'failed')
})
test('bloqueos y datos indispensables nunca disparan al autor',async()=>{
 for(const status of ['passed','blocked']){const r=await portalQualityCycle({task,result:'Original',review:async()=>verdict(status),correct:()=>{throw Error('No debe ejecutar autor')}});assert.equal(r.result,'Original')}
})
test('revisión exclusiva mantiene texto e historial y no repite autor',async()=>{
 const r=await portalQualityCycle({task:{...task,qualityCheckedAt:'2026-11-05T23:00:00Z',qualityStatus:'blocked',qualityReviews:[{summary:'Dictamen anterior'}]},result:'Original',allowCorrections:false,review:async()=>verdict('failed',['Corregir']),correct:()=>{throw Error('No debe ejecutar autor')}})
 assert.equal(r.result,'Original');assert.equal(r.corrections,0);assert.equal(r.quality.qualityHistory[0].qualityStatus,'blocked')
})
test('autorización o petición de información en corrección detiene el ciclo',async()=>{
 let reviews=0;const r=await portalQualityCycle({task,result:'Original',review:async()=>{reviews++;return verdict('failed',['Referencia incorrecta'])},correct:async()=>({blocked:true,reason:'NECESITO: autorización'})});assert.equal(reviews,1);assert.equal(r.quality.qualityStatus,'blocked');assert.equal(r.result,'Original')
})
test('tareas ajenas al portal conservan su política y no se autocorrigen',async()=>{
 const r=await portalQualityCycle({task:{projectId:'project'},result:'Original',review:async()=>verdict('failed',['Defecto']),correct:()=>{throw Error('No debe ejecutar autor')}});assert.equal(r.quality.qualityHistory,undefined);assert.equal(r.corrections,0)
})
test('presupuesto persistido evita reiniciar el ciclo de correcciones',async()=>{
 const r=await portalQualityCycle({task:{...task,qualityCorrectionCount:2},result:'Original',review:async()=>verdict('failed',['Defecto']),correct:()=>{throw Error('Presupuesto agotado')}});assert.equal(r.corrections,0);assert.equal(r.quality.qualityCorrectionCount,2)
})
test('solo orden explícita y hash vigente permiten QA exclusiva sin aceptar trabajo del autor',()=>{
 const t={...task,pendingAcceptance:true,agentOutput:'Original',portalQaOnly:{requestId:'11111111-1111-4111-8111-111111111111',outputSHA256:outputHash('Original')}};
 assert.equal(exclusivePortalQa(t),true);assert.equal(t.pendingAcceptance,true);
 assert.equal(exclusivePortalQa({...t,agentOutput:'Cambió'}),false);assert.equal(exclusivePortalQa({...t,portalQaOnly:null}),false);assert.equal(exclusivePortalQa({...t,projectId:'project'}),false)
})
