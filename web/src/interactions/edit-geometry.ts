import { state, updateEdge, subscribe, getMode, selectEdgeById } from '../state/index.ts'
import { unprojectUIToLatLon } from '../geo.ts'
import { edgeGeometryToUIPoints, nearestPointOnPolyline, ensureEdgeGeometry } from '../shared/geometry.ts'
import type { MutableNode, MutableEdge } from '../state/normalize.ts'
import type { UIPoint, GeometryPoint } from '../shared/geometry'

const win = window as typeof window & {
  __leaflet_map?: {
    mouseEventToContainerPoint?: (ev: MouseEvent) => { x: number; y: number }
    containerPointToLatLng?: (pt: [number, number]) => { lat: number; lng: number }
  }
  d3?: typeof import('d3')
}

type SegmentHit = { i: number; t: number; d2: number; px: number; py: number }

type SelectedVertex = { edgeId: string | null; index: number }

let currentEdgeId: string | null = null
let selVertex: SelectedVertex = { edgeId: null, index: -1 }
let isDraggingVertex = false
let wired = false
const INSERT_TOLERANCE = 32
let suppressNextContextMenu = false

function nearestVertex(pts: UIPoint[], x: number, y: number, tol = 12): number {
  let best = { idx: -1, d2: Infinity }
  for(let i = 0; i < pts.length; i += 1){
    const dx = pts[i][0] - x
    const dy = pts[i][1] - y
    const d2 = dx * dx + dy * dy
    if(d2 < best.d2){ best = { idx: i, d2 } }
  }
  return (best.d2 <= tol * tol) ? best.idx : -1
}

function nearestSegment(pts: UIPoint[], x: number, y: number): SegmentHit {
  const hit = nearestPointOnPolyline(pts, x, y)
  if(!hit) return { i: -1, t: 0, d2: Infinity, px: 0, py: 0 }
  return { i: hit.seg, t: hit.t, d2: hit.d2, px: hit.px, py: hit.py }
}

function findNearestEdgeHit(x: number, y: number, tol = 28): { edge: MutableEdge; hit: SegmentHit } | null {
  let best: { edge: MutableEdge; hit: SegmentHit } | null = null
  for(const e of state.edges as MutableEdge[]){
    const pts = edgeGeometryToUIPoints(e, state.nodes as MutableNode[])
    if(pts.length < 2) continue
    const hit = nearestSegment(pts, x, y)
    if(hit && hit.d2 < tol * tol){
      if(!best || hit.d2 < best.hit.d2) best = { edge: e, hit }
    }
  }
  return best
}

function getOverlay(): SVGGElement | null {
  return document.getElementById('svg')?.querySelector('g.overlay') || null
}

function clearHandles(): void {
  try{
    getOverlay()?.querySelectorAll('g.geom-handles, path.geom-preview')?.forEach(n => n.remove())
  }catch{}
}

function getUIPositionFromEvent(ev: MouseEvent, svg: SVGSVGElement): { x: number; y: number } {
  let x: number | undefined
  let y: number | undefined
  try{
    if(win.__leaflet_map?.mouseEventToContainerPoint){
      const pt = win.__leaflet_map.mouseEventToContainerPoint(ev)
      x = pt.x
      y = pt.y
    }
  }catch{}
  if(x == null || y == null){
    const rect = svg.getBoundingClientRect()
    const px = ev.clientX - rect.left
    const py = ev.clientY - rect.top
    try{
      const t = win.d3?.zoomTransform?.(svg)
      if(t && typeof t.invert === 'function'){
        const p = t.invert([px, py]) as [number, number]
        x = p[0]
        y = p[1]
      }else{
        x = px
        y = py
      }
    }catch{
      x = px
      y = py
    }
  }
  return { x: x ?? 0, y: y ?? 0 }
}

