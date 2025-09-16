import { d3 } from '../vendor.js'
import { state } from '../state/index.js'
import { displayXYForNode } from '../geo.js'
import { isCanal, vn } from '../utils.js'
import { ensurePipeStyle } from '../style/pipes.js'

const NODE_W = 120, NODE_H = 48
const MARKER_R = 6
const BUBBLE_GAP = 8 // gap between marker and info bubble

export function renderNodes(gNodes, nodes){
  // Deduplicate by id defensively to avoid display ghosts if state has duplicates
  const seen = new Set()
  const unique = []
  for(const n of nodes){ if(n && n.id && !seen.has(n.id)){ seen.add(n.id); unique.push(n) } }
  const sel = gNodes.selectAll('g.node').data(unique, d => d.id)

  const cls = (t) => String(t||'').toUpperCase()
  const enter = sel.enter().append('g').attr('class', d => `node ${cls(d.type)}`)
    .attr('transform', d => { const p = displayXYForNode(d); return `translate(${p.x},${p.y})` })

  // Visuals
  // Marker centered on the node position (future: replace with icon)
  enter.append('circle')
    .attr('class','marker-dot')
    .attr('cx', NODE_W/2)
    .attr('cy', NODE_H/2)
    .attr('r', MARKER_R)

  // Info bubble positioned to the right of the marker
  enter.append('rect')
    .attr('class','box')
    .attr('x', (NODE_W/2) + MARKER_R + BUBBLE_GAP)
    .attr('y', 0)
    .attr('width', NODE_W)
    .attr('height', NODE_H)

  // Generous hit target covering marker + bubble
  enter.append('rect')
    .attr('class','hit')
    .attr('x', -10)
    .attr('y', -10)
    .attr('width', (NODE_W/2) + MARKER_R + BUBBLE_GAP + NODE_W + 20)
    .attr('height', NODE_H+20)
    .style('fill','transparent')

  // Labels inside the bubble
  enter.append('text').attr('class','label')
    .attr('x', (NODE_W/2) + MARKER_R + BUBBLE_GAP + 8)
    .attr('y', 18)
    .text(d => d.name||d.id)
  // No explicit type line (kept for quieter UI)
  // enter.append('text').attr('class','sublabel').attr('x', 8).attr('y', 34).text(d => (d.type||'').toUpperCase())
  enter.append('text').attr('class','sublabel pos')
    .attr('x', (NODE_W/2) + MARKER_R + BUBBLE_GAP + 8)
    .attr('y', 46)
    .text(d => formatSublabel(d))

  sel.merge(enter)
    .attr('class', d => {
      const isSel = state.selection.nodeId===d.id || (state.selection.multi && state.selection.multi.has(d.id))
      return `node ${cls(d.type)} ${isSel?'selected':''}`
    })
    .attr('transform', d => {
      const p = displayXYForNode(d)
      const T = String(d.type||'').toUpperCase()
      // Junction: interpret (x,y) as the visual point (center); otherwise (x,y) is top-left of the box
      return (T==='JONCTION') ? `translate(${p.x},${p.y})` : `translate(${p.x},${p.y})`
    })
    .select('text.label')
      .attr('x', (NODE_W/2) + MARKER_R + BUBBLE_GAP + 8)
      .text(d => d.name||d.id)
  // Toggle visuals for junctions
  sel.merge(enter).each(function(d){
    const isJ = (String(d.type||'').toUpperCase()==='JONCTION')
    const g = d3.select(this)
    // Show bubble and labels for all but junctions
    g.select('rect.box').style('display', isJ? 'none':'')
    g.select('text.label').style('display', isJ? 'none':'')
    g.select('text.sublabel').style('display', isJ? 'none':'')
    // Marker is always visible
    const dot = g.select('circle.marker-dot')
    dot.attr('cx', NODE_W/2).attr('cy', NODE_H/2).attr('r', MARKER_R).style('display','')
  })
  // Apply dynamic border color for CANALISATION nodes
  sel.merge(enter)
    .each(function(d){
      if(!isCanal(d)) return
      const style = ensurePipeStyle({ nodes: state.nodes, edges: state.edges, theme: document.body?.dataset?.theme || 'dark' })
      const stroke = style.borderColorForCanal(d)
      if(stroke) this.querySelector('rect.box')?.setAttribute('stroke', stroke)
    })
  sel.merge(enter)
    .select('text.sublabel.pos')
      .attr('x', (NODE_W/2) + MARKER_R + BUBBLE_GAP + 8)
      .text(d => formatSublabel(d))
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
    // Edges-only fallback: consider the pipeline edge/group instead of canal nodes
    const inc = state.edges.filter(e => (e.from_id??e.source)===nd.id || (e.to_id??e.target)===nd.id)
    if(inc.length){
      const withGroup = inc.find(e => e.pipe_group_id)
      const pgid = nd.branch_id || withGroup?.pipe_group_id || inc[0].id
      const short = (s)=>{ try{ s=String(s||''); return s.length>14 ? s.slice(0,8)+'…'+s.slice(-4) : s }catch{ return String(pgid||'') } }
      return `branche ${short(pgid)}`
    }
    return '— non assigné —'
  }
  if(T==='POINT_MESURE' || T==='VANNE'){
    // Prefer assignment by canal node
    if(nd.pm_collector_id){
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
    // Fallback: assignment by edge id (pipes as edges)
    if(nd.pm_collector_edge_id){
      const e = state.edges.find(x=>x.id===nd.pm_collector_edge_id)
      if(e){
        const a = state.nodes.find(n=>n.id===(e.from_id??e.source))
        const b = state.nodes.find(n=>n.id===(e.to_id??e.target))
        const off = (nd.pm_offset_m!=='' && nd.pm_offset_m!=null) ? ` · +${nd.pm_offset_m}m` : ''
        return `${a?.name||a?.id||'A'} → ${b?.name||b?.id||'B'}${off}`
      }
    }
    return '— non assigné —'
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
