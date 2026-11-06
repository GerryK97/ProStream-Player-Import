'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { api, type DirectoryProfile } from './client'
import { Initials, SourceBadge, Spinner } from './ui'
import type { ScoredMatch, ScoringPreview } from '@/lib/scoring'

type Scorer = {
  source: 'stumps'
  externalId: string
  handle: string | null
  name: string
  profileUrl: string
  matchQuality: 'exact-pid' | 'best-effort' | 'key'
  preview: ScoringPreview
}
type Existing = { source: string; matches: number; duplicates: number; tournaments: number; firstAt: string | null; lastAt: string | null }
type SourceResponse = { scorer: Scorer; matches: { linked: DirectoryProfile | null; candidates: DirectoryProfile[] }; records: Record<string, Existing[]> }
type ImportResponse = { result: { playerDirectoryId: number; publicCode: string | null; upserted: number; inserted: number; duplicates: number; record: Existing[] }; profile: DirectoryProfile | null }

const month = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'Asia/Colombo' }) : '')
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Colombo' }) : '')
const span = (a: string | null, b: string | null) => (month(a) === month(b) ? month(b) : [month(a), month(b)].filter(Boolean).join(' to '))

function recordLine(r: Existing[] | undefined): string | null {
  if (!r?.length) return null
  return r.map((x) => `${x.source === 'stumps' ? 'STUMPS' : x.source === 'cricheroes' ? 'CricHeroes' : x.source} ${x.matches - x.duplicates}`).join(' · ')
}

function MatchRow({ m }: { m: ScoredMatch }) {
  return (
    <li className="py-2 text-sm">
      <div className="flex justify-between gap-3"><span className="truncate font-medium">{m.teamA}</span><span className="shrink-0 tabular-nums">{m.teamAScore}</span></div>
      <div className="flex justify-between gap-3"><span className="truncate font-medium">{m.teamB}</span><span className="shrink-0 tabular-nums">{m.teamBScore}</span></div>
      <div className="text-xs text-app-muted">
        {m.result && <span className="text-primary-dark">{m.result} · </span>}
        {[m.matchLabel, m.format, day(m.playedAt)].filter(Boolean).join(' · ')}
      </div>
    </li>
  )
}

/**
 * Import the matches a person SCORED (not played) on STUMPS into their
 * ProStream scoring record (Scoreboard /scorers/<code>). Separate from player
 * stats: nothing here touches career stats or leaderboards.
 */
