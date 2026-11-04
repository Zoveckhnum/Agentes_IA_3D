import {existsSync,lstatSync,realpathSync,readdirSync,readFileSync,writeFileSync,mkdirSync,renameSync,unlinkSync} from 'node:fs'
import {join,relative,isAbsolute,resolve,dirname} from 'node:path'
import {randomUUID} from 'node:crypto'
import {fingerprint,containsCredential} from './security.mjs'
import {createRoleSkillContext} from './role-skills.mjs'
const forbidden=/^(?:\.git|\.env.*|\.codex|\.agents|\.claude|credenciales|credentials|secrets|node_modules|\.qa|\.context)$/i
const privateFile=/^(?:auth\.json|google-token\.json|google-oauth\.json|negocio\.json|business\.json|environment.*|.*\.(?:p7m|pfx|p12|pem|key))$/i
export function createWorkspaceGate(cwd,{writable=false,audit=()=>{},roleId='personalizado'}={}){
 if(lstatSync(cwd).isSymbolicLink())throw new Error('security_linked_workspace')
 const root=realpathSync.native(cwd)
 function checked(path,{write=false}={}){
  if(typeof path!=='string'||!path||path.length>400||isAbsolute(path)||/[\x00-\x1f:]/.test(path)||containsCredential(path))throw new Error('security_path_forbidden')
  const parts=path.split(/[\\/]/)
  if(parts.some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(p)||forbidden.test(p)||privateFile.test(p)))throw new Error('security_path_forbidden')
  if(write&&parts.some(p=>/^\.agentes$|^insumos$|^revisiones$|^tarea\.md$|^\.github$/i.test(p)))throw new Error('security_input_readonly')
  let cursor=root
  for(const part of parts){cursor=join(cursor,part);if(existsSync(cursor)){const stat=lstatSync(cursor);if(stat.isSymbolicLink()||stat.nlink>1&&!stat.isDirectory())throw new Error('security_link_forbidden')}}
  const rel=relative(root,resolve(cursor));if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('security_path_forbidden')
  return cursor
 }
 function guarded(action,subject,fn){
  try{audit('tool_started',{subject});const result=fn();audit(action,{subject});return result}
  catch(error){audit('tool_denied',{allowed:false,subject,reason:'workspace_policy'});throw new Error(/^security_[a-z_]+$/.test(error.message)?error.message:'security_workspace_operation_failed')}
 }
 function bytes(file){const stat=lstatSync(file);if(!stat.isFile()||stat.size>1048576)throw new Error('security_file_size_or_type');const content=readFileSync(file,'utf8');if(content.includes('\0')||containsCredential(content))throw new Error('security_sensitive_content');return content}
 return {
  list({path}={}){return guarded('file_list',path||'.',()=>{const directory=path&&path!=='.'?checked(path):root;if(!lstatSync(directory).isDirectory())throw new Error('security_not_directory');return readdirSync(directory,{withFileTypes:true}).filter(e=>!forbidden.test(e.name)&&!privateFile.test(e.name)&&!containsCredential(e.name)&&!e.isSymbolicLink()).slice(0,200).map(e=>({name:e.name,directory:e.isDirectory()}))})},
  read({path,offset=0,maxChars=12000}){return guarded('file_read',path,()=>{if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(maxChars)||maxChars<1||maxChars>12000)throw new Error('security_invalid_range');const text=bytes(checked(path)),end=Math.min(text.length,offset+maxChars);return {path,sha256:fingerprint(text),totalChars:text.length,text:text.slice(offset,end),nextOffset:end<text.length?end:null}})},
  write({path,content,expectedSHA256}){return guarded('file_written',path,()=>{
   if(!writable)throw new Error('security_workspace_readonly')
   if(typeof content!=='string'||Buffer.byteLength(content)>1048576||content.includes('\0')||containsCredential(content))throw new Error('security_sensitive_or_large_content')
   const file=checked(path,{write:true}),existed=existsSync(file)
   if(existed){if(!/^[a-f0-9]{64}$/.test(expectedSHA256||'')||fingerprint(bytes(file))!==expectedSHA256)throw new Error('security_stale_file')}
   else if(expectedSHA256)throw new Error('security_stale_file')
   mkdirSync(dirname(file),{recursive:true});checked(path,{write:true})
   const temp=join(dirname(file),'.stackbi-write-'+randomUUID()+'.tmp')
   try{writeFileSync(temp,content,{flag:'wx'});checked(path,{write:true});if(existed&&fingerprint(bytes(file))!==expectedSHA256||!existed&&existsSync(file))throw new Error('security_stale_file');renameSync(temp,file)}finally{if(existsSync(temp))unlinkSync(temp)}
   return {path,sha256:fingerprint(content),bytes:Buffer.byteLength(content)}
  })},
  skill({skillId,path='SKILL.md',offset=0}){return guarded('skill_read',skillId,()=>{
   const role=createRoleSkillContext(roleId),skill=role.skills.find(s=>s.id===skillId)
   if(!skill||typeof path!=='string'||isAbsolute(path)||/[\x00-\x1f:]/.test(path)||path.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))throw new Error('security_skill_forbidden')
   const base=dirname(skill.path),file=join(base,path),rel=relative(base,file)
   if(rel.startsWith('..')||isAbsolute(rel))throw new Error('security_skill_forbidden')
   const text=bytes(file);if(!Number.isSafeInteger(offset)||offset<0)throw new Error('security_invalid_range')
   return {skillId,path,sha256:fingerprint(text),text:text.slice(offset,offset+12000),nextOffset:offset+12000<text.length?offset+12000:null}
  })},
 }
}
