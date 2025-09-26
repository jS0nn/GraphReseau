import { clamp, isCanal, vn } from '../utils.ts'
import type { MutableNode, MutableEdge } from '../state/normalize.ts'

type PipeTheme = 'dark' | 'light' | (string & {})

interface WidthRange {
  min: number
  max: number
}

interface StyleMetaOverrides {
  theme?: string
  width_px?: Partial<WidthRange>
  mode?: string
  classes?: {
    count?: number
    strategy?: string
    bounds?: number[]
  }
  trunk_tolerance?: number
  diameter_range_mm?: Partial<WidthRange>
  branch_colors_by_path?: Record<string, string>
}

interface PipeStyleOptions {
  mode?: 'continuous' | 'classed'
  classes?: number
  classStrategy?: 'quantile' | 'fixed'
  fixedBounds?: number[]
  widthPx?: WidthRange
  defaultDiameterMm?: number
  trunkToleranceRatio?: number
  styleMeta?: StyleMetaOverrides
}

type NumericLike = number | string | null | undefined

const asNumericLike = (value: unknown): NumericLike => {
  if(typeof value === 'number' || typeof value === 'string') return value
  return value == null ? null : null
}

type EdgeInput = MutableEdge & {
  diametre_mm?: NumericLike
  longueur_m?: NumericLike
  createdAt?: string | null
  ui_diameter_mm?: NumericLike
}

type InlineData = { from?: MutableNode | null | undefined }

interface PipeStyleMetaPayload {
  mode: string
  theme: PipeTheme
  width_px: WidthRange
  diameter_range_mm: WidthRange
  classes: null | {
    count: number
    strategy: 'quantile' | 'fixed'
    bounds: number[]
    labels: string[]
    width_levels: number[]
  }
  trunk_tolerance: number
  branch_colors_by_path: Record<string, string>
}

interface PipeStyle {
  widthForEdge: (edge: EdgeInput) => number
  colorForEdge: (edge: EdgeInput) => string
  widthForInline: (data: InlineData | null | undefined) => number
  colorForInline: (data: InlineData | null | undefined) => string
  borderColorForCanal: (node: MutableNode | null | undefined) => string | null
  meta: () => PipeStyleMetaPayload
}

interface EnsurePipeStyleArgs {
  nodes?: MutableNode[]
  edges?: EdgeInput[]
  theme?: PipeTheme
  options?: PipeStyleOptions
}

interface ClassScale {
  bounds: number[]
  labels: string[]
  indexOf: (value: number | null | undefined) => number
  widthLevels: number[]
}

const MIN_DIAMETER_MM = 80
const MAX_DIAMETER_MM = 315

function parseDiameter(raw: NumericLike): number | null {
  if(raw == null) return null
  const num = Number(raw)
  return Number.isFinite(num) && num > 0 ? num : null
}

function cssVar(name: string, fallback = ''): string {
  try{
    const value = getComputedStyle(document.documentElement).getPropertyValue(name)
    return value?.trim() || fallback
  }catch{
    return fallback
  }
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const s = (hex || '').replace('#', '').trim()
  if(s.length === 3){
    const [r, g, b] = s
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) }
  }
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (x: number) => x.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if(hp >= 0 && hp < 1){ r = c; g = x }
  else if(hp < 2){ r = x; g = c }
  else if(hp < 3){ g = c; b = x }
  else if(hp < 4){ g = x; b = c }
  else if(hp < 5){ r = x; b = c }
  else { r = c; b = x }
  const m = l - c / 2
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  }
}

function srgbToLin(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b)
}

function contrastRatio(fg: { r: number; g: number; b: number }, bg: { r: number; g: number; b: number }): number {
  const L1 = relativeLuminance(fg)
  const L2 = relativeLuminance(bg)
  const [a, b] = L1 >= L2 ? [L1, L2] : [L2, L1]
  return (a + 0.05) / (b + 0.05)
}

function ensureContrast(hex: string, bgHex: string, minRatio: number): string {
  try{
    const bg = parseHex(bgHex)
    let best = hex
    let rgb = parseHex(hex)
    let ratio = contrastRatio(rgb, bg)
    if(ratio >= minRatio) return best
    const bgLum = relativeLuminance(bg)
    const lighter = bgLum < 0.25
    const { h, s } = hexToApproxHsl(hex)
    let lightness = lighter ? 0.65 : 0.45
    let guard = 0
    while(guard++ < 32){
      const c = hslToRgb(h, s, lightness)
      ratio = contrastRatio(c, bg)
      if(ratio >= minRatio){
        best = rgbToHex(c.r, c.g, c.b)
        break
      }
      lightness = lighter ? Math.min(0.98, lightness + 0.06) : Math.max(0.02, lightness - 0.06)
    }
    return best
  }catch{
    return hex
  }
}

