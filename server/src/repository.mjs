import { createHash, randomBytes } from 'node:crypto'
import { sql } from './db.mjs'
import { documentPath, ApiError, applyMutation, applyQuery, validateValue } from './values.mjs'
import { canRead, authorizeWrite } from './policy.mjs'
const hash = value => createHash('sha256').update(value).digest('hex')
export function createRepository(database, maxDocuments = 5000, ownerUid = '') {
  const request = (target, path) => new sql.Request(target).input('path', sql.NVarChar(450), path)
  async function lookup(target, path, lock = false) {
    const r = await request(target, path).query(`SELECT Payload FROM app.Documents ${lock ? 'WITH(UPDLOCK,HOLDLOCK)' : ''} WHERE Path=@path`)
    return r.recordset[0] ? JSON.parse(r.recordset[0].Payload) : null
  }
  async function actorProfile(actor, target) {
    if (actor.worker) return actor
    const profile = await lookup(target, `users/${actor.uid}`)
    return { ...actor, role: profile?.role || 'pending', isSuper: actor.uid === ownerUid || profile?.isSuper === true }
  }
  return {
    async read(actor, spec) {
      if (!spec || typeof spec !== 'object') throw new ApiError(400, 'invalid-argument')
      const pool = await database.pool(), effective = await actorProfile(actor, pool)
      if (spec.kind === 'document') {
        documentPath(spec.path)
        if (!canRead(effective, spec.path)) throw new ApiError(403, 'permission-denied')
        let data = await lookup(pool, spec.path)
        if (data && spec.path === `users/${ownerUid}`) data = { ...data, isSuper: true }
        return { kind: 'document', path: spec.path, data }
      }
      if (spec.kind !== 'collection') throw new ApiError(400, 'invalid-argument')
      documentPath(spec.path, true)
      // A collection may contain private documents; authorize each row before returning it.
      const r = await new sql.Request(pool).input('collection', sql.NVarChar(400), spec.path).input('count', sql.Int, maxDocuments + 1)
        .query('SELECT TOP (@count) Path,Payload FROM app.Documents WHERE CollectionPath=@collection ORDER BY DocumentId')
      if (r.recordset.length > maxDocuments) throw new ApiError(413, 'resource-exhausted', 'Se requiere paginación para esta colección.')
      if (!canRead(effective, `${spec.path}/__probe__`) && !['users', 'chats', 'worklog', 'invites'].includes(spec.path)) throw new ApiError(403, 'permission-denied')
      const documents = r.recordset.map(r => ({ path: r.Path, data: { ...JSON.parse(r.Payload), ...(r.Path === `users/${ownerUid}` ? { isSuper: true } : {}) } })).filter(d => canRead(effective, d.path))
      return { kind: 'collection', documents: applyQuery(documents, spec) }
    },
    async commit(actor, body) {
      if (!body || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(body.id || '') || !Array.isArray(body.operations) || body.operations.length < 1 || body.operations.length > 400) throw new ApiError(400, 'invalid-argument')
      const unique = new Set()
      for (const op of body.operations) { documentPath(op.path); if (unique.has(op.path)) throw new ApiError(400, 'invalid-argument'); unique.add(op.path) }
      const conditions = body.preconditions ?? []
      if (!Array.isArray(conditions) || conditions.length > body.operations.length) throw new ApiError(400, 'invalid-argument')
      const checked = new Set()
      for (const c of conditions) {
        if (!c || !unique.has(c.path) || checked.has(c.path) || !c.expected || Array.isArray(c.expected) || typeof c.expected !== 'object') throw new ApiError(400, 'invalid-argument')
        validateValue(c.expected); checked.add(c.path)
      }
      const transaction = new sql.Transaction(await database.pool())
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
      try {
        const digest = hash(JSON.stringify(conditions.length ? { operations: body.operations, preconditions: conditions } : body.operations))
        const prior = await new sql.Request(transaction).input('id', sql.UniqueIdentifier, body.id).query('SELECT Actor,RequestHash FROM app.Commits WITH(UPDLOCK,HOLDLOCK) WHERE CommitId=@id')
        if (prior.recordset[0]) {
          if (prior.recordset[0].Actor !== actor.uid || prior.recordset[0].RequestHash !== digest) throw new ApiError(409, 'already-exists')
          await transaction.commit(); return { ok: true, duplicate: true }
        }
        const effective = await actorProfile(actor, transaction), now = new Date(), invitations = []
        for (const op of [...body.operations].sort((a, b) => a.path.localeCompare(b.path))) {
          const before = await lookup(transaction, op.path, true)
          const condition = conditions.find(c => c.path === op.path)
          if (condition && Object.entries(condition.expected).some(([key, value]) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(value))) throw new ApiError(409, 'aborted', 'La tarea cambió o está asignada a otro proceso.')
          if (actor.worker && op.path.startsWith('tasks/') && before?.autoLoopOwner && condition?.expected?.autoLoopOwner !== before.autoLoopOwner) throw new ApiError(409, 'aborted', 'La escritura requiere la asignación vigente.')
          const after = applyMutation(before, op, now)
          await authorizeWrite(effective, op, before, after, path => lookup(transaction, path))
          if (op.path.startsWith('invites/') && op.path.split('/').length === 2) {
            const email = op.path.split('/')[1]
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email !== email.toLowerCase()) throw new ApiError(400, 'invalid-argument')
            await new sql.Request(transaction).input('email', sql.NVarChar(320), email).query('DELETE FROM app.InvitationTokens WHERE Email=@email')
            if (after) {
              const token = randomBytes(32).toString('base64url')
              await new sql.Request(transaction).input('email', sql.NVarChar(320), email).input('hash', sql.Char(64), hash(token)).input('role', sql.VarChar(16), after.role).input('actor', sql.NVarChar(128), actor.uid)
                .query('INSERT INTO app.InvitationTokens(Email,TokenHash,Role,CreatedBy,ExpiresAt) VALUES(@email,@hash,@role,@actor,DATEADD(hour,48,SYSUTCDATETIME()))')
              invitations.push({ email, token })
            }
          }
          if (!after) await request(transaction, op.path).query('DELETE FROM app.Documents WHERE Path=@path')
          else {
            const parts = op.path.split('/'), json = JSON.stringify(after)
            const r = request(transaction, op.path).input('collection', sql.NVarChar(400), parts.slice(0, -1).join('/')).input('documentId', sql.NVarChar(200), parts.at(-1)).input('payload', sql.NVarChar(sql.MAX), json)
            await r.query('UPDATE app.Documents SET Payload=@payload,UpdatedAt=SYSUTCDATETIME() WHERE Path=@path; IF @@ROWCOUNT=0 INSERT INTO app.Documents(Path,CollectionPath,DocumentId,Payload) VALUES(@path,@collection,@documentId,@payload)')
          }
          await new sql.Request(transaction).input('actor', sql.NVarChar(128), actor.uid).input('action', sql.VarChar(32), op.type).input('path', sql.NVarChar(450), op.path)
            .query('INSERT INTO app.AuditLog(Actor,Action,DocumentPath) VALUES(@actor,@action,@path)')
        }
        await new sql.Request(transaction).input('id', sql.UniqueIdentifier, body.id).input('actor', sql.NVarChar(128), actor.uid).input('hash', sql.Char(64), digest)
          .query('INSERT INTO app.Commits(CommitId,Actor,RequestHash) VALUES(@id,@actor,@hash)')
        await transaction.commit()
        return { ok: true, ...(invitations.length ? { invitations } : {}) }
      } catch (error) { await transaction.rollback().catch(() => {}); throw error }
    },
  }
}
