import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createZip,readZip,safeName } from './zip.mjs'
import { verifyArtifact,sha256,allowedPayload } from './artifact.mjs'
import { validateRun,validateApproval,validatePolicy } from './policy.mjs'

test('ZIP roundtrip preserves binary bytes and rejects corrupt data',()=>{
  const files=[{name:'public/index.html',content:Buffer.from('<html>test</html>')},{name:'server/native.node',content:Buffer.from([0,255,1,2])}]
  const zip=createZip(files),read=readZip(zip)
  for(const f of files)assert.deepEqual(read.get(f.name),f.content)
  const corrupt=Buffer.from(zip);corrupt[40]^=255
  assert.throws(()=>readZip(corrupt))
})
test('ZIP rejects traversal, Windows aliases, alternate streams and duplicate case paths',()=>{
  for(const path of ['../escape','/absolute','C:/file','folder\\file','public/CON.txt','public/name.','public/name:stream','public//x'])assert.throws(()=>safeName(path))
  assert.throws(()=>createZip([{name:'public/A',content:Buffer.from('a')},{name:'public/a',content:Buffer.from('b')}]),/Duplicate/)
  assert.equal(allowedPayload('public/.env'),false)
  assert.equal(allowedPayload('deploy/run.ps1'),false)
})
function bundle(change={}){
  const names=['public/index.html','server/src/main.mjs','server/package.json','server/package-lock.json','server/node_modules/msnodesqlv8/build/Release/sqlserver.node']
  const files=names.map(name=>({name,content:Buffer.from('synthetic '+name)}))
  const manifest={format:'stackbi-ci-artifact-v1',project:'agentes-ia-3d',platform:'win32',arch:'x64',node:'22.12.0',cleanSource:true,repository:'owner/repo',commit:'a'.repeat(40),runId:'123',runAttempt:'1',checks:['unit','roles','sql-integration','build'],files:Object.fromEntries(files.map(f=>[f.name,sha256(f.content)])),...change}
  return createZip([...files,{name:'manifest.json',content:Buffer.from(JSON.stringify(manifest))}])
}
test('artifact binds commit, run and complete hashes with no machine secrets or deploy scripts',()=>{
  assert.equal(verifyArtifact(bundle(),{commit:'a'.repeat(40),runId:123}).manifest.project,'agentes-ia-3d')
  assert.throws(()=>verifyArtifact(bundle(),{commit:'b'.repeat(40)}),/commit mismatch/)
  assert.throws(()=>verifyArtifact(bundle({cleanSource:false})),/evidence/)
  assert.throws(()=>verifyArtifact(bundle({checks:['unit','build']})),/evidence/)
  assert.throws(()=>verifyArtifact(bundle({files:{}})),/file list/)
})
test('deployment refuses PR artifacts, forks, other workflows and nonallowed branches',()=>{
  const policy={repository:'owner/repo',allowedBranches:['main']}
  const run={id:1,run_attempt:1,status:'completed',conclusion:'success',event:'push',head_repository:{full_name:'owner/repo'},head_branch:'main',path:'.github/workflows/ci.yml',head_sha:'a'.repeat(40)}
  validateRun(run,policy)
  for(const fields of [{event:'pull_request'},{head_repository:{full_name:'fork/repo'}},{path:'.github/workflows/other.yml'},{head_branch:'untrusted'},{conclusion:'failure'}])assert.throws(()=>validateRun({...run,...fields},policy))
})
test('approval is one-use, short-lived and bound to exact staging artifact',()=>{
  const now=Date.now(),candidate={repository:'owner/repo',commit:'a'.repeat(40),digest:'b'.repeat(64),runId:'1',runAttempt:'1'}
  const a={format:'stackbi-deploy-approval-v1',environment:'staging',...candidate,nonce:randomUUID(),approvedBySid:'S-1-5-21-1',issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+60000).toISOString()}
  validateApproval(a,candidate,new Set(),now)
  for(const fields of [{environment:'production'},{digest:'c'.repeat(64)},{runId:'2'},{expiresAt:new Date(now-1).toISOString()}])assert.throws(()=>validateApproval({...a,...fields},candidate,new Set(),now))
  assert.throws(()=>validateApproval(a,candidate,new Set([a.nonce]),now))
  assert.throws(()=>validatePolicy({allowProduction:true}))
})
