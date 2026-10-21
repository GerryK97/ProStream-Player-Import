import { NextRequest, NextResponse } from 'next/server'
import { and, eq, inArray } from 'drizzle-orm'
import { jsonError, withSession } from '@/lib/api'
import { fetchTeamRoster } from '@/lib/scrape'
import { getDb } from '@/lib/db'
import { playerDirectory } from '@/lib/db/schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/source/team?ref=<CricHeroes team id or URL> — roster preview with which members are already in ProStream. */
export const GET = withSession(async (_user, req: NextRequest) => {
  const ref = req.nextUrl.searchParams.get('ref')?.trim()
  if (!ref) return jsonError(400, 'Missing team reference')
  const { team, members } = await fetchTeamRoster(ref)
  const ids = members.map((m) => m.externalId)
  const existing = ids.length
    ? await getDb()
        .select({ id: playerDirectory.id, externalId: playerDirectory.externalId, isStub: playerDirectory.isStub })
        .from(playerDirectory)
        .where(and(eq(playerDirectory.source, 'cricheroes'), inArray(playerDirectory.externalId, ids)))
    : []
  const byExt = new Map(existing.map((e) => [e.externalId, e]))
  const { raw: _raw, ...teamPreview } = team
  void _raw
  return NextResponse.json({
    team: teamPreview,
    members: members.map((m) => ({ ...m, existing: byExt.get(m.externalId) ?? null })),
  })
})
