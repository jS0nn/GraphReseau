import { genIdWithTime as genId } from '../utils.js'

const NUMERIC_NODE_FIELDS = [
  'x',
  'y',
  'diameter_mm',
  'gps_lat',
  'gps_lon',
  'well_pos_index',
  'pm_pos_index',
  'pm_offset_m',
  'x_ui',
  'y_ui',
]

export function normalizeNumericValue(value){
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

export function normalizeEdge(raw){
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

export function dedupeEdges(edges){
  const used = new Set()
  const result = []
  for(const edge of edges){
    const key = edge.id || ''
    if(!key){
      result.push(edge)
      continue
    }
    if(!used.has(key)){
      used.add(key)
      result.push(edge)
      continue
    }
    const duplicate = result.some(e => e.id === key && (e.from_id ?? e.source) === (edge.from_id ?? edge.source) && (e.to_id ?? e.target) === (edge.to_id ?? edge.target))
    if(duplicate) continue
    let newId = genId('E')
    let guard = 0
    while(result.some(e => e.id === newId) && guard++ < 5){
      newId = genId('E')
    }
    result.push({ ...edge, id: newId })
    used.add(newId)
  }
  return result
}

function sanitizeGeometry(geom){
  if(!Array.isArray(geom) || geom.length < 2) return null
  const cleaned = []
  for(const pt of geom){
    if(!Array.isArray(pt) || pt.length < 2) continue
    const lon = +pt[0]
    const lat = +pt[1]
    if(Number.isFinite(lon) && Number.isFinite(lat)) cleaned.push([lon, lat])
  }
  return cleaned.length >= 2 ? cleaned : null
}

function sanitizeNodeForSave(node){
  const next = { ...node }
  if(next.x != null) next.x_ui = next.x
  if(next.y != null) next.y_ui = next.y
  for(const key of NUMERIC_NODE_FIELDS){
    next[key] = normalizeNumericValue(next[key])
  }
  return next
}

function sanitizeEdgeForSave(edge){
  return {
    id: edge.id,
    from_id: edge.from_id ?? edge.source,
    to_id: edge.to_id ?? edge.target,
    active: edge.active !== false,
    commentaire: edge.commentaire || '',
    geometry: sanitizeGeometry(edge.geometry),
    pipe_group_id: edge.pipe_group_id || null,
  }
}

export function sanitizeGraphPayload(graph){
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.map(sanitizeNodeForSave) : []
  const edgesRaw = Array.isArray(graph?.edges) ? graph.edges.map(sanitizeEdgeForSave) : []
  const edges = dedupeEdges(edgesRaw)
  return { nodes, edges }
}
