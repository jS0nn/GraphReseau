import type { MutableNode, MutableEdge } from '../state/normalize'

export type UIPoint = [number, number]
export type GeometryPoint = [number, number]

export function centerUIForNode(node: MutableNode | null | undefined): UIPoint
export function edgeGeometryToUIPoints(edge: MutableEdge | null | undefined, nodes: MutableNode[]): UIPoint[]
export function ensureEdgeGeometry(edge: MutableEdge | null | undefined, nodes: MutableNode[]): GeometryPoint[] | null
export function nearestPointOnPolyline(points: UIPoint[], x: number, y: number): {
  seg: number
  t: number
  d2: number
  px: number
  py: number
} | null
export function splitGeometryAt(
  geometry: GeometryPoint[],
  hit: { px: number; py: number; seg: number; t: number },
): {
  g1: GeometryPoint[]
  g2: GeometryPoint[]
}
export function geometryLengthMeters(geometry: GeometryPoint[] | null | undefined): number | null
export function offsetAlongGeometry(edge: MutableEdge | null | undefined, node: MutableNode | null | undefined): number | null
