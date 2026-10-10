import assert from 'node:assert/strict'
import test from 'node:test'
import { analyze } from './analyze.ts'
import { emptyDoc } from './doc.ts'
import { exampleDoc } from './example.ts'
import { hatchTile } from './landscape.ts'
import { pdfFromJpegPages } from './pdf.ts'
import { runtimeLabel } from './program.ts'
import { pressureLabel, sourceLabel, valveFlowLabel } from './pipes.ts'
import { dripFlowTags, lossTags } from './pipeview.ts'
import { buildSheetPages, contentBounds, DEFAULT_SHEET_LAYERS, mmToPx, paperOf } from './sheet.ts'

test('A4 album is 297 by 210 millimetres', () => {
  const paper = paperOf('a4')
  assert.equal(paper.wMm, 297)
  assert.equal(paper.hMm, 210)
  assert.ok(mmToPx(297) > 1700)
})

test('content bounds cover the example lawn and the source', () => {
  const doc = exampleDoc()
  const box = contentBounds(doc)
  assert.ok(box.minX < 40)
  assert.ok(box.maxX > 760)
  assert.ok(box.minY < 80)
  assert.ok(box.maxY > 520)
})

test('scheme svg has the lawn, heads, pipes, legend and scale', () => {
  const doc = exampleDoc()
  const pages = buildSheetPages(doc, analyze(doc), { title: 'Участок 12', date: '09.10.2026', paper: 'a4' })
  assert.equal(pages.length, 2)
  const svg = pages[0].svg
  assert.match(svg, /<svg /)
  assert.match(svg, /Газон/)
  assert.match(svg, /ЛЕГЕНДА/)
  assert.match(svg, /Масштаб 1:(50|75|100|150|200|250)/)
  assert.match(svg, /Участок 12/)
  assert.match(svg, /09\.10\.2026/)
  assert.match(svg, /Дождеватель/)
  assert.match(svg, /Источник/)
  assert.match(svg, /sheet-lawn/)
  assert.equal(pages[0].name, 'Схема')
  assert.equal(pages[1].name, 'Спецификация')
  assert.match(pages[1].svg, /Спецификация/)
  assert.match(pages[1].svg, /К ЗАКУПКЕ/)
  assert.match(pages[1].svg, /Сопло веерное 4,5 м, 180°/)
  assert.match(pages[1].svg, /Корпус выдвижной/)
  assert.match(pages[1].svg, /ПЭ/)
})

test('a station colour and a precip wash reach the sheet', () => {
  const doc = exampleDoc()
  doc.valves = [{ id: 'v1', name: 'Клапан 1', x: 200, y: 300 }]
  const pages = buildSheetPages(doc, analyze(doc), { title: 'Станция', date: '01.01.2026', includeSpec: false })
  assert.match(pages[0].svg, /#c23b22/)
  assert.match(pages[0].svg, /Станция 1/)
  assert.match(pages[0].svg, /sheet-lawn/)
  const wet = buildSheetPages(doc, analyze(doc), {
    title: 'Осадки',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, precip: true },
  })
  assert.match(wet[0].svg, /rgba\(78,156,82,0\.46\)/)
  assert.match(wet[0].svg, /Норма, 8–22 мм\/ч/)
  const named = buildSheetPages(doc, analyze(doc), {
    title: 'Подписи',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, headInfo: true },
  })
  assert.match(named[0].svg, /4,5 м · 180° · 360 л\/ч/)
  assert.equal(pages[0].svg.includes('4,5 м · 180° · 360 л/ч'), false)
})

