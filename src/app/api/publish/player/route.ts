import { NextRequest, NextResponse } from 'next/server'
import { jsonError, withSession } from '@/lib/api'
import { assertSourceWritable } from '@/lib/capabilities'
import { getProfile } from '@/lib/directory'
import { publishPlayer } from '@/lib/publish'
import { parsePublishOptions, parseTargetId } from '@/lib/publishInput'
import { fetchScrapedPlayer, isSource } from '@/lib/scrape'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/publish/player
 * { source, ref, targetId: number | null, fields?: {field: 'fill'|'overwrite'|'skip'},
 *   linkTeams?: boolean }
 *
 * The player is re-scraped here rather than trusted from the client, so the
 * browser can only choose WHAT to apply, never inject the data itself.
 */
export const POST = withSession(async (user, req: NextRequest) => {
  const body = (await req.json()) as Record<string, unknown>
  if (!isSource(body.source)) return jsonError(400, 'Unknown source')
  if (typeof body.ref !== 'string' || !body.ref.trim()) return jsonError(400, 'Missing player reference')
  let targetId: number | null
  let options
  try {
    targetId = parseTargetId(body.targetId)
    options = parsePublishOptions(body)
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid request')
  }

  await assertSourceWritable(body.source)
  const player = await fetchScrapedPlayer(body.source, body.ref)
  const result = await publishPlayer(player, targetId, user, options)
  console.info('[publish]', user.username, body.source, player.externalId, '->', result.playerDirectoryId, result.updatedFields.join(','))
  return NextResponse.json({ result, profile: await getProfile(result.playerDirectoryId) })
})
