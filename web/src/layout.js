import { log } from './ui/logs.js'

export async function autoLayout(nodes, edges){
  // ELK layered layout if available
  if (window.ELK) {
    try{
      const elk = new window.ELK()
      // Filter invalid edges (dangling)
      const nodeIds = new Set(nodes.map(n=>n.id))
      const validEdges = edges.filter(e => nodeIds.has(e.source??e.from_id) && nodeIds.has(e.target??e.to_id))
      const removed = edges.length - validEdges.length
      if(removed>0) log(`ELK: ${removed} arête(s) invalides retirées`, 'warn')
      const g = {
        id: 'root', layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction':'RIGHT' },
        children: nodes.map(n => ({ id: n.id, width: 120, height: 48 })),
        edges: validEdges.map(e => ({ id: e.id || `${e.source??e.from_id}-${e.target??e.to_id}`, sources: [e.source??e.from_id], targets: [e.target??e.to_id] })),
      }
      const out = await elk.layout(g)
      const pos = new Map(out.children.map(c => [c.id, { x: Math.round(c.x||0), y: Math.round(c.y||0) }]))
      nodes.forEach(n => Object.assign(n, pos.get(n.id) || {}))
      log(`ELK: disposé ${nodes.length} nœuds / ${edges.length} arêtes`)
      return { nodes, edges }
    }catch(err){
      log('ELK erreur: ' + (err?.message||err), 'error')
    }
  }
  // Fallback: naive grid
  const cols = Math.ceil(Math.sqrt(nodes.length||1))
  const stepX = 220, stepY = 140
  nodes.forEach((n, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    n.x = 80 + c * stepX
    n.y = 80 + r * stepY
  })
  log(`Fallback layout: ${nodes.length} nœuds`) 
  return { nodes, edges }
}
