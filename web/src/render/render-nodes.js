import { d3 } from '../vendor.js'
import { state } from '../state.js'
import { isCanal, vn } from '../utils.js'

const NODE_W = 120, NODE_H = 48

export function renderNodes(gNodes, nodes){
  // Deduplicate by id defensively to avoid display ghosts if state has duplicates
  const seen = new Set()
  const unique = []
  for(const n of nodes){ if(n && n.id && !seen.has(n.id)){ seen.add(n.id); unique.push(n) } }
  const sel = gNodes.selectAll('g.node').data(unique, d => d.id)

  const cls = (t) => String(t||'').toUpperCase()
  const enter = sel.enter().append('g').attr('class', d => `node ${cls(d.type)}`)
    .attr('transform', d => `translate(${d.x||0},${d.y||0})`)

  // Visual box
  enter.append('rect').attr('class','box').attr('width', NODE_W).attr('height', NODE_H)
  enter.append('rect').attr('class','hit').attr('width', NODE_W+20).attr('height', NODE_H+20).attr('x', -10).attr('y', -10).style('fill','transparent')
  enter.append('text').attr('class','label').attr('x', 8).attr('y', 18).text(d => d.name||d.id)
  // No explicit type line (kept for quieter UI)
  // enter.append('text').attr('class','sublabel').attr('x', 8).attr('y', 34).text(d => (d.type||'').toUpperCase())
  enter.append('text').attr('class','sublabel pos').attr('x', 8).attr('y', 46).text(d => formatSublabel(d))

  sel.merge(enter)
    .attr('class', d => {
      const isSel = state.selection.nodeId===d.id || (state.selection.multi && state.selection.multi.has(d.id))
      return `node ${cls(d.type)} ${isSel?'selected':''}`
    })
    .attr('transform', d => `translate(${d.x||0},${d.y||0})`)
    .select('text.label').text(d => d.name||d.id)
  sel.merge(enter)
    .select('text.sublabel.pos').text(d => formatSublabel(d))
  sel.exit().remove()
}

export const NODE_SIZE = { w: NODE_W, h: NODE_H }

function formatSublabel(nd){
  const T = (nd.type||'').toUpperCase()
  if(T==='OUVRAGE'){
    const canal = state.nodes.find(n=>n.id===nd.well_collector_id)
    const pos = +nd.well_pos_index || 0
    if(canal && pos>0) return `${canal.name||canal.id} · #${pos}`
    if(pos>0) return `#${pos}`
    return '— non assigné —'
  }
  if(T==='POINT_MESURE' || T==='VANNE'){
    if(!nd.pm_collector_id) return '— non assigné —'
    const canal = state.nodes.find(n=>n.id===nd.pm_collector_id)
    const N = (canal?.collector_well_ids?.length)||0
    const k = +nd.pm_pos_index||0
    let posTxt=''
    if(N===0) posTxt='—'
    else if(k<=0) posTxt='avant #1'
    else if(k>=N) posTxt=`après #${N}`
    else posTxt=`entre #${k}–#${k+1}`
    const off = (nd.pm_offset_m!=='' && nd.pm_offset_m!=null) ? ` · +${nd.pm_offset_m}m` : ''
    return `${canal?.name||'—'} · ${posTxt}${off}`
  }
  if(isCanal(nd)){
    const parentEdge = state.edges.find(e=> (e.to_id??e.target)===nd.id && isCanal(state.nodes.find(n=>n.id===(e.from_id??e.source))))
    if(!parentEdge) return 'racine'
    const parent = state.nodes.find(n=>n.id===(parentEdge.from_id??parentEdge.source))
    const siblings = state.edges.filter(e=> (e.from_id??e.source)===parent.id && isCanal(state.nodes.find(n=>n.id===(e.to_id??e.target)))).map(e=> (e.to_id??e.target))
    const idx = siblings.indexOf(nd.id)
    const total = siblings.length
    return `↳ ${parent?.name||'—'} · #${idx+1}/${total}`
  }
  if(T==='GENERAL'){
    return 'Général'
  }
  return ''
}
