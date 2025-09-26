import { d3 } from '../vendor.ts'
import { state, getBranchName } from '../state/index.ts'
import { isCanal } from '../utils.ts'
import { ensurePipeStyle } from '../style/pipes.ts'
import type { StyleMetaOverrides } from '../style/pipes.ts'
import { NODE_WIDTH, NODE_HEIGHT, NODE_MARKER_RADIUS, NODE_BUBBLE_GAP, NODE_SIZE } from '../constants/nodes.ts'
import { getNodeCanvasPosition } from '../view/view-mode.ts'
import { colorPairForBranchId } from '../shared/branch-colors.ts'
import type { MutableNode } from '../state/normalize.ts'
import type { Selection, BaseType } from 'd3-selection'

const BUBBLE_GAP = NODE_BUBBLE_GAP // gap between marker and info bubble

type NodeGroupSelection = Selection<BaseType, unknown, BaseType, unknown>
type NodeSelection = Selection<BaseType, MutableNode, BaseType, MutableNode>

export function renderNodes(gNodes: NodeGroupSelection, nodes: MutableNode[]): void {
  const seen = new Set<string>()
  const unique: MutableNode[] = []
  for (const node of nodes) {
    if (node && node.id && !seen.has(node.id)) {
      seen.add(node.id)
      unique.push(node)
    }
  }

  const sel: NodeSelection = gNodes.selectAll<BaseType, MutableNode>('g.node').data(unique, (node) => node.id)

  const cls = (value: unknown): string => String(value ?? '').toUpperCase()

  const computeTransform = (node: MutableNode): string => {
    const position = getNodeCanvasPosition(node)
    const isJunction = cls(node.type) === 'JONCTION'
    const tx = (position.x || 0) - (isJunction ? NODE_WIDTH / 2 : 0)
    const ty = (position.y || 0) - (isJunction ? NODE_HEIGHT / 2 : 0)
    return `translate(${tx},${ty})`
  }

  const enter = sel.enter()
    .append('g')
    .attr('class', (node: MutableNode) => `node ${cls(node.type)}`)
    .attr('transform', computeTransform)

  enter.append('circle')
    .attr('class', 'marker-dot')
    .attr('cx', NODE_WIDTH / 2)
    .attr('cy', NODE_HEIGHT / 2)
    .attr('r', NODE_MARKER_RADIUS)
    .attr('fill', '#fff')
    .attr('stroke', '#111827')
    .attr('stroke-width', 1.5)

  enter.append('rect')
    .attr('class', 'box')
    .attr('x', (NODE_WIDTH / 2) + NODE_MARKER_RADIUS + BUBBLE_GAP)
    .attr('y', 0)
    .attr('width', NODE_WIDTH)
    .attr('height', NODE_HEIGHT)
    .attr('rx', 14)
    .attr('ry', 14)

  enter.append('rect')
    .attr('class', 'hit')
    .attr('x', -10)
    .attr('y', -10)
    .attr('width', (NODE_WIDTH / 2) + NODE_MARKER_RADIUS + BUBBLE_GAP + NODE_WIDTH + 20)
    .attr('height', NODE_HEIGHT + 20)
    .style('fill', 'transparent')

  enter.append('text').attr('class', 'label')
    .attr('x', (NODE_WIDTH / 2) + NODE_MARKER_RADIUS + BUBBLE_GAP + 8)
    .attr('y', 18)
    .text((node: MutableNode) => node.name || node.id)

  enter.append('text').attr('class', 'sublabel pos')
    .attr('x', (NODE_WIDTH / 2) + NODE_MARKER_RADIUS + BUBBLE_GAP + 8)
    .attr('y', 46)
    .text((node: MutableNode) => formatSublabel(node))

  enter.append('text').attr('class', 'badge missing-site')
    .attr('x', (NODE_WIDTH / 2) + NODE_MARKER_RADIUS + BUBBLE_GAP + 8)
    .attr('y', 64)
    .text('donnée manquante')
    .style('display', 'none')

  const merged = sel.merge(enter)

  merged
    .attr('class', (node: MutableNode) => {
      const selected = state.selection.nodeId === node.id || state.selection.multi?.has(node.id)
      return `node ${cls(node.type)} ${selected ? 'selected' : ''}`
    })
    .attr('data-site-effective', (node: MutableNode) => node.site_effective || '')
    .attr('data-site-fallback', (node: MutableNode) => node.site_effective_is_fallback ? '1' : '0')
    .attr('transform', computeTransform)

  merged.select<SVGTextElement>('text.label')
    .attr('x', (NODE_WIDTH / 2) + NODE_MARKER_RADIUS + BUBBLE_GAP + 8)
    .text((node: MutableNode) => node.name || node.id)

  merged.select<SVGRectElement>('rect.box')
    .attr('rx', 14)
    .attr('ry', 14)

  merged.each(function (this: SVGGElement, node: MutableNode) {
    const isJunction = cls(node.type) === 'JONCTION'
    const group = d3.select(this)
    group.select<SVGRectElement>('rect.box').style('display', isJunction ? 'none' : '')
    group.select<SVGTextElement>('text.label').style('display', isJunction ? 'none' : '')
    group.select<SVGTextElement>('text.sublabel').style('display', isJunction ? 'none' : '')
    const dot = group.select<SVGCircleElement>('circle.marker-dot')
    dot.attr('cx', NODE_WIDTH / 2).attr('cy', NODE_HEIGHT / 2).attr('r', NODE_MARKER_RADIUS).style('display', '')
  })

  const theme = document.body?.dataset?.theme || 'dark'
  const styleMeta = (state.graphMeta?.style_meta || {}) as StyleMetaOverrides
  const pipeStyle = ensurePipeStyle({ nodes: state.nodes, edges: state.edges, theme, options: { styleMeta } })

  merged.each(function (this: SVGGElement, node: MutableNode) {
    const colors = colorPairForBranchId(node.branch_id, theme)
    const box = this.querySelector('rect.box') as SVGRectElement | null
    const dot = this.querySelector('circle.marker-dot') as SVGCircleElement | null
    if (box) {
      if (colors.fill) box.setAttribute('fill', colors.fill)
      if (colors.stroke) box.setAttribute('stroke', colors.stroke)
    }
    if (dot) {
      if (colors.stroke) dot.setAttribute('stroke', colors.stroke)
      if (colors.fill) dot.setAttribute('fill', colors.fill)
    }
    if (isCanal(node) && !colors.stroke) {
      const fallback = pipeStyle.borderColorForCanal(node)
      if (fallback && box) box.setAttribute('stroke', fallback)
    }
  })

  merged.select<SVGTextElement>('text.sublabel.pos')
    .attr('x', (NODE_WIDTH / 2) + NODE_MARKER_RADIUS + BUBBLE_GAP + 8)
    .text((node: MutableNode) => formatSublabel(node))

  merged.select<SVGTextElement>('text.badge.missing-site')
    .style('display', (node: MutableNode) => node.site_effective_is_fallback ? null : 'none')

  sel.exit().remove()
}

