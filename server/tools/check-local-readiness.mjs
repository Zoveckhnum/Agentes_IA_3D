import { createDatabase } from '../src/db.mjs'
const database = createDatabase()
try {
  const pool = await database.pool()
  const result = await pool.request().query(`
    SELECT CONVERT(varchar(40), SERVERPROPERTY('ProductVersion')) AS sqlVersion;
    SELECT COUNT(*) AS documents FROM app.Documents;
    SELECT COUNT(*) AS accounts,
      SUM(CASE WHEN Disabled=0 AND MustChangePassword=1 THEN 1 ELSE 0 END) AS activeAccountsRequiringPasswordChange
      FROM app.Accounts;
    SELECT DocumentCount,AccountCount FROM app.MigrationImports;
    SELECT Action,LEFT(DocumentPath,CHARINDEX('/',DocumentPath+'/')-1) AS collection,
      COUNT(*) AS operations,MIN(CreatedAt) AS firstAt,MAX(CreatedAt) AS lastAt
      FROM app.AuditLog GROUP BY Action,LEFT(DocumentPath,CHARINDEX('/',DocumentPath+'/')-1);
  `)
  const origin = process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:11090'
  const health = await fetch(`${origin}/health/db`, { signal: AbortSignal.timeout(20000) })
  const healthDetails = await health.json()
  console.log(JSON.stringify({ sql: result.recordsets[0][0], data: result.recordsets[1][0],
    auth: result.recordsets[2][0], verifiedImports: result.recordsets[3], audit: result.recordsets[4], service: healthDetails }))
  if (!health.ok || !healthDetails.ok || !healthDetails.permissionsRestricted || result.recordsets[2][0].activeAccountsRequiringPasswordChange) process.exitCode = 1
} finally { await database.close() }
