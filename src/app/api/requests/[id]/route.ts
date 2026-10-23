import { NextRequest, NextResponse } from 'next/server'
import { jsonError, withSession } from '@/lib/api'
import { assertSourceWritable } from '@/lib/capabilities'
import { getProfile } from '@/lib/directory'
import { publishPlayer } from '@/lib/publish'
import { parsePublishOptions } from '@/lib/publishInput'
import { approvalRef, getRequest, normalizeAdminNote, resolveRequest, RequestStateError } from '@/lib/requests'
import { fetchScrapedPlayer } from '@/lib/scrape'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/requests/:id
 *   { action: 'approve', ref?, fields?, linkTeams? }  import into the requester's profile, mark Added
 *   { action: 'needs_info' | 'reject', note }          ask the player, or decline
 *
 * Approve always imports into the request's own ProStream profile (never one
 * the browser chooses) and re-fetches the outside player on the server. `ref`
 * is only needed when the player gave a CricHeroes name: it is the CricHeroes
 * player the Admin picked from the search.
 */
export const POST = withSession(async (user, req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const id = Number((await ctx.params).id)
  if (!Number.isInteger(id) || id <= 0) return jsonError(400, 'Invalid request id')
  const body = (await req.json()) as Record<string, unknown>
  const action = body.action
  const note = normalizeAdminNote(body.note)

  const request = await getRequest(id)
  if (!request) return jsonError(404, 'Request not found')

  try {
    if (action === 'needs_info' || action === 'reject') {
      const updated = await resolveRequest(id, user.id, action, note)
      return NextResponse.json({ request: updated })
    }
    if (action !== 'approve') return jsonError(400, 'Unknown action')
    if (request.status !== 'pending' && request.status !== 'needs_info') return jsonError(409, 'This request was already decided')

    // A name request must be resolved to one real CricHeroes player first.
    const ref = approvalRef(request, body.ref)
    if (!ref) return jsonError(400, 'Pick the CricHeroes player from the search before importing')

    let options
    try {
      options = parsePublishOptions(body)
    } catch (err) {
      return jsonError(400, err instanceof Error ? err.message : 'Invalid request')
    }
    await assertSourceWritable(request.source)
    const player = await fetchScrapedPlayer(request.source, ref)
    // publishPlayer refuses (409) when this outside account already sits on
    // another ProStream profile, so one account never lands on two players.
    const result = await publishPlayer(player, request.directoryPlayerId, user, options)
    const updated = await resolveRequest(id, user.id, 'approve', note, { ref: player.externalId, url: player.profileUrl })
    console.info('[request]', user.username, 'approved', id, request.source, player.externalId, '->', result.playerDirectoryId, result.updatedFields.join(','))
    return NextResponse.json({ request: updated, result, profile: await getProfile(result.playerDirectoryId) })
  } catch (err) {
    if (err instanceof RequestStateError) return jsonError(409, err.message)
    throw err
  }
})
