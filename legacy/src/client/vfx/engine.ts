// The weapon effects engine: struct-of-array particle pools (no per-frame allocation), ribbon pools, and a few
// pooled dynamic entities (projectiles, melee sweeps, flame jets, burning / injured status emitters, lights, camera
// shakes). Everything is pre-scheduled with a future birth time, so a whole volley is described the moment it fires.
// Pure TypeScript (no three.js, no DOM): the renderer in renderer.ts copies what `draw` emits into instanced
// buffers, and tests/client/vfx.test.ts drives it with a synthetic clock. Units: inches, seconds, y up.
import { CAPS, F, L, hex, type FxWriter, type LayerId, type P3 } from './types'

// ---------------------------------------------------------------- helpers

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const easeOut = (u: number): number => 1 - (1 - u) * (1 - u)

/** Mutable description of one particle; `FxEngine.begin` hands out the single shared instance, `commit` copies it into a pool. */
export class PSpec {
  layer: LayerId = L.ADD
  frame = 0
  x = 0
  y = 0
  z = 0
  vx = 0
  vy = 0
  vz = 0
  born = 0
  life = 1
  s0 = 1
  s1 = 1
  a0 = 1
  a1 = 0
  r0 = 1
  g0 = 1
  b0 = 1
  r1 = 1
  g1 = 1
  b1 = 1
  rot = 0
  spin = 0
  drag = 0
  grav = 0
  hold = 0
  atk = 0.06
  /** Colour at start and end from one hex pair. */
  col(a: string, b: string = a): this {
    const c0 = hex(a)
    const c1 = hex(b)
    this.r0 = c0[0]
    this.g0 = c0[1]
    this.b0 = c0[2]
    this.r1 = c1[0]
    this.g1 = c1[1]
    this.b1 = c1[2]
    return this
  }
  at(x: number, y: number, z: number): this {
    this.x = x
    this.y = y
    this.z = z
    return this
  }
  vel(x: number, y: number, z: number): this {
    this.vx = x
    this.vy = y
    this.vz = z
    return this
  }
}

class PStore {
  n = 0
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  readonly vx: Float32Array
  readonly vy: Float32Array
  readonly vz: Float32Array
  readonly born: Float64Array
  readonly life: Float32Array
  readonly s0: Float32Array
  readonly s1: Float32Array
  readonly a0: Float32Array
  readonly a1: Float32Array
  readonly r0: Float32Array
  readonly g0: Float32Array
  readonly b0: Float32Array
  readonly r1: Float32Array
  readonly g1: Float32Array
  readonly b1: Float32Array
  readonly rot: Float32Array
  readonly spin: Float32Array
  readonly drag: Float32Array
  readonly grav: Float32Array
  readonly hold: Float32Array
  readonly atk: Float32Array
  readonly frame: Uint8Array
  peak = 0
  dropped = 0

  constructor(readonly cap: number) {
    const f = () => new Float32Array(cap)
    this.x = f()
    this.y = f()
    this.z = f()
    this.vx = f()
    this.vy = f()
    this.vz = f()
    this.born = new Float64Array(cap)
    this.life = f()
    this.s0 = f()
    this.s1 = f()
    this.a0 = f()
    this.a1 = f()
    this.r0 = f()
    this.g0 = f()
    this.b0 = f()
    this.r1 = f()
    this.g1 = f()
    this.b1 = f()
    this.rot = f()
    this.spin = f()
    this.drag = f()
    this.grav = f()
    this.hold = f()
    this.atk = f()
    this.frame = new Uint8Array(cap)
  }

  add(s: PSpec): boolean {
    if (this.n >= this.cap) {
      this.dropped++
      return false
    }
    const i = this.n++
    this.x[i] = s.x
    this.y[i] = s.y
    this.z[i] = s.z
    this.vx[i] = s.vx
    this.vy[i] = s.vy
    this.vz[i] = s.vz
    this.born[i] = s.born
    this.life[i] = s.life
    this.s0[i] = s.s0
    this.s1[i] = s.s1
    this.a0[i] = s.a0
    this.a1[i] = s.a1
    this.r0[i] = s.r0
    this.g0[i] = s.g0
    this.b0[i] = s.b0
    this.r1[i] = s.r1
    this.g1[i] = s.g1
    this.b1[i] = s.b1
    this.rot[i] = s.rot
    this.spin[i] = s.spin
    this.drag[i] = s.drag
    this.grav[i] = s.grav
    this.hold[i] = s.hold
    this.atk[i] = s.atk
    this.frame[i] = s.frame
    if (this.n > this.peak) this.peak = this.n
    return true
  }

  private move(from: number, to: number): void {
    this.x[to] = this.x[from]!
    this.y[to] = this.y[from]!
    this.z[to] = this.z[from]!
    this.vx[to] = this.vx[from]!
    this.vy[to] = this.vy[from]!
    this.vz[to] = this.vz[from]!
    this.born[to] = this.born[from]!
    this.life[to] = this.life[from]!
    this.s0[to] = this.s0[from]!
    this.s1[to] = this.s1[from]!
    this.a0[to] = this.a0[from]!
    this.a1[to] = this.a1[from]!
    this.r0[to] = this.r0[from]!
    this.g0[to] = this.g0[from]!
    this.b0[to] = this.b0[from]!
    this.r1[to] = this.r1[from]!
    this.g1[to] = this.g1[from]!
    this.b1[to] = this.b1[from]!
    this.rot[to] = this.rot[from]!
    this.spin[to] = this.spin[from]!
    this.drag[to] = this.drag[from]!
    this.grav[to] = this.grav[from]!
    this.hold[to] = this.hold[from]!
    this.atk[to] = this.atk[from]!
    this.frame[to] = this.frame[from]!
  }

  update(now: number, dt: number): void {
    let i = 0
    while (i < this.n) {
      const age = now - this.born[i]!
      if (age < 0) {
        i++
        continue
      }
      if (age >= this.life[i]!) {
        this.n--
        if (i !== this.n) this.move(this.n, i)
        continue
      }
      const d = dt < age ? dt : age
      if (d > 0) {
        const dr = this.drag[i]!
        if (dr > 0) {
          const k = Math.exp(-dr * d)
          this.vx[i] = this.vx[i]! * k
          this.vy[i] = this.vy[i]! * k
          this.vz[i] = this.vz[i]! * k
        }
        this.vy[i] = this.vy[i]! - this.grav[i]! * d
        this.x[i] = this.x[i]! + this.vx[i]! * d
        this.y[i] = this.y[i]! + this.vy[i]! * d
        this.z[i] = this.z[i]! + this.vz[i]! * d
        this.rot[i] = this.rot[i]! + this.spin[i]! * d
      }
      i++
    }
  }

  clear(): void {
    this.n = 0
  }

  /** Alpha / size at age fraction u. */
  alpha(i: number, u: number): number {
    const h = this.hold[i]!
    let a = u < h ? this.a0[i]! : this.a0[i]! + (this.a1[i]! - this.a0[i]!) * ((u - h) / (1 - h))
    const k = this.atk[i]!
    if (k > 0 && u < k) a *= u / k
    return a
  }

  drawBill(w: FxWriter, layer: 0 | 1 | 2 | 3, now: number): void {
    for (let i = 0; i < this.n; i++) {
      const age = now - this.born[i]!
      if (age < 0) continue
      const u = age / this.life[i]!
      if (u >= 1) continue
      const a = this.alpha(i, u)
      if (a <= 0.003) continue
      const s = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * easeOut(u)
      w.bill(
        layer,
        this.x[i]!,
        this.y[i]!,
        this.z[i]!,
        s,
        this.rot[i]!,
        a,
        this.frame[i]!,
        this.r0[i]! + (this.r1[i]! - this.r0[i]!) * u,
        this.g0[i]! + (this.g1[i]! - this.g0[i]!) * u,
        this.b0[i]! + (this.b1[i]! - this.b0[i]!) * u,
      )
    }
  }

