// Vendor entry: d3 + elk
import * as d3 from 'd3'
import ELK from 'elkjs/lib/elk.bundled.js'
import L from 'leaflet'

// Expose to global for legacy code ease
window.d3 = d3
window.ELK = ELK
window.L = L

export { d3, ELK, L }
