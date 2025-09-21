import { genIdWithTime as genId, snap as snapToGrid, incrementName, defaultName } from '../utils.js'
import { setGeoCenter as applyGeoCenter } from '../geo.js'
import { normalizeGraph, reprojectNodesFromGPS } from './normalize.js'
import { enforceEdgeOnlyNodeType } from './graph-rules.js'
import { recomputeBranches } from '../api.js'

export { setGeoScale, setGeoCenter } from '../geo.js'

export const state = {
  nodes: [],
  edges: [],
  graphMeta: {
    version: '1.5',
    site_id: null,
    generated_at: null,
    style_meta: {},
  },
  branchDiagnostics: [],
  branchChanges: [],
  branchConflicts: [],
  selection: { nodeId: null, edgeId: null, multi: new Set() },
  clipboard: null,
  mode: 'select',
  viewMode: 'geo',
  gridStep: 8,
  _spawnIndex: 0,
  edgeVarWidth: true,
}

const GLOBAL_BRANCH_KEY = '__global__'
const manualEdgeDefaults = new Map()

const canonBranchId = (value) => {
  const txt = (value == null) ? '' : String(value).trim()
  return txt || null
}

const manualKey = (branchId) => canonBranchId(branchId) || GLOBAL_BRANCH_KEY

const normaliseMaterial = (value) => {
  if(value == null || value === '') return null
  const txt = String(value).trim()
  return txt ? txt.toUpperCase() : null
}

const normaliseSdr = (value) => {
  if(value == null || value === '') return null
  const txt = String(value).trim()
  return txt ? txt.toUpperCase() : null
}

function insertManualDefaults(branchId, patch){
  const key = manualKey(branchId)
  const current = manualEdgeDefaults.get(key) || {}
  const next = { ...current }

  if(Object.prototype.hasOwnProperty.call(patch, 'diameter_mm')){
    const val = patch.diameter_mm
    if(val == null || val === ''){
      delete next.diameter_mm
    }else{
      const num = Number(val)
      if(Number.isFinite(num) && num > 0){
        next.diameter_mm = num
      }
    }
  }

  if(Object.prototype.hasOwnProperty.call(patch, 'material')){
    const mat = normaliseMaterial(patch.material)
    if(mat){ next.material = mat } else { delete next.material }
  }

  if(Object.prototype.hasOwnProperty.call(patch, 'sdr')){
    const sdr = normaliseSdr(patch.sdr)
    if(sdr){ next.sdr = sdr } else { delete next.sdr }
  }

  if(Object.keys(next).length){
    manualEdgeDefaults.set(key, next)
  }else{
    manualEdgeDefaults.delete(key)
  }
}

function fetchManualDefaults(branchId){
  const key = manualKey(branchId)
  const direct = manualEdgeDefaults.get(key)
  if(direct) return direct
  return manualEdgeDefaults.get(GLOBAL_BRANCH_KEY) || null
}

function getViewportCenter(){
  try{
    const svg = document.getElementById('svg')
    const canvas = document.getElementById('canvas')
    if(!svg || !canvas) return null
    const rectSvg = svg.getBoundingClientRect()
    const rectCanvas = canvas.getBoundingClientRect()
    const px = (rectCanvas.left + rectCanvas.width / 2) - rectSvg.left
    const py = (rectCanvas.top + rectCanvas.height / 2) - rectSvg.top
    const d3 = window.d3
    if(d3 && typeof d3.zoomTransform === 'function'){
      const transform = d3.zoomTransform(svg)
      if(transform && typeof transform.invert === 'function'){
        const [cx, cy] = transform.invert([px, py])
        return { x: snapToGrid(cx, state.gridStep), y: snapToGrid(cy, state.gridStep) }
      }
    }
    return { x: snapToGrid(px, state.gridStep), y: snapToGrid(py, state.gridStep) }
  }catch{
    return null
  }
}

export function clearManualDiameter(){
  manualEdgeDefaults.clear()
}

export function recordManualDiameter(branchId, diameter){
  insertManualDefaults(branchId, { diameter_mm: diameter })
}

