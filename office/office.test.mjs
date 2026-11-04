import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'node:http'
import {createHash,randomUUID} from 'node:crypto'
import {isHumanCeo,nextOpening,CLOSED_MESSAGE,atomicOfficeJson,readOfficeState,enqueueOfficeCommand} from './core.mjs'
import {officeTick} from './controller.mjs'
import {createOfficeGateway} from './gateway.mjs'
import {authorizeWrite} from '../server/src/policy.mjs'
import {createHumanServer} from '../motor/hitl/server.mjs'
const hash=s=>createHash('sha256').update(s).digest('hex')
const actor={uid:'human-ceo',tokenHash:hash('synthetic-session')},profile={role:'admin',executiveRole:'ceo'}
function fixture(state={}){const root=mkdtempSync(join(tmpdir(),'stackbi-office-'));for(const dir of ['requests','receipts','state','private'])mkdirSync(join(root,dir));atomicOfficeJson(join(root,'state','office.json'),{format:'stackbi-office-state-v1',mode:'open',revision:0,autoResume:true,...state});return root}
test('07:00 siguiente usa fecha civil de México, incluso al cambiar año o mes',()=>{
 assert.equal(nextOpening(new Date('2026-11-04T00:00:00Z')),'2026-11-04T13:00:00.000Z')
 assert.equal(nextOpening(new Date('2026-12-31T23:30:00Z')),'2027-01-01T13:00:00.000Z')
 assert.equal(nextOpening(new Date('2026-11-04T07:00:00Z')),'2026-11-05T13:00:00.000Z')
})
test('solo CEO humano activo: no basta cargo editable, admin o agente',()=>{
 assert.equal(isHumanCeo(actor,profile),true)
 for(const [a,p]of [[{...actor,worker:true},profile],[{...actor,mustChangePassword:true},profile],[actor,{role:'admin',position:'CEO'}],[actor,{role:'pending',executiveRole:'ceo'}],[null,profile]])assert.equal(isHumanCeo(a,p),false)
 assert.equal(isHumanCeo(actor,{role:'empleado',executiveRole:'ceo'}),true)
})
test('empleado, administrador normal y worker no pueden asignarse CEO',async()=>{
 const before={email:'human@example.invalid',role:'empleado',position:'CEO'},after={...before,executiveRole:'ceo'}
 for(const a of [{uid:'u',email:before.email,role:'empleado'},{uid:'admin',role:'admin'},{uid:'worker',worker:true,role:'admin',isSuper:true}])await assert.rejects(authorizeWrite(a,{path:'users/u'},before,after,async()=>null))
 await authorizeWrite({uid:'owner',role:'admin',isSuper:true},{path:'users/u'},before,after,async()=>null)
})
test('cierre preserva snapshot, espera operación en curso y detiene antes de marcar cerrado',async()=>{
 const root=fixture(),calls=[],now=()=>new Date('2026-11-04T00:30:00Z');let busy=true
 enqueueOfficeCommand(root,{action:'close',actor,profile,sessionHash:actor.tokenHash,revision:0,now:now()})
 const host=async op=>{calls.push(op);return op==='snapshot'?{saved:true}:op==='busy'?{busy}: {ok:true}}
 const options={root,host,now,authorize:async()=>true,pauseTasks:async()=>calls.push('pause-tasks')}
 let state=await officeTick(options);assert.equal(state.mode,'closing');assert.equal(calls.includes('stop'),false)
 busy=false;state=await officeTick(options);assert.equal(state.mode,'closed');assert.equal(state.reopenAt,'2026-11-04T13:00:00.000Z');assert.ok(calls.indexOf('pause-tasks')<calls.indexOf('stop'))
 assert.equal(JSON.stringify(state).includes(actor.tokenHash),false)
})

