import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyDoc, parseDoc } from './doc.ts'

test('grid snap is off by default and only on when the user turns it on', () => {
  assert.equal(emptyDoc().snapGrid, false)
  assert.equal(parseDoc(emptyDoc())?.snapGrid, false)
  const { snapGrid: _ignored, ...without } = emptyDoc()
  assert.equal(parseDoc(without)?.snapGrid, false)
  assert.equal(parseDoc({ ...emptyDoc(), snapGrid: true })?.snapGrid, true)
  assert.equal(parseDoc({ ...emptyDoc(), snapGrid: false })?.snapGrid, false)
})
