// Canonical cookie-session connector. Copies in Diagnóstico/Oficina are checked by tests.
import { Router } from 'express'
import { Issuer, generators } from 'openid-client'
import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
export class CentralError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const hash = value => createHash('sha256').update(value).digest('hex')
const same = (a,b) => timingSafeEqual(Buffer.from(hash(a)),Buffer.from(hash(b)))
function safeUrl(value, originOnly = false) {
  const url = new URL(value)
  if (url.username || url.password || url.search || url.hash || (originOnly && url.pathname !== '/') || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname)))) throw new Error('URL central inválida')
  return originOnly ? url.origin : value
}
export function centralConfiguration(env, portalId, appOrigin) {
  if (env.CENTRAL_ACCESS_REQUIRED !== 'true') return { enabled:false, portalId }
  const origin=safeUrl(appOrigin,true), portalOrigin=safeUrl(env.CENTRAL_PORTAL_ORIGIN,true), issuer=safeUrl(env.CENTRAL_OIDC_ISSUER)
  const clientId=env.CENTRAL_OIDC_CLIENT_ID || '', clientSecret=env.CENTRAL_OIDC_CLIENT_SECRET || '', token=env.CENTRAL_PORTAL_SERVICE_TOKEN || '', bindingSecret=env.CENTRAL_BINDING_SECRET || ''
  if (!['iqualitys','office'].includes(portalId) || !clientId || !clientSecret || token.length<48 || !/^[a-f0-9]{64}$/i.test(bindingSecret)) throw new Error('Configuración central incompleta')
  return { enabled:true,portalId,origin,portalOrigin,issuer,clientId,clientSecret,token,bindingSecret,secure:origin.startsWith('https:') }
}
function cookies(req,name) { return String(req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1) || '' }
export function createCentralConnector(config, dependencies) {
  const router=Router(),pending=new Map(),request=dependencies.request || fetch
  const name=(config.secure?'__Host-':'')+'central_'+config.portalId
  const options={ httpOnly:true, secure:!!config.secure, sameSite:'lax', path:'/' }
  let client
  async function oidc() {
    if (dependencies.client) return dependencies.client
    if (!client) {
      const issuer=await Issuer.discover(config.issuer)
      if (issuer.issuer!==config.issuer) throw new CentralError(503,'El proveedor de identidad no coincide.')
      client=new issuer.Client({client_id:config.clientId,client_secret:config.clientSecret,redirect_uris:[config.origin+'/api/auth/oidc/callback'],response_types:['code'],id_token_signed_response_alg:'RS256'})
    }
    return client
  }
  function seal(value) {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(config.bindingSecret,'hex'),iv)
    cipher.setAAD(Buffer.from(config.portalId+'|'+config.origin))
    const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()])
    return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url')
  }
  function open(value) {
    if (!value || value.length>3000 || !/^[\w-]+$/.test(value)) throw new Error('invalid cookie')
    const raw=Buffer.from(value,'base64url'),decipher=createDecipheriv('aes-256-gcm',Buffer.from(config.bindingSecret,'hex'),raw.subarray(0,12))
    decipher.setAAD(Buffer.from(config.portalId+'|'+config.origin));decipher.setAuthTag(raw.subarray(12,28))
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8'))
  }
  async function access(issuer,subject) {
    if (issuer!==config.issuer || typeof subject!=='string' || !subject || subject.length>255) throw new CentralError(401,'La identidad central no es válida.')
    let response
    try { response=await request(config.portalOrigin+'/api/service/'+config.portalId+'/access',{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},body:JSON.stringify({issuer,subject})}) }
    catch { throw new CentralError(503,'El portal central no está disponible. Intenta de nuevo en unos momentos.') }
    if (response.status===403) throw new CentralError(403,'El acceso a esta plataforma fue retirado. Contacta al superusuario.')
    if (!response.ok) throw new CentralError(503,'No pudimos comprobar tu acceso central.')
    let result
    try { result=await response.json() } catch { throw new CentralError(503,'La respuesta del portal central no es válida.') }
    if (result.allowed!==true || typeof result.localAccountId!=='string' || !result.localAccountId || result.localAccountId.length>128 || !Number.isSafeInteger(result.version) || result.version<1) throw new CentralError(403,'No tienes un acceso central válido.')
    return result
  }
  function clear(res) { res.clearCookie(name,options);res.clearCookie(name+'_flow',options) }
  async function validate(req,localId,tokenHash) {
    if (!config.enabled) return
    let binding
    try { binding=open(cookies(req,name)) } catch { throw new CentralError(401,'Inicia sesión desde Portal iqualitys.') }
    if (typeof binding.hash!=='string' || !same(binding.hash,tokenHash) || binding.localId!==String(localId) || !Number.isFinite(binding.expires) || binding.expires<=Date.now()) throw new CentralError(401,'Tu sesión central venció. Inicia sesión de nuevo.')
    const current=await access(binding.issuer,binding.subject)
    if (current.localAccountId!==String(localId) || current.version!==binding.version) throw new CentralError(401,'Tu acceso cambió. Inicia sesión de nuevo desde el portal central.')
  }
  const publicConfig=()=>({required:!!config.enabled,loginUrl:config.enabled?'/api/auth/oidc/login':null,portalUrl:config.enabled?config.portalOrigin+'/':null})
  router.get('/auth/central/config',(_req,res)=>res.json(publicConfig()))
  router.get('/auth/oidc/login',async(_req,res,next)=>{
    if (!config.enabled) return res.status(404).json({error:'El acceso central no está activado.'})
    try {
      for (const [key,value] of pending) if(value.expires<Date.now())pending.delete(key)
      if(pending.size>=2000) throw new CentralError(429,'Hay demasiados accesos en curso. Intenta más tarde.')
      const state=generators.state(),nonce=generators.nonce(),verifier=generators.codeVerifier(),key=randomBytes(32).toString('base64url')
      const provider=await oidc()
      pending.set(hash(key),{state,nonce,verifier,expires:Date.now()+600000})
      res.cookie(name+'_flow',key,{...options,maxAge:600000})
      res.redirect(provider.authorizationUrl({scope:'openid profile email',response_type:'code',state,nonce,code_challenge:generators.codeChallenge(verifier),code_challenge_method:'S256'}))
    } catch(e) { next(e instanceof CentralError?e:new CentralError(503,'No pudimos conectar con el proveedor de identidad.')) }
  })
  router.get('/auth/oidc/callback',async(req,res)=>{
    if(!config.enabled)return res.status(404).end()
    const key=hash(cookies(req,name+'_flow')),attempt=pending.get(key)
    pending.delete(key);res.clearCookie(name+'_flow',options)
    if(!attempt || attempt.expires<Date.now() || typeof req.query.code!=='string' || typeof req.query.state!=='string' || !same(attempt.state,req.query.state))return res.redirect('/?error=central_access')
    try {
      const provider=await oidc(),tokens=await provider.callback(config.origin+'/api/auth/oidc/callback',{code:req.query.code,state:req.query.state,...(typeof req.query.iss==='string'?{iss:req.query.iss}:{})},{state:attempt.state,nonce:attempt.nonce,code_verifier:attempt.verifier,response_type:'code'})
      const claims=tokens.claims()
      if(claims.iss!==config.issuer || claims.email_verified!==true)throw new Error('unverified')
      const permission=await access(claims.iss,claims.sub)
      const session=await dependencies.issueSession(req,res,permission.localAccountId)
      if(session.localId!==permission.localAccountId || !/^[a-f0-9]{64}$/.test(session.tokenHash))throw new Error('invalid local session')
      const expires=Math.min(Date.now()+8*3600000,session.expiresAt || Infinity)
      res.cookie(name,seal({issuer:claims.iss,subject:claims.sub,localId:session.localId,hash:session.tokenHash,version:permission.version,expires}),{...options,maxAge:expires-Date.now()})
      res.redirect('/')
    } catch { clear(res);res.redirect('/?error=central_access') }
  })
  return {enabled:!!config.enabled,router,validate,clear,publicConfig}
}
