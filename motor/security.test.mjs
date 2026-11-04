import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,symlinkSync,linkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createWorkspaceGate} from './workspace-gate.mjs'
import {commandDecision,redactSecrets,containsCredential,createSecurityAuditor,assertTaskDirectory,SECURITY_FEATURES} from './security.mjs'
import {createCodexRunner} from './codex-runner.mjs'
const dir=()=>mkdtempSync(join(tmpdir(),'stackbi-security-'))
test('consola general, eliminación masiva y force push están prohibidos; solo huella en decisiones',()=>{
 for(const command of ['rm -rf /','Remove-Item C:\\Windows -Recurse -Force','cmd /c rd /s /q C:\\','git push --force origin main','git -C x push -f origin main','node -e process.exit()','python -c print(1)','curl https://example.invalid','powershell -EncodedCommand QQ==']){const decision=commandDecision(command);assert.equal(decision.allowed,false);assert.match(decision.commandSHA256,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(decision).includes(command),false)}
 assert.equal(SECURITY_FEATURES.shell_tool,false);assert.equal(SECURITY_FEATURES.apps,false);assert.equal(SECURITY_FEATURES.multi_agent,false)
})
test('archivos permitidos: crear, leer, actualizar con hash y rechazar revisiones obsoletas',()=>{
 const root=dir(),events=[],gate=createWorkspaceGate(root,{writable:true,audit:(...event)=>events.push(event)})
 const created=gate.write({path:'src/producto.txt',content:'primera revisión'})
 assert.equal(gate.read({path:'src/producto.txt'}).sha256,created.sha256)
 assert.throws(()=>gate.write({path:'src/producto.txt',content:'sin hash'}),/stale/)
 gate.write({path:'src/producto.txt',content:'segunda',expectedSHA256:created.sha256})
 assert.throws(()=>gate.write({path:'src/producto.txt',content:'tercera',expectedSHA256:created.sha256}),/stale/)
 assert.equal(readFileSync(join(root,'src/producto.txt'),'utf8'),'segunda')
 assert.ok(events.some(e=>e[0]==='file_written'));assert.ok(events.some(e=>e[0]==='tool_denied'))
 assert.equal(gate.remove,undefined);assert.equal(gate.execute,undefined)
})
test('bloquea traversal, unidades, ADS, UNC, dispositivos, configuración y secretos',()=>{
 const root=dir(),gate=createWorkspaceGate(root,{writable:true})
 for(const path of ['../fuera.txt','C:\\Windows\\test.txt','\\\\servidor\\archivo','archivo.txt:flujo','NUL.txt','src/COM1','src./file','src /file','.git/config','.env','.env.production','.codex/config.toml','.agents/skills/x','credentials/x','secrets/x','google-token.json','business.json','auth.json','test.pem','file//otro'])assert.throws(()=>gate.write({path,content:'contenido'}),/security_/)
 assert.equal(existsSync(join(root,'Windows')),false)
})
test('insumos no se editan y QA no puede escribir',()=>{
 const root=dir(),gate=createWorkspaceGate(root,{writable:true})
 for(const path of ['insumos/tarea/entrega.txt','.agentes/tarea.md','revisiones/hash/file','tarea.md','.github/workflows/change.yml'])assert.throws(()=>gate.write({path,content:'cambio'}),/readonly/)
 assert.throws(()=>createWorkspaceGate(root).write({path:'file.txt',content:'x'}),/readonly/)
})
test('rechaza enlaces de directorio, archivo y hardlinks sin alterar canarios externos',()=>{
 const root=dir(),outside=dir();writeFileSync(join(outside,'canary.txt'),'original')
 symlinkSync(outside,join(root,'link'),'junction');linkSync(join(outside,'canary.txt'),join(root,'hard.txt'))
 const gate=createWorkspaceGate(root,{writable:true})
 for(const path of ['link/canary.txt','hard.txt']){assert.throws(()=>gate.read({path}),/link/);assert.throws(()=>gate.write({path,content:'cambio'}),/link/)}
 assert.equal(readFileSync(join(outside,'canary.txt'),'utf8'),'original')
})
test('si no se puede auditar no se escribe ningún archivo',()=>{
 const root=dir(),gate=createWorkspaceGate(root,{writable:true,audit:()=>{throw new Error('audit unavailable')}})
 assert.throws(()=>gate.write({path:'producto.txt',content:'nuevo'}),/audit unavailable/);assert.equal(existsSync(join(root,'producto.txt')),false)
})
test('credenciales sintéticas se omiten en mensajes y se bloquean en archivos',()=>{
 const values=['sk-'+('a'.repeat(30)),'github_pat_'+('b'.repeat(40)),('123456789:')+('c'.repeat(35)),'Bearer '+('d'.repeat(30)),'password="'+('e'.repeat(25))+'"','refresh_token="'+('f'.repeat(30))+'"','-----BEGIN PRIVATE KEY-----\nSYNTHETIC\n-----END PRIVATE KEY-----']
 for(const value of values){assert.equal(containsCredential(value),true);assert.equal(redactSecrets(value).includes(value),false);assert.throws(()=>createWorkspaceGate(dir(),{writable:true}).write({path:'config.txt',content:value}),/sensitive/)}
 assert.equal(redactSecrets('Informe sin credenciales'),'Informe sin credenciales')
 assert.equal(redactSecrets('const api_key = process.env.OPENAI_API_KEY'),'const api_key = process.env.OPENAI_API_KEY')
})
test('auditoría solo contiene hashes y códigos; falla si se exige Windows sin escritor',()=>{
 const secret='sk-'+('z'.repeat(30)),event=createSecurityAuditor({}, {taskId:secret,projectId:'privado'})('tool_denied',{subject:secret,allowed:false,reason:'workspace_policy'})
 assert.doesNotMatch(JSON.stringify(event),/sk-|privado/);assert.match(event.subjectSHA256,/^[a-f0-9]{64}$/)
 assert.throws(()=>createSecurityAuditor({AGENTES_SECURITY_MODE:'strict'}),/not_configured/)
})
test('raíz de tarea debe estar autorizada y sin configuración Codex de proyecto',()=>{
 const state=dir(),projects=dir(),cwd=join(state,'trabajos','test');mkdirSync(cwd,{recursive:true})
 const env={AGENTES_STATE_ROOT:state,AGENTES_PROJECT_ROOT:projects}
 let ancestor=resolve(cwd),inherited=false;while(true){inherited ||= existsSync(join(ancestor,'.codex','config.toml'));const parent=resolve(ancestor,'..');if(parent===ancestor)break;ancestor=parent}
 if(inherited)assert.throws(()=>assertTaskDirectory(cwd,env),/config_forbidden/);else assert.ok(assertTaskDirectory(cwd,env))
 assert.throws(()=>assertTaskDirectory(dir(),env),/outside_roots/)
 mkdirSync(join(cwd,'.codex'));writeFileSync(join(cwd,'.codex','config.toml'),'test=true');assert.throws(()=>assertTaskDirectory(cwd,env),/config_forbidden/)
})
test('runner bloquea secretos antes de crear cliente y nunca entrega una credencial del modelo',async()=>{
 const root=dir(),calls=[];class Client{constructor(o){calls.push(o)}startThread(){return this}async runStreamed(){return {events:(async function*(){yield {type:'item.completed',item:{type:'agent_message',text:'sk-'+('z'.repeat(30))}};yield {type:'turn.completed',usage:{input_tokens:10,output_tokens:10}}})()}}}
 const run=createCodexRunner({},{CodexClient:Client}),blocked=await run('password="'+('z'.repeat(30))+'"',root,{tools:[]})
 assert.equal(blocked.code,1);assert.equal(calls.length,0)
 const result=await run('Genera un informe',root,{tools:[]});assert.equal(result.code,1);assert.equal(result.json.result,'');assert.doesNotMatch(result.err,/sk-/)
 assert.equal(calls[0].config.features.shell_tool,false);assert.deepEqual(calls[0].config.mcp_servers.archivos.enabled_tools,['listar','leer','leer_habilidad','escribir'])
})
test('roles de QA reciben lector y no escritor; evento inesperado de consola invalida la ejecución',async()=>{
 const calls=[];class Client{constructor(o){calls.push(o)}startThread(o){calls.push(o);return this}async runStreamed(){return {events:(async function*(){yield {type:'item.started',item:{type:'command_execution',command:'git push --force origin main'}}})()}}}
 const response=await createCodexRunner({},{CodexClient:Client})('Revisar',dir(),{roleId:'qa_software',tools:[]})
 assert.equal(response.code,1);assert.equal(calls[1].sandboxMode,'read-only');assert.equal(calls[0].config.mcp_servers.archivos.enabled_tools.includes('escribir'),false)
})
test('un rechazo de seguridad del MCP cancela el turno sin esperar otra respuesta del modelo',async()=>{
 let continued=false
 class Client{startThread(){return this}async runStreamed(){return {events:(async function*(){yield {type:'item.completed',item:{type:'mcp_tool_call',server:'archivos',tool:'leer',status:'failed',result:{content:[{type:'text',text:'Operación bloqueada: security_path_forbidden'}]}}};continued=true;yield {type:'item.completed',item:{type:'agent_message',text:'no debe entregar'}}})()}}}
 const result=await createCodexRunner({},{CodexClient:Client})('Prueba',dir(),{tools:[]})
 assert.equal(result.code,1);assert.equal(result.json.security_blocked,true);assert.equal(result.json.result,'');assert.equal(continued,false)
})
