import assert from 'node:assert/strict'
import test from 'node:test'
import { analyze } from './analyze.ts'
import { emptyDoc } from './doc.ts'
import { nozzleById } from './nozzles.ts'
import { layoutIrrigation, layoutPlan, pxPerMeterFromPage, scaleBarPxPerMeter, segmentRole, sheetScaleRatio, type InkSeg } from './plan.ts'
import { pointInPolygon } from './geom.ts'
import type { Climate, Point, Slope, Soil } from './types.ts'

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

test('a drawn bed stays free of sprinklers and of a drip carpet', () => {
  const doc = layoutPlan(
    { width: 500, height: 400, pxPerMeter: 10 },
    [...rect(100, 80, 200, 140, 'structure'), ...rect(120, 150, 40, 30, 'bed')],
  )
  assert.ok(doc)
  const bed = doc.zones.find((zone) => zone.kind === 'bed')
  assert.ok(bed)
  assert.equal(doc.drips.length, 0)
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
  assert.ok(next.pipes.some((pipe) => pipe.role === 'main'))
  assert.ok(next.pipes.some((pipe) => pipe.role === 'zone'))
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
  doc.plants = [
    { id: 'bush', kind: 'bush', x: 140, y: 165, radiusM: 0.6 },
    { id: 'tree', kind: 'tree', x: 155, y: 175, radiusM: 1.2 },
  ]
  const next = layoutIrrigation(doc)
  assert.ok(next)
  const bed = next.zones.find((zone) => zone.kind === 'bed')
  assert.ok(bed)
  assert.equal(next.drips.length, 2)
  let px = 0
  for (const drip of next.drips) {
    for (let i = 1; i < drip.points.length; i++) {
      px += Math.hypot(drip.points[i].x - drip.points[i - 1].x, drip.points[i].y - drip.points[i - 1].y)
    }
  }
  assert.ok(px / 10 < 12, `drip ${px / 10}m should sit on the plants`)
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

function zone(
  id: string,
  kind: 'lawn' | 'bed' | 'shrub' | 'building' | 'concrete' | 'path' | 'water',
  x: number,
  y: number,
  w: number,
  h: number,
) {
  return {
    id,
    name: id,
    kind,
    doseMm: kind === 'lawn' ? 6 : 8,
    soil: 'loam' as Soil,
    slope: 'flat' as Slope,
    climate: 'open' as Climate,
    points: [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ],
  }
}

function dripStations(
  drips: { id: string; points: Point[] }[],
  marks: { id: string; kind: string; stationId: string }[],
  ring: Point[],
): Set<string> {
  const ids = new Set<string>()
  for (const mark of marks) {
    if (mark.kind !== 'drip') continue
    const drip = drips.find((item) => item.id === mark.id)
    if (!drip || drip.points.length === 0) continue
    const at = {
      x: drip.points.reduce((sum, point) => sum + point.x, 0) / drip.points.length,
      y: drip.points.reduce((sum, point) => sum + point.y, 0) / drip.points.length,
    }
    if (!pointInPolygon(at, ring)) continue
    ids.add(mark.stationId)
  }
  return ids
}

function stationsTouching(
  sprinklers: { id: string; x: number; y: number }[],
  marks: { id: string; kind: string; stationId: string }[],
  ring: Point[],
): Set<string> {
  const ids = new Set<string>()
  for (const mark of marks) {
    if (mark.kind !== 'sprinkler') continue
    const head = sprinklers.find((item) => item.id === mark.id)
    if (!head || !pointInPolygon(head, ring)) continue
    ids.add(mark.stationId)
  }
  return ids
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

test('a chosen fan stays at 4.5 m even on a large lawn', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 100, 80, 200, 140)]
  doc.source = { x: 60, y: 150, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc, 'fan')
  assert.ok(next)
  assert.ok(next.sprinklers.length >= 4)
  assert.ok(next.sprinklers.every((head) => head.radiusM === 4.5))
  assert.ok(coveredShare(next.zones[0].points, next.sprinklers, 10) >= 0.85)
})

test('fans on a wide lawn cover the middle', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 0, 0, 300, 180)]
  doc.source = { x: -40, y: 90, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc, 'fan')
  assert.ok(next)
  assert.ok(next.sprinklers.length >= 12)
  assert.ok(next.sprinklers.every((head) => head.radiusM === 4.5))
  const share = coveredShare(next.zones[0].points, next.sprinklers, 10)
  assert.ok(share >= 0.95, `covered ${share}`)
  const middle = next.sprinklers.some((head) => head.x > 90 && head.x < 210 && head.y > 45 && head.y < 135)
  assert.ok(middle, 'no fan in the middle of a 30×18 m lawn')
})

