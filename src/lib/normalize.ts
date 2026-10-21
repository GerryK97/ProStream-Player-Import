// Turn raw CricHeroes / STUMPS payloads into one ScrapedPlayer shape that maps
// directly onto ProStream's player_directory columns.
//
// Pure functions, no I/O, so they are unit tested against captured fixtures.
//
// careerStatsImported keeps the shape the Scoreboard's own CricHeroes importer
// already writes ({ batting|bowling|fielding|captain: [{title, value}] }), so
// both sources render the same way in any UI that reads the column. STUMPS is
// per-format at source, so its formats are summed into career totals and the
// per-format breakdown is kept under `formats`.

import type { BattingStyle, BowlingStyle, PlayerRole } from './db/schema'
import type { CricHeroesPlayerExport, CHStatItem, CHTeamRef, CHMember } from './sources/cricheroes'
import type { StumpsPlayerExport, StumpsRow } from './sources/stumps'

export type ExternalSource = 'cricheroes' | 'stumps'

export type StatItem = { title: string; value: string | number }

export type CareerStats = {
  batting: StatItem[]
  bowling: StatItem[]
  fielding: StatItem[]
  captain: StatItem[]
  formats?: Array<{ code: number | null; format: string; batting: StatItem[]; bowling: StatItem[]; fielding: StatItem[] }>
  source: ExternalSource
  sourceUrl: string
  fetchedAt: string
}

export type ScrapedTeamRef = {
  externalId: string
  name: string
  isCaptain?: boolean
  isAdmin?: boolean
  roleSkill?: string | null
  raw: unknown
}

export type ScrapedPlayer = {
  source: ExternalSource
  externalId: string
  profileUrl: string
  matchQuality: 'exact' | 'best-effort'
  name: string
  cityName: string | null
  dob: string | null
  role: PlayerRole | null
  battingStyle: BattingStyle | null
  bowlingStyle: BowlingStyle | null
  jerseyNumber: number | null
  statement: string | null
  isVerified: boolean
  /** The source's own wording, shown next to the mapped enum value in the UI. */
  sourceLabels: { role: string | null; battingStyle: string | null; bowlingStyle: string | null }
  summary: { matches: number; runs: number; wickets: number }
  careerStats: CareerStats
  teams: ScrapedTeamRef[]
  raw: unknown
}

// ── Shared value maps ─────────────────────────────────────────────────────────

/** "RHB" / "LHB" / "Right Hand Bat" → batting_style enum. */
export function normalizeBattingHand(raw: string | null | undefined): BattingStyle | null {
  if (!raw) return null
  const v = raw.toLowerCase()
  if (v.includes('lhb') || v.includes('left')) return 'left-hand'
  if (v.includes('rhb') || v.includes('right')) return 'right-hand'
  return null
}

/** Free-text bowling style → bowling_style enum. Same rules as the Scoreboard importer. */
export function normalizeBowlingStyle(raw: string | null | undefined): BowlingStyle | null {
  if (!raw) return null
  const v = raw.toLowerCase()
  const left = v.includes('left')
  const arm = left ? 'left-arm' : 'right-arm'
  if (v.includes('leg break') || v.includes('legbreak') || v.includes('leg spin') || v.includes('googly')) {
    return left ? 'left-arm-chinaman' : 'right-arm-legbreak'
  }
  if (v.includes('off break') || v.includes('offbreak') || v.includes('off spin')) {
    return left ? 'left-arm-orthodox' : 'right-arm-offbreak'
  }
  if (v.includes('chinaman') || v.includes('wrist spin') || v.includes('unorthodox')) return 'left-arm-chinaman'
  if (v.includes('orthodox') || v.includes('slow left')) return 'left-arm-orthodox'
  if (v.includes('spin')) return left ? 'left-arm-orthodox' : 'right-arm-offbreak'
  if (v.includes('fast')) return `${arm}-fast` as BowlingStyle
  if (v.includes('medium') || v.includes('seam')) return `${arm}-medium` as BowlingStyle
  return null
}

