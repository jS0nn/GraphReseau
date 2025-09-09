import { state, subscribe, updateNode, removeNode, removeEdge, clearSelection, addNode, addEdge, moveWellToCanal, moveInlineToCanal, reorderChildCanals, reorderInlines, buildCanalSequence, applyCanalSequence, selectEdgeById, selectNodeById } from '../state.js'
import { genIdWithTime as genId, defaultName, vn, snap } from '../utils.js'
import { log } from './logs.js'
function setStatus(msg){ const el=document.getElementById('status'); if(el) el.textContent = msg||'' }

function el(id){ return document.getElementById(id) }
function setDisplay(id, on){ const g = document.getElementById(id); if(g) g.style.display = on ? 'block' : 'none' }

export function initForms(){
  const nodeForm = el('nodeForm')
  const edgeForm = el('edgeForm')
  const noSel = el('noSel')
  const delNodeBtn = el('deleteNodeBtn')
  const delEdgeBtn = el('deleteEdgeBtn')

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
      const T = (n.type||'PUITS').toUpperCase()
      setDisplay('grpDiameter', (T==='PUITS'||T==='CANALISATION'||T==='VANNE'))
      setDisplay('grpCanal', T==='CANALISATION')
      setDisplay('grpWell', T==='PUITS')
      setDisplay('grpInline', (T==='POINT_MESURE'||T==='VANNE'))
      nodeForm.name.value = n.name||''
      nodeForm.type.value = (n.type||'PUITS')
      nodeForm.x.value = Math.round(+n.x||0)
      nodeForm.y.value = Math.round(+n.y||0)
      if('diameter_mm' in n && nodeForm.diameter_mm) nodeForm.diameter_mm.value = (n.diameter_mm===''||n.diameter_mm==null)?'':n.diameter_mm
      if('gps_lat' in n && nodeForm.gps_lat) nodeForm.gps_lat.value = (n.gps_lat===''||n.gps_lat==null)?'':n.gps_lat
      if('gps_lon' in n && nodeForm.gps_lon) nodeForm.gps_lon.value = (n.gps_lon===''||n.gps_lon==null)?'':n.gps_lon
      // Canalisation extras: render simple children list + add shortcuts
      const seq = document.getElementById('seqList')
      if(seq){
        seq.innerHTML = ''
        if(T==='CANALISATION') renderCanalSequence(n, seq)
        if(T==='PUITS') renderWellSection(n)
        if(T==='POINT_MESURE' || T==='VANNE') renderInlineSection(n)
      }
    } else if(eid){
      const e = state.edges.find(e=>e.id===eid)
      if(!e){ showNone(); return }
      showEdge()
      const from = state.nodes.find(n=>n.id===(e.source??e.from_id))
      const to = state.nodes.find(n=>n.id===(e.target??e.to_id))
      edgeForm.from_name.value = from?.name||from?.id||''
      edgeForm.to_name.value = to?.name||to?.id||''
      edgeForm.active.value = String(e.active!==false)
    } else {
      showNone()
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
    const IGNORE_IDS = new Set(['wellCanalSelect','inlCanalSelect','inlOffsetInput','cwSearch','pmSearch','vanSearch'])
    nodeForm.addEventListener('input', (evt)=>{
      const t = evt?.target
      if(t && IGNORE_IDS.has(t.id||'')) return
      const id = state.selection.nodeId
      if(!id) return
      const patch = {
        name: nodeForm.name.value,
        type: nodeForm.type.value,
        x: nodeForm.x.value===''? '' : +nodeForm.x.value,
        y: nodeForm.y.value===''? '' : +nodeForm.y.value,
      }
      if(nodeForm.diameter_mm) patch.diameter_mm = (nodeForm.diameter_mm.value===''? '' : +nodeForm.diameter_mm.value)
      if(nodeForm.gps_lat) patch.gps_lat = (nodeForm.gps_lat.value===''? '' : +nodeForm.gps_lat.value)
      if(nodeForm.gps_lon) patch.gps_lon = (nodeForm.gps_lon.value===''? '' : +nodeForm.gps_lon.value)
      updateNode(id, patch)
    })
  }

  // Edge form inputs
  if(edgeForm){
    edgeForm.addEventListener('input', ()=>{
      const id = state.selection.edgeId
      if(!id) return
      const e = state.edges.find(e=>e.id===id)
      if(!e) return
      e.active = (edgeForm.active.value === 'true')
    })
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

function renderCanalSequence(canal, seqContainer){
  const seq = buildCanalSequence(canal.id)
  const childCanals = state.nodes.filter(x => (x.type==='CANALISATION'||x.type==='COLLECTEUR'))
    .filter(x => state.edges.some(e => (e.source??e.from_id)===canal.id && (e.target??e.to_id)===x.id))

  const title = document.createElement('div'); title.className='badges'
  title.appendChild(chip('Séquence & enfants', 'badge'))
  seqContainer.appendChild(title)

  // Note: the old "+" quick-add buttons are removed to avoid duplication
  // with the global toolbar and the new unassigned lists below.

  // Sequence row built from tokens with HTML5 drag/drop
  const row = document.createElement('div'); row.className='chips'; row.id='seqRow'
  function rebuild(){
    row.innerHTML=''
    const tokens = buildCanalSequence(canal.id)
    tokens.forEach((t, idx)=>{
      const n = state.nodes.find(x=>x.id===t.id) || { id:t.id, type: (t.kind==='W'?'PUITS': 'POINT_MESURE') }
      const el = chipWithRm(t.kind, n, (node)=>{
        if(!confirm('Retirer cet élément de la séquence ?')) return
        if(t.kind==='W'){
          canal.collector_well_ids = (canal.collector_well_ids||[]).filter(id=>id!==node.id)
          const e = state.edges.find(e=> (e.from_id??e.source)===canal.id && (e.to_id??e.target)===node.id); if(e) removeEdge(e.id)
        } else {
          const dev = state.nodes.find(x=>x.id===node.id); if(dev){ dev.pm_collector_id=''; dev.pm_pos_index=''; dev.pm_offset_m='' }
        }
        applyCanalSequence(canal.id, buildCanalSequence(canal.id))
        log('Séquence: élément retiré')
        updateNode(canal.id, { __touch: Date.now() })
        rebuild()
      })
      el.draggable = true
      el.dataset.idx = String(idx)
      el.addEventListener('dragstart', (e)=>{ el.classList.add('dragging'); e.dataTransfer.setData('text/plain', String(idx)) })
      el.addEventListener('dragend', ()=> el.classList.remove('dragging'))
      el.addEventListener('dragover', (e)=> e.preventDefault())
      el.addEventListener('drop', (e)=>{
        e.preventDefault()
        const from = +e.dataTransfer.getData('text/plain')
        const to = +el.dataset.idx
        if(from===to) return
        const seq = buildCanalSequence(canal.id)
        const moved = seq.splice(from,1)[0]
        seq.splice(to,0,moved)
        applyCanalSequence(canal.id, seq)
        log('Séquence: ordre mis à jour')
        updateNode(canal.id, { __touch: Date.now() })
        rebuild()
      })
      row.appendChild(el)
    })
  }
  rebuild()
  seqContainer.appendChild(row)

  // Unassigned items lists (wells, PMs, valves) as clickable chips
  function rebuildUnassigned(){
    const wellsWrap = document.getElementById('unassignedWells')
    const pmsWrap = document.getElementById('unassignedPMs')
    const vannesWrap = document.getElementById('unassignedVannes')
    const wellsCount = document.getElementById('unassignedWellsCount')
    const pmsCount = document.getElementById('unassignedPMsCount')
    const vannesCount = document.getElementById('unassignedVannesCount')
    if(wellsWrap){
      wellsWrap.innerHTML=''
      const available = state.nodes.filter(n => n.type==='PUITS' && !n.well_collector_id)
      if(wellsCount) wellsCount.textContent = available.length ? `(${available.length})` : '(0)'
      if(!available.length){ const sm=document.createElement('small'); sm.style.color='var(--muted)'; sm.textContent='Aucun'; wellsWrap.appendChild(sm) }
      available.forEach(n=>{
        const c = chip(`➕ ${n.name||n.id}`); c.classList.add('ghost'); c.style.cursor='pointer'; c.title='Ajouter à cette canalisation'
        c.onclick = ()=>{
          moveWellToCanal(n.id, canal.id, { position: (canal.collector_well_ids||[]).length })
          updateNode(canal.id, { __touch: Date.now() })
          rebuild(); rebuildUnassigned()
        }
        wellsWrap.appendChild(c)
      })
    }
    if(pmsWrap){
      pmsWrap.innerHTML=''
      const available = state.nodes.filter(n => n.type==='POINT_MESURE' && !n.pm_collector_id)
      if(pmsCount) pmsCount.textContent = available.length ? `(${available.length})` : '(0)'
      if(!available.length){ const sm=document.createElement('small'); sm.style.color='var(--muted)'; sm.textContent='Aucun'; pmsWrap.appendChild(sm) }
      available.forEach(n=>{
        const c = chip(`➕ ${n.name||n.id}`); c.classList.add('ghost'); c.style.cursor='pointer'; c.title='Ajouter à cette canalisation'
        c.onclick = ()=>{
          const pos = Array.isArray(canal.collector_well_ids) ? canal.collector_well_ids.length : 0
          moveInlineToCanal(n.id, canal.id, pos)
          updateNode(canal.id, { __touch: Date.now() })
          rebuild(); rebuildUnassigned()
        }
        pmsWrap.appendChild(c)
      })
    }
    if(vannesWrap){
      vannesWrap.innerHTML=''
      const available = state.nodes.filter(n => n.type==='VANNE' && !n.pm_collector_id)
      if(vannesCount) vannesCount.textContent = available.length ? `(${available.length})` : '(0)'
      if(!available.length){ const sm=document.createElement('small'); sm.style.color='var(--muted)'; sm.textContent='Aucun'; vannesWrap.appendChild(sm) }
      available.forEach(n=>{
        const c = chip(`➕ ${n.name||n.id}`); c.classList.add('ghost'); c.style.cursor='pointer'; c.title='Ajouter à cette canalisation'
        c.onclick = ()=>{
          const pos = Array.isArray(canal.collector_well_ids) ? canal.collector_well_ids.length : 0
          moveInlineToCanal(n.id, canal.id, pos)
          updateNode(canal.id, { __touch: Date.now() })
          rebuild(); rebuildUnassigned()
        }
        vannesWrap.appendChild(c)
      })
    }
  }
  rebuildUnassigned()

  // Children canals listing with drag reorder (into #childCanalsList)
  const childWrap = document.getElementById('childCanalsList')
  if(childWrap){
    childWrap.innerHTML = ''
    let ordered = (canal.child_canal_ids||[]).map(id => state.nodes.find(n=>n.id===id)).filter(Boolean)
    // Fallback: derive from edges if no explicit order is stored
    if(!ordered.length){
      const edgeChildren = state.edges
        .filter(e => (e.source??e.from_id)===canal.id)
        .map(e => state.nodes.find(n=> n.id===(e.target??e.to_id)))
        .filter(n => n && (n.type==='CANALISATION' || n.type==='COLLECTEUR'))
      // Sort by vertical position as a reasonable default order
      edgeChildren.sort((a,b)=> vn(a.y,0) - vn(b.y,0))
      ordered = edgeChildren
    }
    if(!ordered.length){
      const sm = document.createElement('small'); sm.style.color='var(--muted)'; sm.textContent='Aucun branchement'
      childWrap.appendChild(sm)
    }
    ordered.forEach((c,i) => {
      const elc = chip(c.name||c.id)
      elc.dataset.id = c.id
      elc.dataset.idx = String(i)
      elc.draggable = true
      elc.classList.add('drag')
      childWrap.appendChild(elc)
    })
    let draggingC=null
    childWrap.querySelectorAll('.chip').forEach(el => {
      el.addEventListener('dragstart', (e)=>{ draggingC = el; el.classList.add('dragging'); e.dataTransfer.setData('text/plain', el.dataset.idx||'0') })
      el.addEventListener('dragend', ()=>{ el.classList.remove('dragging'); draggingC=null })
      el.addEventListener('dragover',(e)=> e.preventDefault())
      el.addEventListener('drop', (e)=>{
        e.preventDefault()
        const from = +(e.dataTransfer.getData('text/plain')||'0')
        const to = +(el.dataset.idx||'0')
        if(from===to) return
        // Rebuild source order from current display if model lacks explicit order
        const currentIds = Array.isArray(canal.child_canal_ids) && canal.child_canal_ids.length
          ? canal.child_canal_ids.slice()
          : Array.from(childWrap.querySelectorAll('.chip')).map(x=>x.dataset.id).filter(Boolean)
        const arr = currentIds.slice()
        const mv = arr.splice(from,1)[0]
        if(mv!==undefined){ arr.splice(to,0,mv); reorderChildCanals(canal.id, arr); updateNode(canal.id,{ __touch: Date.now() }) }
      })
    })
  }

  // New quick actions for creating and assigning at once
  try{
    const btnNewW = document.getElementById('cwAddNewBtn')
    if(btnNewW){
      btnNewW.onclick = ()=>{
        const w = addNode({ type:'PUITS', x:(canal.x||0)+40, y:(canal.y||0)+120 })
        moveWellToCanal(w.id, canal.id, { position: (canal.collector_well_ids||[]).length })
        updateNode(canal.id, { __touch: Date.now() })
      }
    }
    const btnNewPM = document.getElementById('pmAddNewBtn')
    if(btnNewPM){
      btnNewPM.onclick = ()=>{
        const pm = addNode({ type:'POINT_MESURE', x:(canal.x||0)+80, y:(canal.y||0)+40 })
        const pos = Array.isArray(canal.collector_well_ids) ? canal.collector_well_ids.length : 0
        moveInlineToCanal(pm.id, canal.id, pos)
        updateNode(canal.id, { __touch: Date.now() })
      }
    }
    const btnNewV = document.getElementById('vanAddNewBtn')
    if(btnNewV){
      btnNewV.onclick = ()=>{
        const v = addNode({ type:'VANNE', x:(canal.x||0)+80, y:(canal.y||0)-40 })
        const pos = Array.isArray(canal.collector_well_ids) ? canal.collector_well_ids.length : 0
        moveInlineToCanal(v.id, canal.id, pos)
        updateNode(canal.id, { __touch: Date.now() })
      }
    }
  }catch(err){ console.error('[forms] quick-create wiring failed', err) }
}

function renderWellSection(well){
  const sel = document.getElementById('wellCanalSelect')
  const info = document.getElementById('wellPosInfo')
  if(sel){
    sel.innerHTML = ''
    const optNone = document.createElement('option'); optNone.value=''; optNone.textContent='—'
    sel.appendChild(optNone)
    state.nodes.filter(n=>n.type==='CANALISATION'||n.type==='COLLECTEUR').forEach(c => {
      const o = document.createElement('option'); o.value=c.id; o.textContent=c.name||c.id; if(well.well_collector_id===c.id) o.selected=true; sel.appendChild(o)
    })
    sel.onchange = ()=>{
      const newId = sel.value
      if(newId){
        const dst = state.nodes.find(n=>n.id===newId)
        const pos = Array.isArray(dst?.collector_well_ids) ? dst.collector_well_ids.length : 0
        // Apply move first
        moveWellToCanal(well.id, newId, { position: pos })
        // Status uses intended destination + end-position (pos+1)
        setStatus(`Puits ajouté à ${(dst?.name||dst?.id||'—')} (#${pos+1})`)
        // Keep selection on the well (triggers refresh)
        try{ selectNodeById(well.id) }catch{}
      }
    }
  }
  if(info){
    const canal = state.nodes.find(n=>n.id===well.well_collector_id)
    const idx = well.well_pos_index||''
    const total = Array.isArray(canal?.collector_well_ids)? canal.collector_well_ids.length : ''
    info.value = idx && total ? `${idx} / ${total}` : ''
  }
}

function renderInlineSection(dev){
  const sel = document.getElementById('inlCanalSelect')
  const info = document.getElementById('inlPosInfo')
  const off = document.getElementById('inlOffsetInput')
  if(sel){
    sel.innerHTML = ''
    const optNone = document.createElement('option'); optNone.value=''; optNone.textContent='—'
    sel.appendChild(optNone)
    state.nodes.filter(n=>n.type==='CANALISATION'||n.type==='COLLECTEUR').forEach(c => {
      const o = document.createElement('option'); o.value=c.id; o.textContent=c.name||c.id; if(dev.pm_collector_id===c.id) o.selected=true; sel.appendChild(o)
    })
    sel.onchange = ()=>{
      const newId = sel.value
      if(newId){
        const dst = state.nodes.find(n=>n.id===newId)
        const pos = Array.isArray(dst?.collector_well_ids) ? dst.collector_well_ids.length : 0
        // Place after the last well by default
        moveInlineToCanal(dev.id, newId, pos)
        const c=dst
        setStatus(`${(dev.type==='VANNE'?'Vanne':'Point de mesure')} ajouté à ${(c?.name||c?.id||'—')} (${pos ? 'après #'+pos : 'avant #1'})`)
        try{ selectNodeById(dev.id) }catch{}
      }
    }
  }
  if(info){
    const canal = state.nodes.find(n=>n.id===dev.pm_collector_id)
    const N = Array.isArray(canal?.collector_well_ids)? canal.collector_well_ids.length : 0
    const k = Math.max(0, +dev.pm_pos_index||0)
    info.value = `${k} / ${N}`
  }
  if(off){ off.value = (dev.pm_offset_m===''||dev.pm_offset_m==null)? '' : dev.pm_offset_m; off.oninput = ()=>{ dev.pm_offset_m = (off.value===''? '' : +off.value) } }
}
