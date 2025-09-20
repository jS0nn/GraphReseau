import { state, subscribe, updateNode, updateEdge, removeNode, removeEdge, clearSelection, addNode, addEdge, selectEdgeById, selectNodeById, flipEdgeDirection } from '../state/index.js'
import { displayXYForNode, unprojectUIToLatLon } from '../geo.js'
import { NODE_SIZE } from '../constants/nodes.js'
import { genIdWithTime as genId, defaultName, vn, snap, isCanal } from '../utils.js'
import { log } from './logs.js'
function setStatus(msg){ const el=document.getElementById('status'); if(el) el.textContent = msg||'' }

function el(id){ return document.getElementById(id) }
function setDisplay(id, on){ const g = document.getElementById(id); if(g) g.style.display = on ? 'block' : 'none' }

function findCanalContext(node){
  if(!node) return null
  if(isCanal(node)) return { canal: node, viaEdge: null }
  const nid = node.id
  const nodes = state.nodes
  const edges = state.edges
  const byId = (id)=> nodes.find(n=> n.id === id)
  if(node.well_collector_id){
    const canal = byId(node.well_collector_id)
    if(isCanal(canal)) return { canal, viaEdge: edges.find(e => (e.to_id ?? e.target) === nid && (e.from_id ?? e.source) === canal.id) || null }
  }
  if(node.pm_collector_edge_id){
    const edge = edges.find(e => e.id === node.pm_collector_edge_id)
    if(edge){
      const a = byId(edge.from_id ?? edge.source)
      const b = byId(edge.to_id ?? edge.target)
      if(isCanal(a)) return { canal: a, viaEdge: edge }
      if(isCanal(b)) return { canal: b, viaEdge: edge }
    }
  }
  for(const edge of edges){
    const fromId = edge.from_id ?? edge.source
    const toId = edge.to_id ?? edge.target
    if(fromId === nid){
      const target = byId(toId)
      if(isCanal(target)) return { canal: target, viaEdge: edge }
    }else if(toId === nid){
      const src = byId(fromId)
      if(isCanal(src)) return { canal: src, viaEdge: edge }
    }
  }
  return null
}

