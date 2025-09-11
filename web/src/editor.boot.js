import { d3 } from './vendor.js'
import { getGraph, saveGraph, getMode } from './api.js'
import { toJSON, toCompact, toNodeEdge } from './exports.js'
import { $$ } from './utils.js'
import { initCanvas } from './render/canvas.js'
import { renderNodes, NODE_SIZE } from './render/render-nodes.js'
import { renderEdges } from './render/render-edges.js'
import { renderInline } from './render/render-inline.js'
import { autoLayout } from './layout.js'
import { initLogsUI, log, wireStateLogs } from './ui/logs.js'
import { initForms } from './ui/forms.js'
import { initModesUI } from './modes.js'
import { state, setGraph, getGraph as getStateGraph, subscribe, selectNodeById, selectEdgeById, copySelection, pasteClipboard, removeEdge, removeNodes, removeNode, addNode, setMode } from './state.js'
import { createHistory } from './history.js'
import { attachConnect } from './interactions/connect.js'
import { attachNodeDrag } from './interactions/drag.js'
import { attachSelection } from './interactions/selection.js'
import { attachMarquee } from './interactions/marquee.js'

function ensureHUD(){
  let hud = document.getElementById('hud')
  if(!hud){ hud = document.createElement('div'); hud.id='hud'; document.body.appendChild(hud) }
  return hud
}

function adjustWrapTop(){
  try{
    const bar = document.getElementById('appbar')
    const h = Math.ceil(bar?.getBoundingClientRect().height || 70)
    document.documentElement.style.setProperty('--appbar-height', h+'px')
  }catch{}
}

function updateHUD(){
  const hud = ensureHUD()
  hud.textContent = `${state.nodes.length} nœuds • ${state.edges.length} arêtes`
}

function setStatus(msg){ const el=document.getElementById('status'); if(el) el.textContent = msg||'' }

function computeZoomFitTransform(containerEl, nodes){
  const w = containerEl.clientWidth || 1200
  const h = containerEl.clientHeight || 800
  const M = 60 // margin around content

  // Try to use actual rendered content bbox (nodes+edges), independent of current zoom
  try{
    const root = document.getElementById('zoomRoot')
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
        const scale = Math.min(w / bw, h / bh)
        const tx = (w - scale * bw)/2 - scale * minX
        const ty = (h - scale * bh)/2 - scale * minY
        return { k: scale, x: tx, y: ty }
      }
    }
  }catch{/* fallback to nodes extents below */}

  // Fallback: compute from node positions
  if(!nodes.length) return { k:1, x:0, y:0 }
  const valid = nodes.filter(n => Number.isFinite(+n.x) && Number.isFinite(+n.y))
  const xs1 = (valid.length?valid:nodes).map(n => (+n.x||0))
  const xs2 = (valid.length?valid:nodes).map(n => (+n.x||0) + NODE_SIZE.w)
  const ys1 = (valid.length?valid:nodes).map(n => (+n.y||0))
  const ys2 = (valid.length?valid:nodes).map(n => (+n.y||0) + NODE_SIZE.h)
  const minX = Math.min(...xs1) - M
  const maxX = Math.max(...xs2) + M
  const minY = Math.min(...ys1) - M
  const maxY = Math.max(...ys2) + M
  const bw = Math.max(1, (maxX - minX))
  const bh = Math.max(1, (maxY - minY))
  const scale = Math.min(w / bw, h / bh)
  const tx = (w - scale * bw)/2 - scale * minX
  const ty = (h - scale * bh)/2 - scale * minY
  return { k: scale, x: tx, y: ty }
}

