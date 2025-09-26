// Lightweight GPS → UI projection helpers
// Equirectangular projection around a configurable center with adjustable scale.

import { NODE_SIZE } from './constants/nodes.ts'

export type ProjectionOptions = {
  scaleX?: number | null
  scaleY?: number | null
  scale?: number | null
  centerLat?: number | null
  centerLon?: number | null
  flipY?: boolean
  useCosLat?: boolean
}

export type NodeLike = {
  gps_lat?: number | string | null
  gps_lon?: number | string | null
  gps_locked?: boolean | null
  type?: string | null
  x?: number | string | null
  y?: number | string | null
}

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

// Shared config (mutable via setters)
export const geoConfig: {
  scale: number
  scaleX: number | null
  scaleY: number | null
  centerLat: number | null
  centerLon: number | null
  flipY: boolean
  useCosLat: boolean
} = {
  scale: 500000,
  scaleX: null,
  scaleY: null,
  centerLat: null,
  centerLon: null,
  flipY: true,
  useCosLat: true,
}

export function setGeoScale(pxPerDegree: number): void {
  if(isFiniteNumber(pxPerDegree) && pxPerDegree > 0){
    geoConfig.scale = pxPerDegree
  }
}

export function setGeoScaleXY(pxPerDegLon: number | null | undefined, pxPerDegLat: number | null | undefined): void {
  if(isFiniteNumber(pxPerDegLon) && pxPerDegLon > 0) geoConfig.scaleX = pxPerDegLon
  if(isFiniteNumber(pxPerDegLat) && pxPerDegLat > 0) geoConfig.scaleY = pxPerDegLat
}

export function setGeoCenter(lat: number | null | undefined, lon: number | null | undefined): void {
  if(isFiniteNumber(lat)) geoConfig.centerLat = lat
  if(isFiniteNumber(lon)) geoConfig.centerLon = lon
}

export function computeCenterFromNodes(nodes: Iterable<NodeLike> | null | undefined): { centerLat: number; centerLon: number } | null {
  const lats: number[] = []
  const lons: number[] = []
  for(const node of nodes || []){
    const latRaw = node?.gps_lat
    const lonRaw = node?.gps_lon
    const lat = typeof latRaw === 'string' ? Number(latRaw) : latRaw
    const lon = typeof lonRaw === 'string' ? Number(lonRaw) : lonRaw
    if(isFiniteNumber(lat) && isFiniteNumber(lon)){
      lats.push(lat)
      lons.push(lon)
    }
  }
  if(lats.length === 0) return null
  lats.sort((a, b) => a - b)
  lons.sort((a, b) => a - b)
  const mid = Math.floor(lats.length / 2)
  const medLat = (lats.length % 2 === 0) ? (lats[mid - 1] + lats[mid]) / 2 : lats[mid]
  const medLon = (lons.length % 2 === 0) ? (lons[mid - 1] + lons[mid]) / 2 : lons[mid]
  return { centerLat: medLat, centerLon: medLon }
}

export function projectLatLonToUI(lat: number, lon: number, opts: ProjectionOptions = {}): { x: number; y: number } {
  if(!isFiniteNumber(lat) || !isFiniteNumber(lon)) return { x: 0, y: 0 }
  try{
    const leaflet = (window as typeof window & { __leaflet_map?: { latLngToContainerPoint?: (ll: { lat: number; lng: number }) => { x: number; y: number } } }).__leaflet_map
    if(window.__MAP_ACTIVE && leaflet?.latLngToContainerPoint){
      const pt = leaflet.latLngToContainerPoint({ lat, lng: lon })
      if(pt) return { x: pt.x, y: pt.y }
    }
  }catch{}

  const scaleX = isFiniteNumber(opts.scaleX) ? opts.scaleX : geoConfig.scaleX ?? 0
  const scaleY = isFiniteNumber(opts.scaleY) ? opts.scaleY : geoConfig.scaleY ?? 0
  const scale = isFiniteNumber(opts.scale) ? opts.scale : geoConfig.scale
  const cLat = isFiniteNumber(opts.centerLat) ? opts.centerLat : (isFiniteNumber(geoConfig.centerLat) ? geoConfig.centerLat : lat)
  const cLon = isFiniteNumber(opts.centerLon) ? opts.centerLon : (isFiniteNumber(geoConfig.centerLon) ? geoConfig.centerLon : lon)
  const flipY = typeof opts.flipY === 'boolean' ? opts.flipY : geoConfig.flipY
  const useCos = typeof opts.useCosLat === 'boolean' ? opts.useCosLat : geoConfig.useCosLat

  const dxDeg = lon - cLon
  const dyDeg = lat - cLat
  let x: number
  let y: number

  if(isFiniteNumber(scaleX) && isFiniteNumber(scaleY) && scaleX > 0 && scaleY > 0){
    x = dxDeg * scaleX
    y = (flipY ? -1 : 1) * dyDeg * scaleY
  }else{
    const latRad = (cLat || 0) * Math.PI / 180
    const kx = useCos ? Math.cos(latRad) : 1
    x = dxDeg * kx * scale
    y = (flipY ? -1 : 1) * dyDeg * scale
  }

  return { x, y }
}

