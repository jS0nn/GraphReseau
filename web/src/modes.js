import { setMode, getMode, subscribe } from './state/index.js'
import { showTooltip, scheduleHide, cancelHide } from './ui/tooltip.js'

function el(id){ return document.getElementById(id) }

export function initModesUI(){
  const btnSel = el('modeSelect')
  const btnDraw = el('modeDraw')
  const btnConn = el('modeConnect')
  const btnEdit = el('modeEdit')
  const btnJun = el('modeJunction')
  const btnDel = el('modeDelete')
  function attachHotkeyTip(btn, label){
    if(!btn) return
    const html = `<div style="display:flex; align-items:center; gap:6px"><span style="opacity:.8">Raccourci</span><kbd style="background:#111827;color:#e5e7eb;border:1px solid #334155;padding:2px 6px;border-radius:6px;font:12px/1 ui-sans-serif">${label}</kbd></div>`
    const showBelow = (e)=>{
      try{
        cancelHide()
        const r = btn.getBoundingClientRect()
        const x = Math.round(r.left + r.width/2)
        const y = Math.round(r.bottom + 6)
        showTooltip(x, y, html)
      }catch{}
    }
    btn.addEventListener('mouseenter', showBelow)
    btn.addEventListener('focus', showBelow)
    btn.addEventListener('mouseleave', ()=> scheduleHide(600))
    btn.addEventListener('blur', ()=> scheduleHide(0))
  }
  const update = () => {
    const m = getMode()
    btnSel?.classList.toggle('active', m==='select')
    btnDraw?.classList.toggle('active', m==='draw')
    btnConn?.classList.toggle('active', m==='connect')
    btnEdit?.classList.toggle('active', m==='edit')
    btnJun?.classList.toggle('active', m==='junction')
    btnDel?.classList.toggle('active', m==='delete')
  }
  btnSel && (btnSel.onclick = ()=> setMode('select'))
  btnDraw && (btnDraw.onclick = ()=> setMode('draw'))
  btnConn && (btnConn.onclick = ()=> setMode('connect'))
  btnEdit && (btnEdit.onclick = ()=> setMode('edit'))
  btnDel && (btnDel.onclick = ()=> setMode('delete'))
  btnJun && (btnJun.onclick = ()=> setMode('junction'))
  // Hotkey tooltips under mode buttons
  attachHotkeyTip(btnSel, 'V')
  attachHotkeyTip(btnDraw, 'D')
  attachHotkeyTip(btnEdit, 'E')
  attachHotkeyTip(btnJun, 'I')
  attachHotkeyTip(btnDel, 'Suppr')
  subscribe((evt)=>{ if(evt==='mode:set') update() })
  update()
}
