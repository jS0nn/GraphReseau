import { state, updateEdge, subscribe, getMode } from '../state.js'
import { projectLatLonToUI, unprojectUIToLatLon, displayXYForNode } from '../geo.js'
import { NODE_SIZE } from '../render/render-nodes.js'

let currentEdgeId = null
let selVertex = { edgeId: null, index: -1 }
let isDraggingVertex = false
let wired = false

function centerXY(node){
  try{
    const p = displayXYForNode(node)
    const T = String(node?.type||'').toUpperCase()
    return (T==='JONCTION') ? [ (p.x||0), (p.y||0) ] : [ (p.x||0) + NODE_SIZE.w/2, (p.y||0) + NODE_SIZE.h/2 ]
  }catch{ return [0,0] }
}

function uiPointsForEdgeGeometry(edge){
  const geom = Array.isArray(edge?.geometry) ? edge.geometry : null
  if(!geom || geom.length < 2) return []
  const pts = []
  for(const g of geom){
    if(!Array.isArray(g) || g.length < 2) continue
    const lon = +g[0], lat = +g[1]
    if(Number.isFinite(lat) && Number.isFinite(lon)){
      const p = projectLatLonToUI(lat, lon)
      pts.push([p.x, p.y])
    }
  }
  // Anchor endpoints to current node centers so handles align with rendered edge
  try{
    const a = state.nodes.find(n=>n.id===(edge.from_id??edge.source))
    const b = state.nodes.find(n=>n.id===(edge.to_id??edge.target))
    if(a && pts.length){ const ca = centerXY(a); pts[0] = [ca[0], ca[1]] }
    if(b && pts.length){ const cb = centerXY(b); pts[pts.length-1] = [cb[0], cb[1]] }
  }catch{}
  return pts
}

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
  let best = { i:-1, t:0, d2:Infinity, px:0, py:0 }
  for(let i=1;i<pts.length;i++){
    const ax=pts[i-1][0], ay=pts[i-1][1]
    const bx=pts[i][0],   by=pts[i][1]
    const abx = bx-ax, aby = by-ay
    const apx = x-ax,  apy = y-ay
    const ab2 = abx*abx + aby*aby || 1
    let t = (apx*abx + apy*aby) / ab2
    if(t<0) t=0; if(t>1) t=1
    const px = ax + t*abx, py = ay + t*aby
    const dx = x-px, dy=y-py
    const d2 = dx*dx + dy*dy
    if(d2 < best.d2){ best = { i, t, d2, px, py } }
  }
  return best
}

function findNearestEdgeHit(x, y, tol=28){
  let best = null
  for(const e of state.edges){
    const pts = uiPointsForEdgeGeometry(e)
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
  const pts = uiPointsForEdgeGeometry(edge)
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
        const uiPts = uiPointsForEdgeGeometry(edge)
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
    // initialize from endpoints: if GPS présent, utiliser directement, sinon unproject depuis UI
    const a = state.nodes.find(n=>n.id===(datum.source??datum.from_id))
    const b = state.nodes.find(n=>n.id===(datum.target??datum.to_id))
    if(a && b){
      let A, B
      if(Number.isFinite(+a.gps_lat) && Number.isFinite(+a.gps_lon)) A = { lon:+a.gps_lon, lat:+a.gps_lat }
      else { const ca = centerXY(a); A = unprojectUIToLatLon(ca[0], ca[1]) }
      if(Number.isFinite(+b.gps_lat) && Number.isFinite(+b.gps_lon)) B = { lon:+b.gps_lon, lat:+b.gps_lat }
      else { const cb = centerXY(b); B = unprojectUIToLatLon(cb[0], cb[1]) }
      updateEdge(datum.id, { geometry: [[A.lon,A.lat],[B.lon,B.lat]] })
    }
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
      const ptsSel = uiPointsForEdgeGeometry(e)
      if(ptsSel.length>=2){ seg = nearestSegment(ptsSel, x, y) }
      // Si le point est trop loin de l'arête sélectionnée, bascule sur la plus proche globale
      if(!seg || !Number.isFinite(seg.d2) || seg.d2 > (32*32)) e = null
    }
    if(!e){
      const found = findNearestEdgeHit(x, y, 32)
      if(!found) return
      e = found.edge
      seg = found.hit
    }
    currentEdgeId = e.id
    // Initialiser la géométrie si manquante
    if(!Array.isArray(e.geometry) || e.geometry.length<2){
      const a = state.nodes.find(n=>n.id===(e.from_id??e.source))
      const b = state.nodes.find(n=>n.id===(e.to_id??e.target))
      if(a && b){
        let A, B
        if(Number.isFinite(+a.gps_lat) && Number.isFinite(+a.gps_lon)) A = { lon:+a.gps_lon, lat:+a.gps_lat }
        else { const ca = centerXY(a); A = unprojectUIToLatLon(ca[0], ca[1]) }
        if(Number.isFinite(+b.gps_lat) && Number.isFinite(+b.gps_lon)) B = { lon:+b.gps_lon, lat:+b.gps_lat }
        else { const cb = centerXY(b); B = unprojectUIToLatLon(cb[0], cb[1]) }
        updateEdge(e.id, { geometry: [[A.lon,A.lat],[B.lon,B.lat]] })
      }
    }
    // Recalcule et insère au plus proche
    const pts = uiPointsForEdgeGeometry(state.edges.find(x=>x.id===e.id))
    if(!seg){ seg = nearestSegment(pts, x, y) }
    const uiIns = [seg.px, seg.py]
    const ll = unprojectUIToLatLon(uiIns[0], uiIns[1])
    const geo = (state.edges.find(x=>x.id===e.id)?.geometry || []).slice()
    if(geo.length>=2){ geo.splice(seg.i, 0, [ll.lon, ll.lat]); updateEdge(e.id, { geometry: geo }) }
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