test('turning a layer off drops that geometry from the sheet', () => {
  const doc = exampleDoc()
  const analysis = analyze(doc)
  const off = buildSheetPages(doc, analysis, {
    title: 'Тест',
    date: '01.01.2026',
    layers: { ...DEFAULT_SHEET_LAYERS, spray: false, pipes: false },
    includeSpec: false,
  })
  assert.equal(off.length, 1)
  assert.equal(off[0].svg.includes('Дождеватель'), false)
  assert.equal(/rgba\(47,122,72/.test(off[0].svg), false)
  const on = buildSheetPages(doc, analysis, { title: 'Тест', date: '01.01.2026', includeSpec: false })
  assert.match(on[0].svg, /Дождеватель/)
})

test('a hatch and a measure reach the printed sheet', () => {
  const doc = {
    ...emptyDoc(),
    zones: [{
      id: 'z',
      name: 'Дорожка',
      kind: 'path' as const,
      points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }],
      doseMm: 0,
      soil: 'loam' as const,
      slope: 'flat' as const,
      climate: 'open' as const,
      hatch: 'path-brick' as const,
    }],
    measures: [{ id: 'm', a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }],
  }
  const box = contentBounds(doc)
  assert.ok(box.maxX >= 200)
  const pages = buildSheetPages(doc, analyze(doc), { title: 'Т', date: '01.01.2026', includeSpec: false })
  assert.match(pages[0].svg, /sheet-path-brick/)
  assert.match(pages[0].svg, /10\.0 м/)
})

test('stroke, opacity, anchor and a coloured note reach the sheet', () => {
  const doc = {
    ...emptyDoc(),
    anchor: { x: -50, y: 5 },
    zones: [{
      id: 'z',
      name: 'Газон',
      kind: 'lawn' as const,
      points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }],
      doseMm: 6,
      soil: 'loam' as const,
      slope: 'flat' as const,
      climate: 'open' as const,
      stroke: '#8d2b1f',
      opacity: 0.4,
      pen: 3,
    }],
    notes: [{ id: 'n', x: 5, y: 5, text: 'Кран', sizeM: 0.4, color: '#2a6288', bold: true }],
  }
  const box = contentBounds(doc)
  assert.ok(box.minX < -40)
  const svg = buildSheetPages(doc, analyze(doc), { title: 'Т', date: '01.01.2026', includeSpec: false })[0].svg
  assert.match(svg, /stroke="#8d2b1f"/)
  assert.match(svg, /opacity="0\.4"/)
  assert.match(svg, /fill="#2a6288"/)
  assert.match(svg, /font-weight="700"/)
})

test('zone textures are dense and water keeps its waves on the sheet', () => {
  const lawn = hatchTile('lawn', 20)
  assert.ok(lawn.nodes.filter((node) => node.kind === 'path').length >= 2)
  const mulch = hatchTile('bed-mulch', 20)
  assert.ok(mulch.nodes.filter((node) => node.kind === 'chip').length >= 6)
  const shrub = hatchTile('shrub', 20)
  assert.ok(shrub.nodes.filter((node) => node.kind === 'dot').length >= 6)
  const water = hatchTile('water', 20)
  const waves = water.nodes.filter((node) => node.kind === 'path')
  assert.ok(waves.length >= 2)
  assert.ok(waves.every((node) => node.kind === 'path' && node.d.includes('Q')))
  const doc = {
    ...emptyDoc(),
    zones: [{
      id: 'z',
      name: 'Пруд',
      kind: 'water' as const,
      points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }],
      doseMm: 0,
      soil: 'loam' as const,
      slope: 'flat' as const,
      climate: 'open' as const,
    }],
  }
  const svg = buildSheetPages(doc, analyze(doc), { title: 'Т', date: '01.01.2026', includeSpec: false })[0].svg
  assert.match(svg, /sheet-water/)
  assert.match(svg, /id="sheet-water"[\s\S]*Q /)
})

test('a conifer crown reaches the printed sheet', () => {
  const doc = {
    ...emptyDoc(),
    plants: [{ id: 'p', kind: 'tree' as const, x: 20, y: 20, radiusM: 2, form: 'conifer' as const }],
  }
  const svg = buildSheetPages(doc, analyze(doc), { title: 'Т', date: '01.01.2026', includeSpec: false })[0].svg
  assert.match(svg, /fill="#1e4a34"/)
  assert.match(svg, / L /)
})

test('a car and a scale bar reach the printed sheet', () => {
  const doc = {
    ...emptyDoc(),
    fixtures: [
      { id: 'c', kind: 'sedan' as const, x: 30, y: 20, radiusM: 2.25, rotationDeg: 90 },
      { id: 'b', kind: 'scalebar' as const, x: 10, y: 40, radiusM: 2 },
    ],
  }
  const svg = buildSheetPages(doc, analyze(doc), { title: 'Т', date: '01.01.2026', includeSpec: false })[0].svg
  assert.match(svg, /fill="#3e4c5e"/)
  assert.match(svg, /rotate\(90\)/)
  assert.match(svg, /4 м/)
})

