// Scoring record rules against a trimmed real STUMPS scorer payload
// (fixtures/stumps-scorer.json: raw gateway rows for fore5474, who scored 236 matches).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  crossSourceDuplicates, isRecordable, matchFingerprint, stumpsScoredMatch, stumpsScoringPreview, tidyTeamName, utcTimestampText,
} from '../src/lib/scoring'

const raw = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'stumps-scorer.json'), 'utf8'))

test('team names: lower-case is title-cased, mixed case kept', () => {
  assert.equal(tidyTeamName('power hitters'), 'Power Hitters')
  assert.equal(tidyTeamName('  90s  kids '), '90s Kids')
  assert.equal(tidyTeamName('TEAM INSHAF'), 'TEAM INSHAF')
})

test('a raw STUMPS final normalizes; stage-like venue becomes the label', () => {
  const m = stumpsScoredMatch(raw.matches.find((r: { mk: string }) => r.mk === '-OZYqLJMR3aT1E7P4aCV'))!
  assert.deepEqual(
    [m.source, m.tournamentName, m.matchLabel, m.venue, m.format, m.playedAt],
    ['stumps', 'Hijrappura M M V OLD BOYS CRICKET Tournament', 'Final', null, 'T10', '2025-09-07T11:04:00.000Z'],
  )
  assert.deepEqual([m.teamA, m.teamAScore, m.teamB, m.teamBScore], ['Warriors', '64-5 (5)', 'Power Hitters', '59-6 (5)'])
  assert.equal(m.result, 'WARRIORS won by 5 wickets')
  assert.equal(isRecordable(m), true)
})

test('trailing punctuation on a stage is dropped', () => {
  const row = raw.matches.find((r: { mve?: string }) => r.mve === 'Eliminator,')
  assert.equal(stumpsScoredMatch(row)!.matchLabel, 'Eliminator')
})

test('an unfinished match (no iscp, no result) is listed but not recorded', () => {
  const m = stumpsScoredMatch(raw.matches[0])!
  assert.equal(m.completed, false)
  assert.equal(isRecordable(m), false)
  assert.equal(stumpsScoredMatch({ mk: 'x', btmn: 'a' }), null)
})

test('preview groups by tournament, newest first, flags empty tournaments, reads the award count', () => {
  const p = stumpsScoringPreview(raw)
  assert.equal(p.listed, 7)
  assert.equal(p.matches.length, 6)
  assert.equal(p.sourceScoredCount, 236)
  assert.deepEqual(p.tournaments.map((t) => [t.name, t.matches]), [['Hijrappura M M V OLD BOYS CRICKET Tournament', 3], ['DIGANA MRI LEAGUE', 3]])
  assert.deepEqual(p.emptyTournaments, ['LEGENDS PREMIER LEAGUE SEASON 3'])
  assert.ok(p.matches.every((m, i) => i === 0 || (p.matches[i - 1].playedAt ?? '') >= (m.playedAt ?? '')))
  assert.equal(p.lastAt, '2025-09-07T11:04:00.000Z')
})

test('duplicates are only across sources; fingerprint ignores order, case and punctuation', () => {
  assert.equal(
    matchFingerprint({ playedAt: '2025-09-07T11:04:00.000Z', teamA: 'Warriors', teamB: 'Power Hitters' }),
    matchFingerprint({ playedAt: '2025-09-07T23:00:00.000Z', teamA: 'POWER-HITTERS', teamB: 'warriors' }),
  )
  const rows = [
    { source: 'stumps', playedAt: '2025-09-07T10:00:00.000Z', teamA: 'Warriors', teamB: 'Power Hitters' },
    { source: 'stumps', playedAt: '2025-09-07T13:00:00.000Z', teamA: 'Power Hitters', teamB: 'Warriors' },
    { source: 'cricheroes', playedAt: '2025-09-07T11:00:00.000Z', teamA: 'warriors', teamB: 'power hitters' },
  ]
  assert.deepEqual([...crossSourceDuplicates(rows)], [[2, 0]])
})

test('timestamps are written as UTC wall-clock text', () => {
  assert.equal(utcTimestampText('2025-09-07T11:04:00.000Z'), '2025-09-07 11:04:00.000')
  assert.equal(utcTimestampText(null), null)
})
