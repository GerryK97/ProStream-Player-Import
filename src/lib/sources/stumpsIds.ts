/**
 * Accepts a STUMPS player id (`ahan5390`), an internal key (`-Og0ngaOURQpDbTTOeQL`),
 * a profile URL (`https://stumpsapp.com/player/<key>`) or a free-text name.
 */
export function parseStumpsQuery(input: string): { key?: string; query: string } {
  const s = input.trim()
  const url = s.match(/stumpsapp\.com\/player\/([^/?#\s]+)/i)
  if (url) return { key: decodeURIComponent(url[1]), query: s }
  // Firebase-style push keys start with '-' and are 20 chars.
  if (/^-[A-Za-z0-9_-]{19}$/.test(s)) return { key: s, query: s }
  return { query: s }
}
