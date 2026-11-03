import { execFileSync } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { collect, sha256, verifyArtifact } from '../../deploy/cicd/artifact.mjs'
import { createZip } from '../../deploy/cicd/zip.mjs'
const root=fileURLToPath(new URL('../../',import.meta.url))
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true}).trim()
const commit=git(['rev-parse','HEAD'])
if(git(['status','--porcelain','--untracked-files=all']))throw new Error('Packaging requires a clean committed source tree')
if(process.platform!=='win32'||process.arch!=='x64'||process.versions.node!=='22.12.0')throw new Error('Build on Windows x64 with Node 22.12.0')
if(process.env.GITHUB_SHA && process.env.GITHUB_SHA!==commit)throw new Error('Checkout does not match GitHub run')
const evidence=JSON.parse(await readFile(new URL('../../.local/ci-evidence.json',import.meta.url)))
if(evidence.commit!==commit)throw new Error('Test evidence belongs to another revision')
const files=[...await collect(root+'server/src','server/src'),...await collect(root+'server/migrations','server/migrations'),...await collect(root+'server/node_modules','server/node_modules'),...await collect(root+'deploy/sql-preview','public')]
for(const name of ['package.json','package-lock.json'])files.push({name:'server/'+name,content:await readFile(root+'server/'+name)})
const manifest={format:'stackbi-ci-artifact-v1',project:'agentes-ia-3d',repository:process.env.GITHUB_REPOSITORY||'Zoveckhnum/Agentes_IA_3D',commit,ref:process.env.GITHUB_REF||git(['symbolic-ref','HEAD']),runId:process.env.GITHUB_RUN_ID||'local',runAttempt:process.env.GITHUB_RUN_ATTEMPT||'1',platform:'win32',arch:'x64',node:process.versions.node,cleanSource:true,checks:evidence.checks,files:Object.fromEntries(files.sort((a,b)=>a.name.localeCompare(b.name)).map(f=>[f.name,sha256(f.content)]))}
const bytes=createZip([...files,{name:'manifest.json',content:Buffer.from(JSON.stringify(manifest))}])
verifyArtifact(bytes,{commit})
await mkdir(root+'.local/ci-artifacts',{recursive:true})
const name=`stackbi-${commit}.zip`
await writeFile(root+'.local/ci-artifacts/'+name,bytes)
await writeFile(root+'.local/ci-artifacts/digest.txt',sha256(bytes)+'  '+name+'\n')
console.log(JSON.stringify({artifact:name,commit,digest:sha256(bytes),bytes:bytes.length,files:files.length}))
