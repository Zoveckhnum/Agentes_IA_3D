import {execFileSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {writeFileSync,mkdirSync} from 'node:fs'
import {resolve,join} from 'node:path'
const rootOption=process.argv.indexOf('--root')
const root=rootOption<0?fileURLToPath(new URL('../',import.meta.url)):resolve(process.argv[rootOption+1])
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024})
const privatePath=/(?:^|\/)(?:\.env(?:\.[^/]*)?|negocio\.json|business\.json|auth\.json|google-token\.json|google-oauth\.json|credentials|credenciales|secrets)(?:\/|$)|\.(?:p7m|pfx|p12|pem|key)$/i
const textPath=/\.(?:md|mjs|js|jsx|ts|tsx|json|ps1|yml|yaml|html|css|txt|rules|toml)$/i
const fingerprints=/(?:github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]{24,}|\b\d{8,12}:[A-Za-z0-9_-]{30,}|\b(?:ya29\.|GOCSPX-)[A-Za-z0-9_.-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{64,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g
const entropy=text=>{const counts=new Map();for(const c of text)counts.set(c,(counts.get(c)||0)+1);return [...counts.values()].reduce((n,c)=>n-c/text.length*Math.log2(c/text.length),0)}
const objects=git(['rev-list','--objects','--all']).trim().split(/\r?\n/),seen=new Set(),findings=[],excludedPrivate=new Set(),candidates=[];let scanned=0,bytes=0,skippedLarge=0
for(const line of objects){
 const split=line.indexOf(' ');if(split<0)continue
 const oid=line.slice(0,split),path=line.slice(split+1)
 if(!/^[a-f0-9]{40,64}$/.test(oid)||seen.has(oid))continue
 seen.add(oid)
 if(privatePath.test(path)){excludedPrivate.add(path);continue} // Never read private configuration or credentials.
 if(textPath.test(path))candidates.push({oid,path})
}
const metadata=execFileSync('git',['cat-file','--batch-check'],{cwd:root,input:candidates.map(x=>x.oid).join('\n')+'\n',encoding:'utf8',windowsHide:true,maxBuffer:32*1024*1024}).trim().split(/\r?\n/)
const selected=[]
for(let index=0;index<candidates.length;index++){
 const [,type,sizeText]=metadata[index].split(' '),size=Number(sizeText)
 if(type!=='blob')continue
 if(size>2*1024*1024||bytes+size>128*1024*1024){skippedLarge++;continue}
 selected.push({...candidates[index],size});bytes+=size
}
const batch=execFileSync('git',['cat-file','--batch'],{cwd:root,input:selected.map(x=>x.oid).join('\n')+'\n',windowsHide:true,maxBuffer:130*1024*1024})
let offset=0
for(const {oid,path,size} of selected){
 const end=batch.indexOf(10,offset),header=batch.subarray(offset,end).toString('utf8')
 if(header!==`${oid} blob ${size}`)throw new Error('Unexpected blob metadata')
 const content=batch.subarray(end+1,end+1+size).toString('utf8');offset=end+size+2;scanned++
 const matches=[...content.matchAll(fingerprints)].map(m=>m[0]).filter(m=>m.includes('PRIVATE KEY-----')||(!/example|placeholder|synthetic|your[_-]|test[_-]|dummy/i.test(m)&&entropy(m)>3.6))
 if(matches.length)findings.push({blob:oid,path,matches:matches.length})
}
const privatePathsExcluded=[...excludedPrivate].filter(path=>!/(?:^|\/)\.env\.example$/i.test(path)),templatesNotRead=[...excludedPrivate].filter(path=>/(?:^|\/)\.env\.example$/i.test(path))
const report={format:'stackbi-secret-scan-v1',head:git(['rev-parse','HEAD']).trim(),history:'all local refs; unique textual blobs',shallow:git(['rev-parse','--is-shallow-repository']).trim()==='true',scannedBlobs:scanned,scannedBytes:bytes,skippedLarge,privatePathsExcluded,templatesNotRead,findings,ok:findings.length===0&&privatePathsExcluded.length===0&&skippedLarge===0}
mkdirSync(join(root,'.local'),{recursive:true});writeFileSync(join(root,'.local/security-scan.json'),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report))
if(!report.ok)process.exitCode=1
