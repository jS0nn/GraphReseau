import { state, updateEdge, subscribe, getMode } from '../state/index.js'
import { unprojectUIToLatLon } from '../geo.js'
import { edgeGeometryToUIPoints, nearestPointOnPolyline, ensureEdgeGeometry } from '../shared/geometry.js'

let currentEdgeId = null
let selVertex = { edgeId: null, index: -1 }
let isDraggingVertex = false
let wired = false

function nearestVertex(pts, x, y, tol=12){
  let best = { idx:-1, d2: Infinity }
  for(let i=0;i<pts.length;i++){
    const dx = pts[i][0]-x, dy=pts[i][1]-y
    const d2 = dx*dx+dy*dy
    if(d2 < best.d2){ best = { idx:i, d2 } }
  }
  return (best.d2 <= tol*tol) ? best.idx : -1
}

function nearestSegment(pts, x, y){
  const hit = nearestPointOnPolyline(pts, x, y)
  if(!hit) return { i:-1, t:0, d2:Infinity, px:0, py:0 }
  return { i: hit.seg, t: hit.t, d2: hit.d2, px: hit.px, py: hit.py }
}

function findNearestEdgeHit(x, y, tol=28){
  let best = null
  for(const e of state.edges){
    const pts = edgeGeometryToUIPoints(e, state.nodes)
    if(pts.length < 2) continue
    const hit = nearestSegment(pts, x, y)
    if(hit && hit.d2 < tol*tol){
      if(!best || hit.d2 < best.hit.d2) best = { edge: e, hit }
    }
  }
  return best
}

function getOverlay(){ return document.getElementById('svg')?.querySelector('g.overlay') }

function clearHandles(){ try{ getOverlay()?.querySelectorAll('g.geom-handles, path.geom-preview')?.forEach(n=>n.remove()) }catch{} }

function renderHandles(edge){
  clearHandles()
  const overlay = getOverlay(); if(!overlay) return
  const pts = edgeGeometryToUIPoints(edge, state.nodes)
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
    c.addEventListener('mousedown', (e)=>{
      if(getMode()!=='edit') return
      selVertex = { edgeId: edge.id, index: idx }
      c.style.cursor='grabbing'
      e.preventDefault(); e.stopPropagation()
      isDraggingVertex = true
      const move = (ev)=>{
        let x, y
        try{
          if(window.__leaflet_map){ const pt = window.__leaflet_map.mouseEventToContainerPoint(ev); x=pt.x; y=pt.y }
        }catch{}
        if(x==null||y==null){
          const svg = document.getElementById('svg'); const r = svg.getBoundingClientRect();
          const px = ev.clientX - r.left, py = ev.clientY - r.top
          try{ const t = window.d3?.zoomTransform?.(svg); if(t && typeof t.invert==='function'){ const p = t.invert([px,py]); x=p[0]; y=p[1] } else { x=px; y=py } }
          catch{ x=px; y=py }
        }
        c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y))
        // update geometry live
    const uiPts = edgeGeometryToUIPoints(edge, state.nodes)
        if(uiPts.length){ uiPts[idx] = [x,y] }
        // Write back to lon/lat
        const llPts = uiPts.map(([ux,uy])=>{ const ll = unprojectUIToLatLon(ux, uy); return [ll.lon, ll.lat] })
        updateEdge(edge.id, { geometry: llPts })
      }
      const up = ()=>{ document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); c.style.cursor='grab'; isDraggingVertex=false; renderHandles(state.edges.find(x=>x.id===edge.id)) }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    })
    g.appendChild(c)
  })
}

function onEdgeClick(e, datum){
  if(getMode()!=='edit') return
  if(!datum) return
  currentEdgeId = datum.id
  const edge = state.edges.find(x=>x.id===currentEdgeId)
  if(!Array.isArray(edge?.geometry) || edge.geometry.length<2){
    const fallbackGeom = ensureEdgeGeometry(edge, state.nodes)
    if(fallbackGeom) updateEdge(datum.id, { geometry: fallbackGeom })
  }
  renderHandles(state.edges.find(x=>x.id===currentEdgeId))
}

