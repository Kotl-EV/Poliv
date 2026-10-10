import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDoc } from './doc.ts'
import { draftHeadFlow, headPrecipMmH, joinableHeads, stickTarget } from './join.ts'

test('a head already on a pipe is not offered again', () => {
  const doc = emptyDoc()
  doc.sprinklers = [
    { id: 'on', nozzleId: 'fan180', x: 10, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 },
    { id: 'free', nozzleId: 'fan180', x: 40, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 },
  ]
  doc.pipes = [{ id: 'p', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }]
  const heads = joinableHeads(doc, [], 14)
  assert.deepEqual(heads.map((head) => head.id), ['free'])
})

test('after the first head only a similar precipitation stays', () => {
  const doc = emptyDoc()
  doc.sprinklers = [
    { id: 'fan', nozzleId: 'fan180', x: 0, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 },
    { id: 'mate', nozzleId: 'fan180', x: 30, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 },
    { id: 'rotor', nozzleId: 'rotor', x: 60, y: 0, radiusM: 10, arcDeg: 180, rotationDeg: 0, flowLph: 720 },
  ]
  const fan = headPrecipMmH(doc.sprinklers[0])
  const rotor = headPrecipMmH(doc.sprinklers[2])
  assert.ok(Math.abs(fan - rotor) / fan > 0.2)
  const heads = joinableHeads(doc, [{ x: 0, y: 0 }], 14)
  assert.deepEqual(heads.map((head) => head.id), ['fan', 'mate'])
  assert.equal(draftHeadFlow(doc, [{ x: 0, y: 0 }, { x: 30, y: 0 }], 14), 720)
})

test('a zone line sticks to a valve before empty ground', () => {
  const doc = emptyDoc()
  doc.valves = [{ id: 'v', name: 'Клапан 1', x: 10, y: 0 }]
  const stuck = stickTarget(doc, { x: 12, y: 2 }, 'zone', [], 14)
  assert.equal(stuck?.valveId, 'v')
  assert.equal(stuck?.x, 10)
  assert.equal(stickTarget(doc, { x: 40, y: 0 }, 'zone', [], 14), null)
})
