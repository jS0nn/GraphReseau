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
  if(node.type !== 'CANALISATION'){
    node.diameter_mm = null
    node.sdr_ouvrage = ''
    node.material = ''
  }
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
  repairInlineAnchors(filteredNodes, edges)
  applyDerivedGraphData(graph, filteredNodes, edges)
  const meta = {
    version: typeof graph?.version === 'string' && graph.version ? graph.version : '1.5',
    site_id: graph?.site_id || null,
    generated_at: graph?.generated_at || null,
    style_meta: (graph && typeof graph.style_meta === 'object' && graph.style_meta) ? JSON.parse(JSON.stringify(graph.style_meta)) : {},
  }
  return { nodes: filteredNodes, edges, geoCenter, meta }
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

function applyDerivedGraphData(graph, nodes, edges){
  const graphSite = (graph && typeof graph.site_id !== 'undefined') ? graph.site_id : null
  const hasGraphSite = graphSite !== null && graphSite !== undefined && String(graphSite).trim() !== ''

  for(const node of nodes){
    const own = (node && node.site_id != null && String(node.site_id).trim() !== '') ? node.site_id : null
    const effective = own ?? (hasGraphSite ? graphSite : null)
    node.site_effective = effective
    node.site_effective_is_fallback = !own && hasGraphSite
  }

  propagateEdgeDiameter(nodes, edges)

  for(const edge of edges){
    const own = (edge && edge.site_id != null && String(edge.site_id).trim() !== '') ? edge.site_id : null
    const effective = own ?? (hasGraphSite ? graphSite : null)
    edge.site_effective = effective
    edge.site_effective_is_fallback = !own && hasGraphSite
  }
}

function propagateEdgeDiameter(nodes, edges){
  const incoming = new Map()
  const outgoing = new Map()

  for(const edge of edges){
    const from = edge.from_id ?? edge.source
    const to = edge.to_id ?? edge.target
    if(!from || !to) continue
    if(!incoming.has(to)) incoming.set(to, [])
    incoming.get(to).push(edge)
    if(!outgoing.has(from)) outgoing.set(from, [])
    outgoing.get(from).push(edge)
    const dia = Number.isFinite(+edge.diameter_mm) && +edge.diameter_mm > 0 ? +edge.diameter_mm : null
    edge.ui_diameter_mm = dia
  }

  const nodeIds = new Set(nodes.map(n => n.id))
  const roots = new Set(nodeIds)
  for(const id of incoming.keys()){
    roots.delete(id)
  }

  const queue = Array.from(roots)
  const visited = new Set()
  while(queue.length){
    const nid = queue.shift()
    if(!nid || visited.has(nid)) continue
    visited.add(nid)
    const parents = incoming.get(nid) || []
    let inherited = null
    if(parents.length === 1){
      const parentEdge = parents[0]
      if(parentEdge && Number.isFinite(+parentEdge.ui_diameter_mm) && +parentEdge.ui_diameter_mm > 0){
        inherited = +parentEdge.ui_diameter_mm
      }
    }
    const children = outgoing.get(nid) || []
    for(const edge of children){
      if(edge && (!Number.isFinite(+edge.ui_diameter_mm) || +edge.ui_diameter_mm <= 0) && inherited != null && inherited > 0){
        edge.ui_diameter_mm = inherited
      }
      const nextId = edge?.to_id ?? edge?.target
      if(nextId) queue.push(nextId)
    }
  }
}

const INLINE_TYPES = new Set(['POINT_MESURE', 'VANNE'])

const EARTH_RADIUS_M = 6371000

function toRad(deg){ return deg * Math.PI / 180 }

function haversineMeters(lon1, lat1, lon2, lat2){
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const dPhi = toRad(lat2 - lat1)
  const dLambda = toRad(lon2 - lon1)
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_M * c
}

function geometryLengthMetersLocal(geometry){
  if(!Array.isArray(geometry) || geometry.length < 2) return null
  let total = 0
  for(let i = 1; i < geometry.length; i++){
    const prev = geometry[i - 1]
    const curr = geometry[i]
    if(!Array.isArray(prev) || !Array.isArray(curr)) continue
    const lon1 = Number(prev[0])
    const lat1 = Number(prev[1])
    const lon2 = Number(curr[0])
    const lat2 = Number(curr[1])
    if(!Number.isFinite(lon1) || !Number.isFinite(lat1) || !Number.isFinite(lon2) || !Number.isFinite(lat2)) continue
    total += haversineMeters(lon1, lat1, lon2, lat2)
  }
  return total || null
}

