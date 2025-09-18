import { genIdWithTime as genId, snap as snapToGrid } from '../utils.js'
import { computeCenterFromNodes, uiPosFromNodeGPS, unprojectUIToLatLon } from '../geo.js'
import { canonicalizeNodeType, shouldFilterNode } from './graph-rules.js'
import { NODE_SIZE } from '../constants/nodes.js'
import { normalizeNumericValue, normalizeEdge, dedupeEdges } from '../shared/graph-transform.js'

export const XY_ABS_MAX = 100000
const NUMERIC_NODE_FIELDS = ['x','y','diameter_mm','gps_lat','gps_lon','well_pos_index','pm_pos_index','pm_offset_m','x_ui','y_ui']

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
  const type = String(node?.type || '').toUpperCase()
  const offsetX = (type === 'JONCTION') ? 0 : NODE_SIZE.w/2
  const offsetY = (type === 'JONCTION') ? 0 : NODE_SIZE.h/2
  const gpsOpts = center ? { centerLat: center.centerLat, centerLon: center.centerLon } : undefined

  let gpsPos = null
  if(node.gps_locked){
    gpsPos = uiPosFromNodeGPS(node, gpsOpts)
    if(gpsPos && offsetX && offsetY && Number.isFinite(+node.x) && Number.isFinite(+node.y)){
      const tol = 2
      const xVal = +node.x
      const yVal = +node.y
      const legacyDx = Math.abs(xVal - gpsPos.x)
      const legacyDy = Math.abs(yVal - gpsPos.y)
      const newDx = Math.abs(xVal - (gpsPos.x - offsetX))
      const newDy = Math.abs(yVal - (gpsPos.y - offsetY))
      if(legacyDx <= tol && legacyDy <= tol && (newDx > tol || newDy > tol)){
        try{
          const centerLL = unprojectUIToLatLon(gpsPos.x + offsetX, gpsPos.y + offsetY)
          if(Number.isFinite(centerLL?.lat) && Number.isFinite(centerLL?.lon)){
            node.gps_lat = centerLL.lat
            node.gps_lon = centerLL.lon
            gpsPos = uiPosFromNodeGPS(node, gpsOpts)
          }
        }catch{}
      }
    }
  }
  const xBad = force || !Number.isFinite(node.x) || Math.abs(+node.x || 0) > XY_ABS_MAX
  const yBad = force || !Number.isFinite(node.y) || Math.abs(+node.y || 0) > XY_ABS_MAX
  if(xBad || yBad){
    const pos = gpsPos || uiPosFromNodeGPS(node, gpsOpts)
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
      const cx = +node.x + offsetX
      const cy = +node.y + offsetY
      const ll = unprojectUIToLatLon(cx, cy)
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
