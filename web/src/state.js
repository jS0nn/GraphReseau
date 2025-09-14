import { genIdWithTime as genId, snap as snapToGrid, isCanal, vn, incrementName, defaultName } from './utils.js'
import { computeCenterFromNodes, setGeoCenter, uiPosFromNodeGPS, unprojectUIToLatLon } from './geo.js'
export { setGeoScale, setGeoCenter } from './geo.js'

// Global editor state (graph + UI)
export const state = {
  nodes: [],
  edges: [],
  selection: { nodeId: null, edgeId: null, multi: new Set() },
  clipboard: null,
  mode: 'select',
  gridStep: 8,
  _spawnIndex: 0,
  edgeVarWidth: false,
}

// Simple pub/sub to propagate updates
const listeners = new Set()
export function subscribe(fn){ listeners.add(fn); return () => listeners.delete(fn) }
function notify(event, payload){ for (const fn of listeners) fn(event, payload, state) }

// Graph setters
export function setGraph(graph){
  // Normalize nodes
  const rawNodes = Array.isArray(graph?.nodes) ? graph.nodes.slice() : []
  const nodes = rawNodes.map(n => {
    const m = { ...n }
    if(m && m.type==='COLLECTEUR') m.type='CANALISATION'
    if(m && m.type==='PLATEFORME') m.type='GENERAL'
    if(m && (m.type==='GÉNÉRAL' || m.type==='Général' || m.type==='general')) m.type='GENERAL'
    if(m && m.type==='PUITS') m.type='OUVRAGE'
    // Keep GENERAL as GENERAL in the UI; do not coerce to POINT_MESURE on load.
    // Coerce numeric fields to number or null to avoid '' roundtrip
    const numKeys = ['x','y','diameter_mm','gps_lat','gps_lon','well_pos_index','pm_pos_index','pm_offset_m','x_ui','y_ui']
    numKeys.forEach(k => {
      const val = m[k]
      if(val === '' || val === undefined || val === null){ m[k] = null; return }
      if(typeof val === 'number'){ m[k] = Number.isFinite(val) ? val : null; return }
      if(typeof val === 'string'){
        const s = val.trim().replace(',', '.')
        const norm = s.replace(/[^0-9.\-]/g, '')
        const v = parseFloat(norm)
        m[k] = Number.isFinite(v) ? v : null
        return
      }
      const v = +val
      m[k] = Number.isFinite(v) ? v : null
    })
    // Use x_ui/y_ui as position sources when present
    if(m.x == null && m.x_ui != null) m.x = m.x_ui
    if(m.y == null && m.y_ui != null) m.y = m.y_ui
    // Default GPS lock: true if GPS present; else false. Preserve existing flag.
    // Default: lock to GPS by default
    if(typeof m.gps_locked !== 'boolean') m.gps_locked = true
    return m
  })
  // If x/y are missing or incoherent (extreme), derive from GPS when available
  // Heuristic threshold: values beyond ±100k px are considered incoherent for UI
  const XY_ABS_MAX = 100000
  try{
    const center = computeCenterFromNodes(nodes)
    if(center) setGeoCenter(center.centerLat, center.centerLon)
  }catch{}
  nodes.forEach(m => {
    const xBad = !(Number.isFinite(m.x)) || Math.abs(+m.x||0) > XY_ABS_MAX
    const yBad = !(Number.isFinite(m.y)) || Math.abs(+m.y||0) > XY_ABS_MAX
    if((xBad || yBad)){
      const pos = uiPosFromNodeGPS(m)
      if(pos){ m.x = snapToGrid(pos.x, state.gridStep); m.y = snapToGrid(pos.y, state.gridStep) }
    }
    // If locked but no GPS yet, derive GPS from current UI position
    if(m.gps_locked && (m.gps_lat==null || m.gps_lon==null) && Number.isFinite(m.x) && Number.isFinite(m.y)){
      try{
        const ll = unprojectUIToLatLon(+m.x, +m.y)
        if(Number.isFinite(ll?.lat) && Number.isFinite(ll?.lon)){
          m.gps_lat = ll.lat; m.gps_lon = ll.lon
        }
      }catch{}
    }
  })
  state.nodes = nodes
  // Normalize edges to canonical from_id/to_id
  const rawEdges = Array.isArray(graph?.edges) ? graph.edges.slice() : []
  state.edges = rawEdges.map(e => ({
    id: e.id,
    from_id: e.from_id ?? e.source,
    to_id: e.to_id ?? e.target,
    active: e.active !== false,
    commentaire: (e.commentaire||''),
    geometry: Array.isArray(e.geometry) ? e.geometry : null,
    pipe_group_id: e.pipe_group_id || null,
  }))

  // Deduplicate edges by id; if same id repeats with identical from/to, keep first; otherwise reassign id
  ;(function dedupEdges(){
    const used = new Set()
    const tmp = []
    state.edges.forEach((e) => {
      const key = e.id || ''
      if(!key){ tmp.push(e); return }
      if(!used.has(key)) { used.add(key); tmp.push(e); return }
      // Duplicate id: if identical endpoints already present with same id, drop; else assign fresh id
      const existsSame = tmp.some(x => x.id===key && (x.from_id??x.source)===(e.from_id??e.source) && (x.to_id??x.target)===(e.to_id??e.target))
      if(existsSame) return
      let nid = genId('E')
      const guard = new Set(tmp.map(x=>x.id))
      let k=0
      while(guard.has(nid) && k++<5){ nid = genId('E') }
      e.id = nid
      used.add(nid)
      tmp.push(e)
    })
    state.edges = tmp
  })()

  // Fix direction for OUVRAGE↔CANALISATION edges: must be CANALISATION → OUVRAGE
  state.edges.forEach(e => {
    const a = state.nodes.find(n=>n.id===(e.from_id??e.source))
    const b = state.nodes.find(n=>n.id===(e.to_id??e.target))
    const isWell = (n)=> n?.type==='OUVRAGE'
    if(isWell(a) && isCanal(b)){
      const tmp = e.from_id; e.from_id = e.to_id; e.to_id = tmp
    }
    // Also handle potential legacy 'COLLECTEUR' types not remapped yet
    if(isWell(a) && (b?.type==='COLLECTEUR')){
      const tmp = e.from_id; e.from_id = e.to_id; e.to_id = tmp
    }
  })

  // Optional migration: convert canal nodes into edges between OUVRAGE nodes
  try{
    if(typeof window!=='undefined' && window.__PIPES_AS_EDGES__){
      const byId = new Map(state.nodes.map(n=>[n.id, n]))
      const canals = state.nodes.filter(n => n?.type==='CANALISATION' || n?.type==='COLLECTEUR')
      const newEdges = []
      for(const c of canals){
        // Determine ordered wells along this canal
        let wellIds = Array.isArray(c.collector_well_ids) ? c.collector_well_ids.slice() : []
        if(wellIds.length===0){
          // fallback: infer from existing edges canal->well sorted by y
          const neigh = state.edges
            .filter(e => (e.from_id??e.source)===c.id)
            .map(e => byId.get(e.to_id??e.target))
            .filter(n => n && n.type==='OUVRAGE')
            .sort((a,b)=> (vn(a?.y,0) - vn(b?.y,0)))
            .map(n=>n.id)
          wellIds = neigh
        }
        for(let i=0;i+1<wellIds.length;i++){
          const a = byId.get(wellIds[i])
          const b = byId.get(wellIds[i+1])
          if(a && b && a.type==='OUVRAGE' && b.type==='OUVRAGE'){
            // Avoid duplicates
            const exists = state.edges.some(e => (e.from_id??e.source)===a.id && (e.to_id??e.target)===b.id)
            if(!exists){ newEdges.push({ from_id:a.id, to_id:b.id, active:true, commentaire:'', pipe_group_id: c.branch_id || c.id || null }) }
          }
        }
        // Clear references from devices to this canal
        state.nodes.forEach(n => {
          if(n?.well_collector_id===c.id){ n.well_collector_id=''; n.well_pos_index='' }
          if(n?.pm_collector_id===c.id){ n.pm_collector_id=''; n.pm_pos_index=''; n.pm_offset_m='' }
        })
      }
      // Apply new edges
      newEdges.forEach(ne => addEdge(ne.from_id, ne.to_id, { active: ne.active, commentaire: ne.commentaire, pipe_group_id: ne.pipe_group_id }))
      // Drop edges attached to canal nodes
      state.edges = state.edges.filter(e => {
        const a = byId.get(e.from_id??e.source)
        const b = byId.get(e.to_id??e.target)
        return (a && b && a.type!=='CANALISATION' && a.type!=='COLLECTEUR' && b.type!=='CANALISATION' && b.type!=='COLLECTEUR')
      })
      // Drop canal nodes
      state.nodes = state.nodes.filter(n => !(n?.type==='CANALISATION' || n?.type==='COLLECTEUR'))
    }
  }catch{}

  // Derive collector relationships from edges if missing/empty
  const byId = new Map(state.nodes.map(n=>[n.id, n]))
  // Reset derived fields to avoid stale data
  state.nodes.forEach(n => {
    if(isCanal(n)){
      n.collector_well_ids = Array.isArray(n.collector_well_ids) ? n.collector_well_ids.slice() : []
    }
    if(n.type==='OUVRAGE'){
      n.well_collector_id = n.well_collector_id || ''
      n.well_pos_index = n.well_pos_index || null
    }
  })
  // Build mapping canal -> [wells]
  const canalToWells = new Map()
  state.edges.forEach(e => {
    const from = byId.get(e.from_id)
    const to = byId.get(e.to_id)
    if(isCanal(from) && to?.type==='OUVRAGE'){
      (canalToWells.get(from.id) || canalToWells.set(from.id, []) && canalToWells.get(from.id)).push(to.id)
    }
  })
  canalToWells.forEach((arr, canalId) => {
    const canal = byId.get(canalId)
    if(!canal) return
    // Use existing ordering if present, else sort by Y for stability
    const uniq = Array.from(new Set(arr))
    if(!Array.isArray(canal.collector_well_ids) || canal.collector_well_ids.length===0){
      uniq.sort((a,b)=> (byId.get(a)?.y??0) - (byId.get(b)?.y??0))
      canal.collector_well_ids = uniq
    }
    // Set back-references + position index
    canal.collector_well_ids.forEach((wid, i) => {
      const w = byId.get(wid)
      if(w && w.type==='OUVRAGE'){ w.well_collector_id = canal.id; w.well_pos_index = i+1 }
    })
  })
  clearSelection()
  notify('graph:set')
}

