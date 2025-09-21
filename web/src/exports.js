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
