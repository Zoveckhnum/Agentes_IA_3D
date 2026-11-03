import { readFileSync,writeFileSync,mkdirSync,readdirSync,lstatSync } from 'node:fs'
import { join,extname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readJson,validatePlan,sha256,canonical,checkedPath,safeSummary,containsSecrets } from '../motor/hitl/core.mjs'
import { driveFolder,runPowerShell } from '../motor/hitl/executors.mjs'
import { verifyArtifact } from '../deploy/cicd/artifact.mjs'
const root=process.env.APP_HITL_ROOT||'C:\\ProgramData\\StackBI\\HumanApprovals'
const args=process.argv.slice(2),command=args.shift()
if(args.length%2)throw new Error('Cada opción requiere un valor')
const options=Object.fromEntries(Array.from({length:args.length/2},(_,i)=>[args[i*2],args[i*2+1]]))
if(command==='prepare'){
  const admin=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'],{encoding:'utf8',windowsHide:true}).trim()
  if(admin!=='True')throw new Error('La preparación requiere un operador administrador')
  const kind=options['--kind'],id=randomUUID(),summary=options['--summary'],project=options['--project']||'stackbi'
  if(!safeSummary(summary))throw new Error('Indica --summary con el alcance concreto revisado, sin credenciales')
  let bytes,file,target
  if(kind==='verification'){bytes=Buffer.from('StackBI: prueba de aprobación sin efectos externos.\n');file='verification.txt';target={effect:'none'}}
  else if(kind==='iis-production'){
    const c=readJson('C:\\ProgramData\\StackBI\\DeployBroker\\state\\latest-candidate.json')
    const expected=join('C:\\ProgramData\\StackBI\\DeployBroker\\quarantine',`${c.runId}-${c.runAttempt}-${c.commit}`)
    if(c.format!=='stackbi-candidate-v1'||c.directory!==expected)throw new Error('Candidato CI no reconocido')
    bytes=readFileSync(join(expected,'artifact.zip'));file='artifact.zip'
    const verified=verifyArtifact(bytes,{repository:'Zoveckhnum/Agentes_IA_3D',commit:c.commit,runId:c.runId,runAttempt:c.runAttempt})
    if(verified.digest!==c.digest)throw new Error('El candidato cambió desde CI')
    target={origin:'https://stackbi.com.mx',service:'node-agentes-ia-3d',repository:c.repository,commit:c.commit,runId:c.runId,runAttempt:c.runAttempt,baseline:sha256(readFileSync('C:\\ProgramData\\StackBI\\Applications\\agentes-ia-3d\\deployment.json'))}
  }else if(kind==='sql-schema'){
    if(extname(options['--file']||'').toLowerCase()!=='.sql')throw new Error('Indica --file con un SQL revisado')
    if(lstatSync(options['--file']).size>512*1024||lstatSync(options['--file']).isSymbolicLink())throw new Error('SQL demasiado grande o enlazado')
    bytes=readFileSync(options['--file']);file='migration.sql'
    const schema=JSON.parse(runPowerShell(join(root,'program/deploy/windows/Invoke-HumanSql.ps1'),['-Mode','inspect']))
    target={database:schema.database,schemaSHA256:schema.schemaSHA256}
  }else if(kind==='drive-official'){
    const extension=extname(options['--file']||'').slice(1).toLowerCase()
    if(!['pdf','docx','xlsx','md','txt','html'].includes(extension)||lstatSync(options['--file']).size>10*1024*1024||lstatSync(options['--file']).isSymbolicLink())throw new Error('Indica un documento revisado de hasta 10 MiB')
    const {folder,digest}=await driveFolder(options['--folder'])
    if(folder.appProperties?.project!==project)throw new Error('La carpeta no pertenece al proyecto indicado')
    bytes=readFileSync(options['--file']);file='document.'+extension
    target={folderId:folder.id,rootId:process.env.APP_HITL_GOOGLE_ROOT,folderSHA256:digest,name:options['--name']}
  }else throw new Error('Tipo de operación no admitido')
  if(containsSecrets(bytes.toString('utf8')) && kind!=='iis-production')throw new Error('El contenido parece contener credenciales; revisa el archivo antes de prepararlo')
  const registry=join(root,'registry')
  let stored=0
  function count(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name),stat=lstatSync(path);if(stat.isSymbolicLink())throw new Error('Enlace en registro de planes');if(entry.isDirectory())count(path);else stored+=stat.size}}
  count(registry);if(stored+bytes.length>512*1024*1024)throw new Error('Registro de operaciones supera 512 MiB; archiva planes terminados')
  const plan=validatePlan({format:'stackbi-human-plan-v1',id,kind,project,summary,createdAt:new Date().toISOString(),target,payload:{file,sha256:sha256(bytes),bytes:bytes.length}})
  const directory=checkedPath(registry,id);mkdirSync(directory)
  writeFileSync(checkedPath(directory,file),bytes,{flag:'wx'})
  writeFileSync(checkedPath(directory,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify({prepared:true,planId:id,kind,project,planSHA256:sha256(canonical(plan)),payloadSHA256:plan.payload.sha256,target}))
}else if(command==='request'||command==='status'){
  const path=command==='request'?'/request':'/requests/'+options['--id']
  const response=await fetch('http://127.0.0.1:10013'+path,{method:command==='request'?'POST':'GET',headers:{Authorization:'Bearer '+process.env.APP_HITL_REQUEST_TOKEN,'Content-Type':'application/json'},...(command==='request'?{body:JSON.stringify({planId:options['--plan'],taskId:options['--task']||''})}:{}),signal:AbortSignal.timeout(15000)})
  if(!response.ok)throw new Error('El servicio no aceptó la solicitud')
  const r=await response.json();console.log(JSON.stringify({requestId:r.id,planId:r.planId,status:r.status,kind:r.kind,expiresAt:r.expiresAt,result:r.result}))
}else throw new Error('Usa prepare, request o status')
