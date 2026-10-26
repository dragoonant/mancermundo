// Terrain features made of parts (polygon footprint, height, traits). Parts are solid prisms for
// raycasts; Vantage floors are surfaces an operative may finish a move on (R-11, R-12).
import {
  EPS,
  circleInsidePolygon,
  circleOverlapsPolygon,
  distToPolygon,
  pointInPolygon,
  polygonBBox,
  type BBox,
} from './geometry'
import { discCentres, footprintOf, footprintsOverlap, type Footprint } from './footprint'
import type { GameState, MapDef, Polygon, Rejection, Vec2, Vec3 } from './types'

export interface Solid {
  partId: string
  featureId: string
  polygon: Polygon
  bbox: BBox
  bottom: number
  top: number
  heavy: boolean
  light: boolean
  blocking: boolean
  vantage: boolean
  accessible: boolean
  insignificant: boolean
  exposed: boolean
  ceiling: boolean
  barred: boolean
  crTransparent: boolean
  /** M2b-game: wall thickness (Breach), part tags ('obstructing', 'protective'), and the equipment feature data */
  thickness: number | null
  tags: string[]
  equipmentId: string | null
  /** ladders: the part id the ladder leans on */
  leansOn: string | null
  /** surface heights an operative can pass over (the top plus Vantage floors) */
  walkable: number[]
  /** surface heights an operative may finish a move on */
  floors: number[]
}

export interface TerrainIndex {
  solids: Solid[]
  byPart: Map<string, Solid>
  halfX: number
  halfZ: number
}

const cache = new WeakMap<MapDef, TerrainIndex>()

export function terrainOf(map: MapDef): TerrainIndex {
  const hit = cache.get(map)
  if (hit) return hit
  const solids: Solid[] = []
  for (const feature of map.features) {
    for (const part of feature.parts) {
      const has = (t: string) => (part.traits as string[]).includes(t)
      const vantage = has('vantage')
      const ceiling = has('ceiling')
      const extra = part.vantageFloors ?? []
      solids.push({
        partId: part.id,
        featureId: feature.id,
        polygon: part.footprint,
        bbox: polygonBBox(part.footprint),
        bottom: part.bottom ?? (ceiling ? Math.max(0, part.height - 0.25) : 0),
        top: part.height,
        heavy: has('heavy'),
        light: has('light') || vantage,
        blocking: has('blocking'),
        vantage,
        accessible: has('accessible'),
        insignificant: has('insignificant'),
        exposed: has('exposed'),
        ceiling,
        barred: has('barred'),
        crTransparent: part.crTransparent === true,
        thickness: part.thickness ?? null,
        tags: part.tags ?? [],
        equipmentId: feature.equipmentId ?? null,
        leansOn: feature.leansOn ?? null,
        walkable: [part.height, ...extra],
        floors: [...(vantage ? [part.height] : []), ...extra],
      })
    }
  }
  const idx: TerrainIndex = {
    solids,
    byPart: new Map(solids.map((s) => [s.partId, s])),
    halfX: map.size.x / 2,
    halfZ: map.size.z / 2,
  }
  cache.set(map, idx)
  return idx
}

const Y_TOL = 0.01

export function sameLevel(a: number, b: number): boolean {
  return Math.abs(a - b) < Y_TOL
}

/** A solid with a walkable surface at height y under point p (y > 0). */
export function walkableSolidAt(idx: TerrainIndex, p: Vec2, y: number): Solid | null {
  for (const s of idx.solids) {
    if (!s.walkable.some((w) => sameLevel(w, y))) continue
    if (pointInPolygon(p, s.polygon)) return s
  }
  return null
}

/** The solid whose placeable surface at height y fully supports the disc. */
export function placeableSolid(idx: TerrainIndex, c: Vec2, r: number, y: number): Solid | null {
  for (const s of idx.solids) {
    if (!s.floors.some((f) => sameLevel(f, y))) continue
    if (circleInsidePolygon(c, r, s.polygon)) return s
  }
  return null
}

/** The part a body standing at pos is on (null on the killzone floor). */
export function standingSolid(idx: TerrainIndex, pos: Vec3): Solid | null {
  if (pos.y < Y_TOL) return null
  return walkableSolidAt(idx, pos, pos.y)
}

/** Round bases of 50mm or less pass under Ceiling terrain (R-11.9). */
export function isSmallBase(radius: number): boolean {
  return radius * 2 * 25.4 <= 50.5
}

/** Would solid s block a body whose base is at height y, radius r, miniature height h? */
export function obstructs(s: Solid, y: number, r: number, h: number): boolean {
  if (s.top <= y + Y_TOL) return false
  if (s.insignificant && !s.vantage) return false
  if (s.bottom >= y + h && !(s.ceiling && !isSmallBase(r))) return false
  return true
}

/** First solid that blocks a disc at this level, skipping the named parts. */
export function discBlockedBy(
  idx: TerrainIndex,
  c: Vec2,
  y: number,
  r: number,
  h: number,
  skip?: ReadonlySet<string>,
): Solid | null {
  for (const s of idx.solids) {
    if (skip?.has(s.partId)) continue
    if (c.x + r < s.bbox.minX || c.x - r > s.bbox.maxX || c.z + r < s.bbox.minZ || c.z - r > s.bbox.maxZ) continue
    if (!obstructs(s, y, r, h)) continue
    if (circleOverlapsPolygon(c, r, s.polygon)) return s
  }
  return null
}

export function insideKillzone(idx: TerrainIndex, c: Vec2, r: number): boolean {
  return Math.abs(c.x) + r <= idx.halfX + EPS && Math.abs(c.z) + r <= idx.halfZ + EPS
}

export interface PlacementSpec {
  id: string
  pos: Vec3
  radius: number
  height: number
  /** M9 batch B: oval bases (footprint.ts), the centre-to-end-disc vector */
  axis?: Vec2
}

/**
 * Can this base be finished on? Checks the killzone edge, terrain support and collision, and other
 * bases (R-8.1, R-11.5). Returns null when the spot is placeable.
 */
export function placementProblem(state: GameState, spec: PlacementSpec): Rejection | null {
  const idx = terrainOf(state.map)
  const fp: Footprint = spec.axis ? { pos: spec.pos, baseRadius: spec.radius, axis: spec.axis } : { pos: spec.pos, baseRadius: spec.radius }
  const discs = discCentres(fp)
  if (!discs.every((c) => insideKillzone(idx, c, spec.radius))) {
    return { code: 'E_OUT_OF_RANGE', reason: 'base would cross the killzone edge' }
  }
  if (spec.pos.y > Y_TOL) {
    if (!discs.every((c) => placeableSolid(idx, c, spec.radius, spec.pos.y))) {
      return { code: 'E_NO_PATH', reason: 'no Vantage surface at that height supports the base' }
    }
  }
  for (const c of discs) {
    const blocker = discBlockedBy(idx, c, spec.pos.y, spec.radius, spec.height)
    if (blocker) return { code: 'E_OVERLAP', reason: 'base overlaps terrain', details: { part: blocker.partId } }
  }
  for (const o of Object.values(state.operatives)) {
    if (o.status !== 'active' || o.id === spec.id) continue
    if (Math.abs(o.pos.y - spec.pos.y) >= 0.5) continue
    if (footprintsOverlap(fp, footprintOf(o))) {
      return { code: 'E_OVERLAP', reason: `base overlaps ${o.id}`, details: { operative: o.id } }
    }
  }
  return null
}

export function horizontalDistToSolid(p: Vec2, s: Solid): number {
  return distToPolygon(p, s.polygon)
}
