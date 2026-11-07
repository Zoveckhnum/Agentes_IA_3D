import express from 'express'
import helmet from 'helmet'
import { randomUUID } from 'node:crypto'
import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import { applicationConfig } from './config.mjs'
import { createDatabase, sql } from './db.mjs'
import { createRepository } from './repository.mjs'
import { createAuth } from './auth.mjs'
import { ApiError } from './values.mjs'
import {createPortalBridge} from './portal-bridge.mjs'
import {mountPortalTaskAssets} from './portal-task-assets.mjs'
import { createAccountSecurity } from './account-security.mjs'
import { createCentralConnector,CentralError } from './central-connector.mjs'

export function createApplication(database, config, dependencies = {}) {
  const app = express(), repository = createRepository(database, config.maxDocuments, config.ownerUid)
  const central=createCentralConnector(config.central||{enabled:false,portalId:'office'},{issueSession:(_req,res,id)=>auth.centralSession(id,res)})
  const auth = createAuth(database, config, central)
  const security = createAccountSecurity(database, config, dependencies.sendSecurityMail)
  app.disable('x-powered-by')
  app.set('trust proxy', 'loopback')
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], imgSrc: ["'self'", 'data:', 'https:'], connectSrc: ["'self'"], fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'], upgradeInsecureRequests: config.secureCookies ? [] : null } } }))
  app.use((req, res, next) => { req.requestId = randomUUID(); res.set('X-Request-Id', req.requestId); next() })
  app.get('/health', (_req, res) => res.json({ ok: true }))
  app.get('/health/db', async (_req, res) => {
    try {
      const result = await new sql.Request(await database.pool()).query("SELECT CONVERT(varchar(10),CONNECTIONPROPERTY('net_transport')) AS Transport,IS_SRVROLEMEMBER('sysadmin') AS IsSysadmin,IS_MEMBER('db_owner') AS IsOwner,HAS_PERMS_BY_NAME(DB_NAME(),'DATABASE','CREATE TABLE') AS CanCreateTable,CASE WHEN OBJECT_ID('app.Documents') IS NOT NULL AND OBJECT_ID('app.Accounts') IS NOT NULL THEN 1 ELSE 0 END AS Ready")
      if (result.recordset[0]?.Transport !== 'TCP' || !result.recordset[0]?.Ready || result.recordset[0]?.IsSysadmin || result.recordset[0]?.IsOwner || result.recordset[0]?.CanCreateTable) throw new Error('Database not ready or identity overprivileged')
      res.json({ ok: true, connectedOverTcp: true, encrypted: true, certificateValidated: true, schemaReady: true, permissionsRestricted: true })
    } catch { res.status(503).json({ ok: false }) }
  })
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  app.use('/api', (req, _res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) && !req.headers.authorization && req.headers.origin !== config.origin) return next(new ApiError(403, 'permission-denied'))
    if (req.headers.origin && req.headers.origin !== config.origin) return next(new ApiError(403, 'permission-denied'))
    next()
  })
  app.use('/api', express.json({ limit: config.maxBodyBytes, strict: true }))
  app.use('/api/integrations/portal',createPortalBridge({repository,configuration:config.portalBridgeConfiguration,officeOrigin:config.origin}))
  app.use('/api',central.router)
  app.post('/api/auth/login', async (req, res) => res.json({ user: await auth.login(req, res) }))
  app.post('/api/auth/register', async (req, res) => res.json(await auth.register(req)))
  app.use('/api', async (req, _res, next) => { try { req.actor = await auth.actor(req); next() } catch (error) { next(error) } })
  app.get('/api/auth/me', (req, res) => {
    const { tokenHash, sessionCreatedAt, ...user } = req.actor
    res.json({ user })
  })
  app.post('/api/auth/logout', async (req, res) => { await auth.logout(req.actor, res); res.json({ ok: true }) })
  app.use(['/api/auth/security/request','/api/auth/password','/api/auth/email'],(_req,_res,next)=>central.enabled?next(new ApiError(403,'auth/central-required','Administra tu acceso desde Portal iqualitys.')):next())
  app.post('/api/auth/security/request', async (req, res) => res.json(await security.request(req.actor, req.body)))
  app.post('/api/auth/password', async (req, res) => { await security.confirm(req.actor, req.body, 'password'); auth.clearSessionCookie(res); res.json({ ok: true }) })
  app.post('/api/auth/email', async (req, res) => { await security.confirm(req.actor, req.body, 'email'); auth.clearSessionCookie(res); res.json({ ok: true }) })
  app.use('/api', (req, _res, next) => req.actor.mustChangePassword ? next(new ApiError(403, 'auth/password-change-required')) : next())
  app.post('/api/data/read', async (req, res) => res.json(await repository.read(req.actor, req.body)))
  app.get('/api/worker/capabilities', (req, res, next) => req.actor.worker ? res.json({ atomicClaims: true, version: 1 }) : next(new ApiError(403, 'permission-denied')))
  app.post('/api/data/commit', async (req, res) => res.json(await repository.commit(req.actor, req.body)))
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'not-found')))
  mountPortalTaskAssets(app)
  if (config.staticRoot) {
    const root = resolve(config.staticRoot)
    if (!existsSync(join(root, 'index.html'))) throw new Error('No existe la compilación del frontend')
    app.use(express.static(root, { index: false, dotfiles: 'deny', fallthrough: true, maxAge: 0 }))
    app.get('/{*path}', (_req, res) => res.sendFile(join(root, 'index.html')))
  }
  app.use((error, req, res, _next) => {
    const status = error instanceof ApiError || error instanceof CentralError ? error.status : error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500
    if (status === 500) console.error(JSON.stringify({ event: 'request_failed', requestId: req.requestId, code: error.code || 'internal', time: new Date().toISOString() }))
    res.status(status).json({ error: { code: error instanceof ApiError ? error.code : error instanceof CentralError?'auth/central-access':'internal', message: error instanceof ApiError || error instanceof CentralError ? error.message : 'No se pudo completar la operación.', requestId: req.requestId } })
  })
  return app
}

if (import.meta.url === new URL(process.argv[1], 'file:').href || process.argv[1]?.replaceAll('\\', '/').endsWith('/server/src/main.mjs')) {
  const config = applicationConfig(), database = createDatabase()
  const app = createApplication(database, config)
  const server = app.listen(config.port, config.host, () => console.log(JSON.stringify({ event: 'api_listening', host: config.host, port: config.port })))
  const maintenance = setInterval(async () => {
    try { await new sql.Request(await database.pool()).query('DELETE TOP (10000) FROM app.Sessions WHERE ExpiresAt<SYSUTCDATETIME(); DELETE TOP (10000) FROM app.Commits WHERE CreatedAt<DATEADD(day,-30,SYSUTCDATETIME()); DELETE TOP (10000) FROM app.AuditLog WHERE CreatedAt<DATEADD(day,-90,SYSUTCDATETIME()); DELETE TOP (10000) FROM app.AccountVerifications WHERE CreatedAt<DATEADD(day,-2,SYSUTCDATETIME())') } catch { console.error(JSON.stringify({ event: 'maintenance_failed' })) }
  }, 3600e3).unref()
  let stopping = false
  const stop = () => { if (stopping) return; stopping = true; clearInterval(maintenance); const timeout = setTimeout(() => process.exit(1), 15000).unref(); server.close(async () => { await database.close().catch(() => {}); clearTimeout(timeout); process.exit(0) }) }
  process.on('SIGTERM', stop); process.on('SIGINT', stop); process.on('SIGBREAK', stop)
}
