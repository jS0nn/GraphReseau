import { displayXYForNode, projectLatLonToUI, unprojectUIToLatLon } from '../geo.js'
import { NODE_SIZE } from '../constants/nodes.js'

function toNodeLookup(nodes){
  if(nodes instanceof Map) return nodes
  const lookup = new Map()
  for(const node of nodes || []){
    if(node && node.id) lookup.set(node.id, node)
  }
  return lookup
}

export function centerUIForNode(node){
  try{
    const p = displayXYForNode(node)
    const type = String(node?.type || '').toUpperCase()
    if(type === 'JONCTION') return [ (p.x || 0), (p.y || 0) ]
    return [ (p.x || 0) + NODE_SIZE.w / 2, (p.y || 0) + NODE_SIZE.h / 2 ]
  }catch{
    return [0, 0]
  }
}

export function edgeGeometryToUIPoints(edge, nodes){
  const lookup = toNodeLookup(nodes)
  const geometry = Array.isArray(edge?.geometry) && edge.geometry.length >= 2 ? edge.geometry : null
  const pts = []
  if(geometry){
    for(const g of geometry){
      if(!Array.isArray(g) || g.length < 2) continue
      const lon = +g[0]
      const lat = +g[1]
      if(Number.isFinite(lon) && Number.isFinite(lat)){
        const p = projectLatLonToUI(lat, lon)
        pts.push([p.x, p.y])
      }
    }
  }
  const fromId = edge?.from_id ?? edge?.source
  const toId = edge?.to_id ?? edge?.target
  const fromNode = lookup.get(fromId)
  const toNode = lookup.get(toId)
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

export function nearestPointOnPolyline(pts, x, y){
  let best = null
  for(let i = 1; i < pts.length; i++){
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

export function ensureEdgeGeometry(edge, nodes){
  if(Array.isArray(edge?.geometry) && edge.geometry.length >= 2){
    return edge.geometry
  }
  const lookup = toNodeLookup(nodes)
  const fromId = edge?.from_id ?? edge?.source
  const toId = edge?.to_id ?? edge?.target
  const fromNode = lookup.get(fromId)
  const toNode = lookup.get(toId)
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

export function splitGeometryAt(geometry, hit){
  if(!geometry || !hit) return { g1: [], g2: [] }
  const insertionLL = unprojectUIToLatLon(hit.px, hit.py)
  const ins = [insertionLL.lon, insertionLL.lat]
  if(Array.isArray(geometry) && geometry.length >= 2){
    const before = []
    const after = []
    const rawIndex = Number.isFinite(hit?.seg) ? Math.round(hit.seg) : 1
    const segIndex = Math.min(Math.max(rawIndex, 1), geometry.length - 1)
    for(let i = 0; i < geometry.length; i++){
      if(i < segIndex) before.push(geometry[i])
      else after.push(geometry[i])
    }
    if(before.length && (before[before.length - 1][0] !== ins[0] || before[before.length - 1][1] !== ins[1])) before.push(ins)
    if(after.length && (after[0][0] !== ins[0] || after[0][1] !== ins[1])) after.unshift(ins)
    return { g1: before, g2: after }
  }
  return { g1: [geometry?.[0] || ins, ins], g2: [ins, geometry?.[1] || ins] }
}
