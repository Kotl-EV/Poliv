import assert from 'node:assert/strict'
import test from 'node:test'
import { dripFlowTags, dripTags, flowArrows, funnyPoints, lossTags, pipeTags, sleeveTags, speedTags } from './pipeview.ts'
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
    stationId: '',
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
  assert.equal(tags[0].text, 'Ø25 · 5 м')
  assert.equal(tags[0].rotate, 0)
  assert.ok(Math.abs(tags[0].x - 50) < 1e-6)
  assert.ok(tags[0].y > 0)
  const bare = pipeTags([segment({ lengthM: null })], 20, 1)
  assert.equal(bare[0].text, 'Ø25')
  const fraction = pipeTags([segment({ lengthM: 12.44, odMm: 32 })], 20, 1)
  assert.equal(fraction[0].text, 'Ø32 · 12,4 м')
})

test('a drip line is labelled with its length and a short one is not', () => {
  const tags = dripTags([{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }] }], 20, 1)
  assert.equal(tags.length, 1)
  assert.equal(tags[0].text, '7 м')
  assert.equal(tags[0].rotate, 0)
  assert.ok(Math.abs(tags[0].x - 50) < 1e-6)
  assert.equal(dripTags([{ points: [{ x: 0, y: 0 }, { x: 4, y: 0 }] }], 20, 1).length, 0)
  assert.equal(dripTags([{ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }], null, 1).length, 0)
})

test('a drip line names its emitters opposite the length and a bare one does not', () => {
  const line = {
    id: 'd',
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }],
    spacingM: 0.3,
    emitterLph: 2,
  }
  const tags = dripFlowTags([line], 20, 1)
  const length = dripTags([line], 20, 1)
  assert.equal(tags.length, 1)
  assert.equal(tags[0].text, '23 шт · 46 л/ч')
  assert.equal(tags[0].rotate, 0)
  assert.ok(Math.abs(tags[0].x - 50) < 1e-6)
  assert.ok(tags[0].y < 0)
  assert.ok(length[0].y > 0)
  assert.equal(dripFlowTags([{ ...line, bare: true }], 20, 1).length, 0)
  assert.equal(dripFlowTags([{ ...line, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }] }], 20, 1).length, 0)
  assert.equal(dripFlowTags([line], null, 1).length, 0)
})

test('a flow arrow points downstream and skips a dry or a short pipe', () => {
  const forward = flowArrows([segment({ a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, flowLph: 360, downB: true })], 20, 1)
  assert.equal(forward.length, 1)
  assert.ok(Math.abs(forward[0].x - 124) < 1e-6)
  assert.equal(forward[0].y, 0)
  assert.equal(forward[0].rotationDeg, 90)
  const back = flowArrows([segment({ a: { x: 200, y: 0 }, b: { x: 0, y: 0 }, flowLph: 360, downB: false })], 20, 1)
  assert.equal(back.length, 1)
  assert.ok(Math.abs(back[0].x - 76) < 1e-6)
  assert.equal(back[0].rotationDeg, 90)
  assert.equal(flowArrows([segment({ flowLph: 0, downB: true })], 20, 1).length, 0)
  assert.equal(flowArrows([segment({ status: 'unfed', flowLph: 360, downB: true })], 20, 1).length, 0)
  assert.equal(flowArrows([segment({ b: { x: 4, y: 0 }, flowLph: 360, downB: true })], 20, 1).length, 0)
})

test('a pipe speed sits opposite the diameter and a fast pipe is marked', () => {
  const calm = speedTags([segment({ velocity: 0.5 })], 20, 1)
  assert.equal(calm.length, 1)
  assert.equal(calm[0].text, '0,5 м/с')
  assert.equal(calm[0].hot, false)
  assert.equal(calm[0].rotate, 0)
  assert.ok(Math.abs(calm[0].x - 50) < 1e-6)
  assert.ok(calm[0].y < 0)
  const fast = speedTags([segment({ velocity: 1.62 })], 20, 1)
  assert.equal(fast[0].text, '1,62 м/с')
  assert.equal(fast[0].hot, true)
  assert.equal(speedTags([segment({ velocity: 1.5 })], 20, 1)[0].hot, false)
  assert.equal(speedTags([segment({ velocity: 0 })], 20, 1).length, 0)
  assert.equal(speedTags([segment({ velocity: null })], 20, 1).length, 0)
  assert.equal(speedTags([segment({ status: 'unfed', velocity: 1 })], 20, 1).length, 0)
  assert.equal(speedTags([segment({ b: { x: 4, y: 0 }, velocity: 1 })], 20, 1).length, 0)
})

test('a pipe loss sits outside the diameter and a dry pipe is skipped', () => {
  const tags = lossTags([segment({ headLossM: 0.32 })], 20, 1)
  const diameter = pipeTags([segment({})], 20, 1)
  assert.equal(tags.length, 1)
  assert.equal(tags[0].text, 'потери 0,32 м')
  assert.equal(tags[0].rotate, 0)
  assert.ok(Math.abs(tags[0].x - 50) < 1e-6)
  assert.ok(tags[0].y > diameter[0].y)
  const fraction = lossTags([segment({ headLossM: 1.256 })], 20, 1)
  assert.equal(fraction[0].text, 'потери 1,26 м')
  assert.equal(lossTags([segment({ headLossM: 0 })], 20, 1).length, 0)
  assert.equal(lossTags([segment({ headLossM: null })], 20, 1).length, 0)
  assert.equal(lossTags([segment({ status: 'unfed', headLossM: 0.3 })], 20, 1).length, 0)
  assert.equal(lossTags([segment({ b: { x: 4, y: 0 }, headLossM: 0.3 })], 20, 1).length, 0)
})

test('a sleeve is labelled with its length and a short one is not', () => {
  const tags = sleeveTags([{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }], 20, 1)
  assert.equal(tags.length, 1)
  assert.equal(tags[0].text, '5 м')
  assert.equal(tags[0].rotate, 0)
  assert.ok(Math.abs(tags[0].x - 50) < 1e-6)
  assert.ok(tags[0].y > 0)
  const fraction = sleeveTags([{ a: { x: 0, y: 0 }, b: { x: 248, y: 0 } }], 20, 1)
  assert.equal(fraction[0].text, '12,4 м')
  assert.equal(sleeveTags([{ a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }], 20, 1).length, 0)
  assert.equal(sleeveTags([{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }], null, 1).length, 0)
})
