import { readFile,writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { validatePolicy,validateApproval } from '../deploy/cicd/policy.mjs'
const root='C:\\ProgramData\\StackBI\\DeployBroker'
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''))
const policy=await json(join(root,'policy.json'));validatePolicy(policy)
const args=process.argv.slice(2),command=args.shift()
if(command==='status'){
  for(const file of ['status','latest-candidate','last-deployment'])try{console.log(JSON.stringify({record:file,...await json(join(root,'state',file+'.json'))}))}catch(e){if(e.code!=='ENOENT')throw e}
}else if(command==='approve'){
  const options=Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[i*2],args[i*2+1]]))
  const candidate=await json(join(root,'state/latest-candidate.json'))
  if(options['--commit']!==candidate.commit||options['--sha256']!==candidate.digest||options['--run-id']!==candidate.runId||options['--environment']!=='staging')throw new Error('Specify the exact inspected --commit, --sha256, --run-id and --environment staging')
  const admin=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{encoding:'utf8',windowsHide:true}).trim()
  if(admin!=='True')throw new Error('Approval requires an elevated operator')
  const sid=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],{encoding:'utf8',windowsHide:true}).trim()
  const approval={format:'stackbi-deploy-approval-v1',environment:'staging',repository:candidate.repository,commit:candidate.commit,digest:candidate.digest,runId:candidate.runId,runAttempt:candidate.runAttempt,nonce:randomUUID(),approvedBySid:sid,issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+30*60000).toISOString()}
  validateApproval(approval,candidate,new Set())
  await writeFile(join(root,'approvals',approval.nonce+'.json'),JSON.stringify(approval,null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify({approved:true,environment:'staging',commit:approval.commit,digest:approval.digest,nonce:approval.nonce,expiresAt:approval.expiresAt}))
}else throw new Error('Use status, or approve --environment staging --commit SHA --sha256 DIGEST --run-id ID')
