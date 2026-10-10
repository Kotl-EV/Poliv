import assert from 'node:assert/strict'
import test from 'node:test'
import { analyze } from './analyze.ts'
import { emptyDoc } from './doc.ts'
import { exampleDoc } from './example.ts'
import { gearList, gearText } from './gear.ts'
import type { Doc, Sprinkler } from './types.ts'

function head(patch: Partial<Sprinkler> & Pick<Sprinkler, 'id' | 'nozzleId'>): Sprinkler {
  return {
    x: 40,
    y: 40,
    radiusM: 4.5,
    arcDeg: 180,
    rotationDeg: 0,
    flowLph: 360,
    ...patch,
  }
}

function lawn(doc: Doc) {
  doc.zones = [{
    id: 'z',
    name: 'Газон',
    kind: 'lawn',
    points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }],
    doseMm: 6,
    soil: 'loam',
    slope: 'flat',
    climate: 'open',
  }]
}

test('the example scheme lists spray bodies, nozzles, pipe and fittings', () => {
  const gear = gearList(exampleDoc(), analyze(exampleDoc()))
  assert.equal(gear.notes.length, 0)
  assert.equal(gear.lines.find((line) => line.name.startsWith('Корпус выдвижной'))?.qty, '4 шт.')
  assert.equal(gear.lines.find((line) => line.name === 'Сопло веерное 4,5 м, 180°')?.qty, '4 шт.')
  assert.equal(gear.lines.some((line) => line.name.startsWith('Корпус ротора')), false)
  assert.equal(gear.lines.find((line) => line.name === 'Труба ПЭ 25, SDR 11')?.qty, '3,2 м')
  assert.equal(gear.lines.find((line) => line.name === 'Труба ПЭ 20, SDR 11')?.qty, '22 м')
  assert.equal(gear.lines.find((line) => line.name === 'Крестовина ПЭ 25×20×20×20')?.qty, '1 шт.')
})

