import { state, addNode, addEdge, updateEdge, removeEdge, updateNode, getMode, subscribe } from '../state.js'
import { displayXYForNode, unprojectUIToLatLon, projectLatLonToUI } from '../geo.js'
import { NODE_SIZE } from '../render/render-nodes.js'
import { getMap, isMapActive } from '../map.js'

const SNAP_TOL = 32 // px for nodes (distance to node rectangle)
const EDGE_TOL = 24 // px for snapping onto existing edges

let drawing = null // { pointsUI: [ [x,y],... ], previewPath, snappedIds: string[] }
let overlayRef = null
let antennaSeedNodeId = null

function getUIFromEvent(evt){
  try{
    if(window.__leaflet_map){
      const map = window.__leaflet_map
      const pt = map.mouseEventToContainerPoint(evt)
      return [pt.x, pt.y]
    }
  }catch{}
  const svg = document.getElementById('svg')
  const r = svg.getBoundingClientRect()
  return [evt.clientX - r.left, evt.clientY - r.top]
}

function getLatLonFromEvent(evt){
  if(isMapActive && isMapActive() && getMap){
    const m = getMap()
    if(m){
      const mapEl = document.getElementById('map')
      const r = mapEl.getBoundingClientRect()
      const pt = m.containerPointToLatLng([evt.clientX - r.left, evt.clientY - r.top])
      return [pt.lng, pt.lat]
    }
  }
  const [ux, uy] = getUIFromEvent(evt)
  const ll = unprojectUIToLatLon(ux, uy)
  return [ll.lon, ll.lat]
}

function nearestNodeUI([x,y], tolPx = SNAP_TOL){
  let best = null
  for(const n of state.nodes){
    const p = displayXYForNode(n) // top-left of the node box
    const ax = p.x, ay = p.y
    const bx = ax + NODE_SIZE.w, by = ay + NODE_SIZE.h
    // Distance from point to axis-aligned rectangle
    const dx = (x < ax) ? (ax - x) : (x > bx ? x - bx : 0)
    const dy = (y < ay) ? (ay - y) : (y > by ? y - by : 0)
    const d2 = dx*dx + dy*dy
    if(d2 <= tolPx*tolPx){
      if(!best || d2 < best.d2) best = { id: n.id, x: Math.min(Math.max(x, ax), bx), y: Math.min(Math.max(y, ay), by), d2, node: n }
    }
  }
  return best
}

function updatePreview(){
  if(!drawing) return
  const d = drawing.pointsUI
  let path = ''
  for(let i=0;i<d.length;i++){
    const p = d[i]
    path += (i===0? 'M':' L') + p[0] + ',' + p[1]
  }
  if(drawing.previewPath) drawing.previewPath.setAttribute('d', path)
}

function startDrawing(gOverlay){
  if(drawing) return
  const p = document.createElementNS('http://www.w3.org/2000/svg','path')
  p.setAttribute('class','draw-preview')
  p.setAttribute('fill','none')
  p.setAttribute('stroke','var(--accent)')
  p.setAttribute('stroke-width','2')
  gOverlay.node().appendChild(p)
  drawing = { pointsUI: [], previewPath: p, snappedIds: [] }
}

function stopDrawing(){
  if(!drawing) return
  try{ drawing.previewPath?.remove() }catch{}
  drawing = null
}

function finishDrawing(){
  if(!drawing) return
  const pts = drawing.pointsUI
  if(pts.length < 2){ stopDrawing(); return }
  // Compute lat/lon geometry from stored UI points
  const geometry = pts.map(([x,y])=>{
    const ll = unprojectUIToLatLon(x, y)
    return [ll.lon, ll.lat]
  })
  // Endpoints
  const startUI = pts[0]
  const endUI = pts[pts.length-1]
  let aId = drawing.snappedIds?.[0] || nearestNodeUI(startUI)?.id || null
  let bId = drawing.snappedIds?.[pts.length-1] || nearestNodeUI(endUI)?.id || null
  let createdA = false, createdB = false
  // Create endpoints if needed (OUVRAGE) and lock to GPS if available
  if(!aId){
    const ll = unprojectUIToLatLon(startUI[0], startUI[1])
    const na = addNode({ type:'OUVRAGE', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true })
    aId = na.id
    createdA = true
  }
  if(!bId){
    const ll = unprojectUIToLatLon(endUI[0], endUI[1])
    const nb = addNode({ type:'OUVRAGE', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true })
    bId = nb.id
    createdB = true
  }
  // Ensure snapped endpoints have GPS so they stay anchored to the basemap
  const ensureNodeHasGPS = (id, ui)=>{
    const n = state.nodes.find(nn=>nn.id===id)
    if(!n) return
    const has = Number.isFinite(+n.gps_lat) && Number.isFinite(+n.gps_lon)
    if(!has){
      const ll = unprojectUIToLatLon(ui[0], ui[1])
      if(Number.isFinite(ll?.lat) && Number.isFinite(ll?.lon)) updateNode(id, { gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true })
    }
  }
  ensureNodeHasGPS(aId, startUI)
  ensureNodeHasGPS(bId, endUI)
  const e = addEdge(aId, bId, { active: true })
  updateEdge(e.id, { geometry })
  // If started as an antenna from a junction, attach newly created ouvrages to this new branch
  if(antennaSeedNodeId){
    try{
      const branchId = e.id
      if(createdA){ const nn = state.nodes.find(n=>n.id===aId); if(nn){ nn.branch_id = branchId; updateNode(aId, { branch_id: branchId }) } }
      if(createdB){ const nn = state.nodes.find(n=>n.id===bId); if(nn){ nn.branch_id = branchId; updateNode(bId, { branch_id: branchId }) } }
    }catch{}
  }
  stopDrawing()
  antennaSeedNodeId = null
}

