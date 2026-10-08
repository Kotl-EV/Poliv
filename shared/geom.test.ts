import assert from 'node:assert/strict'
import test from 'node:test'
import { SNAP_PX } from './doc.ts'
import {
  controlFromHandle,
  dist,
  handleFromControl,
  midpoint,
  snapToGrid,
  withinScreen,
  zonePathD,
} from './geom.ts'

test('zone close uses screen pixels, so a fitted large sheet still hits the start vertex', () => {
  const start = { x: 100, y: 100 }
  const k = 0.12
  const onDot = { x: 120, y: 100 }
  assert.equal(dist(start, onDot) <= SNAP_PX, false)
  assert.equal(withinScreen(start, onDot, k, 32), true)
  assert.equal(withinScreen(start, { x: 500, y: 100 }, k, 32), false)
})

test('grid snap lands on metre steps', () => {
  const ppm = 20
  const hit = snapToGrid({ x: 53, y: 28 }, 1 * ppm)
  assert.equal(hit.x, 60)
  assert.equal(hit.y, 20)
})

test('a midpoint handle on the chord keeps the edge straight', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 10, y: 0 }
  const mid = midpoint(a, b)
  const control = controlFromHandle(a, b, mid)
  const back = handleFromControl(a, b, control)
  assert.equal(control.x, 5)
  assert.equal(control.y, 0)
  assert.equal(back.x, 5)
  assert.equal(back.y, 0)
})

test('closed zone path ends with Z', () => {
  const d = zonePathD([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], null, true)
  assert.equal(d.includes('Z'), true)
})