function insertVertexAtPosition(x: number, y: number, preferEdgeId: string | null | undefined): boolean {
  let edge: MutableEdge | null = null
  let seg: SegmentHit | null = null
  const preferIds: (string | null | undefined)[] = []
  if(preferEdgeId) preferIds.push(preferEdgeId)
  if(currentEdgeId && !preferIds.includes(currentEdgeId)) preferIds.push(currentEdgeId)
  for(const edgeId of preferIds){
    const candidate = edgeId ? (state.edges as MutableEdge[]).find(xx=>xx.id===edgeId) : null
    if(!candidate) continue
    const pts = edgeGeometryToUIPoints(candidate, state.nodes as MutableNode[])
    if(pts.length < 2) continue
    const hit = nearestSegment(pts, x, y)
    if(!hit || !Number.isFinite(hit.d2) || hit.d2 > (INSERT_TOLERANCE*INSERT_TOLERANCE)) continue
    edge = candidate
    seg = hit
    break
  }
  if(!edge){
    const found = findNearestEdgeHit(x, y, INSERT_TOLERANCE)
    if(found){ edge = found.edge; seg = found.hit }
  }
  if(!edge || !seg) return false
  currentEdgeId = edge.id
  selectEdgeById(edge.id)
  let edgeRef = (state.edges as MutableEdge[]).find(x=>x.id===edge.id)
  if(!Array.isArray(edgeRef?.geometry) || edgeRef.geometry.length<2){
    const fallbackGeom = ensureEdgeGeometry(edgeRef, state.nodes as MutableNode[])
    if(fallbackGeom) updateEdge(edge.id, { geometry: fallbackGeom })
    edgeRef = (state.edges as MutableEdge[]).find(x=>x.id===edge.id)
  }
  const pts = edgeGeometryToUIPoints(edgeRef, state.nodes as MutableNode[])
  if(pts.length < 2) return false
  if(!seg || !Number.isFinite(seg?.i)){ seg = nearestSegment(pts, x, y) }
  const insertPoint: [number, number] = [ Number.isFinite(seg?.px) ? (seg?.px ?? x) : x, Number.isFinite(seg?.py) ? (seg?.py ?? y) : y ]
  const ll = unprojectUIToLatLon(insertPoint[0], insertPoint[1])
  const geo = ((edgeRef?.geometry ?? []) as Array<[number, number]>).slice()
  if(geo.length < 2) return false
  const insertIndex = Number.isFinite(seg?.i) ? (seg?.i ?? 1) : 1
  geo.splice(insertIndex, 0, [ll.lon, ll.lat])
  updateEdge(edge.id, { geometry: geo as Array<[number, number]> })
  renderHandles(state.edges.find(x=>x.id===edge.id))
  return true
}

function attemptInsertFromEvent(ev: MouseEvent, svg: SVGSVGElement | null, preferEdgeId?: string | null): boolean {
  if(getMode()!=='edit' || !svg) return false
  const { x, y } = getUIPositionFromEvent(ev, svg)
  const target = ev.target instanceof Element ? ev.target : null
  const targetEdgeId = preferEdgeId ?? target?.closest('g.edge')?.getAttribute('data-id')
  const inserted = insertVertexAtPosition(x, y, targetEdgeId)
  if(inserted){
    ev.preventDefault?.()
    ev.stopPropagation?.()
  }
  return inserted
}

function renderHandles(edge: MutableEdge | undefined | null): void {
  clearHandles()
  if(!edge) return
  const overlay = getOverlay()
  if(!overlay) return
  const pts = edgeGeometryToUIPoints(edge, state.nodes as MutableNode[])
  if(pts.length<2) return
  const svgns = 'http://www.w3.org/2000/svg'
  const g = document.createElementNS(svgns,'g'); g.setAttribute('class','geom-handles'); overlay.appendChild(g)
  // handles
  pts.forEach((p,idx)=>{
    const c = document.createElementNS(svgns,'circle')
    c.setAttribute('cx', String(p[0])); c.setAttribute('cy', String(p[1])); c.setAttribute('r','5')
    c.setAttribute('fill', idx===selVertex.index?'#ffcc66':'#e7f0ff')
    c.setAttribute('stroke','#245ef5'); c.setAttribute('stroke-width','1.5')
    c.style.cursor='grab'
    c.addEventListener('mousedown', (e: MouseEvent)=>{
      if(getMode()!=='edit') return
      selVertex = { edgeId: edge.id, index: idx }
      c.style.cursor='grabbing'
      e.preventDefault(); e.stopPropagation()
      isDraggingVertex = true
      const move = (ev: MouseEvent)=>{
        let x: number | undefined
        let y: number | undefined
        try{
          if(window.__leaflet_map){ const pt = window.__leaflet_map.mouseEventToContainerPoint?.(ev); if(pt){ x=pt.x; y=pt.y } }
        }catch{}
        if(x==null||y==null){
          const svgEl = document.getElementById('svg')
          const svg = svgEl instanceof SVGSVGElement ? svgEl : null
          const r = svg?.getBoundingClientRect()
          const px = r ? ev.clientX - r.left : ev.clientX
          const py = r ? ev.clientY - r.top : ev.clientY
          try{
            const t = svg ? window.d3?.zoomTransform?.(svg) : null
            if(t && typeof t.invert==='function'){
              const p = t.invert([px,py]) as [number, number]
              x=p[0]
              y=p[1]
            } else {
              x=px
              y=py
            }
          }
          catch{ x=px; y=py }
        }
        c.setAttribute('cx', String(x ?? 0)); c.setAttribute('cy', String(y ?? 0))
        // update geometry live
    const uiPts = edgeGeometryToUIPoints(edge, state.nodes as MutableNode[])
        if(uiPts.length && x != null && y != null){ uiPts[idx] = [x,y] }
        // Write back to lon/lat
        const llPts = uiPts.map(([ux,uy])=>{ const ll = unprojectUIToLatLon(ux, uy); return [ll.lon, ll.lat] }) as Array<[number, number]>
        updateEdge(edge.id, { geometry: llPts })
      }
      const up = ()=>{
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
        c.style.cursor='grab'
        isDraggingVertex=false
        renderHandles(state.edges.find(x=>x.id===edge.id))
      }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    })
    g.appendChild(c)
  })
}

