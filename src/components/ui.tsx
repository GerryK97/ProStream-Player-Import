'use client'

import type { Source } from './client'
import { SOURCE_LABEL } from './client'

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`} aria-hidden />
}

export function SourceBadge({ source }: { source: Source | string }) {
  const tone =
    source === 'cricheroes' ? 'bg-cricheroes/10 text-cricheroes' : source === 'stumps' ? 'bg-stumps/10 text-stumps' : 'bg-gray-100 text-gray-700'
  const label = (SOURCE_LABEL as Record<string, string>)[source] ?? (source === 'manual' ? 'ProStream' : source)
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
}

/** Initials badge. The importer is data-only, so no remote images are loaded. */
export function Initials({ name, size = 44, rounded = 'full' }: { name: string; size?: number; rounded?: 'full' | 'xl' }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
  return (
    <span
      style={{ width: size, height: size, fontSize: size / 2.8 }}
      className={`flex shrink-0 items-center justify-center bg-app-header font-bold text-white ${rounded === 'full' ? 'rounded-full' : 'rounded-xl'}`}
    >
      {initials || '?'}
    </span>
  )
}

export function StatsTable({ items }: { items: Array<{ title: string; value: string | number }> }) {
  if (!items?.length) return <p className="mt-3 text-sm text-app-muted">No statistics on record.</p>
  return (
    <dl className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
      {items.map((i) => (
        <div key={i.title} className="rounded-lg border border-app-border px-2 py-1.5">
          <dt className="truncate text-[11px] text-app-muted">{i.title}</dt>
          <dd className="font-semibold tabular-nums">{String(i.value)}</dd>
        </div>
      ))}
    </dl>
  )
}
