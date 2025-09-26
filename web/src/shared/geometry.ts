import { projectLatLonToUI, unprojectUIToLatLon } from '../geo.ts'
import { getNodeCanvasPosition, getNodeCenterPosition, isGraphView } from '../view/view-mode.ts'

export type NodeLike = {
  id?: string
  gps_lat?: number | string | null
  gps_lon?: number | string | null
  type?: string | null
  x?: number | string | null
  y?: number | string | null
}

export type GeometryPoint = [number, number]

export type EdgeLike = {
  id?: string | null
  geometry?: Array<[number | string, number | string]> | null
  from_id?: string | null
  to_id?: string | null
  source?: string | null
  target?: string | null
}

export type UIPoint = [number, number]

function toNodeLookup(nodes: Iterable<NodeLike> | Map<string, NodeLike>): Map<string, NodeLike> {
  if(nodes instanceof Map) return nodes
  const lookup = new Map<string, NodeLike>()
  for(const node of nodes || []){
    if(node && node.id) lookup.set(node.id, node)
  }
  return lookup
}

export function centerUIForNode(node: NodeLike | null | undefined): UIPoint {
  try{
    const c = getNodeCenterPosition(node)
    return [c.x || 0, c.y || 0]
  }catch{
    return [0, 0]
  }
}

export function edgeGeometryToUIPoints(edge: EdgeLike | null | undefined, nodes: Iterable<NodeLike> | Map<string, NodeLike>): UIPoint[] {
  const lookup = toNodeLookup(nodes)
  const useGeometry = !isGraphView() && Array.isArray(edge?.geometry) && edge!.geometry!.length >= 2
  const geometry = useGeometry ? edge?.geometry ?? null : null
  const pts: UIPoint[] = []
  if(geometry){
    for(const g of geometry){
      if(!Array.isArray(g) || g.length < 2) continue
      const lon = Number(g[0])
      const lat = Number(g[1])
      if(Number.isFinite(lon) && Number.isFinite(lat)){
        const p = projectLatLonToUI(lat, lon)
        pts.push([p.x, p.y])
      }
    }
  }
  const fromId = (edge?.from_id ?? edge?.source) || null
  const toId = (edge?.to_id ?? edge?.target) || null
  const fromNode = fromId ? lookup.get(fromId) : null
  const toNode = toId ? lookup.get(toId) : null
  if(pts.length < 2){
    if(fromNode && toNode){
      const a = centerUIForNode(fromNode)
      const b = centerUIForNode(toNode)
      return [a, b]
    }
    return []
  }
  if(fromNode){
    const anchor = centerUIForNode(fromNode)
    pts[0] = [anchor[0], anchor[1]]
  }
  if(toNode){
    const anchor = centerUIForNode(toNode)
    pts[pts.length - 1] = [anchor[0], anchor[1]]
  }
  return pts
}

export type PolylineHit = { seg: number; t: number; d2: number; px: number; py: number } | null

export function nearestPointOnPolyline(pts: UIPoint[], x: number, y: number): PolylineHit {
  let best: PolylineHit = null
  for(let i = 1; i < pts.length; i += 1){
    const ax = pts[i - 1][0]
    const ay = pts[i - 1][1]
    const bx = pts[i][0]
    const by = pts[i][1]
    const abx = bx - ax
    const aby = by - ay
    const apx = x - ax
    const apy = y - ay
    const denom = abx * abx + aby * aby || 1
    let t = (apx * abx + apy * aby) / denom
    if(t < 0) t = 0
    if(t > 1) t = 1
    const px = ax + t * abx
    const py = ay + t * aby
    const dx = x - px
    const dy = y - py
    const d2 = dx * dx + dy * dy
    if(!best || d2 < best.d2){
      best = { seg: i, t, d2, px, py }
    }
  }
  return best
}

