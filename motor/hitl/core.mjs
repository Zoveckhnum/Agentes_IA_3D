import { createHash, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, lstatSync, openSync, fsyncSync, closeSync } from 'node:fs'
import { join, resolve, relative, isAbsolute } from 'node:path'

export const sha256 = value => createHash('sha256').update(value).digest('hex')
export const canonical = value => JSON.stringify(value, (_key,item) => item && !Array.isArray(item) && typeof item==='object' ? Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])) : item)
export const uuid = value => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)
export const containsSecrets = value => /-----BEGIN .*PRIVATE KEY|(?:github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]{15,}|(?:password|token|secret|api[_-]?key)\s*["']?\s*[:=]\s*["']?\S{8,}/i.test(value)
export const safeSummary = value => typeof value==='string' && value.trim().length>=5 && value.length<=800 && !/[\x00-\x08\x0b-\x1f]/.test(value) && !containsSecrets(value)
export function authorized(header, expectedHash) {
  if(!/^[a-f0-9]{64}$/.test(expectedHash||'') || !header?.startsWith('Bearer '))return false
  return timingSafeEqual(Buffer.from(sha256(header.slice(7)),'hex'),Buffer.from(expectedHash,'hex'))
}
export function checkedPath(root, ...parts) {
  let cursor=resolve(root)
  if(lstatSync(cursor).isSymbolicLink())throw new Error('Linked root rejected')
  for(const part of parts){
    if(typeof part!=='string'||!part||part.includes('/')||part.includes('\\')||part==='.'||part==='..'||/[\x00-\x1f:]/.test(part))throw new Error('Unsafe managed path')
    cursor=join(cursor,part)
    try{if(lstatSync(cursor).isSymbolicLink())throw new Error('Linked managed path rejected')}catch(e){if(e.code!=='ENOENT')throw e}
  }
  const rel=relative(resolve(root),cursor)
  if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('Path escaped root')
  return cursor
}
export function atomicJson(file, value) {
  const temp=file+'.'+randomUUID()+'.tmp',fd=openSync(temp,'wx')
  try{writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd)}finally{closeSync(fd)}
  renameSync(temp,file)
}
export function readJson(file) {const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw new Error('Invalid managed JSON');return JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,''))}
export function validatePlan(plan) {
  if(plan?.format!=='stackbi-human-plan-v1'||!uuid(plan.id)||!['verification','iis-production','sql-schema','drive-official'].includes(plan.kind)||!safeSummary(plan.summary)||typeof plan.project!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(plan.project)||!/^[a-f0-9]{64}$/.test(plan.payload?.sha256||'')||!Number.isSafeInteger(plan.payload?.bytes)||plan.payload.bytes<1)throw new Error('Invalid operation plan')
  const target=plan.target
  if(!target || typeof target!=='object')throw new Error('Missing exact target')
  const files={verification:'verification.txt','iis-production':'artifact.zip','sql-schema':'migration.sql'}
  if(files[plan.kind] && plan.payload.file!==files[plan.kind])throw new Error('Unexpected payload filename')
  if(plan.kind==='iis-production' && (target.origin!=='https://stackbi.com.mx'||target.service!=='node-agentes-ia-3d'||!/^\d+$/.test(target.runId)||!/^[a-f0-9]{40}$/.test(target.commit)||!/^[a-f0-9]{64}$/.test(target.baseline)||target.repository!=='Zoveckhnum/Agentes_IA_3D'||plan.payload.bytes>128*1024*1024))throw new Error('Invalid production deployment')
  if(plan.kind==='sql-schema' && (target.database!=='AgentesIA3D'||!/^[a-f0-9]{64}$/.test(target.schemaSHA256)||plan.payload.bytes>512*1024))throw new Error('Invalid SQL change')
  if(plan.kind==='drive-official' && (!/^[A-Za-z0-9_-]{8,150}$/.test(target.folderId||'')||!/^[A-Za-z0-9_-]{8,150}$/.test(target.rootId||'')||!safeSummary(target.name)||!/^[a-f0-9]{64}$/.test(target.folderSHA256||'')||!/^document\.(pdf|docx|xlsx|md|txt|html)$/.test(plan.payload.file)||plan.payload.bytes>10*1024*1024))throw new Error('Invalid official document')
  if(plan.kind==='verification' && (target.effect!=='none'||plan.payload.bytes>1024))throw new Error('Verification cannot mutate business systems')
  return plan
}
export function readPlan(registry,id) {
  if(!uuid(id))throw new Error('Invalid plan id')
  const dir=checkedPath(registry,id),plan=validatePlan(readJson(checkedPath(dir,'plan.json')))
  if(plan.id!==id)throw new Error('Plan identity mismatch')
  const file=checkedPath(dir,plan.payload.file),stat=lstatSync(file)
  if(!stat.isFile()||stat.size!==plan.payload.bytes||sha256(readFileSync(file))!==plan.payload.sha256)throw new Error('Operation content changed')
  return {plan,digest:sha256(canonical(plan)),directory:dir}
}

