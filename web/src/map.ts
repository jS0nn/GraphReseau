import { L } from './vendor.ts'
import { subscribe, state } from './state/index.ts'
import { setGeoCenter, setGeoScale, setGeoScaleXY } from './geo.ts'

type GlobalWithMap = typeof window & {
  __MAP?: {
    tilesUrl?: string
    tilesAttribution?: string
    tilesApiKey?: string
  }
  __MAP_ACTIVE?: boolean
  __MAP_SUPPRESS_AUTOFIT?: boolean
  __leaflet_map?: ReturnType<typeof L.map> | null
}

type CanvasPadding = { left: number; right: number; top: number; bottom: number }

type FitOptions = {
  paddingTopLeft: ReturnType<typeof L.point>
  paddingBottomRight: ReturnType<typeof L.point>
}

function consumeAutoFitSuppression(): boolean {
  const g = typeof globalThis !== 'undefined' ? (globalThis as GlobalWithMap) : null
  if(!g) return false
  if(g.__MAP_SUPPRESS_AUTOFIT){
    g.__MAP_SUPPRESS_AUTOFIT = false
    return true
  }
  return false
}

let map: ReturnType<typeof L.map> | null = null
let tilesLayer: ReturnType<typeof L.tileLayer> | null = null

function computeCanvasOverlayPadding(): CanvasPadding {
  const container = typeof document !== 'undefined' ? document.getElementById('canvas') : null
  const width = container?.clientWidth || 0
  const height = container?.clientHeight || 0
  if(!container || width <= 0 || height <= 0){
    return { left: 0, right: 0, top: 0, bottom: 0 }
  }
  const result: CanvasPadding = { left: 0, right: 0, top: 0, bottom: 0 }
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

export function initMap(): ReturnType<typeof L.map> | null {
  const body = typeof document !== 'undefined' ? document.body : null
  const globalCfg = (window as GlobalWithMap).__MAP
  const cfg = globalCfg || {
    tilesUrl: body?.dataset?.tilesUrl || '',
    tilesAttribution: body?.dataset?.tilesAttribution || '',
    tilesApiKey: body?.dataset?.tilesApiKey || '',
  }
  let tilesUrl = (cfg.tilesUrl || '').trim()
  const tilesAttr = cfg.tilesAttribution || ''
  const el = document.getElementById('map')
  if(!el) return null
  if(!tilesUrl){
    return null
  }
  try{
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

    map = L.map(el, {
      zoomControl: false,
      attributionControl: !!tilesAttr,
      doubleClickZoom: false,
      maxZoom: 22,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
    })

    tilesLayer = L.tileLayer(tilesUrl, {
      attribution: tilesAttr,
      maxZoom: 22,
      maxNativeZoom: 18,
      detectRetina: true,
    })
    tilesLayer.addTo(map)
    try{ map.doubleClickZoom && map.doubleClickZoom.disable() }catch{}
    const globalWindow = window as GlobalWithMap
    globalWindow.__MAP_ACTIVE = true
    try{ globalWindow.__leaflet_map = map }catch{}

    subscribe((ev)=>{
      if(ev === 'graph:set'){
        if(consumeAutoFitSuppression()) return
        fitMapToNodes()
      }
    })

    fitMapToNodes()
    const onView = ()=>{
      try{
        const root = document.getElementById('zoomRoot')
        root?.removeAttribute('transform')
      }catch{}
      syncGeoProjection()
      notifyViewChanged()
    }
    map.on('move zoom', onView)
    map.on('moveend zoomend', onView)
    syncGeoProjection()
    notifyViewChanged()
    return map
  }catch(err){
    console.warn('Leaflet init failed', err)
    return null
  }
}

export function fitMapToNodes(): void {
  if(!map) return
  const pts: Array<[number, number]> = []
  for(const n of state.nodes || []){
    const lat = (n?.gps_lat === '' || n?.gps_lat == null) ? null : Number(n.gps_lat)
    const lon = (n?.gps_lon === '' || n?.gps_lon == null) ? null : Number(n.gps_lon)
    if(Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lat as number, lon as number])
  }
  if(pts.length === 0) return
  let minLat = Infinity; let maxLat = -Infinity
  let minLon = Infinity; let maxLon = -Infinity
  pts.forEach(([lat, lon]) => {
    if(lat < minLat) minLat = lat
    if(lat > maxLat) maxLat = lat
    if(lon < minLon) minLon = lon
    if(lon > maxLon) maxLon = lon
  })
  const bounds = L.latLngBounds(L.latLng(minLat, minLon), L.latLng(maxLat, maxLon))
  try{
    const padding = computeCanvasOverlayPadding()
    const base = 60
    const options: FitOptions = {
      paddingTopLeft: L.point(base + padding.left, base),
      paddingBottomRight: L.point(base + padding.right, base + padding.bottom),
    }
    map.fitBounds(bounds.pad(0.05), options)
  }catch{}
}

export function syncGeoProjection(): void {
  if(!map) return
  try{
    const z = map.getZoom()
    const center = map.getCenter()
    const origin = map.project(center, z)
    const lonOffset = map.project({ lat: center.lat, lng: center.lng + 0.01 }, z)
    const latOffset = map.project({ lat: center.lat + 0.01, lng: center.lng }, z)
    const pxPerDegLon = (lonOffset.x - origin.x) / 0.01
    const pxPerDegLat = (latOffset.y - origin.y) / 0.01
    if(Number.isFinite(pxPerDegLon) && Number.isFinite(pxPerDegLat)){
      setGeoScaleXY(pxPerDegLon, pxPerDegLat)
    }
    setGeoCenter(center.lat, center.lng)
  }catch{}
}

export function getMap(): ReturnType<typeof L.map> | null {
  return map
}

export function isMapActive(): boolean {
  return !!(window as GlobalWithMap).__MAP_ACTIVE
}

let rafHandle = 0
function notifyViewChanged(): void {
  if(rafHandle) return
  rafHandle = requestAnimationFrame(() => {
    rafHandle = 0
    try{ document.dispatchEvent(new CustomEvent('map:view')) }catch{}
  })
}
