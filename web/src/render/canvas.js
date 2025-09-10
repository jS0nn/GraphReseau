import { d3 } from '../vendor.js'

export function initCanvas(){
  const svg = d3.select('#svg')
  const root = d3.select('#zoomRoot')
  const gInline = root.select('.inline-conns')
  const gEdges = root.select('.edges')
  const gNodes = root.select('.nodes')
  const gOverlay = root.select('.overlay')

  let spacePan = false
  const zoom = d3.zoom()
    .filter((event)=> {
      const isWheel = event.type === 'wheel'
      if(isWheel) return !(event.ctrlKey||event.metaKey)
      // For drag pan: allow when not starting on nodes/edges and not using Ctrl/Cmd (reserved for marquee)
      const isPointerDown = event.type === 'mousedown' || event.type === 'pointerdown' || event.type === 'touchstart'
      if(isPointerDown){
        if(event.ctrlKey||event.metaKey||event.shiftKey) return false
        if(event.button === 2) return false
        const trg = event.target
        // Disallow pan when grabbing nodes/edges; allow on background/overlay
        return !(trg && trg.closest && trg.closest('g.node, g.edge'))
      }
      // Other events: default allow
      return true
    })
    // Allow wider zoom range so zoom-fit can always include all elements
    .scaleExtent([0.02, 5])
    .on('zoom', (e)=> root.attr('transform', e.transform))
  svg.call(zoom)

  function zoomBy(k){ svg.transition().duration(160).call(zoom.scaleBy, k) }
  function zoomReset(){ svg.transition().call(zoom.transform, d3.zoomIdentity) }
  function setSpacePan(on){ spacePan = !!on; svg.style('cursor', on ? 'grab' : null) }

  return { svg, root, gInline, gEdges, gNodes, gOverlay, zoomBy, zoomReset, zoom, setSpacePan }
}
