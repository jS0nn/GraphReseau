import type { LatLngExpression, LeafletMouseEvent } from 'leaflet'

import { L } from './vendor.ts'
import { subscribe, state, getPlanOverlayState, setPlanOverlayBounds, setPlanOverlayScalePercent } from './state/index.ts'
import type { PlanOverlayBounds, LatLon } from './types/plan-overlay.ts'
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

type CornerKey = 'nw' | 'ne' | 'sw' | 'se'
type HandleKey = CornerKey | 'center'
const PLAN_HANDLE_KEYS: CornerKey[] = ['nw', 'ne', 'sw', 'se']
const PLAN_CENTER_KEY: 'center' = 'center'
const PLAN_HANDLE_PANE = 'plan-handle-pane'
let planHandleLayer: ReturnType<typeof L.layerGroup> | null = null
const planHandleMarkers: Partial<Record<HandleKey, ReturnType<typeof L.marker>>> = {}
let planHandleDragActive = false
let mapDraggingWasEnabled = true
let mapScrollWasEnabled = true
let planHandleDragArmed = false
let altKeyDown = false
let planHandleActiveKey: HandleKey | null = null

const DEV_BUILD = typeof __DEV__ !== 'undefined' && __DEV__ === true

const debugPlan = DEV_BUILD
  ? (...args: unknown[]): void => {
      try{
        if(typeof console === 'undefined') return
        const g = typeof window !== 'undefined' ? (window as GlobalWithMap & { __PLAN_DEBUG?: boolean }) : null
        if(g && g.__PLAN_DEBUG !== true) return
        console.debug('[plan]', ...args)
      }catch{}
    }
  : () => {}

const isAltKey = (key: string | undefined | null): boolean => key === 'Alt' || key === 'AltGraph'

const altModifierActive = (original?: unknown): boolean => {
  const candidate = original as Record<string, unknown> | null | undefined
  if(candidate && typeof candidate.altKey === 'boolean'){
    return Boolean(candidate.altKey)
  }
  return altKeyDown
}

function setAltInteractionMode(enabled: boolean): void {
  try{
    const body = typeof document !== 'undefined' ? document.body : null
    if(!body) return
    if(enabled){
      if(!body.classList.contains('plan-alt-active')){
        debugPlan('setAltInteractionMode:on')
      }
      body.classList.add('plan-alt-active')
    }else{
      if(body.classList.contains('plan-alt-active')){
        debugPlan('setAltInteractionMode:off')
      }
      body.classList.remove('plan-alt-active')
    }
  }catch{}
}

function armPlanHandleDrag(): void {
  if(planHandleDragArmed) return
  planHandleDragArmed = true
  planHandleDragActive = true
  setAltInteractionMode(true)
  debugPlan('armPlanHandleDrag')
  disableMapInteractions()
}

function releasePlanHandleDrag(): void {
  if(planHandleDragArmed || planHandleDragActive){
    debugPlan('releasePlanHandleDrag')
  }
  planHandleDragArmed = false
  planHandleDragActive = false
  planHandleActiveKey = null
  enableMapInteractions()
  if(!altKeyDown){
    setAltInteractionMode(false)
  }
}

if(typeof window !== 'undefined'){
  window.addEventListener('keydown', (event) => {
    if(isAltKey(event.key)){
      altKeyDown = true
      setAltInteractionMode(true)
    }
  })
  window.addEventListener('keyup', (event) => {
    if(isAltKey(event.key)){
      altKeyDown = false
      if(!planHandleDragActive){
        setAltInteractionMode(false)
      }
    }
  })
  window.addEventListener('blur', () => {
    altKeyDown = false
    if(!planHandleDragActive){
      setAltInteractionMode(false)
    }
  })
}
const SCALE_PERCENT_MIN = 25
const SCALE_PERCENT_MAX = 200

subscribe((event) => {
  if(event === 'plan:set' || event === 'plan:toggle' || event === 'plan:bounds' || event === 'plan:editable'){
    updatePlanOverlayHandles()
  }
})

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

function disableMapInteractions(): void {
  if(!map) return
  try{
    mapDraggingWasEnabled = !!map.dragging?.enabled?.()
    if(mapDraggingWasEnabled){
      debugPlan('disableMapInteractions: dragging off')
      map.dragging?.disable()
    }
  }catch{}
  try{
    mapScrollWasEnabled = !!map.scrollWheelZoom?.enabled?.()
    if(mapScrollWasEnabled){
      debugPlan('disableMapInteractions: scroll off')
      map.scrollWheelZoom?.disable()
    }
  }catch{}
}

