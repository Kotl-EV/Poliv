import assert from 'node:assert/strict'
import test from 'node:test'
import { funnyPoints, pipeTags } from './pipeview.ts'
import type { SegmentResult } from './types.ts'

function segment(patch: Partial<SegmentResult>): SegmentResult {
  return {
    pipeId: 'p',
    a: { x: 0, y: 0 },
    b: { x: 100, y: 0 },
    lengthM: 5,
    flowLph: 360,
    odMm: 25,
    idMm: 20.4,
    name: 'ПЭ 25',
    velocity: 1,
    headLossM: 0.2,
    residualHeadM: 20,
    status: 'ok',
    role: 'main',
    ...patch,
  }
}

test('a flexible tail starts and ends on its two points', () => {
  const points = funnyPoints({ x: 0, y: 0 }, { x: 40, y: 0 })
  assert.ok(points.length > 4)
  assert.equal(points[0].x, 0)
  assert.equal(points[0].y, 0)
  assert.ok(Math.abs(points[points.length - 1].x - 40) < 1e-9)
  assert.ok(Math.abs(points[points.length - 1].y) < 1e-9)
  assert.ok(points.some((point) => Math.abs(point.y) > 1))
})

test('a long fed pipe gets a diameter tag and a short one does not', () => {
  const tags = pipeTags(
    [
      segment({}),
      segment({ b: { x: 4, y: 0 }, odMm: 20, status: 'ok' }),
      segment({ odMm: 32, status: 'unfed', a: { x: 0, y: 30 }, b: { x: 100, y: 30 } }),
    ],
    20,
    1,
  )
  assert.equal(tags.length, 1)
  assert.equal(tags[0].text, 'Ø25')
  assert.equal(tags[0].rotate, 0)
  assert.ok(Math.abs(tags[0].x - 50) < 1e-6)
  assert.ok(tags[0].y > 0)
})