// Helpers for snapping to existing edge segments
function uiPointsForEdgeGeometry(edge){
  if(Array.isArray(edge?.geometry) && edge.geometry.length>=2){
    const pts=[]
    for(const g of edge.geometry){
      if(Array.isArray(g)&&g.length>=2){
        const lon=+g[0], lat=+g[1]
        if(Number.isFinite(lat)&&Number.isFinite(lon)){
          const p=projectLatLonToUI(lat, lon)
          pts.push([p.x,p.y])
        }
      }
    }
    return pts
  }
  const a = state.nodes.find(n=>n.id===(edge.from_id??edge.source))
  const b = state.nodes.find(n=>n.id===(edge.to_id??edge.target))
  if(!a||!b) return []
  const pa=displayXYForNode(a), pb=displayXYForNode(b)
  return [[pa.x,pa.y],[pb.x,pb.y]]
}

function nearestOnPolyline(pts, x, y){
  let best = { seg:-1, t:0, d2: Infinity, px:0, py:0 }
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
    if(d2 < best.d2){ best = { seg:i, t, d2, px, py } }
  }
  return best
}

function splitGeometry(geom, hit){
  const insLL = unprojectUIToLatLon(hit.px, hit.py)
  const ins = [insLL.lon, insLL.lat]
  if(Array.isArray(geom) && geom.length>=2){
    const before = []
    const after = []
    const cutIdx = hit.seg
    for(let i=0;i<geom.length;i++){
      if(i<cutIdx) before.push(geom[i])
      else if(i>=cutIdx) after.push(geom[i])
    }
    if(before.length && (before[before.length-1][0]!==ins[0] || before[before.length-1][1]!==ins[1])) before.push(ins)
    if(after.length && (after[0][0]!==ins[0] || after[0][1]!==ins[1])) after.unshift(ins)
    return { g1: before, g2: after }
  }
  return { g1: [geom?.[0]||ins, ins], g2: [ins, geom?.[1]||ins] }
}

function findNearestEdgeHit(x, y){
  let best=null
  for(const e of state.edges){
    const pts = uiPointsForEdgeGeometry(e)
    if(pts.length<2) continue
    const hit = nearestOnPolyline(pts, x, y)
    if(hit && hit.d2 < (EDGE_TOL*EDGE_TOL)){
      if(!best || hit.d2 < best.hit.d2) best = { edge:e, hit }
    }
  }
  return best
}

function splitEdgeAt(edge, hit){
  let geom = Array.isArray(edge.geometry) && edge.geometry.length>=2 ? edge.geometry.slice() : null
  if(!geom){
    const a = state.nodes.find(n=>n.id===(edge.from_id??edge.source))
    const b = state.nodes.find(n=>n.id===(edge.to_id??edge.target))
    if(!a||!b) return null
    const pa=displayXYForNode(a), pb=displayXYForNode(b)
    const A = unprojectUIToLatLon(pa.x, pa.y)
    const B = unprojectUIToLatLon(pb.x, pb.y)
    geom = [[A.lon,A.lat],[B.lon,B.lat]]
  }
  const parts = splitGeometry(geom, hit)
  const fromId = edge.from_id ?? edge.source
  const toId   = edge.to_id   ?? edge.target
  const keepActive = edge.active!==false
  const commentaire = edge.commentaire || ''
  const pgid = edge.pipe_group_id || ''
  // Create the new node at hit point, lock to GPS
  const ll = unprojectUIToLatLon(hit.px, hit.py)
  const node = addNode({ type:'JONCTION', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true, name:'' })
  removeEdge(edge.id)
  const e1 = addEdge(fromId, node.id, { active: keepActive, commentaire, pipe_group_id: pgid })
  updateEdge(e1.id, { geometry: parts.g1 })
  const e2 = addEdge(node.id, toId, { active: keepActive, commentaire, pipe_group_id: pgid })
  updateEdge(e2.id, { geometry: parts.g2 })
  return { nodeId: node.id, ui: [hit.px, hit.py] }
}

