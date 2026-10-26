// GLB terrain support (docs/spec/30-figures.md section 5): the `terrain` manifest section, the piece placement from
// the killzone layout data (model slug, pos, yaw), the fit of a finalised GLB onto the piece's rules footprint, and
// the see-through heuristic (Mallet's ruin transparency). Pure helpers are exported for tests/client/terrain.test.ts.
// Terrain GLB contract (tools/models/finalize-terrain.py): long axis X, front +Z, origin at the footprint centre on
// the ground (y = 0), already scaled to footprint.w x footprint.d x heightIn inches.
import { useEffect, useMemo, useState } from 'react'
import { Mesh, type Camera, type Material, type Object3D } from 'three'
import k1 from '@/data/killzones/volkus-01.json'
import k2 from '@/data/killzones/volkus-02.json'
import k3 from '@/data/killzones/volkus-03.json'
import { useGlbInstance } from '../figures/glbLoader'

export interface TerrainEntry {
  file: string
  footprint: { w: number; d: number }
  heightIn: number
  origin: 'centre-ground'
}

export interface PieceMeta {
  model: string
  pos: { x: number; z: number }
  /** degrees about +Y (three.js rotation.y = yaw * PI / 180) */
  yaw: number
}

interface LayoutPiece extends PieceMeta {
  id: string
  parts: { id: string; footprint: { x: number; z: number }[]; height: number }[]
}
interface LayoutFile {
  id: string
  pieces: LayoutPiece[]
}

export const LAYOUT_FILES: readonly LayoutFile[] = [k1, k2, k3] as unknown as LayoutFile[]

/** Placement of a layout piece: the engine's MapDef features carry the piece id and model slug but not pos/yaw. */
export function pieceMeta(mapId: string, pieceId: string): PieceMeta | null {
  const layout = LAYOUT_FILES.find((l) => l.id === mapId)
  const p = layout?.pieces.find((q) => q.id === pieceId)
  return p ? { model: p.model, pos: p.pos, yaw: p.yaw } : null
}

/** World point -> piece-local frame (inverse of rotation.y = yaw). */
export function toLocal(pt: { x: number; z: number }, pos: { x: number; z: number }, yawDeg: number): { x: number; z: number } {
  const y = (yawDeg * Math.PI) / 180
  const dx = pt.x - pos.x
  const dz = pt.z - pos.z
  return { x: dx * Math.cos(y) - dz * Math.sin(y), z: dx * Math.sin(y) + dz * Math.cos(y) }
}

/** Rules footprint of a piece in its local frame: bbox of the union of its parts, centre offset from pos, tallest part. */
export function pieceFootprint(piece: { pos: { x: number; z: number }; yaw: number; parts: { footprint: { x: number; z: number }[]; height: number }[] }): { w: number; d: number; h: number; cx: number; cz: number } {
  const pts = piece.parts.flatMap((p) => p.footprint.map((q) => toLocal(q, piece.pos, piece.yaw)))
  const xs = pts.map((p) => p.x)
  const zs = pts.map((p) => p.z)
  const r = (n: number) => Math.round(n * 100) / 100
  return {
    w: r(Math.max(...xs) - Math.min(...xs)),
    d: r(Math.max(...zs) - Math.min(...zs)),
    h: Math.max(...piece.parts.map((p) => p.height)),
    cx: r((Math.max(...xs) + Math.min(...xs)) / 2),
    cz: r((Math.max(...zs) + Math.min(...zs)) / 2),
  }
}

/** Scale that fits a finalised GLB onto a piece's rules footprint (1,1,1 when the manifest already matches). */
export function fitScale(entry: TerrainEntry, fp: { w: number; d: number; h: number }): [number, number, number] {
  return [fp.w / entry.footprint.w, fp.h / entry.heightIn, fp.d / entry.footprint.d]
}