function onEdgeClick(e: Event, datum: { id: string; source?: string | null; target?: string | null } | null): void {
  if(getMode()!=='edit') return
  if(!datum) return
  currentEdgeId = datum.id
  const edge = state.edges.find(x=>x.id===currentEdgeId)
  if(edge){
    selectEdgeById(edge.id)
  }
  if(!Array.isArray(edge?.geometry) || edge.geometry.length<2){
    const fallbackGeom = ensureEdgeGeometry(edge, state.nodes)
    if(fallbackGeom) updateEdge(datum.id, { geometry: fallbackGeom })
  }
  renderHandles(state.edges.find(x=>x.id===currentEdgeId))
}

export function attachEditGeometry(_gEdges: unknown): void {
  if(wired) return; wired = true
  // re-render handles when edge updates (avoid during drag)
  subscribe((evt, payload)=>{
    if(evt === 'selection:edge'){
      currentEdgeId = typeof payload === 'string' ? payload : null
      if(!currentEdgeId){ selVertex = { edgeId: null, index: -1 } }
    }
    if(getMode()!=='edit') { clearHandles(); return }
    if((evt.startsWith('edge:') || evt==='graph:set' || evt==='selection:edge' || evt.startsWith('node:')) && !isDraggingVertex){
      const e = currentEdgeId ? state.edges.find(x=>x.id===currentEdgeId) : null
      if(e) renderHandles(e); else clearHandles()
    }
    if(evt==='mode:set' && payload!=='edit') clearHandles()
  })
  // Re-render on map move/zoom to keep handles synchronized
  try{
    document.addEventListener('map:view', ()=>{
      if(getMode()!=='edit' || isDraggingVertex) return
      if(!currentEdgeId) return
      const e = state.edges.find(x=>x.id===currentEdgeId)
      if(e) renderHandles(e)
    })
  }catch{}
  // Delegated click: select nearest g.edge; prefer target.closest
  const svgRootEl = document.getElementById('svg')
  const svgRoot = svgRootEl instanceof SVGSVGElement ? svgRootEl : null
  svgRoot?.addEventListener('click', (ev: MouseEvent)=>{
    if(getMode()!=='edit' || ev.altKey) return
    const target = ev.target instanceof Element ? ev.target : null
    const g = target?.closest('g.edge')
    if(!g) return
    ev.preventDefault(); ev.stopPropagation()
    const id = g.getAttribute('data-id')
    const e = id ? state.edges.find(x=>x.id===id) : null
    if(e) onEdgeClick(ev, { id: e.id, source: e.from_id, target: e.to_id })
  }, true)
  // Alt+clic (capture) pour insérer un sommet sur l'arête la plus proche
  const svgEl = document.getElementById('svg')
  const svg = svgEl instanceof SVGSVGElement ? svgEl : null
  svg?.addEventListener('click', (ev: MouseEvent)=>{
    if(getMode()!=='edit' || !ev.altKey) return
    attemptInsertFromEvent(ev, svg)
  }, true)
  svg?.addEventListener('mousedown', (ev: MouseEvent)=>{
    if(getMode()!=='edit') return
    const isRightClick = ev.button === 2 || (ev.button === 0 && ev.ctrlKey)
    if(!isRightClick) return
    const inserted = attemptInsertFromEvent(ev, svg)
    if(inserted) suppressNextContextMenu = true
  }, true)
  svg?.addEventListener('contextmenu', (ev: MouseEvent)=>{
    if(getMode()!=='edit') return
    if(suppressNextContextMenu){
      suppressNextContextMenu = false
      ev.preventDefault(); ev.stopPropagation()
      return
    }
    const inserted = attemptInsertFromEvent(ev, svg)
    if(inserted){
      suppressNextContextMenu = false
      return
    }
  }, true)
  // delete current vertex on Delete
  window.addEventListener('keydown', (ev: KeyboardEvent)=>{
    if(getMode()!=='edit') return
    if(ev.key!=='Delete' && ev.key!=='Backspace') return
    if(selVertex.edgeId && selVertex.index>=0){
      const e = state.edges.find(x=>x.id===selVertex.edgeId)
      if(e && Array.isArray(e.geometry) && e.geometry.length>2){
        const g = e.geometry.slice() as Array<[number, number]>; g.splice(selVertex.index, 1); updateEdge(e.id, { geometry: g }); selVertex={ edgeId:null, index:-1 }
        renderHandles(state.edges.find(x=>x.id===e.id))
      }
    }
  })
}
