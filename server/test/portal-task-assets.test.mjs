import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import {once} from 'node:events'
import {mountPortalTaskAssets} from '../src/portal-task-assets.mjs'

test('tarjeta entrega activos reales antes del fallback SPA y no expone rutas arbitrarias',async()=>{
 const app=express();mountPortalTaskAssets(app);app.use((_req,res)=>res.type('html').send('fallback'));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 try{const root='http://127.0.0.1:'+server.address().port;
  for(const [name,type] of [['portal-task.html','text/html'],['portal-task.js','javascript'],['portal-task.css','text/css'],['portal-job-trace.mjs','javascript']]){
   const r=await fetch(root+'/'+name);assert.equal(r.status,200);assert.ok(r.headers.get('content-type').includes(type));assert.notEqual(await r.text(),'fallback');
  }
  assert.equal(await(await fetch(root+'/portal-task-assets.mjs')).text(),'fallback');
 }finally{await new Promise(resolve=>server.close(resolve));}
})
