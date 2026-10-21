// Public codes, identical to ProStream-Scoreboard/src/lib/publicCode.ts: 8 chars
// from a 30-symbol alphabet with ambiguous letters removed (no 0 O 1 I L U).
// Every imported profile gets one so it can be shared/QR-scanned like any other.

import { eq } from 'drizzle-orm'
import type { Executor } from './db'
import { playerDirectory, teamDirectory } from './db/schema'

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
const LENGTH = 8

export function generatePublicCode(length = LENGTH): string {
  let out = ''
  for (let i = 0; i < length; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

export async function allocatePublicCode(kind: 'player' | 'team', db: Executor): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generatePublicCode()
    const table = kind === 'player' ? playerDirectory : teamDirectory
    const [hit] = await db.select({ id: table.id }).from(table).where(eq(table.publicCode, code)).limit(1)
    if (!hit) return code
  }
  return generatePublicCode(LENGTH + 4)
}
