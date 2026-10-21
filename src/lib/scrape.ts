// Source-agnostic scraping entry points used by the API routes.

import 'server-only'
import * as cricheroes from './sources/cricheroes'
import * as stumps from './sources/stumps'
import {
  cricheroesMemberRef,
  normalizeCricHeroesPlayer,
  normalizeStumpsPlayer,
  titleCase,
  type ExternalSource,
  type ScrapedPlayer,
} from './normalize'
import { memo } from './cache'

export type SearchHit = {
  source: ExternalSource
  /** What to pass back to fetchScrapedPlayer(). */
  ref: string
  name: string
  subtitle: string | null
  verified: boolean
}

export type TeamHit = { source: ExternalSource; ref: string; name: string; subtitle: string | null }

const SOURCES: ExternalSource[] = ['cricheroes', 'stumps']

export function isSource(v: unknown): v is ExternalSource {
  return typeof v === 'string' && (SOURCES as string[]).includes(v)
}

/** Detect the source of a pasted profile URL. */
export function sourceFromUrl(input: string): ExternalSource | null {
  if (/cricheroes\.(com|in)/i.test(input)) return 'cricheroes'
  if (/stumpsapp\.com/i.test(input)) return 'stumps'
  return null
}

export async function searchSource(source: ExternalSource, query: string): Promise<SearchHit[]> {
  const q = query.trim()
  if (!q) return []

  if (source === 'cricheroes') {
    const id = cricheroes.parseCricHeroesId(q, 'player')
    if (id) {
      const p = await cricheroes.fetchPlayer(id)
      return [
        {
          source,
          ref: String(id),
          name: p.profile?.name ?? `Player ${id}`,
          subtitle: [p.profile?.city_name, p.profile?.playing_role].filter(Boolean).join(' · ') || null,
          verified: false,
        },
      ]
    }
    const hits = await cricheroes.searchPlayers(q)
    return hits.slice(0, 25).map((h) => ({
      source,
      ref: String(h.user_id),
      name: h.name,
      subtitle: [h.city_name, h.playing_role || h.player_skill].filter(Boolean).join(' · ') || null,
      verified: h.is_verified === 1,
    }))
  }

  const parsed = stumps.parseStumpsQuery(q)
  if (parsed.key) {
    const o = await stumps.getOverview(parsed.key)
    if (!o) return []
    return [{ source, ref: parsed.key, name: titleCase(String(o.un ?? 'Player')), subtitle: o.pid ? `ID ${o.pid}` : null, verified: Boolean(o.isver) }]
  }
  const hits = await stumps.searchPlayers(q, 20)
  // A STUMPS player id (e.g. "ahan5390") is confirmed exactly and pinned first.
  if (/^[a-z]+\d+$/i.test(q)) {
    const exact = await stumps.resolvePlayer(q).catch(() => null)
    if (exact?.match === 'exact-pid') {
      const rest = hits.filter((h) => h.uk !== exact.uk)
      return [
        { source, ref: exact.uk, name: titleCase(String(exact.overview.un ?? q)), subtitle: `ID ${q} · exact match`, verified: Boolean(exact.overview.isver) },
        ...rest.map((h) => ({ source, ref: h.uk, name: titleCase(String(h.un ?? '')), subtitle: null, verified: false })),
      ]
    }
  }
  return hits.map((h) => ({
    source,
    ref: h.uk,
    name: titleCase(String(h.un ?? '')),
    subtitle: null,
    verified: false,
  }))
}

export async function fetchScrapedPlayer(source: ExternalSource, ref: string): Promise<ScrapedPlayer> {
  // Preview and publish fetch the same player seconds apart; reuse the scrape.
  return memo(`player:${source}:${ref.trim()}`, 5 * 60_000, async () => {
    if (source === 'cricheroes') {
      const id = cricheroes.parseCricHeroesId(ref, 'player')
      if (!id) throw new Error('Enter a CricHeroes player id or profile URL')
      return normalizeCricHeroesPlayer(await cricheroes.fetchPlayer(id))
    }
    return normalizeStumpsPlayer(await stumps.fetchPlayer(ref))
  })
}

// ── Teams (CricHeroes only: STUMPS exposes no team roster endpoint) ───────────

export async function searchTeams(query: string): Promise<TeamHit[]> {
  const q = query.trim()
  if (!q) return []
  const id = cricheroes.parseCricHeroesId(q, 'team')
  if (id) {
    const t = await cricheroes.fetchTeam(id)
    return [{ source: 'cricheroes', ref: String(id), name: t.info?.team_name ?? `Team ${id}`, subtitle: `${t.members.length} members${t.info?.city_name ? ` · ${t.info.city_name}` : ''}` }]
  }
  const hits = await cricheroes.searchTeams(q)
  return hits.slice(0, 25).map((t) => ({
    source: 'cricheroes',
    ref: String(t.team_id),
    name: t.name,
    subtitle: [t.city_name, t.captain_name ? `Capt. ${t.captain_name}` : null].filter(Boolean).join(' · ') || null,
  }))
}

export async function fetchTeamRoster(ref: string) {
  const id = cricheroes.parseCricHeroesId(ref, 'team')
  if (!id) throw new Error('Enter a CricHeroes team id or URL')
  const t = await memo(`ch-team:${id}`, 10 * 60_000, () => cricheroes.fetchTeam(id))
  const created = t.info?.created_date ? new Date(t.info.created_date).getFullYear() : null
  return {
    team: {
      externalId: String(id),
      name: t.info?.team_name?.trim() || `Team ${id}`,
      cityName: t.info?.city_name?.trim() || null,
      foundedYear: created && Number.isFinite(created) ? created : null,
      raw: { info: t.info, statistics: t.statistics },
    },
    members: t.members.filter((m) => m?.player_id != null).map(cricheroesMemberRef),
  }
}
