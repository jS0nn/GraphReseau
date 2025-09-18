import { state, addNode, addEdge, updateEdge, removeEdge, updateNode, getMode, subscribe } from '../state/index.js'
import { displayXYForNode, unprojectUIToLatLon, projectLatLonToUI } from '../geo.js'
import { NODE_SIZE } from '../constants/nodes.js'
import { getMap, isMapActive } from '../map.js'
import { showMiniMenu } from '../ui/mini-menu.js'
import { centerUIForNode, edgeGeometryToUIPoints, nearestPointOnPolyline, splitGeometryAt, ensureEdgeGeometry } from '../shared/geometry.js'

const SNAP_TOL = 15 // px for nodes (distance to node rectangle)
const EDGE_TOL = 15 // px for snapping onto existing edges

// drawing shape:
// {
//   pointsUI: [ [x,y], ... ], // UI cache for preview rendering
//   pointsLL: [ [lon,lat], ... ], // authoritative vertices in GPS for consistency on view changes
//   previewPath: SVGPathElement,
//   snappedIds: string[],
//   _hasPhantom?: boolean
// }
let drawing = null
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
  const px = evt.clientX - r.left
  const py = evt.clientY - r.top
  try{ const t = window.d3?.zoomTransform?.(svg); if(t && typeof t.invert==='function'){ const p=t.invert([px,py]); return [p[0], p[1]] } }catch{}
  return [px, py]
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
  const tol2 = tolPx * tolPx
  for(const n of state.nodes){
    const [cx, cy] = centerUIForNode(n)
    const dx = x - cx
    const dy = y - cy
    const d2 = dx * dx + dy * dy
    if(d2 <= tol2){
      if(!best || d2 < best.d2){
        best = { id: n.id, x: cx, y: cy, d2, node: n }
      }
    }
  }
  return best
}

function updatePreview(){
  if(!drawing) return
  // Recompute UI from GPS when available to keep preview anchored on map moves
  if(Array.isArray(drawing.pointsLL) && drawing.pointsLL.length){
    const ui = []
    for(const ll of drawing.pointsLL){
      if(!Array.isArray(ll) || ll.length<2) continue
      const lon = +ll[0], lat = +ll[1]
      if(Number.isFinite(lat) && Number.isFinite(lon)){
        const p = projectLatLonToUI(lat, lon)
        ui.push([p.x, p.y])
      }
    }
    drawing.pointsUI = ui
  }
  const d = drawing.pointsUI || []
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
  drawing = { pointsUI: [], pointsLL: [], previewPath: p, snappedIds: [] }
}

function stopDrawing(){
  if(!drawing) return
  try{ drawing.previewPath?.remove() }catch{}
  drawing = null
}

function discardPhantomPoint(){
  if(!drawing || !drawing._hasPhantom) return
  if(Array.isArray(drawing.pointsLL) && drawing.pointsLL.length){ drawing.pointsLL.pop() }
  if(Array.isArray(drawing.pointsUI) && drawing.pointsUI.length){ drawing.pointsUI.pop() }
  drawing._hasPhantom = false
}

