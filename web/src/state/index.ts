
import { genIdWithTime as genId, snap as snapToGrid, incrementName, defaultName } from '../utils.ts'
import { setGeoCenter as applyGeoCenter } from '../geo.ts'
import { normalizeGraph, reprojectNodesFromGPS } from './normalize.ts'
import type { MutableNode, MutableEdge } from './normalize.ts'
import { enforceEdgeOnlyNodeType } from './graph-rules.ts'
import { recomputeBranches } from '../api.ts'
import type { Graph } from '../types/graph'
import type { PlanOverlayConfig, PlanOverlayBounds, LatLon } from '../types/plan-overlay.ts'
import { d3 } from '../vendor.ts'
import { NODE_SIZE } from '../constants/nodes.ts'

export { setGeoScale, setGeoCenter } from '../geo.ts'

const DEV_BUILD = typeof __DEV__ !== 'undefined' && __DEV__ === true

const debugPlanState = DEV_BUILD
  ? (...args: unknown[]): void => {
      try{
        if(typeof console === 'undefined') return
        const g = typeof window !== 'undefined' ? (window as { __PLAN_DEBUG?: boolean }) : null
        if(g && g.__PLAN_DEBUG !== true) return
        console.debug('[plan:state]', ...args)
      }catch{}
    }
  : () => {}

type BranchMeta = {
  id: string
  name: string
  parent_id: string | null
  is_trunk: boolean
}

type BranchEntry = BranchMeta | Record<string, unknown>

type BranchDiagnosticsEntry = Record<string, unknown>
type BranchChangeEntry = Record<string, unknown>
type BranchConflictEntry = Record<string, unknown>

type BranchRecalcResult = {
  edges?: Array<{ id: string; branch_id?: string | null }>
  nodes?: Array<{ id: string; branch_id?: string | null }>
  branch_diagnostics?: BranchDiagnosticsEntry[]
  branch_changes?: BranchChangeEntry[]
  branch_conflicts?: BranchConflictEntry[]
}

type BranchStyleMeta = {
  branch_names_by_id?: Record<string, string>
  [key: string]: unknown
}

type GraphMetaState = {
  version: string
  site_id: string | null
  generated_at: string | null
  style_meta: BranchStyleMeta
}

export type PlanOverlayState = {
  config: PlanOverlayConfig | null
  planId: string | null
  imageTransparentUrl: string | null
  imageOriginalUrl: string | null
  useTransparent: boolean
  enabled: boolean
  opacity: number
  rotationDeg: number
   scalePercent: number
  editable: boolean
  originalBounds: PlanOverlayBounds | null
  currentBounds: PlanOverlayBounds | null
  dirty: boolean
  saving: boolean
  loading: boolean
  error: string | null
}

type ClipboardPayload = {
  nodes: MutableNode[]
  edges: Array<Partial<MutableEdge>>
} | MutableNode[] | null

type StateSelection = {
  nodeId: string | null
  edgeId: string | null
  multi: Set<string>
}

export type EditorState = {
  nodes: MutableNode[]
  edges: MutableEdge[]
  graphMeta: GraphMetaState
  branches: BranchMeta[]
  branchMap: Map<string, BranchMeta>
  branchDiagnostics: BranchDiagnosticsEntry[]
  branchChanges: BranchChangeEntry[]
  branchConflicts: BranchConflictEntry[]
  selection: StateSelection
  clipboard: ClipboardPayload
  mode: string
  viewMode: string
  gridStep: number
  _spawnIndex: number
  edgeVarWidth: boolean
  crs: { code: string; projected_for_lengths: string }
  planOverlay: PlanOverlayState
}

export const state: EditorState = {
  nodes: [] as MutableNode[],
  edges: [] as MutableEdge[],
  graphMeta: {
    version: '1.5',
    site_id: null,
    generated_at: null,
    style_meta: {} as BranchStyleMeta,
  },
  branches: [] as BranchMeta[],
  branchMap: new Map<string, BranchMeta>(),
  branchDiagnostics: [] as BranchDiagnosticsEntry[],
  branchChanges: [] as BranchChangeEntry[],
  branchConflicts: [] as BranchConflictEntry[],
  selection: { nodeId: null, edgeId: null, multi: new Set<string>() },
  clipboard: null,
  mode: 'select',
  viewMode: 'geo',
  gridStep: 8,
  _spawnIndex: 0,
  edgeVarWidth: true,
  crs: { code: 'EPSG:4326', projected_for_lengths: 'EPSG:2154' },
  planOverlay: {
    config: null,
    planId: null,
    imageTransparentUrl: null,
    imageOriginalUrl: null,
    useTransparent: true,
    enabled: false,
    opacity: 0.7,
    rotationDeg: 0,
    scalePercent: 100,
    editable: false,
    originalBounds: null,
    currentBounds: null,
    dirty: false,
    saving: false,
    loading: false,
    error: null,
  },
}

const GLOBAL_BRANCH_KEY = '__global__'
type ManualEdgeDefaults = {
  diameter_mm?: number
  material?: string
  sdr?: string
}

type ManualEdgePatchInput = {
  diameter_mm?: number | string | null
  material?: unknown
  sdr?: unknown
}

const manualEdgeDefaults = new Map<string, ManualEdgeDefaults>()
const DEFAULT_CRS: EditorState['crs'] = { code: 'EPSG:4326', projected_for_lengths: 'EPSG:2154' }

const NODE_BRANCH_FIELDS = ['branch_id', 'branchId', 'type'] as const
const EDGE_BRANCH_FIELDS = ['branch_id', 'branchId', 'from_id', 'to_id', 'source', 'target', 'geometry'] as const

const PLAN_OPACITY_MIN = 0
const PLAN_OPACITY_MAX = 1
const PLAN_ROTATION_MIN = -180
const PLAN_ROTATION_MAX = 180
const PLAN_DIRTY_TOLERANCE = 1e-9
const PLAN_SCALE_PERCENT_MIN = 25
const PLAN_SCALE_PERCENT_MAX = 200

