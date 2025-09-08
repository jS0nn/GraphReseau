import './polyfills.js'
import { getGraph, saveGraph, getMode } from './api.js'

/*
  Portage de l’éditeur depuis Apps Script (legacy) – rendu SVG, interactions, formulaires, logs, exports, layout ELK+fallback.
  Points clés (migration finalisée côté données):
  - API native: échanges via getGraph/saveGraph (fetch) définis dans api.js — plus d’appel à google.script.run.
  - DOM: fourni par app/templates/index.html (boutons, formulaires, SVG, etc.).
  - d3 et ELK: exposés globalement par vendor.js (window.d3 / window.ELK).
*/

// Utils & état
const $$ = (s)=>document.querySelector(s)
function status(msg){ const el=$$('#status'); if(el) el.textContent=msg||'' }
const gridStep=8
let snapEnabled=true
function snap(v){ return snapEnabled ? Math.round(v/gridStep)*gridStep : v }
function vn(v,def){
  // Coerce '', null, undefined, NaN to default; numbers or numeric strings to number
  if (v === '' || v === null || v === undefined) return def
  const n = +v
  return Number.isNaN(n) ? def : n
}
function genId(prefix='N'){ const t=Date.now().toString(36).slice(-6); const r=Math.floor(Math.random()*1e6).toString(36); return `${prefix}-${t}${r}`.toUpperCase() }
function incrementName(name){ if(!name) return 'N-001'; const m=name.match(/^(.*?)(\d+)(\D*)$/); if(m){ const base=m[1],num=m[2],suf=m[3]||''; let next=String(parseInt(num,10)+1).padStart(num.length,'0'); let cand=`${base}${next}${suf}`; while(nodes.some(x=>x.name===cand)){ next=String(parseInt(next,10)+1).padStart(num.length,'0'); cand=`${base}${next}${suf}`; } return cand; } let k=1,cand=`${name}-copy`; while(nodes.some(x=>x.name===cand)){ k++; cand=`${name}-copy${k}`; } return cand; }
const isCanal=n=>(n.type==='CANALISATION'||n.type==='COLLECTEUR')
function setPropCollapsed(on){ document.body.classList.toggle('prop-collapsed', !!on) }

let nodes=[], edges=[]
let mode='select'
let selectedNode=null, selectedEdge=null
let selectedIds=new Set()
let connectSource=null

// d3 selections
const d3 = window.d3
const ELK = window.ELK
const svg=d3.select('#svg'); const zoomRoot=d3.select('#zoomRoot')
const gInline=zoomRoot.select('.inline-conns'); const gEdges=zoomRoot.select('.edges'); const gNodes=zoomRoot.select('.nodes'); const gOverlay=zoomRoot.select('.overlay')

function adjustWrapTop(){ const h=$$('#appbar')?.getBoundingClientRect().height||70; document.documentElement.style.setProperty('--appbar-height', Math.ceil(h)+'px') }
window.addEventListener('resize', adjustWrapTop)

// Zoom / Theme / Buttons
const zoom=d3.zoom().scaleExtent([0.25,2]).on('zoom',(e)=>zoomRoot.attr('transform',e.transform))
svg.call(zoom)
function zoomBy(k){ svg.transition().duration(160).call(zoom.scaleBy,k) }
function zoomFit(){
  if(!nodes.length){ svg.transition().call(zoom.transform,d3.zoomIdentity); return }
  const xs=nodes.map(n=>vn(n.x,120)), ys=nodes.map(n=>vn(n.y,120))
  const minX=Math.min(...xs)-80, maxX=Math.max(...xs)+260
  const minY=Math.min(...ys)-80, maxY=Math.max(...ys)+140
  const cw=$$('#canvas').clientWidth, ch=$$('#canvas').clientHeight
  const scale=Math.min(cw/(maxX-minX), ch/(maxY-minY), 2)
  const tx=(cw - scale*(maxX-minX))/2 - scale*minX
  const ty=(ch - scale*(maxY-minY))/2 - scale*minY
  svg.transition().duration(220).call(zoom.transform, d3.zoomIdentity.translate(tx,ty).scale(scale))
}

document.getElementById('themeBtn').onclick=()=>{ document.body.dataset.theme=(document.body.dataset.theme==='light'?'dark':'light'); render(); adjustWrapTop() }
document.getElementById('zoomInBtn').onclick  = ()=>zoomBy(1.15)
document.getElementById('zoomOutBtn').onclick = ()=>zoomBy(1/1.15)
document.getElementById('zoomFitBtn').onclick = zoomFit

// Historique
const hist=[]; let histIdx=-1
function snapshot(){ return JSON.parse(JSON.stringify({nodes,edges})) }
function pushHist(){ hist.splice(histIdx+1); hist.push({state:snapshot()}); histIdx=hist.length-1 }
function undo(){ if(histIdx<=0) return; histIdx--; ({nodes,edges}=JSON.parse(JSON.stringify(hist[histIdx].state))); clearSelection(); render(); status('Annulé') }
function redo(){ if(histIdx>=hist.length-1) return; histIdx++; ({nodes,edges}=JSON.parse(JSON.stringify(hist[histIdx].state))); clearSelection(); render(); status('Rétabli') }

// Raccourcis
let spacePan=false
window.addEventListener('keydown',(e)=>{
  const inForm=/(INPUT|SELECT|TEXTAREA)/.test(document.activeElement?.tagName||'')
  if(!inForm){
    const m=e.metaKey||e.ctrlKey
    if(m && (e.key==='z'||e.key==='Z')){ e.preventDefault(); undo(); return }
    if(m && (e.key==='y'||(e.shiftKey && (e.key==='Z'||e.key==='z')))){ e.preventDefault(); redo(); return }
    if(m && (e.key==='c'||e.key==='C')){ e.preventDefault(); copySelection(); return }
    if(m && (e.key==='v'||e.key==='V')){ e.preventDefault(); pasteClipboard(); return }
    if(e.key==='l'||e.key==='L'){ e.preventDefault(); autoLayout(); return }
    if(e.key==='c'||e.key==='C'){ e.preventDefault(); setMode('connect'); return }
    if(e.key==='Delete'||e.key==='Backspace'){ e.preventDefault(); deleteSelection(); return }
    if(e.key==='='||e.key==='+'){ e.preventDefault(); zoomBy(1.15); return }
    if(e.key==='-'){ e.preventDefault(); zoomBy(1/1.15); return }
  }
  if(e.code==='Space'){ spacePan=true; svg.style('cursor','grab') }
})
window.addEventListener('keyup',(e)=>{ if(e.code==='Space'){ spacePan=false; svg.style('cursor','') } })

// Ajout / suppression / connexions
function deleteSelection(){
  if (selectedEdge) {
    // reuse button handler
    const btn = document.getElementById('deleteEdgeBtn')
    if (btn) btn.click();
    return
  }
  if (selectedIds && selectedIds.size) {
    const targets = nodes.filter(n=>selectedIds.has(n.id))
    if (!targets.length) return
    if (!confirm(`Supprimer ${targets.length} élément(s) et leurs liens ?`)) return
    targets.forEach(n=>deleteNode(n))
    pushHist(); render(); status('Sélection supprimée')
    return
  }
  if (selectedNode) {
    if (!confirm(`Supprimer ${selectedNode.name||selectedNode.id} ?`)) return
    deleteNode(selectedNode); pushHist(); render(); status('Nœud supprimé')
  }
}

