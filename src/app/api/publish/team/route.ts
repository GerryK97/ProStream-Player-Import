import { NextRequest, NextResponse } from 'next/server'
import { jsonError, withSession } from '@/lib/api'
import { assertSourceWritable } from '@/lib/capabilities'
import { publishTeam } from '@/lib/publish'
import { fetchTeamRoster } from '@/lib/scrape'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** POST /api/publish/team { ref } — create/refresh the CricHeroes team in the team directory. */
export const POST = withSession(async (user, req: NextRequest) => {
  const body = (await req.json()) as { ref?: string }
  if (!body.ref) return jsonError(400, 'Missing team reference')
  await assertSourceWritable('cricheroes')
  const { team } = await fetchTeamRoster(body.ref)
  return NextResponse.json(await publishTeam('cricheroes', team, user))
})
