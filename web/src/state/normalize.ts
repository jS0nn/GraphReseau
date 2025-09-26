import { snap as snapToGrid, toNullableString } from '../utils.ts'
import { computeCenterFromNodes, uiPosFromNodeGPS, unprojectUIToLatLon } from '../geo.ts'
import { canonicalizeNodeType, shouldFilterNode } from './graph-rules.ts'
import { NODE_SIZE } from '../constants/nodes.ts'
import { normalizeNumericValue, normalizeEdge, dedupeEdges, normalizeBranches, normalizeCrs } from '../shared/graph-transform.ts'
import type { EdgeInput } from '../shared/graph-transform.ts'
import assignBranchIds from '../shared/branch-assign.ts'
import type { Node, Edge, Graph } from '../types/graph'

export const XY_ABS_MAX = 100000
const NUMERIC_NODE_FIELDS = ['x','y','diameter_mm','gps_lat','gps_lon','well_pos_index','pm_pos_index','pm_offset_m','x_ui','y_ui'] as const

type GeoCenter = { centerLat: number; centerLon: number }

type NodeOverride = Omit<Node,
  'gps_lat' | 'gps_lon' | 'x' | 'y' | 'x_ui' | 'y_ui' | 'diameter_mm' | 'pm_offset_m' | 'pm_pos_index' | 'well_pos_index'
>

export interface MutableNode extends NodeOverride {
  id: string
  name?: string | null
  type?: string | null
  branch_id?: string | null
  gps_lat?: number | string | null
  gps_lon?: number | string | null
  x?: number | string | null
  y?: number | string | null
  x_ui?: number | string | null
  y_ui?: number | string | null
  diameter_mm?: number | string | null
  pm_offset_m?: number | string | null
  pm_pos_index?: number | string | null
  well_pos_index?: number | string | null
  ui_diameter_mm?: number | null
  site_effective?: string | null
  site_effective_is_fallback?: boolean
  child_canal_ids?: string[] | null
  branchId?: string | null
}

export interface MutableEdge extends Omit<Edge, 'from_id' | 'to_id' | 'branch_id'> {
  id: string
  from_id: string | null
  to_id: string | null
  branch_id: string | null
  geometry?: Array<[number, number]> | null
  ui_diameter_mm?: number | null
  source?: string | null
  target?: string | null
  site_effective?: string | null
  site_effective_is_fallback?: boolean
  branchId?: string | null
}

type NormalizeOptions = { gridStep?: number }

type GraphLike = Omit<Partial<Graph>, 'nodes' | 'edges'> & {
  nodes?: Array<Partial<Node> & Record<string, unknown>>
  edges?: Array<Partial<Edge> & Record<string, unknown>>
}

export type NormalizedGraph = {
  nodes: MutableNode[]
  edges: MutableEdge[]
  geoCenter: GeoCenter | null
  meta: {
    version: string
    site_id: string | null
    generated_at: string | null
    style_meta: Record<string, unknown>
  }
  branches: ReturnType<typeof normalizeBranches>
  crs: ReturnType<typeof normalizeCrs>
}

function normalizeNode(raw: Partial<Node> & Record<string, unknown>): MutableNode {
  const node: MutableNode = { ...raw } as MutableNode
  const canonicalType = canonicalizeNodeType(node.type)
  if(canonicalType) node.type = canonicalType
  for(const key of NUMERIC_NODE_FIELDS){
    node[key] = normalizeNumericValue(node[key])
  }
  delete node.lat
  delete node.lon
  if(node.x == null && node.x_ui != null) node.x = node.x_ui
  if(node.y == null && node.y_ui != null) node.y = node.y_ui
  if(typeof node.gps_locked !== 'boolean') node.gps_locked = true
  const type = String(node.type || '').toUpperCase()
  if(type !== 'CANALISATION'){
    node.diameter_mm = null
    node.material = ''
  }else{
    if(node.diameter_mm == null) node.diameter_mm = null
    if(node.material == null) node.material = ''
  }
  return node
}

function safeGeoCenter(nodes: readonly MutableNode[]): GeoCenter | null {
  try{
    const center = computeCenterFromNodes(nodes)
    if(center && Number.isFinite(center.centerLat) && Number.isFinite(center.centerLon)) return center
  }catch{}
  return null
}

