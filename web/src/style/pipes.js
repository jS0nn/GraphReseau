// Pipe styling engine: thickness by diameter, stable colors by branch, memoized.
// Public API:
//   ensurePipeStyle({ nodes, edges, theme, options }) -> style object with:
//     - widthForEdge(edge)
//     - colorForEdge(edge)
//     - widthForInline(devData) // expects { from: canalNode }
//     - colorForInline(devData)
//     - borderColorForCanal(node)
//     - meta() -> exportable computed params
//
// Options supported:
//   mode: 'continuous' | 'classed' (default 'continuous')
//   classes: number of classes when mode==='classed' (default 5)
//   classStrategy: 'quantile' | 'fixed' (default 'quantile')
//   fixedBounds: number[] (only when classStrategy==='fixed')
//   widthPx: { min: 1.6, max: 6 }
//   defaultDiameterMm: 50

import { clamp, isCanal, vn } from '../utils.js'

// --- Color helpers ---
function cssVar(name, fallback=''){
  try{ const v = getComputedStyle(document.documentElement).getPropertyValue(name); return v?.trim()||fallback }catch{ return fallback }
}
function parseHex(hex){
  const s = (hex||'').replace('#','').trim()
  if(s.length===3){ const r=s[0],g=s[1],b=s[2]; return { r:parseInt(r+r,16), g:parseInt(g+g,16), b:parseInt(b+b,16) } }
  return { r:parseInt(s.slice(0,2),16), g:parseInt(s.slice(2,4),16), b:parseInt(s.slice(4,6),16) }
}
function rgbToHex(r,g,b){ const h=(x)=>x.toString(16).padStart(2,'0'); return `#${h(r)}${h(g)}${h(b)}` }
function hslToRgb(h, s, l){
  // h[0,360), s,l [0,1]
  const c = (1 - Math.abs(2*l - 1)) * s
  const hp = (h % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r=0,g=0,b=0
  if (hp >= 0 && hp < 1) { r=c; g=x }
  else if (hp < 2) { r=x; g=c }
  else if (hp < 3) { g=c; b=x }
  else if (hp < 4) { g=x; b=c }
  else if (hp < 5) { r=x; b=c }
  else { r=c; b=x }
  const m = l - c/2
  return { r:Math.round((r+m)*255), g:Math.round((g+m)*255), b:Math.round((b+m)*255) }
}
function srgbToLin(c){ const v=c/255; return v<=0.04045? v/12.92 : Math.pow((v+0.055)/1.055,2.4) }
function relativeLuminance({r,g,b}){ return 0.2126*srgbToLin(r) + 0.7152*srgbToLin(g) + 0.0722*srgbToLin(b) }
function contrastRatio(fg, bg){ const L1=relativeLuminance(fg), L2=relativeLuminance(bg); const [a,b]=L1>=L2?[L1,L2]:[L2,L1]; return (a+0.05)/(b+0.05) }
function ensureContrast(hex, bgHex, minRatio){
  try{
    const bg = parseHex(bgHex)
    let best = hex
    let rgb = parseHex(hex)
    let ratio = contrastRatio(rgb, bg)
    if(ratio >= minRatio) return best
    // Adjust lightness up or down depending on theme until min ratio reached
    const bgLum = relativeLuminance(bg)
    // If background is dark (lum < ~0.2), push color lighter; else darker
    const lighter = bgLum < 0.25
    // Search over lightness 0..1 for min ratio target with fixed hue/sat
    // Derive current HSL roughly by sampling across L; simpler: keep hue/sat constant and sweep L
    const { h, s } = hexToApproxHsl(hex)
    let L = lighter ? 0.65 : 0.45
    let bestL=L, guard=0
    while(guard++<32){
      const c = hslToRgb(h, s, L)
      const r = contrastRatio(c, bg)
      if(r>=minRatio){ best = rgbToHex(c.r,c.g,c.b); break }
      L = lighter ? Math.min(0.98, L+0.06) : Math.max(0.02, L-0.06)
      bestL=L
    }
    return best
  }catch{ return hex }
}
function hexToApproxHsl(hex){
  // Rough conversion: use built-in to canvas when available else fallback
  try{
    const { r, g, b } = parseHex(hex)
    const rn=r/255, gn=g/255, bn=b/255
    const max=Math.max(rn,gn,bn), min=Math.min(rn,gn,bn)
    let h=0, s=0, l=(max+min)/2
    if(max!==min){
      const d = max-min
      s = l>0.5 ? d/(2-max-min) : d/(max+min)
      switch(max){
        case rn: h=(gn-bn)/d+(gn<bn?6:0); break
        case gn: h=(bn-rn)/d+2; break
        case bn: h=(rn-gn)/d+4; break
      }
      h*=60
    }
    return { h, s, l }
  }catch{ return { h: 200, s: 0.6, l: 0.5 } }
}

// Stable hash for strings → integer
function hash32(str){ let h=2166136261>>>0; for(let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) } return h>>>0 }

