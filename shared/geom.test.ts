import assert from 'node:assert/strict'
import test from 'node:test'
import { SNAP_PX } from './doc.ts'
import {
  aimSprinkler,
  bearingDeg,
  pickSprinkler,
  pointInStrip,
  circlePoints,
  controlFromHandle,
  dist,
  headsAlong,
  mirrorHeading,
  mirrorNozzleId,
  sideInto,
  sideOfPoint,
  seatOnZone,
  resizeEdge,
  filletVertex,
  noteLeader,
  handleFromControl,
  midpoint,
  mirrorAround,
  nearestScreen,
  polygonAreaPx,
  rectPoints,
  scaleAround,
  snapDeg,
  snapToGrid,
  alignShift,
  flattenRing,
  strokeToPolygon,
  withinScreen,
  zonePathD,
} from './geom.ts'

test('the cursor above a rightward edge is the left side', () => {
  const edge = [{ x: 0, y: 0 }, { x: 100, y: 0 }]
  assert.equal(sideOfPoint(edge, { x: 50, y: -20 }), 1)
  assert.equal(sideOfPoint(edge, { x: 50, y: 20 }), -1)
  assert.equal(sideOfPoint(edge, { x: 50, y: 2 }, 8), 0)
})

test('a heading mirrors across an axis and a left strip becomes the right one', () => {
  const vertical = [{ x: 0, y: 0 }, { x: 0, y: 100 }]
  const turned = ((mirrorHeading(90, vertical[0], vertical[1]) - 270) % 360 + 360) % 360
  assert.ok(turned < 0.05)
  const flat = ((mirrorHeading(0, { x: 0, y: 0 }, { x: 100, y: 0 }) - 180) % 360 + 360) % 360
  assert.ok(flat < 0.05)
  assert.equal(mirrorNozzleId('fan-lcs'), 'fan-rcs')
  assert.equal(mirrorNozzleId('rot-rcs'), 'rot-lcs')
  assert.equal(mirrorNozzleId('fan180'), 'fan180')
})

test('a row along a square edge faces into the square', () => {
  const clockwise = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
  assert.equal(sideInto([clockwise[0], clockwise[1]], clockwise), -1)
  assert.equal(sideInto([clockwise[1], clockwise[2]], clockwise), -1)
  const counter = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }]
  assert.equal(sideInto([counter[0], counter[1]], counter), 1)
})

function angleGap(actual: number, expected: number): number {
  return Math.abs((((actual - expected) % 360) + 540) % 360 - 180)
}

test('a head near a zone edge sits on the outline and faces in', () => {
  const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
  const top = seatOnZone({ x: 50, y: -8 }, [{ points: square }], 20, 16)
  if (!top) throw new Error('кромка не поймана')
  assert.equal(top.x, 50)
  assert.equal(top.y, 0)
  assert.ok(angleGap(top.rotationDeg, 180) < 0.05)
  assert.ok(Math.abs(top.arcDeg - 180) < 0.05)
  const right = seatOnZone({ x: 108, y: 50 }, [{ points: square }], 20, 16)
  if (!right) throw new Error('правая кромка не поймана')
  assert.equal(right.x, 100)
  assert.equal(right.y, 50)
  assert.ok(angleGap(right.rotationDeg, 270) < 0.05)
  const corner = seatOnZone({ x: -6, y: -6 }, [{ points: square }], 20, 16)
  if (!corner) throw new Error('угол не пойман')
  assert.equal(corner.x, 0)
  assert.equal(corner.y, 0)
  assert.ok(angleGap(corner.rotationDeg, 135) < 0.05)
  assert.ok(Math.abs(corner.arcDeg - 90) < 0.05)
  assert.equal(seatOnZone({ x: 50, y: 50 }, [{ points: square }], 20, 16), null)
  const counter = [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }]
  const other = seatOnZone({ x: 50, y: -8 }, [{ points: counter }], 20, 16)
  if (!other) throw new Error('встречный контур не пойман')
  assert.ok(angleGap(other.rotationDeg, 180) < 0.05)
})