export function uiPosFromNodeGPS(node: NodeLike | null | undefined, opts: ProjectionOptions = {}): { x: number; y: number } | null {
  const latRaw = node?.gps_lat
  const lonRaw = node?.gps_lon
  const lat = typeof latRaw === 'string' ? Number(latRaw) : latRaw
  const lon = typeof lonRaw === 'string' ? Number(lonRaw) : lonRaw
  if(!isFiniteNumber(lat) || !isFiniteNumber(lon)) return null
  return projectLatLonToUI(lat, lon, opts)
}

export function displayXYForNode(node: NodeLike | null | undefined): { x: number; y: number } {
  if(node?.gps_locked){
    const projected = uiPosFromNodeGPS(node)
    if(projected){
      const type = String(node?.type || '').toUpperCase()
      if(type === 'JONCTION') return { x: projected.x, y: projected.y }
      return { x: projected.x - NODE_SIZE.w / 2, y: projected.y - NODE_SIZE.h / 2 }
    }
  }
  const x = typeof node?.x === 'string' ? Number(node?.x) : node?.x
  const y = typeof node?.y === 'string' ? Number(node?.y) : node?.y
  return { x: isFiniteNumber(x) ? x : 0, y: isFiniteNumber(y) ? y : 0 }
}

export function unprojectUIToLatLon(x: number, y: number, opts: ProjectionOptions = {}): { lon: number; lat: number } {
  try{
    const leaflet = (window as typeof window & { __leaflet_map?: { containerPointToLatLng?: (pt: [number, number]) => { lat: number; lng: number } } }).__leaflet_map
    if(window.__MAP_ACTIVE && leaflet?.containerPointToLatLng){
      const pt = leaflet.containerPointToLatLng([x, y])
      if(pt) return { lon: pt.lng, lat: pt.lat }
    }
  }catch{}

  const scaleX = isFiniteNumber(opts.scaleX) ? opts.scaleX : geoConfig.scaleX ?? 0
  const scaleY = isFiniteNumber(opts.scaleY) ? opts.scaleY : geoConfig.scaleY ?? 0
  const scale = isFiniteNumber(opts.scale) ? opts.scale : geoConfig.scale
  const cLat = isFiniteNumber(opts.centerLat) ? opts.centerLat : geoConfig.centerLat ?? 0
  const cLon = isFiniteNumber(opts.centerLon) ? opts.centerLon : geoConfig.centerLon ?? 0
  const flipY = typeof opts.flipY === 'boolean' ? opts.flipY : geoConfig.flipY
  const useCos = typeof opts.useCosLat === 'boolean' ? opts.useCosLat : geoConfig.useCosLat

  let lon: number
  let lat: number
  if(isFiniteNumber(scaleX) && isFiniteNumber(scaleY) && scaleX > 0 && scaleY > 0){
    lat = (flipY ? -1 : 1) * (y / scaleY) + cLat
    lon = (x / scaleX) + cLon
  }else{
    lat = (flipY ? -1 : 1) * (y / scale) + cLat
    const kx = useCos ? Math.cos((cLat || 0) * Math.PI / 180) : 1
    lon = (x / (scale * (kx || 1))) + cLon
  }
  return { lon, lat }
}
