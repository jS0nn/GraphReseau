import { state, subscribe, updateNode, updateEdge, removeNode, removeEdge, clearSelection, addNode, addEdge, selectEdgeById, selectNodeById, flipEdgeDirection, recordManualDiameter, recordManualEdgeProps, getBranchName, setBranchName } from '../state/index.ts'
import { displayXYForNode, unprojectUIToLatLon } from '../geo.ts'
import { NODE_SIZE } from '../constants/nodes.ts'
import { genIdWithTime as genId, defaultName, vn, snap, isCanal, toNullableString } from '../utils.ts'
import { log } from './logs.ts'
import type { MutableNode, MutableEdge } from '../state/normalize.ts'

type FormShim = HTMLFormElement
type FormField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
type WiredElement = HTMLElement & { __wired__?: boolean }

type CanalContext = { canal: MutableNode; viaEdge: MutableEdge | null } | null

const getElement = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null

const asFormField = (element: Element | RadioNodeList | null): FormField | null => {
  if(!element) return null
  if(typeof RadioNodeList !== 'undefined' && element instanceof RadioNodeList){
    const first = element[0]
    return asFormField(first ?? null)
  }
  if(element instanceof HTMLInputElement) return element
  if(element instanceof HTMLTextAreaElement) return element
  if(element instanceof HTMLSelectElement) return element
  return null
}

const getFormField = <T extends FormField>(form: FormShim | null, name: string): T | null => {
  if(!form) return null
  const field = asFormField(form.elements.namedItem(name))
  return (field as T | null)
}

const toCanonicalMaterial = (value: unknown): string | null => {
  if(value == null || value === '') return null
  const txt = String(value).trim()
  return txt ? txt.toUpperCase() : null
}

const toCanonicalSdr = (value: unknown): string | null => {
  if(value == null || value === '') return null
  const txt = String(value).trim()
  return txt ? txt.toUpperCase() : null
}

type EdgeFormPatch = Partial<MutableEdge> & {
  branch_id?: string | null
  diameter_mm?: number | string | null
  material?: string | null
  sdr?: string | null
}
function setStatus(msg: string | null | undefined){ const el = document.getElementById('status'); if(el) el.textContent = msg || '' }

function setDisplay(id: string, on: boolean){ const g = document.getElementById(id); if(g) g.style.display = on ? 'block' : 'none' }

function findCanalContext(node: MutableNode | null | undefined): CanalContext {
  if(!node) return null
  if(isCanal(node)) return { canal: node, viaEdge: null }
  const nid = node.id
  const nodes = state.nodes as MutableNode[]
  const edges = state.edges as MutableEdge[]
  const byId = (id: string | null | undefined) => nodes.find(n=> n.id === id)
  const wellCollectorId = toNullableString(node.well_collector_id)
  if(wellCollectorId){
    const canal = byId(wellCollectorId)
    if(canal && isCanal(canal)){
      const via = edges.find(e => (e.to_id ?? e.target) === nid && (e.from_id ?? e.source) === canal.id) || null
      return { canal, viaEdge: via }
    }
  }
  const pmEdgeId = toNullableString(node.pm_collector_edge_id)
  if(pmEdgeId){
    const edge = edges.find(e => e.id === pmEdgeId)
    if(edge){
      const a = byId(edge.from_id ?? edge.source)
      const b = byId(edge.to_id ?? edge.target)
      if(a && isCanal(a)) return { canal: a, viaEdge: edge }
      if(b && isCanal(b)) return { canal: b, viaEdge: edge }
    }
  }
  for(const edge of edges){
    const fromId = edge.from_id ?? edge.source
    const toId = edge.to_id ?? edge.target
    if(fromId === nid){
      const target = byId(toId)
      if(target && isCanal(target)) return { canal: target, viaEdge: edge }
    }else if(toId === nid){
      const src = byId(fromId)
      if(src && isCanal(src)) return { canal: src, viaEdge: edge }
    }
  }
  return null
}

