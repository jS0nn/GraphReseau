const fromId = (e) => e.from_id ?? e.source
const toId   = (e) => e.to_id   ?? e.target

export function toJSON(graph){
  // Include style meta if available (for reproducibility of classes/colors)
  let engineMeta = null
  try{ engineMeta = (window.__pipesStyle && typeof window.__pipesStyle.meta==='function') ? window.__pipesStyle.meta() : null }catch{}
  const style_meta = (graph && graph.style_meta && Object.keys(graph.style_meta).length) ? graph.style_meta : engineMeta
  return {
    version: graph?.version || '1.5',
    site_id: graph?.site_id || null,
    generated_at: graph?.generated_at || null,
    style_meta,
    nodes: graph?.nodes || [],
    edges: graph?.edges || [],
  }
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
    branch_id: n.branch_id || '',
    diameter_mm: n.diameter_mm ?? undefined,
    pm_collector_edge_id: (n.type==='POINT_MESURE'||n.type==='VANNE') ? (n.pm_collector_edge_id || '') : undefined,
    pm_pos_index: (n.type==='POINT_MESURE'||n.type==='VANNE') ? (+n.pm_pos_index || 0) : undefined,
    pm_offset_m: (n.type==='POINT_MESURE'||n.type==='VANNE') ? (n.pm_offset_m || '') : undefined,
  }))
  return { nodes: slimNodes, index: Object.fromEntries(index), edges_idx, adj }
}

export function toNodeEdge(graph){
  const nodes = (graph.nodes || []).map(n => ({
    id: n.id,
    type: n.type,
    name: n.name,
    x: n.x,
    y: n.y,
    branch_id: n.branch_id || '',
    diameter_mm: n.diameter_mm ?? undefined,
  }))
  const edges = (graph.edges || []).map(e => ({
    id: e.id || '',
    from: fromId(e),
    to: toId(e),
    active: e.active !== false,
    commentaire: e.commentaire || '',
    branch_id: e.branch_id || '',
    diameter_mm: e.diameter_mm ?? null,
    length_m: e.length_m ?? null,
    geometry: Array.isArray(e.geometry) ? e.geometry : null,
  }))
  return { nodes, edges }
}
