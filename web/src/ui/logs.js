import { subscribe, state } from '../state.js'

let inited = false

export function initLogsUI(){
  if(inited) return; inited = true
  const drawer = document.getElementById('logDrawer')
  const body = document.getElementById('logBody')
  const btn = document.getElementById('logBtn')
  const btnClose = document.getElementById('logClose')
  const btnClear = document.getElementById('logClear')
  const btnDownload = document.getElementById('logDownload')
  if(btn) btn.onclick = () => drawer?.classList.toggle('open')
  if(btnClose) btnClose.onclick = () => drawer?.classList.remove('open')
  if(btnClear) btnClear.onclick = () => { if(body) body.textContent = '' }
  if(btnDownload) btnDownload.onclick = () => {
    const blob = new Blob([body?.textContent||''], { type:'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href=url; a.download='layout-log.txt'; a.click(); URL.revokeObjectURL(url)
  }
}

export function log(msg, level='info'){
  console.log('[editor]', msg)
  const body = document.getElementById('logBody')
  if(!body) return
  const line = document.createElement('div')
  line.className = `log-line log-${level}`
  line.textContent = String(msg)
  body.appendChild(line)
  body.scrollTop = body.scrollHeight
}

// Subscribe common editor events to the log (dev or not)
let wired = false
export function wireStateLogs(){
  if(wired) return; wired = true
  subscribe((evt, payload)=>{
    switch(true){
      case evt==='graph:set':
        log(`Graph chargé: ${state.nodes.length} nœuds / ${state.edges.length} arêtes`); break
      case evt==='mode:set':
        log(`Mode: ${payload}`); break
      case evt==='node:add':
        log(`+ nœud ${payload?.type||''} ${(payload?.name||payload?.id)}`); break
      case evt==='node:remove':
        log(`− nœud ${payload?.id}`); break
      case evt==='edge:add':
        log(`+ arête ${payload?.from_id||payload?.source} → ${payload?.to_id||payload?.target}`); break
      case evt==='edge:remove':
        log(`− arête ${payload?.id}`); break
      case evt==='clipboard:copy':
        log(`Copié: ${payload?.count||0} nœud(s)`); break
      case evt==='clipboard:paste':
        log(`Collé: ${payload?.count||0} nœud(s)`); break
      case evt==='sequence:update':
        log(`Séquence mise à jour (canal)`); break
      case evt==='graph:update':
        log('Graphe mis à jour'); break
      default:
        if(evt.startsWith('node:update')){ log('Nœud mis à jour') }
        break
    }
  })
}
