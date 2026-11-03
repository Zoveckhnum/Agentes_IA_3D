import test from 'node:test'
import assert from 'node:assert/strict'
import { createCodexRunner, codexEnvironment } from './codex-runner.mjs'

function fake(events) {
  const calls = []
  class Client {
    constructor(options) { calls.push(['client', options]) }
    startThread(options) { calls.push(['start', options]); return this }
    resumeThread(id, options) { calls.push(['resume', id, options]); return this }
    async runStreamed(prompt, options) {
      calls.push(['run', prompt, options])
      return { events: (async function* () { for (const event of events) yield event })() }
    }
  }
  return { Client, calls }
}
const message = text => ({ type: 'item.completed', item: { type: 'agent_message', text } })
const completed = { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 5 } }

test('registro local y consentimiento para borradores respetan los permisos del rol', async () => {
  for (const granted of [false, true]) {
    for (const capability of ['proyectos_integracion', 'proyectos_lectura', 'proyectos_registro']) {
      const { Client, calls } = fake([message('listo'), completed])
      await createCodexRunner({ PROJECTS_ALLOW_DRAFT_WRITES: String(granted) }, { CodexClient: Client })('tarea', '/trabajo', { tools: [capability] })
      const config = calls[0][1].config.mcp_servers.proyectos
      const canWrite = capability === 'proyectos_integracion'
      const canRegister = canWrite || capability === 'proyectos_registro'
      assert.equal(config.args.at(-1), canWrite ? 'write' : canRegister ? 'register' : 'read')
      assert.deepEqual(config.enabled_tools, ['listar_proyectos', ...(capability !== 'proyectos_registro' ? ['github_leer', 'drive_listar'] : []), ...(canRegister ? ['registrar_proyecto'] : []), ...(canWrite ? ['github_borrador', 'drive_guardar'] : [])])
      assert.deepEqual(config.tools || {}, canRegister ? {
        registrar_proyecto: { approval_mode: 'approve' },
        ...(granted && canWrite ? {
          github_borrador: { approval_mode: 'approve' },
          drive_guardar: { approval_mode: 'approve' },
        } : {}),
      } : {})
      assert.equal(config.default_tools_approval_mode, undefined)
      assert.equal(calls[1][1].approvalPolicy, 'never')
      assert.equal(calls[1][1].networkAccessEnabled, false)
    }
  }
})

test('extrae entrega final, sesión y tokens sin convertirlos en dólares', async () => {
  const { Client, calls } = fake([
    { type: 'thread.started', thread_id: 'sesion-1' }, message('avance'), message('entrega'), completed,
  ])
  const res = await createCodexRunner({ CODEX_MODEL: 'mi-modelo', AGENT_PASSWORD: 'secreto' }, { CodexClient: Client })('tarea', '/trabajo', { tools: [] })
  assert.equal(res.code, 0)
  assert.equal(res.json.result, 'entrega')
  assert.equal(res.json.session_id, 'sesion-1')
  assert.deepEqual(res.json.usage, completed.usage)
  assert.equal(res.json.total_cost_usd, undefined)
  assert.equal(calls[0][1].env.AGENT_PASSWORD, undefined)
  assert.equal(calls[1][1].webSearchMode, 'disabled')
  assert.equal(calls[1][1].approvalPolicy, 'never')
  assert.equal(calls[1][1].sandboxMode, 'workspace-write')
  assert.equal(calls[1][1].model, 'mi-modelo')
  assert.match(calls[2][1], /No publiques en producción/)
})
test('reanuda el hilo y habilita búsqueda solo para el rol web', async () => {
  const { Client, calls } = fake([message('listo'), completed])
  await createCodexRunner({}, { CodexClient: Client })('tarea', '/trabajo', { resume: 'anterior', tools: ['web_search'] })
  assert.equal(calls[1][0], 'resume')
  assert.equal(calls[1][1], 'anterior')
  assert.equal(calls[1][2].webSearchMode, 'live')
})
test('un fallo o stream incompleto nunca entrega avances como resultado aprobado', async () => {
  for (const events of [[message('avance')], [message('avance'), { type: 'turn.failed', error: { message: 'Sin sesión' } }]]) {
    const { Client } = fake(events)
    const res = await createCodexRunner({}, { CodexClient: Client })('tarea', '/trabajo')
    assert.equal(res.code, 1)
    assert.equal(res.json.result, '')
    assert.ok(res.err)
  }
})
test('cancela al superar el presupuesto de herramientas', async () => {
  const { Client } = fake([
    { type: 'item.started', item: { type: 'mcp_tool_call' } },
    { type: 'item.started', item: { type: 'command_execution' } }, message('no entregar'), completed,
  ])
  const res = await createCodexRunner({}, { CodexClient: Client })('tarea', '/trabajo', { maxTurns: 1 })
  assert.equal(res.code, 1)
  assert.match(res.err, /límite/)
})
test('cancela una ejecución que excede el tiempo máximo', async () => {
  class Client {
    startThread() { return this }
    async runStreamed(_, { signal }) {
      return { events: (async function* () {
        await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
        yield completed
      })() }
    }
  }
  const res = await createCodexRunner({}, { CodexClient: Client, timeoutMs: 10 })('tarea', '/trabajo')
  assert.equal(res.code, 1)
  assert.match(res.err, /Tiempo máximo/)
})
test('filtra credenciales ajenas y preserva el entorno del sistema', () => {
  const env = codexEnvironment({ PATH: 'bin', USERPROFILE: '/user', FIREBASE_API_KEY: 'x', TELEGRAM_BOT_TOKEN: 'y', CODEX_API_KEY: 'z' }, 'Agente', '#123456')
  assert.deepEqual(env, { PATH: 'bin', USERPROFILE: '/user', AGENTES_AGENTE: 'Agente', AGENTES_COLOR: '#123456' })
})

test('el rol efectivo llega al modelo con su ficha y solo sus skills asignadas', async () => {
  const { Client, calls } = fake([message('entrega'), completed])
  const response = await createCodexRunner({}, { CodexClient: Client })('Construye un formulario', '/trabajo', { tools: [], roleId: 'frontend_portales' })
  assert.equal(response.code, 0)
  const prompt = calls.find(c=>c[0]==='run')[1]
  assert.match(prompt, /frontend_portales/)
  assert.match(prompt, /vercel-react-best-practices/)
  assert.match(prompt, /Criterios de aceptación/)
  assert.match(prompt, /no permisos/)
  assert.doesNotMatch(prompt, /powershell-windows/)
  assert.equal(calls.find(c=>c[0]==='start')[1].networkAccessEnabled, false)
})

test('un rol desconocido falla antes de crear el cliente o ejecutar herramientas', async () => {
  const { Client, calls } = fake([message('no debe ejecutar'), completed])
  const response = await createCodexRunner({}, { CodexClient: Client })('tarea', '/trabajo', { roleId: 'sin_registrar' })
  assert.equal(response.code, 1)
  assert.equal(calls.length, 0)
  assert.match(response.err, /no registrado/)
})
