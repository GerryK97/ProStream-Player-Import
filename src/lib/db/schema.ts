// A deliberately small mirror of the ProStream Scoreboard schema
// (ProStream-Scoreboard/src/lib/db/schema.ts is the source of truth).
//
// Only the tables and columns this importer reads or writes are declared.
// Photo columns (headshot_cloudinary_id, logo_cloudinary_id) are deliberately
// absent: the importer is data-only and must never touch images.
// Drizzle never emits DDL from here (there is no drizzle-kit config in this
// repo), so declaring a subset is safe: SELECTs name only these columns and
// INSERTs rely on the database defaults for everything else.

import {
  pgTable,
  pgEnum,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  varchar,
  date,
} from 'drizzle-orm/pg-core'

export const playerRoleEnum = pgEnum('player_role', ['batsman', 'bowler', 'allrounder', 'keeper'])
export const battingStyleEnum = pgEnum('batting_style', ['right-hand', 'left-hand'])
export const bowlingStyleEnum = pgEnum('bowling_style', [
  'right-arm-fast',
  'right-arm-medium',
  'right-arm-offbreak',
  'right-arm-legbreak',
  'left-arm-fast',
  'left-arm-medium',
  'left-arm-orthodox',
  'left-arm-chinaman',
])
export const userRoleEnum = pgEnum('user_role', ['Admin', 'Operator', 'Player', 'Audience', 'Scorer'])
export const userStatusEnum = pgEnum('user_status', ['Active', 'PendingApproval', 'Suspended'])

// 'stumps' is added by Scoreboard migration 0072. The importer checks at
// runtime that the label exists before writing STUMPS rows (see capabilities.ts).
export const directorySourceEnum = pgEnum('directory_source', ['manual', 'cricheroes', 'native', 'stumps'])

export type PlayerRole = (typeof playerRoleEnum.enumValues)[number]
export type BattingStyle = (typeof battingStyleEnum.enumValues)[number]
export type BowlingStyle = (typeof bowlingStyleEnum.enumValues)[number]
export type DirectorySource = (typeof directorySourceEnum.enumValues)[number]

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: varchar('username', { length: 50 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  role: userRoleEnum('role').notNull(),
  status: userStatusEnum('status').notNull(),
})

export const playerDirectory = pgTable('player_directory', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  displayName: text('display_name').notNull(),
  dob: date('dob'),
  cityName: text('city_name'),
  countryName: text('country_name'),
  role: playerRoleEnum('role'),
  battingStyle: battingStyleEnum('batting_style'),
  bowlingStyle: bowlingStyleEnum('bowling_style'),
  statement: text('statement'),
  publicCode: varchar('public_code', { length: 16 }),
  mobile: varchar('mobile', { length: 20 }),
  userId: text('user_id'),
  jerseyNumber: integer('jersey_number'),
  source: directorySourceEnum('source').notNull().default('manual'),
  externalId: text('external_id'),
  externalRaw: jsonb('external_raw'),
  isVerified: boolean('is_verified').notNull().default(false),
  isStub: boolean('is_stub').notNull().default(false),
  importedAt: timestamp('imported_at'),
  careerStatsImported: jsonb('career_stats_imported'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const teamDirectory = pgTable('team_directory', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  shortCode: varchar('short_code', { length: 10 }),
  cityName: text('city_name'),
  foundedYear: integer('founded_year'),
  statement: text('statement'),
  publicCode: varchar('public_code', { length: 16 }),
  source: directorySourceEnum('source').notNull().default('manual'),
  externalId: text('external_id'),
  externalRaw: jsonb('external_raw'),
  isVerified: boolean('is_verified').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  isStub: boolean('is_stub').notNull().default(false),
  importedAt: timestamp('imported_at'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const directoryMemberships = pgTable('directory_memberships', {
  id: serial('id').primaryKey(),
  teamDirectoryId: integer('team_directory_id').notNull(),
  playerDirectoryId: integer('player_directory_id').notNull(),
  roleSkill: text('role_skill'),
  isCaptain: boolean('is_captain').notNull().default(false),
  isAdmin: boolean('is_admin').notNull().default(false),
  isVerified: boolean('is_verified').notNull().default(false),
  source: directorySourceEnum('source').notNull().default('manual'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// "Bring my stats" requests (Scoreboard migration 0077). A profile owner asks
// an Admin to add a CricHeroes or STUMPS career; the Admin works the queue here.
// For CricHeroes, external_ref is a numeric id or, when the player only gave a
// name, that name (resolved to an id on import).
export const playerImportRequests = pgTable('player_import_requests', {
  id: serial('id').primaryKey(),
  directoryPlayerId: integer('directory_player_id').notNull(),
  requesterUserId: text('requester_user_id').notNull(),
  source: text('source').$type<'cricheroes' | 'stumps'>().notNull(),
  externalRef: text('external_ref').notNull(),
  sourceUrl: text('source_url').notNull(),
  status: text('status').$type<'pending' | 'needs_info' | 'imported' | 'rejected' | 'cancelled'>().notNull(),
  playerNote: text('player_note'),
  adminNote: text('admin_note'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// Shared in-app inbox (owned by the Auction service, same database).
export const notifications = pgTable('notifications', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  data: text('data'),
})

export const devicePushTokens = pgTable('device_push_tokens', {
  userId: text('user_id').notNull(),
  expoPushToken: text('expo_push_token').notNull(),
})

export type PlayerImportRequestRow = typeof playerImportRequests.$inferSelect
export type PlayerDirectoryRow = typeof playerDirectory.$inferSelect
export type NewPlayerDirectoryRow = typeof playerDirectory.$inferInsert
