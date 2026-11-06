import { NextRequest, NextResponse } from 'next/server'
import { jsonError, withSession } from '@/lib/api'
import { suggestMatches } from '@/lib/directory'
import { existingRecord, fetchScorer } from '@/lib/scoringServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * GET /api/scoring/source?source=stumps&ref=<id, key or profile URL>
 * Fetch every match the person scored and preview the scoring record, plus
 * the ProStream profiles it likely belongs to. Nothing is written.
 */
export const GET = withSession(async (_user, req: NextRequest) => {
  const source = req.nextUrl.searchParams.get('source') ?? 'stumps'
  const ref = req.nextUrl.searchParams.get('ref')?.trim()
  if (source !== 'stumps') return jsonError(400, 'Scoring records can only be imported from STUMPS for now')
  if (!ref) return jsonError(400, 'Missing STUMPS player reference')
  const fetched = await fetchScorer('stumps', ref)
  const matches = await suggestMatches(fetched.name, 'stumps', fetched.externalId)
  const { raw: _raw, ...scorer } = fetched
  void _raw
  const candidates = [matches.linked, ...matches.candidates].filter((p, i, all): p is NonNullable<typeof p> => !!p && all.findIndex((q) => q?.id === p.id) === i)
  const records = Object.fromEntries(await Promise.all(candidates.map(async (p) => [p.id, await existingRecord(p.id).catch(() => [])] as const)))
  return NextResponse.json({ scorer, matches, records })
})
