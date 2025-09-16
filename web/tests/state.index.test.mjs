import test from 'node:test'
import assert from 'node:assert/strict'

import { state, setGraph, getGraph, clearSelection, addNode } from '../src/state/index.js'

function resetState(){
  state.nodes.length = 0
  state.edges.length = 0
  state.selection.nodeId = null
  state.selection.edgeId = null
  state.selection.multi = new Set()
  state.clipboard = null
  state.mode = 'select'
  state._spawnIndex = 0
}

test('setGraph normalises incoming data and clears selection', () => {
  resetState()
  state.selection.nodeId = 'legacy'
  state.selection.multi = new Set(['legacy'])

  setGraph({
    nodes: [
      { id: 'c1', type: 'CANALISATION', gps_lat: 45, gps_lon: 3 },
      { id: 'n1', type: 'puits', x: '10', y: '20' },
    ],
    edges: [ { id: 'e1', source: 'c1', target: 'n1' } ],
  })

  const graph = getGraph()
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.nodes[0].type, 'OUVRAGE')
  assert.equal(state.selection.nodeId, null)
  assert.equal(state.selection.multi.size, 0)
})

test('addNode uses edge-only type enforcement', () => {
  resetState()
  const node = addNode({ type: 'CANALISATION' })
  assert.equal(node.type, 'OUVRAGE')
  assert.ok(state.nodes.find(n => n.id === node.id))
  clearSelection()
})
