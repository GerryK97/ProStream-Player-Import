// Runtime checks of what the connected database supports, so the UI can
// explain a missing migration instead of failing on INSERT.

import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from './db'

export type Capabilities = {
  database: boolean
  sources: { cricheroes: boolean; stumps: boolean }
  error?: string
}

let cache: { at: number; value: Capabilities } | null = null

export async function getCapabilities(force = false): Promise<Capabilities> {
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.value
  let value: Capabilities
  try {
    const res = await getDb().execute(sql`
      SELECT e.enumlabel AS label
      FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'directory_source'
    `)
    const labels = new Set((res.rows as Array<{ label: string }>).map((r) => r.label))
    value = {
      database: true,
      sources: { cricheroes: labels.has('cricheroes'), stumps: labels.has('stumps') },
    }
  } catch (err) {
    value = {
      database: false,
      sources: { cricheroes: false, stumps: false },
      error: err instanceof Error ? err.message : 'Database unavailable',
    }
  }
  cache = { at: Date.now(), value }
  return value
}

export class CapabilityError extends Error {}

export async function assertSourceWritable(source: 'cricheroes' | 'stumps') {
  const caps = await getCapabilities()
  if (!caps.database) throw new CapabilityError(`Database unavailable: ${caps.error ?? 'unknown error'}`)
  if (!caps.sources[source]) {
    throw new CapabilityError(
      source === 'stumps'
        ? "The database does not accept 'stumps' as a directory source yet. Apply Scoreboard migration 0072_directory_source_stumps.sql."
        : `The database does not accept '${source}' as a directory source.`,
    )
  }
}
