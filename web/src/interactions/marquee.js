import { d3 } from '../vendor.js'
import { setMultiSelection, state } from '../state/index.js'
import { vn } from '../utils.js'
import { NODE_SIZE } from '../constants/nodes.js'
import { isMapActive } from '../map.js'
import { displayXYForNode } from '../geo.js'

export function attachMarquee(svg, gOverlay){
  let start = null
  let rect = null
  const root = svg

  function toCanvas(pt){
    // When a Leaflet map is active, displayed coordinates are already in container pixels
    try{ if(isMapActive && isMapActive()) return { x: pt[0], y: pt[1] } }catch{}
    const t = d3.zoomTransform(svg.node())
    return { x: (pt[0]-t.x)/t.k, y: (pt[1]-t.y)/t.k }
  }

  function drawRect(a, b){
    const x = Math.min(a.x, b.x)
    const y = Math.min(a.y, b.y)
    const w = Math.abs(a.x - b.x)
    const h = Math.abs(a.y - b.y)
    if(!rect){ rect = gOverlay.append('rect').attr('class','marquee') }
    rect.attr('x', x).attr('y', y).attr('width', w).attr('height', h)
  }

  function clearRect(){ if(rect){ rect.remove(); rect = null } }

  svg.on('mousedown.marquee', (e) => {
    if(e.button !== 0) return
    if(!(e.ctrlKey || e.metaKey || e.shiftKey)) return // modifier required for marquee
    if(e.target.closest('g.node, g.edge')) return
    start = toCanvas(d3.pointer(e))
    drawRect(start, start)
    e.preventDefault(); e.stopPropagation()
  })

  svg.on('mousemove.marquee', (e) => {
    if(!start) return
    const curr = toCanvas(d3.pointer(e))
    drawRect(start, curr)
  })

  svg.on('mouseup.marquee', (e) => {
    if(!start) return
    const end = toCanvas(d3.pointer(e))
    const x1 = Math.min(start.x, end.x), x2 = Math.max(start.x, end.x)
    const y1 = Math.min(start.y, end.y), y2 = Math.max(start.y, end.y)
    const inside = state.nodes.filter(n => {
      // Use displayed UI coordinates so GPS-anchored nodes are correctly hit-tested
      const p = displayXYForNode(n)
      const T = String(n?.type||'').toUpperCase()
      // Junction nodes render as a small dot around their center; others render as a box from top-left
      const isJ = (T === 'JONCTION')
      const w = isJ ? 10 : NODE_SIZE.w
      const h = isJ ? 10 : NODE_SIZE.h
      const nx1 = vn(isJ ? (p.x - w/2) : p.x, 0)
      const ny1 = vn(isJ ? (p.y - h/2) : p.y, 0)
      const nx2 = nx1 + w, ny2 = ny1 + h
      return nx1>=x1 && ny1>=y1 && nx2<=x2 && ny2<=y2
    }).map(n => n.id)
    // With Ctrl/Cmd we extend selection; otherwise replace (but we only start with Ctrl)
    const current = new Set(state.selection.multi || [])
    inside.forEach(id => current.add(id))
    setMultiSelection(Array.from(current))
    // Prevent the background click handler from clearing the freshly-set selection
    try{ window.__squelchCanvasClick = true }catch{}
    start = null
    clearRect()
    e.preventDefault(); e.stopPropagation()
  })

  svg.on('mouseleave.marquee', () => { start=null; clearRect() })
}
