import assert from 'node:assert/strict'
import test from 'node:test'
import { analyze } from './analyze.ts'
import { exampleDoc } from './example.ts'
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
