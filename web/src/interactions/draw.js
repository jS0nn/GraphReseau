import { state, addNode, addEdge, updateEdge, removeEdge, updateNode, getMode, setMode, subscribe, suspendOrphanPrune, getManualEdgeProps, triggerBranchRecalc } from '../state/index.js'
import { displayXYForNode, unprojectUIToLatLon, projectLatLonToUI } from '../geo.js'
import { NODE_SIZE } from '../constants/nodes.js'
import { getMap, isMapActive } from '../map.js'
import { showMiniMenu } from '../ui/mini-menu.js'
import { centerUIForNode, edgeGeometryToUIPoints, nearestPointOnPolyline, splitGeometryAt, ensureEdgeGeometry, geometryLengthMeters, offsetAlongGeometry } from '../shared/geometry.js'
import { isCanal, genIdWithTime } from '../utils.js'

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
let antennaSeedProps = null

const finiteDiameter = (value) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}
const roundMeters = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null)

const generateBranchId = () => {
  let candidate = null
  let guard = 0
  const exists = (branchId) => {
    const key = branchId ? String(branchId).trim() : ''
    if(!key) return false
    const edgeHit = state.edges.some(e => String(e?.branch_id ?? '').trim() === key)
    if(edgeHit) return true
    return state.nodes.some(n => String(n?.branch_id ?? '').trim() === key)
  }
  do{
    candidate = genIdWithTime('BR')
    guard += 1
  }while(exists(candidate) && guard < 10)
  return candidate
}

function pickEdgeProps(edge){
  if(!edge) return null
  const diameter_mm = finiteDiameter(edge.diameter_mm)
  const material = edge.material || ''
  const sdr = edge.sdr || ''
  const branch_id = edge.branch_id || ''
  if(diameter_mm == null && !material && !sdr && !branch_id) return null
  return { diameter_mm, material, sdr, branch_id: branch_id || null }
}

function mergeEdgeProps(target, props){
  if(!props) return target
  if(props.diameter_mm != null) target.diameter_mm = props.diameter_mm
  if(props.material) target.material = props.material
  if(props.sdr) target.sdr = props.sdr
  if(props.branch_id && !target.branch_id) target.branch_id = props.branch_id
  return target
}

function inferPropsFromNodeId(nodeId, visited = new Set()){
  if(!nodeId || visited.has(nodeId)) return null
  visited.add(nodeId)
  const node = state.nodes.find(nn => nn.id === nodeId)
  if(node){
    if(isCanal(node)){
      const diameter_mm = finiteDiameter(node.diameter_mm)
      const material = node.material || ''
      if(diameter_mm != null || material || node.branch_id){
        return { diameter_mm, material, branch_id: node.branch_id || null }
      }
    }
    if(node.well_collector_id){
      const props = inferPropsFromNodeId(node.well_collector_id, visited)
      if(props) return props
    }
    if(Array.isArray(node.collector_well_ids)){
      for(const cid of node.collector_well_ids){
        const props = inferPropsFromNodeId(cid, visited)
        if(props) return props
      }
    }
    const edgeRefs = [node.attach_edge_id, node.pm_collector_edge_id].filter(Boolean)
    for(const eid of edgeRefs){
      const edge = state.edges.find(e => e.id === eid)
      const props = pickEdgeProps(edge)
      if(props) return props
    }
  }
  const connectedEdges = state.edges.filter(e => (e.from_id ?? e.source) === nodeId || (e.to_id ?? e.target) === nodeId)
  for(const edge of connectedEdges){
    const props = pickEdgeProps(edge)
    if(props) return props
  }
  return null
}

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
  drawing = { pointsUI: [], pointsLL: [], previewPath: p, snappedIds: [], anchorHints: new Map() }
}