function defaultName(type){
  const base={PUITS:'P-',CANALISATION:'C-',COLLECTEUR:'C-',PLATEFORME:'PL-',VANNE:'V-',POINT_MESURE:'M-'}[type]||'N-'
  let k=nodes.filter(n=>n.type===type||(type==='CANALISATION'&&n.type==='COLLECTEUR')).length+1
  let s=`${base}${String(k).padStart(3,'0')}`; while(nodes.some(n=>n.name===s)){ k++; s=`${base}${String(k).padStart(3,'0')}` } return s
}
function addNode(type='PUITS',xy){
  const id=genId(type)
  const n={id,name:defaultName(type),type:(type==='COLLECTEUR'?'CANALISATION':type),
    branch_id:'',diameter_mm:'', collector_well_ids:[], child_canal_ids:[],
    well_collector_id:'',well_pos_index:'', pm_collector_id:'',pm_pos_index:'',pm_offset_m:'',
    gps_lat:'',gps_lon:'', x:xy?.x??snap(120+Math.random()*200), y:xy?.y??snap(120+Math.random()*200)}
  nodes.push(n); pushHist(); selectSingle(n); render()
}
function deleteNode(n){
  if(!n) return
  if(n.type==='PUITS'){
    nodes.filter(isCanal).forEach(c=>{ c.collector_well_ids=(c.collector_well_ids||[]).filter(id=>id!==n.id) })
    edges=edges.filter(e=>e.to_id!==n.id)
  }
  if(n.type==='POINT_MESURE' || n.type==='VANNE'){
    n.pm_collector_id=''; n.pm_pos_index=''; n.pm_offset_m=''
  }
  if(isCanal(n)){
    nodes.forEach(x=>{
      if(x.type==='PUITS' && x.well_collector_id===n.id){ x.well_collector_id=''; x.well_pos_index='' }
      if((x.type==='POINT_MESURE'||x.type==='VANNE') && x.pm_collector_id===n.id){ x.pm_collector_id=''; x.pm_pos_index=''; x.pm_offset_m='' }
    })
    nodes.filter(isCanal).forEach(c=>{ c.child_canal_ids=(c.child_canal_ids||[]).filter(id=>id!==n.id) })
    edges=edges.filter(e=>e.from_id!==n.id && e.to_id!==n.id)
  }
  nodes=nodes.filter(x=>x.id!==n.id)
  clearSelection(); pushHist(); render()
}
function addEdge(fromNode,toNode){
  if(!fromNode||!toNode||fromNode.id===toNode.id) return
  const isInline = n => n.type==='POINT_MESURE' || n.type==='VANNE'
  if((isInline(fromNode)&&isCanal(toNode))||(isInline(toNode)&&isCanal(fromNode))){
    const dev=isInline(fromNode)?fromNode:toNode; const canal=isCanal(fromNode)?fromNode:toNode
    attachInlineToCanal(dev, canal); pushHist(); selectSingle(dev); render(); status(`${dev.type==='VANNE'?'Vanne':'Point de mesure'} → ${canal.name}`); return
  }
  if((fromNode.type==='PUITS'&&isCanal(toNode))||(toNode.type==='PUITS'&&isCanal(fromNode))){
    const well=fromNode.type==='PUITS'?fromNode:toNode; const canal=isCanal(fromNode)?fromNode:toNode
    if(!edges.some(e=>e.from_id===canal.id&&e.to_id===well.id)){ edges.push({id:genId('E'),from_id:canal.id,to_id:well.id,active:true}) }
    appendWellToCanal(canal,well); pushHist(); selectSingle(well); render(); status(`Puits connecté à ${canal.name}`); return
  }
  if(isCanal(fromNode) && isCanal(toNode)){
    if(!edges.some(e=>e.from_id===fromNode.id && e.to_id===toNode.id)){ edges.push({id:genId('E'),from_id:fromNode.id,to_id:toNode.id,active:true}) }
    ensureChildOrder(fromNode, toNode); pushHist(); render(); status(`Branchement ${toNode.name} sur ${fromNode.name}`); return
  }
}
function ensureChildOrder(parent, child){
  if(!Array.isArray(parent.child_canal_ids)) parent.child_canal_ids=[]
  parent.child_canal_ids = parent.child_canal_ids.filter(id => edges.some(e=>e.from_id===parent.id && e.to_id===id && isCanal(nodes.find(n=>n.id===id))))
  if(!parent.child_canal_ids.includes(child.id)) parent.child_canal_ids.push(child.id)
  parent.child_canal_ids.sort((a,b)=>{ const ya = vn(nodes.find(n=>n.id===a)?.y,0); const yb = vn(nodes.find(n=>n.id===b)?.y,0); return ya - yb })
}
function appendWellToCanal(canal, well){
  if(!Array.isArray(canal.collector_well_ids)) canal.collector_well_ids=[]
  if(!canal.collector_well_ids.includes(well.id)) canal.collector_well_ids.push(well.id)
  canal.collector_well_ids = canal.collector_well_ids.filter(id => nodes.some(n=>n.id===id && n.type==='PUITS'))
  canal.collector_well_ids.forEach((id,i)=>{ const w=nodes.find(n=>n.id===id); if(w){ w.well_pos_index=i+1; w.well_collector_id=canal.id }})
}
function attachInlineToCanal(dev,canal){ dev.pm_collector_id = canal.id; dev.pm_pos_index = (canal.collector_well_ids||[]).length }

// UI – sélection & formulaires
function setMode(m){
  mode=m; connectSource=null
  $$('#modeSelect').classList.toggle('active',m==='select')
  $$('#modeConnect').classList.toggle('active',m==='connect')
  $$('#modeDelete').classList.toggle('active',m==='delete')
  status(m==='connect'?'Clique une source, puis une cible (nœud)':'')
}
function clearSelection(){ selectedNode=null; selectedEdge=null; selectedIds.clear(); $$('#nodeForm').style.display='none'; $$('#edgeForm').style.display='none'; $$('#noSel').style.display='block'; setPropCollapsed(true); render() }
function selectSingle(n){ selectedNode=n; selectedEdge=null; selectedIds=new Set([n.id]); showNodeForm(n); setPropCollapsed(false); render() }
function selectEdgeOnly(e){
  selectedEdge=e; selectedNode=null; selectedIds.clear(); setPropCollapsed(false)
  const f=$$('#edgeForm'); f.style.display='block'; $$('#nodeForm').style.display='none'; $$('#noSel').style.display='none'
  const from=nodes.find(n=>n.id===e.from_id), to=nodes.find(n=>n.id===e.to_id)
  f.from_name.value=from?.name||''; f.to_name.value=to?.name||''; f.active.value=String(e.active!==false); render()
}

const FORM_INPUT_IGNORE=new Set(['wellCanalSelect','inlCanalSelect','inlOffsetInput','cwSearch','pmSearch','vanSearch'])
function showNodeForm(n){
  const f=$$('#nodeForm'); f.style.display='block'; $$('#edgeForm').style.display='none'; $$('#noSel').style.display='none'
  f.name.value=n.name||''; f.type.value=(n.type==='COLLECTEUR'?'CANALISATION':(n.type||'PUITS'))
  f.diameter_mm.value=n.diameter_mm??''; f.x.value=Math.round(vn(n.x,0)); f.y.value=Math.round(vn(n.y,0))
  f.gps_lat.value=n.gps_lat??''; f.gps_lon.value=n.gps_lon??''
  const type=(n.type==='COLLECTEUR'?'CANALISATION':(n.type||'PUITS')).toUpperCase()
  $$('#grpDiameter').style.display=(type==='PUITS'||type==='CANALISATION'||type==='VANNE')?'block':'none'
  $$('#grpCanal').style.display=(type==='CANALISATION')?'block':'none'
  $$('#grpWell').style.display=(type==='PUITS')?'block':'none'
  $$('#grpInline').style.display=(type==='POINT_MESURE'||type==='VANNE')?'block':'none'
  try{
    if(type==='CANALISATION') refreshCanalUI();
    if(type==='PUITS') refreshWellUI();
    if(type==='POINT_MESURE'||type==='VANNE') refreshInlineUI();
  }catch(err){ console.error('[showNodeForm] refresh failed', err, { type, node: n }) }
  $$('#grpPos').open=true
  $$('#deleteNodeBtn').onclick=()=>{ if(!selectedNode) return; if(confirm(`Supprimer ${selectedNode.name} ?`)){ deleteNode(selectedNode); status('Nœud supprimé') } }
}

$$('#nodeForm').addEventListener('input',(evt)=>{
  if(!selectedNode) return; if(FORM_INPUT_IGNORE.has(evt.target.id||'')) return
  const f=evt.currentTarget
  selectedNode.name=f.name.value; selectedNode.type=(f.type.value==='COLLECTEUR'?'CANALISATION':f.type.value)
  selectedNode.diameter_mm=f.diameter_mm.value===''? '': +f.diameter_mm.value
  selectedNode.x=f.x.value===''? '': +f.x.value; selectedNode.y=f.y.value===''? '': +f.y.value
  selectedNode.gps_lat=f.gps_lat.value===''? '': +f.gps_lat.value; selectedNode.gps_lon=f.gps_lon.value===''? '': +f.gps_lon.value
  const t=(selectedNode.type||'PUITS').toUpperCase()
  $$('#grpDiameter').style.display=(t==='PUITS'||t==='CANALISATION'||t==='VANNE')?'block':'none'
  $$('#grpCanal').style.display=(t==='CANALISATION')?'block':'none'
  $$('#grpWell').style.display=(t==='PUITS')?'block':'none'
  $$('#grpInline').style.display=(t==='POINT_MESURE'||t==='VANNE')?'block':'none'
  if(t==='CANALISATION') refreshCanalUI(); if(t==='PUITS') refreshWellUI(); if(t==='POINT_MESURE'||t==='VANNE') refreshInlineUI(); render()
})

