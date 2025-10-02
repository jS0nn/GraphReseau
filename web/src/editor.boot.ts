import { d3 } from './vendor.ts'
import { getGraph, saveGraph, getMode, getPlanOverlayConfig, fetchPlanOverlayMedia, savePlanOverlayConfig, deletePlanOverlayConfig } from './api.ts'
import { toJSON } from './exports.ts'
import { $$ } from './utils.ts'
import { initCanvas } from './render/canvas.ts'
import { renderNodes } from './render/render-nodes.ts'
import { NODE_SIZE } from './constants/nodes.ts'
import { renderEdges } from './render/render-edges.ts'
import { renderInline } from './render/render-inline.ts'
import { autoLayout } from './layout.ts'
import { initLogsUI, log, wireStateLogs, initDevErrorHooks } from './ui/logs.ts'
import { initForms } from './ui/forms.ts'
import { showModeHelp } from './ui/mode-help.ts'
import { initModesUI } from './modes.ts'
import { initPlanImportUI } from './ui/plan-import.ts'
import { initMap, fitMapToNodes, syncGeoProjection, getMap, applyPlanOverlay, updatePlanOverlayOpacity as mapSetPlanOpacity, updatePlanOverlayRotation as mapSetPlanRotation } from './map.ts'
import { state, setGraph, getGraph as getStateGraph, subscribe, selectNodeById, selectEdgeById, copySelection, pasteClipboard, removeEdge, removeNodes, removeNode, addNode, setMode, setViewMode, getViewMode, setPlanOverlayData, setPlanOverlayLoading, setPlanOverlayError, setPlanOverlayEnabled, setPlanOverlayOpacity, setPlanOverlayRotation, setPlanOverlayUseTransparent, setPlanOverlayEditable, setPlanOverlaySaving, markPlanOverlaySaved, getPlanOverlayState } from './state/index.ts'
import { createHistory } from './state/history.ts'
import { attachNodeDrag } from './interactions/drag.ts'
import { attachSelection } from './interactions/selection.ts'
import { attachMarquee } from './interactions/marquee.ts'
import { attachDraw } from './interactions/draw.ts'
import { attachEditGeometry } from './interactions/edit-geometry.ts'
import { attachJunction } from './interactions/junction.ts'
import type { Graph } from './types/graph'
import type { MutableNode } from './state/normalize.ts'
import type { PlanOverlayBounds } from './types/plan-overlay.ts'

type CanvasHandles = ReturnType<typeof initCanvas>
type GraphSnapshot = Graph

const DEV_BUILD = (typeof __DEV__ !== 'undefined' && __DEV__ === true)
const PLAN_ROTATION_STEP = 5
const PLAN_ROTATION_MIN = -180
const PLAN_ROTATION_MAX = 180

let planTransparentObjectUrl: string | null = null
let planOriginalObjectUrl: string | null = null
const restoredPlanPrefs = new Set<string>()
let isRestoringPlanPrefs = false

let planControlsEl: HTMLElement | null = null
let planToolsEl: HTMLElement | null = null
let planToggleBtn: HTMLButtonElement | null = null
let planImportBtn: HTMLButtonElement | null = null
let planOpacityRange: HTMLInputElement | null = null
let planOpacityValue: HTMLElement | null = null
let planRotationRange: HTMLInputElement | null = null
let planRotationInput: HTMLInputElement | null = null
let planRotateLeftBtn: HTMLButtonElement | null = null
let planRotateRightBtn: HTMLButtonElement | null = null
let planRotateResetBtn: HTMLButtonElement | null = null
let planStatusEl: HTMLElement | null = null
let planWhiteToggleBtn: HTMLButtonElement | null = null
let planSaveBoundsBtn: HTMLButtonElement | null = null
let planDeleteBtn: HTMLButtonElement | null = null

const getPlanState = getPlanOverlayState

const debugPlanUi = DEV_BUILD
  ? (...args: unknown[]): void => {
      try{
        if(typeof console === 'undefined') return
        const g = typeof window !== 'undefined' ? (window as { __PLAN_DEBUG?: boolean }) : null
        if(g && g.__PLAN_DEBUG !== true) return
        console.debug('[plan:ui]', ...args)
      }catch{}
    }
  : () => {}

function activePlanUrl(plan = getPlanOverlayState()): string | null {
  const transparent = plan.imageTransparentUrl
  const original = plan.imageOriginalUrl
  if(plan.useTransparent){
    return transparent || original
  }
  return original || transparent
}

if(typeof window !== 'undefined'){
  window.addEventListener('beforeunload', () => {
    if(planTransparentObjectUrl){
      try{ URL.revokeObjectURL(planTransparentObjectUrl) }catch{}
      planTransparentObjectUrl = null
    }
    if(planOriginalObjectUrl){
      try{ URL.revokeObjectURL(planOriginalObjectUrl) }catch{}
      planOriginalObjectUrl = null
    }
  })
}

function ensureHUD(): HTMLDivElement | null {
  if(!DEV_BUILD) return null
  let hud = document.getElementById('hud')
  if(!hud){
    hud = document.createElement('div')
    hud.id = 'hud'
    document.body.appendChild(hud)
  }
  return hud as HTMLDivElement
}

function adjustWrapTop(): void {
  try{
    const bar = document.getElementById('appbar')
    const h = Math.ceil(bar?.getBoundingClientRect().height || 70)
    document.documentElement.style.setProperty('--appbar-height', h+'px')
  }catch{}
}

function updateHUD(): void {
  if(!DEV_BUILD) return
  const hud = ensureHUD()
  if(!hud) return
  hud.textContent = `${state.nodes.length} nœuds • ${state.edges.length} arêtes`
}

function setStatus(msg: string | null | undefined): void {
  const el = document.getElementById('status')
  if(el) el.textContent = msg || ''
}

