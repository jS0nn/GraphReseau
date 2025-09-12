import { d3 } from '../vendor.js'
import { state } from '../state.js'
import { NODE_SIZE } from './render-nodes.js'
import { ensurePipeStyle } from '../style/pipes.js'
import { displayXYForNode } from '../geo.js'
import { showTooltip, hideTooltip, scheduleHide, cancelHide } from '../ui/tooltip.js'

export function renderInline(g, nodes){
  const index = new Map(nodes.map(n=>[n.id, n]))
  const devs = nodes.filter(n => n && (n.type==='POINT_MESURE' || n.type==='VANNE') && n.pm_collector_id)
  const data = devs.map(d => ({ id: d.id, type: d.type, from: index.get(d.pm_collector_id), to: d }))
    .filter(x => x.from && x.to)

  const sel = g.selectAll('path.inline').data(data, d => d.id)
  sel.enter().append('path')
    .attr('class', d => `inline ${d.type==='VANNE'?'valve-connector':'pm-connector'}`)
    .merge(sel)
    .attr('stroke', (d)=>{
      const theme = document.body?.dataset?.theme || 'dark'
      const style = ensurePipeStyle({ nodes, edges: [], theme })
      return style.colorForInline(d)
    })
    .attr('stroke-width', (d)=>{
      const theme = document.body?.dataset?.theme || 'dark'
      const style = ensurePipeStyle({ nodes, edges: [], theme })
      return style.widthForInline(d)
    })
    .attr('d', d => {
      const a = d.from, b = d.to
      const pa = displayXYForNode(a)
      const pb = displayXYForNode(b)
      const ax = (pa.x||0) + NODE_SIZE.w
      const ay = (pa.y||0) + NODE_SIZE.h/2
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
