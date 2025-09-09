// Entry point: load modular editor by default; legacy via ?legacy=1
function wantsLegacy(){ try{ return new URLSearchParams(location.search).get('legacy') === '1' }catch{ return false } }

function loadScript(src){
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = src
    s.defer = true
    s.onload = () => resolve()
    s.onerror = (e) => reject(e)
    document.head.appendChild(s)
  })
}

if (wantsLegacy()) {
  loadScript('/static/bundle/legacy-editor.js')
} else {
  loadScript('/static/bundle/editor.boot.js').then(()=>{
    if (window.EditorBoot?.boot) window.EditorBoot.boot()
  }).catch(err => { console.error('Failed to load editor.boot', err) })
}
