import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createDatabase, sql } from '../src/db.mjs'
export async function migrateSchema(database) {
  const pool = await database.pool()
  const tx = new sql.Transaction(pool)
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
  try {
    await new sql.Request(tx).query("DECLARE @r int; EXEC @r=sp_getapplock @Resource=N'AgentesIA3D.Schema',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=15000; IF @r<0 THROW 50001,'No se pudo bloquear la migracion',1; IF OBJECT_ID('dbo.SchemaMigrations') IS NULL CREATE TABLE dbo.SchemaMigrations(Name nvarchar(200) NOT NULL PRIMARY KEY,SHA256 char(64) NOT NULL,AppliedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME());")
    const directory = fileURLToPath(new URL('../migrations/', import.meta.url))
    for (const name of (await readdir(directory)).filter(n => /^\d+-[a-z0-9-]+\.sql$/.test(n)).sort()) {
      const content = await readFile(`${directory}/${name}`, 'utf8'), digest = createHash('sha256').update(content).digest('hex')
      const existing = await new sql.Request(tx).input('name', sql.NVarChar(200), name).query('SELECT SHA256 FROM dbo.SchemaMigrations WHERE Name=@name')
      if (existing.recordset[0]) { if (existing.recordset[0].SHA256 !== digest) throw new Error(`Se modificó una migración aplicada: ${name}`); continue }
      for (const batch of content.split(/^\s*GO\s*$/gmi).filter(v => v.trim())) await new sql.Request(tx).batch(batch)
      await new sql.Request(tx).input('name', sql.NVarChar(200), name).input('hash', sql.Char(64), digest).query('INSERT INTO dbo.SchemaMigrations(Name,SHA256) VALUES(@name,@hash)')
      console.log(JSON.stringify({ event: 'schema_migration_applied', migration: name }))
    }
    await tx.commit()
  } catch (error) { await tx.rollback().catch(() => {}); throw error }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const database = createDatabase()
  try { await migrateSchema(database) } finally { await database.close() }
}