test('several stations branch off the main instead of sitting behind each other', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 0, 0, 300, 180)]
  doc.source = { x: -40, y: 90, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc, 'fan')
  assert.ok(next)
  assert.ok(next.valves.length >= 2, `${next.valves.length} valves`)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('за другим клапаном')), false)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
  assert.equal(row.warnings.some((item) => item.includes('одной точке')), false)
  assert.ok(row.stations.length >= 2)
  assert.ok(row.stations.every((station) => station.flowLph > 0 && station.flowLph <= 1500))
  const headFlow = next.sprinklers.reduce((sum, head) => sum + head.flowLph, 0)
  const stationFlow = row.stations.reduce((sum, station) => sum + station.flowLph, 0)
  assert.ok(Math.abs(stationFlow - headFlow) < 1, `stations ${stationFlow} heads ${headFlow}`)
  const largest = Math.max(...row.stations.map((station) => station.flowLph))
  assert.ok(Math.abs(row.connectedFlowLph - largest) < 1, `main ${row.connectedFlowLph} largest ${largest}`)
})

test('a bucket of 900 L/h keeps every station inside the source', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 0, 0, 160, 100)]
  doc.source = { x: -30, y: 50, pressureBar: 3, flowLimitLph: 900 }
  const next = layoutIrrigation(doc, 'fan')
  assert.ok(next)
  const headFlow = next.sprinklers.reduce((sum, head) => sum + head.flowLph, 0)
  assert.ok(headFlow > 900, `heads ${headFlow} should need more than one bucket`)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('выше лимита источника')), false)
  assert.equal(row.warnings.some((item) => item.includes('за другим клапаном')), false)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
  assert.equal(row.warnings.some((item) => item.includes('одной точке')), false)
  assert.ok(row.stations.length >= 2)
  assert.ok(row.stations.every((station) => station.flowLph > 0 && station.flowLph <= 900))
  const stationFlow = row.stations.reduce((sum, station) => sum + station.flowLph, 0)
  assert.ok(Math.abs(stationFlow - headFlow) < 1, `stations ${stationFlow} heads ${headFlow}`)
  const largest = Math.max(...row.stations.map((station) => station.flowLph))
  assert.ok(Math.abs(row.connectedFlowLph - largest) < 1, `main ${row.connectedFlowLph} largest ${largest}`)
})

test('a wide lawn with a 900 L/h bucket picks a throw each head can run', () => {
  const open = emptyDoc()
  open.pxPerMeter = 10
  open.zones = [zone('lawn', 'lawn', 0, 0, 300, 180)]
  open.source = { x: -40, y: 90, pressureBar: 3, flowLimitLph: null }
  const free = layoutIrrigation(open)
  assert.ok(free)
  const freeMax = Math.max(...free.sprinklers.map((head) => head.flowLph))
  assert.ok(freeMax > 900, `open scheme max ${freeMax}`)

  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 0, 0, 300, 180)]
  doc.source = { x: -40, y: 90, pressureBar: 3, flowLimitLph: 900 }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.ok(next.sprinklers.length >= 4)
  assert.ok(next.sprinklers.every((head) => head.flowLph <= 900), `max ${Math.max(...next.sprinklers.map((head) => head.flowLph))}`)
  const share = coveredShare(next.zones[0].points, next.sprinklers, 10)
  assert.ok(share >= 0.85, `covered ${share}`)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('выше лимита источника')), false)
  assert.equal(row.warnings.some((item) => item.includes('за другим клапаном')), false)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
  assert.ok(row.stations.every((station) => station.flowLph > 0 && station.flowLph <= 900))
  const headFlow = next.sprinklers.reduce((sum, head) => sum + head.flowLph, 0)
  const stationFlow = row.stations.reduce((sum, station) => sum + station.flowLph, 0)
  assert.ok(Math.abs(stationFlow - headFlow) < 1, `stations ${stationFlow} heads ${headFlow}`)
})

