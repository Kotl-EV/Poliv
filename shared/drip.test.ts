import assert from 'node:assert/strict'
import test from 'node:test'
import { dripPitch, dripRingPoints, emitterPoints, placeDripAtPlant, placeDripOnPolygon } from './drip.ts'
import { dist, pointInPolygon } from './geom.ts'
import { layoutIrrigation } from './plan.ts'
import { emptyDoc } from './doc.ts'
import type { Point } from './types.ts'

const PPM = 10

test('a drip ring is centered on the plant and passes through the anchor', () => {
  const anchor = { x: 100, y: 40 }
  const center = { x: 100, y: 80 }
  assert.equal(dripRingPoints(anchor, { x: 100, y: 42 }), null)
  const ring = dripRingPoints(anchor, center)
  assert.ok(ring)
  assert.equal(ring![0].x, anchor.x)
  assert.equal(ring![0].y, anchor.y)
  assert.equal(ring![ring!.length - 1].x, anchor.x)
  assert.equal(ring![ring!.length - 1].y, anchor.y)
  for (const point of ring!) assert.ok(Math.abs(dist(point, center) - 40) < 1e-6)
})

function rect(x: number, y: number, w: number, h: number): Point[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

function runLen(runs: { points: Point[] }[], ppm: number): number {
  let px = 0
  for (const run of runs) {
    for (let i = 1; i < run.points.length; i++) px += dist(run.points[i - 1], run.points[i])
  }
  return px / ppm
}

function longSegs(runs: { points: Point[] }[], minM: number, ppm: number): [Point, Point][] {
  const min = minM * ppm
  const segs: [Point, Point][] = []
  for (const run of runs) {
    for (let i = 1; i < run.points.length; i++) {
      if (dist(run.points[i - 1], run.points[i]) >= min) segs.push([run.points[i - 1], run.points[i]])
    }
  }
  return segs
}

function axisAligned(seg: [Point, Point], ppm: number): boolean {
  const tol = 0.12 * ppm
  return Math.abs(seg[0].x - seg[1].x) < tol || Math.abs(seg[0].y - seg[1].y) < tol
}

test('a rectangular bed gets axis-aligned laterals, not a perimeter loop', () => {
  const ring = rect(100, 80, 50, 40)
  const runs = placeDripOnPolygon(ring, [], PPM, { kind: 'bed', soil: 'loam' })
  assert.ok(runs.length >= 1)
  const lengthM = runLen(runs, PPM)
  assert.ok(lengthM > 20, `laterals ${lengthM}m should beat the 18m perimeter`)
  assert.ok(lengthM < 90, `laterals ${lengthM}m should stay near area/spacing`)
  const segs = longSegs(runs, 1, PPM)
  assert.ok(segs.length >= 4)
  assert.ok(segs.every((seg) => axisAligned(seg, PPM)))
  for (const run of runs) {
    for (const point of run.points) assert.ok(pointInPolygon(point, ring))
  }
})

test('an L-bed does not cross the cutout and does not explode in length', () => {
  const ring: Point[] = [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 80, y: 20 },
    { x: 40, y: 20 },
    { x: 40, y: 60 },
    { x: 0, y: 60 },
  ]
  const cutout = rect(40, 20, 40, 40)
  const topBar = rect(0, 0, 80, 20)
  const runs = placeDripOnPolygon(ring, [], PPM, { kind: 'bed', soil: 'loam' })
  assert.ok(runs.length >= 1)
  const lengthM = runLen(runs, PPM)
  assert.ok(lengthM > 40, `L laterals ${lengthM}m too short for 32 m²`)
  assert.ok(lengthM < 180, `L laterals ${lengthM}m jumped the cutout`)
  const topLong = longSegs(runs, 3.2, PPM).filter((seg) => {
    const mid = { x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 }
    return pointInPolygon(mid, topBar)
  })
  assert.ok(topLong.length >= 2, `top arm should run along the 8 m bar, got ${topLong.length}`)
  assert.ok(topLong.every((seg) => axisAligned(seg, PPM)))
  for (const run of runs) {
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1]
      const b = run.points[i]
      for (const t of [0.25, 0.5, 0.75]) {
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
        assert.equal(pointInPolygon(p, cutout), false, `segment through cutout at ${p.x},${p.y}`)
        assert.ok(pointInPolygon(p, ring), `segment left the L at ${p.x},${p.y}`)
      }
    }
  }
})

test('a U-bed does not bridge the channel', () => {
  const ring: Point[] = [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 80, y: 60 },
    { x: 60, y: 60 },
    { x: 60, y: 20 },
    { x: 20, y: 20 },
    { x: 20, y: 60 },
    { x: 0, y: 60 },
  ]
  const channel = rect(20, 20, 40, 40)
  const runs = placeDripOnPolygon(ring, [], PPM, { kind: 'bed', soil: 'loam' })
  assert.ok(runs.length >= 2)
  const lengthM = runLen(runs, PPM)
  assert.ok(lengthM > 30)
  assert.ok(lengthM < 160, `U laterals ${lengthM}m`)
  for (const run of runs) {
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1]
      const b = run.points[i]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      assert.equal(pointInPolygon(mid, channel), false)
    }
  }
})

