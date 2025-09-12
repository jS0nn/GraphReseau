import { state, addNode, addEdge, updateEdge, getMode, subscribe } from '../state.js'
import { displayXYForNode, unprojectUIToLatLon } from '../geo.js'
import { getMap, isMapActive } from '../map.js'

const SNAP_TOL = 16 // px

let drawing = null // { pointsUI: [ [x,y],... ], previewPath: SVGPathElement, snappedStartId, snappedEndId }

function getUIFromEvent(evt){
  try{
    if(window.__leaflet_map){
      const map = window.__leaflet_map
      const pt = map.mouseEventToContainerPoint(evt)
      return [pt.x, pt.y]
    }
  }catch{}
  const svg = document.getElementById('svg')
  const r = svg.getBoundingClientRect()
  return [evt.clientX - r.left, evt.clientY - r.top]
}

function getLatLonFromEvent(evt){
  if(isMapActive && isMapActive() && getMap){
    const m = getMap()
    if(m){
      const mapEl = document.getElementById('map')
      const r = mapEl.getBoundingClientRect()
      const pt = m.containerPointToLatLng([evt.clientX - r.left, evt.clientY - r.top])
      return [pt.lng, pt.lat]
    }
  }
  const [ux, uy] = getUIFromEvent(evt)
  const ll = unprojectUIToLatLon(ux, uy)
  return [ll.lon, ll.lat]
}

function nearestNodeUI([x,y], tolPx = SNAP_TOL){
  let best = null
  for(const n of state.nodes){
    const p = displayXYForNode(n)
    const dx = p.x - x
    const dy = p.y - y
    const d2 = dx*dx + dy*dy
    if(d2 <= tolPx*tolPx){
      if(!best || d2 < best.d2) best = { id: n.id, x: p.x, y: p.y, d2, node: n }
    }
  }
  return best
}

function updatePreview(){
  if(!drawing) return
  const d = drawing.pointsUI
  let path = ''
  for(let i=0;i<d.length;i++){
    const p = d[i]
    path += (i===0? 'M':' L') + p[0] + ',' + p[1]
  }
  if(drawing.previewPath) drawing.previewPath.setAttribute('d', path)
}

function startDrawing(gOverlay){
  if(drawing) return
  const p = document.createElementNS('http://www.w3.org/2000/svg','path')
  p.setAttribute('class','draw-preview')
  p.setAttribute('fill','none')
  p.setAttribute('stroke','var(--accent)')
  p.setAttribute('stroke-width','2')
  gOverlay.node().appendChild(p)
  drawing = { pointsUI: [], previewPath: p, snappedStartId: null, snappedEndId: null }
}

function stopDrawing(){
  if(!drawing) return
  try{ drawing.previewPath?.remove() }catch{}
  drawing = null
}

function finishDrawing(){
  if(!drawing) return
  const pts = drawing.pointsUI
  if(pts.length < 2){ stopDrawing(); return }
  // Compute lat/lon geometry from stored UI points
  const geometry = pts.map(([x,y])=>{
    const ll = unprojectUIToLatLon(x, y)
    return [ll.lon, ll.lat]
  })
  // Endpoints
  const startUI = pts[0]
  const endUI = pts[pts.length-1]
  const startSnap = nearestNodeUI(startUI)
  const endSnap = nearestNodeUI(endUI)
  let aId = startSnap?.id
  let bId = endSnap?.id
  // Create endpoints if needed (OUVRAGE) and lock to GPS if available
  if(!aId){
    const ll = unprojectUIToLatLon(startUI[0], startUI[1])
    const na = addNode({ type:'OUVRAGE', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true })
    aId = na.id
  }
  if(!bId){
    const ll = unprojectUIToLatLon(endUI[0], endUI[1])
    const nb = addNode({ type:'OUVRAGE', gps_lat: ll.lat, gps_lon: ll.lon, gps_locked: true })
    bId = nb.id
  }
  const e = addEdge(aId, bId, { active: true })
  updateEdge(e.id, { geometry })
  stopDrawing()
}

export function attachDraw(svgSel, gOverlay){
  // React to mode changes: clear preview when leaving draw mode
  subscribe((evt)=>{ if(evt==='mode:set' && getMode()!=='draw') stopDrawing() })

  function onClick(evt){
    if(getMode()!=='draw') return
    if(!drawing) startDrawing(gOverlay)
    const ui = getUIFromEvent(evt)
    const snap = nearestNodeUI(ui)
    const p = snap ? [snap.x, snap.y] : ui
    drawing.pointsUI.push(p)
    updatePreview()
  }

  function onMove(evt){
    if(getMode()!=='draw' || !drawing) return
    const ui = getUIFromEvent(evt)
    const snap = nearestNodeUI(ui)
    const p = snap ? [snap.x, snap.y] : ui
    // Update the last phantom point for live preview
    if(!drawing._hasPhantom){ drawing.pointsUI.push(p); drawing._hasPhantom = true }
    else drawing.pointsUI[drawing.pointsUI.length-1] = p
    updatePreview()
  }

  function onDblClick(evt){
    if(getMode()!=='draw') return
    if(!drawing) return
    if(drawing._hasPhantom){ drawing.pointsUI.pop(); drawing._hasPhantom=false }
    finishDrawing()
  }

  function onKey(evt){
    if(getMode()!=='draw') return
    if(evt.key==='Escape'){ stopDrawing() }
    if(evt.key==='Enter'){ if(drawing){ if(drawing._hasPhantom){ drawing.pointsUI.pop(); drawing._hasPhantom=false } finishDrawing() } }
  }

  const svg = svgSel.node()
  svg.addEventListener('click', onClick)
  svg.addEventListener('mousemove', onMove)
  svg.addEventListener('dblclick', onDblClick)
  window.addEventListener('keydown', onKey)
}
