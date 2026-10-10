import assert from 'node:assert/strict'
import test from 'node:test'
import { analyze, stationInk, stationNo } from './analyze.ts'
import { dripRingPoints } from './drip.ts'
import { emptyDoc, parseDoc } from './doc.ts'
import { exampleDoc } from './example.ts'
import { headLossM, velocityMs } from './pipes.ts'

test('example network on SDR 11 picks PE 25 at the source and PE 20 after the first split', () => {
  const analysis = analyze(exampleDoc())
  assert.equal(analysis.warnings.length, 0)
  assert.equal(analysis.connectedFlowLph, 1440)
  assert.equal(analysis.zones[0].areaM2, 116.16)
  assert.ok(Math.abs((analysis.zones[0].precipMmH ?? 0) - 1440 / 116.16) < 1e-9)

  const main = analysis.segments.find((item) => item.a.x === 40 && item.b.x === 200)
  assert.ok(main)
  assert.equal(main.flowLph, 1440)
  assert.equal(main.role, 'main')
  assert.equal(main.downB, true)
  assert.equal(main.odMm, 25)
  assert.equal(main.idMm, 20.4)
  assert.ok((main.velocity ?? 0) <= 1.5)
  assert.ok((main.headLossM ?? 0) > 0.2 && (main.headLossM ?? 0) < 0.5)
  assert.ok((main.residualHeadM ?? 0) < (analysis.sourceHeadM ?? 0))

  const lateral = analysis.segments.find((item) => item.a.x === 200 && item.b.y === 150)
  assert.ok(lateral)
  assert.equal(lateral.flowLph, 360)
  assert.equal(lateral.role, 'zone')
  assert.equal(lateral.odMm, 20)

  const pe25 = analysis.pipes.find((item) => item.odMm === 25)
  const pe20 = analysis.pipes.find((item) => item.odMm === 20)
  assert.equal(pe25?.lengthM, 3.2)
  assert.equal(pe20?.lengthM, 22)
  assert.ok((analysis.minResidualHeadM ?? 0) > 20)
  assert.equal(analysis.fittings.find((item) => item.name === 'Крестовина ПЭ 25×20×20×20')?.count, 1)
  assert.equal(analysis.fittings.find((item) => item.name === 'Тройник ПЭ 20')?.count, 1)
  assert.equal(analysis.fittings.find((item) => item.name === 'Угол ПЭ 20')?.count, 1)
  assert.equal(analysis.fittingMarks.length, 3)
  assert.equal(analysis.fittingMarks.filter((item) => item.kind === 'cross').length, 1)
  assert.equal(analysis.fittingMarks.filter((item) => item.kind === 'tee').length, 1)
  assert.equal(analysis.fittingMarks.filter((item) => item.kind === 'elbow').length, 1)
  const runtime = 6 / (1440 / 116.16) * 60
  assert.equal(analysis.zones[0].doseMm, 6)
  assert.equal(analysis.zones[0].climate, 'open')
  assert.equal(analysis.zones[0].appliedMm, 6)
  assert.ok(Math.abs((analysis.zones[0].runtimeMin ?? 0) - runtime) < 1e-9)
  assert.ok(Math.abs((analysis.programMin ?? 0) - runtime) < 1e-9)
  assert.equal(analysis.stations.length, 0)
  assert.equal(analysis.zones[0].cycles, 1)
  assert.equal(analysis.zones[0].intakeMmH, 12)
  assert.ok(Math.abs((analysis.clockMin ?? 0) - runtime) < 1e-9)
  assert.ok(Math.abs((analysis.trench.lengthM ?? 0) - 25.2) < 1e-9)
  assert.equal(analysis.trench.widthM, 0.3)
  assert.equal(analysis.trench.depthM, 0.4)
  assert.ok(Math.abs((analysis.trench.volumeM3 ?? 0) - 25.2 * 0.3 * 0.4) < 1e-9)
})

test('SDR 9 keeps a 16 mm lateral for 360 l/h', () => {
  const doc = exampleDoc()
  doc.pipeSeries = 'sdr9'
  const analysis = analyze(doc)
  const lateral = analysis.segments.find((item) => item.a.x === 200 && item.b.y === 150)
  assert.equal(lateral?.odMm, 16)
  assert.equal(lateral?.idMm, 12)
})

