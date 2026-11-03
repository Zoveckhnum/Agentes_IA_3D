import { readFile,writeFile,mkdir,readdir,lstat,rm,open,unlink } from 'node:fs/promises'
import { resolve,join,relative,isAbsolute } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { verifyArtifact,extractArtifact,sha256 } from './artifact.mjs'
import { readZip } from './zip.mjs'
import { validateRun,validateApproval,validatePolicy } from './policy.mjs'
const root=process.env.APP_CI_ROOT||'C:\\ProgramData\\StackBI\\DeployBroker'
const abort=new AbortController()
const signal=milliseconds=>AbortSignal.any([AbortSignal.timeout(milliseconds),abort.signal])
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''))
const save=async(path,value)=>{await writeFile(path+'.tmp',JSON.stringify(value,null,2)+'\n');await import('node:fs/promises').then(fs=>fs.rename(path+'.tmp',path))}
const log=(event,extra={})=>console.log(JSON.stringify({event,time:new Date().toISOString(),...extra}))
async function exists(path){try{await lstat(path);return true}catch(e){if(e.code==='ENOENT')return false;throw e}}
async function directoryBytes(directory){
  let bytes=0
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name),stat=await lstat(path)
    if(stat.isSymbolicLink())throw new Error('Managed storage contains a link')
    bytes+=entry.isDirectory()?await directoryBytes(path):stat.size
  }
  return bytes
}
async function boundedBytes(response){
  if(!response.ok)throw new Error(`HTTP ${response.status}`)
  const parts=[];let length=0
  for await(const chunk of response.body){length+=chunk.length;if(length>128*1024*1024)throw new Error('Artifact download limit');parts.push(chunk)}
  return Buffer.concat(parts)
}
async function github(policy,path,redirect='follow'){
  const response=await fetch(`https://api.github.com/repos/${policy.repository}${path}`,{headers:{Authorization:`Bearer ${process.env.APP_CI_GITHUB_TOKEN}`,Accept:'application/vnd.github+json','User-Agent':'StackBI-DeployBroker'},signal:signal(45000),redirect})
  if(!response.ok && !(redirect==='manual'&&response.status===302))throw new Error(`GitHub HTTP ${response.status}`)
  return response
}
async function prune(directory,keep,pattern,marker,limit=3){
  const dirs=[]
  for(const d of await readdir(directory,{withFileTypes:true}))if(d.isDirectory()&&pattern.test(d.name)){const path=join(directory,d.name);if((await lstat(path)).isSymbolicLink())throw new Error('Managed directory is a link');const meta=await json(join(path,marker));if(meta.format!==(marker==='candidate.json'?'stackbi-candidate-v1':'stackbi-ci-installed-v1'))throw new Error('Unrecognized retention marker');dirs.push({name:d.name,path,date:meta.createdAt||meta.downloadedAt||''})}
  dirs.sort((a,b)=>b.date.localeCompare(a.date))
  const retained=new Set(keep)
  for(const d of dirs){if(retained.size>=limit)break;retained.add(d.path)}
  for(const d of dirs)if(!retained.has(d.path)){
    const within=relative(resolve(directory),resolve(d.path))
    if(!within||within.startsWith('..')||isAbsolute(within))throw new Error('Retention escaped root')
    await rm(d.path,{recursive:true,force:false})
  }
}
async function getCandidate(policy){
  let selected
  for(const branch of policy.allowedBranches){
    const data=await (await github(policy,`/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&status=success&per_page=3`)).json()
    for(const run of data.workflow_runs||[]){try{validateRun(run,policy)}catch{continue}if(!selected||Date.parse(run.updated_at)>Date.parse(selected.updated_at))selected=run}
  }
  if(!selected)return null
  const key=`${selected.id}-${selected.run_attempt}-${selected.head_sha}`
  const directory=join(root,'quarantine',key),marker=join(directory,'candidate.json')
  if(await exists(marker))return json(marker)
  const artifacts=await (await github(policy,`/actions/runs/${selected.id}/artifacts`)).json()
  const artifact=artifacts.artifacts?.find(a=>!a.expired&&a.name===`stackbi-app-${selected.head_sha}`&&a.workflow_run?.id===selected.id&&a.workflow_run?.head_sha===selected.head_sha)
  if(!artifact)throw new Error('Successful CI run has no matching artifact')
  const redirect=await github(policy,`/actions/artifacts/${artifact.id}/zip`,'manual')
  let outer
  if(redirect.status===302){
    const url=new URL(redirect.headers.get('location'))
    if(url.protocol!=='https:'||url.username||url.password||!['.blob.core.windows.net','.githubusercontent.com'].some(s=>url.hostname.endsWith(s)))throw new Error('Untrusted artifact redirect')
    outer=await boundedBytes(await fetch(url,{signal:signal(90000)}))
  }else outer=await boundedBytes(redirect)
  const entries=readZip(outer),filename=`stackbi-${selected.head_sha}.zip`
  if(entries.size!==1||!entries.has(filename))throw new Error('Unexpected artifact envelope')
  const bytes=entries.get(filename),verified=verifyArtifact(bytes,{repository:policy.repository,commit:selected.head_sha,runId:selected.id,runAttempt:selected.run_attempt})
  const candidate={format:'stackbi-candidate-v1',repository:policy.repository,commit:verified.manifest.commit,runId:String(selected.id),runAttempt:String(selected.run_attempt),digest:verified.digest,directory,downloadedAt:new Date().toISOString(),workflowUrl:selected.html_url,artifactId:artifact.id}
  if(await directoryBytes(join(root,'quarantine'))+bytes.length>512*1024*1024)throw new Error('Candidate storage exceeds 512 MiB; review retention before downloading more')
  await mkdir(directory,{recursive:false})
  await writeFile(join(directory,'artifact.zip'),bytes,{flag:'wx'})
  await save(marker,candidate)
  await save(join(root,'state/latest-candidate.json'),candidate)
  log('candidate_ready',{commit:candidate.commit,runId:candidate.runId,digest:candidate.digest})
  return candidate
}
async function processApprovals(policy){
  const receipts=new Set((await readdir(join(root,'receipts'))).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>n.slice(0,-5)))
  const keep=new Set()
  for(const name of await readdir(join(root,'approvals'))){
    if(!/^[a-f0-9-]{36}\.json$/.test(name)||receipts.has(name.slice(0,-5)))continue
    const approval=await json(join(root,'approvals',name))
    const key=`${approval.runId}-${approval.runAttempt}-${approval.commit}`
    if(!/^\d+-\d+-[a-f0-9]{40}$/.test(key))throw new Error('Invalid approval candidate key')
    const directory=join(root,'quarantine',key),candidate=await json(join(directory,'candidate.json'))
    keep.add(directory)
    try{
      validateApproval(approval,candidate,receipts)
      const run=await (await github(policy,`/actions/runs/${candidate.runId}`)).json();validateRun(run,policy)
      if(run.head_sha!==candidate.commit||String(run.run_attempt)!==candidate.runAttempt)throw new Error('Run changed since approval')
      const verified=verifyArtifact(await readFile(join(directory,'artifact.zip')),{repository:policy.repository,commit:candidate.commit,runId:candidate.runId,runAttempt:candidate.runAttempt})
      if(verified.digest!==approval.digest)throw new Error('Approved archive changed')
      const migrations=Object.fromEntries(Object.entries(verified.manifest.files).filter(([n])=>n.startsWith('server/migrations/')).map(([n,h])=>[n.slice('server/migrations/'.length),h]))
      if(JSON.stringify(Object.entries(migrations).sort())!==JSON.stringify(Object.entries(policy.migrations).sort()))throw new Error('Schema changed; separate migration approval is required')
      const receipt={...candidate,format:'stackbi-deployment-receipt-v1',nonce:approval.nonce,environment:'staging',approvedBySid:approval.approvedBySid,startedAt:new Date().toISOString(),status:'started'}
      const receiptPath=join(root,'receipts',name)
      await writeFile(receiptPath,JSON.stringify(receipt)+'\n',{flag:'wx'});receipts.add(approval.nonce)
      const release=join(policy.applicationRoot,'releases',`ci-${candidate.runId}-${candidate.commit.slice(0,12)}-${approval.nonce.slice(0,8)}`)
      if(await directoryBytes(join(policy.applicationRoot,'releases'))+[...verified.files.values()].reduce((n,b)=>n+b.length,0)>2*1024*1024*1024)throw new Error('Staging releases exceed 2 GiB; review retention')
      await extractArtifact(verified,release)
      await save(join(release,'.release.json'),{format:'stackbi-ci-installed-v1',digest:verified.digest,commit:candidate.commit,createdAt:new Date().toISOString(),verified:false})
      const env={...process.env};delete env.APP_CI_GITHUB_TOKEN
      const execution=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-File',join(root,'program/Deploy-Staging.ps1'),'-ReleaseDirectory',release,'-ArtifactSHA256',verified.digest,'-Commit',candidate.commit,'-RunId',candidate.runId],{encoding:'utf8',timeout:150000,windowsHide:true,env})
      receipt.status=execution.status===0?'deployed':'failed';receipt.finishedAt=new Date().toISOString()
      try{receipt.result=JSON.parse(execution.stdout.trim())}catch{receipt.result={ok:false,diagnostic:'Deployment process failed; inspect restricted service logs'}}
      await save(receiptPath,receipt)
      await save(join(root,'state/last-deployment.json'),receipt)
      log('deployment_finished',{status:receipt.status,commit:candidate.commit,runId:candidate.runId})
      if(execution.status!==0)continue
      const current=await json(join(policy.applicationRoot,'deployment.json'))
      await prune(join(policy.applicationRoot,'releases'),new Set([current.release,current.previousRelease].filter(Boolean)),/^(bootstrap|ci-\d+-[a-f0-9]{12}(?:-[a-f0-9]{8})?)$/,'.release.json')
    }catch(error){
      const receiptPath=join(root,'receipts',name)
      if(await exists(receiptPath)){const receipt=await json(receiptPath);receipt.status='failed';receipt.reason=error.message;receipt.finishedAt=new Date().toISOString();await save(receiptPath,receipt);await save(join(root,'state/last-deployment.json'),receipt)}
      log('approval_rejected',{nonce:approval.nonce,reason:error.message});await save(join(root,'state/rejected-approval.json'),{nonce:approval.nonce,reason:error.message,time:new Date().toISOString()})
    }
  }
  return keep
}
export async function tick(){
  const policy=await json(join(root,'policy.json'));validatePolicy(policy)
  if(!process.env.APP_CI_GITHUB_TOKEN)throw new Error('Missing protected GitHub credential')
  const mutex=join(root,'state/broker.lock');let lock
  try{lock=await open(mutex,'wx')}catch(e){if(e.code==='EEXIST')throw new Error('Broker lock exists; inspect before clearing');throw e}
  try{
    await processApprovals(policy)
    const candidate=await getCandidate(policy)
    const keep=await processApprovals(policy)
    if(candidate)keep.add(candidate.directory)
    await prune(join(root,'quarantine'),keep,/^\d+-\d+-[a-f0-9]{40}$/,'candidate.json')
    await save(join(root,'state/status.json'),{ok:true,lastPoll:new Date().toISOString(),candidate:candidate?.commit||null,environment:'staging',productionEnabled:false})
  }finally{await lock.close();await unlink(mutex)}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  let stopping=false
  for(const name of ['SIGTERM','SIGINT','SIGBREAK'])process.on(name,()=>{stopping=true;abort.abort()})
  do{
    try{await tick()}catch(error){if(!stopping){log('poll_failed',{reason:error.message});await save(join(root,'state/status.json'),{ok:false,reason:error.message,lastPoll:new Date().toISOString()})}}
    if(!stopping)await new Promise(r=>{const stop=()=>{clearTimeout(timer);r()};const timer=setTimeout(()=>{abort.signal.removeEventListener('abort',stop);r()},30000);abort.signal.addEventListener('abort',stop,{once:true})})
  }while(!stopping)
}
