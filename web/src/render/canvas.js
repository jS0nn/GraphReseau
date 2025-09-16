import { d3 } from '../vendor.js'
import { getMap, isMapActive } from '../map.js'

export function initCanvas(){
  const svg = d3.select('#svg')
  const root = d3.select('#zoomRoot')
  const gInline = root.select('.inline-conns')
  const gEdges = root.select('.edges')
  const gNodes = root.select('.nodes')
  const gOverlay = root.select('.overlay')

  let spacePan = false
  const zoomStep = 1.25
  const logZoomStep = Math.log(zoomStep)
  const zoom = d3.zoom()
    .filter((event)=> {
      const isWheel = event.type === 'wheel'
      const isDbl = event.type === 'dblclick'
      const isPointerDown = event.type === 'mousedown' || event.type === 'pointerdown' || event.type === 'touchstart'
      // When a map is active, handle wheel at app level (Leaflet setZoomAround) instead of d3.zoom
      if(isWheel){
        if(isMapActive && isMapActive()) return false
        return !(event.ctrlKey||event.metaKey)
      }
      // Disable double‑click zoom to avoid interfering with draw finish
      if(isDbl) return false
      // For drag pan: allow when not starting on nodes/edges and not using Ctrl/Cmd (reserved for marquee)
      if(isPointerDown && (isMapActive && isMapActive())){
        // Still let d3 capture pointerdown to compute dx/dy, but block when starting on a node/edge
        if(event.ctrlKey||event.metaKey||event.shiftKey) return false
        if(event.button === 2) return false
        const trg = event.target
        return !(trg && trg.closest && trg.closest('g.node, g.edge'))
      }
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
    .wheelDelta((event)=> {
      // Normalise wheel delta so one notch matches the button zoom step
      const mode = event.deltaMode
      const denom = mode === 1 ? 3 : mode === 2 ? 120 : 100
      const notches = -event.deltaY / (denom || 1)
      const clamped = Math.max(-2, Math.min(2, notches))
      return clamped * logZoomStep
    })
    // Allow wider zoom range so zoom-fit can always include all elements
    // Increase max from 5 -> 10 to enable 2x closer zoom
    .scaleExtent([0.02, 10])
    .on('zoom', (e)=> {
      const map = getMap && getMap()
      if(isMapActive && isMapActive() && map){
        // Forward pan/zoom deltas to Leaflet; keep SVG root at identity
        const t = e.transform
        const cur = (root.__lastZoomTransform || d3.zoomIdentity)
        const dx = t.x - cur.x
        const dy = t.y - cur.y
        const ratio = (t.k && cur.k) ? (t.k / cur.k) : 1
        if(Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5){
          try{ map.panBy([ -dx, -dy ], { animate: false }) }catch{}
        }
        if(Math.abs(ratio - 1) > 0.001){
          try{
            const z0 = map.getZoom()
            const z1 = z0 + Math.log2(Math.max(1e-6, ratio))
            map.setZoom(z1, { animate: false })
          }catch{}
        }
        try{ root.attr('transform', null) }catch{}
        root.__lastZoomTransform = t
        // Do not apply the transform on the SVG root when a map is active
        return
      }
      root.attr('transform', e.transform)
    })
  svg.call(zoom)

  // Smooth wheel zoom forwarded to Leaflet, keeping cursor fixed
  try{
    const svgEl = document.getElementById('svg')
    svgEl?.addEventListener('wheel', (e)=>{
      if(!(isMapActive && isMapActive())) return
      const map = getMap && getMap()
      if(!map) return
      e.preventDefault(); e.stopPropagation()
      // Use Leaflet's event helper for exact container point
      let pt
      try{ pt = map.mouseEventToContainerPoint(e) }catch{ pt = null }
      if(!pt){
        const rect = map.getContainer().getBoundingClientRect()
        pt = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      }
      const z0 = map.getZoom()
      const dir = (e.deltaY < 0) ? 1 : -1
      const z1 = z0 + dir
      try{ map.setZoomAround(pt, z1, { animate: false }) }catch{}
    }, { passive: false, capture: true })
  }catch{}

  function zoomBy(k){
    if(isMapActive && isMapActive() && getMap && getMap()){
      try{ const m=getMap(); m.setZoom(m.getZoom() + (k>1 ? 1 : -1), { animate: true }) }catch{}
      return
    }
    svg.transition().duration(160).call(zoom.scaleBy, k)
  }
  function zoomReset(){
    if(isMapActive && isMapActive() && getMap && getMap()){
      try{ const m=getMap(); m.setZoom(0) }catch{}
      return
    }
    svg.transition().call(zoom.transform, d3.zoomIdentity)
  }
  function setSpacePan(on){ spacePan = !!on; svg.style('cursor', on ? 'grab' : null) }

  return { svg, root, gInline, gEdges, gNodes, gOverlay, zoomBy, zoomReset, zoom, setSpacePan, zoomStep }
}
