// Client-side types and helpers shared by the import screens.
import type { ScrapedPlayer } from '@/lib/normalize'
import type { DirectoryProfile } from '@/lib/directory'

export type { DirectoryProfile }
export type PlayerPreview = Omit<ScrapedPlayer, 'raw'>
export type Source = 'cricheroes' | 'stumps'
export type FieldMode = 'fill' | 'overwrite' | 'skip'

export const SOURCE_LABEL: Record<Source, string> = { cricheroes: 'CricHeroes', stumps: 'STUMPS' }

export const ROLE_LABEL: Record<string, string> = {
  batsman: 'Batter',
  bowler: 'Bowler',
  allrounder: 'All-rounder',
  keeper: 'Wicket-keeper',
}
export const BAT_LABEL: Record<string, string> = { 'right-hand': 'Right-hand bat', 'left-hand': 'Left-hand bat' }
export const BOWL_LABEL: Record<string, string> = {
  'right-arm-fast': 'Right-arm fast',
  'right-arm-medium': 'Right-arm medium',
  'right-arm-offbreak': 'Right-arm off break',
  'right-arm-legbreak': 'Right-arm leg break',
  'left-arm-fast': 'Left-arm fast',
  'left-arm-medium': 'Left-arm medium',
  'left-arm-orthodox': 'Left-arm orthodox',
  'left-arm-chinaman': 'Left-arm wrist spin',
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && typeof window !== 'undefined') {
    window.location.assign(new URL('/login', window.location.origin))
  }
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data)
  return data as T
}
