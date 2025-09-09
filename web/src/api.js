// Native API client for the editor (replaces Apps Script bridge)

function parseSearch() {
  const p = new URLSearchParams(location.search)
  return {
    source: p.get('source'),
    sheet_id: p.get('sheet_id'),
    gcs_uri: p.get('gcs_uri'),
    bq_project: p.get('bq_project'),
    bq_dataset: p.get('bq_dataset'),
    bq_nodes: p.get('bq_nodes'),
    bq_edges: p.get('bq_edges'),
    mode: p.get('mode') || 'ro',
  }
}

function buildParamsForSource(q) {
  const params = new URLSearchParams()
  if (q.source) params.set('source', q.source)
  if (!q.source || q.source === 'sheet' || q.source === 'sheets') {
    if (q.sheet_id) params.set('sheet_id', q.sheet_id)
  } else if (q.source === 'gcs_json' || q.source === 'json' || q.source === 'gcs') {
    if (q.gcs_uri) params.set('gcs_uri', q.gcs_uri)
  } else if (q.source === 'bigquery' || q.source === 'bq') {
    if (q.bq_project) params.set('bq_project', q.bq_project)
    if (q.bq_dataset) params.set('bq_dataset', q.bq_dataset)
    if (q.bq_nodes) params.set('bq_nodes', q.bq_nodes)
    if (q.bq_edges) params.set('bq_edges', q.bq_edges)
  }
  return params
}

export async function getGraph() {
  const q = parseSearch()
  const params = buildParamsForSource(q)
  const res = await fetch('/api/graph?' + params.toString())
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`GET /api/graph ${res.status} ${txt}`)
  }
  const data = await res.json()
  // Ensure node numeric fields are coerced on initial load (defense-in-depth)
  if(Array.isArray(data?.nodes)){
    data.nodes.forEach(m => {
      const numKeys = ['diameter_mm','gps_lat','gps_lon','well_pos_index','pm_pos_index','pm_offset_m']
      numKeys.forEach(k => { if(m[k]==='') m[k]=null })
    })
  }
  return data
}

function sanitizeGraph(graph){
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.map(n => {
    const m = { ...n }
    // Normalize numbers: convert '' to null; retain numbers
    const numKeys = ['diameter_mm','gps_lat','gps_lon','well_pos_index','pm_pos_index','pm_offset_m']
    numKeys.forEach(k => {
      if(m[k] === '' || m[k] === undefined) m[k] = null
      else if(m[k] != null) {
        const v = +m[k]
        m[k] = Number.isFinite(v) ? v : null
      }
    })
    return m
  }) : []
  const edges = Array.isArray(graph?.edges) ? graph.edges.map(e => ({
    id: e.id,
    from_id: e.from_id ?? e.source,
    to_id: e.to_id ?? e.target,
    active: e.active !== false,
  })) : []
  return { nodes, edges }
}

export async function saveGraph(graph) {
  const q = parseSearch()
  const params = buildParamsForSource(q)
  const payload = sanitizeGraph(graph || {})
  const res = await fetch('/api/graph?' + params.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`POST /api/graph ${res.status} ${txt}`)
  }
  return await res.json().catch(() => ({ ok: true }))
}

export function getMode() {
  return parseSearch().mode || 'ro'
}
