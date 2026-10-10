import assert from 'node:assert/strict'
import test from 'node:test'
import { headCaption, nozzleById, NOZZLES, nozzlesOf, rotorMark, sectorForPlace } from './nozzles.ts'

test('a head caption names the throw, the sector and the flow', () => {
  assert.equal(
    headCaption({ nozzleId: 'fan180', radiusM: 4.5, arcDeg: 180, flowLph: 360 }),
    '4,5 м · 180° · 360 л/ч',
  )
  assert.equal(
    headCaption({ nozzleId: 'fan360', radiusM: 4.5, arcDeg: 360, flowLph: 720 }),
    '4,5 м · 360° · 720 л/ч',
  )
  assert.equal(
    headCaption({ nozzleId: 'fan-ss', radiusM: 1.5, arcDeg: 180, flowLph: 80 }),
    '1,5×9 м · 80 л/ч',
  )
  assert.equal(
    headCaption({ nozzleId: 'fan-es', radiusM: 4.5, arcDeg: 180, flowLph: 40 }),
    '1,5×4,5 м · 40 л/ч',
  )
})

test('a corner and an edge pick the sector of that place', () => {
  assert.deepEqual(sectorForPlace(nozzleById('fan180'), 90), { nozzleId: 'fan90', arcDeg: 90, radiusM: 4.5, flowLph: 180 })
  assert.deepEqual(sectorForPlace(nozzleById('fan360'), 180), { nozzleId: 'fan180', arcDeg: 180, radiusM: 4.5, flowLph: 360 })
  assert.equal(sectorForPlace(nozzleById('fan180'), 270).nozzleId, 'fan45-270')
  assert.equal(sectorForPlace(nozzleById('fan180'), 150).arcDeg, 120)
  const adjustable = sectorForPlace(nozzleById('fan45-adj'), 90)
  assert.equal(adjustable.nozzleId, 'fan45-adj')
  assert.equal(adjustable.arcDeg, 90)
  assert.equal(adjustable.flowLph, nozzleById('fan45-adj').flowLph)
  const wide = sectorForPlace(nozzleById('rot-corner'), 180)
  assert.equal(wide.nozzleId, 'rot-corner')
  assert.equal(wide.arcDeg, 105)
  assert.equal(sectorForPlace(nozzleById('fan-ss'), 90).nozzleId, 'fan-ss')
  assert.equal(sectorForPlace(nozzleById('bub240'), 90).nozzleId, 'bub240')
  assert.equal(sectorForPlace(nozzleById('rotorLa10-180'), 90).nozzleId, 'rotorLa10-90')
})

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