export function getManualDiameter(branchId){
  const defaults = fetchManualDefaults(branchId)
  return defaults?.diameter_mm ?? null
}

export function recordManualEdgeProps(branchId, patch){
  if(!patch || typeof patch !== 'object') return
  insertManualDefaults(branchId, patch)
}

export function getManualEdgeProps(branchId){
  const defaults = fetchManualDefaults(branchId)
  return defaults ? { ...defaults } : null
}

const listeners = new Set()
export function subscribe(fn){ listeners.add(fn); return () => listeners.delete(fn) }
function notify(event, payload){ for(const fn of listeners) fn(event, payload, state) }

const REMOVABLE_NODE_TYPES = new Set(['JONCTION', 'JUNCTION'])
let isPruningOrphans = false
let pruneSuspendCount = 0
let prunePending = false
let pruneScheduled = false

function shouldAutoRemoveNode(node){
  if(!node || !node.id) return false
  const type = String(node.type || '').toUpperCase()
  if(REMOVABLE_NODE_TYPES.has(type)) return true
  const name = typeof node.name === 'string' ? node.name.trim() : ''
  if(!type && !name) return true
  return false
}

export function pruneOrphanNodes(){
  prunePending = false
  pruneScheduled = false
  if(isPruningOrphans) return
  isPruningOrphans = true
  try{
    while(true){
      const connected = new Set()
      for(const edge of state.edges){
        if(!edge) continue
        const fromId = edge.from_id ?? edge.source
        const toId = edge.to_id ?? edge.target
        if(fromId) connected.add(fromId)
        if(toId) connected.add(toId)
      }
      const toRemove = []
      for(const node of state.nodes){
        if(!node?.id) continue
        if(connected.has(node.id)) continue
        if(!shouldAutoRemoveNode(node)) continue
        toRemove.push(node.id)
      }
      if(!toRemove.length) break
      for(const id of toRemove){
        const idx = state.nodes.findIndex(n => n && n.id === id)
        if(idx < 0) continue
        state.nodes.splice(idx, 1)
        if(state.selection.nodeId === id){
          selectNodeById(null)
        }else if(state.selection.multi && state.selection.multi.has(id)){
          const remaining = Array.from(state.selection.multi).filter(x => x !== id)
          setMultiSelection(remaining)
        }
        notify('node:remove', { id })
      }
    }
  }finally{
    isPruningOrphans = false
  }
}

export function suspendOrphanPrune(fn){
  pruneSuspendCount++
  try{
    return typeof fn === 'function' ? fn() : undefined
  }finally{
    pruneSuspendCount = Math.max(0, pruneSuspendCount - 1)
    if(pruneSuspendCount === 0 && prunePending){
      scheduleOrphanPrune()
    }
  }
}

function scheduleOrphanPrune(){
  if(pruneSuspendCount > 0){
    prunePending = true
    return
  }
  if(pruneScheduled) return
  pruneScheduled = true
  const run = ()=>{
    if(pruneSuspendCount > 0){
      pruneScheduled = false
      prunePending = true
      return
    }
    pruneOrphanNodes()
  }
  if(typeof queueMicrotask === 'function'){ queueMicrotask(run) }
  else setTimeout(run, 0)
}

let branchRecalcScheduled = false

function buildGraphForBranchRecalc(){
  return {
    version: state.graphMeta?.version || '1.5',
    site_id: state.graphMeta?.site_id || null,
    generated_at: state.graphMeta?.generated_at || null,
    style_meta: state.graphMeta?.style_meta || {},
    nodes: state.nodes,
    edges: state.edges,
  }
}

