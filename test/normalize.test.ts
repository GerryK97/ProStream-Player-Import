// Normaliser tests against real payloads captured by the original Python
// projects (cricheroes-extract/team_deep.json, stumps-scraper/output/ahan5390.json).
// Expected values are the ones the Python tools produced and verified.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  cleanDob,
  normalizeBattingHand,
  normalizeBowlingStyle,
  normalizeCricHeroesPlayer,
  normalizeRole,
  normalizeStumpsPlayer,
  stripHtml,
  stumpsCareerStats,
  titleCase,
  type StatItem,
} from '../src/lib/normalize'
import { parseCricHeroesId } from '../src/lib/sources/cricheroesIds'
import { parseStumpsQuery } from '../src/lib/sources/stumpsIds'

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))
const stat = (items: StatItem[], title: string) => items.find((i) => i.title === title)?.value

test('value maps match the Scoreboard enums', () => {
  assert.equal(normalizeBattingHand('LHB'), 'left-hand')
  assert.equal(normalizeBattingHand('Right Hand Bat'), 'right-hand')
  assert.equal(normalizeBattingHand(''), null)
  assert.equal(normalizeBowlingStyle('Right-arm Leg Break'), 'right-arm-legbreak')
  assert.equal(normalizeBowlingStyle('Slow left-arm chinaman'), 'left-arm-chinaman')
  assert.equal(normalizeBowlingStyle('Slow Left-arm Orthodox'), 'left-arm-orthodox')
  assert.equal(normalizeBowlingStyle('Right-arm fast'), 'right-arm-fast')
  assert.equal(normalizeBowlingStyle('Left-arm medium fast'), 'left-arm-fast')
  assert.equal(normalizeBowlingStyle('Right-arm Off Break'), 'right-arm-offbreak')
  assert.equal(normalizeBowlingStyle('Nothing'), null)
  assert.equal(normalizeRole('All-Rounder'), 'allrounder')
  assert.equal(normalizeRole('Wicketkeeper Batter'), 'keeper')
  assert.equal(normalizeRole('BOWL'), 'bowler')
  assert.equal(normalizeRole('Top order Batter'), 'batsman')
  assert.equal(normalizeRole(''), null)
})

test('text helpers', () => {
  assert.equal(stripHtml('top score of <b>94</b>, &amp; more'), 'top score of 94 , & more')
  assert.equal(titleCase('SAHAN  NAWANJANA'), 'Sahan Nawanjana')
  assert.equal(cleanDob('1988-07-19'), '1988-07-19')
  assert.equal(cleanDob('1988-02-30'), null)
  assert.equal(cleanDob('2999-01-01'), null)
  assert.equal(cleanDob(''), null)
})

test('id parsing from ids and URLs', () => {
  assert.equal(parseCricHeroesId('1008487', 'player'), 1008487)
  assert.equal(parseCricHeroesId('https://cricheroes.com/player-profile/1008487/abhay', 'player'), 1008487)
  assert.equal(parseCricHeroesId('https://cricheroes.com/team-profile/2580003/CP-Sm@shers', 'team'), 2580003)
  assert.equal(parseCricHeroesId('Akram Azeez', 'player'), null)
  assert.deepEqual(parseStumpsQuery('https://stumpsapp.com/player/-Og0ngaOURQpDbTTOeQL'), { key: '-Og0ngaOURQpDbTTOeQL', query: 'https://stumpsapp.com/player/-Og0ngaOURQpDbTTOeQL' })
  assert.deepEqual(parseStumpsQuery('-Og0ngaOURQpDbTTOeQL'), { key: '-Og0ngaOURQpDbTTOeQL', query: '-Og0ngaOURQpDbTTOeQL' })
  assert.deepEqual(parseStumpsQuery('ahan5390'), { query: 'ahan5390' })
})

