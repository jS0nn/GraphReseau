import { state, addNode, addEdge, removeEdge, updateEdge, updateNode, getMode, subscribe, renameNodeId, setMode, selectNodeById, suspendOrphanPrune, getManualEdgeProps } from '../state/index.ts'
import { genIdWithTime as genId, isCanal } from '../utils.ts'
import { unprojectUIToLatLon } from '../geo.ts'
import { showMiniMenu } from '../ui/mini-menu.ts'
import { startDrawingFromNodeId } from './draw.ts'
import { devlog } from '../ui/logs.ts'
import { centerUIForNode, edgeGeometryToUIPoints, nearestPointOnPolyline, splitGeometryAt, ensureEdgeGeometry, geometryLengthMeters, offsetAlongGeometry, type PolylineHit, type UIPoint } from '../shared/geometry.ts'
import type { MutableNode, MutableEdge } from '../state/normalize.ts'
import type { EdgeProps, EdgePatch } from './types.ts'

const win = window as typeof window & {
  __leaflet_map?: {
    mouseEventToContainerPoint?: (ev: MouseEvent) => { x: number; y: number }
  }
  d3?: typeof import('d3')
}

const JUNCTION_TOLERANCE = 24

const finiteDiameter = (value: unknown): number | null => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}

const roundMeters = (value: unknown): number | null => (Number.isFinite(value) ? Math.round(Number(value) * 100) / 100 : null)

const canonicalMaterial = (value: unknown): string | null => {
  if(value == null || value === '') return null
  const txt = String(value).trim()
  return txt ? txt.toUpperCase() : null
}

const canonicalSdr = (value: unknown): string | null => {
  if(value == null || value === '') return null
  const txt = String(value).trim()
  return txt ? txt.toUpperCase() : null
}

type JunctionHit = {
  edge: MutableEdge
  hit: NonNullable<PolylineHit>
}

const asEdges = (): MutableEdge[] => state.edges as MutableEdge[]
const asNodes = (): MutableNode[] => state.nodes as MutableNode[]

function pickEdgeProps(edge: MutableEdge | null | undefined): EdgeProps | null {
  if(!edge) return null
  const diameter_mm = finiteDiameter(edge.diameter_mm)
  const material = edge.material ? String(edge.material) : null
  const sdr = edge.sdr ? String(edge.sdr) : null
  const branch_id = edge.branch_id ? String(edge.branch_id).trim() || null : null
  if(diameter_mm == null && !material && !sdr && !branch_id) return null
  return { diameter_mm, material, sdr, branch_id }
}

function mergeEdgeProps(target: EdgePatch, props: EdgeProps | null): EdgePatch {
  if(!props) return target
  if(props.diameter_mm != null) target.diameter_mm = props.diameter_mm
  if(props.material != null) target.material = props.material
  if(props.sdr != null) target.sdr = props.sdr
  if(props.branch_id && !target.branch_id) target.branch_id = props.branch_id
  return target
}

function eventToUI(evt: MouseEvent): UIPoint {
  try{
    const map = win.__leaflet_map
    if(map?.mouseEventToContainerPoint){
      const pt = map.mouseEventToContainerPoint(evt)
      return [pt.x, pt.y]
    }
  }catch{}
  const svgEl = document.getElementById('svg')
  if(!(svgEl instanceof SVGSVGElement)) return [evt.clientX, evt.clientY]
  const r = svgEl.getBoundingClientRect()
  const px = evt.clientX - r.left
  const py = evt.clientY - r.top
  try{
    const transform = win.d3?.zoomTransform?.(svgEl)
    if(transform && typeof transform.invert === 'function'){
      const p = transform.invert([px, py]) as UIPoint
      return [p[0], p[1]]
    }
  }catch{}
  return [px, py]
}

function findNearestEdgeHitForJunction(ux: number, uy: number): JunctionHit | null {
  let best: JunctionHit | null = null
  for(const edge of asEdges()){
    const pts = edgeGeometryToUIPoints(edge, asNodes())
    if(pts.length < 2) continue
    const hit = nearestPointOnPolyline(pts, ux, uy)
    if(hit && hit.d2 < (JUNCTION_TOLERANCE * JUNCTION_TOLERANCE)){
      if(!best || hit.d2 < best.hit.d2){
        best = { edge, hit }
      }
    }
  }
  return best
}