export function getGraph(){ return { nodes: state.nodes, edges: state.edges } }

// Edge thickness (UI option)
export function setEdgeThicknessEnabled(enabled){ state.edgeVarWidth = !!enabled }
export function isEdgeThicknessEnabled(){ return !!state.edgeVarWidth }

// Selection helpers
export function clearSelection(){
  state.selection.nodeId = null
  state.selection.edgeId = null
  state.selection.multi = new Set()
  notify('selection:clear')
}

export function selectNodeById(id){
  state.selection.nodeId = id
  state.selection.edgeId = null
  state.selection.multi = new Set(id ? [id] : [])
  notify('selection:node', id)
}

export function selectEdgeById(id){
  state.selection.edgeId = id
  state.selection.nodeId = null
  state.selection.multi = new Set()
  notify('selection:edge', id)
}

export function setMultiSelection(ids){
  const s = new Set(ids || [])
  state.selection.multi = s
  state.selection.nodeId = s.size===1 ? Array.from(s)[0] : null
  state.selection.edgeId = null
  notify('selection:multi', Array.from(s))
}

export function toggleMultiSelection(id){
  const s = state.selection.multi || new Set()
  if(s.has(id)) s.delete(id); else s.add(id)
  state.selection.multi = s
  state.selection.nodeId = null
  state.selection.edgeId = null
  notify('selection:multi', Array.from(s))
}

