// Bridge to emulate google.script.run against our FastAPI API.
// Supports chaining withSuccessHandler/withFailureHandler then getGraph()/saveGraph().
function parseSearch(){
  const p = new URLSearchParams(location.search)
  return {
    sheet_id: p.get('sheet_id') || '',
    mode: p.get('mode') || 'ro',
    source: p.get('source') || null,
    gcs_uri: p.get('gcs_uri') || null,
    bq_project: p.get('bq_project') || null,
    bq_dataset: p.get('bq_dataset') || null,
    bq_nodes: p.get('bq_nodes') || null,
    bq_edges: p.get('bq_edges') || null,
  }
}

function makeRunner(){
  let ok = () => {}, fail = (e) => { console.error('[bridge] error', e) }
  const q = parseSearch()
  const chain = {
    withSuccessHandler(fn){ ok = fn || ok; return chain },
    withFailureHandler(fn){ fail = fn || fail; return chain },
    getGraph(){
      const params = new URLSearchParams()
      if (q.source) params.set('source', q.source)
      if (q.sheet_id) params.set('sheet_id', q.sheet_id)
      if (q.gcs_uri) params.set('gcs_uri', q.gcs_uri)
      if (q.bq_project) params.set('bq_project', q.bq_project)
      if (q.bq_dataset) params.set('bq_dataset', q.bq_dataset)
      if (q.bq_nodes) params.set('bq_nodes', q.bq_nodes)
      if (q.bq_edges) params.set('bq_edges', q.bq_edges)
      fetch('/api/graph?' + params.toString())
        .then(r => { if(!r.ok) throw new Error(''+r.status); return r.json() })
        .then(data => ok(data))
        .catch(err => fail(err))
    },
    saveGraph(payload){
      const params = new URLSearchParams()
      if (q.source) params.set('source', q.source)
      if (q.sheet_id) params.set('sheet_id', q.sheet_id)
      if (q.gcs_uri) params.set('gcs_uri', q.gcs_uri)
      if (q.bq_project) params.set('bq_project', q.bq_project)
      if (q.bq_dataset) params.set('bq_dataset', q.bq_dataset)
      if (q.bq_nodes) params.set('bq_nodes', q.bq_nodes)
      if (q.bq_edges) params.set('bq_edges', q.bq_edges)
      fetch('/api/graph?' + params.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
      })
        .then(r => { if(!r.ok) throw new Error(''+r.status); return r.json().catch(()=>({ok:true})) })
        .then(() => ok({ nodes: (payload?.nodes||[]).length, edges: (payload?.edges||[]).length }))
        .catch(err => fail(err))
    },
  }
  return chain
}

if (!window.google) window.google = {}
if (!window.google.script) window.google.script = {}
window.google.script.run = new Proxy({}, {
  get(_t, prop){
    if (prop === 'withSuccessHandler') return (fn) => makeRunner().withSuccessHandler(fn)
    if (prop === 'withFailureHandler') return (_fn) => makeRunner().withFailureHandler(_fn)
    // Direct calls without handlers
    if (prop === 'getGraph') return () => makeRunner().getGraph()
    if (prop === 'saveGraph') return (payload) => makeRunner().saveGraph(payload)
    return () => console.warn('[bridge] unknown call', prop)
  }
})

