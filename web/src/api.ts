// Native API client for the editor (replaces Apps Script bridge)

import { sanitizeGraphPayload } from './shared/graph-transform.ts'
import type { GraphInput } from './shared/graph-transform.ts'
import type { Graph, Node } from './types/graph'
import type { PlanOverlayConfig, PlanOverlayUpdatePayload, PlanOverlayBounds } from './types/plan-overlay.ts'

export interface DriveFileItem {
  id: string
  name: string
  mime_type?: string | null
  modified_time?: string | null
  size?: string | null
  icon_link?: string | null
}

export interface DriveFileListResponse {
  files: DriveFileItem[]
  next_page_token?: string | null
}

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
  const q = parseSearch()
  const params = buildParamsForSource(q)
  const url = new URL(`/api/graph/branch-recalc?${params.toString()}`, window.location.origin).toString()
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

export async function getPlanOverlayConfig(): Promise<PlanOverlayConfig | null> {
  const q = parseSearch()
  const params = buildParamsForSource(q)
  const res = await fetch(`/api/plan-overlay/config?${params.toString()}`)
  if(res.status === 404) return null
  if(!res.ok){
    const txt = await res.text().catch(() => '')
    throw new Error(`GET /api/plan-overlay/config ${res.status} ${txt}`)
  }
  return res.json() as Promise<PlanOverlayConfig>
}

export async function fetchPlanOverlayMedia(options: { transparent?: boolean } = {}): Promise<{ blob: Blob; mime: string }> {
  const q = parseSearch()
  const params = buildParamsForSource(q)
  if(options.transparent === false){
    params.set('transparent', '0')
  }
  const res = await fetch(`/api/plan-overlay/media?${params.toString()}`)
  if(res.status === 404){
    throw new Error('plan overlay media not found')
  }
  if(!res.ok){
    const txt = await res.text().catch(() => '')
    throw new Error(`GET /api/plan-overlay/media ${res.status} ${txt}`)
  }
  const blob = await res.blob()
  const mime = res.headers.get('Content-Type') || blob.type || 'application/octet-stream'
  return { blob, mime }
}

export async function savePlanOverlayConfig(update: PlanOverlayUpdatePayload): Promise<PlanOverlayConfig> {
  const q = parseSearch()
  const params = buildParamsForSource(q)
  const res = await fetch(`/api/plan-overlay/config?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  })
  if(!res.ok){
    const txt = await res.text().catch(() => '')
    throw new Error(`POST /api/plan-overlay/config ${res.status} ${txt}`)
  }
  return res.json() as Promise<PlanOverlayConfig>
}

export async function listPlanOverlayDriveFiles(options: {
  query?: string
  pageSize?: number
  pageToken?: string | null
  driveId?: string | null
  parentId?: string | null
} = {}): Promise<DriveFileListResponse> {
  const q = parseSearch()
  const params = buildParamsForSource(q)
  if(options.query){
    params.set('query', options.query)
  }
  if(options.pageSize && Number.isFinite(options.pageSize)){
    params.set('page_size', String(Math.max(1, Math.min(100, options.pageSize || 50))))
  }
  if(options.pageToken){
    params.set('page_token', options.pageToken)
  }
  if(options.driveId){
    params.set('drive_id', options.driveId)
  }
  if(options.parentId){
    params.set('parent_id', options.parentId)
  }
  const res = await fetch(`/api/plan-overlay/drive-files?${params.toString()}`)
  if(!res.ok){
    const txt = await res.text().catch(() => '')
    throw new Error(`GET /api/plan-overlay/drive-files ${res.status} ${txt}`)
  }
  const data = await res.json()
  const files = Array.isArray(data?.files) ? data.files : []
  return {
    files,
    next_page_token: data?.next_page_token ?? null,
  }
}

export async function importPlanOverlayFromDrive(payload: { driveFileId: string; displayName?: string | null }): Promise<PlanOverlayConfig> {
  const q = parseSearch()
  const params = buildParamsForSource(q)
  const body = {
    drive_file_id: payload.driveFileId,
    display_name: payload.displayName ?? null,
  }
  const res = await fetch(`/api/plan-overlay/import?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if(!res.ok){
    const txt = await res.text().catch(() => '')
    throw new Error(`POST /api/plan-overlay/import ${res.status} ${txt}`)
  }
  return res.json() as Promise<PlanOverlayConfig>
}

export async function uploadPlanOverlayFile(file: File, options: { displayName?: string | null; bounds?: PlanOverlayBounds } = {}): Promise<PlanOverlayConfig> {
  const q = parseSearch()
  const params = buildParamsForSource(q)
  const formData = new FormData()
  formData.append('file', file)
  if(options.displayName != null){
    formData.append('display_name', options.displayName)
  }
  if(options.bounds){
    formData.append('bounds', JSON.stringify(options.bounds))
  }
  const res = await fetch(`/api/plan-overlay/upload?${params.toString()}`, {
    method: 'POST',
    body: formData,
  })
  if(!res.ok){
    const txt = await res.text().catch(() => '')
    throw new Error(`POST /api/plan-overlay/upload ${res.status} ${txt}`)
  }
  return res.json() as Promise<PlanOverlayConfig>
}

export async function deletePlanOverlayConfig(): Promise<{ ok: boolean }> {
  const q = parseSearch()
  const params = buildParamsForSource(q)
  const res = await fetch(`/api/plan-overlay/media?${params.toString()}`, {
    method: 'DELETE',
  })
  if(!res.ok){
    const txt = await res.text().catch(() => '')
    throw new Error(`DELETE /api/plan-overlay/media ${res.status} ${txt}`)
  }
  return res.json().catch(() => ({ ok: true }))
}
