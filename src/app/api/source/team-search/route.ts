import { NextRequest, NextResponse } from 'next/server'
import { jsonError, withSession } from '@/lib/api'
import { searchTeams } from '@/lib/scrape'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withSession(async (_user, req: NextRequest) => {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return jsonError(400, 'Type at least 2 characters')
  return NextResponse.json({ results: await searchTeams(q) })
})
