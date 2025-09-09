import { setMode, getMode, subscribe } from './state.js'

function el(id){ return document.getElementById(id) }

export function initModesUI(){
  const btnSel = el('modeSelect')
  const btnConn = el('modeConnect')
  const btnDel = el('modeDelete')
  const update = () => {
    const m = getMode()
    btnSel?.classList.toggle('active', m==='select')
    btnConn?.classList.toggle('active', m==='connect')
    btnDel?.classList.toggle('active', m==='delete')
  }
  btnSel && (btnSel.onclick = ()=> setMode('select'))
  btnConn && (btnConn.onclick = ()=> setMode('connect'))
  btnDel && (btnDel.onclick = ()=> setMode('delete'))
  subscribe((evt)=>{ if(evt==='mode:set') update() })
  update()
}

