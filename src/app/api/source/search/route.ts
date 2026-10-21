import { NextRequest, NextResponse } from 'next/server'
import { jsonError, withSession } from '@/lib/api'
import { isSource, searchSource, sourceFromUrl } from '@/lib/scrape'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** GET /api/source/search?source=cricheroes|stumps&q=name-or-id-or-url */
export const GET = withSession(async (_user, req: NextRequest) => {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? ''
  const requested = req.nextUrl.searchParams.get('source')
  const source = sourceFromUrl(q) ?? requested
  if (!isSource(source)) return jsonError(400, 'Unknown source')
  if (q.length < 2) return jsonError(400, 'Type at least 2 characters')
  return NextResponse.json({ source, results: await searchSource(source, q) })
})