function bindToolbar(canvas){
  const byId = (id)=> document.getElementById(id)
  byId('themeBtn')?.addEventListener('click', ()=>{
    document.body.dataset.theme = (document.body.dataset.theme==='light' ? 'dark' : 'light')
    adjustWrapTop()
    // Re-render to apply theme-dependent styles (edge colors/widths)
    try{ renderAll(canvas) }catch{}
  })
  byId('zoomInBtn')?.addEventListener('click', ()=> canvas.zoomBy(1.15))
  byId('zoomOutBtn')?.addEventListener('click', ()=> canvas.zoomBy(1/1.15))
  byId('zoomFitBtn')?.addEventListener('click', ()=> {
    const t = computeZoomFitTransform(document.getElementById('canvas'), state.nodes)
    const d3 = window.d3
    canvas.svg.transition().duration(220).call(canvas.zoom.transform, d3.zoomIdentity.translate(t.x, t.y).scale(t.k))
  })
  byId('layoutBtn')?.addEventListener('click', async ()=>{ await autoLayout(state.nodes, state.edges); renderAll(canvas) })
  // Toggle variable edge thickness (by diameter)
  const thickBtn = byId('thicknessBtn')
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
  byId('exportBtn')?.addEventListener('click', ()=> downloadJSON(toJSON(getStateGraph()), 'graph.json'))
  byId('exportCompactBtn')?.addEventListener('click', ()=> downloadJSON(toCompact(getStateGraph()), 'graph.compact.json'))
  byId('exportNodeEdgeBtn')?.addEventListener('click', ()=> downloadJSON(toNodeEdge(getStateGraph()), 'graph.node-edge.json'))
  const saveBtn = byId('saveBtn')
  if(getMode()==='ro'){ saveBtn?.classList.add('hidden') }
  saveBtn?.addEventListener('click', async ()=>{
    const g = getStateGraph(); setStatus('Sauvegarde…')
    await saveGraph(g)
      .then(()=>{ setStatus('Sauvé.'); log('Graph sauvé') })
      .catch(err=>{ console.error(err); alert('Erreur de sauvegarde'); setStatus('Erreur sauvegarde'); log('Sauvegarde: erreur', 'error') })
  })
  byId('loadBtn')?.addEventListener('click', async ()=>{ const g = await getGraph(); setGraph(g) })
  // Help dialog
  const helpBtn = byId('helpBtn')
  const helpDlg = document.getElementById('helpDlg')
  const helpClose = document.getElementById('helpCloseBtn')
  if(helpBtn && helpDlg && 'showModal' in helpDlg){ helpBtn.onclick = ()=> helpDlg.showModal() }
  if(helpClose && helpDlg){ helpClose.onclick = ()=> helpDlg.close() }

  // Add menu (basic: add a node of selected type)
  const addBtn = byId('addBtn')
  const addMenu = byId('addMenu')
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
          const t = d3.zoomTransform(svgEl)
          const svgRect = svgEl.getBoundingClientRect()
          const canRect = canEl.getBoundingClientRect()
          // Center of the visible canvas, converted to svg local coords
          const centerInSvg = [ (canRect.left + canRect.width/2) - svgRect.left,
                                (canRect.top  + canRect.height/2) - svgRect.top ]
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
    document.addEventListener('click', (e)=>{
      if(!addBtn.contains(e.target) && !addMenu.contains(e.target)) addMenu.classList.remove('open')
    })
  }
}

