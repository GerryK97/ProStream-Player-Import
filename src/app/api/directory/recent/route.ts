import { NextResponse } from 'next/server'
import { withSession } from '@/lib/api'
import { recentImports } from '@/lib/directory'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withSession(async () => NextResponse.json({ results: await recentImports(30) }))
