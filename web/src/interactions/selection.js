import { selectNodeById, selectEdgeById, getMode, removeNode, removeEdge, toggleMultiSelection } from '../state/index.js'

export function attachSelection(gNodes, gEdges){
  gNodes.selectAll('g.node')
    .on('click', (e, d) => {
      e.stopPropagation()
      const mode = getMode()
      if(String(d?.type||'').toUpperCase()==='JONCTION') return // ignore pure junctions
      if(mode==='delete'){
        if(confirm(`Supprimer le nœud ${(d.name||d.id)} et ses liens ?`)){
          removeNode(d.id); selectNodeById(null); selectEdgeById(null)
        }
        return
      }
      if(mode==='connect'){ return }
      if(e.shiftKey){ toggleMultiSelection(d.id); return }
      selectNodeById(d.id)
    })
  gEdges.selectAll('g.edge')
    .on('click', (e, d) => {
      e.stopPropagation()
      if(getMode()==='delete'){
        if(confirm('Supprimer cette arête ?')){ removeEdge(d.id); selectEdgeById(null); selectNodeById(null) }
        return
      }
      selectEdgeById(d.id)
    })
}
