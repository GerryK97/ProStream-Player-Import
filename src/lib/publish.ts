// Publish a scraped player into the Scoreboard's player directory.
//
// Two targets:
//   • NEW      — create (or re-sync) a profile keyed on (source, externalId),
//                the same idempotency key the Scoreboard's own CricHeroes
//                importer uses, so re-running never duplicates.
//   • EXISTING — enrich a profile that already exists in ProStream (usually a
//                hand-made 'manual' one, possibly owned by a Player login).
//                The profile adopts the external identity so later re-syncs
//                land on the same row.
//
// Every field is opt-in. By default only EMPTY fields are filled, so nothing a
// player or admin typed in ProStream is overwritten without asking.
//
// Data only: photos and logos are never downloaded or written. Headshots stay
// whatever ProStream already has.

import 'server-only'
import { and, eq, ne, sql } from 'drizzle-orm'
import { getDb, type Executor } from './db'
import { directoryMemberships, playerDirectory, teamDirectory, type NewPlayerDirectoryRow } from './db/schema'
import { deriveShortCode, type ScrapedPlayer, type ScrapedTeamRef } from './normalize'
import { allocatePublicCode } from './publicCode'
import type { SessionUser } from './auth'

export const PROFILE_FIELDS = [
  'name',
  'cityName',
  'dob',
  'role',
  'battingStyle',
  'bowlingStyle',
  'jerseyNumber',
  'statement',
  'stats',
] as const
export type ProfileField = (typeof PROFILE_FIELDS)[number]

export type FieldMode = 'fill' | 'overwrite' | 'skip'

export type PublishOptions = {
  /** Per-field behaviour. Missing fields default to 'fill' (only when empty). */
  fields?: Partial<Record<ProfileField, FieldMode>>
  /** Add the player's source teams to the team directory and link them. */
  linkTeams?: boolean
}

export type PublishResult = {
  playerDirectoryId: number
  created: boolean
  publicCode: string | null
  updatedFields: string[]
  teamsLinked: number
}

const STATEMENT_MAX = 500 // matches the Scoreboard's PATCH validation
const NAME_MAX = 120

const clip = (s: string | null, max: number) => (s && s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

function isEmpty(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '')
}

function decide(mode: FieldMode, current: unknown, incoming: unknown): boolean {
  if (mode === 'skip' || isEmpty(incoming)) return false
  if (mode === 'overwrite') return true
  return isEmpty(current)
}

function importMeta(player: ScrapedPlayer, user: SessionUser, previousSource?: string) {
  return {
    source: player.source,
    externalId: player.externalId,
    profileUrl: player.profileUrl,
    matchQuality: player.matchQuality,
    importedBy: user.username,
    importedAt: new Date().toISOString(),
    tool: 'prostream-player-import',
    ...(previousSource && previousSource !== player.source ? { previousSource } : {}),
  }
}

/** Find the profile already holding this external identity, if any. */
export async function findByExternal(source: ScrapedPlayer['source'], externalId: string, db: Executor = getDb()) {
  const [row] = await db
    .select()
    .from(playerDirectory)
    .where(and(eq(playerDirectory.source, source), eq(playerDirectory.externalId, externalId)))
    .limit(1)
  return row ?? null
}

async function ensureTeam(db: Executor, source: ScrapedPlayer['source'], ref: ScrapedTeamRef, user: SessionUser) {
  const [existing] = await db
    .select({ id: teamDirectory.id })
    .from(teamDirectory)
    .where(and(eq(teamDirectory.source, source), eq(teamDirectory.externalId, ref.externalId)))
    .limit(1)
  if (existing) return existing.id

  const [row] = await db
    .insert(teamDirectory)
    .values({
      name: clip(ref.name, NAME_MAX) ?? 'Unknown Team',
      shortCode: deriveShortCode(ref.name) || null,
      source,
      externalId: ref.externalId,
      externalRaw: ref.raw as object,
      isStub: true,
      importedAt: new Date(),
      createdBy: user.id,
      publicCode: await allocatePublicCode('team', db),
    })
    .onConflictDoNothing()
    .returning({ id: teamDirectory.id })
  if (row) return row.id
  // Lost a race with a concurrent import: read the winner.
  const [again] = await db
    .select({ id: teamDirectory.id })
    .from(teamDirectory)
    .where(and(eq(teamDirectory.source, source), eq(teamDirectory.externalId, ref.externalId)))
    .limit(1)
  return again.id
}

