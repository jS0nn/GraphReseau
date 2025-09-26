import type { Node } from '../types/graph'

const LEGACY_PIPE_TYPES: ReadonlySet<string> = new Set(['CANALISATION', 'COLLECTEUR'])

function toUpperSafe(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

export function canonicalizeNodeType(type: unknown): string {
  const upper = toUpperSafe(type)
  if(!upper) return ''
  if(upper === 'COLLECTEUR') return 'CANALISATION'
  if(upper === 'PLATEFORME') return 'GENERAL'
  if(upper === 'GÉNÉRAL' || upper === 'GENERAL') return 'GENERAL'
  if(upper === 'PUITS') return 'OUVRAGE'
  return upper
}

export function enforceEdgeOnlyNodeType(type: unknown): string {
  const canonical = canonicalizeNodeType(type)
  if(!canonical) return 'OUVRAGE'
  if(LEGACY_PIPE_TYPES.has(canonical)) return 'OUVRAGE'
  return canonical
}

export function isLegacyPipeType(type: unknown): boolean {
  const upper = toUpperSafe(type)
  return LEGACY_PIPE_TYPES.has(upper)
}

type NodeWithType = Pick<Node, 'type'> | { type?: unknown } | null | undefined

export function shouldFilterNode(node: NodeWithType): boolean {
  return isLegacyPipeType(node?.type)
}

export const EDGE_MODE_FORBIDDEN_TYPES = LEGACY_PIPE_TYPES
