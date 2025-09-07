export const state = {
  nodes: [],
  edges: [],
}

export function setGraph(graph){
  state.nodes = graph.nodes || []
  state.edges = graph.edges || []
}

