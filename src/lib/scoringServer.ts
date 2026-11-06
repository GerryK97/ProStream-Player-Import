// Write a person's scored matches into the Scoreboard's scored_match_imports
// table (migration 0088), and read back what a profile already has.
//
// Idempotent: rows upsert on (directory_player_id, source, external_match_id),
// so re-importing refreshes in place. After each write, matches that also
// exist from the other source are marked duplicate_of_id (hidden on the
// Scoreboard). The profile's updated_at is bumped so the app's ETag changes.

import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { getDb } from './db'
import { playerDirectory, scoredMatchImports } from './db/schema'
import { memo } from './cache'
import * as stumps from './sources/stumps'
import { stumpsProfileUrl } from './normalize'
import { crossSourceDuplicates, stumpsScoringPreview, utcTimestampText, type ScoringPreview } from './scoring'
import type { SessionUser } from './auth'

export type ScorerSource = 'stumps'

export type ScorerFetch = {
  source: ScorerSource
  externalId: string
  /** STUMPS user-facing id, e.g. fore5474. */
  handle: string | null
  name: string
  profileUrl: string
  matchQuality: 'exact-pid' | 'best-effort' | 'key'
  preview: ScoringPreview
}

export type ExistingRecord = { source: string; matches: number; duplicates: number; tournaments: number; firstAt: string | null; lastAt: string | null }

export type ScoringImportResult = {
  playerDirectoryId: number
  publicCode: string | null
  upserted: number
  inserted: number
  duplicates: number
  record: ExistingRecord[]
}

/** Fetch a STUMPS person's scored matches. Cached briefly so preview then import does not hit STUMPS twice. */
export async function fetchScorer(source: ScorerSource, ref: string): Promise<ScorerFetch & { raw: Awaited<ReturnType<typeof stumps.fetchScorer>> }> {
  if (source !== 'stumps') throw new Error('Scoring records can only be imported from STUMPS for now')
  const raw = await memo(`scorer:stumps:${ref.trim()}`, 5 * 60_000, () => stumps.fetchScorer(ref.trim()))
  const o = raw.overview
  return {
    source,
    externalId: raw.uk,
    handle: o.pid ? String(o.pid) : null,
    name: String(o.un ?? raw.hit?.un ?? 'Unknown').trim().replace(/\b\w/g, (c) => c.toUpperCase()),
    profileUrl: stumpsProfileUrl(raw.uk),
    matchQuality: raw.match,
    preview: stumpsScoringPreview(raw),
    raw,
  }
}

/** What a profile's scoring record already holds, per source. */
export async function existingRecord(playerDirectoryId: number): Promise<ExistingRecord[]> {
  const res = await getDb().execute(sql`
    select source, count(*)::int as matches,
           count(*) filter (where duplicate_of_id is not null)::int as duplicates,
           count(distinct tournament_name)::int as tournaments,
           to_char(min(played_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "firstAt",
           to_char(max(played_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "lastAt"
    from scored_match_imports where directory_player_id = ${playerDirectoryId}
    group by source order by source`)
  return res.rows as ExistingRecord[]
}

/** Import every recordable match from a fetched scorer into one ProStream profile. */
export async function importScoredMatches(fetched: ScorerFetch & { raw: { matches: Array<Record<string, unknown>> } }, playerDirectoryId: number, user: SessionUser): Promise<ScoringImportResult> {
  const db = getDb()
  const [profile] = await db.select({ id: playerDirectory.id, publicCode: playerDirectory.publicCode })
    .from(playerDirectory).where(eq(playerDirectory.id, playerDirectoryId)).limit(1)
  if (!profile) throw new Error(`ProStream profile #${playerDirectoryId} not found`)

  const rawByKey = new Map(fetched.raw.matches.map((m) => [String(m.mk), m]))
  const rows = fetched.preview.matches
  let inserted = 0
  let duplicates = 0

  await db.transaction(async (tx) => {
    for (const m of rows) {
      const values = {
        directoryPlayerId: playerDirectoryId,
        source: m.source,
        externalMatchId: m.externalMatchId,
        externalTournamentId: m.externalTournamentId,
        tournamentName: m.tournamentName,
        matchLabel: m.matchLabel,
        format: m.format,
        venue: m.venue,
        // UTC wall-clock text: the column is timestamp without time zone holding UTC.
        playedAt: sql`${utcTimestampText(m.playedAt)}::timestamp`,
        teamA: m.teamA,
        teamAScore: m.teamAScore,
        teamB: m.teamB,
        teamBScore: m.teamBScore,
        result: m.result,
        completed: m.completed,
        raw: { sourceUrl: fetched.profileUrl, handle: fetched.handle, match: rawByKey.get(m.externalMatchId) ?? null, tool: 'prostream-player-import' },
        importedBy: user.id,
      }
      const [row] = await tx.insert(scoredMatchImports).values(values)
        .onConflictDoUpdate({
          target: [scoredMatchImports.directoryPlayerId, scoredMatchImports.source, scoredMatchImports.externalMatchId],
          set: { ...values, importedBy: sql`${scoredMatchImports.importedBy}`, updatedAt: new Date() },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` })
      if (row?.inserted) inserted++
    }

    // Recompute cross-source duplicates for this profile: earliest import wins.
    const existing = await tx.execute(sql`
      select id, source, to_char(played_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "playedAt", team_a as "teamA", team_b as "teamB"
      from scored_match_imports where directory_player_id = ${playerDirectoryId} order by imported_at, id`)
    const list = existing.rows as Array<{ id: number; source: string; playedAt: string | null; teamA: string; teamB: string }>
    await tx.update(scoredMatchImports).set({ duplicateOfId: null }).where(eq(scoredMatchImports.directoryPlayerId, playerDirectoryId))
    for (const [i, first] of crossSourceDuplicates(list)) {
      await tx.update(scoredMatchImports).set({ duplicateOfId: list[first].id })
        .where(and(eq(scoredMatchImports.id, list[i].id), eq(scoredMatchImports.directoryPlayerId, playerDirectoryId)))
      duplicates++
    }
    await tx.update(playerDirectory).set({ updatedAt: new Date() }).where(eq(playerDirectory.id, playerDirectoryId))
  })

  return {
    playerDirectoryId,
    publicCode: profile.publicCode,
    upserted: rows.length,
    inserted,
    duplicates,
    record: await existingRecord(playerDirectoryId),
  }
}
