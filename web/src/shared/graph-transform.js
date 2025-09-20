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

const OFFSET_TOLERANCE_M = 0.5

const canonicalMaterial = (value) => {
  if(value == null || value === '') return null
  const txt = String(value).trim()
  return txt ? txt.toUpperCase() : null
}

const canonicalSdr = (value) => {
  if(value == null || value === '') return null
  const txt = String(value).trim()
  return txt ? txt.toUpperCase() : null
}

const isFiniteNumber = (value) => Number.isFinite(Number(value)) && Number.isFinite(+value)

function haversineMeters(lon1, lat1, lon2, lat2){
  const R = 6371000
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function geometryLength(points){
  if(!Array.isArray(points) || points.length < 2) return null
  let total = 0
  for(let i = 0; i < points.length - 1; i += 1){
    const a = points[i]
    const b = points[i + 1]
    if(!Array.isArray(a) || !Array.isArray(b) || a.length < 2 || b.length < 2) continue
    const lon1 = Number(a[0])
    const lat1 = Number(a[1])
    const lon2 = Number(b[0])
    const lat2 = Number(b[1])
    if(!Number.isFinite(lon1) || !Number.isFinite(lat1) || !Number.isFinite(lon2) || !Number.isFinite(lat2)) continue
    total += haversineMeters(lon1, lat1, lon2, lat2)
  }
  return total > 0 ? total : null
}

function edgeLengthMeters(edge){
  if(!edge) return null
  const candidates = [edge.length_m, edge.longueur_m]
    .map(normalizeNumericValue)
    .filter((v) => v != null)
  if(candidates.length){
    return candidates[0]
  }
  return geometryLength(Array.isArray(edge.geometry) ? edge.geometry : null)
}

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
  const diameter = normalizeNumericValue(raw.diameter_mm ?? raw.diametre_mm)
  const length = normalizeNumericValue(raw.length_m ?? raw.longueur_m)
  const branch = (raw.branch_id ?? raw.BranchId ?? '').trim() || null
  const material = canonicalMaterial(raw.material ?? raw.materiau ?? raw['matériau'])
  const sdr = canonicalSdr(raw.sdr ?? raw.sdr_ouvrage)
  const siteId = (() => {
    const val = raw.site_id
    if(val == null || val === '') return null
    const txt = String(val).trim()
    return txt || null
  })()
  const extras = (typeof raw.extras === 'object' && raw.extras) ? { ...raw.extras } : {}
  Object.keys(extras).forEach((key) => {
    if(key.startsWith('ui_') || key.startsWith('site_effective')) delete extras[key]
  })
  return {
    id: raw.id,
    from_id: raw.from_id ?? raw.source,
    to_id: raw.to_id ?? raw.target,
    active: raw.active !== false,
    commentaire: raw.commentaire || '',
    geometry: Array.isArray(raw.geometry) ? raw.geometry : null,
    branch_id: branch,
    diameter_mm: diameter,
    length_m: length,
    material,
    sdr,
    site_id: siteId,
    extras,
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
  const type = String(next.type || '').toUpperCase()
  if(type !== 'CANALISATION'){
    next.diameter_mm = null
    next.sdr_ouvrage = ''
    next.material = ''
  }else{
    if(next.diameter_mm == null) next.diameter_mm = null
    if(next.sdr_ouvrage == null) next.sdr_ouvrage = ''
    if(next.material == null) next.material = ''
  }
  delete next.site_effective
  delete next.site_effective_is_fallback
  Object.keys(next).forEach((key) => {
    if(key.startsWith('ui_') && key !== 'x_ui' && key !== 'y_ui') delete next[key]
  })
  if(next.extras && typeof next.extras === 'object'){
    Object.keys(next.extras).forEach((key) => {
      if(key.startsWith('ui_') || key.startsWith('site_effective')) delete next.extras[key]
    })
    if(!Object.keys(next.extras).length) delete next.extras
  }
  return next
}

function sanitizeEdgeForSave(edge){
  const diameter = normalizeNumericValue(edge.diameter_mm ?? edge.diametre_mm)
  const length = normalizeNumericValue(edge.length_m ?? edge.longueur_m)
  const branch = (edge.branch_id ?? edge.BranchId ?? '').trim() || null
  const material = canonicalMaterial(edge.material ?? edge.materiau)
  const sdr = canonicalSdr(edge.sdr ?? edge.sdr_ouvrage)
  const siteId = (() => {
    const val = edge.site_id
    if(val == null || val === '') return null
    const txt = String(val).trim()
    return txt || null
  })()
  let extras = (typeof edge.extras === 'object' && edge.extras) ? { ...edge.extras } : null
  if(extras){
    Object.keys(extras).forEach((key) => {
      if(key.startsWith('ui_') || key.startsWith('site_effective')) delete extras[key]
    })
    if(!Object.keys(extras).length) extras = null
  }

  const payload = {
    id: edge.id,
    from_id: edge.from_id ?? edge.source,
    to_id: edge.to_id ?? edge.target,
    active: edge.active !== false,
    commentaire: edge.commentaire || '',
    geometry: sanitizeGeometry(edge.geometry),
    branch_id: branch,
    diameter_mm: diameter != null ? Math.round(diameter * 100) / 100 : null,
    length_m: length != null ? Math.round(length * 100) / 100 : null,
    material,
    sdr,
  }
  if(siteId) payload.site_id = siteId
  if(extras) payload.extras = extras
  return payload
}

export function sanitizeGraphPayload(graph){
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.map(sanitizeNodeForSave) : []
  const edgesRaw = Array.isArray(graph?.edges) ? graph.edges.map(sanitizeEdgeForSave) : []
  const edges = dedupeEdges(edgesRaw)

  const edgeById = new Map()
  for(const edge of edges){
    if(!edge.id) continue
    if(edge.geometry && (edge.length_m == null || Number.isNaN(edge.length_m))){
      const computed = edgeLengthMeters(edge)
      if(computed != null){
        edge.length_m = Math.round(computed * 100) / 100
      }
    }
    edgeById.set(edge.id, edge)
    if(!edge.branch_id){
      throw new Error(`L'arête ${edge.id} doit avoir un branch_id`)
    }
    if(edge.diameter_mm == null || !(edge.diameter_mm >= 0)){
      throw new Error(`L'arête ${edge.id} doit avoir un diameter_mm valide`)
    }
    if(!Object.prototype.hasOwnProperty.call(edge, 'material')) edge.material = null
    if(!Object.prototype.hasOwnProperty.call(edge, 'sdr')) edge.sdr = null
  }

  const inlineTypes = new Set(['POINT_MESURE', 'VANNE'])
  for(const node of nodes){
    const typeUpper = String(node.type || '').toUpperCase()
    if(!inlineTypes.has(typeUpper)){
      if(node.pm_offset_m != null){
        const val = normalizeNumericValue(node.pm_offset_m)
        node.pm_offset_m = val == null ? null : Math.round(val * 100) / 100
      }
      continue
    }
    const anchorId = String(node.pm_collector_edge_id || node.attach_edge_id || '').trim()
    if(!anchorId){
      throw new Error(`Le nœud ${node.id} doit être relié à une arête (pm_collector_edge_id manquant)`)
    }
    const anchor = edgeById.get(anchorId)
    if(!anchor){
      throw new Error(`Le nœud ${node.id} référence une arête inexistante (${anchorId})`)
    }
    const anchorTo = anchor.to_id ?? anchor.target
    if(anchorTo && anchorTo !== node.id){
      throw new Error(`L’arête ${anchorId} doit arriver sur ${node.id} pour l'ancrer`)
    }
    let offset = normalizeNumericValue(node.pm_offset_m)
    const lengthHint = edgeLengthMeters(anchor)
    if(offset != null && offset < 0){
      offset = 0
    }
    if(lengthHint != null && offset != null){
      if(offset > lengthHint + OFFSET_TOLERANCE_M){
        throw new Error(`Offset ${offset} m dépasse la longueur de l’arête ${anchorId}`)
      }
      offset = Math.min(offset, lengthHint)
    }
    node.pm_offset_m = offset == null ? null : Math.round(offset * 100) / 100
    node.pm_collector_edge_id = anchorId
    node.attach_edge_id = anchorId
  }

  return {
    version: graph?.version || '1.5',
    site_id: graph?.site_id || null,
    generated_at: graph?.generated_at || null,
    style_meta: graph?.style_meta || {},
    nodes,
    edges,
  }
}