/** Role text ('BAT', 'All-Rounder', 'Wicketkeeping Batter', …) → player_role enum. */
export function normalizeRole(raw: string | null | undefined): PlayerRole | null {
  if (!raw) return null
  const v = raw.toLowerCase()
  if (v.includes('wk') || v.includes('keep')) return 'keeper'
  if (v.includes('all') || v === 'ar') return 'allrounder'
  if (v.includes('bowl')) return 'bowler'
  if (v.includes('bat')) return 'batsman'
  return null
}

export function stripHtml(raw: string | null | undefined): string | null {
  if (!raw) return null
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length ? text : null
}

function nn(raw: unknown): string | null {
  if (raw == null) return null
  const t = String(raw).trim()
  return t.length ? t : null
}

/** Title-case an ALL CAPS STUMPS name ("SAHAN NAWANJANA" → "Sahan Nawanjana"). */
export function titleCase(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** 'YYYY-MM-DD' only, and never in the future. */
export function cleanDob(raw: unknown): string | null {
  const s = nn(raw)
  if (!s) return null
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  if (!m) return null
  const d = new Date(`${m[1]}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[1] || d > new Date()) return null
  return m[1]
}

export function cleanJersey(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= 999 ? n : null
}

function statValue(items: StatItem[] | undefined, title: string): number {
  const hit = items?.find((i) => i.title.toLowerCase() === title.toLowerCase())
  const n = Number(hit?.value)
  return Number.isFinite(n) ? n : 0
}

// ── CricHeroes ────────────────────────────────────────────────────────────────

const cleanItems = (items: CHStatItem[] | undefined): StatItem[] =>
  (items ?? []).map((i) => ({ title: String(i.title), value: i.value as string | number }))

export function cricheroesProfileUrl(id: number | string, name?: string): string {
  const slug = (name ?? 'player').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'player'
  return `https://cricheroes.com/player-profile/${id}/${slug}`
}

export function cricheroesTeamRef(t: CHTeamRef): ScrapedTeamRef {
  return { externalId: String(t.team_id), name: nn(t.team_name) ?? 'Unknown Team', raw: t }
}

export function normalizeCricHeroesPlayer(raw: CricHeroesPlayerExport, fetchedAt = new Date()): ScrapedPlayer {
  const p = raw.profile ?? {}
  const id = String(raw.player_id ?? p.player_id ?? '')
  const name = nn(p.name) ?? 'Unknown Player'
  const s = raw.statistics?.statistics ?? {}
  const url = cricheroesProfileUrl(id, name)
  const careerStats: CareerStats = {
    batting: cleanItems(s.batting),
    bowling: cleanItems(s.bowling),
    fielding: cleanItems(s.fielding),
    captain: cleanItems(s.captain),
    source: 'cricheroes',
    sourceUrl: url,
    fetchedAt: fetchedAt.toISOString(),
  }
  const roleText = nn(p.playing_role) ?? nn(p.player_skill)

  return {
    source: 'cricheroes',
    externalId: id,
    profileUrl: url,
    matchQuality: 'exact',
    name,
    cityName: nn(p.city_name),
    dob: cleanDob(p.dob),
    role: normalizeRole(roleText),
    battingStyle: normalizeBattingHand(p.batting_hand),
    bowlingStyle: normalizeBowlingStyle(p.bowling_style),
    jerseyNumber: null,
    statement: stripHtml(p.player_statement),
    isVerified: false,
    sourceLabels: { role: roleText, battingStyle: nn(p.batting_hand), bowlingStyle: nn(p.bowling_style) },
    summary: {
      matches: Number(p.total_matches ?? statValue(careerStats.batting, 'Matches')) || 0,
      runs: Number(p.total_runs ?? statValue(careerStats.batting, 'Runs')) || 0,
      wickets: Number(p.total_wickets ?? statValue(careerStats.bowling, 'Wickets')) || 0,
    },
    careerStats,
    teams: (raw.teams ?? []).filter((t) => t?.team_id != null).map(cricheroesTeamRef),
    raw,
  }
}

export function cricheroesMemberRef(m: CHMember): { externalId: string; name: string; role: PlayerRole | null; isCaptain: boolean; isAdmin: boolean; roleSkill: string | null } {
  return {
    externalId: String(m.player_id),
    name: nn(m.name) ?? 'Unknown Player',
    role: normalizeRole(m.player_skill),
    isCaptain: (m.is_captain ?? 0) === 1,
    isAdmin: (m.is_admin ?? 0) === 1,
    roleSkill: nn(m.player_skill),
  }
}

// ── STUMPS ────────────────────────────────────────────────────────────────────

export const STUMPS_ROLE: Record<number, string> = {
  1: 'Batter',
  2: 'Bowler',
  3: 'All Rounder',
  4: 'Wicketkeeping Batter',
  99: 'Unspecified',
}
export const STUMPS_BAT: Record<number, string> = { 1: 'Right Hand Bat', 2: 'Left Hand Bat' }
export const STUMPS_BOWL: Record<number, string> = {
  1: 'Right Arm Fast',
  2: 'Right Arm Medium',
  3: 'Left Arm Fast',
  4: 'Left Arm Medium',
  5: 'Right Arm Off Break',
  6: 'Right Arm Leg Break',
  7: 'Left Arm Orthodox Spin',
  8: 'Left Arm Wrist Spin',
}
export const STUMPS_FORMAT: Record<number, string> = {
  1: 'T10',
  2: 'T20',
  3: 'Club Cricket',
  4: 'One Day',
  5: 'Test Match',
  6: '100 Ball',
}

const STUMPS_ROLE_ENUM: Record<number, PlayerRole> = { 1: 'batsman', 2: 'bowler', 3: 'allrounder', 4: 'keeper' }
const STUMPS_BAT_ENUM: Record<number, BattingStyle> = { 1: 'right-hand', 2: 'left-hand' }
const STUMPS_BOWL_ENUM: Record<number, BowlingStyle> = {
  1: 'right-arm-fast',
  2: 'right-arm-medium',
  3: 'left-arm-fast',
  4: 'left-arm-medium',
  5: 'right-arm-offbreak',
  6: 'right-arm-legbreak',
  7: 'left-arm-orthodox',
  8: 'left-arm-chinaman',
}

const num = (row: StumpsRow, key: string): number => {
  const n = Number(row[key])
  return Number.isFinite(n) ? n : 0
}

const round = (n: number, dp = 2): number => Number(n.toFixed(dp))

/** "115*" → { runs: 115, notOut: true }. */
function parseHighScore(v: unknown): { runs: number; notOut: boolean } {
  const s = String(v ?? '').trim()
  const n = parseInt(s, 10)
  return { runs: Number.isFinite(n) ? n : 0, notOut: s.endsWith('*') }
}

/** "4-1" or "4/1" → { wickets: 4, runs: 1 }. */
function parseBest(v: unknown): { wickets: number; runs: number } | null {
  const m = String(v ?? '').match(/^(\d+)\s*[-/]\s*(\d+)$/)
  return m ? { wickets: Number(m[1]), runs: Number(m[2]) } : null
}

const oversFromBalls = (balls: number): string => `${Math.floor(balls / 6)}.${balls % 6}`

type StumpsTotals = {
  matches: number
  bat: { innings: number; notOuts: number; runs: number; balls: number; hs: { runs: number; notOut: boolean }; thirties: number; fifties: number; hundreds: number; fours: number; sixes: number; ducks: number }
  bowl: { innings: number; balls: number; runs: number; dots: number; maidens: number; wickets: number; best: { wickets: number; runs: number } | null; threes: number; fives: number }
  field: { catches: number; stumpings: number; runouts: number }
}

function emptyTotals(): StumpsTotals {
  return {
    matches: 0,
    bat: { innings: 0, notOuts: 0, runs: 0, balls: 0, hs: { runs: 0, notOut: false }, thirties: 0, fifties: 0, hundreds: 0, fours: 0, sixes: 0, ducks: 0 },
    bowl: { innings: 0, balls: 0, runs: 0, dots: 0, maidens: 0, wickets: 0, best: null, threes: 0, fives: 0 },
    field: { catches: 0, stumpings: 0, runouts: 0 },
  }
}

function addRow(t: StumpsTotals, row: StumpsRow): void {
  t.matches += num(row, 'mat')
  t.bat.innings += num(row, 'btin')
  t.bat.notOuts += num(row, 'btno')
  t.bat.runs += num(row, 'btrn')
  t.bat.balls += num(row, 'btbl')
  const hs = parseHighScore(row.hs)
  if (hs.runs > t.bat.hs.runs || (hs.runs === t.bat.hs.runs && hs.notOut)) t.bat.hs = hs
  t.bat.thirties += num(row, 'bt30')
  t.bat.fifties += num(row, 'bt50')
  t.bat.hundreds += num(row, 'bt100')
  t.bat.fours += num(row, 'bt4')
  t.bat.sixes += num(row, 'bt6')
  t.bat.ducks += num(row, 'btdk')
  t.bowl.innings += num(row, 'blin')
  t.bowl.balls += num(row, 'blbl')
  t.bowl.runs += num(row, 'blrn')
  t.bowl.dots += num(row, 'bl0')
  t.bowl.maidens += num(row, 'blmd')
  t.bowl.wickets += num(row, 'blwkt')
  t.bowl.threes += num(row, 'bl3w')
  t.bowl.fives += num(row, 'bl5w')
  const best = parseBest(row.bbl)
  if (best && (!t.bowl.best || best.wickets > t.bowl.best.wickets || (best.wickets === t.bowl.best.wickets && best.runs < t.bowl.best.runs))) {
    t.bowl.best = best
  }
  t.field.catches += num(row, 'flct')
  t.field.stumpings += num(row, 'flst')
  t.field.runouts += num(row, 'flro')
}

function totalsToItems(t: StumpsTotals): { batting: StatItem[]; bowling: StatItem[]; fielding: StatItem[] } {
  const outs = t.bat.innings - t.bat.notOuts
  const hs = `${t.bat.hs.runs}${t.bat.hs.notOut ? '*' : ''}`
  return {
    batting: [
      { title: 'Matches', value: t.matches },
      { title: 'Innings', value: t.bat.innings },
      { title: 'Not out', value: t.bat.notOuts },
      { title: 'Runs', value: t.bat.runs },
      { title: 'Balls', value: t.bat.balls },
      { title: 'Highest Runs', value: hs },
      { title: 'Avg', value: outs > 0 ? round(t.bat.runs / outs).toFixed(2) : '-' },
      { title: 'SR', value: t.bat.balls > 0 ? round((t.bat.runs / t.bat.balls) * 100).toFixed(2) : '0.00' },
      { title: '30s', value: t.bat.thirties },
      { title: '50s', value: t.bat.fifties },
      { title: '100s', value: t.bat.hundreds },
      { title: '4s', value: t.bat.fours },
      { title: '6s', value: t.bat.sixes },
      { title: 'Ducks', value: t.bat.ducks },
    ],
    bowling: [
      { title: 'Matches', value: t.matches },
      { title: 'Innings', value: t.bowl.innings },
      { title: 'Overs', value: oversFromBalls(t.bowl.balls) },
      { title: 'Maidens', value: t.bowl.maidens },
      { title: 'Wickets', value: t.bowl.wickets },
      { title: 'Runs', value: t.bowl.runs },
      { title: 'Best Bowling', value: t.bowl.best ? `${t.bowl.best.wickets}/${t.bowl.best.runs}` : '-' },
      { title: '3 Wickets', value: t.bowl.threes },
      { title: '5 Wickets', value: t.bowl.fives },
      { title: 'Economy', value: t.bowl.balls > 0 ? round((t.bowl.runs / t.bowl.balls) * 6).toFixed(2) : '0.00' },
      { title: 'SR', value: t.bowl.wickets > 0 ? round(t.bowl.balls / t.bowl.wickets).toFixed(2) : '-' },
      { title: 'Avg', value: t.bowl.wickets > 0 ? round(t.bowl.runs / t.bowl.wickets).toFixed(2) : '-' },
      { title: 'Dot Balls', value: t.bowl.dots },
    ],
    fielding: [
      { title: 'Matches', value: t.matches },
      { title: 'Catches', value: t.field.catches },
      { title: 'Run outs', value: t.field.runouts },
      { title: 'Stumpings', value: t.field.stumpings },
    ],
  }
}

/** Sum STUMPS per-format statistics into career totals plus a per-format breakdown. */
export function stumpsCareerStats(statistics: Record<string, StumpsRow>): Pick<CareerStats, 'batting' | 'bowling' | 'fielding' | 'formats'> & { totals: StumpsTotals } {
  const total = emptyTotals()
  const formats: NonNullable<CareerStats['formats']> = []
  const keys = Object.keys(statistics ?? {}).sort((a, b) => Number(a) - Number(b))
  for (const key of keys) {
    const row = statistics[key]
    if (!row || typeof row !== 'object') continue
    addRow(total, row)
    const one = emptyTotals()
    addRow(one, row)
    const code = Number.isFinite(Number(key)) ? Number(key) : null
    formats.push({ code, format: (code != null && STUMPS_FORMAT[code]) || `Format ${key}`, ...totalsToItems(one) })
  }
  return { ...totalsToItems(total), formats, totals: total }
}

export function stumpsTeamRef(t: StumpsRow): ScrapedTeamRef | null {
  const key = nn(t.tmk)
  if (!key) return null
  const name = nn(t.tmn)
  return { externalId: key, name: name ? titleCase(name) : 'Unknown Team', raw: t }
}

export function stumpsProfileUrl(uk: string): string {
  return `https://stumpsapp.com/player/${encodeURIComponent(uk)}`
}

export function normalizeStumpsPlayer(raw: StumpsPlayerExport, fetchedAt = new Date()): ScrapedPlayer {
  const o = raw.overview ?? {}
  const nameRaw = nn(o.un) ?? nn(raw.hit?.un) ?? 'Unknown Player'
  const url = stumpsProfileUrl(raw.uk)
  const stats = stumpsCareerStats(raw.statistics)
  const plr = Number(o.plr)
  const bts = Number(o.bts)
  const bls = Number(o.bls)
  const firstClub = raw.clubs?.[0]

  return {
    source: 'stumps',
    // `uk` is STUMPS's stable record key; the user-facing pid can be edited.
    externalId: raw.uk,
    profileUrl: url,
    matchQuality: raw.match === 'best-effort' ? 'best-effort' : 'exact',
    name: titleCase(nameRaw),
    cityName: firstClub ? (nn(firstClub.ci) ? titleCase(String(firstClub.ci)) : null) : null,
    dob: null,
    role: STUMPS_ROLE_ENUM[plr] ?? null,
    battingStyle: STUMPS_BAT_ENUM[bts] ?? null,
    bowlingStyle: STUMPS_BOWL_ENUM[bls] ?? null,
    jerseyNumber: cleanJersey(o.jno),
    statement: null,
    isVerified: o.isver === true || o.isver === 1,
    sourceLabels: { role: STUMPS_ROLE[plr] ?? null, battingStyle: STUMPS_BAT[bts] ?? null, bowlingStyle: STUMPS_BOWL[bls] ?? null },
    summary: { matches: stats.totals.matches || Number(o.a1 ?? 0) || 0, runs: stats.totals.bat.runs, wickets: stats.totals.bowl.wickets },
    careerStats: {
      batting: stats.batting,
      bowling: stats.bowling,
      fielding: stats.fielding,
      captain: [],
      formats: stats.formats,
      source: 'stumps',
      sourceUrl: url,
      fetchedAt: fetchedAt.toISOString(),
    },
    teams: (raw.teams ?? []).map(stumpsTeamRef).filter((t): t is ScrapedTeamRef => t !== null),
    raw,
  }
}

/** A short code from team name initials ("Venus Cricket Club" → "VCC"). */
export function deriveShortCode(name: string): string {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean)
  return words.map((w) => w[0]).join('').toUpperCase().slice(0, 10)
}
