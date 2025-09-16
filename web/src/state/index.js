import { genIdWithTime as genId, snap as snapToGrid, incrementName, defaultName } from '../utils.js'
import { setGeoCenter as applyGeoCenter } from '../geo.js'
import { normalizeGraph, reprojectNodesFromGPS } from './normalize.js'
import { enforceEdgeOnlyNodeType } from './graph-rules.js'

export { setGeoScale, setGeoCenter } from '../geo.js'

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

const listeners = new Set()
export function subscribe(fn){ listeners.add(fn); return () => listeners.delete(fn) }
function notify(event, payload){ for(const fn of listeners) fn(event, payload, state) }

export function setGraph(graph){
  const { nodes, edges, geoCenter } = normalizeGraph(graph, { gridStep: state.gridStep })
  state.nodes = nodes
  state.edges = edges
  clearSelection()
  if(geoCenter) applyGeoCenter(geoCenter.centerLat, geoCenter.centerLon)
  notify('graph:set')
}

export function getGraph(){ return { nodes: state.nodes, edges: state.edges } }

export function setEdgeThicknessEnabled(enabled){ state.edgeVarWidth = !!enabled }
export function isEdgeThicknessEnabled(){ return !!state.edgeVarWidth }

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
  const multi = new Set(ids || [])
  state.selection.multi = multi
  state.selection.nodeId = multi.size === 1 ? Array.from(multi)[0] : null
  state.selection.edgeId = null
  notify('selection:multi', Array.from(multi))
}

export function toggleMultiSelection(id){
  const multi = state.selection.multi || new Set()
  if(multi.has(id)) multi.delete(id); else multi.add(id)
  state.selection.multi = multi
  state.selection.nodeId = null
  state.selection.edgeId = null
  notify('selection:multi', Array.from(multi))
}

export function setMode(mode){ state.mode = mode; notify('mode:set', mode) }
export function getMode(){ return state.mode }

export function copySelection(){
  const ids = new Set(Array.from(state.selection.multi || []))
  const selectedNodes = state.nodes.filter(n => ids.has(n.id))
  const selectedEdges = state.edges.filter(e => ids.has(e.source ?? e.from_id) && ids.has(e.target ?? e.to_id))
  state.clipboard = {
    nodes: JSON.parse(JSON.stringify(selectedNodes)),
    edges: JSON.parse(JSON.stringify(selectedEdges)),
  }
  notify('clipboard:copy', { count: selectedNodes.length })
}

export function pasteClipboard(offset = { x: 24, y: 24 }){
  const clip = state.clipboard
  let clipNodes = []
  let clipEdges = []
  if(Array.isArray(clip)){
    clipNodes = clip
  }else if(clip && Array.isArray(clip.nodes)){
    clipNodes = clip.nodes
    clipEdges = Array.isArray(clip.edges) ? clip.edges : []
  }
  if(!Array.isArray(clipNodes) || !clipNodes.length) return []
  const existingNames = new Set(state.nodes.map(n => n.name).filter(Boolean))
  const idMap = new Map()
  const spawnIndex = (state._spawnIndex = (state._spawnIndex || 0) + 1)
  const extraOffset = { x: (spawnIndex % 7) * 8, y: (spawnIndex % 11) * 8 }
  const clones = clipNodes.map((node) => {
    const baseName = node.name || node.id || 'N'
    const newName = incrementName(baseName, Array.from(existingNames))
    existingNames.add(newName)
    const clone = {
      ...node,
      id: genId((node.type || 'N').toUpperCase()),
      name: newName,
      x: snapToGrid((+node.x || 0) + (offset.x || 0) + extraOffset.x, state.gridStep),
      y: snapToGrid((+node.y || 0) + (offset.y || 0) + extraOffset.y, state.gridStep),
    }
    if(clone.type === 'PUITS'){ clone.well_collector_id = ''; clone.well_pos_index = '' }
    if(clone.type === 'POINT_MESURE' || clone.type === 'VANNE'){
      clone.pm_collector_id = ''
      clone.pm_pos_index = ''
      clone.pm_offset_m = ''
    }
    idMap.set(node.id, clone.id)
    return clone
  })
  state.nodes.push(...clones)
  clipEdges.forEach(edge => {
    const fromId = idMap.get(edge.source ?? edge.from_id)
    const toId = idMap.get(edge.target ?? edge.to_id)
    if(fromId && toId) addEdge(fromId, toId, { active: edge.active !== false })
  })
  state.selection.multi = new Set(clones.map(n => n.id))
  state.selection.nodeId = clones[0]?.id || null
  notify('clipboard:paste', { count: clones.length })
  return clones
}

