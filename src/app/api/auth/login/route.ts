import { NextRequest, NextResponse } from 'next/server'
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE, verifyCredentials } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local'
  if (!rateLimit(`login:${ip}`, 10, 15 * 60_000)) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 })
  }
  const body = (await req.json().catch(() => null)) as { username?: string; password?: string } | null
  const result = await verifyCredentials(body?.username ?? '', body?.password ?? '')
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 401 })
  const res = NextResponse.json({ ok: true, user: result.user })
  res.cookies.set(SESSION_COOKIE, await createSessionToken(result.user), sessionCookieOptions)
  return res
}
