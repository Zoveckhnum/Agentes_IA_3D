import { randomInt, randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import { sql } from './db.mjs'
import { ApiError } from './values.mjs'
import { passwordDigest, verifyPassword } from './passwords.mjs'
import { createSecurityMailer } from './security-mail.mjs'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const invalid = () => new ApiError(400, 'auth/invalid-code', 'El código no es válido, venció o agotó sus intentos. Solicita uno nuevo.')
export function approvedDemoRecovery(config, account, target, now = Date.now()) {
  const approval = config.ownerEmailRecovery
  return !!approval && account.Uid === config.ownerUid && account.EmailVerified === false
    && /^[^\s@]+@[^\s@]+\.local$/i.test(account.Email)
    && account.Email.toLowerCase() === approval.sourceEmail
    && target === approval.targetEmail && emailPattern.test(target) && !target.toLowerCase().endsWith('.local')
    && account.CredentialVersion === approval.credentialVersion
    && new Date(approval.expiresAt).getTime() > now
}
export function createAccountSecurity(database, config, sendMail = createSecurityMailer(config.securityMail)) {
  const hash = (id, scope, code) => createHmac('sha256', config.securityCodeSecret).update(`${id}:${scope}:${code}`).digest('hex')
  const ready = actor => {
    if (actor.worker) throw new ApiError(403, 'permission-denied')
    if (!config.securityCodeSecret || config.securityCodeSecret.length < 32) throw new ApiError(503, 'auth/mail-unavailable', 'La verificación por correo no está configurada.')
  }
  // Limits also protect scrypt and the provider before a SQL verification is created.
  const requests = new Map()
  let checks = 0
  function limit(actor) {
    const now = Date.now()
    for (const [key, value] of requests) if (value.until < now) requests.delete(key)
    const entry = requests.get(actor.uid) || { count: 0, until: now + 15 * 60e3 }
    if (entry.count >= 10 || checks >= 4 || requests.size >= 10000) throw new ApiError(429, 'auth/too-many-requests', 'Espera unos minutos antes de volver a intentarlo.')
    entry.count++; requests.set(actor.uid, entry)
  }
  async function begin(actor) {
    const tx = new sql.Transaction(await database.pool())
    await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE)
    try {
      await new sql.Request(tx).input('resource', sql.NVarChar(255), `account-security:${actor.uid}`).query("DECLARE @r int; EXEC @r=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000; IF @r<0 THROW 50001,'Account verification busy',1;")
      const result = await new sql.Request(tx).input('uid', sql.NVarChar(128), actor.uid).input('token', sql.Char(64), actor.tokenHash).query('SELECT a.* FROM app.Accounts a WITH(UPDLOCK,HOLDLOCK) JOIN app.Sessions s ON s.Uid=a.Uid AND s.CredentialVersion=a.CredentialVersion WHERE a.Uid=@uid AND a.Disabled=0 AND s.TokenHash=@token AND s.ExpiresAt>SYSUTCDATETIME()')
      if (!result.recordset[0]) throw new ApiError(401, 'unauthenticated')
      return { tx, account: result.recordset[0] }
    } catch (error) { await tx.rollback().catch(() => {}); throw error }
  }
  return {
    async request(actor, body) {
      ready(actor); limit(actor)
      const purpose = body?.purpose, currentPassword = body?.currentPassword
      if (!['email', 'password'].includes(purpose) || typeof currentPassword !== 'string' || currentPassword.length > 256) throw new ApiError(400, 'invalid-argument')
      if (actor.mustChangePassword && purpose !== 'password') throw new ApiError(403, 'auth/password-change-required')
      const target = purpose === 'email' && typeof body.email === 'string' ? body.email.trim().toLowerCase() : actor.email
      if (typeof target !== 'string' || target.length > 320 || !emailPattern.test(target) || (purpose === 'email' && target === actor.email.toLowerCase())) throw new ApiError(400, 'invalid-argument', 'Ingresa un correo nuevo válido.')
      checks++
      let state
      const id = randomUUID(), code = String(randomInt(0, 100000000)).padStart(8, '0'), currentCode = String(randomInt(0, 100000000)).padStart(8, '0')
      try {
        state = await begin(actor)
        const { tx, account } = state
        if (!await verifyPassword(currentPassword, account.PasswordDigest)) throw new ApiError(401, 'auth/invalid-credential', 'La contraseña actual no es correcta.')
        const recovery = purpose === 'email' && approvedDemoRecovery(config, account, target)
        if (account.Email.toLowerCase().endsWith('.local') && !recovery) throw new ApiError(409, 'auth/demo-email', 'Esta cuenta de prueba necesita cambiar primero su correo de acceso a la dirección real autorizada por el administrador.')
        const requiresCurrentCode = purpose === 'email' && !recovery
        const recent = await new sql.Request(tx).input('uid', sql.NVarChar(128), actor.uid).query('SELECT COUNT(*) AS Total, MAX(CreatedAt) AS Latest FROM app.AccountVerifications WHERE Uid=@uid AND CreatedAt>DATEADD(minute,-15,SYSUTCDATETIME())')
        if (recent.recordset[0].Total >= 5 || (recent.recordset[0].Latest && Date.now() - new Date(recent.recordset[0].Latest).getTime() < 60000)) throw new ApiError(429, 'auth/too-many-requests', 'Espera al menos un minuto antes de solicitar otro código.')
        if (purpose === 'email') {
          const existing = await new sql.Request(tx).input('email', sql.NVarChar(320), target).query('SELECT Uid FROM app.Accounts WHERE EmailNormalized=@email')
          if (existing.recordset.length) throw new ApiError(409, 'auth/email-unavailable', 'No se puede utilizar ese correo para esta cuenta.')
        }
        await new sql.Request(tx).input('uid', sql.NVarChar(128), actor.uid).query('UPDATE app.AccountVerifications SET Used=1 WHERE Uid=@uid AND Used=0')
        await new sql.Request(tx).input('id', sql.UniqueIdentifier, id).input('uid', sql.NVarChar(128), actor.uid).input('purpose', sql.VarChar(16), purpose).input('email', sql.NVarChar(320), target).input('version', sql.Int, account.CredentialVersion).input('hash', sql.Char(64), hash(id, 'target', code)).input('currentHash', sql.Char(64), requiresCurrentCode ? hash(id, 'current', currentCode) : null)
          .query('INSERT INTO app.AccountVerifications(Id,Uid,Purpose,TargetEmail,CredentialVersion,CodeHash,CurrentCodeHash,ExpiresAt) VALUES(@id,@uid,@purpose,@email,@version,@hash,@currentHash,DATEADD(minute,10,SYSUTCDATETIME()))')
        await tx.commit(); state = null
        // Activate only when every required email has been accepted by Brevo.
        if (requiresCurrentCode) await sendMail({ to: account.Email, purpose: 'email-current', code: currentCode })
        await sendMail({ to: target, purpose, code })
        await new sql.Request(await database.pool()).input('id', sql.UniqueIdentifier, id).query('UPDATE app.AccountVerifications SET Sent=1 WHERE Id=@id AND Used=0')
        return { id, purpose, expiresIn: 600, requiresCurrentCode, destination: target }
      } catch (error) { await state?.tx.rollback().catch(() => {}); throw error } finally { checks-- }
    },
    async confirm(actor, body, purpose) {
      ready(actor)
      if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(body?.id || '') || typeof body?.code !== 'string' || !/^\d{8}$/.test(body.code)) throw invalid()
      if (purpose === 'email' && actor.mustChangePassword) throw new ApiError(403, 'auth/password-change-required')
      if (purpose === 'password' && (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 256 || body.password.toLowerCase().includes('solo-emulador'))) throw new ApiError(400, 'auth/weak-password', 'Usa una contraseña nueva de al menos 12 caracteres.')
      let state
      try {
        state = await begin(actor)
        const { tx, account } = state
        const result = await new sql.Request(tx).input('id', sql.UniqueIdentifier, body.id).input('uid', sql.NVarChar(128), actor.uid).input('purpose', sql.VarChar(16), purpose).input('version', sql.Int, account.CredentialVersion)
          .query('SELECT * FROM app.AccountVerifications WITH(UPDLOCK,HOLDLOCK) WHERE Id=@id AND Uid=@uid AND Purpose=@purpose AND CredentialVersion=@version AND Used=0 AND Sent=1 AND Attempts<5 AND ExpiresAt>SYSUTCDATETIME()')
        const challenge = result.recordset[0]
        if (!challenge) throw invalid()
        const matches = (scope, input, expected) => timingSafeEqual(Buffer.from(hash(body.id.toLowerCase(), scope, input), 'hex'), Buffer.from(expected, 'hex'))
        const targetOk = matches('target', body.code, challenge.CodeHash)
        const recovery = purpose === 'email' && challenge.CurrentCodeHash === null && approvedDemoRecovery(config, account, challenge.TargetEmail)
        const currentOk = purpose !== 'email' || recovery || (challenge.CurrentCodeHash && typeof body.currentCode === 'string' && /^\d{8}$/.test(body.currentCode) && matches('current', body.currentCode, challenge.CurrentCodeHash))
        if (!targetOk || !currentOk) {
          await new sql.Request(tx).input('id', sql.UniqueIdentifier, body.id).query('UPDATE app.AccountVerifications SET Attempts=Attempts+1 WHERE Id=@id')
          await tx.commit(); state = null; throw invalid()
        }
        if (purpose === 'email') {
          const existing = await new sql.Request(tx).input('email', sql.NVarChar(320), challenge.TargetEmail).query('SELECT Uid FROM app.Accounts WHERE EmailNormalized=@email')
          if (existing.recordset.length) throw new ApiError(409, 'auth/email-unavailable', 'Ese correo ya no está disponible. Solicita un cambio con otro correo.')
          await new sql.Request(tx).input('uid', sql.NVarChar(128), actor.uid).input('email', sql.NVarChar(320), challenge.TargetEmail).input('old', sql.NVarChar(320), account.Email).input('path', sql.NVarChar(450), `users/${actor.uid}`)
            .query("UPDATE app.Accounts SET Email=@email,EmailVerified=1,CredentialVersion=CredentialVersion+1 WHERE Uid=@uid; UPDATE app.Documents SET Payload=JSON_MODIFY(Payload,'$.email',@email),UpdatedAt=SYSUTCDATETIME() WHERE Path=@path; UPDATE app.Documents SET Payload=JSON_MODIFY(Payload,'$.createdBy',@email),UpdatedAt=SYSUTCDATETIME() WHERE CollectionPath=N'tasks' AND JSON_VALUE(Payload,'$.createdBy')=@old;")
        } else {
          const digest = await passwordDigest(body.password)
          if (await verifyPassword(body.password, account.PasswordDigest)) throw new ApiError(400, 'auth/weak-password', 'Elige una contraseña distinta de la actual.')
          await new sql.Request(tx).input('uid', sql.NVarChar(128), actor.uid).input('digest', sql.VarChar(300), digest).query('UPDATE app.Accounts SET PasswordDigest=@digest,EmailVerified=1,MustChangePassword=0,CredentialVersion=CredentialVersion+1,FailedLogins=0,LockedUntil=NULL WHERE Uid=@uid')
        }
        await new sql.Request(tx).input('uid', sql.NVarChar(128), actor.uid).input('action', sql.VarChar(32), purpose === 'email' ? 'email-changed-verified' : 'password-changed-verified').input('path', sql.NVarChar(450), `users/${actor.uid}`)
          .query('UPDATE app.AccountVerifications SET Used=1 WHERE Uid=@uid; DELETE FROM app.Sessions WHERE Uid=@uid; INSERT INTO app.AuditLog(Actor,Action,DocumentPath) VALUES(@uid,@action,@path)')
        await tx.commit(); state = null
        return { ok: true }
      } catch (error) { await state?.tx.rollback().catch(() => {}); throw error }
    },
  }
}
