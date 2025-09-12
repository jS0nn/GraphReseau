import { setMode, getMode, subscribe } from './state.js'

function el(id){ return document.getElementById(id) }

export function initModesUI(){
  const btnSel = el('modeSelect')
  const btnDraw = el('modeDraw')
  const btnConn = el('modeConnect')
  const btnEdit = el('modeEdit')
  const btnDel = el('modeDelete')
  const update = () => {
    const m = getMode()
    btnSel?.classList.toggle('active', m==='select')
    btnDraw?.classList.toggle('active', m==='draw')
    btnConn?.classList.toggle('active', m==='connect')
    btnEdit?.classList.toggle('active', m==='edit')
    btnDel?.classList.toggle('active', m==='delete')
  }
  btnSel && (btnSel.onclick = ()=> setMode('select'))
  btnDraw && (btnDraw.onclick = ()=> setMode('draw'))
  btnConn && (btnConn.onclick = ()=> setMode('connect'))
  btnEdit && (btnEdit.onclick = ()=> setMode('edit'))
  btnDel && (btnDel.onclick = ()=> setMode('delete'))
  subscribe((evt)=>{ if(evt==='mode:set') update() })
  update()
}
