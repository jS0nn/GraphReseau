export function renderInline(sel, graph){
  sel.textContent = JSON.stringify(graph, null, 2)
}

