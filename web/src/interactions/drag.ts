import { d3 } from '../vendor.ts'
import { moveNode, getMode, state, updateNode } from '../state/index.ts'
import { unprojectUIToLatLon } from '../geo.ts'
import { NODE_SIZE } from '../constants/nodes.ts'
import type { Selection, BaseType } from 'd3-selection'
import type { D3DragEvent } from 'd3-drag'
import type { MutableNode } from '../state/normalize.ts'

type DragDatum = MutableNode
type DragSelection = Selection<SVGGElement, unknown, BaseType, unknown>
type DragEndListener = (node: DragDatum) => void

export function attachNodeDrag(gNodes: DragSelection, onEnd?: DragEndListener): void {
  // Only when in 'select' mode to avoid blocking clicks in 'connect' mode
  if(getMode() !== 'select'){
    gNodes.selectAll('g.node').on('.drag', null)
    return
  }
  let overrideLock = false
  let overrideIds: string[] = []
  const drag = d3.drag<SVGGElement, DragDatum>()
    .clickDistance(8)
    .on('start', function(event: D3DragEvent<SVGGElement, DragDatum, unknown>): void {
      try{ event.sourceEvent?.preventDefault(); event.sourceEvent?.stopPropagation() }catch{}
      d3.select(this).classed('dragging', true)
      // Ctrl maintenu: autoriser le déplacement même si gps_locked
      overrideLock = !!(event.sourceEvent && event.sourceEvent.ctrlKey)
      if(overrideLock){
        const datum = d3.select(this).datum() as DragDatum
        const ids = (state.selection.multi && state.selection.multi.size>1 && state.selection.multi.has(datum.id))
          ? Array.from(state.selection.multi)
          : [datum.id]
        overrideIds = ids.filter((id: string) => {
          const n = state.nodes.find(n=>n.id===id)
          return !!(n && n.gps_locked)
        })
      } else {
        overrideIds = []
      }
    })
    .on('drag', function(event: D3DragEvent<SVGGElement, DragDatum, unknown>, datum: DragDatum): void {
      try{ event.sourceEvent?.preventDefault(); event.sourceEvent?.stopPropagation() }catch{}
      const ids = (state.selection.multi && state.selection.multi.size>1 && state.selection.multi.has(datum.id))
        ? Array.from(state.selection.multi)
        : [datum.id]
      // Skip GPS-locked nodes, sauf si override (Ctrl enfoncé au démarrage)
      const movable = overrideLock ? ids : ids.filter((id: string) => {
        const n = state.nodes.find(n=>n.id===id)
        if(!n) return false
        if(String(n.type||'').toUpperCase()==='JONCTION') return false
        return !(n.gps_locked)
      })
      // Déplacement fluide: pas de snap pendant le drag (meilleure sensation).
      movable.forEach(id => moveNode(id, event.dx, event.dy, { snap: false }))
    })
    .on('end', function(event: D3DragEvent<SVGGElement, DragDatum, unknown>, datum: DragDatum): void {
      try{ event.sourceEvent?.stopPropagation() }catch{}
      d3.select(this).classed('dragging', false)
      // À la fin du drag, on snappe les positions au grid pour tous les nœuds déplacés
      const ids = (state.selection.multi && state.selection.multi.size>1 && state.selection.multi.has(datum.id))
        ? Array.from(state.selection.multi)
        : [datum.id]
      const movable = overrideLock ? ids : ids.filter((id: string) => {
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
          const type = String(n.type || '').toUpperCase()
          const x = Number(n.x ?? 0)
          const y = Number(n.y ?? 0)
          const cx = x + (type === 'JONCTION' ? 0 : NODE_SIZE.w/2)
          const cy = y + (type === 'JONCTION' ? 0 : NODE_SIZE.h/2)
          try{
            const ll = unprojectUIToLatLon(cx, cy)
            if(Number.isFinite(ll?.lat) && Number.isFinite(ll?.lon)){
              updateNode(id, { gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true })
            }
          }catch{}
        })
      }
      overrideLock = false; overrideIds = []
      if(typeof onEnd==='function') onEnd(datum)
    })

  gNodes.selectAll('g.node').call(drag)
}