export function ensureEdgeGeometry(edge: EdgeLike | null | undefined, nodes: Iterable<NodeLike> | Map<string, NodeLike>): Array<[number, number]> | null {
  if(isGraphView()) return null
  if(Array.isArray(edge?.geometry) && edge!.geometry!.length >= 2){
    return edge!.geometry as Array<[number, number]>
  }
  const lookup = toNodeLookup(nodes)
  const fromId = (edge?.from_id ?? edge?.source) || null
  const toId = (edge?.to_id ?? edge?.target) || null
  const fromNode = fromId ? lookup.get(fromId) : null
  const toNode = toId ? lookup.get(toId) : null
  if(!fromNode || !toNode) return null
  const a = centerUIForNode(fromNode)
  const b = centerUIForNode(toNode)
  const A = unprojectUIToLatLon(a[0], a[1])
  const B = unprojectUIToLatLon(b[0], b[1])
  if(!A || !B) return null
  return [
    [A.lon, A.lat],
    [B.lon, B.lat],
  ]
}

export function splitGeometryAt(geometry: Array<[number, number]> | null | undefined, hit: PolylineHit): { g1: Array<[number, number]>; g2: Array<[number, number]> } {
  if(!geometry || !hit) return { g1: [], g2: [] }
  const insertionLL = unprojectUIToLatLon(hit.px, hit.py)
  const ins: [number, number] = [insertionLL.lon, insertionLL.lat]
  if(Array.isArray(geometry) && geometry.length >= 2){
    const before: Array<[number, number]> = []
    const after: Array<[number, number]> = []
    const rawIndex = Number.isFinite(hit?.seg) ? Math.round(hit.seg) : 1
    const segIndex = Math.min(Math.max(rawIndex, 1), geometry.length - 1)
    for(let i = 0; i < geometry.length; i += 1){
      if(i < segIndex) before.push(geometry[i])
      else after.push(geometry[i])
    }
    if(before.length && (before[before.length - 1][0] !== ins[0] || before[before.length - 1][1] !== ins[1])) before.push(ins)
    if(after.length && (after[0][0] !== ins[0] || after[0][1] !== ins[1])) after.unshift(ins)
    return { g1: before, g2: after }
  }
  return { g1: [geometry?.[0] || ins, ins], g2: [ins, geometry?.[1] || ins] }
}

const EARTH_RADIUS_M = 6371000

function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = Math.PI / 180
  const phi1 = lat1 * toRad
  const phi2 = lat2 * toRad
  const dPhi = (lat2 - lat1) * toRad
  const dLambda = (lon2 - lon1) * toRad
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_M * c
}

export function geometryLengthMeters(geometry: Array<[number | string, number | string]> | null | undefined): number | null {
  if(!Array.isArray(geometry) || geometry.length < 2) return null
  let total = 0
  for(let i = 1; i < geometry.length; i += 1){
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

export function offsetAlongGeometry(edge: EdgeLike | null | undefined, node: NodeLike | null | undefined): number | null {
  if(!edge || !Array.isArray(edge?.geometry) || edge.geometry.length < 2) return null
  const lat = Number(node?.gps_lat)
  const lon = Number(node?.gps_lon)
  if(!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const uiPolyline: UIPoint[] = []
  for(const pt of edge.geometry){
    if(!Array.isArray(pt) || pt.length < 2) continue
    const lonPt = Number(pt[0])
    const latPt = Number(pt[1])
    if(!Number.isFinite(lonPt) || !Number.isFinite(latPt)) continue
    const projected = projectLatLonToUI(latPt, lonPt)
    uiPolyline.push([projected.x, projected.y])
  }
  if(uiPolyline.length < 2) return null
  const nodeUI = projectLatLonToUI(lat, lon)
  const hit = nearestPointOnPolyline(uiPolyline, nodeUI.x, nodeUI.y)
  if(!hit) return null
  let total = 0
  const segIndex = Math.max(1, Math.min(hit.seg, (edge.geometry?.length ?? 1) - 1))
  for(let i = 1; i < segIndex; i += 1){
    const prev = edge.geometry![i - 1]
    const curr = edge.geometry![i]
    total += haversineMeters(Number(prev[0]), Number(prev[1]), Number(curr[0]), Number(curr[1]))
  }
  const start = edge.geometry![segIndex - 1]
  const end = edge.geometry![segIndex]
  const segLength = haversineMeters(Number(start[0]), Number(start[1]), Number(end[0]), Number(end[1]))
  const t = Number.isFinite(hit.t) ? Math.max(0, Math.min(1, hit.t)) : 0
  total += segLength * t
  return total
}
