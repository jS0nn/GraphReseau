import test from 'node:test'
import assert from 'node:assert/strict'

import { state, addNode } from '../src/state/index.ts'

function resetState(){
  state.nodes.length = 0
  state.edges.length = 0
  state.selection.nodeId = null
  state.selection.edgeId = null
  state.selection.multi = new Set()
}

test('addNode forces canal types to ouvrage', () => {
  resetState()
  const node = addNode({ type: 'CANALISATION' })
  assert.equal(node.type, 'OUVRAGE')
  assert.equal(state.nodes.length, 1)
  assert.equal(state.nodes[0].type, 'OUVRAGE')
})

test('addNode converts legacy COLLECTEUR type to ouvrage', () => {
  resetState()
  const node = addNode({ type: 'COLLECTEUR' })
  assert.equal(node.type, 'OUVRAGE')
})
