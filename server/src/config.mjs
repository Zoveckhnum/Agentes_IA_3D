import {centralConfiguration} from './central-connector.mjs'
const required = (env, name) => {
  const value = env[name]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Falta ${name}`)
  return value.trim()
}
const integer = (value, name, min, max) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} fuera de rango`)
  return parsed
}
export function databaseConfig(env = process.env) {
  if (env.CORE_DB_ENCRYPT !== 'true' || env.CORE_DB_TRUSTED_CONNECTION !== 'true' || env.CORE_DB_TRUST_SERVER_CERTIFICATE !== 'false') {
    throw new Error('SQL exige identidad Windows, cifrado y validación del certificado')
  }
  const driver = required(env, 'CORE_DB_ODBC_DRIVER')
  if (driver !== 'ODBC Driver 18 for SQL Server') throw new Error('Se requiere ODBC Driver 18')
  const server = required(env, 'CORE_DB_SERVER')
  if (!/^[a-zA-Z0-9.-]+$/.test(server) || !server.includes('.')) throw new Error('SQL requiere un FQDN válido')
  const database = required(env, 'CORE_DB_NAME')
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(database)) throw new Error('Nombre de base inválido')
  const brace = value => `{${String(value).replaceAll('}', '}}')}}`
  const connectionString = [
    `Driver=${brace(driver)}`, `Server=${brace(`tcp:${server},${integer(env.CORE_DB_PORT, 'CORE_DB_PORT', 1, 65535)}`)}`,
    `Database=${brace(database)}`, 'Trusted_Connection=Yes', 'Encrypt=Yes', 'TrustServerCertificate=No',
    'ApplicationIntent=ReadWrite', 'APP={Stackbi Office}',
  ].join(';') + ';'
  return { connectionString, connectionTimeout: 10000, requestTimeout: 15000, pool: { min: 0, max: 3, idleTimeoutMillis: 30000 } }
}
export function applicationConfig(env = process.env) {
  const origin = new URL(required(env, 'PUBLIC_ORIGIN'))
  const localHttp = env.ALLOW_LOCAL_HTTP === 'true' && ['127.0.0.1', 'localhost'].includes(origin.hostname)
  if (origin.protocol !== 'https:' && !localHttp) throw new Error('PUBLIC_ORIGIN requiere HTTPS')
  const workerToken = required(env, 'WORKER_API_TOKEN')
  if (workerToken.length < 48) throw new Error('WORKER_API_TOKEN requiere al menos 48 caracteres aleatorios')
  return {
    origin: origin.origin, secureCookies: !localHttp, host: '127.0.0.1',
    central: centralConfiguration(env,'office',origin.origin),
    port: integer(env.PORT ?? 10011, 'PORT', 1024, 65535), workerToken,
    workerUid: required(env, 'WORKER_UID'), workerEmail: required(env, 'WORKER_EMAIL').toLowerCase(),
    ownerUid: required(env, 'APP_OWNER_UID'),
    maxDocuments: 5000, maxBodyBytes: 2 * 1024 * 1024,
    staticRoot: env.APP_STATIC_ROOT || '',
    securityCodeSecret: env.APP_SECURITY_CODE_SECRET || '',
    ownerEmailRecovery: env.APP_OWNER_EMAIL_RECOVERY ? JSON.parse(env.APP_OWNER_EMAIL_RECOVERY) : null,
    securityMail: { apiKey: env.APP_BREVO_API_KEY || '', sender: env.APP_MAIL_SENDER || '', senderName: env.APP_MAIL_SENDER_NAME || 'Stackbi Office' },
  }
}
