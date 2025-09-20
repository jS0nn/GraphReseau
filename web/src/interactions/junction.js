import { state, addNode, addEdge, removeEdge, updateEdge, updateNode, getMode, subscribe, renameNodeId, setMode, selectNodeById, suspendOrphanPrune } from '../state/index.js'
import { genIdWithTime as genId, isCanal } from '../utils.js'
import { unprojectUIToLatLon } from '../geo.js'
import { showMiniMenu } from '../ui/mini-menu.js'
import { startDrawingFromNodeId } from './draw.js'
import { devlog } from '../ui/logs.js'
import { centerUIForNode, edgeGeometryToUIPoints, nearestPointOnPolyline, splitGeometryAt, ensureEdgeGeometry } from '../shared/geometry.js'

const JUNCTION_TOLERANCE = 24

const finiteDiameter = (value) => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}

function pickEdgeProps(edge){
  if(!edge) return null
  const diameter_mm = finiteDiameter(edge.diameter_mm)
  const material = edge.material || ''
  const sdr = edge.sdr || ''
  if(diameter_mm == null && !material && !sdr) return null
  return { diameter_mm, material, sdr }
}

function mergeEdgeProps(target, props){
  if(!props) return target
  if(props.diameter_mm != null) target.diameter_mm = props.diameter_mm
  if(props.material) target.material = props.material
  if(props.sdr) target.sdr = props.sdr
  return target
}

function eventToUI(evt){
  try{ if(window.__leaflet_map){ const pt=window.__leaflet_map.mouseEventToContainerPoint(evt); return [pt.x,pt.y] } }catch{}
  const svg=document.getElementById('svg'); const r=svg.getBoundingClientRect()
  const px = evt.clientX - r.left, py = evt.clientY - r.top
  try{ const t = window.d3?.zoomTransform?.(svg); if(t && typeof t.invert==='function'){ const p=t.invert([px,py]); return [p[0], p[1]] } }catch{}
  return [px, py]
}

function findNearestEdgeHitForJunction(ux, uy){
  let best = null
  for(const edge of state.edges){
    const pts = edgeGeometryToUIPoints(edge, state.nodes)
    if(pts.length < 2) continue
    const hit = nearestPointOnPolyline(pts, ux, uy)
    if(hit && hit.d2 < (JUNCTION_TOLERANCE*JUNCTION_TOLERANCE)){
      if(!best || hit.d2 < best.hit.d2) best = { edge, hit }
    }
  }
  return best
}

