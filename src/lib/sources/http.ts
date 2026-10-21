// Shared HTTP transport for the source scrapers: per-source rate limiting,
// timeouts and exponential backoff with jitter. Mirrors the behaviour of the
// Python clients (stumps_scraper/client.py, cricheroes.py) so we stay polite
// to both upstream APIs.

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export type FetchOptions = {
  retries?: number
  timeoutMs?: number
}

const MIN_INTERVAL_MS: Record<string, number> = {
  cricheroes: Number(process.env.CRICHEROES_MIN_INTERVAL_MS ?? 250),
  stumps: Number(process.env.STUMPS_MIN_INTERVAL_MS ?? 250),
  image: 0,
}

// A promise chain per source serialises request *starts* so they are spaced by
// at least MIN_INTERVAL_MS, while responses may still overlap.
const queues = new Map<string, Promise<void>>()

function throttle(source: string): Promise<void> {
  const gap = MIN_INTERVAL_MS[source] ?? 250
  if (gap <= 0) return Promise.resolve()
  const prev = queues.get(source) ?? Promise.resolve()
  const next = prev.then(() => new Promise<void>((r) => setTimeout(r, gap)))
  queues.set(source, next)
  return prev
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function politeFetch(
  source: string,
  url: string,
  init: RequestInit = {},
  opts: FetchOptions = {},
): Promise<Response> {
  const retries = opts.retries ?? 3
  const timeoutMs = opts.timeoutMs ?? 20_000
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await throttle(source)
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
      if (res.ok) return res
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      const err = new HttpError(res.status, `HTTP ${res.status} from ${source}${detail ? `: ${detail}` : ''}`)
      // 4xx other than 429 are permanent.
      if (res.status < 500 && res.status !== 429) throw err
      lastError = err
      const retryAfter = Number(res.headers.get('retry-after'))
      if (Number.isFinite(retryAfter) && retryAfter > 0) await sleep(Math.min(retryAfter, 30) * 1000)
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err
      lastError = err
    }
    if (attempt < retries) {
      const delay = 800 * 2 ** attempt
      await sleep(delay + Math.random() * delay * 0.25)
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Request to ${source} failed`)
}