export function ImportScoring() {
  const params = useSearchParams()
  const [ref, setRef] = useState(params.get('ref') ?? '')
  const [loading, setLoading] = useState(!!params.get('ref'))
  const [error, setError] = useState('')
  const [data, setData] = useState<SourceResponse | null>(null)
  const [target, setTarget] = useState<DirectoryProfile | null>(null)
  const [targetRecord, setTargetRecord] = useState<Existing[] | null>(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<DirectoryProfile[] | null>(null)
  const [tournament, setTournament] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<ImportResponse | null>(null)
  const requestedPlayerId = Number(params.get('playerId')) || null

  // State is only set once the request settles, never synchronously inside the
  // opening effect (same pattern as ImportRequests). Callers reset the screen first.
  const fetchScorer = useCallback((value: string) =>
    api<SourceResponse>(`/api/scoring/source?source=stumps&ref=${encodeURIComponent(value.trim())}`)
      .then(async (d) => {
        let pick: DirectoryProfile | null = d.matches.linked ?? null
        if (requestedPlayerId) {
          const r = await api<{ results: DirectoryProfile[] }>(`/api/directory/search?q=%23${requestedPlayerId}`).catch(() => ({ results: [] }))
          pick = r.results.find((p) => p.id === requestedPlayerId) ?? pick
        }
        setData(d)
        setTarget(pick)
        setTargetRecord(pick ? d.records[pick.id] ?? null : null)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not fetch from STUMPS'))
      .finally(() => setLoading(false)), [requestedPlayerId])

  function load(value: string) {
    if (!value.trim()) return
    setLoading(true)
    setError('')
    setData(null)
    setDone(null)
    setTournament(null)
    void fetchScorer(value)
  }

  // Opened from a request (?ref=...&playerId=...): fetch straight away.
  // `loading` starts true for this case.
  const initialRef = params.get('ref')
  useEffect(() => {
    if (initialRef) void fetchScorer(initialRef)
  }, [initialRef, fetchScorer])

  async function choose(p: DirectoryProfile) {
    setTarget(p)
    setDone(null)
    setTargetRecord(data?.records[p.id] ?? null)
    if (!data?.records[p.id]) {
      const r = await api<{ record: Existing[] }>(`/api/scoring/import?playerId=${p.id}`).catch(() => ({ record: [] }))
      setTargetRecord(r.record)
    }
  }

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const r = await api<{ results: DirectoryProfile[] }>(`/api/directory/search?q=${encodeURIComponent(q)}`).catch(() => ({ results: [] }))
    setResults(r.results)
  }

  async function runImport() {
    if (!data || !target) return
    setBusy(true)
    setError('')
    try {
      const d = await api<ImportResponse>('/api/scoring/import', {
        method: 'POST',
        body: JSON.stringify({ source: 'stumps', ref: data.scorer.externalId, playerId: target.id }),
      })
      setDone(d)
      setTargetRecord(d.result.record)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  const p = data?.scorer.preview
  const visible = p ? (tournament ? p.matches.filter((m) => (m.externalTournamentId ?? m.tournamentName?.toLowerCase()) === tournament) : p.matches) : []
  const shown = showAll ? visible : visible.slice(0, 15)
  const candidates = data ? [data.matches.linked, ...data.matches.candidates].filter((x, i, all): x is DirectoryProfile => !!x && all.findIndex((y) => y?.id === x.id) === i) : []
  const scoreboard = 'https://score.prostream.lk'

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm">
        <h1 className="text-xl font-bold">Scoring record</h1>
        <p className="mt-1 text-sm text-app-muted">
          Add the matches a person <strong>scored</strong> on STUMPS to their ProStream profile. Shown on their public scoring page; never counted in player stats.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); void load(ref) }} className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="STUMPS profile link, player id (e.g. fore5474) or key"
            className="min-w-0 flex-1 rounded-lg border border-app-border px-3 py-2 text-base outline-none focus:border-primary sm:text-sm"
          />
          <button disabled={loading || !ref.trim()} className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
            {loading && <Spinner />} {loading ? 'Fetching all matches…' : 'Fetch from STUMPS'}
          </button>
        </form>
        {loading && <p className="mt-2 text-xs text-app-muted">Scorers can have hundreds of matches. This can take up to a minute.</p>}
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </section>

      {data && p && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start">
          <section className="min-w-0 space-y-4 rounded-2xl border border-app-border bg-app-surface p-4 shadow-sm sm:p-5">
            <div className="flex items-center gap-3">
              <Initials name={data.scorer.name} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-bold">{data.scorer.name}</span>
                  <SourceBadge source="stumps" />
                  {data.scorer.matchQuality === 'best-effort' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Best match, check it</span>}
                </div>
                <a href={data.scorer.profileUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                  {data.scorer.handle ?? data.scorer.externalId} on STUMPS ↗
                </a>
              </div>
            </div>

            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Completed', p.matches.length],
                ['Tournaments', p.tournaments.length],
                ['STUMPS count', p.sourceScoredCount ?? '—'],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0 rounded-lg border border-app-border px-1 py-2">
                  <dt className="truncate text-[0.65rem] tracking-wide text-app-muted uppercase">{k}</dt>
                  <dd className="text-xl font-bold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-app-muted">
              {p.listed} listed on STUMPS, {p.listed - p.matches.length} not completed (left out). STUMPS count is its own tally of matches this person scored. {span(p.firstAt, p.lastAt)}.
              {p.sourceScoredCount != null && p.sourceScoredCount !== p.matches.length && ' The STUMPS scorer count differs from the list: check before importing.'}
              {p.sourceScoredCount == null && ' STUMPS has no scorer count for this person. Check these are matches they scored, not played.'}
            </p>

            <div>
              <h2 className="text-sm font-semibold">Tournaments</h2>
              <ul className="mt-2 divide-y divide-app-border rounded-lg border border-app-border">
                {p.tournaments.map((t) => (
                  <li key={t.key}>
                    <button
                      onClick={() => { setTournament(tournament === t.key ? null : t.key); setShowAll(false) }}
                      className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${tournament === t.key ? 'bg-primary/5' : 'hover:bg-app-surface-alt'}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{t.name}</span>
                        <span className="text-xs text-app-muted">{span(t.firstAt, t.lastAt)}</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{t.matches}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {p.emptyTournaments.length > 0 && (
                <p className="mt-2 text-xs text-app-muted">Listed on STUMPS with no completed match, not imported: {p.emptyTournaments.join(', ')}.</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Matches ({visible.length})</h2>
                {tournament && <button onClick={() => setTournament(null)} className="text-xs text-accent hover:underline">Show all</button>}
              </div>
              <ul className="mt-1 divide-y divide-app-border">{shown.map((m) => <MatchRow key={m.externalMatchId} m={m} />)}</ul>
              {visible.length > shown.length && (
                <button onClick={() => setShowAll(true)} className="mt-2 w-full rounded-lg border border-app-border py-2 text-sm font-medium hover:bg-app-surface-alt">
                  Show all {visible.length}
                </button>
              )}
            </div>
          </section>

          <section className="min-w-0 space-y-4 rounded-2xl border border-app-border bg-app-surface p-4 shadow-sm sm:p-5">
            <div>
              <h2 className="text-lg font-bold">Add to ProStream</h2>
              <p className="text-sm text-app-muted">Choose the scorer&apos;s ProStream profile. Re-importing updates the same matches.</p>
            </div>
            <ul className="space-y-2">
              {[...candidates, ...(target && !candidates.some((c) => c.id === target.id) ? [target] : [])].map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => void choose(c)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${target?.id === c.id ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-app-border hover:border-primary'}`}
                  >
                    <Initials name={c.displayName} size={36} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{c.displayName}</span>
                      <span className="block truncate text-xs text-app-muted">
                        #{c.id}{c.publicCode ? ` · ${c.publicCode}` : ''}{c.cityName ? ` · ${c.cityName}` : ''}{c.hasLogin ? ' · has login' : ''}
                      </span>
                      {recordLine(data.records[c.id]) && <span className="block text-xs text-primary-dark">Scoring record: {recordLine(data.records[c.id])}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <form onSubmit={search} className="flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by name, code or #id" className="min-w-0 flex-1 rounded-lg border border-app-border px-3 py-1.5 text-base outline-none focus:border-primary sm:text-sm" />
              <button className="rounded-lg border border-app-border px-3 py-1.5 text-sm font-medium hover:bg-app-surface-alt">Search</button>
            </form>
            {results && (
              <ul className="max-h-64 space-y-1 overflow-y-auto">
                {results.length === 0 && <li className="text-sm text-app-muted">No profiles found.</li>}
                {results.map((r) => (
                  <li key={r.id}>
                    <button onClick={() => void choose(r)} className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-app-surface-alt">
                      <span className="font-medium">{r.displayName}</span> <span className="text-app-muted">#{r.id}{r.publicCode ? ` · ${r.publicCode}` : ''}{r.hasLogin ? ' · has login' : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {target && (
              <div className="space-y-3 rounded-xl border border-app-border p-3 text-sm">
                <p>
                  Add <strong>{p.matches.length}</strong> scored matches to <strong>{target.displayName}</strong> (#{target.id}).
                  {targetRecord && targetRecord.length > 0 && <> Already on this profile: {recordLine(targetRecord)}.</>}
                </p>
                <button
                  onClick={() => void runImport()}
                  disabled={busy || p.matches.length === 0}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
                >
                  {busy && <Spinner />} {busy ? 'Importing…' : targetRecord?.some((r) => r.source === 'stumps') ? 'Refresh scoring record' : 'Import scoring record'}
                </button>
              </div>
            )}

            {done && (
              <div className="space-y-1 rounded-xl bg-green-50 p-3 text-sm text-green-900">
                <p className="font-semibold">Done: {done.result.upserted} matches ({done.result.inserted} new, {done.result.upserted - done.result.inserted} refreshed).</p>
                {done.result.duplicates > 0 && <p>{done.result.duplicates} also came from another platform and are shown once.</p>}
                {done.result.publicCode && (
                  <a href={`${scoreboard}/scorers/${done.result.publicCode}`} target="_blank" rel="noreferrer" className="font-semibold text-primary-dark underline">
                    Open the scoring page ↗
                  </a>
                )}
                {requestedPlayerId && <p className="pt-1">Now mark the request as Added on the Requests tab.</p>}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