test('a fan lawn and a rotor lawn do not share a valve', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [
    zone('small', 'lawn', 0, 0, 90, 60),
    zone('wide', 'lawn', 160, 0, 300, 180),
  ]
  doc.source = { x: 100, y: 240, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('за другим клапаном')), false)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
  assert.equal(row.warnings.some((item) => item.includes('одной точке')), false)
  const byStation = new Map<string, Set<string>>()
  for (const mark of row.marks) {
    if (mark.kind !== 'sprinkler') continue
    const head = next.sprinklers.find((item) => item.id === mark.id)
    if (!head) continue
    const kinds = byStation.get(mark.stationId) ?? new Set<string>()
    kinds.add(nozzleById(head.nozzleId).kind)
    byStation.set(mark.stationId, kinds)
  }
  const seen = new Set<string>()
  for (const [id, kinds] of byStation) {
    assert.equal(kinds.size, 1, `${id} mixes ${[...kinds].join('+')}`)
    for (const kind of kinds) seen.add(kind)
  }
  assert.ok(seen.has('fan'), `families ${[...seen].join(',')}`)
  assert.ok(seen.has('rotor'), `families ${[...seen].join(',')}`)
})

test('a heavy dose does not run on the same valve as a light dose', () => {
  const heavy = zone('heavy', 'lawn', 0, 0, 120, 80)
  const light = zone('light', 'lawn', 200, 0, 120, 80)
  heavy.doseMm = 18
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [heavy, light]
  doc.source = { x: 160, y: 160, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc, 'fan')
  assert.ok(next)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('за другим клапаном')), false)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
  const heavyRow = row.zones.find((item) => item.id === 'heavy')
  const lightRow = row.zones.find((item) => item.id === 'light')
  assert.ok(heavyRow?.runtimeMin && lightRow?.runtimeMin)
  assert.ok(heavyRow.runtimeMin > lightRow.runtimeMin * 1.25, `heavy ${heavyRow.runtimeMin} light ${lightRow.runtimeMin}`)
  const onHeavy = stationsTouching(next.sprinklers, row.marks, heavy.points)
  const onLight = stationsTouching(next.sprinklers, row.marks, light.points)
  assert.ok(onHeavy.size >= 1 && onLight.size >= 1)
  for (const id of onHeavy) assert.equal(onLight.has(id), false, `valve ${id} waters both doses`)
})

test('wind and shade do not share a valve', () => {
  const windy = zone('windy', 'lawn', 0, 0, 120, 80)
  const shady = zone('shady', 'lawn', 200, 0, 120, 80)
  windy.climate = 'wind'
  shady.climate = 'shade'
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [windy, shady]
  doc.source = { x: 160, y: 160, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc, 'fan')
  assert.ok(next)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('за другим клапаном')), false)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
  const windRow = row.zones.find((item) => item.id === 'windy')
  const shadeRow = row.zones.find((item) => item.id === 'shady')
  assert.ok(windRow?.runtimeMin && shadeRow?.runtimeMin)
  assert.ok(windRow.runtimeMin > shadeRow.runtimeMin * 1.25, `wind ${windRow.runtimeMin} shade ${shadeRow.runtimeMin}`)
  const onWind = stationsTouching(next.sprinklers, row.marks, windy.points)
  const onShade = stationsTouching(next.sprinklers, row.marks, shady.points)
  assert.ok(onWind.size >= 1 && onShade.size >= 1)
  for (const id of onWind) assert.equal(onShade.has(id), false, `valve ${id} waters wind and shade`)
})

test('a heavy bed does not share a drip valve with a light bed', () => {
  const heavy = zone('heavy', 'bed', 0, 0, 80, 60)
  const light = zone('light', 'bed', 160, 0, 80, 60)
  heavy.doseMm = 24
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [heavy, light]
  doc.source = { x: 120, y: 140, pressureBar: 3, flowLimitLph: null }
  doc.plants = [
    { id: 'heavy-bush', kind: 'bush', x: 40, y: 30, radiusM: 0.6 },
    { id: 'light-bush', kind: 'bush', x: 200, y: 30, radiusM: 0.6 },
  ]
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.equal(next.sprinklers.length, 0)
  assert.equal(next.drips.length, 2)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('за другим клапаном')), false)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
  const heavyRow = row.zones.find((item) => item.id === 'heavy')
  const lightRow = row.zones.find((item) => item.id === 'light')
  assert.ok(heavyRow?.runtimeMin && lightRow?.runtimeMin)
  assert.ok(heavyRow.runtimeMin > lightRow.runtimeMin * 1.25, `heavy ${heavyRow.runtimeMin} light ${lightRow.runtimeMin}`)
  const onHeavy = dripStations(next.drips, row.marks, heavy.points)
  const onLight = dripStations(next.drips, row.marks, light.points)
  assert.ok(onHeavy.size >= 1 && onLight.size >= 1)
  for (const id of onHeavy) assert.equal(onLight.has(id), false, `valve ${id} waters both beds`)
})