test('a long specification continues on the next page', () => {
  const doc = emptyDoc()
  doc.zones = Array.from({ length: 70 }, (_, index) => ({
    id: `z${index + 1}`,
    name: index === 69 ? 'Клумба-последняя' : `Клумба ${index + 1}`,
    kind: 'bed' as const,
    points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }],
    doseMm: 4,
    soil: 'loam' as const,
    slope: 'flat' as const,
    climate: 'open' as const,
  }))
  doc.sprinklers = [{
    id: 's',
    nozzleId: 'fan180',
    x: 10,
    y: 10,
    radiusM: 4.5,
    arcDeg: 180,
    rotationDeg: 0,
    flowLph: 360,
  }]
  const pages = buildSheetPages(doc, analyze(doc), { title: 'Длинный', date: '01.01.2026', paper: 'a4' })
  assert.ok(pages.length >= 3)
  assert.equal(pages[1].name, 'Спецификация')
  assert.match(pages[1].svg, /К ЗАКУПКЕ/)
  assert.equal(pages[1].svg.includes('Клумба-последняя'), false)
  const rest = pages.slice(2)
  assert.match(rest.map((page) => page.svg).join('\n'), /Клумба-последняя/)
  assert.match(rest[0].svg, /продолжение/)
  assert.match(rest.map((page) => page.svg).join('\n'), /ТРАНШЕЯ/)
})

test('jpeg pages become a pdf with one image per page', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 1, 2, 3])
  const pdf = pdfFromJpegPages([
    { widthPt: 841.89, heightPt: 595.28, pixelWidth: 1754, pixelHeight: 1240, jpeg },
    { widthPt: 841.89, heightPt: 595.28, pixelWidth: 1754, pixelHeight: 1240, jpeg },
  ])
  const text = new TextDecoder().decode(pdf)
  assert.equal(text.startsWith('%PDF-1.4'), true)
  assert.match(text, /\/Type \/Page/)
  assert.match(text, /\/Count 2/)
  assert.match(text, /\/Filter \/DCTDecode/)
  assert.match(text, /startxref/)
  assert.match(text, /%%EOF/)
  assert.ok(pdf.length > 400)
})

test('runtime, a hidden cover and a draft sheet stay on the drawing', () => {
  const doc = exampleDoc()
  const analysis = analyze(doc)
  const label = runtimeLabel(analysis.zones[0].runtimeMin, analysis.zones[0].cycles)
  assert.ok(label)
  const plain = buildSheetPages(doc, analysis, { title: 'План', date: '01.01.2026', includeSpec: false })
  assert.equal(plain[0].svg.includes(label), false)
  assert.match(plain[0].svg, /#24633a/)
  assert.match(plain[0].svg, /sheet-lawn/)
  const timed = buildSheetPages(doc, analysis, {
    title: 'Время',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, runtime: true },
  })
  assert.equal(timed[0].svg.includes(label), true)
  const bare = buildSheetPages(doc, analysis, {
    title: 'Без радиусов',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, cover: false },
  })
  assert.equal(bare[0].svg.includes('#24633a'), false)
  assert.match(bare[0].svg, /Дождеватель/)
  const draft = buildSheetPages(doc, analysis, {
    title: 'Чертёж',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, draft: true },
  })
  assert.equal(draft[0].svg.includes('sheet-lawn'), false)
  assert.match(draft[0].svg, /fill="#ffffff"/)
  const spec = buildSheetPages(doc, analysis, { title: 'Пульт', date: '01.01.2026' }).map((page) => page.svg).join('\n')
  assert.match(spec, /ПУЛЬТ/)
  assert.match(spec, /старт 06:00/)
  assert.match(spec, /Вся сеть/)
})