export function initForms(){
  const nodeForm = el('nodeForm')
  const edgeForm = el('edgeForm')
  const noSel = el('noSel')
  const delNodeBtn = el('deleteNodeBtn')
  const delEdgeBtn = el('deleteEdgeBtn')
  const flipEdgeBtn = el('flipEdgeBtn')

  const setCollapsed = (on)=> document.body.classList.toggle('prop-collapsed', !!on)
  function showNone(){ if(nodeForm) nodeForm.style.display='none'; if(edgeForm) edgeForm.style.display='none'; if(noSel) noSel.style.display='block' /* keep panel open */ }
  function showNode(){ if(nodeForm) nodeForm.style.display='block'; if(edgeForm) edgeForm.style.display='none'; if(noSel) noSel.style.display='none'; setCollapsed(false) }
  function showEdge(){ if(nodeForm) nodeForm.style.display='none'; if(edgeForm) edgeForm.style.display='block'; if(noSel) noSel.style.display='none'; setCollapsed(false) }

  // Selection rendering
  function refresh(){
    const nid = state.selection.nodeId
    const eid = state.selection.edgeId
    if(nid){
      const n = state.nodes.find(n=>n.id===nid)
      if(!n){ showNone(); return }
      showNode()
      if(flipEdgeBtn){ flipEdgeBtn.disabled = true }
      const T = (n.type||'OUVRAGE').toUpperCase()
      const isCan = (T === 'CANALISATION')
      // Show ID (read-only)
      try{ const idEl = document.getElementById('nodeId'); if(idEl) idEl.value = n.id || '' }catch{}
      setDisplay('grpCanalProps', isCan)
      setDisplay('grpInline', (T==='POINT_MESURE'||T==='VANNE'))
      nodeForm.name.value = n.name||''
      nodeForm.type.value = (n.type||'OUVRAGE')
      // Hide/disable legacy canal node type when edges-only
      const typeSel = nodeForm.type
      if(typeSel && typeSel.options){
        Array.from(typeSel.options).forEach(opt => {
          if(String(opt.value).toUpperCase()==='CANALISATION' || String(opt.textContent||'').toUpperCase()==='CANALISATION'){
            opt.disabled = true; opt.hidden = true
          }
        })
      }
      nodeForm.x_UI.value = Math.round(+(n.x ?? 0))
      nodeForm.y_UI.value = Math.round(+(n.y ?? 0))
      if(nodeForm.diameter_mm) nodeForm.diameter_mm.value = (isCan && n.diameter_mm!=null && n.diameter_mm!=='') ? n.diameter_mm : ''
      if(nodeForm.sdr_ouvrage) nodeForm.sdr_ouvrage.value = (isCan && n.sdr_ouvrage) ? n.sdr_ouvrage : ''
      if(nodeForm.material) nodeForm.material.value = (isCan && n.material) ? n.material : ''
      const infoCtx = findCanalContext(n)
      setDisplay('grpPipeInfo', !isCan && !!infoCtx?.canal)
      try{
        const nameEl = document.getElementById('pipeInfoName')
        const diaEl = document.getElementById('pipeInfoDiameter')
        const sdrEl = document.getElementById('pipeInfoSDR')
        const matEl = document.getElementById('pipeInfoMaterial')
        if(nameEl) nameEl.value = infoCtx?.canal ? (infoCtx.canal.name || infoCtx.canal.id || '') : ''
        if(diaEl) diaEl.value = infoCtx?.canal?.diameter_mm ?? ''
        if(sdrEl) sdrEl.value = infoCtx?.canal?.sdr_ouvrage ?? ''
        if(matEl) matEl.value = infoCtx?.canal?.material ?? ''
      }catch{}
      if('gps_lat' in n && nodeForm.gps_lat) nodeForm.gps_lat.value = (n.gps_lat===''||n.gps_lat==null)?'':n.gps_lat
      if('gps_lon' in n && nodeForm.gps_lon) nodeForm.gps_lon.value = (n.gps_lon===''||n.gps_lon==null)?'':n.gps_lon
      // GPS lock toggle visibility/state
      const lock = document.getElementById('gpsLockToggle')
      if(lock){
        lock.checked = !!n.gps_locked
        lock.disabled = false
        lock.parentElement.style.opacity = '1'
        lock.title = 'Quand activé, la position suit le GPS (non déplaçable)'
      }
      if(nodeForm.commentaire) nodeForm.commentaire.value = (n?.commentaire ?? '')
      // Canalisation extras: render simple children list + add shortcuts
      const seq = document.getElementById('seqList')
      if(seq){
        seq.innerHTML = ''
        if(T==='POINT_MESURE' || T==='VANNE') renderInlineSection(n)
      }
    } else if(eid){
      const e = state.edges.find(e=>e.id===eid)
      if(!e){ showNone(); return }
      showEdge()
      // Show edge ID (read-only)
      try{ const eIdEl = document.getElementById('edgeId'); if(eIdEl) eIdEl.value = e.id || '' }catch{}
      const from = state.nodes.find(n=>n.id===(e.source??e.from_id))
      const to = state.nodes.find(n=>n.id===(e.target??e.to_id))
      edgeForm.from_name.value = from?.name||from?.id||''
      edgeForm.to_name.value = to?.name||to?.id||''
      edgeForm.active.value = String(e.active!==false)
      if(edgeForm.diameter_mm){
        const val = Number.isFinite(+e.diameter_mm) && +e.diameter_mm > 0 ? +e.diameter_mm : ''
        edgeForm.diameter_mm.value = val
      }
      if(edgeForm.sdr){ edgeForm.sdr.value = e.sdr || '' }
      if(edgeForm.material){ edgeForm.material.value = e.material || '' }
      if(edgeForm.commentaire) edgeForm.commentaire.value = e.commentaire || ''
      if(flipEdgeBtn){
        flipEdgeBtn.disabled = false
      }
    } else {
      showNone()
      if(flipEdgeBtn){
        flipEdgeBtn.disabled = true
      }
    }
  }

  subscribe((evt)=>{
    if(evt.startsWith('selection:') || evt.startsWith('node:') || evt.startsWith('edge:') || evt==='graph:set') refresh()
  })
  refresh()

  // Node form inputs
  if(nodeForm){
    // Ignore inputs that are handled by dedicated change handlers to avoid
    // premature re-render cancelling their events (e.g., canal selects).
    const IGNORE_IDS = new Set(['wellCanalSelect','inlEdgeSelect','inlOffsetInput','cwSearch','pmSearch','vanSearch','gpsLockToggle'])
    nodeForm.addEventListener('input', (evt)=>{
      const t = evt?.target
      if(t && IGNORE_IDS.has(t.id||'')) return
      const id = state.selection.nodeId
      if(!id) return
      const current = state.nodes.find(nn=>nn.id===id)
      const isCan = isCanal(current)
      const xui = nodeForm.x_UI ? (nodeForm.x_UI.value===''? '' : +nodeForm.x_UI.value) : ''
      const yui = nodeForm.y_UI ? (nodeForm.y_UI.value===''? '' : +nodeForm.y_UI.value) : ''
      const patch = {
        name: nodeForm.name.value,
        type: nodeForm.type.value,
        // Keep UI and live position in sync when edited from the form
        x: xui,
        y: yui,
        x_ui: xui,
        y_ui: yui,
      }
      if(isCan){
        if(nodeForm.diameter_mm) patch.diameter_mm = (nodeForm.diameter_mm.value===''? '' : +nodeForm.diameter_mm.value)
        if(nodeForm.sdr_ouvrage) patch.sdr_ouvrage = nodeForm.sdr_ouvrage.value
        if(nodeForm.material) patch.material = nodeForm.material.value
      }
      if(nodeForm.gps_lat) patch.gps_lat = (nodeForm.gps_lat.value===''? '' : +nodeForm.gps_lat.value)
      if(nodeForm.gps_lon) patch.gps_lon = (nodeForm.gps_lon.value===''? '' : +nodeForm.gps_lon.value)
      if(nodeForm.commentaire) patch.commentaire = nodeForm.commentaire.value
      updateNode(id, patch)
    })
    // GPS lock toggle
    const lock = document.getElementById('gpsLockToggle')
    if(lock && !lock.__wired__){
      lock.__wired__ = true
      lock.addEventListener('change', ()=>{
        const id = state.selection.nodeId
        if(!id) return
        const n = state.nodes.find(nn=>nn.id===id)
        const to = !!lock.checked
        if(n){
          if(n.gps_locked && !to){
            // Unlock: freeze current visual position into x/y
            const p = displayXYForNode(n)
            updateNode(id, { gps_locked: false, x: Math.round(+p.x||0), y: Math.round(+p.y||0) })
            return
          }
          if(!n.gps_locked && to){
            // Lock: compute GPS from the visual marker center and set gps_lat/lon
            const p = displayXYForNode(n) // when unlocked, this is {x,y}
            const type = String(n.type||'').toUpperCase()
            const cx = (+p.x||0) + (type === 'JONCTION' ? 0 : NODE_SIZE.w/2)
            const cy = (+p.y||0) + (type === 'JONCTION' ? 0 : NODE_SIZE.h/2)
            const ll = unprojectUIToLatLon(cx, cy)
            const patch = { gps_locked: true }
            if(Number.isFinite(ll?.lat) && Number.isFinite(ll?.lon)){
              patch.gps_lat = ll.lat
              patch.gps_lon = ll.lon
            }
            updateNode(id, patch)
            return
          }
        }
        updateNode(id, { gps_locked: to })
      })
    }
  }

  // Edge form inputs
  if(edgeForm){
    edgeForm.addEventListener('input', ()=>{
      const id = state.selection.edgeId
      if(!id) return
      const e = state.edges.find(edge=>edge.id === id)
      if(!e) return
      const patch = {
        active: (edgeForm.active.value === 'true'),
        commentaire: edgeForm.commentaire ? edgeForm.commentaire.value : e.commentaire,
      }
      if(edgeForm.diameter_mm){
        const raw = edgeForm.diameter_mm.value
        if(raw === ''){
          patch.diameter_mm = null
        }else{
          const num = Number(raw)
          patch.diameter_mm = Number.isFinite(num) ? num : null
        }
      }
      if(edgeForm.sdr){ patch.sdr = edgeForm.sdr.value || '' }
      if(edgeForm.material){ patch.material = edgeForm.material.value || '' }
      updateEdge(id, patch)
    })
  }

  if(flipEdgeBtn && !flipEdgeBtn.__wired__){
    flipEdgeBtn.__wired__ = true
    flipEdgeBtn.onclick = () => {
      const id = state.selection.edgeId
      if(!id) return
      flipEdgeDirection(id)
      setStatus('Sens inversé')
    }
  }

  if(delNodeBtn){ delNodeBtn.onclick = ()=>{ const id = state.selection.nodeId; if(!id) return; if(confirm('Supprimer ce nœud ?')){ removeNode(id); clearSelection() } } }
  if(delEdgeBtn){ delEdgeBtn.onclick = ()=>{ const id = state.selection.edgeId; if(!id){ alert('Aucune arête sélectionnée'); return } if(confirm('Supprimer cette arête ?')){ removeEdge(id); selectEdgeById(null); selectNodeById(null) } } }
}

