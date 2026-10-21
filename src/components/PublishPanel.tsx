'use client'

import { useMemo, useState } from 'react'
import {
  api,
  ApiError,
  BAT_LABEL,
  BOWL_LABEL,
  ROLE_LABEL,
  SOURCE_LABEL,
  type DirectoryProfile,
  type FieldMode,
  type PlayerPreview,
} from './client'
import { Initials, SourceBadge, Spinner } from './ui'

type Matches = { linked: DirectoryProfile | null; candidates: DirectoryProfile[] }
type Target = { kind: 'new' } | { kind: 'existing'; profile: DirectoryProfile }

type FieldKey = 'name' | 'cityName' | 'dob' | 'role' | 'battingStyle' | 'bowlingStyle' | 'jerseyNumber' | 'statement' | 'stats'

type PublishResponse = {
  result: {
    playerDirectoryId: number
    created: boolean
    publicCode: string | null
    updatedFields: string[]
    teamsLinked: number
  }
  profile: DirectoryProfile | null
}

const FIELD_LABEL: Record<FieldKey, string> = {
  name: 'Name',
  cityName: 'City',
  dob: 'Date of birth',
  role: 'Role',
  battingStyle: 'Batting style',
  bowlingStyle: 'Bowling style',
  jerseyNumber: 'Jersey number',
  statement: 'Bio / statement',
  stats: 'Career stats',
}

function display(field: FieldKey, v: unknown): string | null {
  if (v == null || v === '') return null
  if (field === 'role') return ROLE_LABEL[String(v)] ?? String(v)
  if (field === 'battingStyle') return BAT_LABEL[String(v)] ?? String(v)
  if (field === 'bowlingStyle') return BOWL_LABEL[String(v)] ?? String(v)
  return String(v)
}