function finishDrawing(){
  if(!drawing) return
  // Drop phantom if present so we only keep confirmed vertices
  discardPhantomPoint()
  const ptsLL = Array.isArray(drawing.pointsLL) ? drawing.pointsLL.slice() : []
  if(ptsLL.length < 2){ stopDrawing(); return }
  // Endpoints
  const projectUI = (ll)=>{ const p = projectLatLonToUI(ll[1], ll[0]); return [p.x, p.y] }
  const startUI = projectUI(ptsLL[0])
  const endUI = projectUI(ptsLL[ptsLL.length-1])
  let aId = drawing.snappedIds?.[0] || nearestNodeUI(startUI)?.id || null
  let bId = drawing.snappedIds?.[ptsLL.length-1] || nearestNodeUI(endUI)?.id || null
  let createdA = false, createdB = false
  // Create endpoints if needed (OUVRAGE) and lock to GPS if available
  if(!aId){
    // startUI/endUI already represent the intended CENTER
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
      // ui matches the visual marker center; lock GPS to that point
      const ll = unprojectUIToLatLon(ui[0], ui[1])
      if(Number.isFinite(ll?.lat) && Number.isFinite(ll?.lon)) updateNode(id, { gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true })
    }
  }
  ensureNodeHasGPS(aId, startUI)
  ensureNodeHasGPS(bId, endUI)

  const snappedIds = Array.isArray(drawing.snappedIds) ? drawing.snappedIds.slice() : []
  const pointCount = ptsLL.length
  while(snappedIds.length < pointCount) snappedIds.push(null)
  snappedIds[0] = aId
  snappedIds[pointCount-1] = bId
  const nodeAtIndex = snappedIds.map(id => id || null)

  const segments = []
  let segStartIdx = 0
  let segStartNode = nodeAtIndex[0] || aId
  for(let i=1;i<pointCount;i++){
    const maybeNode = nodeAtIndex[i]
    if(maybeNode && segStartNode){
      if(maybeNode !== segStartNode){
        const slice = ptsLL.slice(segStartIdx, i+1).map(pt => [pt[0], pt[1]])
        if(slice.length >= 2){ segments.push({ from: segStartNode, to: maybeNode, geometry: slice }) }
        segStartIdx = i
        segStartNode = maybeNode
      } else {
        segStartIdx = i
      }
    }
  }
  if(!segments.length){
    const slice = ptsLL.map(pt => [pt[0], pt[1]])
    if(slice.length >= 2) segments.push({ from: aId, to: bId, geometry: slice })
  }

  const edgesCreated = []
  const nodeSegments = new Map()
  const registerEdgeForNode = (nodeId, edgeId)=>{
    if(!nodeId || !edgeId) return
    const arr = nodeSegments.get(nodeId) || []
    arr.push(edgeId)
    nodeSegments.set(nodeId, arr)
  }
  for(const seg of segments){
    const edge = addEdge(seg.from, seg.to, { active: true })
    updateEdge(edge.id, { geometry: seg.geometry })
    edgesCreated.push(edge)
    registerEdgeForNode(seg.from, edge.id)
    registerEdgeForNode(seg.to, edge.id)
  }
  if(!edgesCreated.length){ stopDrawing(); antennaSeedNodeId = null; return }

  const pgid = edgesCreated[0]?.id
  if(pgid){
    for(const edge of edgesCreated){ updateEdge(edge.id, { pipe_group_id: pgid }) }
  }

  const nodeIdsOnPath = new Set(nodeAtIndex.filter(Boolean))
  const assignNodeToBranch = (id) => {
    const n = state.nodes.find(nn=>nn.id===id)
    if(!n) return
    if(pgid && n.branch_id !== pgid){ updateNode(id, { branch_id: pgid }) }
    else if(!pgid && !n.branch_id){ updateNode(id, { branch_id: edgesCreated[0]?.id || '' }) }
  }
  const assignInlineToEdge = (id) => {
    const n = state.nodes.find(nn=>nn.id===id)
    if(!n) return
    const T = String(n.type||'').toUpperCase()
    if(T==='POINT_MESURE' || T==='VANNE'){
      const usableEdges = nodeSegments.get(id) || []
      const targetEdge = usableEdges[0] || edgesCreated[0]?.id || null
      const patch = {}
      if(targetEdge && n.pm_collector_edge_id !== targetEdge){ patch.pm_collector_edge_id = targetEdge }
      if(n.pm_collector_id){ patch.pm_collector_id = '' }
      if(Object.keys(patch).length){ updateNode(id, patch) }
    }
  }
  assignNodeToBranch(aId)
  assignNodeToBranch(bId)
  assignInlineToEdge(aId)
  assignInlineToEdge(bId)
  for(const nid of nodeIdsOnPath){
    if(nid===aId || nid===bId) continue
    assignNodeToBranch(nid)
    assignInlineToEdge(nid)
  }

  stopDrawing()
  antennaSeedNodeId = null
}

function findNearestEdgeHit(x, y){
  let best=null
  for(const e of state.edges){
    const pts = edgeGeometryToUIPoints(e, state.nodes)
    if(pts.length<2) continue
    const hit = nearestPointOnPolyline(pts, x, y)
    if(hit && Number.isFinite(hit.d2) && hit.d2 < (EDGE_TOL*EDGE_TOL)){
      if(!best || hit.d2 < best.hit.d2) best = { edge:e, hit }
    }
  }
  return best
}

