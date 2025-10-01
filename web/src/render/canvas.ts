import type { Selection, BaseType } from 'd3-selection'
import type { ZoomBehavior } from 'd3-zoom'
import { d3 } from '../vendor.ts'
import { getMap, isMapActive } from '../map.ts'
import { point as leafletPoint } from 'leaflet'
import type { Point as LeafletPoint } from 'leaflet'

type SvgSelection = Selection<SVGSVGElement, unknown, BaseType, unknown>
type GroupSelection = Selection<SVGGElement, unknown, BaseType, unknown>

type CanvasHandles = {
  svg: SvgSelection
  root: GroupSelection
  gInline: GroupSelection
  gEdges: GroupSelection
  gNodes: GroupSelection
  gOverlay: GroupSelection
  zoomBy: (factor: number) => void
  zoomReset: () => void
  zoom: ZoomBehavior<SVGSVGElement, unknown>
  setSpacePan: (on: boolean) => void
  zoomStep: number
}

export function initCanvas(): CanvasHandles {
  const svg = d3.select<SVGSVGElement, unknown>('#svg')
  const root = d3.select<SVGGElement, unknown>('#zoomRoot')
  const gInline = root.select<SVGGElement>('.inline-conns')
  const gEdges = root.select<SVGGElement>('.edges')
  const gNodes = root.select<SVGGElement>('.nodes')
  const gOverlay = root.select<SVGGElement>('.overlay')

const DEV_BUILD = typeof __DEV__ !== 'undefined' && __DEV__ === true

const debugCanvas = DEV_BUILD
  ? (...args: unknown[]): void => {
      try{
        if(typeof console === 'undefined') return
        console.debug('[plan:canvas]', ...args)
      }catch{}
    }
  : () => {}

let spacePan = false
const zoomStep = 1.25
const logZoomStep = Math.log(zoomStep)
let lastZoomTransform = d3.zoomIdentity
const PAN_GUARD_THRESHOLD_PX = 6
let panGuardActive = false
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .clickDistance(6)
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
      if(isPointerDown){
        if(event.ctrlKey||event.metaKey||event.shiftKey) return false
        if(event.button === 2) return false
        return true
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
    .on('start', (e) => {
      const source = e.sourceEvent as Event | undefined
      const target = (source && 'target' in source) ? (source as { target?: EventTarget }).target : undefined
      const element = target instanceof Element ? target : null
      debugCanvas('zoom start', { target: element?.tagName, classList: element ? Array.from(element.classList) : null })
      if(element && element.closest('g.node, g.edge')){
        panGuardActive = true
      }else{
        panGuardActive = false
      }
    })
    .on('zoom', (e)=> {
      if(panGuardActive){
        const dxGuard = e.transform.x - lastZoomTransform.x
        const dyGuard = e.transform.y - lastZoomTransform.y
        if(Math.hypot(dxGuard, dyGuard) < PAN_GUARD_THRESHOLD_PX){
          return
        }
        panGuardActive = false
      }
      debugCanvas('zoom step', { dx: e.transform.x - lastZoomTransform.x, dy: e.transform.y - lastZoomTransform.y, k: e.transform.k })
      const map = getMap && getMap()
      if(isMapActive && isMapActive() && map){
        // Forward pan/zoom deltas to Leaflet; keep SVG root at identity
        const t = e.transform
        const cur = lastZoomTransform
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
        lastZoomTransform = t
        // Do not apply the transform on the SVG root when a map is active
        return
      }
      root.attr('transform', e.transform)
      lastZoomTransform = e.transform
    })
    .on('end', () => {
      debugCanvas('zoom end')
      panGuardActive = false
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
      let pt: LeafletPoint | null = null
      try{ pt = map.mouseEventToContainerPoint(e) }catch{}
      if(!pt){
        const rect = map.getContainer().getBoundingClientRect()
        pt = leafletPoint(e.clientX - rect.left, e.clientY - rect.top)
      }
      const z0 = map.getZoom()
      const dir = (e.deltaY < 0) ? 1 : -1
      const z1 = z0 + dir
      try{ map.setZoomAround(pt, z1, { animate: false }) }catch{}
    }, { passive: false, capture: true })
  }catch{}

  function zoomBy(k: number){
    if(isMapActive && isMapActive() && typeof getMap === 'function'){
      const map = getMap()
      if(map){
        try{ map.setZoom(map.getZoom() + (k > 1 ? 1 : -1), { animate: true }) }catch{}
        return
      }
    }
    const transition = svg.transition().duration(160)
    zoom.scaleBy(transition, k)
  }
  function zoomReset(){
    if(isMapActive && isMapActive() && typeof getMap === 'function'){
      const map = getMap()
      if(map){
        try{ map.setZoom(0) }catch{}
        return
      }
    }
    const transition = svg.transition()
    zoom.transform(transition, d3.zoomIdentity)
  }
  function setSpacePan(on: boolean){
    spacePan = !!on
    if(spacePan){
      svg.style('cursor', 'grab')
    }else{
      svg.style('cursor', null)
    }
  }

  return { svg, root, gInline, gEdges, gNodes, gOverlay, zoomBy, zoomReset, zoom, setSpacePan, zoomStep }
}
