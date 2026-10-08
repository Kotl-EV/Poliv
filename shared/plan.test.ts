import assert from 'node:assert/strict'
import test from 'node:test'
import { analyze } from './analyze.ts'
import { emptyDoc } from './doc.ts'
import { layoutIrrigation, layoutPlan, pxPerMeterFromPage, scaleBarPxPerMeter, segmentRole, sheetScaleRatio, type InkSeg } from './plan.ts'
import { pointInPolygon } from './geom.ts'
import type { Point } from './types.ts'

function rect(x: number, y: number, w: number, h: number, role: InkSeg['role']): InkSeg[] {
  const a = { x, y }
  const b = { x: x + w, y }
  const c = { x: x + w, y: y + h }
  const d = { x, y: y + h }
  return [
    { a, b, role },
    { a: b, b: c, role },
    { a: c, b: d, role },
    { a: d, b: a, role },
  ]
}

test('sheet scale reads 1:200 and turns page width into metres', () => {
  assert.equal(sheetScaleRatio('2. Масштаб 1:200'), 200)
  assert.equal(sheetScaleRatio('без масштаба'), null)
  const px = pxPerMeterFromPage(1191, 1191, 200)
  assert.ok(Math.abs(px - 72 / (0.0254 * 200)) < 1e-9)
})

test('a 0-1-2-10-20 scale bar gives pixels per metre', () => {
  const y = 491
  const tick = (x: number) => [{ a: { x, y: y - 3 }, b: { x, y: y + 3 } }]
  const strokes = [
    { a: { x: 603, y }, b: { x: 749, y } },
    ...tick(603),
    ...tick(610),
    ...tick(618),
    ...tick(676),
    ...tick(749),
  ]
  const ppm = scaleBarPxPerMeter(strokes)
  assert.ok(ppm)
  assert.ok(Math.abs(ppm - 146 / 20) < 0.15)
  assert.equal(scaleBarPxPerMeter([{ a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }]), null)
})

test('segment role keeps the plot and drops the sheet frame', () => {
  const ppm = 10
  assert.equal(segmentRole({ x: 0, y: 0 }, { x: 80, y: 0 }, [0, 0, 0], ppm), null)
  assert.equal(segmentRole({ x: 0, y: 0 }, { x: 40, y: 30 }, [0, 0, 0], ppm), 'structure')
  assert.equal(segmentRole({ x: 0, y: 0 }, { x: 6, y: 4 }, [0, 0, 0], ppm), 'hatch')
  assert.equal(segmentRole({ x: 0, y: 0 }, { x: 16, y: 12 }, [0, 0, 0], ppm), 'grid')
  assert.equal(segmentRole({ x: 0, y: 0 }, { x: 40, y: 30 }, [0.9, 0.9, 0.9], ppm), 'grid')
  assert.equal(segmentRole({ x: 0, y: 0 }, { x: 80, y: 0 }, [0.9, 0.9, 0.9], ppm), null)
  assert.equal(segmentRole({ x: 0, y: 0 }, { x: 8, y: 6 }, [0, 0.87, 0.1], ppm), 'plant')
  assert.equal(segmentRole({ x: 0, y: 0 }, { x: 3, y: 2 }, [0.75, 0.86, 0.78], ppm), 'stipple')
  assert.equal(segmentRole({ x: 0, y: 0 }, { x: 20, y: 12 }, [0.8, 0.41, 0.16], ppm), 'bed')
})

function lawnOf(doc: NonNullable<ReturnType<typeof layoutPlan>>) {
  return doc.zones.find((zone) => zone.kind === 'lawn')
}