test('a note leader reaches the sheet', () => {
  const doc = {
    ...emptyDoc(),
    notes: [{ id: 'n', x: 10, y: 20, text: 'Туда', sizeM: 0.4, leader: { x: 110, y: 20 } }],
  }
  const box = contentBounds(doc)
  assert.ok(box.maxX >= 110)
  assert.ok(box.minX <= 10)
  const svg = buildSheetPages(doc, analyze(doc), { title: 'Выноска', date: '01.01.2026', includeSpec: false })[0].svg
  assert.match(svg, /Туда/)
  assert.match(svg, /<polygon points="110,20/)
  const plainDoc = { ...doc, notes: [{ id: 'n', x: 10, y: 20, text: 'Туда', sizeM: 0.4 }] }
  const plain = buildSheetPages(plainDoc, analyze(plainDoc), { title: 'Выноска', date: '01.01.2026', includeSpec: false })[0].svg
  assert.equal(plain.includes('<polygon'), false)
})

test('a sleeve length reaches the sheet and hides with the fittings', () => {
  const doc = {
    ...emptyDoc(),
    sleeves: [{ id: 's', a: { x: 0, y: 0 }, b: { x: 248, y: 0 } }],
  }
  const on = buildSheetPages(doc, analyze(doc), { title: 'Гильза', date: '01.01.2026', includeSpec: false })
  assert.match(on[0].svg, /12,4 м/)
  const off = buildSheetPages(doc, analyze(doc), {
    title: 'Гильза',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, fittings: false },
  })
  assert.equal(off[0].svg.includes('12,4 м'), false)
})

test('a zone name reaches the sheet only when that layer is on', () => {
  const doc = {
    ...emptyDoc(),
    zones: [{
      id: 'z',
      name: 'Палисадник',
      kind: 'lawn' as const,
      points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }],
      doseMm: 6,
      soil: 'loam' as const,
      slope: 'flat' as const,
      climate: 'open' as const,
    }],
  }
  const analysis = analyze(doc)
  const off = buildSheetPages(doc, analysis, { title: 'Имя', date: '01.01.2026', includeSpec: false })
  // Легенда всегда пишет имя. Подпись в середине зоны — только со слоем.
  assert.equal(off[0].svg.includes('>Палисадник</text>'), false)
  assert.match(off[0].svg, /Палисадник ·/)
  const on = buildSheetPages(doc, analysis, {
    title: 'Имя',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, names: true },
  })
  assert.match(on[0].svg, />Палисадник<\/text>/)
})

test('a flow arrow points at the head and hides with the pipes', () => {
  const doc = {
    ...emptyDoc(),
    source: { x: 0, y: 0, pressureBar: 3, flowLimitLph: null },
    zones: [],
    valves: [],
    pipes: [{ id: 'run', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }],
    sprinklers: [{ id: 's', nozzleId: 'fan180', x: 200, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 }],
  }
  const analysis = analyze(doc)
  const on = buildSheetPages(doc, analysis, { title: 'Поток', date: '01.01.2026', includeSpec: false })
  assert.match(on[0].svg, /data-flow="1"/)
  assert.match(on[0].svg, /rotate\(90\)/)
  const off = buildSheetPages(doc, analysis, {
    title: 'Поток',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, pipes: false },
  })
  assert.equal(off[0].svg.includes('data-flow='), false)
})

test('a pipe speed reaches the sheet and hides with the pipes', () => {
  const doc = {
    ...emptyDoc(),
    source: { x: 0, y: 0, pressureBar: 3, flowLimitLph: null },
    zones: [],
    valves: [],
    pipes: [{ id: 'run', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }],
    sprinklers: [{ id: 's', nozzleId: 'fan180', x: 200, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 }],
  }
  const analysis = analyze(doc)
  const fed = analysis.segments.find((segment) => segment.status === 'ok' && segment.velocity && segment.velocity > 0)
  assert.ok(fed?.velocity)
  const label = `${fed.velocity.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} м/с`
  const on = buildSheetPages(doc, analysis, { title: 'Скорость', date: '01.01.2026', includeSpec: false })
  assert.match(on[0].svg, /data-speed="1"/)
  assert.equal(on[0].svg.includes(`>${label}</text>`), true)
  const off = buildSheetPages(doc, analysis, {
    title: 'Скорость',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, pipes: false },
  })
  assert.equal(off[0].svg.includes('data-speed='), false)
})