  /** Sparks: a streak from the particle back along its velocity. */
  drawSpark(w: FxWriter, now: number): void {
    for (let i = 0; i < this.n; i++) {
      const age = now - this.born[i]!
      if (age < 0) continue
      const u = age / this.life[i]!
      if (u >= 1) continue
      const a = this.alpha(i, u)
      if (a <= 0.003) continue
      const k = 0.045
      const x = this.x[i]!
      const y = this.y[i]!
      const z = this.z[i]!
      const s = this.s0[i]! + (this.s1[i]! - this.s0[i]!) * u
      w.beam(
        false,
        x,
        y,
        z,
        x - this.vx[i]! * k,
        y - this.vy[i]! * k,
        z - this.vz[i]! * k,
        s,
        s * 0.25,
        a,
        0,
        F.BEAM,
        this.r0[i]! + (this.r1[i]! - this.r0[i]!) * u,
        this.g0[i]! + (this.g1[i]! - this.g0[i]!) * u,
        this.b0[i]! + (this.b1[i]! - this.b0[i]!) * u,
      )
    }
  }
}

/** Ribbons with a fixed position (vapour trails, lightning, slash afterglow, cables). */
class BStore {
  n = 0
  peak = 0
  dropped = 0
  readonly p: Float32Array
  readonly born: Float64Array
  readonly life: Float32Array
  readonly w: Float32Array
  readonly a: Float32Array
  readonly c: Float32Array
  readonly hold: Float32Array
  readonly grow: Float32Array
  readonly frame: Uint8Array
  constructor(readonly cap: number) {
    this.p = new Float32Array(cap * 6)
    this.born = new Float64Array(cap)
    this.life = new Float32Array(cap)
    this.w = new Float32Array(cap * 2)
    this.a = new Float32Array(cap * 2)
    this.c = new Float32Array(cap * 3)
    this.hold = new Float32Array(cap)
    this.grow = new Float32Array(cap)
    this.frame = new Uint8Array(cap)
  }
  add(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w0: number, w1: number, a0: number, a1: number, frame: number, rgb: readonly [number, number, number], born: number, life: number, hold: number, grow: number): boolean {
    if (this.n >= this.cap) {
      this.dropped++
      return false
    }
    const i = this.n++
    const o = i * 6
    this.p[o] = x0
    this.p[o + 1] = y0
    this.p[o + 2] = z0
    this.p[o + 3] = x1
    this.p[o + 4] = y1
    this.p[o + 5] = z1
    this.w[i * 2] = w0
    this.w[i * 2 + 1] = w1
    this.a[i * 2] = a0
    this.a[i * 2 + 1] = a1
    this.c[i * 3] = rgb[0]
    this.c[i * 3 + 1] = rgb[1]
    this.c[i * 3 + 2] = rgb[2]
    this.born[i] = born
    this.life[i] = life
    this.hold[i] = hold
    this.grow[i] = grow
    this.frame[i] = frame
    if (this.n > this.peak) this.peak = this.n
    return true
  }
  update(now: number): void {
    let i = 0
    while (i < this.n) {
      if (now - this.born[i]! >= this.life[i]!) {
        this.n--
        const l = this.n
        if (i !== l) {
          for (let k = 0; k < 6; k++) this.p[i * 6 + k] = this.p[l * 6 + k]!
          this.w[i * 2] = this.w[l * 2]!
          this.w[i * 2 + 1] = this.w[l * 2 + 1]!
          this.a[i * 2] = this.a[l * 2]!
          this.a[i * 2 + 1] = this.a[l * 2 + 1]!
          for (let k = 0; k < 3; k++) this.c[i * 3 + k] = this.c[l * 3 + k]!
          this.born[i] = this.born[l]!
          this.life[i] = this.life[l]!
          this.hold[i] = this.hold[l]!
          this.grow[i] = this.grow[l]!
          this.frame[i] = this.frame[l]!
        }
        continue
      }
      i++
    }
  }
  draw(w: FxWriter, norm: boolean, now: number): void {
    for (let i = 0; i < this.n; i++) {
      const age = now - this.born[i]!
      if (age < 0) continue
      const u = age / this.life[i]!
      if (u >= 1) continue
      const h = this.hold[i]!
      const f = u < h ? 1 : 1 - (u - h) / (1 - h)
      if (f <= 0.003) continue
      const gw = 1 + this.grow[i]! * u
      const o = i * 6
      w.beam(
        norm,
        this.p[o]!,
        this.p[o + 1]!,
        this.p[o + 2]!,
        this.p[o + 3]!,
        this.p[o + 4]!,
        this.p[o + 5]!,
        this.w[i * 2]! * gw,
        this.w[i * 2 + 1]! * gw,
        this.a[i * 2]! * f,
        this.a[i * 2 + 1]! * f,
        this.frame[i]!,
        this.c[i * 3]!,
        this.c[i * 3 + 1]!,
        this.c[i * 3 + 2]!,
      )
    }
  }
  clear(): void {
    this.n = 0
  }
}

// ---------------------------------------------------------------- dynamic entities

export const PK = { BOLT: 0, SNIPER: 1, PLASMA: 2, ROCKET: 3, GRENADE: 4, STICK: 5, KNIFE: 6, HARPOON: 7 } as const
export type ProjKind = (typeof PK)[keyof typeof PK]

export class Proj {
  active = false
  kind: ProjKind = PK.BOLT
  t0 = 0
  dur = 0.12
  fx = 0
  fy = 0
  fz = 0
  tx = 0
  ty = 0
  tz = 0
  arc = 0
  bend = 0
  /** horizontal unit vector perpendicular to the flight direction */
  sx = 0
  sz = 1
  size = 1
  tail = 1.5
  spin = 0
  seed = 0
  acc = 0
  px = 0
  py = 0
  pz = 0
  started = false
  cr = 1
  cg = 1
  cb = 1
  gr = 1
  gg = 1
  gb = 1
  /** 0 = nothing, 1 = leave a fading streak where the shot ended */
  afterglow = 1
}

export class Sweep {
  active = false
  t0 = 0
  dur = 0.18
  cx = 0
  cy = 0
  cz = 0
  /** plane basis: the arc point at angle a is c + R * (sin a * S + (cos a - lift) * W) */
  sx = 1
  sy = 0
  sz = 0
  wx = 0
  wy = 1
  wz = 0
  R = 1.1
  lift = 0.6
  a0 = -1.7
  a1 = 1.7
  width = 0.22
  tailFrac = 0.55
  cr = 1
  cg = 1
  cb = 1
  gr = 1
  gg = 1
  gb = 1
  sparks = false
  energy = false
  seed = 0
  sparkAcc = 0
}

export class Jet {
  active = false
  t0 = 0
  dur = 0.5
  mx = 0
  my = 0
  mz = 0
  dx = 0
  dy = 0
  dz = 1
  len = 5
  spread = 0.16
  rate = 110
  acc = 0
  size = 1
  accE = 0
  accS = 0
  /** colour ramp: 0 = orange fire, 1 = pale chemical fire */
  hue = 0
}

export const SK = { BURN: 0, INJURED: 1 } as const
export class Status {
  active = false
  kind: number = SK.BURN
  id: string | null = null
  t0 = 0
  until = 0
  x = 0
  y = 0
  z = 0
  h = 1.2
  acc = 0
  accSmoke = 0
  accEmber = 0
  strength = 1
  lightSlot = -1
}

export class Light {
  active = false
  owner = 0
  x = 0
  y = 0
  z = 0
  r = 1
  g = 0.6
  b = 0.2
  peak = 3
  t0 = 0
  life = 0.4
  flicker = false
  /** persistent lights (burning figures) stay until `release` */
  hold = false
}

class Shake {
  active = false
  t0 = 0
  dur = 0.3
  amp = 0.1
  freq = 38
}

// ---------------------------------------------------------------- engine

export interface EngineOptions {
  /** monotonic milliseconds; defaults to performance.now */
  perf?: () => number
  seed?: number
  /** particle count multiplier (0.4 for the low-graphics path) */
  quality?: number
}

export interface EngineStats {
  add: number
  norm: number
  flatAdd: number
  flatNorm: number
  spark: number
  beamAdd: number
  beamNorm: number
  projectiles: number
  sweeps: number
  jets: number
  status: number
  lights: number
  /** instances emitted by the last draw */
  billboards: number
  beams: number
  peak: Record<string, number>
  dropped: number
}

const MAX_DT = 0.05

