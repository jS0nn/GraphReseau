import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeGraph, reprojectNodesFromGPS } from '../src/state/normalize.js'
import { enforceEdgeOnlyNodeType } from '../src/state/graph-rules.js'

test('normalizeGraph canonicalises types, filters legacy pipes, dedupes edges', () => {
  const input = {
    nodes: [
      { id: 'c1', type: 'COLLECTEUR', gps_lat: 45, gps_lon: 3 },
      { id: 'w1', type: 'puits', x: '100', y: '200' },
      { id: 'g1', type: 'general', gps_lat: 45.1, gps_lon: 3.1 },
    ],
    edges: [
      { id: 'E-1', source: 'w1', target: 'g1', active: true },
      { id: 'E-1', source: 'w1', target: 'g1', active: true },
      { id: 'E-1', source: 'g1', target: 'w1', active: true },
    ],
  }

  const result = normalizeGraph(input, { gridStep: 4 })

  // The legacy canal node is filtered out but other nodes remain and are canonicalised
  assert.equal(result.nodes.length, 2)
  const types = result.nodes.map(n => n.type).sort()
  assert.deepEqual(types, ['GENERAL', 'OUVRAGE'])
  assert.ok(result.nodes.every(n => typeof n.gps_locked === 'boolean'))

  // Duplicate edges with same id/from/to collapse; divergent duplicate gets a fresh id
  assert.equal(result.edges.length, 2)
  assert.equal(result.edges.filter(e => e.id === 'E-1').length, 1)
  const altEdge = result.edges.find(e => e.id !== 'E-1')
  assert.ok(altEdge, 'edge with regenerated id is kept')
  assert.equal(altEdge.from_id, 'g1')
  assert.equal(altEdge.to_id, 'w1')

  assert.ok(result.geoCenter, 'geo center computed from GPS data')
  assert.equal(result.geoCenter.centerLat, 45)
  assert.equal(result.geoCenter.centerLon, 3)
})

test('reprojectNodesFromGPS fills missing coordinates when GPS locked', () => {
  const nodes = [
    { id: 'n1', type: 'OUVRAGE', gps_lat: 45, gps_lon: 3, gps_locked: true, x: null, y: null },
  ]

  const { changed, geoCenter } = reprojectNodesFromGPS(nodes, { gridStep: 8, force: true })
  assert.equal(changed, true)
  assert.ok(Number.isFinite(nodes[0].x))
  assert.ok(Number.isFinite(nodes[0].y))
  assert.ok(geoCenter)
})

test('enforceEdgeOnlyNodeType maps legacy pipelines to ouvrage', () => {
  assert.equal(enforceEdgeOnlyNodeType('CANALISATION'), 'OUVRAGE')
  assert.equal(enforceEdgeOnlyNodeType('collecteur'), 'OUVRAGE')
  assert.equal(enforceEdgeOnlyNodeType('GENERAL'), 'GENERAL')
})