// Modes
export function setMode(m){ state.mode = m; notify('mode:set', m) }
export function getMode(){ return state.mode }

// Clipboard (copy/paste nodes only for now)
export function copySelection(){
  const ids = new Set(Array.from(state.selection.multi || []))
  const selected = state.nodes.filter(n => ids.has(n.id))
  const selEdges = state.edges.filter(e => ids.has(e.source??e.from_id) && ids.has(e.target??e.to_id))
  state.clipboard = { nodes: JSON.parse(JSON.stringify(selected)), edges: JSON.parse(JSON.stringify(selEdges)) }
  notify('clipboard:copy', { count: selected.length })
}

export function pasteClipboard(offset = { x: 24, y: 24 }){
  const clip = state.clipboard
  let clipNodes = [], clipEdges = []
  if(Array.isArray(clip)) clipNodes = clip
  else if(clip && Array.isArray(clip.nodes)) { clipNodes = clip.nodes; clipEdges = Array.isArray(clip.edges)? clip.edges : [] }
  if (!Array.isArray(clipNodes) || !clipNodes.length) return []
  const existingNames = new Set(state.nodes.map(x => x.name).filter(Boolean))
  const idMap = new Map()
  // Vary paste offset slightly per call to avoid stacking
  const pi = (state._spawnIndex = (state._spawnIndex||0) + 1)
  const extra = { x: (pi%7)*8, y: (pi%11)*8 }
  const clones = clipNodes.map((n) => {
    const baseName = n.name || n.id || 'N'
    const newName = incrementName(baseName, Array.from(existingNames))
    existingNames.add(newName)
    const node = {
      ...n,
      id: genId((n.type||'N').toUpperCase()),
      name: newName,
      x: snapToGrid((+n.x || 0) + (offset.x||0) + extra.x, state.gridStep),
      y: snapToGrid((+n.y || 0) + (offset.y||0) + extra.y, state.gridStep),
    }
    // Reset dependent relations; keep for canals to rebuild later
    if(node.type==='PUITS'){ node.well_collector_id=''; node.well_pos_index='' }
    if(node.type==='POINT_MESURE'||node.type==='VANNE'){ node.pm_collector_id=''; node.pm_pos_index=''; node.pm_offset_m='' }
    if(isCanal(node)){ node.collector_well_ids=[]; node.child_canal_ids=[] }
    idMap.set(n.id, node.id)
    return node
  })
  state.nodes.push(...clones)
  // Recreate edges among clones
  clipEdges.forEach(e => {
    const a = idMap.get(e.source??e.from_id)
    const b = idMap.get(e.target??e.to_id)
    if(a && b) addEdge(a, b, { active: (e.active!==false) })
  })
  // Rebuild canal sequences/children for cloned canals
  clipNodes.forEach(src => {
    if(!isCanal(src)) return
    const dstId = idMap.get(src.id)
    if(!dstId) return
    const dst = state.nodes.find(n=>n.id===dstId)
    if(!dst) return
    const newWells = (src.collector_well_ids||[]).map(wid => idMap.get(wid)).filter(Boolean)
    dst.collector_well_ids = newWells.slice()
    dst.collector_well_ids.forEach((wid,i)=>{
      const w = state.nodes.find(n=>n.id===wid)
      if(w){ w.well_collector_id = dst.id; w.well_pos_index = i+1 }
      if(w && !state.edges.some(e=> (e.source??e.from_id)===dst.id && (e.target??e.to_id)===wid)) addEdge(dst.id, wid, { active: true })
    })
    const newChild = (src.child_canal_ids||[]).map(cid => idMap.get(cid)).filter(Boolean)
    dst.child_canal_ids = newChild.slice()
    newChild.forEach(cid => { if(!state.edges.some(e=> (e.source??e.from_id)===dst.id && (e.target??e.to_id)===cid)) addEdge(dst.id, cid, { active:true }) })
  })
  state.selection.multi = new Set(clones.map(n => n.id))
  state.selection.nodeId = clones[0]?.id || null
  notify('clipboard:paste', { count: clones.length })
  return clones
}