function stopDrawing(){
  if(drawing){
    try{ drawing.previewPath?.remove() }catch{}
    drawing = null
  }
  antennaSeedNodeId = null
  antennaSeedProps = null
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
  const nodeIdsOnPath = new Set(nodeAtIndex.filter(Boolean))

  const baseProps = (() => {
    if(antennaSeedProps) return antennaSeedProps
    if(antennaSeedNodeId){
      const props = inferPropsFromNodeId(antennaSeedNodeId)
      if(props) return props
    }
    const startProps = inferPropsFromNodeId(aId)
    if(startProps) return startProps
    const endProps = inferPropsFromNodeId(bId)
    if(endProps) return endProps
    for(const nid of nodeIdsOnPath){
      const props = inferPropsFromNodeId(nid)
      if(props) return props
    }
    return null
  })()

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
    const edge = addEdge(seg.to, seg.from, { active: true })
    const geom = Array.isArray(seg.geometry) ? seg.geometry.slice().reverse() : seg.geometry
    updateEdge(edge.id, { geometry: geom })
    edgesCreated.push(edge)
    registerEdgeForNode(seg.from, edge.id)
    registerEdgeForNode(seg.to, edge.id)
  }
  if(!edgesCreated.length){ stopDrawing(); return }

  const cleanId = (value) => {
    if(value == null) return ''
    const txt = String(value).trim()
    return txt
  }
  const seedCandidates = []
  if(baseProps?.branch_id) seedCandidates.push(baseProps.branch_id)
  if(antennaSeedProps?.branch_id) seedCandidates.push(antennaSeedProps.branch_id)
  const startNodeObj = state.nodes.find(nn => nn.id === aId)
  const endNodeObj = state.nodes.find(nn => nn.id === bId)
  if(startNodeObj?.branch_id) seedCandidates.push(startNodeObj.branch_id)
  if(endNodeObj?.branch_id) seedCandidates.push(endNodeObj.branch_id)
  const branchSeed = seedCandidates.map(cleanId).find(Boolean) || ''

  const branchIdForEdge = (edge) => {
    if(!edge) return branchSeed || cleanId(edge?.id)
    const target = state.nodes.find(nn => nn.id === (edge.to_id ?? edge.target))
    const source = state.nodes.find(nn => nn.id === (edge.from_id ?? edge.source))
    const candidates = [
      edge.branch_id,
      target?.branch_id,
      source?.branch_id,
      branchSeed,
    ].map(cleanId).filter(Boolean)
    return candidates.length ? candidates[0] : cleanId(edge.id)
  }

  const applyEdgeProps = (edge) => {
    if(!edge) return
    const branch = branchIdForEdge(edge)
    const patch = { branch_id: branch }
    mergeEdgeProps(patch, baseProps)
    const manual = getManualEdgeProps(branch) || {}

    if(manual.diameter_mm != null){
      patch.diameter_mm = manual.diameter_mm
    } else if(patch.diameter_mm == null){
      const existing = finiteDiameter(edge.diameter_mm)
      if(existing != null) patch.diameter_mm = existing
    }

    const normaliseMaterial = (value) => {
      if(value == null || value === undefined) return null
      const txt = String(value).trim()
      return txt ? txt.toUpperCase() : null
    }
    const normaliseSdr = (value) => {
      if(value == null || value === undefined) return null
      const txt = String(value).trim()
      return txt ? txt.toUpperCase() : null
    }

    const materialSource = manual.material ?? patch.material ?? edge.material
    const sdrSource = manual.sdr ?? patch.sdr ?? edge.sdr
    patch.material = normaliseMaterial(materialSource)
    patch.sdr = normaliseSdr(sdrSource)

    if(patch.material === undefined) patch.material = null
    if(patch.sdr === undefined) patch.sdr = null

    if(Object.keys(patch).length){
      updateEdge(edge.id, patch)
    }
  }
  edgesCreated.forEach(applyEdgeProps)

  const branchIdForNode = (nodeId) => {
    const node = state.nodes.find(n => n.id === nodeId)
    if(!node) return ''
    const edgesForNode = nodeSegments.get(nodeId) || []
    for(const eid of edgesForNode){
      const edge = state.edges.find(e => e.id === eid)
      const branch = branchIdForEdge(edge)
      if(cleanId(branch)) return branch
    }
    if(cleanId(node.branch_id)) return cleanId(node.branch_id)
    return branchSeed || ''
  }

  const assignNodeToBranch = (id) => {
    const n = state.nodes.find(nn=>nn.id===id)
    if(!n) return
    const desired = branchIdForNode(id)
    if(cleanId(desired) && cleanId(n.branch_id) !== cleanId(desired)){
      updateNode(id, { branch_id: cleanId(desired) })
    }
  }
  const assignInlineToEdge = (id) => {
    const n = state.nodes.find(nn=>nn.id===id)
    if(!n) return
    const T = String(n.type||'').toUpperCase()
    if(T==='POINT_MESURE' || T==='VANNE'){
      const usableEdges = nodeSegments.get(id) || []
      const hint = drawing?.anchorHints?.get(id) || null
      const upstreamEdge = usableEdges
        .map(eid => state.edges.find(e => e.id === eid))
        .find(edge => edge && (edge.to_id ?? edge.target) === id)
      const fallbackEdgeId = usableEdges[0] || edgesCreated[0]?.id || null
      const targetEdge = hint?.edgeId || upstreamEdge?.id || fallbackEdgeId
      const patch = {}
      if(targetEdge && n.pm_collector_edge_id !== targetEdge){
        patch.pm_collector_edge_id = targetEdge
        patch.attach_edge_id = targetEdge
      }
      if(n.pm_collector_id){ patch.pm_collector_id = '' }
      if(targetEdge){
        const edge = state.edges.find(e => e.id === targetEdge)
        const offsetVal = (hint && hint.offset != null) ? hint.offset : offsetAlongGeometry(edge, n)
        let clamped = Number(offsetVal)
        if(Number.isFinite(clamped)){
          const lengthHint = Number.isFinite(edge?.length_m) ? edge.length_m : geometryLengthMeters(edge?.geometry)
          if(Number.isFinite(lengthHint)){
            clamped = Math.min(clamped, lengthHint)
          }
          patch.pm_offset_m = roundMeters(clamped)
        }else{
          patch.pm_offset_m = null
        }
      }
      if(Object.keys(patch).length){ updateNode(id, patch) }
      if(hint){ try{ drawing?.anchorHints?.delete(id) }catch{} }
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
  try{ setMode('select') }catch{}
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
  const baseProps = pickEdgeProps(edge)
  const branchId = (() => {
    const candidates = [edge.branch_id, baseProps?.branch_id, edge.id]
    for(const cand of candidates){
      if(cand && String(cand).trim()) return String(cand).trim()
    }
    return ''
  })()
  // Create the new node at hit point, lock to GPS
  const ll = unprojectUIToLatLon(hit.px, hit.py)
  const node = addNode({ type:'JONCTION', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true, name:'', x: hit.px, y: hit.py })
  let e1 = null
  let e2 = null
  const buildEdgeOpts = () => {
    const opts = { active: keepActive, commentaire }
    if(branchId) opts.branch_id = branchId
    mergeEdgeProps(opts, baseProps)
    return opts
  }
  suspendOrphanPrune(()=>{
    removeEdge(edge.id)
    e1 = addEdge(fromId, node.id, buildEdgeOpts())
    if(e1?.id) updateEdge(e1.id, { geometry: parts.g1 })
    e2 = addEdge(node.id, toId, buildEdgeOpts())
    if(e2?.id) updateEdge(e2.id, { geometry: parts.g2 })
  })
  if(branchId) updateNode(node.id, { branch_id: branchId })
  const upstreamEdgeId = e1?.id || null
  const offsetMeters = geometryLengthMeters(parts.g1)
  return {
    nodeId: node.id,
    ui: [hit.px, hit.py],
    edgeProps: baseProps,
    anchorEdgeId: upstreamEdgeId,
    anchorOffsetM: roundMeters(offsetMeters),
  }
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
          if(res.edgeProps){ antennaSeedProps = res.edgeProps }
          if(res.anchorEdgeId){
            try{ drawing?.anchorHints?.set(res.nodeId, { edgeId: res.anchorEdgeId, offset: res.anchorOffsetM }) }catch{}
          }
          // Mini menu (type du nœud inséré) — pas d'antenne ici car on est déjà en dessin
          try{
            showMiniMenu(evt.clientX, evt.clientY, [
              { label: 'Jonction', onClick: ()=> updateNode(res.nodeId, { type:'JONCTION' }) },
              { label: 'Point de mesure', onClick: ()=> {
                  const cx = res.ui?.[0] ?? 0, cy = res.ui?.[1] ?? 0
                  const ll = unprojectUIToLatLon(cx, cy)
                  const pmPatch = { type:'POINT_MESURE', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true }
                  if(res.anchorEdgeId){ pmPatch.pm_collector_edge_id = res.anchorEdgeId; pmPatch.attach_edge_id = res.anchorEdgeId }
                  if(res.anchorOffsetM != null){ pmPatch.pm_offset_m = res.anchorOffsetM }
                  updateNode(res.nodeId, pmPatch)
                }
              },
              { label: 'Vanne', onClick: ()=> {
                  const cx = res.ui?.[0] ?? 0, cy = res.ui?.[1] ?? 0
                  const ll = unprojectUIToLatLon(cx, cy)
                  const vPatch = { type:'VANNE', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true }
                  if(res.anchorEdgeId){ vPatch.pm_collector_edge_id = res.anchorEdgeId; vPatch.attach_edge_id = res.anchorEdgeId }
                  if(res.anchorOffsetM != null){ vPatch.pm_offset_m = res.anchorOffsetM }
                  updateNode(res.nodeId, vPatch)
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
    if(!Array.isArray(drawing.pointsUI)) drawing.pointsUI = []
    if(!Array.isArray(drawing.snappedIds)) drawing.snappedIds = []
    if(drawing._hasPhantom && drawing.pointsLL.length){
      const lastIdx = drawing.pointsLL.length - 1
      drawing.pointsLL[lastIdx] = [ll.lon, ll.lat]
      drawing.pointsUI[lastIdx] = usePt
      drawing.snappedIds[lastIdx] = snappedId
      drawing._hasPhantom = false
    } else {
      drawing.pointsLL.push([ll.lon, ll.lat])
      // UI cache will be recomputed from GPS in updatePreview
      drawing.pointsUI.push(usePt)
      drawing.snappedIds.push(snappedId)
    }
    if(snappedId && !antennaSeedProps){
      antennaSeedProps = inferPropsFromNodeId(snappedId)
    }
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
    const baseProps = inferPropsFromNodeId(nodeId)
    if(baseProps){
      const nextProps = { ...baseProps }
      const branch = typeof nextProps.branch_id === 'string' ? nextProps.branch_id.trim() : (nextProps.branch_id ? String(nextProps.branch_id).trim() : '')
      if(branch){
        nextProps.branch_id = generateBranchId()
      }
      antennaSeedProps = nextProps
    } else if(!antennaSeedProps){
      antennaSeedProps = null
    }
    updatePreview()
    triggerBranchRecalc()
  }catch{}
}