test('a fenced rectangle gets sprinklers, valves and a connected network', () => {
  const ppm = 10
  const doc = layoutPlan({ width: 500, height: 400, pxPerMeter: ppm }, rect(100, 80, 200, 140, 'structure'))
  assert.ok(doc)
  assert.ok(doc.sprinklers.length >= 4)
  assert.ok(doc.valves.length >= 1)
  assert.ok(doc.source)
  const lawn = lawnOf(doc)
  assert.ok(lawn)
  for (const head of doc.sprinklers) {
    assert.ok(head.x > 100 && head.x < 300 && head.y > 80 && head.y < 220)
  }
  const analysis = analyze(doc)
  assert.ok((lawn && analysis.zones.find((zone) => zone.id === lawn.id)?.areaM2) || 0 > 100)
  const area = analysis.zones.find((zone) => zone.id === lawn.id)?.areaM2 ?? 0
  assert.ok(area > 100 && area < 290)
  assert.ok(analysis.connectedFlowLph > 0)
  assert.ok(analysis.stations.every((station) => station.flowLph <= 1500))
  assert.ok(analysis.totalFlowLph >= analysis.connectedFlowLph)
  assert.equal(analysis.warnings.some((item) => item.includes('петля')), false)
  assert.equal(analysis.warnings.some((item) => item.includes('не стоит на трубе')), false)
  assert.equal(analysis.warnings.some((item) => item.includes('не соединена')), false)
})

test('a building inside the fence is left dry', () => {
  const open = layoutPlan({ width: 500, height: 400, pxPerMeter: 10 }, rect(100, 80, 200, 140, 'structure'))
  const withHouse = layoutPlan(
    { width: 500, height: 400, pxPerMeter: 10 },
    [...rect(100, 80, 200, 140, 'structure'), ...rect(150, 120, 60, 60, 'structure')],
  )
  assert.ok(open && withHouse)
  const house: Point[] = [
    { x: 150, y: 120 },
    { x: 210, y: 120 },
    { x: 210, y: 180 },
    { x: 150, y: 180 },
  ]
  assert.equal(withHouse.sprinklers.some((head) => pointInPolygon(head, house)), false)
  const lawn = withHouse.zones.find((zone) => zone.kind === 'lawn')
  assert.ok(lawn)
  assert.equal(pointInPolygon({ x: 180, y: 150 }, lawn.points), false)
  const openArea = analyze(open).zones.find((zone) => zone.kind === 'lawn')?.areaM2 ?? 0
  const houseArea = analyze(withHouse).zones.find((zone) => zone.kind === 'lawn')?.areaM2 ?? 0
  assert.ok(houseArea < openArea - 15)
})

test('a paving grid inside the fence stays dry', () => {
  const ppm = 10
  const grid: InkSeg[] = []
  for (let i = 0; i < 10; i++) {
    const y = 110 + i * 6
    grid.push({ a: { x: 130, y }, b: { x: 250, y }, role: 'grid' })
  }
  const doc = layoutPlan({ width: 500, height: 400, pxPerMeter: ppm }, [...rect(100, 80, 200, 140, 'structure'), ...grid])
  assert.ok(doc)
  const lawn = lawnOf(doc)
  assert.ok(lawn)
  assert.equal(pointInPolygon({ x: 180, y: 140 }, lawn.points), false)
  const area = analyze(doc).zones.find((zone) => zone.id === lawn.id)?.areaM2 ?? 0
  assert.ok(area > 20)
  assert.equal(doc.sprinklers.some((head) => head.x > 140 && head.x < 240 && head.y > 120 && head.y < 160), false)
})

test('a bed gets drip and no sprinkler inside it', () => {
  const doc = layoutPlan(
    { width: 500, height: 400, pxPerMeter: 10 },
    [...rect(100, 80, 200, 140, 'structure'), ...rect(120, 150, 40, 30, 'bed')],
  )
  assert.ok(doc)
  const bed = doc.zones.find((zone) => zone.kind === 'bed')
  assert.ok(bed)
  assert.ok(doc.drips.length >= 1)
  assert.ok(analyze(doc).drips.flowLph > 0)
  assert.equal(doc.sprinklers.some((head) => pointInPolygon(head, bed.points)), false)
})

