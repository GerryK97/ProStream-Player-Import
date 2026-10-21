// Read-side helpers over ProStream's player directory: find candidate profiles
// to enrich, and describe a profile for the side-by-side review screen.

import 'server-only'
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm'
import { getDb } from './db'
import { directoryMemberships, playerDirectory, teamDirectory } from './db/schema'

export type DirectoryProfile = {
  id: number
  name: string
  displayName: string
  publicCode: string | null
  cityName: string | null
  dob: string | null
  role: string | null
  battingStyle: string | null
  bowlingStyle: string | null
  jerseyNumber: number | null
  statement: string | null
  source: string
  externalId: string | null
  hasStats: boolean
  statsSource: string | null
  hasLogin: boolean
  isStub: boolean
  importedAt: string | null
  updatedAt: string
  teams: string[]
}

const columns = {
  id: playerDirectory.id,
  name: playerDirectory.name,
  displayName: playerDirectory.displayName,
  publicCode: playerDirectory.publicCode,
  cityName: playerDirectory.cityName,
  dob: playerDirectory.dob,
  role: playerDirectory.role,
  battingStyle: playerDirectory.battingStyle,
  bowlingStyle: playerDirectory.bowlingStyle,
  jerseyNumber: playerDirectory.jerseyNumber,
  statement: playerDirectory.statement,
  source: playerDirectory.source,
  externalId: playerDirectory.externalId,
  statsSource: sql<string | null>`${playerDirectory.careerStatsImported}->>'source'`,
  hasStats: sql<boolean>`${playerDirectory.careerStatsImported} IS NOT NULL`,
  hasLogin: sql<boolean>`${playerDirectory.userId} IS NOT NULL`,
  isStub: playerDirectory.isStub,
  importedAt: playerDirectory.importedAt,
  updatedAt: playerDirectory.updatedAt,
}

type Row = {
  [K in keyof typeof columns]: unknown
}

async function decorate(rows: Row[]): Promise<DirectoryProfile[]> {
  if (!rows.length) return []
  const ids = rows.map((r) => Number(r.id))
  const db = getDb()
  const teams = await db
    .select({ playerId: directoryMemberships.playerDirectoryId, name: teamDirectory.name })
    .from(directoryMemberships)
    .innerJoin(teamDirectory, eq(teamDirectory.id, directoryMemberships.teamDirectoryId))
    .where(inArray(directoryMemberships.playerDirectoryId, ids))
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    displayName: String(r.displayName),
    publicCode: (r.publicCode as string) ?? null,
    cityName: (r.cityName as string) ?? null,
    dob: (r.dob as string) ?? null,
    role: (r.role as string) ?? null,
    battingStyle: (r.battingStyle as string) ?? null,
    bowlingStyle: (r.bowlingStyle as string) ?? null,
    jerseyNumber: (r.jerseyNumber as number) ?? null,
    statement: (r.statement as string) ?? null,
    source: String(r.source),
    externalId: (r.externalId as string) ?? null,
    hasStats: Boolean(r.hasStats),
    statsSource: (r.statsSource as string) ?? null,
    hasLogin: Boolean(r.hasLogin),
    isStub: Boolean(r.isStub),
    importedAt: r.importedAt ? new Date(r.importedAt as string).toISOString() : null,
    updatedAt: new Date(r.updatedAt as string).toISOString(),
    teams: teams.filter((t) => t.playerId === Number(r.id)).map((t) => t.name).slice(0, 6),
  }))
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** Search ProStream profiles by name, display name, public code, city or id. */
export async function searchDirectory(q: string, limit = 20): Promise<DirectoryProfile[]> {
  const db = getDb()
  const term = q.trim()
  const conds = []
  if (term) {
    const like = `%${escapeLike(term)}%`
    const ors = [
      ilike(playerDirectory.name, like),
      ilike(playerDirectory.displayName, like),
      ilike(playerDirectory.cityName, like),
      eq(playerDirectory.publicCode, term.toUpperCase()),
    ]
    if (/^#?\d+$/.test(term)) ors.push(eq(playerDirectory.id, Number(term.replace('#', ''))))
    conds.push(or(...ors))
  }
  const rows = await db
    .select(columns)
    .from(playerDirectory)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(playerDirectory.updatedAt))
    .limit(Math.min(limit, 50))
  return decorate(rows as Row[])
}

/**
 * Likely ProStream matches for a scraped player: the profile already linked to
 * this external identity first, then name matches ranked by how many name
 * tokens they share.
 */
export async function suggestMatches(name: string, source: string, externalId: string): Promise<{ linked: DirectoryProfile | null; candidates: DirectoryProfile[] }> {
  const db = getDb()
  const [linkedRow] = await db
    .select(columns)
    .from(playerDirectory)
    .where(and(sql`${playerDirectory.source}::text = ${source}`, eq(playerDirectory.externalId, externalId)))
    .limit(1)

  const tokens = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .slice(0, 4)
  let rows: Row[] = []
  if (tokens.length) {
    const tokenConds = tokens.map((t) => or(ilike(playerDirectory.name, `%${escapeLike(t)}%`), ilike(playerDirectory.displayName, `%${escapeLike(t)}%`)))
    const score = sql<number>`(${sql.join(
      tokens.map((t) => sql`CASE WHEN ${playerDirectory.name} ILIKE ${`%${escapeLike(t)}%`} OR ${playerDirectory.displayName} ILIKE ${`%${escapeLike(t)}%`} THEN 1 ELSE 0 END`),
      sql` + `,
    )})`
    rows = (await db
      .select(columns)
      .from(playerDirectory)
      .where(or(...tokenConds))
      .orderBy(desc(score), desc(playerDirectory.updatedAt))
      .limit(8)) as Row[]
  }
  const [linked] = linkedRow ? await decorate([linkedRow as Row]) : [null]
  const candidates = (await decorate(rows)).filter((c) => c.id !== linked?.id)
  return { linked: linked ?? null, candidates }
}

export async function getProfile(id: number): Promise<DirectoryProfile | null> {
  const rows = await getDb().select(columns).from(playerDirectory).where(eq(playerDirectory.id, id)).limit(1)
  const [p] = await decorate(rows as Row[])
  return p ?? null
}

export async function recentImports(limit = 25): Promise<DirectoryProfile[]> {
  const rows = await getDb()
    .select(columns)
    .from(playerDirectory)
    .where(sql`${playerDirectory.importedAt} IS NOT NULL AND ${playerDirectory.source}::text IN ('cricheroes', 'stumps')`)
    .orderBy(desc(playerDirectory.importedAt))
    .limit(limit)
  return decorate(rows as Row[])
}
