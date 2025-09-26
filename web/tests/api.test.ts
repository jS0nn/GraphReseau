import test from 'node:test'
import assert from 'node:assert/strict'

import { getMode, getGraph, recomputeBranches, __internals } from '../src/api.ts'
import type { Graph } from '../src/types/graph'

const originalFetch = globalThis.fetch
const originalLocation = globalThis.location

function restoreGlobals(){
  if(originalFetch){
    globalThis.fetch = originalFetch
  }else{
    // @ts-ignore
    delete globalThis.fetch
  }
  if(typeof originalLocation !== 'undefined'){
    // @ts-ignore
    globalThis.location = originalLocation
  }else{
    // @ts-ignore
    delete globalThis.location
  }
}

function setLocationSearch(search: string){
  // @ts-ignore
  globalThis.location = { search }
}

test('buildParamsForSource handles sheet source', () => {
  const params = __internals.buildParamsForSource({ source: 'sheet', sheet_id: 'abc' })
  assert.equal(params.toString(), 'source=sheet&sheet_id=abc')
})

test('getMode reads query parameter or defaults', () => {
  setLocationSearch('?mode=rw')
  assert.equal(getMode(), 'rw')

  setLocationSearch('')
  assert.equal(getMode(), 'ro')
  restoreGlobals()
})

test('getGraph coerces blank numeric fields to null', async () => {
  setLocationSearch('?sheet_id=S1')
  globalThis.fetch = async (url: RequestInfo | URL) => {
    assert.equal(String(url), '/api/graph?sheet_id=S1')
    const response = {
      ok: true,
      async json(){
        return {
          nodes: [
            { id: 'n1', diameter_mm: '', gps_lat: '', pm_pos_index: '', extras: {} },
          ],
          edges: [],
        } as unknown as Graph
      },
      async text(){ return '' },
    }
    return response as unknown as Response
  }

  const graph = await getGraph()
  assert.equal(graph.nodes[0]?.diameter_mm, null)
  assert.equal(graph.nodes[0]?.gps_lat, null)
  assert.equal(graph.nodes[0]?.pm_pos_index, null)
  restoreGlobals()
})

test('recomputeBranches skips network outside browser context', async () => {
  const originalWindow = globalThis.window
  // @ts-ignore set window undefined to simulate Node runtime
  delete globalThis.window

  let called = false
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => {
    called = true
    return Response.json({ ok: true })
  }

  const result = await recomputeBranches({ nodes: [], edges: [] })
  assert.deepEqual(result, { ok: true })
  assert.equal(called, false)

  if(previousFetch){
    globalThis.fetch = previousFetch
  }else{
    // @ts-ignore
    delete globalThis.fetch
  }
  if(originalWindow){
    globalThis.window = originalWindow
  }
})