function insertJunctionAt(edge: MutableEdge, hit: NonNullable<PolylineHit>, ev: MouseEvent): boolean {
  const centerLL = unprojectUIToLatLon(hit.px, hit.py)
  const geom = ensureEdgeGeometry(edge, asNodes())
  if(!geom) return false
  const parts = splitGeometryAt(geom, hit)
  const fromId = edge.from_id ?? edge.source ?? null
  const toId = edge.to_id ?? edge.target ?? null
  if(!fromId || !toId) return false
  const keepActive = edge.active !== false
  const commentaire = edge.commentaire || ''
  const baseProps = pickEdgeProps(edge)
  const branchId = (() => {
    const candidates = [edge.branch_id, baseProps?.branch_id, edge.id]
    for(const cand of candidates){
      if(cand && String(cand).trim()) return String(cand).trim()
    }
    return ''
  })()
  const upstreamOffset = roundMeters(geometryLengthMeters(parts.g1))
  const { clientX: x, clientY: y } = ev

  type CreationResult = {
    nodeId: string
    newEdgeAId: string | null
    newEdgeBId: string | null
    branchId: string | null
  }

  let created: CreationResult | null = null

  const buildEdgeOpts = (): EdgePatch => {
    const opts: EdgePatch = { active: keepActive, commentaire }
    if(branchId) opts.branch_id = branchId
    mergeEdgeProps(opts, baseProps)
    const manual = getManualEdgeProps(branchId) as (EdgeProps & Record<string, unknown>) | null
    if(manual?.diameter_mm != null){
      opts.diameter_mm = manual.diameter_mm
    }else if(opts.diameter_mm != null){
      const num = finiteDiameter(opts.diameter_mm)
      opts.diameter_mm = num != null ? num : null
    }
    const materialSource = manual?.material ?? opts.material
    const sdrSource = manual?.sdr ?? opts.sdr
    opts.material = canonicalMaterial(materialSource)
    opts.sdr = canonicalSdr(sdrSource)
    if(opts.material === undefined) opts.material = null
    if(opts.sdr === undefined) opts.sdr = null
    return opts
  }

  const ensureCreated = (): CreationResult | null => {
    if(created) return created
    const node = addNode({
      type: 'JONCTION',
      gps_lat: centerLL.lat,
      gps_lon: centerLL.lon,
      gps_locked: true,
      name: '',
      x: hit.px,
      y: hit.py,
    }) as MutableNode | null
    if(!node) return null
    let newEdgeAId: string | null = null
    let newEdgeBId: string | null = null

    suspendOrphanPrune(() => {
      if(edge.id) removeEdge(edge.id)
      const optsA = buildEdgeOpts()
      const newEdgeA = addEdge(fromId, node.id, optsA)
      if(newEdgeA?.id){
        newEdgeAId = newEdgeA.id
        updateEdge(newEdgeA.id, { geometry: parts.g1 })
      }
      const optsB = buildEdgeOpts()
      const newEdgeB = addEdge(node.id, toId, optsB)
      if(newEdgeB?.id){
        newEdgeBId = newEdgeB.id
        updateEdge(newEdgeB.id, { geometry: parts.g2 })
      }
    })

    if(branchId) updateNode(node.id, { branch_id: branchId })
    devlog('junction:split', edge.id, '->', newEdgeAId, newEdgeBId, 'new node', node.id)

    created = { nodeId: node.id, newEdgeAId, newEdgeBId, branchId: branchId || null }
    return created
  }

  const inheritBranchAttrs = (creation: CreationResult | null, targetId: string | null): void => {
    if(!creation || !targetId) return
    try{
      const n = asNodes().find((nn) => nn.id === targetId)
      if(!n) return
      const edgeA = creation.newEdgeAId ? asEdges().find((xx) => xx.id === creation.newEdgeAId) : null
      const edgeB = creation.newEdgeBId ? asEdges().find((xx) => xx.id === creation.newEdgeBId) : null
      const nextBranchId = creation.branchId || edgeA?.branch_id || edgeB?.branch_id || edgeA?.id || edgeB?.id || edge.id
      n.branch_id = nextBranchId ?? null
      const fromNode = asNodes().find((nn) => nn.id === fromId)
      const toNode = asNodes().find((nn) => nn.id === toId)
      const canalNeighbors = [fromNode, toNode].filter(isCanal)
      const diameterCandidates = canalNeighbors
        .map((nn) => finiteDiameter(nn?.diameter_mm))
        .filter((v): v is number => v != null)
      const materialCandidate = canalNeighbors.map((nn) => nn?.material).find((val) => !!val)
      const patch: Record<string, unknown> = { branch_id: n.branch_id }
      if(diameterCandidates.length){
        patch.diameter_mm = diameterCandidates[0]
      }else if(baseProps?.diameter_mm != null){
        patch.diameter_mm = baseProps.diameter_mm
      }
      if(materialCandidate){
        patch.material = materialCandidate
      }else if(baseProps?.material){
        patch.material = baseProps.material
      }
      updateNode(targetId, patch)
    }catch{}
  }

  const attachInlineToEdge = (creation: CreationResult | null, inlineId: string | null, options: { anchorEdgeId?: string | null; offsetMeters?: number | null } = {}): void => {
    if(!creation || !inlineId) return
    try{
      const nodeRef = asNodes().find((nn) => nn.id === inlineId)
      if(!nodeRef) return
      const fromNode = asNodes().find((nn) => nn.id === fromId)
      const toNode = asNodes().find((nn) => nn.id === toId)
      const preferredId = options.anchorEdgeId || null
      const preferred = preferredId ? asEdges().find((e) => e.id === preferredId) : null
      const edgeA = creation.newEdgeAId ? asEdges().find((e) => e.id === creation.newEdgeAId) : null
      const edgeB = creation.newEdgeBId ? asEdges().find((e) => e.id === creation.newEdgeBId) : null
      const resolvedEdge = preferred
        || (edgeA && (edgeA.to_id ?? edgeA.target) === inlineId ? edgeA : null)
        || (edgeB && (edgeB.to_id ?? edgeB.target) === inlineId ? edgeB : null)
        || edgeA
        || edgeB
      if(!resolvedEdge) return
      const candidates = [fromNode?.diameter_mm, toNode?.diameter_mm]
        .map((v) => {
          const num = Number(v)
          return Number.isFinite(num) && num > 0 ? num : null
        })
        .filter((v): v is number => v != null)
      const patch: Record<string, unknown> = {
        pm_collector_edge_id: resolvedEdge.id,
        attach_edge_id: resolvedEdge.id,
        pm_collector_id: '',
      }
      if(candidates.length){
        Object.assign(patch, { diameter_mm: candidates[0] })
      }
      const offsetSource = options.offsetMeters != null ? options.offsetMeters : offsetAlongGeometry(resolvedEdge, nodeRef)
      let clamped = Number(offsetSource)
      if(Number.isFinite(clamped)){
        if(resolvedEdge){
          if(typeof resolvedEdge.length_m === 'number' && Number.isFinite(resolvedEdge.length_m)){
            clamped = Math.min(clamped, resolvedEdge.length_m)
          }else{
            const geomLength = geometryLengthMeters(resolvedEdge.geometry)
            if(typeof geomLength === 'number' && Number.isFinite(geomLength)){
              clamped = Math.min(clamped, geomLength)
            }
          }
        }
        patch.pm_offset_m = roundMeters(clamped)
      }else{
        patch.pm_offset_m = null
      }
      updateNode(inlineId, patch)
    }catch(err){
      try{ console.debug('[dev] attachInlineToEdge error', err) }catch{}
    }
  }

  showMiniMenu(x, y, [
    {
      label: 'Jonction',
      onClick: () => {
        const creation = ensureCreated()
        if(!creation) return
        updateNode(creation.nodeId, { type: 'JONCTION' })
        try{ setMode('select') }catch{}
      },
    },
    {
      label: 'Point de mesure',
      onClick: () => {
        const creation = ensureCreated()
        if(!creation) return
        let nodeId = creation.nodeId
        const nid = genId('POINT_MESURE')
        renameNodeId(nodeId, nid)
        nodeId = nid
        creation.nodeId = nid
        updateNode(nid, { type: 'POINT_MESURE', gps_lat: centerLL.lat, gps_lon: centerLL.lon, gps_locked: true })
        inheritBranchAttrs(creation, nid)
        attachInlineToEdge(creation, nid, { anchorEdgeId: creation.newEdgeAId, offsetMeters: upstreamOffset })
        try{
          setMode('select')
          selectNodeById(nid)
        }catch{}
      },
    },
    {
      label: 'Vanne',
      onClick: () => {
        const creation = ensureCreated()
        if(!creation) return
        let nodeId = creation.nodeId
        const nid = genId('VANNE')
        renameNodeId(nodeId, nid)
        nodeId = nid
        creation.nodeId = nid
        updateNode(nid, { type: 'VANNE', gps_lat: centerLL.lat, gps_lon: centerLL.lon, gps_locked: true })
        inheritBranchAttrs(creation, nid)
        attachInlineToEdge(creation, nid, { anchorEdgeId: creation.newEdgeAId, offsetMeters: upstreamOffset })
        try{
          setMode('select')
          selectNodeById(nid)
        }catch{}
      },
    },
    {
      label: 'Démarrer une antenne',
      onClick: () => {
        const creation = ensureCreated()
        if(!creation) return
        try{ setMode('draw') }catch{}
        startDrawingFromNodeId(creation.nodeId)
      },
    },
  ])

  return true
}

function handleJunctionEvent(ev: MouseEvent): boolean {
  const [ux, uy] = eventToUI(ev)
  const found = findNearestEdgeHitForJunction(ux, uy)
  if(!found) return false
  return insertJunctionAt(found.edge, found.hit, ev)
}

export function attachJunction(): void {
  const svgEl = document.getElementById('svg')
  if(!(svgEl instanceof SVGSVGElement)) return

  svgEl.addEventListener('click', (ev) => {
    if(getMode() !== 'junction') return
    const inserted = handleJunctionEvent(ev)
    if(inserted){
      ev.preventDefault()
      ev.stopPropagation()
    }
  }, true)

  svgEl.addEventListener('contextmenu', (ev) => {
    if(getMode() !== 'select') return
    const inserted = handleJunctionEvent(ev)
    if(inserted){
      ev.preventDefault()
      ev.stopPropagation()
    }
  }, true)

  subscribe((evt, payload) => {
    if(evt === 'mode:set' && payload !== 'junction'){
      // No transient UI to clear yet – placeholder for future hooks
    }
  })
}