// Public helper: recompute node UI positions from GPS
// - If force=true, recompute for all nodes with gps_lat/gps_lon
// - Else, only for nodes with missing/abnormal x/y
export function applyGPSPositions({ force=false } = {}){
  const XY_ABS_MAX = 100000
  try{
    const center = computeCenterFromNodes(state.nodes)
    if(center) setGeoCenter(center.centerLat, center.centerLon)
  }catch{}
  let changed = false
  state.nodes.forEach(m => {
    const xBad = force || !(Number.isFinite(m.x)) || Math.abs(+m.x||0) > XY_ABS_MAX
    const yBad = force || !(Number.isFinite(m.y)) || Math.abs(+m.y||0) > XY_ABS_MAX
    if((xBad || yBad)){
      const pos = uiPosFromNodeGPS(m)
      if(pos){ m.x = snapToGrid(pos.x, state.gridStep); m.y = snapToGrid(pos.y, state.gridStep); changed = true }
    }
  })
  if(changed) notify('graph:update')
}

// Mutators used by interactions
export function moveNode(id, dx, dy, { snap=true } = {}){
  const n = state.nodes.find(n => n.id === id)
  if (!n) return
  if(n.gps_locked){ return } // do not move GPS-locked nodes
  const nx = (+n.x || 0) + dx
  const ny = (+n.y || 0) + dy
  n.x = snap ? snapToGrid(nx, state.gridStep) : nx
  n.y = snap ? snapToGrid(ny, state.gridStep) : ny
  notify('node:move', { id, x: n.x, y: n.y })
}