export function attachEditGeometry(_gEdges){
  if(wired) return; wired = true
  // re-render handles when edge updates (avoid during drag)
  subscribe((evt, payload)=>{
    if(getMode()!=='edit') { clearHandles(); return }
    if((evt.startsWith('edge:') || evt==='graph:set' || evt==='selection:edge' || evt.startsWith('node:')) && !isDraggingVertex){
      const e = state.edges.find(x=>x.id===currentEdgeId)
      if(e) renderHandles(e)
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
  const svgRoot = document.getElementById('svg')
  svgRoot?.addEventListener('click', (ev)=>{
    if(getMode()!=='edit' || ev.altKey) return
    const g = ev.target?.closest && ev.target.closest('g.edge')
    if(!g) return
    ev.preventDefault(); ev.stopPropagation()
    const id = g.getAttribute('data-id')
    const e = id ? state.edges.find(x=>x.id===id) : null
    if(e) onEdgeClick(ev, { id: e.id, source: e.from_id, target: e.to_id })
  }, true)
  // Alt+clic (capture) pour insérer un sommet sur l'arête la plus proche
  const svg = document.getElementById('svg')
  svg?.addEventListener('click', (ev)=>{
    if(getMode()!=='edit' || !ev.altKey) return
    ev.preventDefault(); ev.stopPropagation()
    let x, y
    try{ if(window.__leaflet_map){ const pt=window.__leaflet_map.mouseEventToContainerPoint(ev); x=pt.x; y=pt.y } }catch{}
    if(x==null||y==null){
      const r = svg.getBoundingClientRect(); const px=ev.clientX-r.left; const py=ev.clientY-r.top
      try{ const t = window.d3?.zoomTransform?.(svg); if(t && typeof t.invert==='function'){ const p=t.invert([px,py]); x=p[0]; y=p[1] } else { x=px; y=py } }
      catch{ x=px; y=py }
    }
    // Préférence: arête sélectionnée si présente
    let e = currentEdgeId ? state.edges.find(xx=>xx.id===currentEdgeId) : null
    let seg = null
    if(e){
    const ptsSel = edgeGeometryToUIPoints(e, state.nodes)
      if(ptsSel.length>=2){ seg = nearestSegment(ptsSel, x, y) }
      // Si le point est trop loin de l'arête sélectionnée, bascule sur la plus proche globale
      if(!seg || !Number.isFinite(seg.d2) || seg.d2 > (32*32)) e = null
    }
  if(!e){
    const found = findNearestEdgeHit(x, y, 32)
    if(!found) return
    e = found.edge
    seg = nearestSegment(edgeGeometryToUIPoints(e, state.nodes), x, y)
  }
    currentEdgeId = e.id
    // Initialiser la géométrie si manquante
    if(!Array.isArray(e.geometry) || e.geometry.length<2){
      const fallbackGeom = ensureEdgeGeometry(e, state.nodes)
      if(fallbackGeom) updateEdge(e.id, { geometry: fallbackGeom })
    }
    // Recalcule et insère au plus proche
    const pts = edgeGeometryToUIPoints(state.edges.find(x=>x.id===e.id), state.nodes)
    if(!seg){ seg = nearestSegment(pts, x, y) }
    const uiIns = [seg.px, seg.py]
    const ll = unprojectUIToLatLon(uiIns[0], uiIns[1])
    const geo = (state.edges.find(x=>x.id===e.id)?.geometry || []).slice()
    if(geo.length>=2){
      const insertIndex = Number.isFinite(seg?.i) ? seg.i : (Number.isFinite(seg?.seg) ? seg.seg : 1)
      geo.splice(insertIndex, 0, [ll.lon, ll.lat])
      updateEdge(e.id, { geometry: geo })
    }
    renderHandles(state.edges.find(x=>x.id===e.id))
  }, true)
  // delete current vertex on Delete
  window.addEventListener('keydown', (ev)=>{
    if(getMode()!=='edit') return
    if(ev.key!=='Delete' && ev.key!=='Backspace') return
    if(selVertex.edgeId && selVertex.index>=0){
      const e = state.edges.find(x=>x.id===selVertex.edgeId)
      if(e && Array.isArray(e.geometry) && e.geometry.length>2){
        const g = e.geometry.slice(); g.splice(selVertex.index, 1); updateEdge(e.id, { geometry: g }); selVertex={ edgeId:null, index:-1 }
        renderHandles(state.edges.find(x=>x.id===e.id))
      }
    }
  })
}
