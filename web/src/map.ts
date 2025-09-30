import { L } from './vendor.ts'
import { subscribe, state } from './state/index.ts'
import type { PlanOverlayBounds } from './types/plan-overlay.ts'
import { createRotatedImageOverlay, type RotatedOverlayCorners } from './leaflet-rotated-image.ts'
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

type PlanOverlayOptions = {
  url: string
  bounds: PlanOverlayBounds
  opacity: number
  rotationDeg: number
}

type PlanOverlayLayerState = {
  layer: ReturnType<typeof createRotatedImageOverlay>
  options: PlanOverlayOptions
}

let planOverlayState: PlanOverlayLayerState | null = null
let pendingPlanOverlay: PlanOverlayOptions | null = null

const EARTH_RADIUS = 6378137

const clampLat = (lat: number): number => {
  if(lat > 89.5) return 89.5
  if(lat < -89.5) return -89.5
  return lat
}

type MercPoint = { x: number; y: number }

function projectLatLon(lat: number, lon: number): MercPoint {
  const rad = Math.PI / 180
  const latClamped = clampLat(lat)
  const x = lon * rad * EARTH_RADIUS
  const y = Math.log(Math.tan(Math.PI / 4 + (latClamped * rad) / 2)) * EARTH_RADIUS
  return { x, y }
}

function unprojectToLatLon(pt: MercPoint): { lat: number; lon: number } {
  const lon = (pt.x / EARTH_RADIUS) * (180 / Math.PI)
  const lat = (2 * Math.atan(Math.exp(pt.y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI)
  return { lat, lon }
}

function rotatePoint(point: MercPoint, center: MercPoint, angleRad: number): MercPoint {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const dx = point.x - center.x
  const dy = point.y - center.y
  const rx = dx * cos - dy * sin
  const ry = dx * sin + dy * cos
  return { x: center.x + rx, y: center.y + ry }
}

function computeRotatedCorners(bounds: PlanOverlayBounds, rotationDeg: number): RotatedOverlayCorners {
  const nw = projectLatLon(bounds.nw.lat, bounds.nw.lon)
  const ne = projectLatLon(bounds.ne.lat, bounds.ne.lon)
  const sw = projectLatLon(bounds.sw.lat, bounds.sw.lon)
  const se = projectLatLon(bounds.se.lat, bounds.se.lon)
  const points = [nw, ne, sw, se]
  const center = {
    x: points.reduce((acc, pt) => acc + pt.x, 0) / points.length,
    y: points.reduce((acc, pt) => acc + pt.y, 0) / points.length,
  }
  const angleRad = (rotationDeg || 0) * Math.PI / 180
  if(Math.abs(angleRad) < 1e-8){
    return {
      nw: { lat: bounds.nw.lat, lon: bounds.nw.lon },
      ne: { lat: bounds.ne.lat, lon: bounds.ne.lon },
      sw: { lat: bounds.sw.lat, lon: bounds.sw.lon },
      se: { lat: bounds.se.lat, lon: bounds.se.lon },
    }
  }
  const rotatedNw = unprojectToLatLon(rotatePoint(nw, center, angleRad))
  const rotatedNe = unprojectToLatLon(rotatePoint(ne, center, angleRad))
  const rotatedSw = unprojectToLatLon(rotatePoint(sw, center, angleRad))
  const rotatedSe = unprojectToLatLon(rotatePoint(se, center, angleRad))
  return {
    nw: rotatedNw,
    ne: rotatedNe,
    sw: rotatedSw,
    se: rotatedSe,
  }
}

function syncPlanOverlayLayer(): void {
  if(!map){
    return
  }
  if(!planOverlayState){
    if(pendingPlanOverlay){
      const corners = computeRotatedCorners(pendingPlanOverlay.bounds, pendingPlanOverlay.rotationDeg)
      const layer = createRotatedImageOverlay(pendingPlanOverlay.url, corners, {
        opacity: pendingPlanOverlay.opacity,
        interactive: false,
        pane: 'overlayPane',
      })
      layer.addTo(map)
      planOverlayState = {
        layer,
        options: { ...pendingPlanOverlay },
      }
      pendingPlanOverlay = null
      layer.bringToFront?.()
    }
    return
  }
  const { options } = planOverlayState
  const corners = computeRotatedCorners(options.bounds, options.rotationDeg)
  planOverlayState.layer.setCorners(corners)
  planOverlayState.layer.setOpacity(options.opacity)
  if(planOverlayState.layer.setUrl){
    planOverlayState.layer.setUrl(options.url)
  }
  if(map && !map.hasLayer(planOverlayState.layer)){
    planOverlayState.layer.addTo(map)
  }
  planOverlayState.layer.bringToFront?.()
}

function clearPlanOverlayLayer(): void {
  if(map && planOverlayState){
    map.removeLayer(planOverlayState.layer)
  }
  planOverlayState = null
}

export function applyPlanOverlay(options: PlanOverlayOptions | null): void {
  if(!options){
    pendingPlanOverlay = null
    clearPlanOverlayLayer()
    return
  }
  const normalized: PlanOverlayOptions = {
    url: options.url,
    bounds: options.bounds,
    opacity: Math.max(0, Math.min(1, options.opacity)),
    rotationDeg: options.rotationDeg,
  }
  pendingPlanOverlay = { ...normalized }
  if(!map){
    return
  }
  if(!planOverlayState){
    const corners = computeRotatedCorners(normalized.bounds, normalized.rotationDeg)
    const layer = createRotatedImageOverlay(normalized.url, corners, {
      opacity: normalized.opacity,
      interactive: false,
      pane: 'overlayPane',
    })
    layer.addTo(map)
    planOverlayState = { layer, options: { ...normalized } }
    layer.bringToFront?.()
    return
  }
  planOverlayState.options = { ...normalized }
  if(planOverlayState.layer.setUrl){
    planOverlayState.layer.setUrl(normalized.url)
  }
  planOverlayState.layer.setCorners(computeRotatedCorners(normalized.bounds, normalized.rotationDeg))
  planOverlayState.layer.setOpacity(normalized.opacity)
  if(!map.hasLayer(planOverlayState.layer)){
    planOverlayState.layer.addTo(map)
  }
  planOverlayState.layer.bringToFront?.()
}

export function updatePlanOverlayOpacity(opacity: number): void {
  const clamped = Math.max(0, Math.min(1, opacity))
  if(planOverlayState){
    planOverlayState.options.opacity = clamped
    planOverlayState.layer.setOpacity(clamped)
  }
  if(pendingPlanOverlay){
    pendingPlanOverlay = { ...pendingPlanOverlay, opacity: clamped }
  }
}

export function updatePlanOverlayRotation(rotationDeg: number): void {
  if(planOverlayState){
    planOverlayState.options.rotationDeg = rotationDeg
    planOverlayState.layer.setCorners(computeRotatedCorners(planOverlayState.options.bounds, rotationDeg))
  }
  if(pendingPlanOverlay){
    pendingPlanOverlay = { ...pendingPlanOverlay, rotationDeg }
  }
}

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
    syncPlanOverlayLayer()
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
