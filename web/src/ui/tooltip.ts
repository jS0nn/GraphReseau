let tipEl: HTMLDivElement | null = null
let showTimer: ReturnType<typeof setTimeout> | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

function ensureEl(): HTMLDivElement {
  if(tipEl) return tipEl
  const el = document.createElement('div')
  el.className = 'tooltip'
  const style = el.style
  style.position = 'fixed'
  style.zIndex = '10000'
  style.padding = '6px 8px'
  style.borderRadius = '8px'
  style.background = 'rgba(17,24,39,.92)'
  style.color = '#e5e7eb'
  style.border = '1px solid #334155'
  style.font = '12px/1.2 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial'
  style.pointerEvents = 'none'
  style.opacity = '0'
  style.transition = 'opacity 120ms ease'
  style.boxShadow = '0 6px 22px rgba(0,0,0,0.3)'
  document.body.appendChild(el)
  tipEl = el
  return el
}

export function showTooltip(x: number, y: number, html: string): void {
  const el = ensureEl()
  el.innerHTML = html
  const pad = 10
  const vw = window.innerWidth || 1200
  const vh = window.innerHeight || 800
  const w = Math.min(360, Math.max(120, el.offsetWidth || 160))
  const h = Math.min(260, Math.max(40, el.offsetHeight || 40))
  let left = x + pad
  let top = y + pad
  if(left + w > vw - 8) left = x - w - pad
  if(top + h > vh - 8) top = y - h - pad
  el.style.left = `${Math.max(8, Math.round(left))}px`
  el.style.top = `${Math.max(8, Math.round(top))}px`
  if(showTimer) clearTimeout(showTimer)
  if(hideTimer) clearTimeout(hideTimer)
  showTimer = setTimeout(() => { el.style.opacity = '1' }, 40)
}

export function hideTooltip(): void {
  if(!tipEl) return
  tipEl.style.opacity = '0'
  if(hideTimer) clearTimeout(hideTimer)
  hideTimer = null
}

export function scheduleHide(delayMs = 2000): void {
  if(hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => { try{ hideTooltip() }catch{} }, Math.max(200, Number(delayMs) || 0))
}

export function cancelHide(): void {
  if(hideTimer) clearTimeout(hideTimer)
  hideTimer = null
}
