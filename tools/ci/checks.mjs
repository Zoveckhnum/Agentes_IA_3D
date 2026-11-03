import { spawnSync,execFileSync } from 'node:child_process'
import { mkdir,writeFile,readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../../',import.meta.url))
const steps=[['unit',['--test','tools/perfil-local.test.mjs','motor/codex-runner.test.mjs','motor/auto-loop.test.mjs','motor/memoria.test.mjs','motor/role-skills.test.mjs','motor/integraciones.test.mjs','motor/continuidad.test.mjs','motor/espacios-proyecto.test.mjs','motor/registro-proyectos.test.mjs','motor/tareas-proyecto.test.mjs','deploy/cicd/cicd.test.mjs','server/test/contracts.test.mjs','server/test/retention.test.mjs']],['roles',['tools/roles.mjs','check']],['sql-integration',['server/tools/integration-test.mjs']],['build',['tools/build-sql.mjs']]]
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim()
const continuation=process.argv.includes('--integration-build')
const previous=continuation?JSON.parse(await readFile(root+'.local/ci-evidence.json','utf8')):null
if(previous && (previous.commit!==commit || !['unit','roles'].every(c=>previous.checks.includes(c))))throw new Error('Missing unit/role evidence for this commit')
const checks=previous?[...previous.checks]:[]
for(const [name,args] of steps.filter(([name])=>process.argv.includes('--unit-only')?['unit','roles'].includes(name):continuation?!['unit','roles'].includes(name):true)){
  const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:process.env,windowsHide:true})
  if(result.status!==0)throw new Error(`CI check failed: ${name}`)
  checks.push(name)
}
await mkdir(root+'.local',{recursive:true})
await writeFile(root+'.local/ci-evidence.json',JSON.stringify({commit,checks})+'\n')
