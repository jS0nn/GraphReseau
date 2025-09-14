import { connectByRules, getMode, subscribe, selectNodeById, state } from '../state.js'

function setStatus(msg){ const el=document.getElementById('status'); if(el) el.textContent = msg||'' }

let sourceId = null

function highlightPotentialTargets(gNodes, on){
  const src = state.nodes.find(n=>n.id===sourceId)
  gNodes.selectAll('g.node').classed('halo', function(d){
    if(!on || !src) return false
    const T = (src.type||'').toUpperCase()
    const DT = (d.type||'').toUpperCase()
    // New rules (pipes as edges):
    // - Do NOT target canal nodes anymore
    if(DT==='CANALISATION' || DT==='COLLECTEUR') return false
    // - Inline devices cannot be connected via Connecter (use Junction/Draw)
    if(T==='POINT_MESURE' || T==='VANNE') return false
    // - From a regular node (OUVRAGE/GENERAL/JONCTION), allow other regular nodes
    if(T==='OUVRAGE' || T==='GENERAL' || T==='JONCTION'){
      return (DT==='OUVRAGE' || DT==='GENERAL' || DT==='JONCTION') && d.id!==src.id
    }
    return false
  })
}

export function attachConnect(gNodes){
  gNodes.selectAll('g.node')
    .on('click.connect', (e, d) => {
      if(getMode() !== 'connect') return
      e.stopPropagation()
      if(!sourceId){ sourceId = d.id; setStatus('Sélectionne la cible…'); highlightPotentialTargets(gNodes, true) }
      else if (sourceId && sourceId !== d.id){
        const res = connectByRules(sourceId, d.id)
        if(res?.ok){
          if(res.type==='inline' || res.type==='well'){ selectNodeById(res.nodeId) }
          setStatus(res.type==='edge' ? 'Arête créée' : 'Connecté')
        } else {
          setStatus('Connexion non valide')
        }
        sourceId = null; highlightPotentialTargets(gNodes, false)
      }
      else { sourceId = null; setStatus('') }
    })
}

// Reset on mode change
subscribe((evt)=>{ if(evt==='mode:set'){ sourceId = null; setStatus(''); try{ highlightPotentialTargets(d3.select('.nodes'), false) }catch{} } })
