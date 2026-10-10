import assert from 'node:assert/strict'
import test from 'node:test'
import { analyze } from './analyze.ts'
import { emptyDoc, parseDoc } from './doc.ts'
import { exampleDoc } from './example.ts'
import { bucketLph, programOf, programTable, runtimeLabel } from './program.ts'

test('ten litres in forty seconds is 900 litres per hour', () => {
  assert.equal(bucketLph(10, 40), 900)
  assert.equal(bucketLph(0, 40), null)
  assert.equal(bucketLph(10, 0), null)
  assert.equal(bucketLph(-1, 10), null)
  assert.equal(bucketLph(10, 4000), null)
})

test('a missing program is Monday, Wednesday and Friday at six', () => {
  const table = programTable(exampleDoc(), analyze(exampleDoc()))
  assert.ok(table)
  assert.equal(table.lines[0].name, 'Пн, Ср, Пт')
  assert.equal(table.lines[0].when, 'старт 06:00')
  assert.equal(table.lines.some((line) => line.name === 'Вся сеть'), true)
  assert.deepEqual(programOf({}), { days: [0, 2, 4], startHour: 6, startMin: 0 })
})

test('one station starts at the chosen clock and soaks between cycles', () => {
  const table = programTable(
    { program: { days: [1], startHour: 21, startMin: 30 } },
    {
      programMin: 12,
      clockMin: 42,
      stations: [{ id: 'v', name: 'Клапан 1', flowLph: 100, runtimeMin: 12, cycles: 2, soakMin: 30 }],
    },
  )
  assert.ok(table)
  const row = table.lines.find((line) => line.name === 'Клапан 1')
  assert.equal(row?.when, '21:30–22:12')
  assert.match(row?.note ?? '', /12 мин/)
  assert.match(row?.note ?? '', /2 цикла, пауза 30 мин/)
  assert.equal(table.lines.at(-1)?.name, 'Вместе')
  assert.equal(table.lines.at(-1)?.when, '42 мин')
  const none = programTable(
    { program: { days: [], startHour: 6, startMin: 0 } },
    { programMin: 12, clockMin: 12, stations: [] },
  )
  assert.equal(none?.lines[0].name, 'ни одного дня')
})

test('runtime label names the cycles', () => {
  assert.equal(runtimeLabel(12, 1), '12 мин')
  assert.equal(runtimeLabel(12, 2), '12 мин · 2 цикла')
  assert.equal(runtimeLabel(12, 5), '12 мин · 5 циклов')
  assert.equal(runtimeLabel(null, 2), null)
})

test('a program reloads and a bad hour rejects the document', () => {
  const saved = parseDoc({ ...emptyDoc(), program: { days: [0, 2, 4], startHour: 6, startMin: 0 } })
  assert.deepEqual(saved?.program, { days: [0, 2, 4], startHour: 6, startMin: 0 })
  assert.equal(parseDoc(emptyDoc())?.program, undefined)
  assert.equal(parseDoc({ ...emptyDoc(), program: { days: [0], startHour: 25, startMin: 0 } }), null)
  assert.equal(parseDoc({ ...emptyDoc(), program: { days: [8], startHour: 6, startMin: 0 } }), null)
})
