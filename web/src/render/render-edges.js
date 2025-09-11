import { d3 } from '../vendor.js'
import { state } from '../state.js'
import { NODE_SIZE } from './render-nodes.js'
import { ensurePipeStyle } from '../style/pipes.js'
import { showTooltip, hideTooltip, scheduleHide, cancelHide } from '../ui/tooltip.js'

function pathFor(a, b){
  if(!a || !b) return ''
  const ax = (a.x||0) + NODE_SIZE.w
  const ay = (a.y||0) + NODE_SIZE.h/2
  const bx = (b.x||0)
  const by = (b.y||0) + NODE_SIZE.h/2
  const dx = Math.max(40, (bx - ax) / 2)
  const c1x = ax + dx, c1y = ay
  const c2x = bx - dx, c2y = by
  return `M${ax},${ay} C${c1x},${c1y} ${c2x},${c2y} ${bx},${by}`
}

export function renderEdges(gEdges, edges){
  const index = new Map(state.nodes.map(n => [n.id, n]))
  const norm = (e)=> ({ id: e.id, source: e.source ?? e.from_id, target: e.target ?? e.to_id, active: e.active!==false })
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
  enter.append('path').attr('class','line').attr('marker-end','url(#arrow)')
  enter.append('path').attr('class','hit')

  sel.merge(enter)
    .attr('class', d => `edge ${state.selection.edgeId===d.id?'selected':''}`)
    .each(function(d){
      const a = index.get(d.source), b = index.get(d.target)
      const dStr = pathFor(a, b)
      d3.select(this).select('path.line')
        .attr('d', dStr)
        .attr('stroke', d.active ? style.colorForEdge({ from_id:d.source, to_id:d.target }) : 'var(--muted)')
        .attr('stroke-width', style.widthForEdge({ from_id:d.source, to_id:d.target }))
        .attr('marker-end', state.selection.edgeId===d.id ? 'url(#arrowSel)' : 'url(#arrow)')
      d3.select(this).select('path.hit')
        .attr('d', dStr)
        .attr('stroke-width', Math.max(24, (style.widthForEdge({ from_id:d.source, to_id:d.target })||2)*12))
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
    const width = style.widthForEdge({ from_id:edge.source, to_id:edge.target })
    const nameA = a?.name||a?.id||'A', nameB = b?.name||b?.id||'B'
    const diaTxt = dia==null ? 'Ø inconnu (valeur par défaut)' : `Ø ${fmtNum(dia)} mm`
    return `
      <div><strong>${nameA}</strong> → <strong>${nameB}</strong></div>
      <div>${canal?(canal.name||canal.id)+' · ':''}${diaTxt}</div>
      <div style="opacity:.85">épaisseur: ${width?width.toFixed(1):'—'} px</div>
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
