// Simple tooltip utility: show near cursor, hide on leave

let tipEl = null
let showTimer = null
let hideTimer = null

function ensureEl(){
  if(tipEl) return tipEl
  tipEl = document.createElement('div')
  tipEl.className = 'tooltip'
  Object.assign(tipEl.style, {
    position: 'fixed', zIndex: 10000,
    padding: '6px 8px', borderRadius: '8px',
    background: 'rgba(17,24,39,.92)', color: '#e5e7eb',
    border: '1px solid #334155',
    font: '12px/1.2 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial',
    pointerEvents: 'none', opacity: '0', transition: 'opacity 120ms ease',
    boxShadow: '0 6px 22px rgba(0,0,0,0.3)'
  })
  document.body.appendChild(tipEl)
  return tipEl
}

export function showTooltip(x, y, html){
  const el = ensureEl()
  el.innerHTML = html
  const pad = 10
  const vw = window.innerWidth||1200, vh = window.innerHeight||800
  const rect = { w: Math.min(360, Math.max(120, el.offsetWidth||160)), h: Math.min(260, Math.max(40, el.offsetHeight||40)) }
  let left = x + pad, top = y + pad
  if(left + rect.w > vw - 8) left = x - rect.w - pad
  if(top + rect.h > vh - 8) top = y - rect.h - pad
  el.style.left = Math.max(8, Math.round(left)) + 'px'
  el.style.top  = Math.max(8, Math.round(top))  + 'px'
  clearTimeout(showTimer)
  clearTimeout(hideTimer)
  showTimer = setTimeout(()=>{ el.style.opacity = '1' }, 40)
}

export function hideTooltip(){
  if(!tipEl) return
  tipEl.style.opacity = '0'
  clearTimeout(hideTimer); hideTimer = null
}

export function scheduleHide(delayMs = 2000){
  clearTimeout(hideTimer)
  hideTimer = setTimeout(()=>{ try{ hideTooltip() }catch{} }, Math.max(200, +delayMs||0))
}

export function cancelHide(){
  clearTimeout(hideTimer)
  hideTimer = null
}