// --- Branch detection with trunk continuity ---
// Returns Map canalId -> branchPath (rootId[|childId...]) where trunk child keeps same path,
// and non-trunk children get a derived path by appending their id.
function computeBranchPaths(nodes, edges, { trunkToleranceRatio=0.10, defaultDiameterMm=50 } = {}){
  const idToNode = new Map(nodes.map(n=>[n.id, n]))
  const isCan = (id)=> isCanal(idToNode.get(id))
  const parentOf = new Map() // canalId -> parent canalId
  const childrenOf = new Map() // canalId -> canal children ids
  const anchorsOf = new Map() // canalId -> Set(non-canal upstream ids)
  edges.forEach(e=>{
    const a = e.from_id ?? e.source
    const b = e.to_id ?? e.target
    if(isCan(a) && isCan(b)){
      parentOf.set(b, a)
      ;(childrenOf.get(a)||childrenOf.set(a,[])&&childrenOf.get(a)).push(b)
    }else if(!isCan(idToNode.get(a)) && isCan(b)){
      // non-canal upstream feeding a root canal
      (anchorsOf.get(b) || anchorsOf.set(b, new Set()) && anchorsOf.get(b)).add(a)
    }
  })
  // Sort children using explicit order if available, else by y for stability
  const orderChildren = (pid, arr)=>{
    const parent = idToNode.get(pid)
    const exp = Array.isArray(parent?.child_canal_ids)? parent.child_canal_ids : []
    const index = new Map(exp.map((id,i)=>[id,i]))
    const defOrder = (id)=> index.has(id) ? index.get(id) : (1e6 + (vn(idToNode.get(id)?.y, 0)))
    return arr.slice().sort((ia, ib)=> defOrder(ia) - defOrder(ib))
  }
  const canals = nodes.filter(isCanal)
  const rootCanals = canals.filter(c => !parentOf.has(c.id)).map(c=>c.id)
  const branchPath = new Map()
  // Assign recursively from a starting path
  function assignPath(canalId, path){
    branchPath.set(canalId, path)
    const kidsRaw = childrenOf.get(canalId) || []
    if(!kidsRaw.length) return
    const kids = orderChildren(canalId, kidsRaw)
    // If there is a single child canal, always propagate the trunk color regardless of diameter
    if(kids.length === 1){
      assignPath(kids[0], path)
      return
    }
    const pd = +idToNode.get(canalId)?.diameter_mm
    const parentD = (Number.isFinite(pd) && pd > 0) ? pd : defaultDiameterMm
    // Choose trunk child: largest diameter within tolerance; if none, no trunk propagation
    let trunkChild = null, maxD = -Infinity
    kids.forEach(cid=>{ const dd = +idToNode.get(cid)?.diameter_mm; const d = (Number.isFinite(dd) && dd > 0) ? dd : defaultDiameterMm; if(d>maxD){ maxD=d; trunkChild=cid } })
    kids.forEach((cid)=>{
      const isTrunk = (cid===trunkChild) // always propagate along chosen trunk child
      const childPath = isTrunk ? path : (path + '|' + cid)
      assignPath(cid, childPath)
    })
  }
  // Group root canals by their upstream non-canal anchor (e.g., GENERAL). If none, group by themselves.
  const groupByAnchor = new Map() // anchorId -> root canal ids[]
  rootCanals.forEach(rid => {
    const anc = anchorsOf.get(rid)
    // Prefer a GENERAL parent when multiple exist; else pick lexicographically first for determinism
    let anchorId = null
    if(anc && anc.size){
      const arr = Array.from(anc)
      const preferred = arr.find(id => (idToNode.get(id)?.type==='GENERAL'))
      anchorId = preferred || arr.sort()[0]
    }
    if(!anchorId) anchorId = rid // fallback when no explicit non-canal anchor
    ;(groupByAnchor.get(anchorId) || groupByAnchor.set(anchorId, []) && groupByAnchor.get(anchorId)).push(rid)
  })
  // Within each anchor group, choose one trunk root (max diameter; ties broken by y/order), which inherits the anchor color (path = anchorId)
  for(const [anchorId, arr] of groupByAnchor.entries()){
    if(arr.length===1){ assignPath(arr[0], anchorId); continue }
    // Select trunk root canal
    let trunkRoot = arr[0]
    let maxD = -Infinity
    arr.forEach(cid=>{ const dd = +idToNode.get(cid)?.diameter_mm; const d = (Number.isFinite(dd) && dd > 0) ? dd : defaultDiameterMm; if(d>maxD){ maxD=d; trunkRoot=cid } })
    // If all NaN, break ties by visual order (y) for stability
    if(!Number.isFinite(maxD)){
      arr.sort((a,b)=> vn(idToNode.get(a)?.y,0) - vn(idToNode.get(b)?.y,0))
      trunkRoot = arr[0]
    }
    // Assign trunk root path = anchorId; others branch off anchor immediately
    assignPath(trunkRoot, anchorId)
    arr.forEach(cid => { if(cid!==trunkRoot) assignPath(cid, anchorId + '|' + cid) })
  }
  return { paths: branchPath, childrenOf, rootsByAnchor: groupByAnchor } // details for color spacing
}

