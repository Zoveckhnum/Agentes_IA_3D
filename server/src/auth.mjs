import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto'
import { sql } from './db.mjs'
import { ApiError } from './values.mjs'
import { passwordDigest, verifyPassword } from './passwords.mjs'
const sha = value => createHash('sha256').update(value).digest('hex')
const publicUser = a => ({ uid: a.Uid, email: a.Email, emailVerified: !!a.EmailVerified, displayName: a.DisplayName || '', photoURL: a.PhotoUrl || '', mustChangePassword: !!a.MustChangePassword })
export function createAuth(database, config, central) {
  const cookieName = config.secureCookies ? '__Host-agentes3d' : 'agentes3d_local'
  const cookieOptions = { httpOnly: true, secure: config.secureCookies, sameSite: 'strict', path: '/' }
  const dummy = passwordDigest(randomBytes(24).toString('hex'))
  const attempts = new Map()
  let runningChecks = 0
  return {
    async register(req) {
      if(central?.enabled)throw new ApiError(403,'auth/central-required','Administra tu acceso desde Portal iqualitys.')
      const { email, token, password } = req.body || {}
      if (typeof email !== 'string' || email.length > 320 || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token) || typeof password !== 'string' || password.length < 12 || password.length > 256) throw new ApiError(400, 'invalid-argument')
      if (runningChecks >= 4) throw new ApiError(429, 'auth/too-many-requests')
      const key = `register:${req.ip}`, now = Date.now()
      for (const [k, entry] of attempts) if (entry.until < now) attempts.delete(k)
      const attempt = attempts.get(key) || { count: 0, until: now + 10 * 60e3 }
      if (attempt.count >= 20 || attempts.size > 10000) throw new ApiError(429, 'auth/too-many-requests')
      attempt.count++; attempts.set(key, attempt); runningChecks++
      let tx
      try {
        tx = new sql.Transaction(await database.pool()); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
        const normalized = email.trim().toLowerCase()
        const invite = await new sql.Request(tx).input('email', sql.NVarChar(320), normalized).input('hash', sql.Char(64), sha(token)).query('SELECT Role FROM app.InvitationTokens WITH(UPDLOCK,HOLDLOCK) WHERE Email=@email AND TokenHash=@hash AND ExpiresAt>SYSUTCDATETIME()')
        if (!invite.recordset[0]) throw new ApiError(400, 'auth/invalid-invitation', 'La invitación no es válida o ya venció.')
        const present = await new sql.Request(tx).input('email', sql.NVarChar(320), normalized).query('SELECT Uid FROM app.Accounts WHERE EmailNormalized=@email')
        if (present.recordset.length) throw new ApiError(409, 'auth/account-exists', 'La cuenta ya existe; inicia sesión.')
        const uid = randomUUID(), digest = await passwordDigest(password)
        await new sql.Request(tx).input('uid', sql.NVarChar(128), uid).input('email', sql.NVarChar(320), normalized).input('digest', sql.VarChar(300), digest)
          .query('INSERT INTO app.Accounts(Uid,Email,PasswordDigest,MustChangePassword) VALUES(@uid,@email,@digest,0)')
        const profile = { email: normalized, name: normalized.split('@')[0], role: invite.recordset[0].Role, createdAt: { $type: 'timestamp', seconds: Math.floor(now / 1000), nanoseconds: 0 } }
        await new sql.Request(tx).input('path', sql.NVarChar(450), `users/${uid}`).input('uid', sql.NVarChar(200), uid).input('payload', sql.NVarChar(sql.MAX), JSON.stringify(profile)).input('email', sql.NVarChar(320), normalized).input('invite', sql.NVarChar(450), `invites/${normalized}`)
          .query("INSERT INTO app.Documents(Path,CollectionPath,DocumentId,Payload) VALUES(@path,N'users',@uid,@payload); DELETE FROM app.InvitationTokens WHERE Email=@email; DELETE FROM app.Documents WHERE Path=@invite;")
        await new sql.Request(tx).input('uid', sql.NVarChar(128), uid).input('path', sql.NVarChar(450), `users/${uid}`).query("INSERT INTO app.AuditLog(Actor,Action,DocumentPath) VALUES(@uid,'register',@path)")
        await tx.commit()
        return { ok: true }
      } catch (error) { await tx?.rollback().catch(() => {}); throw error } finally { runningChecks-- }
    },
    async actor(req) {
      if (req.headers.authorization) {
        const expected = `Bearer ${config.workerToken}`, actual = String(req.headers.authorization)
        if (Buffer.byteLength(actual) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw new ApiError(401, 'unauthenticated')
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) throw new ApiError(401, 'unauthenticated')
        return { uid: config.workerUid, email: config.workerEmail, worker: true }
      }
      const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(v => v.trim().split('=')))
      const token = cookies[cookieName]
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401, 'unauthenticated')
      const result = await new sql.Request(await database.pool()).input('token', sql.Char(64), sha(token)).query('SELECT a.*,s.CreatedAt AS SessionCreatedAt FROM app.Sessions s JOIN app.Accounts a ON a.Uid=s.Uid AND a.CredentialVersion=s.CredentialVersion WHERE s.TokenHash=@token AND s.ExpiresAt>SYSUTCDATETIME() AND a.Disabled=0')
      const account = result.recordset[0]
      if (!account) throw new ApiError(401, 'unauthenticated')
      await central?.validate(req,account.Uid,sha(token))
      return { ...publicUser(account), tokenHash: sha(token), sessionCreatedAt: account.SessionCreatedAt }
    },
    async login(req, res, authorizeAccount) {
      if(central?.enabled)throw new ApiError(403,'auth/central-required','Inicia sesión desde Portal iqualitys.')
      const { email, password, remember = false } = req.body || {}
      if (typeof email !== 'string' || email.length > 320 || typeof password !== 'string' || password.length > 1024) throw new ApiError(400, 'invalid-argument')
      const key = `${req.ip}:${sha(email.toLowerCase())}`, now = Date.now()
      for (const [k, entry] of attempts) if (entry.until < now) attempts.delete(k)
      const previous = attempts.get(key) || { count: 0, until: now + 10 * 60e3 }
      if (previous.count >= 8 || attempts.size > 10000 || runningChecks >= 4) throw new ApiError(429, 'auth/too-many-requests')
      previous.count++; attempts.set(key, previous); runningChecks++
      try {
        const pool = await database.pool()
        const result = await new sql.Request(pool).input('email', sql.NVarChar(320), email.trim().toLowerCase()).query('SELECT * FROM app.Accounts WHERE EmailNormalized=@email')
        const account = result.recordset[0]
        const valid = await verifyPassword(password, account?.PasswordDigest || await dummy)
        if (!valid || !account || account.Disabled || (account.LockedUntil && new Date(account.LockedUntil) > new Date())) {
          if (account) await new sql.Request(pool).input('uid', sql.NVarChar(128), account.Uid).query('UPDATE app.Accounts SET FailedLogins=FailedLogins+1,LockedUntil=CASE WHEN FailedLogins>=7 THEN DATEADD(minute,10,SYSUTCDATETIME()) ELSE LockedUntil END WHERE Uid=@uid')
          throw new ApiError(401, 'auth/invalid-credential')
        }
        if(authorizeAccount)await authorizeAccount(account)
        const token = randomBytes(32).toString('base64url'), expires = new Date(now + (remember ? 7 * 86400e3 : 8 * 3600e3))
        await new sql.Request(pool).input('uid', sql.NVarChar(128), account.Uid).input('hash', sql.Char(64), sha(token)).input('version', sql.Int, account.CredentialVersion).input('expires', sql.DateTime2, expires)
          .query('UPDATE app.Accounts SET FailedLogins=0,LockedUntil=NULL WHERE Uid=@uid; INSERT INTO app.Sessions(TokenHash,Uid,CredentialVersion,ExpiresAt) VALUES(@hash,@uid,@version,@expires)')
        res.cookie(cookieName, token, { ...cookieOptions, ...(remember ? { maxAge: 7 * 86400e3 } : {}) })
        attempts.delete(key)
        return publicUser(account)
      } finally { runningChecks-- }
    },
    async logout(actor, res) {
      if (!actor.worker) await new sql.Request(await database.pool()).input('hash', sql.Char(64), actor.tokenHash).query('DELETE FROM app.Sessions WHERE TokenHash=@hash')
      res.clearCookie(cookieName, cookieOptions)
      central?.clear(res)
    },
    async centralSession(uid,res) {
      const pool=await database.pool()
      const account=(await new sql.Request(pool).input('uid',sql.NVarChar(128),uid).query('SELECT * FROM app.Accounts WHERE Uid=@uid AND Disabled=0')).recordset[0]
      if(!account||account.MustChangePassword||(account.LockedUntil&&new Date(account.LockedUntil)>new Date()))throw new ApiError(403,'auth/account-not-ready','La cuenta vinculada requiere revisión del administrador.')
      const token=randomBytes(32).toString('base64url'),expiresAt=Date.now()+8*3600e3
      await new sql.Request(pool).input('uid',sql.NVarChar(128),account.Uid).input('hash',sql.Char(64),sha(token)).input('version',sql.Int,account.CredentialVersion).input('expires',sql.DateTime2,new Date(expiresAt)).query('INSERT INTO app.Sessions(TokenHash,Uid,CredentialVersion,ExpiresAt) VALUES(@hash,@uid,@version,@expires)')
      res.cookie(cookieName,token,{...cookieOptions,maxAge:8*3600e3})
      return{localId:account.Uid,tokenHash:sha(token),expiresAt}
    },
    clearSessionCookie(res) { res.clearCookie(cookieName, cookieOptions) },

  }
}