function enableMapInteractions(): void {
  if(!map) return
  try{
    if(mapDraggingWasEnabled){
      debugPlan('enableMapInteractions: dragging on')
      map.dragging?.enable()
    }
  }catch{}
  try{
    if(mapScrollWasEnabled){
      debugPlan('enableMapInteractions: scroll on')
      map.scrollWheelZoom?.enable()
    }
  }catch{}
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
      nw: L.latLng(bounds.nw.lat, bounds.nw.lon),
      ne: L.latLng(bounds.ne.lat, bounds.ne.lon),
      sw: L.latLng(bounds.sw.lat, bounds.sw.lon),
      se: L.latLng(bounds.se.lat, bounds.se.lon),
    }
  }
  const rotatedNw = unprojectToLatLon(rotatePoint(nw, center, angleRad))
  const rotatedNe = unprojectToLatLon(rotatePoint(ne, center, angleRad))
  const rotatedSw = unprojectToLatLon(rotatePoint(sw, center, angleRad))
  const rotatedSe = unprojectToLatLon(rotatePoint(se, center, angleRad))
  return {
    nw: L.latLng(rotatedNw.lat, rotatedNw.lon),
    ne: L.latLng(rotatedNe.lat, rotatedNe.lon),
    sw: L.latLng(rotatedSw.lat, rotatedSw.lon),
    se: L.latLng(rotatedSe.lat, rotatedSe.lon),
  }
}

function applyOverlayBoundsImmediate(bounds: PlanOverlayBounds, rotationDeg: number): void {
  if(planOverlayState){
    planOverlayState.options = { ...planOverlayState.options, bounds }
    planOverlayState.layer.setCorners(computeRotatedCorners(bounds, rotationDeg))
    const bringToFront = (planOverlayState.layer as unknown as { bringToFront?: () => void }).bringToFront
    if(typeof bringToFront === 'function') bringToFront.call(planOverlayState.layer)
    debugPlan('applyOverlayBoundsImmediate', { bounds, rotationDeg })
  }
  if(pendingPlanOverlay){
    pendingPlanOverlay = { ...pendingPlanOverlay, bounds }
  }
}

const latLngToLatLon = (value: LatLngExpression): LatLon => {
  const latLng = L.latLng(value)
  return { lat: latLng.lat, lon: latLng.lng }
}

function computeBaseBoundsFromRotated(corners: RotatedOverlayCorners, rotationDeg: number): PlanOverlayBounds {
  const angleRad = (rotationDeg || 0) * Math.PI / 180
  const nwLL = L.latLng(corners.nw)
  const neLL = L.latLng(corners.ne)
  const swLL = L.latLng(corners.sw)
  const seLL = L.latLng(corners.se)
  if(Math.abs(angleRad) < 1e-8){
    return {
      nw: { lat: nwLL.lat, lon: nwLL.lng },
      ne: { lat: neLL.lat, lon: neLL.lng },
      sw: { lat: swLL.lat, lon: swLL.lng },
      se: { lat: seLL.lat, lon: seLL.lng },
    }
  }
  const nw = projectLatLon(nwLL.lat, nwLL.lng)
  const ne = projectLatLon(neLL.lat, neLL.lng)
  const sw = projectLatLon(swLL.lat, swLL.lng)
  const se = projectLatLon(seLL.lat, seLL.lng)
  const center = {
    x: (nw.x + ne.x + sw.x + se.x) / 4,
    y: (nw.y + ne.y + sw.y + se.y) / 4,
  }
  const inverseAngle = -angleRad
  const rawNw = unprojectToLatLon(rotatePoint(nw, center, inverseAngle))
  const rawNe = unprojectToLatLon(rotatePoint(ne, center, inverseAngle))
  const rawSw = unprojectToLatLon(rotatePoint(sw, center, inverseAngle))
  const rawSe = unprojectToLatLon(rotatePoint(se, center, inverseAngle))
  return {
    nw: rawNw,
    ne: rawNe,
    sw: rawSw,
    se: rawSe,
  }
}

