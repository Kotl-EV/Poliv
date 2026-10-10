import assert from 'node:assert/strict'
import test from 'node:test'
import { brushOutline, clipRegions, mirrorAcross, splitRegion } from './clip.ts'
import { offsetRing, pointInZone, zoneAreaPx } from './geom.ts'
import type { Point } from './types.ts'

function box(x: number, y: number, w: number, h: number): Point[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
}

function area(regions: { points: Point[]; holes?: Point[][] }[]): number {
  return regions.reduce((sum, region) => sum + zoneAreaPx(region.points, region.holes), 0)
}

test('union of overlapping rectangles is one rectangle of the combined area', () => {
  const regions = clipRegions('union', { points: box(0, 0, 10, 10) }, { points: box(5, 0, 10, 10) })
  assert.equal(regions.length, 1)
  assert.ok(Math.abs(area(regions) - 150) < 0.5, JSON.stringify(regions))
  assert.equal(regions[0].holes, undefined)
})

test('intersection keeps only the overlap', () => {
  const regions = clipRegions('intersect', { points: box(0, 0, 10, 10) }, { points: box(5, 0, 10, 10) })
  assert.equal(regions.length, 1)
  assert.ok(Math.abs(area(regions) - 50) < 0.5, JSON.stringify(regions))
  assert.ok(pointInZone({ x: 7, y: 5 }, regions[0].points, regions[0].holes))
  assert.equal(pointInZone({ x: 2, y: 5 }, regions[0].points, regions[0].holes), false)
})

test('difference cuts the overlap and keeps the cutter out', () => {
  const regions = clipRegions('diff', { points: box(0, 0, 10, 10) }, { points: box(5, 0, 10, 10) })
  assert.equal(regions.length, 1)
  assert.ok(Math.abs(area(regions) - 50) < 0.5, JSON.stringify(regions))
  assert.ok(pointInZone({ x: 2, y: 5 }, regions[0].points, regions[0].holes))
  assert.equal(pointInZone({ x: 7, y: 5 }, regions[0].points, regions[0].holes), false)
})

test('xor keeps both wings and drops the overlap', () => {
  const regions = clipRegions('xor', { points: box(0, 0, 10, 10) }, { points: box(5, 0, 10, 10) })
  assert.ok(Math.abs(area(regions) - 100) < 0.5, JSON.stringify(regions))
  assert.equal(regions.some((region) => pointInZone({ x: 2, y: 5 }, region.points, region.holes)), true)
  assert.equal(regions.some((region) => pointInZone({ x: 12, y: 5 }, region.points, region.holes)), true)
  assert.equal(regions.some((region) => pointInZone({ x: 7, y: 5 }, region.points, region.holes)), false)
})

test('edge-touching rectangles unite into one', () => {
  const regions = clipRegions('union', { points: box(0, 0, 10, 10) }, { points: box(10, 0, 10, 10) })
  assert.equal(regions.length, 1, JSON.stringify(regions))
  assert.ok(Math.abs(area(regions) - 200) < 0.5)
})

test('a cutter fully inside leaves a hole', () => {
  const regions = clipRegions('diff', { points: box(0, 0, 30, 30) }, { points: box(10, 10, 10, 10) })
  assert.equal(regions.length, 1, JSON.stringify(regions))
  assert.ok(Math.abs(area(regions) - 800) < 1, JSON.stringify(regions))
  assert.ok((regions[0].holes ?? []).length === 1)
  assert.equal(pointInZone({ x: 15, y: 15 }, regions[0].points, regions[0].holes), false)
  assert.ok(pointInZone({ x: 2, y: 2 }, regions[0].points, regions[0].holes))
})

test('disjoint rectangles stay apart', () => {
  const regions = clipRegions('union', { points: box(0, 0, 4, 4) }, { points: box(20, 0, 4, 4) })
  assert.equal(regions.length, 2, JSON.stringify(regions))
  assert.ok(Math.abs(area(regions) - 32) < 0.5)
})

test('an L united with its notch becomes a rectangle', () => {
  const ell: Point[] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 20 },
    { x: 0, y: 20 },
  ]
  const notch = box(10, 10, 10, 10)
  const regions = clipRegions('union', { points: ell }, { points: notch })
  assert.equal(regions.length, 1, JSON.stringify(regions))
  assert.ok(Math.abs(area(regions) - 400) < 1, JSON.stringify(regions))
})

test('offset grows and shrinks a square', () => {
  const grown = offsetRing(box(0, 0, 10, 10), 1)
  assert.ok(grown)
  assert.ok(Math.abs(zoneAreaPx(grown!) - 144) < 1, JSON.stringify(grown))
  const shrunk = offsetRing(box(0, 0, 10, 10), -1)
  assert.ok(shrunk)
  assert.ok(Math.abs(zoneAreaPx(shrunk!) - 64) < 1, JSON.stringify(shrunk))
  assert.equal(offsetRing(box(0, 0, 10, 10), -6), null)
})

test('square brush covers a straight stroke', () => {
  const region = brushOutline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10, 'square')
  assert.ok(region)
  const covered = zoneAreaPx(region!.points, region!.holes)
  assert.ok(covered > 2000 && covered < 2800, String(covered))
  assert.ok(pointInZone({ x: 50, y: 0 }, region!.points, region!.holes))
})

test('a vertical cut splits a square into two areas that add up', () => {
  const parts = splitRegion({ points: box(0, 0, 10, 10) }, { x: 4, y: -5 }, { x: 4, y: 15 })
  assert.ok(parts && parts.length === 2, JSON.stringify(parts))
  const areas = parts!.map((part) => zoneAreaPx(part.points, part.holes)).sort((a, b) => a - b)
  assert.ok(Math.abs(areas[0] - 40) < 1, JSON.stringify(areas))
  assert.ok(Math.abs(areas[1] - 60) < 1, JSON.stringify(areas))
})

test('a line that misses the square does not cut it', () => {
  assert.equal(splitRegion({ points: box(0, 0, 10, 10) }, { x: 30, y: 0 }, { x: 30, y: 10 }), null)
})

test('an L cut at the notch becomes two rectangles', () => {
  const ell: Point[] = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
    { x: 10, y: 10 },
    { x: 10, y: 20 },
    { x: 0, y: 20 },
  ]
  const parts = splitRegion({ points: ell }, { x: 10, y: -2 }, { x: 10, y: 22 })
  assert.ok(parts && parts.length === 2, JSON.stringify(parts))
  const areas = parts!.map((part) => zoneAreaPx(part.points, part.holes)).sort((a, b) => a - b)
  assert.ok(Math.abs(areas[0] - 100) < 1.5, JSON.stringify(areas))
  assert.ok(Math.abs(areas[1] - 200) < 1.5, JSON.stringify(areas))
})

test('mirror across a horizontal line flips y', () => {
  assert.deepEqual(mirrorAcross({ x: 2, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }), { x: 2, y: -5 })
})

test('one triangle click is a triangle', () => {
  const region = brushOutline([{ x: 10, y: 10 }], 6, 'triangle')
  assert.ok(region)
  assert.equal(region!.points.length, 3)
  assert.ok(zoneAreaPx(region!.points) > 10)
})
