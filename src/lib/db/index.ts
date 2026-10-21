import { Pool } from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from './schema'

// Lazily created so `next build` (which imports route modules) does not need a
// DATABASE_URL. One pool per process, reused across dev hot reloads.
const globalForDb = globalThis as typeof globalThis & {
  playerImportPool?: Pool
  playerImportDb?: NodePgDatabase<typeof schema>
}

export function getPool(): Pool {
  if (!globalForDb.playerImportPool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is required')
    globalForDb.playerImportPool = new Pool({
      connectionString,
      application_name: 'prostream-player-import',
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    })
  }
  return globalForDb.playerImportPool
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!globalForDb.playerImportDb) {
    globalForDb.playerImportDb = drizzle(getPool(), { schema })
  }
  return globalForDb.playerImportDb
}

export type Db = NodePgDatabase<typeof schema>
/** The database or an open transaction: anything that can run queries. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0]
