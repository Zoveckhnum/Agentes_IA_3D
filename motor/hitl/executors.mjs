import { readFile,mkdir,cp,rename,readdir,lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readPlan,sha256,canonical,readJson,checkedPath } from './core.mjs'
import { verifyArtifact,extractArtifact } from '../../deploy/cicd/artifact.mjs'

const production='C:\\ProgramData\\StackBI\\Applications\\agentes-ia-3d\\deployment.json'
const powershell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
async function directoryBytes(directory){let size=0;for(const entry of await readdir(directory,{withFileTypes:true})){const file=join(directory,entry.name),stat=await lstat(file);if(stat.isSymbolicLink())throw new Error('Linked execution workspace');size+=entry.isDirectory()?await directoryBytes(file):stat.size}return size}
export function runPowerShell(script,args=[],{timeout=1800000}={}) {
  const child=spawnSync(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,...args],{encoding:'utf8',windowsHide:true,timeout,maxBuffer:1024*1024})
  if(child.status!==0)throw new Error('Trusted operation helper failed; inspect restricted operator logs')
  return child.stdout.trim()
}
export async function googleAccess(env=process.env,fetchImpl=fetch) {
  const response=await fetchImpl('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.APP_HITL_GOOGLE_CLIENT_ID,client_secret:env.APP_HITL_GOOGLE_CLIENT_SECRET||'',refresh_token:env.APP_HITL_GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'}),signal:AbortSignal.timeout(20000),redirect:'error'})
  const result=await response.json()
  if(!response.ok||!result.access_token)throw new Error('Google authorization unavailable')
  return result.access_token
}
export async function driveFolder(folderId,env=process.env,fetchImpl=fetch) {
  const access=await googleAccess(env,fetchImpl)
  const response=await fetchImpl('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(folderId)+'?fields=id,name,mimeType,parents,trashed,appProperties',{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(20000),redirect:'error'})
  const folder=await response.json()
  if(!response.ok||folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder'||!folder.parents?.includes(env.APP_HITL_GOOGLE_ROOT))throw new Error('Official folder is outside the registered Drive root')
  return {folder,access,digest:sha256(canonical(folder))}
}
export async function executePlan(verified,{root,env=process.env,fetchImpl=fetch,runPS=runPowerShell}={}) {
  const {plan,directory}=verified
  const payload=await readFile(checkedPath(directory,plan.payload.file))
  if(sha256(payload)!==plan.payload.sha256)throw new Error('Approved content changed before execution')
  if(plan.kind==='verification')return {ok:true,kind:'verification',businessEffects:false}
  if(plan.kind==='iis-production'){
    if(sha256(await readFile(production))!==plan.target.baseline)throw new Error('Production changed after preparation')
    const artifact=verifyArtifact(payload,{repository:plan.target.repository,commit:plan.target.commit,runId:plan.target.runId,runAttempt:plan.target.runAttempt})
    if(await directoryBytes(join(root,'work'))+[...artifact.files.values()].reduce((sum,b)=>sum+b.length,0)>2*1024**3)throw new Error('Execution workspace exceeds 2 GiB; archive completed operations')
    const work=join(root,'work',plan.id)
    await extractArtifact(artifact,work);await mkdir(join(work,'deploy'));await rename(join(work,'public'),join(work,'deploy/sql-preview'))
    const support=join(root,'program/support')
    for(const name of ['roles','shared','app/src'])await cp(join(support,name),join(work,name),{recursive:true})
    for(const name of ['tools/roles.mjs','motor/role-skills.mjs']){await mkdir(join(work,name,'..'),{recursive:true});await cp(join(support,name),join(work,name))}
    runPS(join(root,'program/deploy/windows/Update-SqlPreview.ps1'),['-RepositoryRoot',work,'-PublicOrigin','https://stackbi.com.mx'])
    const deployment=readJson(production)
    const expected=await readFile(join(work,'deploy/sql-preview/index.html'),'utf8')
    const page=await fetchImpl('http://127.0.0.1:10011/',{signal:AbortSignal.timeout(10000)})
    if(!page.ok||await page.text()!==expected)throw new Error('Published frontend differs from approved artifact')
    return {ok:true,kind:plan.kind,commit:plan.target.commit,release:deployment.release}
  }
  if(plan.kind==='sql-schema'){
    const value=runPS(join(root,'program/deploy/windows/Invoke-HumanSql.ps1'),['-Mode','execute','-PlanDirectory',directory])
    const result=JSON.parse(value)
    if(!result.ok||!result.backupVerified)throw new Error('Schema change did not return verified evidence')
    return {ok:true,kind:plan.kind,database:result.database,backupVerified:true,afterSchemaSHA256:result.afterSchemaSHA256}
  }
  if(plan.kind==='drive-official'){
    const {folder,access,digest}=await driveFolder(plan.target.folderId,env,fetchImpl)
    if(env.APP_HITL_GOOGLE_ROOT!==plan.target.rootId||digest!==plan.target.folderSHA256||folder.appProperties?.project!==plan.project)throw new Error('Drive destination changed after preparation')
    const boundary='stackbi_'+randomUUID().replaceAll('-','')
    const metadata={name:plan.target.name,parents:[folder.id],appProperties:{project:plan.project,approval:plan.id,sha256:plan.payload.sha256,official:'true'}}
    const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),payload,Buffer.from(`\r\n--${boundary}--\r\n`)])
    const response=await fetchImpl('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,appProperties',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':`multipart/related; boundary=${boundary}`},body,signal:AbortSignal.timeout(60000),redirect:'error'})
    const result=await response.json()
    if(!response.ok||!result.id)throw new Error('Official upload failed or its outcome is uncertain; inspect Drive before preparing another operation')
    return {ok:true,kind:plan.kind,fileId:result.id,url:`https://drive.google.com/file/d/${encodeURIComponent(result.id)}/view`}
  }
  throw new Error('No trusted executor for this operation')
}

export async function executeApproved({root,request,executionId=randomUUID(),rpc,handler=executePlan}) {
  const verified=readPlan(join(root,'registry'),request.planId)
  if(verified.digest!==request.planSHA256)throw new Error('Prepared plan changed')
  // Consumption is durable BEFORE any external effect. Never automatically replay.
  await rpc('/consume',{id:request.id,planSHA256:verified.digest,executionId})
  let result
  try{result=await handler(verified,{root})}catch{result={ok:false,code:'operation_failed_or_outcome_uncertain'}}
  await rpc('/complete',{id:request.id,executionId,result})
  return result
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const root=process.env.APP_HITL_ROOT||'C:\\ProgramData\\StackBI\\HumanApprovals'
  const rpc=async(path,body)=>{
    const r=await fetch('http://127.0.0.1:10013'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+process.env.APP_HITL_EXECUTE_TOKEN,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)})
    if(!r.ok)throw new Error('Approval service rejected execution')
    return r.json()
  }
  const requests=(await rpc('/approved')).requests
  for(const request of requests.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)).slice(0,1)){
    try{const result=await executeApproved({root,request,rpc});console.log(JSON.stringify({event:'human_operation_finished',requestId:request.id,ok:result.ok}))}
    catch{console.error(JSON.stringify({event:'human_operation_not_started_or_receipt_uncertain',requestId:request.id}))}
  }
}