function offsetAlongGeometryLocal(edge, node){
  const geometry = edge?.geometry
  if(!Array.isArray(geometry) || geometry.length < 2) return null
  const nodeLat = Number(node?.gps_lat)
  const nodeLon = Number(node?.gps_lon)
  if(!Number.isFinite(nodeLat) || !Number.isFinite(nodeLon)) return null

  const first = geometry[0]
  const refLat = Number(first?.[1])
  const refLon = Number(first?.[0])
  if(!Number.isFinite(refLat) || !Number.isFinite(refLon)) return null
  const refPhi = toRad(refLat)
  const refLambda = toRad(refLon)

  const toXY = (lonDeg, latDeg) => {
    const phi = toRad(latDeg)
    const lambda = toRad(lonDeg)
    const x = EARTH_RADIUS_M * (lambda - refLambda) * Math.cos(refPhi)
    const y = EARTH_RADIUS_M * (phi - refPhi)
    return { x, y }
  }

  const nodeXY = toXY(nodeLon, nodeLat)
  let accumulated = 0
  let bestOffset = null
  let bestDistSq = Infinity

  for(let i = 1; i < geometry.length; i++){
    const prev = geometry[i - 1]
    const curr = geometry[i]
    const lon1 = Number(prev?.[0])
    const lat1 = Number(prev?.[1])
    const lon2 = Number(curr?.[0])
    const lat2 = Number(curr?.[1])
    if(!Number.isFinite(lon1) || !Number.isFinite(lat1) || !Number.isFinite(lon2) || !Number.isFinite(lat2)) continue

    const a = toXY(lon1, lat1)
    const b = toXY(lon2, lat2)
    const abx = b.x - a.x
    const aby = b.y - a.y
    const apx = nodeXY.x - a.x
    const apy = nodeXY.y - a.y
    const denom = abx * abx + aby * aby
    const segLength = Math.sqrt(denom)
    if(segLength === 0){
      continue
    }
    let t = (apx * abx + apy * aby) / denom
    if(t < 0) t = 0
    if(t > 1) t = 1
    const projX = a.x + t * abx
    const projY = a.y + t * aby
    const dx = nodeXY.x - projX
    const dy = nodeXY.y - projY
    const distSq = dx * dx + dy * dy
    const offsetHere = accumulated + segLength * t
    if(distSq < bestDistSq){
      bestDistSq = distSq
      bestOffset = offsetHere
    }
    accumulated += segLength
  }

  return bestOffset
}

function repairInlineAnchors(nodes, edges){
  const edgeById = new Map()
  const incoming = new Map()
  for(const edge of edges){
    if(!edge || !edge.id) continue
    edgeById.set(edge.id, edge)
    const to = edge.to_id ?? edge.target
    if(!to) continue
    if(!incoming.has(to)) incoming.set(to, [])
    incoming.get(to).push(edge)
  }

  const roundMeters = (value) => {
    if(!Number.isFinite(value)) return null
    return Math.round(value * 100) / 100
  }

  for(const node of nodes){
    if(!node || !node.id) continue
    const type = String(node.type || '').toUpperCase()
    if(!INLINE_TYPES.has(type)) continue

    const anchorIdRaw = node.pm_collector_edge_id || node.attach_edge_id || ''
    let anchorId = typeof anchorIdRaw === 'string' ? anchorIdRaw.trim() : ''
    let edge = anchorId ? edgeById.get(anchorId) : null
    if(!edge || (edge.to_id ?? edge.target) !== node.id){
      const incomingEdges = incoming.get(node.id) || []
      edge = incomingEdges[0] || null
      anchorId = edge?.id || ''
      node.pm_collector_edge_id = anchorId
      node.attach_edge_id = anchorId
    }

    if(!edge){
      node.pm_collector_edge_id = ''
      node.attach_edge_id = ''
      node.pm_offset_m = null
      continue
    }

    const offset = offsetAlongGeometryLocal(edge, node)
    if(offset != null){
      const length = geometryLengthMetersLocal(edge.geometry)
      let adjusted = Math.max(0, offset)
      if(length != null && adjusted > length) adjusted = length
      node.pm_offset_m = roundMeters(adjusted)
    }else if(node.pm_offset_m == null || node.pm_offset_m === ''){
      node.pm_offset_m = null
    }
  }
}