function refreshWellUI(){
  const w=selectedNode; const selC=$$('#wellCanalSelect'); const posInfo=$$('#wellPosInfo')
  const canals=nodes.filter(isCanal)
  selC.innerHTML = '<option value="">— aucun —</option>' + canals.map(c=>`<option value="${c.id}" ${c.id===w.well_collector_id?'selected':''}>${c.name}</option>`).join('')
  posInfo.value = w.well_pos_index ? String(w.well_pos_index) : ''
  selC.onchange=()=>{
    const old=nodes.find(n=>n.id===w.well_collector_id); const neu=nodes.find(n=>n.id===selC.value)
    if(old && old!==neu){
      old.collector_well_ids=(old.collector_well_ids||[]).filter(id=>id!==w.id)
      edges = edges.filter(e=> !(e.from_id===old.id && e.to_id===w.id))
      old.collector_well_ids.forEach((id,i)=>{ const ww=nodes.find(n=>n.id===id); if(ww){ ww.well_pos_index=i+1; ww.well_collector_id=old.id }})
    }
    if(neu){
      appendWellToCanal(neu,w)
      if(!edges.some(e=>e.from_id===neu.id && e.to_id===w.id)){ edges.push({id:genId('E'),from_id:neu.id,to_id:w.id,active:true}) }
    }else{ w.well_collector_id=''; w.well_pos_index='' }
    pushHist(); refreshWellUI(); render()
  }
}

function buildSequence(canal){
  const wells=(canal.collector_well_ids||[]).slice()
  const pms=nodes.filter(n=>n.type==='POINT_MESURE' && n.pm_collector_id===canal.id)
  const vans=nodes.filter(n=>n.type==='VANNE' && n.pm_collector_id===canal.id)
  const seq=[]
  for(let i=0;i<=wells.length;i++){
    pms.filter(m => (+m.pm_pos_index||0)===i).forEach(m=>seq.push({kind:'M',id:m.id}))
    vans.filter(v => (+v.pm_pos_index||0)===i).forEach(v=>seq.push({kind:'V',id:v.id}))
    if(i<wells.length) seq.push({kind:'W',id:wells[i]})
  }
  return seq
}
function applySequenceToModel(canal, seq){
  canal.collector_well_ids = seq.filter(t=>t.kind==='W').map(t=>t.id)
  canal.collector_well_ids.forEach((id,i)=>{ const w=nodes.find(n=>n.id===id); if(w){ w.well_collector_id=canal.id; w.well_pos_index=i+1 }})
  let wellsBefore=0
  seq.forEach(t=>{
    if(t.kind==='W'){ wellsBefore++ }
    else{
      const dev = nodes.find(n=>n.id===t.id && (n.type==='POINT_MESURE'||n.type==='VANNE'))
      if(dev){ dev.pm_collector_id = canal.id; dev.pm_pos_index = wellsBefore }
    }
  })
}
function refreshCanalUI(){
  const canal=selectedNode
  console.debug('[refreshCanalUI] start', { canal })
  const childEdges = edges.filter(e=>e.from_id===canal.id).map(e=>nodes.find(n=>n.id===e.to_id)).filter(isCanal)
  console.debug('[refreshCanalUI] childEdges', { count: childEdges.length })
  if(!Array.isArray(canal.child_canal_ids)) canal.child_canal_ids=[]
  canal.child_canal_ids = canal.child_canal_ids.filter(id => childEdges.some(c=>c.id===id))
  const missing = childEdges.filter(c=>!canal.child_canal_ids.includes(c.id)).map(c=>c.id)
  if(missing.length){ missing.sort((a,b)=>vn(nodes.find(n=>n.id===a)?.y,0)-vn(nodes.find(n=>n.id===b)?.y,0)); canal.child_canal_ids = canal.child_canal_ids.concat(missing) }
  canal.collector_well_ids = (canal.collector_well_ids||[]).filter(id => nodes.some(n=>n.id===id && n.type==='PUITS'))
  const seq = buildSequence(canal)
  console.debug('[refreshCanalUI] seq', { length: seq.length })
  const list=$$('#seqList'); if (!list) { console.error('[refreshCanalUI] #seqList missing'); return }
  list.innerHTML=''
  function labelFor(token){ const n = nodes.find(x=>x.id===token.id); if(token.kind==='W') return n?.name||token.id; if(token.kind==='M') return (n?.name||token.id)+' · PM'; if(token.kind==='V') return (n?.name||token.id)+' · Vanne'; return token.id }
  function chipFor(token, idx){
    const chip=document.createElement('div'); chip.className='chip'; chip.draggable=true; chip.dataset.idx=idx; chip.dataset.kind=token.kind; chip.dataset.id=token.id
    chip.innerHTML=`<span class="drag" title="Déplacer">☰</span><span>${labelFor(token)}</span><span class="rm" style="opacity:.7;cursor:pointer" title="Retirer">✖</span>`
    chip.addEventListener('dragstart',e=>{ chip.classList.add('dragging'); e.dataTransfer.setData('text/plain', idx.toString()) })
    chip.addEventListener('dragend',()=>chip.classList.remove('dragging'))
    chip.addEventListener('dragover',e=>e.preventDefault())
    chip.addEventListener('drop',e=>{ e.preventDefault(); const from=+e.dataTransfer.getData('text/plain'); const to=+chip.dataset.idx; if(from===to) return; const newSeq = seq.slice(); const moved=newSeq.splice(from,1)[0]; newSeq.splice(to,0,moved); applySequenceToModel(canal, newSeq); pushHist(); refreshCanalUI(); render() })
    chip.querySelector('.rm').onclick=()=>{
      if (token.kind==='W'){
        canal.collector_well_ids = (canal.collector_well_ids||[]).filter(id=>id!==token.id)
        edges = edges.filter(e=> !(e.from_id===canal.id && e.to_id===token.id))
        canal.collector_well_ids.forEach((id,i)=>{ const w=nodes.find(n=>n.id===id); if(w){ w.well_pos_index=i+1; w.well_collector_id=canal.id }})
      } else {
        const dev = nodes.find(n=>n.id===token.id && (n.type==='POINT_MESURE'||n.type==='VANNE'))
        if(dev){ dev.pm_collector_id=''; dev.pm_pos_index=''; dev.pm_offset_m='' }
      }
      pushHist(); refreshCanalUI(); render()
    }
    return chip
  }
  seq.forEach((t,i)=> list.appendChild(chipFor(t,i)))
  console.debug('[refreshCanalUI] chips ready')

  const dl=$$('#cwDatalist'); const inp=$$('#cwSearch')
  const availWells=nodes.filter(n=>n.type==='PUITS' && !n.well_collector_id)
  if (dl) dl.innerHTML=availWells.map(n=>`<option value="${(n.name||n.id)}" data-id="${n.id}">`).join('')
  if (inp) { inp.value=''; inp.placeholder = availWells.length ? 'Puits non attribués…' : 'Aucun puits dispo' }
  $$('#cwAddBtn').onclick=()=>{
    const val=inp.value.trim(); if(!val) return
    const opt = $$('#cwDatalist').querySelector(`option[value="${CSS.escape(val)}"]`)
    const id = opt?.dataset.id
    const cand = id ? nodes.find(n=>n.id===id) : nodes.find(n=>n.type==='PUITS' && !n.well_collector_id && ((n.name && n.name===val) || n.id===val))
    if(!cand){ alert('Aucun puits non attribué trouvé.'); return }
    appendWellToCanal(canal,cand)
    if(!edges.some(e=>e.from_id===canal.id && e.to_id===cand.id)){ edges.push({id:genId('E'),from_id:canal.id,to_id:cand.id,active:true}) }
    inp.value=''; pushHist(); refreshCanalUI(); render()
  }
  $$('#cwAddNewBtn').onclick=()=>{
    const w={id:genId('PUITS'), name:defaultName('PUITS'), type:'PUITS', x:snap(vn(canal.x,120)+260), y:snap(vn(canal.y,120)+26+ ((canal.collector_well_ids?.length||0))*68)}
    nodes.push(w); appendWellToCanal(canal,w); edges.push({id:genId('E'), from_id:canal.id, to_id:w.id, active:true}); pushHist(); refreshCanalUI(); render(); selectSingle(w)
  }
  const refreshInlineLists=()=>{
    const availPM = nodes.filter(n => n.type === 'POINT_MESURE' && !n.pm_collector_id)
    $$('#pmDatalist').innerHTML = availPM.map(n=>`<option value="${(n.name||n.id)}" data-id="${n.id}">`).join('')
    $$('#pmSearch').placeholder = availPM.length ? 'Point de mesure non attribué…' : 'Aucun PM dispo'
    const availV = nodes.filter(n => n.type === 'VANNE' && !n.pm_collector_id)
    $$('#vanDatalist').innerHTML = availV.map(n=>`<option value="${(n.name||n.id)}" data-id="${n.id}">`).join('')
    $$('#vanSearch').placeholder = availV.length ? 'Vanne non attribuée…' : 'Aucune vanne dispo'
  }
  refreshInlineLists()
  $$('#pmAddBtn').onclick=()=>{ const val = $$('#pmSearch').value.trim(); if (!val) return; const opt = $$('#pmDatalist').querySelector(`option[value="${CSS.escape(val)}"]`); const id = opt?.dataset.id; let pm = id ? nodes.find(x => x.id===id) : nodes.find(x => x.type==='POINT_MESURE' && !x.pm_collector_id && ((x.name && x.name===val) || x.id===val)); if (!pm) { alert('PM introuvable ou déjà attribué.'); return; } pm.pm_collector_id = canal.id; pm.pm_pos_index = (canal.collector_well_ids || []).length; $$('#pmSearch').value=''; pushHist(); refreshInlineLists(); refreshCanalUI(); render() }
  $$('#pmAddNewBtn').onclick=()=>{ const m={ id:genId('POINT_MESURE'), name:defaultName('POINT_MESURE'), type:'POINT_MESURE', x:snap(vn(canal.x,120)+200), y:snap(vn(canal.y,120)+26), pm_collector_id:canal.id, pm_pos_index:(canal.collector_well_ids||[]).length, pm_offset_m:'' }; nodes.push(m); pushHist(); refreshInlineLists(); refreshCanalUI(); render(); selectSingle(m) }
  $$('#vanAddBtn').onclick=()=>{ const val = $$('#vanSearch').value.trim(); if (!val) return; const opt = $$('#vanDatalist').querySelector(`option[value="${CSS.escape(val)}"]`); const id = opt?.dataset.id; let v = id ? nodes.find(x => x.id===id) : nodes.find(x => x.type==='VANNE' && !x.pm_collector_id && ((x.name && x.name===val) || x.id===val)); if (!v) { alert('Vanne introuvable ou déjà attribuée.'); return; } v.pm_collector_id = canal.id; v.pm_pos_index = (canal.collector_well_ids || []).length; $$('#vanSearch').value=''; pushHist(); refreshInlineLists(); refreshCanalUI(); render() }
  $$('#vanAddNewBtn').onclick=()=>{ const v={ id:genId('VANNE'), name:defaultName('VANNE'), type:'VANNE', x:snap(vn(canal.x,120)+220), y:snap(vn(canal.y,120)-12), pm_collector_id:canal.id, pm_pos_index:(canal.collector_well_ids||[]).length, pm_offset_m:'' }; nodes.push(v); pushHist(); refreshInlineLists(); refreshCanalUI(); render(); selectSingle(v) }
  try {
    const childWrap = document.getElementById('childCanalsList')
    if (!childWrap) { console.error('[refreshCanalUI] #childCanalsList missing'); return }
    childWrap.innerHTML = ''

    const childIds = Array.isArray(canal.child_canal_ids) ? canal.child_canal_ids.slice() : []
    for (let i = 0; i < childIds.length; i++) {
      const cid = childIds[i]
      const c = nodes.find(n => n.id === cid)

      const chip = document.createElement('div')
      chip.className = 'chip'
      chip.draggable = true
      chip.dataset.idx = String(i)
      chip.dataset.id = cid
      chip.innerHTML = `<span class="drag">☰</span><span>${(c && c.name) || cid}</span>`

      chip.addEventListener('dragstart', (e) => {
        try { chip.classList.add('dragging'); e.dataTransfer.setData('text/plain', String(i)) } catch (ex) { console.error('[childCanals] dragstart', ex) }
      })
      chip.addEventListener('dragend', () => chip.classList.remove('dragging'))
      chip.addEventListener('dragover', (e) => { try { e.preventDefault() } catch (ex) { console.error('[childCanals] dragover', ex) } })
      chip.addEventListener('drop', (e) => {
        try {
          e.preventDefault()
          const from = +e.dataTransfer.getData('text/plain')
          const to = +chip.dataset.idx
          if (from === to) return
          const arr = Array.isArray(canal.child_canal_ids) ? canal.child_canal_ids.slice() : []
          const mv = arr.splice(from, 1)[0]
          if (mv !== undefined) {
            arr.splice(to, 0, mv)
            canal.child_canal_ids = arr
            pushHist(); refreshCanalUI(); render()
          }
        } catch (ex) {
          console.error('[childCanals] drop', ex)
        }
      })
      if (typeof childWrap.appendChild === 'function') childWrap.appendChild(chip)
      else console.error('[childCanals] appendChild not a function on', childWrap)
    }
  } catch (e) {
    console.error('[refreshCanalUI] childCanalsList build failed', e, { ids: canal.child_canal_ids })
  }
}
function refreshInlineUI(){
  const dev=selectedNode; const selC=$$('#inlCanalSelect'); const posI=$$('#inlPosInfo'); const offI=$$('#inlOffsetInput')
  const canals=nodes.filter(isCanal)
  selC.innerHTML='<option value="">— aucune —</option>'+ canals.map(c=>`<option value="${c.id}" ${c.id===dev.pm_collector_id?'selected':''}>${c.name}</option>`).join('')
  posI.value = (dev.pm_pos_index===''||dev.pm_pos_index==null) ? '' : String(dev.pm_pos_index)
  selC.onchange=()=>{ dev.pm_collector_id = selC.value || ''; if(dev.pm_collector_id){ const c = nodes.find(n=>n.id===dev.pm_collector_id); dev.pm_pos_index = Math.min((c?.collector_well_ids||[]).length, (+dev.pm_pos_index||0)); }else{ dev.pm_pos_index=''; dev.pm_offset_m='' } pushHist(); refreshInlineUI(); render() }
  offI.value = (dev.pm_offset_m ?? '')
  offI.oninput = ()=>{ const v = offI.value.trim(); dev.pm_offset_m = v==='' ? '' : (+v); pushHist(); render() }
}

