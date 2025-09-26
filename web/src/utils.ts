import type { Node } from './types/graph'

export const genId = (prefix = 'id'): string => `${prefix}-${Math.random().toString(36).slice(2, 8)}`

export const genIdWithTime = (prefix = 'N'): string => {
  const t = Date.now().toString(36).slice(-6)
  const r = Math.floor(Math.random() * 1e6).toString(36)
  return `${prefix}-${t}${r}`.toUpperCase()
}

export const $$ = <T extends Element = Element>(selector: string): T | null => document.querySelector<T>(selector)

export const valOrNull = <T>(value: T | '' | undefined): T | null => (value === '' || value === undefined ? null : value)

export const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

export function vn(value: unknown, fallback: number): number {
  if(value === '' || value === null || value === undefined) return fallback
  const numeric = Number(value)
  return Number.isNaN(numeric) ? fallback : numeric
}

export const snap = (value: number, step = 8): number => Math.round(value / step) * step

export const isCanal = (node: unknown): boolean => {
  const type = typeof node === 'object' && node !== null ? (node as { type?: unknown }).type : undefined
  const t = String(type || '').toUpperCase()
  return t === 'CANALISATION' || t === 'COLLECTEUR'
}

export const toNullableString = (value: unknown, { trim = true }: { trim?: boolean } = {}): string | null => {
  if(value === null || value === undefined) return null
  const text = typeof value === 'string' ? value : String(value)
  if(!trim) return text
  const normalized = text.trim()
  return normalized || null
}

export function incrementName(name: string | null | undefined, existingNames: readonly string[] = []): string {
  const baseName = name?.trim()
  if(!baseName) return 'N-001'
  const exists = (candidate: string): boolean => existingNames.includes(candidate)
  const match = baseName.match(/^(.*?)(\d+)(\D*)$/)
  if(match){
    const [, base, digits, suffix = ''] = match
    let next = (parseInt(digits, 10) + 1).toString().padStart(digits.length, '0')
    let candidate = `${base}${next}${suffix}`
    let guard = 0
    while(exists(candidate) && guard++ < 999){
      next = (parseInt(next, 10) + 1).toString().padStart(digits.length, '0')
      candidate = `${base}${next}${suffix}`
    }
    return candidate
  }
  let k = 1
  let candidate = `${baseName}-copy`
  let guard = 0
  while(exists(candidate) && guard++ < 999){
    k += 1
    candidate = `${baseName}-copy${k}`
  }
  return candidate
}

type NodeNameLike = Pick<Node, 'name'>

export function defaultName(type: string | null | undefined, nodes: readonly NodeNameLike[] = []): string {
  const canonical = type === 'COLLECTEUR' ? 'CANALISATION' : String(type || 'N').toUpperCase()
  const baseMap: Record<string, string> = {
    OUVRAGE: 'ouvr',
    CANALISATION: 'cana',
    COLLECTEUR: 'cana',
    GENERAL: 'gen',
    VANNE: 'vanne',
    POINT_MESURE: 'pm',
  }
  const base = baseMap[canonical] ?? 'n'
  const exists = (candidate: string): boolean => nodes.some(node => (node.name || '').toLowerCase() === candidate.toLowerCase())
  let index = 1
  let candidate = `${base}${index}`
  while(exists(candidate)){
    index += 1
    candidate = `${base}${index}`
  }
  return candidate
}