export function applyGPSPositions({ force=false } = {}){
  const { changed, geoCenter } = reprojectNodesFromGPS(state.nodes, { gridStep: state.gridStep, force })
  if(geoCenter) applyGeoCenter(geoCenter.centerLat, geoCenter.centerLon)
  if(changed) notify('graph:update')
}

export function moveNode(id, dx, dy, { snap=true } = {}){
  const node = state.nodes.find(n => n.id === id)
  if(!node) return
  if(node.gps_locked) return
  const nextX = (+node.x || 0) + dx
  const nextY = (+node.y || 0) + dy
  node.x = snap ? snapToGrid(nextX, state.gridStep) : nextX
  node.y = snap ? snapToGrid(nextY, state.gridStep) : nextY
  notify('node:move', { id, x: node.x, y: node.y })
}

export function updateNode(id, patch){
  const node = state.nodes.find(n => n.id === id)
  if(!node) return
  Object.assign(node, patch || {})
  notify('node:update', { id, patch })
}

export function addNode(partial = {}){
  const type = enforceEdgeOnlyNodeType(partial.type || 'OUVRAGE')
  function nextSpawn(){
    const idx = state._spawnIndex++
    const baseX = 120 + (idx % 8) * 60
    const baseY = 120 + Math.floor(idx / 8) * 80
    const tooClose = (x, y) => state.nodes.some(n => Math.abs((+n.x || 0) - x) < 40 && Math.abs((+n.y || 0) - y) < 40)
    let x = baseX
    let y = baseY
    let guard = 0
    while(tooClose(x, y) && guard++ < 64){ x += state.gridStep * 2; y += state.gridStep * 2 }
    return { x, y }
  }
  const position = (partial.x == null || partial.y == null) ? nextSpawn() : { x: partial.x, y: partial.y }
  const base = {
    id: genId(type || 'N'),
    type,
    name: defaultName(type, state.nodes),
    x: position.x,
    y: position.y,
  }
  const node = Object.assign(base, partial || {})
  node.type = enforceEdgeOnlyNodeType(node.type)
  state.nodes.push(node)
  notify('node:add', node)
  return node
}

export function renameNodeId(oldId, newId){
  if(!oldId || !newId) return
  if(state.nodes.some(n => n.id === newId)) return
  const node = state.nodes.find(n => n.id === oldId)
  if(!node) return
  node.id = newId
  state.edges.forEach(edge => {
    if(edge.from_id === oldId) edge.from_id = newId
    if(edge.to_id === oldId) edge.to_id = newId
  })
  if(state.selection.nodeId === oldId) state.selection.nodeId = newId
  if(state.selection.multi?.has(oldId)){
    state.selection.multi.delete(oldId)
    state.selection.multi.add(newId)
  }
  notify('node:update', { id: newId, patch: { id: newId } })
}

export function removeNode(id){
  const node = state.nodes.find(n => n.id === id)
  if(!node) return
  if(node.type === 'POINT_MESURE' || node.type === 'VANNE'){
    node.pm_collector_id = ''
    node.pm_pos_index = ''
    node.pm_offset_m = ''
  }
  state.nodes = state.nodes.filter(n => n.id !== id)
  notify('node:remove', { id })
}

export function removeNodes(ids){
  for(const id of ids || []) removeNode(id)
}

export function addEdge(source, target, partial = {}){
  const exists = state.edges.find(e => (e.from_id ?? e.source) === source && (e.to_id ?? e.target) === target)
  if(exists) return exists
  let id = genId('E')
  const used = new Set(state.edges.map(e => e.id))
  let guard = 0
  while(used.has(id) && guard++ < 5) id = genId('E')
  const edge = {
    id,
    from_id: source,
    to_id: target,
    active: partial?.active !== false,
    commentaire: partial?.commentaire || '',
    ...partial,
  }
  state.edges.push(edge)
  notify('edge:add', edge)
  return edge
}

export function updateEdge(id, patch){
  const edge = state.edges.find(e => e.id === id)
  if(!edge) return
  Object.assign(edge, patch || {})
  notify('edge:update', { id, patch })
}

export function removeEdge(id){
  const index = state.edges.findIndex(e => e.id === id)
  if(index < 0) return
  state.edges.splice(index, 1)
  notify('edge:remove', { id })
}
