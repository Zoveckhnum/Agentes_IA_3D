import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createApprovalLedger,validatePlan,readPlan,canonical,sha256,buttons,authorized,checkedPath } from './core.mjs'
import { createHumanServer } from './server.mjs'
import { executeApproved,executePlan } from './executors.mjs'
import { humanClient,approvalResolution } from './client.mjs'

function fixture(t,options={}) {
  const root=realpathSync.native(mkdtempSync(join(tmpdir(),'stackbi-human-'))),registry=join(root,'registry')
  mkdirSync(registry);mkdirSync(join(root,'state'))
  t.after(()=>{assert.ok(relative(realpathSync.native(tmpdir()),root).startsWith('stackbi-human-'));rmSync(root,{recursive:true,force:true})})
  let clock=Date.now()
  const ledger=createApprovalLedger({root:join(root,'state/requests'),registry,ownerId:'123456',now:()=>clock,...options})
  const makePlan=(kind='verification')=>{
    const id=randomUUID(),bytes=Buffer.from('Reviewed operation fixture'),directory=join(registry,id)
    const target={verification:{effect:'none'},'iis-production':{origin:'https://stackbi.com.mx',service:'node-agentes-ia-3d',repository:'Zoveckhnum/Agentes_IA_3D',commit:'a'.repeat(40),runId:'123',runAttempt:'1',baseline:'b'.repeat(64)},'sql-schema':{database:'AgentesIA3D',schemaSHA256:'c'.repeat(64)},'drive-official':{folderId:'folder12345',rootId:'root123456',folderSHA256:'d'.repeat(64),name:'Documento revisado'}}[kind]
    const file={verification:'verification.txt','iis-production':'artifact.zip','sql-schema':'migration.sql','drive-official':'document.pdf'}[kind]
    const plan=validatePlan({format:'stackbi-human-plan-v1',id,kind,project:'stackbi',summary:'Operación sintética de prueba',createdAt:new Date(clock).toISOString(),target,payload:{file,sha256:sha256(bytes),bytes:bytes.length}})
    mkdirSync(directory);writeFileSync(join(directory,file),bytes);writeFileSync(join(directory,'plan.json'),JSON.stringify(plan));return plan
  }
  const callback=(r,action='a')=>({id:'callback-id',from:{id:123456},message:{message_id:10,chat:{id:123456,type:'private'}},data:`${action}:${r.id}:${r.nonce}`})
  const request=(plan=makePlan())=>{const r=ledger.request(plan.id,{taskId:'task-1'});ledger.delivered(r.id,{chatId:'123456',messageId:10});return ledger.get(r.id)}
  return {root,registry,ledger,makePlan,callback,request,advance:ms=>{clock+=ms}}
}
test('aprueba solo el propietario, chat privado, mensaje y nonce exactos; conserva la decisión tras reiniciar',t=>{
  const f=fixture(t),r=f.request()
  assert.ok(Buffer.byteLength(buttons(r).inline_keyboard[0][0].callback_data)<=64)
  const valid=f.callback(r)
  for(const change of [{from:{id:999999}},{message:{...valid.message,chat:{id:999999,type:'private'}}},{message:{...valid.message,chat:{id:123456,type:'group'}}},{message:{...valid.message,message_id:99}},{data:valid.data.replace(r.nonce,'0'.repeat(16))}])assert.throws(()=>f.ledger.decide({...valid,...change}))
  assert.equal(f.ledger.get(r.id).status,'pending')
  assert.equal(f.ledger.decide(valid).status,'approved')
  const reopened=createApprovalLedger({root:join(f.root,'state/requests'),registry:f.registry,ownerId:'123456'})
  assert.equal(reopened.get(r.id).status,'approved');assert.throws(()=>reopened.decide(valid))
})
test('rechazo y vencimiento bloquean consumo y no permiten cambiar la decisión',t=>{
  const f=fixture(t),r=f.request();f.ledger.decide(f.callback(r,'r'))
  assert.throws(()=>f.ledger.consume(r.id,r.planSHA256,randomUUID()));assert.throws(()=>f.ledger.decide(f.callback(r)))
  const expired=f.request(f.makePlan());f.advance(31*60000)
  assert.equal(f.ledger.get(expired.id).status,'expired');assert.throws(()=>f.ledger.decide(f.callback(expired)));assert.throws(()=>f.ledger.consume(expired.id,expired.planSHA256,randomUUID()))
})
test('el cambio de bytes o manifiesto invalida la aprobación; un plan no puede cambiar de tipo/destino',t=>{
  const f=fixture(t),plan=f.makePlan(),r=f.request(plan);f.ledger.decide(f.callback(r))
  writeFileSync(join(f.registry,plan.id,plan.payload.file),'Changed content')
  assert.throws(()=>f.ledger.consume(r.id,r.planSHA256,randomUUID()))
  for(const kind of ['iis-production','sql-schema','drive-official']){
    const p=f.makePlan(kind);assert.doesNotThrow(()=>readPlan(f.registry,p.id))
    assert.throws(()=>validatePlan({...p,kind:'arbitrary-shell'}))
    if(kind==='sql-schema')assert.throws(()=>validatePlan({...p,target:{...p.target,database:'master'}}))
    if(kind==='iis-production')assert.throws(()=>validatePlan({...p,target:{...p.target,service:'another-service'}}))
  }
})
test('consume una vez antes del efecto; falla cerrada sin ejecutar cuando falta la aprobación',async t=>{
  const f=fixture(t),r=f.request();let effects=0
  const rpc=async(path,body)=>path==='/consume'?f.ledger.consume(body.id,body.planSHA256,body.executionId):f.ledger.complete(body.id,body.executionId,body.result)
  const handler=async()=>{assert.equal(f.ledger.get(r.id).status,'executing');effects++;return {ok:true}}
  await assert.rejects(executeApproved({root:f.root,request:r,rpc,handler}));assert.equal(effects,0)
  f.ledger.decide(f.callback(r))
  await executeApproved({root:f.root,request:r,rpc,handler});assert.equal(effects,1)
  await assert.rejects(executeApproved({root:f.root,request:r,rpc,handler}));assert.equal(effects,1)
})
test('una ejecución fallida queda consumida y no se reintenta ni se sustituye por una verificación',async t=>{
  const f=fixture(t),r=f.request();f.ledger.decide(f.callback(r))
  const rpc=async(path,b)=>path==='/consume'?f.ledger.consume(b.id,b.planSHA256,b.executionId):f.ledger.complete(b.id,b.executionId,b.result)
  await executeApproved({root:f.root,request:r,rpc,handler:async()=>{throw new Error('Synthetic executor failure')}})
  assert.equal(f.ledger.get(r.id).status,'failed');await assert.rejects(executeApproved({root:f.root,request:r,rpc}))
})
test('presupuesta solicitudes y conserva idempotencia incluso para rechazo',t=>{
  const f=fixture(t,{maxDaily:1}),plan=f.makePlan(),r=f.ledger.request(plan.id)
  assert.equal(f.ledger.request(plan.id).id,r.id)
  assert.throws(()=>f.ledger.request(f.makePlan().id),/budget/)
  assert.throws(()=>checkedPath(f.registry,'../escape'))
  const outside=join(f.root,'outside');mkdirSync(outside);const linkId=randomUUID();symlinkSync(outside,join(f.registry,linkId),'junction');assert.throws(()=>readPlan(f.registry,linkId),/Linked/)
})
test('API separa solicitar de consumir y no expone nonce; persona ajena no obtiene acceso',async t=>{
  const f=fixture(t),plan=f.makePlan(),submit='s'.repeat(64),execute='e'.repeat(64)
  const service=createHumanServer({root:f.root,ownerId:'123456',submitHash:sha256(submit),executeHash:sha256(execute),token:'synthetic',port:0,fetchImpl:async()=>new Response(JSON.stringify({ok:false}),{status:500})})
  const address=await service.start({poll:false});t.after(()=>service.close())
  const url=`http://127.0.0.1:${address.port}`
  assert.equal((await fetch(url+'/approved')).status,401)
  assert.equal((await fetch(url+'/approved',{headers:{Authorization:'Bearer '+submit}})).status,404)
  const request=await (await fetch(url+'/request',{method:'POST',headers:{Authorization:'Bearer '+submit,'Content-Type':'application/json'},body:JSON.stringify({planId:plan.id})})).json()
  assert.equal(request.status,'pending');assert.equal(request.nonce,undefined)
  const consume=key=>fetch(url+'/consume',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({id:request.id,planSHA256:request.planSHA256,executionId:randomUUID()})})
  assert.equal((await consume(submit)).status,403);assert.equal((await consume(execute)).status,409)
  assert.equal(authorized('Bearer '+submit,sha256(submit)),true);assert.equal(authorized('Bearer '+execute,sha256(submit)),false)
})
test('el cliente del motor no tiene rutas de decisión, consumo ni ejecución',async()=>{
  let calls=0
  const client=humanClient({}, {credential:()=>({endpoint:'http://127.0.0.1:10013',token:'s'.repeat(64)}),fetchImpl:async()=>{calls++;return new Response('{}')}})
  for(const path of ['/consume','/complete','/approved','/decide'])await assert.rejects(client(path,{}))
  assert.equal(calls,0);await client('/request',{planId:randomUUID()});assert.equal(calls,1)
})
test('el motor solo continúa tras executed y rechaza recibos de otra tarea/proyecto',()=>{
  const task={id:'task-1',projectId:'stackbi'},r={taskId:'task-1',project:'stackbi',status:'approved'}
  assert.equal(approvalResolution(task,[r]),'waiting')
  assert.equal(approvalResolution(task,[{...r,status:'executing'}]),'waiting')
  assert.equal(approvalResolution(task,[{...r,status:'executed'}]),'resume')
  assert.equal(approvalResolution(task,[{...r,status:'rejected'}]),'blocked')
  assert.throws(()=>approvalResolution(task,[{...r,taskId:'another'}]));assert.throws(()=>approvalResolution(task,[{...r,project:'another'}]))
})
test('verificación real no llama a ningún ejecutor de negocio',async t=>{
  const f=fixture(t),p=f.makePlan()
  const result=await executePlan(readPlan(f.registry,p.id),{root:f.root,fetchImpl:()=>{throw new Error('Network forbidden')},runPS:()=>{throw new Error('PowerShell forbidden')}})
  assert.deepEqual(result,{ok:true,kind:'verification',businessEffects:false})
})

