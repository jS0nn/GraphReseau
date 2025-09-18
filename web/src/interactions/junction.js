import { state, addNode, addEdge, removeEdge, updateEdge, updateNode, getMode, subscribe, renameNodeId, setMode, selectNodeById, suspendOrphanPrune } from '../state/index.js'
import { genIdWithTime as genId } from '../utils.js'
import { unprojectUIToLatLon } from '../geo.js'
import { showMiniMenu } from '../ui/mini-menu.js'
import { startDrawingFromNodeId } from './draw.js'
import { devlog } from '../ui/logs.js'
import { centerUIForNode, edgeGeometryToUIPoints, nearestPointOnPolyline, splitGeometryAt, ensureEdgeGeometry } from '../shared/geometry.js'

function eventToUI(evt){
  try{ if(window.__leaflet_map){ const pt=window.__leaflet_map.mouseEventToContainerPoint(evt); return [pt.x,pt.y] } }catch{}
  const svg=document.getElementById('svg'); const r=svg.getBoundingClientRect()
  const px = evt.clientX - r.left, py = evt.clientY - r.top
  try{ const t = window.d3?.zoomTransform?.(svg); if(t && typeof t.invert==='function'){ const p=t.invert([px,py]); return [p[0], p[1]] } }catch{}
  return [px, py]
}

export function attachJunction(){
  const svg = document.getElementById('svg')
  if(!svg) return
  svg.addEventListener('click', (ev)=>{
    if(getMode()!=='junction') return
    const [ux, uy] = eventToUI(ev)
    // Find nearest edge with a polyline
    let best=null
    for(const e of state.edges){
      const pts = edgeGeometryToUIPoints(e, state.nodes)
      if(pts.length<2) continue
      const hit = nearestPointOnPolyline(pts, ux, uy)
      // 24px tolerance
      if(hit && hit.d2 < (24*24)){
        if(!best || hit.d2 < best.hit.d2) best = { edge:e, hit }
      }
    }
    if(!best) return
    const { edge, hit } = best
    // Build new node at insertion
    const centerLL = unprojectUIToLatLon(hit.px, hit.py)
    const node = addNode({ type:'JONCTION', gps_lat: centerLL.lat, gps_lon: centerLL.lon, gps_locked: true, name:'', x: hit.px, y: hit.py })
    // Split geometry
    const geom = ensureEdgeGeometry(edge, state.nodes)
    if(!geom) return
    const parts = splitGeometryAt(geom, hit)
    const fromId = edge.from_id ?? edge.source
    const toId   = edge.to_id   ?? edge.target
    // Remove old edge and add new ones
    const keepActive = edge.active!==false
    const commentaire = edge.commentaire || ''
    const pgid = edge.pipe_group_id || ''
    let e1 = null
    let e2 = null
    suspendOrphanPrune(()=>{
      removeEdge(edge.id)
      e1 = addEdge(fromId, node.id, { active: keepActive, commentaire, pipe_group_id: pgid })
      if(e1?.id){ updateEdge(e1.id, { geometry: parts.g1 }) }
      e2 = addEdge(node.id, toId, { active: keepActive, commentaire, pipe_group_id: pgid })
      if(e2?.id){ updateEdge(e2.id, { geometry: parts.g2 }) }
    })
    devlog('junction:split', edge.id, '->', e1.id, e2.id, 'new node', node.id)
    // Mini menu: choose type + optionally start antenna
    const x = ev.clientX, y = ev.clientY
    function inheritBranchAttrs(targetId){
      try{
        const n = state.nodes.find(nn=>nn.id===targetId); if(!n) return
        // Attach to branch: prefer pipe_group_id, else new split edges id, else original edge id
        const branchId = edge.pipe_group_id || e1?.id || e2?.id || edge.id
        n.branch_id = branchId
        // Inherit diameter from the branch if available: look for a neighbor CANALISATION on either endpoint
        const fromNode = state.nodes.find(nn=>nn.id===fromId)
        const toNode = state.nodes.find(nn=>nn.id===toId)
        const candidates = [fromNode?.diameter_mm, toNode?.diameter_mm]
          .map(v => {
            const num = Number(v)
            return Number.isFinite(num) && num > 0 ? num : null
          })
          .filter(v => v != null)
        if(candidates.length){ n.diameter_mm = candidates[0] }
        updateNode(targetId, { branch_id: n.branch_id, diameter_mm: n.diameter_mm })
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
  }, true)

  // Clear any transient UI when leaving mode
  subscribe((evt, payload)=>{ if(evt==='mode:set' && payload!=='junction'){ /* no overlay to clear yet */ } })
}
