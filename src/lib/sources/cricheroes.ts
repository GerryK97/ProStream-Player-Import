// CricHeroes client: a TypeScript port of cricheroes-extract/cricheroes.py.
//
// cricheroes.com is a Next.js app backed by a JSON API at api.cricheroes.in.
// The site sends a static api-key shipped in its own JS bundle plus a random
// udid. If CricHeroes rotates the key, set CRICHEROES_API_KEY to the new value
// from their `_next/static/chunks/*.js` (search for "api-key").
//
// Server-only: browsers would be blocked by CORS, and the key stays off the client.

import 'server-only'
import { HttpError, politeFetch, type FetchOptions } from './http'
import { parseCricHeroesId } from './cricheroesIds'

export { parseCricHeroesId }

const BASE = 'https://api.cricheroes.in/api/v1'
// The API rejects requests without a browser-like User-Agent (HTTP 403).
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function udid(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 32; i += 1) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

const DEVICE_ID = udid()

function headers(): Record<string, string> {
  return {
    'api-key': process.env.CRICHEROES_API_KEY || 'cr!CkH3r0s',
    udid: DEVICE_ID,
    'device-type': 'Chrome: 124.0.0.0',
    'User-Agent': UA,
    Origin: 'https://cricheroes.com',
    Referer: 'https://cricheroes.com/',
    Accept: 'application/json',
  }
}

type Envelope<T> = {
  status?: boolean
  data?: T
  page?: { next?: string | null }
  error?: { code?: number; message?: string }
}

// "Not found" style errors mean "no data", not a failure.
function isEmptyError(err: Envelope<unknown>['error']): boolean {
  const msg = String(err?.message ?? '').toLowerCase()
  return (
    err?.code === 404 ||
    ['did not find', 'no record', "hasn't played", 'not played', 'no data'].some((s) => msg.includes(s))
  )
}

async function get<T>(path: string, opts?: FetchOptions): Promise<Envelope<T> | null> {
  const url = path.startsWith('http') ? path : `${BASE}/${path.replace(/^\//, '')}`
  let res: Response
  try {
    res = await politeFetch('cricheroes', url, { headers: headers() }, opts)
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null
    throw err
  }
  const body = (await res.json()) as Envelope<T>
  if (body.status === false) {
    if (isEmptyError(body.error)) return null
    throw new Error(`CricHeroes API error: ${body.error?.message ?? 'unknown'}`)
  }
  return body
}

async function data<T>(path: string): Promise<T | null> {
  const body = await get<T>(path)
  return body?.data ?? null
}

/** Follow the API's page.next cursor. */
async function paged<T>(path: string, limit = 0): Promise<T[]> {
  const out: T[] = []
  let url: string | null = path
  const seen = new Set<string>()
  while (url && !seen.has(url)) {
    seen.add(url)
    const body: Envelope<T[]> | null = await get<T[]>(url)
    if (!body) break
    out.push(...(body.data ?? []))
    if (limit && out.length >= limit) return out.slice(0, limit)
    const next: string | null | undefined = body.page?.next
    url = next ? (next.startsWith('/') ? `${BASE}${next}` : next) : null
  }
  return out
}

// ── Types (only the fields we use; the raw payload is stored untouched) ───────

export type CHSearchPlayer = {
  user_id: number
  name: string
  city_name?: string
  player_skill?: string
  playing_role?: string
  profile_photo?: string
  is_verified?: number
  is_player_pro?: number
}

export type CHSearchTeam = {
  team_id: number
  name: string
  city_name?: string
  captain_name?: string
  logo?: string
  is_verified?: number
}

export type CHProfile = {
  player_id?: number
  name?: string
  profile_photo?: string
  city_name?: string
  bowling_style?: string
  batting_hand?: string
  playing_role?: string
  player_skill?: string
  batter_category?: string
  bowler_category?: string
  dob?: string
  player_statement?: string
  total_matches?: number
  total_runs?: number
  total_wickets?: number
  is_pro?: number
}

export type CHStatItem = { title: string; value: string | number }
export type CHStatistics = {
  statistics?: { batting?: CHStatItem[]; bowling?: CHStatItem[]; fielding?: CHStatItem[]; captain?: CHStatItem[] }
}

export type CHTeamRef = {
  team_id: number
  team_name: string
  logo?: string
  created_date?: string
  matches_played?: number
  matches_won?: number
  matches_loss?: number
  is_verified?: number
}

export type CHMember = {
  player_id: number
  name: string
  profile_photo?: string
  player_skill?: string
  is_verified?: number
  is_captain?: number
  is_admin?: number
}

export type CHTeamInfo = {
  team_id?: number
  team_name?: string
  logo?: string
  city_name?: string
  created_date?: string
  is_verified?: number
  is_active?: number
  statement?: string
}

export type CricHeroesPlayerExport = {
  player_id: number
  profile: CHProfile | null
  statistics: CHStatistics | null
  teams: CHTeamRef[]
  matches: unknown[]
}

export type CricHeroesTeamExport = {
  team_id: number
  info: CHTeamInfo | null
  statistics: unknown
  members: CHMember[]
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function searchPlayers(name: string): Promise<CHSearchPlayer[]> {
  const d = await data<{ players?: CHSearchPlayer[] }>(`search/v2/global-search-all/2/${encodeURIComponent(name)}`)
  return d?.players ?? []
}

export async function searchTeams(name: string): Promise<CHSearchTeam[]> {
  const d = await data<{ teams?: CHSearchTeam[] }>(`search/v2/global-search-all/1/${encodeURIComponent(name)}`)
  return d?.teams ?? []
}

export async function fetchPlayer(playerId: number, opts: { matches?: number } = {}): Promise<CricHeroesPlayerExport> {
  const [profile, statistics, teams] = await Promise.all([
    data<CHProfile>(`player/get-player-profile-web/${playerId}`),
    data<CHStatistics>(`player/get-player-statistic/${playerId}`),
    paged<CHTeamRef>(`player/get-player-team/${playerId}?pageno=1`, 200),
  ])
  if (!profile) throw new Error(`CricHeroes player ${playerId} not found`)
  const matches = opts.matches ? await paged<unknown>(`player/get-player-match/${playerId}?pageno=1`, opts.matches) : []
  return { player_id: playerId, profile, statistics, teams, matches }
}

export async function fetchTeam(teamId: number): Promise<CricHeroesTeamExport> {
  const [info, statistics, membersBody] = await Promise.all([
    data<CHTeamInfo>(`team/get-team-profile-info/${teamId}`),
    data<unknown>(`team/get-team-statistic/${teamId}`),
    data<{ members?: CHMember[] }>(`team/get-team-member/${teamId}`),
  ])
  if (!info) throw new Error(`CricHeroes team ${teamId} not found`)
  return { team_id: teamId, info, statistics, members: membersBody?.members ?? [] }
}
