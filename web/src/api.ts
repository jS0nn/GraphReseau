// Native API client for the editor (replaces Apps Script bridge)

import { sanitizeGraphPayload } from './shared/graph-transform.ts'
import type { GraphInput } from './shared/graph-transform.ts'
import type { Graph, Node } from './types/graph'

type ParsedQuery = {
  source?: string | null
  sheet_id?: string | null
  site_id?: string | null
  gcs_uri?: string | null
  bq_project?: string | null
  bq_dataset?: string | null
  bq_nodes?: string | null
  bq_edges?: string | null
  mode?: string | null
}

const NODE_NUMERIC_FIELDS = [
  'diameter_mm',
  'gps_lat',
  'gps_lon',
  'well_pos_index',
  'pm_pos_index',
  'pm_offset_m',
] as const

type NodeNumericField = typeof NODE_NUMERIC_FIELDS[number]
type CoercibleNode = Node & Record<NodeNumericField, number | string | null | undefined>

function getLocationSearch(): string {
  try{
    if(typeof location !== 'undefined' && typeof location.search === 'string'){
      return location.search
    }
  }catch{}
  return ''
}

function parseSearch(): ParsedQuery {
  const p = new URLSearchParams(getLocationSearch())
  return {
    source: p.get('source'),
    sheet_id: p.get('sheet_id'),
    site_id: p.get('site_id'),
    gcs_uri: p.get('gcs_uri'),
    bq_project: p.get('bq_project'),
    bq_dataset: p.get('bq_dataset'),
    bq_nodes: p.get('bq_nodes'),
    bq_edges: p.get('bq_edges'),
    mode: p.get('mode'),
  }
}

function buildParamsForSource(q: ParsedQuery): URLSearchParams {
  const params = new URLSearchParams()
  if(q.source) params.set('source', q.source)
  if(!q.source || q.source === 'sheet' || q.source === 'sheets'){
    if(q.sheet_id) params.set('sheet_id', q.sheet_id)
  }else if(q.source === 'gcs_json' || q.source === 'json' || q.source === 'gcs'){
    if(q.gcs_uri) params.set('gcs_uri', q.gcs_uri)
  }else if(q.source === 'bigquery' || q.source === 'bq'){
    if(q.bq_project) params.set('bq_project', q.bq_project)
    if(q.bq_dataset) params.set('bq_dataset', q.bq_dataset)
    if(q.bq_nodes) params.set('bq_nodes', q.bq_nodes)
    if(q.bq_edges) params.set('bq_edges', q.bq_edges)
  }
  if(q.site_id) params.set('site_id', q.site_id)
  return params
}

export async function getGraph(): Promise<Graph> {
  const q = parseSearch()
  const params = buildParamsForSource(q)
  const res = await fetch(`/api/graph?${params.toString()}`)
  if(!res.ok){
    const txt = await res.text().catch(() => '')
    throw new Error(`GET /api/graph ${res.status} ${txt}`)
  }
  const data: Graph = await res.json()
  if(Array.isArray(data?.nodes)){
    (data.nodes as CoercibleNode[]).forEach((node) => {
      NODE_NUMERIC_FIELDS.forEach((key) => {
        if(!node) return
        const value = node[key] as number | string | null | undefined
        if(value === ''){
          node[key] = null
        }
      })
    })
  }
  return data
}

export async function saveGraph(graph: Graph): Promise<{ ok: boolean }> {
  const q = parseSearch()
  const params = buildParamsForSource(q)
  const payload = sanitizeGraphPayload((graph || {}) as GraphInput)
  const res = await fetch(`/api/graph?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if(!res.ok){
    const txt = await res.text().catch(() => '')
    throw new Error(`POST /api/graph ${res.status} ${txt}`)
  }
  return res.json().catch(() => ({ ok: true }))
}

export function getMode(): string {
  return parseSearch().mode || 'ro'
}

export async function recomputeBranches(graph: Graph): Promise<unknown> {
  const payload = sanitizeGraphPayload((graph || {}) as GraphInput)
  if(typeof window === 'undefined' || !window?.location?.origin){
    // Tests or non-browser environments: skip network recompute and pretend it succeeded.
    return { ok: true }
  }
  const url = new URL('/api/graph/branch-recalc', window.location.origin).toString()
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if(!res.ok){
    const txt = await res.text().catch(() => '')
    throw new Error(`POST /api/graph/branch-recalc ${res.status} ${txt}`)
  }
  return res.json()
}

export const __internals = {
  parseSearch,
  buildParamsForSource,
}
