import {createRequire} from 'node:module'
import {request as httpRequest} from 'node:http'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createDatabase,sql} from '../server/src/db.mjs'
import {createAuth} from '../server/src/auth.mjs'
import {readOfficeState,publicOfficeState,isHumanCeo,enqueueOfficeCommand,officeClosedMessage} from './core.mjs'
const require=createRequire(new URL('../server/package.json',import.meta.url)),express=require('express'),helmet=require('helmet')

export function createOfficeGateway({root,database,origin='https://stackbi.com.mx',authConfig,upstreamPort=10011,now=()=>new Date(),authOverride,profileOverride}){
 const app=express(),auth=authOverride||createAuth(database,authConfig),stateFile=join(root,'state','office.json')
 const assetRoot=fileURLToPath(new URL('public/',import.meta.url))
 app.disable('x-powered-by');app.set('trust proxy','loopback');app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:'],connectSrc:["'self'"],fontSrc:["'self'"],upgradeInsecureRequests:new URL(origin).protocol==='https:'?[]:null}}}))
 app.use((req,res,next)=>{res.set('Cache-Control','no-store');next()})
 const profile=async uid=>{const r=await new sql.Request(await database.pool()).input('path',sql.NVarChar(450),'users/'+uid).query('SELECT Payload FROM app.Documents WHERE Path=@path');return r.recordset[0]?JSON.parse(r.recordset[0].Payload):null}
 async function ceo(req){if(req.headers.authorization)throw new Error('office_ceo_required');const actor=await auth.actor(req),p=await (profileOverride||profile)(actor.uid);if(!isHumanCeo(actor,p))throw new Error('office_ceo_required');return {actor,profile:p}}
 app.get('/_office/health',async(_req,res)=>{try{const state=readOfficeState(stateFile),r=await new sql.Request(await database.pool()).query("SELECT HAS_PERMS_BY_NAME('app.Documents','OBJECT','UPDATE') AS CanWriteProfiles,HAS_PERMS_BY_NAME('app.Accounts','OBJECT','UPDATE') AS CanWriteAccounts,HAS_PERMS_BY_NAME('app.Sessions','OBJECT','INSERT') AS CanCreateSessions,IS_ROLEMEMBER('db_owner') AS IsOwner");const p=r.recordset[0],restricted=!p.CanWriteProfiles&&!p.CanWriteAccounts&&!p.IsOwner&&p.CanCreateSessions===1;res.status(restricted?200:503).json({ok:restricted,mode:state.mode,permissionsRestricted:restricted})}catch{res.status(503).json({ok:false})}})
 app.use('/_office/assets',express.static(assetRoot,{dotfiles:'deny',maxAge:0,index:false}))
 app.get('/_office/status',async(req,res)=>{try{const state=readOfficeState(stateFile);let canControl=false;try{await ceo(req);canControl=true}catch{};res.json({...publicOfficeState(state),canControl})}catch{res.status(503).json({mode:'error',message:'No se pudo consultar el estado de la oficina.'})}})
 app.use('/_office',(req,res,next)=>{if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin)return res.status(403).json({error:{code:'permission-denied',message:'Origen no autorizado.'}});next()})
 app.use('/_office',express.json({limit:4096,strict:true}))
 app.post('/_office/login',async(req,res)=>{
  try{await auth.login(req,res,async account=>{if(!isHumanCeo({uid:account.Uid,mustChangePassword:!!account.MustChangePassword},await profile(account.Uid)))throw new Error('office_ceo_required')});res.json({ok:true,canControl:true})}
  catch{res.status(403).json({error:{code:'permission-denied',message:'Se requiere una cuenta humana con permiso CEO y contraseña válida.'}})}
 })
 for(const action of ['close','open'])app.post('/_office/'+action,async(req,res)=>{
  try{const identity=await ceo(req),state=readOfficeState(stateFile);if(req.body?.revision!==state.revision)return res.status(409).json({error:{code:'state-changed',message:'El estado cambió. Actualiza antes de continuar.'}})
   if(action==='close'&&state.mode!=='open'||action==='open'&&!['closed','error'].includes(state.mode))return res.status(409).json({error:{code:'invalid-state',message:'La oficina está cambiando de estado.'}})
   const command=enqueueOfficeCommand(root,{action,...identity,sessionHash:identity.actor.tokenHash,revision:state.revision,now:now()});res.status(202).json(command)
  }catch{res.status(403).json({error:{code:'permission-denied',message:'Solo una cuenta humana con permiso CEO puede controlar la oficina.'}})}
 })
 app.use('/_office',(_req,res)=>res.status(404).json({error:{code:'not-found'}}))
 app.use((req,res)=>{
  let state;try{state=readOfficeState(stateFile)}catch{state={mode:'error',autoResume:false}}
  if(state.mode!=='open'){
   res.set('Retry-After',String(Math.max(60,Math.ceil(((Date.parse(state.reopenAt)||now().getTime()+60000)-now().getTime())/1000))))
   if(req.url.startsWith('/api/')||req.url.startsWith('/health'))return res.status(503).json({error:{code:'office-closed',message:officeClosedMessage(state)},...publicOfficeState({...state,revision:state.revision||0})})
   return res.status(503).type('html').send(readFileSync(join(assetRoot,'closed.html'),'utf8').replace('__OFFICE_MESSAGE__',officeClosedMessage(state)))
  }
  if(req.headers.authorization)return res.status(403).json({error:{code:'permission-denied',message:'Acceso interno no disponible en la URL pública.'}})
  const upstream=httpRequest({host:'127.0.0.1',port:upstreamPort,path:req.originalUrl,method:req.method,headers:{...req.headers,'x-forwarded-proto':new URL(origin).protocol.slice(0,-1)}},response=>{res.status(response.statusCode||502);for(const [key,value]of Object.entries(response.headers))if(value!==undefined&&!['connection','transfer-encoding','cache-control'].includes(key))res.setHeader(key,value);response.pipe(res)})
  upstream.on('error',()=>{if(!res.headersSent){if(req.url.startsWith('/api/')||req.url.startsWith('/health'))res.status(503).json({error:{code:'unavailable',message:'La oficina no está disponible temporalmente.'}});else res.status(503).type('html').send('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/_office/assets/closed.css"><title>Oficina temporalmente no disponible</title><main class="office-closed"><h1>Oficina temporalmente no disponible</h1><p class="opening-date">Intenta de nuevo en un momento.</p><a href="/">Volver a intentar</a></main></html>')}else res.destroy()});upstream.setTimeout(30000,()=>upstream.destroy());req.on('aborted',()=>upstream.destroy());req.pipe(upstream)
 })
 app.use((_error,_req,res,_next)=>res.status(400).json({error:{code:'invalid-request',message:'No se pudo completar la solicitud.'}}))
 return app
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const root=process.env.APP_OFFICE_ROOT,database=createDatabase(),origin=process.env.PUBLIC_ORIGIN
 if(!root||new URL(origin).protocol!=='https:')throw new Error('Office control configuration missing')
 const config={secureCookies:true,workerToken:'disabled-office-worker-token-not-a-login'.repeat(2),workerUid:'disabled',workerEmail:'disabled@example.invalid'}
 const app=createOfficeGateway({root,database,origin,authConfig:config}),server=app.listen(10014,'127.0.0.1')
 for(const signal of ['SIGTERM','SIGINT','SIGBREAK'])process.on(signal,()=>{server.closeAllConnections();server.close(async()=>{await database.close();process.exit(0)})})
}
