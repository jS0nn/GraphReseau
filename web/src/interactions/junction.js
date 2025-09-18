import { state, addNode, addEdge, removeEdge, updateEdge, updateNode, getMode, subscribe, renameNodeId, setMode, selectNodeById } from '../state/index.js'
import { genIdWithTime as genId } from '../utils.js'
import { projectLatLonToUI, unprojectUIToLatLon, displayXYForNode } from '../geo.js'
import { NODE_SIZE } from '../constants/nodes.js'
import { showMiniMenu } from '../ui/mini-menu.js'
import { startDrawingFromNodeId } from './draw.js'
import { devlog } from '../ui/logs.js'

function centerXY(node){
  try{
    const p = displayXYForNode(node)
    const T = String(node?.type||'').toUpperCase()
    return (T==='JONCTION') ? [ (p.x||0), (p.y||0) ] : [ (p.x||0) + NODE_SIZE.w/2, (p.y||0) + NODE_SIZE.h/2 ]
  }catch{ return [0,0] }
}

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
    // Anchor endpoints to current node centers to avoid legacy left-edge offsets
    try{
      const a = state.nodes.find(n=>n.id===(edge.from_id??edge.source))
      const b = state.nodes.find(n=>n.id===(edge.to_id??edge.target))
      if(a && pts.length){ const ca = centerXY(a); pts[0] = [ca[0], ca[1]] }
      if(b && pts.length){ const cb = centerXY(b); pts[pts.length-1] = [cb[0], cb[1]] }
    }catch{}
    return pts
  }
  // Fallback to straight segment between endpoints
  const a = state.nodes.find(n=>n.id===(edge.from_id??edge.source))
  const b = state.nodes.find(n=>n.id===(edge.to_id??edge.target))
  if(!a||!b) return []
  const ca = centerXY(a)
  const cb = centerXY(b)
  return [[ca[0], ca[1]], [cb[0], cb[1]]]
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

function splitGeometry(geom, uiPts, insert){
  // insert: { seg, t, px, py }
  const ll = unprojectUIToLatLon(insert.px, insert.py)
  const ins = [ll.lon, ll.lat]
  if(Array.isArray(geom) && geom.length>=2){
    const before = []
    const after = []
    const cutIdx = insert.seg
    for(let i=0;i<geom.length;i++){
      if(i<cutIdx) before.push(geom[i])
      else if(i>=cutIdx) after.push(geom[i])
    }
    // ensure we include insert at the boundary
    if(before.length && (before[before.length-1][0]!==ins[0] || before[before.length-1][1]!==ins[1])) before.push(ins)
    if(after.length && (after[0][0]!==ins[0] || after[0][1]!==ins[1])) after.unshift(ins)
    return { g1: before, g2: after }
  }
  // Fallback: build from endpoints using insert point
  return { g1: [geom?.[0]||ins, ins], g2: [ins, geom?.[1]||ins] }
}

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
      const pts = uiPointsForEdgeGeometry(e)
      if(pts.length<2) continue
      const hit = nearestOnPolyline(pts, ux, uy)
      // 24px tolerance
      if(hit && hit.d2 < (24*24)){
        if(!best || hit.d2 < best.hit.d2) best = { edge:e, pts, hit }
      }
    }
    if(!best) return
    const { edge, pts, hit } = best
    // Build new node at insertion
    const centerLL = unprojectUIToLatLon(hit.px, hit.py)
    const node = addNode({ type:'JONCTION', gps_lat: centerLL.lat, gps_lon: centerLL.lon, gps_locked: true, name:'' })
    // Split geometry
    let geom = Array.isArray(edge.geometry) && edge.geometry.length>=2 ? edge.geometry.slice() : null
    if(!geom){
      // create simple 2-pt geometry from endpoints
      const a = state.nodes.find(n=>n.id===(edge.from_id??edge.source))
      const b = state.nodes.find(n=>n.id===(edge.to_id??edge.target))
      const ca = centerXY(a), cb = centerXY(b)
      const A = unprojectUIToLatLon(ca[0], ca[1])
      const B = unprojectUIToLatLon(cb[0], cb[1])
      geom = [[A.lon,A.lat],[B.lon,B.lat]]
    }
    const parts = splitGeometry(geom, pts, hit)
    const fromId = edge.from_id ?? edge.source
    const toId   = edge.to_id   ?? edge.target
    // Remove old edge and add new ones
    const keepActive = edge.active!==false
    const commentaire = edge.commentaire || ''
    const pgid = edge.pipe_group_id || ''
    removeEdge(edge.id)
    const e1 = addEdge(fromId, node.id, { active: keepActive, commentaire, pipe_group_id: pgid })
    updateEdge(e1.id, { geometry: parts.g1 })
    const e2 = addEdge(node.id, toId, { active: keepActive, commentaire, pipe_group_id: pgid })
    updateEdge(e2.id, { geometry: parts.g2 })
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
