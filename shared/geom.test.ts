import assert from 'node:assert/strict'
import test from 'node:test'
import { SNAP_PX } from './doc.ts'
import {
  aimSprinkler,
  bearingDeg,
  circlePoints,
  controlFromHandle,
  dist,
  handleFromControl,
  midpoint,
  mirrorAround,
  nearestScreen,
  polygonAreaPx,
  rectPoints,
  scaleAround,
  snapDeg,
  snapToGrid,
  strokeToPolygon,
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

test('vertex snap stays within a few screen pixels and ignores far corners', () => {
  const click = { x: 100, y: 100 }
  const far = { x: 160, y: 100 }
  const near = { x: 104, y: 100 }
  assert.equal(nearestScreen(click, [far], 0.6, 8), null)
  assert.deepEqual(nearestScreen(click, [near], 0.6, 8), near)
})

test('rect from a corner keeps that corner and shift makes a square', () => {
  const pts = rectPoints({ x: 10, y: 10 }, { x: 40, y: 20 })
  assert.equal(pts.length, 4)
  assert.deepEqual(pts[2], { x: 40, y: 20 })
  const square = rectPoints({ x: 0, y: 0 }, { x: 10, y: 4 }, true)
  assert.equal(Math.abs(square[2].x - square[0].x), Math.abs(square[2].y - square[0].y))
})

test('circle around a centre has equal radii', () => {
  const c = { x: 50, y: 50 }
  const pts = circlePoints(c, { x: 50, y: 30 }, 16)
  assert.equal(pts.length, 16)
  for (const point of pts) assert.ok(Math.abs(dist(c, point) - 20) < 1e-6)
})

test('a brush stroke becomes a closed outline with area', () => {
  const poly = strokeToPolygon([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }], 5)
  assert.ok(poly.length >= 8)
  assert.ok(polygonAreaPx(poly) > 200)
})

test('scale and mirror keep the centroid', () => {
  const origin = { x: 10, y: 10 }
  assert.deepEqual(scaleAround({ x: 14, y: 10 }, origin, 2), { x: 18, y: 10 })
  assert.deepEqual(mirrorAround({ x: 14, y: 8 }, origin, 'x'), { x: 6, y: 8 })
  assert.deepEqual(mirrorAround({ x: 14, y: 8 }, origin, 'y'), { x: 14, y: 12 })
})

test('bearing is 0 up and grows clockwise', () => {
  const o = { x: 0, y: 0 }
  assert.equal(Math.round(bearingDeg(o, { x: 0, y: -10 })), 0)
  assert.equal(Math.round(bearingDeg(o, { x: 10, y: 0 })), 90)
  assert.equal(Math.round(bearingDeg(o, { x: 0, y: 10 })), 180)
  assert.equal(Math.round(bearingDeg(o, { x: -10, y: 0 })), 270)
  assert.equal(snapDeg(22, 15), 15)
  assert.equal(snapDeg(353, 15), 0)
})

test('dragging the mid handle turns the sector, edge handles change the arc', () => {
  const o = { x: 100, y: 100 }
  const rot = aimSprinkler(o, 0, 180, { x: 200, y: 100 }, 'rot')
  assert.equal(Math.round(rot.rotationDeg), 90)
  assert.equal(rot.arcDeg, 180)
  const start = aimSprinkler(o, 180, 180, { x: 100, y: 0 }, 'start')
  assert.equal(Math.round(start.arcDeg), 270)
  const end = aimSprinkler(o, 180, 180, { x: 100, y: 200 }, 'end')
  assert.equal(Math.round(end.arcDeg), 90)
})
