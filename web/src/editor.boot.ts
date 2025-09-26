import { d3 } from './vendor.ts'
import { getGraph, saveGraph, getMode } from './api.ts'
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
import { initMap, fitMapToNodes, syncGeoProjection, getMap } from './map.ts'
import { state, setGraph, getGraph as getStateGraph, subscribe, selectNodeById, selectEdgeById, copySelection, pasteClipboard, removeEdge, removeNodes, removeNode, addNode, setMode, setViewMode, getViewMode } from './state/index.ts'
import { createHistory } from './state/history.ts'
import { attachNodeDrag } from './interactions/drag.ts'
import { attachSelection } from './interactions/selection.ts'
import { attachMarquee } from './interactions/marquee.ts'
import { attachDraw } from './interactions/draw.ts'
import { attachEditGeometry } from './interactions/edit-geometry.ts'
import { attachJunction } from './interactions/junction.ts'
import type { Graph } from './types/graph'
import type { MutableNode } from './state/normalize.ts'

type CanvasHandles = ReturnType<typeof initCanvas>
type GraphSnapshot = Graph

const DEV_BUILD = (typeof __DEV__ !== 'undefined' && __DEV__ === true)

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
  byId('loadBtn')?.addEventListener('click', async ()=>{
    try{
      setStatus('Chargement…')
      const g = await getGraph()
      setGraph(g)
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
        // Compute current view center in canvas coordinates
        try{
          const svgEl = document.getElementById('svg')
          const canEl = document.getElementById('canvas')
          const d3Instance = window.d3
          if(!svgEl || !canEl || !d3Instance) throw new Error('missing canvas refs')
          const t = d3Instance.zoomTransform(svgEl)
          const svgRect = svgEl.getBoundingClientRect()
          const canRect = canEl.getBoundingClientRect()
          // Center of the visible canvas, converted to svg local coords
          const centerInSvg: [number, number] = [
            (canRect.left + canRect.width / 2) - svgRect.left,
            (canRect.top + canRect.height / 2) - svgRect.top,
          ]
          const [cx, cy] = t.invert(centerInSvg)
          const gs = (state?.gridStep||8)
          // Slightly offset each subsequent add to avoid stacking
          const pi = (state._spawnIndex = (state._spawnIndex||0) + 1)
          const extraX = (pi % 7) * (gs)
          const extraY = (pi % 11) * (gs)
          const node = addNode({ type, x: Math.round((cx+extraX)/gs)*gs, y: Math.round((cy+extraY)/gs)*gs })
          selectNodeById(node.id)
          return
        }catch{}
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
    if(evt==='graph:set' || evt.startsWith('node:') || evt.startsWith('edge:') || evt.startsWith('selection:') || evt==='branch:update'){
      renderAll(canvas)
    }
    if(evt === 'view:set' && typeof payload === 'string'){
      applyViewMode(payload)
    }
  })
  try{ document.addEventListener('map:view', ()=> { renderAll(canvas) }) }catch{}

  const graph = await getGraph().catch<Graph>(err=>{
    log('Chargement échoué: '+err, 'error')
    return { nodes: [], edges: [] } as Graph
  })
  setGraph(graph)
  document.body.classList.remove('prop-collapsed')
  try{ initMap(); fitMapToNodes(); syncGeoProjection() }catch{}
  applyViewMode(getViewMode())

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
