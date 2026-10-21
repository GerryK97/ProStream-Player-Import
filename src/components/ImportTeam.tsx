'use client'

import { useState } from 'react'
import { api } from './client'
import { Initials, Spinner } from './ui'

type TeamHit = { ref: string; name: string; subtitle: string | null }
type Member = {
  externalId: string
  name: string
  role: string | null
  isCaptain: boolean
  isAdmin: boolean
  roleSkill: string | null
  existing: { id: number; isStub: boolean } | null
}
type Status = { state: 'pending' | 'running' | 'done' | 'failed'; message?: string; id?: number }

const CONCURRENCY = 2

export function ImportTeam() {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<TeamHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')

  const [teamRef, setTeamRef] = useState<string | null>(null)
  const [team, setTeam] = useState<{ name: string; cityName: string | null } | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [loadingTeam, setLoadingTeam] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [overwrite, setOverwrite] = useState(false)
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [running, setRunning] = useState(false)

  async function search(e: React.FormEvent) {
    e.preventDefault()
    setSearching(true)
    setError('')
    try {
      const data = await api<{ results: TeamHit[] }>(`/api/source/team-search?q=${encodeURIComponent(q)}`)
      setHits(data.results)
      if (data.results.length === 1) void openTeam(data.results[0].ref)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  async function openTeam(ref: string) {
    setTeamRef(ref)
    setLoadingTeam(true)
    setStatus({})
    setError('')
    try {
      const data = await api<{ team: { name: string; cityName: string | null }; members: Member[] }>(`/api/source/team?ref=${encodeURIComponent(ref)}`)
      setTeam(data.team)
      setMembers(data.members)
      setSelected(new Set(data.members.map((m) => m.externalId)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load team')
      setTeam(null)
    } finally {
      setLoadingTeam(false)
    }
  }

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function run() {
    if (!teamRef) return
    setRunning(true)
    setError('')
    try {
      const { teamDirectoryId } = await api<{ teamDirectoryId: number }>('/api/publish/team', { method: 'POST', body: JSON.stringify({ ref: teamRef }) })
      const queue = members.filter((m) => selected.has(m.externalId))
      setStatus(Object.fromEntries(queue.map((m) => [m.externalId, { state: 'pending' } as Status])))
      const mode = overwrite ? 'overwrite' : 'fill'
      let idx = 0
      const worker = async () => {
        while (idx < queue.length) {
          const m = queue[idx++]
          setStatus((s) => ({ ...s, [m.externalId]: { state: 'running' } }))
          try {
            const data = await api<{ result: { playerDirectoryId: number; created: boolean } }>('/api/publish/team-member', {
              method: 'POST',
              body: JSON.stringify({
                teamRef,
                teamDirectoryId,
                playerRef: m.externalId,
                fields: { name: mode, cityName: mode, dob: mode, role: mode, battingStyle: mode, bowlingStyle: mode, statement: mode, stats: 'overwrite' },
              }),
            })
            const r = data.result
            setStatus((s) => ({
              ...s,
              [m.externalId]: { state: 'done', id: r.playerDirectoryId, message: r.created ? 'created' : 'updated' },
            }))
          } catch (err) {
            setStatus((s) => ({ ...s, [m.externalId]: { state: 'failed', message: err instanceof Error ? err.message : 'failed' } }))
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setRunning(false)
    }
  }

  const done = Object.values(status).filter((s) => s.state === 'done').length
  const failed = Object.values(status).filter((s) => s.state === 'failed').length
  const total = Object.keys(status).length

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm">
        <h1 className="text-xl font-bold">Import a team roster</h1>
        <p className="mt-1 text-sm text-app-muted">
          Pull a CricHeroes team with every member&apos;s profile data and career stats into the ProStream player and team directories. Members already imported are
          updated in place, never duplicated. (STUMPS does not publish team rosters, so team import is CricHeroes only.)
        </p>
        <form onSubmit={search} className="mt-4 flex gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Team name, CricHeroes team id, or team URL"
            className="min-w-0 flex-1 rounded-lg border border-app-border px-3 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <button disabled={searching || q.trim().length < 2} className="rounded-lg bg-primary px-5 py-2 font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>
        {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
        {hits && hits.length === 0 && <p className="mt-3 text-sm text-app-muted">No teams found.</p>}
        {hits && hits.length > 1 && (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {hits.map((h) => (
              <li key={h.ref}>
                <button
                  onClick={() => openTeam(h.ref)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left hover:border-primary ${teamRef === h.ref ? 'border-primary bg-primary/5' : 'border-app-border'}`}
                >
                  <Initials name={h.name} size={40} rounded="xl" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{h.name}</span>
                    <span className="block truncate text-xs text-app-muted">{h.subtitle ?? h.ref}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {loadingTeam && (
        <div className="flex items-center gap-3 rounded-2xl border border-app-border bg-app-surface p-6 text-app-muted">
          <Spinner /> Loading roster…
        </div>
      )}

      {team && !loadingTeam && (
        <section className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-4">
            <Initials name={team.name} size={56} rounded="xl" />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold">{team.name}</h2>
              <p className="text-sm text-app-muted">
                {members.length} members{team.cityName ? ` · ${team.cityName}` : ''} · {members.filter((m) => m.existing && !m.existing.isStub).length} already in ProStream
              </p>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <button className="text-accent hover:underline" onClick={() => setSelected(new Set(members.map((m) => m.externalId)))}>
                Select all
              </button>
              <button className="text-accent hover:underline" onClick={() => setSelected(new Set(members.filter((m) => !m.existing || m.existing.isStub).map((m) => m.externalId)))}>
                Only new
              </button>
              <button className="text-accent hover:underline" onClick={() => setSelected(new Set())}>
                None
              </button>
            </div>
          </div>

          <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((m) => {
              const st = status[m.externalId]
              return (
                <li key={m.externalId}>
                  <label className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 ${selected.has(m.externalId) ? 'border-primary/60 bg-primary/5' : 'border-app-border'}`}>
                    <input type="checkbox" className="accent-primary" checked={selected.has(m.externalId)} disabled={running} onChange={() => toggle(m.externalId)} />
                    <Initials name={m.name} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {m.name}
                        {m.isCaptain && <span className="ml-1 text-xs text-amber-600">(C)</span>}
                      </span>
                      <span className="block truncate text-xs text-app-muted">
                        {st?.state === 'running' ? (
                          <span className="inline-flex items-center gap-1 text-accent">
                            <Spinner className="h-3 w-3" /> importing
                          </span>
                        ) : st?.state === 'done' ? (
                          <span className="text-primary-dark">✓ #{st.id} {st.message}</span>
                        ) : st?.state === 'failed' ? (
                          <span className="text-red-700" title={st.message}>✕ {st.message}</span>
                        ) : st?.state === 'pending' ? (
                          'queued'
                        ) : m.existing && !m.existing.isStub ? (
                          `in ProStream #${m.existing.id}`
                        ) : (
                          'new'
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>

          <div className="mt-5 flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-primary" checked={overwrite} disabled={running} onChange={(e) => setOverwrite(e.target.checked)} />
              Replace existing profile details (default: only fill empty fields)
            </label>
            <button
              onClick={run}
              disabled={running || selected.size === 0}
              className="ml-auto flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {running && <Spinner />}
              {running ? `Importing ${done + failed}/${total}…` : `Import ${selected.size} player${selected.size === 1 ? '' : 's'}`}
            </button>
          </div>
          {!running && total > 0 && (
            <p className="mt-3 text-sm text-app-muted">
              Finished: {done} imported{failed ? `, ${failed} failed (re-run to retry)` : ''}.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