test('the buy list copies as lines a shop can read', () => {
  const doc = emptyDoc()
  lawn(doc)
  doc.sprinklers = [
    head({ id: 'a', nozzleId: 'fan180' }),
    head({ id: 'b', nozzleId: 'rotor', x: 80, y: 80, radiusM: 10, flowLph: 720 }),
  ]
  const text = gearText(gearList(doc, analyze(doc)))
  assert.match(text, /^К закупке\n/)
  assert.match(text, /Корпус выдвижной 1\/2" 10 см — 1 шт\./)
  assert.match(text, /Сопло ротора №1,5, 10,1 м — 1 шт\./)
  assert.match(text, /Зона «Газон» смешивает веер и ротор/)
})

test('a fan and a rotor on one lawn ask for two bodies and a split', () => {
  const doc = emptyDoc()
  lawn(doc)
  doc.sprinklers = [
    head({ id: 'a', nozzleId: 'fan180' }),
    head({ id: 'b', nozzleId: 'rotor', x: 80, y: 80, radiusM: 10, flowLph: 720 }),
  ]
  const gear = gearList(doc, analyze(doc))
  assert.equal(gear.lines.find((line) => line.name.startsWith('Корпус выдвижной'))?.qty, '1 шт.')
  assert.equal(gear.lines.find((line) => line.name === 'Корпус ротора 10 см')?.qty, '1 шт.')
  assert.equal(gear.lines.find((line) => line.name === 'Сопло ротора №1,5, 10,1 м')?.qty, '1 шт.')
  assert.equal(gear.notes.length, 1)
  assert.match(gear.notes[0], /Газон/)
  assert.match(gear.notes[0], /веер и ротор/)
})

test('rotators share the spray body and bubblers stay a single item', () => {
  const doc = emptyDoc()
  doc.sprinklers = [
    head({ id: 'a', nozzleId: 'fan180' }),
    head({ id: 'b', nozzleId: 'rot6-180', x: 80, radiusM: 6, flowLph: 180 }),
    head({ id: 'c', nozzleId: 'bub240', x: 120, radiusM: 0.6, arcDeg: 360, flowLph: 240 }),
    head({ id: 'd', nozzleId: 'bub240h', x: 140, radiusM: 0.6, arcDeg: 180, flowLph: 240 }),
  ]
  const gear = gearList(doc, analyze(doc))
  assert.equal(gear.lines.find((line) => line.name.startsWith('Корпус выдвижной'))?.qty, '2 шт.')
  assert.equal(gear.lines.some((line) => line.name === 'Корпус ротора'), false)
  assert.equal(gear.lines.find((line) => line.name === 'Сопло-ротатор 6 м, 180°')?.qty, '1 шт.')
  assert.equal(gear.lines.find((line) => line.name === 'Баблер 4 л/мин')?.qty, '1 шт.')
  assert.equal(gear.lines.find((line) => line.name === 'Баблер 4 л/мин, 180°')?.qty, '1 шт.')
})

test('rotor sectors share one nozzle and a strip is its own line', () => {
  const doc = emptyDoc()
  doc.sprinklers = [
    head({ id: 'a', nozzleId: 'rotor90', arcDeg: 90, radiusM: 10, flowLph: 360 }),
    head({ id: 'b', nozzleId: 'rotor', x: 80, arcDeg: 180, radiusM: 10, flowLph: 720 }),
    head({ id: 'c', nozzleId: 'fan-ss', x: 120, radiusM: 1.5, arcDeg: 180, flowLph: 152 }),
    head({ id: 'd', nozzleId: 'fan45-adj', x: 160, radiusM: 4.5, arcDeg: 200, flowLph: 360 }),
  ]
  const gear = gearList(doc, analyze(doc))
  assert.equal(gear.lines.find((line) => line.name === 'Сопло ротора №1,5, 10,1 м')?.qty, '2 шт.')
  assert.equal(gear.lines.find((line) => line.name === 'Полоса боковая 1,5×9 м')?.qty, '1 шт.')
  assert.equal(gear.lines.find((line) => line.name === 'Сопло веерное регулируемое 4,5 м')?.qty, '1 шт.')
  assert.equal(gear.lines.find((line) => line.name.startsWith('Корпус ротора'))?.qty, '2 шт.')
  assert.equal(gear.lines.find((line) => line.name.startsWith('Корпус выдвижной'))?.qty, '2 шт.')
})

test('a tall spray body and a long rotor keep their own buy lines', () => {
  const doc = emptyDoc()
  doc.sprinklers = [
    head({ id: 'a', nozzleId: 'fan180', riseCm: 30 }),
    head({ id: 'b', nozzleId: 'rotor', x: 80, radiusM: 15, arcDeg: 180, flowLph: 1440 }),
  ]
  const gear = gearList(doc, analyze(doc))
  assert.equal(gear.lines.find((line) => line.name === 'Корпус выдвижной 1/2" 30 см')?.qty, '1 шт.')
  assert.equal(gear.lines.some((line) => line.name === 'Корпус выдвижной 1/2" 10 см'), false)
  assert.equal(gear.lines.find((line) => line.name === 'Корпус ротора 10 см')?.qty, '1 шт.')
  assert.equal(gear.lines.find((line) => line.name === 'Сопло ротора №8, 13,7 м, вылет 15 м')?.qty, '1 шт.')
})

test('the same fitted throw groups into one nozzle line', () => {
  const doc = emptyDoc()
  doc.sprinklers = [
    head({ id: 'a', nozzleId: 'fan180', radiusM: 5, flowLph: 444 }),
    head({ id: 'b', nozzleId: 'fan360', x: 90, radiusM: 5.04, arcDeg: 180, flowLph: 450 }),
  ]
  const gear = gearList(doc, analyze(doc))
  assert.equal(gear.lines.find((line) => line.name === 'Сопло веерное 5 м, 180°')?.qty, '2 шт.')
})

test('drip, a valve box and a loose hydrant are buy lines', () => {
  const doc = emptyDoc()
  doc.valves = [
    { id: 'v1', name: 'Клапан 1', x: 10, y: 10, boxId: 'box' },
    { id: 'v2', name: 'Клапан 2', x: 20, y: 10, boxId: 'box' },
  ]
  doc.boxes = [{ id: 'box', name: 'Бокс', x: 15, y: 10 }]
  doc.hydrants = [{ id: 'h', x: 300, y: 300 }]
  doc.sleeves = [{ id: 's', a: { x: 0, y: 0 }, b: { x: 40, y: 0 } }]
  doc.drips = [{ id: 'd', points: [{ x: 0, y: 0 }, { x: 60, y: 0 }], spacingM: 0.3, emitterLph: 2 }]
  const gear = gearList(doc, analyze(doc))
  assert.equal(gear.lines.find((line) => line.name === 'Капельная трубка 2 л/ч, шаг 0,3 м')?.qty, '3 м')
  assert.equal(gear.lines.find((line) => line.name === 'Клапан электромагнитный')?.qty, '2 шт.')
  assert.equal(gear.lines.find((line) => line.name === 'Клапанный бокс на 2 клапана')?.qty, '1 шт.')
  assert.equal(gear.lines.find((line) => line.name === 'Гидрант')?.qty, '1 шт.')
  assert.equal(gear.lines.filter((line) => line.name === 'Гидрант').length, 1)
  assert.equal(gear.lines.find((line) => line.name === 'Гильза')?.qty, '1 шт. · 2 м')
  doc.drips.push({ id: 'bare', points: [{ x: 0, y: 20 }, { x: 40, y: 20 }], spacingM: 0.3, emitterLph: 2, bare: true })
  const withBare = gearList(doc, analyze(doc))
  assert.equal(withBare.lines.find((line) => line.name === 'Капельная трубка 2 л/ч, шаг 0,3 м')?.qty, '3 м')
  assert.equal(withBare.lines.find((line) => line.name === 'Трубка ПЭ 16 без капельниц')?.qty, '2 м')
})
