// Entry point: load modular editor only (legacy removed)
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
loadScript('/static/bundle/editor.boot.js').then(()=>{
  if (window.EditorBoot?.boot) window.EditorBoot.boot()
}).catch(err => { console.error('Failed to load editor.boot', err) })