test('two beds with the same dose still share a drip valve', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [
    zone('left', 'bed', 0, 0, 80, 60),
    zone('right', 'bed', 160, 0, 80, 60),
  ]
  doc.source = { x: 120, y: 140, pressureBar: 3, flowLimitLph: null }
  doc.plants = [
    { id: 'left-bush', kind: 'bush', x: 40, y: 30, radiusM: 0.6 },
    { id: 'right-bush', kind: 'bush', x: 200, y: 30, radiusM: 0.6 },
  ]
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.equal(next.drips.length, 2)
  const row = analyze(next)
  const onLeft = dripStations(next.drips, row.marks, doc.zones[0].points)
  const onRight = dripStations(next.drips, row.marks, doc.zones[1].points)
  const shared = [...onLeft].filter((id) => onRight.has(id))
  assert.ok(shared.length >= 1, 'same dose stayed on separate drip valves')
})

test('a 2.4 bar source on a wide lawn stays with fans', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 0, 0, 300, 180)]
  doc.source = { x: -40, y: 90, pressureBar: 2.4, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.ok(next.sprinklers.length >= 4)
  assert.ok(next.sprinklers.every((head) => head.radiusM <= 5.5), `radius ${Math.max(...next.sprinklers.map((head) => head.radiusM))}`)
  const share = coveredShare(next.zones[0].points, next.sprinklers, 10)
  assert.ok(share >= 0.85, `covered ${share}`)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('меньше 2 бар')), false)
})

test('clay and sand do not share a valve', () => {
  const clay = zone('clay', 'lawn', 0, 0, 120, 80)
  const sand = zone('sand', 'lawn', 200, 0, 120, 80)
  clay.soil = 'clay'
  sand.soil = 'sand'
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [clay, sand]
  doc.source = { x: 160, y: 160, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc, 'fan')
  assert.ok(next)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('за другим клапаном')), false)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
  const clayRow = row.zones.find((item) => item.id === 'clay')
  const sandRow = row.zones.find((item) => item.id === 'sand')
  assert.ok(clayRow?.cycles && sandRow?.cycles)
  assert.ok(clayRow.cycles > sandRow.cycles, `clay ${clayRow.cycles} sand ${sandRow.cycles}`)
  const onClay = stationsTouching(next.sprinklers, row.marks, clay.points)
  const onSand = stationsTouching(next.sprinklers, row.marks, sand.points)
  assert.ok(onClay.size >= 1 && onSand.size >= 1)
  for (const id of onClay) assert.equal(onSand.has(id), false, `valve ${id} waters clay and sand`)
})

test('a steep loam does not wait through a clay soak', () => {
  const clay = zone('clay', 'lawn', 0, 0, 120, 80)
  const loam = zone('loam', 'lawn', 200, 0, 120, 80)
  clay.soil = 'clay'
  clay.doseMm = 8
  loam.soil = 'loam'
  loam.slope = 'steep'
  loam.doseMm = 8
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [clay, loam]
  doc.source = { x: 160, y: 160, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc, 'fan')
  assert.ok(next)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('за другим клапаном')), false)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
  const clayRow = row.zones.find((item) => item.id === 'clay')
  const loamRow = row.zones.find((item) => item.id === 'loam')
  assert.equal(clayRow?.cycles, 2)
  assert.equal(loamRow?.cycles, 2)
  assert.equal(clayRow?.soakMin, 45)
  assert.equal(loamRow?.soakMin, 30)
  const onClay = stationsTouching(next.sprinklers, row.marks, clay.points)
  const onLoam = stationsTouching(next.sprinklers, row.marks, loam.points)
  assert.ok(onClay.size >= 1 && onLoam.size >= 1)
  for (const id of onClay) assert.equal(onLoam.has(id), false, `valve ${id} waters clay and loam`)
  for (const id of onClay) assert.equal(row.stations.find((item) => item.id === id)?.soakMin, 45)
  for (const id of onLoam) assert.equal(row.stations.find((item) => item.id === id)?.soakMin, 30)
})

