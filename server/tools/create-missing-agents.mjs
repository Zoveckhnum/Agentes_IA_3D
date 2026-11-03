// Explicit operator action. Creates only missing roles; never starts the worker.
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createDatabase, sql } from '../src/db.mjs'
import { timestamp } from '../src/values.mjs'
const catalog = JSON.parse(await readFile(new URL('../../roles/catalogo.json', import.meta.url), 'utf8'))
const apply = process.argv.includes('--apply') || process.env.APP_CREATE_MISSING_AGENTS === 'true'
const database = createDatabase()
const checksum = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex')
let tx
try {
  const pool = await database.pool()
  tx = new sql.Transaction(pool)
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
  const before = (await new sql.Request(tx).query("SELECT Path,Payload FROM app.Documents WITH(UPDLOCK,HOLDLOCK) WHERE CollectionPath=N'agents' ORDER BY Path")).recordset
  const agents = before.map(row=>JSON.parse(row.Payload))
  const existingRoles = new Set(agents.map(agent=>agent.rol))
  const missing = Object.entries(catalog.roles).filter(([id])=>!existingRoles.has(id))
  if (!apply || !missing.length) {
    await tx.rollback(); tx = null
    console.log(JSON.stringify({ apply, existingAgents: agents.length, missingRoles: missing.map(([id])=>id), created: 0 }))
  } else {
    const uid = process.env.APP_OWNER_UID
    if (!uid) throw new Error('Falta la identidad del propietario en el paquete protegido')
    const owner = (await new sql.Request(tx).input('uid', sql.NVarChar(128), uid).query('SELECT Email FROM app.Accounts WHERE Uid=@uid AND Disabled=0')).recordset[0]
    if (!owner) throw new Error('No existe una cuenta activa del propietario')
    let order = Math.max(-1, ...agents.map(a=>Number.isFinite(a.order)?a.order:-1)) + 1
    const colors = ['#4700E0','#0f766e','#b45309','#be185d','#1d4ed8','#7e22ce']
    const created = []
    for (const [id, role] of missing) {
      if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(id) || !role.nombre || !role.mision || !role.skills?.length) throw new Error('Ficha de rol incompleta')
      const documentId = `catalogo-${id}`, path = `agents/${documentId}`
      const present = await new sql.Request(tx).input('path', sql.NVarChar(450), path).query('SELECT 1 AS Present FROM app.Documents WITH(UPDLOCK,HOLDLOCK) WHERE Path=@path')
      if (present.recordset.length) throw new Error('Un identificador reservado ya pertenece a otro documento; no se sobrescribe')
      const color = colors[created.length % colors.length]
      const payload = JSON.stringify({ name: role.nombre, role: role.nombre, rol: id,
        bio: (role.descripcion || role.nombre).slice(0,140), mission: role.mision,
        photo: '', active: false, order: order++, breakUntil: null, breakType: null,
        ...(role.coordinador ? { kind: 'coordinador' } : {}),
        look: { torso: color, arms: color, legs: '#1f2937', hair: '#2b2118', accent: '#ffd23f', style: 'pelo', emblem: '', skin: '#f6c445' },
        createdAt: timestamp(), createdBy: owner.Email,
      })
      await new sql.Request(tx).input('path', sql.NVarChar(450), path).input('id', sql.NVarChar(200), documentId).input('payload', sql.NVarChar(sql.MAX), payload)
        .query("INSERT INTO app.Documents(Path,CollectionPath,DocumentId,Payload) VALUES(@path,N'agents',@id,@payload)")
      await new sql.Request(tx).input('actor', sql.NVarChar(128), uid).input('path', sql.NVarChar(450), path)
        .query("INSERT INTO app.AuditLog(Actor,Action,DocumentPath) VALUES(@actor,'create-agent',@path)")
      created.push({ roleId: id, name: role.nombre, active: false })
    }
    const after = (await new sql.Request(tx).query("SELECT Path,Payload FROM app.Documents WHERE CollectionPath=N'agents' ORDER BY Path")).recordset
    const oldPaths = new Set(before.map(row=>row.Path))
    if (checksum(before) !== checksum(after.filter(row=>oldPaths.has(row.Path))) || after.length !== before.length + created.length) throw new Error('La verificación de preservación de agentes falló')
    await tx.commit(); tx = null
    console.log(JSON.stringify({ ok: true, created: created.length, totalAgents: after.length, existingPreserved: true, agents: created }))
  }
} finally {
  if (tx) await tx.rollback().catch(()=>{})
  await database.close()
}