export function PublishPanel({
  player,
  playerRef,
  matches,
  writable,
}: {
  player: PlayerPreview
  playerRef: string
  matches: Matches
  writable: boolean
}) {
  const [target, setTarget] = useState<Target>(matches.linked ? { kind: 'existing', profile: matches.linked } : { kind: 'new' })
  const [modes, setModes] = useState<Partial<Record<FieldKey, FieldMode>>>({})
  const [linkTeams, setLinkTeams] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [conflictId, setConflictId] = useState<number | null>(null)
  const [done, setDone] = useState<PublishResponse | null>(null)

  const [q, setQ] = useState('')
  const [results, setResults] = useState<DirectoryProfile[] | null>(null)
  const [searching, setSearching] = useState(false)

  const current = target.kind === 'existing' ? target.profile : null

  const rows = useMemo(() => {
    const incoming: Record<FieldKey, unknown> = {
      name: player.name,
      cityName: player.cityName,
      dob: player.dob,
      role: player.role,
      battingStyle: player.battingStyle,
      bowlingStyle: player.bowlingStyle,
      jerseyNumber: player.jerseyNumber,
      statement: player.statement,
      stats: player.careerStats.batting.length || player.careerStats.bowling.length ? `${player.summary.matches} matches` : null,
    }
    const existing: Record<FieldKey, unknown> = current
      ? {
          name: current.isStub ? null : current.name,
          cityName: current.cityName,
          dob: current.dob,
          role: current.role,
          battingStyle: current.battingStyle,
          bowlingStyle: current.bowlingStyle,
          jerseyNumber: current.jerseyNumber,
          statement: current.statement,
          stats: current.hasStats ? `${current.statsSource ? SOURCE_LABEL[current.statsSource as 'cricheroes'] ?? current.statsSource : 'imported'} snapshot` : null,
        }
      : ({} as Record<FieldKey, unknown>)
    return (Object.keys(FIELD_LABEL) as FieldKey[]).map((f) => {
      const inc = incoming[f]
      const cur = existing[f]
      const hasIncoming = inc != null && inc !== ''
      const hasCurrent = cur != null && cur !== ''
      const same = hasIncoming && hasCurrent && String(inc) === String(cur)
      // Stats from the same source are refreshed by default.
      const sameSourceStats = f === 'stats' && current?.statsSource === player.source
      const defaultMode: FieldMode = !hasIncoming ? 'skip' : 'fill'
      const mode = modes[f] ?? defaultMode
      const willWrite = hasIncoming && mode !== 'skip' && (mode === 'overwrite' || !hasCurrent || sameSourceStats) && !same
      return { f, inc, cur, hasIncoming, hasCurrent, same, mode, willWrite }
    })
  }, [player, current, modes])

  async function searchDirectory(e?: React.FormEvent) {
    e?.preventDefault()
    setSearching(true)
    try {
      const data = await api<{ results: DirectoryProfile[] }>(`/api/directory/search?q=${encodeURIComponent(q)}`)
      setResults(data.results)
    } finally {
      setSearching(false)
    }
  }

  async function publish() {
    setBusy(true)
    setError('')
    setConflictId(null)
    try {
      const fields: Partial<Record<FieldKey, FieldMode>> = {}
      for (const r of rows) fields[r.f] = r.mode
      const data = await api<PublishResponse>('/api/publish/player', {
        method: 'POST',
        body: JSON.stringify({
          source: player.source,
          ref: playerRef,
          targetId: current?.id ?? null,
          fields,
          linkTeams,
        }),
      })
      setDone(data)
      if (data.profile) setTarget({ kind: 'existing', profile: data.profile })
      setModes({})
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      if (err instanceof ApiError && typeof err.data.existingId === 'number') setConflictId(err.data.existingId)
    } finally {
      setBusy(false)
    }
  }

  const writes = rows.filter((r) => r.willWrite).length
  const candidates = matches.candidates

  return (
    <section className="space-y-5 rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm">
      <div>
        <h2 className="text-lg font-bold">Upload to ProStream</h2>
        <p className="text-sm text-app-muted">Choose the Scoreboard player profile this data belongs to.</p>
      </div>

      {/* ── Target picker ── */}
      <div className="space-y-2">
        {matches.linked && (
          <TargetOption
            active={current?.id === matches.linked.id}
            onClick={() => setTarget({ kind: 'existing', profile: matches.linked! })}
            profile={matches.linked}
            note={`Already linked to this ${SOURCE_LABEL[player.source]} player`}
          />
        )}
        {!matches.linked && (
          <button
            onClick={() => setTarget({ kind: 'new' })}
            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${target.kind === 'new' ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-app-border hover:border-primary'}`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">+</span>
            <span>
              <span className="block font-semibold">Create a new ProStream profile</span>
              <span className="block text-xs text-app-muted">Gets its own public code. Re-importing later updates the same profile.</span>
            </span>
          </button>
        )}
        {candidates.length > 0 && <p className="pt-1 text-xs font-semibold tracking-wide text-app-muted uppercase">Possible matches in ProStream</p>}
        {candidates.map((c) => (
          <TargetOption key={c.id} active={current?.id === c.id} onClick={() => setTarget({ kind: 'existing', profile: c })} profile={c} />
        ))}
        {current && !candidates.some((c) => c.id === current.id) && current.id !== matches.linked?.id && (
          <TargetOption active onClick={() => undefined} profile={current} />
        )}

        <form onSubmit={searchDirectory} className="flex gap-2 pt-1">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find another profile: name, public code or #id"
            className="min-w-0 flex-1 rounded-lg border border-app-border px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
          <button className="rounded-lg border border-app-border px-3 py-1.5 text-sm font-medium hover:bg-app-surface-alt">{searching ? '…' : 'Find'}</button>
        </form>
        {results && (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {results.length === 0 && <p className="text-sm text-app-muted">No profiles found.</p>}
            {results.map((c) => (
              <TargetOption
                key={c.id}
                active={current?.id === c.id}
                onClick={() => {
                  setTarget({ kind: 'existing', profile: c })
                  setResults(null)
                }}
                profile={c}
              />
            ))}
          </div>
        )}
        {matches.linked && target.kind === 'existing' && (
          <p className="text-xs text-app-muted">This {SOURCE_LABEL[player.source]} player can only be linked to one ProStream profile.</p>
        )}
      </div>

      {/* ── Field review ── */}
      <div>
        <h3 className="text-sm font-semibold">What will be uploaded</h3>
        <div className="mt-2 overflow-hidden rounded-xl border border-app-border">
          <table className="w-full text-sm">
            <thead className="bg-app-surface-alt text-left text-xs text-app-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Field</th>
                {current && <th className="px-3 py-2 font-medium">ProStream now</th>}
                <th className="px-3 py-2 font-medium">From {SOURCE_LABEL[player.source]}</th>
                <th className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.f} className={`border-t border-app-border ${r.willWrite ? 'bg-primary/5' : ''}`}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{FIELD_LABEL[r.f]}</td>
                  {current && (
                    <td className="max-w-[10rem] px-3 py-2">
                      <Cell field={r.f} value={r.cur} />
                    </td>
                  )}
                  <td className="max-w-[12rem] px-3 py-2">
                    <Cell field={r.f} value={r.inc} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!r.hasIncoming ? (
                      <span className="text-xs text-app-muted">nothing to add</span>
                    ) : r.same ? (
                      <span className="text-xs text-app-muted">same</span>
                    ) : (
                      <select
                        value={r.mode}
                        onChange={(e) => setModes((m) => ({ ...m, [r.f]: e.target.value as FieldMode }))}
                        className={`rounded-md border px-1.5 py-1 text-xs ${r.willWrite ? 'border-primary text-primary-dark' : 'border-app-border text-app-muted'}`}
                      >
                        {current && r.hasCurrent ? (
                          <>
                            <option value="fill">{r.f === 'stats' && current.statsSource === player.source ? 'Refresh' : 'Keep current'}</option>
                            <option value="overwrite">Replace</option>
                            <option value="skip">Skip</option>
                          </>
                        ) : (
                          <>
                            <option value="fill">Add</option>
                            <option value="skip">Skip</option>
                          </>
                        )}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        {player.teams.length > 0 && (
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={linkTeams} onChange={(e) => setLinkTeams(e.target.checked)} className="mt-0.5 accent-primary" />
            <span>
              Also add their {player.teams.length} {SOURCE_LABEL[player.source]} team{player.teams.length === 1 ? '' : 's'} to the team directory and link them
            </span>
          </label>
        )}
        {current?.hasLogin && (
          <p className="rounded-lg bg-blue-50 px-3 py-2 text-blue-800">This profile belongs to a player login. Only empty fields are filled unless you choose Replace.</p>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
          {conflictId && (
            <button
              className="ml-2 font-semibold underline"
              onClick={async () => {
                const data = await api<{ results: DirectoryProfile[] }>(`/api/directory/search?q=%23${conflictId}`)
                if (data.results[0]) setTarget({ kind: 'existing', profile: data.results[0] })
                setError('')
                setConflictId(null)
              }}
            >
              Switch to #{conflictId}
            </button>
          )}
        </div>
      )}

      {done && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          <p className="font-semibold text-primary-dark">
            {done.result.created ? 'Profile created' : 'Profile updated'} · #{done.result.playerDirectoryId}
            {done.result.publicCode && <span className="ml-2 rounded bg-white px-1.5 py-0.5 font-mono text-xs">{done.result.publicCode}</span>}
          </p>
          <ul className="mt-1 space-y-0.5 text-app-muted">
            <li>Fields written: {done.result.updatedFields.filter((f) => f !== 'created').join(', ') || (done.result.created ? 'all available' : 'none (link refreshed)')}</li>
            {done.result.teamsLinked > 0 && <li>{done.result.teamsLinked} teams linked.</li>}
          </ul>
        </div>
      )}

      <button
        onClick={publish}
        disabled={busy || !writable || (current != null && writes === 0 && !linkTeams)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-white transition hover:bg-primary-dark disabled:opacity-50"
      >
        {busy && <Spinner />}
        {!writable
          ? 'Uploads unavailable for this source'
          : busy
            ? 'Uploading…'
            : current
              ? `Update profile #${current.id}${writes ? ` (${writes} field${writes === 1 ? '' : 's'})` : ''}`
              : 'Create ProStream profile'}
      </button>
    </section>
  )
}

function Cell({ field, value }: { field: FieldKey; value: unknown }) {
  if (value == null || value === '') return <span className="text-app-muted">empty</span>
  const text = display(field, value) ?? ''
  return (
    <span className="line-clamp-2 break-words" title={text}>
      {text}
    </span>
  )
}

function TargetOption({ profile, active, onClick, note }: { profile: DirectoryProfile; active: boolean; onClick: () => void; note?: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition ${active ? 'border-primary bg-primary/5 ring-2 ring-primary/20' : 'border-app-border hover:border-primary'}`}
    >
      <Initials name={profile.displayName} size={44} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-semibold">{profile.displayName}</span>
          <span className="text-xs text-app-muted">#{profile.id}</span>
          <SourceBadge source={profile.source} />
          {profile.hasLogin && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">has login</span>}
        </span>
        <span className="block truncate text-xs text-app-muted">
          {note ??
            ([profile.publicCode, profile.cityName, ROLE_LABEL[profile.role ?? ''], profile.teams.slice(0, 2).join(', ')].filter(Boolean).join(' · ') || 'No details yet')}
        </span>
      </span>
    </button>
  )
}