test('a tree on the lawn keeps a 90 minute drip station', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 0, 0, 160, 100)]
  doc.source = { x: -20, y: 50, pressureBar: 3, flowLimitLph: null }
  doc.plants = [{ id: 'oak', kind: 'tree', x: 80, y: 50, radiusM: 1.2 }]
  const next = layoutIrrigation(doc, 'fan')
  assert.ok(next)
  assert.equal(next.drips.length, 1)
  const row = analyze(next)
  const lawn = row.zones.find((item) => item.id === 'lawn')
  assert.ok(lawn?.runtimeMin && lawn.runtimeMin < 60, `lawn ${lawn?.runtimeMin}`)
  const mark = row.marks.find((item) => item.kind === 'drip')
  assert.ok(mark)
  const station = row.stations.find((item) => item.id === mark.stationId)
  assert.equal(station?.runtimeMin, 90)
  assert.equal(station?.cycles, 1)
  const headMark = row.marks.find((item) => item.kind === 'sprinkler')
  assert.ok(headMark)
  assert.notEqual(headMark.stationId, mark.stationId)
})

test('a one metre gap beside a house still carries the pipe', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [
    zone('left', 'lawn', 0, 0, 80, 80),
    zone('right', 'lawn', 140, 0, 80, 80),
    zone('house', 'building', 80, 0, 60, 70),
  ]
  doc.source = { x: 40, y: -20, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc, 'fan')
  assert.ok(next)
  const house = next.zones.find((item) => item.kind === 'building')
  const right = next.zones.find((item) => item.id === 'right')
  assert.ok(house && right)
  assert.ok(next.sprinklers.some((head) => pointInPolygon(head, right.points)))
  assert.ok(metresInside(next.pipes, house.points, 10) < 0.5)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
})

test('a long day warns that watering misses noon', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 0, 0, 200, 200)]
  doc.zones[0].doseMm = 40
  doc.source = { x: 0, y: 100, pressureBar: 3, flowLimitLph: null }
  doc.sprinklers = [{ id: 's', nozzleId: 'fan180', x: 100, y: 100, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 }]
  doc.pipes = [{ id: 'run', points: [{ x: 0, y: 100 }, { x: 100, y: 100 }] }]
  const row = analyze(doc)
  assert.ok(row.warnings.some((item) => item.includes('не заканчивается к 12:00')))
})

test('two lawns with the same dose still share a station when the flow fits', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [
    zone('left', 'lawn', 0, 0, 90, 60),
    zone('right', 'lawn', 160, 0, 90, 60),
  ]
  doc.source = { x: 120, y: 140, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc, 'fan')
  assert.ok(next)
  assert.ok(next.sprinklers.length >= 4)
  assert.ok(next.valves.length < next.sprinklers.length, `${next.valves.length} valves for ${next.sprinklers.length} heads`)
  const row = analyze(next)
  const onLeft = stationsTouching(next.sprinklers, row.marks, doc.zones[0].points)
  const onRight = stationsTouching(next.sprinklers, row.marks, doc.zones[1].points)
  const shared = [...onLeft].filter((id) => onRight.has(id))
  assert.ok(shared.length >= 1, 'same dose stayed on separate valves')
})