export class FxEngine {
  clock = 0
  quality: number
  frozen = false
  /** engine time at which to freeze automatically (screenshots); Infinity when unarmed */
  freezeAt = Infinity
  /** called whenever something is spawned so the host can request a frame */
  onWake: (() => void) | null = null
  /** where an operative currently is (set by the host); falls back to the position given at spawn */
  resolve: ((id: string, out: { x: number; y: number; z: number; h: number }) => boolean) | null = null
  readonly spec = new PSpec()
  readonly rnd: () => number
  private readonly perf: () => number
  private lastReal = 0
  private live = false
  private armFreeze = -1
  private cpuSum = 0
  private cpuFrames = 0
  private cpuPeak = 0
  private drawPeak = 0
  private armProj = -1
  private armExplosion = -1
  private drawBillboards = 0
  private drawBeams = 0

  readonly add = new PStore(CAPS.add)
  readonly norm = new PStore(CAPS.norm)
  readonly flatAdd = new PStore(CAPS.flatAdd)
  readonly flatNorm = new PStore(CAPS.flatNorm)
  readonly spark = new PStore(CAPS.spark)
  readonly beamAdd = new BStore(CAPS.beamAdd)
  readonly beamNorm = new BStore(CAPS.beamNorm)
  readonly projs: Proj[] = Array.from({ length: CAPS.projectiles }, () => new Proj())
  readonly sweeps: Sweep[] = Array.from({ length: CAPS.sweeps }, () => new Sweep())
  readonly jets: Jet[] = Array.from({ length: CAPS.jets }, () => new Jet())
  readonly statuses: Status[] = Array.from({ length: CAPS.status }, () => new Status())
  readonly lights: Light[] = Array.from({ length: CAPS.lights }, () => new Light())
  private readonly shakes: Shake[] = Array.from({ length: CAPS.shakes }, () => new Shake())
  private readonly tmp = { x: 0, y: 0, z: 0, h: 0 }
  private readonly stores: PStore[]
  private projDropped = 0

  constructor(opts: EngineOptions = {}) {
    this.perf = opts.perf ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
    this.rnd = mulberry32(opts.seed ?? 0x5eed)
    this.quality = opts.quality ?? 1
    this.stores = [this.add, this.norm, this.flatAdd, this.flatNorm, this.spark]
  }

  // ------------------------------------------------------------ random + counts
  rr(a: number, b: number): number {
    return a + (b - a) * this.rnd()
  }
  sgn(): number {
    return this.rnd() < 0.5 ? -1 : 1
  }
  /** A particle count scaled by the quality setting (stochastic rounding, so 0.4 x 1 is sometimes 1). */
  n(count: number): number {
    const v = count * this.quality
    const f = Math.floor(v)
    return f + (this.rnd() < v - f ? 1 : 0)
  }

  // ------------------------------------------------------------ time
  /** Engine time "now" including the part of the frame that has not been simulated yet. */
  t(): number {
    if (this.frozen || !this.live) return this.clock
    return this.clock + Math.min(MAX_DT, Math.max(0, (this.perf() - this.lastReal) / 1000))
  }

  /** Call before spawning: re-bases the clock when the engine was idle and wakes the host. */
  kick(): void {
    if (!this.live) {
      this.live = true
      this.lastReal = this.perf()
    }
    if (this.armFreeze >= 0) {
      this.freezeAt = this.clock + this.armFreeze
      this.armFreeze = -1
    }
    this.onWake?.()
  }

  /** Freeze `ms` after the next spawn (deterministic mid-effect screenshots). */
  freezeAfterNextSpawn(ms: number): void {
    this.armFreeze = ms / 1000
    this.frozen = false
    this.freezeAt = Infinity
  }
  /** Freeze `ms` after the next explosion starts (the fireball is at its biggest about 0.35 s in). */
  freezeAfterNextExplosion(ms: number): void {
    this.armExplosion = ms / 1000
    this.frozen = false
    this.freezeAt = Infinity
  }
  /** Recipes call this as an explosion is scheduled `delay` seconds from now. */
  noteExplosion(delay: number): void {
    if (this.armExplosion >= 0) {
      this.freezeAt = this.t() + delay + this.armExplosion
      this.armExplosion = -1
    }
  }
  /** Freeze `ms` after the next projectile is launched (a tracer volley is over in a few frames, so e2e arms this up front). */
  freezeAfterNextProjectile(ms: number): void {
    this.armProj = ms / 1000
    this.frozen = false
    this.freezeAt = Infinity
  }
  freeze(): void {
    this.frozen = true
  }
  resume(): void {
    this.frozen = false
    this.freezeAt = Infinity
    this.lastReal = this.perf()
    this.live = true
    this.onWake?.()
  }

  // ------------------------------------------------------------ spawning
  begin(layer: LayerId, frame: number): PSpec {
    const s = this.spec
    s.layer = layer
    s.frame = frame
    s.x = s.y = s.z = 0
    s.vx = s.vy = s.vz = 0
    s.born = this.t()
    s.life = 1
    s.s0 = s.s1 = 1
    s.a0 = 1
    s.a1 = 0
    s.r0 = s.g0 = s.b0 = s.r1 = s.g1 = s.b1 = 1
    s.rot = 0
    s.spin = 0
    s.drag = 0
    s.grav = 0
    s.hold = 0
    s.atk = 0.06
    return s
  }
  commit(): boolean {
    const s = this.spec
    switch (s.layer) {
      case L.ADD:
        return this.add.add(s)
      case L.NORM:
        return this.norm.add(s)
      case L.FLAT_ADD:
        return this.flatAdd.add(s)
      case L.FLAT_NORM:
        return this.flatNorm.add(s)
      default:
        return this.spark.add(s)
    }
  }
  beam(norm: boolean, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w0: number, w1: number, a0: number, a1: number, frame: number, rgb: readonly [number, number, number], delay: number, life: number, hold = 0, grow = 0): boolean {
    return (norm ? this.beamNorm : this.beamAdd).add(x0, y0, z0, x1, y1, z1, w0, w1, a0, a1, frame, rgb, this.t() + delay, life, hold, grow)
  }

  proj(): Proj | null {
    if (this.armProj >= 0) {
      this.freezeAt = this.t() + this.armProj
      this.armProj = -1
    }
    for (const p of this.projs) {
      if (!p.active) {
        p.active = true
        p.started = false
        p.acc = 0
        p.afterglow = 1
        p.spin = 0
        p.arc = 0
        p.bend = 0
        p.size = 1
        p.tail = 1.5
        p.seed = this.rnd() * 1000
        return p
      }
    }
    this.projDropped++
    return null
  }
  sweep(): Sweep | null {
    for (const s of this.sweeps) {
      if (!s.active) {
        s.active = true
        s.sparks = false
        s.energy = false
        s.sparkAcc = 0
        s.seed = this.rnd() * 1000
        return s
      }
    }
    return null
  }
  jet(): Jet | null {
    for (const j of this.jets) {
      if (!j.active) {
        j.active = true
        j.acc = j.accE = j.accS = 0
        j.hue = 0
        return j
      }
    }
    return null
  }

  shake(amp: number, dur: number, delay = 0, freq = 38): void {
    let slot: Shake | null = null
    for (const s of this.shakes) if (!s.active) slot = s
    if (!slot) {
      slot = this.shakes[0]!
      for (const s of this.shakes) if (s.amp * (1 - (this.clock - s.t0) / s.dur) < slot.amp) slot = s
    }
    slot.active = true
    slot.t0 = this.t() + delay
    slot.dur = dur
    slot.amp = amp
    slot.freq = freq
  }

  /** Current camera offset in inches (the host moves the scene by this). Allocation free. */
  shakeOffset(out: P3, now = this.t()): void {
    let x = 0
    let y = 0
    for (const s of this.shakes) {
      if (!s.active) continue
      const age = now - s.t0
      if (age < 0 || age >= s.dur) continue
      const k = 1 - age / s.dur
      const a = s.amp * k * k
      x += Math.sin(age * s.freq) * a
      y += Math.cos(age * s.freq * 1.31 + 1.7) * a * 0.7
    }
    out[0] = x
    out[1] = y
    out[2] = 0
  }

  light(x: number, y: number, z: number, color: string, peak: number, life: number, delay = 0, flicker = false): void {
    if (this.quality < 0.5) return
    const slot = this.freeLight()
    const c = hex(color)
    slot.active = true
    slot.owner = 0
    slot.hold = false
    slot.x = x
    slot.y = y
    slot.z = z
    slot.r = c[0]
    slot.g = c[1]
    slot.b = c[2]
    slot.peak = peak
    slot.t0 = this.t() + delay
    slot.life = life
    slot.flicker = flicker
  }

