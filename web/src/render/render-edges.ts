import { d3 } from '../vendor.ts'
import { state, getBranchName } from '../state/index.ts'
import { projectLatLonToUI } from '../geo.ts'
import { ensurePipeStyle } from '../style/pipes.ts'
import type { EdgeInput, StyleMetaOverrides } from '../style/pipes.ts'
import { colorForBranchId } from '../shared/branch-colors.ts'
import { showTooltip, hideTooltip, scheduleHide, cancelHide } from '../ui/tooltip.ts'
import { getNodeCenterPosition, isGraphView } from '../view/view-mode.ts'
import type { MutableEdge, MutableNode } from '../state/normalize.ts'
import type { Selection, BaseType } from 'd3-selection'

type Point = [number, number]

type EdgeGroupSelection = Selection<SVGGElement, unknown, BaseType, unknown>
type EdgeSelection = Selection<SVGGElement, RenderEdge, BaseType, RenderEdge>

type LegacyEdge = MutableEdge & {
  source?: string | null
  target?: string | null
  diametre_mm?: number | null
  ui_diameter_mm?: number | null
  site_effective?: string | null
  site_effective_is_fallback?: boolean
}

const asLegacy = (edge: MutableEdge): LegacyEdge => edge as LegacyEdge

function anchorFor(node: MutableNode | undefined | null): Point {
  if(!node) return [0, 0]
  const c = getNodeCenterPosition(node)
  return [c.x || 0, c.y || 0]
}

function dedupePoints(points: Point[]): Point[] {
  const out: Point[] = []
  for(const p of points){
    if(!Array.isArray(p) || p.length < 2) continue
    const x = +p[0]
    const y = +p[1]
    if(!Number.isFinite(x) || !Number.isFinite(y)) continue
    const prev = out[out.length - 1]
    if(prev && Math.abs(prev[0] - x) < 0.5 && Math.abs(prev[1] - y) < 0.5) continue
    out.push([x, y])
  }
  return out
}

function arrowSegmentFromPoints(points: Point[]): string {
  if(!Array.isArray(points) || points.length < 2) return ''
  let total = 0
  type Segment = { a: Point; b: Point; len: number }
  const segments: Segment[] = []
  for(let i = 1; i < points.length; i += 1){
    const a = points[i - 1]
    const b = points[i]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy)
    if(len <= 0) continue
    segments.push({ a, b, len })
    total += len
  }
  if(total <= 0) return ''
  let target = total / 2
  for(const seg of segments){
    if(target > seg.len){ target -= seg.len; continue }
    const t = seg.len ? (target / seg.len) : 0
    const x0 = seg.a[0] + (seg.b[0] - seg.a[0]) * t
    const y0 = seg.a[1] + (seg.b[1] - seg.a[1]) * t
    const dirx = seg.b[0] - seg.a[0]
    const diry = seg.b[1] - seg.a[1]
    const norm = Math.hypot(dirx, diry) || 1
    const ux = dirx / norm
    const uy = diry / norm
    const span = 18
    const x1 = x0 + ux * span
    const y1 = y0 + uy * span
    return `M${x0},${y0} L${x1},${y1}`
  }
  return ''
}

function buildPath(points: Point[] | null | undefined): string {
  if(!Array.isArray(points) || !points.length) return ''
  let d = ''
  for(let i = 0; i < points.length; i += 1){
    const pt = points[i]
    d += (i === 0 ? 'M' : ' L') + pt[0] + ',' + pt[1]
  }
  return d
}

function geometryPoints(
  geom: Array<[number | string, number | string]> | null | undefined,
  aNode: MutableNode | undefined | null,
  bNode: MutableNode | undefined | null,
): Point[] | null {
  if(!Array.isArray(geom) || geom.length < 2) return null
  const pts: Point[] = []
  for(const g of geom){
    if(!Array.isArray(g) || g.length < 2) continue
    const lon = +g[0]
    const lat = +g[1]
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const projected = projectLatLonToUI(lat, lon)
    pts.push([projected.x, projected.y])
  }
  if(!pts.length) return null
  if(aNode){ const A = anchorFor(aNode); pts[0] = [A[0], A[1]] }
  if(bNode){ const B = anchorFor(bNode); pts[pts.length - 1] = [B[0], B[1]] }
  return dedupePoints(pts)
}