test('layout from a drawn lawn and a source places heads and pipes', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [{
    id: 'zone-lawn',
    name: 'Газон',
    kind: 'lawn',
    doseMm: 6,
    soil: 'loam',
    slope: 'flat',
    climate: 'open',
    points: [
      { x: 100, y: 80 },
      { x: 300, y: 80 },
      { x: 300, y: 220 },
      { x: 100, y: 220 },
    ],
  }]
  doc.source = { x: 60, y: 150, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.equal(next.zones.length, 1)
  assert.ok(next.sprinklers.length >= 4)
  assert.ok(next.pipes.length >= 1)
  assert.ok(next.source && next.source.x === 60)
  const analysis = analyze(next)
  assert.ok(analysis.connectedFlowLph > 0)
  assert.equal(analysis.warnings.some((item) => item.includes('не соединена')), false)
})

test('layout puts drip on a bed and keeps the lawn heads out of it', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [
    {
      id: 'zone-lawn',
      name: 'Газон',
      kind: 'lawn',
      doseMm: 6,
      soil: 'loam',
      slope: 'flat',
      climate: 'open',
      points: [
        { x: 100, y: 80 },
        { x: 300, y: 80 },
        { x: 300, y: 220 },
        { x: 100, y: 220 },
      ],
    },
    {
      id: 'zone-bed',
      name: 'Клумба',
      kind: 'bed',
      doseMm: 8,
      soil: 'loam',
      slope: 'flat',
      climate: 'open',
      points: [
        { x: 120, y: 150 },
        { x: 170, y: 150 },
        { x: 170, y: 190 },
        { x: 120, y: 190 },
      ],
    },
  ]
  doc.source = { x: 60, y: 150, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  const bed = next.zones.find((zone) => zone.kind === 'bed')
  assert.ok(bed)
  assert.ok(next.drips.length >= 1)
  assert.equal(next.sprinklers.some((head) => pointInPolygon(head, bed.points)), false)
})

test('layoutIrrigation needs scale, source and a wet zone', () => {
  const base = emptyDoc()
  assert.equal(layoutIrrigation(base), null)
  base.pxPerMeter = 10
  assert.equal(layoutIrrigation(base), null)
  base.source = { x: 10, y: 10, pressureBar: 3, flowLimitLph: null }
  assert.equal(layoutIrrigation(base), null)
})

function zone(id: string, kind: 'lawn' | 'bed' | 'shrub' | 'building', x: number, y: number, w: number, h: number) {
  return {
    id,
    name: id,
    kind,
    doseMm: kind === 'lawn' ? 6 : 8,
    soil: 'loam' as const,
    slope: 'flat' as const,
    climate: 'open' as const,
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  }
}

function coveredShare(points: Point[], sprinklers: { x: number; y: number; radiusM: number; arcDeg: number; rotationDeg: number }[], ppm: number): number {
  const minX = Math.min(...points.map((p) => p.x))
  const maxX = Math.max(...points.map((p) => p.x))
  const minY = Math.min(...points.map((p) => p.y))
  const maxY = Math.max(...points.map((p) => p.y))
  const step = 0.6 * ppm
  let total = 0
  let good = 0
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let y = minY + step / 2; y < maxY; y += step) {
      const sample = { x, y }
      if (!pointInPolygon(sample, points)) continue
      total += 1
      const hit = sprinklers.some((head) => {
        const d = Math.hypot(head.x - sample.x, head.y - sample.y)
        if (d > head.radiusM * ppm * 1.05) return false
        if (head.arcDeg >= 359) return true
        const bearing = ((Math.atan2(sample.x - head.x, -(sample.y - head.y)) * 180) / Math.PI + 360) % 360
        let delta = bearing - head.rotationDeg
        while (delta > 180) delta -= 360
        while (delta < -180) delta += 360
        return Math.abs(delta) <= head.arcDeg / 2 + 6
      })
      if (hit) good += 1
    }
  }
  return total === 0 ? 0 : good / total
}