function backfillNodePosition(
  node: MutableNode,
  step: number,
  { force = false, center = null }: { force?: boolean; center?: GeoCenter | null } = {},
): boolean {
  let changed = false
  const prevX = Number(node.x ?? NaN)
  const prevY = Number(node.y ?? NaN)
  const type = String(node?.type || '').toUpperCase()
  const offsetX = (type === 'JONCTION') ? 0 : NODE_SIZE.w/2
  const offsetY = (type === 'JONCTION') ? 0 : NODE_SIZE.h/2
  const gpsOpts = center ? { centerLat: center.centerLat, centerLon: center.centerLon } : undefined

  let gpsPos: { x: number; y: number } | null = null
  const numericX = Number(node.x ?? NaN)
  const numericY = Number(node.y ?? NaN)

  if(node.gps_locked){
    gpsPos = uiPosFromNodeGPS(node, gpsOpts)
    if(gpsPos && offsetX && offsetY && Number.isFinite(numericX) && Number.isFinite(numericY)){
      const tol = 2
      const xVal = numericX
      const yVal = numericY
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
  const xBad = force || !Number.isFinite(numericX) || Math.abs(Number.isFinite(numericX) ? numericX : 0) > XY_ABS_MAX
  const yBad = force || !Number.isFinite(numericY) || Math.abs(Number.isFinite(numericY) ? numericY : 0) > XY_ABS_MAX
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
  if(node.gps_locked && (node.gps_lat == null || node.gps_lon == null) && Number.isFinite(numericX) && Number.isFinite(numericY)){
    try{
      const cx = numericX + offsetX
      const cy = numericY + offsetY
      const ll = unprojectUIToLatLon(cx, cy)
      if(Number.isFinite(ll?.lat) && Number.isFinite(ll?.lon)){
        node.gps_lat = ll.lat
        node.gps_lon = ll.lon
      }
    }catch{}
  }
  return changed
}

export function normalizeGraph(input: unknown, { gridStep = 8 }: NormalizeOptions = {}): NormalizedGraph {
  const graph = (input ?? {}) as GraphLike | null | undefined
  const step = Number.isFinite(gridStep) && gridStep > 0 ? gridStep : 8
  const rawNodes = Array.isArray(graph?.nodes) ? (graph.nodes as Array<Partial<Node> & Record<string, unknown>>).slice() : []
  const nodes: MutableNode[] = rawNodes.map(normalizeNode)
  const geoCenter = safeGeoCenter(nodes)
  for(const node of nodes){ backfillNodePosition(node, step, { center: geoCenter }) }
  const rawEdges = Array.isArray(graph?.edges) ? (graph.edges as Array<Partial<Edge> & Record<string, unknown>>).slice() : []
  const edges = dedupeEdges(rawEdges.map(normalizeEdge)) as MutableEdge[]
  assignBranchIds(nodes, edges)
  const filteredNodes = nodes.filter(node => !shouldFilterNode({ type: node?.type })) as MutableNode[]
  repairInlineAnchors(filteredNodes, edges)
  applyDerivedGraphData(graph, filteredNodes, edges)
  const meta = {
    version: typeof graph?.version === 'string' && graph.version ? graph.version : '1.5',
    site_id: graph?.site_id || null,
    generated_at: graph?.generated_at || null,
    style_meta: (graph && typeof graph.style_meta === 'object' && graph.style_meta) ? JSON.parse(JSON.stringify(graph.style_meta)) : {},
  }
  const branchNames = (() => {
    if(graph?.style_meta && typeof graph.style_meta === 'object'){
      const metaObj = graph.style_meta as Record<string, unknown>
      const names = metaObj.branch_names_by_id
      if(names && typeof names === 'object') return names as Record<string, unknown>
    }
    return null
  })()
  const branches = normalizeBranches(graph?.branches ?? null, edges as unknown as EdgeInput[], branchNames)
  const crs = normalizeCrs(graph?.crs)
  return { nodes: filteredNodes, edges, geoCenter, meta, branches, crs }
}

export function reprojectNodesFromGPS(
  nodes: Iterable<MutableNode>,
  { gridStep = 8, force = false }: { gridStep?: number; force?: boolean } = {},
): { changed: boolean; geoCenter: GeoCenter | null } {
  const step = Number.isFinite(gridStep) && gridStep > 0 ? gridStep : 8
  const list = Array.isArray(nodes) ? nodes : Array.from(nodes)
  const center = safeGeoCenter(list)
  let changed = false
  for(const node of list){
    if(!node) continue
    if(backfillNodePosition(node, step, { force, center })) changed = true
  }
  return { changed, geoCenter: center }
}

function applyDerivedGraphData(graph: GraphLike | null | undefined, nodes: MutableNode[], edges: MutableEdge[]): void {
  const graphSite = toNullableString(graph?.site_id)
  const hasGraphSite = !!graphSite

  for(const node of nodes){
    const own = toNullableString(node?.site_id)
    const effective = own ?? graphSite
    node.site_effective = effective
    node.site_effective_is_fallback = !own && hasGraphSite
  }

  propagateEdgeDiameter(nodes, edges)

  for(const edge of edges){
    const own = toNullableString(edge?.site_id)
    const effective = own ?? graphSite
    edge.site_effective = effective
    edge.site_effective_is_fallback = !own && hasGraphSite
  }
}

function propagateEdgeDiameter(nodes: MutableNode[], edges: MutableEdge[]): void {
  const incoming = new Map<string, MutableEdge[]>()
  const outgoing = new Map<string, MutableEdge[]>()

  for(const edge of edges){
    const from = (edge.from_id ?? edge.source) as string | undefined | null
    const to = (edge.to_id ?? edge.target) as string | undefined | null
    if(!from || !to) continue
    if(!incoming.has(to)) incoming.set(to, [])
    const incomingList = incoming.get(to)
    if(incomingList) incomingList.push(edge)
    if(!outgoing.has(from)) outgoing.set(from, [])
    const outgoingList = outgoing.get(from)
    if(outgoingList) outgoingList.push(edge)
    const diaValue = Number(edge.diameter_mm)
    const dia = Number.isFinite(diaValue) && diaValue > 0 ? diaValue : null
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
      const parentVal = Number(parentEdge?.ui_diameter_mm)
      if(parentEdge && Number.isFinite(parentVal) && parentVal > 0){
        inherited = parentVal
      }
    }
    const children = outgoing.get(nid) || []
    for(const edge of children){
      const uiVal = Number(edge?.ui_diameter_mm)
      if(edge && (!Number.isFinite(uiVal) || uiVal <= 0) && inherited != null && inherited > 0){
        edge.ui_diameter_mm = inherited
      }
      const nextId = edge?.to_id ?? edge?.target
      if(nextId) queue.push(nextId)
    }
  }
}

const INLINE_TYPES: ReadonlySet<string> = new Set(['POINT_MESURE', 'VANNE'])

const EARTH_RADIUS_M = 6371000

function toRad(deg: number): number { return deg * Math.PI / 180 }

function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const phi1 = toRad(lat1)
  const phi2 = toRad(lat2)
  const dPhi = toRad(lat2 - lat1)
  const dLambda = toRad(lon2 - lon1)
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_M * c
}