// --- Thickness mapping ---
function sqrtScale(minDia, maxDia, outMin, outMax){
  const sMin = Math.sqrt(Math.max(0, minDia||0))
  const sMax = Math.sqrt(Math.max(0, maxDia||0))
  const denom = (sMax - sMin) || 1
  return (d)=>{
    const v = Math.sqrt(Math.max(0, d||0))
    const t = (v - sMin) / denom
    return outMin + clamp(t, 0, 1) * (outMax - outMin)
  }
}

function quantileThresholds(sortedVals, k){
  const n = Math.max(1, k|0)
  if(sortedVals.length===0) return []
  const th=[]
  for(let i=1;i<n;i++){
    const p = i/n
    const idx = p*(sortedVals.length-1)
    const lo = Math.floor(idx), hi = Math.ceil(idx)
    const v = (lo===hi) ? sortedVals[lo] : (sortedVals[lo]*(hi-idx) + sortedVals[hi]*(idx-lo))
    th.push(v)
  }
  return th
}

function computeClasses(values, count, strategy='quantile', fixedBounds){
  const vals = values.filter(v=>Number.isFinite(+v)).slice().sort((a,b)=>a-b)
  if(vals.length===0){ return { bounds: [], labels: [], indexOf: ()=>0, widthLevels: [] } }
  let bounds=[]
  if(strategy==='fixed' && Array.isArray(fixedBounds) && fixedBounds.length){
    bounds = fixedBounds.slice().sort((a,b)=>a-b)
  }else{
    bounds = quantileThresholds(vals, count)
  }
  const labels = []
  const n = Math.max(1, count|0)
  for(let i=0;i<n;i++){
    const lo = (i===0) ? -Infinity : bounds[i-1]
    const hi = (i===n-1) ? Infinity : bounds[i]
    labels.push(i===0?`C1 (≤ ${Math.round(bounds[0])})`:(i===n-1?`C${n} (≥ ${Math.round(bounds[n-2])})`:`C${i+1}`))
  }
  function indexOf(v){
    if(!Number.isFinite(+v)) return 0
    for(let i=0;i<bounds.length;i++){ if(v <= bounds[i]) return i }
    return bounds.length
  }
  return { bounds, labels, indexOf }
}

// --- Engine ---
let _cache = { key: '', style: null }

