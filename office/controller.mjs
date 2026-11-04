import {existsSync,readFileSync,readdirSync,unlinkSync,lstatSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'
import {createDatabase,sql} from '../server/src/db.mjs'
import {readOfficeState,atomicOfficeJson,nextOpening,isHumanCeo} from './core.mjs'

export async function officeTick({root,authorize,host,pauseTasks=async()=>{},resumeTasks=async()=>{},now=()=>new Date()}){
 const statePath=join(root,'state','office.json'),snapshotPath=join(root,'private','snapshot.json')
 let state=readOfficeState(statePath)
 const receipts=readdirSync(join(root,'receipts')).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(name=>({name,time:lstatSync(join(root,'receipts',name)).mtimeMs})).sort((a,b)=>b.time-a.time)
 for(const old of receipts.slice(200))unlinkSync(join(root,'receipts',old.name))
 const save=next=>{state={...next,updatedAt:now().toISOString()};atomicOfficeJson(statePath,state)}
 const receipt=(id,result)=>atomicOfficeJson(join(root,'receipts',id+'.json'),{id,...result,time:now().toISOString()})
 const files=readdirSync(join(root,'requests')).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).sort()
 for(const name of files){
  const file=join(root,'requests',name),id=name.slice(0,-5)
  try{
   const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)throw new Error('invalid_request')
   const request=JSON.parse(readFileSync(file,'utf8')),age=now().getTime()-Date.parse(request.createdAt)
   if(request.format!=='stackbi-office-command-v1'||request.id!==id||!['close','open'].includes(request.action)||!Number.isFinite(age)||age< -5000||age>120000||request.expectedRevision!==state.revision||!await authorize(request))throw new Error('not_authorized')
   if(request.action==='close'){
    if(state.mode!=='open')throw new Error('invalid_state')
    const snapshot=await host('snapshot');atomicOfficeJson(snapshotPath,snapshot)
    save({...state,mode:'closing',revision:state.revision+1,closedId:id,closedBy:request.uid,closedAt:request.createdAt,reopenAt:nextOpening(new Date(request.createdAt)),attempts:0})
   }else{
    if(!['closed','error'].includes(state.mode))throw new Error('invalid_state')
    save({...state,mode:'opening',revision:state.revision+1,requestId:id,openedBy:request.uid,attempts:0})
   }
   receipt(id,{accepted:true,mode:state.mode,action:request.action,actorUid:request.uid})
  }catch{receipt(id,{accepted:false,code:'office_command_rejected'})}
  finally{unlinkSync(file)}
 }
 if(state.mode==='closing'){
  await host('quiesce')
  if((await host('busy')).busy)return state
  await pauseTasks(state.closedId)
  await host('stop')
  save({...state,mode:'closed',fullyClosedAt:now().toISOString()})
 }
 if(state.mode==='closed'&&state.autoResume!==false&&now().getTime()>=Date.parse(state.reopenAt))save({...state,mode:'opening',revision:state.revision+1,openedBy:'scheduled-controller',attempts:0})
 if(state.mode==='opening'){
  try{
   if(!existsSync(snapshotPath))throw new Error('snapshot_missing')
   await host('start',JSON.parse(readFileSync(snapshotPath,'utf8')))
   await resumeTasks(state.closedId)
   await host('resume',JSON.parse(readFileSync(snapshotPath,'utf8')))
   save({...state,mode:'open',openedAt:now().toISOString(),attempts:0})
  }catch{
   try{await host('quiesce');await host('stop');await pauseTasks(state.closedId)}catch{}
   const attempts=(state.attempts||0)+1
   save({...state,mode:attempts>=3?'error':'opening',attempts,code:'opening_failed'})
  }
 }
 return state
}

export function createOfficeAuthorizer(database){return async request=>{
 if(typeof request.uid!=='string'||!/^[a-f0-9]{64}$/.test(request.sessionHash||''))return false
 const rows=(await new sql.Request(await database.pool()).input('uid',sql.NVarChar(128),request.uid).input('hash',sql.Char(64),request.sessionHash).query("SELECT a.Uid,a.MustChangePassword,d.Payload FROM app.Sessions s JOIN app.Accounts a ON a.Uid=s.Uid AND a.CredentialVersion=s.CredentialVersion JOIN app.Documents d ON d.Path=N'users/'+a.Uid WHERE s.TokenHash=@hash AND a.Uid=@uid AND s.ExpiresAt>SYSUTCDATETIME() AND a.Disabled=0")).recordset
 const row=rows[0];return !!row&&isHumanCeo({uid:row.Uid,mustChangePassword:!!row.MustChangePassword},JSON.parse(row.Payload))
}}
export function createTaskPauser(database){
 async function modify(closeId,resume){
  const pool=await database.pool(),tx=new sql.Transaction(pool);await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
  try{
   const rows=(await new sql.Request(tx).query("SELECT Path,Payload FROM app.Documents WITH(UPDLOCK,HOLDLOCK) WHERE CollectionPath='tasks'")).recordset
   for(const row of rows){const task=JSON.parse(row.Payload);let changed=false
    if(!resume&&task.autoLoopOwner&&task.estado==='en_progreso'){
     task.officePause={closeId,previousEstado:'en_revision'};task.estado='en_espera';task.agentStatus='office_paused';task.autoLoopOwner=null;task.autoLoopExpiresAt=null;task.timerStartedAt=null;changed=true
    }else if(resume&&task.officePause?.closeId===closeId&&task.agentStatus==='office_paused'){
     task.estado='en_revision';task.agentStatus='queued';if(Number.isInteger(task.autoLoopAttempts)&&task.autoLoopAttempts>0)task.autoLoopAttempts--;delete task.officePause;changed=true
    }
    if(changed)await new sql.Request(tx).input('path',sql.NVarChar(450),row.Path).input('payload',sql.NVarChar(sql.MAX),JSON.stringify(task)).query("UPDATE app.Documents SET Payload=@payload,UpdatedAt=SYSUTCDATETIME() WHERE Path=@path; INSERT INTO app.AuditLog(Actor,Action,DocumentPath) VALUES(N'office-controller',N'office-pause-resume',@path)")
   }
   await tx.commit()
  }catch(error){await tx.rollback().catch(()=>{});throw error}
 }
 return {pause:id=>modify(id,false),resume:id=>modify(id,true)}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const root=process.env.APP_OFFICE_ROOT,database=createDatabase(),tasks=createTaskPauser(database)
 const host=(operation,snapshot)=>{
  const result=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(root,'service','Office-Host.ps1')],{input:JSON.stringify({operation,snapshot}),encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:16384})
  if(result.status!==0)throw new Error('office_host_failed')
  return JSON.parse(result.stdout.trim())
 }
 try{await officeTick({root,authorize:createOfficeAuthorizer(database),host,pauseTasks:tasks.pause,resumeTasks:tasks.resume});console.log(JSON.stringify({event:'office_tick',ok:true}))}
 catch{console.error(JSON.stringify({event:'office_tick',ok:false}));process.exitCode=1}
 finally{await database.close()}
}
