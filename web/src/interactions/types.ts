import type { UIPoint } from '../shared/geometry'
import type { MutableEdge } from '../state/normalize.ts'

export type LatLonPoint = [number, number]

export type AnchorHint = {
  edgeId?: string
  offset?: number | null
}

export type EdgeProps = {
  diameter_mm?: number | null
  material?: string | null
  sdr?: string | null
  branch_id?: string | null
}

export type EdgePatch = Partial<MutableEdge>

export type DrawingShape = {
  pointsUI: UIPoint[]
  pointsLL: LatLonPoint[]
  previewPath: SVGPathElement | null
  snappedIds: (string | null)[]
  anchorHints: Map<string, AnchorHint>
  _hasPhantom?: boolean
}
