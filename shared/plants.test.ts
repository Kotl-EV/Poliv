import assert from 'node:assert/strict'
import test from 'node:test'
import { BUSH_FORMS, TREE_FORMS, formOf, plantGlyph, plantPaint } from './plants.ts'

test('every crown is a closed drawing and the fallback matches the kind', () => {
  const forms = [...TREE_FORMS, ...BUSH_FORMS]
  assert.equal(new Set(forms.map((item) => item.id)).size, forms.length)
  for (const item of forms) {
    const glyph = plantGlyph(item.id)
    assert.ok(glyph.fills.length >= 2, item.id)
    if (glyph.shade) assert.equal(glyph.shade.length, glyph.fills.length, item.id)
    for (const path of glyph.fills) {
      assert.ok(path.startsWith('M'), item.id)
      assert.ok(path.endsWith('Z'), item.id)
    }
  }
  assert.ok(plantGlyph('palm').fills.length >= 8)
  assert.ok(plantGlyph('conifer').fills[0].includes(' L '))
  assert.equal(formOf({ kind: 'tree' }), 'leaf')
  assert.equal(formOf({ kind: 'bush', form: 'palm' }), 'ball')
  assert.equal(formOf({ kind: 'tree', form: 'conifer' }), 'conifer')
  assert.equal(new Set(forms.map((item) => plantGlyph(item.id).fills[0])).size, forms.length)
  assert.equal(formOf({ kind: 'tree', form: 'oak' }), 'oak')
  assert.equal(formOf({ kind: 'bush', form: 'hedge' }), 'hedge')
  for (const item of BUSH_FORMS) {
    const glyph = plantGlyph(item.id)
    assert.ok(glyph.fills.length >= 4, item.id)
    assert.ok(glyph.veins.length + glyph.dots.length >= 3, item.id)
    const inked = glyph.inked ?? glyph.fills.length
    assert.ok(inked >= 1 && inked <= glyph.fills.length, item.id)
    for (const path of [...glyph.fills, ...glyph.veins]) {
      for (const value of path.match(/-?\d+(?:\.\d+)?/g) ?? []) {
        const n = Number(value)
        assert.ok(n >= -1.25 && n <= 1.25, `${item.id} ${n}`)
      }
    }
  }
  assert.equal(plantGlyph('leaf').inked, 1)
  assert.equal(plantPaint('conifer').leaf, '#1e4a34')
  assert.ok(plantGlyph('spread').fills.length >= 6)
  assert.ok(plantGlyph('fruit').dots.some((dot) => dot.bloom))
  assert.ok(plantGlyph('fern').fills[0].includes(' L '))
  assert.ok(plantGlyph('rose').dots.some((dot) => dot.bloom && dot.r >= 0.12))
})
