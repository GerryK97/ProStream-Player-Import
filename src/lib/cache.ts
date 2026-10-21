// Short-lived in-memory memo for source lookups. A roster import calls the
// same team endpoint once per member; caching keeps that to one upstream call.
const store = new Map<string, { at: number; value: Promise<unknown> }>()

export function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const hit = store.get(key)
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>
  const value = fn().catch((err) => {
    store.delete(key)
    throw err
  })
  store.set(key, { at: now, value })
  if (store.size > 500) for (const [k, v] of store) if (now - v.at > ttlMs) store.delete(k)
  return value
}