test('heads on one station stay inside one part of a large lawn', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 0, 0, 500, 360)]
  doc.source = { x: -30, y: 180, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  const row = analyze(next)
  const byStation = new Map<string, { x: number; y: number }[]>()
  for (const head of next.sprinklers) {
    const mark = row.marks.find((item) => item.kind === 'sprinkler' && item.id === head.id)
    if (!mark) continue
    const list = byStation.get(mark.stationId) ?? []
    list.push(head)
    byStation.set(mark.stationId, list)
  }
  assert.ok(byStation.size >= 2)
  for (const [id, heads] of byStation) {
    let far = 0
    for (const a of heads) {
      for (const b of heads) far = Math.max(far, Math.hypot(a.x - b.x, a.y - b.y) / 10)
    }
    assert.ok(far <= 24, `station ${id} spans ${far.toFixed(1)} m`)
  }
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

test('a lawn with a bed does not pack overlapping heads', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [
    zone('lawn', 'lawn', 100, 80, 200, 140),
    zone('bed', 'bed', 160, 130, 50, 40),
  ]
  doc.source = { x: 60, y: 150, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  if (!next) return
  const heads = next.sprinklers
  assert.ok(heads.length >= 4)
  assert.ok(heads.length <= 10, `${heads.length} heads around a 5×4 m bed`)
  for (let i = 0; i < heads.length; i++) {
    for (let j = i + 1; j < heads.length; j++) {
      const a = heads[i]
      const b = heads[j]
      const gap = Math.hypot(a.x - b.x, a.y - b.y) / 10
      assert.ok(gap >= 0.5 * Math.min(a.radiusM, b.radiusM) - 0.05, `heads ${gap.toFixed(2)} m apart`)
    }
  }
  assert.ok(coveredShare(next.zones[0].points, heads, 10) >= 0.78)
})

test('a long narrow lawn keeps every head on the pipe', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 0, 0, 220, 40)]
  doc.source = { x: -20, y: 20, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.ok(next.sprinklers.length >= 6, `${next.sprinklers.length} heads on a 22×4 m strip`)
  assert.ok(next.sprinklers.every((head) => head.x >= -2 && head.x <= 222 && head.y >= -2 && head.y <= 42))
  const share = coveredShare(next.zones[0].points, next.sprinklers, 10)
  assert.ok(share >= 0.9, `covered ${share}`)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
})

test('a small lawn uses fan nozzles', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('lawn', 'lawn', 100, 80, 90, 60)]
  doc.source = { x: 60, y: 110, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.ok(next.sprinklers.length >= 2)
  assert.ok(next.sprinklers.every((head) => head.radiusM <= 6))
  assert.ok(next.sprinklers.every((head) => head.nozzleId.startsWith('fan')))
  assert.ok(coveredShare(next.zones[0].points, next.sprinklers, 10) >= 0.9)
})

test('auto layout fits the throw to the width of the lawn', () => {
  const wide = emptyDoc()
  wide.pxPerMeter = 10
  wide.zones = [zone('lawn', 'lawn', 0, 0, 300, 180)]
  wide.source = { x: -40, y: 90, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(wide)
  assert.ok(next)
  assert.ok(next.sprinklers.length >= 4)
  assert.ok(next.sprinklers.length <= 12)
  assert.ok(next.sprinklers.every((head) => head.radiusM >= 8))
  const share = coveredShare(next.zones[0].points, next.sprinklers, 10)
  assert.ok(share >= 0.95, `covered ${share}`)
})

test('an ornamental grass bush skips the drip ring', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('bed', 'bed', 100, 80, 80, 40)]
  doc.source = { x: 60, y: 100, pressureBar: 3, flowLimitLph: null }
  doc.plants = [
    { id: 'grass', kind: 'bush', x: 120, y: 100, radiusM: 0.5, form: 'grass' },
    { id: 'bush', kind: 'bush', x: 155, y: 100, radiusM: 0.5, form: 'ball' },
  ]
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.equal(next.drips.length, 1)
  const near = (plant: { x: number; y: number }) => next.drips[0].points.some((point) => Math.hypot(point.x - plant.x, point.y - plant.y) < 12)
  assert.equal(near(doc.plants[0]), false)
  assert.equal(near(doc.plants[1]), true)
})

test('trees on a large bed keep a short drip and the network stays on the source', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [
    zone('lawn', 'lawn', 0, 0, 500, 360),
    zone('bed', 'bed', 20, 16, 460, 70),
    zone('house', 'building', 24, 120, 140, 160),
  ]
  doc.source = { x: -30, y: 180, pressureBar: 3, flowLimitLph: null }
  doc.plants = [80, 180, 280, 380].map((x, index) => ({ id: `tree-${index}`, kind: 'tree' as const, x, y: 50, radiusM: 4 }))
  const next = layoutIrrigation(doc)
  assert.ok(next)
  const row = analyze(next)
  const bed = row.zones.find((item) => item.id === 'bed')
  assert.ok(bed?.runtimeMin && bed.runtimeMin <= 120, `bed ${bed?.runtimeMin}`)
  assert.ok((bed.precipMmH ?? 0) >= 1, `precip ${bed.precipMmH}`)
  for (const station of row.stations) {
    if (station.flowLph > 0 && station.flowLph < 400) {
      assert.ok(station.runtimeMin !== null && station.runtimeMin <= 120, `drip ${station.runtimeMin}`)
    }
  }
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
  assert.equal(row.warnings.some((item) => item.includes('за другим клапаном')), false)
})

