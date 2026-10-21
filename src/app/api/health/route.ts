import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Liveness + database reachability, for Dokploy / uptime checks. No auth, no data. */
export async function GET() {
  try {
    await getDb().execute(sql`SELECT 1`)
    return NextResponse.json({ ok: true, db: true })
  } catch {
    return NextResponse.json({ ok: false, db: false }, { status: 503 })
  }
}