test('Drive valida la carpeta exacta antes de publicar y solo sube los bytes revisados',async t=>{
  const f=fixture(t),plan=f.makePlan('drive-official')
  const folder={id:'folder12345',name:'Documentos',mimeType:'application/vnd.google-apps.folder',parents:['root123456'],trashed:false,appProperties:{project:'stackbi'}}
  plan.target.folderSHA256=sha256(canonical(folder))
  writeFileSync(join(f.registry,plan.id,'plan.json'),JSON.stringify(plan))
  let uploads=0,changed=false
  const fetchImpl=async(url,options)=>{
    if(url==='https://oauth2.googleapis.com/token')return new Response(JSON.stringify({access_token:'synthetic-access'}))
    if(url.startsWith('https://www.googleapis.com/drive/v3/files/'))return new Response(JSON.stringify(changed?{...folder,name:'Changed folder'}:folder))
    uploads++;assert.equal(options.method,'POST');assert.ok(options.body.includes(Buffer.from('Reviewed operation fixture')));assert.ok(options.body.includes(Buffer.from(plan.payload.sha256)))
    return new Response(JSON.stringify({id:'new-document'}))
  }
  const config={root:f.root,env:{APP_HITL_GOOGLE_ROOT:'root123456'},fetchImpl}
  const result=await executePlan(readPlan(f.registry,plan.id),config)
  assert.equal(result.ok,true);assert.equal(uploads,1)
  changed=true;await assert.rejects(executePlan(readPlan(f.registry,plan.id),config),/changed/);assert.equal(uploads,1)
})
test('SQL requiere la evidencia de backup y llama solo al helper fijo con el plan registrado',async t=>{
  const f=fixture(t),plan=f.makePlan('sql-schema');let runs=0
  const runPS=(script,args)=>{runs++;assert.ok(script.endsWith('Invoke-HumanSql.ps1'));assert.deepEqual(args,['-Mode','execute','-PlanDirectory',join(f.registry,plan.id)]);return JSON.stringify({ok:true,database:'AgentesIA3D',backupVerified:false})}
  await assert.rejects(executePlan(readPlan(f.registry,plan.id),{root:f.root,runPS}),/verified evidence/)
  assert.equal(runs,1)
})
