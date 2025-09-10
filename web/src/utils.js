// ID helpers
export const genId = (p='id') => `${p}-${Math.random().toString(36).slice(2,8)}`
export const genIdWithTime = (prefix='N') => {
  const t = Date.now().toString(36).slice(-6)
  const r = Math.floor(Math.random()*1e6).toString(36)
  return `${prefix}-${t}${r}`.toUpperCase()
}

// DOM/query helper
export const $$ = (s) => document.querySelector(s)

// Value normalization
export const valOrNull = (v) => (v === '' || v === undefined ? null : v)
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
export function vn(v, def){
  if (v === '' || v === null || v === undefined) return def
  const n = +v
  return Number.isNaN(n) ? def : n
}

// Geometry helpers
export const snap = (v, step=8) => Math.round(v/step) * step

// Domain helpers
export const isCanal = (n) => (n?.type === 'CANALISATION' || n?.type === 'COLLECTEUR')
export function incrementName(name, existingNames){
  if(!name) return 'N-001'
  const exists = (cand) => Array.isArray(existingNames)
    ? existingNames.includes(cand)
    : false
  const m=name.match(/^(.*?)(\d+)(\D*)$/)
  if(m){
    const base=m[1],num=m[2],suf=m[3]||''
    let next=String(parseInt(num,10)+1).padStart(num.length,'0')
    let cand=`${base}${next}${suf}`
    let guard=0
    while(exists(cand) && guard++<999){
      next=String(parseInt(next,10)+1).padStart(num.length,'0')
      cand=`${base}${next}${suf}`
    }
    return cand
  }
  let k=1
  let cand=`${name}-copy`
  let guard=0
  while(exists(cand) && guard++<999){ k++; cand=`${name}-copy${k}` }
  return cand
}

// Download helper (JSON/text)
export function download(data, name, mime='application/json'){
  const payload = (typeof data === 'string') ? data : JSON.stringify(data)
  const blob = new Blob([payload], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

// Default name by type (legacy-like)
export function defaultName(type, nodes){
  const T = (type==='COLLECTEUR') ? 'CANALISATION' : (type||'N')
  const baseMap = { OUVRAGE:'ouvr', CANALISATION:'cana', COLLECTEUR:'cana', GENERAL:'gen', VANNE:'vanne', POINT_MESURE:'pm' }
  const base = baseMap[T] || 'n'
  const exists = (name) => Array.isArray(nodes) && nodes.some(n=> (n.name||'').toLowerCase() === name.toLowerCase())
  let k = 1
  let cand = `${base}${k}`
  while(exists(cand)){ k += 1; cand = `${base}${k}` }
  return cand
}