test('a pipe loss reaches the sheet and hides with the pipes', () => {
  const doc = {
    ...emptyDoc(),
    source: { x: 0, y: 0, pressureBar: 3, flowLimitLph: null },
    zones: [],
    valves: [],
    pipes: [{ id: 'run', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }],
    sprinklers: [{ id: 's', nozzleId: 'fan180', x: 200, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 }],
  }
  const analysis = analyze(doc)
  const tags = lossTags(analysis.segments, doc.pxPerMeter, 1)
  assert.equal(tags.length, 1)
  const on = buildSheetPages(doc, analysis, { title: 'Потери', date: '01.01.2026', includeSpec: false })
  assert.match(on[0].svg, /data-loss="1"/)
  assert.equal(on[0].svg.includes(`>${tags[0].text}</text>`), true)
  const off = buildSheetPages(doc, analysis, {
    title: 'Потери',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, pipes: false },
  })
  assert.equal(off[0].svg.includes('data-loss='), false)
})

test('a drip emitter count reaches the sheet and hides with the drip', () => {
  const doc = {
    ...emptyDoc(),
    zones: [],
    valves: [],
    pipes: [],
    sprinklers: [],
    drips: [
      { id: 'd', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }], spacingM: 0.3, emitterLph: 2 },
      { id: 'bare', points: [{ x: 0, y: 40 }, { x: 100, y: 40 }], spacingM: 0.3, emitterLph: 2, bare: true },
    ],
  }
  const analysis = analyze(doc)
  const tags = dripFlowTags(doc.drips, doc.pxPerMeter, 1)
  assert.equal(tags.length, 1)
  const on = buildSheetPages(doc, analysis, { title: 'Капля', date: '01.01.2026', includeSpec: false })
  assert.equal(on[0].svg.match(/data-drip-flow="1"/g)?.length, 1)
  assert.equal(on[0].svg.includes(`>${tags[0].text}</text>`), true)
  const off = buildSheetPages(doc, analysis, {
    title: 'Капля',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, drip: false },
  })
  assert.equal(off[0].svg.includes('data-drip-flow='), false)
})

test('a head pressure reaches the sheet and hides with the heads', () => {
  const doc = {
    ...emptyDoc(),
    source: { x: 0, y: 0, pressureBar: 3, flowLimitLph: null },
    zones: [],
    valves: [],
    pipes: [{ id: 'run', points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] }],
    sprinklers: [{ id: 's', nozzleId: 'fan180', x: 200, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 }],
  }
  const analysis = analyze(doc)
  const mark = analysis.pressureMarks.find((item) => item.id === 's')
  assert.ok(mark)
  const on = buildSheetPages(doc, analysis, { title: 'Напор', date: '01.01.2026', includeSpec: false })
  assert.match(on[0].svg, /data-pressure="1"/)
  assert.equal(on[0].svg.includes(`>${pressureLabel(mark.bar)}</text>`), true)
  const off = buildSheetPages(doc, analysis, {
    title: 'Напор',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, spray: false },
  })
  assert.equal(off[0].svg.includes('data-pressure='), false)
  const pipesOff = buildSheetPages(doc, analysis, {
    title: 'Напор',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, pipes: false },
  })
  assert.match(pipesOff[0].svg, /data-pressure="1"/)
})

test('a valve shows its station flow and hides with the fittings', () => {
  assert.equal(valveFlowLabel(360), '360 л/ч')
  assert.equal(valveFlowLabel(12.6), '13 л/ч')
  const doc = {
    ...emptyDoc(),
    source: { x: 0, y: 0, pressureBar: 3, flowLimitLph: null },
    zones: [],
    pipes: [{ id: 'run', points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 200, y: 0 }] }],
    valves: [{ id: 'v1', name: 'Клапан 1', x: 80, y: 0 }],
    sprinklers: [{ id: 's', nozzleId: 'fan180', x: 200, y: 0, radiusM: 4.5, arcDeg: 180, rotationDeg: 0, flowLph: 360 }],
  }
  const analysis = analyze(doc)
  assert.equal(analysis.stations.find((item) => item.id === 'v1')?.flowLph, 360)
  const on = buildSheetPages(doc, analysis, { title: 'Клапан', date: '01.01.2026', includeSpec: false })
  assert.match(on[0].svg, /data-valve-flow="1"/)
  assert.equal(on[0].svg.includes('>360 л/ч</text>'), true)
  const off = buildSheetPages(doc, analysis, {
    title: 'Клапан',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, fittings: false },
  })
  assert.equal(off[0].svg.includes('data-valve-flow='), false)
  const dry = {
    ...doc,
    sprinklers: [],
  }
  const idle = buildSheetPages(dry, analyze(dry), { title: 'Клапан', date: '01.01.2026', includeSpec: false })
  assert.equal(idle[0].svg.includes('data-valve-flow='), false)
})