test('shrub laterals are farther apart than bed laterals', () => {
  const ring = rect(0, 0, 40, 40)
  const bed = placeDripOnPolygon(ring, [], PPM, { kind: 'bed', soil: 'loam' })
  const shrub = placeDripOnPolygon(ring, [], PPM, { kind: 'shrub', soil: 'loam' })
  const bedLong = longSegs(bed, 1, PPM).length
  const shrubLong = longSegs(shrub, 1, PPM).length
  assert.ok(bedLong > shrubLong, `bed ${bedLong} laterals vs shrub ${shrubLong}`)
  assert.ok(dripPitch('shrub', 'loam').lateralM > dripPitch('bed', 'loam').lateralM)
})

test('sand packs laterals tighter than clay', () => {
  const ring = rect(0, 0, 50, 40)
  const sand = placeDripOnPolygon(ring, [], PPM, { kind: 'bed', soil: 'sand' })
  const clay = placeDripOnPolygon(ring, [], PPM, { kind: 'bed', soil: 'clay' })
  assert.ok(longSegs(sand, 1, PPM).length > longSegs(clay, 1, PPM).length)
})

test('a hole in the bed is punched out of the laterals', () => {
  const outer = rect(0, 0, 60, 60)
  const hole = rect(20, 20, 20, 20)
  const runs = placeDripOnPolygon(outer, [hole], PPM, { kind: 'bed', soil: 'loam' })
  assert.ok(runs.length >= 1)
  for (const run of runs) {
    for (let i = 1; i < run.points.length; i++) {
      const a = run.points[i - 1]
      const b = run.points[i]
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      assert.equal(pointInPolygon(mid, hole), false)
    }
  }
})

test('a narrow strip gets a single centerline', () => {
  const ring = rect(0, 0, 40, 4)
  const runs = placeDripOnPolygon(ring, [], PPM, { kind: 'bed', soil: 'loam' })
  assert.ok(runs.length >= 1)
  assert.equal(longSegs(runs, 1, PPM).length, 1)
})

test('a bush gets two emitters and a tree gets a crown ring', () => {
  const bush = placeDripAtPlant({ kind: 'bush', x: 50, y: 40, radiusM: 0.6 }, PPM)
  assert.ok(bush)
  const bushM = runLen([bush], PPM)
  assert.ok(bushM > 0.8 && bushM < 4, `bush ring ${bushM}m`)
  assert.equal(emitterPoints(bush.points, bush.spacingM, PPM).length, 2)
  for (const point of bush.points) {
    assert.ok(Math.hypot(point.x - 50, point.y - 40) / PPM < 0.6)
  }
  const tree = placeDripAtPlant({ kind: 'tree', x: 0, y: 0, radiusM: 1.6 }, PPM)
  assert.ok(tree)
  const treeM = runLen([tree], PPM)
  assert.ok(treeM < 8, `tree ring ${treeM}m`)
  const emitters = emitterPoints(tree.points, tree.spacingM, PPM).length
  assert.ok(emitters >= 3 && emitters <= 6, `tree emitters ${emitters}`)
  assert.equal(tree.emitterLph, 4)
})

test('layoutIrrigation waters plants and leaves an empty bed dry', () => {
  const empty = emptyDoc()
  empty.pxPerMeter = PPM
  empty.zones = [{
    id: 'bed',
    name: 'bed',
    kind: 'bed',
    doseMm: 8,
    soil: 'loam',
    slope: 'flat',
    climate: 'open',
    points: rect(100, 80, 50, 40),
  }]
  empty.source = { x: 60, y: 100, pressureBar: 3, flowLimitLph: null }
  assert.equal(layoutIrrigation(empty), null)

  const doc = emptyDoc()
  doc.pxPerMeter = PPM
  doc.zones = empty.zones
  doc.source = empty.source
  doc.plants = [
    { id: 'bush', kind: 'bush', x: 120, y: 100, radiusM: 0.6 },
    { id: 'tree', kind: 'tree', x: 135, y: 105, radiusM: 1.6 },
  ]
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.equal(next.drips.length, 2)
  assert.equal(next.sprinklers.length, 0)
  const lengthM = runLen(next.drips, PPM)
  assert.ok(lengthM < 12, `plant drip ${lengthM}m should stay at the plants`)
  for (const drip of next.drips) {
    const mid = {
      x: drip.points.reduce((sum, point) => sum + point.x, 0) / drip.points.length,
      y: drip.points.reduce((sum, point) => sum + point.y, 0) / drip.points.length,
    }
    const near = doc.plants.some((plant) => Math.hypot(plant.x - mid.x, plant.y - mid.y) < 2 * PPM)
    assert.ok(near)
  }
})
