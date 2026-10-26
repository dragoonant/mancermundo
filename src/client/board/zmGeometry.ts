// Pure geometry helpers behind ZmBoard (no canvas, no React, so they run under vitest in node): the merged bulkhead mesh
// of a compiled board, flat polygon overlays, and door placement. Board space: x east, z south on screen, y up, inches.
import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { BoardDef, Polygon, Vec2 } from '@/engine/types'

/** wall height in inches (the spec's ~3") */
export const WALL_HEIGHT = 3
/** inches of wall one wall-texture tile covers along its length */
export const WALL_TILE_W = 3
/** height of the lighter lip drawn on top of a wall (it sits inside WALL_HEIGHT, so nothing sticks out of the outline) */
export const CAP_LIP = 0.12

function area(poly: Polygon): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    s += a.x * b.z - b.x * a.z
  }
  return s / 2
}

/**
 * One merged mesh for every wall rectangle: `sides` carries the vertical faces (UV in wall-tile units: u along the wall,
 * v up it) and `caps` the horizontal top faces. Faces are wound counter-clockwise seen from outside whichever way the
 * polygon is wound.
 */
export function buildWallGeometry(def: Pick<BoardDef, 'walls'>, height = WALL_HEIGHT): { sides: BufferGeometry; caps: BufferGeometry } {
  const sp: number[] = []
  const sn: number[] = []
  const su: number[] = []
  const cp: number[] = []
  const cn: number[] = []
  const cu: number[] = []
  for (const w of def.walls) {
    const poly = w.poly
    const outwardSign = area(poly) >= 0 ? 1 : -1
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!
      const b = poly[(i + 1) % poly.length]!
      const ex = b.x - a.x
      const ez = b.z - a.z
      const len = Math.hypot(ex, ez)
      if (len < 1e-6) continue
      // outward normal of a counter-clockwise (x right, z up) polygon edge is (ez, -ex)
      const nx = (outwardSign * ez) / len
      const nz = (-outwardSign * ex) / len
      // geometric normal of (a0, b0, b1) is (-ez, 0, ex): keep that order when it agrees with the outward normal
      const same = -ez * nx + ex * nz > 0
      const u0 = 0
      const u1 = len / WALL_TILE_W
      // offset u by the wall's start so adjacent walls do not all show the same seam position
      const off = (Math.abs(a.x) + Math.abs(a.z)) / WALL_TILE_W
      const quad: [number, number, number, number, number][] = [
        [a.x, 0, a.z, u0 + off, 0],
        [b.x, 0, b.z, u1 + off, 0],
        [b.x, height, b.z, u1 + off, 1],
        [a.x, height, a.z, u0 + off, 1],
      ]
      const order = same ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]
      for (const k of order) {
        const q = quad[k]!
        sp.push(q[0], q[1], q[2])
        sn.push(nx, 0, nz)
        su.push(q[3], q[4])
      }
    }
    // top cap: fan from the first corner (rectangles, convex), facing up
    const flip = outwardSign > 0 // counter-clockwise in (x, z) looks clockwise from above (+y), so reverse for up-facing
    for (let i = 1; i + 1 < poly.length; i++) {
      const tri = flip ? [0, i + 1, i] : [0, i, i + 1]
      for (const k of tri) {
        const p = poly[k]!
        cp.push(p.x, height, p.z)
        cn.push(0, 1, 0)
        cu.push(p.x / WALL_TILE_W, p.z / WALL_TILE_W)
      }
    }
  }
  const make = (p: number[], n: number[], u: number[]): BufferGeometry => {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(p, 3))
    g.setAttribute('normal', new Float32BufferAttribute(n, 3))
    g.setAttribute('uv', new Float32BufferAttribute(u, 2))
    g.computeBoundingBox()
    g.computeBoundingSphere()
    return g
  }
  return { sides: make(sp, sn, su), caps: make(cp, cn, cu) }
}

/** A flat, up-facing polygon (convex, fan-triangulated) at height `y`. */
export function flatPolygonGeometry(poly: Polygon, y: number): BufferGeometry {
  const p: number[] = []
  const flip = area(poly) > 0
  for (let i = 1; i + 1 < poly.length; i++) {
    const tri = flip ? [0, i + 1, i] : [0, i, i + 1]
    for (const k of tri) p.push(poly[k]!.x, y, poly[k]!.z)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(p, 3))
  g.computeVertexNormals()
  return g
}

export interface DoorFrame {
  /** centre of the doorway on the floor */
  centre: Vec2
  /** gap width along the wall */
  length: number
  thickness: number
  /** rotation about +y that turns a box's local x onto the door's long axis */
  yaw: number
}

export function doorFrame(door: BoardDef['doors'][number]): DoorFrame {
  const { a, b } = door.seg
  const dx = b.x - a.x
  const dz = b.z - a.z
  const length = Math.hypot(dx, dz)
  // door polygon is the rectangle along the segment: its short side is the thickness
  const xs = door.poly.map((p) => p.x)
  const zs = door.poly.map((p) => p.z)
  const bw = Math.max(...xs) - Math.min(...xs)
  const bd = Math.max(...zs) - Math.min(...zs)
  const thickness = Math.abs(dx) >= Math.abs(dz) ? bd : bw
  return { centre: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, length, thickness, yaw: Math.atan2(-dz, dx) }
}

export function polygonCentroid(poly: Polygon): Vec2 {
  let x = 0
  let z = 0
  for (const p of poly) {
    x += p.x
    z += p.z
  }
  return { x: x / poly.length, z: z / poly.length }
}

export function polygonBox(poly: Polygon): { minX: number; maxX: number; minZ: number; maxZ: number; w: number; d: number; cx: number; cz: number } {
  const xs = poly.map((p) => p.x)
  const zs = poly.map((p) => p.z)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  return { minX, maxX, minZ, maxZ, w: maxX - minX, d: maxZ - minZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }
}

// ---------------------------------------------------------------------------------------------------------------------
// Door look

interface DoorRecordLike {
  state: 'closed' | 'open' | 'destroyed'
  locked: boolean
}

/** Door panel colour by state (closed, locked, open, destroyed). */
export const DOOR_COLORS = { closed: '#e0a52e', locked: '#e0392f', open: '#3fc46b', destroyed: '#3a3430' } as const
export type DoorLook = keyof typeof DOOR_COLORS

export function doorLook(rec: DoorRecordLike | undefined): DoorLook {
  if (!rec) return 'closed'
  if (rec.state === 'destroyed') return 'destroyed'
  if (rec.state === 'open') return 'open'
  return rec.locked ? 'locked' : 'closed'
}