test('a source label names the pressure and hides with the fittings', () => {
  assert.equal(sourceLabel({ pressureBar: 3, flowLimitLph: null }), '3 бар')
  assert.equal(sourceLabel({ pressureBar: 2.5, flowLimitLph: 900 }), '2,5 бар · 900 л/ч')
  assert.equal(sourceLabel({ pressureBar: 3, flowLimitLph: 0 }), '3 бар')
  const doc = {
    ...emptyDoc(),
    source: { x: 40, y: 80, pressureBar: 2.5, flowLimitLph: 900 },
    zones: [],
    valves: [],
    pipes: [],
    sprinklers: [],
  }
  const analysis = analyze(doc)
  const on = buildSheetPages(doc, analysis, { title: 'Источник', date: '01.01.2026', includeSpec: false })
  assert.match(on[0].svg, /data-source="1"/)
  assert.equal(on[0].svg.includes('>2,5 бар · 900 л/ч</text>'), true)
  const off = buildSheetPages(doc, analysis, {
    title: 'Источник',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, fittings: false },
  })
  assert.equal(off[0].svg.includes('data-source='), false)
})

test('a pipe elbow and a cap reach the sheet with the pipes', () => {
  const doc = {
    ...emptyDoc(),
    source: { x: 0, y: 0, pressureBar: 3, flowLimitLph: null },
    zones: [],
    sprinklers: [],
    valves: [],
    pipes: [{ id: 'run', points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 80 }] }],
  }
  const analysis = analyze(doc)
  assert.equal(analysis.fittingMarks.some((item) => item.kind === 'elbow' && item.x === 80 && item.y === 0), true)
  assert.equal(analysis.fittingMarks.some((item) => item.kind === 'cap' && item.x === 80 && item.y === 80), true)
  const on = buildSheetPages(doc, analysis, { title: 'Фитинг', date: '01.01.2026', includeSpec: false })
  assert.match(on[0].svg, /data-fitting="elbow"/)
  assert.match(on[0].svg, /data-fitting="cap"/)
  const off = buildSheetPages(doc, analysis, {
    title: 'Фитинг',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, pipes: false },
  })
  assert.equal(off[0].svg.includes('data-fitting='), false)
})

test('a zone area reaches the sheet only when that layer is on', () => {
  const doc = {
    ...emptyDoc(),
    zones: [{
      id: 'z',
      name: 'Палисадник',
      kind: 'lawn' as const,
      points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 80, y: 40 }],
      doseMm: 6,
      soil: 'loam' as const,
      slope: 'flat' as const,
      climate: 'open' as const,
    }],
  }
  const analysis = analyze(doc)
  const off = buildSheetPages(doc, analysis, { title: 'Площадь', date: '01.01.2026', includeSpec: false })
  // Легенда всегда пишет площадь. Подпись в середине — только со слоем.
  assert.equal(off[0].svg.includes('>4 м²</text>'), false)
  assert.match(off[0].svg, /4 м²/)
  const on = buildSheetPages(doc, analysis, {
    title: 'Площадь',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, area: true },
  })
  assert.match(on[0].svg, />4 м²<\/text>/)
  const bare = { ...doc, pxPerMeter: null }
  const unscaled = buildSheetPages(bare, analyze(bare), {
    title: 'Площадь',
    date: '01.01.2026',
    includeSpec: false,
    layers: { ...DEFAULT_SHEET_LAYERS, area: true },
  })
  assert.equal(unscaled[0].svg.includes('>4 м²</text>'), false)
})