async function ensureMembership(
  db: Executor,
  source: ScrapedPlayer['source'],
  teamId: number,
  playerId: number,
  extra: { roleSkill?: string | null; isCaptain?: boolean; isAdmin?: boolean } = {},
) {
  await db
    .insert(directoryMemberships)
    .values({
      teamDirectoryId: teamId,
      playerDirectoryId: playerId,
      roleSkill: extra.roleSkill ?? null,
      isCaptain: extra.isCaptain ?? false,
      isAdmin: extra.isAdmin ?? false,
      source,
    })
    .onConflictDoUpdate({
      target: [directoryMemberships.teamDirectoryId, directoryMemberships.playerDirectoryId],
      set: {
        roleSkill: sql`COALESCE(excluded.role_skill, ${directoryMemberships.roleSkill})`,
        isCaptain: extra.isCaptain ?? false,
        isAdmin: extra.isAdmin ?? false,
      },
    })
}

export class PublishConflictError extends Error {
  constructor(
    message: string,
    public existingId: number,
  ) {
    super(message)
  }
}

/**
 * Create or update a directory profile from scraped data.
 * `targetId` null = new profile (or re-sync of the one already holding this
 * external identity).
 */
export async function publishPlayer(
  player: ScrapedPlayer,
  targetId: number | null,
  user: SessionUser,
  options: PublishOptions = {},
): Promise<PublishResult> {
  const db = getDb()
  const mode = (f: ProfileField): FieldMode => options.fields?.[f] ?? 'fill'

  // Resolve the row we are writing to.
  const holder = await findByExternal(player.source, player.externalId, db)
  let current: typeof playerDirectory.$inferSelect | null = null
  if (targetId != null) {
    const [row] = await db.select().from(playerDirectory).where(eq(playerDirectory.id, targetId)).limit(1)
    if (!row) throw new Error(`ProStream profile #${targetId} not found`)
    if (holder && holder.id !== row.id) {
      throw new PublishConflictError(
        `This ${player.source} player is already linked to ProStream profile #${holder.id} (${holder.displayName}). Update that profile instead, or unlink it first.`,
        holder.id,
      )
    }
    if (row.source !== 'manual' && row.source !== player.source && row.externalId) {
      throw new PublishConflictError(
        `Profile #${row.id} is already linked to ${row.source} (${row.externalId}). One profile can hold one external link.`,
        row.id,
      )
    }
    current = row
  } else if (holder) {
    current = holder
  }

  const incoming = {
    name: clip(player.name, NAME_MAX),
    cityName: player.cityName,
    dob: player.dob,
    role: player.role,
    battingStyle: player.battingStyle,
    bowlingStyle: player.bowlingStyle,
    jerseyNumber: player.jerseyNumber,
    statement: clip(player.statement, STATEMENT_MAX),
  }

  return db.transaction(async (tx) => {
    const updatedFields: string[] = []
    let id: number
    let created = false
    let publicCode: string | null

    const careerStats = player.careerStats as unknown as object
    const externalRaw = { ...(player.raw as object), _import: importMeta(player, user, current?.source) }

    if (!current) {
      const values: NewPlayerDirectoryRow = {
        name: incoming.name ?? 'Unknown Player',
        displayName: incoming.name ?? 'Unknown Player',
        cityName: mode('cityName') === 'skip' ? null : incoming.cityName,
        dob: mode('dob') === 'skip' ? null : incoming.dob,
        role: mode('role') === 'skip' ? null : incoming.role,
        battingStyle: mode('battingStyle') === 'skip' ? null : incoming.battingStyle,
        bowlingStyle: mode('bowlingStyle') === 'skip' ? null : incoming.bowlingStyle,
        jerseyNumber: mode('jerseyNumber') === 'skip' ? null : incoming.jerseyNumber,
        statement: mode('statement') === 'skip' ? null : incoming.statement,
        careerStatsImported: mode('stats') === 'skip' ? null : careerStats,
        source: player.source,
        externalId: player.externalId,
        externalRaw,
        isVerified: false,
        isStub: false,
        importedAt: new Date(),
        createdBy: user.id,
        publicCode: await allocatePublicCode('player', tx),
      }
      const [row] = await tx.insert(playerDirectory).values(values).returning({ id: playerDirectory.id, publicCode: playerDirectory.publicCode })
      id = row.id
      publicCode = row.publicCode
      created = true
      updatedFields.push('created')
    } else {
      const patch: Partial<NewPlayerDirectoryRow> = {
        source: player.source,
        externalId: player.externalId,
        externalRaw,
        importedAt: new Date(),
        isStub: false,
        updatedAt: new Date(),
      }
      if (decide(mode('name'), current.isStub ? null : current.name, incoming.name)) {
        patch.name = incoming.name!
        // Keep a custom display name unless it simply mirrored the old name.
        if (isEmpty(current.displayName) || current.displayName === current.name || current.isStub) patch.displayName = incoming.name!
        updatedFields.push('name')
      }
      for (const f of ['cityName', 'dob', 'role', 'battingStyle', 'bowlingStyle', 'jerseyNumber', 'statement'] as const) {
        if (decide(mode(f), current[f], incoming[f])) {
          ;(patch as Record<string, unknown>)[f] = incoming[f]
          updatedFields.push(f)
        }
      }
      // Stats are a snapshot, so 'fill' still refreshes a snapshot from the same source.
      const statsMode = mode('stats')
      const sameSourceSnapshot = (current.careerStatsImported as { source?: string } | null)?.source === player.source
      if (statsMode === 'overwrite' || (statsMode === 'fill' && (isEmpty(current.careerStatsImported) || sameSourceSnapshot))) {
        patch.careerStatsImported = careerStats
        updatedFields.push('stats')
      }
      if (!current.publicCode) patch.publicCode = await allocatePublicCode('player', tx)

      // Guard against the identity being claimed by another row in between.
      const [clash] = await tx
        .select({ id: playerDirectory.id })
        .from(playerDirectory)
        .where(and(eq(playerDirectory.source, player.source), eq(playerDirectory.externalId, player.externalId), ne(playerDirectory.id, current.id)))
        .limit(1)
      if (clash) throw new PublishConflictError(`Already linked to profile #${clash.id}`, clash.id)

      const [row] = await tx
        .update(playerDirectory)
        .set(patch)
        .where(eq(playerDirectory.id, current.id))
        .returning({ id: playerDirectory.id, publicCode: playerDirectory.publicCode })
      id = row.id
      publicCode = row.publicCode
    }

    let teamsLinked = 0
    if (options.linkTeams) {
      for (const ref of player.teams.slice(0, 50)) {
        const teamId = await ensureTeam(tx, player.source, ref, user)
        await ensureMembership(tx, player.source, teamId, id)
        teamsLinked += 1
      }
    }

    return { playerDirectoryId: id, created, publicCode, updatedFields, teamsLinked }
  })
}