test('CricHeroes player maps onto player_directory fields', () => {
  const p = normalizeCricHeroesPlayer(fixture('cricheroes-player.json'), new Date('2026-10-21T00:00:00Z'))
  assert.equal(p.source, 'cricheroes')
  assert.equal(p.externalId, '10489930')
  assert.equal(p.name, 'Rudraprasanna Panda - Green Ball')
  assert.equal(p.cityName, 'Bengaluru (Bangalore)')
  assert.equal(p.dob, '1988-07-19')
  assert.equal(p.role, 'allrounder')
  assert.equal(p.battingStyle, 'right-hand')
  assert.equal(p.bowlingStyle, 'right-arm-fast')
  assert.ok(p.statement && !p.statement.includes('<b>'))
  assert.equal(p.profileUrl, 'https://cricheroes.com/player-profile/10489930/Rudraprasanna-Panda-Green-Ball')
  assert.deepEqual(p.summary, { matches: 315, runs: 3095, wickets: 215 })
  // careerStatsImported keeps the Scoreboard importer's {title,value} shape.
  assert.equal(stat(p.careerStats.batting, 'Runs'), 3095)
  assert.equal(stat(p.careerStats.bowling, 'Best Bowling'), '5/18')
  assert.equal(stat(p.careerStats.fielding, 'Catches'), 83)
  assert.equal(stat(p.careerStats.captain, 'Matches'), 93)
  assert.equal(p.careerStats.source, 'cricheroes')
  assert.equal(p.careerStats.fetchedAt, '2026-10-21T00:00:00.000Z')
  assert.ok(p.teams.length > 0)
  assert.ok(p.teams.every((t) => t.externalId && t.name))
  // Data only: no image fields are produced.
  assert.ok(!('photoUrl' in p))
})

test('STUMPS player decodes the cryptic API keys', () => {
  const raw = fixture('stumps-player.json')
  const expected = fixture('stumps-expected.json').expected
  const p = normalizeStumpsPlayer(raw)
  assert.equal(p.source, 'stumps')
  assert.equal(p.externalId, '-Og0ngaOURQpDbTTOeQL')
  assert.equal(p.name, 'Sahan Nawanjana')
  assert.equal(p.matchQuality, 'exact')
  assert.equal(p.role, 'allrounder')
  assert.equal(p.sourceLabels.role, expected.player.roles.playing_role)
  assert.equal(p.sourceLabels.battingStyle, expected.player.roles.batting_style)
  assert.equal(p.sourceLabels.bowlingStyle, expected.player.roles.bowling_style)
  assert.equal(p.battingStyle, 'right-hand')
  assert.equal(p.bowlingStyle, 'right-arm-medium')
  assert.equal(p.jerseyNumber, Number(expected.player.jersey_number))
  assert.equal(p.cityName, 'Chilaw')
  assert.equal(p.profileUrl, 'https://stumpsapp.com/player/-Og0ngaOURQpDbTTOeQL')
  assert.deepEqual(p.teams.map((t) => t.name), ['Golden Lions', ...p.teams.slice(1).map((t) => t.name)])
  assert.ok(!('photoUrl' in p))

  // Same numbers the Python scraper produced for the T10 format.
  const t10 = expected.statistics.by_format['1']
  assert.equal(stat(p.careerStats.batting, 'Runs'), t10.batting.runs)
  assert.equal(stat(p.careerStats.batting, 'Highest Runs'), t10.batting.high_score)
  assert.equal(stat(p.careerStats.batting, 'Avg'), t10.batting.average.toFixed(2))
  assert.equal(stat(p.careerStats.batting, 'SR'), t10.batting.strike_rate.toFixed(2))
  assert.equal(stat(p.careerStats.batting, '6s'), t10.batting.sixes)
  assert.equal(stat(p.careerStats.bowling, 'Wickets'), t10.bowling.wickets)
  assert.equal(stat(p.careerStats.bowling, 'Best Bowling'), '4/1')
  assert.equal(stat(p.careerStats.bowling, 'Overs'), '4.0')
  assert.equal(stat(p.careerStats.fielding, 'Catches'), t10.fielding.catches)
  assert.equal(p.careerStats.formats?.[0]?.format, 'T10')
  assert.deepEqual(p.summary, { matches: 7, runs: 264, wickets: 9 })
})

test('STUMPS multi-format statistics sum into career totals', () => {
  const s = stumpsCareerStats({
    '1': { mat: 3, btin: 3, btrn: 50, btbl: 40, btno: 1, hs: '30*', blbl: 12, blrn: 20, blwkt: 2, bbl: '2-5' },
    '2': { mat: 2, btin: 2, btrn: 70, btbl: 50, hs: '45', blbl: 24, blrn: 30, blwkt: 3, bbl: '3-10' },
  })
  assert.equal(stat(s.batting, 'Matches'), 5)
  assert.equal(stat(s.batting, 'Runs'), 120)
  assert.equal(stat(s.batting, 'Highest Runs'), '45')
  assert.equal(stat(s.batting, 'Avg'), '30.00') // 120 runs / 4 outs
  assert.equal(stat(s.bowling, 'Wickets'), 5)
  assert.equal(stat(s.bowling, 'Best Bowling'), '3/10')
  assert.equal(stat(s.bowling, 'Overs'), '6.0')
  assert.equal(stat(s.bowling, 'Economy'), '8.33')
  assert.deepEqual(s.formats?.map((f) => f.format), ['T10', 'T20'])
})
