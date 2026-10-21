'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, SOURCE_LABEL, type DirectoryProfile, type PlayerPreview, type Source } from './client'
import { Initials, SourceBadge, Spinner, StatsTable } from './ui'
import { PublishPanel } from './PublishPanel'

type SearchHit = { source: Source; ref: string; name: string; subtitle: string | null; verified: boolean }
type Capabilities = { database: boolean; sources: Record<Source, boolean>; error?: string }

export function ImportPlayer() {
  const [source, setSource] = useState<Source>('cricheroes')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [caps, setCaps] = useState<Capabilities | null>(null)

  const [selected, setSelected] = useState<SearchHit | null>(null)
  const [loadingPlayer, setLoadingPlayer] = useState(false)
  const [player, setPlayer] = useState<PlayerPreview | null>(null)
  const [matches, setMatches] = useState<{ linked: DirectoryProfile | null; candidates: DirectoryProfile[] } | null>(null)
  const [playerError, setPlayerError] = useState('')
  const previewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api<Capabilities>('/api/capabilities').then(setCaps).catch(() => null)
  }, [])

  async function search(e?: React.FormEvent) {
    e?.preventDefault()
    if (query.trim().length < 2) return
    setSearching(true)
    setSearchError('')
    setHits(null)
    try {
      const data = await api<{ source: Source; results: SearchHit[] }>(`/api/source/search?source=${source}&q=${encodeURIComponent(query.trim())}`)
      if (data.source !== source) setSource(data.source)
      setHits(data.results)
      if (data.results.length === 1) void open(data.results[0])
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  const open = useCallback(async (hit: SearchHit) => {
    setSelected(hit)
    setPlayer(null)
    setMatches(null)
    setPlayerError('')
    setLoadingPlayer(true)
    requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    try {
      const data = await api<{ player: PlayerPreview; matches: { linked: DirectoryProfile | null; candidates: DirectoryProfile[] } }>(
        `/api/source/player?source=${hit.source}&ref=${encodeURIComponent(hit.ref)}`,
      )
      setPlayer(data.player)
      setMatches(data.matches)
    } catch (err) {
      setPlayerError(err instanceof Error ? err.message : 'Could not load player')
    } finally {
      setLoadingPlayer(false)
    }
  }, [])

  const sourceBlocked = caps && !caps.sources[source]

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm">
        <h1 className="text-xl font-bold">Import a player</h1>
        <p className="mt-1 text-sm text-app-muted">
          Search CricHeroes or STUMPS, review the scraped profile data and stats, then upload it to a ProStream player profile.
        </p>

        {caps && (!caps.database || sourceBlocked) && (
          <div className="mt-4 space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {!caps.database && <p>Database not reachable: {caps.error}</p>}
            {caps.database && sourceBlocked && (
              <p>
                {SOURCE_LABEL[source]} profiles can be previewed but not uploaded yet: the database needs Scoreboard migration
                <code className="mx-1 rounded bg-amber-100 px-1">0072_directory_source_stumps.sql</code>.
              </p>
            )}
          </div>
        )}

        <form onSubmit={search} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <div className="inline-flex shrink-0 rounded-lg border border-app-border p-1">
            {(['cricheroes', 'stumps'] as Source[]).map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => {
                  setSource(s)
                  setHits(null)
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold transition ${source === s ? (s === 'cricheroes' ? 'bg-cricheroes text-white' : 'bg-stumps text-white') : 'text-app-muted hover:bg-app-surface-alt'}`}
              >
                {SOURCE_LABEL[s]}
              </button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={source === 'cricheroes' ? 'Player name, CricHeroes id, or profile URL' : 'Player name, STUMPS id (e.g. ahan5390), or profile URL'}
            className="min-w-0 flex-1 rounded-lg border border-app-border px-3 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <button disabled={searching || query.trim().length < 2} className="rounded-lg bg-primary px-5 py-2 font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>

        {searchError && <p className="mt-3 text-sm text-red-700">{searchError}</p>}
        {hits && hits.length === 0 && <p className="mt-4 text-sm text-app-muted">No players found on {SOURCE_LABEL[source]}.</p>}
        {hits && hits.length > 0 && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {hits.map((h) => (
              <li key={`${h.source}:${h.ref}`}>
                <button
                  onClick={() => open(h)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition hover:border-primary ${selected?.ref === h.ref ? 'border-primary bg-primary/5' : 'border-app-border'}`}
                >
                  <Initials name={h.name} size={44} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {h.name} {h.verified && <span className="text-xs text-primary">✓</span>}
                    </span>
                    <span className="block truncate text-xs text-app-muted">{h.subtitle ?? `${SOURCE_LABEL[h.source]} · ${h.ref}`}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div ref={previewRef} className="scroll-mt-4">
        {loadingPlayer && (
          <div className="flex items-center gap-3 rounded-2xl border border-app-border bg-app-surface p-6 text-app-muted">
            <Spinner /> Scraping {selected?.name} from {selected && SOURCE_LABEL[selected.source]}…
          </div>
        )}
        {playerError && <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">{playerError}</div>}
        {player && matches && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <PlayerCard player={player} />
            <PublishPanel
              key={`${player.source}:${player.externalId}`}
              player={player}
              playerRef={selected!.ref}
              matches={matches}
              writable={caps ? caps.database && caps.sources[player.source] : true}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function PlayerCard({ player }: { player: PlayerPreview }) {
  const [tab, setTab] = useState<'batting' | 'bowling' | 'fielding'>('batting')
  const [format, setFormat] = useState<string>('all')
  const stats = player.careerStats
  const formats = stats.formats ?? []
  const block = format === 'all' ? stats : formats.find((f) => f.format === format) ?? stats

  return (
    <section className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <Initials name={player.name} size={72} rounded="xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SourceBadge source={player.source} />
            {player.matchQuality === 'best-effort' && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Best-effort match, check it is the right player</span>
            )}
          </div>
          <h2 className="mt-1 text-2xl font-bold">{player.name}</h2>
          <a href={player.profileUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
            View on {SOURCE_LABEL[player.source]} ↗
          </a>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            {(
              [
                ['Matches', player.summary.matches],
                ['Runs', player.summary.runs],
                ['Wickets', player.summary.wickets],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg bg-app-surface-alt py-2">
                <dt className="text-[11px] tracking-wide text-app-muted uppercase">{k}</dt>
                <dd className="text-lg font-bold">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Info label="Role" value={player.sourceLabels.role} />
        <Info label="Batting" value={player.sourceLabels.battingStyle} />
        <Info label="Bowling" value={player.sourceLabels.bowlingStyle} />
        <Info label="City" value={player.cityName} />
        <Info label="Date of birth" value={player.dob} />
        <Info label="Jersey" value={player.jerseyNumber?.toString() ?? null} />
      </dl>

      {player.statement && <p className="mt-4 line-clamp-4 text-sm text-app-muted">{player.statement}</p>}

      <div className="mt-5">
        <div className="flex flex-wrap items-center gap-2">
          {(['batting', 'bowling', 'fielding'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1 text-sm font-medium capitalize ${tab === t ? 'bg-app-header text-white' : 'bg-app-surface-alt text-app-muted hover:text-app-ink'}`}
            >
              {t}
            </button>
          ))}
          {formats.length > 1 && (
            <select value={format} onChange={(e) => setFormat(e.target.value)} className="ml-auto rounded-md border border-app-border px-2 py-1 text-sm">
              <option value="all">All formats</option>
              {formats.map((f) => (
                <option key={f.format}>{f.format}</option>
              ))}
            </select>
          )}
        </div>
        <StatsTable items={block[tab]} />
      </div>

      {player.teams.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-semibold">Teams on {SOURCE_LABEL[player.source]} ({player.teams.length})</h3>
          <p className="mt-1 text-sm text-app-muted">{player.teams.slice(0, 12).map((t) => t.name).join(', ')}{player.teams.length > 12 ? ', …' : ''}</p>
        </div>
      )}
    </section>
  )
}

function Info({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs text-app-muted">{label}</dt>
      <dd className="font-medium">{value || <span className="text-app-muted">not listed</span>}</dd>
    </div>
  )
}
