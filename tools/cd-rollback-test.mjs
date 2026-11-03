// Operator-only negative test, hard-wired to isolated staging. No production target.
import { mkdir,writeFile,readFile } from 'node:fs/promises'
import { execFileSync,spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const powershell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const admin=execFileSync(powershell,['-NoProfile','-Command','([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{encoding:'utf8',windowsHide:true}).trim()
if(admin!=='True')throw new Error('Elevated operator required for staging recovery drill')
const production='C:\\ProgramData\\StackBI\\Applications\\agentes-ia-3d\\deployment.json'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const before=hash(await readFile(production))
const commit='bad000000000'+'0'.repeat(28)
const directory='C:\\ProgramData\\StackBI\\Applications\\agentes-ia-3d-staging\\releases\\ci-0-bad000000000'
await mkdir(directory,{recursive:false})
await mkdir(directory+'/server/src',{recursive:true})
await mkdir(directory+'/public')
await writeFile(directory+'/server/src/main.mjs','process.exit(3)\n')
await writeFile(directory+'/public/index.html','<html>Intentionally failing staging recovery drill</html>')
await writeFile(directory+'/manifest.json',JSON.stringify({commit,runId:'0'}))
await writeFile(directory+'/.release.json',JSON.stringify({format:'stackbi-ci-installed-v1',verified:false,test:true,createdAt:new Date().toISOString()}))
const result=spawnSync(powershell,['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('../deploy/cicd/Deploy-Staging.ps1',import.meta.url)),'-ReleaseDirectory',directory,'-ArtifactSHA256','0'.repeat(64),'-Commit',commit,'-RunId','0'],{encoding:'utf8',windowsHide:true,timeout:120000})
let proof
try{proof=JSON.parse(result.stdout.trim())}catch{throw new Error('Rollback drill did not return a controlled result')}
if(result.status!==1||!proof.rollbackAttempted||!proof.rollbackHealthy||hash(await readFile(production))!==before)throw new Error('Staging recovery drill failed')
const evidence={...proof,passed:true,productionManifestUnchanged:true,time:new Date().toISOString()}
await writeFile(new URL('../.local/ci-rollback-proof.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n')
console.log(JSON.stringify(evidence))
