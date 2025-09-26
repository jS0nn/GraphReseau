import { genIdWithTime as genId } from '../utils.ts'
import assignBranchIds from './branch-assign.ts'
import type { Graph, Edge, Node } from '../types/graph'
import type { MutableEdge, MutableNode } from '../state/normalize.ts'

type NodeInput = Partial<Node> & {
  pm_collector_edge_id?: string | null
  attach_edge_id?: string | null
  pm_offset_m?: number | string | null
  [key: string]: unknown
}

export type EdgeInput = Partial<Edge> & {
  BranchId?: unknown
  longueur_m?: unknown
  materiau?: unknown
  createdAt?: string | null
  geometry?: Array<[unknown, unknown]> | null
  extras?: Record<string, unknown> | null
  branch_id?: string | null
  [key: string]: unknown
}

type BranchMeta = {
  id: string
  name: string
  parent_id: string | null
  is_trunk: boolean
}

export type GraphInput = Graph | (Partial<Graph> & Record<string, unknown>)

const toTrimmedString = (value: unknown): string => (value == null ? '' : String(value).trim())
const normalizeIdValue = (value: unknown): string | null => {
  const txt = toTrimmedString(value)
  return txt || null
}

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
const INLINE_BRANCH_LOCK_TYPES = new Set(['VANNE'])

const canonicalMaterial = (value: unknown): string | null => {
  if(value == null || value === '') return null
  const txt = toTrimmedString(value)
  return txt ? txt.toUpperCase() : null
}

const canonicalSdr = (value: unknown): string | null => {
  if(value == null || value === '') return null
  const txt = toTrimmedString(value)
  return txt ? txt.toUpperCase() : null
}

const DEFAULT_CRS = { code: 'EPSG:4326', projected_for_lengths: 'EPSG:2154' }

const normalizeBranchId = (value: unknown): string => toTrimmedString(value)

export function normalizeCrs(raw: unknown): { code: string; projected_for_lengths: string } {
  try{
    if(raw && typeof raw === 'object'){
      const obj = raw as Record<string, unknown>
      const code = normalizeBranchId(obj.code ?? obj.Code ?? obj.crs ?? DEFAULT_CRS.code) || DEFAULT_CRS.code
      const projectedRaw = obj.projected_for_lengths ?? obj.projected ?? DEFAULT_CRS.projected_for_lengths
      const projected = normalizeBranchId(projectedRaw) || DEFAULT_CRS.projected_for_lengths
      return { code, projected_for_lengths: projected }
    }
  }catch{}
  return { ...DEFAULT_CRS }
}

function normalizeBranchEntry(entry: unknown, namesMap: Map<string, string> | null | undefined): BranchMeta | null {
  if(!entry) return null
  if(typeof entry === 'string'){
    const id = entry.trim()
    if(!id) return null
    const lookup = namesMap && namesMap.get(id)
    const name = lookup || id
    return { id, name, parent_id: null, is_trunk: id.startsWith('GENERAL-') }
  }
  if(typeof entry === 'object'){
    const obj = entry as Record<string, unknown>
    if(!('id' in obj) && obj.BranchId !== undefined){
      return normalizeBranchEntry({ id: obj.BranchId, name: obj.name ?? obj.Nom }, namesMap)
    }
    const id = normalizeBranchId(obj.id ?? obj.ID)
    if(!id) return null
    let name = ''
    if(obj.name != null) name = String(obj.name).trim()
    if(!name && namesMap){
      const lookup = namesMap.get(id)
      if(lookup) name = lookup
    }
    if(!name) name = id
    const parent = normalizeIdValue(obj.parent_id ?? obj.parentId ?? obj.parentID)
    const isTrunk = !!obj.is_trunk || (!!obj.isTrunk)
    return { id, name, parent_id: parent, is_trunk: isTrunk }
  }
  return null
}

