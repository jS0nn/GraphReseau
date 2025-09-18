// Lightweight GPS → UI projection helpers
// Equirectangular projection around a configurable center with adjustable scale.

import { NODE_SIZE } from './constants/nodes.js'

// Shared config (mutable via setters)
export const geoConfig = {
  // Pixels per degree (lon/lat). Adjust to zoom points in/out in the UI.
  // Example: 10000 px/deg → ~10 px per 0.001° (~111 m).
  scale: 500000, // legacy uniform scale
  // New: independent per-axis scales derived from Leaflet projection
  scaleX: null,  // px per degree of longitude at current center
  scaleY: null,  // px per degree of latitude at current center
  // Projection center (degrees). When null, computed from data by caller.
  centerLat: null,
  centerLon: null,
  // Flip Y so that increasing latitude goes up visually
  flipY: true,
  // Apply cos(latitude) factor to longitude scaling (reduces distortion)
  useCosLat: true,
}

export function setGeoScale(pxPerDegree){
  if(typeof pxPerDegree === 'number' && isFinite(pxPerDegree) && pxPerDegree > 0){
    geoConfig.scale = pxPerDegree
  }
}

export function setGeoScaleXY(pxPerDegLon, pxPerDegLat){
  if(Number.isFinite(pxPerDegLon) && pxPerDegLon > 0) geoConfig.scaleX = +pxPerDegLon
  if(Number.isFinite(pxPerDegLat) && pxPerDegLat > 0) geoConfig.scaleY = +pxPerDegLat
}

export function setGeoCenter(lat, lon){
  if(isFinite(lat)) geoConfig.centerLat = +lat
  if(isFinite(lon)) geoConfig.centerLon = +lon
}

export function getGeoCenter(){
  return { centerLat: geoConfig.centerLat, centerLon: geoConfig.centerLon }
}

// Compute median center from nodes containing gps_lat/gps_lon
export function computeCenterFromNodes(nodes){
  const lats = []
  const lons = []
  for(const n of (nodes||[])){
    const a = n?.gps_lat, b = n?.gps_lon
    const lat = (a===''||a==null) ? null : +a
    const lon = (b===''||b==null) ? null : +b
    if(Number.isFinite(lat) && Number.isFinite(lon)){
      lats.push(lat); lons.push(lon)
    }
  }
  if(lats.length === 0) return null
  lats.sort((a,b)=>a-b); lons.sort((a,b)=>a-b)
  const mid = Math.floor(lats.length/2)
  const medLat = (lats.length%2===0) ? (lats[mid-1]+lats[mid])/2 : lats[mid]
  const medLon = (lons.length%2===0) ? (lons[mid-1]+lons[mid])/2 : lons[mid]
  return { centerLat: medLat, centerLon: medLon }
}

// Project a (lat, lon) to UI (x,y) in pixels using current config or overrides
export function projectLatLonToUI(lat, lon, opts={}){
  if(!Number.isFinite(lat) || !Number.isFinite(lon)) return { x: 0, y: 0 }
  try{
    if(window.__MAP_ACTIVE && window.__leaflet_map){
      const map = window.__leaflet_map
      const pt = map.latLngToContainerPoint({ lat, lng: lon })
      return { x: pt.x, y: pt.y }
    }
  }catch{}
  const scaleX = Number.isFinite(opts.scaleX) ? +opts.scaleX : (geoConfig.scaleX ?? 0)
  const scaleY = Number.isFinite(opts.scaleY) ? +opts.scaleY : (geoConfig.scaleY ?? 0)
  const scale = Number.isFinite(opts.scale) ? +opts.scale : geoConfig.scale
  const cLat = Number.isFinite(opts.centerLat) ? +opts.centerLat : geoConfig.centerLat ?? lat
  const cLon = Number.isFinite(opts.centerLon) ? +opts.centerLon : geoConfig.centerLon ?? lon
  const flipY = (typeof opts.flipY === 'boolean') ? opts.flipY : geoConfig.flipY
  const useCos = (typeof opts.useCosLat === 'boolean') ? opts.useCosLat : geoConfig.useCosLat
  const dxDeg = (lon - cLon)
  const dyDeg = (lat - cLat)
  // Prefer axis scales if available; fallback to legacy uniform scale with cos(lat)
  let x, y
  if(Number.isFinite(scaleX) && Number.isFinite(scaleY) && scaleX>0 && scaleY>0){
    x = dxDeg * scaleX
    y = (flipY ? -1 : 1) * dyDeg * scaleY
  } else {
    const latRad = (cLat || 0) * Math.PI/180
    const kx = useCos ? Math.cos(latRad) : 1
    x = dxDeg * kx * scale
    y = (flipY ? -1 : 1) * dyDeg * scale
  }
  return { x, y }
}

// Convenience: derive {x,y} for a node object if gps present
export function uiPosFromNodeGPS(node, opts={}){
  const lat = (node?.gps_lat===''||node?.gps_lat==null) ? null : +node.gps_lat
  const lon = (node?.gps_lon===''||node?.gps_lon==null) ? null : +node.gps_lon
  if(!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return projectLatLonToUI(lat, lon, opts)
}

// Display coordinates for a node considering GPS when available.
// Returns { x, y } in UI pixels. Falls back to node.x/node.y if no GPS.
export function displayXYForNode(node){
  if(node && node.gps_locked){
    const p = uiPosFromNodeGPS(node)
    if(p){
      const type = String(node?.type || '').toUpperCase()
      if(type === 'JONCTION') return { x: p.x, y: p.y }
      return { x: p.x - (NODE_SIZE.w/2), y: p.y - (NODE_SIZE.h/2) }
    }
  }
  return { x: (+node.x||0), y: (+node.y||0) }
}

// Inverse of projectLatLonToUI using current geoConfig.
// Returns { lon, lat } from UI pixel coordinates.
export function unprojectUIToLatLon(x, y, opts={}){
  try{
    if(window.__MAP_ACTIVE && window.__leaflet_map){
      const map = window.__leaflet_map
      const pt = map.containerPointToLatLng([ x, y ])
      return { lon: pt.lng, lat: pt.lat }
    }
  }catch{}
  const scaleX = Number.isFinite(opts.scaleX) ? +opts.scaleX : (geoConfig.scaleX ?? 0)
  const scaleY = Number.isFinite(opts.scaleY) ? +opts.scaleY : (geoConfig.scaleY ?? 0)
  const scale = Number.isFinite(opts.scale) ? +opts.scale : geoConfig.scale
  const cLat = Number.isFinite(opts.centerLat) ? +opts.centerLat : geoConfig.centerLat || 0
  const cLon = Number.isFinite(opts.centerLon) ? +opts.centerLon : geoConfig.centerLon || 0
  const flipY = (typeof opts.flipY === 'boolean') ? opts.flipY : geoConfig.flipY
  const useCos = (typeof opts.useCosLat === 'boolean') ? opts.useCosLat : geoConfig.useCosLat
  let lon, lat
  if(Number.isFinite(scaleX) && Number.isFinite(scaleY) && scaleX>0 && scaleY>0){
    lat = (flipY ? -1 : 1) * (y / scaleY) + cLat
    lon = (x / scaleX) + cLon
  } else {
    lat = (flipY ? -1 : 1) * (y / scale) + cLat
    const kx = useCos ? Math.cos((cLat || 0) * Math.PI/180) : 1
    lon = (x / (scale * (kx || 1))) + cLon
  }
  return { lon, lat }
}
