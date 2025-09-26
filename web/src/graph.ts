import { state } from './state/index.ts'
import { genId } from './utils.ts'
import type { MutableNode, MutableEdge } from './state/normalize.ts'

type PartialNode = Partial<MutableNode>

type PartialEdge = Partial<MutableEdge>

export function addNode(partial: PartialNode = {}): MutableNode {
  const node: MutableNode = { id: genId('n'), label: '', ...partial } as MutableNode
  state.nodes.push(node)
  return node
}

export function addEdge(source: string, target: string, partial: PartialEdge = {}): MutableEdge {
  const edge: MutableEdge = { id: genId('e'), source, target, ...partial } as MutableEdge
  state.edges.push(edge)
  return edge
}