// ── Team roster import (CricHeroes) ───────────────────────────────────────────

export type RosterMember = {
  externalId: string
  name: string
  role: ScrapedPlayer['role']
  isCaptain: boolean
  isAdmin: boolean
  roleSkill: string | null
}

/** Create/refresh the team row from a source team, returning its directory id. */
export async function publishTeam(
  source: ScrapedPlayer['source'],
  team: { externalId: string; name: string; cityName: string | null; foundedYear: number | null; raw: unknown },
  user: SessionUser,
): Promise<{ teamDirectoryId: number; created: boolean }> {
  const db = getDb()
  const [existing] = await db
    .select({ id: teamDirectory.id })
    .from(teamDirectory)
    .where(and(eq(teamDirectory.source, source), eq(teamDirectory.externalId, team.externalId)))
    .limit(1)

  const values = {
    name: clip(team.name, NAME_MAX) ?? 'Unknown Team',
    shortCode: deriveShortCode(team.name) || null,
    cityName: team.cityName,
    foundedYear: team.foundedYear,
    externalRaw: team.raw as object,
    isStub: false,
    importedAt: new Date(),
    updatedAt: new Date(),
  }
  if (existing) {
    await db.update(teamDirectory).set(values).where(eq(teamDirectory.id, existing.id))
    return { teamDirectoryId: existing.id, created: false }
  }
  const [row] = await db
    .insert(teamDirectory)
    .values({ ...values, source, externalId: team.externalId, createdBy: user.id, publicCode: await allocatePublicCode('team', db) })
    .returning({ id: teamDirectory.id })
  return { teamDirectoryId: row.id, created: true }
}

export async function linkRosterMember(
  source: ScrapedPlayer['source'],
  teamDirectoryId: number,
  playerDirectoryId: number,
  member: RosterMember,
) {
  await ensureMembership(getDb(), source, teamDirectoryId, playerDirectoryId, {
    roleSkill: member.roleSkill,
    isCaptain: member.isCaptain,
    isAdmin: member.isAdmin,
  })
}