export function createApprovalLedger({root,registry,ownerId,now=Date.now,maxRecords=2000,maxDaily=20}) {
  if(!/^[1-9]\d{3,19}$/.test(String(ownerId)))throw new Error('A fixed Telegram owner is required')
  mkdirSync(root,{recursive:true});mkdirSync(registry,{recursive:true})
  const list=()=>readdirSync(root).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>readJson(checkedPath(root,n)))
  const save=record=>atomicJson(checkedPath(root,record.id+'.json'),record)
  const load=id=>{if(!uuid(id))throw new Error('Invalid request id');const r=readJson(checkedPath(root,id+'.json'));if(r.id!==id||r.format!=='stackbi-human-approval-v1')throw new Error('Invalid request record');return r}
  function current(record) {
    const {digest}=readPlan(registry,record.planId)
    if(digest!==record.planSHA256)throw new Error('Approval is for another operation revision')
    return record
  }
  function expire(record) {
    if(['pending','approved'].includes(record.status)&&Date.parse(record.expiresAt)<=now()){record.status='expired';record.finishedAt=new Date(now()).toISOString();save(record)}
    return record
  }
  return {
    list:()=>list().map(expire),get:id=>expire(load(id)),
    request(planId,{taskId='',ttlMs=30*60000}={}) {
      if(!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>60*60000||!/^[\w-]{0,100}$/.test(taskId))throw new Error('Invalid request constraints')
      const verified=readPlan(registry,planId),records=list().map(expire)
      const previous=records.find(r=>r.planId===planId)
      if(previous)return previous // One request per immutable plan, including rejection/expiry.
      if(records.length>=maxRecords||records.filter(r=>r.createdAt.slice(0,10)===new Date(now()).toISOString().slice(0,10)).length>=maxDaily)throw new Error('Approval storage or daily budget reached')
      const record={format:'stackbi-human-approval-v1',id:randomUUID(),nonce:randomBytes(8).toString('hex'),planId,planSHA256:verified.digest,kind:verified.plan.kind,project:verified.plan.project,summary:verified.plan.summary,target:verified.plan.target,payloadSHA256:verified.plan.payload.sha256,taskId,status:'pending',ownerId:String(ownerId),createdAt:new Date(now()).toISOString(),expiresAt:new Date(now()+ttlMs).toISOString(),delivery:null}
      save(record);return record
    },
    delivered(id,message) {
      const record=current(expire(load(id)))
      if(record.status!=='pending'||String(message.chatId)!==String(ownerId)||!Number.isSafeInteger(message.messageId))throw new Error('Invalid approval message binding')
      record.delivery={chatId:String(message.chatId),messageId:message.messageId};save(record);return record
    },
    decide(callback) {
      const match=/^([ar]):([a-f0-9-]{36}):([a-f0-9]{16})$/.exec(callback?.data||'')
      if(!match||String(callback.from?.id)!==String(ownerId)||callback.message?.chat?.type!=='private'||String(callback.message.chat.id)!==String(ownerId))throw new Error('Callback is not from the private owner chat')
      const record=current(expire(load(match[2])))
      if(record.nonce!==match[3]||!record.delivery||record.delivery.messageId!==callback.message.message_id||record.delivery.chatId!==String(callback.message.chat.id))throw new Error('Callback belongs to another message')
      if(record.status!=='pending')throw new Error('Approval already decided, expired or consumed')
      record.status=match[1]==='a'?'approved':'rejected';record.decidedAt=new Date(now()).toISOString();record.decidedBy=String(callback.from.id);save(record);return record
    },
    consume(id,digest,executionId) {
      const record=current(expire(load(id)))
      if(record.status!=='approved'||record.planSHA256!==digest||!uuid(executionId))throw new Error('Approval is missing, expired, used or for another revision')
      record.status='executing';record.executionId=executionId;record.consumedAt=new Date(now()).toISOString();save(record);return record
    },
    complete(id,executionId,result) {
      const record=load(id)
      if(record.status!=='executing'||record.executionId!==executionId||typeof result?.ok!=='boolean')throw new Error('Execution receipt does not match approval')
      record.status=result.ok?'executed':'failed';record.result=result;record.finishedAt=new Date(now()).toISOString();save(record);return record
    },
  }
}
export const buttons = record => ({inline_keyboard:[[{text:'Aprobar',callback_data:`a:${record.id}:${record.nonce}`},{text:'Rechazar',callback_data:`r:${record.id}:${record.nonce}`}]]})
export function approvalText(record) {
  const kind={'verification':'Verificación sin efectos','iis-production':'Despliegue IIS a producción','sql-schema':'Cambio estructural de SQL','drive-official':'Documento oficial en Drive'}[record.kind]
  return `${kind}\nProyecto: ${record.project}\nTarea: ${record.taskId||'Solicitud del operador'}\n${record.summary}\n\nDestino: ${JSON.stringify(record.target)}\nSHA-256 del contenido: ${record.payloadSHA256}\nRevisión del plan: ${record.planSHA256}\nPlan: ${record.planId}\nSolicitud: ${record.id}\nVence: ${new Date(record.expiresAt).toLocaleString('es-MX',{timeZone:'America/Mexico_City'})} (Ciudad de México)\n\nRevisa el plan preparado en el servidor. Aprobar autoriza solo esta operación y revisión; QA no la sustituye.`
}
