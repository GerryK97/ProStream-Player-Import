import { NextRequest, NextResponse } from 'next/server'
import { jsonError, withSession } from '@/lib/api'
import { assertScoringWritable } from '@/lib/capabilities'
import { getProfile } from '@/lib/directory'
import { existingRecord, fetchScorer, importScoredMatches } from '@/lib/scoringServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET  /api/scoring/import?playerId=123           what this profile's scoring record holds
 * POST /api/scoring/import { source, ref, playerId }
 *   Re-fetch the scorer on the server (never trusts browser data) and upsert
 *   every completed match into the profile's scoring record. Idempotent.
 */
export const GET = withSession(async (_user, req: NextRequest) => {
  const id = Number(req.nextUrl.searchParams.get('playerId'))
  if (!Number.isInteger(id) || id <= 0) return jsonError(400, 'Invalid player id')
  return NextResponse.json({ record: await existingRecord(id) })
})

export const POST = withSession(async (user, req: NextRequest) => {
  const body = (await req.json()) as { source?: unknown; ref?: unknown; playerId?: unknown }
  const playerId = Number(body.playerId)
  const ref = typeof body.ref === 'string' ? body.ref.trim() : ''
  if (body.source !== undefined && body.source !== 'stumps') return jsonError(400, 'Scoring records can only be imported from STUMPS for now')
  if (!ref) return jsonError(400, 'Missing STUMPS player reference')
  if (!Number.isInteger(playerId) || playerId <= 0) return jsonError(400, 'Pick the ProStream profile to add the record to')
  await assertScoringWritable()
  const profile = await getProfile(playerId)
  if (!profile) return jsonError(404, `ProStream profile #${playerId} not found`)

  const fetched = await fetchScorer('stumps', ref)
  if (!fetched.preview.matches.length) return jsonError(422, 'STUMPS lists no completed matches for this person')
  const result = await importScoredMatches(fetched, playerId, user)
  console.info('[scoring]', user.username, 'imported', result.upserted, 'stumps', fetched.externalId, '->', playerId, `(${result.inserted} new, ${result.duplicates} duplicates)`)
  return NextResponse.json({ result, profile })
})
