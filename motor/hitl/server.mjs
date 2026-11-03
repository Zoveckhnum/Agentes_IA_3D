import { createServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApprovalLedger, authorized, readJson, atomicJson, buttons, approvalText } from './core.mjs'

export function createHumanServer({root,ownerId,submitHash,executeHash,token,fetchImpl=fetch,port=10013}) {
  const ledger=createApprovalLedger({root:join(root,'state','requests'),registry:join(root,'registry'),ownerId})
  const stop=new AbortController(),cursor=join(root,'state','telegram-cursor.json')
  let offset=0,botOnline=false,polling=false
  const deliveries=new Set()
  const view=record=>{const {nonce,ownerId,decidedBy,...visible}=record;return visible}
  try{offset=readJson(cursor).offset;if(!Number.isSafeInteger(offset)||offset<0)throw new Error('Invalid Telegram cursor')}catch(e){if(e.code!=='ENOENT')throw e}
  const call=async(method,body={})=>{
    const response=await fetchImpl(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([stop.signal,AbortSignal.timeout(method==='getUpdates'?35000:15000)])})
    const data=await response.json()
    if(!response.ok||!data.ok)throw new Error(`Telegram rejected ${method}`)
    return data.result
  }
  async function deliver(record) {
    if(deliveries.has(record.id))return
    record=ledger.get(record.id)
    if(record.status!=='pending'||record.delivery)return
    deliveries.add(record.id)
    try{
      const message=await call('sendMessage',{chat_id:ownerId,text:approvalText(record),reply_markup:buttons(record),link_preview_options:{is_disabled:true}})
      ledger.delivered(record.id,{chatId:message.chat.id,messageId:message.message_id})
    }finally{deliveries.delete(record.id)}
  }
  async function updateMessage(record) {
    if(!record.delivery)return
    const labels={approved:'Aprobada; pendiente de ejecución.',rejected:'Rechazada. No se ejecutará.',expired:'Vencida. Hace falta preparar otra solicitud.',executing:'En ejecución. Autorización consumida.',executed:'Ejecutada correctamente.',failed:'La ejecución falló o requiere revisión. No se reintentará automáticamente.'}
    await call('editMessageText',{chat_id:record.delivery.chatId,message_id:record.delivery.messageId,text:approvalText(record)+'\n\nEstado: '+(labels[record.status]||record.status),reply_markup:{inline_keyboard:[]},link_preview_options:{is_disabled:true}})
  }
  async function callback(query) {
    if(String(query?.from?.id)!==String(ownerId))return
    let record,text='No se autorizó: solicitud ajena, vencida, modificada o ya decidida.'
    try{record=ledger.decide(query);text=record.status==='approved'?'Aprobada para esta revisión.':'Rechazada.'}catch{}
    await call('answerCallbackQuery',{callback_query_id:query.id,text,show_alert:!record}).catch(()=>{})
    if(record)await updateMessage(record).catch(()=>{})
  }
  async function loop() {
    if(polling)return;polling=true
    while(!stop.signal.aborted){
      try{
        await call('getMe');botOnline=true
        for(const record of ledger.list())await deliver(record)
        const updates=await call('getUpdates',{offset,timeout:20,allowed_updates:['callback_query','message']})
        for(const update of updates){
          if(!Number.isSafeInteger(update.update_id)||update.update_id<offset)continue
          if(update.callback_query)await callback(update.callback_query)
          const message=update.message
          if(message?.chat?.type==='private'&&String(message.from?.id)===String(ownerId)&&String(message.chat.id)===String(ownerId)&&typeof message.text==='string'){
            if(/^\/(estado|start|ayuda)(?:\s|$)/.test(message.text)){
              const counts=ledger.list().reduce((map,r)=>(map[r.status]=(map[r.status]||0)+1,map),{})
              await call('sendMessage',{chat_id:ownerId,text:'Aprobaciones StackBI activas. Usa los botones de cada solicitud. Un mensaje de texto no autoriza operaciones.\nEstado: '+JSON.stringify(counts)})
            }
          }
          // Decision is durable before acknowledging this update to Telegram.
          offset=update.update_id+1;atomicJson(cursor,{offset})
        }
        atomicJson(join(root,'state/status.json'),{online:true,time:new Date().toISOString(),ownerConfigured:true,pending:ledger.list().filter(r=>r.status==='pending').length})
      }catch{
        botOnline=false
        if(!stop.signal.aborted){atomicJson(join(root,'state/status.json'),{online:false,time:new Date().toISOString(),code:'telegram_unavailable'});await new Promise(r=>setTimeout(r,3000))}
      }
    }
  }
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
    const respond=(status,value)=>{res.statusCode=status;res.end(JSON.stringify(value))}
    if(req.url==='/health'&&req.method==='GET')return respond(200,{ok:true,telegramOnline:botOnline})
    const submit=authorized(req.headers.authorization,submitHash),execute=authorized(req.headers.authorization,executeHash)
    if(!submit&&!execute)return respond(401,{error:'unauthorized'})
    try{
      if(req.url==='/approved'&&req.method==='GET'&&execute)return respond(200,{requests:ledger.list().filter(r=>r.status==='approved').map(view)})
      if(req.url?.startsWith('/requests/')&&req.method==='GET')return respond(200,view(ledger.get(req.url.slice('/requests/'.length))))
      if(req.method!=='POST')return respond(404,{error:'not-found'})
      let bytes=0,parts=[]
      for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)return respond(413,{error:'too-large'});parts.push(chunk)}
      const body=JSON.parse(Buffer.concat(parts).toString('utf8'))
      if(req.url==='/request'&&submit){
        const record=ledger.request(body.planId,{taskId:body.taskId||''})
        respond(200,view(record));void deliver(record).catch(()=>{});return
      }
      if(req.url==='/consume'&&execute)return respond(200,view(ledger.consume(body.id,body.planSHA256,body.executionId)))
      if(req.url==='/complete'&&execute){
        if(JSON.stringify(body.result).length>2000)throw new Error('Receipt too large')
        const record=ledger.complete(body.id,body.executionId,body.result)
        respond(200,view(record));void updateMessage(record).catch(()=>{});return
      }
      return respond(403,{error:'forbidden'})
    }catch{return respond(409,{error:'operation-not-authorized-or-invalid'})}
  })
  return {ledger,server,async start({poll=true}={}){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});if(poll)void loop();return server.address()},async close(){stop.abort();server.closeAllConnections();await new Promise(r=>server.close(r))}}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const root=process.env.APP_HITL_ROOT||'C:\\ProgramData\\StackBI\\HumanApprovals'
  const service=createHumanServer({root,ownerId:process.env.APP_HITL_OWNER_ID,submitHash:process.env.APP_HITL_SUBMIT_HASH,executeHash:process.env.APP_HITL_EXECUTE_HASH,token:process.env.APP_HITL_BOT_TOKEN})
  await service.start()
  console.log(JSON.stringify({event:'human_approval_service_started',host:'127.0.0.1',port:10013}))
  let stopping=false
  for(const signal of ['SIGINT','SIGTERM','SIGBREAK'])process.on(signal,async()=>{if(stopping)return;stopping=true;await service.close();process.exit(0)})
}