  private freeLight(): Light {
    let weakest = this.lights[0]!
    let wv = Infinity
    for (const l of this.lights) {
      if (!l.active) return l
      const v = l.hold ? 99 : l.peak * Math.max(0, 1 - (this.clock - l.t0) / l.life)
      if (v < wv) {
        wv = v
        weakest = l
      }
    }
    return weakest
  }

  // ------------------------------------------------------------ status emitters (burning, injured)
  status(id: string, kind: number): Status | null {
    let free: Status | null = null
    for (const s of this.statuses) {
      if (s.active && s.id === id && s.kind === kind) return s
      if (!s.active && !free) free = s
    }
    if (!free) return null
    free.active = true
    free.kind = kind
    free.id = id
    free.acc = free.accSmoke = free.accEmber = 0
    free.strength = 1
    free.lightSlot = -1
    return free
  }
  /** Set an operative on fire for `dur` seconds from `delay` seconds from now. */
  burn(id: string, x: number, y: number, z: number, h: number, dur: number, delay = 0, strength = 1): void {
    const s = this.status(id, SK.BURN)
    if (!s) return
    const t = this.t() + delay
    // a second burn extends the first
    s.t0 = s.until > this.clock ? Math.min(s.t0, t) : t
    s.until = Math.max(s.until > this.clock ? s.until : 0, t + dur)
    s.x = x
    s.y = y
    s.z = z
    s.h = h
    s.strength = Math.max(s.strength, strength)
  }
  injured(id: string, on: boolean, x = 0, y = 0, z = 0, h = 1.2): void {
    if (on) {
      const s = this.status(id, SK.INJURED)
      if (!s) return
      s.t0 = this.t()
      s.until = Infinity
      s.x = x
      s.y = y
      s.z = z
      s.h = h
    } else {
      for (const s of this.statuses) if (s.active && s.kind === SK.INJURED && s.id === id) s.active = false
    }
  }
  isBurning(id: string): boolean {
    for (const s of this.statuses) if (s.active && s.kind === SK.BURN && s.id === id && this.clock >= s.t0 - 0.001 && this.clock < s.until) return true
    return false
  }
  isInjured(id: string): boolean {
    for (const s of this.statuses) if (s.active && s.kind === SK.INJURED && s.id === id) return true
    return false
  }

  // ------------------------------------------------------------ update
  /** Advance to real time `nowMs`. Returns true while anything transient is alive (the host keeps requesting frames). */
  update(nowMs: number = this.perf()): boolean {
    if (!this.live) return false
    let dt = (nowMs - this.lastReal) / 1000
    this.lastReal = nowMs
    if (this.frozen) return false
    if (dt > MAX_DT * 2) dt = MAX_DT * 2
    if (dt < 0) dt = 0
    // sub-step so a hitch does not skip particles' lives
    while (dt > 1e-6) {
      const h = dt > MAX_DT ? MAX_DT : dt
      dt -= h
      if (this.clock + h >= this.freezeAt) {
        this.tick(Math.max(0, this.freezeAt - this.clock))
        this.frozen = true
        this.freezeAt = Infinity
        return false
      }
      this.tick(h)
    }
    return this.alive()
  }

  /** Deterministic stepping for tests and the gallery's pause button. */
  advance(ms: number): void {
    this.live = true
    let left = ms / 1000
    while (left > 1e-9) {
      const h = left > 1 / 60 ? 1 / 60 : left
      left -= h
      this.tick(h)
    }
    this.live = this.alive()
  }

  private tick(dt: number): void {
    this.clock += dt
    const now = this.clock
    for (const s of this.stores) s.update(now, dt)
    this.beamAdd.update(now)
    this.beamNorm.update(now)
    this.tickProjectiles(now, dt)
    this.tickJets(now, dt)
    this.tickSweeps(now, dt)
    this.tickStatus(now, dt)
    this.tickLights(now)
    for (const s of this.shakes) if (s.active && now - s.t0 >= s.dur) s.active = false
    if (!this.alive() && !this.ambient()) this.live = false
  }

  /** True while a transient effect exists. */
  alive(): boolean {
    for (const s of this.stores) if (s.n > 0) return true
    if (this.beamAdd.n > 0 || this.beamNorm.n > 0) return true
    for (const p of this.projs) if (p.active) return true
    for (const s of this.sweeps) if (s.active) return true
    for (const j of this.jets) if (j.active) return true
    for (const l of this.lights) if (l.active) return true
    for (const s of this.shakes) if (s.active) return true
    for (const s of this.statuses) if (s.active && s.kind === SK.BURN) return true
    return false
  }
  /** True when only slow persistent effects (injured drips) remain; the host ticks these at a low rate. */
  ambient(): boolean {
    for (const s of this.statuses) if (s.active && s.kind === SK.INJURED) return true
    return false
  }

  private tickLights(now: number): void {
    for (const l of this.lights) {
      if (l.active && !l.hold && now - l.t0 >= l.life) l.active = false
    }
  }

  // ---- projectiles
  /** Position of a projectile at flight fraction u. */
  projAt(p: Proj, u: number, out: P3): void {
    const k = 4 * u * (1 - u)
    out[0] = p.fx + (p.tx - p.fx) * u + p.sx * p.bend * k
    out[1] = p.fy + (p.ty - p.fy) * u + p.arc * k
    out[2] = p.fz + (p.tz - p.fz) * u + p.sz * p.bend * k
  }
  private readonly pt: P3 = [0, 0, 0]
  private readonly pt2: P3 = [0, 0, 0]

  private tickProjectiles(now: number, dt: number): void {
    for (const p of this.projs) {
      if (!p.active) continue
      const age = now - p.t0
      if (age < 0) continue
      const u = Math.min(1, age / p.dur)
      this.projAt(p, u, this.pt)
      const [x, y, z] = this.pt
      if (!p.started) {
        p.started = true
        p.px = p.fx
        p.py = p.fy
        p.pz = p.fz
      }
      const moved = Math.hypot(x - p.px, y - p.py, z - p.pz)
      p.acc += moved
      this.projTrail(p, x, y, z, moved, dt, age)
      p.px = x
      p.py = y
      p.pz = z
      if (u >= 1) {
        if (p.afterglow) this.afterglow(p)
        p.active = false
      }
    }
  }

  private afterglow(p: Proj): void {
    // the streak a bolt leaves behind for a moment after it lands
    if (p.kind === PK.BOLT || p.kind === PK.SNIPER) {
      const dx = p.tx - p.fx
      const dy = p.ty - p.fy
      const dz = p.tz - p.fz
      const len = Math.hypot(dx, dy, dz) || 1
      const tl = Math.min(p.tail, len)
      const k = tl / len
      this.beam(false, p.tx - dx * k, p.ty - dy * k, p.tz - dz * k, p.tx, p.ty, p.tz, 0.02, 0.1 * p.size, 0, 0.8, F.BEAM, [p.gr, p.gg, p.gb], 0, p.kind === PK.SNIPER ? 0.3 : 0.12)
    }
  }

