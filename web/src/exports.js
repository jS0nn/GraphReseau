import { isCanal, vn } from './utils.js'

const fromId = (e) => e.from_id ?? e.source
const toId   = (e) => e.to_id   ?? e.target

export function toJSON(graph){
  // Include style meta if available (for reproducibility of classes/colors)
  let style_meta = null
  try{ style_meta = (window.__pipesStyle && typeof window.__pipesStyle.meta==='function') ? window.__pipesStyle.meta() : null }catch{}
  return { nodes: graph.nodes || [], edges: graph.edges || [], style_meta }
}

export function toCompact(graph){
  const nodes = graph.nodes || []
  const edges = graph.edges || []
  const index = new Map(nodes.map((n,i)=>[n.id, i]))
  const edges_idx = edges.map(e => [ index.get(fromId(e)), index.get(toId(e)) ])
  const adj = Array.from({ length: nodes.length }, () => [])
  edges_idx.forEach(([i,j]) => { if(i!=null && j!=null) adj[i].push(j) })
  const slimNodes = nodes.map(n => ({
    id: n.id,
    type: n.type,
    name: n.name,
    diameter_mm: n.diameter_mm ?? undefined,
    collector_well_ids: isCanal(n) ? (n.collector_well_ids || []) : undefined,
    child_canal_ids: isCanal(n) ? (n.child_canal_ids || []) : undefined,
    well_collector_id: n.type==='OUVRAGE' ? (n.well_collector_id || '') : undefined,
    well_pos_index: n.type==='OUVRAGE' ? (+n.well_pos_index || null) : undefined,
    pm_collector_id: (n.type==='POINT_MESURE'||n.type==='VANNE') ? (n.pm_collector_id || '') : undefined,
    pm_pos_index: (n.type==='POINT_MESURE'||n.type==='VANNE') ? (+n.pm_pos_index || 0) : undefined,
    pm_offset_m: (n.type==='POINT_MESURE'||n.type==='VANNE') ? (n.pm_offset_m || '') : undefined,
  }))
  return { nodes: slimNodes, index: Object.fromEntries(index), edges_idx, adj }
}

export function toNodeEdge(graph){
  const nodes = graph.nodes || []
  const edges = graph.edges || []
  const Nmap = new Map(nodes.map(n => [n.id, n]))
  const isWell = n => n?.type==='OUVRAGE'
  const isCan  = n => n?.type==='CANALISATION' || n?.type==='COLLECTEUR'
  const isOther= n => n && !isWell(n) && !isCan(n)
  const compiledNodes = []
  const compiledEdges = []
  nodes.forEach(n=>{ if(!isCan(n)) compiledNodes.push({ id:n.id, type:n.type, name:n.name, x:n.x, y:n.y }) })
  const outBy = new Map(), inBy = new Map()
  edges.forEach(e=>{ (outBy.get(fromId(e))||outBy.set(fromId(e),[]) && outBy.get(fromId(e))).push(e); (inBy.get(toId(e))||inBy.set(toId(e),[]) && inBy.get(toId(e))).push(e) })
  const getOut=id=>outBy.get(id)||[]
  const getIn=id=>inBy.get(id)||[]
  let uidT=0, uidE=0
  const Tname = (c, k)=> `${c.name||c.id}@T${k}`
  const Tid   = (c, k)=> `T-${(++uidT)}-${c.id}-${k}`
  const Eid   = ()=> `E-${(++uidE)}`
  nodes.filter(isCan).forEach(c=>{
    const wells = (c.collector_well_ids||[]).map(id=>Nmap.get(id)).filter(Boolean).sort((a,b)=> (+a.well_pos_index||0) - (+b.well_pos_index||0))
    const N = wells.length
    const Tids = []
    for(let k=0;k<=N;k++){ const id = Tid(c, k); Tids.push(id); compiledNodes.push({ id, type:'NODE', name: Tname(c, k) }) }
    const inMainEdges  = getIn(c.id).filter(e => isOther(Nmap.get(fromId(e))) || isCan(Nmap.get(fromId(e))))
    inMainEdges.forEach(e=>{ compiledEdges.push({ id:Eid(), from: fromId(e), to: Tids[0], diameter_mm: c.diameter_mm, color: undefined }) })
    for(let k=0;k<N;k++){ compiledEdges.push({ id:Eid(), from: Tids[k], to: Tids[k+1], diameter_mm: c.diameter_mm, color: undefined }) }
    wells.forEach((w, idx)=>{ const k = (+w.well_pos_index||idx+1); const anchor = Math.min(Math.max(k,0), N); compiledEdges.push({ id:Eid(), from: Tids[anchor], to: w.id, diameter_mm: w.diameter_mm||undefined, color: undefined }) })
    const outOthers = getOut(c.id).filter(e => isOther(Nmap.get(toId(e))))
    outOthers.forEach(e=>{ compiledEdges.push({ id:Eid(), from: Tids[N], to: toId(e), diameter_mm: c.diameter_mm, color: undefined }) })
    const outCanalsEdges = getOut(c.id).filter(e => isCan(Nmap.get(toId(e))))
    const orderMap = new Map(); (c.child_canal_ids||[]).forEach((id,idx)=>orderMap.set(id, idx))
    outCanalsEdges.sort((e1,e2)=>{ const a = Nmap.get(toId(e1)), b = Nmap.get(toId(e2)); const oa = orderMap.has(a.id) ? orderMap.get(a.id) : 1e6 + vn(a.y,0); const ob = orderMap.has(b.id) ? orderMap.get(b.id) : 1e6 + vn(b.y,0); return oa - ob })
    outCanalsEdges.forEach((e,idx)=>{ compiledEdges.push({ id:Eid(), from: Tids[N], to: toId(e), diameter_mm: c.diameter_mm, color: undefined, order_on_parent: idx+1 }) })
    const inlines = nodes.filter(n => (n.type==='POINT_MESURE' || n.type==='VANNE') && n.pm_collector_id===c.id)
    const bucket = new Map(); function pushOnEdge(edgeId, s){ (bucket.get(edgeId)||bucket.set(edgeId,[]) && bucket.get(edgeId)).push(s) }
    inlines.forEach(dev=>{ const pos = +dev.pm_pos_index||0; let edgeCandidate = null; if(pos >=0 && pos < N){ edgeCandidate = compiledEdges.find(e => e.from===Tids[pos] && e.to===Tids[pos+1]) } else if (N>0){ edgeCandidate = compiledEdges.find(e => e.from===Tids[N-1] && e.to===Tids[N]) } if(edgeCandidate){ const s = { id: dev.id, type: dev.type, name: dev.name, order: (dev.pm_order==null?null:+dev.pm_order), offset_m: (dev.pm_offset_m===''?null:+dev.pm_offset_m) }; pushOnEdge(edgeCandidate.id, s) } })
    for(const [eid, arr] of bucket.entries()){
      arr.sort((a,b)=>{
        const ao = (a.order==null)?Infinity:a.order, bo = (b.order==null)?Infinity:b.order
        if(ao!==bo) return ao - bo
        const ax=(a.offset_m==null)?Infinity:a.offset_m, bx=(b.offset_m==null)?Infinity:b.offset_m
        if(ax!==bx) return ax-bx
        return (''+(a.name||a.id)).localeCompare(''+(b.name||b.id))
      })
      arr.forEach((s,i)=>{ if(s.order==null) s.order = i+1 })
      const ce = compiledEdges.find(e=>e.id===eid); if(ce){ ce.devices = arr }
    }
  })
  return { nodes: compiledNodes, edges: compiledEdges }
}
