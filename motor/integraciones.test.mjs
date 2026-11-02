import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeFile, githubClient } from './integraciones.mjs'
import { acceptsMessage } from './telegram.mjs'
import { parseReview, reviewDelivery } from './calidad.mjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { fileURLToPath } from 'node:url'

test('almacenamiento rechaza escapes, archivos de entorno y credenciales', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentes-test-'))
  writeFileSync(join(cwd, 'entrega.md'), 'Entrega de prueba')
  writeFileSync(join(cwd, '.env'), 'TOKEN=secreto')
  writeFileSync(join(cwd, 'clave.txt'), '-----BEGIN PRIVATE KEY-----')
  assert.equal(safeFile(cwd, 'entrega.md').bytes.toString(), 'Entrega de prueba')
  for (const path of ['../otro', '.env', 'clave.txt', join(cwd, 'entrega.md')]) assert.throws(() => safeFile(cwd, path))
})
test('errores de GitHub no exponen token ni cuerpo remoto', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => ({ ok: false, status: 403 })
  try { await assert.rejects(githubClient({ GITHUB_TOKEN: 'secreto' })('owner/repo', ''), /HTTP 403/) }
  finally { globalThis.fetch = original }
})
test('Telegram acepta exclusivamente mensajes privados del propietario', () => {
  assert.equal(acceptsMessage({ chat: { type: 'private' }, from: { id: 123 } }, '123'), true)
  for (const [type, id, owner] of [['group', 123, '123'], ['private', 999, '123'], ['private', 123, '']]) assert.equal(acceptsMessage({ chat: { type }, from: { id } }, owner), false)
})
test('QA no aprueba respuestas inválidas ni auto revisión', async () => {
  assert.throws(() => parseReview('{"verdict":"passed","summary":"OK","evidence":[],"issues":[]}'))
  const cwd = mkdtempSync(join(tmpdir(), 'agentes-qa-'))
  const author = { id: 'autor', active: true }
  const result = await reviewDelivery({ cwd, task: {}, author, requiredRoles: ['qa'], agents: [author], profile: () => ({ id: 'qa', qualityReviewer: true }), runCodex: () => { throw new Error('No debe ejecutarse') }, result: 'Entrega' })
  assert.equal(result.qualityStatus, 'blocked')
})
test('QA detecta cambios del revisor y conserva evidencias independientes', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentes-qa-'))
  writeFileSync(join(cwd, 'entrega.txt'), 'original')
  const args = { cwd, task: { tarea: 'Validar' }, author: { id: 'autor' }, requiredRoles: ['qa'], agents: [{ id: 'qa', name: 'QA' }], profile: () => ({ id: 'qa', qualityReviewer: true, mision: 'Revisar' }), result: 'Entrega' }
  const response = { code: 0, json: { result: JSON.stringify({ verdict: 'passed', summary: 'Verificado', evidence: ['Leí entrega.txt: original'], issues: [] }) } }
  const valid = await reviewDelivery({ ...args, runCodex: async () => response })
  assert.equal(valid.qualityStatus, 'passed')
  assert.equal(valid.qualityReviews[0].reviewerId, 'qa')
  const altered = await reviewDelivery({ ...args, runCodex: async (_, path) => { writeFileSync(join(path, 'entrega.txt'), 'cambio'); return response } })
  assert.equal(altered.qualityStatus, 'blocked')
  const interrupted = await reviewDelivery({ ...args, runCodex: async () => ({ code: 1, err: 'Conexión interrumpida.', json: { result: '' } }) })
  assert.equal(interrupted.qualityStatus, 'blocked')
  assert.match(interrupted.qualityReviews[0].summary, /Conexión interrumpida/)
})
test('servidor MCP de revisión no expone herramientas de escritura', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'agentes-mcp-'))
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('proyectos-mcp.mjs', import.meta.url)), cwd, 'read'], stderr: 'pipe' })
  const client = new Client({ name: 'test', version: '1' })
  try {
    await client.connect(transport)
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map(t => t.name).sort(), ['drive_listar', 'github_leer', 'listar_proyectos'])
    for (const tool of tools) assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} debe declarar que solo lee`)
    assert.equal(tools.find(t => t.name === 'listar_proyectos').annotations?.openWorldHint, false)
    const result = await client.callTool({ name: 'listar_proyectos', arguments: {} })
    assert.equal(result.isError, undefined)
    assert.ok(result.content[0].text)
  } finally { await client.close() }
})
