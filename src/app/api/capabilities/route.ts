import { NextResponse } from 'next/server'
import { withSession } from '@/lib/api'
import { getCapabilities } from '@/lib/capabilities'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withSession(async () => NextResponse.json(await getCapabilities(true)))