// ------------------------------------------------------------------ manifest (terrain section), fetched once
let terrainManifest: Record<string, TerrainEntry> = {}
let manifestRequest: Promise<void> | null = null
const manifestListeners = new Set<() => void>()

function requestManifest(): void {
  manifestRequest ??= fetch(`${import.meta.env.BASE_URL}assets/models/manifest.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { terrain?: Record<string, TerrainEntry> } | null) => {
      terrainManifest = j?.terrain ?? {}
    })
    .catch(() => {
      terrainManifest = {}
    })
    .finally(() => manifestListeners.forEach((l) => l()))
}

export function useTerrainManifest(): Record<string, TerrainEntry> {
  const [, setTick] = useState(0)
  useEffect(() => {
    const l = () => setTick((n) => n + 1)
    manifestListeners.add(l)
    requestManifest()
    return () => {
      manifestListeners.delete(l)
    }
  }, [])
  return terrainManifest
}

/** A private node tree of the slug's terrain GLB with its own material clones (so the piece can fade alone), or null. */
export function useTerrainGlb(slug: string | undefined, entry: TerrainEntry | undefined): Object3D | null {
  const inst = useGlbInstance(entry && slug ? `terrain/${slug}` : undefined)
  return useMemo(() => {
    if (!inst) return null
    inst.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      m.castShadow = true
      m.receiveShadow = true
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : (m.material as Material).clone()
    })
    return inst
  }, [inst])
}

// ------------------------------------------------------------------ see-through fade
export const FADE_OPACITY = 0.35

/** Set the opacity of every material under `root` (a transparent flip rebuilds the shader once). */
export function setOpacity(root: Object3D, opacity: number): void {
  const solid = opacity >= 0.999
  root.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      if (mat.transparent === !solid && mat.opacity === opacity) continue
      if (mat.transparent === solid) mat.needsUpdate = true
      mat.transparent = !solid
      mat.opacity = opacity
      mat.depthWrite = solid
    }
  })
}

export interface Box3like {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  bottom: number
  top: number
}

/** Does the segment a -> b (t in [0, tMax]) cross the axis-aligned box? Slab test. */
export function segmentHitsBox(a: [number, number, number], b: [number, number, number], box: Box3like, tMax = 1): boolean {
  let t0 = 0
  let t1 = tMax
  const lo = [box.minX, box.bottom, box.minZ]
  const hi = [box.maxX, box.top, box.maxZ]
  for (let i = 0; i < 3; i++) {
    const d = b[i]! - a[i]!
    if (Math.abs(d) < 1e-9) {
      if (a[i]! < lo[i]! || a[i]! > hi[i]!) return false
      continue
    }
    let ta = (lo[i]! - a[i]!) / d
    let tb = (hi[i]! - a[i]!) / d
    if (ta > tb) [ta, tb] = [tb, ta]
    t0 = Math.max(t0, ta)
    t1 = Math.min(t1, tb)
    if (t0 > t1) return false
  }
  return true
}

/** True when the line from the camera to a target is blocked by one of the piece's part boxes. Parts the target
 *  stands on (xz inside, feet at or above the top) never block. */
export function pieceOccludes(cam: Camera['position'], target: { x: number; y: number; z: number; feetY: number }, boxes: Box3like[]): boolean {
  const a: [number, number, number] = [cam.x, cam.y, cam.z]
  const b: [number, number, number] = [target.x, target.y, target.z]
  for (const bx of boxes) {
    const inside = target.x >= bx.minX && target.x <= bx.maxX && target.z >= bx.minZ && target.z <= bx.maxZ
    if (inside && target.feetY >= bx.top - 0.1) continue
    const shrunk = { ...bx, minX: bx.minX + 0.02, maxX: bx.maxX - 0.02, minZ: bx.minZ + 0.02, maxZ: bx.maxZ - 0.02 }
    if (segmentHitsBox(a, b, shrunk, 0.97)) return true
  }
  return false
}