  private projTrail(p: Proj, x: number, y: number, z: number, moved: number, dt: number, age: number): void {
    switch (p.kind) {
      case PK.PLASMA: {
        // glowing droplets shed along the path
        const step = 0.34
        while (p.acc >= step) {
          p.acc -= step
          if (this.rnd() > this.quality + 0.25) continue
          const s = this.begin(L.ADD, F.GLOW)
          s.at(x - (x - p.px) * this.rnd(), y - (y - p.py) * this.rnd(), z - (z - p.pz) * this.rnd()).vel(this.rr(-0.4, 0.4), this.rr(-0.2, 0.5), this.rr(-0.4, 0.4))
          s.life = this.rr(0.25, 0.4)
          s.s0 = 0.55 * p.size
          s.s1 = 0.1
          s.a0 = 0.55
          s.a1 = 0
          s.col('#7fe8ff', '#2a60ff')
          this.commit()
        }
        break
      }
      case PK.ROCKET: {
        const step = 0.16
        while (p.acc >= step) {
          p.acc -= step
          const s = this.begin(L.NORM, F.SMOKE)
          s.at(x - (x - p.px) * this.rnd(), y - (y - p.py) * this.rnd(), z - (z - p.pz) * this.rnd()).vel(this.rr(-0.25, 0.25), this.rr(0.15, 0.6), this.rr(-0.25, 0.25))
          s.life = this.rr(0.9, 1.4)
          s.s0 = 0.28
          s.s1 = this.rr(0.9, 1.35)
          s.a0 = 0.55
          s.a1 = 0
          s.rot = this.rnd() * 6.28
          s.spin = this.rr(-0.6, 0.6)
          s.col('#d8d2c8', '#6a6a6a')
          s.drag = 0.8
          this.commit()
          const f = this.begin(L.ADD, F.GLOW)
          f.at(x, y, z)
          f.life = 0.22
          f.s0 = 0.75
          f.s1 = 0.1
          f.a0 = 0.75
          f.a1 = 0
          f.col('#ffd070', '#ff4a10')
          this.commit()
        }
        break
      }
      case PK.GRENADE: {
        const step = 0.45
        while (p.acc >= step) {
          p.acc -= step
          const s = this.begin(L.NORM, F.SMOKE)
          s.at(x, y, z).vel(0, 0.15, 0)
          s.life = 0.7
          s.s0 = 0.14
          s.s1 = 0.5
          s.a0 = 0.28
          s.a1 = 0
          s.col('#c9c9c9', '#8a8a8a')
          this.commit()
        }
        break
      }
      case PK.STICK: {
        // lit fuse: a couple of sparks every frame
        const n = this.n(2)
        for (let i = 0; i < n; i++) {
          const s = this.begin(L.SPARK, F.SPARK)
          s.at(x, y + 0.05, z).vel(this.rr(-1.2, 1.2), this.rr(0.4, 2.2), this.rr(-1.2, 1.2))
          s.life = this.rr(0.15, 0.3)
          s.s0 = 0.05
          s.s1 = 0.02
          s.a0 = 1
          s.a1 = 0
          s.grav = 5
          s.col('#fff2a0', '#ff7a1a')
          this.commit()
        }
        break
      }
      case PK.HARPOON: {
        const step = 0.4
        while (p.acc >= step) {
          p.acc -= step
          const s = this.begin(L.ADD, F.GLOW)
          s.at(x, y, z)
          s.life = 0.18
          s.s0 = 0.25
          s.s1 = 0.05
          s.a0 = 0.35
          s.a1 = 0
          s.col('#9fb0c0', '#3a4350')
          this.commit()
        }
        break
      }
      case PK.SNIPER: {
        // thin vapour: slow-fading wisps along the path
        const step = 0.45
        while (p.acc >= step) {
          p.acc -= step
          const s = this.begin(L.ADD, F.SMOKE)
          s.at(x, y, z).vel(this.rr(-0.1, 0.1), this.rr(0.05, 0.2), this.rr(-0.1, 0.1))
          s.life = this.rr(0.7, 1.1)
          s.s0 = 0.16
          s.s1 = 0.55
          s.a0 = 0.16
          s.a1 = 0
          s.rot = this.rnd() * 6.28
          s.col('#cfe8ff', '#8fb4e0')
          this.commit()
        }
        break
      }
      case PK.BOLT: {
        // ragged hot gas puffs only for the slow ones; fast bolts are just the streak
        if (p.dur > 0.2 && this.rnd() < 0.5) {
          const s = this.begin(L.ADD, F.GLOW)
          s.at(x, y, z)
          s.life = 0.2
          s.s0 = 0.3
          s.s1 = 0.05
          s.a0 = 0.35
          s.a1 = 0
          s.col('#ffd070', '#ff7a1a')
          this.commit()
        }
        break
      }
      default:
        break
    }
    void dt
    void age
    void moved
  }

  // ---- flame jets
  private tickJets(now: number, dt: number): void {
    for (const j of this.jets) {
      if (!j.active) continue
      const age = now - j.t0
      if (age < 0) continue
      if (age >= j.dur) {
        j.active = false
        continue
      }
      // the stream builds fast and thins at the end
      const env = age < 0.08 ? age / 0.08 : age > j.dur - 0.12 ? Math.max(0, (j.dur - age) / 0.12) : 1
      j.acc += j.rate * env * dt * this.quality
      j.accE += 26 * env * dt * this.quality
      j.accS += 12 * env * dt * this.quality
      const speed = j.len / 0.3
      // perpendicular axes
      const hx = -j.dz
      const hz = j.dx
      const hl = Math.hypot(hx, hz) || 1
      const px = hx / hl
      const pz = hz / hl
      while (j.acc >= 1) {
        j.acc -= 1
        const r = this.rnd()
        const sp = speed * this.rr(0.75, 1.15)
        const sa = this.rr(-1, 1) * j.spread
        const sv = this.rr(-1, 1) * j.spread
        const tongue = r < 0.42
        const s = this.begin(L.ADD, tongue ? F.FLAME : F.GLOW)
        s.at(j.mx + this.rr(-0.05, 0.05), j.my + this.rr(-0.05, 0.05), j.mz + this.rr(-0.05, 0.05))
        s.vel((j.dx + px * sa) * sp, (j.dy + sv) * sp + 0.4, (j.dz + pz * sa) * sp)
        s.life = this.rr(0.3, 0.5)
        s.s0 = (tongue ? 0.6 : 0.55) * j.size
        s.s1 = (tongue ? 1.5 + r : 1.9 + r) * j.size
        s.a0 = tongue ? 0.95 : 0.6
        s.a1 = 0
        s.hold = 0.2
        s.rot = tongue ? this.rr(-0.6, 0.6) : this.rnd() * 6.28
        s.spin = this.rr(-1.5, 1.5)
        s.drag = 0.6
        s.grav = -2.4
        s.atk = 0.1
        if (j.hue === 1) s.col('#e8fff0', '#1fa86a')
        else s.col(r < 0.1 ? '#fff0b8' : r < 0.45 ? '#ffb02e' : '#ff8a24', r < 0.5 ? '#e5330a' : '#a81a05')
        this.commit()
        if (r > 0.88) {
          // heat haze: faint pale wisps lifting off the stream
          const h = this.begin(L.ADD, F.SMOKE)
          h.at(j.mx + j.dx * j.len * this.rr(0.3, 0.9), j.my + this.rr(0.1, 0.5), j.mz + j.dz * j.len * this.rr(0.3, 0.9)).vel(this.rr(-0.3, 0.3), this.rr(0.9, 1.6), this.rr(-0.3, 0.3))
          h.life = this.rr(0.6, 0.9)
          h.s0 = 1.2 * j.size
          h.s1 = 2.8 * j.size
          h.a0 = 0.09
          h.a1 = 0
          h.rot = this.rnd() * 6.28
          h.col('#ffe9c8', '#ffb070')
          this.commit()
        }
        if (r > 0.7) {
          const g = this.begin(L.ADD, F.GLOW)
          g.at(j.mx, j.my, j.mz).vel((j.dx + px * sa) * sp * 0.8, (j.dy + sv) * sp * 0.8 + 0.5, (j.dz + pz * sa) * sp * 0.8)
          g.life = this.rr(0.4, 0.6)
          g.s0 = 0.7 * j.size
          g.s1 = 2.4 * j.size
          g.a0 = 0.3
          g.a1 = 0
          g.col(j.hue === 1 ? '#7dffc0' : '#ff9a30', '#8a1205')
          this.commit()
        }
      }
      while (j.accE >= 1) {
        j.accE -= 1
        const sp = speed * this.rr(0.5, 1.0)
        const s = this.begin(L.SPARK, F.SPARK)
        s.at(j.mx, j.my, j.mz).vel((j.dx + this.rr(-0.25, 0.25)) * sp, (j.dy + this.rr(0, 0.5)) * sp + 1.2, (j.dz + this.rr(-0.25, 0.25)) * sp)
        s.life = this.rr(0.5, 1.0)
        s.s0 = 0.05
        s.s1 = 0.02
        s.a0 = 1
        s.a1 = 0
        s.hold = 0.4
        s.grav = 4.5
        s.drag = 0.6
        s.col('#ffe8a0', '#ff5a10')
        this.commit()
      }
      while (j.accS >= 1) {
        j.accS -= 1
        const t = this.rr(0.4, 1)
        const sm = this.begin(L.NORM, F.SMOKE)
        sm.at(j.mx + j.dx * j.len * t, j.my + j.dy * j.len * t + 0.15, j.mz + j.dz * j.len * t).vel(this.rr(-0.2, 0.2), this.rr(0.5, 1.1), this.rr(-0.2, 0.2))
        sm.life = this.rr(0.9, 1.5)
        sm.s0 = 0.35
        sm.s1 = this.rr(1.1, 1.7)
        sm.a0 = 0.33
        sm.a1 = 0
        sm.rot = this.rnd() * 6.28
        sm.spin = this.rr(-0.5, 0.5)
        sm.col('#4a4640', '#262626')
        sm.drag = 0.9
        this.commit()
      }
    }
  }

