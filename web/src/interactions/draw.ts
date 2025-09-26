import { state, addNode, addEdge, updateEdge, removeEdge, updateNode, getMode, setMode, subscribe, suspendOrphanPrune, getManualEdgeProps, triggerBranchRecalc } from '../state/index.ts'
import { displayXYForNode, unprojectUIToLatLon, projectLatLonToUI } from '../geo.ts'
import { NODE_SIZE } from '../constants/nodes.ts'
import { getMap, isMapActive } from '../map.ts'
import { showMiniMenu } from '../ui/mini-menu.ts'
import { centerUIForNode, edgeGeometryToUIPoints, nearestPointOnPolyline, splitGeometryAt, ensureEdgeGeometry, geometryLengthMeters, offsetAlongGeometry } from '../shared/geometry.ts'
import { isCanal, genIdWithTime, toNullableString } from '../utils.ts'
import type { MutableNode, MutableEdge } from '../state/normalize.ts'
import type { UIPoint, GeometryPoint, PolylineHit } from '../shared/geometry.ts'
import type { DrawingShape, EdgeProps, EdgePatch, AnchorHint, LatLonPoint } from './types'
import type { Selection, BaseType } from 'd3-selection'

const win = window as typeof window & {
  __leaflet_map?: {
    mouseEventToContainerPoint?: (ev: MouseEvent) => { x: number; y: number }
    containerPointToLatLng?: (pt: [number, number]) => { lat: number; lng: number }
  }
  __squelchCanvasClick?: boolean
  d3?: typeof import('d3')
}

const SNAP_TOL = 15 // px for nodes (distance to node rectangle)
const EDGE_TOL = 15 // px for snapping onto existing edges
type SegmentSpec = { from: string | null; to: string | null; geometry: LatLonPoint[] }
type SplitResult = {
  nodeId: string
  ui: UIPoint
  edgeProps: EdgeProps | null
  anchorEdgeId: string | null
  anchorOffsetM: number | null
}

let drawing: DrawingShape | null = null
let overlayRef: Selection<SVGGElement, unknown, BaseType, unknown> | null = null
let antennaSeedNodeId: string | null = null
let antennaSeedProps: EdgeProps | null = null

const finiteDiameter = (value: unknown): number | null => {
  const num = Number(value)
  return Number.isFinite(num) && num > 0 ? num : null
}
const roundMeters = (value: unknown): number | null => (Number.isFinite(value) ? Math.round(Number(value) * 100) / 100 : null)

const toUIPoint = (value: UIPoint | { x: number; y: number }): UIPoint => {
  if(Array.isArray(value)) return [value[0], value[1]]
  return [value.x, value.y]
}

const generateBranchId = (): string => {
  let candidate: string | null = null
  let guard = 0
  const exists = (branchId: string | null): boolean => {
    const key = branchId ? String(branchId).trim() : ''
    if(!key) return false
    const edgeHit = (state.edges as MutableEdge[]).some(e => String(e?.branch_id ?? '').trim() === key)
    if(edgeHit) return true
    return (state.nodes as MutableNode[]).some(n => String(n?.branch_id ?? '').trim() === key)
  }
  do{
    candidate = genIdWithTime('BR')
    guard += 1
  }while(exists(candidate) && guard < 10)
  return candidate ?? genIdWithTime('BR')
}

