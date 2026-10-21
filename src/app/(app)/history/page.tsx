'use client'

import { useEffect, useState } from 'react'
import { api, ROLE_LABEL, type DirectoryProfile } from '@/components/client'
import { Initials, SourceBadge, Spinner } from '@/components/ui'

export default function HistoryPage() {
  const [rows, setRows] = useState<DirectoryProfile[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api<{ results: DirectoryProfile[] }>('/api/directory/recent')
      .then((d) => setRows(d.results))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
  }, [])

  return (
    <section className="rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm">
      <h1 className="text-xl font-bold">Recent imports</h1>
      <p className="mt-1 text-sm text-app-muted">ProStream profiles most recently updated from CricHeroes or STUMPS.</p>
      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      {!rows && !error && (
        <p className="mt-4 flex items-center gap-2 text-app-muted">
          <Spinner /> Loading…
        </p>
      )}
      {rows && rows.length === 0 && <p className="mt-4 text-sm text-app-muted">Nothing imported yet.</p>}
      {rows && rows.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-app-muted">
              <tr className="border-b border-app-border">
                <th className="py-2 pr-3 font-medium">Player</th>
                <th className="py-2 pr-3 font-medium">Source</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Teams</th>
                <th className="py-2 pr-3 font-medium">Stats</th>
                <th className="py-2 font-medium">Imported</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-app-border last:border-0">
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <Initials name={p.displayName} size={32} />
                      <div>
                        <div className="font-semibold">{p.displayName}</div>
                        <div className="text-xs text-app-muted">
                          #{p.id}
                          {p.publicCode ? ` · ${p.publicCode}` : ''}
                          {p.hasLogin ? ' · has login' : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <SourceBadge source={p.source} />
                  </td>
                  <td className="py-2 pr-3">{ROLE_LABEL[p.role ?? ''] ?? '—'}</td>
                  <td className="max-w-[16rem] truncate py-2 pr-3 text-app-muted">{p.teams.join(', ') || '—'}</td>
                  <td className="py-2 pr-3">{p.hasStats ? '✓' : '—'}</td>
                  <td className="py-2 whitespace-nowrap text-app-muted">{p.importedAt ? new Date(p.importedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
