// Login against the Scoreboard's shared `users` table (same bcrypt hashes), with
// this app's own short-lived session cookie. Only roles in IMPORT_ALLOWED_ROLES
// (default: Admin) may sign in, mirroring the Scoreboard's own rule that only
// Admins may import player data (/api/directory/import).

import 'server-only'
import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { getDb } from './db'
import { users } from './db/schema'

export const SESSION_COOKIE = 'psi_session'
const SESSION_HOURS = 12

export type SessionUser = { id: string; username: string; displayName: string; role: string }

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters)')
  return new TextEncoder().encode(s)
}

export function allowedRoles(): string[] {
  return (process.env.IMPORT_ALLOWED_ROLES || 'Admin')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
}

let cachedDummyHash: string | null = null
function dummyHash(): string {
  cachedDummyHash ??= bcrypt.hashSync('not-a-real-password', 12)
  return cachedDummyHash
}

export async function verifyCredentials(
  usernameRaw: string,
  password: string,
): Promise<{ ok: true; user: SessionUser } | { ok: false; error: string }> {
  const username = usernameRaw.trim().toLowerCase()
  if (!username || !password) return { ok: false, error: 'Username and password are required' }

  const [user] = await getDb().select().from(users).where(eq(users.username, username)).limit(1)
  // Always run bcrypt so response time does not reveal whether the user exists.
  const hash = user?.passwordHash ?? dummyHash()
  const valid = await bcrypt.compare(password, hash).catch(() => false)
  if (!user || !valid) return { ok: false, error: 'Invalid username or password' }
  if (user.status !== 'Active') return { ok: false, error: 'Account is not active' }
  if (!allowedRoles().includes(user.role)) {
    return { ok: false, error: `Only ${allowedRoles().join(' / ')} accounts can use the importer` }
  }
  return { ok: true, user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } }
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ username: user.username, displayName: user.displayName, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret())
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_HOURS * 3600,
}

/**
 * Current session, re-checked against the database so a suspended or demoted
 * account loses access immediately rather than when the cookie expires.
 */
export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret())
    if (!payload.sub) return null
    const [user] = await getDb()
      .select({ id: users.id, username: users.username, displayName: users.displayName, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1)
    if (!user || user.status !== 'Active' || !allowedRoles().includes(user.role)) return null
    return { id: user.id, username: user.username, displayName: user.displayName, role: user.role }
  } catch {
    return null
  }
}

export class AuthError extends Error {}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession()
  if (!session) throw new AuthError('Unauthorized')
  return session
}