function pickEdgeProps(edge: MutableEdge | null | undefined): EdgeProps | null {
  if(!edge) return null
  const diameter_mm = finiteDiameter(edge.diameter_mm)
  const material = edge.material ? String(edge.material) : null
  const sdr = edge.sdr ? String(edge.sdr) : null
  const branch_id = toNullableString(edge.branch_id)
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

function inferPropsFromNodeId(nodeId: string | null | undefined, visited: Set<string> = new Set()): EdgeProps | null {
  if(!nodeId || visited.has(nodeId)) return null
  visited.add(nodeId)
  const node = (state.nodes as MutableNode[]).find(nn => nn.id === nodeId)
  if(node){
    if(isCanal(node)){
      const diameter_mm = finiteDiameter(node.diameter_mm)
      const material = toNullableString(node.material, { trim: false })
      const branch_id = toNullableString(node.branch_id)
      if(diameter_mm != null || material || branch_id){
        return { diameter_mm, material, branch_id }
      }
    }
    const wellCollectorId = toNullableString(node.well_collector_id)
    if(wellCollectorId){
      const props = inferPropsFromNodeId(wellCollectorId, visited)
      if(props) return props
    }
    if(Array.isArray(node.collector_well_ids)){
      for(const cid of node.collector_well_ids){
        const childId = toNullableString(cid)
        if(!childId) continue
        const props = inferPropsFromNodeId(childId, visited)
        if(props) return props
      }
    }
    const edgeRefs = [node.attach_edge_id, node.pm_collector_edge_id]
      .map(id => toNullableString(id))
      .filter((value): value is string => !!value)
    for(const eid of edgeRefs){
      const edge = (state.edges as MutableEdge[]).find(e => e.id === eid)
      const props = pickEdgeProps(edge)
      if(props) return props
    }
  }
  const connectedEdges = (state.edges as MutableEdge[]).filter(e => (e.from_id ?? e.source) === nodeId || (e.to_id ?? e.target) === nodeId)
  for(const edge of connectedEdges){
    const props = pickEdgeProps(edge)
    if(props) return props
  }
  return null
}

function getUIFromEvent(evt: MouseEvent): UIPoint {
  try{
    if(win.__leaflet_map?.mouseEventToContainerPoint){
      const pt = win.__leaflet_map.mouseEventToContainerPoint(evt)
      return [pt.x, pt.y]
    }
  }catch{}
  const svg = document.getElementById('svg')
  if(!svg) return [0, 0]
  const r = svg.getBoundingClientRect()
  const px = evt.clientX - r.left
  const py = evt.clientY - r.top
  try{
    const transform = win.d3?.zoomTransform?.(svg)
    if(transform && typeof transform.invert === 'function'){
      const p = transform.invert([px, py]) as [number, number]
      return [p[0], p[1]]
    }
  }catch{}
  return [px, py]
}

function getLatLonFromEvent(evt: MouseEvent): LatLonPoint {
  if(isMapActive && isMapActive() && getMap){
    const m = getMap()
    if(m && typeof m.containerPointToLatLng === 'function'){
      const mapEl = document.getElementById('map')
      if(mapEl){
        const r = mapEl.getBoundingClientRect()
        const pt = m.containerPointToLatLng([evt.clientX - r.left, evt.clientY - r.top])
        return [pt.lng, pt.lat]
      }
    }
  }
  const [ux, uy] = getUIFromEvent(evt)
  const ll = unprojectUIToLatLon(ux, uy)
  return [ll.lon, ll.lat]
}

function nearestNodeUI([x, y]: UIPoint, tolPx = SNAP_TOL){
  let best: { id: string; x: number; y: number; d2: number; node: MutableNode } | null = null
  const tol2 = tolPx * tolPx
  for(const n of state.nodes as MutableNode[]){
    const anchor = centerUIForNode(n)
    const cx = anchor[0]
    const cy = anchor[1]
    const dx = x - cx
    const dy = y - cy
    const d2 = dx * dx + dy * dy
    if(d2 <= tol2){
      if(!best || d2 < best.d2){
        best = { id: n.id, x: cx, y: cy, d2, node: n }
      }
    }
  }
  return best
}

function updatePreview(){
  if(!drawing) return
  // Recompute UI from GPS when available to keep preview anchored on map moves
  if(Array.isArray(drawing.pointsLL) && drawing.pointsLL.length){
    const ui: UIPoint[] = []
    for(const ll of drawing.pointsLL){
      if(!Array.isArray(ll) || ll.length<2) continue
      const lon = +ll[0], lat = +ll[1]
      if(Number.isFinite(lat) && Number.isFinite(lon)){
        const p = projectLatLonToUI(lat, lon)
        ui.push([p.x, p.y])
      }
    }
    drawing.pointsUI = ui
  }
  const d = drawing.pointsUI || []
  let path = ''
  for(let i=0;i<d.length;i++){
    const p = d[i]
    path += (i===0? 'M':' L') + p[0] + ',' + p[1]
  }
  if(drawing.previewPath) drawing.previewPath.setAttribute('d', path)
}

function startDrawing(gOverlay: Selection<SVGGElement, unknown, BaseType, unknown>): void {
  if(drawing) return
  overlayRef = gOverlay
  const p = document.createElementNS('http://www.w3.org/2000/svg','path')
  p.setAttribute('class','draw-preview')
  p.setAttribute('fill','none')
  p.setAttribute('stroke','var(--accent)')
  p.setAttribute('stroke-width','2')
  const node = gOverlay.node()
  if(node){
    node.appendChild(p)
  }
  drawing = {
    pointsUI: [] as UIPoint[],
    pointsLL: [] as LatLonPoint[],
    previewPath: p,
    snappedIds: [] as (string | null)[],
    anchorHints: new Map<string, AnchorHint>(),
  }
}

function stopDrawing(){
  if(drawing){
    try{ drawing.previewPath?.remove() }catch{}
    drawing = null
  }
  antennaSeedNodeId = null
  antennaSeedProps = null
}

function discardPhantomPoint(){
  const shape = drawing
  if(!shape || !shape._hasPhantom) return
  if(Array.isArray(shape.pointsLL) && shape.pointsLL.length){ shape.pointsLL.pop() }
  if(Array.isArray(shape.pointsUI) && shape.pointsUI.length){ shape.pointsUI.pop() }
  shape._hasPhantom = false
}

function finishDrawing(){
  if(!drawing) return
  // Drop phantom if present so we only keep confirmed vertices
  discardPhantomPoint()
  const ptsLL: LatLonPoint[] = Array.isArray(drawing.pointsLL) ? drawing.pointsLL.slice() as LatLonPoint[] : []
  if(ptsLL.length < 2){ stopDrawing(); return }
  // Endpoints
  const projectUI = (ll: LatLonPoint): UIPoint => { const p = projectLatLonToUI(ll[1], ll[0]); return [p.x, p.y] }
  const startUI = projectUI(ptsLL[0])
  const endUI = projectUI(ptsLL[ptsLL.length-1])
  let aId = drawing.snappedIds?.[0] || nearestNodeUI(startUI)?.id || null
  let bId = drawing.snappedIds?.[ptsLL.length-1] || nearestNodeUI(endUI)?.id || null
  let createdA = false, createdB = false
  // Create endpoints if needed (OUVRAGE) and lock to GPS if available
  if(!aId){
    // startUI/endUI already represent the intended CENTER
    const ll = unprojectUIToLatLon(startUI[0], startUI[1])
    const na = addNode({ type:'OUVRAGE', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true })
    aId = na.id
    createdA = true
  }
  if(!bId){
    const ll = unprojectUIToLatLon(endUI[0], endUI[1])
    const nb = addNode({ type:'OUVRAGE', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true })
    bId = nb.id
    createdB = true
  }
  // Ensure snapped endpoints have GPS so they stay anchored to the basemap
  const ensureNodeHasGPS = (id: string | null | undefined, ui: UIPoint): void => {
    if(!id) return
    const n = (state.nodes as MutableNode[]).find(nn => nn.id === id)
    if(!n) return
    const lat = Number(n.gps_lat)
    const lon = Number(n.gps_lon)
    const has = Number.isFinite(lat) && Number.isFinite(lon)
    if(!has){
      // ui matches the visual marker center; lock GPS to that point
      const ll = unprojectUIToLatLon(ui[0], ui[1])
      if(Number.isFinite(ll?.lat) && Number.isFinite(ll?.lon)){
        updateNode(id, { gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true })
      }
    }
  }
  ensureNodeHasGPS(aId, startUI)
  ensureNodeHasGPS(bId, endUI)

  const snappedIds: (string | null)[] = Array.isArray(drawing.snappedIds) ? drawing.snappedIds.slice() as (string | null)[] : []
  const pointCount = ptsLL.length
  while(snappedIds.length < pointCount) snappedIds.push(null)
  snappedIds[0] = aId
  snappedIds[pointCount-1] = bId
  const nodeAtIndex = snappedIds.map(id => id || null)
  const nodeIdsOnPath = new Set<string>(
    nodeAtIndex.filter((id): id is string => typeof id === 'string' && id.length > 0),
  )

  const baseProps = (() => {
    if(antennaSeedProps) return antennaSeedProps
    if(antennaSeedNodeId){
      const props = inferPropsFromNodeId(antennaSeedNodeId)
      if(props) return props
    }
    const startProps = inferPropsFromNodeId(aId)
    if(startProps) return startProps
    const endProps = inferPropsFromNodeId(bId)
    if(endProps) return endProps
    for(const nid of nodeIdsOnPath){
      const props = inferPropsFromNodeId(nid)
      if(props) return props
    }
    return null
  })()

  const segments: SegmentSpec[] = []
  let segStartIdx = 0
  let segStartNode = nodeAtIndex[0] || aId
  for(let i=1;i<pointCount;i++){
    const maybeNode = nodeAtIndex[i]
    if(maybeNode && segStartNode){
      if(maybeNode !== segStartNode){
      const slice = ptsLL.slice(segStartIdx, i + 1).map(pt => [pt[0], pt[1]] as LatLonPoint)
        if(slice.length >= 2){ segments.push({ from: segStartNode, to: maybeNode, geometry: slice }) }
        segStartIdx = i
        segStartNode = maybeNode
      } else {
        segStartIdx = i
      }
    }
  }
  if(!segments.length){
    const slice = ptsLL.map(pt => [pt[0], pt[1]] as LatLonPoint)
    if(slice.length >= 2) segments.push({ from: aId, to: bId, geometry: slice })
  }

  const edgesCreated: MutableEdge[] = []
  const nodeSegments = new Map<string, string[]>()
  const registerEdgeForNode = (nodeId: string | null | undefined, edgeId: string | null | undefined): void => {
    if(!nodeId || !edgeId) return
    const arr = nodeSegments.get(nodeId) ?? []
    arr.push(edgeId)
    nodeSegments.set(nodeId, arr)
  }
  for(const seg of segments){
    if(!seg.from || !seg.to) continue
    const edge = addEdge(seg.to, seg.from, { active: true })
    if(!edge?.id) continue
    const geom = Array.isArray(seg.geometry)
      ? [...seg.geometry].reverse() as GeometryPoint[]
      : (seg.geometry as GeometryPoint[])
    updateEdge(edge.id, { geometry: geom })
    edgesCreated.push(edge)
    registerEdgeForNode(seg.from, edge.id)
    registerEdgeForNode(seg.to, edge.id)
  }
  if(!edgesCreated.length){ stopDrawing(); return }

  const cleanId = (value: unknown): string => {
    if(value == null) return ''
    const txt = String(value).trim()
    return txt
  }
  const seedCandidates = []
  if(baseProps?.branch_id) seedCandidates.push(baseProps.branch_id)
  if(antennaSeedProps?.branch_id) seedCandidates.push(antennaSeedProps.branch_id)
  const startNodeObj = state.nodes.find(nn => nn.id === aId)
  const endNodeObj = state.nodes.find(nn => nn.id === bId)
  if(startNodeObj?.branch_id) seedCandidates.push(startNodeObj.branch_id)
  if(endNodeObj?.branch_id) seedCandidates.push(endNodeObj.branch_id)
  const branchSeed = seedCandidates.map(cleanId).find(Boolean) || ''

  const branchIdForEdge = (edge: MutableEdge | null | undefined): string => {
    if(!edge) return branchSeed || ''
    const target = (state.nodes as MutableNode[]).find(nn => nn.id === (edge.to_id ?? edge.target))
    const source = (state.nodes as MutableNode[]).find(nn => nn.id === (edge.from_id ?? edge.source))
    const candidates = [
      edge.branch_id,
      target?.branch_id,
      source?.branch_id,
      branchSeed,
    ].map(cleanId).filter(Boolean)
    return candidates.length ? candidates[0] : cleanId(edge.id)
  }

  const applyEdgeProps = (edge: MutableEdge | null | undefined): void => {
    if(!edge) return
    const branch = branchIdForEdge(edge)
    const patch: EdgePatch = { branch_id: branch }
    mergeEdgeProps(patch, baseProps)
    const manual = (getManualEdgeProps(branch) || {}) as EdgeProps

    if(manual.diameter_mm != null){
      patch.diameter_mm = manual.diameter_mm
    } else if(patch.diameter_mm == null){
      const existing = finiteDiameter(edge.diameter_mm)
      if(existing != null) patch.diameter_mm = existing
    }

    const normaliseMaterial = (value: unknown): string | null => {
      if(value == null || value === undefined) return null
      const txt = String(value).trim()
      return txt ? txt.toUpperCase() : null
    }
    const normaliseSdr = (value: unknown): string | null => {
      if(value == null || value === undefined) return null
      const txt = String(value).trim()
      return txt ? txt.toUpperCase() : null
    }

    const materialSource = manual.material ?? patch.material ?? edge.material
    const sdrSource = manual.sdr ?? patch.sdr ?? edge.sdr
    patch.material = normaliseMaterial(materialSource)
    patch.sdr = normaliseSdr(sdrSource)

    if(patch.material === undefined) patch.material = null
    if(patch.sdr === undefined) patch.sdr = null

    if(Object.keys(patch).length){
      updateEdge(edge.id, patch)
    }
  }
  edgesCreated.forEach(applyEdgeProps)

  const branchIdForNode = (nodeId: string | null | undefined): string => {
    if(!nodeId) return ''
    const node = (state.nodes as MutableNode[]).find(n => n.id === nodeId)
    if(!node) return ''
    const edgesForNode = nodeSegments.get(nodeId) ?? []
    for(const eid of edgesForNode){
      const edge = (state.edges as MutableEdge[]).find(e => e.id === eid)
      const branch = branchIdForEdge(edge)
      if(cleanId(branch)) return branch
    }
    if(cleanId(node.branch_id)) return cleanId(node.branch_id)
    return branchSeed || ''
  }

  const assignNodeToBranch = (id: string | null | undefined): void => {
    if(!id) return
    const n = (state.nodes as MutableNode[]).find(nn=>nn.id===id)
    if(!n) return
    const desired = branchIdForNode(id)
    if(cleanId(desired) && cleanId(n.branch_id) !== cleanId(desired)){
      updateNode(id, { branch_id: cleanId(desired) })
    }
  }
  const assignInlineToEdge = (id: string | null | undefined): void => {
    if(!id) return
    const n = (state.nodes as MutableNode[]).find(nn=>nn.id===id)
    if(!n) return
    const T = String(n.type||'').toUpperCase()
    if(T==='POINT_MESURE' || T==='VANNE'){
      const usableEdges = nodeSegments.get(id) ?? []
      const hint = (drawing?.anchorHints?.get(id) as AnchorHint | undefined) || null
      const upstreamEdge = usableEdges
        .map(eid => (state.edges as MutableEdge[]).find(e => e.id === eid))
        .find(edge => edge && (edge.to_id ?? edge.target) === id)
      const fallbackEdgeId = usableEdges[0] || edgesCreated[0]?.id || null
      const targetEdge = hint?.edgeId || upstreamEdge?.id || fallbackEdgeId
      const patch: EdgePatch = {}
      if(targetEdge && n.pm_collector_edge_id !== targetEdge){
        patch.pm_collector_edge_id = targetEdge
        patch.attach_edge_id = targetEdge
      }
      if(n.pm_collector_id){ patch.pm_collector_id = '' }
      if(targetEdge){
        const edge = (state.edges as MutableEdge[]).find(e => e.id === targetEdge)
        const offsetVal = (hint && hint.offset != null) ? hint.offset : offsetAlongGeometry(edge, n)
        let clamped = Number(offsetVal)
        if(Number.isFinite(clamped)){
          if(edge){
            if(typeof edge.length_m === 'number' && Number.isFinite(edge.length_m)){
              clamped = Math.min(clamped, edge.length_m)
            }else{
              const geomLength = geometryLengthMeters(edge.geometry)
              if(typeof geomLength === 'number' && Number.isFinite(geomLength)){
                clamped = Math.min(clamped, geomLength)
              }
            }
          }
          patch.pm_offset_m = roundMeters(clamped)
        }else{
          patch.pm_offset_m = null
        }
      }
      if(Object.keys(patch).length){ updateNode(id, patch) }
      if(hint){
        try{ drawing?.anchorHints?.delete(id) }catch{}
      }
    }
  }
  assignNodeToBranch(aId)
  assignNodeToBranch(bId)
  assignInlineToEdge(aId)
  assignInlineToEdge(bId)
  for(const nid of nodeIdsOnPath){
    if(nid===aId || nid===bId) continue
    assignNodeToBranch(nid)
    assignInlineToEdge(nid)
  }

  stopDrawing()
  try{ setMode('select') }catch{}
}

function findNearestEdgeHit(x: number, y: number): { edge: MutableEdge; hit: NonNullable<PolylineHit> } | null {
  let best: { edge: MutableEdge; hit: NonNullable<PolylineHit> } | null = null
  for(const e of state.edges as MutableEdge[]){
    const pts = edgeGeometryToUIPoints(e, state.nodes)
    if(pts.length<2) continue
    const hit = nearestPointOnPolyline(pts, x, y)
    if(hit && Number.isFinite(hit.d2) && hit.d2 < (EDGE_TOL*EDGE_TOL)){
      if(!best || hit.d2 < best.hit.d2) best = { edge:e, hit }
    }
  }
  return best
}

function splitEdgeAt(edge: MutableEdge, hit: NonNullable<PolylineHit>): SplitResult | null {
  const geom = ensureEdgeGeometry(edge, state.nodes as MutableNode[])
  if(!geom) return null
  const parts = splitGeometryAt(geom, hit)
  const fromId = edge.from_id ?? edge.source
  const toId   = edge.to_id   ?? edge.target
  if(!fromId || !toId) return null
  const keepActive = edge.active!==false
  const commentaire = edge.commentaire || ''
  const baseProps = pickEdgeProps(edge)
  const branchId = (() => {
    const candidates = [edge.branch_id, baseProps?.branch_id, edge.id]
    for(const cand of candidates){
      if(cand && String(cand).trim()) return String(cand).trim()
    }
    return ''
  })()
  // Create the new node at hit point, lock to GPS
  const ll = unprojectUIToLatLon(hit.px, hit.py)
  const node = addNode({ type:'JONCTION', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true, name:'', x: hit.px, y: hit.py }) as MutableNode
  const buildEdgeOpts = (): EdgePatch => {
    const opts: EdgePatch = { active: keepActive, commentaire }
    if(branchId) opts.branch_id = branchId
    mergeEdgeProps(opts, baseProps)
    return opts
  }
  let upstreamEdgeId: string | null = null
  suspendOrphanPrune(()=>{
    if(edge.id) removeEdge(edge.id)
    const newEdgeA = addEdge(fromId, node.id, buildEdgeOpts())
    if(newEdgeA?.id){
      upstreamEdgeId = newEdgeA.id
      updateEdge(newEdgeA.id, { geometry: parts.g1 })
    }
    const newEdgeB = addEdge(node.id, toId, buildEdgeOpts())
    if(newEdgeB?.id){
      updateEdge(newEdgeB.id, { geometry: parts.g2 })
    }
  })
  if(branchId) updateNode(node.id, { branch_id: branchId })
  const offsetMeters = geometryLengthMeters(parts.g1)
  return {
    nodeId: node.id,
    ui: [hit.px, hit.py] as UIPoint,
    edgeProps: baseProps,
    anchorEdgeId: upstreamEdgeId,
    anchorOffsetM: roundMeters(offsetMeters),
  }
}

export function attachDraw(
  svgSel: Selection<SVGSVGElement, unknown, BaseType, unknown>,
  gOverlay: Selection<SVGGElement, unknown, BaseType, unknown>,
): void {
  overlayRef = gOverlay
  // React to mode changes: clear preview when leaving draw mode
  subscribe((evt)=>{ if(evt==='mode:set' && getMode()!=='draw') stopDrawing() })
  // Keep preview in sync with map moves/zooms by reprojecting from GPS
  try{
    document.addEventListener('map:view', ()=>{
      if(getMode()!=='draw' || !drawing) return
      updatePreview()
    })
  }catch{}

  function onClick(evt: MouseEvent): void {
    if(getMode()!=='draw') return
    if(!drawing) startDrawing(gOverlay)
    const shape = drawing
    if(!shape) return
    const ui = getUIFromEvent(evt)
    const snapNode = nearestNodeUI(ui)
    let usePt: UIPoint = ui
    let snappedId: string | null = null
    if(snapNode){
      const c = centerUIForNode(snapNode.node as MutableNode)
      usePt = [c[0], c[1]]
      snappedId = snapNode.id
      try{ console.debug('[dev] draw click node', snappedId) }catch{}
    }
    else{
      // Try snapping to existing edge segment
      const best = findNearestEdgeHit(ui[0], ui[1])
      if(best){
        const res = splitEdgeAt(best.edge, best.hit)
        if(res){
          usePt = res.ui
          snappedId = res.nodeId
          if(res.edgeProps){ antennaSeedProps = res.edgeProps }
          if(res.anchorEdgeId){
            try{ shape.anchorHints?.set(res.nodeId, { edgeId: res.anchorEdgeId, offset: res.anchorOffsetM }) }catch{}
          }
          // Mini menu (type du nœud inséré) — pas d'antenne ici car on est déjà en dessin
          try{
            showMiniMenu(evt.clientX, evt.clientY, [
              { label: 'Jonction', onClick: ()=> updateNode(res.nodeId, { type:'JONCTION' }) },
              { label: 'Point de mesure', onClick: ()=> {
                  const cx = res.ui?.[0] ?? 0, cy = res.ui?.[1] ?? 0
                  const ll = unprojectUIToLatLon(cx, cy)
                  const pmPatch: EdgePatch = { type:'POINT_MESURE', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true }
                  if(res.anchorEdgeId){ pmPatch.pm_collector_edge_id = res.anchorEdgeId; pmPatch.attach_edge_id = res.anchorEdgeId }
                  if(res.anchorOffsetM != null){ pmPatch.pm_offset_m = res.anchorOffsetM }
                  updateNode(res.nodeId, pmPatch)
                }
              },
              { label: 'Vanne', onClick: ()=> {
                  const cx = res.ui?.[0] ?? 0, cy = res.ui?.[1] ?? 0
                  const ll = unprojectUIToLatLon(cx, cy)
                  const vPatch: EdgePatch = { type:'VANNE', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true }
                  if(res.anchorEdgeId){ vPatch.pm_collector_edge_id = res.anchorEdgeId; vPatch.attach_edge_id = res.anchorEdgeId }
                  if(res.anchorOffsetM != null){ vPatch.pm_offset_m = res.anchorOffsetM }
                  updateNode(res.nodeId, vPatch)
                }
              },
            ])
          }catch{}
          try{ console.debug('[dev] draw split edge', best.edge?.id, '-> node', snappedId) }catch{}
        }
      } else { try{ console.debug('[dev] draw click free', Math.round(ui[0]), Math.round(ui[1])) }catch{} }
    }
    // Store authoritative GPS for anchoring across view changes
    const ll = unprojectUIToLatLon(usePt[0], usePt[1])
    if(!Array.isArray(shape.pointsLL)) shape.pointsLL = [] as LatLonPoint[]
    if(!Array.isArray(shape.pointsUI)) shape.pointsUI = [] as UIPoint[]
    if(!Array.isArray(shape.snappedIds)) shape.snappedIds = [] as (string | null)[]
    if(shape._hasPhantom && shape.pointsLL.length){
      const lastIdx = shape.pointsLL.length - 1
      shape.pointsLL[lastIdx] = [ll.lon, ll.lat] as LatLonPoint
      shape.pointsUI[lastIdx] = usePt
      shape.snappedIds[lastIdx] = snappedId
      shape._hasPhantom = false
    } else {
      shape.pointsLL.push([ll.lon, ll.lat] as LatLonPoint)
      // UI cache will be recomputed from GPS in updatePreview
      shape.pointsUI.push(usePt)
      shape.snappedIds.push(snappedId)
    }
    if(snappedId && !antennaSeedProps){
      antennaSeedProps = inferPropsFromNodeId(snappedId)
    }
    updatePreview()
  }

  function onMove(evt: MouseEvent): void {
    if(getMode()!=='draw' || !drawing) return
    const shape = drawing
    if(!shape) return
    const ui = getUIFromEvent(evt)
    const snap = nearestNodeUI(ui)
    const p: UIPoint = snap ? centerUIForNode(snap.node as MutableNode) : ui
    // Update the last phantom point for live preview
    const ll = unprojectUIToLatLon(p[0], p[1])
    if(!shape._hasPhantom){
      // Prime both LL and UI caches
      shape.pointsLL.push([ll.lon, ll.lat])
      shape.pointsUI.push(p)
      shape._hasPhantom = true
    } else {
      // Replace last phantom
      if(Array.isArray(shape.pointsLL) && shape.pointsLL.length){ shape.pointsLL[shape.pointsLL.length-1] = [ll.lon, ll.lat] }
      shape.pointsUI[shape.pointsUI.length-1] = p
    }
    updatePreview()
  }

  function onDblClick(evt: MouseEvent): void {
    if(getMode()!=='draw') return
    if(!drawing) return
    discardPhantomPoint()
    try{ console.debug('[dev] draw finish with', drawing.pointsUI.length, 'points') }catch{}
    finishDrawing()
  }

  function onKey(evt: KeyboardEvent): void {
    if(getMode()!=='draw') return
    if(evt.key==='Escape'){ stopDrawing() }
    if(evt.key==='Enter'){
      if(!drawing) return
      evt.preventDefault()
      discardPhantomPoint()
      finishDrawing()
    }
  }

  const svg = svgSel.node()
  if(svg){
    // Capture phase to preempt selection handlers on nodes/edges
    svg.addEventListener('click', (e: MouseEvent)=>{ if(getMode()==='draw'){ onClick(e); e.stopPropagation(); e.preventDefault() } }, true)
    svg.addEventListener('mousemove', onMove)
    svg.addEventListener('dblclick', (e: MouseEvent)=>{ if(getMode()==='draw'){ onDblClick(e); e.stopPropagation(); e.preventDefault() } }, true)
  }
  window.addEventListener('keydown', onKey)
}

export function startDrawingFromNodeId(nodeId: string | null | undefined): void {
  try{
    if(!overlayRef) return
    const n = state.nodes.find(nn=>nn.id===nodeId)
    if(!n) return
    if(!drawing && overlayRef) startDrawing(overlayRef)
    const shape = drawing
    if(!shape) return
    const c = centerUIForNode(n)
    shape.pointsUI = [[c[0], c[1]] as UIPoint]
    const ll = unprojectUIToLatLon(c[0], c[1])
    shape.pointsLL = [[ll.lon, ll.lat] as LatLonPoint]
    shape.snappedIds = [nodeId ?? null]
    antennaSeedNodeId = nodeId ?? null
    const baseProps = inferPropsFromNodeId(nodeId)
    if(baseProps){
      const nextProps = { ...baseProps }
      const branch = typeof nextProps.branch_id === 'string' ? nextProps.branch_id.trim() : (nextProps.branch_id ? String(nextProps.branch_id).trim() : '')
      if(branch){
        nextProps.branch_id = generateBranchId()
      }
      antennaSeedProps = nextProps
    } else if(!antennaSeedProps){
      antennaSeedProps = null
    }
    updatePreview()
    triggerBranchRecalc()
  }catch{}
}
