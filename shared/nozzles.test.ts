import assert from 'node:assert/strict'
import test from 'node:test'
import { nozzleById, NOZZLES, nozzlesOf } from './nozzles.ts'

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
    const radii = new Set(nozzlesOf(kind).map((item) => item.radiusM))
    assert.ok(radii.size >= 3, kind)
    for (const radius of radii) {
      const row = nozzlesOf(kind).filter((item) => item.radiusM === radius)
      const full = row.find((item) => item.arcDeg === 360)
      const half = row.find((item) => item.arcDeg === 180)
      const quarter = row.find((item) => item.arcDeg === 90)
      assert.ok(full && half && quarter)
      assert.equal(full.flowLph, half.flowLph * 2)
      assert.equal(half.flowLph, quarter.flowLph * 2)
    }
  }
  assert.ok(nozzlesOf('bubbler').every((item) => item.radiusM <= 1 && item.flowLph >= 60))
  assert.equal(new Set(NOZZLES.map((item) => item.id)).size, NOZZLES.length)
})