function scheduleBranchRecalc(){
  if(branchRecalcScheduled) return
  branchRecalcScheduled = true
  const run = async () => {
    branchRecalcScheduled = false
    try{
      const result = await recomputeBranches(buildGraphForBranchRecalc())
      if(Array.isArray(result?.edges)){
        const branchMap = new Map(result.edges.map(e => [e.id, e.branch_id]))
        state.edges.forEach(edge => {
          const updated = branchMap.get(edge.id)
          if(updated !== undefined) edge.branch_id = updated
        })
      }
      if(Array.isArray(result?.nodes)){
        const nodeMap = new Map(result.nodes.map(n => [n.id, n.branch_id]))
        state.nodes.forEach(node => {
          const updated = nodeMap.get(node.id)
          if(updated !== undefined) node.branch_id = updated
        })
      }
      state.branchDiagnostics = result?.branch_diagnostics || []
      state.branchChanges = result?.branch_changes || []
      state.branchConflicts = result?.branch_conflicts || []
      notify('graph:branches', {
        diagnostics: state.branchDiagnostics,
        changes: state.branchChanges,
        conflicts: state.branchConflicts,
      })
    }catch(err){
      console.warn('[branch] recompute failed', err)
    }
  }
  if(typeof queueMicrotask === 'function') queueMicrotask(run)
  else setTimeout(run, 0)
}

export function triggerBranchRecalc(){
  scheduleBranchRecalc()
}

export function setGraph(graph){
  const { nodes, edges, geoCenter, meta } = normalizeGraph(graph, { gridStep: state.gridStep })
  state.nodes = nodes
  state.edges = edges
  state.graphMeta = Object.assign({
    version: '1.5',
    site_id: null,
    generated_at: null,
    style_meta: {},
  }, meta || {})
  clearSelection()
  if(geoCenter) applyGeoCenter(geoCenter.centerLat, geoCenter.centerLon)
  pruneOrphanNodes()
  clearManualDiameter()
  notify('graph:set')
  scheduleBranchRecalc()
}

export function getGraph(){
  return {
    version: state.graphMeta?.version ?? '1.5',
    site_id: state.graphMeta?.site_id ?? null,
    generated_at: state.graphMeta?.generated_at ?? null,
    style_meta: state.graphMeta?.style_meta ?? {},
    nodes: state.nodes,
    edges: state.edges,
  }
}

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

export function setViewMode(mode){
  if(!mode) return
  const next = String(mode)
  if(state.viewMode === next) return
  state.viewMode = next
  notify('view:set', next)
}

export function getViewMode(){ return state.viewMode }

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
  scheduleBranchRecalc()
}

export function addNode(partial = {}){
  const type = enforceEdgeOnlyNodeType(partial.type || 'OUVRAGE')
  function nextSpawn(){
    const idx = state._spawnIndex++
    const center = getViewportCenter()
    if(center) return center
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
  const relatedEdges = state.edges.filter(e => (e.from_id ?? e.source) === id || (e.to_id ?? e.target) === id)
  relatedEdges.forEach(edge => {
    if(edge?.id){
      removeEdge(edge.id)
    }
  })
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
    created_at: partial?.created_at || new Date().toISOString(),
    ...partial,
  }
  if(!edge.created_at) edge.created_at = new Date().toISOString()
  state.edges.push(edge)
  notify('edge:add', edge)
  scheduleBranchRecalc()
  return edge
}

export function updateEdge(id, patch){
  const edge = state.edges.find(e => e.id === id)
  if(!edge) return
  Object.assign(edge, patch || {})
  notify('edge:update', { id, patch })
  scheduleBranchRecalc()
}

export function removeEdge(id){
  const index = state.edges.findIndex(e => e.id === id)
  if(index < 0) return
  state.edges.splice(index, 1)
  notify('edge:remove', { id })
  scheduleOrphanPrune()
  scheduleBranchRecalc()
}

export function flipEdgeDirection(id){
  const edge = state.edges.find(e => e.id === id)
  if(!edge) return
  const from = edge.from_id ?? edge.source
  const to = edge.to_id ?? edge.target
  if(!from || !to) return
  edge.from_id = to
  edge.to_id = from
  if('source' in edge) edge.source = edge.from_id
  if('target' in edge) edge.target = edge.to_id
  if(Array.isArray(edge.geometry)){
    edge.geometry = edge.geometry.slice().reverse()
  }
  notify('edge:flip', { id, from_id: edge.from_id, to_id: edge.to_id })
  scheduleBranchRecalc()
}
