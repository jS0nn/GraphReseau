import { d3 } from './vendor.js'
import { setGraph, state } from './state/index.js'
import { autoLayout } from './layout.js'
import { renderNodes } from './render/render-nodes.js'

function parseSearch(){
  const p = new URLSearchParams(location.search)
  return { sheet_id: p.get('sheet_id'), site_id: p.get('site_id') }
}

async function fetchGraph(sheetId){
  const q = parseSearch()
  const params = new URLSearchParams()
  if (sheetId || q.sheet_id) params.set('sheet_id', sheetId || q.sheet_id)
  if (q.site_id) params.set('site_id', q.site_id)
  const url = params.toString() ? `/api/graph?${params.toString()}` : '/api/graph'
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to load graph')
  return await res.json()
}

async function init(){
  const el = document.getElementById('app')
  const sid = el?.dataset?.sheetId || ''
  const g = await fetchGraph(sid)
  setGraph(g)
  await autoLayout(state.nodes, state.edges)
  // Render nodes as simple absolutely-positioned divs
  const root = d3.select('#app')
  renderNodes(root, state.nodes)
}

init().catch(err => {
  console.error(err)
  const el = document.getElementById('app')
  if (el) el.textContent = 'Erreur de chargement: ' + err.message
})
