import { NextRequest, NextResponse } from 'next/server'
import { withSession } from '@/lib/api'
import { searchDirectory } from '@/lib/directory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withSession(async (_user, req: NextRequest) => {
  const q = req.nextUrl.searchParams.get('q') ?? ''
  return NextResponse.json({ results: await searchDirectory(q, 20) })
})
