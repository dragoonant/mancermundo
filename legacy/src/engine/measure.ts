// Distances and control range (R-8.2, R-8.3). Operative distances are measured between the closest
// parts of bases (3D straight line between nearest base points); areas are horizontal only.
import { withinDistance } from './geometry'
import { footprintGap2D, footprintInsidePolygon } from './footprint'
import { baseDistance3D, bodyOf, visible, type Body } from './los'
import { activeOps, markerRadius } from './state'
import type { GameState, Marker, Operative, Polygon, Seat } from './types'

export { baseDistance3D, bodyOf }
export type { Body }

/** Base-edge distance between two bodies (3D). */
export function distanceBetween(a: Body, b: Body): number {
  return baseDistance3D(a, b)
}

export function isWithin(a: Body, b: Body, inches: number): boolean {
  return withinDistance(baseDistance3D(a, b), inches)
}

/** A body is "wholly within" a region (drop zone, territory) when its whole base lies inside it. */
export function whollyWithinRegion(b: Body, region: Polygon): boolean {
  return footprintInsidePolygon(b, region)
}

/** Horizontal base-edge gap from a body to a marker disc (areas are horizontal only). */
export function gapToMarker(b: Body, marker: Pick<Marker, 'kind' | 'pos'>): number {
  return footprintGap2D(b, { pos: marker.pos, baseRadius: markerRadius(marker) })
}

export function markerBody(marker: Marker): Body {
  return { id: marker.id, pos: { x: marker.pos.x, y: 0, z: marker.pos.z }, baseRadius: markerRadius(marker), height: 0.05 }
}

/** Control range is mutual: visible to and within 1" from either side (R-8.2). */
export function inControlRange(state: GameState, a: Body, b: Body): boolean {
  if (a.id === b.id) return false
  if (!withinDistance(baseDistance3D(a, b), 1)) return false
  return visible(state, a, b, { crMode: true }) || visible(state, b, a, { crMode: true })
}

export function enemiesInControlRange(state: GameState, op: Body & { seat?: Seat }, seat: Seat): Operative[] {
  const me = bodyOf(op)
  return activeOps(state).filter((o) => o.seat !== seat && inControlRange(state, me, bodyOf(o)))
}

export function friendsInControlRange(state: GameState, op: Body, seat: Seat): Operative[] {
  const me = bodyOf(op)
  return activeOps(state).filter((o) => o.seat === seat && o.id !== op.id && inControlRange(state, me, bodyOf(o)))
}

/** A marker is in an operative's control range when visible to it and within 1" (horizontal gap). */
export function markerInControlRange(state: GameState, op: Body, marker: Marker): boolean {
  if (!withinDistance(gapToMarker(op, marker), 1)) return false
  return visible(state, op, markerBody(marker), { crMode: true })
}

