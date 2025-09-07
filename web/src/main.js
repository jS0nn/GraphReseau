import './shim.js'
import { d3 } from './vendor.js'
import { setGraph, state } from './state.js'
import { autoLayout } from './layout.js'
import { renderNodes } from './render/render-nodes.js'

async function fetchGraph(sheetId){
  const url = sheetId ? `/api/graph?sheet_id=${encodeURIComponent(sheetId)}` : '/api/graph'
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

