import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import {join,relative,isAbsolute,resolve} from 'node:path'
import {existsSync,lstatSync,realpathSync} from 'node:fs'
export const fingerprint=value=>createHash('sha256').update(String(value)).digest('hex')
export const SECURITY_FEATURES=Object.freeze({shell_tool:false,apps:false,plugins:false,remote_plugin:false,multi_agent:false,multi_agent_v2:false,code_mode:false,code_mode_host:true,browser_use:false,browser_use_external:false,browser_use_full_cdp_access:false,in_app_browser:false,computer_use:false,image_generation:false,view_image:false,skill_search:false,skill_mcp_dependency_install:false,request_permissions_tool:false,enable_mcp_apps:false})
const credentialPatterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,/(?:github_pat_|gh[pousr]_|sk-)[A-Za-z0-9_-]{16,}/g,/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g,/\b(?:ya29\.|GOCSPX-)[A-Za-z0-9_.-]{12,}/g,/Bearer\s+[A-Za-z0-9._~+\/-]{12,}/gi,/(?:password|contrase(?:ñ|n)a|api[_-]?key|access_token|refresh_token|client_secret|bot_token|secret)\s*["']?\s*[:=]\s*["']?[^\s"',;}{]{8,}/gi]
export function redactSecrets(value){let text=String(value);for(const regex of credentialPatterns)text=text.replace(regex,match=>/[:=]\s*(?:process\.env[.\[]|os\.environ|(?:config|options|env)\.)/.test(match)?match:'[CREDENCIAL OMITIDA]');return text}
export function containsCredential(value){return redactSecrets(value)!==String(value)}
export function commandDecision(command){
 const text=String(command)
 return {allowed:false,reason:/\bgit(?:\.exe)?\b[\s\S]*\bpush\b[\s\S]*(?:--force|-f\b|\+refs)/i.test(text)?'force_push_forbidden':/\b(?:rm|rmdir|rd|del|erase|Remove-Item|Clear-Content|format|diskpart)\b/i.test(text)?'destructive_command_forbidden':'general_execution_forbidden',commandSHA256:fingerprint(text)}
}
export function assertTaskDirectory(cwd,env){
 if(lstatSync(cwd).isSymbolicLink())throw new Error('security_linked_task_root')
 const target=realpathSync.native(cwd)
 if(env.CODEX_HOME&&existsSync(join(env.CODEX_HOME,'config.toml')))throw new Error('security_inherited_codex_config_forbidden')
 if(!env.AGENTES_STATE_ROOT||!env.AGENTES_PROJECT_ROOT)throw new Error('security_task_root_missing')
 const bases=[join(env.AGENTES_STATE_ROOT,'trabajos'),join(env.AGENTES_STATE_ROOT,'probe'),join(env.AGENTES_PROJECT_ROOT,'products','.tareas')]
 for(const base of bases){
  if(!existsSync(base))continue
  if(lstatSync(base).isSymbolicLink())throw new Error('security_linked_task_root')
  const absolute=realpathSync.native(base),rel=relative(absolute,target)
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+(process.platform==='win32'?'\\':'/')))continue
  let current=absolute
  for(const part of ['',...rel.split(/[\\/]/).filter(Boolean)]){if(part)current=join(current,part);if(lstatSync(current).isSymbolicLink())throw new Error('security_linked_task_root')}
  let ancestor=target
  while(true){if(existsSync(join(ancestor,'.codex','config.toml')))throw new Error('security_project_codex_config_forbidden');const parent=resolve(ancestor,'..');if(parent===ancestor)break;ancestor=parent}
  return target
 }
 throw new Error('security_task_outside_roots')
}
const actions=new Set(['run_started','run_finished','tool_started','tool_finished','tool_denied','file_read','file_list','file_written','skill_read','command_denied','gate_probe'])
export function createSecurityAuditor(env={}, {taskId='',projectId=''}={}){
 const writer=env.AGENTES_SECURITY_AUDIT_WRITER
 if(env.AGENTES_SECURITY_MODE==='strict'&&(!writer||process.platform!=='win32'))throw new Error('security_audit_not_configured')
 return (action,{allowed=true,subject='',reason='policy',runId=''}={})=>{
  if(!actions.has(action)||!/^[a-z_]{1,60}$/.test(reason)||!/^[a-f0-9-]{0,64}$/.test(runId))throw new Error('security_invalid_audit_event')
  const event={format:'stackbi-security-event-v1',time:new Date().toISOString(),action,allowed,reason,taskSHA256:fingerprint(taskId),projectSHA256:fingerprint(projectId),subjectSHA256:fingerprint(subject),runId}
  if(writer){
   const result=spawnSync(join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',writer],{input:JSON.stringify(event),encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:4096})
   if(result.status!==0)throw new Error('security_audit_unavailable')
  }
  return event
 }
}