function graphPoints(aNode: MutableNode | undefined, bNode: MutableNode | undefined): Point[] {
  if(!aNode || !bNode) return []
  const A = anchorFor(aNode)
  const B = anchorFor(bNode)
  const start: Point = [A[0], A[1]]
  const end: Point = [B[0], B[1]]
  if(!isGraphView()) return dedupePoints([start, end])
  const deltaY = Math.abs(B[1] - A[1])
  if(deltaY < 1) return dedupePoints([start, end])
  const midY = Math.round((A[1] + B[1]) / 2)
  const path: Point[] = [start, [A[0], midY], [B[0], midY], end]
  return dedupePoints(path)
}

type RenderEdge = MutableEdge & {
  source: string | null | undefined
  target: string | null | undefined
  from_id: string | null | undefined
  to_id: string | null | undefined
}

export function renderEdges(gEdges: EdgeGroupSelection, edges: MutableEdge[]): void {
  const index = new Map<string, MutableNode>(state.nodes.map(node => [node.id, node]))
  const normalizeEdge = (edge: LegacyEdge): RenderEdge => ({
    ...edge,
    id: edge.id,
    source: edge.source ?? edge.from_id ?? null,
    target: edge.target ?? edge.to_id ?? null,
    from_id: edge.from_id ?? edge.source ?? null,
    to_id: edge.to_id ?? edge.target ?? null,
    active: edge.active !== false,
    geometry: edge.geometry ?? null,
    diameter_mm: edge.diameter_mm ?? edge.diametre_mm ?? null,
    ui_diameter_mm: edge.ui_diameter_mm ?? null,
    site_effective: edge.site_effective ?? null,
    site_effective_is_fallback: !!edge.site_effective_is_fallback,
  })
  const seen = new Set<string>()
  const data: RenderEdge[] = []
  for(const edge of edges){
    const normalized = normalizeEdge(asLegacy(edge))
    const src = normalized.source ?? normalized.from_id
    const dst = normalized.target ?? normalized.to_id
    if(!normalized.id || seen.has(normalized.id)) continue
    if(src && dst && index.has(String(src)) && index.has(String(dst))){
      seen.add(normalized.id)
      data.push(normalized)
    }
  }
  const theme = document.body?.dataset?.theme || 'dark'
  const styleMeta = (state.graphMeta?.style_meta || {}) as StyleMetaOverrides
  const style = ensurePipeStyle({ nodes: state.nodes, edges: state.edges, theme, options: { styleMeta } })
  const sel: EdgeSelection = gEdges.selectAll<SVGGElement, RenderEdge>('g.edge').data(data, (d: RenderEdge) => d.id)
  const enter = sel.enter().append('g').attr('class','edge').attr('tabindex', 0)
  enter.attr('data-id', (d: RenderEdge)=>d.id)
  enter.append('path').attr('class','line')
  enter.append('path').attr('class','midArrow').attr('marker-end','url(#arrow)')
  enter.append('path').attr('class','hit')
  const DEFAULT_EDGE_WIDTH = 1.8
  const merged = sel.merge(enter)
  merged
    .attr('class', (d: RenderEdge) => `edge ${state.selection.edgeId===d.id?'selected':''}`)
    .attr('data-id', (d: RenderEdge)=>d.id)
    .attr('data-branch-id', (d: RenderEdge) => d.branch_id || '')
    .attr('data-site-effective', (d: RenderEdge) => d.site_effective || '')
    .attr('data-site-fallback', (d: RenderEdge) => d.site_effective_is_fallback ? '1' : '0')
    .each(function(d: RenderEdge){
      const srcId = d.source ?? d.from_id ?? null
      const dstId = d.target ?? d.to_id ?? null
      const a = srcId ? index.get(String(srcId)) : undefined
      const b = dstId ? index.get(String(dstId)) : undefined
      const useGeometry = !isGraphView() && Array.isArray(d.geometry) && d.geometry.length>=2
      const pts = useGeometry ? geometryPoints(d.geometry, a, b) : graphPoints(a, b)
      const safePts = (pts && pts.length >= 2) ? pts : graphPoints(a, b)
      const dStr = buildPath(safePts)
      const varWidth = !!state.edgeVarWidth
      const diameterValue = Number(d.diameter_mm)
      const direct = Number.isFinite(diameterValue) && diameterValue > 0 ? diameterValue : null
      const uiValue = Number(d.ui_diameter_mm)
      const inherited = Number.isFinite(uiValue) && uiValue > 0 ? uiValue : null
      const visualDiameter = direct ?? inherited
      const widthEdge = (visualDiameter != null)
        ? ({ ...d, diameter_mm: visualDiameter } as EdgeInput)
        : (d as EdgeInput)
      const baseW = varWidth ? (style.widthForEdge(widthEdge) || DEFAULT_EDGE_WIDTH) : DEFAULT_EDGE_WIDTH
      const selected = state.selection.edgeId===d.id
      const branchColor = colorForBranchId(d.branch_id, theme)
      const colorEdge = { ...d, from_id: srcId ?? null, to_id: dstId ?? null } as EdgeInput
      const baseColor = branchColor || (d.active ? style.colorForEdge(colorEdge) : 'var(--muted)')
      const hiColor = d.active ? 'var(--edge-color-sel)' : 'var(--muted)'
      const strokeColor = selected ? hiColor : baseColor
      const w = selected ? Math.max(baseW * 1.6, baseW + 1.4) : baseW
      if(selected && this.parentNode){
        try{ this.parentNode.appendChild(this) }catch{}
      }
      const group = d3.select(this)
      if(selected){
        group.style('filter', 'drop-shadow(0 0 6px rgba(106,168,255,0.55))')
      }else{
        group.style('filter', null)
      }
      group.select('path.line')
        .attr('d', dStr)
        .attr('stroke', strokeColor)
        .attr('stroke-width', w)
        .attr('fill', 'none')
        .attr('marker-end', null)
      const midD = arrowSegmentFromPoints(safePts)
      const midArrow = group.select('path.midArrow')
      midArrow
        .attr('d', midD || null)
        .attr('stroke', strokeColor)
        .attr('stroke-width', Math.max(1, w*0.9))
        .attr('marker-end', selected ? 'url(#arrowSel)' : 'url(#arrow)')
      if(midD){
        midArrow.style('display', null)
      }else{
        midArrow.style('display', 'none')
      }
      group.select('path.hit')
        .attr('d', dStr)
        .attr('stroke-width', Math.max(24, w*12))
        .attr('fill', 'none')
    })
  // Tooltips (hover and keyboard focus)
  function fmtNum(n: number){ try{ return new Intl.NumberFormat(undefined, { maximumFractionDigits:0 }).format(n) }catch{ return String(n) } }
  function tipHTML(edge: RenderEdge){
    const srcId = edge.source ?? edge.from_id ?? null
    const dstId = edge.target ?? edge.to_id ?? null
    const a = srcId ? index.get(String(srcId)) : undefined
    const b = dstId ? index.get(String(dstId)) : undefined
    // Prefer child canal if both ends are canals
    const aIs = a && (a.type==='CANALISATION'||a.type==='COLLECTEUR')
    const bIs = b && (b.type==='CANALISATION'||b.type==='COLLECTEUR')
    const canal = (aIs && bIs) ? b : (aIs ? a : (bIs ? b : null))
    const finitePositive = (value: unknown): number | null => {
      const num = Number(value)
      return Number.isFinite(num) && num > 0 ? num : null
    }
    const direct = finitePositive(edge?.diameter_mm)
    const fallback = finitePositive(edge?.ui_diameter_mm)
    const canalDia = canal ? finitePositive(canal.diameter_mm) : null
    const dia = direct ?? fallback ?? canalDia
    const nameA = a?.name||a?.id||'A', nameB = b?.name||b?.id||'B'
    const inheritedTxt = (direct == null && fallback != null)
      ? `Ø ${fmtNum(fallback)} mm (hérité)`
      : (dia == null ? 'Ø inconnu (valeur par défaut)' : `Ø ${fmtNum(dia)} mm`)
    const siteEff = edge.site_effective || '—'
    const siteNote = edge.site_effective_is_fallback ? `${siteEff} · donnée manquante` : siteEff
    const branchLabel = getBranchName(edge.branch_id || '')
    const branchInfo = branchLabel ? `<div>Branche: ${branchLabel}</div>` : ''
    return `
      <div><strong>${nameA}</strong> → <strong>${nameB}</strong></div>
      <div>${canal?(canal.name||canal.id)+' · ':''}${inheritedTxt}</div>
      ${branchInfo}
      <div>Site: ${siteNote}</div>
    `
  }
  merged
    .on('mouseenter', function(event: MouseEvent, d: RenderEdge){ cancelHide(); showTooltip(event.clientX, event.clientY, tipHTML(d)) })
    .on('mousemove', function(event: MouseEvent, d: RenderEdge){ cancelHide(); showTooltip(event.clientX, event.clientY, tipHTML(d)) })
    .on('mouseleave', function(){ scheduleHide(2000) })
    .on('focus', function(this: SVGElement, _event: FocusEvent, d: RenderEdge){ cancelHide(); const bb=this.getBoundingClientRect(); showTooltip(bb.right, bb.top, tipHTML(d)) })
    .on('blur', function(){ scheduleHide(2000) })
  sel.exit().remove()
}