function insertJunctionAt(edge, hit, ev){
  if(!edge || !hit || !ev) return false
  const centerLL = unprojectUIToLatLon(hit.px, hit.py)
  const node = addNode({ type:'JONCTION', gps_lat: centerLL.lat, gps_lon: centerLL.lon, gps_locked: true, name:'', x: hit.px, y: hit.py })
  const geom = ensureEdgeGeometry(edge, state.nodes)
  if(!geom) return false
  const parts = splitGeometryAt(geom, hit)
  const fromId = edge.from_id ?? edge.source
  const toId   = edge.to_id   ?? edge.target
  const keepActive = edge.active !== false
  const commentaire = edge.commentaire || ''
  const pgid = edge.pipe_group_id || ''
  const baseProps = pickEdgeProps(edge)
  const branchId = edge.branch_id || pgid || edge.id
  let e1 = null
  let e2 = null
  const buildEdgeOpts = () => {
    const opts = { active: keepActive, commentaire, pipe_group_id: pgid }
    if(branchId) opts.branch_id = branchId
    mergeEdgeProps(opts, baseProps)
    return opts
  }
  suspendOrphanPrune(()=>{
    removeEdge(edge.id)
    e1 = addEdge(fromId, node.id, buildEdgeOpts())
    if(e1?.id){ updateEdge(e1.id, { geometry: parts.g1 }) }
    e2 = addEdge(node.id, toId, buildEdgeOpts())
    if(e2?.id){ updateEdge(e2.id, { geometry: parts.g2 }) }
  })
  if(branchId) updateNode(node.id, { branch_id: branchId })
  devlog('junction:split', edge.id, '->', e1?.id, e2?.id, 'new node', node.id)

  const { clientX: x, clientY: y } = ev

  function inheritBranchAttrs(targetId){
    try{
      const n = state.nodes.find(nn=>nn.id===targetId); if(!n) return
      const nextBranchId = edge.pipe_group_id || e1?.id || e2?.id || edge.id
      n.branch_id = nextBranchId
      const fromNode = state.nodes.find(nn=>nn.id===fromId)
      const toNode = state.nodes.find(nn=>nn.id===toId)
      const canalNeighbors = [fromNode, toNode].filter(isCanal)
      const diameterCandidates = canalNeighbors
        .map(nn => finiteDiameter(nn?.diameter_mm))
        .filter(v => v != null)
      const materialCandidate = canalNeighbors.map(nn => nn?.material).find(val => val)
      const sdrCandidate = canalNeighbors.map(nn => nn?.sdr_ouvrage).find(val => val)
      const patch = { branch_id: n.branch_id }
      if(diameterCandidates.length){ patch.diameter_mm = diameterCandidates[0] }
      else if(baseProps?.diameter_mm != null){ patch.diameter_mm = baseProps.diameter_mm }
      if(materialCandidate){ patch.material = materialCandidate }
      else if(baseProps?.material){ patch.material = baseProps.material }
      if(sdrCandidate){ patch.sdr_ouvrage = sdrCandidate }
      else if(baseProps?.sdr){ patch.sdr_ouvrage = baseProps.sdr }
      updateNode(targetId, patch)
    }catch{}
  }

  function attachInlineToEdge(inlineId){
    try{
      const fromNode = state.nodes.find(nn=>nn.id===fromId)
      const toNode = state.nodes.find(nn=>nn.id===toId)
      const anchorEdgeId = e1?.id || e2?.id || edge.id
      const candidates = [fromNode?.diameter_mm, toNode?.diameter_mm]
        .map(v => {
          const num = Number(v)
          return Number.isFinite(num) && num > 0 ? num : null
        })
        .filter(v => v != null)
      const patch = { pm_collector_edge_id: anchorEdgeId }
      if(candidates.length){ Object.assign(patch, { diameter_mm: candidates[0] }) }
      updateNode(inlineId, patch)
    }catch(err){ try{ console.debug('[dev] attachInlineToEdge error', err) }catch{} }
  }

  showMiniMenu(x, y, [
    { label: 'Jonction', onClick: ()=> { updateNode(node.id, { type:'JONCTION' }); try{ setMode('select') }catch{} } },
    { label: 'Point de mesure', onClick: ()=> { const nid = genId('POINT_MESURE'); renameNodeId(node.id, nid); updateNode(nid, { type:'POINT_MESURE', gps_lat: centerLL.lat, gps_lon: centerLL.lon, gps_locked: true }); inheritBranchAttrs(nid); attachInlineToEdge(nid); try{ setMode('select'); selectNodeById(nid) }catch{} } },
    { label: 'Vanne', onClick: ()=> { const nid = genId('VANNE'); renameNodeId(node.id, nid); updateNode(nid, { type:'VANNE', gps_lat: centerLL.lat, gps_lon: centerLL.lon, gps_locked: true }); inheritBranchAttrs(nid); attachInlineToEdge(nid); try{ setMode('select'); selectNodeById(nid) }catch{} } },
    { label: 'Démarrer une antenne', onClick: ()=> { try{ setMode('draw') }catch{} startDrawingFromNodeId(node.id) } },
  ])

  return true
}

function handleJunctionEvent(ev){
  if(!ev) return false
  const [ux, uy] = eventToUI(ev)
  const found = findNearestEdgeHitForJunction(ux, uy)
  if(!found) return false
  return insertJunctionAt(found.edge, found.hit, ev)
}

export function attachJunction(){
  const svg = document.getElementById('svg')
  if(!svg) return

  svg.addEventListener('click', (ev)=>{
    if(getMode()!=='junction') return
    const inserted = handleJunctionEvent(ev)
    if(inserted){ ev.preventDefault(); ev.stopPropagation() }
  }, true)

  svg.addEventListener('contextmenu', (ev)=>{
    if(getMode()!=='select') return
    const inserted = handleJunctionEvent(ev)
    if(inserted){ ev.preventDefault(); ev.stopPropagation() }
  }, true)

  // Clear any transient UI when leaving mode
  subscribe((evt, payload)=>{ if(evt==='mode:set' && payload!=='junction'){ /* no overlay to clear yet */ } })
}