export { NODE_SIZE }

function formatSublabel(nd: MutableNode): string {
  const T = (nd.type||'').toUpperCase()
  if(T==='OUVRAGE'){
    const canal = state.nodes.find(n=>n.id===nd.well_collector_id)
    const posValue = Number(nd.well_pos_index)
    const pos = Number.isFinite(posValue) ? posValue : 0
    if(canal && pos>0) return `${canal.name||canal.id} · #${pos}`
    if(pos>0) return `#${pos}`
    // Edges-only fallback: consider the pipeline edge/group instead of canal nodes
    const inc = state.edges.filter(e => (e.from_id??e.source)===nd.id || (e.to_id??e.target)===nd.id)
    if(inc.length){
      const branchCandidates = [nd.branch_id, ...inc.map(e => e.branch_id)]
        .map(v => {
          const text = v == null ? '' : String(v).trim()
          return text
        })
        .filter(Boolean)
      const branchId = branchCandidates.length ? branchCandidates[0] : inc[0].id
      const branchLabel = getBranchName(branchId)
      if(branchLabel){
        return `branche ${branchLabel}`
      }
      const short = (value: unknown): string => {
        try {
          const str = String(value ?? '')
          return str.length > 14 ? `${str.slice(0, 8)}…${str.slice(-4)}` : str
        } catch {
          return String(branchId ?? '')
        }
      }
      return `branche ${short(branchId)}`
    }
    return '— non assigné —'
  }
  if(T==='POINT_MESURE' || T==='VANNE'){
    // Prefer assignment by canal node
    if(nd.pm_collector_id){
      const canal = state.nodes.find(n=>n.id===nd.pm_collector_id)
      const wells = canal && Array.isArray(canal.collector_well_ids) ? canal.collector_well_ids : []
      const N = wells.length
      const posVal = Number(nd.pm_pos_index)
      const k = Number.isFinite(posVal) ? posVal : 0
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
    const siblings = parent
      ? state.edges
        .filter(e=> (e.from_id??e.source)===parent.id && isCanal(state.nodes.find(n=>n.id===(e.to_id??e.target))))
        .map(e=> (e.to_id??e.target))
      : []
    const idx = siblings.indexOf(nd.id)
    const total = siblings.length
    return `↳ ${parent?.name||'—'} · #${idx+1}/${total}`
  }
  if(T==='GENERAL'){
    return 'Général'
  }
  return ''
}
