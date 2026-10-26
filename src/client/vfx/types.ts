// Shared constants for the weapon effects engine: particle layers, atlas frames, pool caps and the writer
// interface the renderer implements. Pure data (no three.js, no DOM), so the engine runs in node tests.

/** Particle layers. Each has its own pool and its own instanced draw call. */
export const L = { ADD: 0, NORM: 1, FLAT_ADD: 2, FLAT_NORM: 3, SPARK: 4 } as const
export type LayerId = (typeof L)[keyof typeof L]

/** Frames of the procedural atlas (4 x 4 cells, see atlas.ts). */
export const F = {
  GLOW: 0,
  CORE: 1,
  STAR: 2,
  SMOKE: 3,
  RING: 4,
  SPARK: 5,
  FLAME: 6,
  SLASH: 7,
  BASH: 8,
  DEBRIS: 9,
  SCORCH: 10,
  HEX: 11,
  BEAM: 12,
  EDGE: 13,
  DROP: 14,
  BLADE: 15,
} as const

/** Hard caps of every pool. The stress test in tests/client/vfx.test.ts proves nothing ever exceeds them. */
export const CAPS = {
  add: 460,
  norm: 300,
  flatAdd: 28,
  flatNorm: 48,
  spark: 280,
  beamAdd: 220,
  beamNorm: 64,
  projectiles: 40,
  sweeps: 12,
  jets: 6,
  status: 24,
  lights: 3,
  shakes: 6,
  /** extra instances the renderer reserves per batch for the dynamic entities (projectile heads, sweeps, jets) */
  dynBill: 140,
  dynBeam: 220,
} as const

export type RGB = readonly [number, number, number]

const cache = new Map<string, RGB>()
/** '#rrggbb' -> raw sRGB 0..1 (the shaders write straight to the sRGB canvas, so no colour-space conversion). */
export function hex(c: string): RGB {
  let v = cache.get(c)
  if (!v) {
    const n = parseInt(c.slice(1), 16)
    v = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
    cache.set(c, v)
  }
  return v
}

/** What the renderer (or a counting test sink) receives each frame. */
export interface FxWriter {
  /** billboard (layers ADD, NORM) or ground quad (FLAT_ADD, FLAT_NORM) */
  bill(layer: 0 | 1 | 2 | 3, x: number, y: number, z: number, size: number, rot: number, alpha: number, frame: number, r: number, g: number, b: number): void
  /** ribbon from p0 (width w0, alpha a0) to p1 (w1, a1) */
  beam(norm: boolean, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w0: number, w1: number, a0: number, a1: number, frame: number, r: number, g: number, b: number): void
}

export type P3 = [number, number, number]