  // ---- melee sweeps
  private tickSweeps(now: number, dt: number): void {
    for (const s of this.sweeps) {
      if (!s.active) continue
      const age = now - s.t0
      if (age < 0) continue
      if (age >= s.dur + 0.2) {
        s.active = false
        continue
      }
      const u = Math.min(1, age / s.dur)
      if (s.sparks && u < 1) {
        s.sparkAcc += 150 * dt * this.quality
        const a = s.a0 + (s.a1 - s.a0) * easeOut(u)
        sweepPoint(s, a, this.pt2)
        while (s.sparkAcc >= 1) {
          s.sparkAcc -= 1
          const sp = this.begin(L.SPARK, F.SPARK)
          sp.at(this.pt2[0], this.pt2[1], this.pt2[2]).vel(this.rr(-3.5, 3.5), this.rr(0.5, 4.5), this.rr(-3.5, 3.5))
          sp.life = this.rr(0.25, 0.5)
          sp.s0 = 0.06
          sp.s1 = 0.02
          sp.a0 = 1
          sp.a1 = 0
          sp.grav = 9
          sp.col('#fff2b0', '#ff7a1a')
          this.commit()
        }
      }
    }
  }

  // ---- status emitters
  private tickStatus(now: number, dt: number): void {
    const tmp = this.tmp
    for (const s of this.statuses) {
      if (!s.active) continue
      if (s.kind === SK.BURN) {
        if (now < s.t0) continue
        if (now >= s.until) {
          s.active = false
          this.releaseLight(s)
          continue
        }
        if (this.resolve?.(s.id ?? '', tmp)) {
          s.x = tmp.x
          s.y = tmp.y
          s.z = tmp.z
          s.h = tmp.h
        }
        const left = s.until - now
        const env = Math.min(1, (now - s.t0) / 0.2 + 0.2) * Math.min(1, left / 0.55) * s.strength
        s.acc += 46 * env * dt * this.quality
        s.accSmoke += 8 * env * dt * this.quality
        s.accEmber += 7 * env * dt * this.quality
        while (s.acc >= 1) {
          s.acc -= 1
          const r = this.rnd()
          const f = this.begin(L.ADD, r < 0.7 ? F.FLAME : F.GLOW)
          f.at(s.x + this.rr(-0.3, 0.3), s.y + s.h * this.rr(0.03, 0.8), s.z + this.rr(-0.3, 0.3)).vel(this.rr(-0.25, 0.25), this.rr(1.1, 2.3), this.rr(-0.25, 0.25))
          f.life = this.rr(0.34, 0.6)
          f.s0 = 1.1 * (0.7 + 0.4 * env)
          f.s1 = 0.55
          f.a0 = r < 0.7 ? 0.6 : 0.25
          f.a1 = 0
          f.hold = 0.2
          f.rot = this.rr(-0.3, 0.3)
          f.spin = this.rr(-1.5, 1.5)
          f.drag = 0.8
          f.col(r < 0.12 ? '#ffe9a0' : r < 0.5 ? '#ff8a24' : r < 0.8 ? '#ff6a18' : '#ff9a30', r < 0.5 ? '#d1300a' : '#7a1204')
          this.commit()
        }
        while (s.accSmoke >= 1) {
          s.accSmoke -= 1
          const sm = this.begin(L.NORM, F.SMOKE)
          sm.at(s.x + this.rr(-0.15, 0.15), s.y + s.h * this.rr(0.7, 1.05), s.z + this.rr(-0.15, 0.15)).vel(this.rr(-0.15, 0.15), this.rr(0.7, 1.3), this.rr(-0.15, 0.15))
          sm.life = this.rr(1.1, 1.7)
          sm.s0 = 0.3
          sm.s1 = this.rr(0.9, 1.4)
          sm.a0 = 0.42
          sm.a1 = 0
          sm.rot = this.rnd() * 6.28
          sm.spin = this.rr(-0.5, 0.5)
          sm.col('#3d3a36', '#1c1c1c')
          sm.drag = 0.7
          this.commit()
        }
        while (s.accEmber >= 1) {
          s.accEmber -= 1
          const e = this.begin(L.SPARK, F.SPARK)
          e.at(s.x + this.rr(-0.2, 0.2), s.y + s.h * this.rr(0.3, 0.9), s.z + this.rr(-0.2, 0.2)).vel(this.rr(-0.8, 0.8), this.rr(1.2, 3), this.rr(-0.8, 0.8))
          e.life = this.rr(0.5, 0.9)
          e.s0 = 0.045
          e.s1 = 0.02
          e.a0 = 1
          e.a1 = 0
          e.grav = 1.2
          e.col('#ffe090', '#ff4a10')
          this.commit()
        }
        // ground glow
        const g = this.begin(L.FLAT_ADD, F.GLOW)
        g.at(s.x, 0.04, s.z)
        g.life = 0.09
        g.s0 = g.s1 = 1.4 + this.rnd() * 0.3
        g.a0 = 0.2 * env
        g.a1 = 0.12 * env
        g.atk = 0
        g.col('#ff7a1a', '#ff5010')
        this.commit()
        // flickering orange light
        if (this.quality >= 0.5) {
          let l = s.lightSlot >= 0 ? this.lights[s.lightSlot]! : null
          if (!l || !l.active || l.owner === 0) {
            l = this.freeLight()
            s.lightSlot = this.lights.indexOf(l)
            l.active = true
            l.owner = 1
            l.hold = true
            l.r = 1
            l.g = 0.5
            l.b = 0.14
            l.flicker = true
          }
          l.x = s.x
          l.y = s.y + s.h * 0.5
          l.z = s.z
          l.peak = 3.4 * env
          l.t0 = now
          l.life = 1
        }
      } else {
        // injured: a slow drip or a couple of sparks
        if (this.resolve?.(s.id ?? '', tmp)) {
          s.x = tmp.x
          s.y = tmp.y
          s.z = tmp.z
          s.h = tmp.h
        }
        s.acc += dt
        if (s.acc >= 0.26) {
          s.acc = -this.rr(0.02, 0.3)
          const r = this.rnd()
          if (r < 0.4) {
            // a drop of blood falling from the wound
            const d = this.begin(L.NORM, F.DROP)
            d.at(s.x + this.rr(-0.14, 0.14), s.y + s.h * this.rr(0.35, 0.6), s.z + this.rr(0.05, 0.22)).vel(0, -0.3, 0)
            d.life = 0.6
            d.s0 = 0.36
            d.s1 = 0.28
            d.a0 = 0.95
            d.a1 = 0.8
            d.atk = 0
            d.grav = 8
            d.col('#a01010', '#6a0808')
            this.commit()
          } else if (r < 0.75) {
            // a crackle of sparks from damaged kit
            const n = 3 + (this.rnd() < 0.5 ? 1 : 0)
            for (let i = 0; i < n; i++) {
              const k = this.begin(L.SPARK, F.SPARK)
              k.at(s.x + this.rr(-0.12, 0.12), s.y + s.h * this.rr(0.4, 0.75), s.z + this.rr(0, 0.15)).vel(this.rr(-1.6, 1.6), this.rr(0.8, 2.8), this.rr(-1.6, 1.6))
              k.life = this.rr(0.25, 0.45)
              k.s0 = 0.14
              k.s1 = 0.05
              k.a0 = 1
              k.a1 = 0
              k.grav = 7
              k.col('#fff0b0', '#ff7a1a')
              this.commit()
            }
            const g = this.begin(L.ADD, F.GLOW)
            g.at(s.x, s.y + s.h * 0.6, s.z + 0.1)
            g.life = 0.14
            g.s0 = 0.5
            g.s1 = 0.8
            g.a0 = 0.7
            g.a1 = 0
            g.col('#ffb347', '#ff6a10')
            this.commit()
          } else {
            // a thread of dark smoke
            const m = this.begin(L.NORM, F.SMOKE)
            m.at(s.x + this.rr(-0.1, 0.1), s.y + s.h * 0.6, s.z + 0.1).vel(this.rr(-0.1, 0.1), this.rr(0.5, 0.9), this.rr(-0.1, 0.1))
            m.life = this.rr(0.9, 1.3)
            m.s0 = 0.22
            m.s1 = 0.7
            m.a0 = 0.45
            m.a1 = 0
            m.rot = this.rnd() * 6.28
            m.col('#5a4a46', '#2a2422')
            m.drag = 0.6
            this.commit()
          }
        }
      }
    }
  }