export function updateNode(id, patch){
  const n = state.nodes.find(n => n.id === id)
  if (!n) return
  Object.assign(n, patch || {})
  notify('node:update', { id, patch })
}

export function addNode(partial = {}){
  const type = (partial.type==='COLLECTEUR') ? 'CANALISATION' : (partial.type || 'OUVRAGE')
  // Choose a spawn position if none provided: simple grid walk avoiding overlap
  function nextSpawn(){
    const i = state._spawnIndex++
    const gx = 120 + (i % 8) * 60
    const gy = 120 + Math.floor(i / 8) * 80
    // if conflict (too close), shift a bit
    const tooClose = (x,y)=> state.nodes.some(n => Math.abs((+n.x||0)-x) < 40 && Math.abs((+n.y||0)-y) < 40)
    let x=gx, y=gy, guard=0
    while(tooClose(x,y) && guard++<64){ x+= state.gridStep*2; y+= state.gridStep*2 }
    return { x, y }
  }
  const pos = (partial.x==null || partial.y==null) ? nextSpawn() : { x: partial.x, y: partial.y }
  const base = { id: genId(type||'N'), type, name: defaultName(type, state.nodes), x: pos.x, y: pos.y }
  const node = Object.assign(base, partial || {})
  node.type = type
  state.nodes.push(node)
  notify('node:add', node)
  return node
}

// Rename a node id and update references (edges, selection). Limited scope (recently created nodes).
export function renameNodeId(oldId, newId){
  if(!oldId || !newId) return
  if(state.nodes.some(n=>n.id===newId)) return // do not overwrite
  const n = state.nodes.find(x=>x.id===oldId)
  if(!n) return
  n.id = newId
  state.edges.forEach(e => {
    if(e.from_id===oldId) e.from_id = newId
    if(e.to_id===oldId) e.to_id = newId
  })
  if(state.selection.nodeId===oldId) state.selection.nodeId = newId
  if(state.selection.multi?.has(oldId)){
    state.selection.multi.delete(oldId); state.selection.multi.add(newId)
  }
  notify('node:update', { id: newId, patch: { id: newId } })
}

