import { L } from './vendor.js'
import { subscribe, state } from './state/index.js'
import { setGeoCenter, setGeoScale, setGeoScaleXY } from './geo.js'

function consumeAutoFitSuppression(){
  const g = typeof globalThis !== 'undefined' ? globalThis : null
  if(!g) return false
  if(g.__MAP_SUPPRESS_AUTOFIT){
    g.__MAP_SUPPRESS_AUTOFIT = false
    return true
  }
  return false
}

let map = null
let tilesLayer = null

function computeCanvasOverlayPadding(){
  const container = typeof document !== 'undefined' ? document.getElementById('canvas') : null
  const width = container?.clientWidth || 0
  const height = container?.clientHeight || 0
  if(!container || width <= 0 || height <= 0){
    return { left: 0, right: 0, top: 0, bottom: 0 }
  }
  const result = { left: 0, right: 0, top: 0, bottom: 0 }
  try{
    const propEl = document.getElementById('prop')
    if(propEl && !document.body.classList.contains('prop-collapsed')){
      const style = window.getComputedStyle(propEl)
      const opacity = parseFloat(style?.opacity || '1')
      if(style && style.display !== 'none' && style.visibility !== 'hidden' && opacity > 0){
        const canvasRect = container.getBoundingClientRect()
        const propRect = propEl.getBoundingClientRect()
        const overlapLeft = Math.max(canvasRect.left, propRect.left)
        const overlapRight = Math.min(canvasRect.right, propRect.right)
        const overlapWidth = Math.max(0, overlapRight - overlapLeft)
        if(overlapWidth > 1){
          const propCenterX = propRect.left + propRect.width / 2
          const canvasCenterX = canvasRect.left + canvasRect.width / 2
          if(propCenterX >= canvasCenterX){
            result.right = overlapWidth
          }else{
            result.left = overlapWidth
          }
        }
      }
    }
    const logDrawer = document.getElementById('logDrawer')
    if(logDrawer){
      const style = window.getComputedStyle(logDrawer)
      const opacity = parseFloat(style?.opacity || '1')
      if(style && style.display !== 'none' && opacity > 0){
        const rect = logDrawer.getBoundingClientRect()
        const canvasRect = container.getBoundingClientRect()
        if(rect.top < canvasRect.bottom && rect.bottom > canvasRect.top){
          const overlap = Math.max(0, Math.min(canvasRect.bottom, rect.bottom) - Math.max(canvasRect.top, rect.top))
          if(overlap > 1){
            result.bottom = overlap
          }
        }
      }
    }
  }catch{}
  return result
}