// Rendu
let canalColor = new Map()
function makeThemeColorGenerator(){ const GOLD = 137.508; let i = 0; const isLight = (document.body.dataset.theme === 'light'); const L_SEQ_DARK  = [68,72,64,75,70,66,74,62]; const S_SEQ_DARK  = [70,66,74,60,68,72,64,76]; const L_SEQ_LIGHT = [40,36,44,32,48,30,42,34]; const S_SEQ_LIGHT = [72,68,78,64,70,60,75,66]; const Ls = isLight ? L_SEQ_LIGHT : L_SEQ_DARK; const Ss = isLight ? S_SEQ_LIGHT : S_SEQ_DARK; return function nextColor(){ const hue = (i * GOLD) % 360; const l = Ls[i % Ls.length]; const s = Ss[i % Ss.length]; i++; return `hsl(${hue.toFixed(2)}, ${s}%, ${l}%)` } }
function assignCanalColors(){ canalColor.clear(); const nextCol = makeThemeColorGenerator(); const nm = new Map(nodes.map(n=>[n.id,n])); const canals = nodes.filter(isCanal); const inBy=new Map(), outBy=new Map(); edges.forEach(e=>{ (inBy.get(e.to_id)||inBy.set(e.to_id,[]) && inBy.get(e.to_id)).push(e); (outBy.get(e.from_id)||outBy.set(e.from_id,[]) && outBy.get(e.from_id)).push(e) }); const roots = canals.filter(c=> !((inBy.get(c.id)||[]).some(e=> isCanal(nm.get(e.from_id)))) ); const visited=new Set(); function dfs(c, col){ if(!c) return; if(!col) col=nextCol(); canalColor.set(c.id, col); visited.add(c.id); const outs = (outBy.get(c.id)||[]).map(e=>nm.get(e.to_id)).filter(n=>n && isCanal(n)); if(!outs.length) return; const sorted = outs.slice().sort((a,b)=>{ const da=+a.diameter_mm||0, db=+b.diameter_mm||0; if(db!==da) return db-da; return nodes.indexOf(a)-nodes.indexOf(b) }); const main = sorted[0]; if(main && !visited.has(main.id)) dfs(main, col); for(let i=1;i<sorted.length;i++){ const child=sorted[i]; if(!visited.has(child.id)) dfs(child, nextCol()) } } roots.forEach(r=>dfs(r,null)); canals.forEach(c=>{ if(!canalColor.has(c.id)) canalColor.set(c.id, nextCol()) }) }
function edgePolyline(e){ const a=nodes.find(n=>n.id===e.from_id), b=nodes.find(n=>n.id===e.to_id); if(!a||!b) return null; const ax=vn(a.x,120)+180, ay=vn(a.y,120)+26; const bx=vn(b.x,120), by=vn(b.y,120)+26; const midx=(ax+bx)/2; return [{x:ax,y:ay},{x:midx,y:ay},{x:midx,y:by},{x:bx,y:by}] }
function anchorOnNodeRect(node, px, py){ const cx = vn(node.x,120)+90, cy = vn(node.y,120)+26; const hw=90, hh=26; let dx = px - cx, dy = py - cy; if(dx===0 && dy===0) return {x:cx,y:cy}; const sx = dx!==0 ? hw/Math.abs(dx) : Infinity; const sy = dy!==0 ? hh/Math.abs(dy) : Infinity; const t = Math.min(sx, sy); return { x: cx + dx*t, y: cy + dy*t } }