async function loadPlanOverlayAssets(): Promise<void> {
  setPlanOverlayLoading(true)
  setPlanOverlayError(null)
  try{
    const config = await getPlanOverlayConfig()
    if(!config){
      const prevTransparent = planTransparentObjectUrl
      const prevOriginal = planOriginalObjectUrl
      planTransparentObjectUrl = null
      planOriginalObjectUrl = null
      setPlanOverlayData(null)
      if(prevTransparent){ try{ URL.revokeObjectURL(prevTransparent) }catch{} }
      if(prevOriginal){ try{ URL.revokeObjectURL(prevOriginal) }catch{} }
      return
    }

    const [transparentMedia, originalMedia] = await Promise.all([
      fetchPlanOverlayMedia({ transparent: true }).catch((err) => {
        console.warn('[plan] transparent fetch failed', err)
        return null
      }),
      fetchPlanOverlayMedia({ transparent: false }).catch((err) => {
        console.warn('[plan] original fetch failed', err)
        return null
      }),
    ])

    const nextTransparentUrl = transparentMedia ? URL.createObjectURL(transparentMedia.blob) : null
    const nextOriginalUrl = originalMedia ? URL.createObjectURL(originalMedia.blob) : null

    if(!nextTransparentUrl && !nextOriginalUrl){
      throw new Error('Plan indisponible pour ce site')
    }

    const prevTransparent = planTransparentObjectUrl
    const prevOriginal = planOriginalObjectUrl

    planTransparentObjectUrl = nextTransparentUrl
    planOriginalObjectUrl = nextOriginalUrl

    if(prevTransparent && prevTransparent !== nextTransparentUrl){
      try{ URL.revokeObjectURL(prevTransparent) }catch{}
    }
    if(prevOriginal && prevOriginal !== nextOriginalUrl){
      try{ URL.revokeObjectURL(prevOriginal) }catch{}
    }

    setPlanOverlayData(config, { transparentUrl: nextTransparentUrl, originalUrl: nextOriginalUrl })
  }catch(err){
    console.error('[plan] load failed', err)
    const message = err instanceof Error ? err.message : String(err)
    setPlanOverlayError(message)
    setPlanOverlayData(null)
    if(planTransparentObjectUrl){
      try{ URL.revokeObjectURL(planTransparentObjectUrl) }catch{}
      planTransparentObjectUrl = null
    }
    if(planOriginalObjectUrl){
      try{ URL.revokeObjectURL(planOriginalObjectUrl) }catch{}
      planOriginalObjectUrl = null
    }
  }finally{
    setPlanOverlayLoading(false)
  }
}

async function saveCurrentPlanBounds(): Promise<void> {
  const plan = getPlanOverlayState()
  if(plan.saving) return
  if(!plan.config || !plan.currentBounds){
    if(planStatusEl){
      planStatusEl.textContent = 'Aucun plan à enregistrer'
    }
    return
  }
  const boundsPayload = JSON.parse(JSON.stringify(plan.currentBounds)) as PlanOverlayBounds
  setPlanOverlaySaving(true)
  updatePlanControlsUI()
  let statusMessage: string | null = null
  try{
    const updated = await savePlanOverlayConfig({
      bounds: boundsPayload,
      rotation_deg: plan.rotationDeg,
    })
    const transparentUrl = plan.imageTransparentUrl
    const originalUrl = plan.imageOriginalUrl
    setPlanOverlayData(updated, { transparentUrl, originalUrl })
    markPlanOverlaySaved(updated.bounds)
    statusMessage = 'Plan enregistré'
  }catch(err){
    console.error('[plan] save failed', err)
    const message = err instanceof Error ? err.message : String(err)
    statusMessage = `Erreur sauvegarde plan: ${message}`
  }finally{
    setPlanOverlaySaving(false)
    updatePlanControlsUI()
    if(statusMessage && planStatusEl){
      planStatusEl.textContent = statusMessage
    }
  }
}

async function deleteCurrentPlan(): Promise<void> {
  const current = getPlanOverlayState()
  if(current.loading) return
  if(!current.config){
    if(planStatusEl) planStatusEl.textContent = 'Aucun plan à supprimer'
    return
  }
  const confirmed = typeof window !== 'undefined' ? window.confirm('Supprimer le plan actuel ? Cette action efface la configuration dans Sheets.') : true
  if(!confirmed) return
  setPlanOverlayLoading(true)
  updatePlanControlsUI()
  let statusMessage: string | null = null
  try{
    await deletePlanOverlayConfig()
    if(planTransparentObjectUrl){
      try{ URL.revokeObjectURL(planTransparentObjectUrl) }catch{}
      planTransparentObjectUrl = null
    }
    if(planOriginalObjectUrl){
      try{ URL.revokeObjectURL(planOriginalObjectUrl) }catch{}
      planOriginalObjectUrl = null
    }
    setPlanOverlayError(null)
    setPlanOverlayData(null)
    applyPlanOverlay(null)
    savePlanOverlayPreferences()
    statusMessage = 'Plan supprimé'
  }catch(err){
    console.error('[plan] delete failed', err)
    const message = err instanceof Error ? err.message : String(err)
    setPlanOverlayError(message)
    statusMessage = `Erreur suppression plan: ${message}`
  }finally{
    setPlanOverlayLoading(false)
    updatePlanControlsUI()
    if(statusMessage && planStatusEl){
      planStatusEl.textContent = statusMessage
    }
  }
}

function planStoragePrefix(): string | null {
  const plan = getPlanOverlayState()
  const planId = plan.planId
  if(!planId) return null
  return `planOverlay:${planId}:`
}

function savePlanOverlayPreferences(): void {
  if(isRestoringPlanPrefs) return
  const prefix = planStoragePrefix()
  if(!prefix) return
  const plan = getPlanState()
  try{
    localStorage.setItem(`${prefix}opacity`, plan.opacity.toString())
    localStorage.setItem(`${prefix}rotation`, plan.rotationDeg.toString())
    localStorage.setItem(`${prefix}enabled`, plan.enabled ? '1' : '0')
    localStorage.setItem(`${prefix}mode`, plan.useTransparent ? '1' : '0')
  }catch{}
}

