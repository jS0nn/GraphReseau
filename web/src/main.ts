import { d3 } from './vendor.ts'
import { setGraph, state } from './state/index.ts'
import { autoLayout } from './layout.ts'
import { renderNodes } from './render/render-nodes.ts'
import type { Graph } from './types/graph'
import type { MutableNode, MutableEdge } from './state/normalize.ts'

type SearchParams = {
  sheet_id: string | null
  site_id: string | null
}

const parseSearch = (): SearchParams => {
  const params = new URLSearchParams(window.location.search)
  return {
    sheet_id: params.get('sheet_id'),
    site_id: params.get('site_id'),
  }
}

const fetchGraph = async (sheetId?: string | null): Promise<Graph> => {
  const query = parseSearch()
  const params = new URLSearchParams()
  const finalSheetId = sheetId ?? query.sheet_id ?? undefined
  if(finalSheetId) params.set('sheet_id', finalSheetId)
  if(query.site_id) params.set('site_id', query.site_id)
  const url = params.toString() ? `/api/graph?${params.toString()}` : '/api/graph'
  const res = await fetch(url)
  if(!res.ok) throw new Error(`Failed to load graph (${res.status})`)
  return await res.json() as Graph
}

const init = async (): Promise<void> => {
  const el = document.getElementById('app')
  const sheetId = el?.dataset?.sheetId ?? undefined
  const graph = await fetchGraph(sheetId)
  setGraph(graph)
  await autoLayout(state.nodes as MutableNode[], state.edges as MutableEdge[])
  const root = d3.select('#app')
  renderNodes(root, state.nodes as MutableNode[])
}

init().catch((err: unknown) => {
  console.error(err)
  const el = document.getElementById('app')
  if(el){
    const message = err instanceof Error ? err.message : 'Erreur inconnue'
    el.textContent = `Erreur de chargement: ${message}`
  }
})
