import sql from 'mssql/msnodesqlv8.js'
import { databaseConfig } from './config.mjs'
export { sql }
export function createDatabase(config = databaseConfig()) {
  let pending
  return {
    async pool() {
      if (!pending) pending = new sql.ConnectionPool(config).connect().catch(error => { pending = undefined; throw error })
      return pending
    },
    async close() { const connection = pending; pending = undefined; if (connection) await (await connection).close() },
  }
}