function splitEdgeAt(edge, hit){
  const geom = ensureEdgeGeometry(edge, state.nodes)
  if(!geom) return null
  const parts = splitGeometryAt(geom, hit)
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
  // Keep preview in sync with map moves/zooms by reprojecting from GPS
  try{
    document.addEventListener('map:view', ()=>{
      if(getMode()!=='draw' || !drawing) return
      updatePreview()
    })
  }catch{}

  function onClick(evt){
    if(getMode()!=='draw') return
    if(!drawing) startDrawing(gOverlay)
    const ui = getUIFromEvent(evt)
    const snapNode = nearestNodeUI(ui)
    let usePt = ui
    let snappedId = null
    if(snapNode){ const c = centerUIForNode(snapNode.node); usePt = [c[0], c[1]]; snappedId = snapNode.id; try{ console.debug('[dev] draw click node', snappedId) }catch{} }
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
              { label: 'Jonction', onClick: ()=> updateNode(res.nodeId, { type:'JONCTION' }) },
              { label: 'Point de mesure', onClick: ()=> {
                  const cx = res.ui?.[0] ?? 0, cy = res.ui?.[1] ?? 0
                  const ll = unprojectUIToLatLon(cx, cy)
                  updateNode(res.nodeId, { type:'POINT_MESURE', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true })
                }
              },
              { label: 'Vanne', onClick: ()=> {
                  const cx = res.ui?.[0] ?? 0, cy = res.ui?.[1] ?? 0
                  const ll = unprojectUIToLatLon(cx, cy)
                  updateNode(res.nodeId, { type:'VANNE', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true })
                }
              },
            ])
          }catch{}
          try{ console.debug('[dev] draw split edge', best.edge?.id, '-> node', snappedId) }catch{}
        }
      } else { try{ console.debug('[dev] draw click free', Math.round(ui[0]), Math.round(ui[1])) }catch{} }
    }
    // Store authoritative GPS for anchoring across view changes
    const ll = unprojectUIToLatLon(usePt[0], usePt[1])
    if(!Array.isArray(drawing.pointsLL)) drawing.pointsLL = []
    drawing.pointsLL.push([ll.lon, ll.lat])
    // UI cache will be recomputed from GPS in updatePreview
    drawing.pointsUI.push(usePt)
    drawing.snappedIds.push(snappedId)
    updatePreview()
  }

  function onMove(evt){
    if(getMode()!=='draw' || !drawing) return
    const ui = getUIFromEvent(evt)
    const snap = nearestNodeUI(ui)
    const p = snap ? centerUIForNode(snap.node) : ui
    // Update the last phantom point for live preview
    const ll = unprojectUIToLatLon(p[0], p[1])
    if(!drawing._hasPhantom){
      // Prime both LL and UI caches
      drawing.pointsLL.push([ll.lon, ll.lat])
      drawing.pointsUI.push(p)
      drawing._hasPhantom = true
    } else {
      // Replace last phantom
      if(Array.isArray(drawing.pointsLL) && drawing.pointsLL.length){ drawing.pointsLL[drawing.pointsLL.length-1] = [ll.lon, ll.lat] }
      drawing.pointsUI[drawing.pointsUI.length-1] = p
    }
    updatePreview()
  }

  function onDblClick(evt){
    if(getMode()!=='draw') return
    if(!drawing) return
    discardPhantomPoint()
    try{ console.debug('[dev] draw finish with', drawing.pointsUI.length, 'points') }catch{}
    finishDrawing()
  }

  function onKey(evt){
    if(getMode()!=='draw') return
    if(evt.key==='Escape'){ stopDrawing() }
    if(evt.key==='Enter'){
      if(!drawing) return
      evt.preventDefault()
      discardPhantomPoint()
      finishDrawing()
    }
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
    const c = centerUIForNode(n)
    drawing.pointsUI = [[c[0], c[1]]]
    const ll = unprojectUIToLatLon(c[0], c[1])
    drawing.pointsLL = [[ll.lon, ll.lat]]
    drawing.snappedIds = [nodeId]
    antennaSeedNodeId = nodeId
    updatePreview()
  }catch{}
}
