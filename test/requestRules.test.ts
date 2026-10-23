import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approvalRef, isNameRef, normalizeAdminNote } from '../src/lib/requestRules'

test('a CricHeroes name is not an account, a numeric id is', () => {
  assert.equal(isNameRef('cricheroes', 'Kasun Perera'), true)
  assert.equal(isNameRef('cricheroes', '1234567'), false)
  assert.equal(isNameRef('stumps', 'ahan5390'), false)
})

test('an id request imports its own id, or the one the Admin corrected', () => {
  assert.equal(approvalRef({ source: 'cricheroes', externalRef: '1234567' }, undefined), '1234567')
  assert.equal(approvalRef({ source: 'cricheroes', externalRef: '1234567' }, '7654321'), '7654321')
  assert.equal(approvalRef({ source: 'stumps', externalRef: '-Og0ngaOURQpDbTTOeQL' }, null), '-Og0ngaOURQpDbTTOeQL')
})

test('a name request cannot be approved until a real player is picked', () => {
  assert.equal(approvalRef({ source: 'cricheroes', externalRef: 'Kasun Perera' }, undefined), null)
  assert.equal(approvalRef({ source: 'cricheroes', externalRef: 'Kasun Perera' }, ''), null)
  assert.equal(approvalRef({ source: 'cricheroes', externalRef: 'Kasun Perera' }, 'Kasun Perera'), null)
  assert.equal(approvalRef({ source: 'cricheroes', externalRef: 'Kasun Perera' }, ' 998877 '), '998877')
})

test('admin notes are trimmed, capped and empty means none', () => {
  assert.equal(normalizeAdminNote('  hi  '), 'hi')
  assert.equal(normalizeAdminNote('   '), null)
  assert.equal(normalizeAdminNote(5), null)
  assert.equal(normalizeAdminNote('x'.repeat(500))?.length, 400)
})
