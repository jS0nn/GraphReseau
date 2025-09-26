export {}

declare global {
  interface Window {
    __leaflet_map?: {
      mouseEventToContainerPoint?: (ev: MouseEvent) => { x: number; y: number }
      containerPointToLatLng?: (pt: [number, number]) => { lat: number; lng: number }
      mouseEventToLatLng?: (ev: MouseEvent) => { lat: number; lng: number }
      latLngToContainerPoint?: (latLng: { lat: number; lng: number }) => { x: number; y: number }
    }
    __squelchCanvasClick?: boolean
    d3?: typeof import('d3')
    EditorBoot?: {
      boot?: () => void
    }
    __pipesStyle?: import('../style/pipes').PipeStyle
    __MAP_ACTIVE?: boolean
    __MAP_SUPPRESS_AUTOFIT?: boolean
  }
  var __MAP_SUPPRESS_AUTOFIT: boolean | undefined
  const __DEV__: boolean | undefined
}