test('PE 20 SDR 11 is too fast for 1440 l/h and PE 25 is not', () => {
  assert.ok(velocityMs(1440, 16) > 1.5)
  assert.ok(velocityMs(1440, 20.4) <= 1.5)
})

test('head loss grows with length and with flow', () => {
  const short = headLossM(1440, 20.4, 3.2)
  const longer = headLossM(1440, 20.4, 6.4)
  const slower = headLossM(360, 20.4, 3.2)
  assert.ok(Math.abs(longer - short * 2) < 1e-9)
  assert.ok(slower < short)
})

test('a sprinkler off the pipe is left out of the network flow', () => {
  const doc = exampleDoc()
  doc.sprinklers.push({
    id: 'loose',
    nozzleId: 'fan360',
    x: 20,
    y: 20,
    radiusM: 4.5,
    arcDeg: 360,
    rotationDeg: 0,
    flowLph: 720,
  })
  const analysis = analyze(doc)
  assert.equal(analysis.connectedFlowLph, 1440)
  assert.equal(analysis.totalFlowLph, 2160)
  assert.ok(analysis.warnings.some((item) => item.includes('не стоит на трубе')))
})

test('flow above the source limit is reported', () => {
  const doc = exampleDoc()
  doc.source = { x: 40, y: 300, pressureBar: 3, flowLimitLph: 1000 }
  const analysis = analyze(doc)
  assert.ok(analysis.warnings.some((item) => item.includes('лимита источника')))
})

test('valves run one at a time, so the main follows the larger station', () => {
  const doc = exampleDoc()
  doc.pxPerMeter = 50
  doc.zones = []
  doc.sprinklers = [
    { id: 'a', nozzleId: 'fan360', x: 100, y: 100, radiusM: 4.5, arcDeg: 360, rotationDeg: 0, flowLph: 1000 },
    { id: 'b', nozzleId: 'fan180', x: 200, y: 100, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 400 },
  ]
  doc.source = { x: 0, y: 0, pressureBar: 3, flowLimitLph: null }
  doc.pipes = [
    { id: 'main', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }] },
    { id: 'a', points: [{ x: 100, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 100 }] },
    { id: 'b', points: [{ x: 200, y: 0 }, { x: 200, y: 50 }, { x: 200, y: 100 }] },
  ]
  doc.valves = [
    { id: 'va', name: 'Клапан 1', x: 100, y: 50 },
    { id: 'vb', name: 'Клапан 2', x: 200, y: 50 },
  ]
  const analysis = analyze(doc)
  assert.equal(analysis.totalFlowLph, 1400)
  assert.equal(analysis.connectedFlowLph, 1000)
  assert.deepEqual(analysis.stations.map((item) => item.flowLph).sort((a, b) => a - b), [400, 1000])
  const supply = analysis.segments.find((item) => item.a.x === 0 && item.b.x === 100)
  assert.equal(supply?.flowLph, 1000)
  assert.equal(supply?.odMm, 20)
  assert.equal(supply?.role, 'main')
  const pastValve = analysis.segments.find((item) => item.a.x === 100 && item.a.y === 50 && item.b.y === 100)
  assert.equal(pastValve?.role, 'zone')
  doc.pipes = doc.pipes.map((pipe) => (pipe.id === 'main' ? { ...pipe, role: 'zone' } : pipe))
  assert.equal(analyze(doc).segments.find((item) => item.a.x === 0 && item.b.x === 100)?.role, 'zone')
  const second = analysis.segments.find((item) => item.a.x === 100 && item.a.y === 0 && item.b.x === 200)
  assert.equal(second?.flowLph, 400)
  assert.equal(analysis.fittings.find((item) => item.name === 'Тройник ПЭ 20')?.count, 1)
  assert.equal(analysis.fittings.find((item) => item.name === 'Угол ПЭ 20')?.count, 1)
})

