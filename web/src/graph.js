import { state } from './state/index.js'
import { genId } from './utils.js'

export function addNode(partial = {}){
  const n = { id: genId('n'), label: '', ...partial }
  state.nodes.push(n)
  return n
}

export function addEdge(source, target, partial = {}){
  const e = { id: genId('e'), source, target, ...partial }
  state.edges.push(e)
  return e
}