export function initForms(): void {
  const nodeForm = getElement<FormShim>('nodeForm')
  const edgeForm = getElement<FormShim>('edgeForm')
  const noSel = getElement('noSel')
  const delNodeBtn = getElement<HTMLButtonElement>('deleteNodeBtn')
  const delEdgeBtn = getElement<HTMLButtonElement>('deleteEdgeBtn')
  const flipEdgeBtn = getElement<HTMLButtonElement & WiredElement>('flipEdgeBtn')

  const getNodeField = <T extends FormField>(name: string): T | null => getFormField<T>(nodeForm, name)
  const getEdgeField = <T extends FormField>(name: string): T | null => getFormField<T>(edgeForm, name)

  const setCollapsed = (on: boolean): void => { document.body.classList.toggle('prop-collapsed', !!on) }
  function showNone(){ if(nodeForm) nodeForm.style.display='none'; if(edgeForm) edgeForm.style.display='none'; if(noSel) noSel.style.display='block' /* keep panel open */ }
  function showNode(){ if(nodeForm) nodeForm.style.display='block'; if(edgeForm) edgeForm.style.display='none'; if(noSel) noSel.style.display='none'; setCollapsed(false) }
  function showEdge(){ if(nodeForm) nodeForm.style.display='none'; if(edgeForm) edgeForm.style.display='block'; if(noSel) noSel.style.display='none'; setCollapsed(false) }

  // Selection rendering
  function refresh(): void {
    const nid = state.selection.nodeId
    const eid = state.selection.edgeId
    if(nid){
      const n = state.nodes.find(n=>n.id===nid)
      if(!n){ showNone(); return }
      if(!nodeForm){ showNone(); return }
      showNode()
      if(flipEdgeBtn){ flipEdgeBtn.disabled = true }
      const T = (n.type||'OUVRAGE').toUpperCase()
      const isCan = (T === 'CANALISATION')
      // Show ID (read-only)
      try{ const idEl = getElement<HTMLInputElement>('nodeId'); if(idEl) idEl.value = n.id || '' }catch{}
      setDisplay('grpCanalProps', isCan)
      setDisplay('grpInline', (T==='POINT_MESURE'||T==='VANNE'))
      const nameInput = getNodeField<HTMLInputElement>('name')
      if(nameInput) nameInput.value = n.name || ''
      const typeSelect = getNodeField<HTMLSelectElement>('type')
      if(typeSelect) typeSelect.value = (n.type || 'OUVRAGE') as string
      // Hide/disable legacy canal node type when edges-only
      if(typeSelect && typeSelect.options){
        Array.from(typeSelect.options).forEach(opt => {
          if(String(opt.value).toUpperCase()==='CANALISATION' || String(opt.textContent||'').toUpperCase()==='CANALISATION'){
            opt.disabled = true; opt.hidden = true
          }
        })
      }
      const xUiInput = getNodeField<HTMLInputElement>('x_UI')
      const yUiInput = getNodeField<HTMLInputElement>('y_UI')
      if(xUiInput) xUiInput.value = String(Math.round(+(n.x ?? 0)))
      if(yUiInput) yUiInput.value = String(Math.round(+(n.y ?? 0)))
      const diameterInput = getNodeField<HTMLInputElement>('diameter_mm')
      if(diameterInput) diameterInput.value = (isCan && n.diameter_mm != null && n.diameter_mm !== '') ? String(n.diameter_mm) : ''
      const materialInput = getNodeField<HTMLInputElement>('material')
      if(materialInput) materialInput.value = (isCan && n.material) ? String(n.material) : ''
      const infoCtx = findCanalContext(n)
      setDisplay('grpPipeInfo', !isCan && !!infoCtx?.canal)
      try{
        const nameEl = getElement<HTMLInputElement>('pipeInfoName')
        const diaEl = getElement<HTMLInputElement>('pipeInfoDiameter')
        const matEl = getElement<HTMLInputElement>('pipeInfoMaterial')
        if(nameEl) nameEl.value = infoCtx?.canal ? (infoCtx.canal.name || infoCtx.canal.id || '') : ''
        if(diaEl) diaEl.value = infoCtx?.canal?.diameter_mm == null ? '' : String(infoCtx.canal.diameter_mm)
        if(matEl) matEl.value = infoCtx?.canal?.material == null ? '' : String(infoCtx.canal.material)
      }catch{}
      const gpsLatInput = getNodeField<HTMLInputElement>('gps_lat')
      const gpsLonInput = getNodeField<HTMLInputElement>('gps_lon')
      if('gps_lat' in n && gpsLatInput) gpsLatInput.value = (n.gps_lat === '' || n.gps_lat == null) ? '' : String(n.gps_lat)
      if('gps_lon' in n && gpsLonInput) gpsLonInput.value = (n.gps_lon === '' || n.gps_lon == null) ? '' : String(n.gps_lon)
      // GPS lock toggle visibility/state
      const lock = getElement<HTMLInputElement & WiredElement>('gpsLockToggle')
      if(lock){
        lock.checked = !!n.gps_locked
        lock.disabled = false
        const parent = lock.parentElement
        if(parent instanceof HTMLElement){
          parent.style.opacity = '1'
        }
        lock.title = 'Quand activé, la position suit le GPS (non déplaçable)'
      }
      const commentInput = getNodeField<HTMLTextAreaElement>('commentaire')
      if(commentInput) commentInput.value = String(n?.commentaire ?? '')
      // Canalisation extras: render simple children list + add shortcuts
      const seq = document.getElementById('seqList')
      if(seq){
        seq.innerHTML = ''
        if(T==='POINT_MESURE' || T==='VANNE') renderInlineSection(n)
      }
    } else if(eid){
      const e = state.edges.find(e=>e.id===eid)
      if(!e){ showNone(); return }
      if(!edgeForm){ showNone(); return }
      showEdge()
      // Show edge ID (read-only)
      try{ const eIdEl = getElement<HTMLInputElement>('edgeId'); if(eIdEl) eIdEl.value = e.id || '' }catch{}
      const from = state.nodes.find(n=>n.id===(e.source??e.from_id))
      const to = state.nodes.find(n=>n.id===(e.target??e.to_id))
      const fromField = getEdgeField<HTMLInputElement>('from_name')
      if(fromField) fromField.value = toNullableString(from?.name, { trim: false }) || from?.id || ''
      const toField = getEdgeField<HTMLInputElement>('to_name')
      if(toField) toField.value = toNullableString(to?.name, { trim: false }) || to?.id || ''
      const activeField = getEdgeField<HTMLSelectElement>('active')
      if(activeField) activeField.value = String(e.active !== false)
      const branchField = getEdgeField<HTMLInputElement>('branch_id')
      if(branchField) branchField.value = toNullableString(e.branch_id, { trim: false }) || ''
      const diameterField = getEdgeField<HTMLInputElement>('diameter_mm')
      if(diameterField){
        const diaValue = Number(e.diameter_mm)
        const val = Number.isFinite(diaValue) && diaValue > 0 ? String(diaValue) : ''
        diameterField.value = val
      }
      const sdrField = getEdgeField<HTMLInputElement>('sdr')
      if(sdrField) sdrField.value = toNullableString(e.sdr, { trim: false }) || ''
      const materialField = getEdgeField<HTMLInputElement>('material')
      if(materialField) materialField.value = toNullableString(e.material, { trim: false }) || ''
      const branchNameField = getEdgeField<HTMLInputElement>('branch_name')
      if(branchNameField){
        const branchId = toNullableString(e.branch_id) || ''
        branchNameField.value = getBranchName(branchId)
      }
      const commentField = getEdgeField<HTMLTextAreaElement>('commentaire')
      if(commentField) commentField.value = toNullableString(e.commentaire, { trim: false }) || ''
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
    if(evt.startsWith('selection:') || evt.startsWith('node:') || evt.startsWith('edge:') || evt==='graph:set' || evt==='branch:update') refresh()
  })
  refresh()

  // Node form inputs
  if(nodeForm){
    // Ignore inputs that are handled by dedicated change handlers to avoid
    // premature re-render cancelling their events (e.g., canal selects).
    const IGNORE_IDS = new Set(['wellCanalSelect','inlEdgeSelect','inlOffsetInput','cwSearch','pmSearch','vanSearch','gpsLockToggle'])
    nodeForm.addEventListener('input', (evt: Event)=>{
      const t = evt?.target as HTMLElement | null
      if(t && IGNORE_IDS.has(t.id||'')) return
      const id = state.selection.nodeId
      if(!id) return
      const current = state.nodes.find(nn=>nn.id===id)
      const isCan = isCanal(current)
      const xInput = getNodeField<HTMLInputElement>('x_UI')
      const yInput = getNodeField<HTMLInputElement>('y_UI')
      const xui = xInput ? (xInput.value === '' ? '' : +xInput.value) : ''
      const yui = yInput ? (yInput.value === '' ? '' : +yInput.value) : ''
      const nameInput = getNodeField<HTMLInputElement>('name')
      const typeSelect = getNodeField<HTMLSelectElement>('type')
      const patch: Partial<MutableNode> = {
        name: nameInput ? nameInput.value : '',
        type: typeSelect ? typeSelect.value : 'OUVRAGE',
        // Keep UI and live position in sync when edited from the form
        x: xui,
        y: yui,
        x_ui: xui,
        y_ui: yui,
      }
      if(isCan){
        const diameterField = getNodeField<HTMLInputElement>('diameter_mm')
        if(diameterField) patch.diameter_mm = (diameterField.value === '' ? '' : +diameterField.value)
        const materialField = getNodeField<HTMLInputElement>('material')
        if(materialField) patch.material = materialField.value
      }
      const gpsLatField = getNodeField<HTMLInputElement>('gps_lat')
      if(gpsLatField) patch.gps_lat = (gpsLatField.value === '' ? '' : +gpsLatField.value)
      const gpsLonField = getNodeField<HTMLInputElement>('gps_lon')
      if(gpsLonField) patch.gps_lon = (gpsLonField.value === '' ? '' : +gpsLonField.value)
      const commentField = getNodeField<HTMLTextAreaElement>('commentaire')
      if(commentField) patch.commentaire = commentField.value
      updateNode(id, patch)
    })
    // GPS lock toggle
    const lock = getElement<HTMLInputElement & WiredElement>('gpsLockToggle')
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
            const patch: Partial<MutableNode> = { gps_locked: true }
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
    edgeForm.addEventListener('input', (event: Event)=>{
      const id = state.selection.edgeId
      if(!id) return
      const e = state.edges.find(edge=>edge.id === id)
      if(!e) return
      const target = event?.target as EventTarget | null
      const activeField = getEdgeField<HTMLSelectElement>('active')
      const commentField = getEdgeField<HTMLTextAreaElement>('commentaire')
      const branchField = getEdgeField<HTMLInputElement>('branch_id')
      const branchNameField = getEdgeField<HTMLInputElement>('branch_name')
      const patch: EdgeFormPatch = {
        active: activeField ? activeField.value === 'true' : e.active !== false,
        commentaire: commentField ? commentField.value : e.commentaire,
        branch_id: branchField ? branchField.value : e.branch_id ?? null,
      }
      if(target && branchField && target === branchField){
        return
      }
      if(target && branchNameField && target === branchNameField){
        return
      }
      const diameterField = getEdgeField<HTMLInputElement>('diameter_mm')
      if(diameterField){
        const raw = diameterField.value
        if(raw === ''){
          patch.diameter_mm = null
        }else{
          const num = Number(raw)
          patch.diameter_mm = Number.isFinite(num) ? num : null
        }
        if(target && diameterField && target === diameterField){
          const branchCandidate = typeof patch.branch_id === 'string' ? patch.branch_id : (e.branch_id ?? '')
          const manualBranch = branchCandidate.trim() || null
          const diameterValue = patch.diameter_mm
          recordManualDiameter(manualBranch, typeof diameterValue === 'number' || typeof diameterValue === 'string' ? diameterValue : null)
        }
      }
      const sdrField = getEdgeField<HTMLInputElement>('sdr')
      if(sdrField){
        patch.sdr = toCanonicalSdr(sdrField.value)
      }
      const materialField = getEdgeField<HTMLInputElement>('material')
      if(materialField){
        patch.material = toCanonicalMaterial(materialField.value)
      }
      updateEdge(id, patch)
      const branchCandidate = typeof patch.branch_id === 'string' ? patch.branch_id : (e.branch_id ?? '')
      const manualBranch = branchCandidate.trim() || null
      const manualPatch: EdgeFormPatch = {}
      if(target && diameterField && target === diameterField) manualPatch.diameter_mm = patch.diameter_mm ?? null
      if(target && materialField && target === materialField) manualPatch.material = patch.material ?? null
      if(target && sdrField && target === sdrField) manualPatch.sdr = patch.sdr ?? null
      if(Object.keys(manualPatch).length){
        recordManualEdgeProps(manualBranch, manualPatch)
      }
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

  const branchNameField = getEdgeField<HTMLInputElement & WiredElement>('branch_name')
  if(branchNameField && !branchNameField.__wired__){
    branchNameField.__wired__ = true
    branchNameField.addEventListener('change', ()=>{
      const id = state.selection.edgeId
      if(!id) return
      const e = state.edges.find(edge=>edge.id === id)
      if(!e || !e.branch_id) return
      setBranchName(e.branch_id, branchNameField.value)
      setStatus('Nom de branche mis à jour')
    })
  }
}

function chip(label: string, cls = ''): HTMLDivElement {
  const el = document.createElement('div')
  el.className = `chip ${cls}`
  el.textContent = label
  return el
}

function chipWithRm(kind: string, node: MutableNode, onRemove: (node: MutableNode) => void): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'chip'
  el.dataset.kind = kind
  el.dataset.id = node.id
  const label = document.createElement('span')
  label.textContent = (kind === 'W') ? (node.name || node.id) : ((node.type === 'VANNE' ? 'Vanne: ' : 'PM: ') + (node.name || node.id))
  const rm = document.createElement('span')
  rm.textContent = '✖'
  rm.title = 'Retirer'
  rm.style.cursor = 'pointer'
  rm.style.opacity = '.7'
  rm.style.marginLeft = '8px'
  rm.onclick = (e: MouseEvent) => { e.stopPropagation(); onRemove(node) }
  const drag = document.createElement('span')
  drag.textContent = '☰'
  drag.className = 'drag'
  drag.style.marginRight = '6px'
  el.appendChild(drag)
  el.appendChild(label)
  el.appendChild(rm)
  return el
}

function btnChip(label: string, onclick: () => void): HTMLDivElement {
  const c = chip(label)
  c.style.cursor = 'pointer'
  c.onclick = onclick
  return c
}

function renderCanalSequence(){ /* canal nodes removed */ }

function renderInlineSection(dev: MutableNode): void {
  const selEdge = getElement<HTMLSelectElement>('inlEdgeSelect')
  const info = getElement<HTMLInputElement>('inlPosInfo')
  const off = getElement<HTMLInputElement>('inlOffsetInput')

  if(selEdge){
    selEdge.innerHTML = ''
    const optNone = document.createElement('option'); optNone.value=''; optNone.textContent='—'
    selEdge.appendChild(optNone)

    const grouped = new Map<string, MutableEdge[]>()
    ;(state.edges as MutableEdge[]).forEach((edge: MutableEdge) => {
      
      const key = String(edge.branch_id || edge.id || '')
      const list = grouped.get(key)
      if(list){
        list.push(edge)
      }else{
        grouped.set(key, [edge])
      }
    })

    const orderedEntries = Array.from(grouped.entries()).sort(([a], [b]) => String(a).localeCompare(String(b)))
    orderedEntries.forEach(([branchId, edges]) => {
      edges.forEach((edge: MutableEdge, idx: number) => {
          const a = state.nodes.find(n => n.id === (edge.from_id ?? edge.source))
          const b = state.nodes.find(n => n.id === (edge.to_id ?? edge.target))
          if(!a || !b) return
          const name = `${a.name || a.id} → ${b.name || b.id}${edges.length>1?` (#${idx+1})`:''}`
          const opt = document.createElement('option')
          opt.value = edge.id
          opt.textContent = `${getBranchName(branchId) || branchId} · ${name}`
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
    off.value = dev.pm_offset_m == null || dev.pm_offset_m === '' ? '' : String(dev.pm_offset_m)
    off.oninput = () => { dev.pm_offset_m = off.value === '' ? '' : +off.value }
  }
}

function renderGeneralSection(){ /* canal UI removed */ }