export function removeNode(id){
  const n = state.nodes.find(x=>x.id===id)
  if(!n) return
  // Cleanup relationships like legacy
  if(n.type==='OUVRAGE'){
    state.nodes.filter(isCanal).forEach(c => {
      if(Array.isArray(c.collector_well_ids)){
        c.collector_well_ids = c.collector_well_ids.filter(wid => wid !== n.id)
        c.collector_well_ids.forEach((wid,i)=>{
          const w = state.nodes.find(nn=>nn.id===wid)
          if(w){ w.well_pos_index = i+1; w.well_collector_id = c.id }
        })
      }
    })
    state.edges = state.edges.filter(e => (e.to_id??e.target) !== n.id)
  }
  if(n.type==='POINT_MESURE' || n.type==='VANNE'){
    n.pm_collector_id = ''
    n.pm_pos_index = ''
    n.pm_offset_m = ''
  }
  if(isCanal(n)){
    state.nodes.forEach(x=>{
      if(x.type==='OUVRAGE' && x.well_collector_id===n.id){ x.well_collector_id=''; x.well_pos_index='' }
      if((x.type==='POINT_MESURE'||x.type==='VANNE') && x.pm_collector_id===n.id){ x.pm_collector_id=''; x.pm_pos_index=''; x.pm_offset_m='' }
    })
    state.nodes.filter(isCanal).forEach(c=>{ if(Array.isArray(c.child_canal_ids)) c.child_canal_ids = c.child_canal_ids.filter(cid=>cid!==n.id) })
    state.edges = state.edges.filter(e => (e.from_id??e.source)!==n.id && (e.to_id??e.target)!==n.id)
  }
  // Remove the node
  state.nodes = state.nodes.filter(x=>x.id!==id)
  notify('node:remove', { id })
}

export function removeNodes(ids){
  (ids||[]).forEach(id => removeNode(id))
}

export function addEdge(source, target, partial = {}){
  // Avoid duplicate edges between same endpoints
  const dup = state.edges.find(e => (e.from_id??e.source)===source && (e.to_id??e.target)===target)
  if(dup) return dup
  // Generate a unique edge id in current state
  let id = genId('E')
  const used = new Set(state.edges.map(e => e.id))
  let retries = 0
  while(used.has(id) && retries++ < 5) id = genId('E')
  const edge = { id, from_id: source, to_id: target, active: (partial?.active!==false), commentaire: (partial?.commentaire||''), ...partial }
  state.edges.push(edge)
  notify('edge:add', edge)
  return edge
}

export function updateEdge(id, patch){
  const e = state.edges.find(e => e.id === id)
  if(!e) return
  Object.assign(e, patch||{})
  notify('edge:update', { id, patch })
}

export function removeEdge(id){
  const i = state.edges.findIndex(e => e.id === id)
  if (i < 0) return
  const e = state.edges[i]
  const from = e.source ?? e.from_id
  const to = e.target ?? e.to_id
  state.edges.splice(i, 1)
  // Cleanup relationships
  const fromNode = state.nodes.find(n=>n.id===from)
  const toNode = state.nodes.find(n=>n.id===to)
  if(fromNode && toNode){
    // canal -> well
    if(isCanal(fromNode) && toNode.type==='OUVRAGE'){
      if(Array.isArray(fromNode.collector_well_ids)){
        fromNode.collector_well_ids = fromNode.collector_well_ids.filter(x=>x!==toNode.id)
        fromNode.collector_well_ids.forEach((wid, idx)=>{
          const w = state.nodes.find(n=>n.id===wid)
          if(w){ w.well_pos_index = idx+1; w.well_collector_id = fromNode.id }
        })
      }
      toNode.well_collector_id = ''
      toNode.well_pos_index = ''
    }
    // canal -> canal
    if(isCanal(fromNode) && isCanal(toNode)){
      if(Array.isArray(fromNode.child_canal_ids)) fromNode.child_canal_ids = fromNode.child_canal_ids.filter(x=>x!==toNode.id)
    }
  }
  notify('edge:remove', { id })
}

// Domain-aware connect helpers
function ensureEdgeExists(fromId, toId){
  const exists = state.edges.some(e => (e.source??e.from_id)===fromId && (e.target??e.to_id)===toId)
  if (exists) return null
  return addEdge(fromId, toId, { active: true })
}

