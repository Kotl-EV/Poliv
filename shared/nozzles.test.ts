import assert from 'node:assert/strict'
import test from 'node:test'
import { nozzleById, NOZZLES, nozzlesOf, rotorMark } from './nozzles.ts'

test('legacy fan and rotor keep their radius and matched flow', () => {
  assert.deepEqual(
    ['fan90', 'fan180', 'fan360', 'rotor90', 'rotor', 'rotor360'].map((id) => {
      const nozzle = nozzleById(id)
      return [nozzle.id, nozzle.radiusM, nozzle.arcDeg, nozzle.flowLph]
    }),
    [
      ['fan90', 4.5, 90, 180],
      ['fan180', 4.5, 180, 360],
      ['fan360', 4.5, 360, 720],
      ['rotor90', 10, 90, 360],
      ['rotor', 10, 180, 720],
      ['rotor360', 10, 360, 1440],
    ],
  )
  assert.equal(nozzleById('missing').id, 'fan180')
})

test('each family has several throws and matched sectors', () => {
  assert.ok(nozzlesOf('fan').length >= 12)
  assert.ok(nozzlesOf('rotator').length >= 12)
  assert.ok(nozzlesOf('rotor').length >= 16)
  assert.ok(nozzlesOf('bubbler').length >= 4)
  for (const kind of ['fan', 'rotator', 'rotor'] as const) {
    const fixed = nozzlesOf(kind).filter((item) => item.pattern === 'fixed')
    const radii = new Set(fixed.map((item) => item.radiusM))
    assert.ok(radii.size >= 3, kind)
    for (const radius of radii) {
      const row = fixed.filter((item) => item.radiusM === radius)
      const full = row.find((item) => item.arcDeg === 360)
      const half = row.find((item) => item.arcDeg === 180)
      const quarter = row.find((item) => item.arcDeg === 90)
      const third = row.find((item) => item.arcDeg === 120)
      assert.ok(full && half && quarter && third)
      assert.equal(full.flowLph, half.flowLph * 2)
      assert.equal(half.flowLph, quarter.flowLph * 2)
      assert.equal(third.flowLph, Math.round((half.flowLph * 2) / 3))
    }
  }
  assert.equal(nozzleById('fan45-120').flowLph, 240)
  assert.equal(nozzleById('fan45-adj').pattern, 'adjust')
  assert.equal(nozzleById('fan45-adj').flowLph, 360)
  assert.equal(nozzleById('fan-ss').pattern, 'strip')
  assert.equal(nozzleById('fan-ss').flowLph, nozzleById('fan-es').flowLph * 2)
  assert.equal(nozzleById('rot-corner').pattern, 'corner')
  assert.equal(nozzleById('rot-corner').flowLph, nozzleById('rot4-90').flowLph)
  const low = nozzlesOf('rotor').filter((item) => item.pattern === 'low' && item.radiusM === 8)
  const lowFull = low.find((item) => item.arcDeg === 360)
  const lowHalf = low.find((item) => item.arcDeg === 180)
  assert.ok(lowFull && lowHalf)
  assert.equal(lowFull.flowLph, lowHalf.flowLph * 2)
  assert.notEqual(nozzleById('rotorLa10-180').id, 'rotor')
  assert.equal(rotorMark(10, false).code, '1.5')
  assert.equal(rotorMark(11.6, false).code, '3')
  assert.equal(rotorMark(9.8, true).code, '3')
  assert.ok(nozzlesOf('bubbler').every((item) => item.radiusM <= 1 && item.flowLph >= 60))
  assert.equal(new Set(NOZZLES.map((item) => item.id)).size, NOZZLES.length)
})
