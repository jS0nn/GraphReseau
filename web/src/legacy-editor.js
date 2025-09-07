// Legacy Editor: port of the original inline script, slightly adapted
// Relies on global d3 and ELK provided by vendor.js and a google.script.run bridge
import './bridge-gas.js'

// To keep this manageable, we import helpers from separate modules where available
// but replicate names and wiring used by the legacy code.

// Minimal utilities used widely by the legacy script
const $$ = (s)=>document.querySelector(s)
function status(msg){ const el=$$('#status'); if(el) el.textContent=msg||'' }
const gridStep=8
const snapEnabled=true
function snap(v){ return snapEnabled ? Math.round(v/gridStep)*gridStep : v }
function vn(v,def){ return (v==null||Number.isNaN(v))?def:v }
function genId(prefix='N'){ const t=Date.now().toString(36).slice(-6); const r=Math.floor(Math.random()*1e6).toString(36); return `${prefix}-${t}${r}`.toUpperCase() }
function incrementName(name){ if(!name) return 'N-001'; const m=name.match(/^(.*?)(\d+)(\D*)$/); if(m){ const base=m[1],num=m[2],suf=m[3]||''; let next=String(parseInt(num,10)+1).padStart(num.length,'0'); let cand=`${base}${next}${suf}`; return cand; } return (name+'-copy') }

// Global editor state (legacy naming)
let nodes=[], edges=[]
let selectedNode=null, selectedEdge=null
let selectedIds=new Set()
let mode='select'
let connectSource=null

// Basic SVG skeleton like original
function ensureDOM(){
  if (!document.getElementById('appbar')){
    const header=document.createElement('header'); header.className='appbar'; header.id='appbar';
    header.innerHTML=`<div class="title">Éditeur réseau</div>
      <button class="btn" id="loadBtn"><i class="uil uil-import"></i>Charger</button>
      <button class="btn primary" id="saveBtn" title="Ctrl/Cmd+S"><i class="uil uil-save"></i>Sauvegarder</button>
      <button class="btn" id="layoutBtn" title="L"><i class="uil uil-horizontal-align-right"></i>Agencer</button>
      <div class="seg" id="modes" title="C = Connecter">
        <button id="modeSelect" class="active"><i class="uil uil-mouse"></i> Sélection</button>
        <button id="modeConnect"><i class="uil uil-vector-square-alt"></i> Connecter</button>
        <button id="modeDelete"><i class="uil uil-trash-alt"></i> Supprimer</button>
      </div>
      <div class="spacer"></div>
      <button class="btn" id="themeBtn" title="Thème"><i class="uil uil-brightness-half"></i> Thème</button>`
    document.body.prepend(header)
  }
  if (!document.getElementById('wrap')){
    const wrap=document.createElement('div'); wrap.id='wrap'
    wrap.innerHTML=`<div id="canvas"><svg id="svg"><defs>
      <marker id="arrow" viewBox="0 -5 10 10" refX="7.2" refY="0" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,-5L10,0L0,5"></path></marker>
      <marker id="arrowSel" viewBox="0 -5 10 10" refX="7.2" refY="0" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,-5L10,0L0,5"></path></marker>
    </defs><g id="zoomRoot"><g class="inline-conns"></g><g class="edges"></g><g class="nodes"></g><g class="overlay"></g></g></svg></div>
    <aside id="prop"><div class="card"><h3 style="margin:4px 0 8px">Propriétés</h3><div id="noSel">Aucune sélection.</div>
      <form id="nodeForm" style="display:none"></form>
      <form id="edgeForm" style="display:none; margin-top:8px"></form>
    </div></aside>`
    document.body.appendChild(wrap)
  }
  if (!document.getElementById('status')){
    const st=document.createElement('div'); st.id='status'; document.body.appendChild(st)
  }
  document.body.dataset.theme = document.body.dataset.theme || 'dark'
  document.body.classList.add('prop-collapsed')
}

function adjustWrapTop(){ const h=$$('#appbar')?.getBoundingClientRect().height||70; document.documentElement.style.setProperty('--appbar-height', Math.ceil(h)+'px') }

// Very minimal render: show count while we phase‑in modules
function render(){ status(`Nœuds: ${nodes.length} · Tuyaux: ${edges.length}`) }

function setMode(m){ mode=m; $$('#modeSelect')?.classList.toggle('active',m==='select'); $$('#modeConnect')?.classList.toggle('active',m==='connect'); $$('#modeDelete')?.classList.toggle('active',m==='delete') }

function initToolbar(){
  document.getElementById('layoutBtn')?.addEventListener('click', ()=>status('Agencement… (à venir)'))
  document.getElementById('themeBtn')?.addEventListener('click', ()=>{ document.body.dataset.theme=(document.body.dataset.theme==='light'?'dark':'light'); render(); adjustWrapTop() })
  document.getElementById('modeSelect')?.addEventListener('click', ()=>setMode('select'))
  document.getElementById('modeConnect')?.addEventListener('click', ()=>setMode('connect'))
  document.getElementById('modeDelete')?.addEventListener('click', ()=>setMode('delete'))
  // Hide saveBtn if mode=ro
  const modeParam = new URLSearchParams(location.search).get('mode') || 'ro'
  if (modeParam === 'ro') document.getElementById('saveBtn')?.classList.add('hidden')
  document.getElementById('loadBtn')?.addEventListener('click', ()=>loadGraph())
  document.getElementById('saveBtn')?.addEventListener('click', ()=>saveGraph())
}

function loadGraph(){
  status('Chargement…')
  window.google.script.run.withSuccessHandler(graph=>{
    nodes=(graph.nodes||[]).map(n=>({...n,type:(n.type==='COLLECTEUR'?'CANALISATION':(n.type||'PUITS'))}))
    edges=graph.edges||[]
    render(); status('Chargé.')
  }).withFailureHandler(err=>{ status('Erreur chargement'); console.error(err) }).getGraph()
}

function saveGraph(){
  const payload = { nodes, edges }
  status('Sauvegarde…')
  window.google.script.run.withSuccessHandler(res=>{
    status(`Sauvé (${res.nodes} nœuds, ${res.edges} tuyaux).`)
  }).withFailureHandler(err=>{ status('Erreur sauvegarde'); console.error(err) }).saveGraph(payload)
}

function bootstrap(){
  ensureDOM()
  adjustWrapTop()
  initToolbar()
  setMode('select')
  loadGraph()
}

document.addEventListener('DOMContentLoaded', bootstrap)

