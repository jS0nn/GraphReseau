export function renderNodes(sel, nodes){
  sel.selectAll('div.node')
    .data(nodes, d => d.id)
    .join(enter => enter.append('div').attr('class', 'node').style('position','absolute')
      .style('transform', d => `translate(${d.x||0}px, ${d.y||0}px)`) )
}

