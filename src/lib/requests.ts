// "Bring my stats" queue, worked by an Admin in this app.
//
// A profile owner sends a request from the ProStream app (Scoreboard
// /api/directory/players/me/import-requests). It lands in the shared
// player_import_requests table. Here the Admin opens it, fetches the outside
// profile, imports it into the requester's own ProStream profile, and the
// request is marked Added and the player notified, in one step.
//
// For CricHeroes the player may have given only a name. Then external_ref is
// that name and the Admin picks the right CricHeroes player from a search
// before importing; the request is updated to the real id.

import 'server-only'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from './db'
import { devicePushTokens, notifications, playerDirectory, playerImportRequests, users, type PlayerImportRequestRow } from './db/schema'
import { isNameRef } from './requestRules'

export { approvalRef, isNameRef, normalizeAdminNote } from './requestRules'

export type RequestStatus = PlayerImportRequestRow['status']
export const OPEN_STATUSES: RequestStatus[] = ['pending', 'needs_info']
export const DONE_STATUSES: RequestStatus[] = ['imported', 'rejected', 'cancelled']

const SOURCE_LABEL = { cricheroes: 'CricHeroes', stumps: 'STUMPS' } as const

export type QueueItem = {
  id: number
  source: 'cricheroes' | 'stumps'
  externalRef: string
  sourceUrl: string
  byName: boolean
  status: RequestStatus
  playerNote: string | null
  adminNote: string | null
  createdAt: string
  updatedAt: string
  decidedAt: string | null
  requester: { id: string; username: string | null; displayName: string | null }
  profile: {
    id: number
    displayName: string
    cityName: string | null
    mobile: string | null
    publicCode: string | null
    source: string
    externalId: string | null
  }
  /** Another profile already holds this outside id (approve would be refused). */
  heldBy: { id: number; name: string } | null
}

export async function hasRequestsTable(): Promise<boolean> {
  const res = await getDb().execute(sql`select to_regclass('player_import_requests') is not null as ok`)
  return Boolean((res.rows?.[0] as { ok?: boolean } | undefined)?.ok)
}

export async function listRequests(kind: 'open' | 'done'): Promise<QueueItem[]> {
  const db = getDb()
  const statuses = kind === 'open' ? OPEN_STATUSES : DONE_STATUSES
  const rows = await db
    .select({
      r: playerImportRequests,
      pId: playerDirectory.id,
      pName: playerDirectory.displayName,
      pCity: playerDirectory.cityName,
      pMobile: playerDirectory.mobile,
      pCode: playerDirectory.publicCode,
      pSource: playerDirectory.source,
      pExternalId: playerDirectory.externalId,
      uUsername: users.username,
      uName: users.displayName,
    })
    .from(playerImportRequests)
    .innerJoin(playerDirectory, eq(playerDirectory.id, playerImportRequests.directoryPlayerId))
    .leftJoin(users, eq(users.id, playerImportRequests.requesterUserId))
    .where(inArray(playerImportRequests.status, statuses))
    .orderBy(kind === 'open' ? asc(playerImportRequests.updatedAt) : desc(playerImportRequests.decidedAt))
    .limit(100)

  const idRefs = rows.filter((x) => !isNameRef(x.r.source, x.r.externalRef)).map((x) => x.r.externalRef)
  const holders = idRefs.length
    ? await db
      .select({ id: playerDirectory.id, name: playerDirectory.displayName, source: playerDirectory.source, externalId: playerDirectory.externalId })
      .from(playerDirectory)
      .where(inArray(playerDirectory.externalId, [...new Set(idRefs)]))
    : []

  return rows.map(({ r, ...p }) => {
    const h = isNameRef(r.source, r.externalRef)
      ? undefined
      : holders.find((x) => x.source === r.source && x.externalId === r.externalRef && x.id !== r.directoryPlayerId)
    return {
      id: r.id,
      source: r.source,
      externalRef: r.externalRef,
      sourceUrl: r.sourceUrl,
      byName: isNameRef(r.source, r.externalRef),
      status: r.status,
      playerNote: r.playerNote,
      adminNote: r.adminNote,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      requester: { id: r.requesterUserId, username: p.uUsername ?? null, displayName: p.uName ?? null },
      profile: {
        id: p.pId,
        displayName: p.pName,
        cityName: p.pCity,
        mobile: p.pMobile,
        publicCode: p.pCode,
        source: String(p.pSource),
        externalId: p.pExternalId,
      },
      heldBy: h ? { id: h.id, name: h.name } : null,
    }
  })
}

export async function getRequest(id: number): Promise<PlayerImportRequestRow | null> {
  const [row] = await getDb().select().from(playerImportRequests).where(eq(playerImportRequests.id, id)).limit(1)
  return row ?? null
}

export class RequestStateError extends Error {}

/**
 * Close an open request. Approve also records the outside id that was actually
 * imported, so a name request ends up pointing at a real account.
 */
export async function resolveRequest(
  id: number,
  adminId: string,
  action: 'approve' | 'needs_info' | 'reject',
  note: string | null,
  importedRef?: { ref: string; url: string },
): Promise<PlayerImportRequestRow> {
  if ((action === 'needs_info' || action === 'reject') && !note) {
    throw new RequestStateError('Add a message for the player')
  }
  const next: RequestStatus = action === 'approve' ? 'imported' : action === 'needs_info' ? 'needs_info' : 'rejected'
  const final = action !== 'needs_info'
  const [updated] = await getDb()
    .update(playerImportRequests)
    .set({
      status: next,
      ...(note ? { adminNote: note } : {}),
      ...(importedRef ? { externalRef: importedRef.ref, sourceUrl: importedRef.url } : {}),
      decidedBy: adminId,
      ...(final ? { decidedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(playerImportRequests.id, id), inArray(playerImportRequests.status, OPEN_STATUSES)))
    .returning()
  if (!updated) throw new RequestStateError('This request was already decided')

  void notifyPlayer(updated.requesterUserId, action, updated.source, note, updated.id, updated.directoryPlayerId)
  return updated
}

/** Inbox row plus Expo push, the same shape the Scoreboard sends. Never throws. */
async function notifyPlayer(
  userId: string,
  action: 'approve' | 'needs_info' | 'reject',
  source: 'cricheroes' | 'stumps',
  note: string | null,
  requestId: number,
  playerId: number,
) {
  const label = SOURCE_LABEL[source]
  const title = action === 'approve' ? `${label} stats added` : action === 'needs_info' ? `${label} request needs more info` : `${label} stats not added`
  const body = action === 'approve'
    ? `Your ${label} stats are now on your ProStream profile.`
    : note ?? (action === 'needs_info' ? 'An Admin needs more information.' : 'An Admin could not add these stats.')
  const data = { importRequestId: requestId, playerId, screen: 'import-requests', type: 'player_claim_decision' }
  const db = getDb()
  try {
    await db.insert(notifications).values({ userId, type: 'player_claim_decision', title, body, data: JSON.stringify(data) })
  } catch (err) {
    console.error('[requests] inbox notification failed', err)
  }
  try {
    const tokens = (await db.select({ t: devicePushTokens.expoPushToken }).from(devicePushTokens).where(eq(devicePushTokens.userId, userId)))
      .map((r) => r.t)
      .filter((t) => /^Expo(nent)?PushToken\[.+\]$/.test(t))
    if (!tokens.length) return
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, sound: 'default', title, body, data }))),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    console.error('[requests] push failed', err)
  }
}