export function attachDraw(svgSel, gOverlay){
  overlayRef = gOverlay
  // React to mode changes: clear preview when leaving draw mode
  subscribe((evt)=>{ if(evt==='mode:set' && getMode()!=='draw') stopDrawing() })

  function onClick(evt){
    if(getMode()!=='draw') return
    if(!drawing) startDrawing(gOverlay)
    const ui = getUIFromEvent(evt)
    const snapNode = nearestNodeUI(ui)
    let usePt = ui
    let snappedId = null
    if(snapNode){ usePt = [snapNode.x, snapNode.y]; snappedId = snapNode.id; try{ console.debug('[dev] draw click node', snappedId) }catch{} }
    else{
      // Try snapping to existing edge segment
      const best = findNearestEdgeHit(ui[0], ui[1])
      if(best){
        const res = splitEdgeAt(best.edge, best.hit)
        if(res){
          usePt = res.ui; snappedId = res.nodeId
          // Mini menu (type du nœud inséré) — pas d'antenne ici car on est déjà en dessin
          try{
            showMiniMenu(evt.clientX, evt.clientY, [
              { label: 'Jonction', onClick: ()=> updateNode(res.nodeId, { type:'OUVRAGE' }) },
              { label: 'Point de mesure', onClick: ()=> updateNode(res.nodeId, { type:'POINT_MESURE' }) },
              { label: 'Vanne', onClick: ()=> updateNode(res.nodeId, { type:'VANNE' }) },
            ])
          }catch{}
          try{ console.debug('[dev] draw split edge', best.edge?.id, '-> node', snappedId) }catch{}
        }
      } else { try{ console.debug('[dev] draw click free', Math.round(ui[0]), Math.round(ui[1])) }catch{} }
    }
    drawing.pointsUI.push(usePt)
    drawing.snappedIds.push(snappedId)
    updatePreview()
  }

  function onMove(evt){
    if(getMode()!=='draw' || !drawing) return
    const ui = getUIFromEvent(evt)
    const snap = nearestNodeUI(ui)
    const p = snap ? [snap.x, snap.y] : ui
    // Update the last phantom point for live preview
    if(!drawing._hasPhantom){ drawing.pointsUI.push(p); drawing._hasPhantom = true }
    else drawing.pointsUI[drawing.pointsUI.length-1] = p
    updatePreview()
  }

  function onDblClick(evt){
    if(getMode()!=='draw') return
    if(!drawing) return
    if(drawing._hasPhantom){ drawing.pointsUI.pop(); drawing._hasPhantom=false }
    try{ console.debug('[dev] draw finish with', drawing.pointsUI.length, 'points') }catch{}
    finishDrawing()
  }

  function onKey(evt){
    if(getMode()!=='draw') return
    if(evt.key==='Escape'){ stopDrawing() }
    if(evt.key==='Enter'){ if(drawing){ if(drawing._hasPhantom){ drawing.pointsUI.pop(); drawing._hasPhantom=false } finishDrawing() } }
  }

  const svg = svgSel.node()
  // Capture phase to preempt selection handlers on nodes/edges
  svg.addEventListener('click', (e)=>{ if(getMode()==='draw'){ onClick(e); e.stopPropagation(); e.preventDefault() } }, true)
  svg.addEventListener('mousemove', onMove)
  svg.addEventListener('dblclick', (e)=>{ if(getMode()==='draw'){ onDblClick(e); e.stopPropagation(); e.preventDefault() } }, true)
  window.addEventListener('keydown', onKey)
}

export function startDrawingFromNodeId(nodeId){
  try{
    if(!overlayRef) return
    const n = state.nodes.find(nn=>nn.id===nodeId)
    if(!n) return
    if(!drawing) startDrawing(overlayRef)
    const p = displayXYForNode(n)
    drawing.pointsUI = [[p.x, p.y]]
    drawing.snappedIds = [nodeId]
    antennaSeedNodeId = nodeId
    updatePreview()
  }catch{}
}
