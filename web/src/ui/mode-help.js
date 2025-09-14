let hideTimer = null

function ensureEl(){
  let el = document.getElementById('modeHelp')
  if(!el){
    el = document.createElement('div')
    el.id = 'modeHelp'
    const close = document.createElement('button')
    close.className = 'close'
    close.title = 'Fermer'
    close.innerHTML = '&times;'
    close.onclick = ()=> hide()
    el.appendChild(close)
    const content = document.createElement('div')
    content.className = 'content'
    el.appendChild(content)
    document.body.appendChild(el)
  }
  return el
}

function contentFor(mode){
  const li = (...items)=> '<ul>'+items.map(x=>`<li>${x}</li>`).join('')+'</ul>'
  switch((mode||'').toLowerCase()){
    case 'draw':
      return '<b>Dessiner (D)</b>'+li(
        'Clic = ajouter un sommet',
        'Double‑clic / Entrée = terminer, Échap = annuler',
        'Clic nœud = attache, clic canalisation = split + jonction',
        'Molette = zoom, Espace = pan')
    case 'edit':
      return '<b>Éditer (E)</b>'+li(
        'Clic sur une canalisation = afficher les poignées',
        'Glisser un sommet pour déplacer',
        'Alt+clic sur un segment = insérer un sommet',
        'Suppr = supprimer le sommet')
    case 'junction':
      return '<b>Insérer (J)</b>'+li(
        'Clic sur une canalisation = insérer un point et découper la ligne',
        'Mini‑menu: type du point (Jonction/PM/Vanne) et action « Démarrer une antenne »',
        'Les jonctions ne prennent pas de place (petit rond ancré au GPS)')
    case 'connect':
      return '<b>Connecter (C)</b>'+li(
        'Clique une source, puis un tuyau ou un nœud',
        'Canalisation → Canalisation : ordre des enfants dans la fiche du parent')
    case 'delete':
      return '<b>Supprimer</b>'+li(
        'Sélectionne un élément puis Supprimer',
        'Ou passe en mode Supprimer et clique l’élément')
    case 'select':
    default:
      return '<b>Sélection (V)</b>'+li(
        'Clic = sélectionner, Shift = multi‑sélection',
        'Suppr = supprimer la sélection',
        'Molette = zoom, Espace = pan')
  }
}

export function showModeHelp(mode){
  const el = ensureEl()
  const content = el.querySelector('.content')
  content.innerHTML = contentFor(mode)
  el.classList.add('open')
  clearTimeout(hideTimer)
  hideTimer = setTimeout(()=>{ hide() }, 7000)
}

export function hide(){
  clearTimeout(hideTimer); hideTimer = null
  const el = document.getElementById('modeHelp')
  if(el) el.classList.remove('open')
}
