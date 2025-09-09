import { d3 } from '../vendor.js'
import { state } from '../state.js'
import { NODE_SIZE } from './render-nodes.js'

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

  const sel = gEdges.selectAll('g.edge').data(data, d => d.id)
  const enter = sel.enter().append('g').attr('class','edge')
  enter.append('path').attr('class','line').attr('marker-end','url(#arrow)')
  enter.append('path').attr('class','hit')

  sel.merge(enter)
    .attr('class', d => `edge ${state.selection.edgeId===d.id?'selected':''}`)
    .each(function(d){
      const a = index.get(d.source), b = index.get(d.target)
      const dStr = pathFor(a, b)
      d3.select(this).select('path.line')
        .attr('d', dStr)
        .attr('stroke', d.active ? 'var(--edge-color)' : 'var(--muted)')
        .attr('marker-end', state.selection.edgeId===d.id ? 'url(#arrowSel)' : 'url(#arrow)')
      d3.select(this).select('path.hit')
        .attr('d', dStr)
    })
  sel.exit().remove()
}