export function normalizeBranches(
  raw: unknown,
  edges: EdgeInput[] | null | undefined,
  namesById?: Record<string, unknown> | null,
): BranchMeta[] {
  const namesMap = (() => {
    if(!namesById || typeof namesById !== 'object') return null
    const map = new Map<string, string>()
    try{
      for(const [key, value] of Object.entries(namesById)){
        if(!key) continue
        const id = normalizeBranchId(key)
        if(!id) continue
        if(value == null) continue
        const name = toTrimmedString(value)
        if(!name) continue
        map.set(id, name)
      }
    }catch{}
    return map
  })()

  const map = new Map<string, BranchMeta>()
  if(Array.isArray(raw)){
    for(const entry of raw as unknown[]){
      const branch = normalizeBranchEntry(entry, namesMap)
      if(!branch) continue
      const existing = map.get(branch.id)
      if(existing){
        if(!existing.name && branch.name) existing.name = branch.name
        if(!existing.parent_id && branch.parent_id) existing.parent_id = branch.parent_id
        if(!existing.is_trunk && branch.is_trunk) existing.is_trunk = true
        continue
      }
      map.set(branch.id, { ...branch })
    }
  }
  const edgeList: EdgeInput[] = Array.isArray(edges) ? edges : []
  for(const edge of edgeList){
    const branchId = normalizeBranchId(edge.branch_id ?? edge.BranchId)
    if(!branchId) continue
    if(!map.has(branchId)){
      const lookup = namesMap ? namesMap.get(branchId) : null
      map.set(branchId, {
        id: branchId,
        name: lookup || branchId,
        parent_id: null,
        is_trunk: branchId.startsWith('GENERAL-'),
      })
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const nameA = (a.name || a.id || '').toLowerCase()
    const nameB = (b.name || b.id || '').toLowerCase()
    if(nameA < nameB) return -1
    if(nameA > nameB) return 1
    if(a.id < b.id) return -1
    if(a.id > b.id) return 1
    return 0
  })
}

const isFiniteNumber = (value: unknown): boolean => {
  if(typeof value === 'number') return Number.isFinite(value)
  const numeric = Number(value)
  return Number.isFinite(numeric)
}

