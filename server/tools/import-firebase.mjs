import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { createDatabase, sql } from '../src/db.mjs'
import { passwordDigest } from '../src/passwords.mjs'
import { validateValue } from '../src/values.mjs'

const sha = value => createHash('sha256').update(value).digest('hex')
export function firestoreValue(value) {
  if ('nullValue' in value) return null
  if ('booleanValue' in value) return value.booleanValue
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) { const n = Number(value.integerValue); return Number.isSafeInteger(n) ? n : { $type: 'int64', value: value.integerValue } }
  if ('doubleValue' in value) return typeof value.doubleValue === 'number' ? value.doubleValue : { $type: 'double', value: value.doubleValue }
  if ('timestampValue' in value) {
    const match = /^(.*?)(?:\.(\d+))?Z$/.exec(value.timestampValue)
    if (!match) throw new Error('Timestamp de exportación inválido')
    return { $type: 'timestamp', seconds: Date.parse(`${match[1]}Z`) / 1000, nanoseconds: Number((match[2] || '').padEnd(9, '0')) }
  }
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(firestoreValue)
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([k, v]) => [k, firestoreValue(v)]))
  if ('referenceValue' in value) return { $type: 'reference', value: value.referenceValue }
  if ('geoPointValue' in value) return { $type: 'geopoint', ...value.geoPointValue }
  if ('bytesValue' in value) return { $type: 'bytes', value: value.bytesValue }
  throw new Error('La exportación incluye un tipo no reconocido; se cancela sin descartar datos')
}
async function emulatorRequest(path, body, method = 'POST') {
  const response = await fetch(`http://127.0.0.1:18080/v1/projects/demo-agentes-ia-3d/databases/(default)/documents${path}`, {
    method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`No se pudo leer la copia del emulador: HTTP ${response.status}`)
  return response.json()
}
export async function readSourceDocuments() {
  const documents = [], visited = new Set()
  async function walk(parent = '') {
    if (visited.has(parent)) return
    visited.add(parent)
    let pageToken
    do {
      const result = await emulatorRequest(`${parent}:listCollectionIds`, { pageSize: 1000, ...(pageToken ? { pageToken } : {}) })
      for (const collection of result.collectionIds || []) {
        let next
        do {
          const path = `${parent}/${encodeURIComponent(collection)}`
          const result = await emulatorRequest(`${path}?pageSize=1000&showMissing=true${next ? `&pageToken=${encodeURIComponent(next)}` : ''}`, null, 'GET')
          for (const source of result.documents || []) {
            const relative = source.name.split('/documents/')[1]
            if (!relative || relative.length > 450 || relative.split('/').some(p => !p || p.length > 200)) throw new Error('Ruta de origen fuera de los límites SQL; se cancela la importación')
            if (source.createTime || source.updateTime || source.fields) {
              const data = Object.fromEntries(Object.entries(source.fields || {}).map(([key, value]) => [key, firestoreValue(value)]))
              validateValue(data)
              documents.push({ path: relative, data })
            }
            await walk(`/${relative.split('/').map(encodeURIComponent).join('/')}`)
          }
          next = result.nextPageToken
        } while (next)
      }
      pageToken = result.nextPageToken
    } while (pageToken)
  }
  await walk()
  return documents.sort((a, b) => a.path.localeCompare(b.path))
}
async function sourceHash(directory) {
  const files = []
  async function walk(dir, prefix = '') {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('La fuente de migración no admite enlaces')
      if (entry.isDirectory()) await walk(join(dir, entry.name), `${prefix}${entry.name}/`)
      else files.push(`${prefix}${entry.name}:${sha(await readFile(join(dir, entry.name)))}`)
    }
  }
  await walk(directory)
  return sha(files.sort().join('\n'))
}
export async function importFirebase(database, sourceDirectory, reportPath) {
  const source = resolve(sourceDirectory), digest = await sourceHash(source)
  const sourceAccounts = JSON.parse(await readFile(join(source, 'auth_export', 'accounts.json'), 'utf8')).users || []
  const documents = await readSourceDocuments()
  if (!sourceAccounts.length || !documents.length) throw new Error('Fuente vacía; se cancela la migración')
  const profiles = documents.filter(d => d.path.startsWith('users/') && d.path.split('/').length === 2)
  const owner = profiles.filter(p => p.data.role === 'admin').sort((a, b) => Number(!!b.data.isSuper) - Number(!!a.data.isSuper) || a.path.localeCompare(b.path))[0]
  if (!owner || !sourceAccounts.some(a => a.localId === owner.path.split('/')[1] && !a.disabled)) throw new Error('No hay administrador con cuenta verificable en la exportación')
  const robot = sourceAccounts.find(a => !profiles.some(p => p.path === `users/${a.localId}`) && /robot|agent/i.test(a.email || ''))
  if (!robot) throw new Error('Se requiere identificar explícitamente la cuenta del motor')
  const prepared = []
  for (const account of sourceAccounts) {
    const prefix = `fakeHash:salt=${account.salt}:password=`
    let digest
    if (account.passwordHash?.startsWith(prefix)) digest = await passwordDigest(account.passwordHash.slice(prefix.length))
    else if (account.passwordHash) throw new Error('Hash de autenticación no compatible; no se descartan cuentas ni se reemplazan credenciales')
    prepared.push({ ...account, digest })
  }
  const tx = new sql.Transaction(await database.pool())
  await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
  try {
    await new sql.Request(tx).query("DECLARE @r int; EXEC @r=sp_getapplock @Resource=N'AgentesIA3D.Import',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=15000; IF @r<0 THROW 50001,'No se pudo bloquear la importacion',1;")
    const previous = await new sql.Request(tx).input('hash', sql.Char(64), digest).query('SELECT DocumentCount,AccountCount FROM app.MigrationImports WHERE SourceHash=@hash')
    if (previous.recordset.length) { await tx.rollback(); return { alreadyImported: true, sourceHash: digest, ...previous.recordset[0] } }
    const counts = await new sql.Request(tx).query('SELECT (SELECT COUNT(*) FROM app.Documents) AS Documents,(SELECT COUNT(*) FROM app.Accounts) AS Accounts')
    if (counts.recordset[0].Documents || counts.recordset[0].Accounts) throw new Error('La base destino contiene datos: no se sobrescribe')
    for (const document of documents) {
      const parts = document.path.split('/'), payload = JSON.stringify(document.data)
      await new sql.Request(tx).input('path', sql.NVarChar(450), document.path).input('collection', sql.NVarChar(400), parts.slice(0, -1).join('/')).input('id', sql.NVarChar(200), parts.at(-1)).input('payload', sql.NVarChar(sql.MAX), payload)
        .query('INSERT INTO app.Documents(Path,CollectionPath,DocumentId,Payload) VALUES(@path,@collection,@id,@payload)')
    }
    for (const account of prepared) {
      await new sql.Request(tx).input('uid', sql.NVarChar(128), account.localId).input('email', sql.NVarChar(320), account.email).input('digest', sql.VarChar(300), account.digest || null)
        .input('disabled', sql.Bit, !!account.disabled || account.localId === robot.localId).input('verified', sql.Bit, !!account.emailVerified).input('name', sql.NVarChar(200), account.displayName || null).input('photo', sql.NVarChar(2048), account.photoUrl || null)
        .query('INSERT INTO app.Accounts(Uid,Email,PasswordDigest,Disabled,MustChangePassword,EmailVerified,DisplayName,PhotoUrl) VALUES(@uid,@email,@digest,@disabled,1,@verified,@name,@photo)')
    }
    const actual = await new sql.Request(tx).query('SELECT Path,Payload FROM app.Documents')
    const expected = new Map(documents.map(d => [d.path, JSON.stringify(d.data)]))
    if (actual.recordset.length !== expected.size || actual.recordset.some(r => expected.get(r.Path) !== r.Payload)) throw new Error('La verificación de documentos no coincide: rollback completo')
    await new sql.Request(tx).input('hash', sql.Char(64), digest).input('documents', sql.Int, documents.length).input('accounts', sql.Int, prepared.length).query('INSERT INTO app.MigrationImports(SourceHash,DocumentCount,AccountCount) VALUES(@hash,@documents,@accounts)')
    await tx.commit()
    const collections = {}
    for (const document of documents) { const collection = document.path.split('/')[0]; collections[collection] = (collections[collection] || 0) + 1 }
    const report = { sourceHash: digest, documentCount: documents.length, accountCount: prepared.length, collections, documentsVerified: true, ownerUid: owner.path.split('/')[1], workerUid: robot.localId, workerEmail: robot.email, passwordsRehashed: prepared.filter(a => a.digest).length, passwordRotationRequired: true, sourcePreserved: true, verifiedAt: new Date().toISOString() }
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
    return report
  } catch (error) { await tx.rollback().catch(() => {}); throw error }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [source, report] = process.argv.slice(2)
  if (!source || !report) throw new Error('Uso: import-firebase.mjs <copia-protegida-exportacion> <informe-protegido>')
  const database = createDatabase()
  try { const result = await importFirebase(database, source, report); console.log(JSON.stringify({ event: 'firebase_import_verified', documentCount: result.documentCount, accountCount: result.accountCount, collections: result.collections, documentsVerified: result.documentsVerified, alreadyImported: result.alreadyImported || false })) } finally { await database.close() }
}