function ensurePlanHandleLayer(): ReturnType<typeof L.layerGroup> | null {
  if(!map) return null
  if(!planHandleLayer){
    planHandleLayer = L.featureGroup([], { pane: PLAN_HANDLE_PANE }).addTo(map)
    debugPlan('created plan handle layer', planHandleLayer)
  }
  return planHandleLayer
}

function isAltGesture(event?: LeafletMouseEvent): boolean {
  if(event && event.originalEvent && typeof (event.originalEvent as MouseEvent).altKey === 'boolean'){
    if((event.originalEvent as MouseEvent).altKey) return true
  }
  return altKeyDown
}

function stopDomEvent(e?: Event): void {
  if(!e) return
  try{
    L.DomEvent.stop(e)
  }catch{}
}

function clearPlanOverlayHandles(): void {
  debugPlan('clearPlanOverlayHandles')
  if(planHandleLayer && map){
    planHandleLayer.clearLayers()
    map.removeLayer(planHandleLayer)
  }
  planHandleLayer = null
  for(const key of PLAN_HANDLE_KEYS){
    const marker = planHandleMarkers[key]
    if(marker){
      marker.off('dragstart')
      marker.off('drag')
      marker.off('dragend')
      marker.off('mousedown')
    }
    delete planHandleMarkers[key]
  }
  const centerMarker = planHandleMarkers[PLAN_CENTER_KEY]
  if(centerMarker){
    centerMarker.off('dragstart')
    centerMarker.off('drag')
    centerMarker.off('dragend')
    centerMarker.off('mousedown')
  }
  delete planHandleMarkers[PLAN_CENTER_KEY]
  planHandleDragActive = false
  planHandleDragArmed = false
  releasePlanHandleDrag()
}

function handlePlanCornerDrag(key: CornerKey, latLng: L.LatLng): void {
  const plan = getPlanOverlayState()
  if(!plan.config) return
  debugPlan('handlePlanCenterDrag', { lat: latLng.lat, lon: latLng.lng })
  debugPlan('handlePlanCornerDrag', { key, lat: latLng.lat, lon: latLng.lng })
  const baseBounds = plan.currentBounds ?? plan.config.bounds
  if(!baseBounds) return
  const rotationRad = (plan.rotationDeg || 0) * Math.PI / 180

  const projectedBase: Record<CornerKey, MercPoint> = {
    nw: projectLatLon(baseBounds.nw.lat, baseBounds.nw.lon),
    ne: projectLatLon(baseBounds.ne.lat, baseBounds.ne.lon),
    sw: projectLatLon(baseBounds.sw.lat, baseBounds.sw.lon),
    se: projectLatLon(baseBounds.se.lat, baseBounds.se.lon),
  }
  const center = {
    x: (projectedBase.nw.x + projectedBase.ne.x + projectedBase.sw.x + projectedBase.se.x) / 4,
    y: (projectedBase.nw.y + projectedBase.ne.y + projectedBase.sw.y + projectedBase.se.y) / 4,
  }
  const originalCorner = projectedBase[key]
  const originalVec = {
    x: originalCorner.x - center.x,
    y: originalCorner.y - center.y,
  }
  const originalLen = Math.hypot(originalVec.x, originalVec.y)
  if(!Number.isFinite(originalLen) || originalLen < 1e-6){
    return
  }

  const targetProjectedRotated = projectLatLon(latLng.lat, latLng.lng)
  const targetProjectedBase = rotatePoint(targetProjectedRotated, center, -rotationRad)
  const targetVec = {
    x: targetProjectedBase.x - center.x,
    y: targetProjectedBase.y - center.y,
  }
  const targetLen = Math.hypot(targetVec.x, targetVec.y)
  if(!Number.isFinite(targetLen) || targetLen < 1e-6){
    return
  }
  let factor = targetLen / originalLen
  factor = Math.max(0.05, Math.min(10, factor))
  const prevScale = plan.scalePercent || 100
  scalePlanOverlayBy(factor)
  const nextScale = Math.max(SCALE_PERCENT_MIN, Math.min(SCALE_PERCENT_MAX, prevScale * factor))
  setPlanOverlayScalePercent(nextScale)
}

