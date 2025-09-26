import { subscribe, state } from '../state/index.ts'

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

type GlobalWithDev = typeof window & { __DEV__?: boolean }

let inited = false
let DEV_LOGS = (() => {
  const g = window as GlobalWithDev
  const flag = typeof g.__DEV__ === 'boolean' ? g.__DEV__ : false
  let value = flag
  try{
    const qs = new URLSearchParams(location.search)
    if(qs.get('devlogs') === '1') value = true
    if(localStorage.getItem('DEV_LOGS') === '1') value = true
  }catch{}
  return value
})()

const getElement = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null

export function initLogsUI(): void {
  if(inited) return
  inited = true
  const drawer = getElement<HTMLDivElement>('logDrawer')
  const body = getElement<HTMLDivElement>('logBody')
  const btn = getElement<HTMLButtonElement>('logBtn')
  const btnClose = getElement<HTMLButtonElement>('logClose')
  const btnClear = getElement<HTMLButtonElement>('logClear')
  const btnDownload = getElement<HTMLButtonElement>('logDownload')
  if(btn) btn.onclick = () => drawer?.classList.toggle('open')
  if(btnClose) btnClose.onclick = () => drawer?.classList.remove('open')
  if(btnClear) btnClear.onclick = () => { if(body) body.textContent = '' }
  if(btnDownload) btnDownload.onclick = () => {
    const content = body?.textContent || ''
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'layout-log.txt'
    a.click()
    URL.revokeObjectURL(url)
  }
}

export function log(msg: unknown, level: LogLevel = 'info'): void {
  // eslint-disable-next-line no-console
  console.log('[editor]', msg)
  const body = getElement<HTMLDivElement>('logBody')
  if(!body) return
  const line = document.createElement('div')
  line.className = `log-line log-${level}`
  line.textContent = String(msg)
  body.appendChild(line)
  body.scrollTop = body.scrollHeight
}

export function devlog(...args: unknown[]): void {
  if(!DEV_LOGS) return
  try{ console.debug('[dev]', ...args) }catch{}
}

export function setDevLogsEnabled(on: boolean): void {
  DEV_LOGS = !!on
  try{ localStorage.setItem('DEV_LOGS', on ? '1' : '0') }catch{}
}

export function initDevErrorHooks(): void {
  if(!DEV_LOGS) return
  try{
    window.addEventListener('error', (e) => {
      try{ console.error('[dev:error]', e?.message, `${e?.filename}:${e?.lineno}:${e?.colno}`, e?.error) }catch{}
    })
    window.addEventListener('unhandledrejection', (e) => {
      try{ console.error('[dev:promise]', e?.reason) }catch{}
    })
  }catch{}
}

let wired = false
export function wireStateLogs(): void {
  if(wired) return
  wired = true
  subscribe((evt, payload) => {
    const data = (payload && typeof payload === 'object') ? (payload as Record<string, unknown>) : null
    const read = (key: string): unknown => (data ? data[key] : undefined)
    const pickString = (value: unknown, fallback = ''): string => {
      if(typeof value === 'string') return value
      if(typeof value === 'number') return String(value)
      if(value == null) return fallback
      return String(value)
    }
    const pickCount = (value: unknown): number => {
      if(typeof value === 'number' && Number.isFinite(value)) return value
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    switch(true){
      case evt === 'graph:set':
        log(`Graph chargé: ${state.nodes.length} nœuds / ${state.edges.length} arêtes`)
        break
      case evt === 'mode:set':
        log(`Mode: ${String(payload)}`)
        break
      case evt === 'node:add':
        log(`+ nœud ${pickString(read('type'))} ${pickString(read('name')) || pickString(read('id'))}`)
        break
      case evt === 'node:remove':
        log(`− nœud ${pickString(read('id'))}`)
        break
      case evt === 'edge:add':
        log(`+ arête ${pickString(read('from_id')) || pickString(read('source'))} → ${pickString(read('to_id')) || pickString(read('target'))}`)
        break
      case evt === 'edge:remove':
        log(`− arête ${pickString(read('id'))}`)
        break
      case evt === 'edge:flip':
        log(`↺ arête ${pickString(read('from_id')) || pickString(read('source'))} → ${pickString(read('to_id')) || pickString(read('target'))}`)
        break
      case evt === 'clipboard:copy':
        log(`Copié: ${pickCount(read('count'))} nœud(s)`)
        break
      case evt === 'clipboard:paste':
        log(`Collé: ${pickCount(read('count'))} nœud(s)`)
        break
      case evt === 'sequence:update':
        log('Séquence mise à jour (canal)')
        break
      case evt === 'graph:update':
        log('Graphe mis à jour')
        break
      default:
        if(typeof evt === 'string' && evt.startsWith('node:update')) log('Nœud mis à jour')
        break
    }
  })
}
