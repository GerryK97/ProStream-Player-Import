// Scoring record: matches a person scored on another platform, written to the
// Scoreboard's scored_match_imports table (Scoreboard migration 0088). Pure
// functions, unit tested against the live STUMPS payload shape.
//
// The Scoreboard reads the same rows (src/lib/directory/scoringRecord.ts there)
// and shows them on /scorers/<publicCode>. Rules must stay in step:
//   • completed matches only (started, with a result or a score)
//   • a stage-like "venue" ("Final", "Match 20") is the match label
//   • stored in UTC, keyed on (player, source, source match id)
//   • the same match from two sources (same UTC day, same two teams) is a duplicate
//
// A summary only: imported scorecards never reach stats or leaderboards.

import { STUMPS_FORMAT } from './normalize'
import type { StumpsRow } from './sources/stumps'

export type ScoredMatch = {
  source: 'stumps' | 'cricheroes'
  externalMatchId: string
  externalTournamentId: string | null
  tournamentName: string | null
  matchLabel: string | null
  format: string | null
  venue: string | null
  playedAt: string | null
  teamA: string
  teamAScore: string | null
  teamB: string
  teamBScore: string | null
  result: string | null
  completed: boolean
}

export type ScoredTournament = { key: string; name: string; matches: number; firstAt: string | null; lastAt: string | null }

export type ScoringPreview = {
  /** All matches the source lists for this person, before filtering. */
  listed: number
  /** Completed matches that go on the record. */
  matches: ScoredMatch[]
  tournaments: ScoredTournament[]
  /** Source tournaments with no completed match in the list (shown, not imported). */
  emptyTournaments: string[]
  firstAt: string | null
  lastAt: string | null
  /** The source's own count of matches this person scored, when it has one (STUMPS award a5). */
  sourceScoredCount: number | null
}

const nn = (v: unknown): string | null => {
  if (v == null) return null
  const t = String(v).trim()
  return t.length ? t : null
}

function iso(v: unknown): string | null {
  const s = nn(v)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Title-case lower-case team names ("power hitters" -> "Power Hitters"). Mixed case is kept. */
export function tidyTeamName(name: string): string {
  const t = name.trim().replace(/\s+/g, ' ')
  if (t !== t.toLowerCase()) return t
  return t.replace(/(^|[\s(/-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
}

const STAGE = /^(final|semi|qualifier|eliminator|match\s*\d+|quarter|league|group|play-?off)/i

/**
 * One raw STUMPS gateway match row (`/users/{uk}/matches`) to a scored match.
 * Codes: mk key, trk/trn tournament, btmn/btms and atmn/atms teams and scores,
 * mrs result, mts start time, mdt date, mve venue or stage, mtl match type,
 * mfmt format, isms started, iscp completed.
 */
export function stumpsScoredMatch(m: StumpsRow): ScoredMatch | null {
  const key = nn(m.mk)
  const a = nn(m.btmn)
  const b = nn(m.atmn)
  if (!key || !a || !b) return null
  const venue = nn(m.mve)?.replace(/[\s,;.]+$/, '') || null
  const type = nn(m.mtl)
  const stageLike = venue != null && STAGE.test(venue)
  return {
    source: 'stumps',
    externalMatchId: key,
    externalTournamentId: nn(m.trk),
    tournamentName: nn(m.trn),
    matchLabel: stageLike ? venue : type && type !== 'Open Match' ? type : null,
    format: STUMPS_FORMAT[Number(m.mfmt)] ?? null,
    venue: stageLike ? null : venue,
    playedAt: iso(m.mts) ?? iso(m.mdt),
    teamA: tidyTeamName(a),
    teamAScore: nn(m.btms),
    teamB: tidyTeamName(b),
    teamBScore: nn(m.atms),
    result: nn(m.mrs),
    completed: m.iscp === true,
  }
}

export function isRecordable(m: ScoredMatch): boolean {
  return m.completed && (m.result != null || m.teamAScore != null || m.teamBScore != null)
}

const teamKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Same match on two platforms: same UTC day and the same two teams in any order. */
export function matchFingerprint(m: { playedAt: string | null; teamA: string; teamB: string }): string {
  return `${m.playedAt ? m.playedAt.slice(0, 10) : ''}#${[teamKey(m.teamA), teamKey(m.teamB)].sort().join('|')}`
}

/**
 * For rows in import order, which ones duplicate an earlier row from a
 * different source (index -> earlier index). Same-source repeats are real
 * rematches and are kept.
 */
export function crossSourceDuplicates(rows: Array<{ source: string; playedAt: string | null; teamA: string; teamB: string }>): Map<number, number> {
  const first = new Map<string, number>()
  const dupes = new Map<number, number>()
  rows.forEach((r, i) => {
    if (!r.playedAt) return
    const fp = matchFingerprint(r)
    const f = first.get(fp)
    if (f == null) first.set(fp, i)
    else if (rows[f].source !== r.source) dupes.set(i, f)
  })
  return dupes
}

/** Postgres `timestamp without time zone` text in UTC, independent of the host time zone. */
export function utcTimestampText(isoString: string | null): string | null {
  return isoString ? isoString.replace('T', ' ').replace('Z', '') : null
}

/** Preview of a STUMPS person's scored matches, newest first, grouped by tournament. */
export function stumpsScoringPreview(raw: { matches?: StumpsRow[]; tournaments?: StumpsRow[]; overview?: Record<string, unknown> }): ScoringPreview {
  const listed = raw.matches ?? []
  const matches = listed
    .map(stumpsScoredMatch)
    .filter((m): m is ScoredMatch => m != null && isRecordable(m))
    .sort((x, y) => (y.playedAt ?? '').localeCompare(x.playedAt ?? ''))

  const byName = new Map<string, ScoredTournament>()
  for (const m of matches) {
    if (!m.tournamentName) continue
    const key = m.externalTournamentId ?? m.tournamentName.toLowerCase()
    const t = byName.get(key) ?? { key, name: m.tournamentName, matches: 0, firstAt: null, lastAt: null }
    t.matches++
    if (m.playedAt && (!t.firstAt || m.playedAt < t.firstAt)) t.firstAt = m.playedAt
    if (m.playedAt && (!t.lastAt || m.playedAt > t.lastAt)) t.lastAt = m.playedAt
    byName.set(key, t)
  }
  const tournaments = [...byName.values()].sort((a, b) => (b.lastAt ?? '').localeCompare(a.lastAt ?? ''))
  const withMatches = new Set(tournaments.map((t) => t.key))
  const emptyTournaments = (raw.tournaments ?? [])
    .filter((t) => nn(t.trn) && !withMatches.has(nn(t.trk) ?? String(t.trn).toLowerCase()))
    .map((t) => String(t.trn).trim())
  const dates = matches.map((m) => m.playedAt).filter((d): d is string => d != null).sort()
  const a5 = Number(raw.overview?.a5)
  return {
    listed: listed.length,
    matches,
    tournaments,
    emptyTournaments,
    firstAt: dates[0] ?? null,
    lastAt: dates[dates.length - 1] ?? null,
    sourceScoredCount: Number.isFinite(a5) && a5 > 0 ? a5 : null,
  }
}
