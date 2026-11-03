import { execFileSync } from 'node:child_process'

export function requesterCredentials(env=process.env) {
  const file=env.APP_HITL_CREDENTIAL_FILE
  if(file!=='C:\\ProgramData\\StackBI\\AgentMotor\\secrets\\approval-request.p7m')throw new Error('Falta el canal de solicitudes configurado por el operador')
  const raw=execFileSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','C:\\ProgramData\\StackBI\\AgentMotor\\service\\Get-ApprovalCredential.ps1','-EnvironmentFile',file],{encoding:'utf8',windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe']})
  const value=JSON.parse(raw)
  if(value.endpoint!=='http://127.0.0.1:10013'||typeof value.token!=='string'||value.token.length<48)throw new Error('Canal de solicitudes inválido')
  return value
}
export function humanClient(env=process.env,{credential=requesterCredentials,fetchImpl=fetch}={}) {
  return async(path,body)=>{
    if(!['/request'].includes(path)&&!/^\/requests\/[a-f0-9-]{36}$/.test(path))throw new Error('El motor solo puede solicitar y consultar aprobaciones')
    const config=credential(env)
    const response=await fetchImpl(config.endpoint+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),redirect:'error'})
    if(!response.ok)throw new Error('El servicio de aprobación no aceptó la consulta')
    return response.json()
  }
}
export function approvalResult(record) {return {requestId:record.id,planId:record.planId,status:record.status,kind:record.kind,expiresAt:record.expiresAt,...(record.result?{result:record.result}:{})}}
export function approvalResolution(task,records) {
  if(!records.length||records.some(r=>r.taskId!==task.id||(task.projectId&&r.project!==task.projectId)))throw new Error('La aprobación corresponde a otra tarea o proyecto.')
  if(records.some(r=>['rejected','expired','failed'].includes(r.status)))return 'blocked'
  if(records.every(r=>r.status==='executed'))return 'resume'
  return 'waiting'
}
