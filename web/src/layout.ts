import { log } from './ui/logs.ts'
import type { MutableNode, MutableEdge } from './state/normalize.ts'

type ElkNode = { id: string; width?: number; height?: number }
type ElkEdge = { id: string; sources: string[]; targets: string[] }
type ElkGraph = {
  id: string
  layoutOptions: Record<string, string>
  children: ElkNode[]
  edges: ElkEdge[]
}
type ElkResultChild = { id: string; x?: number; y?: number }
type ElkResult = { children: ElkResultChild[] }
type ElkInstance = { layout: (graph: ElkGraph) => Promise<ElkResult> }
type ElkConstructor = new () => ElkInstance

type LayoutResult = { nodes: MutableNode[]; edges: MutableEdge[] }

export async function autoLayout(nodes: MutableNode[], edges: MutableEdge[]): Promise<LayoutResult> {
  const elkCtor = (window as typeof window & { ELK?: ElkConstructor }).ELK
  if(elkCtor){
    try{
      const elk = new elkCtor()
      const nodeIds = new Set(nodes.map(n => n.id))
      const validEdges = edges.filter(edge => {
        const source = edge.source ?? edge.from_id ?? null
        const target = edge.target ?? edge.to_id ?? null
        return !!(source && target && nodeIds.has(source) && nodeIds.has(target))
      })
      const removed = edges.length - validEdges.length
      if(removed > 0){
        log(`ELK: ${removed} arête(s) invalides retirées`, 'warn')
      }
      const graph: ElkGraph = {
        id: 'root',
        layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'RIGHT' },
        children: nodes.map(node => ({ id: node.id, width: 120, height: 48 })),
        edges: validEdges.map(edge => {
          const source = edge.source ?? edge.from_id ?? ''
          const target = edge.target ?? edge.to_id ?? ''
          return {
            id: edge.id || `${source}-${target}`,
            sources: [source],
            targets: [target],
          }
        }),
      }
      const out = await elk.layout(graph)
      const positions = new Map<string, { x: number; y: number }>()
      for(const child of out.children || []){
        const x = Math.round(child.x ?? 0)
        const y = Math.round(child.y ?? 0)
        positions.set(child.id, { x, y })
      }
      nodes.forEach(node => {
        const pos = positions.get(node.id)
        if(pos){
          Object.assign(node, pos)
        }
      })
      log(`ELK: disposé ${nodes.length} nœuds / ${edges.length} arêtes`)
      return { nodes, edges }
    }catch(err){
      log('ELK erreur: ' + (err instanceof Error ? err.message : String(err)), 'error')
    }
  }

  const cols = Math.ceil(Math.sqrt(nodes.length || 1))
  const stepX = 220
  const stepY = 140
  nodes.forEach((node, index) => {
    const c = index % cols
    const r = Math.floor(index / cols)
    node.x = 80 + c * stepX
    node.y = 80 + r * stepY
  })
  log(`Fallback layout: ${nodes.length} nœuds`)
  return { nodes, edges }
}
