import type { Selection, BaseType } from 'd3-selection'
import { d3 } from '../vendor.ts'
import { setMultiSelection, state } from '../state/index.ts'
import { vn } from '../utils.ts'
import { NODE_SIZE } from '../constants/nodes.ts'
import { isMapActive } from '../map.ts'
import { getNodeCanvasPosition, getNodeCenterPosition } from '../view/view-mode.ts'

type SvgSelection = Selection<SVGSVGElement, unknown, BaseType, unknown>
type GroupSelection = Selection<SVGGElement, unknown, BaseType, unknown>
type RectSelection = Selection<SVGRectElement, unknown, BaseType, unknown>

type Point = { x: number; y: number }

export function attachMarquee(svg: SvgSelection, gOverlay: GroupSelection): void {
  let start: Point | null = null
  let rect: RectSelection | null = null

  function toCanvas(pt: [number, number]): Point {
    // When a Leaflet map is active, displayed coordinates are already in container pixels
    try{ if(isMapActive && isMapActive()) return { x: pt[0], y: pt[1] } }catch{}
    const svgEl = svg.node()
    const t = svgEl ? d3.zoomTransform(svgEl) : d3.zoomIdentity
    return { x: (pt[0]-t.x)/t.k, y: (pt[1]-t.y)/t.k }
  }

  function drawRect(a: Point, b: Point): void {
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    const w = Math.abs(a.x - b.x)
    const h = Math.abs(a.y - b.y)
    if(!rect){ rect = gOverlay.append('rect').attr('class','marquee') }
    rect.attr('x', x).attr('y', y).attr('width', w).attr('height', h)
  }

  function clearRect(): void { if(rect){ rect.remove(); rect = null } }

  svg.on('mousedown.marquee', (e: MouseEvent) => {
    if(e.button !== 0) return
    if(!(e.ctrlKey || e.metaKey || e.shiftKey)) return // modifier required for marquee
    if((e.target as Element)?.closest?.('g.node, g.edge')) return
    const pointer = d3.pointer(e, svg.node()) as [number, number]
    start = toCanvas(pointer)
    drawRect(start, start)
    e.preventDefault(); e.stopPropagation()
  })

  svg.on('mousemove.marquee', (e: MouseEvent) => {
    if(!start) return
    const pointer = d3.pointer(e, svg.node()) as [number, number]
    const curr = toCanvas(pointer)
    drawRect(start, curr)
  })

  svg.on('mouseup.marquee', (e: MouseEvent) => {
    if(!start) return
    const pointer = d3.pointer(e, svg.node()) as [number, number]
    const end = toCanvas(pointer)
    const x1 = Math.min(start.x, end.x), x2 = Math.max(start.x, end.x)
    const y1 = Math.min(start.y, end.y), y2 = Math.max(start.y, end.y)
    const insideIds = state.nodes.filter((n) => {
      // Use displayed UI coordinates so GPS-anchored nodes are correctly hit-tested
      const pos = getNodeCanvasPosition(n)
      const T = String(n?.type||'').toUpperCase()
      // Junction nodes render as a small dot around their center; others render as a box from top-left
      const isJ = (T === 'JONCTION')
      const w = isJ ? 10 : NODE_SIZE.w
      const h = isJ ? 10 : NODE_SIZE.h
      let nx1, ny1
      if(isJ){
        const center = getNodeCenterPosition(n)
        nx1 = vn(center.x - w/2, 0)
        ny1 = vn(center.y - h/2, 0)
      }else{
        nx1 = vn(pos.x, 0)
        ny1 = vn(pos.y, 0)
      }
      const nx2 = nx1 + w, ny2 = ny1 + h
      return nx1>=x1 && ny1>=y1 && nx2<=x2 && ny2<=y2
    }).map((n) => n.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
    // With Ctrl/Cmd we extend selection; otherwise replace (but we only start with Ctrl)
    const current = new Set(state.selection.multi || [])
    insideIds.forEach(id => current.add(id))
    setMultiSelection(Array.from(current))
    // Prevent the background click handler from clearing the freshly-set selection
    if(typeof window !== 'undefined'){
      window.__squelchCanvasClick = true
    }
    start = null
    clearRect()
    e.preventDefault(); e.stopPropagation()
  })

  svg.on('mouseleave.marquee', () => { start=null; clearRect() })
}
