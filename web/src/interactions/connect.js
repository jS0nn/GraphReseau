import { connectByRules, getMode, subscribe, selectNodeById, state } from '../state.js'

function setStatus(msg){ const el=document.getElementById('status'); if(el) el.textContent = msg||'' }

let sourceId = null

function highlightPotentialTargets(gNodes, on){
  const src = state.nodes.find(n=>n.id===sourceId)
  gNodes.selectAll('g.node').classed('halo', function(d){
    if(!on || !src) return false
    const T = (src.type||'').toUpperCase()
    const DT = (d.type||'').toUpperCase()
    if(T==='PUITS') return DT==='CANALISATION' || DT==='COLLECTEUR'
    if(T==='CANALISATION' || T==='COLLECTEUR') return DT==='PUITS' || DT==='POINT_MESURE' || DT==='VANNE' || DT==='CANALISATION' || DT==='COLLECTEUR'
    if(T==='POINT_MESURE' || T==='VANNE') return DT==='CANALISATION' || DT==='COLLECTEUR'
    return true
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
          setStatus(res.type==='canal' ? 'Branchement canal → canal' : 'Connecté')
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