function chip(label, cls=''){
  const el = document.createElement('div')
  el.className = `chip ${cls}`
  el.textContent = label
  return el
}

function chipWithRm(kind, node, onRemove){
  const el = document.createElement('div')
  el.className = 'chip'
  el.dataset.kind = kind
  el.dataset.id = node.id
  const label = document.createElement('span')
  label.textContent = (kind==='W') ? (node.name||node.id) : ((node.type==='VANNE'?'Vanne: ':'PM: ')+(node.name||node.id))
  const rm = document.createElement('span')
  rm.textContent = '✖'
  rm.title = 'Retirer'
  rm.style.cursor = 'pointer'
  rm.style.opacity = '.7'
  rm.style.marginLeft = '8px'
  rm.onclick = (e)=>{ e.stopPropagation(); if(typeof onRemove==='function') onRemove(node) }
  const drag = document.createElement('span')
  drag.textContent = '☰'
  drag.className = 'drag'
  drag.style.marginRight = '6px'
  el.appendChild(drag); el.appendChild(label); el.appendChild(rm)
  return el
}

function btnChip(label, onclick){ const c = chip(label); c.style.cursor='pointer'; c.onclick = onclick; return c }

function renderCanalSequence(){ /* canal nodes removed */ }

function renderInlineSection(dev){
  const selEdge = document.getElementById('inlEdgeSelect')
  const info = document.getElementById('inlPosInfo')
  const off = document.getElementById('inlOffsetInput')

  if(selEdge){
    selEdge.innerHTML = ''
    const optNone = document.createElement('option'); optNone.value=''; optNone.textContent='—'
    selEdge.appendChild(optNone)

    const grouped = new Map()
    state.edges.forEach(e => {
      const key = e.pipe_group_id || e.id
      ;(grouped.get(key) || grouped.set(key, []) && grouped.get(key)).push(e)
    })

    Array.from(grouped.entries())
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .forEach(([groupId, edges]) => {
        edges.forEach((edge, idx) => {
          const a = state.nodes.find(n => n.id === (edge.from_id ?? edge.source))
          const b = state.nodes.find(n => n.id === (edge.to_id ?? edge.target))
          if(!a || !b) return
          const name = `${a.name || a.id} → ${b.name || b.id}${edges.length>1?` (#${idx+1})`:''}`
          const opt = document.createElement('option')
          opt.value = edge.id
          opt.textContent = `${groupId} · ${name}`
          if(dev.pm_collector_edge_id === edge.id) opt.selected = true
          selEdge.appendChild(opt)
        })
      })

    selEdge.onchange = () => {
      const newEdgeId = selEdge.value
      if(newEdgeId){
        dev.pm_collector_edge_id = newEdgeId
        try{ updateNode(dev.id, { pm_collector_edge_id: newEdgeId, pm_collector_id: '', pm_pos_index: null }) }catch{}
        setStatus(`${(dev.type==='VANNE'?'Vanne':'Point de mesure')} ancré sur l’arête ${selEdge.selectedOptions?.[0]?.textContent || newEdgeId}`)
      } else {
        dev.pm_collector_edge_id = ''
        try{ updateNode(dev.id, { pm_collector_edge_id: '', pm_pos_index: null }) }catch{}
      }
    }
  }

  if(info){
    if(dev.pm_collector_edge_id){
      const edge = state.edges.find(e => e.id === dev.pm_collector_edge_id)
      const a = edge ? state.nodes.find(n => n.id === (edge.from_id ?? edge.source)) : null
      const b = edge ? state.nodes.find(n => n.id === (edge.to_id ?? edge.target)) : null
      info.value = edge ? `${a?.name || a?.id || '?'} → ${b?.name || b?.id || '?'} (arête)` : ''
    } else {
      info.value = ''
    }
  }

  if(off){
    off.value = (dev.pm_offset_m===''||dev.pm_offset_m==null)? '' : dev.pm_offset_m
    off.oninput = ()=>{ dev.pm_offset_m = (off.value===''? '' : +off.value) }
  }
}

function renderGeneralSection(){ /* canal UI removed */ }