function render(){
  assignCanalColors()
  // Edges
  const edgeSel=gEdges.selectAll('.edge').data(edges,d=>d.id)
  const edgeEnter=edgeSel.enter().append('g').attr('class','edge')
    .on('click',(evt,d)=>{ evt.stopPropagation(); selectEdgeOnly(d) })
    .on('dblclick',(evt,d)=>{ evt.stopPropagation() })
  edgeEnter.append('path').attr('class','hit')
  edgeEnter.append('path').attr('class','line').attr('marker-end','url(#arrow)')
  edgeSel.exit().remove()
  gEdges.selectAll('.edge').classed('selected',d=>selectedEdge && selectedEdge.id===d.id)
  // Nodes
  const nodeSel=gNodes.selectAll('.node').data(nodes,d=>d.id)
  const nodeEnter=nodeSel.enter().append('g')
    .attr('class',d=>`node ${d.type||'PUITS'}`)
    .call(makeNodeDrag())
  nodeEnter.append('rect').attr('class','hit').attr('x',-10).attr('y',-4).attr('width',200).attr('height',60)
  nodeEnter.append('rect').attr('class','box').attr('width',180).attr('height',52)
  nodeEnter.append('text').attr('class','label').attr('x',90).attr('y',28).attr('text-anchor','middle')
  nodeEnter.append('text').attr('class','sublabel').attr('x',90).attr('y',46).attr('text-anchor','middle')
  nodeSel.exit().remove()
  const allNodes=gNodes.selectAll('.node')
  allNodes.attr('class',d=>`node ${d.type||'PUITS'} ${selectedIds.has(d.id)?'selected':''}`)
  allNodes.select('text.label').text(d=>d.name||d.id)
  allNodes.attr('transform',d=>`translate(${vn(d.x,120)},${vn(d.y,120)})`)
  allNodes.each(function(nd){ const sub = d3.select(this).select('text.sublabel'); let txt = ''; if(nd.type==='PUITS'){ const canal = nodes.find(n=>n.id===nd.well_collector_id); const pos = +nd.well_pos_index || 0; if(canal && pos>0) txt = `${canal.name} · #${pos}`; else if(pos>0) txt = `#${pos}` } else if(nd.type==='POINT_MESURE' || nd.type==='VANNE'){ if(nd.pm_collector_id){ const canal = nodes.find(n=>n.id===nd.pm_collector_id); const N = (canal?.collector_well_ids?.length)||0; const k = +nd.pm_pos_index||0; let posTxt=''; if(N===0) posTxt='—'; else if(k<=0) posTxt='avant #1'; else if(k>=N) posTxt=`après #${N}`; else posTxt=`entre #${k}–#${k+1}`; const off = (nd.pm_offset_m!=='' && nd.pm_offset_m!=null) ? ` · +${nd.pm_offset_m}m` : ''; txt = `${canal?.name||'—'} · ${posTxt}${off}` } else { txt = '— non assigné —' } } else if(isCanal(nd)){ const parent = edges.find(e=>e.to_id===nd.id && isCanal(nodes.find(n=>n.id===e.from_id))); if(!parent) txt = 'racine'; else { const p = nodes.find(n=>n.id===parent.from_id); const sibs = edges.filter(e=>e.from_id===p.id && isCanal(nodes.find(n=>n.id===e.to_id))).map(e=>e.to_id); const idx = sibs.indexOf(nd.id); const total = sibs.length; txt = `↳ ${p?.name||'—'} · #${idx+1}/${total}` } } sub.text(txt).style('display', txt ? null : 'none') })
  gEdges.selectAll('.edge').each(function(d){ const g=d3.select(this); const a=nodes.find(n=>n.id===d.from_id), b=nodes.find(n=>n.id===d.to_id); if(!a||!b) return; let col=null; if(isCanal(b)) col = canalColor.get(b.id); else if(isCanal(a)) col = canalColor.get(a.id); const pts=edgePolyline(d); const path=`M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y} L${pts[2].x},${pts[2].y} L${pts[3].x-7.2},${pts[3].y}`; const isSel=selectedEdge && selectedEdge.id===d.id; g.select('path.line').attr('d',path).attr('marker-end',isSel?'url(#arrowSel)':'url(#arrow)').attr('stroke', col || getComputedStyle(document.body).getPropertyValue('--edge-color')); g.select('path.hit').attr('d',path) })
  gNodes.selectAll('.node').each(function(nd){ const g=d3.select(this); if(isCanal(nd)){ const col = canalColor.get(nd.id) || getComputedStyle(document.body).getPropertyValue('--stroke'); g.select('rect.box').attr('stroke', col).attr('stroke-width', 1.6) }else{ g.select('rect.box').attr('stroke', getComputedStyle(document.body).getPropertyValue('--stroke')).attr('stroke-width', 1.0) } })
  drawInlineConnectors()
  updateHUD()
}

function drawInlineConnectors(){ gInline.selectAll('*').remove(); nodes.forEach(dev=>{ if((dev.type!=='POINT_MESURE' && dev.type!=='VANNE') || !dev.pm_collector_id) return; const canal = nodes.find(n=>n.id===dev.pm_collector_id); if(!canal) return; const devCenter = { x: vn(dev.x,120)+90, y: vn(dev.y,120)+26 }; const anchor = anchorOnNodeRect(canal, devCenter.x, devCenter.y); const col = canalColor.get(canal.id) || getComputedStyle(document.body).getPropertyValue('--edge-color'); gInline.append('path').attr('class', dev.type==='VANNE' ? 'valve-connector' : 'pm-connector').attr('d', `M${anchor.x},${anchor.y} L${devCenter.x},${devCenter.y}`).attr('stroke', col) }) }

// Drag & interactions
const DRAG_THRESHOLD=8; let squelchCanvasClick=false
function makeNodeDrag(){ let sx=0, sy=0, moved=false; return d3.drag().on('start',(ev,d)=>{ sx=ev.x; sy=ev.y; moved=false }).on('drag',(ev,d)=>{ if(spacePan) return; if(!moved && (Math.abs(ev.x-sx)>DRAG_THRESHOLD||Math.abs(ev.y-sy)>DRAG_THRESHOLD)) moved=true; if(moved){ d.x=snap(ev.x); d.y=snap(ev.y); render() } }).on('end',(ev,d)=>{ if(!moved){ squelchCanvasClick=true; handleNodeClick(d,ev.sourceEvent) } else pushHist() }) }
function handleNodeClick(n,domEvt){ if(mode==='connect'){ if(!connectSource){ connectSource=n; highlightPotentialTargets(true); status(`Source: ${n.name} → clique une cible (nœud) ou un tuyau`) } else { addEdge(connectSource,n); connectSource=null; highlightPotentialTargets(false); status('') } return } if(mode==='delete'){ if(confirm(`Supprimer le nœud ${n.name||''} et ses tuyaux ?`)){ deleteNode(n); pushHist() } return } if(domEvt && (domEvt.shiftKey||domEvt.ctrlKey||domEvt.metaKey)){ if(selectedIds.has(n.id)) selectedIds.delete(n.id); else selectedIds.add(n.id); selectedNode=(selectedIds.size===1)?nodes.find(x=>selectedIds.has(x.id)):null; if(selectedNode) showNodeForm(selectedNode); else { $$('#nodeForm').style.display='none'; $$('#edgeForm').style.display='none'; $$('#noSel').style.display='block'; setPropCollapsed(false) } render(); return } selectSingle(n) }
function highlightPotentialTargets(on){ gNodes.selectAll('.node').classed('halo',function(d){ if(!connectSource||!on) return false; if(connectSource.type==='PUITS') return isCanal(d); if(isCanal(connectSource)) return d.type==='PUITS' || d.type==='POINT_MESURE' || d.type==='VANNE' || isCanal(d); if(connectSource.type==='POINT_MESURE'||connectSource.type==='VANNE') return isCanal(d); return true }) }

// Menu contexte minimal
const ctx=$$('#ctx'); svg.on('contextmenu',(e)=>{ e.preventDefault(); ctx.innerHTML=`<div class="item" id="ctxLayout">🧭 Agencer</div>`; ctx.style.left=e.pageX+'px'; ctx.style.top=e.pageY+'px'; ctx.style.display='block' })
document.addEventListener('click',()=>ctx.style.display='none')
ctx.addEventListener('click',(e)=>{ if(e.target.id==='ctxLayout'){ autoLayout() } ctx.style.display='none' })

