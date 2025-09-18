import { state, selectNodeById, selectEdgeById, getMode, removeNode, removeEdge, toggleMultiSelection } from '../state/index.js'
import { edgeGeometryToUIPoints, nearestPointOnPolyline } from '../shared/geometry.js'

const EDGE_FALLBACK_TOLERANCE = 28
let edgeFallbackWired = false

function handleEdgeSelection(event, datum){
  if(!datum || !datum.id) return false
  if(event){ event.stopPropagation() }
  const mode = getMode()
  if(mode === 'delete'){
    const ok = confirm('Supprimer cette arête ?')
    if(ok){
      removeEdge(datum.id)
      selectEdgeById(null)
      selectNodeById(null)
    }
    return true
  }
  selectEdgeById(datum.id)
  return true
}

function eventToCanvasPoint(ev){
  const svg = document.getElementById('svg')
  if(!svg) return null
  let x, y
  try{
    if(window.__leaflet_map){
      const pt = window.__leaflet_map.mouseEventToContainerPoint(ev)
      x = pt.x; y = pt.y
    }
  }catch{}
  if(x == null || y == null){
    const rect = svg.getBoundingClientRect()
    const px = ev.clientX - rect.left
    const py = ev.clientY - rect.top
    try{
      const t = window.d3?.zoomTransform?.(svg)
      if(t && typeof t.invert === 'function'){
        const p = t.invert([px, py])
        x = p[0]; y = p[1]
      } else {
        x = px; y = py
      }
    }catch{
      x = px; y = py
    }
  }
  return { x, y }
}

function findNearestEdgeAt(x, y, tol = EDGE_FALLBACK_TOLERANCE){
  const edges = state?.edges || []
  const nodes = state?.nodes || []
  const tol2 = tol * tol
  let best = null
  for(const edge of edges){
    if(!edge?.id) continue
    const pts = edgeGeometryToUIPoints(edge, nodes)
    if(pts.length < 2) continue
    const hit = nearestPointOnPolyline(pts, x, y)
    if(!hit || !Number.isFinite(hit.d2) || hit.d2 > tol2) continue
    if(!best || hit.d2 < best.hit.d2){
      best = { edge, hit }
    }
  }
  return best
}

function wireEdgeFallback(){
  if(edgeFallbackWired) return
  const svg = document.getElementById('svg')
  if(!svg) return
  const handler = (ev)=>{
    if(ev.defaultPrevented) return
    const mode = getMode()
    if(mode !== 'select' && mode !== 'edit' && mode !== 'delete') return
    if(ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return
    const nodeEl = ev.target?.closest && ev.target.closest('g.node')
    if(nodeEl){
      const cls = nodeEl.classList || { contains: ()=>false }
      const looksLikeJunction = cls.contains('JONCTION') || cls.contains('junction')
      if(!looksLikeJunction) return
    }
    if(ev.target?.closest && ev.target.closest('g.edge')) return
    const pt = eventToCanvasPoint(ev)
    if(!pt) return
    const found = findNearestEdgeAt(pt.x, pt.y)
    if(!found) return
    const handled = handleEdgeSelection(ev, { id: found.edge.id })
    if(handled){
      try{ window.__squelchCanvasClick = true }catch{}
      ev.preventDefault()
    }
  }
  svg.addEventListener('click', handler, true)
  edgeFallbackWired = true
}

export function attachSelection(gNodes, gEdges){
  gNodes.selectAll('g.node')
    .on('click', (e, d) => {
      e.stopPropagation()
      const mode = getMode()
      if(String(d?.type||'').toUpperCase()==='JONCTION') return // ignore pure junctions
      if(mode==='delete'){
        if(confirm(`Supprimer le nœud ${(d.name||d.id)} et ses liens ?`)){
          removeNode(d.id); selectNodeById(null); selectEdgeById(null)
        }
        return
      }
      if(mode==='connect'){ return }
      if(e.shiftKey){ toggleMultiSelection(d.id); return }
      selectNodeById(d.id)
    })
  gEdges.selectAll('g.edge')
    .on('click', (e, d) => {
      handleEdgeSelection(e, d)
    })
  wireEdgeFallback()
}