function handlePlanCenterDrag(latLng: L.LatLng): void {
  const plan = getPlanOverlayState()
  if(!plan.config) return
  const baseBounds = plan.currentBounds ?? plan.config.bounds
  if(!baseBounds) return
  const projectedBase: Record<CornerKey, MercPoint> = {
    nw: projectLatLon(baseBounds.nw.lat, baseBounds.nw.lon),
    ne: projectLatLon(baseBounds.ne.lat, baseBounds.ne.lon),
    sw: projectLatLon(baseBounds.sw.lat, baseBounds.sw.lon),
    se: projectLatLon(baseBounds.se.lat, baseBounds.se.lon),
  }
  const center = {
    x: (projectedBase.nw.x + projectedBase.ne.x + projectedBase.sw.x + projectedBase.se.x) / 4,
    y: (projectedBase.nw.y + projectedBase.ne.y + projectedBase.sw.y + projectedBase.se.y) / 4,
  }
  const target = projectLatLon(latLng.lat, latLng.lng)
  const delta = {
    x: target.x - center.x,
    y: target.y - center.y,
  }
  const nextBounds: PlanOverlayBounds = {
    nw: unprojectToLatLon({ x: projectedBase.nw.x + delta.x, y: projectedBase.nw.y + delta.y }),
    ne: unprojectToLatLon({ x: projectedBase.ne.x + delta.x, y: projectedBase.ne.y + delta.y }),
    sw: unprojectToLatLon({ x: projectedBase.sw.x + delta.x, y: projectedBase.sw.y + delta.y }),
    se: unprojectToLatLon({ x: projectedBase.se.x + delta.x, y: projectedBase.se.y + delta.y }),
  }
  setPlanOverlayBounds(nextBounds)
  applyOverlayBoundsImmediate(nextBounds, plan.rotationDeg || 0)
  debugPlan('handlePlanCenterDrag:applied', nextBounds)
}

