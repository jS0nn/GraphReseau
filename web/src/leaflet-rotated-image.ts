import type { ImageOverlayOptions, LatLngBounds, LatLngExpression } from 'leaflet'
import { L } from './vendor.ts'

export type RotatedOverlayCorners = {
  nw: LatLngExpression
  ne: LatLngExpression
  sw: LatLngExpression
  se: LatLngExpression
}

class RotatedImageOverlay extends L.ImageOverlay {
  private _topLeft: L.LatLng
  private _topRight: L.LatLng
  private _bottomLeft: L.LatLng
  private _bottomRight: L.LatLng
  private _boundsValue: LatLngBounds

  constructor(url: string, corners: RotatedOverlayCorners, options?: ImageOverlayOptions){
    const nw = L.latLng(corners.nw)
    const ne = L.latLng(corners.ne)
    const sw = L.latLng(corners.sw)
    const se = L.latLng(corners.se)
    const bounds = L.latLngBounds([nw, ne, sw, se])
    super(url, bounds, options)
    this._topLeft = nw
    this._topRight = ne
    this._bottomLeft = sw
    this._bottomRight = se
    this._boundsValue = bounds
    ;(this as unknown as { _bounds: LatLngBounds })._bounds = bounds
  }

  onAdd(map: L.Map): this {
    super.onAdd(map)
    this._reset()
    return this
  }

  _animateZoom(event: L.LeafletEvent & { center: L.LatLng; zoom: number }): void {
    super._animateZoom?.(event)
    this._reset()
  }

  getBounds(): LatLngBounds {
    return this._boundsValue
  }

  setCorners(corners: RotatedOverlayCorners): void {
    this._topLeft = L.latLng(corners.nw)
    this._topRight = L.latLng(corners.ne)
    this._bottomLeft = L.latLng(corners.sw)
    this._bottomRight = L.latLng(corners.se)
    this._boundsValue = L.latLngBounds([this._topLeft, this._topRight, this._bottomLeft, this._bottomRight])
    ;(this as unknown as { _bounds: LatLngBounds })._bounds = this._boundsValue
    this._reset()
  }

  private _reset(): void {
    const map = this._map
    const image = this._image as HTMLImageElement | undefined
    if(!map || !image) return

    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height
    if(!width || !height){
      if(!image.complete){
        const onLoad = () => {
          image.removeEventListener('load', onLoad)
          this._reset()
        }
        image.addEventListener('load', onLoad, { once: true })
      }
      return
    }

    const topLeft = map.latLngToLayerPoint(this._topLeft)
    const topRight = map.latLngToLayerPoint(this._topRight)
    const bottomLeft = map.latLngToLayerPoint(this._bottomLeft)

    const topRightOffset = topRight.subtract(topLeft)
    const bottomLeftOffset = bottomLeft.subtract(topLeft)

    const a = topRightOffset.x / width
    const b = topRightOffset.y / width
    const c = bottomLeftOffset.x / height
    const d = bottomLeftOffset.y / height

    const transform = `matrix3d(${a},${b},0,0,${c},${d},0,0,0,0,1,0,${topLeft.x},${topLeft.y},0,1)`

    const previousVisibility = image.style.visibility
    image.style.visibility = 'hidden'
    image.style.transformOrigin = '0 0'
    image.style.width = `${width}px`
    image.style.height = `${height}px`
    image.style.transform = transform
    image.style.visibility = previousVisibility || ''
  }
}

export function createRotatedImageOverlay(
  url: string,
  corners: RotatedOverlayCorners,
  options?: ImageOverlayOptions
): RotatedImageOverlay {
  return new RotatedImageOverlay(url, corners, options)
}