test('a bed without a lawn gets drip only at its plants', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [zone('bed', 'bed', 100, 80, 50, 40)]
  doc.source = { x: 60, y: 100, pressureBar: 3, flowLimitLph: null }
  doc.plants = [{ id: 'bush', kind: 'bush', x: 125, y: 100, radiusM: 0.6 }]
  const next = layoutIrrigation(doc)
  assert.ok(next)
  assert.equal(next.sprinklers.length, 0)
  assert.equal(next.drips.length, 1)
  const lengthM = next.drips.reduce((sum, drip) => {
    let px = 0
    for (let i = 1; i < drip.points.length; i++) {
      px += Math.hypot(drip.points[i].x - drip.points[i - 1].x, drip.points[i].y - drip.points[i - 1].y)
    }
    return sum + px / 10
  }, 0)
  assert.ok(lengthM < 4, `drip ${lengthM}m should be a plant ring`)
  const row = analyze(next)
  assert.ok(row.drips.flowLph > 0)
  assert.ok(row.drips.flowLph < 20)
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
  const bedRow = row.zones.find((zone) => zone.kind === 'bed')
  assert.ok(bedRow?.runtimeMin && bedRow.runtimeMin < 400, `bed runtime ${bedRow?.runtimeMin}`)
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
  doc.plants = [
    { id: 'bush', kind: 'bush', x: 120, y: 100, radiusM: 0.6 },
    { id: 'lawn-tree', kind: 'tree', x: 170, y: 150, radiusM: 1.4 },
    { id: 'house-tree', kind: 'tree', x: 225, y: 125, radiusM: 1.2 },
  ]
  const next = layoutIrrigation(doc)
  assert.ok(next)
  const shrub = next.zones.find((item) => item.kind === 'shrub')
  const house = next.zones.find((item) => item.kind === 'building')
  assert.ok(shrub && house)
  assert.equal(next.drips.length, 2)
  assert.equal(next.sprinklers.some((head) => pointInPolygon(head, shrub.points)), false)
  assert.equal(next.sprinklers.some((head) => pointInPolygon(head, house.points)), false)
  const dripInShrub = next.drips.some((drip) => drip.points.some((point) => pointInPolygon(point, shrub.points)))
  assert.ok(dripInShrub)
  assert.equal(next.drips.some((drip) => drip.points.some((point) => pointInPolygon(point, house.points))), false)
})

test('a pipe skirts concrete when soil goes around the patio', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [
    zone('side', 'lawn', 0, 0, 60, 180),
    zone('back', 'lawn', 60, 0, 180, 80),
    zone('patio', 'concrete', 60, 80, 180, 70),
  ]
  doc.source = { x: 30, y: 160, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  const patio = next.zones.find((item) => item.kind === 'concrete')
  assert.ok(patio)
  const inside = metresInside(next.pipes, patio.points, 10)
  assert.ok(inside < 1.5, `pipe under concrete ${inside.toFixed(2)} m`)
  assert.equal(next.sleeves?.length ?? 0, 0)
  assert.equal(next.sprinklers.some((head) => pointInPolygon(head, patio.points)), false)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
})

test('a full concrete band is crossed once, in a sleeve', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [
    zone('lawn', 'lawn', 0, 0, 180, 80),
    zone('drive', 'concrete', 0, 80, 180, 60),
  ]
  doc.source = { x: 90, y: 180, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  const drive = next.zones.find((item) => item.kind === 'concrete')
  assert.ok(drive)
  const inside = metresInside(next.pipes, drive.points, 10)
  assert.ok(inside > 3 && inside < 12, `crossing ${inside.toFixed(2)} m`)
  const sleeves = next.sleeves ?? []
  assert.equal(sleeves.length, 1)
  const length = Math.hypot(sleeves[0].b.x - sleeves[0].a.x, sleeves[0].b.y - sleeves[0].a.y) / 10
  assert.ok(length > 3 && length < 10, `sleeve ${length.toFixed(2)} m`)
  assert.equal(next.valves.some((valve) => pointInPolygon(valve, drive.points)), false)
  assert.equal(next.sprinklers.some((head) => pointInPolygon(head, drive.points)), false)
  assert.ok(coveredShare(next.zones[0].points, next.sprinklers, 10) >= 0.85)
  const row = analyze(next)
  assert.equal(row.warnings.some((item) => item.includes('не стоит на трубе')), false)
  assert.equal(row.warnings.some((item) => item.includes('не соединена')), false)
})