function restorePlanOverlayPreferences(): void {
  const plan = getPlanState()
  const planId = plan.planId
  if(!planId || restoredPlanPrefs.has(planId)) return
  const prefix = planStoragePrefix()
  if(!prefix) return
  isRestoringPlanPrefs = true
  try{
    const storedOpacity = localStorage.getItem(`${prefix}opacity`)
    if(storedOpacity !== null){
      const value = Number(storedOpacity)
      if(Number.isFinite(value)) setPlanOverlayOpacity(value)
    }
    const storedRotation = localStorage.getItem(`${prefix}rotation`)
    if(storedRotation !== null){
      const value = Number(storedRotation)
      if(Number.isFinite(value)) setPlanOverlayRotation(value)
    }
    const storedEnabled = localStorage.getItem(`${prefix}enabled`)
    if(storedEnabled !== null){
      setPlanOverlayEnabled(storedEnabled === '1')
    }
    const storedMode = localStorage.getItem(`${prefix}mode`)
    if(storedMode !== null){
      setPlanOverlayUseTransparent(storedMode !== '0')
    }
  }catch{}
  isRestoringPlanPrefs = false
  restoredPlanPrefs.add(planId)
}

function syncPlanOverlayWithMap(): void {
  const plan = getPlanOverlayState()
  const url = activePlanUrl(plan)
  debugPlanUi('syncPlanOverlayWithMap', { hasConfig: !!plan.config, enabled: plan.enabled, url })
  if(!plan.config || !url || !plan.enabled){
    applyPlanOverlay(null)
    return
  }
  applyPlanOverlay({
    url,
    bounds: plan.config.bounds,
    opacity: plan.opacity,
    rotationDeg: plan.rotationDeg,
  })
}

function updatePlanControlsUI(): void {
  if(!planControlsEl) return
  const plan = getPlanOverlayState()
  const canEditPlan = !!plan.editable
  const dirty = !!plan.dirty
  const saving = !!plan.saving
  const activeUrl = activePlanUrl(plan)
  const hasMedia = !!plan.config && !!(plan.imageTransparentUrl || plan.imageOriginalUrl)
  const hasConfig = !!plan.config && !!activeUrl && hasMedia
  planControlsEl.hidden = false
  planControlsEl.classList.toggle('loading', plan.loading)
  planControlsEl.classList.toggle('readonly', !canEditPlan)
  planControlsEl.classList.toggle('saving', saving)
  planControlsEl.classList.toggle('empty', !hasConfig)

  if(planImportBtn){
    planImportBtn.disabled = !!plan.loading
  }

  if(planToggleBtn){
    planToggleBtn.disabled = !hasConfig || plan.loading
    planToggleBtn.classList.toggle('active', !!plan.enabled)
    planToggleBtn.setAttribute('aria-pressed', plan.enabled ? 'true' : 'false')
    planToggleBtn.title = hasConfig ? (plan.enabled ? 'Masquer le plan' : 'Afficher le plan') : 'Aucun plan configuré'
  }

  const toolsVisible = !!(hasConfig && plan.enabled && !plan.loading && !plan.error)
  if(planToolsEl){
    planToolsEl.hidden = !toolsVisible
  }

  const opacityValue = Math.round(plan.opacity * 100)
  const rotationValue = Math.round(plan.rotationDeg)

  if(planOpacityRange){
    planOpacityRange.disabled = !toolsVisible
    planOpacityRange.value = String(opacityValue)
  }
  if(planOpacityValue){
    planOpacityValue.textContent = `${opacityValue}%`
  }
  if(planRotationRange){
    planRotationRange.disabled = !toolsVisible
    planRotationRange.value = String(rotationValue)
  }
  if(planRotationInput){
    planRotationInput.disabled = !toolsVisible
    planRotationInput.value = plan.rotationDeg.toFixed(1)
  }
  if(planRotateLeftBtn) planRotateLeftBtn.disabled = !toolsVisible
  if(planRotateRightBtn) planRotateRightBtn.disabled = !toolsVisible
  if(planRotateResetBtn){
    const defaultRotation = Number(plan.config?.defaults?.bearing_deg ?? 0)
    planRotateResetBtn.disabled = !toolsVisible
    planRotateResetBtn.title = toolsVisible ? `Réinitialiser (${Math.round(defaultRotation)}°)` : 'Réinitialiser l’orientation du plan'
  }

  if(planWhiteToggleBtn){
    const hasTransparent = !!plan.imageTransparentUrl
    const hasOriginal = !!plan.imageOriginalUrl
    const canToggleWhite = toolsVisible && hasTransparent && hasOriginal
    const btnVisible = toolsVisible && (hasTransparent || hasOriginal)
    planWhiteToggleBtn.hidden = !btnVisible
    planWhiteToggleBtn.disabled = !canToggleWhite
    const showActive = btnVisible && !plan.useTransparent
    planWhiteToggleBtn.classList.toggle('active', showActive)
    planWhiteToggleBtn.setAttribute('aria-pressed', showActive ? 'true' : 'false')
    planWhiteToggleBtn.title = canToggleWhite
      ? (plan.useTransparent ? 'Afficher le fond blanc' : 'Masquer le fond blanc')
      : 'Fond blanc indisponible'
  }

  if(planSaveBoundsBtn){
    const showSave = canEditPlan && hasConfig
    planSaveBoundsBtn.hidden = !showSave
    const disableSave = !showSave || !dirty || plan.loading || saving || !!plan.error
    planSaveBoundsBtn.disabled = disableSave
    planSaveBoundsBtn.classList.toggle('loading', saving)
    if(showSave){
      planSaveBoundsBtn.title = saving
        ? 'Sauvegarde du plan en cours…'
        : (dirty ? 'Enregistrer les coins du plan dans Sheets' : 'Aucune modification à enregistrer')
    }else{
      planSaveBoundsBtn.title = hasConfig ? 'Enregistrement indisponible en lecture seule' : 'Aucun plan configuré'
    }
  }

  if(planDeleteBtn){
    const showDelete = canEditPlan && hasConfig && !plan.loading
    planDeleteBtn.disabled = !showDelete
    planDeleteBtn.hidden = !showDelete
    if(!showDelete){
      planDeleteBtn.style.display = 'none'
    }else{
      planDeleteBtn.style.display = ''
    }
  }

  if(planStatusEl){
    let statusText = ''
    if(plan.loading){
      statusText = 'Chargement du plan…'
    }else if(plan.error){
      statusText = plan.error
    }else if(!hasConfig){
      statusText = 'Aucun plan configuré'
    }else if(saving){
      statusText = 'Sauvegarde du plan…'
    }else if(!plan.enabled){
      const name = plan.config?.display_name || 'Plan'
      statusText = `${name} (masqué)`
    }else if(dirty){
      const name = plan.config?.display_name || 'Plan'
      statusText = `${name} (modifications non sauvegardées)`
    }else{
      const name = plan.config?.display_name || 'Plan actif'
      const hasToggle = !!plan.imageTransparentUrl && !!plan.imageOriginalUrl
      const suffix = hasToggle ? (plan.useTransparent ? ' — fond blanc masqué' : ' — fond blanc affiché') : ''
      statusText = `${name}${suffix}`
    }
    if(statusText && !canEditPlan && !plan.loading && !plan.error){
      statusText += ' (lecture seule)'
    }
    planStatusEl.textContent = statusText
  }
}

