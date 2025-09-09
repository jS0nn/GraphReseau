import { d3 } from '../vendor.js'
import { moveNode, getMode, state } from '../state.js'

export function attachNodeDrag(gNodes, onEnd){
  // Only when in 'select' mode to avoid blocking clicks in 'connect' mode
  if(getMode() !== 'select'){
    gNodes.selectAll('g.node').on('.drag', null)
    return
  }
  const drag = d3.drag()
    .on('start', function(e){ try{ e.sourceEvent?.preventDefault(); e.sourceEvent?.stopPropagation() }catch{} d3.select(this).classed('dragging', true) })
    .on('drag', function(e, d){ try{ e.sourceEvent?.preventDefault(); e.sourceEvent?.stopPropagation() }catch{}
      const ids = (state.selection.multi && state.selection.multi.size>1 && state.selection.multi.has(d.id))
        ? Array.from(state.selection.multi)
        : [d.id]
      ids.forEach(id => moveNode(id, e.dx, e.dy, { snap: !e.sourceEvent?.altKey }))
    })
    .on('end', function(e, d){ try{ e.sourceEvent?.stopPropagation() }catch{} d3.select(this).classed('dragging', false); if(typeof onEnd==='function') onEnd(d) })

  gNodes.selectAll('g.node').call(drag)
}
