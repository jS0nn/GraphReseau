import { d3 } from '../vendor.js'
import { state } from '../state.js'
import { NODE_SIZE } from './render-nodes.js'

export function renderInline(g, nodes){
  const index = new Map(nodes.map(n=>[n.id, n]))
  const devs = nodes.filter(n => n && (n.type==='POINT_MESURE' || n.type==='VANNE') && n.pm_collector_id)
  const data = devs.map(d => ({ id: d.id, type: d.type, from: index.get(d.pm_collector_id), to: d }))
    .filter(x => x.from && x.to)

  const sel = g.selectAll('path.inline').data(data, d => d.id)
  sel.enter().append('path')
    .attr('class', d => `inline ${d.type==='VANNE'?'valve-connector':'pm-connector'}`)
    .merge(sel)
    .attr('stroke', 'var(--edge-color)')
    .attr('d', d => {
      const a = d.from, b = d.to
      const ax = (a.x||0) + NODE_SIZE.w
      const ay = (a.y||0) + NODE_SIZE.h/2
      const bx = (b.x||0)
      const by = (b.y||0) + NODE_SIZE.h/2
      const dx = Math.max(20, (bx - ax)/2)
      const c1x = ax + dx, c1y = ay
      const c2x = bx - dx, c2y = by
      return `M${ax},${ay} C${c1x},${c1y} ${c2x},${c2y} ${bx},${by}`
    })
  sel.exit().remove()
}
