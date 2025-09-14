import { d3 } from '../vendor.js'
import { state } from '../state.js'
import { NODE_SIZE } from './render-nodes.js'
import { ensurePipeStyle } from '../style/pipes.js'
import { displayXYForNode, projectLatLonToUI } from '../geo.js'
import { showTooltip, hideTooltip, scheduleHide, cancelHide } from '../ui/tooltip.js'

export function renderInline(g, nodes){
  const index = new Map(nodes.map(n=>[n.id, n]))
  const style = ensurePipeStyle({ nodes, edges: state.edges, theme: (document.body?.dataset?.theme || 'dark') })

  // Case 1: inline attached to a canal NODE (pm_collector_id)
  const devsNode = nodes.filter(n => n && (n.type==='POINT_MESURE' || n.type==='VANNE') && n.pm_collector_id)
  const dataNode = devsNode.map(d => ({ id: d.id, type: d.type, from: index.get(d.pm_collector_id), to: d }))
    .filter(x => x.from && x.to)

  // Case 2: inline attached to an EDGE (pm_collector_edge_id)
  const devsEdge = nodes.filter(n => n && (n.type==='POINT_MESURE' || n.type==='VANNE') && !n.pm_collector_id && n.pm_collector_edge_id)
  function nearestPointOnGeom(edge, px, py){
    const pts=[]
    const geom = Array.isArray(edge?.geometry) ? edge.geometry : []
    for(const g of geom){ if(Array.isArray(g)&&g.length>=2){ const p=projectLatLonToUI(+g[1], +g[0]); pts.push([p.x,p.y]) } }
    if(pts.length<2) return { x:px, y:py }
    let best={d2:Infinity, x:px, y:py}
    for(let i=1;i<pts.length;i++){
      const ax=pts[i-1][0], ay=pts[i-1][1]
      const bx=pts[i][0],   by=pts[i][1]
      const abx=bx-ax, aby=by-ay
      const apx=px-ax, apy=py-ay
      const ab2=abx*abx+aby*aby || 1
      let t=(apx*abx+apy*aby)/ab2; if(t<0) t=0; if(t>1) t=1
      const qx=ax+t*abx, qy=ay+t*aby
      const dx=px-qx, dy=py-qy
      const d2=dx*dx+dy*dy
      if(d2<best.d2) best={d2, x:qx, y:qy}
    }
    return best
  }
  const dataEdge = devsEdge.map(d => {
    const edge = state.edges.find(e => e.id===d.pm_collector_edge_id)
    if(!edge || !Array.isArray(edge.geometry)) return null
    const to = d
    const pb = displayXYForNode(to)
    const q = nearestPointOnGeom(edge, pb.x||0, (pb.y||0) + NODE_SIZE.h/2)
    // Pseudo 'from' for styling: use inline diameter if present
    const pseudoFrom = { diameter_mm: to.diameter_mm }
    return { id: d.id, type: d.type, from: pseudoFrom, to, anchorX: q.x, anchorY: q.y }
  }).filter(Boolean)

  const data = dataNode.concat(dataEdge)
  const sel = g.selectAll('path.inline').data(data, d => d.id)
  sel.enter().append('path')
    .attr('class', d => `inline ${d.type==='VANNE'?'valve-connector':'pm-connector'}`)
    .merge(sel)
    .attr('stroke', (d)=> style.colorForInline(d))
    .attr('stroke-width', (d)=> style.widthForInline(d))
    .attr('d', d => {
      const a = d.from, b = d.to
      const pb = displayXYForNode(b)
      // Anchor: either canal node (node-based) or nearest point on edge (edge-based)
      let ax, ay
      if(index.has(b.pm_collector_id)){
        const pa = displayXYForNode(index.get(b.pm_collector_id))
        ax = (pa.x||0) + NODE_SIZE.w; ay = (pa.y||0) + NODE_SIZE.h/2
      } else if(typeof d.anchorX==='number'){
        ax = d.anchorX; ay = d.anchorY
      } else {
        ax = (pb.x||0); ay = (pb.y||0)
      }
      const bx = (pb.x||0)
      const by = (pb.y||0) + NODE_SIZE.h/2
      const dx = Math.max(20, (bx - ax)/2)
      const c1x = ax + dx, c1y = ay
      const c2x = bx - dx, c2y = by
      return `M${ax},${ay} C${c1x},${c1y} ${c2x},${c2y} ${bx},${by}`
    })
    .on('mouseenter', function(e,d){
      const style = ensurePipeStyle({ nodes, edges: [], theme: document.body?.dataset?.theme || 'dark' })
      const name = d.from?.name || d.from?.id || '—'
      const dia = Number.isFinite(+d.from?.diameter_mm) ? +d.from.diameter_mm : null
      const width = style.widthForInline(d)
      const nf=(n)=>{ try{return new Intl.NumberFormat(undefined,{maximumFractionDigits:0}).format(n)}catch{return String(n)} }
      const diaTxt = dia==null ? 'Ø inconnu (valeur par défaut)' : `Ø ${nf(dia)} mm`
      cancelHide(); showTooltip(e.clientX, e.clientY, `<div><strong>${name}</strong> · ${diaTxt}</div><div style="opacity:.85">épaisseur: ${width?width.toFixed(1):'—'} px</div>`)
    })
    .on('mousemove', function(e,d){
      const style = ensurePipeStyle({ nodes, edges: [], theme: document.body?.dataset?.theme || 'dark' })
      const name = d.from?.name || d.from?.id || '—'
      const dia = Number.isFinite(+d.from?.diameter_mm) ? +d.from.diameter_mm : null
      const width = style.widthForInline(d)
      const nf=(n)=>{ try{return new Intl.NumberFormat(undefined,{maximumFractionDigits:0}).format(n)}catch{return String(n)} }
      const diaTxt = dia==null ? 'Ø inconnu (valeur par défaut)' : `Ø ${nf(dia)} mm`
      cancelHide(); showTooltip(e.clientX, e.clientY, `<div><strong>${name}</strong> · ${diaTxt}</div><div style="opacity:.85">épaisseur: ${width?width.toFixed(1):'—'} px</div>`)
    })
    .on('mouseleave', function(){ scheduleHide(2000) })
  sel.exit().remove()
}