  private releaseLight(s: Status): void {
    if (s.lightSlot >= 0) {
      const l = this.lights[s.lightSlot]!
      if (l.owner === 1) {
        l.active = false
        l.hold = false
        l.owner = 0
      }
      s.lightSlot = -1
    }
  }

  // ------------------------------------------------------------ drawing
  /** Emit everything visible at the current engine time into `w`. */
  draw(w: FxWriter): void {
    const now = this.clock
    this.drawBillboards = 0
    this.drawBeams = 0
    const cw = this.cw
    cw.inner = w
    cw.bills = 0
    cw.beams = 0
    this.norm.drawBill(cw, L.NORM, now)
    this.flatNorm.drawBill(cw, L.FLAT_NORM, now)
    this.beamNorm.draw(cw, true, now)
    this.flatAdd.drawBill(cw, L.FLAT_ADD, now)
    this.add.drawBill(cw, L.ADD, now)
    this.beamAdd.draw(cw, false, now)
    this.spark.drawSpark(cw, now)
    for (const p of this.projs) if (p.active && now >= p.t0) this.drawProj(cw, p, now)
    for (const s of this.sweeps) if (s.active && now >= s.t0) this.drawSweep(cw, s, now)
    this.drawBillboards = cw.bills
    this.drawBeams = cw.beams
    if (cw.bills + cw.beams > this.drawPeak) this.drawPeak = cw.bills + cw.beams
  }

  private readonly cw = new CountingWriter()
  private readonly dp: P3 = [0, 0, 0]
  private readonly dq: P3 = [0, 0, 0]

  private drawProj(w: FxWriter, p: Proj, now: number): void {
    const u = Math.min(1, (now - p.t0) / p.dur)
    this.projAt(p, u, this.dp)
    const [x, y, z] = this.dp
    // heading from the path slope
    this.projAt(p, Math.min(1, u + 0.02), this.dq)
    let hx = this.dq[0] - x
    let hy = this.dq[1] - y
    let hz = this.dq[2] - z
    if (u >= 0.98) {
      this.projAt(p, u - 0.02, this.dq)
      hx = x - this.dq[0]
      hy = y - this.dq[1]
      hz = z - this.dq[2]
    }
    const hl = Math.hypot(hx, hy, hz) || 1
    hx /= hl
    hy /= hl
    hz /= hl
    const travelled = u * Math.hypot(p.tx - p.fx, p.ty - p.fy, p.tz - p.fz)
    const flick = 0.85 + 0.15 * Math.sin(now * 90 + p.seed)
    switch (p.kind) {
      case PK.BOLT:
      case PK.SNIPER: {
        const tl = Math.min(p.tail, travelled + 0.15)
        const tx = x - hx * tl
        const ty = y - hy * tl
        const tz = z - hz * tl
        const th = p.size * 0.21
        w.beam(false, tx, ty, tz, x, y, z, th * 0.4, th * 3.4, 0, 0.8 * flick, F.BEAM, p.gr, p.gg, p.gb)
        w.beam(false, x - hx * tl * 0.5, y - hy * tl * 0.5, z - hz * tl * 0.5, x, y, z, th * 0.3, th * 1.3, 0, 1, F.EDGE, p.cr, p.cg, p.cb)
        w.bill(L.ADD, x, y, z, th * 9 * flick, 0, 0.9, F.GLOW, p.gr, p.gg, p.gb)
        w.bill(L.ADD, x, y, z, th * 4, 0, 1, F.CORE, p.cr, p.cg, p.cb)
        if (p.kind === PK.SNIPER) {
          // thin vapour line back to the muzzle
          w.beam(false, p.fx, p.fy, p.fz, x - hx * tl, y - hy * tl, z - hz * tl, 0.035, 0.05, 0.06, 0.32, F.BEAM, 0.85, 0.92, 1)
        }
        break
      }
      case PK.PLASMA: {
        const s = p.size
        const pulse = 1 + 0.18 * Math.sin(now * 55 + p.seed)
        w.bill(L.ADD, x, y, z, 2.3 * s * pulse, 0, 0.85, F.GLOW, p.gr, p.gg, p.gb)
        w.bill(L.ADD, x, y, z, 0.9 * s, 0, 1, F.CORE, p.cr, p.cg, p.cb)
        // rippling halo: three rings out of phase
        for (let i = 0; i < 3; i++) {
          const ph = (now * 3.2 + i / 3 + p.seed) % 1
          w.bill(L.ADD, x, y, z, (0.7 + ph * 1.5) * s, ph * 3, (1 - ph) * 0.85, F.RING, p.gr, p.gg, p.gb)
        }
        const tl = Math.min(1.1 * s, travelled + 0.1)
        w.beam(false, x - hx * tl, y - hy * tl, z - hz * tl, x, y, z, 0.2 * s, 0.7 * s, 0, 0.6, F.BEAM, p.gr, p.gg, p.gb)
        break
      }
      case PK.ROCKET: {
        w.beam(false, x - hx * 0.75, y - hy * 0.75, z - hz * 0.75, x, y, z, 0.13, 0.13, 0.95, 0.95, F.EDGE, 0.95, 0.92, 0.85)
        w.beam(false, x - hx * 1.5, y - hy * 1.5, z - hz * 1.5, x - hx * 0.6, y - hy * 0.6, z - hz * 0.6, 0.02, 0.4, 0, 0.9, F.BEAM, 1, 0.55, 0.15)
        w.bill(L.ADD, x - hx * 0.7, y - hy * 0.7, z - hz * 0.7, 0.9 * flick, 0, 0.9, F.GLOW, 1, 0.6, 0.2)
        w.bill(L.ADD, x - hx * 0.65, y - hy * 0.65, z - hz * 0.65, 0.4, 0, 1, F.CORE, 1, 0.95, 0.7)
        break
      }
      case PK.GRENADE: {
        w.bill(L.NORM, x, y, z, 0.42 * p.size, now * 14 + p.seed, 1, F.DEBRIS, 0.46, 0.56, 0.36)
        w.bill(L.ADD, x + 0.04, y + 0.05, z, 0.5, 0, 0.8 * flick, F.CORE, 1, 0.9, 0.5)
        break
      }
      case PK.STICK: {
        const a = now * 20 + p.seed
        const cx = Math.cos(a) * 0.2
        const cy = Math.sin(a) * 0.2
        w.beam(true, x - cx * 1.6, y - cy * 1.6, z, x + cx * 1.6, y + cy * 1.6, z, 0.2, 0.2, 1, 1, F.EDGE, 0.8, 0.2, 0.12)
        w.beam(false, x - cx * 1.6, y - cy * 1.6, z, x + cx * 1.6, y + cy * 1.6, z, 0.34, 0.34, 0.35, 0.35, F.BEAM, 1, 0.4, 0.2)
        w.bill(L.ADD, x + cx * 1.6, y + cy * 1.6, z, 0.9, 0, 0.95 * flick, F.CORE, 1, 0.85, 0.35)
        w.bill(L.ADD, x + cx * 1.6, y + cy * 1.6, z, 1.4, 0, 0.5, F.GLOW, 1, 0.55, 0.15)
        break
      }
      case PK.KNIFE: {
        const spin = now * 38 + p.seed
        for (let i = 0; i < 5; i++) {
          const uu = Math.max(0, u - i * 0.025)
          this.projAt(p, uu, this.dq)
          w.bill(L.ADD, this.dq[0], this.dq[1], this.dq[2], 0.95 * p.size, spin - i * 0.6, (1 - i * 0.2) * 0.9, F.BLADE, p.gr, p.gg, p.gb)
        }
        w.bill(L.ADD, x, y, z, 1.1, spin, 1, F.BLADE, p.cr, p.cg, p.cb)
        w.bill(L.ADD, x, y, z, 0.9, 0, 0.55, F.GLOW, p.gr, p.gg, p.gb)
        break
      }
      case PK.HARPOON: {
        w.beam(true, p.fx, p.fy - 0.02, p.fz, x - hx * 0.4, y - hy * 0.4, z - hz * 0.4, 0.085, 0.085, 1, 1, F.EDGE, 0.72, 0.76, 0.82)
        w.beam(false, p.fx, p.fy - 0.02, p.fz, x - hx * 0.4, y - hy * 0.4, z - hz * 0.4, 0.2, 0.2, 0.3, 0.3, F.BEAM, 0.7, 0.8, 1)
        w.beam(false, x - hx * 1.5, y - hy * 1.5, z - hz * 1.5, x, y, z, 0.14, 0.4, 0.2, 1, F.EDGE, 0.8, 0.88, 0.96)
        w.beam(true, x - hx * 1.4, y - hy * 1.4, z - hz * 1.4, x, y, z, 0.42, 0.14, 1, 1, F.EDGE, 0.3, 0.33, 0.38)
        w.bill(L.ADD, x, y, z, 0.9, 0, 0.9, F.CORE, 0.9, 0.95, 1)
        w.bill(L.ADD, x, y, z, 1.5, 0, 0.5, F.GLOW, 0.6, 0.75, 1)
        break
      }
    }
  }