function computeCanvasSafeArea(containerEl: HTMLElement | null): { left: number; right: number } {
  const width = containerEl?.clientWidth || 0
  const fallback = { left: 0, right: width }
  if(!containerEl || width <= 0) return fallback
  try{
    const propEl = document.getElementById('prop')
    if(!propEl) return fallback
    if(document.body.classList.contains('prop-collapsed')) return fallback
    const style = window.getComputedStyle(propEl)
    const opacity = parseFloat(style?.opacity || '1')
    if(!style || style.display === 'none' || style.visibility === 'hidden' || opacity <= 0){
      return fallback
    }
    const canvasRect = containerEl.getBoundingClientRect()
    const propRect = propEl.getBoundingClientRect()
    if(!canvasRect || !propRect) return fallback
    const overlapLeft = Math.max(canvasRect.left, propRect.left)
    const overlapRight = Math.min(canvasRect.right, propRect.right)
    const overlapWidth = Math.max(0, overlapRight - overlapLeft)
    if(overlapWidth < 1) return fallback
    const overlayStart = overlapLeft - canvasRect.left
    const overlayEnd = overlayStart + overlapWidth
    const canvasCenter = canvasRect.left + width / 2
    const propCenter = propRect.left + propRect.width / 2
    const propOnRight = propCenter >= canvasCenter
    let safeLeft = 0
    let safeRight = width

    if(propOnRight){
      safeRight = Math.max(0, overlayStart)
    }else{
      safeLeft = Math.min(width, overlayEnd)
    }

    safeLeft = Math.max(0, Math.min(safeLeft, width))
    safeRight = Math.max(0, Math.min(safeRight, width))

    if(safeRight - safeLeft < Math.max(80, width * 0.05)){
      return fallback
    }

    return { left: safeLeft, right: safeRight }
  }catch{}
  return fallback
}

function computeZoomFitTransform(containerEl: HTMLElement | null, nodes: MutableNode[]): { k: number; x: number; y: number } {
  const w = containerEl?.clientWidth ?? 1200
  const h = containerEl?.clientHeight ?? 800
  const M = 60 // margin around content
  const area = computeCanvasSafeArea(containerEl)
  const safeLeft = area.left
  const safeRight = Math.max(area.left, area.right)
  const safeWidth = Math.max(0, safeRight - safeLeft)
  const usableWidth = safeWidth > 0 ? safeWidth : w

  // Try to use actual rendered content bbox (nodes+edges), independent of current zoom
  try{
    const rootNode = document.getElementById('zoomRoot')
    const root = rootNode instanceof SVGGraphicsElement ? rootNode : null
    if(root){
      const prev = root.getAttribute('transform')
      if(prev) root.removeAttribute('transform')
      const bbox = root.getBBox() // may throw if nothing rendered
      if(prev) root.setAttribute('transform', prev)
      if(bbox && isFinite(bbox.width) && isFinite(bbox.height)){
        const minX = bbox.x - M
        const minY = bbox.y - M
        const bw = Math.max(1, bbox.width + 2*M)
        const bh = Math.max(1, bbox.height + 2*M)
        const scale = Math.min(usableWidth / bw, h / bh)
        const tx = safeLeft + (usableWidth - scale * bw)/2 - scale * minX
        const ty = (h - scale * bh)/2 - scale * minY
        return { k: scale, x: tx, y: ty }
      }
    }
  }catch{/* fallback to nodes extents below */}

  // Fallback: compute from node positions
  if(!nodes.length) return { k:1, x:0, y:0 }
  const valid = nodes.filter(n => Number.isFinite(Number(n?.x)) && Number.isFinite(Number(n?.y)))
  const base = valid.length ? valid : nodes
  const xs1 = base.map(n => Number(n?.x) || 0)
  const xs2 = base.map(n => (Number(n?.x) || 0) + NODE_SIZE.w)
  const ys1 = base.map(n => Number(n?.y) || 0)
  const ys2 = base.map(n => (Number(n?.y) || 0) + NODE_SIZE.h)
  const minX = Math.min(...xs1) - M
  const maxX = Math.max(...xs2) + M
  const minY = Math.min(...ys1) - M
  const maxY = Math.max(...ys2) + M
  const bw = Math.max(1, (maxX - minX))
  const bh = Math.max(1, (maxY - minY))
  const scale = Math.min(usableWidth / bw, h / bh)
  const tx = safeLeft + (usableWidth - scale * bw)/2 - scale * minX
  const ty = (h - scale * bh)/2 - scale * minY
  return { k: scale, x: tx, y: ty }
}