function hexToApproxHsl(hex: string): { h: number; s: number; l: number } {
  try{
    const { r, g, b } = parseHex(hex)
    const rn = r / 255
    const gn = g / 255
    const bn = b / 255
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    let h = 0
    let s = 0
    const l = (max + min) / 2
    if(max !== min){
      const d = max - min
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
      switch(max){
        case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break
        case gn: h = (bn - rn) / d + 2; break
        case bn: h = (rn - gn) / d + 4; break
      }
      h *= 60
    }
    return { h, s, l }
  }catch{
    return { h: 200, s: 0.6, l: 0.5 }
  }
}

function hash32(str: string): number {
  let h = 2166136261 >>> 0
  for(let i = 0; i < str.length; i += 1){
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

interface BranchPathsResult {
  paths: Map<string, string>
  childrenOf: Map<string, string[]>
  rootsByAnchor: Map<string, string[]>
}

function computeBranchPaths(nodes: MutableNode[], edges: EdgeInput[], { trunkToleranceRatio = 0.10, defaultDiameterMm = 50 }: { trunkToleranceRatio?: number; defaultDiameterMm?: number } = {}): BranchPathsResult {
  const idToNode = new Map<string, MutableNode>()
  nodes.forEach(node => { if(node?.id) idToNode.set(node.id, node) })
  const isCan = (id: string | null | undefined) => (id ? isCanal(idToNode.get(id)) : false)

  const parentOf = new Map<string, string>()
  const childrenOf = new Map<string, string[]>()
  const anchorsOf = new Map<string, Set<string>>()

  edges.forEach(edge => {
    const rawFrom = edge.from_id ?? edge.source ?? null
    const rawTo = edge.to_id ?? edge.target ?? null
    const from = typeof rawFrom === 'string' ? rawFrom : null
    const to = typeof rawTo === 'string' ? rawTo : null
    if(from && to && isCan(from) && isCan(to)){
      parentOf.set(to, from)
      if(!childrenOf.has(from)) childrenOf.set(from, [])
      childrenOf.get(from)!.push(to)
    }else if(from && to && !isCanal(idToNode.get(from)) && isCan(to)){
      if(!anchorsOf.has(to)) anchorsOf.set(to, new Set())
      anchorsOf.get(to)!.add(from)
    }
  })

  const orderChildren = (pid: string, arr: string[]): string[] => {
    const parent = idToNode.get(pid)
    const expected: string[] = Array.isArray(parent?.child_canal_ids)
      ? parent!.child_canal_ids!.slice()
      : []
    const index = new Map<string, number>()
    expected.forEach((value, position) => index.set(value, position))
    const defaultOrder = (childId: string): number => {
      const explicit = index.get(childId)
      if(explicit != null) return explicit
      const node = idToNode.get(childId)
      return 1e6 + vn(node?.y, 0)
    }
    return arr.slice().sort((a, b) => defaultOrder(a) - defaultOrder(b))
  }

  const canals = nodes.filter(isCanal)
  const rootCanals = canals.filter(c => c.id && !parentOf.has(c.id)).map(c => c.id!).filter(Boolean)
  const branchPath = new Map<string, string>()

  const assignPath = (canalId: string, path: string): void => {
    branchPath.set(canalId, path)
    const kidsRaw = childrenOf.get(canalId) || []
    if(!kidsRaw.length) return
    const kids = orderChildren(canalId, kidsRaw)
    if(kids.length === 1){
      assignPath(kids[0], path)
      return
    }
    let trunkChild: string | null = null
    let maxD = -Infinity
    kids.forEach(cid => {
      const diameter = parseDiameter(idToNode.get(cid)?.diameter_mm)
      const d = diameter ?? defaultDiameterMm
      if(d > maxD){ maxD = d; trunkChild = cid }
    })
    kids.forEach(cid => {
      const childPath = cid === trunkChild ? path : `${path}|${cid}`
      assignPath(cid, childPath)
    })
  }

  const groupByAnchor = new Map<string, string[]>()
  rootCanals.forEach(rid => {
    const anchors = anchorsOf.get(rid)
    let anchorId: string | null = null
    if(anchors && anchors.size){
      const arr = Array.from(anchors)
      anchorId = arr.find(anchor => idToNode.get(anchor)?.type === 'GENERAL') || arr.sort()[0]
    }
    if(!anchorId) anchorId = rid
    const key = anchorId ?? rid
    const list = groupByAnchor.get(key)
    if(list){
      list.push(rid)
    }else{
      groupByAnchor.set(key, [rid])
    }
  })

  for(const [anchorId, arr] of groupByAnchor.entries()){
    if(arr.length === 1){
      assignPath(arr[0], anchorId)
      continue
    }
    let trunkRoot = arr[0]
    let maxD = -Infinity
    arr.forEach(cid => {
      const diameter = parseDiameter(idToNode.get(cid)?.diameter_mm)
      const d = diameter ?? defaultDiameterMm
      if(d > maxD){ maxD = d; trunkRoot = cid }
    })
    if(!Number.isFinite(maxD)){
      arr.sort((a, b) => vn(idToNode.get(a)?.y, 0) - vn(idToNode.get(b)?.y, 0))
      trunkRoot = arr[0]
    }
    assignPath(trunkRoot, anchorId)
    arr.forEach(cid => { if(cid !== trunkRoot) assignPath(cid, `${anchorId}|${cid}`) })
  }

  return {
    paths: branchPath,
    childrenOf,
    rootsByAnchor: groupByAnchor,
  }
}

function sqrtScale(minDia: number, maxDia: number, outMin: number, outMax: number){
  const sMin = Math.sqrt(Math.max(0, minDia || 0))
  const sMax = Math.sqrt(Math.max(0, maxDia || 0))
  const denom = (sMax - sMin) || 1
  return (d: number | null | undefined): number => {
    const value = Math.sqrt(Math.max(0, d || 0))
    const t = (value - sMin) / denom
    return outMin + clamp(t, 0, 1) * (outMax - outMin)
  }
}

function quantileThresholds(sortedVals: number[], k: number): number[]{
  const n = Math.max(1, k | 0)
  if(sortedVals.length === 0) return []
  const thresholds: number[] = []
  for(let i = 1; i < n; i += 1){
    const p = i / n
    const idx = p * (sortedVals.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    const value = lo === hi ? sortedVals[lo] : (sortedVals[lo] * (hi - idx) + sortedVals[hi] * (idx - lo))
    thresholds.push(value)
  }
  return thresholds
}

function computeClasses(values: number[], count: number, strategy: 'quantile' | 'fixed' = 'quantile', fixedBounds?: number[]): ClassScale {
  const numericVals = values.filter(v => Number.isFinite(+v)).slice().sort((a, b) => a - b)
  if(numericVals.length === 0){
    return { bounds: [], labels: [], indexOf: () => 0, widthLevels: [] }
  }
  let bounds: number[] = []
  if(strategy === 'fixed' && Array.isArray(fixedBounds) && fixedBounds.length){
    bounds = fixedBounds.slice().sort((a, b) => a - b)
  }else{
    bounds = quantileThresholds(numericVals, count)
  }
  const labels: string[] = []
  const n = Math.max(1, count | 0)
  for(let i = 0; i < n; i += 1){
    if(i === 0){
      labels.push(`C1 (≤ ${Math.round(bounds[0] ?? numericVals[0])})`)
    }else if(i === n - 1){
      labels.push(`C${n} (≥ ${Math.round(bounds[n - 2] ?? numericVals[numericVals.length - 1])})`)
    }else{
      labels.push(`C${i + 1}`)
    }
  }
  const indexOf = (value: number | null | undefined): number => {
    const num = Number(value)
    if(!Number.isFinite(num)) return 0
    for(let i = 0; i < bounds.length; i += 1){
      if(num <= bounds[i]) return i
    }
    return bounds.length
  }
  return { bounds, labels, indexOf, widthLevels: [] }
}

let _cache: { key: string; style: PipeStyle | null } = { key: '', style: null }

export function ensurePipeStyle(args: EnsurePipeStyleArgs = {}): PipeStyle {
  const nodes = args.nodes ?? []
  const edges = args.edges ?? []
  const theme = args.theme ?? (document.body?.dataset?.theme as PipeTheme ?? 'dark')
  const options = args.options ?? {}
  const opts: Required<Omit<PipeStyleOptions, 'styleMeta'>> & { styleMeta?: StyleMetaOverrides } = {
    mode: options.mode ?? 'continuous',
    classes: options.classes ?? 5,
    classStrategy: options.classStrategy ?? 'quantile',
    fixedBounds: options.fixedBounds ?? [],
    widthPx: options.widthPx ?? { min: 1.0, max: 8.0 },
    defaultDiameterMm: options.defaultDiameterMm ?? 50,
    trunkToleranceRatio: options.trunkToleranceRatio ?? 0.10,
    styleMeta: options.styleMeta,
  }

  const metaOverrides = options.styleMeta || {}
  const widthOverride = metaOverrides.width_px || {}
  const widthMin = Number.isFinite(+widthOverride.min!) && +widthOverride.min! > 0 ? +widthOverride.min! : opts.widthPx.min
  const widthMax = Number.isFinite(+widthOverride.max!) && +widthOverride.max! > 0 ? +widthOverride.max! : opts.widthPx.max
  const resolvedWidthMin = Math.min(widthMin, widthMax)
  const resolvedWidthMax = Math.max(widthMin, widthMax)
  opts.widthPx = { min: resolvedWidthMin, max: resolvedWidthMax }

  const metaMode = typeof metaOverrides.mode === 'string' ? metaOverrides.mode.toLowerCase() : ''
  if(metaMode === 'quantized') opts.mode = 'classed'
  else if(metaMode === 'continuous') opts.mode = 'continuous'

  if(metaOverrides.classes){
    const cls = metaOverrides.classes
    if(Number.isFinite(+cls.count!)) opts.classes = Math.max(1, +cls.count!)
    if(typeof cls.strategy === 'string') opts.classStrategy = cls.strategy as 'quantile' | 'fixed'
    if(Array.isArray(cls.bounds)) opts.fixedBounds = cls.bounds.slice()
  }

  if(metaOverrides.trunk_tolerance != null){
    const tt = Number(metaOverrides.trunk_tolerance)
    if(Number.isFinite(tt) && tt > 0) opts.trunkToleranceRatio = tt
  }

  let clampMin = MIN_DIAMETER_MM
  let clampMax = MAX_DIAMETER_MM
  if(metaOverrides.diameter_range_mm){
    const range = metaOverrides.diameter_range_mm
    if(Number.isFinite(+range.min!)) clampMin = Math.max(1, +range.min!)
    if(Number.isFinite(+range.max!)) clampMax = Math.max(clampMin + 1, +range.max!)
    if(clampMax <= clampMin) clampMax = clampMin + 1
  }

  const normalizeDiameter = (raw: NumericLike): number => {
    const parsed = parseDiameter(raw)
    const base = parsed ?? opts.defaultDiameterMm
    return clamp(base, clampMin, clampMax)
  }

  opts.defaultDiameterMm = clamp(opts.defaultDiameterMm, clampMin, clampMax)

  const nodeDiaVals = nodes
    .filter(isCanal)
    .map(n => parseDiameter(asNumericLike(n?.diameter_mm)))
    .filter((v): v is number => v != null)
    .map(v => clamp(v, clampMin, clampMax))

  const edgeDiaVals = edges
    .map(e => parseDiameter(asNumericLike(e?.diameter_mm ?? e?.diametre_mm)))
    .filter((v): v is number => v != null)
    .map(v => clamp(v, clampMin, clampMax))

  const diaVals = [...nodeDiaVals, ...edgeDiaVals]
  const defaultDia = clamp(opts.defaultDiameterMm, clampMin, clampMax)
  const diaMin = diaVals.length ? Math.min(...diaVals) : defaultDia
  const diaMax = diaVals.length ? Math.max(...diaVals) : defaultDia

  const themeKey = (metaOverrides.theme || theme || document.body?.dataset?.theme || 'dark') as PipeTheme

  const topoHash = (() => {
    const idToNode = new Map(nodes.map(n => [n.id, n]))
    const rel = edges
      .filter(e => {
        const a = idToNode.get(e.from_id ?? e.source ?? '')
        const b = idToNode.get(e.to_id ?? e.target ?? '')
        return isCanal(a) && isCanal(b)
      })
      .map(e => `${e.from_id ?? e.source}->${e.to_id ?? e.target}`)
      .sort()
      .join('|')
    return hash32(rel).toString(36)
  })()

  const key = [
    nodes.length,
    edges.length,
    diaMin,
    diaMax,
    themeKey,
    opts.mode,
    opts.classes,
    opts.classStrategy,
    JSON.stringify(opts.fixedBounds || []),
    topoHash,
    opts.trunkToleranceRatio,
    opts.widthPx.min,
    opts.widthPx.max,
    opts.defaultDiameterMm,
    clampMin,
    clampMax,
    JSON.stringify(metaOverrides || {}),
  ].join('|')

  if(_cache.key === key && _cache.style){
    return _cache.style
  }

  const idToNode = new Map(nodes.map(n => [n.id, n]))
  const scale = sqrtScale(clampMin, clampMax, opts.widthPx.min, opts.widthPx.max)
  const classInfo = opts.mode === 'classed' ? computeClasses(diaVals, opts.classes, opts.classStrategy, opts.fixedBounds) : null
  const widthLevels: number[] = []
  if(classInfo){
    const denom = Math.max(1, opts.classes - 1)
    for(let i = 0; i < opts.classes; i += 1){
      widthLevels.push(opts.widthPx.min + i * (opts.widthPx.max - opts.widthPx.min) / denom)
    }
  }

  const bp = computeBranchPaths(nodes, edges, { trunkToleranceRatio: opts.trunkToleranceRatio, defaultDiameterMm: opts.defaultDiameterMm })
  const pathByCanal = bp.paths
  const uniquePaths = new Set(pathByCanal.values())
  const bg = cssVar('--bg', themeKey === 'light' ? '#f6f8fc' : '#162138')
  const GOLD = 137.50776405003785
  const rootHue = new Map<string, number>()
  const colorByPath = new Map<string, string>()

  for(const p of uniquePaths){
    const root = p.split('|')[0]
    if(!rootHue.has(root)) rootHue.set(root, hash32(root) % 360)
  }

  const MOD = 359
  for(const p of uniquePaths){
    const root = p.split('|')[0]
    const baseHue = rootHue.get(root) ?? 0
    const depth = (p.match(/\|/g)?.length ?? 0)
    const k = depth === 0 ? 0 : (1 + (hash32(p) % MOD))
    const h = (baseHue + k * GOLD) % 360
    const s = themeKey === 'light' ? 0.72 : 0.78
    const l = themeKey === 'light' ? 0.44 : 0.62
    const { r, g, b } = hslToRgb(h, s, l)
    const hex = ensureContrast(rgbToHex(r, g, b), bg, 3.0)
    colorByPath.set(p, hex)
  }

  const orderChildrenForColor = (pid: string, arr: string[]): string[] => {
    const parent = idToNode.get(pid)
    const expected: string[] = Array.isArray(parent?.child_canal_ids)
      ? parent!.child_canal_ids!.slice()
      : []
    const index = new Map<string, number>()
    expected.forEach((value, position) => index.set(value, position))
    const defaultOrder = (childId: string): number => {
      const explicit = index.get(childId)
      if(explicit != null) return explicit
      const node = idToNode.get(childId)
      return 1e6 + vn(node?.y, 0)
    }
    return arr.slice().sort((a, b) => defaultOrder(a) - defaultOrder(b))
  }

  const recolorSiblings = (parentPath: string, orderedChildIds: string[]): void => {
    const siblings = orderedChildIds.filter(cid => pathByCanal.get(cid) !== parentPath)
    const n = siblings.length
    if(n <= 1) return
    const root = parentPath.split('|')[0]
    const H0 = rootHue.get(root) ?? 0
    const step = 360 / (n + 1)
    siblings.forEach((cid, i) => {
      const h = (H0 + (i + 1) * step) % 360
      const s = themeKey === 'light' ? 0.72 : 0.78
      const l = themeKey === 'light' ? 0.44 : 0.62
      const { r, g, b } = hslToRgb(h, s, l)
      const hex = ensureContrast(rgbToHex(r, g, b), bg, 3.0)
      const path = pathByCanal.get(cid) || cid
      colorByPath.set(path, hex)
    })
  }

  for(const [pid, kidsRaw] of bp.childrenOf.entries()){
    const ordered = orderChildrenForColor(pid, kidsRaw)
    const parentPath = pathByCanal.get(pid)
    if(parentPath) recolorSiblings(parentPath, ordered)
  }

  for(const [anchorId, arr] of bp.rootsByAnchor.entries()){
    recolorSiblings(anchorId, arr.slice())
  }

  if(metaOverrides.branch_colors_by_path && typeof metaOverrides.branch_colors_by_path === 'object'){
    for(const [path, color] of Object.entries(metaOverrides.branch_colors_by_path)){
      if(typeof color === 'string' && color.trim()){
        colorByPath.set(path, color.trim())
      }
    }
  }

  const diameterNodeForEdge = (edge: EdgeInput): MutableNode | null => {
    const a = idToNode.get(edge.from_id ?? edge.source ?? '')
    const b = idToNode.get(edge.to_id ?? edge.target ?? '')
    const aIsCan = isCanal(a)
    const bIsCan = isCanal(b)
    const aIsWell = (a?.type ?? '').toUpperCase() === 'OUVRAGE'
    const bIsWell = (b?.type ?? '').toUpperCase() === 'OUVRAGE'
    if(aIsWell || bIsWell) return aIsWell ? a ?? null : b ?? null
    if(aIsCan && bIsCan) return b ?? null
    if(aIsCan) return a ?? null
    if(bIsCan) return b ?? null
    return null
  }

  const widthForDiameter = (value: NumericLike): number => {
    const clamped = normalizeDiameter(value)
    return classInfo ? widthLevels[classInfo.indexOf(clamped)] : scale(clamped)
  }

  const edgeWidth = (edge: EdgeInput): number => {
    const direct = parseDiameter(asNumericLike(edge?.diameter_mm ?? edge?.diametre_mm))
    if(direct != null) return widthForDiameter(direct)
    const node = diameterNodeForEdge(edge)
    return widthForDiameter(asNumericLike(node?.diameter_mm))
  }

  const edgeColor = (edge: EdgeInput): string => {
    const a = idToNode.get(edge.from_id ?? edge.source ?? '')
    const b = idToNode.get(edge.to_id ?? edge.target ?? '')
    const aIsCan = isCanal(a)
    const bIsCan = isCanal(b)
    const canal = (aIsCan && bIsCan) ? b : (aIsCan ? a : (bIsCan ? b : null))
    if(!canal) return cssVar('--edge-color', '#eaf2ff')
    const path = pathByCanal.get(canal.id ?? '') || canal.id || ''
    return colorByPath.get(path) || cssVar('--edge-color', '#eaf2ff')
  }

  const inlineWidth = (data: InlineData | null | undefined): number => {
    const canal = data?.from && isCanal(data.from) ? data.from : null
    return widthForDiameter(asNumericLike(canal?.diameter_mm))
  }

  const inlineColor = (data: InlineData | null | undefined): string => {
    const canal = data?.from && isCanal(data.from) ? data.from : null
    if(!canal) return cssVar('--edge-color', '#eaf2ff')
    const path = pathByCanal.get(canal.id ?? '') || canal.id || ''
    return colorByPath.get(path) || cssVar('--edge-color', '#eaf2ff')
  }

  const canalBorder = (node: MutableNode | null | undefined): string | null => {
    if(!node || !isCanal(node)) return null
    const nodeId = node.id ?? ''
    const path = pathByCanal.get(nodeId) || nodeId || ''
    return colorByPath.get(path) || cssVar('--stroke', '#2e4674')
  }

  const meta = (): PipeStyleMetaPayload => ({
    mode: metaMode || (opts.mode === 'classed' ? 'quantized' : opts.mode),
    theme: themeKey,
    width_px: opts.widthPx,
    diameter_range_mm: { min: clampMin, max: clampMax },
    classes: classInfo ? {
      count: opts.classes,
      strategy: opts.classStrategy,
      bounds: classInfo.bounds,
      labels: classInfo.labels,
      width_levels: widthLevels,
    } : null,
    trunk_tolerance: opts.trunkToleranceRatio,
    branch_colors_by_path: Object.fromEntries(colorByPath),
  })

  const style: PipeStyle = {
    widthForEdge: edgeWidth,
    colorForEdge: edgeColor,
    widthForInline: inlineWidth,
    colorForInline: inlineColor,
    borderColorForCanal: canalBorder,
    meta,
  }

  _cache = { key, style }
  try{ (window as typeof window & { __pipesStyle?: PipeStyle }).__pipesStyle = style }catch{}
  return style
}

export type { PipeStyle, PipeStyleOptions, EnsurePipeStyleArgs, StyleMetaOverrides, EdgeInput, PipeStyleMetaPayload }
