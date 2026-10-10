import assert from 'node:assert/strict'
import test from 'node:test'
import { analyze } from './analyze.ts'
import { emptyDoc } from './doc.ts'
import { exampleDoc } from './example.ts'
import { hatchTile } from './landscape.ts'
import { pdfFromJpegPages } from './pdf.ts'
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
