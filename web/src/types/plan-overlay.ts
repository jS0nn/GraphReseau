export interface LatLon {
  lat: number
  lon: number
}

export interface PlanOverlayBounds {
  sw: LatLon
  se: LatLon
  nw: LatLon
  ne: LatLon
}

export interface PlanOverlayUpdatePayload {
  bounds: PlanOverlayBounds
  rotation_deg?: number
  opacity?: number
}

export interface PlanOverlayMedia {
  type: string
  source: string
  drive_file_id?: string | null
  url?: string | null
  cache_max_age_s?: number | null
}

export interface PlanOverlayDefaults {
  opacity: number
  bearing_deg: number
}

export interface PlanOverlayConfig {
  enabled: boolean
  display_name?: string | null
  media: PlanOverlayMedia
  bounds: PlanOverlayBounds
  defaults: PlanOverlayDefaults
  site_id?: string | null
}
