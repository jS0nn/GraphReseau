import { genIdWithTime as genId, snap as snapToGrid } from '../utils.js'
import { computeCenterFromNodes, uiPosFromNodeGPS, unprojectUIToLatLon } from '../geo.js'
import { canonicalizeNodeType, shouldFilterNode } from './graph-rules.js'

export const XY_ABS_MAX = 100000
const NUMERIC_NODE_FIELDS = ['x','y','diameter_mm','gps_lat','gps_lon','well_pos_index','pm_pos_index','pm_offset_m','x_ui','y_ui']

function normalizeNumericValue(value){
  if(value === '' || value === undefined || value === null) return null
  if(typeof value === 'number') return Number.isFinite(value) ? value : null
  if(typeof value === 'string'){
    const norm = value.trim().replace(',', '.').replace(/[^0-9.\-]/g, '')
    const parsed = parseFloat(norm)
    return Number.isFinite(parsed) ? parsed : null
  }
  const parsed = +value
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeNode(raw){
  const node = { ...raw }
  const canonicalType = canonicalizeNodeType(node.type)
  if(canonicalType) node.type = canonicalType
  for(const key of NUMERIC_NODE_FIELDS){
    node[key] = normalizeNumericValue(node[key])
  }
  if(node.x == null && node.x_ui != null) node.x = node.x_ui
  if(node.y == null && node.y_ui != null) node.y = node.y_ui
  if(typeof node.gps_locked !== 'boolean') node.gps_locked = true
  return node
}

function normalizeEdge(raw){
  return {
    id: raw.id,
    from_id: raw.from_id ?? raw.source,
    to_id: raw.to_id ?? raw.target,
    active: raw.active !== false,
    commentaire: raw.commentaire || '',
    geometry: Array.isArray(raw.geometry) ? raw.geometry : null,
    pipe_group_id: raw.pipe_group_id || null,
  }
}

function dedupeEdges(edges){
  const used = new Set()
  const result = []
  for(const edge of edges){
    const key = edge.id || ''
    if(!key){ result.push(edge); continue }
    if(!used.has(key)){
      used.add(key)
      result.push(edge)
      continue
    }
    const duplicate = result.some(e => e.id === key && (e.from_id ?? e.source) === (edge.from_id ?? edge.source) && (e.to_id ?? e.target) === (edge.to_id ?? edge.target))
    if(duplicate) continue
    let newId = genId('E')
    let guard = 0
    while(result.some(e => e.id === newId) && guard++ < 5){ newId = genId('E') }
    edge.id = newId
    used.add(newId)
    result.push(edge)
  }
  return result
}

function safeGeoCenter(nodes){
  try{
    const center = computeCenterFromNodes(nodes)
    if(center && Number.isFinite(center.centerLat) && Number.isFinite(center.centerLon)) return center
  }catch{}
  return null
}

function backfillNodePosition(node, step, { force=false, center=null } = {}){
  let changed = false
  const prevX = node.x
  const prevY = node.y
  const xBad = force || !Number.isFinite(node.x) || Math.abs(+node.x || 0) > XY_ABS_MAX
  const yBad = force || !Number.isFinite(node.y) || Math.abs(+node.y || 0) > XY_ABS_MAX
  if(xBad || yBad){
    const pos = uiPosFromNodeGPS(node, center ? { centerLat: center.centerLat, centerLon: center.centerLon } : undefined)
    if(pos){
      const nextX = snapToGrid(pos.x, step)
      const nextY = snapToGrid(pos.y, step)
      if(!Number.isFinite(prevX) || !Number.isFinite(prevY) || prevX !== nextX || prevY !== nextY){
        changed = true
      }
      node.x = nextX
      node.y = nextY
    }
  }
  if(node.gps_locked && (node.gps_lat == null || node.gps_lon == null) && Number.isFinite(node.x) && Number.isFinite(node.y)){
    try{
      const ll = unprojectUIToLatLon(+node.x, +node.y)
      if(Number.isFinite(ll?.lat) && Number.isFinite(ll?.lon)){
        node.gps_lat = ll.lat
        node.gps_lon = ll.lon
      }
    }catch{}
  }
  return changed
}

export function normalizeGraph(graph, { gridStep=8 } = {}){
  const step = Number.isFinite(gridStep) && gridStep > 0 ? gridStep : 8
  const rawNodes = Array.isArray(graph?.nodes) ? graph.nodes.slice() : []
  const nodes = rawNodes.map(normalizeNode)
  const geoCenter = safeGeoCenter(nodes)
  for(const node of nodes){ backfillNodePosition(node, step, { center: geoCenter }) }
  const rawEdges = Array.isArray(graph?.edges) ? graph.edges.slice() : []
  const edges = dedupeEdges(rawEdges.map(normalizeEdge))
  const filteredNodes = nodes.filter(n => !shouldFilterNode(n))
  return { nodes: filteredNodes, edges, geoCenter }
}

export function reprojectNodesFromGPS(nodes, { gridStep=8, force=false } = {}){
  const step = Number.isFinite(gridStep) && gridStep > 0 ? gridStep : 8
  const list = Array.isArray(nodes) ? nodes : []
  const center = safeGeoCenter(list)
  let changed = false
  for(const node of list){
    if(!node) continue
    if(backfillNodePosition(node, step, { force, center })) changed = true
  }
  return { changed, geoCenter: center }
}
