import assert from 'node:assert/strict'
import test from 'node:test'
import { FIXTURES, FIXTURE_GROUPS, fixtureGlyph, fixtureMarkup, groupOf, parseFixtureKind } from './fixtures.ts'
import { emptyDoc } from './doc.ts'
import type { Fixture } from './types.ts'

test('every drawing object is a closed mark in its own shelf', () => {
  assert.equal(new Set(FIXTURES.map((item) => item.id)).size, FIXTURES.length)
  const groups = new Set(FIXTURES.map((item) => item.group))
  assert.equal(groups.size, FIXTURE_GROUPS.length)
  assert.ok(FIXTURES.length >= 40)
  for (const item of FIXTURES) {
    assert.equal(groupOf(item.id), item.group)
    assert.ok(item.label.length > 1, item.id)
    const glyph = fixtureGlyph(item.id)
    assert.ok(glyph.parts.length >= 1, item.id)
    for (const part of glyph.parts) {
      assert.ok(part.d.startsWith('M'), item.id)
      assert.ok(part.d.endsWith('Z'), item.id)
    }
    const placed: Fixture = { id: 'f', kind: item.id, x: 4, y: 6, radiusM: item.radiusM }
    const svg = fixtureMarkup(placed, 20, 1)
    assert.match(svg, /translate\(4 6\)/)
  }
  const remote = JSON.stringify(fixtureGlyph('controller'))
  for (const item of FIXTURES) {
    if (item.id === 'controller') continue
    assert.notEqual(JSON.stringify(fixtureGlyph(item.id)), remote, item.id)
  }
  assert.equal(parseFixtureKind('sedan'), 'sedan')
  assert.equal(parseFixtureKind('boat'), null)
  assert.equal(parseFixtureKind(4), null)
  const bar = fixtureMarkup({ id: 'b', kind: 'scalebar', x: 1, y: 2, radiusM: 2 }, 20, 1)
  assert.match(bar, /4 м/)
  const doc = emptyDoc()
  assert.equal(doc.fixtures?.length, 0)
})