function ensureChildOrder(parent, child){
  if(!Array.isArray(parent.child_canal_ids)) parent.child_canal_ids = []
  // Keep only child ids that are still real canal children via an edge
  parent.child_canal_ids = parent.child_canal_ids.filter(id => state.edges.some(e => (e.source??e.from_id)===parent.id && (e.target??e.to_id)===id && isCanal(state.nodes.find(n=>n.id===id))))
  if(!parent.child_canal_ids.includes(child.id)) parent.child_canal_ids.push(child.id)
  parent.child_canal_ids.sort((a,b)=>{
    const ya = vn(state.nodes.find(n=>n.id===a)?.y, 0)
    const yb = vn(state.nodes.find(n=>n.id===b)?.y, 0)
    return ya - yb
  })
}

function appendWellToCanal(canal, well){
  // Remove from other canals first to keep a single collector per well
  state.nodes.filter(isCanal).forEach(c => {
    if(c.id===canal.id) return
    if(Array.isArray(c.collector_well_ids)){
      c.collector_well_ids = c.collector_well_ids.filter(id => id !== well.id)
    }
  })
  if(!Array.isArray(canal.collector_well_ids)) canal.collector_well_ids = []
  if(!canal.collector_well_ids.includes(well.id)) canal.collector_well_ids.push(well.id)
  // Keep only existing wells
  canal.collector_well_ids = canal.collector_well_ids.filter(id => state.nodes.some(n => n.id===id && n.type==='OUVRAGE'))
  // Re-number wells and set back-reference
  canal.collector_well_ids.forEach((id,i)=>{
    const w = state.nodes.find(n => n.id === id)
    if(w){ w.well_pos_index = i+1; w.well_collector_id = canal.id }
  })
}

function attachInlineToCanal(dev, canal){
  dev.pm_collector_id = canal.id
  const wells = (canal.collector_well_ids||[])
    .map(id => state.nodes.find(n=>n.id===id))
    .filter(Boolean)
    .sort((a,b)=> vn(a.y,0)-vn(b.y,0))
  // Place inline on segment according to vertical position: count wells above dev
  const above = wells.filter(w => vn(w.y,0) <= vn(dev.y,0)).length
  dev.pm_pos_index = Math.min(Math.max(above, 0), Math.max(wells.length, 0))
}

export function connectByRules(sourceId, targetId){
  const a = state.nodes.find(n => n.id === sourceId)
  const b = state.nodes.find(n => n.id === targetId)
  if(!a || !b || a.id===b.id) return { ok:false }
  const isInline = n => n?.type==='POINT_MESURE' || n?.type==='VANNE'
  const isRegular = n => n && !isInline(n) && n.type!=='CANALISATION' && n.type!=='COLLECTEUR'
  // New behavior (pipes as edges):
  // - Disallow any connection involving canal nodes in Connect mode
  if(a.type==='CANALISATION' || a.type==='COLLECTEUR' || b.type==='CANALISATION' || b.type==='COLLECTEUR'){
    return { ok:false }
  }
  // - Disallow inline devices here (attach via Junction/Edit modes)
  if(isInline(a) || isInline(b)) return { ok:false }
  // - Regular node ↔ Regular node: create an edge (pipeline)
  if(isRegular(a) && isRegular(b)){
    ensureEdgeExists(a.id, b.id)
    notify('graph:update')
    return { ok:true, type:'edge' }
  }
  return { ok:false }
}

// Exposed helpers for UI operations
export function moveWellToCanal(wellId, canalId, { position } = {}){
  const well = state.nodes.find(n=>n.id===wellId && n.type==='OUVRAGE')
  const canal = state.nodes.find(n=>n.id===canalId && isCanal(n))
  if(!well || !canal) return
  // Remove existing canal->well edges from other canals and any well-originating edges
  state.edges = state.edges.filter(e => {
    const from = e.from_id ?? e.source
    const to = e.to_id ?? e.target
    if(from === well.id) return false
    if(to === well.id && isCanal(state.nodes.find(n=>n.id===from)) && from !== canal.id) return false
    return true
  })
  appendWellToCanal(canal, well)
  ensureEdgeExists(canal.id, well.id)
  // Reinsert at position if provided
  if(typeof position==='number'){
    const arr = Array.isArray(canal.collector_well_ids) ? canal.collector_well_ids.slice() : []
    const cur = arr.indexOf(well.id)
    if(cur>=0){ arr.splice(cur,1); arr.splice(Math.max(0, Math.min(arr.length, position)), 0, well.id) }
    canal.collector_well_ids = arr
    arr.forEach((id,i)=>{ const w=state.nodes.find(n=>n.id===id); if(w){ w.well_pos_index = i+1; w.well_collector_id = canal.id }})
  }
  notify('node:update', { id: well.id, patch: { well_collector_id: canal.id, well_pos_index: well.well_pos_index } })
  notify('sequence:update', { canalId })
}

