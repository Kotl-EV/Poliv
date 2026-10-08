import assert from 'node:assert/strict'
import test from 'node:test'
import { analyze } from './analyze.ts'
import { layoutPlan, pxPerMeterFromPage, scaleBarPxPerMeter, segmentRole, sheetScaleRatio, type InkSeg } from './plan.ts'
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
  assert.ok(analysis.connectedFlowLph > 0 && analysis.connectedFlowLph <= 1600)
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
