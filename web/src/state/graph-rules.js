const LEGACY_PIPE_TYPES = new Set(['CANALISATION', 'COLLECTEUR'])

function toUpperSafe(value){
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

export function canonicalizeNodeType(type){
  const upper = toUpperSafe(type)
  if(!upper) return ''
  if(upper === 'COLLECTEUR') return 'CANALISATION'
  if(upper === 'PLATEFORME') return 'GENERAL'
  if(upper === 'GÉNÉRAL' || upper === 'GENERAL') return 'GENERAL'
  if(upper === 'PUITS') return 'OUVRAGE'
  return upper
}

export function enforceEdgeOnlyNodeType(type){
  const canonical = canonicalizeNodeType(type)
  if(!canonical) return 'OUVRAGE'
  if(LEGACY_PIPE_TYPES.has(canonical)) return 'OUVRAGE'
  return canonical
}

export function isLegacyPipeType(type){
  const upper = toUpperSafe(type)
  return LEGACY_PIPE_TYPES.has(upper)
}

export function shouldFilterNode(node){
  return isLegacyPipeType(node?.type)
}

export const EDGE_MODE_FORBIDDEN_TYPES = LEGACY_PIPE_TYPES
