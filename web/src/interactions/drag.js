import { d3 } from '../vendor.js'
import { moveNode, getMode, state, updateNode } from '../state/index.js'
import { unprojectUIToLatLon } from '../geo.js'

export function attachNodeDrag(gNodes, onEnd){
  // Only when in 'select' mode to avoid blocking clicks in 'connect' mode
  if(getMode() !== 'select'){
    gNodes.selectAll('g.node').on('.drag', null)
    return
  }
  let overrideLock = false
  let overrideIds = []
  const drag = d3.drag()
    .on('start', function(e){
      try{ e.sourceEvent?.preventDefault(); e.sourceEvent?.stopPropagation() }catch{}
      d3.select(this).classed('dragging', true)
      // Ctrl maintenu: autoriser le déplacement même si gps_locked
      overrideLock = !!(e.sourceEvent && e.sourceEvent.ctrlKey)
      if(overrideLock){
        const d = d3.select(this).datum()
        const ids = (state.selection.multi && state.selection.multi.size>1 && state.selection.multi.has(d.id))
          ? Array.from(state.selection.multi)
          : [d.id]
        overrideIds = ids.filter(id => {
          const n = state.nodes.find(n=>n.id===id)
          return !!(n && n.gps_locked)
        })
      } else {
        overrideIds = []
      }
    })
    .on('drag', function(e, d){ try{ e.sourceEvent?.preventDefault(); e.sourceEvent?.stopPropagation() }catch{}
      const ids = (state.selection.multi && state.selection.multi.size>1 && state.selection.multi.has(d.id))
        ? Array.from(state.selection.multi)
        : [d.id]
      // Skip GPS-locked nodes, sauf si override (Ctrl enfoncé au démarrage)
      const movable = overrideLock ? ids : ids.filter(id => {
        const n = state.nodes.find(n=>n.id===id)
        if(!n) return false
        if(String(n.type||'').toUpperCase()==='JONCTION') return false
        return !(n.gps_locked)
      })
      // Déplacement fluide: pas de snap pendant le drag (meilleure sensation).
      movable.forEach(id => moveNode(id, e.dx, e.dy, { snap: false }))
    })
    .on('end', function(e, d){
      try{ e.sourceEvent?.stopPropagation() }catch{}
      d3.select(this).classed('dragging', false)
      // À la fin du drag, on snappe les positions au grid pour tous les nœuds déplacés
      const ids = (state.selection.multi && state.selection.multi.size>1 && state.selection.multi.has(d.id))
        ? Array.from(state.selection.multi)
        : [d.id]
      const movable = overrideLock ? ids : ids.filter(id => {
        const n = state.nodes.find(n=>n.id===id)
        if(!n) return false
        if(String(n.type||'').toUpperCase()==='JONCTION') return false
        return !(n.gps_locked)
      })
      movable.forEach(id => moveNode(id, 0, 0, { snap: true }))
      // Si override, recalcule le GPS des nœuds gps_locked déplacés et garde le verrouillage actif
      if(overrideLock && overrideIds.length){
        overrideIds.forEach(id => {
          const n = state.nodes.find(nn=>nn.id===id)
          if(!n) return
          const x = +n.x || 0, y = +n.y || 0
          try{
            const ll = unprojectUIToLatLon(x, y)
            if(Number.isFinite(ll?.lat) && Number.isFinite(ll?.lon)){
              updateNode(id, { gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true })
            }
          }catch{}
        })
      }
      overrideLock = false; overrideIds = []
      if(typeof onEnd==='function') onEnd(d)
    })

  gNodes.selectAll('g.node').call(drag)
}
