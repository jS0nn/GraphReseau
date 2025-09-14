// Lightweight context mini-menu used after split to choose node type

let openEl = null

export function closeMiniMenu(){
  try{ openEl?.remove() }catch{}
  openEl = null
  document.removeEventListener('click', onDocClick, true)
}

function onDocClick(e){
  if(!openEl) return
  if(!openEl.contains(e.target)) closeMiniMenu()
}

export function showMiniMenu(x, y, items){
  closeMiniMenu()
  const div = document.createElement('div')
  div.className = 'menu'
  div.id = 'miniMenu'
  div.style.left = Math.round(x) + 'px'
  div.style.top  = Math.round(y) + 'px'
  div.style.display = 'block'
  ;(items||[]).forEach(item => {
    const it = document.createElement('div')
    it.className = 'item'
    it.textContent = item.label
    it.onclick = (ev)=>{ ev.stopPropagation(); try{ item.onClick?.() }finally{ closeMiniMenu() } }
    div.appendChild(it)
  })
  document.body.appendChild(div)
  openEl = div
  document.addEventListener('click', onDocClick, true)
}