function geometryLengthMetersLocal(geometry: MutableEdge['geometry']): number | null {
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

function offsetAlongGeometryLocal(edge: MutableEdge, node: MutableNode): number | null {
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

  const toXY = (lonDeg: number, latDeg: number) => {
    const phi = toRad(latDeg)
    const lambda = toRad(lonDeg)
    const x = EARTH_RADIUS_M * (lambda - refLambda) * Math.cos(refPhi)
    const y = EARTH_RADIUS_M * (phi - refPhi)
    return { x, y }
  }

  const nodeXY = toXY(nodeLon, nodeLat)
  let accumulated = 0
  let bestOffset: number | null = null
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

function repairInlineAnchors(nodes: MutableNode[], edges: MutableEdge[]): void {
  const edgeById = new Map<string, MutableEdge>()
  const incoming = new Map<string, MutableEdge[]>()
  for(const edge of edges){
    if(!edge || !edge.id) continue
    edgeById.set(edge.id, edge)
    const to = edge.to_id ?? edge.target
    if(!to) continue
    if(!incoming.has(to)) incoming.set(to, [])
    const list = incoming.get(to)
    if(list) list.push(edge)
  }

  const roundMeters = (value: number | null | undefined): number | null => {
    const num = Number(value)
    if(!Number.isFinite(num)) return null
    return Math.round(num * 100) / 100
  }

  for(const node of nodes){
    if(!node || !node.id) continue
    const type = String(node.type || '').toUpperCase()
    if(!INLINE_TYPES.has(type)) continue

    const anchorIdRaw = node.pm_collector_edge_id || node.attach_edge_id || ''
    let anchorId = typeof anchorIdRaw === 'string' ? anchorIdRaw.trim() : ''
    let edge = anchorId ? edgeById.get(anchorId) ?? null : null
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
    }else if(node.pm_offset_m == null || (typeof node.pm_offset_m === 'string' && node.pm_offset_m.trim() === '')){
      node.pm_offset_m = null
    }
  }
}
