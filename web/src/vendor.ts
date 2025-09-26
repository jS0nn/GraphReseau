import * as d3 from 'd3'
import ELK from 'elkjs/lib/elk.bundled.js'
import L from 'leaflet'

declare global {
  interface Window {
    d3?: typeof d3
    ELK?: typeof ELK
    L?: typeof L
  }
}

window.d3 = d3
window.ELK = ELK
window.L = L

export { d3, ELK, L }
