import { NextRequest, NextResponse } from 'next/server'
import { jsonError, withSession } from '@/lib/api'
import { assertSourceWritable } from '@/lib/capabilities'
import { linkRosterMember, publishPlayer } from '@/lib/publish'
import { parsePublishOptions } from '@/lib/publishInput'
import { fetchScrapedPlayer, fetchTeamRoster } from '@/lib/scrape'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/publish/team-member
 * { teamRef, teamDirectoryId, playerRef, fields? }
 *
 * Import one roster member as a full profile (create or re-sync on its
 * CricHeroes id) and link it to the team. The client calls this once per
 * selected member so progress is visible and one failure never aborts the rest.
 */
export const POST = withSession(async (user, req: NextRequest) => {
  const body = (await req.json()) as Record<string, unknown>
  const teamDirectoryId = Number(body.teamDirectoryId)
  if (!Number.isInteger(teamDirectoryId) || teamDirectoryId <= 0) return jsonError(400, 'Invalid team id')
  if (typeof body.playerRef !== 'string' || typeof body.teamRef !== 'string') return jsonError(400, 'Missing references')
  let options
  try {
    options = parsePublishOptions(body)
  } catch (err) {
    return jsonError(400, err instanceof Error ? err.message : 'Invalid request')
  }
  await assertSourceWritable('cricheroes')

  const { members } = await fetchTeamRoster(body.teamRef)
  const member = members.find((m) => m.externalId === body.playerRef)
  if (!member) return jsonError(404, 'That player is not on this team roster')

  const player = await fetchScrapedPlayer('cricheroes', member.externalId)
  const result = await publishPlayer(player, null, user, { ...options, linkTeams: false })
  await linkRosterMember('cricheroes', teamDirectoryId, result.playerDirectoryId, member)
  return NextResponse.json({ result })
})
