import { readFile } from 'node:fs/promises'
import { createDatabase } from '../src/db.mjs'
const catalog = JSON.parse(await readFile(new URL('../../roles/catalogo.json', import.meta.url), 'utf8'))
const database = createDatabase()
try {
  const result = await (await database.pool()).request().query("SELECT JSON_VALUE(Payload,'$.rol') AS roleId,COUNT(*) AS agents FROM app.Documents WHERE CollectionPath=N'agents' GROUP BY JSON_VALUE(Payload,'$.rol')")
  const roles = result.recordset.map(row=>({ ...row, registered: Object.hasOwn(catalog.roles, row.roleId || '') }))
  const ok = roles.every(r=>r.registered)
  console.log(JSON.stringify({ ok, agents: roles.reduce((n,r)=>n+r.agents,0), roles }))
  if (!ok) process.exitCode = 1
} finally { await database.close() }
