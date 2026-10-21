// STUMPS client: a TypeScript port of stumps-scraper/stumps_scraper/client.py.
//
// stumpsapp.com is a Nuxt app whose player pages render client-side from a JSON
// gateway. Every endpoint is `POST` with `{"method":"GET","data":{...}}` and
// answers `{"status":"success","result":...,"hasnext"?:true}`.
// See stumps-scraper/PLAN.md for the reverse-engineering notes.

import 'server-only'
import { politeFetch } from './http'
import { parseStumpsQuery } from './stumpsIds'

export { parseStumpsQuery }

const API_BASE = process.env.STUMPS_API_BASE || 'https://gateway.stumpsapp.com'
const UA = 'Mozilla/5.0 (compatible; ProStream-Player-Import/1.0; +https://prostream.lk)'

type Envelope<T> = { status?: string; message?: string; result?: T; hasnext?: boolean }

async function post<T>(path: string, payload: Record<string, unknown>): Promise<Envelope<T>> {
  const res = await politeFetch('stumps', API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
    body: JSON.stringify(payload),
  })
  const body = (await res.json()) as Envelope<T>
  if (body.status && body.status !== 'success') {
    throw new Error(`STUMPS gateway error on ${path}: ${body.message ?? body.status}`)
  }
  return body
}

export type StumpsSearchHit = {
  uk: string
  un: string
  pimg?: string
  plr?: number
  sts?: string
  srnk?: number
  [k: string]: unknown
}

export type StumpsOverview = Record<string, unknown> & {
  pid?: string
  un?: string
  pimg?: string
  pimgo?: string
  plr?: number
  bts?: number
  bls?: number
  jno?: string | number
  isver?: boolean | number
}

export type StumpsRow = Record<string, unknown>

export type StumpsPlayerExport = {
  uk: string
  query: string
  match: 'exact-pid' | 'best-effort' | 'key'
  hit: StumpsSearchHit | null
  overview: StumpsOverview
  statistics: Record<string, StumpsRow>
  teams: StumpsRow[]
  clubs: StumpsRow[]
}

export async function searchPlayers(query: string, limit = 10): Promise<StumpsSearchHit[]> {
  const body = await post<StumpsSearchHit[]>('/search/users', { method: 'GET', data: { srchStr: query, limit } })
  return Array.isArray(body.result) ? body.result : []
}

export async function getOverview(uk: string): Promise<StumpsOverview | null> {
  const body = await post<StumpsOverview>(`/users/${encodeURIComponent(uk)}/profile/overview`, {
    method: 'GET',
    data: { uk: null },
  })
  return body.result && typeof body.result === 'object' ? body.result : null
}

async function getStatistics(uk: string): Promise<Record<string, StumpsRow>> {
  const body = await post<Record<string, StumpsRow>>(`/users/${encodeURIComponent(uk)}/profile/statistics`, {
    method: 'GET',
    data: { uk: null },
  })
  return body.result && typeof body.result === 'object' ? body.result : {}
}

async function getTeams(uk: string): Promise<StumpsRow[]> {
  const body = await post<StumpsRow[]>(`/users/${encodeURIComponent(uk)}/teams`, { method: 'GET' })
  return Array.isArray(body.result) ? body.result : []
}

async function paginate(path: string, maxItems: number, cursorField = 'sts'): Promise<StumpsRow[]> {
  const rows: StumpsRow[] = []
  const seen = new Set<unknown>()
  let lastTs: unknown
  for (;;) {
    const data: Record<string, unknown> = { limit: 10 }
    if (lastTs !== undefined) data.lastTs = lastTs
    const body = await post<StumpsRow[]>(path, { method: 'GET', data })
    const page = Array.isArray(body.result) ? body.result : []
    if (!page.length) break
    rows.push(...page)
    if (maxItems && rows.length >= maxItems) return rows.slice(0, maxItems)
    if (!body.hasnext) break
    const cursor = page[page.length - 1][cursorField] ?? page[page.length - 1].sts
    if (cursor == null || seen.has(cursor)) break
    seen.add(cursor)
    lastTs = cursor
  }
  return rows
}

/**
 * Resolve a query to one player. Search is fuzzy and the hits carry no `pid`,
 * so an exact id is confirmed against `/profile/overview`.
 */
export async function resolvePlayer(
  input: string,
  maxCandidates = 5,
): Promise<{ uk: string; match: StumpsPlayerExport['match']; hit: StumpsSearchHit | null; overview: StumpsOverview }> {
  const parsed = parseStumpsQuery(input)
  if (parsed.key) {
    const overview = await getOverview(parsed.key)
    if (!overview) throw new Error(`No STUMPS player with key ${parsed.key}`)
    return { uk: parsed.key, match: 'key', hit: null, overview }
  }

  const hits = await searchPlayers(parsed.query, 10)
  if (!hits.length) throw new Error(`No STUMPS player found for "${parsed.query}"`)
  const wanted = parsed.query.toLowerCase()
  const ordered = [...hits].sort((a, b) => {
    const ea = String(a.un ?? '').trim().toLowerCase() === wanted ? 0 : 1
    const eb = String(b.un ?? '').trim().toLowerCase() === wanted ? 0 : 1
    return ea - eb || Number(a.srnk ?? 0) - Number(b.srnk ?? 0)
  })

  let fallback: { uk: string; hit: StumpsSearchHit; overview: StumpsOverview } | null = null
  for (const hit of ordered.slice(0, maxCandidates)) {
    if (!hit.uk) continue
    const overview = await getOverview(hit.uk)
    if (!overview) continue
    fallback ??= { uk: hit.uk, hit, overview }
    if (String(overview.pid ?? '').trim().toLowerCase() === wanted) {
      return { uk: hit.uk, match: 'exact-pid', hit, overview }
    }
  }
  if (!fallback) throw new Error(`Could not load a STUMPS profile for "${parsed.query}"`)
  return { ...fallback, match: 'best-effort' }
}

/** Fetch everything the importer needs for one player. Matches are skipped (not stored). */
export async function fetchPlayer(input: string): Promise<StumpsPlayerExport> {
  const resolved = await resolvePlayer(input)
  const [statistics, teams, clubs] = await Promise.all([
    getStatistics(resolved.uk),
    getTeams(resolved.uk),
    paginate(`/users/${encodeURIComponent(resolved.uk)}/clubs`, 50),
  ])
  return {
    uk: resolved.uk,
    query: input,
    match: resolved.match,
    hit: resolved.hit,
    overview: resolved.overview,
    statistics,
    teams,
    clubs,
  }
}
