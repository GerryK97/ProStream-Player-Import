/** Pull a numeric id out of a raw id or a cricheroes.com profile URL. */
export function parseCricHeroesId(input: string, kind: 'player' | 'team'): number | null {
  const s = input.trim()
  if (/^\d+$/.test(s)) return Number(s)
  const re = kind === 'player' ? /player-profile\/(\d+)/ : /team-profile\/(\d+)/
  const m = s.match(re)
  return m ? Number(m[1]) : null
}