test('a notch corner and a hole turn the sector into the watered ground', () => {
  const notch = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 40 },
    { x: 40, y: 40 },
    { x: 40, y: 100 },
    { x: 0, y: 100 },
  ]
  const reflex = seatOnZone({ x: 48, y: 48 }, [{ points: notch }], 20, 16)
  if (!reflex) throw new Error('внутренний угол не пойман')
  assert.equal(reflex.x, 40)
  assert.equal(reflex.y, 40)
  assert.ok(angleGap(reflex.rotationDeg, 315) < 0.05)
  assert.ok(Math.abs(reflex.arcDeg - 270) < 0.05)
  const hole = [
    { x: 80, y: 80 },
    { x: 120, y: 80 },
    { x: 120, y: 120 },
    { x: 80, y: 120 },
  ]
  const outer = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 200 },
    { x: 0, y: 200 },
  ]
  const around = seatOnZone({ x: 100, y: 70 }, [{ points: outer, holes: [hole] }], 20, 16)
  if (!around) throw new Error('кромка отверстия не поймана')
  assert.equal(around.x, 100)
  assert.equal(around.y, 80)
  assert.ok(angleGap(around.rotationDeg, 0) < 0.05)
  assert.ok(Math.abs(around.arcDeg - 180) < 0.05)
  const holeCorner = seatOnZone({ x: 72, y: 72 }, [{ points: outer, holes: [hole] }], 20, 16)
  if (!holeCorner) throw new Error('угол отверстия не пойман')
  assert.equal(holeCorner.x, 80)
  assert.equal(holeCorner.y, 80)
  assert.ok(Math.abs(holeCorner.arcDeg - 270) < 0.05)
})

test('a lawn keeps a shared edge and a bulge is followed', () => {
  const lawn = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
  const bed = [{ x: 100, y: 0 }, { x: 160, y: 0 }, { x: 160, y: 100 }, { x: 100, y: 100 }]
  const shared = seatOnZone({ x: 100, y: 50 }, [{ points: bed }, { points: lawn, spray: true }], 20, 16)
  if (!shared) throw new Error('общая кромка не поймана')
  assert.equal(shared.x, 100)
  assert.equal(shared.y, 50)
  assert.ok(angleGap(shared.rotationDeg, 270) < 0.05)
  const bowed = seatOnZone(
    { x: 50, y: -36 },
    [{ points: lawn, bends: [{ x: 50, y: -40 }, null, null, null] }],
    20,
    16,
  )
  if (!bowed) throw new Error('дуга не поймана')
  assert.ok(bowed.y < -10)
  assert.ok(angleGap(bowed.rotationDeg, 180) < 8)
})

test('heads along a left-to-right edge aim up on the left side', () => {
  const row = headsAlong([{ x: 0, y: 0 }, { x: 100, y: 0 }], 50, 1)
  assert.equal(row.length, 2)
  assert.equal(row[0].x, 0)
  assert.equal(row[0].y, 0)
  assert.equal(row[0].rotationDeg, 0)
  assert.equal(row[1].x, 100)
  assert.equal(headsAlong([{ x: 0, y: 0 }, { x: 100, y: 0 }], 50, -1)[0].rotationDeg, 180)
  const mid = headsAlong([{ x: 0, y: 0 }, { x: 100, y: 0 }], 180, 1)
  assert.equal(mid.length, 1)
  assert.equal(mid[0].x, 50)
  assert.equal(mid[0].rotationDeg, 0)
})

test('zone close uses screen pixels, so a fitted large sheet still hits the start vertex', () => {
  const start = { x: 100, y: 100 }
  const k = 0.12
  const onDot = { x: 120, y: 100 }
  assert.equal(dist(start, onDot) <= SNAP_PX, false)
  assert.equal(withinScreen(start, onDot, k, 32), true)
  assert.equal(withinScreen(start, { x: 500, y: 100 }, k, 32), false)
})

test('a bent edge flattens into a polyline that keeps the bulge', () => {
  const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]
  const bends = [{ x: 50, y: 40 }, null, null, null]
  const ring = flattenRing(square, bends)
  if (!ring) throw new Error('дуга не разобралась')
  assert.ok(ring.length > 4)
  assert.ok(ring.some((point) => point.x > 20 && point.x < 80 && point.y > 10 && point.y < 35))
  assert.equal(flattenRing(square, [null, null, null, null])?.length, 4)
  assert.equal(flattenRing(square, bends, 3), null)
})