function bindToolbar(canvas: CanvasHandles): { updateGraphBtn: () => void } {
  const byId = (id: string) => document.getElementById(id)
  byId('themeBtn')?.addEventListener('click', ()=>{
    document.body.dataset.theme = (document.body.dataset.theme==='light' ? 'dark' : 'light')
    adjustWrapTop()
    // Re-render to apply theme-dependent styles (edge colors/widths)
    try{ renderAll(canvas) }catch{}
    try{ document.dispatchEvent(new CustomEvent('theme:change')) }catch{}
  })
  byId('zoomInBtn')?.addEventListener('click', ()=> canvas.zoomBy(canvas.zoomStep))
  byId('zoomOutBtn')?.addEventListener('click', ()=> canvas.zoomBy(1 / canvas.zoomStep))
  byId('zoomFitBtn')?.addEventListener('click', ()=> {
    if(window.__MAP_ACTIVE){
      try{ fitMapToNodes() }catch{}
    }else{
      const canvasEl = document.getElementById('canvas')
      const t = computeZoomFitTransform(canvasEl instanceof HTMLElement ? canvasEl : null, state.nodes as MutableNode[])
      const d3Instance = window.d3
      if(d3Instance){
        canvas.svg.transition().duration(220).call(canvas.zoom.transform, d3Instance.zoomIdentity.translate(t.x, t.y).scale(t.k))
      }
    }
  })
  byId('layoutBtn')?.addEventListener('click', async ()=>{ await autoLayout(state.nodes, state.edges); renderAll(canvas) })
  // Toggle variable edge thickness (by diameter)
  const thickBtnEl = byId('thicknessBtn')
  const thickBtn = thickBtnEl instanceof HTMLButtonElement ? thickBtnEl : null
  if(thickBtn){
    try{
      const saved = localStorage.getItem('edgeVarWidth')
      if(saved!=null) state.edgeVarWidth = (saved==='1' || saved==='true')
    }catch{}
    thickBtn.classList.toggle('active', !!state.edgeVarWidth)
    thickBtn.addEventListener('click', ()=>{
      state.edgeVarWidth = !state.edgeVarWidth
      thickBtn.classList.toggle('active', !!state.edgeVarWidth)
      try{ localStorage.setItem('edgeVarWidth', state.edgeVarWidth ? '1' : '0') }catch{}
      renderAll(canvas)
    })
  }
  byId('exportBtn')?.addEventListener('click', ()=> downloadJSON(toJSON(getStateGraph() as unknown as Graph), 'graph.tson'))
  const saveBtnEl = byId('saveBtn')
  const saveBtn = saveBtnEl instanceof HTMLButtonElement ? saveBtnEl : null
  if(getMode()==='ro'){ saveBtn?.classList.add('hidden') }
  saveBtn?.addEventListener('click', async ()=>{
    const g = getStateGraph() as unknown as Graph
    setStatus('Sauvegarde…')
    await saveGraph(g)
      .then(()=>{ setStatus('Sauvé.'); log('Graph sauvé') })
      .catch(err=>{ console.error(err); alert('Erreur de sauvegarde'); setStatus('Erreur sauvegarde'); log('Sauvegarde: erreur', 'error') })
  })
  // Map toggle
  const mapBtnEl = byId('mapToggleBtn')
  const mapBtn = mapBtnEl instanceof HTMLButtonElement ? mapBtnEl : null
  if(mapBtn){
    try{ const saved = localStorage.getItem('mapHidden'); if(saved==='1') document.body.classList.add('map-hidden') }catch{}
    mapBtn.classList.toggle('active', !document.body.classList.contains('map-hidden'))
    mapBtn.addEventListener('click', ()=>{
      const hidden = document.body.classList.toggle('map-hidden')
      mapBtn.classList.toggle('active', !hidden)
      try{ localStorage.setItem('mapHidden', hidden ? '1' : '0') }catch{}
      // Re-render to refresh overlay against background visibility
      renderAll(canvas)
    })
  }
  planControlsEl = document.getElementById('planControls')
  planToolsEl = document.getElementById('planTools')
  planToggleBtn = byId('planToggleBtn') as HTMLButtonElement | null
  planImportBtn = byId('planImportBtn') as HTMLButtonElement | null
  planOpacityRange = byId('planOpacityRange') as HTMLInputElement | null
  planOpacityValue = byId('planOpacityValue')
  planRotationRange = byId('planRotationRange') as HTMLInputElement | null
  planRotationInput = byId('planRotationInput') as HTMLInputElement | null
  planRotateLeftBtn = byId('planRotateLeftBtn') as HTMLButtonElement | null
  planRotateRightBtn = byId('planRotateRightBtn') as HTMLButtonElement | null
  planRotateResetBtn = byId('planRotateResetBtn') as HTMLButtonElement | null
  planStatusEl = byId('planStatus')
  planWhiteToggleBtn = byId('planWhiteToggleBtn') as HTMLButtonElement | null
  planSaveBoundsBtn = byId('planSaveBoundsBtn') as HTMLButtonElement | null
  planDeleteBtn = byId('planDeleteBtn') as HTMLButtonElement | null
  planToggleBtn?.addEventListener('click', () => {
    if(planToggleBtn?.disabled) return
    const plan = getPlanOverlayState()
    setPlanOverlayEnabled(!plan.enabled)
  })
  planOpacityRange?.addEventListener('input', (event) => {
    if(planOpacityRange?.disabled) return
    const value = Number((event.target as HTMLInputElement).value)
    if(Number.isFinite(value)) setPlanOverlayOpacity(value / 100)
  })
  planRotationRange?.addEventListener('input', (event) => {
    if(planRotationRange?.disabled) return
    const value = Number((event.target as HTMLInputElement).value)
    if(Number.isFinite(value)) setPlanOverlayRotation(value)
    if(planRotationInput){
      planRotationInput.value = String(value)
    }
  })
  planRotationInput?.addEventListener('change', (event) => {
    const input = planRotationInput
    if(!input || input.disabled) return
    const value = Number((event.target as HTMLInputElement).value)
    if(Number.isFinite(value)){
      const bounded = Math.max(PLAN_ROTATION_MIN, Math.min(PLAN_ROTATION_MAX, value))
      setPlanOverlayRotation(bounded)
      if(planRotationRange){
        planRotationRange.value = String(Math.round(bounded))
      }
      input.value = bounded.toFixed(1)
    }
  })
  planRotateLeftBtn?.addEventListener('click', () => {
    if(planRotateLeftBtn?.disabled) return
    const plan = getPlanOverlayState()
    setPlanOverlayRotation(plan.rotationDeg - PLAN_ROTATION_STEP)
  })
  planRotateRightBtn?.addEventListener('click', () => {
    if(planRotateRightBtn?.disabled) return
    const plan = getPlanOverlayState()
    setPlanOverlayRotation(plan.rotationDeg + PLAN_ROTATION_STEP)
  })
  planRotateResetBtn?.addEventListener('click', () => {
    if(planRotateResetBtn?.disabled) return
    const plan = getPlanOverlayState()
    const defaultRotation = Number(plan.config?.defaults?.bearing_deg ?? 0)
    setPlanOverlayRotation(defaultRotation)
  })
  planWhiteToggleBtn?.addEventListener('click', () => {
    if(planWhiteToggleBtn?.disabled) return
    const plan = getPlanOverlayState()
    setPlanOverlayUseTransparent(!plan.useTransparent)
  })
  planSaveBoundsBtn?.addEventListener('click', () => {
    if(planSaveBoundsBtn?.disabled) return
    void saveCurrentPlanBounds()
  })
  planDeleteBtn?.addEventListener('click', () => {
    if(planDeleteBtn?.disabled) return
    void deleteCurrentPlan()
  })
  let graphBtn: HTMLButtonElement | null = null
  function updateGraphBtn(): void {
    if(!graphBtn) return
    const isGraph = getViewMode() === 'graph'
    graphBtn.classList.toggle('active', isGraph)
    graphBtn.setAttribute('aria-pressed', isGraph ? 'true' : 'false')
    graphBtn.title = isGraph ? 'Vue graphe (cliquer pour revenir au terrain)' : 'Vue terrain (cliquer pour vue graphe)'
  }
  if(DEV_BUILD){
    const existingGraphBtn = document.getElementById('graphViewBtn')
    graphBtn = existingGraphBtn instanceof HTMLButtonElement ? existingGraphBtn : null
    if(!graphBtn){
      graphBtn = document.createElement('button')
      graphBtn.id = 'graphViewBtn'
      graphBtn.type = 'button'
      graphBtn.className = 'btn'
      graphBtn.innerHTML = '<i class="uil uil-sitemap"></i> Graphe'
      mapBtn?.insertAdjacentElement('afterend', graphBtn)
    }
    graphBtn.addEventListener('click', ()=>{
      const next = getViewMode() === 'graph' ? 'geo' : 'graph'
      setViewMode(next)
    })
    updateGraphBtn()
  }
  updatePlanControlsUI()
  initPlanImportUI({
    trigger: planImportBtn,
    onPlanImported: async () => {
      planStatusEl && (planStatusEl.textContent = 'Chargement du plan…')
      await loadPlanOverlayAssets()
      updatePlanControlsUI()
    },
    setStatus: (message) => {
      if(planStatusEl) planStatusEl.textContent = message
    },
  })
  byId('loadBtn')?.addEventListener('click', async ()=>{
    try{
      setStatus('Chargement…')
      const g = await getGraph()
      setGraph(g)
      await loadPlanOverlayAssets()
      setStatus('Chargé')
    }catch(err){
      console.error('[dev] load failed', err)
      setStatus('Erreur de chargement')
      alert('Erreur de chargement du graphe. Vérifie la connexion et les paramètres.')
    }
  })
  // Help dialog
  const helpBtnNode = byId('helpBtn')
  const helpBtn = helpBtnNode instanceof HTMLButtonElement ? helpBtnNode : null
  const helpDlgNode = document.getElementById('helpDlg')
  const helpDlg = helpDlgNode instanceof HTMLDialogElement ? helpDlgNode : null
  const helpCloseNode = document.getElementById('helpCloseBtn')
  const helpClose = helpCloseNode instanceof HTMLButtonElement ? helpCloseNode : null
  if(helpBtn && helpDlg && 'showModal' in helpDlg){ helpBtn.onclick = ()=> helpDlg.showModal() }
  if(helpClose && helpDlg){ helpClose.onclick = ()=> helpDlg.close() }

  // Add menu (basic: add a node of selected type)
  const addBtnNode = byId('addBtn')
  const addMenuNode = byId('addMenu')
  const addBtn = addBtnNode instanceof HTMLButtonElement ? addBtnNode : null
  const addMenu = addMenuNode instanceof HTMLElement ? addMenuNode : null
  if(addBtn && addMenu){
    addBtn.onclick = ()=> addMenu.classList.toggle('open')
    addMenu.querySelectorAll('[data-add]')?.forEach(item=>{
      item.addEventListener('click', ()=>{
        addMenu.classList.remove('open')
        const type = (item.getAttribute('data-add') || 'OUVRAGE').toUpperCase()
        const node = addNode({ type })
        selectNodeById(node.id)
      })
    })
    // Close when clicking outside
    document.addEventListener('click', (e: MouseEvent)=>{
      const target = e.target instanceof Node ? e.target : null
      if(target && !addBtn.contains(target) && !addMenu.contains(target)) addMenu.classList.remove('open')
    })
  }
  return { updateGraphBtn }
}