test('a rectangular lawn gets heads at the corners aimed inward', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 100, 80, 200, 140)]
  doc.source = { x: 60, y: 150, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  if (!next) return
  const corners = [
    { x: 100, y: 80 },
    { x: 300, y: 80 },
    { x: 300, y: 220 },
    { x: 100, y: 220 },
  ]
  for (const corner of corners) {
    let found = false
    for (const item of next.sprinklers) {
      if (Math.hypot(item.x - corner.x, item.y - corner.y) >= 25) continue
      found = true
      assert.ok(item.arcDeg <= 100)
      assert.ok(item.x > 100 && item.x < 300 && item.y > 80 && item.y < 220)
      break
    }
    assert.ok(found, `no head near ${corner.x},${corner.y}`)
  }
  assert.ok(coveredShare(next.zones[0].points, next.sprinklers, 10) >= 0.9)
})

test('an L-shaped lawn is covered without heads in the cutout', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [{
    id: 'lawn',
    name: 'Газон',
    kind: 'lawn',
    doseMm: 6,
    soil: 'loam',
    slope: 'flat',
    climate: 'open',
    points: [
      { x: 100, y: 80 },
      { x: 300, y: 80 },
      { x: 300, y: 150 },
      { x: 180, y: 150 },
      { x: 180, y: 220 },
      { x: 100, y: 220 },
    ],
  }]
  doc.source = { x: 60, y: 150, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.ok(next.sprinklers.length >= 4)
  const cutout = [
    { x: 180, y: 150 },
    { x: 300, y: 150 },
    { x: 300, y: 220 },
    { x: 180, y: 220 },
  ]
  assert.equal(next.sprinklers.some((head) => pointInPolygon(head, cutout)), false)
  assert.ok(coveredShare(next.zones[0].points, next.sprinklers, 10) >= 0.82)
})

test('a large lawn uses rotors and covers most of the grass', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 100, 80, 200, 140)]
  doc.source = { x: 60, y: 150, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.ok(next.sprinklers.length >= 4)
  assert.ok(next.sprinklers.length <= 16)
  assert.ok(next.sprinklers.some((head) => head.radiusM >= 9))
  assert.ok(coveredShare(next.zones[0].points, next.sprinklers, 10) >= 0.85)
  const analysis = analyze(next)
  assert.equal(analysis.warnings.some((item) => item.includes('не соединена')), false)
  assert.equal(analysis.warnings.some((item) => item.includes('не стоит на трубе')), false)
})

test('a small lawn uses fan nozzles', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 100, 80, 90, 60)]
  doc.source = { x: 60, y: 110, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.ok(next.sprinklers.length >= 2)
  assert.ok(next.sprinklers.every((head) => head.radiusM <= 5))
  assert.ok(coveredShare(next.zones[0].points, next.sprinklers, 10) >= 0.8)
})

test('a bed without a lawn still gets drip laterals', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('bed', 'bed', 100, 80, 50, 40)]
  doc.source = { x: 60, y: 100, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.equal(next.sprinklers.length, 0)
  assert.ok(next.drips.length >= 1)
  const lengthM = next.drips.reduce((sum, drip) => {
    let px = 0
    for (let i = 1; i < drip.points.length; i++) {
      px += Math.hypot(drip.points[i].x - drip.points[i - 1].x, drip.points[i].y - drip.points[i - 1].y)
    }
    return sum + px / 10
  }, 0)
  assert.ok(lengthM > 20, `drip ${lengthM}m should be laterals, not a 18m perimeter`)
  assert.ok(analyze(next).drips.flowLph > 0)
})

test('shrubs get drip and a building stays dry', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [
    zone('lawn', 'lawn', 80, 60, 220, 160),
    zone('shrub', 'shrub', 100, 80, 40, 40),
    zone('house', 'building', 200, 100, 50, 50),
  ]
  doc.source = { x: 40, y: 140, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  const shrub = next.zones.find((item) => item.kind === 'shrub')
  const house = next.zones.find((item) => item.kind === 'building')
  assert.ok(shrub && house)
  assert.ok(next.drips.length >= 1)
  assert.equal(next.sprinklers.some((head) => pointInPolygon(head, shrub.points)), false)
  assert.equal(next.sprinklers.some((head) => pointInPolygon(head, house.points)), false)
  const dripInShrub = next.drips.some((drip) => drip.points.some((point, i) => i > 0 && pointInPolygon(point, shrub.points)))
  assert.ok(dripInShrub)
})
