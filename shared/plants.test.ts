import assert from 'node:assert/strict'
import test from 'node:test'
import { BUSH_FORMS, TREE_FORMS, formOf, plantGlyph } from './plants.ts'

test('every crown is a closed drawing and the fallback matches the kind', () => {
  const forms = [...TREE_FORMS, ...BUSH_FORMS]
  assert.equal(new Set(forms.map((item) => item.id)).size, forms.length)
  for (const item of forms) {
    const glyph = plantGlyph(item.id)
    assert.ok(glyph.fills.length >= 1, item.id)
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
})
