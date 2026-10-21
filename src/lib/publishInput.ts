// Validation of the publish request body (shared by the player and team-member routes).
import { PROFILE_FIELDS, type FieldMode, type ProfileField, type PublishOptions } from './publish'

const MODES: FieldMode[] = ['fill', 'overwrite', 'skip']

export function parsePublishOptions(body: Record<string, unknown>): PublishOptions {
  const fields: Partial<Record<ProfileField, FieldMode>> = {}
  const raw = (body.fields ?? {}) as Record<string, unknown>
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('fields must be an object')
  for (const [k, v] of Object.entries(raw)) {
    if (!(PROFILE_FIELDS as readonly string[]).includes(k)) throw new Error(`Unknown field: ${k}`)
    if (!MODES.includes(v as FieldMode)) throw new Error(`Invalid mode for ${k}`)
    fields[k as ProfileField] = v as FieldMode
  }
  return {
    fields,
    linkTeams: body.linkTeams === true,
  }
}

export function parseTargetId(v: unknown): number | null {
  if (v == null || v === '' || v === 'new') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) throw new Error('Invalid target profile id')
  return n
}
