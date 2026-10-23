'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, SOURCE_LABEL, type PlayerPreview, type Source } from './client'
import { Initials, SourceBadge, Spinner, StatsTable } from './ui'

type Status = 'pending' | 'needs_info' | 'imported' | 'rejected' | 'cancelled'
type QueueItem = {
  id: number
  source: Source
  externalRef: string
  sourceUrl: string
  byName: boolean
  status: Status
  playerNote: string | null
  adminNote: string | null
  createdAt: string
  updatedAt: string
  decidedAt: string | null
  requester: { id: string; username: string | null; displayName: string | null }
  profile: { id: number; displayName: string; cityName: string | null; mobile: string | null; publicCode: string | null; source: string; externalId: string | null }
  heldBy: { id: number; name: string } | null
}
type Hit = { source: Source; ref: string; name: string; subtitle: string | null; verified: boolean }

const STATUS: Record<Status, { label: string; tone: string }> = {
  pending: { label: 'Waiting for review', tone: 'bg-amber-100 text-amber-900' },
  needs_info: { label: 'Needs more info', tone: 'bg-blue-100 text-blue-900' },
  imported: { label: 'Added', tone: 'bg-green-100 text-green-900' },
  rejected: { label: 'Not added', tone: 'bg-red-100 text-red-900' },
  cancelled: { label: 'Withdrawn', tone: 'bg-gray-100 text-gray-700' },
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

export function ImportRequests() {
  const [tab, setTab] = useState<'open' | 'done'>('open')
  const [items, setItems] = useState<QueueItem[] | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  // State is only set once the request settles, never synchronously inside
  // the effect. Callers clear the list first when they want a spinner.
  const fetchQueue = useCallback((kind: 'open' | 'done') =>
    api<{ requests: QueueItem[] }>(`/api/requests?status=${kind}`)
      .then((d) => setItems(d.requests))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load requests')), [])

  useEffect(() => {
    void fetchQueue(tab)
  }, [tab, fetchQueue])

  function reload(kind: 'open' | 'done') {
    setItems(null)
    setError('')
    void fetchQueue(kind)
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold">Bring my stats requests</h1>
            <p className="mt-1 text-sm text-app-muted">
              Players asked to add their CricHeroes or STUMPS career. Open a request, check it is the same person, then import. The player is told the result.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-app-border p-1">
            {(['open', 'done'] as const).map((k) => (
              <button
                key={k}
                onClick={() => {
                  if (k === tab) return
                  setItems(null)
                  setError('')
                  setOpenId(null)
                  setTab(k)
                }}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${tab === k ? 'bg-app-header text-white' : 'text-app-muted hover:bg-app-surface-alt'}`}
              >
                {k === 'open' ? 'To review' : 'Done'}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {!items && !error && (
          <p className="mt-4 flex items-center gap-2 text-app-muted">
            <Spinner /> Loading…
          </p>
        )}
        {items && items.length === 0 && (
          <p className="mt-4 text-sm text-app-muted">{tab === 'open' ? 'Nothing waiting. New requests appear here.' : 'No decided requests yet.'}</p>
        )}
        {items && items.length > 0 && (
          <ul className="mt-4 space-y-3">
            {items.map((r) => (
              <li key={r.id} className="rounded-xl border border-app-border">
                <button onClick={() => setOpenId(openId === r.id ? null : r.id)} className="flex w-full items-center gap-3 p-3 text-left hover:bg-app-surface-alt">
                  <Initials name={r.profile.displayName} size={40} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold">{r.profile.displayName}</span>
                      <span className="text-xs text-app-muted">#{r.profile.id}</span>
                      <SourceBadge source={r.source} />
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[r.status].tone}`}>{STATUS[r.status].label}</span>
                    </span>
                    <span className="block truncate text-xs text-app-muted">
                      {r.byName ? `Name: "${r.externalRef}"` : `${SOURCE_LABEL[r.source]} ${r.externalRef}`} · sent {fmt(r.createdAt)}
                      {r.decidedAt ? ` · decided ${fmt(r.decidedAt)}` : ''}
                    </span>
                  </span>
                  <span className="text-app-muted">{openId === r.id ? '▴' : '▾'}</span>
                </button>
                {openId === r.id && (
                  <RequestDetail
                    item={r}
                    onDone={() => {
                      setOpenId(null)
                      reload(tab)
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function RequestDetail({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const open = item.status === 'pending' || item.status === 'needs_info'
  const initialRef = item.byName ? null : item.externalRef
  const [ref, setRef] = useState<string | null>(initialRef)
  const [query, setQuery] = useState(item.byName ? item.externalRef : '')
  const [hits, setHits] = useState<Hit[] | null>(null)
  // Start in the loading state the opening effect is about to begin.
  const [searching, setSearching] = useState(open && item.byName)
  const [player, setPlayer] = useState<PlayerPreview | null>(null)
  const [loading, setLoading] = useState(open && !!initialRef)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'' | 'approve' | 'needs_info' | 'reject'>('')
  const [overwriteStats, setOverwriteStats] = useState(false)
  const [linkTeams, setLinkTeams] = useState(false)

  const runSearch = useCallback((q: string) =>
    api<{ results: Hit[] }>(`/api/source/search?source=${item.source}&q=${encodeURIComponent(q.trim())}`)
      .then((d) => setHits(d.results))
      .catch((e) => setError(e instanceof Error ? e.message : 'Search failed'))
      .finally(() => setSearching(false)), [item.source])

  const runFetch = useCallback((r: string) =>
    api<{ player: PlayerPreview }>(`/api/source/player?source=${item.source}&ref=${encodeURIComponent(r)}`)
      .then((d) => setPlayer(d.player))
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not fetch the player'))
      .finally(() => setLoading(false)), [item.source])

  function search(q: string) {
    if (q.trim().length < 2) return
    setSearching(true)
    setError('')
    void runSearch(q)
  }

  function pick(r: string) {
    if (r === ref && player) return
    setRef(r)
    setPlayer(null)
    setError('')
    setLoading(true)
    void runFetch(r)
  }

  // On open: an id request fetches its player, a name request searches that name.
  useEffect(() => {
    if (!open) return
    if (initialRef) void runFetch(initialRef)
    else if (item.byName) void runSearch(item.externalRef)
  }, [open, initialRef, item.byName, item.externalRef, runFetch, runSearch])

  async function decide(action: 'approve' | 'needs_info' | 'reject') {
    setBusy(action)
    setError('')
    try {
      await api(`/api/requests/${item.id}`, {
        method: 'POST',
        body: JSON.stringify(
          action === 'approve'
            ? { action, ref, fields: overwriteStats ? { stats: 'overwrite' } : {}, linkTeams, note: note || undefined }
            : { action, note },
        ),
      })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="space-y-4 border-t border-app-border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Box title="ProStream profile (stats go here)">
          <Line k="Name" v={item.profile.displayName} />
          <Line k="Profile" v={`#${item.profile.id}${item.profile.publicCode ? ` · ${item.profile.publicCode}` : ''}`} />
          <Line k="City" v={item.profile.cityName} />
          <Line k="Mobile" v={item.profile.mobile} />
          <Line k="Account" v={item.requester.displayName ? `${item.requester.displayName}${item.requester.username ? ` (@${item.requester.username})` : ''}` : null} />
          {item.profile.externalId && <Line k="Linked" v={`${item.profile.source} ${item.profile.externalId}`} />}
        </Box>
        <Box title="What the player sent">
          <Line k="Source" v={SOURCE_LABEL[item.source]} />
          <Line k={item.byName ? 'Name' : 'ID'} v={item.externalRef} />
          {!item.byName && (
            <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
              Open on {SOURCE_LABEL[item.source]} ↗
            </a>
          )}
          {item.playerNote && <p className="mt-2 rounded-lg bg-app-surface-alt px-2 py-1.5 text-sm">“{item.playerNote}”</p>}
          {item.adminNote && <p className="mt-2 text-xs text-app-muted">Admin note: {item.adminNote}</p>}
        </Box>
      </div>

      {item.heldBy && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This {SOURCE_LABEL[item.source]} account is already on #{item.heldBy.id} {item.heldBy.name}. Importing is blocked until that is resolved.
        </p>
      )}

      {open && item.byName && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Find the right CricHeroes player</p>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void search(query)
            }}
            className="flex gap-2"
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, CricHeroes id, or profile URL"
              className="min-w-0 flex-1 rounded-lg border border-app-border px-3 py-1.5 text-sm outline-none focus:border-primary"
            />
            <button className="rounded-lg border border-app-border px-3 py-1.5 text-sm font-medium hover:bg-app-surface-alt">{searching ? '…' : 'Search'}</button>
          </form>
          {hits && hits.length === 0 && <p className="text-sm text-app-muted">No CricHeroes players found. Ask the player for their profile link.</p>}
          {hits && hits.length > 0 && (
            <ul className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
              {hits.map((h) => (
                <li key={h.ref}>
                  <button
                    onClick={() => pick(h.ref)}
                    className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left text-sm ${ref === h.ref ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-app-border hover:border-primary'}`}
                  >
                    <Initials name={h.name} size={32} />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {h.name} {h.verified && <span className="text-xs text-primary">✓</span>}
                      </span>
                      <span className="block truncate text-xs text-app-muted">{h.subtitle ?? `CricHeroes ${h.ref}`}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {open && loading && (
        <p className="flex items-center gap-2 text-sm text-app-muted">
          <Spinner /> Fetching from {SOURCE_LABEL[item.source]}…
        </p>
      )}
      {open && player && <Preview player={player} />}

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {open && (
        <div className="space-y-3 rounded-xl border border-app-border p-3">
          {player && (
            <div className="space-y-1 text-sm">
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={overwriteStats} onChange={(e) => setOverwriteStats(e.target.checked)} className="mt-0.5 accent-primary" />
                <span>Replace stats already on this profile from another source (off: only fills empty fields and refreshes the same source)</span>
              </label>
              {player.teams.length > 0 && (
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={linkTeams} onChange={(e) => setLinkTeams(e.target.checked)} className="mt-0.5 accent-primary" />
                  <span>Also add their {player.teams.length} team{player.teams.length === 1 ? '' : 's'} to the team directory</span>
                </label>
              )}
            </div>
          )}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 400))}
            rows={2}
            placeholder="Message for the player (needed to ask for info or reject)"
            className="w-full rounded-lg border border-app-border px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => decide('approve')}
              disabled={!!busy || !player || !!item.heldBy}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {busy === 'approve' && <Spinner />} Import to #{item.profile.id} and approve
            </button>
            <button
              onClick={() => decide('needs_info')}
              disabled={!!busy || !note.trim()}
              className="rounded-lg border border-app-border px-4 py-2 text-sm font-semibold hover:bg-app-surface-alt disabled:opacity-50"
            >
              {busy === 'needs_info' ? 'Sending…' : 'Ask for more info'}
            </button>
            <button
              onClick={() => decide('reject')}
              disabled={!!busy || !note.trim()}
              className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {busy === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
          {!player && !loading && (
            <p className="text-xs text-app-muted">{item.byName ? 'Pick the CricHeroes player above to fetch their stats.' : 'The stats must load before you can import.'}</p>
          )}
        </div>
      )}
    </div>
  )
}

function Preview({ player }: { player: PlayerPreview }) {
  const [tab, setTab] = useState<'batting' | 'bowling' | 'fielding'>('batting')
  return (
    <div className="rounded-xl border border-app-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SourceBadge source={player.source} />
        <span className="font-semibold">{player.name}</span>
        {player.cityName && <span className="text-sm text-app-muted">· {player.cityName}</span>}
        {player.matchQuality === 'best-effort' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Best-effort match</span>}
        <a href={player.profileUrl} target="_blank" rel="noreferrer" className="ml-auto text-xs text-accent hover:underline">
          View on {SOURCE_LABEL[player.source]} ↗
        </a>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {([['Matches', player.summary.matches], ['Runs', player.summary.runs], ['Wickets', player.summary.wickets]] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg bg-app-surface-alt py-1.5">
            <dt className="text-[11px] tracking-wide text-app-muted uppercase">{k}</dt>
            <dd className="font-bold">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex gap-2">
        {(['batting', 'bowling', 'fielding'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${tab === t ? 'bg-app-header text-white' : 'bg-app-surface-alt text-app-muted'}`}>
            {t}
          </button>
        ))}
      </div>
      <StatsTable items={player.careerStats[tab]} />
    </div>
  )
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-app-surface-alt p-3">
      <p className="mb-2 text-xs font-semibold tracking-wide text-app-muted uppercase">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Line({ k, v }: { k: string; v: string | null }) {
  return (
    <p className="flex gap-2 text-sm">
      <span className="w-16 shrink-0 text-app-muted">{k}</span>
      <span className="min-w-0 break-words">{v || <span className="text-app-muted">none</span>}</span>
    </p>
  )
}
