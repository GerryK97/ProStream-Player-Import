// Tiny in-memory fixed-window limiter. One container, so process memory is enough.
const buckets = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k)
    return true
  }
  b.count += 1
  return b.count <= max
}