export function initMap(){
  const body = (typeof document!=='undefined' ? document.body : null)
  const cfg = window.__MAP || {
    tilesUrl: body?.dataset?.tilesUrl || '',
    tilesAttribution: body?.dataset?.tilesAttribution || '',
    tilesApiKey: body?.dataset?.tilesApiKey || '',
  }
  let tilesUrl = (cfg.tilesUrl || '').trim()
  const tilesAttr = cfg.tilesAttribution || ''
  const el = document.getElementById('map')
  if(!el) return null
  if(!tilesUrl){
    // No tiles configured: keep neutral background
    return null
  }
  try{
    // Apply API key substitution if provided
    const apiKey = (cfg.tilesApiKey || '').trim()
    if(apiKey){
      if(/\{apiKey\}|\{apikey\}|\$\{API_KEY\}|\$\{MAP_TILES_API_KEY\}/i.test(tilesUrl)){
        tilesUrl = tilesUrl
          .replace(/\{apiKey\}/ig, apiKey)
          .replace(/\{apikey\}/ig, apiKey)
          .replace(/\$\{API_KEY\}/g, apiKey)
          .replace(/\$\{MAP_TILES_API_KEY\}/g, apiKey)
      } else if(!/[?&](key|api_key|apikey)=/i.test(tilesUrl)){
        tilesUrl += (tilesUrl.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(apiKey)
      }
    }
    // Allow closer zoom and smoother fractional zoom steps
    map = L.map(el, {
      zoomControl: false,
      attributionControl: !!tilesAttr,
      doubleClickZoom: false,
      // Increase max zoom; Leaflet will overzoom beyond maxNativeZoom of tiles
      maxZoom: 22,
      // Make programmatic zoom changes feel smoother
      zoomSnap: 0.25,
      zoomDelta: 0.5,
    })
    // Expose higher logical maxZoom and overzoom from native 18+ when needed
    tilesLayer = L.tileLayer(tilesUrl, {
      attribution: tilesAttr,
      maxZoom: 22,
      // Common native max for many providers; adjust if your tiles go higher
      maxNativeZoom: 18,
      detectRetina: true,
    })
    tilesLayer.addTo(map)
    try{ map.doubleClickZoom && map.doubleClickZoom.disable() }catch{}
    window.__MAP_ACTIVE = true
    try{ window.__leaflet_map = map }catch{}
    // Fit to current nodes with GPS when graph loads/changes unless a caller suppressed it (e.g. undo/redo)
    subscribe((ev)=>{
      if(ev === 'graph:set'){
        if(consumeAutoFitSuppression()) return
        fitMapToNodes()
      }
    })
    // Initial fit attempt (if state already present)
    fitMapToNodes()
    // Sync geo projection scale/center with Leaflet view for better alignment
    const onView = ()=> { 
      try{ const root = document.getElementById('zoomRoot'); root && root.removeAttribute('transform') }catch{}
      syncGeoProjection(); notifyViewChanged() 
    }
    map.on('move zoom', onView)
    map.on('moveend zoomend', onView)
    syncGeoProjection(); notifyViewChanged()
    return map
  }catch(err){
    console.warn('Leaflet init failed', err)
    return null
  }
}

export function fitMapToNodes(){
  if(!map) return
  const pts = []
  for(const n of (state.nodes||[])){
    const lat = (n?.gps_lat===''||n?.gps_lat==null) ? null : +n.gps_lat
    const lon = (n?.gps_lon===''||n?.gps_lon==null) ? null : +n.gps_lon
    if(Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat, lon])
  }
  if(pts.length === 0) return
  let minLat=+Infinity, maxLat=-Infinity, minLon=+Infinity, maxLon=-Infinity
  pts.forEach(([lat,lon])=>{ if(lat<minLat)minLat=lat; if(lat>maxLat)maxLat=lat; if(lon<minLon)minLon=lon; if(lon>maxLon)maxLon=lon })
  const b = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon))
  try{
    const padding = computeCanvasOverlayPadding()
    const base = 60
    const options = {
      paddingTopLeft: L.point(base + padding.left, base),
      paddingBottomRight: L.point(base + padding.right, base + padding.bottom),
    }
    map.fitBounds(b.pad(0.05), options)
  }catch{}
}

export function syncGeoProjection(){
  if(!map) return
  try{
    const z = map.getZoom()
    const c = map.getCenter()
    const p = map.project(c, z)
    const pLon = map.project({ lat: c.lat, lng: c.lng + 0.01 }, z)
    const pLat = map.project({ lat: c.lat + 0.01, lng: c.lng }, z)
    const pxPerDegLon = (pLon.x - p.x) / 0.01
    const pxPerDegLat = (pLat.y - p.y) / 0.01
    // Use per-axis scales to minimize drift relative to Leaflet
    if(Number.isFinite(pxPerDegLon) && Number.isFinite(pxPerDegLat)){
      setGeoScaleXY(pxPerDegLon, pxPerDegLat)
    }
    setGeoCenter(c.lat, c.lng)
  }catch(err){ /* ignore */ }
}

export function getMap(){ return map }
export function isMapActive(){ return !!window.__MAP_ACTIVE }

let _raf = 0
function notifyViewChanged(){
  if(_raf) return
  _raf = requestAnimationFrame(()=>{
    _raf = 0
    try{ document.dispatchEvent(new CustomEvent('map:view')) }catch{}
  })
}
