import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute } from 'node:path'
import { readZip, safeName } from './zip.mjs'
export const sha256 = data=>createHash('sha256').update(data).digest('hex')
export function allowedPayload(name) {
  safeName(name)
  if (name.split('/').some(p=>/^(\.env(?:\..*)?|\.git|credenciales|logs|trabajos)$/i.test(p)) || /\.(p7m|bak|mdf|ldf)$/i.test(name)) return false
  return /^public\//.test(name) || /^server\/(src|migrations|node_modules)\//.test(name) || ['server/package.json','server/package-lock.json'].includes(name)
}
export async function collect(directory, prefix) {
  const files=[]
  async function walk(folder, name) {
    for(const entry of await readdir(folder,{withFileTypes:true})){
      const path=join(folder,entry.name),key=name+'/'+entry.name
      if((await lstat(path)).isSymbolicLink())throw new Error('Build input contains a link')
      if(entry.isDirectory())await walk(path,key)
      else if(entry.isFile() && allowedPayload(key))files.push({name:key,content:await readFile(path)})
    }
  }
  await walk(directory,prefix)
  return files
}
export function verifyArtifact(bytes, expected={}) {
  const files=readZip(bytes),encoded=files.get('manifest.json')
  if(!encoded || encoded.length>4*1024*1024)throw new Error('Missing artifact manifest')
  const manifest=JSON.parse(encoded)
  if(manifest.format!=='stackbi-ci-artifact-v1' || manifest.project!=='agentes-ia-3d' || manifest.platform!=='win32' || manifest.arch!=='x64' || manifest.node!=='22.12.0' || !/^[a-f0-9]{40}$/.test(manifest.commit))throw new Error('Unsupported artifact identity/runtime')
  for(const key of ['repository','commit','runId','runAttempt'])if(expected[key]!==undefined && String(manifest[key])!==String(expected[key]))throw new Error(`Artifact ${key} mismatch`)
  if(manifest.cleanSource!==true || !Array.isArray(manifest.checks) || !['unit','roles','sql-integration','build'].every(k=>manifest.checks.includes(k)))throw new Error('Artifact lacks required CI evidence')
  const names=Object.keys(manifest.files).sort(), actual=[...files.keys()].filter(n=>n!=='manifest.json').sort()
  if(names.join('\n')!==actual.join('\n'))throw new Error('Artifact manifest file list mismatch')
  for(const name of names)if(!allowedPayload(name) || sha256(files.get(name))!==manifest.files[name])throw new Error('Artifact file rejected or modified')
  for(const name of ['public/index.html','server/src/main.mjs','server/package.json','server/package-lock.json'])if(!files.has(name))throw new Error('Artifact is incomplete')
  if(!files.has('server/node_modules/msnodesqlv8/build/Release/sqlserver.node'))throw new Error('Missing Windows native SQL dependency')
  return {manifest,files,digest:sha256(bytes)}
}
export async function extractArtifact(verified,destination) {
  destination=resolve(destination)
  await mkdir(destination,{recursive:false})
  for(const [name,content] of verified.files){
    safeName(name)
    const target=resolve(destination,name),within=relative(destination,target)
    if(!within||within.startsWith('..')||isAbsolute(within))throw new Error('Extraction escaped destination')
    await mkdir(resolve(target,'..'),{recursive:true})
    await writeFile(target,content,{flag:'wx'})
  }
}
