import { NextRequest, NextResponse } from 'next/server'
import { jsonError, withSession } from '@/lib/api'
import { hasRequestsTable, listRequests } from '@/lib/requests'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/requests?status=open|done : the "Bring my stats" queue. */
export const GET = withSession(async (_user, req: NextRequest) => {
  if (!(await hasRequestsTable())) {
    return jsonError(412, 'The requests table is missing. Apply Scoreboard migration 0077_player_import_requests.sql.')
  }
  const kind = req.nextUrl.searchParams.get('status') === 'done' ? 'done' : 'open'
  return NextResponse.json({ requests: await listRequests(kind) })
})