const PLAN_CORNER_KEYS = ['sw', 'se', 'nw', 'ne'] as const
type PlanCornerKey = typeof PLAN_CORNER_KEYS[number]

const cloneLatLon = (value: LatLon | null | undefined): LatLon | null => {
  if(!value) return null
  try{
    const lat = Number(value.lat)
    const lon = Number(value.lon)
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) return null
    return { lat, lon }
  }catch{
    return null
  }
}

const cloneBounds = (bounds: PlanOverlayBounds | null | undefined): PlanOverlayBounds | null => {
  if(!bounds) return null
  const entries: Partial<Record<PlanCornerKey, LatLon>> = {}
  let ok = true
  for(const key of PLAN_CORNER_KEYS){
    const cloned = cloneLatLon(bounds[key])
    if(!cloned){
      ok = false
      break
    }
    entries[key] = cloned
  }
  if(!ok){
    return null
  }
  return {
    sw: entries.sw!,
    se: entries.se!,
    nw: entries.nw!,
    ne: entries.ne!,
  }
}

const boundsEqual = (
  a: PlanOverlayBounds | null | undefined,
  b: PlanOverlayBounds | null | undefined,
  tolerance = PLAN_DIRTY_TOLERANCE,
): boolean => {
  if(!a || !b) return a == null && b == null
  for(const key of PLAN_CORNER_KEYS){
    const pa = a[key]
    const pb = b[key]
    if(!pa || !pb) return false
    if(Math.abs(pa.lat - pb.lat) > tolerance) return false
    if(Math.abs(pa.lon - pb.lon) > tolerance) return false
  }
  return true
}

const clamp = (value: number, min: number, max: number): number => {
  if(!Number.isFinite(value)) return min
  if(value < min) return min
  if(value > max) return max
  return value
}

const planIdFromConfig = (config: PlanOverlayConfig | null): string | null => {
  if(!config) return null
  const media = config.media || { type: '', source: '' }
  const driveId = (media.drive_file_id ?? '').toString().trim()
  if(driveId) return `drive:${driveId}`
  const url = (media.url ?? '').toString().trim()
  if(url) return `url:${url}`
  return null
}

const activeImageUrl = (plan: PlanOverlayState): string | null => {
  const transparentUrl = plan.imageTransparentUrl
  const originalUrl = plan.imageOriginalUrl
  if(plan.useTransparent){
    return transparentUrl || originalUrl
  }
  return originalUrl || transparentUrl
}

const defaultPlanOpacity = (config: PlanOverlayConfig | null): number => {
  if(!config) return 0.7
  const raw = Number(config.defaults?.opacity ?? 0.7)
  if(Number.isNaN(raw)) return 0.7
  if(raw > 1 && raw <= 100) return clamp(raw / 100, PLAN_OPACITY_MIN, PLAN_OPACITY_MAX)
  return clamp(raw, PLAN_OPACITY_MIN, PLAN_OPACITY_MAX)
}

const defaultPlanRotation = (config: PlanOverlayConfig | null): number => {
  if(!config) return 0
  const raw = Number(config.defaults?.bearing_deg ?? 0)
  if(Number.isNaN(raw)) return 0
  return clamp(raw, PLAN_ROTATION_MIN, PLAN_ROTATION_MAX)
}

const canonBranchId = (value: unknown): string | null => {
  const txt = (value == null) ? '' : String(value).trim()
  return txt || null
}

function normaliseBranchEntry(entry: BranchEntry | null | undefined): BranchMeta | null {
  if(!entry) return null
  const source = entry as Record<string, unknown>
  const id = canonBranchId(source.id ?? source.ID ?? source.BranchId)
  if(!id) return null
  let name = ''
  if(source.name != null) name = String(source.name).trim()
  if(!name){
    try{
      const metaNames = state.graphMeta?.style_meta?.branch_names_by_id
      if(metaNames && typeof metaNames === 'object'){
        const lookup = metaNames[id]
        if(lookup != null){
          const candidate = String(lookup).trim()
          if(candidate) name = candidate
        }
      }
    }catch{}
  }
  const parentRaw = source.parent_id ?? source.parentId ?? source.parentID
  const parent = parentRaw == null ? null : canonBranchId(parentRaw)
  const isTrunk = !!(source.is_trunk ?? source.isTrunk)
  return {
    id,
    name: name || id,
    parent_id: parent,
    is_trunk: isTrunk,
  }
}