test('a drawn sleeve is the concrete crossing', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [
    zone('lawn', 'lawn', 0, 0, 280, 70),
    zone('drive', 'concrete', 0, 70, 280, 60),
  ]
  doc.source = { x: 20, y: 170, pressureBar: 3, flowLimitLph: null }
  doc.sleeves = [{ id: 'bore', a: { x: 250, y: 70 }, b: { x: 250, y: 130 } }]
  const next = layoutIrrigation(doc)
  assert.ok(next)
  const drive = next.zones.find((item) => item.kind === 'concrete')
  assert.ok(drive)
  assert.equal(next.sleeves?.some((sleeve) => sleeve.id === 'bore'), true)
  assert.equal(next.sleeves?.length, 1)
  const samples = samplesInside(next.pipes, drive.points)
  assert.ok(samples.length > 0)
  assert.ok(samples.every((point) => Math.abs(point.x - 250) < 48), `crossing x ${samples.map((point) => point.x.toFixed(0)).join(',')}`)
})

test('a path across the plot is crossed in a sleeve, not trenched along', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [
    zone('lawn', 'lawn', 0, 0, 200, 160),
    zone('walk', 'path', -40, 70, 260, 30),
  ]
  doc.source = { x: 100, y: 190, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  const walk = next.zones.find((item) => item.kind === 'path')
  assert.ok(walk)
  const inside = metresInside(next.pipes, walk.points, 10)
  assert.ok(inside > 1 && inside < 10, `path crossing ${inside.toFixed(2)} m`)
  const sleeves = next.sleeves ?? []
  assert.ok(sleeves.length >= 1)
  assert.ok(sleeves.every((sleeve) => Math.hypot(sleeve.b.x - sleeve.a.x, sleeve.b.y - sleeve.a.y) / 10 < 8))
})

test('a building and a pond stay clear of the pipe', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 10
  doc.zones = [
    zone('lawn', 'lawn', 0, 0, 240, 80),
    zone('house', 'building', 90, 80, 70, 70),
    zone('pond', 'water', 180, 100, 40, 40),
  ]
  doc.source = { x: 30, y: 150, pressureBar: 3, flowLimitLph: null }
  const next = layoutIrrigation(doc)
  assert.ok(next)
  const house = next.zones.find((item) => item.kind === 'building')
  const pond = next.zones.find((item) => item.kind === 'water')
  assert.ok(house && pond)
  assert.ok(metresInside(next.pipes, house.points, 10) < 0.5)
  assert.ok(metresInside(next.pipes, pond.points, 10) < 0.5)
  assert.equal(next.sleeves?.length ?? 0, 0)
  assert.ok(next.sprinklers.length >= 2)
})

function metresInside(pipes: { points: Point[] }[], ring: Point[], ppm: number): number {
  let px = 0
  for (const pipe of pipes) {
    for (let i = 1; i < pipe.points.length; i++) {
      const a = pipe.points[i - 1]
      const b = pipe.points[i]
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (ppm * 0.25)))
      for (let s = 1; s <= steps; s++) {
        const p0 = {
          x: a.x + ((b.x - a.x) * (s - 1)) / steps,
          y: a.y + ((b.y - a.y) * (s - 1)) / steps,
        }
        const p1 = {
          x: a.x + ((b.x - a.x) * s) / steps,
          y: a.y + ((b.y - a.y) * s) / steps,
        }
        const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }
        if (pointInPolygon(mid, ring)) px += Math.hypot(p1.x - p0.x, p1.y - p0.y)
      }
    }
  }
  return px / ppm
}

function samplesInside(pipes: { points: Point[] }[], ring: Point[]): Point[] {
  const samples: Point[] = []
  for (const pipe of pipes) {
    for (let i = 1; i < pipe.points.length; i++) {
      const a = pipe.points[i - 1]
      const b = pipe.points[i]
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 4))
      for (let s = 0; s <= steps; s++) {
        const point = {
          x: a.x + ((b.x - a.x) * s) / steps,
          y: a.y + ((b.y - a.y) * s) / steps,
        }
        if (pointInPolygon(point, ring)) samples.push(point)
      }
    }
  }
  return samples
}