  private drawSweep(w: FxWriter, s: Sweep, now: number): void {
    const age = now - s.t0
    const u = Math.min(1, age / s.dur)
    const fade = age > s.dur ? Math.max(0, 1 - (age - s.dur) / 0.2) : 1
    const head = s.a0 + (s.a1 - s.a0) * easeOut(u)
    const span = (s.a1 - s.a0) * s.tailFrac
    const N = 14
    let ax = 0
    let ay = 0
    let az = 0
    for (let i = 0; i <= N; i++) {
      const k = i / N // 0 = tail, 1 = head
      const a = head - span * (1 - k)
      // the tail cannot start before the sweep did
      const clamped = (s.a1 > s.a0 ? a < s.a0 : a > s.a0) ? s.a0 : a
      sweepPoint(s, clamped, this.dp)
      if (i > 0) {
        const k0 = (i - 1) / N
        const w0 = s.width * (0.15 + 0.85 * k0)
        const w1 = s.width * (0.15 + 0.85 * k)
        const a0 = k0 * k0 * fade
        const a1 = k * k * fade
        w.beam(false, ax, ay, az, this.dp[0], this.dp[1], this.dp[2], w0 * 2.6, w1 * 2.6, a0 * 0.7, a1 * 0.7, F.BEAM, s.gr, s.gg, s.gb)
        w.beam(false, ax, ay, az, this.dp[0], this.dp[1], this.dp[2], w0, w1, a0, a1, F.EDGE, s.cr, s.cg, s.cb)
        if (s.energy) w.beam(false, ax, ay, az, this.dp[0], this.dp[1], this.dp[2], w0 * 5, w1 * 5, a0 * 0.25, a1 * 0.25, F.BEAM, s.gr, s.gg, s.gb)
      }
      ax = this.dp[0]
      ay = this.dp[1]
      az = this.dp[2]
    }
    if (u < 1 || fade > 0.6) {
      w.bill(L.ADD, ax, ay, az, s.width * 5 * fade, 0, 0.9 * fade, F.GLOW, s.gr, s.gg, s.gb)
      w.bill(L.ADD, ax, ay, az, s.width * 2.4 * fade, 0, fade, F.CORE, s.cr, s.cg, s.cb)
    }
  }

  // ------------------------------------------------------------ housekeeping
  stats(): EngineStats {
    let proj = 0
    let sw = 0
    let jt = 0
    let st = 0
    let li = 0
    for (const p of this.projs) if (p.active) proj++
    for (const s of this.sweeps) if (s.active) sw++
    for (const j of this.jets) if (j.active) jt++
    for (const s of this.statuses) if (s.active) st++
    for (const l of this.lights) if (l.active) li++
    return {
      add: this.add.n,
      norm: this.norm.n,
      flatAdd: this.flatAdd.n,
      flatNorm: this.flatNorm.n,
      spark: this.spark.n,
      beamAdd: this.beamAdd.n,
      beamNorm: this.beamNorm.n,
      projectiles: proj,
      sweeps: sw,
      jets: jt,
      status: st,
      lights: li,
      billboards: this.drawBillboards,
      beams: this.drawBeams,
      peak: {
        add: this.add.peak,
        norm: this.norm.peak,
        flatAdd: this.flatAdd.peak,
        flatNorm: this.flatNorm.peak,
        spark: this.spark.peak,
        beamAdd: this.beamAdd.peak,
        beamNorm: this.beamNorm.peak,
      },
      dropped: this.add.dropped + this.norm.dropped + this.flatAdd.dropped + this.flatNorm.dropped + this.spark.dropped + this.beamAdd.dropped + this.beamNorm.dropped + this.projDropped,
    }
  }

  /** Atlas frames of the particles of one pool that have been born and are still alive (debug / e2e). */
  visibleFrames(pool: 'add' | 'norm' | 'flatAdd' | 'flatNorm'): number[] {
    const s = this[pool]
    const out: number[] = []
    for (let i = 0; i < s.n; i++) {
      const age = this.clock - s.born[i]!
      if (age >= 0 && age < s.life[i]! && !out.includes(s.frame[i]!)) out.push(s.frame[i]!)
    }
    return out
  }

  /** CPU time of the engine update + buffer write per frame, measured by the host (perf numbers). */
  noteCpu(ms: number): void {
    this.cpuSum += ms
    this.cpuFrames++
    if (ms > this.cpuPeak) this.cpuPeak = ms
  }
  cpu(): { avg: number; peak: number; frames: number; peakDraw: number } {
    return { avg: this.cpuFrames ? this.cpuSum / this.cpuFrames : 0, peak: this.cpuPeak, frames: this.cpuFrames, peakDraw: this.drawPeak }
  }
  resetCpu(): void {
    this.drawPeak = 0
    this.cpuSum = 0
    this.cpuFrames = 0
    this.cpuPeak = 0
  }

  /** Total live instances across pools (the "effects per frame" number). */
  liveCount(): number {
    return this.add.n + this.norm.n + this.flatAdd.n + this.flatNorm.n + this.spark.n + this.beamAdd.n + this.beamNorm.n
  }

  reset(): void {
    for (const s of this.stores) s.clear()
    this.beamAdd.clear()
    this.beamNorm.clear()
    for (const p of this.projs) p.active = false
    for (const s of this.sweeps) s.active = false
    for (const j of this.jets) j.active = false
    for (const s of this.statuses) s.active = false
    for (const l of this.lights) {
      l.active = false
      l.hold = false
    }
    for (const s of this.shakes) s.active = false
    this.live = false
    this.frozen = false
    this.freezeAt = Infinity
  }
}

class CountingWriter implements FxWriter {
  bills = 0
  beams = 0
  inner: FxWriter | null = null
  bill(layer: 0 | 1 | 2 | 3, x: number, y: number, z: number, size: number, rot: number, alpha: number, frame: number, r: number, g: number, b: number): void {
    this.bills++
    this.inner!.bill(layer, x, y, z, size, rot, alpha, frame, r, g, b)
  }
  beam(norm: boolean, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, w0: number, w1: number, a0: number, a1: number, frame: number, r: number, g: number, b: number): void {
    this.beams++
    this.inner!.beam(norm, x0, y0, z0, x1, y1, z1, w0, w1, a0, a1, frame, r, g, b)
  }
}

/** A point on a sweep's arc at angle `a`. */
export function sweepPoint(s: Sweep, a: number, out: P3): void {
  const sa = Math.sin(a) * s.R
  const ca = (Math.cos(a) - s.lift) * s.R
  out[0] = s.cx + s.sx * sa + s.wx * ca
  out[1] = s.cy + s.sy * sa + s.wy * ca
  out[2] = s.cz + s.sz * sa + s.wz * ca
}