function normalizeBranchesForState(entries: Iterable<BranchEntry | null | undefined> | null | undefined): BranchMeta[] {
  const map = new Map<string, BranchMeta>()
  if(entries){
    for(const entry of entries){
      const branch = normaliseBranchEntry(entry)
      if(!branch) continue
      const existing = map.get(branch.id)
      if(existing){
        if(!existing.name && branch.name) existing.name = branch.name
        if(!existing.parent_id && branch.parent_id) existing.parent_id = branch.parent_id
        if(!existing.is_trunk && branch.is_trunk) existing.is_trunk = true
        continue
      }
      map.set(branch.id, branch)
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

const manualKey = (branchId: unknown): string => canonBranchId(branchId) || GLOBAL_BRANCH_KEY

const normaliseMaterial = (value: unknown): string | null => {
  if(value == null || value === '') return null
  const txt = String(value).trim()
  return txt ? txt.toUpperCase() : null
}

const normaliseSdr = (value: unknown): string | null => {
  if(value == null || value === '') return null
  const txt = String(value).trim()
  return txt ? txt.toUpperCase() : null
}

function insertManualDefaults(branchId: unknown, patch: ManualEdgePatchInput | null | undefined): void {
  if(!patch || typeof patch !== 'object') return
  const key = manualKey(branchId)
  const current = manualEdgeDefaults.get(key) || {}
  const next: ManualEdgeDefaults = { ...current }

  if(Object.prototype.hasOwnProperty.call(patch, 'diameter_mm')){
    const val = patch.diameter_mm
    if(val == null || val === ''){
      delete next.diameter_mm
    }else{
      const num = Number(val)
      if(Number.isFinite(num) && num > 0){
        next.diameter_mm = num
      }
    }
  }

  if(Object.prototype.hasOwnProperty.call(patch, 'material')){
    const mat = normaliseMaterial(patch.material)
    if(mat){ next.material = mat } else { delete next.material }
  }

  if(Object.prototype.hasOwnProperty.call(patch, 'sdr')){
    const sdr = normaliseSdr(patch.sdr)
    if(sdr){ next.sdr = sdr } else { delete next.sdr }
  }

  if(Object.keys(next).length){
    manualEdgeDefaults.set(key, next)
  }else{
    manualEdgeDefaults.delete(key)
  }
}

function fetchManualDefaults(branchId: unknown): ManualEdgeDefaults | null {
  const key = manualKey(branchId)
  const direct = manualEdgeDefaults.get(key)
  if(direct) return { ...direct }
  const fallback = manualEdgeDefaults.get(GLOBAL_BRANCH_KEY)
  return fallback ? { ...fallback } : null
}

type ViewportCenter = { x: number; y: number; rawX?: number; rawY?: number }

function getViewportCenter(): ViewportCenter {
  const base = 400
  const x = snapToGrid(base, state.gridStep)
  const y = snapToGrid(base, state.gridStep)
  return { x, y, rawX: base, rawY: base }
}

export function clearManualDiameter(){
  manualEdgeDefaults.clear()
}

export function recordManualDiameter(branchId: unknown, diameter: number | string | null | undefined): void {
  insertManualDefaults(branchId, { diameter_mm: diameter })
}

export function recordManualEdgeProps(branchId: unknown, patch: ManualEdgePatchInput | null | undefined): void {
  if(!patch || typeof patch !== 'object') return
  insertManualDefaults(branchId, patch)
}


export function getManualEdgeProps(branchId: unknown): ManualEdgeDefaults | null {
  const defaults = fetchManualDefaults(branchId)
  return defaults ? { ...defaults } : null
}

function rebuildBranchMap(list: unknown): void {
  const nextMap = new Map<string, BranchMeta>()
  if(Array.isArray(list)){
    for(const entry of list){
      if(!entry) continue
      const branch = normaliseBranchEntry(entry)
      if(!branch) continue
      nextMap.set(branch.id, branch)
    }
  }
  state.branchMap = nextMap
}

export function getBranch(branchId: unknown): BranchMeta | null {
  const id = canonBranchId(branchId)
  if(!id) return null
  return state.branchMap.get(id) || null
}

export function getBranchName(branchId: unknown): string {
  const id = canonBranchId(branchId)
  if(!id) return ''
  const entry = state.branchMap.get(id)
  const name = entry?.name != null ? String(entry.name).trim() : ''
  return name || id
}

export function setBranchName(branchId: unknown, name: unknown): void {
  const id = canonBranchId(branchId)
  if(!id) return
  const cleanName = name == null ? '' : String(name).trim()
  const desiredName = cleanName || id
  const baseline = normalizeBranchesForState(state.branches)
  let updated = false
  let found = false
  const buffer = []
  for(const branch of baseline){
    if(branch.id === id){
      found = true
      if(branch.name !== desiredName){
        updated = true
      }
      buffer.push({ ...branch, name: desiredName })
    }else{
      buffer.push(branch)
    }
  }
  if(!found){
    buffer.push({ id, name: desiredName, parent_id: null, is_trunk: id.startsWith('GENERAL-') })
    updated = true
  }
  state.branches = normalizeBranchesForState(buffer)
  rebuildBranchMap(state.branches)
  const nextStyleMeta = (() => {
    const base = (state.graphMeta?.style_meta && typeof state.graphMeta.style_meta === 'object') ? { ...state.graphMeta.style_meta } : {}
    const namesMap = { ...(base.branch_names_by_id || {}) }
    if(cleanName){
      namesMap[id] = desiredName
    }else{
      delete namesMap[id]
    }
    if(Object.keys(namesMap).length){
      base.branch_names_by_id = namesMap
    }else{
      delete base.branch_names_by_id
    }
    return base
  })()
  state.graphMeta = {
    ...state.graphMeta,
    style_meta: nextStyleMeta,
  }
  if(updated){
    notify('branch:update', { id, name: getBranchName(id) })
  }
}

function syncBranchesWithUsage(): boolean {
  // Ensure every branch referenced by nodes/edges has a matching entry with a default name.
  const used = new Set<string>()
  const metaBranchNames = (() => {
    try{
      const raw = state.graphMeta?.style_meta?.branch_names_by_id
      if(raw && typeof raw === 'object') return raw
    }catch{}
    return {}
  })()
  for(const edge of state.edges){
    if(!edge) continue
    const branchId = canonBranchId(edge.branch_id ?? edge.branchId)
    if(branchId) used.add(branchId)
  }
  for(const node of state.nodes){
    if(!node) continue
    const branchId = canonBranchId(node.branch_id ?? node.branchId)
    if(branchId) used.add(branchId)
  }
  const additions = Array.from(used).map(id => {
    const key = canonBranchId(id)
    if(!key) return { id }
    const lookup = metaBranchNames?.[key]
    if(lookup != null){
      const candidate = String(lookup).trim()
      if(candidate) return { id: key, name: candidate }
    }
    return { id: key }
  })
  const next = normalizeBranchesForState([...(state.branches || []), ...additions])
  let changed = next.length !== (state.branches?.length ?? 0)
  if(!changed){
    for(let i = 0; i < next.length; i += 1){
      const prev = state.branches[i]
      const curr = next[i]
      if(!prev || prev.id !== curr.id || prev.name !== curr.name || prev.parent_id !== curr.parent_id || !!prev.is_trunk !== !!curr.is_trunk){
        changed = true
        break
      }
    }
  }
  state.branches = next
  rebuildBranchMap(state.branches)
  return changed
}

type Listener = (event: string, payload: unknown, state: EditorState) => void

const listeners = new Set<Listener>()
export function subscribe(fn: Listener){ listeners.add(fn); return () => listeners.delete(fn) }
function notify(event: string, payload: unknown = undefined){ for(const fn of listeners) fn(event, payload, state) }

export function getPlanOverlayState(): PlanOverlayState {
  return state.planOverlay
}

export function setPlanOverlayLoading(flag: boolean): void {
  const next = !!flag
  if(state.planOverlay.loading === next) return
  state.planOverlay.loading = next
  notify('plan:loading', { loading: next })
}

export function setPlanOverlayError(message: string | null): void {
  const next = message ? String(message) : null
  if(state.planOverlay.error === next) return
  state.planOverlay.error = next
  notify('plan:error', { error: next })
}

export function setPlanOverlayData(
  config: PlanOverlayConfig | null,
  options?: { transparentUrl?: string | null; originalUrl?: string | null }
): void {
  const prev = { ...state.planOverlay }
  const prevActive = activeImageUrl(prev)
  const newPlanId = planIdFromConfig(config)
  const samePlan = prev.planId !== null && newPlanId !== null && prev.planId === newPlanId
  const transparentProvided = Object.prototype.hasOwnProperty.call(options || {}, 'transparentUrl')
  const originalProvided = Object.prototype.hasOwnProperty.call(options || {}, 'originalUrl')
  const nextTransparentUrl = transparentProvided ? (options?.transparentUrl ?? null) : (samePlan ? prev.imageTransparentUrl : null)
  const nextOriginalUrl = originalProvided ? (options?.originalUrl ?? null) : (samePlan ? prev.imageOriginalUrl : null)

  let configClone: PlanOverlayConfig | null = null
  let initialBounds: PlanOverlayBounds | null = null
  if(config){
    const clonedBounds = cloneBounds(config.bounds) ?? cloneBounds(prev.currentBounds)
    configClone = { ...config, bounds: clonedBounds ?? config.bounds }
    initialBounds = cloneBounds(configClone.bounds)
  }

  state.planOverlay.config = configClone
  state.planOverlay.planId = newPlanId
  state.planOverlay.imageTransparentUrl = nextTransparentUrl
  state.planOverlay.imageOriginalUrl = nextOriginalUrl
  state.planOverlay.error = null
  state.planOverlay.originalBounds = initialBounds ? cloneBounds(initialBounds) : null
  state.planOverlay.currentBounds = initialBounds ? cloneBounds(initialBounds) : null
  state.planOverlay.dirty = false
  state.planOverlay.saving = false
  state.planOverlay.scalePercent = 100

  if(!configClone){
    state.planOverlay.opacity = defaultPlanOpacity(null)
    state.planOverlay.rotationDeg = 0
    state.planOverlay.enabled = false
    state.planOverlay.useTransparent = true
  }else if(samePlan){
    state.planOverlay.opacity = clamp(prev.opacity, PLAN_OPACITY_MIN, PLAN_OPACITY_MAX)
    state.planOverlay.rotationDeg = clamp(prev.rotationDeg, PLAN_ROTATION_MIN, PLAN_ROTATION_MAX)
  }else{
    state.planOverlay.opacity = defaultPlanOpacity(configClone)
    state.planOverlay.rotationDeg = defaultPlanRotation(configClone)
    state.planOverlay.enabled = !!configClone.enabled
    state.planOverlay.useTransparent = nextTransparentUrl != null || nextOriginalUrl == null
  }

  if(state.planOverlay.useTransparent && !state.planOverlay.imageTransparentUrl && state.planOverlay.imageOriginalUrl){
    state.planOverlay.useTransparent = false
  }
  if(!state.planOverlay.useTransparent && !state.planOverlay.imageOriginalUrl && state.planOverlay.imageTransparentUrl){
    state.planOverlay.useTransparent = true
  }

  const activeUrl = activeImageUrl(state.planOverlay)
  if(!activeUrl){
    state.planOverlay.enabled = false
  }

  const configChanged = prev.planId !== state.planOverlay.planId || prev.config !== state.planOverlay.config || prevActive !== activeUrl
  if(configChanged){
    notify('plan:set', { config: state.planOverlay.config, urlTransparent: state.planOverlay.imageTransparentUrl, urlOriginal: state.planOverlay.imageOriginalUrl })
  }
  if(prev.enabled !== state.planOverlay.enabled){
    notify('plan:toggle', { enabled: state.planOverlay.enabled })
  }
  if(prev.opacity !== state.planOverlay.opacity){
    notify('plan:opacity', { opacity: state.planOverlay.opacity })
  }
  if(prev.rotationDeg !== state.planOverlay.rotationDeg){
    notify('plan:rotation', { rotation: state.planOverlay.rotationDeg })
  }
  if(prev.useTransparent !== state.planOverlay.useTransparent){
    notify('plan:mode', { useTransparent: state.planOverlay.useTransparent })
  }
}

export function setPlanOverlayEnabled(enabled: boolean): void {
  const hasImage = !!activeImageUrl(state.planOverlay)
  const next = !!enabled && !!state.planOverlay.config && hasImage
  if(state.planOverlay.enabled === next) return
  state.planOverlay.enabled = next
  notify('plan:toggle', { enabled: state.planOverlay.enabled })
}

export function setPlanOverlayOpacity(value: number): void {
  const next = clamp(value, PLAN_OPACITY_MIN, PLAN_OPACITY_MAX)
  if(!Number.isFinite(next)) return
  if(state.planOverlay.opacity === next) return
  state.planOverlay.opacity = next
  notify('plan:opacity', { opacity: next })
}

export function setPlanOverlayRotation(value: number): void {
  const next = clamp(value, PLAN_ROTATION_MIN, PLAN_ROTATION_MAX)
  if(state.planOverlay.rotationDeg === next) return
  state.planOverlay.rotationDeg = next
  notify('plan:rotation', { rotation: next })
}

export function setPlanOverlayUseTransparent(flag: boolean): void {
  const desired = !!flag
  let next = desired
  const hasTransparent = !!state.planOverlay.imageTransparentUrl
  const hasOriginal = !!state.planOverlay.imageOriginalUrl
  if(desired && !hasTransparent && hasOriginal){
    next = false
  }else if(!desired && !hasOriginal && hasTransparent){
    next = true
  }
  if(state.planOverlay.useTransparent === next) return
  state.planOverlay.useTransparent = next
  if(!activeImageUrl(state.planOverlay)){
    state.planOverlay.enabled = false
    notify('plan:toggle', { enabled: state.planOverlay.enabled })
  }
  notify('plan:mode', { useTransparent: state.planOverlay.useTransparent })
}

export function setPlanOverlayScalePercent(percent: number): void {
  const raw = Number(percent)
  if(!Number.isFinite(raw)) return
  const clamped = clamp(raw, PLAN_SCALE_PERCENT_MIN, PLAN_SCALE_PERCENT_MAX)
  if(state.planOverlay.scalePercent === clamped) return
  state.planOverlay.scalePercent = clamped
  notify('plan:scale', { scalePercent: clamped })
}

export function setPlanOverlayEditable(flag: boolean): void {
  const next = !!flag
  if(state.planOverlay.editable === next) return
  state.planOverlay.editable = next
  notify('plan:editable', { editable: next })
}

export function setPlanOverlayBounds(bounds: PlanOverlayBounds | null): void {
  const config = state.planOverlay.config
  if(!config || !bounds){
    debugPlanState('setPlanOverlayBounds skipped', { hasConfig: !!config, boundsProvided: !!bounds })
    return
  }
  const nextBounds = cloneBounds(bounds)
  if(!nextBounds){
    debugPlanState('setPlanOverlayBounds invalid clone', bounds)
    return
  }
  const current = state.planOverlay.currentBounds
  if(boundsEqual(current, nextBounds)){
    debugPlanState('setPlanOverlayBounds no-op', nextBounds)
    return
  }
  debugPlanState('setPlanOverlayBounds apply', nextBounds)
  state.planOverlay.currentBounds = nextBounds
  state.planOverlay.config = { ...config, bounds: nextBounds }
  const dirty = !boundsEqual(state.planOverlay.originalBounds, nextBounds)
  if(state.planOverlay.dirty !== dirty){
    state.planOverlay.dirty = dirty
    notify('plan:dirty', { dirty })
  }else{
    notify('plan:dirty', { dirty })
  }
  notify('plan:bounds', { bounds: nextBounds })
}

export function resetPlanOverlayBounds(): void {
  const original = state.planOverlay.originalBounds
  if(!original) return
  setPlanOverlayBounds(original)
}

export function setPlanOverlaySaving(flag: boolean): void {
  const next = !!flag
  if(state.planOverlay.saving === next) return
  state.planOverlay.saving = next
  notify('plan:saving', { saving: next })
}

export function markPlanOverlaySaved(bounds?: PlanOverlayBounds | null): void {
  const source = bounds ?? state.planOverlay.currentBounds
  const nextOriginal = source ? cloneBounds(source) : null
  debugPlanState('markPlanOverlaySaved', nextOriginal)
  state.planOverlay.originalBounds = nextOriginal
  state.planOverlay.scalePercent = 100
  const dirty = !boundsEqual(nextOriginal, state.planOverlay.currentBounds)
  if(state.planOverlay.dirty !== dirty){
    state.planOverlay.dirty = dirty
    notify('plan:dirty', { dirty })
  }else{
    notify('plan:dirty', { dirty })
  }
}

const REMOVABLE_NODE_TYPES = new Set(['JONCTION', 'JUNCTION'])
let isPruningOrphans = false
let pruneSuspendCount = 0
let prunePending = false
let pruneScheduled = false

function shouldAutoRemoveNode(node: MutableNode | null | undefined): boolean {
  if(!node || !node.id) return false
  const type = String(node.type || '').toUpperCase()
  if(REMOVABLE_NODE_TYPES.has(type)) return true
  const name = typeof node.name === 'string' ? node.name.trim() : ''
  if(!type && !name) return true
  return false
}

export function pruneOrphanNodes(): void {
  prunePending = false
  pruneScheduled = false
  if(isPruningOrphans) return
  isPruningOrphans = true
  try{
    while(true){
      const connected = new Set<string>()
      for(const edge of state.edges){
        if(!edge) continue
        const fromId = edge.from_id ?? edge.source
        const toId = edge.to_id ?? edge.target
        if(fromId) connected.add(fromId)
        if(toId) connected.add(toId)
      }
      const toRemove: string[] = []
      for(const node of state.nodes){
        if(!node?.id) continue
        if(connected.has(node.id)) continue
        if(!shouldAutoRemoveNode(node)) continue
        toRemove.push(node.id)
      }
      if(!toRemove.length) break
      for(const id of toRemove){
        const idx = state.nodes.findIndex(n => n && n.id === id)
        if(idx < 0) continue
        state.nodes.splice(idx, 1)
        if(state.selection.nodeId === id){
          selectNodeById(null)
        }else if(state.selection.multi && state.selection.multi.has(id)){
          const remaining = Array.from(state.selection.multi).filter(x => x !== id)
          setMultiSelection(remaining)
        }
        notify('node:remove', { id })
      }
    }
  }finally{
    isPruningOrphans = false
  }
}

export function suspendOrphanPrune<T>(fn: (() => T) | null | undefined): T | undefined {
  pruneSuspendCount++
  try{
    return typeof fn === 'function' ? fn() : undefined
  }finally{
    pruneSuspendCount = Math.max(0, pruneSuspendCount - 1)
    if(pruneSuspendCount === 0 && prunePending){
      scheduleOrphanPrune()
    }
  }
}

function scheduleOrphanPrune(): void {
  if(pruneSuspendCount > 0){
    prunePending = true
    return
  }
  if(pruneScheduled) return
  pruneScheduled = true
  const run = (): void => {
    if(pruneSuspendCount > 0){
      pruneScheduled = false
      prunePending = true
      return
    }
    pruneOrphanNodes()
  }
  if(typeof queueMicrotask === 'function'){ queueMicrotask(run) }
  else setTimeout(run, 0)
}

let branchRecalcScheduled = false

function buildGraphForBranchRecalc(): Graph {
  return {
    version: state.graphMeta?.version || '1.5',
    site_id: state.graphMeta?.site_id || null,
    generated_at: state.graphMeta?.generated_at || null,
    style_meta: (state.graphMeta?.style_meta ?? {}) as Record<string, unknown>,
    nodes: state.nodes as unknown as Graph['nodes'],
    edges: state.edges as unknown as Graph['edges'],
  }
}

function scheduleBranchRecalc(){
  if(branchRecalcScheduled) return
  branchRecalcScheduled = true
  const run = async () => {
    branchRecalcScheduled = false
    try{
      const result = await recomputeBranches(buildGraphForBranchRecalc()) as BranchRecalcResult
      if(Array.isArray(result?.edges)){
        const branchMap = new Map(result.edges.map(e => [e.id, e.branch_id]))
        state.edges.forEach(edge => {
          const updated = branchMap.get(edge.id)
          if(updated !== undefined) edge.branch_id = (updated ?? '')
        })
      }
      if(Array.isArray(result?.nodes)){
        const nodeMap = new Map(result.nodes.map(n => [n.id, n.branch_id]))
        state.nodes.forEach(node => {
          const updated = nodeMap.get(node.id)
          if(updated !== undefined) node.branch_id = updated
        })
      }
      const branchSyncChanged = syncBranchesWithUsage()
      state.branchDiagnostics = result?.branch_diagnostics || []
      state.branchChanges = result?.branch_changes || []
      state.branchConflicts = result?.branch_conflicts || []
      notify('graph:branches', {
        diagnostics: state.branchDiagnostics,
        changes: state.branchChanges,
        conflicts: state.branchConflicts,
      })
      if(branchSyncChanged){
        notify('branch:update', { id: null })
      }
    }catch(err){
      console.warn('[branch] recompute failed', err)
    }
  }
  if(typeof queueMicrotask === 'function') queueMicrotask(run)
  else setTimeout(run, 0)
}

export function triggerBranchRecalc(){
  scheduleBranchRecalc()
}

export function setGraph(graph: unknown): void {
  const { nodes, edges, geoCenter, meta, branches = [], crs = DEFAULT_CRS } = normalizeGraph(graph, { gridStep: state.gridStep })
  state.graphMeta = Object.assign({
    version: '1.5',
    site_id: null,
    generated_at: null,
    style_meta: {},
  }, meta || {})
  state.nodes = nodes
  state.edges = edges
  state.branches = normalizeBranchesForState(branches)
  rebuildBranchMap(state.branches)
  const branchSyncChanged = syncBranchesWithUsage()
  state.crs = { ...DEFAULT_CRS, ...(crs || {}) }
  clearSelection()
  if(geoCenter) applyGeoCenter(geoCenter.centerLat, geoCenter.centerLon)
  pruneOrphanNodes()
  clearManualDiameter()
  notify('graph:set')
  scheduleBranchRecalc()
  if(branchSyncChanged){
    notify('branch:update', { id: null })
  }
}


export function getGraph(){
  return {
    version: state.graphMeta?.version ?? '1.5',
    site_id: state.graphMeta?.site_id ?? null,
    generated_at: state.graphMeta?.generated_at ?? null,
    style_meta: state.graphMeta?.style_meta ?? {},
    crs: { ...DEFAULT_CRS, ...(state.crs || {}) },
    branches: state.branches.map(branch => ({ ...branch })),
    nodes: state.nodes,
    edges: state.edges,
  }
}
export function clearSelection(): void {
  state.selection.nodeId = null
  state.selection.edgeId = null
  state.selection.multi = new Set<string>()
  notify('selection:clear')
}

export function selectNodeById(id: string | null | undefined): void {
  const nodeId = id ?? null
  state.selection.nodeId = nodeId
  state.selection.edgeId = null
  if(nodeId){
    state.selection.multi = new Set<string>([nodeId])
  }else{
    state.selection.multi = new Set<string>()
  }
  notify('selection:node', nodeId)
}

export function selectEdgeById(id: string | null | undefined): void {
  const edgeId = id ?? null
  state.selection.edgeId = edgeId
  state.selection.nodeId = null
  state.selection.multi = new Set<string>()
  notify('selection:edge', edgeId)
}

export function setMultiSelection(ids: Iterable<string> | null | undefined): void {
  const entries = ids ? Array.from(ids).filter((value): value is string => typeof value === 'string' && value.trim().length > 0) : []
  const multi = new Set<string>(entries)
  state.selection.multi = multi
  state.selection.nodeId = multi.size === 1 ? Array.from(multi)[0] : null
  state.selection.edgeId = null
  notify('selection:multi', Array.from(multi))
}

export function toggleMultiSelection(id: string | null | undefined): void {
  if(!id) return
  const multi = state.selection.multi || new Set<string>()
  if(multi.has(id)) multi.delete(id)
  else multi.add(id)
  state.selection.multi = multi
  state.selection.nodeId = null
  state.selection.edgeId = null
  notify('selection:multi', Array.from(multi))
}

export function setMode(mode: string): void {
  state.mode = mode
  notify('mode:set', mode)
}
export function getMode(): string {
  return state.mode
}

export function setViewMode(mode: string | null | undefined): void {
  if(!mode) return
  const next = String(mode)
  if(state.viewMode === next) return
  state.viewMode = next
  notify('view:set', next)
}

export function getViewMode(): string {
  return state.viewMode
}

export function copySelection(){
  const ids = new Set(Array.from(state.selection.multi || []))
  const selectedNodes = state.nodes.filter(n => ids.has(n.id))
  const selectedEdges = state.edges.filter((edge) => {
    const fromId = edge.source ?? edge.from_id ?? ''
    const toId = edge.target ?? edge.to_id ?? ''
    return ids.has(fromId) && ids.has(toId)
  })
  state.clipboard = {
    nodes: JSON.parse(JSON.stringify(selectedNodes)),
    edges: JSON.parse(JSON.stringify(selectedEdges)),
  }
  notify('clipboard:copy', { count: selectedNodes.length })
}

export function pasteClipboard(offset: { x?: number; y?: number } = { x: 24, y: 24 }): MutableNode[] {
  const clip = state.clipboard
  let clipNodes: MutableNode[] = []
  let clipEdges: Array<Partial<MutableEdge>> = []
  if(Array.isArray(clip)){
    clipNodes = clip as MutableNode[]
  }else if(clip && Array.isArray((clip as { nodes?: MutableNode[] }).nodes)){
    const payload = clip as { nodes?: MutableNode[]; edges?: Array<Partial<MutableEdge>> }
    clipNodes = payload.nodes ?? []
    clipEdges = Array.isArray(payload.edges) ? payload.edges : []
  }
  if(!clipNodes.length) return []
  const existingNames = new Set(
    state.nodes
      .map(node => node.name)
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0),
  )
  const idMap = new Map<string, string>()
  const spawnIndex = (state._spawnIndex = (state._spawnIndex || 0) + 1)
  const extraOffset = { x: (spawnIndex % 7) * 8, y: (spawnIndex % 11) * 8 }
  const clones: MutableNode[] = clipNodes.map((node) => {
    const baseName = node.name || node.id || 'N'
    const newName = incrementName(baseName, Array.from(existingNames))
    existingNames.add(newName)
    const currentX = Number(node.x ?? 0)
    const currentY = Number(node.y ?? 0)
    const clone: MutableNode = {
      ...(node as MutableNode),
      id: genId((node.type || 'N').toUpperCase()),
      name: newName,
      x: snapToGrid(currentX + (offset.x || 0) + extraOffset.x, state.gridStep),
      y: snapToGrid(currentY + (offset.y || 0) + extraOffset.y, state.gridStep),
    }
    if(clone.type === 'PUITS'){ clone.well_collector_id = ''; clone.well_pos_index = '' }
    if(clone.type === 'POINT_MESURE' || clone.type === 'VANNE'){
      clone.pm_collector_id = ''
      clone.pm_pos_index = ''
      clone.pm_offset_m = ''
    }
    if(node.id) idMap.set(node.id, clone.id)
    return clone
  })
  state.nodes.push(...clones)
  clipEdges.forEach((edge) => {
    const fromId = idMap.get((edge.source ?? edge.from_id) as string)
    const toId = idMap.get((edge.target ?? edge.to_id) as string)
    if(fromId && toId) addEdge(fromId, toId, { active: edge.active !== false })
  })
  state.selection.multi = new Set(clones.map(n => n.id))
  state.selection.nodeId = clones[0]?.id || null
  notify('clipboard:paste', { count: clones.length })
  return clones
}

export function moveNode(id: string, dx: number, dy: number, { snap = true }: { snap?: boolean } = {}): void {
  const node = state.nodes.find(n => n.id === id)
  if(!node) return
  if(node.gps_locked) return
  const currentX = Number(node.x ?? 0)
  const currentY = Number(node.y ?? 0)
  const nextX = currentX + dx
  const nextY = currentY + dy
  node.x = snap ? snapToGrid(nextX, state.gridStep) : nextX
  node.y = snap ? snapToGrid(nextY, state.gridStep) : nextY
  notify('node:move', { id, x: node.x, y: node.y })
}

export function updateNode(id: string, patch: Partial<MutableNode> | null | undefined): void {
  const node = state.nodes.find(n => n.id === id)
  if(!node) return
  let shouldRecalc = false
  if(patch && typeof patch === 'object'){
    for(const key of NODE_BRANCH_FIELDS){
      if(Object.prototype.hasOwnProperty.call(patch, key)){
        const next = patch[key]
        const prev = node[key]
        if(key === 'branch_id' || key === 'branchId'){
          const prevClean = prev == null ? '' : String(prev).trim()
          const nextClean = next == null ? '' : String(next).trim()
          if(prevClean !== nextClean){
            shouldRecalc = true
            break
          }
        }else if(!Object.is(prev, next)){
          shouldRecalc = true
          break
        }
      }
    }
  }
  Object.assign(node, patch || {})
  notify('node:update', { id, patch })
  if(shouldRecalc) scheduleBranchRecalc()
}

type MutableNodePatch = Partial<MutableNode>
type MutableEdgePatch = Partial<MutableEdge>
type SpawnResult = { x: number; y: number }

export function addNode(partial: MutableNodePatch = {}): MutableNode {
  const requestedType = typeof partial.type === 'string' ? partial.type : 'OUVRAGE'
  const type = enforceEdgeOnlyNodeType(requestedType)
  const isJunction = type === 'JONCTION'
  const offsetX = isJunction ? 0 : NODE_SIZE.w / 2
  const offsetY = isJunction ? 0 : NODE_SIZE.h / 2
  const nudgeStep = Math.max(state.gridStep, 1) * 2

  const tooClose = (x: number, y: number): boolean => state.nodes.some((n) => {
    const nx = Number(n?.x ?? NaN)
    const ny = Number(n?.y ?? NaN)
    if(!Number.isFinite(nx) || !Number.isFinite(ny)) return false
    return Math.abs(nx - x) < 40 && Math.abs(ny - y) < 40
  })

  const finaliseSpawn = (topLeftX: number, topLeftY: number): SpawnResult => {
    const snappedX = snapToGrid(topLeftX, state.gridStep)
    const snappedY = snapToGrid(topLeftY, state.gridStep)
    return {
      x: snappedX,
      y: snappedY,
    }
  }

  function nextSpawn(): SpawnResult {
    const idx = state._spawnIndex++
    const center = getViewportCenter()
    if(center){
      const baseCenterX = Number.isFinite(center?.x) ? center.x : 0
      const baseCenterY = Number.isFinite(center?.y) ? center.y : 0
      if(Number.isFinite(baseCenterX) && Number.isFinite(baseCenterY)){
        const baseX = snapToGrid(baseCenterX - offsetX, state.gridStep)
        const baseY = snapToGrid(baseCenterY - offsetY, state.gridStep)
        const step = Math.max(nudgeStep, state.gridStep || 8)
        const maxRadius = 8
        for(let radius = 0; radius <= maxRadius; radius++){
          for(let dx = -radius; dx <= radius; dx++){
            for(let dy = -radius; dy <= radius; dy++){
              if(Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
              const candidateX = baseX + dx * step
              const candidateY = baseY + dy * step
              if(!tooClose(candidateX, candidateY)){
                return finaliseSpawn(candidateX, candidateY)
              }
            }
          }
        }
        return finaliseSpawn(baseX, baseY)
      }
    }
    const baseX = 120 + (idx % 8) * 60
    const baseY = 120 + Math.floor(idx / 8) * 80
    let x = baseX
    let y = baseY
    let guard = 0
    while(tooClose(x, y) && guard++ < 64){
      x += nudgeStep
      y += nudgeStep
    }
    return finaliseSpawn(x, y)
  }

  const spawn = (partial.x == null || partial.y == null) ? nextSpawn() : null
  const position = spawn
    ? { x: spawn.x, y: spawn.y }
    : { x: Number(partial.x), y: Number(partial.y) }

  const base: MutableNode = {
    id: genId(type || 'N'),
    type,
    name: defaultName(type, state.nodes as Array<{ name?: string | null | undefined }>),
    x: position.x,
    y: position.y,
  } as MutableNode

  const node = Object.assign(base, partial || {}) as MutableNode
  node.type = enforceEdgeOnlyNodeType(node.type)
  state.nodes.push(node)
  notify('node:add', node)
  return node
}

export function renameNodeId(oldId: string | null | undefined, newId: string | null | undefined): void {
  if(!oldId || !newId) return
  if(state.nodes.some(n => n.id === newId)) return
  const node = state.nodes.find(n => n.id === oldId)
  if(!node) return
  node.id = newId
  state.edges.forEach(edge => {
    if(edge.from_id === oldId) edge.from_id = newId
    if(edge.source === oldId) edge.source = newId
    if(edge.to_id === oldId) edge.to_id = newId
    if(edge.target === oldId) edge.target = newId
  })
  if(state.selection.nodeId === oldId) state.selection.nodeId = newId
  if(state.selection.multi?.has(oldId)){
    state.selection.multi.delete(oldId)
    state.selection.multi.add(newId)
  }
  notify('node:update', { id: newId, patch: { id: newId } })
}

export function removeNode(id: string | null | undefined): void {
  const node = state.nodes.find(n => n.id === id)
  if(!node) return
  if(node.type === 'POINT_MESURE' || node.type === 'VANNE'){
    node.pm_collector_id = ''
    node.pm_pos_index = ''
    node.pm_offset_m = ''
  }
  const relatedEdges = state.edges.filter(e => (e.from_id ?? e.source) === id || (e.to_id ?? e.target) === id)
  relatedEdges.forEach(edge => {
    if(edge?.id){
      removeEdge(edge.id)
    }
  })
  state.nodes = state.nodes.filter(n => n.id !== id)
  notify('node:remove', { id })
}

export function removeNodes(ids: Iterable<string> | null | undefined): void {
  for(const id of ids || []) removeNode(id)
}

export function addEdge(source: string | null, target: string | null, partial: MutableEdgePatch = {}): MutableEdge | null {
  if(!source || !target) return null
  const exists = state.edges.find(e => (e.from_id ?? e.source) === source && (e.to_id ?? e.target) === target)
  if(exists) return exists as MutableEdge
  let id = partial?.id ?? genId('E')
  const used = new Set(state.edges.map(e => e.id))
  let guard = 0
  while(used.has(id) && guard++ < 5) id = genId('E')
  const edge: MutableEdge = {
    id,
    from_id: source,
    to_id: target,
    active: partial?.active !== false,
    commentaire: partial?.commentaire ?? '',
    created_at: partial?.created_at ?? new Date().toISOString(),
    branch_id: partial?.branch_id ?? '',
    ...partial,
  } as MutableEdge
  if(edge.source == null) edge.source = edge.from_id
  if(edge.target == null) edge.target = edge.to_id
  if(!edge.created_at) edge.created_at = new Date().toISOString()
  state.edges.push(edge)
  notify('edge:add', edge)
  scheduleBranchRecalc()
  return edge
}

export function updateEdge(id: string, patch: MutableEdgePatch | null | undefined): void {
  const edge = state.edges.find(e => e.id === id)
  if(!edge) return
  let shouldRecalc = false
  if(patch && typeof patch === 'object'){
    for(const key of EDGE_BRANCH_FIELDS){
      if(Object.prototype.hasOwnProperty.call(patch, key)){
        const next = patch[key]
        const prev = edge[key]
        if(key === 'branch_id' || key === 'branchId'){
          const prevClean = prev == null ? '' : String(prev).trim()
          const nextClean = next == null ? '' : String(next).trim()
          if(prevClean !== nextClean){
            shouldRecalc = true
            break
          }
        }else if(!Object.is(prev, next)){
          shouldRecalc = true
          break
        }
      }
    }
  }
  Object.assign(edge, patch || {})
  notify('edge:update', { id, patch })
  if(shouldRecalc) scheduleBranchRecalc()
}

export function removeEdge(id: string): void {
  const index = state.edges.findIndex(e => e.id === id)
  if(index < 0) return
  state.edges.splice(index, 1)
  notify('edge:remove', { id })
  scheduleOrphanPrune()
  scheduleBranchRecalc()
}

export function flipEdgeDirection(id: string): void {
  const edge = state.edges.find(e => e.id === id)
  if(!edge) return
  const from = edge.from_id ?? edge.source
  const to = edge.to_id ?? edge.target
  if(!from || !to) return
  edge.from_id = to
  edge.to_id = from
  if('source' in edge) edge.source = edge.from_id
  if('target' in edge) edge.target = edge.to_id
  if(Array.isArray(edge.geometry)){
    edge.geometry = edge.geometry.slice().reverse() as Array<[number, number]>
  }
  notify('edge:flip', { id, from_id: edge.from_id, to_id: edge.to_id })
  scheduleBranchRecalc()
}
