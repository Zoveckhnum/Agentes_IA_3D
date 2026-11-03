import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,readdirSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createTokenMeter,referenceContext,createReferenceReader,DEFAULT_TOKEN_POLICY,normalizeUsage,validateTokenPolicy} from './token-optimization.mjs'
import {createHash} from 'node:crypto'
import {createCodexRunner} from './codex-runner.mjs'
import {reviewDelivery} from './calidad.mjs'
const directory=()=>mkdtempSync(join(tmpdir(),'stackbi-tokens-'))
const usage={input_tokens:100,output_tokens:20,cached_input_tokens:70,cache_write_input_tokens:10,reasoning_output_tokens:5}
test('referencias largas conservan cada byte y detectan alteraciones; textos cortos quedan íntegros',()=>{
 const root=directory(),text='Árbol 漢字\n'+('evidencia importante\n'.repeat(8000))
 const reduced=referenceContext(root,'Entrega',text),file=join(root,'.context',readdirSync(join(root,'.context'))[0])
 assert.equal(readFileSync(file,'utf8'),text);assert.ok(Buffer.byteLength(reduced)<Buffer.byteLength(text)/10)
 assert.match(reduced,/Lee el archivo/);assert.match(reduced,/no basta para aprobar QA/)
 assert.equal(referenceContext(root,'Entrega','Corregir TODO; aprobar solo con recibo executed'),'Corregir TODO; aprobar solo con recibo executed')
 writeFileSync(file,'modificado');assert.throws(()=>referenceContext(root,'Entrega',text),/alterada/)
})
test('un enlace de contexto no escribe fuera de la tarea',()=>{
 const root=directory(),outside=directory();symlinkSync(outside,join(root,'.context'),'junction')
 assert.throws(()=>referenceContext(root,'Entrega','x'.repeat(13000)),/enlaces/);assert.deepEqual(readdirSync(outside),[])
})
test('contabiliza entrada, salida y caché sin sumar dos veces los subconjuntos',()=>{
 const root=directory(),meter=createTokenMeter(root),id=meter.reserve({taskId:'uno',projectId:'cliente-a',promptBytes:10})
 assert.equal(meter.report().pendingCalls,1);assert.equal(meter.report().chargedTokens,DEFAULT_TOKEN_POLICY.reservePerCall)
 assert.deepEqual(meter.finish(id,usage),{status:'reported',chargedTokens:120,reservationExceeded:false})
 const report=createTokenMeter(root).report({taskId:'uno',projectId:'cliente-a'})
 assert.equal(report.inputTokens,100);assert.equal(report.cachedInputTokens,70);assert.equal(report.chargedTokens,120);assert.equal(report.cachedInputRatio,.7)
 assert.equal(meter.report({projectId:'cliente-b'}).calls,0)
 assert.throws(()=>meter.finish(id,usage),/ya cerrada/)
 const contents=readFileSync(join(root,'token-ledger.json'),'utf8');assert.doesNotMatch(contents,/cliente-a|\buno\b/)
})
test('reserva desconocida persiste tras reiniciar y bloquea la tarea, sin afectar otro proyecto',()=>{
 const root=directory(),policy={...DEFAULT_TOKEN_POLICY,reservePerCall:100,maxTaskTokens:100,maxProjectDailyTokens:200,maxDailyTokens:300}
 const meter=createTokenMeter(root,{policy}),id=meter.reserve({taskId:'uno',projectId:'a'})
 meter.finish(id,null,{failed:true})
 const restarted=createTokenMeter(root,{policy});assert.equal(restarted.report().unknownCalls,1)
 assert.throws(()=>restarted.reserve({taskId:'uno',projectId:'a'}),/tarea agotado/)
 restarted.reserve({taskId:'uno',projectId:'b'})
 assert.equal(restarted.report().chargedTokens,200)
})
test('aplica presupuestos diario/proyecto y contabiliza un exceso real; no es un corte del proveedor',()=>{
 const root=directory(),policy={...DEFAULT_TOKEN_POLICY,reservePerCall:100,maxTaskTokens:1000,maxProjectDailyTokens:200,maxDailyTokens:300}
 const meter=createTokenMeter(root,{policy}),id=meter.reserve({taskId:'1',projectId:'a'})
 const result=meter.finish(id,{input_tokens:200,output_tokens:20});assert.equal(result.reservationExceeded,true)
 assert.throws(()=>meter.reserve({taskId:'2',projectId:'a'}),/diario de tokens/)
 const other=createTokenMeter(directory(),{policy});other.reserve({taskId:'1',projectId:'a'});other.reserve({taskId:'2',projectId:'a'})
 assert.throws(()=>other.reserve({taskId:'3',projectId:'a'}),/proyecto agotado/)
})
test('cambio UTC conserva el presupuesto vitalicio de la tarea y registros limitados',()=>{
 let now=new Date('2026-11-03T23:59:59Z');const policy={...DEFAULT_TOKEN_POLICY,reservePerCall:100,maxTaskTokens:100,maxRecords:2}
 const meter=createTokenMeter(directory(),{policy,now:()=>now});meter.reserve({taskId:'a'})
 now=new Date('2026-11-04T00:00:01Z');assert.equal(meter.report().calls,0)
 assert.throws(()=>meter.reserve({taskId:'a'}),/tarea agotado/);meter.reserve({taskId:'b'})
 assert.throws(()=>meter.reserve({taskId:'c'}),/Archiva/)
})
test('registros o locks alterados y políticas inválidas fallan cerrados',()=>{
 const root=directory(),meter=createTokenMeter(root)
 writeFileSync(join(root,'token-ledger.lock'),'existing');assert.throws(()=>meter.reserve(),/EEXIST/)
 const bad=directory();writeFileSync(join(bad,'token-ledger.json'),'{"format":"stackbi-token-ledger-v1","records":[{"chargedTokens":-1}]}')
 assert.throws(()=>createTokenMeter(bad).reserve(),/alterado/)
 assert.throws(()=>validateTokenPolicy({...DEFAULT_TOKEN_POLICY,maxDailyTokens:1}),/incompatibles/)
 assert.equal(normalizeUsage({input_tokens:10,output_tokens:1,cached_input_tokens:11}),null)
})
test('el runner bloquea antes de crear Codex y reserva llamadas incompletas sin fingir ahorro',async()=>{
 const root=directory(),calls=[]
 class Client{constructor(){calls.push('client')}startThread(){return this}async runStreamed(){return {events:(async function*(){yield {type:'item.completed',item:{type:'agent_message',text:'avance'}}})()}}}
 const run=createCodexRunner({AGENTES_STATE_ROOT:root},{CodexClient:Client})
 const large=await run('x'.repeat(100000),root,{tools:[]});assert.equal(large.code,1);assert.deepEqual(calls,[])
 const partial=await run('Tarea secreta que no debe aparecer en el ledger',root,{tools:[],taskId:'a'})
 assert.equal(partial.code,1);assert.equal(partial.json.token_accounting.status,'unknown');assert.equal(run.tokenReport().unknownCalls,1)
 assert.doesNotMatch(readFileSync(join(root,'state','tokens','token-ledger.json'),'utf8'),/Tarea secreta/)
})
test('el runner acumula el uso real también en QA y bloquea antes del cliente al agotar la tarea',async()=>{
 const root=directory(),calls=[],policyPath=join(root,'policy.json')
 writeFileSync(policyPath,JSON.stringify({...DEFAULT_TOKEN_POLICY,reservePerCall:100,maxTaskTokens:100,maxProjectDailyTokens:1000,maxDailyTokens:2000}))
 class Client{constructor(){calls.push('client')}startThread(){return this}async runStreamed(){return {events:(async function*(){yield {type:'item.completed',item:{type:'agent_message',text:'entrega'}};yield {type:'turn.completed',usage}})()}}}
 const run=createCodexRunner({AGENTES_STATE_ROOT:root,AGENTES_TOKEN_POLICY:policyPath},{CodexClient:Client})
 const first=await run('trabajo',root,{taskId:'a',projectId:'p',tools:[]})
 assert.equal(first.code,0);assert.equal(first.json.token_accounting.chargedTokens,120)
 const qa=await run('revisión',root,{taskId:'a',projectId:'p',roleId:'qa_software',tools:[]})
 assert.equal(qa.code,1);assert.match(qa.err,/tarea agotado/);assert.equal(calls.length,1)
 assert.equal(run.tokenReport().reportedCalls,1)
})
test('QA invalida la revisión si el modelo altera la referencia completa',async()=>{
 const root=directory();writeFileSync(join(root,'producto.txt'),'producto')
 const result=await reviewDelivery({cwd:root,task:{tarea:'Validar',descripcion:'Comprobar todo'},author:{id:'author',name:'Autor'},requiredRoles:['qa'],agents:[{id:'reviewer',name:'Revisor'}],profile:()=>({id:'qa',qualityReviewer:true,mision:'Revisar'}),result:'evidencia\n'.repeat(2500),runCodex:async(prompt,cwd)=>{
  assert.match(prompt,/referencia íntegra/);const context=join(cwd,'.context');writeFileSync(join(context,readdirSync(context)[0]),'alterado')
  return {code:0,json:{result:JSON.stringify({verdict:'passed',summary:'Comprobado',evidence:['Lectura'],issues:[]})}}
 }})
 assert.equal(result.qualityStatus,'blocked');assert.match(result.qualityReviews[0].summary,/referencias/)
})
test('lector contextual limita ruta, hash, paginación y resultados sin comandos',()=>{
 const root=directory(),text='a'.repeat(13000)+'CONTROL: TOKENS_OK\n'+'z'.repeat(15000),sha256=createHash('sha256').update(text).digest('hex')
 referenceContext(root,'Prueba',text);const reader=createReferenceReader(root)
 const match=reader.search({sha256,query:'CONTROL:'});assert.equal(match.matches.length,1);assert.match(match.matches[0].text,/TOKENS_OK/)
 const page=reader.read({sha256,offset:13000,maxChars:18});assert.equal(page.text,'CONTROL: TOKENS_OK');assert.equal(page.nextOffset,13018)
 assert.throws(()=>reader.read({sha256:'../archivo'}),/inválido/)
 assert.throws(()=>reader.read({sha256,maxChars:12001}),/inválido/)
 assert.throws(()=>createReferenceReader(directory()).read({sha256}),/ENOENT/)
 writeFileSync(join(root,'.context',sha256+'.txt'),'alterado');assert.throws(()=>reader.search({sha256,query:'CONTROL:'}),/alterada/)
})
test('el runner expone solo las herramientas de referencia de su carpeta',async()=>{
 const root=directory(),calls=[];referenceContext(root,'Prueba','x'.repeat(13000))
 class Client{constructor(options){calls.push(options)}startThread(){return this}async runStreamed(){return {events:(async function*(){yield {type:'item.completed',item:{type:'agent_message',text:'ok'}};yield {type:'turn.completed',usage}})()}}}
 const response=await createCodexRunner({APP_HITL_BOT_TOKEN:'no-debe-pasar'},{CodexClient:Client})('Tarea',root,{tools:[]})
 assert.equal(response.code,0);const context=calls[0].config.mcp_servers.contexto
 assert.equal(context.args.at(-1),root);assert.deepEqual(context.enabled_tools,['leer_referencia','buscar_referencia'])
 assert.doesNotMatch(JSON.stringify(calls),/no-debe-pasar/);assert.equal(context.tools.leer_referencia.approval_mode,'approve')
})