function downloadJSON(obj: unknown, name: string): void {
  const blob = new Blob([ JSON.stringify(obj, null, 2) ], { type:'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

let pushAfterDrag: () => void = ()=>{}
let zoomFitTimer: ReturnType<typeof setTimeout> | null = null

function suppressNextMapAutoFit(): void {
  if(typeof globalThis === 'undefined') return
  globalThis.__MAP_SUPPRESS_AUTOFIT = true
}

function applyZoomFit(canvas: CanvasHandles): void {
  const canvasEl = document.getElementById('canvas')
  const t = computeZoomFitTransform(canvasEl instanceof HTMLElement ? canvasEl : null, state.nodes as MutableNode[])
  const d3Instance = window.d3
  if(d3Instance){
    canvas.svg.transition().duration(220).call(canvas.zoom.transform, d3Instance.zoomIdentity.translate(t.x, t.y).scale(t.k))
  }
}

function requestZoomFit(canvas: CanvasHandles, delay = 180): void {
  if(zoomFitTimer) clearTimeout(zoomFitTimer)
  zoomFitTimer = setTimeout(()=> applyZoomFit(canvas), delay)
}

function renderAll(canvas: CanvasHandles): void {
  renderEdges(canvas.gEdges, state.edges)
  renderNodes(canvas.gNodes, state.nodes)
  renderInline(canvas.gInline)
  // Re-attach edit handlers so new edges get click listeners
  attachEditGeometry(canvas.gEdges)
  updateHUD()
  // Re-attach interactions to updated selections
  attachSelection(canvas.gNodes, canvas.gEdges)
  attachNodeDrag(canvas.gNodes, ()=> pushAfterDrag())
}

function attachInteractions(canvas: CanvasHandles): void {
  // Selection on background
  const canvasNode = document.getElementById('canvas')
  canvasNode?.addEventListener('click', (e: MouseEvent)=>{
    // If a marquee or drag just finished, ignore this background click (debounce)
    if(window.__squelchCanvasClick){ window.__squelchCanvasClick = false; return }
    const target = e.target instanceof Element ? e.target : null
    if(target?.closest('g.node, g.edge')) return
    selectNodeById(null); selectEdgeById(null)
  })

  function deleteSelection(): void {
    // Edge selected
    if(state.selection.edgeId){
      const ok = confirm('Supprimer cette arête ?')
      if(!ok) return
      removeEdge(state.selection.edgeId)
      selectEdgeById(null)
      setStatus('Arête supprimée')
      return
    }
    // Multiple nodes
    const ids = Array.from(state.selection.multi||[])
    if(ids.length>1){
      const ok = confirm(`Supprimer ${ids.length} élément(s) et leurs liens ?`)
      if(!ok) return
      removeNodes(ids)
      selectNodeById(null)
      setStatus('Sélection supprimée')
      return
    }
    // Single node
    const nid = state.selection.nodeId
    if(nid){
      const n = state.nodes.find(x=>x.id===nid)
      const ok = confirm(`Supprimer ${n?.name||n?.id||'ce nœud'} ?`)
      if(!ok) return
      removeNode(nid)
      selectNodeById(null)
      setStatus('Nœud supprimé')
    }
  }
  // Keyboard shortcuts
  window.addEventListener('keydown', (e: KeyboardEvent)=>{
    const m=e.metaKey||e.ctrlKey
    if(m && e.key.toLowerCase()==='c'){ e.preventDefault(); copySelection() }
    if(m && e.key.toLowerCase()==='v'){ e.preventDefault(); pasteClipboard(); renderAll(canvas) }
    if(m && e.key.toLowerCase()==='s'){ e.preventDefault(); document.getElementById('saveBtn')?.click() }
    if(!/(INPUT|TEXTAREA|SELECT)/.test(document.activeElement?.tagName||'')){
      // Escape: always return to select mode from any transient mode
      if(e.key==='Escape'){ e.preventDefault(); setMode('select'); return }
      if(e.key==='Delete' || e.key==='Backspace'){ e.preventDefault(); deleteSelection() }
      if(e.key.toLowerCase()==='l'){ e.preventDefault(); document.getElementById('layoutBtn')?.click() }
      if(e.key.toLowerCase()==='d'){ e.preventDefault(); setMode('draw') }
      if(e.key.toLowerCase()==='e'){ e.preventDefault(); setMode('edit') }
      if(e.key.toLowerCase()==='i'){ e.preventDefault(); setMode('junction') }
      if(e.key.toLowerCase()==='e'){ e.preventDefault(); setMode('edit') }
      if(e.key==='='||e.key==='+'){ e.preventDefault(); canvas.zoomBy(canvas.zoomStep) }
      if(e.key==='-'){ e.preventDefault(); canvas.zoomBy(1 / canvas.zoomStep) }
    }
  })
  // Capture delete even when focus is in inputs if a selection exists
  document.addEventListener('keydown', (e: KeyboardEvent)=>{
    if(e.key!=='Delete' && e.key!=='Backspace') return
    // Never treat Delete/Backspace as a delete when typing in a form field
    const tag = document.activeElement?.tagName||''
    if(/(INPUT|TEXTAREA|SELECT)/.test(tag)) return
    if(!(state.selection?.edgeId || (state.selection?.multi && state.selection.multi.size))) return
    e.preventDefault(); deleteSelection()
  }, true)
  // Hold Space to pan with left-drag anywhere
  window.addEventListener('keydown', (e: KeyboardEvent)=>{ if(e.code==='Space') canvas.setSpacePan?.(true) })
  window.addEventListener('keyup', (e: KeyboardEvent)=>{ if(e.code==='Space') canvas.setSpacePan?.(false) })
}

export async function boot(): Promise<void> {
  initLogsUI()
  initDevErrorHooks()
  wireStateLogs()
  initModesUI()
  initForms()
  const canvas = initCanvas()
  const toolbarHandles = bindToolbar(canvas)
  let previousMapActive: boolean | null = null

  function applyViewMode(mode: string | null | undefined): void {
    const isGraph = mode === 'graph'
    document.body.classList.toggle('graph-view', isGraph)
    try{ toolbarHandles.updateGraphBtn() }catch{}
    if(isGraph){
      previousMapActive = typeof window.__MAP_ACTIVE !== 'undefined' ? !!window.__MAP_ACTIVE : null
      window.__MAP_ACTIVE = false
      renderAll(canvas)
      requestZoomFit(canvas, 120)
    } else {
      if(previousMapActive !== null){
        window.__MAP_ACTIVE = previousMapActive
      } else if(typeof window.__MAP_ACTIVE === 'undefined'){
        window.__MAP_ACTIVE = !!window.__leaflet_map
      }
      try{
        const d3Instance = window.d3
        if(d3Instance){ canvas.svg.interrupt(); canvas.svg.call(canvas.zoom.transform, d3Instance.zoomIdentity) }
        canvas.root?.attr('transform', null)
      }catch{}
      renderAll(canvas)
      if(window.__MAP_ACTIVE){
        const map = getMap && getMap()
        try{ map && map.invalidateSize && map.invalidateSize() }catch{}
        const refreshMap = ()=>{
          try{ fitMapToNodes() }catch{}
          try{ syncGeoProjection() }catch{}
        }
        if(typeof requestAnimationFrame==='function') requestAnimationFrame(()=> requestAnimationFrame(refreshMap))
        else refreshMap()
      } else {
        requestZoomFit(canvas, 120)
      }
    }
  }

  adjustWrapTop(); window.addEventListener('resize', adjustWrapTop)

  subscribe((evt, payload)=>{
    if(evt.startsWith('plan:')){
      debugPlanUi('event', evt, payload)
    }
    if(evt==='graph:set' || evt.startsWith('node:') || evt.startsWith('edge:') || evt.startsWith('selection:') || evt==='branch:update'){
      renderAll(canvas)
    }
    if(evt === 'view:set' && typeof payload === 'string'){
      applyViewMode(payload)
    }
    if(evt === 'plan:set'){
      const plan = getPlanOverlayState()
      if(!plan.config){
        restoredPlanPrefs.clear()
      }
      restorePlanOverlayPreferences()
      syncPlanOverlayWithMap()
      updatePlanControlsUI()
      savePlanOverlayPreferences()
    }else if(evt === 'plan:toggle'){
      syncPlanOverlayWithMap()
      updatePlanControlsUI()
      savePlanOverlayPreferences()
    }else if(evt === 'plan:opacity'){
      const plan = getPlanOverlayState()
      mapSetPlanOpacity(plan.opacity)
      updatePlanControlsUI()
      savePlanOverlayPreferences()
    }else if(evt === 'plan:rotation'){
      const plan = getPlanOverlayState()
      mapSetPlanRotation(plan.rotationDeg)
      updatePlanControlsUI()
      savePlanOverlayPreferences()
    }else if(evt === 'plan:mode'){
      syncPlanOverlayWithMap()
      updatePlanControlsUI()
      savePlanOverlayPreferences()
    }else if(evt === 'plan:bounds'){
      syncPlanOverlayWithMap()
      updatePlanControlsUI()
    }else if(evt === 'plan:scale'){
      updatePlanControlsUI()
    }else if(evt === 'plan:dirty' || evt === 'plan:saving' || evt === 'plan:editable'){
      updatePlanControlsUI()
    }else if(evt === 'plan:loading' || evt === 'plan:error'){
      updatePlanControlsUI()
    }
  })
  const mode = getMode()
  setPlanOverlayEditable(mode !== 'ro')
  try{ document.addEventListener('map:view', ()=> { renderAll(canvas) }) }catch{}

  const graph = await getGraph().catch<Graph>(err=>{
    log('Chargement échoué: '+err, 'error')
    return { nodes: [], edges: [] } as Graph
  })
  setGraph(graph)
  document.body.classList.remove('prop-collapsed')
  try{ initMap(); fitMapToNodes(); syncGeoProjection() }catch{}
  applyViewMode(getViewMode())

  const schedulePlanOverlayLoad = (): void => {
    const start = (): void => { void loadPlanOverlayAssets() }
    try{
      if(typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'){
        window.requestAnimationFrame(()=> start())
      }else if(typeof window !== 'undefined'){
        window.setTimeout(start, 0)
      }else{
        start()
      }
    }catch{
      start()
    }
  }

  schedulePlanOverlayLoad()

  const history = createHistory<GraphSnapshot>(
    () => JSON.parse(JSON.stringify(getStateGraph())) as unknown as GraphSnapshot,
    (snap) => setGraph(JSON.parse(JSON.stringify(snap)) as unknown as GraphSnapshot)
  )
  history.push('load')
  pushAfterDrag = ()=> history.push('drag')

  subscribe((evt, payload)=>{
    if(evt==='mode:set'){
      const mode = typeof payload === 'string' ? payload : ''
      if(mode==='delete') setStatus('Veuillez sélectionner l’élément à supprimer')
      else if(mode==='draw') setStatus('Clic = sommet · Double‑clic = terminer · Échap = annuler')
      else if(mode==='edit') setStatus('Clic = poignées · Alt+clic ou clic droit = insérer · Suppr = supprimer')
      else if(mode==='junction') setStatus('Clic segment = insérer une jonction et découper')
      else setStatus('')
      try{ showModeHelp(mode) }catch{}
    }
  })

  subscribe((evt)=>{
    if(evt==='node:add' || evt==='node:remove' || evt==='edge:add' || evt==='edge:remove' || evt==='edge:flip' || evt==='graph:update' || evt==='sequence:update') history.push(evt)
  })

  renderAll(canvas)
  try{
    if(window.__MAP_ACTIVE){
      if(typeof requestAnimationFrame==='function'){
        requestAnimationFrame(()=> requestAnimationFrame(()=> { try{ fitMapToNodes() }catch{} }))
      }else{
        try{ fitMapToNodes() }catch{}
      }
    }else{
      if(typeof requestAnimationFrame==='function'){
        requestAnimationFrame(()=> requestAnimationFrame(()=> applyZoomFit(canvas)))
      }else{
        applyZoomFit(canvas)
      }
    }
  }catch{}

  attachInteractions(canvas)
  attachMarquee(canvas.svg, canvas.gOverlay)
  attachDraw(canvas.svg, canvas.gOverlay)
  attachEditGeometry(canvas.gEdges)
  attachJunction()

  try{
    const svgNode = document.getElementById('svg')
    const ctxNode = document.getElementById('ctx')
    const svg = svgNode instanceof HTMLElement ? svgNode : null
    const ctx = ctxNode instanceof HTMLElement ? ctxNode : null
    if(svg && ctx){
      svg.addEventListener('contextmenu', (e: MouseEvent)=>{
        e.preventDefault()
        ctx.innerHTML = '<div class="item" id="ctxLayout">🧭 Agencer</div>'
        ctx.style.left = e.pageX+'px'; ctx.style.top = e.pageY+'px'; ctx.style.display='block'
      })
      document.addEventListener('click', ()=>{ ctx.style.display='none' })
      ctx.addEventListener('click', (e: MouseEvent)=>{
        const target = e.target instanceof HTMLElement ? e.target : null
        if(target?.id==='ctxLayout'){ document.getElementById('layoutBtn')?.click() }
        ctx.style.display='none'
      })
    }
  }catch{}

  window.addEventListener('keydown', (e: KeyboardEvent)=>{
    const m=e.metaKey||e.ctrlKey
    if(m && (e.key==='z'||e.key==='Z')){ e.preventDefault(); suppressNextMapAutoFit(); history.undo() }
    if(m && (e.key==='y'||(e.shiftKey&&(e.key==='Z'||e.key==='z')))){ e.preventDefault(); suppressNextMapAutoFit(); history.redo() }
    if(m && (e.key==='s'||e.key==='S')){ e.preventDefault(); history.push('save') }
  })
}

// Expose boot on a global for non-module loading
window.EditorBoot = Object.assign(window.EditorBoot||{}, { boot })