// Marquee multi‑sélection
let marquee=null, mStart=null, baseSet=null
svg.on('mousedown.marquee',(ev)=>{ if(spacePan || mode!=='select') return; if(ev.target.closest && (ev.target.closest('.node')||ev.target.closest('.edge'))) return; ev.preventDefault(); ev.stopPropagation(); const t=d3.zoomTransform(svg.node()); const pt=d3.pointer(ev,svg.node()); mStart={x:(pt[0]-t.x)/t.k, y:(pt[1]-t.y)/t.k}; baseSet=new Set(selectedIds); marquee=gOverlay.append('rect').attr('class','marquee').attr('x',mStart.x).attr('y',mStart.y).attr('width',0).attr('height',0); d3.select(window).on('mousemove.marquee',moveMarquee).on('mouseup.marquee',endMarquee,{once:true}) })
function moveMarquee(ev){ const t=d3.zoomTransform(svg.node()); const pt=d3.pointer(ev,svg.node()); const cur={x:(pt[0]-t.x)/t.k,y:(pt[1]-t.y)/t.k}; const x=Math.min(mStart.x,cur.x), y=Math.min(mStart.y,cur.y), w=Math.abs(cur.x-mStart.x), h=Math.abs(cur.y-mStart.y); marquee.attr('x',x).attr('y',y).attr('width',w).attr('height',h); const additive=(ev.shiftKey||ev.ctrlKey||ev.metaKey); const inside=new Set(); nodes.forEach(n=>{ const nx=vn(n.x,120), ny=vn(n.y,120), wv=180, hv=52; if(nx+wv>=x && nx<=x+w && ny+hv>=y && ny<=y+h) inside.add(n.id) }); selectedIds=new Set(additive?[...baseSet,...inside]:[...inside]); if(selectedIds.size===1){ selectedNode=nodes.find(nn=>selectedIds.has(nn.id)); showNodeForm(selectedNode); setPropCollapsed(false) }else{ selectedNode=null; $$('#nodeForm').style.display='none'; $$('#edgeForm').style.display='none'; $$('#noSel').style.display='block'; setPropCollapsed(false) } render() }
function endMarquee(){ d3.select(window).on('mousemove.marquee',null).on('mouseup.marquee',null); if(marquee){ marquee.remove(); marquee=null } squelchCanvasClick = true }
svg.on('click.clear', (ev)=> { if (squelchCanvasClick) { squelchCanvasClick = false; return } if (ev.target.closest && (ev.target.closest('.node') || ev.target.closest('.edge'))) return; if (mode==='connect') return; clearSelection() })

// Copier / Coller
let clipboard=null
function copySelection(){ if(!selectedIds.size) { status('Rien à copier.'); return } const selNodes = nodes.filter(n=>selectedIds.has(n.id)); const selIds = new Set(selNodes.map(n=>n.id)); const selEdges = edges.filter(e=>selIds.has(e.from_id) && selIds.has(e.to_id)); clipboard = { nodes: JSON.parse(JSON.stringify(selNodes)), edges: JSON.parse(JSON.stringify(selEdges)) }; status(`${selNodes.length} nœud(s) copié(s).`) }
function pasteClipboard(){ if(!clipboard || !clipboard.nodes?.length){ status('Presse‑papiers vide.'); return } const dx = 28, dy = 28; const idMap = new Map(); const newNodeObjs = []; clipboard.nodes.forEach(src=>{ const clone = JSON.parse(JSON.stringify(src)); clone.id   = genId(clone.type||'N'); clone.name = incrementName(clone.name||clone.id); clone.x    = snap(vn(src.x,120)+dx); clone.y = snap(vn(src.y,120)+dy); if(clone.type==='PUITS'){ clone.well_collector_id=''; clone.well_pos_index='' } if(clone.type==='POINT_MESURE'||clone.type==='VANNE'){ clone.pm_collector_id=''; clone.pm_pos_index=''; clone.pm_offset_m='' } if(isCanal(clone)){ clone.collector_well_ids=[]; clone.child_canal_ids=[] } nodes.push(clone); newNodeObjs.push(clone); idMap.set(src.id, clone.id) }); clipboard.edges.forEach(e=>{ const a = idMap.get(e.from_id), b = idMap.get(e.to_id); if(a && b) edges.push({ id:genId('E'), from_id:a, to_id:b, active:true }) }); clipboard.nodes.forEach(src=>{ if(!isCanal(src)) return; const dstId = idMap.get(src.id); if(!dstId) return; const dst = nodes.find(n=>n.id===dstId); if(!dst) return; const newWells = (src.collector_well_ids||[]).map(oldWid=>idMap.get(oldWid)).filter(Boolean); dst.collector_well_ids = newWells.slice(); newWells.forEach((wid, i)=>{ const w = nodes.find(n=>n.id===wid); if(w){ w.well_collector_id = dst.id; w.well_pos_index = i+1 } if(!edges.some(e=>e.from_id===dst.id && e.to_id===wid)){ edges.push({id:genId('E'), from_id:dst.id, to_id:wid, active:true}) } }); const newChildCanas = (src.child_canal_ids||[]).map(oldCid=>idMap.get(oldCid)).filter(Boolean); dst.child_canal_ids = newChildCanas.slice(); newChildCanas.forEach(cid=>{ if(!edges.some(e=>e.from_id===dst.id && e.to_id===cid)){ edges.push({id:genId('E'), from_id:dst.id, to_id:cid, active:true}) } }) }); pushHist(); selectedIds = new Set(newNodeObjs.map(n=>n.id)); selectedNode = (newNodeObjs.length===1) ? newNodeObjs[0] : null; if(selectedNode) showNodeForm(selectedNode); else { $$('#nodeForm').style.display='none'; $$('#edgeForm').style.display='none'; $$('#noSel').style.display='block'; setPropCollapsed(false) } render(); status(`${newNodeObjs.length} nœud(s) collé(s).`) }