test('valves in one box keep their own stations when each zone pipe names a valve', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 20
  doc.source = { x: 0, y: 0, pressureBar: 3, flowLimitLph: null }
  doc.boxes = [{ id: 'box', name: 'Бокс 1', x: 100, y: 0 }]
  doc.valves = [
    { id: 'va', name: 'Клапан 1', x: 100, y: 6, boxId: 'box' },
    { id: 'vb', name: 'Клапан 2', x: 108, y: 6, boxId: 'box' },
  ]
  doc.sprinklers = [
    { id: 'a', nozzleId: 'fan180', x: 100, y: 80, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 300 },
    { id: 'b', nozzleId: 'fan180', x: 180, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 500 },
  ]
  doc.pipes = [
    { id: 'main', role: 'main', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
    { id: 'za', role: 'zone', valveId: 'va', points: [{ x: 100, y: 6 }, { x: 100, y: 80 }] },
    { id: 'zb', role: 'zone', valveId: 'vb', points: [{ x: 108, y: 6 }, { x: 180, y: 0 }] },
  ]
  const analysis = analyze(doc)
  assert.equal(analysis.connectedFlowLph, 500)
  assert.deepEqual(analysis.stations.map((item) => item.flowLph).sort((a, b) => a - b), [300, 500])
  assert.equal(analysis.warnings.some((item) => item.includes('одной точке')), false)
})

test('flow runs toward the head when the pipe was drawn backwards', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 20
  doc.zones = []
  doc.valves = []
  doc.source = { x: 0, y: 0, pressureBar: 3, flowLimitLph: null }
  doc.sprinklers = [{ id: 's', nozzleId: 'fan180', x: 200, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 }]
  doc.pipes = [{ id: 'run', points: [{ x: 200, y: 0 }, { x: 0, y: 0 }] }]
  const back = analyze(doc).segments[0]
  assert.equal(back?.flowLph, 360)
  assert.equal(back?.downB, false)
  doc.pipes = [{ id: 'run', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }]
  assert.equal(analyze(doc).segments[0]?.downB, true)
})

test('a fed head keeps the pressure left in the pipe and a loose head does not', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 20
  doc.zones = []
  doc.valves = []
  doc.source = { x: 0, y: 0, pressureBar: 3, flowLimitLph: null }
  doc.sprinklers = [
    { id: 's', nozzleId: 'fan180', x: 200, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 },
    { id: 'loose', nozzleId: 'fan180', x: 800, y: 800, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 },
    { id: 'tail', nozzleId: 'fan180', x: 216, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 },
  ]
  doc.pipes = [{ id: 'run', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }]
  const analysis = analyze(doc)
  const fed = analysis.pressureMarks.find((item) => item.id === 's')
  assert.ok(fed)
  assert.equal(fed.x, 200)
  assert.equal(fed.y, 0)
  assert.equal(fed.low, false)
  assert.ok(fed.bar < 3 && fed.bar > 2)
  assert.equal(analysis.pressureMarks.some((item) => item.id === 'loose'), false)
  const tail = analysis.pressureMarks.find((item) => item.id === 'tail')
  assert.equal(tail?.x, 216)
  assert.equal(tail?.low, false)
  doc.pxPerMeter = null
  assert.equal(analyze(doc).pressureMarks.some((item) => item.id === 's'), false)
  doc.pxPerMeter = 20
  doc.source = { x: 0, y: 0, pressureBar: 1.5, flowLimitLph: null }
  doc.sprinklers = [{ id: 's', nozzleId: 'fan180', x: 200, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 }]
  const low = analyze(doc).pressureMarks.find((item) => item.id === 's')
  assert.equal(low?.low, true)
  assert.ok((low?.bar ?? 2) < 2)
})

test('a hydrant on a dead end replaces the cap', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 20
  doc.zones = []
  doc.sprinklers = []
  doc.valves = []
  doc.source = { x: 0, y: 0, pressureBar: 3, flowLimitLph: null }
  doc.pipes = [{ id: 'run', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]
  doc.hydrants = [{ id: 'h', x: 100, y: 0 }]
  const analysis = analyze(doc)
  assert.equal(analysis.fittings.find((item) => item.name === 'Гидрант')?.count, 1)
  assert.equal(analysis.fittings.some((item) => item.name.startsWith('Заглушка')), false)
  assert.equal(analysis.fittingMarks.length, 0)
})

