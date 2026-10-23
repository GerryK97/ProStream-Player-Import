// Pure rules for the "Bring my stats" queue. No database or server imports,
// so they are unit-testable.

/** A CricHeroes reference that is a name, not a numeric id. */
export function isNameRef(source: string, ref: string): boolean {
  return source === 'cricheroes' && !/^\d+$/.test(ref.trim())
}

/**
 * Which outside account an approval imports. A request that holds an id or
 * link uses it (or a corrected one the Admin picked). A CricHeroes name
 * request has no account yet, so the Admin must pick one from the search.
 * Returns null when there is nothing safe to import.
 */
export function approvalRef(request: { source: string; externalRef: string }, picked: unknown): string | null {
  const p = typeof picked === 'string' ? picked.trim() : ''
  const ref = isNameRef(request.source, request.externalRef) ? p : p || request.externalRef
  if (!ref || isNameRef(request.source, ref)) return null
  return ref
}

export function normalizeAdminNote(v: unknown): string | null {
  return typeof v === 'string' ? v.trim().slice(0, 400) || null : null
}