// Layout & validation
let layoutLog=[]
function logOpen(open=true){ const d=$$('#logDrawer'); if(!d) return; d.classList.toggle('open', open) }
function logClear(){ layoutLog=[]; const b=$$('#logBody'); if(b) b.innerHTML='' }
function logLine(level,msg,obj){ const t=new Date().toLocaleTimeString(); const b=$$('#logBody'); const div=document.createElement('div'); div.className=`log-line log-${level||'info'}`; div.textContent=`[${t}] ${String(level||'info').toUpperCase()} — ${msg}${obj!==undefined?' '+JSON.stringify(obj):''}`; b.appendChild(div); b.scrollTop=b.scrollHeight }
document.getElementById('logBtn').onclick=()=>logOpen(!$$('#logDrawer').classList.contains('open'))
document.getElementById('logClear').onclick=logClear
document.getElementById('logDownload').onclick=()=>{ const blob=new Blob([JSON.stringify(layoutLog,null,2)],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='agencer-log.json'; a.click(); URL.revokeObjectURL(url) }
document.getElementById('logClose').onclick=()=>logOpen(false)

function graphComponents(){ const id2idx = new Map(nodes.map((n,i)=>[n.id,i])); const adj = nodes.map(()=>[]); edges.forEach(e=>{ const a=id2idx.get(e.from_id), b=id2idx.get(e.to_id); if(a!=null && b!=null){ adj[a].push(b); adj[b].push(a) } }); const seen = new Array(nodes.length).fill(false); const sizes = []; for(let i=0;i<nodes.length;i++){ if(seen[i]) continue; let sz=0; const st=[i]; seen[i]=true; while(st.length){ const v=st.pop(); sz++; for(const w of adj[v]) if(!seen[w]){ seen[w]=true; st.push(w) } } sizes.push(sz) } return {count:sizes.length, sizes} }
function quickCycleCheck(){ const indeg=new Map(nodes.map(n=>[n.id,0])); const adj=new Map(nodes.map(n=>[n.id,[]])); edges.forEach(e=>{ indeg.set(e.to_id,(indeg.get(e.to_id)||0)+1); if(adj.has(e.from_id)) adj.get(e.from_id).push(e.to_id) }); const q=[...indeg.entries()].filter(([_,d])=>d===0).map(([id])=>id); let visited=0; while(q.length){ const u=q.shift(); visited++; for(const v of (adj.get(u)||[])){ indeg.set(v,indeg.get(v)-1); if(indeg.get(v)===0) q.push(v) } } return {hasCycle: visited < nodes.length, visited} }
function detectOverlaps(){ const W=180, H=52, arr = nodes.map(n=>({id:n.id,x:+n.x||0,y:+n.y||0})); let overlaps=0; for(let i=0;i<arr.length;i++){ for(let j=i+1;j<arr.length;j++){ if(Math.abs(arr[i].x-arr[j].x)<W && Math.abs(arr[i].y-arr[j].y)<H){ overlaps++ } } } return {overlaps} }
function fallbackLayoutPack(reasonLabel='fallback+'){ logLine('info',`Fallback+: démarrage`, {reason:reasonLabel}); const preds = new Map(), succs = new Map(); nodes.forEach(n=>{ preds.set(n.id, new Set()); succs.set(n.id, []) }); edges.forEach(e=>{ if(preds.has(e.to_id)) preds.get(e.to_id).add(e.from_id); if(succs.has(e.from_id)) succs.get(e.from_id).push(e.to_id) }); const unplaced = new Set(nodes.map(n=>n.id)); const levels = []; const origY = new Map(nodes.map(n=>[n.id, (+n.y||0)])); while(unplaced.size){ const ready = []; unplaced.forEach(id=>{ const p = preds.get(id) || new Set(); let ok = true; for(const pid of p){ if(unplaced.has(pid)){ ok=false; break } } if(ok) ready.push(id) }); if(ready.length === 0){ let best=[], bestDeg=Infinity; unplaced.forEach(id=>{ const deg = (preds.get(id)||new Set()).size; if(deg < bestDeg){ bestDeg = deg; best = [id] } else if(deg === bestDeg){ best.push(id) } }); levels.push(best.slice()); best.forEach(id=>unplaced.delete(id)) }else{ levels.push(ready); ready.forEach(id=>unplaced.delete(id)) } } const x0=120, y0=120, xStep=260, yStep=120; levels.forEach((ids,L)=>{ ids.sort((a,b)=> (origY.get(a)-origY.get(b))); ids.forEach((id,i)=>{ const n = nodes.find(nn=>nn.id===id); if(!n) return; n.x = Math.round((x0 + L*xStep)/8)*8; n.y = Math.round((y0 + i*yStep)/8)*8 }) }) }
async function autoLayout(){ logOpen(true); logClear(); logLine('info','Agencement démarré',{nodes:nodes.length, edges:edges.length}); const before = new Map(nodes.map(n=>[n.id,{x:n.x,y:n.y}])); const idSet = new Set(nodes.map(n=>n.id)); const e0 = edges.length; edges = edges.filter(e => idSet.has(e.from_id) && idSet.has(e.to_id)); const removed = e0 - edges.length; if(removed>0) logLine('warn','Arêtes invalides supprimées',{removed}); const comps = graphComponents(); const cyc = quickCycleCheck(); const preOver = detectOverlaps(); const isolated = nodes.filter(n => !edges.some(e=>e.from_id===n.id || e.to_id===n.id)).length; logLine('info','Pré‑layout',{components:comps.count, sizes:comps.sizes, isolated, cycles:cyc.hasCycle, overlaps:preOver.overlaps}); try{ if(typeof ELK === 'function'){ logLine('info','ELK: tentative',{"elk.algorithm":"layered","elk.direction":"RIGHT"}); const graph = { id: 'root', layoutOptions:{ 'elk.algorithm':'layered', 'elk.direction':'RIGHT', 'elk.spacing.nodeNode':'48', 'elk.layered.spacing.nodeNodeBetweenLayers':'96', 'elk.layered.considerModelOrder':'true', 'elk.edgeRouting':'ORTHOGONAL' }, children: nodes.map(n=>({ id:n.id, width:180, height:52 })), edges: edges.map(e=>({ id:e.id, sources:[e.from_id], targets:[e.to_id] })) }; const timeout = ms => new Promise((_,rej)=>setTimeout(()=>rej(new Error('ELK timeout')), ms)); const out = await Promise.race([ new ELK().layout(graph), timeout(1500) ]); if(out && Array.isArray(out.children)){ out.children.forEach(c=>{ const n = nodes.find(nn=>nn.id===c.id); if(!n) return; if(Number.isFinite(c.x)) n.x = Math.round(c.x); if(Number.isFinite(c.y)) n.y = Math.round(c.y) }); const moved = countMoves(before); const postOver = detectOverlaps(); logLine('info','ELK: positions appliquées',moved); logLine('info','Post‑ELK',{overlaps:postOver.overlaps}); if(moved.moved===0 || postOver.overlaps>0){ logLine('warn','ELK n’a pas déplacé / chevauchements restants → Fallback forcé', {moved:moved.moved, overlaps:postOver.overlaps}); fallbackLayoutPack('forcedAfterELK'); const moved2 = countMoves(before); logLine('info','Fallback+: positions appliquées', moved2); pushHist(); render(); status(`Agencement (fallback+) – ${moved2.moved}/${moved2.total} déplacés`); return } pushHist(); render(); status(`Agencement OK (ELK) – ${moved.moved}/${moved.total} déplacés`); return } } throw new Error('ELK indisponible ou résultat vide') }catch(err){ logLine('error','ELK: échec', {message:err.message}); fallbackLayoutPack('elkFailed'); const moved = countMoves(before); logLine('info','Fallback+: positions appliquées', moved); pushHist(); render(); status(`Agencement OK (fallback+) – ${moved.moved}/${moved.total} déplacés`) } }
function countMoves(beforeMap){ let moved=0,total=0; nodes.forEach(n=>{ total++; const b=beforeMap.get(n.id)||{}; if(typeof n.x==='number' && typeof n.y==='number'){ if(Math.abs((n.x||0)-(b.x||0))>1 || Math.abs((n.y||0)-(b.y||0))>1) moved++ } }); return {moved,total} }

// Exports
function download(data,name){ const blob=new Blob([data],{type:'application/json'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; a.click(); URL.revokeObjectURL(url) }
document.getElementById('exportBtn').onclick=()=>{ const data=JSON.stringify({nodes,edges},null,2); download(data,'reseau.json') }
document.getElementById('exportCompactBtn').onclick=()=>{ const index=new Map(nodes.map((n,i)=>[n.id,i])); const edges_idx=edges.map(e=>[index.get(e.from_id),index.get(e.to_id)]); const adj=Array.from({length:nodes.length},()=>[]); edges_idx.forEach(([i,j])=>{ if(i!=null&&j!=null) adj[i].push(j) }); const out={ nodes:nodes.map(n=>({id:n.id,type:n.type,name:n.name,diameter_mm:n.diameter_mm??undefined, collector_well_ids:(isCanal(n)?(n.collector_well_ids||[]):undefined), child_canal_ids:(isCanal(n)?(n.child_canal_ids||[]):undefined), well_collector_id:(n.type==='PUITS'?(n.well_collector_id||''):undefined), well_pos_index:(n.type==='PUITS'?(+n.well_pos_index||null):undefined), pm_collector_id:((n.type==='POINT_MESURE'||n.type==='VANNE')?(n.pm_collector_id||''):undefined), pm_pos_index:((n.type==='POINT_MESURE'||n.type==='VANNE')?(+n.pm_pos_index||0):undefined), pm_offset_m:((n.type==='POINT_MESURE'||n.type==='VANNE')?(n.pm_offset_m||''):undefined)})), index:Object.fromEntries(index), edges_idx, adj }; download(JSON.stringify(out),'reseau-compact.json') }
document.getElementById('exportNodeEdgeBtn').onclick = ()=> { const compiled = compileNodeEdgeGraph(); const data = JSON.stringify(compiled, null, 2); download(data, 'reseau-node-edge.json'); status('Export nœud/arête généré.') }

function compileNodeEdgeGraph(){ const Nmap = new Map(nodes.map(n=>[n.id,n])); const isWell = n => n?.type==='PUITS'; const isCan  = n => n?.type==='CANALISATION' || n?.type==='COLLECTEUR'; const isOther= n => n && !isWell(n) && !isCan(n); const compiledNodes = []; const compiledEdges = []; nodes.forEach(n=>{ if(!isCan(n)) compiledNodes.push({ id:n.id, type:n.type, name:n.name, x:n.x, y:n.y }) }); const outBy = new Map(), inBy = new Map(); edges.forEach(e=>{ (outBy.get(e.from_id)||outBy.set(e.from_id,[]) && outBy.get(e.from_id)).push(e); (inBy.get(e.to_id)||inBy.set(e.to_id,[]) && inBy.get(e.to_id)).push(e) }); const getOut=id=>outBy.get(id)||[]; const getIn=id=>inBy.get(id)||[]; let uidT=0, uidE=0; const Tname = (c, k)=> `${c.name||c.id}@T${k}`; const Tid   = (c, k)=> `T-${(++uidT)}-${c.id}-${k}`; const Eid   = ()=> `E-${(++uidE)}`; nodes.filter(isCan).forEach(c=>{ const wells = (c.collector_well_ids||[]).map(id => Nmap.get(id)).filter(Boolean).sort((a,b)=> (+a.well_pos_index||0) - (+b.well_pos_index||0)); const N = wells.length; const Tids = []; for(let k=0;k<=N;k++){ const id = Tid(c, k); Tids.push(id); compiledNodes.push({ id, type:'NODE', name: Tname(c, k) }) } const inMainEdges  = getIn(c.id).filter(e => isOther(Nmap.get(e.from_id)) || isCan(Nmap.get(e.from_id))); inMainEdges.forEach(e=>{ compiledEdges.push({ id:Eid(), from: e.from_id, to: Tids[0], diameter_mm: c.diameter_mm, color: canalColor.get(c.id)||undefined }) }); for(let k=0;k<N;k++){ compiledEdges.push({ id:Eid(), from: Tids[k], to: Tids[k+1], diameter_mm: c.diameter_mm, color: canalColor.get(c.id)||undefined }) } wells.forEach((w, idx)=>{ const k = (+w.well_pos_index||idx+1); const anchor = Math.min(Math.max(k,0), N); compiledEdges.push({ id:Eid(), from: Tids[anchor], to: w.id, diameter_mm: w.diameter_mm||undefined, color: canalColor.get(c.id)||undefined }) }); const outOthers = getOut(c.id).filter(e => isOther(Nmap.get(e.to_id))); outOthers.forEach(e=>{ compiledEdges.push({ id:Eid(), from: Tids[N], to: e.to_id, diameter_mm: c.diameter_mm, color: canalColor.get(c.id)||undefined }) }); const outCanalsEdges = getOut(c.id).filter(e => isCan(Nmap.get(e.to_id))); const orderMap = new Map(); (c.child_canal_ids||[]).forEach((id,idx)=>orderMap.set(id, idx)); outCanalsEdges.sort((e1,e2)=>{ const a = Nmap.get(e1.to_id), b = Nmap.get(e2.to_id); const oa = orderMap.has(a.id) ? orderMap.get(a.id) : 1e6 + vn(a.y,0); const ob = orderMap.has(b.id) ? orderMap.get(b.id) : 1e6 + vn(b.y,0); return oa - ob }); outCanalsEdges.forEach((e,idx)=>{ compiledEdges.push({ id:Eid(), from: Tids[N], to: e.to_id, diameter_mm: c.diameter_mm, color: canalColor.get(c.id)||undefined, order_on_parent: idx+1 }) }); const inlines = nodes.filter(n => (n.type==='POINT_MESURE' || n.type==='VANNE') && n.pm_collector_id===c.id); const bucket = new Map(); function pushOnEdge(edgeId, s){ (bucket.get(edgeId)||bucket.set(edgeId,[]) && bucket.get(edgeId)).push(s) } inlines.forEach(dev=>{ const pos = +dev.pm_pos_index||0; let edgeCandidate = null; if(pos >=0 && pos < N){ edgeCandidate = compiledEdges.find(e => e.from===Tids[pos] && e.to===Tids[pos+1]) } else if (N>0){ edgeCandidate = compiledEdges.find(e => e.from===Tids[N-1] && e.to===Tids[N]) } if(edgeCandidate){ const s = { id: dev.id, type: dev.type, name: dev.name, order: null, offset_m: (dev.pm_offset_m===''?null:dev.pm_offset_m) }; pushOnEdge(edgeCandidate.id, s) } }); for(const [eid, arr] of bucket.entries()){ arr.sort((a,b)=>{ const ax=(a.offset_m==null)?Infinity:a.offset_m; const bx=(b.offset_m==null)?Infinity:b.offset_m; if(ax!==bx) return ax-bx; return (''+(a.name||a.id)).localeCompare(''+(b.name||b.id)) }); arr.forEach((s,i)=>{ if(s.order==null) s.order = i+1 }); const ce = compiledEdges.find(e=>e.id===eid); if(ce){ ce.devices = arr } } }); return { nodes: compiledNodes, edges: compiledEdges } }

// Toolbar wiring
document.getElementById('modeSelect').onclick=()=>setMode('select')
document.getElementById('modeConnect').onclick=()=>setMode('connect')
document.getElementById('modeDelete').onclick=()=>setMode('delete')

const addBtn=$$('#addBtn'), addMenu=$$('#addMenu')
addBtn.onclick=()=>{ const r=addBtn.getBoundingClientRect(); addMenu.style.left=`${r.left}px`; addMenu.style.top=`${r.bottom+6}px`; addMenu.classList.toggle('open') }
document.addEventListener('click',(e)=>{ if(!addBtn.contains(e.target)&&!addMenu.contains(e.target)) addMenu.classList.remove('open') })
addMenu.querySelectorAll('.item').forEach(it=>it.onclick=()=>{
  try{
    const t = (it.dataset.add || 'PUITS').toString().toUpperCase()
    addNode(t)
    addMenu.classList.remove('open')
  }catch(err){
    console.error('[addMenu] addNode failed', err, { dataset: { ...it.dataset } })
    status('Erreur: ajout échoué (voir console)')
  }
})

document.getElementById('helpBtn').onclick=()=>$$('#helpDlg').showModal()
document.getElementById('helpCloseBtn').onclick=()=>$$('#helpDlg').close()
document.getElementById('layoutBtn').onclick=autoLayout
document.getElementById('deleteEdgeBtn').onclick=()=>{
  if (!selectedEdge) { status('Aucune arête sélectionnée'); return }
  if (!confirm('Supprimer cette arête ?')) return
  const e = selectedEdge
  const from = nodes.find(n=>n.id===e.from_id)
  const to = nodes.find(n=>n.id===e.to_id)
  if (from && to) {
    if (isCanal(from) && to.type==='PUITS'){
      if (Array.isArray(from.collector_well_ids)){
        from.collector_well_ids = from.collector_well_ids.filter(id=>id!==to.id)
        from.collector_well_ids.forEach((id,i)=>{ const w=nodes.find(n=>n.id===id); if(w){ w.well_pos_index=i+1; w.well_collector_id=from.id } })
      }
    }
    if (isCanal(from) && isCanal(to)){
      if (Array.isArray(from.child_canal_ids)){
        from.child_canal_ids = from.child_canal_ids.filter(id=>id!==to.id)
      }
    }
  }
  edges = edges.filter(x=>x!==e)
  selectedEdge = null
  pushHist(); render(); status('Arête supprimée')
}

document.getElementById('loadBtn').onclick=async ()=>{
  try{
    status('Chargement…')
    const graph = await getGraph()
    nodes=(graph.nodes||[]).map(n=>({...n,type:(n.type==='COLLECTEUR'?'CANALISATION':(n.type||'PUITS'))}))
    edges=graph.edges||[]
    pushHist(); clearSelection(); render(); zoomFit(); status('Chargé.')
  }catch(err){ console.error(err); status('Erreur de chargement') }
}
document.getElementById('saveBtn').onclick=async ()=>{
  const modeParam = getMode()
  if(modeParam==='ro'){ alert('Mode lecture‑seule.'); return }
  try{
    status('Sauvegarde…')
    const res = await saveGraph({nodes,edges})
    status(`Sauvé (${res.nodes ?? nodes.length} nœuds, ${res.edges ?? edges.length} tuyaux).`)
  }catch(err){ console.error(err); status('Erreur sauvegarde') }
}

// Init
function isLocal(){ return ['localhost','127.0.0.1'].includes(location.hostname) }
function ensureHUD(){
  if (!isLocal()) return
  if (!document.getElementById('hud')){
    const hud = document.createElement('div')
    hud.id = 'hud'
    document.body.appendChild(hud)
  }
}
function updateHUD(){
  if (!isLocal()) return
  const el = document.getElementById('hud')
  if (el) el.textContent = `${nodes.length} nœuds · ${edges.length} arêtes`
}

function init(){
  document.body.dataset.theme = document.body.dataset.theme || 'dark'
  adjustWrapTop()
  const modeParam = getMode()
  if (modeParam === 'ro') document.getElementById('saveBtn')?.classList.add('hidden')
  ensureHUD()
  getGraph().then(graph=>{
    nodes=(graph.nodes||[]).map(n=>({...n,type:(n.type==='COLLECTEUR'?'CANALISATION':(n.type||'PUITS'))}))
    edges=graph.edges||[]
    pushHist(); clearSelection(); render(); zoomFit(); updateHUD(); status('Prêt.')
  }).catch(err=>{ console.error(err); status('Erreur init') })
}

document.addEventListener('DOMContentLoaded', init)

// Expose minimal debug API in local dev only
try{
  if (['localhost','127.0.0.1'].includes(location.hostname)){
    window.ER = {
      addNode,
      showNodeForm,
      refreshCanalUI,
      render,
      get nodes(){ return nodes },
      get edges(){ return edges },
    }
  }
}catch(_e){}
