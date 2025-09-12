import { state, updateEdge, subscribe, getMode } from '../state.js'
import { projectLatLonToUI } from '../geo.js'

let currentEdgeId = null
let selVertex = { edgeId: null, index: -1 }

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
      const move = (ev)=>{
        let x, y
        try{
          if(window.__leaflet_map){ const pt = window.__leaflet_map.mouseEventToContainerPoint(ev); x=pt.x; y=pt.y }
        }catch{}
        if(x==null||y==null){ const svg = document.getElementById('svg'); const r = svg.getBoundingClientRect(); x=ev.clientX-r.left; y=ev.clientY-r.top }
        c.setAttribute('cx', String(x)); c.setAttribute('cy', String(y))
        // update geometry live
        const uiPts = uiPointsForEdgeGeometry(edge)
        if(uiPts.length){ uiPts[idx] = [x,y] }
        // Write back to lon/lat
        const llPts = uiPts.map(([ux,uy])=>{
          const { unprojectUIToLatLon } = require('../geo.js')
          const ll = unprojectUIToLatLon(ux, uy)
          return [ll.lon, ll.lat]
        })
        updateEdge(edge.id, { geometry: llPts })
      }
      const up = ()=>{ document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); c.style.cursor='grab' }
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
    // initialize from endpoints in UI then convert to lon/lat
    const a = state.nodes.find(n=>n.id===(datum.source??datum.from_id))
    const b = state.nodes.find(n=>n.id===(datum.target??datum.to_id))
    if(a && b){
      const pa = projectLatLonToUI(a.gps_lat||0, a.gps_lon||0)
      const pb = projectLatLonToUI(b.gps_lat||0, b.gps_lon||0)
      const { unprojectUIToLatLon } = require('../geo.js')
      const A = unprojectUIToLatLon(pa.x, pa.y)
      const B = unprojectUIToLatLon(pb.x, pb.y)
      updateEdge(datum.id, { geometry: [[A.lon,A.lat],[B.lon,B.lat]] })
    }
  }
  renderHandles(state.edges.find(x=>x.id===currentEdgeId))
}

export function attachEditGeometry(gEdges){
  // re-render handles when selection/edge updates
  subscribe((evt, payload)=>{
    if(getMode()!=='edit') { clearHandles(); return }
    if(evt.startsWith('edge:') || evt==='graph:set' || evt==='selection:edge'){
      const e = state.edges.find(x=>x.id===currentEdgeId)
      if(e) renderHandles(e)
    }
    if(evt==='mode:set' && payload!=='edit') clearHandles()
  })
  // click to select edge for editing
  try{
    gEdges.selectAll('g.edge').on('click.editGeom', function(ev, d){ onEdgeClick(ev, d) })
  }catch{}
  // insert vertex on Alt+Click on any edge path
  const svg = document.getElementById('svg')
  svg?.addEventListener('click', (ev)=>{
    if(getMode()!=='edit' || !ev.altKey) return
    const e = state.edges.find(x=>x.id===currentEdgeId)
    if(!e || !Array.isArray(e.geometry)) return
    let x, y
    try{
      if(window.__leaflet_map){ const pt = window.__leaflet_map.mouseEventToContainerPoint(ev); x=pt.x; y=pt.y }
    }catch{}
    if(x==null||y==null){ const r = svg.getBoundingClientRect(); x=ev.clientX-r.left; y=ev.clientY-r.top }
    const uiPts = uiPointsForEdgeGeometry(e)
    const seg = nearestSegment(uiPts, x, y)
    const uiIns = [seg.px, seg.py]
    const { unprojectUIToLatLon } = require('../geo.js')
    const ll = unprojectUIToLatLon(uiIns[0], uiIns[1])
    const newGeom = e.geometry.slice()
    newGeom.splice(seg.i, 0, [ll.lon, ll.lat])
    updateEdge(e.id, { geometry: newGeom })
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
