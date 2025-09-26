import { setMode, getMode, subscribe } from './state/index.ts'
import { showTooltip, scheduleHide, cancelHide } from './ui/tooltip.ts'

function el<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null
}

type ModeButton = HTMLElement | null

type TooltipOptions = {
  button: ModeButton
  label: string
}

function attachHotkeyTip({ button, label }: TooltipOptions): void {
  if(!button) return
  const html = `<div style="display:flex; align-items:center; gap:6px"><span style="opacity:.8">Raccourci</span><kbd style="background:#111827;color:#e5e7eb;border:1px solid #334155;padding:2px 6px;border-radius:6px;font:12px/1 ui-sans-serif">${label}</kbd></div>`
  const showBelow = (): void => {
    try{
      cancelHide()
      const rect = button.getBoundingClientRect()
      const x = Math.round(rect.left + rect.width / 2)
      const y = Math.round(rect.bottom + 6)
      showTooltip(x, y, html)
    }catch{}
  }
  button.addEventListener('mouseenter', showBelow)
  button.addEventListener('focus', showBelow)
  button.addEventListener('mouseleave', () => scheduleHide(600))
  button.addEventListener('blur', () => scheduleHide(0))
}

export function initModesUI(): void {
  const btnSel = el('modeSelect')
  const btnDraw = el('modeDraw')
  const btnConn = el('modeConnect')
  const btnEdit = el('modeEdit')
  const btnJun = el('modeJunction')
  const btnDel = el('modeDelete')

  const update = (): void => {
    const mode = getMode()
    btnSel?.classList.toggle('active', mode === 'select')
    btnDraw?.classList.toggle('active', mode === 'draw')
    btnConn?.classList.toggle('active', mode === 'connect')
    btnEdit?.classList.toggle('active', mode === 'edit')
    btnJun?.classList.toggle('active', mode === 'junction')
    btnDel?.classList.toggle('active', mode === 'delete')
  }

  if(btnSel) btnSel.onclick = () => setMode('select')
  if(btnDraw) btnDraw.onclick = () => setMode('draw')
  if(btnConn) btnConn.onclick = () => setMode('connect')
  if(btnEdit) btnEdit.onclick = () => setMode('edit')
  if(btnDel) btnDel.onclick = () => setMode('delete')
  if(btnJun) btnJun.onclick = () => setMode('junction')

  attachHotkeyTip({ button: btnSel, label: 'V' })
  attachHotkeyTip({ button: btnDraw, label: 'D' })
  attachHotkeyTip({ button: btnEdit, label: 'E' })
  attachHotkeyTip({ button: btnJun, label: 'I' })
  attachHotkeyTip({ button: btnDel, label: 'Suppr' })

  subscribe((evt) => { if(evt === 'mode:set') update() })
  update()
}
