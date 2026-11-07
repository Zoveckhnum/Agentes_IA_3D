import {test} from 'node:test'
import assert from 'node:assert/strict'
import {once} from 'node:events'
import {createApplication} from '../src/main.mjs'
import {centralConfiguration} from '../src/central-connector.mjs'
test('modo central bloquea contraseñas/altas humanas y conserva el motor loopback, sin SQL',async()=>{
 let calls=0
 const database={pool(){calls++;throw new Error('No SQL allowed in this test')}}
 const config={origin:'http://127.0.0.1:10071',secureCookies:false,maxDocuments:5000,maxBodyBytes:12000,workerToken:'w'.repeat(64),workerUid:'test-worker',workerEmail:'worker@example.invalid',ownerUid:'owner',central:centralConfiguration({CENTRAL_ACCESS_REQUIRED:'true',CENTRAL_PORTAL_ORIGIN:'https://access.example.invalid',CENTRAL_PORTAL_SERVICE_TOKEN:'o'.repeat(64),CENTRAL_OIDC_ISSUER:'https://identity.example.invalid/realms/iqualitys',CENTRAL_OIDC_CLIENT_ID:'test-office',CENTRAL_OIDC_CLIENT_SECRET:'fixture-secret',CENTRAL_BINDING_SECRET:'a'.repeat(64)},'office','http://127.0.0.1:10071')}
 const app=createApplication(database,config),server=app.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port
 try{
  for(const path of ['/api/auth/login','/api/auth/register'])assert.equal((await fetch(origin+path,{method:'POST',headers:{Origin:config.origin,'Content-Type':'application/json'},body:'{}'})).status,403)
  assert.equal((await fetch(origin+'/api/auth/me')).status,401)
  const worker=await fetch(origin+'/api/auth/me',{headers:{Authorization:'Bearer '+config.workerToken}});assert.equal(worker.status,200);assert.equal((await worker.json()).user.uid,'test-worker')
  const publicConfig=await(await fetch(origin+'/api/auth/central/config')).json();assert.equal(publicConfig.required,true);assert.equal('token' in publicConfig,false)
  assert.equal(calls,0)
 }finally{await new Promise(r=>server.close(r))}
});