export function ensurePipeStyle({ nodes, edges, theme, options } = {}){
  const opts = Object.assign({ mode:'continuous', classes:5, classStrategy:'quantile', fixedBounds:[], widthPx:{min:1.6, max:6}, defaultDiameterMm:50, trunkToleranceRatio:0.10 }, options||{})
  const diaVals = nodes.filter(isCanal).map(n => {
    const d = +n.diameter_mm
    return (Number.isFinite(d) && d > 0) ? d : opts.defaultDiameterMm
  })
  const diaMin = Math.min(...diaVals, opts.defaultDiameterMm)
  const diaMax = Math.max(...diaVals, opts.defaultDiameterMm)
  const themeKey = theme || (document.body?.dataset?.theme || 'dark')
  const topoHash = (()=>{
    // simple stable signature of canal parent links
    const idToNode = new Map(nodes.map(n=>[n.id, n]))
    const rel = edges.filter(e=>{
      const a=idToNode.get(e.from_id??e.source), b=idToNode.get(e.to_id??e.target)
      return isCanal(a) && isCanal(b)
    }).map(e=>`${e.from_id??e.source}->${e.to_id??e.target}`).sort().join('|')
    return hash32(rel).toString(36)
  })()
  const key = [nodes.length, edges.length, diaMin, diaMax, themeKey, opts.mode, opts.classes, opts.classStrategy, JSON.stringify(opts.fixedBounds||[]), topoHash, opts.trunkToleranceRatio].join('|')
  if(_cache.key === key && _cache.style){ return _cache.style }

  // Node index used across helpers in this scope
  const idToNode = new Map(nodes.map(n=>[n.id, n]))

  // Build scales
  const scale = sqrtScale(diaMin, diaMax, opts.widthPx.min, opts.widthPx.max)
  const classInfo = (opts.mode==='classed') ? computeClasses(diaVals, opts.classes, opts.classStrategy, opts.fixedBounds) : null
  const widthLevels = []
  if(classInfo){
    // Evenly spaced width levels across [min,max]
    for(let i=0;i<opts.classes;i++){ widthLevels.push(opts.widthPx.min + i*(opts.widthPx.max-opts.widthPx.min)/Math.max(1,(opts.classes-1))) }
  }

  // Branch colors with trunk continuity
  const bp = computeBranchPaths(nodes, edges, { trunkToleranceRatio: opts.trunkToleranceRatio, defaultDiameterMm: opts.defaultDiameterMm })
  const pathByCanal = bp.paths
  const uniquePaths = new Set(Array.from(pathByCanal.values()))
  const bg = cssVar('--bg', themeKey==='light' ? '#f6f8fc' : '#162138')
  const GOLD = 137.50776405003785
  const rootHue = new Map()
  const colorByPath = new Map()
  // First compute root hue per anchor id (path first token, e.g., GENERAL id)
  for(const p of uniquePaths){
    const root = p.split('|')[0]
    if(!rootHue.has(root)) rootHue.set(root, (hash32(root) % 360))
  }
  // Use a large modulus to drastically reduce collisions and keep mapping stable per path
  const MOD = 359
  for(const p of uniquePaths){
    const root = p.split('|')[0]
    const baseHue = rootHue.get(root)
    const depth = (p.match(/\|/g)?.length || 0)
    // k=0 for trunk/root; for branches, pick k from hash(p) in [1..MOD]
    const k = depth===0 ? 0 : (1 + (hash32(p) % MOD))
    const h = (baseHue + k * GOLD) % 360
    const s = themeKey==='light' ? 0.72 : 0.78
    const l = themeKey==='light' ? 0.44 : 0.62
    const { r,g,b } = hslToRgb(h, s, l)
    const hex = ensureContrast(rgbToHex(r,g,b), bg, 3.0)
    colorByPath.set(p, hex)
  }

  // Enforce strong sibling separation at each split (including root anchor groups)
  const orderChildren = (pid, arr)=>{
    const parent = idToNode.get(pid)
    const exp = Array.isArray(parent?.child_canal_ids)? parent.child_canal_ids : []
    const index = new Map(exp.map((id,i)=>[id,i]))
    const defOrder = (id)=> index.has(id) ? index.get(id) : (1e6 + (vn(idToNode.get(id)?.y, 0)))
    return arr.slice().sort((ia, ib)=> defOrder(ia) - defOrder(ib))
  }
  function recolorSiblings(parentPath, orderedChildIds){
    const siblings = orderedChildIds.filter(cid => (pathByCanal.get(cid) !== parentPath))
    const n = siblings.length
    if(n <= 1) return
    const root = parentPath.split('|')[0]
    const H0 = rootHue.get(root)
    const step = 360 / (n + 1)
    siblings.forEach((cid, i) => {
      const h = (H0 + (i+1) * step) % 360
      const s = themeKey==='light' ? 0.72 : 0.78
      const l = themeKey==='light' ? 0.44 : 0.62
      const { r,g,b } = hslToRgb(h, s, l)
      const hex = ensureContrast(rgbToHex(r,g,b), bg, 3.0)
      const p = pathByCanal.get(cid)
      colorByPath.set(p, hex)
    })
  }
  // For each canal parent
  for(const [pid, kidsRaw] of bp.childrenOf.entries()){
    const ordered = orderChildren(pid, kidsRaw)
    const parentPath = pathByCanal.get(pid)
    if(parentPath) recolorSiblings(parentPath, ordered)
  }
  // For each root anchor group
  for(const [anchorId, arr] of bp.rootsByAnchor.entries()){
    const ordered = arr.slice() // group already deterministic from earlier pass; keep order
    recolorSiblings(anchorId, ordered)
  }

  // Edge → canal mapping and helpers
  const canalOfEdge = (e)=>{
    const a = idToNode.get(e.from_id ?? e.source)
    const b = idToNode.get(e.to_id ?? e.target)
    const aIs = isCanal(a), bIs = isCanal(b)
    if(aIs && bIs) return b // parent->child edges: color by child branch
    if(aIs) return a
    if(bIs) return b
    return null
  }
  const widthForDiameter = (d)=> (classInfo ? widthLevels[classInfo.indexOf(d)] : scale(d))

  const edgeWidth = (e)=>{
    const c = canalOfEdge(e)
    const d = Number.isFinite(+c?.diameter_mm) ? +c.diameter_mm : opts.defaultDiameterMm
    return widthForDiameter(d)
  }
  const edgeColor = (e)=>{
    const c = canalOfEdge(e)
    if(!c) return cssVar('--edge-color', '#eaf2ff')
    const path = pathByCanal.get(c.id) || c.id
    return colorByPath.get(path) || cssVar('--edge-color', '#eaf2ff')
  }
  const inlineWidth = (d)=>{
    const c = d?.from && isCanal(d.from) ? d.from : null
    const dia = Number.isFinite(+c?.diameter_mm) ? +c.diameter_mm : opts.defaultDiameterMm
    return widthForDiameter(dia)
  }
  const inlineColor = (d)=>{
    const c = d?.from && isCanal(d.from) ? d.from : null
    if(!c) return cssVar('--edge-color', '#eaf2ff')
    const path = pathByCanal.get(c.id) || c.id
    return colorByPath.get(path) || cssVar('--edge-color', '#eaf2ff')
  }
  const canalBorder = (n)=>{
    if(!isCanal(n)) return null
    const path = pathByCanal.get(n.id) || n.id
    return colorByPath.get(path) || cssVar('--stroke', '#2e4674')
  }

  const meta = ()=>{
    return {
      mode: opts.mode,
      theme: themeKey,
      width_px: opts.widthPx,
      diameter_range_mm: { min: diaMin, max: diaMax },
      classes: (classInfo && {
        count: opts.classes,
        strategy: opts.classStrategy,
        bounds: classInfo.bounds,
        labels: classInfo.labels,
        width_levels: widthLevels,
      }) || null,
      trunk_tolerance: opts.trunkToleranceRatio,
      branch_colors_by_path: Object.fromEntries(colorByPath),
    }
  }

  const style = {
    widthForEdge: edgeWidth,
    colorForEdge: edgeColor,
    widthForInline: inlineWidth,
    colorForInline: inlineColor,
    borderColorForCanal: canalBorder,
    meta,
  }

  _cache = { key, style }
  // Expose for dev/exports if needed
  try{ window.__pipesStyle = style }catch{}
  return style
}
