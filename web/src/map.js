import { L } from './vendor.js'
import { subscribe, state } from './state.js'
import { setGeoCenter, setGeoScale, setGeoScaleXY } from './geo.js'

let map = null
let tilesLayer = null

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
    map = L.map(el, { zoomControl: false, attributionControl: !!tilesAttr, doubleClickZoom: false })
    tilesLayer = L.tileLayer(tilesUrl, { attribution: tilesAttr })
    tilesLayer.addTo(map)
    try{ map.doubleClickZoom && map.doubleClickZoom.disable() }catch{}
    window.__MAP_ACTIVE = true
    try{ window.__leaflet_map = map }catch{}
    // Fit to current nodes with GPS when graph loads/changes
    subscribe((ev)=>{
      if(ev === 'graph:set') fitMapToNodes()
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
  try{ map.fitBounds(b.pad(0.1)) }catch{}
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
