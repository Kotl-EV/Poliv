import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDoc, parseDoc } from './doc.ts'
import { hatchOf } from './landscape.ts'
import type { Zone } from './types.ts'

test('grid snap is off by default and only on when the user turns it on', () => {
  assert.equal(emptyDoc().snapGrid, false)
  assert.equal(parseDoc(emptyDoc())?.snapGrid, false)
  const { snapGrid: _ignored, ...without } = emptyDoc()
  assert.equal(parseDoc(without)?.snapGrid, false)
  assert.equal(parseDoc({ ...emptyDoc(), snapGrid: true })?.snapGrid, true)
  assert.equal(parseDoc({ ...emptyDoc(), snapGrid: false })?.snapGrid, false)
})

test('a zone hole is kept and a broken hole rejects the document', () => {
  const zone: Zone = {
    id: 'z',
    name: 'Газон',
    kind: 'lawn',
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    holes: [[{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 4 }]],
    doseMm: 6,
    soil: 'loam',
    slope: 'flat',
    climate: 'open',
  }
  const parsed = parseDoc({ ...emptyDoc(), zones: [zone] })
  assert.equal(parsed?.zones[0].holes?.length, 1)
  assert.equal(parseDoc({ ...emptyDoc(), zones: [{ ...zone, holes: [[{ x: 1, y: 1 }]] }] }), null)
})

test('notes and plants survive a reload and a blank text is rejected', () => {
  const saved = parseDoc({
    ...emptyDoc(),
    notes: [{ id: 'n', x: 1, y: 2, text: 'Кран', sizeM: 0.4 }],
    plants: [{ id: 'p', kind: 'tree', x: 3, y: 4, radiusM: 1.5 }],
  })
  assert.equal(saved?.notes?.[0].text, 'Кран')
  assert.equal(saved?.plants?.[0].kind, 'tree')
  assert.equal(parseDoc({ ...emptyDoc(), notes: [{ id: 'n', x: 1, y: 2, text: '   ', sizeM: 0.4 }] }), null)
  assert.equal(parseDoc(emptyDoc())?.plants?.length, 0)
})

test('a hatch stays on its surface and a foreign one is dropped', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
  const path = parseDoc({
    ...emptyDoc(),
    zones: [{ id: 'z', name: 'Дорожка', kind: 'path', points, doseMm: 0, hatch: 'path-brick' }],
  })
  assert.equal(path?.zones[0].hatch, 'path-brick')
  assert.equal(path && hatchOf(path.zones[0]), 'path-brick')
  const lawn = parseDoc({
    ...emptyDoc(),
    zones: [{ id: 'z', name: 'Газон', kind: 'lawn', points, doseMm: 6, hatch: 'path-brick' }],
  })
  assert.equal(lawn?.zones[0].hatch, undefined)
  assert.equal(lawn && hatchOf(lawn.zones[0]), 'lawn')
  assert.equal(parseDoc({
    ...emptyDoc(),
    zones: [{ id: 'z', name: 'Газон', kind: 'lawn', points, doseMm: 6, hatch: 3 }],
  }), null)
})

test('measures round-trip and vertex snap defaults on', () => {
  assert.equal(emptyDoc().measures?.length, 0)
  assert.equal(emptyDoc().snapVertex, true)
  const saved = parseDoc({
    ...emptyDoc(),
    snapVertex: false,
    measures: [{ id: 'm', a: { x: 0, y: 0 }, b: { x: 20, y: 0 } }],
  })
  assert.equal(saved?.snapVertex, false)
  assert.equal(saved?.measures?.[0].b.x, 20)
  assert.equal(parseDoc({ ...emptyDoc(), snapVertex: 'yes' }), null)
  assert.equal(parseDoc({ ...emptyDoc(), measures: [{ id: 'm', a: { x: 0, y: 0 } }] }), null)
  const legacy = emptyDoc()
  delete legacy.snapVertex
  assert.equal(parseDoc(legacy)?.snapVertex, true)
})

test('stroke, opacity, note colour, anchor and ortho survive a reload', () => {
  const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
  const saved = parseDoc({
    ...emptyDoc(),
    ortho: true,
    anchor: { x: 4, y: 5 },
    zones: [{
      id: 'z',
      name: 'Газон',
      kind: 'lawn',
      points,
      doseMm: 6,
      stroke: '#8D2B1F',
      opacity: 0.4,
      pen: 3,
    }],
    notes: [{ id: 'n', x: 1, y: 2, text: 'Кран', sizeM: 0.4, color: '#2A6288', bold: true }],
  })
  assert.equal(saved?.ortho, true)
  assert.equal(saved?.anchor?.x, 4)
  assert.equal(saved?.zones[0].stroke, '#8d2b1f')
  assert.equal(saved?.zones[0].opacity, 0.4)
  assert.equal(saved?.zones[0].pen, 3)
  assert.equal(saved?.notes?.[0].color, '#2a6288')
  assert.equal(saved?.notes?.[0].bold, true)
  assert.equal(emptyDoc().ortho, false)
  const plain = parseDoc({
    ...emptyDoc(),
    zones: [{ id: 'z', name: 'Газон', kind: 'lawn', points, doseMm: 6, stroke: 'red' }],
  })
  assert.equal(plain?.zones[0].stroke, undefined)
  assert.equal(parseDoc({ ...emptyDoc(), ortho: 'yes' }), null)
  assert.equal(parseDoc({ ...emptyDoc(), anchor: { x: 1 } }), null)
  assert.equal(parseDoc({
    ...emptyDoc(),
    zones: [{ id: 'z', name: 'Газон', kind: 'lawn', points, doseMm: 6, opacity: 2 }],
  }), null)
  assert.equal(parseDoc({ ...emptyDoc(), notes: [{ id: 'n', x: 1, y: 2, text: 'Кран', sizeM: 0.4, bold: 'yes' }] }), null)
})
