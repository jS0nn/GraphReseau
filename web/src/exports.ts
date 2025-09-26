import type { Graph } from './types/graph'
import type { PipeStyleMetaPayload } from './style/pipes.ts'

export function toJSON(graph: Partial<Graph> | null | undefined): Graph {
  let engineMeta: PipeStyleMetaPayload | null = null
  try{
    const pipesStyle = (window as typeof window & { __pipesStyle?: { meta?: () => PipeStyleMetaPayload | null } }).__pipesStyle
    engineMeta = pipesStyle?.meta?.() ?? null
  }catch{}

  const styleMetaCandidate = (graph?.style_meta && Object.keys(graph.style_meta).length > 0)
    ? graph.style_meta
    : engineMeta ?? null
  const styleMeta = styleMetaCandidate as Graph['style_meta']

  return {
    version: graph?.version ?? '1.5',
    site_id: graph?.site_id ?? null,
    generated_at: graph?.generated_at ?? null,
    style_meta: styleMeta ?? null,
    nodes: graph?.nodes ?? [],
    edges: graph?.edges ?? [],
  }
}