test('align shift matches an edge or the centre of the target box', () => {
  const moving = { minX: 0, minY: 0, maxX: 10, maxY: 10 }
  const target = { minX: 100, minY: 40, maxX: 130, maxY: 80 }
  assert.deepEqual(alignShift(moving, target, 'left'), { dx: 100, dy: 0 })
  assert.deepEqual(alignShift(moving, target, 'right'), { dx: 120, dy: 0 })
  assert.deepEqual(alignShift(moving, target, 'top'), { dx: 0, dy: 40 })
  assert.deepEqual(alignShift(moving, target, 'bottom'), { dx: 0, dy: 70 })
  assert.deepEqual(alignShift(moving, target, 'center'), { dx: 110, dy: 55 })
  const pin = { minX: 8, minY: 3, maxX: 8, maxY: 3 }
  assert.deepEqual(alignShift(moving, pin, 'left'), { dx: 8, dy: 0 })
  assert.deepEqual(alignShift(moving, pin, 'center'), { dx: 3, dy: -2 })
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

test('a click on the spray or on the head picks that sprinkler over the lawn', () => {
  const heads = [
    { id: 'a', x: 100, y: 100, radiusM: 4.5, arcDeg: 180, rotationDeg: 180 },
    { id: 'b', x: 300, y: 100, radiusM: 4.5, arcDeg: 360, rotationDeg: 0 },
  ]
  const ppm = 10
  assert.equal(pickSprinkler(heads, { x: 100, y: 100 }, 1, ppm), 'a')
  assert.equal(pickSprinkler(heads, { x: 100, y: 120 }, 1, ppm), 'a')
  assert.equal(pickSprinkler(heads, { x: 300, y: 100 }, 1, ppm), 'b')
  assert.equal(pickSprinkler(heads, { x: 300, y: 130 }, 1, ppm), null)
})

test('a side strip covers a rectangle in front of the head', () => {
  const origin = { x: 0, y: 0 }
  assert.equal(pointInStrip(origin, 0, 15, 90, 'center', { x: 0, y: -10 }), true)
  assert.equal(pointInStrip(origin, 0, 15, 90, 'center', { x: 0, y: -20 }), false)
  assert.equal(pointInStrip(origin, 0, 15, 90, 'center', { x: 40, y: -10 }), true)
  assert.equal(pointInStrip(origin, 0, 15, 90, 'center', { x: 50, y: -10 }), false)
  assert.equal(pointInStrip(origin, 0, 45, 15, 'left', { x: -10, y: -20 }), true)
  assert.equal(pointInStrip(origin, 0, 45, 15, 'left', { x: 10, y: -20 }), false)
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

test('an edge length keeps the first vertex and scales its bend', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]
  const edge = resizeEdge(square, null, 0, 50)
  assert.deepEqual(edge?.points[0], { x: 0, y: 0 })
  assert.deepEqual(edge?.points[1], { x: 50, y: 0 })
  const bent = resizeEdge(square, [{ x: 50, y: 40 }, null, null, null], 0, 50)
  assert.deepEqual(bent?.bends?.[0], { x: 25, y: 20 })
  assert.equal(resizeEdge([{ x: 0, y: 0 }, { x: 0, y: 0 }], null, 0, 10), null)
  const last = resizeEdge(square, null, 3, 50)
  assert.deepEqual(last?.points[3], { x: 0, y: 100 })
  assert.deepEqual(last?.points[0], { x: 0, y: 50 })
})

test('a corner fillet stops each side one radius early and keeps the far bend', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]
  const bends = [null, { x: 100, y: 50 }, null, null]
  const cut = filletVertex(square, bends, 0, 10)
  assert.ok(cut)
  assert.ok(Math.hypot(cut.points[0].x - 0, cut.points[0].y - 10) < 1e-6)
  assert.ok(Math.hypot(cut.points[1].x - 10, cut.points[1].y - 0) < 1e-6)
  assert.deepEqual(cut.bends[0], { x: 0, y: 0 })
  assert.deepEqual(cut.bends[2], { x: 100, y: 50 })
  assert.equal(cut?.points.length, 5)
  assert.equal(filletVertex(square, null, 0, 200), null)
  assert.equal(filletVertex([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }], null, 1, 5), null)
})

test('a note leader points at the tip and a short one is omitted', () => {
  const mark = noteLeader({ x: 0, y: 0 }, { x: 100, y: 0 }, 1)
  assert.ok(mark)
  assert.deepEqual(mark.head[0], { x: 100, y: 0 })
  assert.ok(Math.abs(mark.shaft[1].x - 89) < 1e-6)
  assert.equal(mark.shaft[1].y, 0)
  assert.ok(Math.abs(mark.head[1].y) > 1)
  assert.equal(noteLeader({ x: 0, y: 0 }, { x: 5, y: 0 }, 1), null)
})
