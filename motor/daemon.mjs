// Start only after an operator enables the policy and authenticates this identity.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { validateLoopPolicy } from './auto-loop.mjs'
import { createCodexRunner } from './codex-runner.mjs'
const root = process.env.AGENTES_STATE_ROOT
if(!root || !process.env.AGENTES_LOOP_POLICY || !process.env.CODEX_HOME) throw new Error('Falta configuración protegida del servicio.')
mkdirSync(join(root,'state'),{recursive:true})
let stopped=false
const stop=()=>{stopped=true}
for(const name of ['SIGTERM','SIGINT','SIGBREAK'])process.on(name,stop)
while(!stopped){
  const policy=validateLoopPolicy(JSON.parse(readFileSync(process.env.AGENTES_LOOP_POLICY,'utf8').replace(/^\uFEFF/,'')))
  const auth=spawnSync(process.env.AGENTES_CODEX_EXE,['login','status'],{env:process.env,windowsHide:true,timeout:15000,encoding:'utf8'})
  const probePath=join(root,'state/codex-probe.json')
  if(auth.status===0 && !existsSync(probePath)){
    const cwd=join(root,'probe');mkdirSync(cwd,{recursive:true})
    const response=await createCodexRunner(process.env,{timeoutMs:60000})('Responde exactamente CODEX_OK. No uses herramientas.',cwd,{tools:[],maxTurns:1})
    writeFileSync(probePath,JSON.stringify({time:new Date().toISOString(),passed:response.code===0 && response.json?.result?.trim()==='CODEX_OK'})+'\n')
  }
  const verified=existsSync(probePath) && JSON.parse(readFileSync(probePath,'utf8')).passed===true
  const ready=policy.mode==='tasks-only' && auth.status===0 && verified
  writeFileSync(join(root,'state/daemon.json'),JSON.stringify({time:new Date().toISOString(),enabled:policy.mode==='tasks-only',loginRequired:auth.status!==0,codexVerified:verified,ready,acceptAfter:policy.acceptAfter,externalNotifications:false})+'\n')
  if(ready){for(const name of ['SIGTERM','SIGINT','SIGBREAK'])process.off(name,stop);await import('./worker.mjs');break}
  await new Promise(resolve=>setTimeout(resolve,10000))
}
