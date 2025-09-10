// Lightweight GPS → UI projection helpers
// Equirectangular projection around a configurable center with adjustable scale.

// Shared config (mutable via setters)
export const geoConfig = {
  // Pixels per degree (lon/lat). Adjust to zoom points in/out in the UI.
  // Example: 10000 px/deg → ~10 px per 0.001° (~111 m).
  scale: 500000,
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
  const scale = Number.isFinite(opts.scale) ? +opts.scale : geoConfig.scale
  const cLat = Number.isFinite(opts.centerLat) ? +opts.centerLat : geoConfig.centerLat ?? lat
  const cLon = Number.isFinite(opts.centerLon) ? +opts.centerLon : geoConfig.centerLon ?? lon
  const flipY = (typeof opts.flipY === 'boolean') ? opts.flipY : geoConfig.flipY
  const useCos = (typeof opts.useCosLat === 'boolean') ? opts.useCosLat : geoConfig.useCosLat
  const latRad = (cLat || 0) * Math.PI/180
  const kx = useCos ? Math.cos(latRad) : 1
  const dxDeg = (lon - cLon)
  const dyDeg = (lat - cLat)
  const x = dxDeg * kx * scale
  const y = (flipY ? -1 : 1) * dyDeg * scale
  return { x, y }
}

// Convenience: derive {x,y} for a node object if gps present
export function uiPosFromNodeGPS(node, opts={}){
  const lat = (node?.gps_lat===''||node?.gps_lat==null) ? null : +node.gps_lat
  const lon = (node?.gps_lon===''||node?.gps_lon==null) ? null : +node.gps_lon
  if(!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return projectLatLonToUI(lat, lon, opts)
}

