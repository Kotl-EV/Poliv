import assert from 'node:assert/strict'
import test from 'node:test'
import { SNAP_PX } from './doc.ts'
import { dist, withinScreen } from './geom.ts'

test('zone close uses screen pixels, so a fitted large sheet still hits the start vertex', () => {
  const start = { x: 100, y: 100 }
  const k = 0.12
  const onDot = { x: 120, y: 100 }
  assert.equal(dist(start, onDot) <= SNAP_PX, false)
  assert.equal(withinScreen(start, onDot, k, 32), true)
  assert.equal(withinScreen(start, { x: 500, y: 100 }, k, 32), false)
})
