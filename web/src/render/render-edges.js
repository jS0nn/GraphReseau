import { d3 } from '../vendor.js'
import { state } from '../state/index.js'
import { projectLatLonToUI } from '../geo.js'
import { ensurePipeStyle } from '../style/pipes.js'
import { showTooltip, hideTooltip, scheduleHide, cancelHide } from '../ui/tooltip.js'
import { getNodeCanvasPosition, getNodeCenterPosition, isGraphView } from '../view/view-mode.js'

function anchorFor(node /*, isSource*/){
  if(!node) return { x:0, y:0 }
  const c = getNodeCenterPosition(node)
  return { x: c.x || 0, y: c.y || 0 }
}

function dedupePoints(points){
  const out = []
  for(const p of points){
    if(!Array.isArray(p) || p.length < 2) continue
    const x = +p[0], y = +p[1]
    if(!Number.isFinite(x) || !Number.isFinite(y)) continue
    const prev = out[out.length - 1]
    if(prev && Math.abs(prev[0] - x) < 0.5 && Math.abs(prev[1] - y) < 0.5) continue
    out.push([x, y])
  }
  return out
}

function arrowSegmentFromPoints(points){
  if(!Array.isArray(points) || points.length < 2) return ''
  let total = 0
  const segments = []
  for(let i = 1; i < points.length; i++){
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

function buildPath(points){
  if(!Array.isArray(points) || !points.length) return ''
  let d = ''
  for(let i = 0; i < points.length; i++){
    const pt = points[i]
    d += (i === 0 ? 'M' : ' L') + pt[0] + ',' + pt[1]
  }
  return d
}

function geometryPoints(geom, aNode, bNode){
  if(!Array.isArray(geom) || geom.length < 2) return null
  const pts = []
  for(const g of geom){
    if(!Array.isArray(g) || g.length < 2) continue
    const lon = +g[0]
    const lat = +g[1]
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const projected = projectLatLonToUI(lat, lon)
    pts.push([projected.x, projected.y])
  }
  if(!pts.length) return null
  if(aNode){ const A = anchorFor(aNode, true); pts[0] = [A.x, A.y] }
  if(bNode){ const B = anchorFor(bNode, false); pts[pts.length - 1] = [B.x, B.y] }
  return dedupePoints(pts)
}

function graphPoints(aNode, bNode){
  if(!aNode || !bNode) return []
  const A = anchorFor(aNode, true)
  const B = anchorFor(bNode, false)
  const start = [A.x, A.y]
  const end = [B.x, B.y]
  if(!isGraphView()) return dedupePoints([start, end])
  const deltaY = Math.abs(B.y - A.y)
  if(deltaY < 1) return dedupePoints([start, end])
  const midY = Math.round((A.y + B.y) / 2)
  const path = [start, [A.x, midY], [B.x, midY], end]
  return dedupePoints(path)
}

export function renderEdges(gEdges, edges){
  const index = new Map(state.nodes.map(n => [n.id, n]))
  const norm = (e)=> ({
    ...e,
    id: e.id,
    source: e.source ?? e.from_id,
    target: e.target ?? e.to_id,
    from_id: e.from_id ?? e.source,
    to_id: e.to_id ?? e.target,
    active: e.active!==false,
    geometry: e.geometry,
    diameter_mm: e.diameter_mm ?? e.diametre_mm ?? null,
  })
  // Deduplicate edges by id
  const seen = new Set()
  const data = []
  for(const e of edges.map(norm)){
    if(!e.id || seen.has(e.id)) continue
    if(index.has(e.source) && index.has(e.target)){ seen.add(e.id); data.push(e) }
  }

  // Style engine (memoized)
  const theme = document.body?.dataset?.theme || 'dark'
  const style = ensurePipeStyle({ nodes: state.nodes, edges: state.edges, theme })

  const sel = gEdges.selectAll('g.edge').data(data, d => d.id)
  const enter = sel.enter().append('g').attr('class','edge').attr('tabindex', 0)
  enter.attr('data-id', d=>d.id)
  enter.append('path').attr('class','line')
  enter.append('path').attr('class','midArrow').attr('marker-end','url(#arrow)')
  enter.append('path').attr('class','hit')

  const DEFAULT_EDGE_WIDTH = 1.8
  sel.merge(enter)
    .attr('class', d => `edge ${state.selection.edgeId===d.id?'selected':''}`)
    .attr('data-id', d=>d.id)
    .each(function(d){
      const a = index.get(d.source), b = index.get(d.target)
      const useGeometry = !isGraphView() && Array.isArray(d.geometry) && d.geometry.length>=2
      const pts = useGeometry ? geometryPoints(d.geometry, a, b) : graphPoints(a, b)
      const safePts = (pts && pts.length >= 2) ? pts : graphPoints(a, b)
      const dStr = buildPath(safePts)
      const varWidth = !!state.edgeVarWidth
      const baseW = varWidth ? (style.widthForEdge(d) || DEFAULT_EDGE_WIDTH) : DEFAULT_EDGE_WIDTH
      const sel = state.selection.edgeId===d.id
      const baseColor = d.active ? style.colorForEdge({ from_id:d.source, to_id:d.target }) : 'var(--muted)'
      const hiColor = d.active ? 'var(--edge-color-sel)' : 'var(--muted)'
      const strokeColor = sel ? hiColor : baseColor
      const w = sel ? Math.max(baseW * 1.6, baseW + 1.4) : baseW
      if(sel && this.parentNode){
        try{ this.parentNode.appendChild(this) }catch{}
      }
      d3.select(this)
        .style('filter', sel ? 'drop-shadow(0 0 6px rgba(106,168,255,0.55))' : null)
      d3.select(this).select('path.line')
        .attr('d', dStr)
        .attr('stroke', strokeColor)
        .attr('stroke-width', w)
        .attr('fill', 'none')
        .attr('marker-end', null)
      // Mid arrow oriented along polyline (or center between nodes)
      const midD = arrowSegmentFromPoints(safePts)
      d3.select(this).select('path.midArrow')
        .attr('d', midD || null)
        .attr('stroke', strokeColor)
        .attr('stroke-width', Math.max(1, w*0.9))
        .attr('marker-end', sel ? 'url(#arrowSel)' : 'url(#arrow)')
        .style('display', midD ? null : 'none')
      d3.select(this).select('path.hit')
        .attr('d', dStr)
        .attr('stroke-width', Math.max(24, w*12))
        .attr('fill', 'none')
    })

  // Tooltips (hover and keyboard focus)
  function fmtNum(n){ try{ return new Intl.NumberFormat(undefined, { maximumFractionDigits:0 }).format(n) }catch{ return String(n) } }
  function tipHTML(edge){
    const a = index.get(edge.source), b = index.get(edge.target)
    // Prefer child canal if both ends are canals
    const aIs = a && (a.type==='CANALISATION'||a.type==='COLLECTEUR')
    const bIs = b && (b.type==='CANALISATION'||b.type==='COLLECTEUR')
    const canal = (aIs && bIs) ? b : (aIs ? a : (bIs ? b : null))
    const edgeDia = Number.isFinite(+edge?.diameter_mm) && +edge.diameter_mm > 0 ? +edge.diameter_mm : null
    const raw = edgeDia ?? (canal ? +canal.diameter_mm : NaN)
    const dia = (Number.isFinite(raw) && raw > 0) ? raw : null
    const nameA = a?.name||a?.id||'A', nameB = b?.name||b?.id||'B'
    const diaTxt = dia==null ? 'Ø inconnu (valeur par défaut)' : `Ø ${fmtNum(dia)} mm`
    return `
      <div><strong>${nameA}</strong> → <strong>${nameB}</strong></div>
      <div>${canal?(canal.name||canal.id)+' · ':''}${diaTxt}</div>
    `
  }
  sel.merge(enter)
    .on('mouseenter', function(e,d){ cancelHide(); showTooltip(e.clientX, e.clientY, tipHTML(d)) })
    .on('mousemove', function(e,d){ cancelHide(); showTooltip(e.clientX, e.clientY, tipHTML(d)) })
    .on('mouseleave', function(){ scheduleHide(2000) })
    .on('focus', function(e,d){ cancelHide(); const bb=this.getBoundingClientRect(); showTooltip(bb.right, bb.top, tipHTML(d)) })
    .on('blur', function(){ scheduleHide(2000) })
  sel.exit().remove()
}