function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat/2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function geometryLength(points: Array<[number, number]> | null | undefined): number | null {
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

function edgeLengthMeters(edge: EdgeInput | null | undefined): number | null {
  if(!edge) return null
  const candidates = [edge.length_m, edge.longueur_m]
    .map(normalizeNumericValue)
    .filter((v) => v != null)
  if(candidates.length){
    return candidates[0] as number
  }
  return geometryLength(Array.isArray(edge.geometry) ? (edge.geometry as Array<[number, number]>) : null)
}


export function normalizeNumericValue(value: unknown): number | null {
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

export function normalizeEdge(raw: EdgeInput): EdgeInput {
  const diameter = normalizeNumericValue(raw.diameter_mm ?? raw.diametre_mm)
  const length = normalizeNumericValue(raw.length_m ?? raw.longueur_m)
  const branchCandidate = normalizeBranchId(raw.branch_id ?? raw.BranchId ?? '')
  const branch = branchCandidate || null
  const material = canonicalMaterial(raw.material ?? raw.materiau ?? (raw as Record<string, unknown>)['matériau'])
  const sdr = canonicalSdr(raw.sdr)
  const siteId = (() => {
    const val = raw.site_id
    if(val == null || val === '') return null
    const txt = toTrimmedString(val)
    return txt || null
  })()
  const geometry = Array.isArray(raw.geometry) ? (raw.geometry as Array<[number, number]>) : null
  const computedLength = (length == null) ? geometryLength(geometry) : null
  const finalLength = length != null ? Math.round(length * 100) / 100 : (computedLength != null ? Math.round(computedLength * 100) / 100 : null)
  const extras = (typeof raw.extras === 'object' && raw.extras) ? { ...(raw.extras as Record<string, unknown>) } : {}
  Object.keys(extras).forEach((key) => {
    if(key.startsWith('ui_') || key.startsWith('site_effective')) delete extras[key]
  })
  return {
    id: raw.id,
    from_id: normalizeIdValue(raw.from_id ?? raw.source),
    to_id: normalizeIdValue(raw.to_id ?? raw.target),
    active: raw.active !== false,
    commentaire: raw.commentaire || '',
    geometry,
    branch_id: branch,
    diameter_mm: diameter,
    length_m: finalLength,
    material,
    sdr,
    site_id: siteId,
    extras,
  } as EdgeInput
}

export function dedupeEdges(edges: EdgeInput[], idChanges: Map<string, string> | null = null): EdgeInput[] {
  const used = new Set<string>()
  const result: EdgeInput[] = []
  for(const edge of edges){
    const key = (edge.id as string | undefined) || ''
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
    if(idChanges && key){
      idChanges.set(key, newId)
    }
    result.push({ ...edge, id: newId })
    used.add(newId)
  }
  return result
}

function sanitizeGeometry(geom: unknown): Array<[number, number]> | null {
  if(!Array.isArray(geom) || geom.length < 2) return null
  const cleaned: Array<[number, number]> = []
  for(const pt of geom){
    if(!Array.isArray(pt) || pt.length < 2) continue
    const lon = +pt[0]
    const lat = +pt[1]
    if(Number.isFinite(lon) && Number.isFinite(lat)) cleaned.push([lon, lat])
  }
  return cleaned.length >= 2 ? cleaned : null
}

function sanitizeNodeForSave(node: NodeInput): NodeInput {
  const next = { ...node }
  if(next.x != null) next.x_ui = next.x
  if(next.y != null) next.y_ui = next.y
  for(const key of NUMERIC_NODE_FIELDS){
    next[key] = normalizeNumericValue(next[key])
  }
  if('lat' in next) delete next.lat
  if('lon' in next) delete next.lon
  const type = String(next.type || '').toUpperCase()
  if(type !== 'CANALISATION'){
    next.diameter_mm = null
    next.material = ''
  }else{
    if(next.diameter_mm == null) next.diameter_mm = null
    if(next.material == null) next.material = ''
  }
  delete next.site_effective
  delete next.site_effective_is_fallback
  Object.keys(next).forEach((key) => {
    if(key.startsWith('ui_') && key !== 'x_ui' && key !== 'y_ui') delete next[key]
  })
  if(next.extras && typeof next.extras === 'object'){
    const extras = next.extras as Record<string, unknown>
    Object.keys(extras).forEach((key) => {
      if(key.startsWith('ui_') || key.startsWith('site_effective')) delete extras[key]
    })
    if(!Object.keys(extras).length) delete next.extras
  }
  return next
}

function sanitizeEdgeForSave(edge: EdgeInput): EdgeInput {
  const diameter = normalizeNumericValue(edge.diameter_mm ?? edge.diametre_mm)
  const length = normalizeNumericValue(edge.length_m ?? edge.longueur_m)
  const branchValue = normalizeBranchId(edge.branch_id ?? edge.BranchId ?? '')
  const branch = branchValue || null
  const material = canonicalMaterial(edge.material ?? edge.materiau)
  const sdr = canonicalSdr(edge.sdr)
  const siteId = (() => {
    const val = edge.site_id
    if(val == null || val === '') return null
    const txt = toTrimmedString(val)
    return txt || null
  })()
  let extras = (typeof edge.extras === 'object' && edge.extras)
    ? { ...(edge.extras as Record<string, unknown>) }
    : null
  if(extras){
    const extrasObj = extras as Record<string, unknown>
    Object.keys(extrasObj).forEach((key) => {
      if(key.startsWith('ui_') || key.startsWith('site_effective')) delete extrasObj[key]
    })
    if(!Object.keys(extrasObj).length) extras = null
  }

  const normalizedDiameter = diameter != null ? Math.round(diameter * 100) / 100 : 0
  let createdAt = edge.created_at || edge.createdAt || null
  if(!createdAt){
    createdAt = new Date().toISOString()
  }

  const fromId = normalizeIdValue(edge.from_id ?? edge.source)
  const toId = normalizeIdValue(edge.to_id ?? edge.target)
  if(!fromId || !toId) throw new Error('Chaque arête doit avoir des identifiants from_id/to_id')

  const payload: EdgeInput = {
    id: edge.id ?? undefined,
    from_id: fromId,
    to_id: toId,
    active: edge.active !== false,
    commentaire: edge.commentaire || '',
    geometry: sanitizeGeometry(edge.geometry),
    diameter_mm: normalizedDiameter,
    length_m: length != null ? Math.round(length * 100) / 100 : null,
    material,
    sdr,
    created_at: createdAt,
  }
  if(branch != null) payload.branch_id = branch
  if(siteId) payload.site_id = siteId
  if(extras) payload.extras = extras
  return payload
}

export function sanitizeGraphPayload(graph: GraphInput | null | undefined): Graph {
  const nodes: NodeInput[] = Array.isArray(graph?.nodes)
    ? (graph?.nodes as NodeInput[]).map(sanitizeNodeForSave)
    : []
  const edgesRaw: EdgeInput[] = Array.isArray(graph?.edges)
    ? (graph?.edges as EdgeInput[]).map(sanitizeEdgeForSave)
    : []
  const idChanges = new Map<string, string>()
  const edges = dedupeEdges(edgesRaw, idChanges)

  assignBranchIds(nodes as unknown as MutableNode[], edges as unknown as MutableEdge[])

  if(idChanges.size){
    const remap = (value: unknown) => {
      if(value == null || value === '') return value
      const key = toTrimmedString(value)
      if(!key) return key
      return idChanges.get(key) || key
    }
    for(const node of nodes){
      if(!node) continue
      if(node.pm_collector_edge_id != null){
        const next = normalizeIdValue(remap(node.pm_collector_edge_id))
        if(next !== node.pm_collector_edge_id) node.pm_collector_edge_id = next
      }
      if(node.attach_edge_id != null){
        const nextAttach = normalizeIdValue(remap(node.attach_edge_id))
        if(nextAttach !== node.attach_edge_id) node.attach_edge_id = nextAttach
      }
    }
  }

  assignBranchIds(nodes as unknown as MutableNode[], edges as unknown as MutableEdge[])

  const edgeById = new Map<string, EdgeInput>()
  for(const edge of edges){
    if(!edge.id) continue
    if(edge.geometry && (edge.length_m == null || Number.isNaN(edge.length_m))){
      const computed = edgeLengthMeters(edge)
      if(computed != null){
        edge.length_m = Math.round(computed * 100) / 100
      }
    }
    edgeById.set(edge.id as string, edge)
    if(!edge.branch_id){
      throw new Error(`L'arête ${edge.id} doit avoir un branch_id`)
    }
    if(edge.diameter_mm == null || !(edge.diameter_mm >= 0)){
      throw new Error(`L'arête ${edge.id} doit avoir un diameter_mm valide`)
    }
    if(!Object.prototype.hasOwnProperty.call(edge, 'material')) edge.material = null
    if(!Object.prototype.hasOwnProperty.call(edge, 'sdr')) edge.sdr = null
  }

  const incomingByNode = new Map<string, EdgeInput[]>()
  for(const edge of edges){
    const to = edge?.to_id ?? edge?.target
    if(!to) continue
    const key = String(to)
    if(!incomingByNode.has(key)) incomingByNode.set(key, [])
    incomingByNode.get(key)!.push(edge)
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
    let anchorId = toTrimmedString(node.pm_collector_edge_id || node.attach_edge_id || '')
    if(!anchorId){
      throw new Error(`Le nœud ${node.id} doit être relié à une arête (pm_collector_edge_id manquant)`)
    }
    let anchor = edgeById.get(anchorId) ?? undefined
    if(!anchor){
      const incoming = incomingByNode.get(String(node.id)) || []
      const found = incoming.find(e => (e.to_id ?? e.target) === node.id)
      if(found && found.id){
        anchor = found
        anchorId = found.id
        node.pm_collector_edge_id = anchorId
        node.attach_edge_id = anchorId
      }
    }
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
        console.warn(`[sanitizeGraphPayload] pm_offset ${offset} > length ${lengthHint} on edge ${anchorId}, value clamped.`)
      }
      if(offset > lengthHint){
        offset = lengthHint
      }
    }
    node.pm_offset_m = offset == null ? null : Math.round(offset * 100) / 100
    node.pm_collector_edge_id = anchorId
    node.attach_edge_id = anchorId
  }

  const branchNames = (graph?.style_meta as Record<string, unknown> | undefined)?.branch_names_by_id as Record<string, unknown> | undefined
  const branches = normalizeBranches(graph?.branches, edges, branchNames || null)
  const crs = normalizeCrs(graph?.crs)
  return {
    version: graph?.version ?? '1.5',
    site_id: (graph?.site_id ?? null) as string | null,
    generated_at: (graph?.generated_at ?? null) as string | null,
    style_meta: (graph?.style_meta as Record<string, unknown> | null) ?? {},
    crs,
    branches,
    nodes: nodes as unknown as Node[],
    edges: edges as unknown as Edge[],
  } as Graph
}
