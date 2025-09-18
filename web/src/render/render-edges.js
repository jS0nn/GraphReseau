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

function pathFor(a, b){
  if(!a || !b) return ''
  const A = anchorFor(a, true)
  const B = anchorFor(b, false)
  const ax = A.x, ay = A.y
  const bx = B.x, by = B.y
  const dx = Math.max(40, (bx - ax) / 2)
  const c1x = ax + dx, c1y = ay
  const c2x = bx - dx, c2y = by
  return `M${ax},${ay} C${c1x},${c1y} ${c2x},${c2y} ${bx},${by}`
}

function pathForGeometry(geom, aNode, bNode){
  if(!Array.isArray(geom) || geom.length < 2) return ''
  const pts = []
  for(let i=0;i<geom.length;i++){
    const g = geom[i]
    if(!Array.isArray(g) || g.length<2) continue
    const lon = +g[0], lat = +g[1]
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const p = projectLatLonToUI(lat, lon)
    pts.push([p.x, p.y])
  }
  // Anchor endpoints to current node positions to keep attachment live during moves
  if(aNode){ const A = anchorFor(aNode, true); pts[0] = [A.x, A.y] }
  if(bNode){ const B = anchorFor(bNode, false); pts[pts.length-1] = [B.x, B.y] }
  let d = ''
  for(let i=0;i<pts.length;i++){
    const p = pts[i]
    if(!p) continue
    if(i===0) d += `M${p[0]},${p[1]}`; else d += ` L${p[0]},${p[1]}`
  }
  return d
}

function midArrowForGeometry(geom, aNode, bNode){
  if(!Array.isArray(geom) || geom.length < 2) return ''
  const pts = []
  for(const g of geom){
    if(!Array.isArray(g) || g.length<2) continue
    const lon = +g[0], lat = +g[1]
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const p = projectLatLonToUI(lat, lon)
    pts.push([p.x, p.y])
  }
  if(aNode){ const A = anchorFor(aNode, true); pts[0] = [A.x, A.y] }
  if(bNode){ const B = anchorFor(bNode, false); pts[pts.length-1] = [B.x, B.y] }
  if(pts.length < 2) return ''
  // Compute total length and midpoint
  let L = 0
  const segs = []
  for(let i=1;i<pts.length;i++){
    const a = pts[i-1], b = pts[i]
    const dx = b[0]-a[0], dy=b[1]-a[1]
    const l = Math.hypot(dx,dy)
    segs.push({a,b,l})
    L += l
  }
  if(L<=0) return ''
  let target = L/2
  for(const s of segs){
    if(target > s.l){ target -= s.l; continue }
    // Place arrow along segment s at fraction t
    const t = s.l ? (target / s.l) : 0
    const x0 = s.a[0] + (s.b[0]-s.a[0]) * t
    const y0 = s.a[1] + (s.b[1]-s.a[1]) * t
    const dirx = (s.b[0]-s.a[0]), diry = (s.b[1]-s.a[1])
    const len = Math.hypot(dirx, diry) || 1
    const ux = dirx / len, uy = diry / len
    const span = 18 // px
    const x1 = x0 + ux * span
    const y1 = y0 + uy * span
    return `M${x0},${y0} L${x1},${y1}`
  }
  return ''
}

export function renderEdges(gEdges, edges){
  const index = new Map(state.nodes.map(n => [n.id, n]))
  const norm = (e)=> ({ id: e.id, source: e.source ?? e.from_id, target: e.target ?? e.to_id, active: e.active!==false, geometry: e.geometry })
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
      const dStr = useGeometry ? pathForGeometry(d.geometry, a, b) : pathFor(a, b)
      const varWidth = !!state.edgeVarWidth
      const baseW = varWidth ? (style.widthForEdge({ from_id:d.source, to_id:d.target }) || DEFAULT_EDGE_WIDTH) : DEFAULT_EDGE_WIDTH
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
      // Mid arrow oriented along polyline (or center between nodes)
      const midD = useGeometry ? midArrowForGeometry(d.geometry, a, b) : ''
      d3.select(this).select('path.midArrow')
        .attr('d', midD || null)
        .attr('stroke', strokeColor)
        .attr('stroke-width', Math.max(1, w*0.9))
        .attr('marker-end', sel ? 'url(#arrowSel)' : 'url(#arrow)')
      d3.select(this).select('path.hit')
        .attr('d', dStr)
        .attr('stroke-width', Math.max(24, w*12))
    })

  // Tooltips (hover and keyboard focus)
  function fmtNum(n){ try{ return new Intl.NumberFormat(undefined, { maximumFractionDigits:0 }).format(n) }catch{ return String(n) } }
  function tipHTML(edge){
    const a = index.get(edge.source), b = index.get(edge.target)
    // Prefer child canal if both ends are canals
    const aIs = a && (a.type==='CANALISATION'||a.type==='COLLECTEUR')
    const bIs = b && (b.type==='CANALISATION'||b.type==='COLLECTEUR')
    const canal = (aIs && bIs) ? b : (aIs ? a : (bIs ? b : null))
    const raw = canal ? +canal.diameter_mm : NaN
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