test('a dead end gets a cap and a straight joint of one size does not', () => {
  const doc = exampleDoc()
  doc.zones = []
  doc.sprinklers = []
  doc.valves = []
  doc.source = { x: 0, y: 0, pressureBar: 3, flowLimitLph: null }
  doc.pipes = [{ id: 'run', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }] }]
  const analysis = analyze(doc)
  assert.deepEqual(analysis.fittings, [{ name: 'Заглушка ПЭ 20', count: 1 }])
  assert.equal(analysis.fittingMarks.length, 1)
  assert.equal(analysis.fittingMarks[0].kind, 'cap')
  assert.equal(analysis.fittingMarks[0].x, 100)
  assert.equal(analysis.fittingMarks[0].y, 0)
  assert.equal(analysis.fittingMarks[0].name, 'Заглушка ПЭ 20')
})

test('a bare supply and a branch feed two emitter rings with one start', () => {
  const doc = exampleDoc()
  doc.zones = []
  doc.sprinklers = []
  doc.valves = []
  doc.source = { x: 0, y: 0, pressureBar: 3, flowLimitLph: null }
  doc.pxPerMeter = 50
  doc.pipes = [{ id: 'run', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]
  const ring = dripRingPoints({ x: 160, y: 40 }, { x: 160, y: 80 })
  const second = dripRingPoints({ x: 100, y: 40 }, { x: 60, y: 40 })
  assert.ok(ring && second)
  doc.drips = [
    { id: 'supply', points: [{ x: 100, y: 0 }, { x: 100, y: 40 }], spacingM: 0.3, emitterLph: 2, bare: true },
    { id: 'branch', points: [{ x: 100, y: 40 }, { x: 160, y: 40 }], spacingM: 0.3, emitterLph: 2, bare: true },
    { id: 'ring', points: ring!, spacingM: 0.3, emitterLph: 4 },
    { id: 'second', points: second!, spacingM: 0.3, emitterLph: 2 },
  ]
  const analysis = analyze(doc)
  assert.equal(analysis.issues.some((item) => item.kind === 'drip'), false)
  assert.equal(analysis.drips.emitters, 17 + 17)
  assert.equal(analysis.drips.flowLph, 17 * 4 + 17 * 2)
  assert.equal(analysis.connectedFlowLph, 17 * 4 + 17 * 2)
  assert.equal(analysis.fittings.find((item) => item.name === 'Старт капельной трубки')?.count, 1)
})

test('a bare tube that misses the pipe is loose and adds no flow', () => {
  const doc = exampleDoc()
  doc.zones = []
  doc.sprinklers = []
  doc.valves = []
  doc.source = { x: 0, y: 0, pressureBar: 3, flowLimitLph: null }
  doc.pipes = [{ id: 'run', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]
  doc.drips = [{ id: 'loose', points: [{ x: 400, y: 400 }, { x: 440, y: 400 }], spacingM: 0.3, emitterLph: 2, bare: true }]
  const analysis = analyze(doc)
  assert.equal(analysis.connectedFlowLph, 0)
  assert.equal(analysis.issues.some((item) => item.kind === 'drip' && item.id === 'loose'), true)
  assert.equal(analysis.fittings.some((item) => item.name === 'Старт капельной трубки'), false)
})

test('a valve paints its zone and numbers the heads', () => {
  const doc = exampleDoc()
  doc.valves = [{ id: 'v1', name: 'Клапан 1', x: 200, y: 300 }]
  const analysis = analyze(doc)
  const zone = analysis.segments.find((item) => item.role === 'zone' && item.status === 'ok')
  assert.equal(zone?.stationId, 'v1')
  assert.equal(analysis.marks.filter((item) => item.kind === 'sprinkler').length, 4)
  assert.equal(stationNo(analysis.stations, 'v1'), 1)
  assert.equal(stationInk(analysis.stations, 'v1'), '#c23b22')
  const main = analysis.segments.find((item) => item.role === 'main' && item.a.x === 40)
  assert.equal(main?.stationId === 'v1' || main?.stationId === '', true)
})

test('drip tubing adds emitters, flow and a start fitting', () => {
  const doc = exampleDoc()
  doc.zones = []
  doc.sprinklers = []
  doc.valves = []
  doc.source = { x: 0, y: 0, pressureBar: 3, flowLimitLph: null }
  doc.pipes = [{ id: 'run', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]
  doc.drips = [{ id: 'd1', points: [{ x: 100, y: 0 }, { x: 100, y: 100 }], spacingM: 0.5, emitterLph: 2 }]
  const analysis = analyze(doc)
  assert.equal(analysis.drips.lengthM, 2)
  assert.equal(analysis.drips.emitters, 4)
  assert.equal(analysis.drips.flowLph, 8)
  assert.equal(analysis.connectedFlowLph, 8)
  assert.equal(analysis.fittings.find((item) => item.name === 'Старт капельной трубки')?.count, 1)
  assert.equal(analysis.fittings.some((item) => item.name.startsWith('Заглушка')), false)
})

test('two valves on one lawn each run the full zone time', () => {
  const doc = exampleDoc()
  doc.valves = [
    { id: 'va', name: 'Клапан 1', x: 200, y: 150 },
    { id: 'vb', name: 'Клапан 2', x: 450, y: 150 },
  ]
  const analysis = analyze(doc)
  const runtime = 6 / (1440 / 116.16) * 60
  assert.equal(analysis.stations.length, 2)
  for (const station of analysis.stations) {
    assert.ok(Math.abs((station.runtimeMin ?? 0) - runtime) < 1e-6)
  }
  assert.ok(Math.abs((analysis.programMin ?? 0) - runtime * 2) < 1e-6)
})

test('wind stretches the example runtime by 1.3 and shade shortens it by 0.7', () => {
  const open = 6 / (1440 / 116.16) * 60
  const wind = exampleDoc()
  wind.zones[0].climate = 'wind'
  const windAnalysis = analyze(wind)
  assert.ok(Math.abs(windAnalysis.zones[0].appliedMm - 7.8) < 1e-9)
  assert.ok(Math.abs((windAnalysis.zones[0].runtimeMin ?? 0) - open * 1.3) < 1e-9)
  assert.equal(windAnalysis.zones[0].cycles, 1)
  assert.ok(Math.abs((windAnalysis.programMin ?? 0) - open * 1.3) < 1e-9)
  const shade = exampleDoc()
  shade.zones[0].climate = 'shade'
  const shadeAnalysis = analyze(shade)
  assert.ok(Math.abs(shadeAnalysis.zones[0].appliedMm - 4.2) < 1e-9)
  assert.ok(Math.abs((shadeAnalysis.zones[0].runtimeMin ?? 0) - open * 0.7) < 1e-9)
  assert.equal(shadeAnalysis.zones[0].cycles, 1)
})

test('clay splits the example lawn into two cycles with a soak', () => {
  const doc = exampleDoc()
  doc.zones[0].soil = 'clay'
  const analysis = analyze(doc)
  const runtime = 6 / (1440 / 116.16) * 60
  assert.equal(analysis.zones[0].cycles, 2)
  assert.equal(analysis.zones[0].soakMin, 45)
  assert.equal(analysis.zones[0].intakeMmH, 5)
  assert.ok(Math.abs((analysis.programMin ?? 0) - runtime) < 1e-9)
  assert.ok(Math.abs((analysis.clockMin ?? 0) - (runtime + 45)) < 1e-6)
  assert.ok(analysis.warnings.some((item) => item.includes('2 цикла')))
})

test('steep clay needs three cycles and steep sand stays one', () => {
  const steep = exampleDoc()
  steep.zones[0].soil = 'clay'
  steep.zones[0].slope = 'steep'
  assert.equal(analyze(steep).zones[0].cycles, 3)
  assert.equal(analyze(steep).zones[0].intakeMmH, 2.5)
  const sand = exampleDoc()
  sand.zones[0].soil = 'sand'
  sand.zones[0].slope = 'steep'
  assert.equal(analyze(sand).zones[0].cycles, 1)
  assert.equal(analyze(sand).warnings.length, 0)
})

test('a lawn without sprinklers has no runtime', () => {
  const doc = exampleDoc()
  doc.sprinklers = []
  doc.pipes = []
  doc.source = null
  const analysis = analyze(doc)
  assert.equal(analysis.zones[0].runtimeMin, null)
  assert.equal(analysis.programMin, null)
  assert.ok(analysis.warnings.some((item) => item.includes('нет осадков')))
})

test('a wider trench doubles the excavation and a missing scale leaves the volume blank', () => {
  const doc = exampleDoc()
  doc.trench = { widthM: 0.6, depthM: 0.4 }
  const wider = analyze(doc)
  assert.ok(Math.abs((wider.trench.volumeM3 ?? 0) - 25.2 * 0.6 * 0.4) < 1e-9)
  doc.pxPerMeter = null
  assert.equal(analyze(doc).trench.volumeM3, null)
})

test('an older project without a pipe series still opens', () => {
  const raw = exampleDoc()
  const legacy = {
    ...raw,
    pipeSeries: undefined,
    valves: undefined,
    drips: undefined,
    trench: undefined,
    source: { x: 40, y: 300 },
    zones: raw.zones.map((zone) => {
      const copy = { ...zone } as Partial<typeof zone>
      delete copy.doseMm
      delete copy.soil
      delete copy.slope
      delete copy.climate
      return copy
    }),
  }
  const parsed = parseDoc(legacy)
  assert.equal(parsed?.pipeSeries, 'sdr11')
  assert.equal(parsed?.source?.pressureBar, 3)
  assert.equal(parsed?.source?.flowLimitLph, null)
  assert.equal(parsed?.zones[0].doseMm, 6)
  assert.equal(parsed?.zones[0].soil, 'loam')
  assert.equal(parsed?.zones[0].slope, 'flat')
  assert.equal(parsed?.zones[0].climate, 'open')
  assert.deepEqual(parsed?.trench, { widthM: 0.3, depthM: 0.4 })
  assert.equal(parseDoc({ ...raw, trench: { widthM: 5, depthM: 0.4 } }), null)
  assert.deepEqual(parsed?.valves, [])
  assert.deepEqual(parsed?.drips, [])
  assert.equal(parseDoc({ ...raw, zones: [{ ...raw.zones[0], doseMm: 80 }] }), null)
})

test('a head within a metre of a pipe end joins through a flexible tail', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 20
  doc.source = { x: 0, y: 0, pressureBar: 3, flowLimitLph: null }
  doc.pipes = [{ id: 'p', role: 'main', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]
  doc.sprinklers = [{
    id: 's',
    nozzleId: 'fan180',
    x: 100,
    y: 16,
    radiusM: 4.5,
    arcDeg: 180,
    rotationDeg: 0,
    flowLph: 360,
  }]
  const analysis = analyze(doc)
  assert.equal(analysis.connectedFlowLph, 360)
  assert.equal(analysis.tails.length, 1)
  assert.ok(Math.abs(analysis.tails[0].lengthM - 0.8) < 1e-9)
  assert.equal(analysis.warnings.some((item) => item.includes('не стоит на трубе')), false)
})

test('a head farther than a metre stays off the network', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = 20
  doc.source = { x: 0, y: 0, pressureBar: 3, flowLimitLph: null }
  doc.pipes = [{ id: 'p', role: 'main', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]
  doc.sprinklers = [{
    id: 's',
    nozzleId: 'fan180',
    x: 100,
    y: 30,
    radiusM: 4.5,
    arcDeg: 180,
    rotationDeg: 0,
    flowLph: 360,
  }]
  const analysis = analyze(doc)
  assert.equal(analysis.connectedFlowLph, 0)
  assert.equal(analysis.tails.length, 0)
  assert.ok(analysis.warnings.some((item) => item.includes('не стоит на трубе')))
})

test('without a scale a head just outside the snap stays loose', () => {
  const doc = emptyDoc()
  doc.pxPerMeter = null
  doc.source = { x: 0, y: 0, pressureBar: 3, flowLimitLph: null }
  doc.pipes = [{ id: 'p', role: 'main', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }]
  doc.sprinklers = [{
    id: 's',
    nozzleId: 'fan180',
    x: 100,
    y: 16,
    radiusM: 4.5,
    arcDeg: 180,
    rotationDeg: 0,
    flowLph: 360,
  }]
  const analysis = analyze(doc)
  assert.equal(analysis.tails.length, 0)
  assert.equal(analysis.connectedFlowLph, 0)
})
