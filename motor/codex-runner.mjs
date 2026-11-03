import { Codex } from '@openai/codex-sdk'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRoleSkillContext } from './role-skills.mjs'
import { uuid } from './hitl/core.mjs'
import { join } from 'node:path'
import { createTokenMeter,loadTokenPolicy } from './token-optimization.mjs'

const rules = readFileSync(new URL('AGENTS.md', import.meta.url), 'utf8')
const TOOL_ITEMS = new Set(['command_execution', 'mcp_tool_call', 'file_change', 'web_search'])

// El proceso de Codex no necesita las credenciales de Firebase ni de Telegram.
export function codexEnvironment(env, agentName, color) {
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|LANG|LC_.*|SHELL|TERM|CODEX_HOME|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|SSL_CERT_FILE|NODE_EXTRA_CA_CERTS)$/i
  return {
    ...Object.fromEntries(Object.entries(env).filter(([k, v]) => allowed.test(k) && typeof v === 'string')),
    AGENTES_AGENTE: agentName || '', AGENTES_COLOR: color || '',
    ...(env.AGENTES_PROJECTS_CONFIG ? { AGENTES_PROJECTS_CONFIG: env.AGENTES_PROJECTS_CONFIG } : {}),
  }
}

export function createCodexRunner(env = {}, { CodexClient = Codex, timeoutMs = 25 * 60 * 1000 } = {}) {
  const policy=loadTokenPolicy(env.AGENTES_TOKEN_POLICY)
  const meter=env.AGENTES_STATE_ROOT?createTokenMeter(join(env.AGENTES_STATE_ROOT,'state','tokens'),{policy}):null
  const runCodex = async function(prompt, cwd, { tools = ['web_search'], resume, agentName, color, maxTurns = 40, outputSchema, roleId = 'personalizado', signal, taskId = '', projectId = '' } = {}) {
    const controller = new AbortController()
    let reason = '', result = '', sessionId = resume || null, usage = null, completed = false
    const toolNames = new Set()
    const approvalRequests = new Map()
    let reservation=null,settled=false,accounting=null,promptBytes=0
    const timer = setTimeout(() => {
      reason = `Tiempo máximo agotado (${Math.round(timeoutMs / 1000)} s).`
      controller.abort()
    }, timeoutMs)
    const response = (failed, error = '') => {
      if(reservation&&!settled){
        settled=true
        try{accounting=meter.finish(reservation,usage,{failed:!!failed})}
        catch{failed=true;reason='No se pudo cerrar el registro de tokens; la reserva se conserva para revisión.'}
      }
      return ({
      code: failed ? 1 : 0,
      json: { result: failed ? '' : result, session_id: sessionId, is_error: failed, usage, tools_used: [...toolNames], approval_requests:[...approvalRequests.values()],token_accounting:accounting,prompt_bytes:promptBytes },
      err: failed ? (reason || error || 'Codex no completó la respuesta.') : '',
    })}
    const canWriteProjects = tools.includes('proyectos_integracion')
    const canRegisterProjects = canWriteProjects || tools.includes('proyectos_registro')
    const canReadProjects = canWriteProjects || tools.includes('proyectos_lectura')
    const canRequestApprovals = tools.includes('aprobaciones_solicitar') && !!env.APP_HITL_CREDENTIAL_FILE
    try {
      if (signal?.aborted) return response(true, 'Ejecución cancelada antes de iniciar.')
      const roleContext = createRoleSkillContext(roleId)
      const fullPrompt=`${rules}\n\n${roleContext.text}\n\n## Encargo concreto\n${prompt}`
      promptBytes=Buffer.byteLength(fullPrompt)
      if(promptBytes>policy.maxPromptBytes)throw new Error('El contexto supera el límite de bytes; divide la tarea sin eliminar requisitos.')
      if(meter)reservation=meter.reserve({taskId,projectId,roleId,promptBytes})
      const codex = new CodexClient({
        ...(env.CODEX_API_KEY || env.OPENAI_API_KEY ? { apiKey: env.CODEX_API_KEY || env.OPENAI_API_KEY } : {}),
        env: codexEnvironment(env, agentName, color),
        ...(canRegisterProjects || canReadProjects || canRequestApprovals ? {
          config: { mcp_servers: { ...(canRegisterProjects || canReadProjects ? { proyectos: {
            command: process.execPath,
            args: [fileURLToPath(new URL('proyectos-mcp.mjs', import.meta.url)), cwd, canWriteProjects ? 'write' : canRegisterProjects ? (canReadProjects ? 'register-read' : 'register') : 'read'],
            startup_timeout_sec: 20,
            tool_timeout_sec: 180,
            enabled_tools: ['listar_proyectos', ...(canReadProjects ? ['github_leer', 'drive_listar'] : []),
              ...(canRegisterProjects ? ['registrar_proyecto'] : []), ...(canWriteProjects ? ['github_borrador', 'drive_guardar'] : [])],
            ...(canRegisterProjects ? { tools: {
              // Registro local reversible. El destino debe proceder de la solicitud del dueño.
              registrar_proyecto: { approval_mode: 'approve' },
              // El consentimiento para borradores no amplía los permisos del rol.
              ...(canWriteProjects && env.PROJECTS_ALLOW_DRAFT_WRITES === 'true' ? {
                github_borrador: { approval_mode: 'approve' },
                drive_guardar: { approval_mode: 'approve' },
              } : {}),
            } } : {}),
          } } : {}), ...(canRequestApprovals ? {aprobaciones:{
            command:process.execPath,args:[fileURLToPath(new URL('hitl/mcp.mjs',import.meta.url)),taskId],
            env:{APP_HITL_CREDENTIAL_FILE:env.APP_HITL_CREDENTIAL_FILE},
            startup_timeout_sec:20,tool_timeout_sec:30,
            enabled_tools:['solicitar_aprobacion','estado_aprobacion'],
            tools:{solicitar_aprobacion:{approval_mode:'approve'}},
          }} : {}) } },
        } : {}),
      })
      const options = {
        ...(env.CODEX_MODEL ? { model: env.CODEX_MODEL } : {}),
        workingDirectory: cwd,
        skipGitRepoCheck: true,
        sandboxMode: 'workspace-write',
        approvalPolicy: 'never',
        networkAccessEnabled: false,
        webSearchMode: tools.includes('web_search') ? 'live' : 'disabled',
      }
      const thread = resume ? codex.resumeThread(resume, options) : codex.startThread(options)
      const stream = await thread.runStreamed(fullPrompt, { signal: signal ? AbortSignal.any([controller.signal, signal]) : controller.signal, ...(outputSchema ? { outputSchema } : {}) })
      let calls = 0
      for await (const event of stream.events) {
        if (event.type === 'thread.started') sessionId = event.thread_id
        if (event.type === 'item.started' && TOOL_ITEMS.has(event.item.type) && ++calls > maxTurns) {
          reason = 'El agente agotó su límite de herramientas. Mueve la tarea a Correcciones para continuar.'
          controller.abort()
          break
        }
        if (event.type === 'item.completed' && event.item.type === 'agent_message') result = event.item.text
        if (event.type === 'item.completed' && event.item.type === 'mcp_tool_call') toolNames.add(`${event.item.server}.${event.item.tool}`)
        if(event.type==='item.completed' && event.item.type==='mcp_tool_call' && event.item.server==='aprobaciones' && event.item.tool==='solicitar_aprobacion'){
          for(const block of event.item.result?.content||[])try{
            const value=JSON.parse(block.text)
            if(uuid(value.requestId)&&['pending','approved','rejected','expired','executing','executed','failed'].includes(value.status))approvalRequests.set(value.requestId,{requestId:value.requestId,status:value.status})
          }catch{}
        }
        if (event.type === 'turn.completed') { completed = true; usage = event.usage }
        if (event.type === 'turn.failed' || event.type === 'error') {
          reason = event.error?.message || event.message || 'Error de Codex.'
          break
        }
      }
      return response(!!reason || signal?.aborted || !completed || !result.trim())
    } catch (error) {
      return response(true, error.message)
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }
  runCodex.tokenReport=()=>meter?.report()||null
  return runCodex
}