test('ni worker ni administrador pueden alterar el marcador de pausa protegido',async()=>{
 const before={asignado:'agent',estado:'en_espera',officePause:{closeId:'synthetic'}},after={...before,estado:'en_revision'}
 for(const a of [{uid:'worker',worker:true},{uid:'owner',role:'admin',isSuper:true}]){
  await assert.rejects(authorizeWrite(a,{path:'tasks/paused'},before,after,async()=>({active:true})))
  await assert.rejects(authorizeWrite(a,{path:'tasks/fresh'},{asignado:'agent'},{asignado:'agent',officePause:{}},async()=>({active:true})))
 }
})
test('reapertura automática no ocurre antes de 07:00 ni con autoResume deshabilitado',async()=>{
 const root=fixture({mode:'closed',reopenAt:'2026-11-04T13:00:00Z',closedId:randomUUID()}),calls=[];atomicOfficeJson(join(root,'private','snapshot.json'),{saved:true})
 let time=new Date('2026-11-04T12:59:59Z');const options={root,now:()=>time,authorize:async()=>false,host:async op=>{calls.push(op);return {ok:true}},resumeTasks:async()=>calls.push('resume-tasks')}
 assert.equal((await officeTick(options)).mode,'closed');assert.equal(calls.length,0)
 time=new Date('2026-11-04T13:00:00Z');assert.equal((await officeTick(options)).mode,'open');assert.deepEqual(calls,['start','resume-tasks','resume'])
 const manual=fixture({mode:'closed',autoResume:false,reopenAt:'2026-11-04T13:00:00Z'});assert.equal((await officeTick({...options,root:manual})).mode,'closed')
})
test('reapertura fallida vuelve a detener trabajo y queda bloqueada después de tres intentos',async()=>{
 const root=fixture({mode:'opening',closedId:randomUUID()}),calls=[];atomicOfficeJson(join(root,'private','snapshot.json'),{})
 const options={root,authorize:async()=>false,host:async op=>{calls.push(op);if(op==='start')throw new Error('health failed');return {}},pauseTasks:async()=>calls.push('pause')}
 for(let i=0;i<3;i++)await officeTick(options)
 assert.equal(readOfficeState(join(root,'state','office.json')).mode,'error');assert.equal(calls.filter(x=>x==='stop').length,3)
})
test('peticiones viejas, repetidas o con sesión revocada no accionan servicios',async()=>{
 const root=fixture(),now=()=>new Date('2026-11-04T01:00:00Z'),calls=[]
 const id=enqueueOfficeCommand(root,{action:'close',actor,profile,sessionHash:actor.tokenHash,revision:0,now:new Date('2026-11-04T00:00:00Z')}).id
 await officeTick({root,now,authorize:async()=>true,host:async op=>calls.push(op)});assert.equal(calls.length,0);assert.equal(JSON.parse(readFileSync(join(root,'receipts',id+'.json'))).accepted,false)
 enqueueOfficeCommand(root,{action:'close',actor,profile,sessionHash:actor.tokenHash,revision:0,now:now()})
 await officeTick({root,now,authorize:async()=>false,host:async op=>calls.push(op)});assert.equal(calls.length,0)
})
test('gateway valida rol y origen en servidor; cerrado sirve 503 sin caché y no consulta aplicación',async()=>{
 const root=fixture(),identities={ceo:actor,employee:{uid:'employee',tokenHash:hash('employee')},admin:{uid:'admin',tokenHash:hash('admin')},agent:{...actor,worker:true}},profiles={...{[actor.uid]:profile},employee:{role:'empleado',position:'CEO'},admin:{role:'admin'}}
 const auth={actor:async req=>{const value=identities[req.headers.cookie];if(!value)throw new Error('unauthenticated');return value}}
 const app=createOfficeGateway({root,database:{},origin:'http://127.0.0.1',authConfig:{},authOverride:auth,profileOverride:async uid=>profiles[uid]})
 const server=createServer(app);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port
 try{
  for(const cookie of ['', 'employee','admin','agent']){const r=await fetch(base+'/_office/close',{method:'POST',headers:{Origin:'http://127.0.0.1','Content-Type':'application/json',Cookie:cookie},body:'{"revision":0}'});assert.equal(r.status,403)}
  const forged=await fetch(base+'/_office/close',{method:'POST',headers:{Origin:'https://foreign.invalid','Content-Type':'application/json',Cookie:'ceo'},body:'{"revision":0}'});assert.equal(forged.status,403)
  const bearer=await fetch(base+'/_office/close',{method:'POST',headers:{Origin:'http://127.0.0.1','Content-Type':'application/json',Cookie:'ceo',Authorization:'Bearer synthetic'},body:'{"revision":0}'});assert.equal(bearer.status,403)
  const valid=await fetch(base+'/_office/close',{method:'POST',headers:{Origin:'http://127.0.0.1','Content-Type':'application/json',Cookie:'ceo'},body:'{"revision":0}'});assert.equal(valid.status,202);assert.equal(readdirSync(join(root,'requests')).length,1)
  atomicOfficeJson(join(root,'state','office.json'),{format:'stackbi-office-state-v1',mode:'closed',revision:1,reopenAt:'2026-11-04T13:00:00Z'})
  const page=await fetch(base+'/cualquier/ruta');assert.equal(page.status,503);assert.match(page.headers.get('cache-control'),/no-store/);assert.ok((await page.text()).includes(CLOSED_MESSAGE))
  const api=await fetch(base+'/api/data/read');assert.equal(api.status,503);assert.equal((await api.json()).message,CLOSED_MESSAGE)
  const status=await fetch(base+'/_office/status',{headers:{Cookie:'ceo'}});assert.equal((await status.json()).canControl,true)
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
test('Telegram cerrado anuncia y responde el mismo texto sin autorizar ni invocar IA',async()=>{
 const root=fixture({mode:'closed',revision:1,closedId:randomUUID(),reopenAt:'2026-11-04T13:00:00Z'});mkdirSync(join(root,'registry'))
 const sent=[];let delivered=false,resolveMessages;const complete=new Promise(r=>{resolveMessages=r})
 const fetchImpl=async(url,{body,signal})=>{
  const method=url.split('/').at(-1),data=JSON.parse(body)
  if(method==='sendMessage'){sent.push(data);if(sent.length>=2)resolveMessages();return {ok:true,json:async()=>({ok:true,result:{message_id:sent.length,chat:{id:1}}})}}
  if(method==='getUpdates'){
   if(!delivered){delivered=true;return {ok:true,json:async()=>({ok:true,result:[{update_id:1,message:{chat:{type:'private',id:1234},from:{id:1234},text:'¿Hay alguien trabajando?'}}]})}}
   return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('stopped')),{once:true}))
  }
  return {ok:true,json:async()=>({ok:true,result:{id:1}})}
 }
 const service=createHumanServer({root,ownerId:'1234',submitHash:hash('submit'),executeHash:hash('execute'),token:'synthetic',fetchImpl,port:0,officeStateFile:join(root,'state','office.json')})
 const address=await service.start()
 try{
  await Promise.race([complete,new Promise((_,reject)=>setTimeout(()=>reject(new Error('notification timeout')),1500))])
  assert.equal(sent.length,2);assert.ok(sent.every(m=>m.text===CLOSED_MESSAGE&&String(m.chat_id)==='1234'))
  const response=await fetch('http://127.0.0.1:'+address.port+'/request',{method:'POST',headers:{Authorization:'Bearer submit','Content-Type':'application/json'},body:'{}'});assert.equal(response.status,503)
  const approved=await fetch('http://127.0.0.1:'+address.port+'/approved',{headers:{Authorization:'Bearer execute'}});assert.deepEqual(await approved.json(),{requests:[]})
  assert.equal(JSON.parse(readFileSync(join(root,'state','office-notice.json'))).status,'delivered')
 }finally{await service.close()}
})
