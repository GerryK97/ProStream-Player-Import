import { NextRequest, NextResponse } from 'next/server'
import { jsonError, withSession } from '@/lib/api'
import { isSource, fetchScrapedPlayer } from '@/lib/scrape'
import { suggestMatches } from '@/lib/directory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/source/player?source=...&ref=...
 * Scrape one player and return the normalised preview plus likely ProStream
 * profiles it should be uploaded to. Nothing is written.
 */
export const GET = withSession(async (_user, req: NextRequest) => {
  const source = req.nextUrl.searchParams.get('source')
  const ref = req.nextUrl.searchParams.get('ref')?.trim()
  if (!isSource(source)) return jsonError(400, 'Unknown source')
  if (!ref) return jsonError(400, 'Missing player reference')
  const player = await fetchScrapedPlayer(source, ref)
  const matches = await suggestMatches(player.name, player.source, player.externalId)
  // The raw payload is large and only needed server-side at publish time.
  const { raw: _raw, ...preview } = player
  void _raw
  return NextResponse.json({ player: preview, matches })
})