function updatePlanOverlayHandles(): void {
  if(!map){
    clearPlanOverlayHandles()
    return
  }
  const plan = getPlanOverlayState()
  if(!plan.editable || !plan.enabled || !plan.config){
    clearPlanOverlayHandles()
    return
  }
  const baseBounds = plan.currentBounds ?? plan.config.bounds
  if(!baseBounds){
    clearPlanOverlayHandles()
    return
  }
  debugPlan('updatePlanOverlayHandles', { editable: plan.editable, enabled: plan.enabled })
  const layer = ensurePlanHandleLayer()
  if(!layer){
    clearPlanOverlayHandles()
    return
  }
  const actualCorners = computeRotatedCorners(baseBounds, plan.rotationDeg)
  for(const key of PLAN_HANDLE_KEYS){
    const corner = latLngToLatLon(actualCorners[key])
    const latLng = L.latLng(corner.lat, corner.lon)
    let marker = planHandleMarkers[key]
    if(!marker){
      debugPlan('create corner handle', key, latLng)
      marker = L.marker(latLng, {
        pane: PLAN_HANDLE_PANE,
        draggable: true,
        zIndexOffset: 1000,
        icon: L.divIcon({
          className: 'plan-handle',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      })
        let startLatLng: L.LatLng | null = null
        marker.on('mousedown', (event: LeafletMouseEvent) => {
          const altHeld = altModifierActive(event.originalEvent)
          planHandleDragArmed = altHeld
          planHandleDragActive = altHeld
          planHandleActiveKey = altHeld ? key : null
          debugPlan('corner:mousedown', key, { altHeld })
          if(altHeld){
            stopDomEvent(event.originalEvent)
            disableMapInteractions()
          }else{
            enableMapInteractions()
          }
        })
        marker.on('dragstart', (event: L.LeafletEvent & { target: L.Marker; originalEvent?: Event }) => {
          startLatLng = event.target.getLatLng()
          const altHeld = planHandleDragArmed || altModifierActive(event.originalEvent)
          planHandleActiveKey = altHeld ? key : null
          debugPlan('corner:dragstart', key, { altHeld })
          if(!altHeld){
            const target = event.target
            target.setLatLng(startLatLng ?? latLng)
            planHandleDragActive = false
            planHandleDragArmed = false
            enableMapInteractions()
            return
          }
          planHandleDragArmed = true
          planHandleDragActive = true
          if(event.originalEvent){
            stopDomEvent(event.originalEvent)
          }
          disableMapInteractions()
        })
        marker.on('drag', (event: L.LeafletEvent & { target: L.Marker; originalEvent?: Event }) => {
          if(!planHandleDragArmed){
            if(!altModifierActive(event.originalEvent)) return
            planHandleDragArmed = true
            planHandleDragActive = true
            if(event.originalEvent){
              stopDomEvent(event.originalEvent)
            }
            disableMapInteractions()
          }
          const target = event.target
          debugPlan('corner:drag', key, target.getLatLng())
          handlePlanCornerDrag(key, target.getLatLng())
        })
        marker.on('dragend', (event: L.LeafletEvent & { target: L.Marker; originalEvent?: Event }) => {
          if(planHandleDragArmed){
            const target = event.target
            handlePlanCornerDrag(key, target.getLatLng())
            updatePlanOverlayHandles()
          }else{
            const target = event.target
            target.setLatLng(startLatLng ?? latLng)
          }
          debugPlan('corner:dragend', key, { armed: planHandleDragArmed })
          startLatLng = null
          planHandleActiveKey = null
          releasePlanHandleDrag()
        })
        marker.addTo(layer)
        planHandleMarkers[key] = marker
      }
      if(!planHandleDragActive || planHandleActiveKey !== key){
        marker.setLatLng(latLng)
    }
    if(!layer.hasLayer(marker)){
      marker.addTo(layer)
    }
  }
  const actualCornerMercs = [actualCorners.nw, actualCorners.ne, actualCorners.sw, actualCorners.se]
    .map(latLngToLatLon)
    .map(pt => projectLatLon(pt.lat, pt.lon))
  const sumCenter = actualCornerMercs.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 })
  const avgCenter = { x: sumCenter.x / actualCornerMercs.length, y: sumCenter.y / actualCornerMercs.length }
  const centerLatLon = unprojectToLatLon(avgCenter)
  const centerAnchor = L.latLng(centerLatLon.lat, centerLatLon.lon)
  let centerMarker = planHandleMarkers[PLAN_CENTER_KEY]
  if(!centerMarker){
    debugPlan('create centre handle', centerAnchor)
    centerMarker = L.marker(centerAnchor, {
      pane: PLAN_HANDLE_PANE,
      draggable: true,
      zIndexOffset: 1000,
      icon: L.divIcon({
        className: 'plan-handle plan-handle-center',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    })
    let centerStartLatLng: L.LatLng | null = null
    centerMarker.on('mousedown', (event: LeafletMouseEvent) => {
      const altHeld = altModifierActive(event.originalEvent)
      planHandleDragArmed = altHeld
      planHandleDragActive = altHeld
      planHandleActiveKey = altHeld ? PLAN_CENTER_KEY : null
      debugPlan('center:mousedown', { altHeld })
      if(altHeld){
        stopDomEvent(event.originalEvent)
        disableMapInteractions()
      }else{
        enableMapInteractions()
      }
    })
    centerMarker.on('dragstart', (event: L.LeafletEvent & { target: L.Marker; originalEvent?: Event }) => {
      centerStartLatLng = event.target.getLatLng()
      const altHeld = planHandleDragArmed || altModifierActive(event.originalEvent)
      planHandleActiveKey = altHeld ? PLAN_CENTER_KEY : null
      debugPlan('center:dragstart', { altHeld })
      if(!altHeld){
        const target = event.target
        target.setLatLng(centerStartLatLng ?? centerAnchor)
        planHandleDragActive = false
        planHandleDragArmed = false
        enableMapInteractions()
        return
      }
      planHandleDragArmed = true
      planHandleDragActive = true
    if(event.originalEvent){
      stopDomEvent(event.originalEvent)
    }
    disableMapInteractions()
    debugPlan('center:drag enabling', planHandleDragArmed)
  })
  centerMarker.on('drag', (event: L.LeafletEvent & { target: L.Marker; originalEvent?: Event }) => {
    if(!planHandleDragArmed){
      if(!altModifierActive(event.originalEvent)) return
      planHandleDragArmed = true
        planHandleDragActive = true
        if(event.originalEvent){
          stopDomEvent(event.originalEvent)
      }
      disableMapInteractions()
      debugPlan('center:drag enabling late', true)
    }
    const target = event.target
    debugPlan('center:drag', target.getLatLng())
    handlePlanCenterDrag(target.getLatLng())
  })
    centerMarker.on('dragend', (event: L.LeafletEvent & { target: L.Marker; originalEvent?: Event }) => {
      if(planHandleDragArmed){
        const target = event.target
        handlePlanCenterDrag(target.getLatLng())
        updatePlanOverlayHandles()
      }else{
        centerMarker?.setLatLng(centerStartLatLng ?? centerAnchor)
      }
      debugPlan('center:dragend', { armed: planHandleDragArmed })
      centerStartLatLng = null
      planHandleActiveKey = null
      releasePlanHandleDrag()
    })
    centerMarker.addTo(layer)
    planHandleMarkers[PLAN_CENTER_KEY] = centerMarker
  }
  if(centerMarker && (!planHandleDragActive || planHandleActiveKey !== PLAN_CENTER_KEY)){
    centerMarker.setLatLng(centerAnchor)
  }
  if(centerMarker && !layer.hasLayer(centerMarker)){
    centerMarker.addTo(layer)
  }
  const bringHandlesFront = (layer as unknown as { bringToFront?: () => void }).bringToFront
  if(typeof bringHandlesFront === 'function') bringHandlesFront.call(layer)
}

function syncPlanOverlayLayer(): void {
  if(!map){
    clearPlanOverlayHandles()
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
      updatePlanOverlayHandles()
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
  updatePlanOverlayHandles()
}

function clearPlanOverlayLayer(): void {
  if(map && planOverlayState){
    map.removeLayer(planOverlayState.layer)
  }
  planOverlayState = null
  clearPlanOverlayHandles()
}

export function applyPlanOverlay(options: PlanOverlayOptions | null): void {
  if(!options){
    debugPlan('applyPlanOverlay', 'clear')
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
  debugPlan('applyPlanOverlay', normalized)
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
    debugPlan('applyPlanOverlay:createLayer', normalized)
    updatePlanOverlayHandles()
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
  debugPlan('applyPlanOverlay:updateExisting', normalized)
  updatePlanOverlayHandles()
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
  updatePlanOverlayHandles()
}

export function scalePlanOverlayBy(factor: number): void {
  if(!Number.isFinite(factor) || factor <= 0){
    return
  }
  debugPlan('scalePlanOverlayBy', { factor })
  const plan = getPlanOverlayState()
  if(!plan.config) return
  const baseBounds = plan.currentBounds ?? plan.config.bounds
  if(!baseBounds) return

  const projectedBase: Record<CornerKey, MercPoint> = {
    nw: projectLatLon(baseBounds.nw.lat, baseBounds.nw.lon),
    ne: projectLatLon(baseBounds.ne.lat, baseBounds.ne.lon),
    sw: projectLatLon(baseBounds.sw.lat, baseBounds.sw.lon),
    se: projectLatLon(baseBounds.se.lat, baseBounds.se.lon),
  }
  const center = {
    x: (projectedBase.nw.x + projectedBase.ne.x + projectedBase.sw.x + projectedBase.se.x) / 4,
    y: (projectedBase.nw.y + projectedBase.ne.y + projectedBase.sw.y + projectedBase.se.y) / 4,
  }
  const nextBounds: PlanOverlayBounds = {
    nw: unprojectToLatLon({ x: center.x + (projectedBase.nw.x - center.x) * factor, y: center.y + (projectedBase.nw.y - center.y) * factor }),
    ne: unprojectToLatLon({ x: center.x + (projectedBase.ne.x - center.x) * factor, y: center.y + (projectedBase.ne.y - center.y) * factor }),
    sw: unprojectToLatLon({ x: center.x + (projectedBase.sw.x - center.x) * factor, y: center.y + (projectedBase.sw.y - center.y) * factor }),
    se: unprojectToLatLon({ x: center.x + (projectedBase.se.x - center.x) * factor, y: center.y + (projectedBase.se.y - center.y) * factor }),
  }
  setPlanOverlayBounds(nextBounds)
  applyOverlayBoundsImmediate(nextBounds, plan.rotationDeg || 0)
  debugPlan('handlePlanCenterDrag:applied', nextBounds)
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

    try{
      const panes = map.getPanes()
      if(!panes[PLAN_HANDLE_PANE]){
        const pane = map.createPane(PLAN_HANDLE_PANE)
        pane.style.zIndex = '850'
        pane.style.pointerEvents = 'auto'
        debugPlan('initMap: created handle pane', pane)
      }
    }catch(err){
      console.warn('plan handle pane creation failed', err)
    }

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
