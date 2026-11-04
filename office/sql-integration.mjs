// Called only by the disposable SQL integration harness, never against production.
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createServer} from 'node:http'
import {sql} from '../server/src/db.mjs'
import {createOfficeGateway} from './gateway.mjs'
import {createOfficeAuthorizer,createTaskPauser,officeTick} from './controller.mjs'
import {atomicOfficeJson} from './core.mjs'
export async function verifyOfficeIntegration({database,config,cookies,password}){
 const root=mkdtempSync(join(tmpdir(),'stackbi-office-sql-'))
 for(const dir of ['state','private','requests','receipts'])mkdirSync(join(root,dir))
 atomicOfficeJson(join(root,'state','office.json'),{format:'stackbi-office-state-v1',mode:'open',revision:0,autoResume:false})
 const server=createServer(createOfficeGateway({root,database,origin:config.origin,authConfig:config}))
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port
 let assertions=0;const check=(a,b)=>{assert.equal(a,b);assertions++}
 const call=(path,body,cookie)=>fetch(base+'/_office/'+path,{method:body?'POST':'GET',headers:{Origin:config.origin,'Content-Type':'application/json',Cookie:cookie||''},...(body?{body:JSON.stringify(body)}:{})})
 try{
  check((await (await call('status',null,cookies.employee)).json()).canControl,false)
  const denied=await call('login',{email:'employee@test.invalid',password});check(denied.status,403);check(denied.headers.has('set-cookie'),false)
  const login=await call('login',{email:'owner@test.invalid',password});check(login.status,200);check(login.headers.has('set-cookie'),true)
  check((await (await call('status',null,cookies.owner)).json()).canControl,true)
  const commandResponse=await call('close',{revision:0},cookies.owner);check(commandResponse.status,202)
  const {id}=await commandResponse.json(),command=JSON.parse(readFileSync(join(root,'requests',id+'.json'))),authorize=createOfficeAuthorizer(database)
  check(await authorize(command),true)
  const pool=await database.pool()
  await new sql.Request(pool).query("UPDATE app.Accounts SET Disabled=1 WHERE Uid='owner'");check(await authorize(command),false)
  await new sql.Request(pool).query("UPDATE app.Accounts SET Disabled=0 WHERE Uid='owner'; UPDATE app.Documents SET Payload=JSON_MODIFY(Payload,'$.executiveRole',NULL) WHERE Path='users/owner'");check(await authorize(command),false)
  await new sql.Request(pool).query("UPDATE app.Documents SET Payload=JSON_MODIFY(Payload,'$.executiveRole','ceo') WHERE Path='users/owner'; INSERT INTO app.Documents(Path,CollectionPath,DocumentId,Payload) VALUES('tasks/office-active','tasks','office-active',N'{\"estado\":\"en_progreso\",\"autoLoopOwner\":\"synthetic-worker\",\"descripcion\":\"preserve this task\"}')")
  const tasks=createTaskPauser(database)
  check((await officeTick({root,authorize,host:async op=>op==='busy'?{busy:false}:{services:[],sites:[]},pauseTasks:tasks.pause})).mode,'closed')
  const task=async()=>JSON.parse((await new sql.Request(pool).query("SELECT Payload FROM app.Documents WHERE Path='tasks/office-active'")).recordset[0].Payload)
  check((await task()).agentStatus,'office_paused');check((await task()).descripcion,'preserve this task')
  await tasks.resume(id);check((await task()).agentStatus,'queued');check((await task()).officePause,undefined)
  check((await call('status',null,cookies.owner)).status,200)
  return assertions
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(root,{recursive:true})}
}