function downloadJSON(obj, name){
  const blob = new Blob([ JSON.stringify(obj, null, 2) ], { type:'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url)
}

let pushAfterDrag = ()=>{}
let zoomFitTimer = null

function applyZoomFit(canvas){
  const t = computeZoomFitTransform(document.getElementById('canvas'), state.nodes)
  const d3 = window.d3
  canvas.svg.transition().duration(220).call(canvas.zoom.transform, d3.zoomIdentity.translate(t.x, t.y).scale(t.k))
}

function requestZoomFit(canvas, delay=180){
  clearTimeout(zoomFitTimer)
  zoomFitTimer = setTimeout(()=> applyZoomFit(canvas), delay)
}

function renderAll(canvas){
  renderEdges(canvas.gEdges, state.edges)
  renderNodes(canvas.gNodes, state.nodes)
  renderInline(canvas.gInline, state.nodes)
  updateHUD()
  // Re-attach interactions to updated selections
  attachSelection(canvas.gNodes, canvas.gEdges)
  attachNodeDrag(canvas.gNodes, ()=> pushAfterDrag())
  attachConnect(canvas.gNodes)
}

function attachInteractions(canvas){
  // Selection on background
  document.getElementById('canvas')?.addEventListener('click', (e)=>{
    // If a marquee or drag just finished, ignore this background click (debounce)
    if(window.__squelchCanvasClick){ window.__squelchCanvasClick = false; return }
    if(e.target?.closest('g.node, g.edge')) return
    selectNodeById(null); selectEdgeById(null)
  })

  function deleteSelection(){
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
  window.addEventListener('keydown', (e)=>{
    const m=e.metaKey||e.ctrlKey
    if(m && e.key.toLowerCase()==='c'){ e.preventDefault(); copySelection() }
    if(m && e.key.toLowerCase()==='v'){ e.preventDefault(); pasteClipboard(); renderAll(canvas) }
    if(m && e.key.toLowerCase()==='s'){ e.preventDefault(); document.getElementById('saveBtn')?.click() }
    if(!/(INPUT|TEXTAREA|SELECT)/.test(document.activeElement?.tagName||'')){
      // Escape: always return to select mode from any transient mode
      if(e.key==='Escape'){ e.preventDefault(); setMode('select'); return }
      if(e.key==='Delete' || e.key==='Backspace'){ e.preventDefault(); deleteSelection() }
      if(e.key.toLowerCase()==='l'){ e.preventDefault(); document.getElementById('layoutBtn')?.click() }
      if(e.key.toLowerCase()==='c'){ e.preventDefault(); setMode('connect') }
      if(e.key==='='||e.key==='+'){ e.preventDefault(); canvas.zoomBy(1.15) }
      if(e.key==='-'){ e.preventDefault(); canvas.zoomBy(1/1.15) }
    }
  })
  // Capture delete even when focus is in inputs if a selection exists
  document.addEventListener('keydown', (e)=>{
    if(e.key!=='Delete' && e.key!=='Backspace') return
    // Never treat Delete/Backspace as a delete when typing in a form field
    const tag = document.activeElement?.tagName||''
    if(/(INPUT|TEXTAREA|SELECT)/.test(tag)) return
    if(!(state.selection?.edgeId || (state.selection?.multi && state.selection.multi.size))) return
    e.preventDefault(); deleteSelection()
  }, true)
  // Hold Space to pan with left-drag anywhere
  window.addEventListener('keydown', (e)=>{ if(e.code==='Space') canvas.setSpacePan?.(true) })
  window.addEventListener('keyup', (e)=>{ if(e.code==='Space') canvas.setSpacePan?.(false) })
}

export async function boot(){
  initLogsUI()
  wireStateLogs()
  initModesUI()
  initForms()
  const canvas = initCanvas()
  bindToolbar(canvas)
  adjustWrapTop(); window.addEventListener('resize', adjustWrapTop)

  // Render on state changes (no auto zoom-fit here)
  subscribe(function(evt, payload){
    if(evt==='graph:set' || evt.startsWith('node:') || evt.startsWith('edge:') || evt.startsWith('selection:')){
      renderAll(canvas)
    }
  })

  // Load graph
  const graph = await getGraph().catch(err=>{ log('Chargement échoué: '+err, 'error'); return { nodes:[], edges:[] } })
  setGraph(graph)
  // History
  const history = createHistory(
    () => JSON.parse(JSON.stringify(getStateGraph())),
    (snap) => setGraph(JSON.parse(JSON.stringify(snap)))
  )
  history.push('load')
  pushAfterDrag = ()=> history.push('drag')
  // Open properties panel by default
  document.body.classList.remove('prop-collapsed')
  // Status for modes (bottom-left info)
  subscribe((evt, payload)=>{
    if(evt==='mode:set'){
      if(payload==='connect') setStatus('Clique une source, puis une cible (nœud)')
      else if(payload==='delete') setStatus('Veuillez sélectionner l’élément à supprimer')
      else setStatus('')
    }
  })
  // Push snapshots on meaningful changes (node/edge + graph/sequence updates)
  subscribe((evt)=>{
    if(evt==='node:add' || evt==='node:remove' || evt==='edge:add' || evt==='edge:remove' || evt==='graph:update' || evt==='sequence:update') history.push(evt)
  })
  // Do not auto-layout on load; preserve positions from source
  renderAll(canvas)
  // Zoom fit on initial load
  try{
    // defer one frame to ensure CSS/layout applied
    requestAnimationFrame(()=> requestAnimationFrame(()=> applyZoomFit(canvas)))
  }catch{}

  // No auto-fit on resize/DOM changes per request

  attachInteractions(canvas)
  attachMarquee(canvas.svg, canvas.gOverlay)

  // Context menu (right-click) – Agencer
  try{
    const svg = document.getElementById('svg')
    const ctx = document.getElementById('ctx')
    if(svg && ctx){
      svg.addEventListener('contextmenu', (e)=>{
        e.preventDefault()
        ctx.innerHTML = '<div class="item" id="ctxLayout">🧭 Agencer</div>'
        ctx.style.left = e.pageX+'px'; ctx.style.top = e.pageY+'px'; ctx.style.display='block'
      })
      document.addEventListener('click', ()=>{ ctx.style.display='none' })
      ctx.addEventListener('click', (e)=>{ if((e.target).id==='ctxLayout'){ document.getElementById('layoutBtn')?.click() } ctx.style.display='none' })
    }
  }catch{}
  // Push a snapshot after drag via selection change subscription + small timeout
  // We don't have a dedicated drag-end event; wire in keyboard undo/redo and on Ctrl/Cmd+S we push explicitly when necessary.
  window.addEventListener('keydown', (e)=>{
    const m=e.metaKey||e.ctrlKey
    if(m && (e.key==='z'||e.key==='Z')){ e.preventDefault(); history.undo() }
    if(m && (e.key==='y'||(e.shiftKey&&(e.key==='Z'||e.key==='z')))){ e.preventDefault(); history.redo() }
    if(m && (e.key==='s'||e.key==='S')){ e.preventDefault(); history.push('save') }
  })
}

// Expose boot on a global for non-module loading
window.EditorBoot = Object.assign(window.EditorBoot||{}, { boot })
