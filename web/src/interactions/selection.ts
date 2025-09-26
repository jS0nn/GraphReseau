import type { Selection, BaseType } from 'd3-selection'
import { d3 } from '../vendor.ts'
import { state, selectNodeById, selectEdgeById, getMode, removeNode, removeEdge, toggleMultiSelection, addEdge, subscribe, updateEdge } from '../state/index.ts'
import { ensureEdgeGeometry, edgeGeometryToUIPoints, nearestPointOnPolyline } from '../shared/geometry.ts'
import type { MutableEdge, MutableNode } from '../state/normalize.ts'

const EDGE_FALLBACK_TOLERANCE = 28
let edgeFallbackWired = false
let pendingConnect: string | null = null

subscribe((evt, payload) => {
  if(evt === 'mode:set' && payload !== 'connect'){
    pendingConnect = null
  }
})

function handleEdgeSelection(event: MouseEvent | null, datum: MutableEdge | { id?: string | null } | null | undefined): boolean {
  if(!datum || !datum.id) return false
  event?.stopPropagation()
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

function eventToCanvasPoint(ev: MouseEvent): { x: number; y: number } | null {
  const svg = document.getElementById('svg')
  if(!svg) return null
  let x: number | undefined
  let y: number | undefined
  try{
    const map = typeof window !== 'undefined' ? window.__leaflet_map : undefined
    if(map && typeof map.mouseEventToContainerPoint === 'function'){
      const pt = map.mouseEventToContainerPoint(ev)
      x = pt.x; y = pt.y
    }
  }catch{}
  if(x == null || y == null){
    const rect = svg.getBoundingClientRect()
    const px = ev.clientX - rect.left
    const py = ev.clientY - rect.top
    try{
      const transform = d3.zoomTransform(svg)
      if(transform && typeof transform.invert === 'function'){
        const p = transform.invert([px, py])
        x = p[0]; y = p[1]
      }else{
        x = px; y = py
      }
    }catch{
      x = px; y = py
    }
  }
  return { x: x ?? 0, y: y ?? 0 }
}

function findNearestEdgeAt(x: number, y: number, tol = EDGE_FALLBACK_TOLERANCE): { edge: MutableEdge; hit: { d2: number } } | null {
  const edges = state?.edges || []
  const nodes = state?.nodes || []
  const tol2 = tol * tol
  let best: { edge: MutableEdge; hit: { d2: number } } | null = null
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

function wireEdgeFallback(): void {
  if(edgeFallbackWired) return
  const svg = document.getElementById('svg')
  if(!svg) return
  const handler = (ev: MouseEvent) => {
    if(ev.defaultPrevented) return
    const mode = getMode()
    if(mode !== 'select' && mode !== 'edit' && mode !== 'delete') return
    if(ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return
    const nodeEl = (ev.target as Element | null)?.closest?.('g.node') as Element | null
    if(nodeEl){
      const cls = nodeEl.classList || { contains: () => false }
      const looksLikeJunction = cls.contains('JONCTION') || cls.contains('junction')
      if(!looksLikeJunction) return
    }
    if((ev.target as Element | null)?.closest?.('g.edge')) return
    const pt = eventToCanvasPoint(ev)
    if(!pt) return
    const found = findNearestEdgeAt(pt.x, pt.y)
    if(!found) return
    const handled = handleEdgeSelection(ev, found.edge)
    if(handled){
      if(typeof window !== 'undefined'){
        window.__squelchCanvasClick = true
      }
      ev.preventDefault()
    }
  }
  svg.addEventListener('click', handler, true)
  edgeFallbackWired = true
}

type NodeGroupSelection = Selection<SVGGElement, unknown, BaseType, unknown>
type EdgeGroupSelection = Selection<SVGGElement, unknown, BaseType, unknown>

export function attachSelection(gNodes: NodeGroupSelection, gEdges: EdgeGroupSelection): void {
  gNodes.selectAll('g.node')
    .on('click', (e: MouseEvent, datum) => {
      const d = datum as MutableNode
      e.stopPropagation()
      const mode = getMode()
      if(String(d?.type||'').toUpperCase()==='JONCTION') return
      if(mode === 'connect'){
        if(!d?.id) return
        if(pendingConnect === d.id){
          pendingConnect = null
          selectNodeById(null)
          return
        }
        if(pendingConnect == null){
          pendingConnect = d.id
          selectNodeById(d.id)
          return
        }
        const avalId = pendingConnect
        const amontId = d.id
        pendingConnect = null
        selectNodeById(null)
        if(avalId === amontId) return
        const edge = addEdge(amontId, avalId, { active: true })
      if(edge?.id){
        const created = state.edges.find(e => e.id === edge.id)
        if(created){
          const geom = ensureEdgeGeometry(created, state.nodes)
          if(geom){ updateEdge(edge.id, { geometry: geom }) }
          }
          selectEdgeById(edge.id)
        }
        return
      }
      if(mode==='delete'){
        if(confirm(`Supprimer le nœud ${(d.name||d.id)} et ses liens ?`)){
          removeNode(d.id); selectNodeById(null); selectEdgeById(null)
        }
        return
      }
      if(e.shiftKey){ toggleMultiSelection(d.id); return }
      selectNodeById(d.id)
    })
  gEdges.selectAll('g.edge')
    .on('click', (e: MouseEvent, datum) => {
      handleEdgeSelection(e, datum as MutableEdge)
    })
  wireEdgeFallback()
}
