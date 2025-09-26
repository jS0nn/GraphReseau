let openEl: HTMLDivElement | null = null

type MiniMenuItem = {
  label: string
  onClick?: () => void
}

export function closeMiniMenu(): void {
  try{ openEl?.remove() }catch{}
  openEl = null
  document.removeEventListener('click', onDocClick, true)
}

function onDocClick(event: MouseEvent): void {
  if(!openEl) return
  const target = event.target
  if(!(target instanceof Node) || !openEl.contains(target)){
    closeMiniMenu()
  }
}

export function showMiniMenu(x: number, y: number, items: MiniMenuItem[] = []): void {
  closeMiniMenu()
  const div = document.createElement('div')
  div.className = 'menu'
  div.id = 'miniMenu'
  div.style.left = `${Math.round(x)}px`
  div.style.top = `${Math.round(y)}px`
  div.style.display = 'block'
  items.forEach((item) => {
    const entry = document.createElement('div')
    entry.className = 'item'
    entry.textContent = item.label
    entry.onclick = (ev) => {
      ev.stopPropagation()
      try{ item.onClick?.() }finally{ closeMiniMenu() }
    }
    div.appendChild(entry)
  })
  document.body.appendChild(div)
  openEl = div
  document.addEventListener('click', onDocClick, true)
}