export function moveInlineToCanal(inlineId, canalId, posIndex){
  const dev = state.nodes.find(n=>n.id===inlineId && (n.type==='POINT_MESURE' || n.type==='VANNE'))
  const canal = state.nodes.find(n=>n.id===canalId && isCanal(n))
  if(!dev || !canal) return
  dev.pm_collector_id = canal.id
  dev.pm_pos_index = Math.max(0, +posIndex||0)
  notify('node:update', { id: dev.id, patch: { pm_collector_id: canal.id, pm_pos_index: dev.pm_pos_index } })
  notify('sequence:update', { canalId })
}

export function reorderChildCanals(parentId, orderedIds){
  const parent = state.nodes.find(n=>n.id===parentId && isCanal(n))
  if(!parent) return
  const valid = orderedIds.filter(id => state.edges.some(e => (e.source??e.from_id)===parent.id && (e.target??e.to_id)===id && isCanal(state.nodes.find(n=>n.id===id))))
  parent.child_canal_ids = valid
  notify('node:update', { id: parent.id, patch: { child_canal_ids: valid.slice() } })
}

export function reorderInlines(canalId, segmentIndex, orderedInlineIds){
  const canal = state.nodes.find(n=>n.id===canalId && isCanal(n))
  if(!canal) return
  const ids = orderedInlineIds.filter(id => {
    const x = state.nodes.find(n=>n.id===id)
    return x && (x.type==='POINT_MESURE' || x.type==='VANNE')
  })
  ids.forEach((id,i)=>{
    const d = state.nodes.find(n=>n.id===id)
    d.pm_collector_id = canal.id
    d.pm_pos_index = Math.max(0, +segmentIndex||0)
    d.pm_order = i+1
  })
  notify('graph:update')
}

// Build/apply canal sequence (legacy-like W/M/V tokens)
export function buildCanalSequence(canalId){
  const c = state.nodes.find(n=>n.id===canalId && isCanal(n))
  if(!c) return []
  const wells = (c.collector_well_ids||[]).slice()
  const pms = state.nodes.filter(n=> n.type==='POINT_MESURE' && n.pm_collector_id===c.id)
  const vans= state.nodes.filter(n=> n.type==='VANNE' && n.pm_collector_id===c.id)
  const seq=[]
  for(let i=0;i<=wells.length;i++){
    pms.filter(m => (+m.pm_pos_index||0)===i).forEach(m=>seq.push({kind:'M', id:m.id}))
    vans.filter(v => (+v.pm_pos_index||0)===i).forEach(v=>seq.push({kind:'V', id:v.id}))
    if(i<wells.length) seq.push({kind:'W', id:wells[i]})
  }
  return seq
}

export function applyCanalSequence(canalId, seq){
  const c = state.nodes.find(n=>n.id===canalId && isCanal(n))
  if(!c) return
  // Apply wells order
  c.collector_well_ids = seq.filter(t=>t.kind==='W').map(t=>t.id)
  c.collector_well_ids.forEach((id,i)=>{ const w=state.nodes.find(n=>n.id===id); if(w){ w.well_collector_id=c.id; w.well_pos_index=i+1 } })
  // Apply inline positions (count wells before)
  let wellsBefore=0
  seq.forEach(t=>{
    if(t.kind==='W'){ wellsBefore++ }
    else{
      const dev = state.nodes.find(n=>n.id===t.id && (n.type==='POINT_MESURE'||n.type==='VANNE'))
      if(dev){ dev.pm_collector_id = c.id; dev.pm_pos_index = wellsBefore }
    }
  })
  notify('sequence:update', { canalId })
}
