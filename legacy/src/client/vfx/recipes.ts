// Effect recipes: what each weapon family looks like. Every function takes the engine and a description of the
// moment (positions in inches, kinds of attack dice) and spawns pre-scheduled particles / entities; nothing here
// runs per frame. `LAYERS` names the layers each family implements (tests/client/vfx.test.ts checks them against
// REQUIRED_LAYERS), so a family cannot silently lose its muzzle flash or its impact.
import { PK, type FxEngine, type Proj, type Sweep } from './engine'
import { REQUIRED_LAYERS, type FxLayer, type VfxFamily } from './families'
import { F, L, hex, type P3 } from './types'

/** Attack die kinds as the engine reports them. */
export const FAIL = 0
export const NORMAL = 1
export const CRIT = 2

export interface VolleyArgs {
  family: VfxFamily
  variant: string
  /** muzzle */
  fx: number
  fy: number
  fz: number
  /** target chest */
  tx: number
  ty: number
  tz: number
  /** target base height (floor under it) and body height, for ground effects and burning */
  floorY: number
  height: number
  targetId: string
  kinds: number[]
  secondary: boolean
  inCover: boolean
  /** colour of the target's blood / oil is the director's business; the volley only needs to know the shooter's facing */
}

export interface VolleyInfo {
  /** seconds until the last projectile lands */
  duration: number
  /** seconds until the first impact */
  first: number
}

type RGBs = readonly [number, number, number]

// ---------------------------------------------------------------- small building blocks

function glow(e: FxEngine, x: number, y: number, z: number, s0: number, s1: number, life: number, c0: string, c1: string, a = 1, delay = 0, frame: number = F.GLOW): void {
  const s = e.begin(L.ADD, frame)
  s.at(x, y, z)
  s.born += delay
  s.life = life
  s.s0 = s0
  s.s1 = s1
  s.a0 = a
  s.a1 = 0
  s.atk = 0.04
  s.col(c0, c1)
  e.commit()
}

function star(e: FxEngine, x: number, y: number, z: number, size: number, life: number, c0: string, c1: string, delay = 0, rot = 0): void {
  const s = e.begin(L.ADD, F.STAR)
  s.at(x, y, z)
  s.born += delay
  s.life = life
  s.s0 = size * 0.55
  s.s1 = size
  s.a0 = 1
  s.a1 = 0
  s.atk = 0.03
  s.rot = rot
  s.spin = e.rr(-2, 2)
  s.col(c0, c1)
  e.commit()
}

function smoke(e: FxEngine, x: number, y: number, z: number, n: number, s0: number, s1: number, life: number, a: number, c0: string, c1: string, delay: number, vx: number, vy: number, vz: number, spread = 0.4): void {
  for (let i = 0; i < e.n(n); i++) {
    const s = e.begin(L.NORM, F.SMOKE)
    s.at(x + e.rr(-0.1, 0.1), y, z + e.rr(-0.1, 0.1)).vel(vx + e.rr(-spread, spread), vy + e.rr(-spread * 0.3, spread), vz + e.rr(-spread, spread))
    s.born += delay + e.rr(0, 0.05)
    s.life = life * e.rr(0.8, 1.2)
    s.s0 = s0
    s.s1 = s1 * e.rr(0.8, 1.2)
    s.a0 = a
    s.a1 = 0
    s.rot = e.rnd() * 6.28
    s.spin = e.rr(-0.8, 0.8)
    s.drag = 1.1
    s.col(c0, c1)
    e.commit()
  }
}

/** A shower of spark streaks. dir is the mean direction (unit), `cone` how far they scatter. */
function sparks(e: FxEngine, x: number, y: number, z: number, n: number, vmin: number, vmax: number, life: number, grav: number, c0: string, c1: string, dx: number, dy: number, dz: number, cone: number, size = 0.05, delay = 0): void {
  const k = e.n(n)
  for (let i = 0; i < k; i++) {
    const sp = e.rr(vmin, vmax)
    const s = e.begin(L.SPARK, F.SPARK)
    s.at(x, y, z).vel((dx + e.rr(-cone, cone)) * sp, (dy + e.rr(-cone, cone)) * sp, (dz + e.rr(-cone, cone)) * sp)
    s.born += delay
    s.life = life * e.rr(0.7, 1.15)
    s.s0 = size
    s.s1 = size * 0.4
    s.a0 = 1
    s.a1 = 0
    s.hold = 0.3
    s.grav = grav
    s.drag = 0.5
    s.col(c0, c1)
    e.commit()
  }
}

function radialSparks(e: FxEngine, x: number, y: number, z: number, n: number, vmin: number, vmax: number, life: number, grav: number, c0: string, c1: string, size = 0.05, delay = 0): void {
  const k = e.n(n)
  for (let i = 0; i < k; i++) {
    const a = e.rnd() * Math.PI * 2
    const up = e.rr(-0.2, 1)
    const sp = e.rr(vmin, vmax)
    const r = Math.sqrt(1 - up * up * 0.6)
    const s = e.begin(L.SPARK, F.SPARK)
    s.at(x, y, z).vel(Math.cos(a) * r * sp, up * sp, Math.sin(a) * r * sp)
    s.born += delay
    s.life = life * e.rr(0.7, 1.15)
    s.s0 = size
    s.s1 = size * 0.4
    s.a0 = 1
    s.a1 = 0
    s.hold = 0.3
    s.grav = grav
    s.drag = 0.4
    s.col(c0, c1)
    e.commit()
  }
}

/** Expanding ring lying on the ground (additive) or standing (billboard). */
function groundRing(e: FxEngine, x: number, y: number, z: number, r0: number, r1: number, life: number, color: string, a: number, delay = 0, additive = true): void {
  const s = e.begin(additive ? L.FLAT_ADD : L.FLAT_NORM, F.RING)
  s.at(x, y + 0.04, z)
  s.born += delay
  s.life = life
  s.s0 = r0 * 2
  s.s1 = r1 * 2
  s.a0 = a
  s.a1 = 0
  s.atk = 0.02
  s.col(color)
  e.commit()
}

function billboardRing(e: FxEngine, x: number, y: number, z: number, r0: number, r1: number, life: number, c0: string, c1: string, a: number, delay = 0): void {
  const s = e.begin(L.ADD, F.RING)
  s.at(x, y, z)
  s.born += delay
  s.life = life
  s.s0 = r0 * 2
  s.s1 = r1 * 2
  s.a0 = a
  s.a1 = 0
  s.atk = 0.02
  s.col(c0, c1)
  e.commit()
}

function dustPuffs(e: FxEngine, x: number, y: number, z: number, n: number, speed: number, s0: number, s1: number, life: number, a: number, color: string, delay = 0, rise = 0.25): void {
  const k = e.n(n)
  for (let i = 0; i < k; i++) {
    const ang = (i / Math.max(1, k)) * Math.PI * 2 + e.rr(-0.3, 0.3)
    const sp = speed * e.rr(0.6, 1.1)
    const s = e.begin(L.NORM, F.SMOKE)
    s.at(x + Math.cos(ang) * 0.2, y + 0.1, z + Math.sin(ang) * 0.2).vel(Math.cos(ang) * sp, rise * e.rr(0.4, 1.4), Math.sin(ang) * sp)
    s.born += delay
    s.life = life * e.rr(0.8, 1.2)
    s.s0 = s0
    s.s1 = s1 * e.rr(0.85, 1.2)
    s.a0 = a
    s.a1 = 0
    s.hold = 0.15
    s.rot = e.rnd() * 6.28
    s.spin = e.rr(-0.6, 0.6)
    s.drag = 2.2
    s.col(color, '#8a8070')
    e.commit()
  }
}

function debris(e: FxEngine, x: number, y: number, z: number, n: number, vmin: number, vmax: number, up: number, size: number, color: string, life: number, delay = 0): void {
  const k = e.n(n)
  for (let i = 0; i < k; i++) {
    const a = e.rnd() * Math.PI * 2
    const sp = e.rr(vmin, vmax)
    const s = e.begin(L.NORM, F.DEBRIS)
    s.at(x, y, z).vel(Math.cos(a) * sp, e.rr(up * 0.5, up), Math.sin(a) * sp)
    s.born += delay
    s.life = life * e.rr(0.8, 1.2)
    s.s0 = size * e.rr(0.7, 1.3)
    s.s1 = s.s0 * 0.7
    s.a0 = 1
    s.a1 = 0
    s.hold = 0.65
    s.rot = e.rnd() * 6.28
    s.spin = e.rr(-14, 14)
    s.grav = 16
    s.drag = 0.2
    s.atk = 0
    s.col(color, '#3a342c')
    e.commit()
  }
}

/** Jagged lightning polyline from a to b: two ribbons per segment (glow + core). */
function lightning(e: FxEngine, ax: number, ay: number, az: number, bx: number, by: number, bz: number, segs: number, jitter: number, glowW: number, coreW: number, glowC: RGBs, coreC: RGBs, delay: number, life: number): void {
  const dx = bx - ax
  const dy = by - ay
  const dz = bz - az
  const len = Math.hypot(dx, dy, dz) || 1
  // two perpendiculars
  let px = -dz / (Math.hypot(dx, dz) || 1)
  let pz = dx / (Math.hypot(dx, dz) || 1)
  if (Math.hypot(dx, dz) < 1e-4) {
    px = 1
    pz = 0
  }
  let lx = ax
  let ly = ay
  let lz = az
  for (let i = 1; i <= segs; i++) {
    const t = i / segs
    const env = i === segs ? 0 : Math.sin(Math.PI * t)
    const j1 = e.rr(-1, 1) * jitter * env
    const j2 = e.rr(-1, 1) * jitter * env * 0.8
    const nx = ax + dx * t + px * j1
    const ny = ay + dy * t + j2
    const nz = az + dz * t + pz * j1
    e.beam(false, lx, ly, lz, nx, ny, nz, glowW, glowW, 0.75, 0.75, F.BEAM, glowC, delay, life)
    e.beam(false, lx, ly, lz, nx, ny, nz, coreW, coreW, 1, 1, F.EDGE, coreC, delay, life)
    lx = nx
    ly = ny
    lz = nz
  }
  void len
}

const unit = (dx: number, dy: number, dz: number): P3 => {
  const l = Math.hypot(dx, dy, dz) || 1
  return [dx / l, dy / l, dz / l]
}

// ---------------------------------------------------------------- bolt / slugga tracer families

interface TracerStyle {
  gap: number
  gapJit: number
  travel: number
  tail: number
  thick: number
  flash: number
  min: number
  max: number
  smoke: number
  casings: boolean
  bend: number
  core: string
  glowC: string
  flashC0: string
  flashC1: string
  sparkC0: string
  sparkC1: string
  ragged: boolean
  kind: typeof PK.BOLT | typeof PK.SNIPER
  dust: number
}

const BOLT_BASE: TracerStyle = {
  gap: 0.07,
  gapJit: 0.01,
  travel: 0.12,
  tail: 2.2,
  thick: 1,
  flash: 1,
  min: 1,
  max: 6,
  smoke: 1,
  casings: false,
  bend: 0,
  core: '#fffbe6',
  glowC: '#ffb347',
  flashC0: '#fff6d0',
  flashC1: '#ffb347',
  sparkC0: '#fff6c8',
  sparkC1: '#ff9a30',
  ragged: false,
  kind: PK.BOLT,
  dust: 0.4,
}

const BOLT_STYLES: Record<string, Partial<TracerStyle>> = {
  rifle: {},
  auto: { gap: 0.045, travel: 0.11, thick: 0.9, flash: 0.9, tail: 2 },
  pistol: { gap: 0.08, travel: 0.1, thick: 0.8, flash: 0.75, tail: 1.6, smoke: 0.6 },
  heavyPistol: { gap: 0.09, travel: 0.11, thick: 1.15, flash: 1.1, tail: 2, smoke: 0.9 },
  stalker: { gap: 0.09, travel: 0.12, thick: 1.1, flash: 1.05, tail: 2.6 },
  heavy: { gap: 0.058, travel: 0.12, thick: 1.2, flash: 1.25, tail: 2.4, min: 4, max: 5, casings: true, smoke: 1.4, glowC: '#ffa030' },
  sniper: { gap: 0, travel: 0.27, thick: 1.6, flash: 1.55, tail: 3.8, min: 1, max: 1, smoke: 1.5, core: '#ffffff', glowC: '#ffe9a8', flashC1: '#ffe9a8', kind: PK.SNIPER, dust: 0.6 },
  // greenskin guns: orange, ragged, smokier
  slugga: { gap: 0.075, gapJit: 0.05, travel: 0.15, thick: 1, flash: 1.05, tail: 1.5, smoke: 2, bend: 0.35, core: '#fff0c0', glowC: '#ff9a2a', flashC0: '#fff0c0', flashC1: '#ff8a1a', sparkC0: '#ffe9a0', sparkC1: '#ff7a1a', ragged: true, dust: 1 },
  dakka: { gap: 0.04, gapJit: 0.025, travel: 0.14, thick: 0.95, flash: 1.0, tail: 1.8, smoke: 2, bend: 0.4, max: 6, core: '#fff0c0', glowC: '#ff9a2a', flashC0: '#fff0c0', flashC1: '#ff8a1a', sparkC0: '#ffe9a0', sparkC1: '#ff7a1a', ragged: true, dust: 1 },
  bigShoota: { gap: 0.05, gapJit: 0.03, travel: 0.16, thick: 1.4, flash: 1.35, tail: 2.8, smoke: 3, bend: 0.3, max: 6, core: '#fff0c0', glowC: '#ff8a1a', flashC0: '#fff0c0', flashC1: '#ff7a10', sparkC0: '#ffe9a0', sparkC1: '#ff6a10', ragged: true, dust: 1.4 },
}

function styleFor(variant: string): TracerStyle {
  return { ...BOLT_BASE, ...(BOLT_STYLES[variant] ?? {}) }
}

function muzzleFlash(e: FxEngine, a: VolleyArgs, st: TracerStyle, d: P3, delay: number, first: boolean): void {
  const { fx, fy, fz } = a
  const f = st.flash
  if (st.ragged) {
    // ragged orange: a few randomly turned flame licks and a hot core
    for (let i = 0; i < 2; i++) {
      const s = e.begin(L.ADD, F.FLAME)
      s.at(fx + d[0] * 0.35, fy + d[1] * 0.35 + 0.1, fz + d[2] * 0.35).vel(d[0] * 2.5, 0.2, d[2] * 2.5)
      s.born += delay
      s.life = e.rr(0.07, 0.12)
      s.s0 = 0.8 * f
      s.s1 = 1.5 * f
      s.a0 = 1
      s.a1 = 0
      s.rot = Math.atan2(d[0], -d[2]) * 0 + e.rr(-1.2, 1.2)
      s.col('#fff0c0', '#ff6a10')
      e.commit()
    }
    star(e, fx + d[0] * 0.2, fy + 0.05, fz + d[2] * 0.2, 1.45 * f, 0.07, '#fff0c0', '#ff9a2a', delay, e.rr(0, 3))
  } else {
    star(e, fx + d[0] * 0.2, fy + d[1] * 0.2, fz + d[2] * 0.2, 3.6 * f, 0.09, st.flashC0, st.flashC1, delay, e.rr(0, 3))
  }
  glow(e, fx + d[0] * 0.25, fy + d[1] * 0.25, fz + d[2] * 0.25, 4.4 * f, 5.6 * f, 0.12, st.flashC1, '#ff6a10', 0.9, delay)
  // the forward blast cone of the flash
  e.beam(false, fx, fy, fz, fx + d[0] * 2.4 * f, fy + d[1] * 2.4 * f, fz + d[2] * 2.4 * f, 1.0 * f, 0.1, 0.95, 0, F.BEAM, hex(st.flashC1), delay, 0.08)
  if (first) e.light(fx + d[0] * 0.5, fy + 0.2, fz + d[2] * 0.5, st.flashC1, 1.4 * f, 0.14, delay)
  smoke(e, fx + d[0] * 0.4, fy, fz + d[2] * 0.4, first ? 2 * st.smoke : 1 * st.smoke, 0.3, 1.2, 1.3, 0.5, '#d8d4cc', '#7a7a7a', delay, d[0] * 1.1, 0.35, d[2] * 1.1)
}

function impactSpark(e: FxEngine, a: VolleyArgs, st: TracerStyle, x: number, y: number, z: number, d: P3, delay: number, crit: boolean, hit: boolean): void {
  const m = crit ? 2 : 1
  if (hit) {
    // spark and ricochet off the armour: scatter back toward the shooter
    sparks(e, x, y, z, 10 * m, 3, 9, 0.4, 12, st.sparkC0, st.sparkC1, -d[0], 0.5, -d[2], 0.7, 0.07, delay)
    sparks(e, x, y, z, 3 * m, 11, 16, 0.3, 6, '#ffffff', st.sparkC1, -d[0] * 0.5, 0.4, -d[2] * 0.5, 0.9, 0.06, delay)
    glow(e, x, y, z, (crit ? 3.2 : 2), (crit ? 4.6 : 3), 0.18, st.flashC0, st.flashC1, 0.95, delay)
    glow(e, x, y, z, 0.9, 1.5, 0.12, '#ffffff', '#ffe0a0', 1, delay, F.CORE)
    if (crit) {
      star(e, x, y, z, 4, 0.24, '#ffffff', st.flashC1, delay, e.rr(0, 3))
      billboardRing(e, x, y + 0.3, z, 0.2, 1.3, 0.24, '#ffffff', st.flashC1, 0.9, delay)
    }
  } else {
    // miss: strikes the mat: dust, chips and a short ricochet
    const gy = Math.max(a.floorY, 0) + 0.06
    smoke(e, x, gy, z, 2 * st.dust, 0.2, 0.8, 0.7, 0.5, '#c4b494', '#8a7e68', delay, 0, 0.5, 0, 0.5)
    sparks(e, x, gy, z, 5, 2, 7, 0.3, 14, st.sparkC0, st.sparkC1, d[0] * 0.5, 0.9, d[2] * 0.5, 0.6, 0.045, delay)
    glow(e, x, gy + 0.05, z, 0.7, 1.1, 0.12, st.flashC0, st.flashC1, 0.8, delay)
    const s = e.begin(L.FLAT_NORM, F.SCORCH)
    s.at(x, gy, z)
    s.born += delay
    s.life = 4
    s.s0 = s.s1 = 0.35
    s.a0 = 0.6
    s.a1 = 0
    s.hold = 0.4
    s.rot = e.rnd() * 6
    s.col('#0c0c0c')
    e.commit()
  }
}

function fireTracers(e: FxEngine, a: VolleyArgs): VolleyInfo {
  const st = styleFor(a.variant)
  const dist = Math.hypot(a.tx - a.fx, a.tz - a.fz)
  const d = unit(a.tx - a.fx, a.ty - a.fy, a.tz - a.fz)
  // perpendicular on the ground, for spread and the casing side
  const px = -d[2]
  const pz = d[0]
  const pl = Math.hypot(px, pz) || 1
  const sx = px / pl
  const sz = pz / pl
  let n = Math.min(st.max, Math.max(st.min, a.kinds.length))
  if (a.secondary) n = Math.max(1, Math.min(3, n))
  const anyHit = a.kinds.some((k) => k !== FAIL)
  let t = 0
  let first = Infinity
  let last = 0
  for (let i = 0; i < n; i++) {
    const kind = i < a.kinds.length ? a.kinds[i]! : anyHit ? NORMAL : FAIL
    const hit = kind !== FAIL
    const delay = t
    t += st.gap + e.rr(0, st.gapJit)
    if (!a.secondary) muzzleFlash(e, a, st, d, delay, i === 0)
    // aim point: jitter on a hit, well off the body on a miss
    let ex = a.tx
    let ey = a.ty
    let ez = a.tz
    if (hit) {
      ex += sx * e.rr(-0.22, 0.22) + e.rr(-0.08, 0.08)
      ey += e.rr(-0.25, 0.3)
      ez += sz * e.rr(-0.22, 0.22)
    } else {
      const off = (0.8 + e.rnd() * 0.9) * e.sgn()
      const beyond = 1.2 + e.rnd() * 2.2
      ex += sx * off + d[0] * beyond
      ez += sz * off + d[2] * beyond
      ey = Math.max(a.floorY, 0) + 0.08 + e.rnd() * 0.12
    }
    const travel = st.travel * (hit ? 1 : 1.1)
    const p = e.proj()
    if (p) {
      p.kind = st.kind
      p.t0 = e.t() + delay
      p.dur = travel
      p.fx = a.fx + d[0] * 0.4 + (a.secondary ? 0 : sx * e.rr(-0.04, 0.04))
      p.fy = a.fy
      p.fz = a.fz + d[2] * 0.4
      p.tx = ex
      p.ty = ey
      p.tz = ez
      p.sx = sx
      p.sz = sz
      p.bend = st.bend * e.rr(-1, 1) * Math.min(1, dist / 6)
      p.size = st.thick
      p.tail = st.tail
      const c = hex(st.core)
      const g = hex(st.glowC)
      p.cr = c[0]
      p.cg = c[1]
      p.cb = c[2]
      p.gr = g[0]
      p.gg = g[1]
      p.gb = g[2]
    }
    const land = delay + travel
    impactSpark(e, a, st, ex, ey, ez, d, land, kind === CRIT, hit)
    if (hit && st.ragged) {
      // chips of whatever it hit
      debris(e, ex, ey, ez, 1, 1, 2.4, 2.5, 0.07, '#8a8070', 0.5, land)
    }
    if (st.casings) {
      const s = e.begin(L.NORM, F.DEBRIS)
      s.at(a.fx - d[0] * 0.1 + sx * 0.12, a.fy, a.fz - d[2] * 0.1 + sz * 0.12).vel(sx * e.rr(1.5, 3) + e.rr(-0.5, 0.5), e.rr(2, 3.5), sz * e.rr(1.5, 3) + e.rr(-0.5, 0.5))
      s.born += delay
      s.life = 0.6
      s.s0 = s.s1 = 0.1
      s.a0 = 1
      s.a1 = 0
      s.hold = 0.7
      s.rot = e.rnd() * 6
      s.spin = e.rr(-25, 25)
      s.grav = 16
      s.atk = 0
      s.col('#e8c15a', '#a07a20')
      e.commit()
    }
    if (st.kind === PK.SNIPER) {
      // the vapour line left in the air after the bolt has landed
      e.beam(false, a.fx, a.fy, a.fz, ex, ey, ez, 0.05, 0.075, 0.28, 0.1, F.BEAM, hex('#cfe8ff'), land - 0.02, 1.1, 0.1, 1.2)
    }
    if (i === 0) first = land
    last = Math.max(last, land)
  }
  return { duration: last, first }
}

// ---------------------------------------------------------------- plasma

function firePlasma(e: FxEngine, a: VolleyArgs): VolleyInfo {
  const sup = a.variant === 'supercharge'
  const d = unit(a.tx - a.fx, a.ty - a.fy, a.tz - a.fz)
  const charge = 0.16
  const travel = sup ? 0.23 : 0.2
  const hit = a.kinds.some((k) => k !== FAIL)
  const crit = a.kinds.includes(CRIT)
  const px = -d[2]
  const pz = d[0]
  const pl = Math.hypot(px, pz) || 1
  const sx = px / pl
  const sz = pz / pl
  const mx = a.fx + d[0] * 0.45
  const my = a.fy
  const mz = a.fz + d[2] * 0.45
  const big = sup ? 1.55 : 1
  if (!a.secondary) {
    // charge glow at the muzzle: rings drawing in, a core swelling
    glow(e, mx, my, mz, 0.3, 2.6 * big, charge, '#bff4ff', '#58d8ff', 0.35)
    glow(e, mx, my, mz, 0.15, 1.1 * big, charge, '#ffffff', '#bff4ff', 0.9, 0, F.CORE)
    for (let i = 0; i < 2; i++) billboardRing(e, mx, my, mz, 2 * big, 0.3, charge, '#58d8ff', '#ffffff', 0.9, i * 0.04)
    radialSparks(e, mx, my, mz, 6, -1, -0.5, charge, 0, '#aef0ff', '#58d8ff', 0.04)
    e.light(mx, my, mz, '#58d8ff', 1.1 * big, charge + 0.15, 0)
    // release flash
    star(e, mx, my, mz, 3.8 * big, 0.16, '#ffffff', '#58d8ff', charge, e.rr(0, 3))
    glow(e, mx, my, mz, 4 * big, 5.4 * big, 0.16, '#bff4ff', '#2a60ff', 0.95, charge)
    smoke(e, mx, my, mz, 1, 0.2, 0.7, 0.8, 0.22, '#e8f6ff', '#9ab4c8', charge, d[0] * 0.8, 0.3, d[2] * 0.8)
    if (sup) {
      // the pistol vents: scalding steam and orange sparks from the shooter
      const vx = a.fx - d[0] * 0.1
      const vz = a.fz - d[2] * 0.1
      for (let i = 0; i < 3; i++) {
        smoke(e, vx + sx * (i - 1) * 0.12, a.fy + 0.12, vz + sz * (i - 1) * 0.12, 1, 0.2, 0.75, 0.95, 0.55, '#ffffff', '#b8c4cc', charge + i * 0.03, sx * (i - 1) * 0.8, 1.6, sz * (i - 1) * 0.8, 0.15)
      }
      radialSparks(e, vx, a.fy + 0.1, vz, 7, 1.5, 4.5, 0.5, 9, '#ffd070', '#ff6a10', 0.045, charge)
      glow(e, vx, a.fy + 0.1, vz, 0.8, 1.6, 0.2, '#ffd070', '#ff6a10', 0.7, charge)
      e.light(vx, a.fy + 0.1, vz, '#ff8a2a', 0.8, 0.25, charge)
    }
  }
  // the bolt
  let ex = a.tx
  let ey = a.ty
  let ez = a.tz
  if (!hit) {
    const off = (0.9 + e.rnd() * 0.8) * e.sgn()
    ex += sx * off + d[0] * 2.2
    ez += sz * off + d[2] * 2.2
    ey = Math.max(a.floorY, 0) + 0.1
  }
  const p = e.proj()
  if (p) {
    p.kind = PK.PLASMA
    p.t0 = e.t() + (a.secondary ? 0 : charge)
    p.dur = travel
    p.fx = mx
    p.fy = my
    p.fz = mz
    p.tx = ex
    p.ty = ey
    p.tz = ez
    p.sx = sx
    p.sz = sz
    p.size = big * (crit ? 1.2 : 1)
    const c = hex('#ffffff')
    const g = hex(sup ? '#8fe4ff' : '#58d8ff')
    p.cr = c[0]
    p.cg = c[1]
    p.cb = c[2]
    p.gr = g[0]
    p.gg = g[1]
    p.gb = g[2]
    p.afterglow = 0
  }
  const land = (a.secondary ? 0 : charge) + travel
  if (hit) {
    const k = (sup ? 1.35 : 1) * (crit ? 1.3 : 1)
    // cyan impact flare, ring, lingering sparks
    star(e, ex, ey, ez, 4.4 * k, 0.3, '#d8f8ff', '#58d8ff', land, e.rr(0, 3))
    glow(e, ex, ey, ez, 3.4 * k, 6 * k, 0.45, '#8fe4ff', '#2a60ff', 0.8, land)
    glow(e, ex, ey, ez, 1.2 * k, 2.2 * k, 0.18, '#ffffff', '#bff4ff', 1, land, F.CORE)
    billboardRing(e, ex, ey + 0.3, ez, 0.3, 2.6 * k, 0.32, '#bff4ff', '#58d8ff', 0.95, land)
    groundRing(e, ex, a.floorY, ez, 0.3, 3.4 * k, 0.5, '#58d8ff', 0.9, land)
    radialSparks(e, ex, ey, ez, 12 * k, 1, 4.5, 0.9, -0.4, '#aef0ff', '#2a60ff', 0.045, land)
    // lingering sparks: slow motes that drift up and flicker
    for (let i = 0; i < e.n(6); i++) {
      const s = e.begin(L.ADD, F.GLOW)
      s.at(ex + e.rr(-0.4, 0.4), ey + e.rr(-0.4, 0.3), ez + e.rr(-0.4, 0.4)).vel(e.rr(-0.25, 0.25), e.rr(0.2, 0.7), e.rr(-0.25, 0.25))
      s.born += land + e.rr(0, 0.2)
      s.life = e.rr(0.9, 1.5)
      s.s0 = 0.22
      s.s1 = 0.06
      s.a0 = 0.8
      s.a1 = 0
      s.hold = 0.3
      s.col('#bff4ff', '#58d8ff')
      e.commit()
    }
    e.light(ex, ey, ez, '#58d8ff', 2.2 * k, 0.4, land)
    e.shake(crit || sup ? 0.07 : 0.035, 0.2, land)
    smoke(e, ex, ey - 0.2, ez, 1, 0.3, 0.9, 0.9, 0.18, '#a8c0d0', '#506070', land, 0, 0.5, 0)
  } else {
    glow(e, ex, ey, ez, 0.8, 1.6, 0.2, '#bff4ff', '#2a60ff', 0.8, land)
    groundRing(e, ex, ey, ez, 0.2, 1.3, 0.3, '#58d8ff', 0.7, land)
    radialSparks(e, ex, ey, ez, 5, 1, 3.5, 0.5, 8, '#aef0ff', '#2a60ff', 0.04, land)
    const s = e.begin(L.FLAT_NORM, F.SCORCH)
    s.at(ex, ey, ez)
    s.born += land
    s.life = 5
    s.s0 = s.s1 = 0.7
    s.a0 = 0.6
    s.a1 = 0
    s.hold = 0.4
    s.col('#0c0c0c')
    e.commit()
  }
  return { duration: land, first: land }
}

// ---------------------------------------------------------------- flame

function fireFlame(e: FxEngine, a: VolleyArgs): VolleyInfo {
  const deluge = a.variant === 'deluge'
  const hand = a.variant === 'hand'
  const dist = Math.hypot(a.tx - a.fx, a.tz - a.fz)
  const d = unit(a.tx - a.fx, a.ty - a.fy, a.tz - a.fz)
  const hit = a.kinds.some((k) => k !== FAIL)
  const dur = deluge ? 0.5 : hand ? 0.55 : 0.65
  const arrive = Math.min(0.36, 0.1 + dist / 24)
  if (!a.secondary) {
    const j = e.jet()
    if (j) {
      j.t0 = e.t()
      j.dur = dur
      j.mx = a.fx + d[0] * 0.3
      j.my = a.fy
      j.mz = a.fz + d[2] * 0.3
      j.dx = d[0]
      j.dy = d[1] * 0.6
      j.dz = d[2]
      j.len = Math.max(2, Math.min(9, dist + 0.8))
      j.spread = deluge ? 0.3 : hand ? 0.2 : 0.17
      j.size = deluge ? 1.35 : hand ? 0.95 : 1.15
      j.rate = deluge ? 170 : 135
      // a hot continuous core down the middle of the stream
      e.beam(false, j.mx, j.my, j.mz, j.mx + j.dx * j.len * 0.85, j.my + j.dy * j.len * 0.85, j.mz + j.dz * j.len * 0.85, 0.5 * j.size, 1.5 * j.size, 0.5, 0.2, F.BEAM, hex('#ffc060'), 0, dur, 0.7)
    }
    // ignition at the nozzle
    glow(e, a.fx + d[0] * 0.3, a.fy, a.fz + d[2] * 0.3, 1.2, 2.4, 0.22, '#fff0b0', '#ff7a1a', 0.9)
    star(e, a.fx + d[0] * 0.3, a.fy, a.fz + d[2] * 0.3, 1.2, 0.12, '#fff6c8', '#ffb347')
    e.light(a.fx + d[0] * 1.2, a.fy + 0.2, a.fz + d[2] * 1.2, '#ff8a2a', 1.7, dur + 0.15, 0, true)
  }
  const delay = a.secondary ? 0.05 : arrive
  const gx = a.tx
  const gz = a.tz
  if (hit || a.secondary) {
    // the stream reaches the target: a gout of fire around it, embers, smoke; then it burns
    glow(e, gx, a.ty, gz, 2.4, 4, 0.5, '#ffd070', '#c42a08', 0.85, delay)
    glow(e, gx, a.floorY + 0.1, gz, 0.4, 0.9, 0.25, '#fff6c8', '#ffb347', 1, delay, F.CORE)
    for (let i = 0; i < e.n(8); i++) {
      const s = e.begin(L.ADD, F.FLAME)
      s.at(gx + e.rr(-0.3, 0.3), a.floorY + e.rr(0.1, 0.6), gz + e.rr(-0.3, 0.3)).vel(e.rr(-0.5, 0.5), e.rr(1.2, 2.4), e.rr(-0.5, 0.5))
      s.born += delay + e.rr(0, 0.18)
      s.life = e.rr(0.4, 0.7)
      s.s0 = 0.6
      s.s1 = 1.4
      s.a0 = 0.9
      s.a1 = 0
      s.hold = 0.2
      s.rot = e.rr(-0.4, 0.4)
      s.drag = 0.7
      s.col('#ffe58a', '#d1300a')
      e.commit()
    }
    radialSparks(e, gx, a.ty, gz, 10, 1.5, 5, 0.9, 5, '#ffe090', '#ff4a10', 0.045, delay)
    smoke(e, gx, a.ty, gz, 2, 0.4, 1.3, 1.3, 0.35, '#4a4640', '#262626', delay + 0.1, 0, 0.9, 0, 0.3)
    e.light(gx, a.ty, gz, '#ff8a2a', 2.2, 0.6, delay, true)
    // every target the flames reach burns for two to three seconds
    e.burn(a.targetId, gx, a.floorY, gz, a.height, e.rr(2.0, 2.9), delay, deluge ? 1.2 : 1)
    e.shake(0.02, 0.18, delay)
  } else {
    // the stream falls short / wide: a lick of ground fire
    const ex = a.tx + e.rr(-1.4, 1.4)
    const ez = a.tz + e.rr(-1.4, 1.4)
    glow(e, ex, a.floorY + 0.15, ez, 1.2, 2, 0.4, '#ffd070', '#c42a08', 0.6, delay)
    groundRing(e, ex, a.floorY, ez, 0.2, 1.1, 0.4, '#ff8a2a', 0.5, delay)
    for (let i = 0; i < e.n(4); i++) {
      const s = e.begin(L.ADD, F.FLAME)
      s.at(ex + e.rr(-0.3, 0.3), a.floorY + 0.1, ez + e.rr(-0.3, 0.3)).vel(0, e.rr(0.8, 1.6), 0)
      s.born += delay + e.rr(0, 0.15)
      s.life = e.rr(0.4, 0.7)
      s.s0 = 0.5
      s.s1 = 0.9
      s.a0 = 0.8
      s.a1 = 0
      s.col('#ffe58a', '#d1300a')
      e.commit()
    }
  }
  return { duration: a.secondary ? 0.45 : dur, first: delay }
}

// ---------------------------------------------------------------- explosive

/** The big one: flash, fireball, shockwave, sparks, debris, lingering dust and smoke, scorch, light and a camera thump. */
export function explosion(e: FxEngine, x: number, floorY: number, z: number, size: number, delay = 0, o: { shake?: boolean; scorch?: boolean; crit?: boolean } = {}): void {
  const s = size
  e.kick()
  e.noteExplosion(delay)
  const y = floorY + 0.7 * Math.min(1.3, s)
  // flash: brief, white-hot
  glow(e, x, y, z, 3.4 * s, 6 * s, 0.11, '#ffeec0', '#ffb347', 0.6, delay)
  star(e, x, y, z, 7 * s, 0.18, '#fff0c8', '#ff9a30', delay, e.rr(0, 3))
  glow(e, x, y, z, 1.3 * s, 2.2 * s, 0.16, '#fff6d8', '#ffd070', 0.8, delay, F.CORE)
  // fireball: a big orange body, a yellow heart and billowing flame tongues thrown outward
  glow(e, x, y + 0.3 * s, z, 3.6 * s, 7.4 * s, 0.7, '#ff8a28', '#7a1204', 0.75, delay)
  glow(e, x, y + 0.2 * s, z, 2.4 * s, 5 * s, 0.5, '#ffc060', '#e5330a', 0.7, delay)
  for (let i = 0; i < e.n(13); i++) {
    const a = e.rnd() * Math.PI * 2
    const sp = e.rr(1.6, 5) * s
    const f = e.begin(L.ADD, i % 3 === 0 ? F.GLOW : F.FLAME)
    f.at(x + Math.cos(a) * 0.3 * s, y + e.rr(-0.3, 0.5) * s, z + Math.sin(a) * 0.3 * s).vel(Math.cos(a) * sp, e.rr(0.6, 3.6) * s, Math.sin(a) * sp)
    f.born += delay + e.rr(0, 0.07)
    f.life = e.rr(0.5, 0.95)
    f.s0 = 2 * s
    f.s1 = e.rr(3.6, 5.4) * s
    f.a0 = 0.78
    f.a1 = 0
    f.hold = 0.25
    f.rot = e.rr(-0.5, 0.5)
    f.spin = e.rr(-1.2, 1.2)
    f.drag = 2.2
    f.grav = -1.5
    f.col(i % 3 === 0 ? '#ffd880' : '#ff9a30', i % 2 ? '#c42a08' : '#6a1004')
    e.commit()
  }
  // shockwave: a ring racing over the mat, a slower ember ring and a ring of kicked-up dust
  groundRing(e, x, floorY, z, 0.6 * s, 9 * s, 0.55, '#ffd8a0', 0.6, delay)
  groundRing(e, x, floorY, z, 0.4 * s, 6.5 * s, 0.75, '#ff8a30', 0.5, delay + 0.04)
  groundRing(e, x, floorY, z, 0.8 * s, 8.5 * s, 1.1, '#c4b494', 0.3, delay + 0.05, false)
  // sparks
  radialSparks(e, x, y, z, 24, 5 * s, 14 * s, 0.85, 14, '#fff2b0', '#ff5a10', 0.07, delay)
  // debris chunks
  debris(e, x, y, z, 10, 2.5 * s, 7 * s, 9 * s, 0.34 * s, '#7a6a55', 1.2, delay)
  debris(e, x, y, z, 5, 2 * s, 5 * s, 6.5 * s, 0.22 * s, '#3a3a40', 1.1, delay)
  // lingering dust cloud + dark smoke column
  dustPuffs(e, x, floorY, z, 10, 4.2 * s, 1.3 * s, 3.5 * s, 2.5, 0.55, '#c4b494', delay, 0.5)
  smoke(e, x, y, z, 8, 1.4 * s, 3.8 * s, 2.4, 0.66, '#6a6560', '#2a2a2a', delay + 0.05, 0, 1.7 * s, 0, 0.9 * s)
  smoke(e, x, y + 0.6 * s, z, 4, 1.1 * s, 2.9 * s, 3, 0.52, '#4a4640', '#1c1c1c', delay + 0.25, 0, 1.4, 0, 0.35)
  // scorch decal on the mat
  if (o.scorch !== false) {
    const sc = e.begin(L.FLAT_NORM, F.SCORCH)
    sc.at(x, floorY + 0.03, z)
    sc.born += delay + 0.03
    sc.life = 7
    sc.s0 = 3.4 * s
    sc.s1 = 5 * s
    sc.a0 = 0.6
    sc.a1 = 0
    sc.hold = 0.55
    sc.rot = e.rnd() * 6.28
    sc.atk = 0.02
    sc.col('#101010')
    e.commit()
  }
  // ground glow
  const g = e.begin(L.FLAT_ADD, F.GLOW)
  g.at(x, floorY + 0.05, z)
  g.born += delay
  g.life = 0.6
  g.s0 = 6 * s
  g.s1 = 10 * s
  g.a0 = 0.9
  g.a1 = 0
  g.col('#ff9a30', '#8a2208')
  e.commit()
  e.light(x, y + 0.5, z, '#ffb050', 4.4 * s, 0.55, delay)
  if (o.shake !== false) e.shake((o.crit ? 0.34 : 0.26) * Math.min(1.3, s), 0.5, delay, 34)
}

function fireExplosive(e: FxEngine, a: VolleyArgs): VolleyInfo {
  const v = a.variant
  const dist = Math.hypot(a.tx - a.fx, a.tz - a.fz)
  const d = unit(a.tx - a.fx, a.ty - a.fy, a.tz - a.fz)
  const px = -d[2]
  const pz = d[0]
  const pl = Math.hypot(px, pz) || 1
  const sx = px / pl
  const sz = pz / pl
  const anyHit = a.kinds.some((k) => k !== FAIL)
  const crit = a.kinds.includes(CRIT)
  const sizes: Record<string, number> = { rokkit: 1.7, frag: 1.3, krak: 1.1, boom: 1.45, dynamite: 1.25 }
  let size = (sizes[v] ?? 0.9) * (crit ? 1.2 : 1)
  if (a.secondary) size *= 0.55
  // a whiff lands the blast beside the target
  let ex = a.tx
  let ez = a.tz
  if (!anyHit) {
    const off = (1.3 + e.rnd() * 0.6) * e.sgn()
    ex += sx * off
    ez += sz * off
    size *= 0.82
  }
  let land = 0.05
  if (!a.secondary) {
    const rocket = v === 'rokkit'
    const p = e.proj()
    const launcher = v === 'rokkit' || ((v === 'frag' || v === 'krak') && dist > 5)
    const dur = rocket ? Math.max(0.36, Math.min(0.62, dist / 20)) : Math.max(0.42, Math.min(0.62, 0.3 + dist / 28))
    if (p) {
      p.kind = rocket ? PK.ROCKET : v === 'dynamite' || v === 'boom' ? PK.STICK : PK.GRENADE
      p.t0 = e.t() + 0.04
      p.dur = dur
      p.fx = a.fx + d[0] * 0.4
      p.fy = a.fy
      p.fz = a.fz + d[2] * 0.4
      p.tx = ex
      p.ty = a.floorY + 0.5
      p.tz = ez
      p.sx = sx
      p.sz = sz
      p.arc = rocket ? 0.35 + dist * 0.04 : 0.9 + dist * 0.28
      p.size = v === 'krak' ? 0.9 : 1
      p.afterglow = 0
    }
    land = 0.04 + dur
    // launch: backblast and smoke plume for the launchers, a throwing flick for the rest
    if (launcher || rocket) {
      glow(e, a.fx + d[0] * 0.4, a.fy, a.fz + d[2] * 0.4, 1.4, 2.4, 0.14, '#fff0c0', '#ff9a30', 0.95, 0.04)
      star(e, a.fx + d[0] * 0.3, a.fy, a.fz + d[2] * 0.3, 1.8, 0.1, '#ffffff', '#ffb347', 0.04)
      smoke(e, a.fx - d[0] * 0.2, a.fy - 0.05, a.fz - d[2] * 0.2, rocket ? 5 : 3, 0.3, 1.3, 1.4, 0.55, '#e0dcd4', '#7a7a7a', 0.04, -d[0] * 1.6, 0.25, -d[2] * 1.6, 0.6)
      e.light(a.fx + d[0] * 0.5, a.fy, a.fz + d[2] * 0.5, '#ffa040', 1.4, 0.18, 0.04)
    } else {
      glow(e, a.fx + d[0] * 0.3, a.fy, a.fz + d[2] * 0.3, 0.6, 1.1, 0.12, '#fff2c0', '#ffb347', 0.7, 0.04)
    }
  }
  explosion(e, ex, a.floorY, ez, size, land, { crit })
  return { duration: land + 0.1, first: land }
}

// ---------------------------------------------------------------- shokka (electric)

function arcBurst(e: FxEngine, x: number, y: number, z: number, floorY: number, n: number, reach: number, delay: number, life: number): void {
  const gl = hex('#4f9bff')
  const co = hex('#e8fbff')
  for (let i = 0; i < e.n(n); i++) {
    const ang = (i / n) * Math.PI * 2 + e.rr(-0.4, 0.4)
    const toGround = i % 2 === 0
    lightning(e, x, y, z, x + Math.cos(ang) * reach, toGround ? floorY + 0.05 : y + e.rr(-0.4, 0.6), z + Math.sin(ang) * reach, 4, 0.28, 0.2, 0.06, gl, co, delay, life)
  }
}

function fireShokka(e: FxEngine, a: VolleyArgs): VolleyInfo {
  const d = unit(a.tx - a.fx, a.ty - a.fy, a.tz - a.fz)
  const px = -d[2]
  const pz = d[0]
  const pl = Math.hypot(px, pz) || 1
  const hit = a.kinds.some((k) => k !== FAIL)
  const crit = a.kinds.includes(CRIT)
  const mx = a.fx + d[0] * 0.4
  const mz = a.fz + d[2] * 0.4
  const glowC = hex('#4f9bff')
  const coreC = hex('#e8fbff')
  const dist = Math.hypot(a.tx - a.fx, a.tz - a.fz)
  let ex = a.tx
  let ey = a.ty
  let ez = a.tz
  if (!hit) {
    const off = (0.9 + e.rnd()) * e.sgn()
    ex += (px / pl) * off + d[0] * 2
    ez += (pz / pl) * off + d[2] * 2
    ey = a.floorY + 0.08
  }
  if (!a.secondary) {
    star(e, mx, a.fy, mz, 1.8, 0.14, '#ffffff', '#4f9bff')
    glow(e, mx, a.fy, mz, 1.6, 2.4, 0.2, '#bff0ff', '#4f9bff', 0.9)
    e.light(mx, a.fy, mz, '#6fb0ff', 1.3, 0.3, 0, true)
    for (let i = 0; i < e.n(3); i++) {
      lightning(e, mx, a.fy, mz, mx + e.rr(-0.6, 0.6), a.fy + e.rr(-0.4, 0.5), mz + e.rr(-0.6, 0.6), 3, 0.12, 0.14, 0.05, glowC, coreC, 0, 0.08)
    }
  }
  // the main arc flickers three times, re-routed each time
  const flick = e.quality < 0.5 ? 2 : 3
  const segs = Math.max(6, Math.round(dist * 1.6))
  const jit = Math.min(0.55, 0.18 + dist * 0.03)
  for (let k = 0; k < flick; k++) {
    const dl = k * 0.075
    if (!a.secondary) lightning(e, mx, a.fy, mz, ex, ey, ez, segs, jit, 0.3, 0.09, glowC, coreC, dl, 0.09)
    if (hit) arcBurst(e, ex, ey, ez, a.floorY, 4, 1.15, dl + 0.02, 0.08)
    else arcBurst(e, ex, ey, ez, a.floorY, 2, 0.8, dl + 0.02, 0.08)
  }
  if (hit) {
    glow(e, ex, ey, ez, 2.2, 3.4, 0.3, '#bff0ff', '#2a60ff', 0.9, 0.02)
    star(e, ex, ey, ez, 2.6 * (crit ? 1.3 : 1), 0.22, '#ffffff', '#4f9bff', 0.02, e.rr(0, 3))
    radialSparks(e, ex, ey, ez, 14, 2, 7, 0.55, 8, '#d8f6ff', '#4f9bff', 0.05, 0.03)
    groundRing(e, ex, a.floorY, ez, 0.3, 2, 0.3, '#4f9bff', 0.7, 0.03)
    e.light(ex, ey, ez, '#6fb0ff', 2, 0.35, 0.02, true)
    e.shake(0.03, 0.2, 0.03)
  } else {
    glow(e, ex, ey, ez, 0.8, 1.5, 0.2, '#bff0ff', '#2a60ff', 0.7, 0.02)
    radialSparks(e, ex, ey, ez, 6, 1.5, 5, 0.4, 8, '#d8f6ff', '#4f9bff', 0.045, 0.03)
  }
  return { duration: 0.28, first: 0.02 }
}

// ---------------------------------------------------------------- harpoon + knives

function fireHarpoon(e: FxEngine, a: VolleyArgs): VolleyInfo {
  const d = unit(a.tx - a.fx, a.ty - a.fy, a.tz - a.fz)
  const px = -d[2]
  const pz = d[0]
  const pl = Math.hypot(px, pz) || 1
  const hit = a.kinds.some((k) => k !== FAIL)
  const dur = 0.24
  let ex = a.tx
  let ey = a.ty
  let ez = a.tz
  if (!hit) {
    const off = (0.9 + e.rnd() * 0.6) * e.sgn()
    ex += (px / pl) * off + d[0] * 2.4
    ez += (pz / pl) * off + d[2] * 2.4
    ey = a.floorY + 0.12
  }
  const mx = a.fx + d[0] * 0.4
  const mz = a.fz + d[2] * 0.4
  // the gun: a thump of compressed gas
  glow(e, mx, a.fy, mz, 1.1, 1.8, 0.1, '#dfe8f0', '#7a8a9a', 0.8)
  smoke(e, mx, a.fy, mz, 2, 0.22, 0.9, 0.9, 0.45, '#e4e8ec', '#8a9098', 0, d[0] * 1.2, 0.2, d[2] * 1.2, 0.3)
  const p = e.proj()
  if (p) {
    p.kind = PK.HARPOON
    p.t0 = e.t()
    p.dur = dur
    p.fx = mx
    p.fy = a.fy
    p.fz = mz
    p.tx = ex
    p.ty = ey
    p.tz = ez
    p.afterglow = 0
  }
  // the cable stays slack for a moment after the barb lands
  e.beam(true, mx, a.fy - 0.02, mz, ex, ey, ez, 0.085, 0.085, 1, 1, F.EDGE, hex('#b8c0cc'), dur, 0.8, 0.6)
  if (hit) {
    // the barb stays in the target for a moment, cable still taut
    const b = e.begin(L.NORM, F.DEBRIS)
    b.at(ex, ey, ez)
    b.born += dur
    b.life = 1.1
    b.s0 = b.s1 = 0.5
    b.a0 = 1
    b.a1 = 0
    b.hold = 0.75
    b.atk = 0
    b.rot = Math.atan2(d[0], d[2])
    b.col('#8a929e', '#5a626e')
    e.commit()
    sparks(e, ex, ey, ez, 8, 2, 6, 0.35, 12, '#e8f4ff', '#ffb347', -d[0], 0.5, -d[2], 0.7, 0.05, dur)
    glow(e, ex, ey, ez, 1.2, 2, 0.16, '#e8f4ff', '#9fb4d0', 0.85, dur)
    star(e, ex, ey, ez, 1.8, 0.18, '#ffffff', '#9fb4d0', dur)
    dustPuffs(e, ex, a.floorY, ez, 3, 1.2, 0.3, 0.9, 0.7, 0.4, '#b8a98c', dur)
    e.shake(0.05, 0.18, dur)
  } else {
    sparks(e, ex, ey, ez, 5, 2, 6, 0.3, 12, '#e8f4ff', '#ffb347', 0, 0.8, 0, 0.8, 0.045, dur)
    dustPuffs(e, ex, ey - 0.06, ez, 3, 1.2, 0.3, 0.9, 0.7, 0.45, '#b8a98c', dur)
  }
  return { duration: dur, first: dur }
}

function fireKnives(e: FxEngine, a: VolleyArgs): VolleyInfo {
  const d = unit(a.tx - a.fx, a.ty - a.fy, a.tz - a.fz)
  const px = -d[2]
  const pz = d[0]
  const pl = Math.hypot(px, pz) || 1
  const sx = px / pl
  const sz = pz / pl
  const n = Math.min(4, Math.max(1, a.kinds.length))
  const anyHit = a.kinds.some((k) => k !== FAIL)
  let first = Infinity
  let last = 0
  for (let i = 0; i < n; i++) {
    const kind = i < a.kinds.length ? a.kinds[i]! : anyHit ? NORMAL : FAIL
    const hit = kind !== FAIL
    const delay = i * 0.08 + e.rr(0, 0.02)
    const dur = 0.27
    let ex = a.tx + sx * e.rr(-0.2, 0.2)
    let ey = a.ty + e.rr(-0.2, 0.25)
    let ez = a.tz + sz * e.rr(-0.2, 0.2)
    if (!hit) {
      const off = (0.8 + e.rnd() * 0.8) * e.sgn()
      ex += sx * off + d[0] * 1.8
      ez += sz * off + d[2] * 1.8
      ey = a.floorY + 0.08
    }
    // the flick of the wrist
    glow(e, a.fx + d[0] * 0.3, a.fy, a.fz + d[2] * 0.3, 0.6, 1, 0.1, '#e8f4ff', '#9fd4ff', 0.6, delay)
    const p = e.proj()
    if (p) {
      p.kind = PK.KNIFE
      p.t0 = e.t() + delay
      p.dur = dur
      p.fx = a.fx + d[0] * 0.3
      p.fy = a.fy
      p.fz = a.fz + d[2] * 0.3
      p.tx = ex
      p.ty = ey
      p.tz = ez
      p.sx = sx
      p.sz = sz
      p.arc = 0.6 + e.rnd() * 0.5
      p.bend = e.rr(-0.5, 0.5)
      p.size = 1
      const c = hex('#ffffff')
      const g = hex('#9fd4ff')
      p.cr = c[0]
      p.cg = c[1]
      p.cb = c[2]
      p.gr = g[0]
      p.gg = g[1]
      p.gb = g[2]
      p.afterglow = 0
    }
    const land = delay + dur
    if (hit) {
      sparks(e, ex, ey, ez, 5, 2, 6, 0.3, 10, '#ffffff', '#9fd4ff', -d[0], 0.4, -d[2], 0.8, 0.045, land)
      star(e, ex, ey, ez, kind === CRIT ? 2.4 : 1.5, 0.16, '#ffffff', '#9fd4ff', land, e.rr(0, 3))
      glow(e, ex, ey, ez, 1.1, 1.6, 0.14, '#e8f4ff', '#9fd4ff', 0.8, land)
    } else {
      sparks(e, ex, ey, ez, 4, 2, 5, 0.3, 12, '#ffffff', '#9fd4ff', 0, 0.8, 0, 0.8, 0.04, land)
      dustPuffs(e, ex, ey - 0.05, ez, 2, 0.8, 0.2, 0.6, 0.5, 0.4, '#b8a98c', land)
    }
    if (i === 0) first = land
    last = Math.max(last, land)
  }
  return { duration: last, first }
}

// ---------------------------------------------------------------- the volley entry point

export function fireVolley(e: FxEngine, a: VolleyArgs): VolleyInfo {
  e.kick()
  switch (a.family) {
    case 'bolt':
    case 'slugga':
      return fireTracers(e, a)
    case 'plasma':
      return firePlasma(e, a)
    case 'flame':
      return fireFlame(e, a)
    case 'explosive':
      return fireExplosive(e, a)
    case 'shokka':
      return fireShokka(e, a)
    case 'harpoon':
      return fireHarpoon(e, a)
    case 'knives':
      return fireKnives(e, a)
    default:
      return { duration: 0, first: 0 }
  }
}

// ---------------------------------------------------------------- melee

export interface StrikeArgs {
  family: VfxFamily
  variant: string
  /** attacker position (ground) and target chest / floor / height */
  ax: number
  az: number
  tx: number
  ty: number
  tz: number
  floorY: number
  height: number
  crit: boolean
  /** 0, 1, 2 ... within one fight, alternates the slash direction */
  index: number
}

function setBasis(s: Sweep, dirx: number, dirz: number, roll: number): void {
  // The slash plane leans back toward the attacker (so a camera looking down sees a crescent, not an edge) and is
  // then rolled around its normal for a diagonal cut. S runs across the attack, W is the plane's "up".
  const l = Math.hypot(dirx, dirz) || 1
  const dx = dirx / l
  const dz = dirz / l
  const beta = 0.95
  const sx0 = -dz
  const sz0 = dx
  const wx0 = -dx * Math.sin(beta)
  const wy0 = Math.cos(beta)
  const wz0 = -dz * Math.sin(beta)
  const c = Math.cos(roll)
  const sn = Math.sin(roll)
  s.sx = sx0 * c + wx0 * sn
  s.sy = wy0 * sn
  s.sz = sz0 * c + wz0 * sn
  s.wx = -sx0 * sn + wx0 * c
  s.wy = wy0 * c
  s.wz = -sz0 * sn + wz0 * c
}

interface SweepStyle {
  R: number
  width: number
  dur: number
  core: string
  glowC: string
  sparks: boolean
  energy: boolean
  tail: number
}
const SWEEPS: Record<string, SweepStyle> = {
  chain: { R: 1.45, width: 0.4, dur: 0.2, core: '#fff8e0', glowC: '#ffa030', sparks: true, energy: false, tail: 0.75 },
  power: { R: 1.55, width: 0.4, dur: 0.21, core: '#f0fcff', glowC: '#40c8ff', sparks: false, energy: true, tail: 0.78 },
  choppa: { R: 1.45, width: 0.42, dur: 0.21, core: '#f4f8ff', glowC: '#8fa8c8', sparks: false, energy: false, tail: 0.7 },
  big: { R: 1.9, width: 0.62, dur: 0.25, core: '#fff4dc', glowC: '#d8a850', sparks: false, energy: false, tail: 0.7 },
  twin: { R: 1.3, width: 0.34, dur: 0.17, core: '#f4f8ff', glowC: '#8fa8c8', sparks: false, energy: false, tail: 0.7 },
  grot: { R: 1.05, width: 0.28, dur: 0.17, core: '#eef2f6', glowC: '#8a98a8', sparks: false, energy: false, tail: 0.7 },
}

function startSweep(e: FxEngine, st: SweepStyle, a: StrikeArgs, delay: number, flip: number, tiltBase: number): void {
  const s = e.sweep()
  if (!s) return
  s.t0 = e.t() + delay
  s.dur = st.dur
  const dx = a.tx - a.ax
  const dz = a.tz - a.az
  const l = Math.hypot(dx, dz) || 1
  s.cx = a.tx - (dx / l) * 0.5
  s.cy = a.ty
  s.cz = a.tz - (dz / l) * 0.5
  setBasis(s, dx, dz, tiltBase + e.rr(-0.2, 0.2))
  s.R = st.R * (a.crit ? 1.2 : 1)
  s.lift = 0.55
  s.a0 = -1.75 * flip
  s.a1 = 1.75 * flip
  s.width = st.width * (a.crit ? 1.3 : 1)
  s.tailFrac = st.tail
  const c = hex(st.core)
  const g = hex(st.glowC)
  s.cr = c[0]
  s.cg = c[1]
  s.cb = c[2]
  s.gr = g[0]
  s.gg = g[1]
  s.gb = g[2]
  s.sparks = st.sparks
  s.energy = st.energy
}

/** The red mark left on whoever was cut or crushed: a slash for blades, a starburst for blunt weapons. */
export function mark(e: FxEngine, kind: 'slash' | 'bash', x: number, y: number, z: number, size: number, delay: number): void {
  const m = e.begin(L.NORM, kind === 'slash' ? F.SLASH : F.BASH)
  m.at(x + e.rr(-0.12, 0.12), y + e.rr(-0.1, 0.15), z + e.rr(-0.12, 0.12))
  m.born += delay
  m.life = 2.4
  m.s0 = size * 0.78
  m.s1 = size
  m.a0 = 1
  m.a1 = 0
  m.hold = 0.4
  m.atk = 0.02
  m.rot = kind === 'slash' ? e.rr(-0.5, 0.5) : e.rr(-0.4, 0.4)
  m.col('#ff2a1a', '#d01808')
  e.commit()
  glow(e, x, y, z, size * 1.1, size * 1.9, 0.3, '#ff3a2a', '#a01008', 0.55, delay)
}

function strikeBlade(e: FxEngine, a: StrikeArgs): void {
  const st = SWEEPS[a.variant] ?? SWEEPS.choppa!
  const flip = a.index % 2 === 0 ? 1 : -1
  const tilt = (a.index % 2 === 0 ? 0.55 : -0.55) + (a.variant === 'big' ? 0.3 : 0)
  startSweep(e, st, a, 0, flip, tilt)
  if (a.variant === 'twin') startSweep(e, st, a, 0.07, -flip, -tilt)
  const hitAt = st.dur * 0.55
  const dirx = a.tx - a.ax
  const dirz = a.tz - a.az
  const l = Math.hypot(dirx, dirz) || 1
  const dx = dirx / l
  const dz = dirz / l
  const m = a.crit ? 1.5 : 1
  // metal on armour / flesh
  sparks(e, a.tx, a.ty, a.tz, (a.variant === 'chain' ? 14 : 8) * m, 3, 9, 0.4, 12, st.core, st.glowC, -dx, 0.5, -dz, 0.8, 0.05, hitAt)
  glow(e, a.tx, a.ty, a.tz, 1.3 * m, 2 * m, 0.16, st.glowC, st.glowC, 0.8, hitAt)
  star(e, a.tx, a.ty, a.tz, (a.crit ? 2.8 : 1.6), 0.18, st.core, st.glowC, hitAt, e.rr(0, 3))
  if (st.energy) {
    // power weapons: a burst of crackling energy around the cut
    glow(e, a.tx, a.ty, a.tz, 2.4 * m, 3.4 * m, 0.34, '#d8f6ff', '#58d8ff', 0.8, hitAt)
    for (let i = 0; i < e.n(4); i++) {
      const ang = e.rnd() * 6.28
      lightning(e, a.tx, a.ty, a.tz, a.tx + Math.cos(ang) * 0.9, a.ty + e.rr(-0.5, 0.6), a.tz + Math.sin(ang) * 0.9, 3, 0.16, 0.14, 0.05, hex('#58d8ff'), hex('#f0fcff'), hitAt + e.rr(0, 0.08), 0.09)
    }
    e.light(a.tx, a.ty, a.tz, '#58d8ff', 1.8, 0.3, hitAt)
  }
  if (a.variant === 'chain') e.light(a.tx, a.ty, a.tz, '#ffb347', 1.3, 0.2, hitAt)
  if (a.variant === 'big') e.shake(0.06, 0.2, hitAt)
  mark(e, 'slash', a.tx, a.ty, a.tz, a.crit ? 4.2 : a.variant === 'big' ? 3.8 : a.variant === 'grot' ? 2.5 : 3.3, hitAt + 0.02)
}

interface CrushStyle {
  scale: number
  color: string
  ring: string
  shake: number
  swing: string
  dust: number
  lightning: boolean
  chips: number
}
const CRUSH: Record<string, CrushStyle> = {
  fist: { scale: 1, color: '#ffd9a0', ring: '#ffe6b8', shake: 0.12, swing: '#e8e0d0', dust: 7, lightning: false, chips: 4 },
  thunder: { scale: 1.15, color: '#9fdcff', ring: '#8ad0ff', shake: 0.17, swing: '#bfe6ff', dust: 6, lightning: true, chips: 5 },
  klaw: { scale: 1.1, color: '#ffb347', ring: '#ffc878', shake: 0.14, swing: '#e0c090', dust: 7, lightning: false, chips: 6 },
  ram: { scale: 1.25, color: '#e0d2a8', ring: '#e8dcc0', shake: 0.2, swing: '#d6c9a8', dust: 10, lightning: false, chips: 9 },
  fists: { scale: 0.7, color: '#ffe0c0', ring: '#ffe6d0', shake: 0.05, swing: '#e8e0d0', dust: 4, lightning: false, chips: 1 },
  bite: { scale: 0.7, color: '#ffb0a0', ring: '#ffc4b8', shake: 0.04, swing: '#ffd0c8', dust: 2, lightning: false, chips: 0 },
}

function strikeCrush(e: FxEngine, a: StrikeArgs): void {
  const st = CRUSH[a.variant] ?? CRUSH.fist!
  const k = st.scale * (a.crit ? 1.3 : 1)
  const delay = a.variant === 'bite' ? 0.04 : 0.1
  // the swing itself: a short heavy crescent
  const sw = e.sweep()
  if (sw) {
    sw.t0 = e.t()
    sw.dur = delay + 0.03
    const dx = a.tx - a.ax
    const dz = a.tz - a.az
    const l = Math.hypot(dx, dz) || 1
    sw.cx = a.tx - (dx / l) * 0.55
    sw.cy = a.ty
    sw.cz = a.tz - (dz / l) * 0.55
    setBasis(sw, dx, dz, a.index % 2 ? 0.2 : -0.2)
    sw.R = 1.0 * st.scale
    sw.lift = 0.15
    sw.a0 = -1.4
    sw.a1 = 1.2
    sw.width = 0.34 * st.scale
    sw.tailFrac = 0.4
    const c = hex(st.swing)
    sw.cr = c[0]
    sw.cg = c[1]
    sw.cb = c[2]
    const g = hex(st.color)
    sw.gr = g[0]
    sw.gg = g[1]
    sw.gb = g[2]
    sw.sparks = false
    sw.energy = false
  }
  const x = a.tx
  const y = a.ty
  const z = a.tz
  // heavy impact flash
  glow(e, x, y, z, 3 * k, 4.6 * k, 0.15, st.color, st.color, 0.55, delay)
  star(e, x, y, z, 3.2 * k, 0.2, '#fff4e0', st.color, delay, e.rr(0, 3))
  glow(e, x, y, z, 1.1 * k, 1.8 * k, 0.14, '#fff6e8', '#ffe0b0', 0.8, delay, F.CORE)
  billboardRing(e, x, y + 0.2, z, 0.3, 1.8 * k, 0.28, '#ffffff', st.ring, 0.55, delay)
  // ground dust ring + puffs
  groundRing(e, x, a.floorY, z, 0.3, 2.6 * k, 0.4, st.ring, 0.7, delay)
  groundRing(e, x, a.floorY, z, 0.4, 2.5 * k, 0.7, '#c4b494', 0.4, delay + 0.02, false)
  dustPuffs(e, x, a.floorY, z, st.dust, 2.4 * k, 0.4, 1.5 * k, 0.9, 0.5, '#c4b494', delay)
  if (st.chips > 0) debris(e, x, a.floorY + 0.3, z, st.chips, 1.5, 4, 5, 0.12, '#7a6a55', 0.7, delay)
  sparks(e, x, y, z, 8 * k, 2, 8, 0.4, 12, '#fff2c0', st.color, 0, 0.7, 0, 1, 0.05, delay)
  if (st.lightning) {
    // thunder hammer: lightning cracks out of the blow
    const gl = hex('#58a8ff')
    const co = hex('#f0fcff')
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < e.n(4); i++) {
        const ang = (i / 4) * 6.28 + e.rr(-0.4, 0.4)
        lightning(e, x, y, z, x + Math.cos(ang) * 1.9, e.rnd() < 0.5 ? a.floorY + 0.05 : y + e.rr(-0.3, 0.8), z + Math.sin(ang) * 1.9, 5, 0.3, 0.22, 0.07, gl, co, delay + r * 0.07, 0.09)
      }
    }
    e.light(x, y, z, '#6fb0ff', 2.6, 0.35, delay, true)
  } else {
    e.light(x, y + 0.2, z, st.color, 1.8 * k, 0.22, delay)
  }
  e.shake(st.shake * (a.crit ? 1.4 : 1), 0.24, delay, 44)
  mark(e, 'bash', x, y, z, (a.crit ? 3.6 : 2.9) * st.scale, delay + 0.02)
}

export function strike(e: FxEngine, a: StrikeArgs): void {
  e.kick()
  if (a.family === 'blade') strikeBlade(e, a)
  else strikeCrush(e, a)
}

/** Fight block: weapons meet. A ring of sparks and a hard flare. */
export function parry(e: FxEngine, x: number, y: number, z: number, crit: boolean): void {
  e.kick()
  const k = crit ? 1.35 : 1
  star(e, x, y, z, 2.6 * k, 0.2, '#ffffff', '#ffe6a0', 0, e.rr(0, 3))
  glow(e, x, y, z, 1.6 * k, 2.6 * k, 0.16, '#fff6d0', '#ffb347', 0.95)
  glow(e, x, y, z, 0.6, 1, 0.1, '#ffffff', '#ffffff', 1, 0, F.CORE)
  billboardRing(e, x, y, z, 0.2, 1.7 * k, 0.24, '#ffffff', '#ffd070', 0.9)
  radialSparks(e, x, y, z, 16 * k, 3, 9, 0.45, 10, '#ffffff', '#ffb347', 0.05)
  e.light(x, y, z, '#ffd070', 1.4, 0.16)
  e.shake(0.04, 0.12, 0, 50)
}

/** A cover save / armour save stops attack dice: a shimmer of hexagons on the defender. */
export function shield(e: FxEngine, x: number, y: number, z: number, count: number, cover: boolean): void {
  e.kick()
  const c0 = cover ? '#8ff0ff' : '#ffe9a8'
  const c1 = cover ? '#2a8cff' : '#ffb347'
  const n = Math.min(3, Math.max(1, count))
  for (let i = 0; i < n; i++) {
    const s = e.begin(L.ADD, F.HEX)
    s.at(x + e.rr(-0.12, 0.12), y + e.rr(-0.1, 0.12), z + e.rr(-0.12, 0.12))
    s.born += i * 0.09
    s.life = 0.5
    s.s0 = 1.2
    s.s1 = cover ? 2.3 : 1.9
    s.a0 = 0.95
    s.a1 = 0
    s.hold = 0.15
    s.rot = e.rr(-0.5, 0.5)
    s.col(c0, c1)
    e.commit()
    radialSparks(e, x, y, z, cover ? 3 : 5, 1.5, cover ? 3.5 : 6, 0.3, 6, c0, c1, 0.04, i * 0.09)
  }
  glow(e, x, y, z, 1.6, 2.8, 0.3, c0, c1, 0.7)
  billboardRing(e, x, y, z, 0.6, 1.9, 0.34, c0, c1, 0.8)
  e.light(x, y, z, c1, 1.1, 0.25)
}

/** Blood / oil mist and droplets where a wound opens. */
export function flesh(e: FxEngine, x: number, y: number, z: number, dx: number, dz: number, amount: number, crit: boolean, tone: string, floorY: number): void {
  e.kick()
  const l = Math.hypot(dx, dz) || 1
  const ux = dx / l
  const uz = dz / l
  const n = Math.min(10, 3 + amount + (crit ? 3 : 0))
  smoke(e, x, y, z, n, 0.4, 1.15, 0.8, 0.7, tone, '#2a0505', 0, ux * 1.8, 0.6, uz * 1.8, 0.9)
  const k = e.n(Math.min(14, 4 + amount * 2 + (crit ? 4 : 0)))
  for (let i = 0; i < k; i++) {
    const sp = e.rr(1.5, 4.2)
    const s = e.begin(L.NORM, F.DROP)
    s.at(x, y + e.rr(-0.1, 0.2), z).vel((ux + e.rr(-0.7, 0.7)) * sp, e.rr(1, 3.2), (uz + e.rr(-0.7, 0.7)) * sp)
    s.life = e.rr(0.4, 0.7)
    s.s0 = e.rr(0.16, 0.26)
    s.s1 = s.s0 * 0.7
    s.a0 = 1
    s.a1 = 0.6
    s.atk = 0
    s.hold = 0.6
    s.grav = 12
    s.col(tone, '#4a0505')
    e.commit()
  }
  // a splat on the mat
  const sp = e.begin(L.FLAT_NORM, F.SCORCH)
  sp.at(x + ux * e.rr(0.4, 1.0), floorY + 0.03, z + uz * e.rr(0.4, 1.0))
  sp.born += 0.12
  sp.life = 6
  sp.s0 = sp.s1 = 0.7 + amount * 0.12
  sp.a0 = 0.55
  sp.a1 = 0
  sp.hold = 0.6
  sp.rot = e.rnd() * 6.28
  sp.col(tone)
  e.commit()
}

/** The teeth of a chainsword biting: a shower of sparks, in step with its hit sound. */
export function chainBurst(e: FxEngine, x: number, y: number, z: number): void {
  e.kick()
  radialSparks(e, x, y, z, 14, 2.5, 8, 0.5, 11, '#fff2b0', '#ff7a1a', 0.06)
  glow(e, x, y, z, 1.2, 2, 0.16, '#ffb347', '#ff7a1a', 0.7)
  e.light(x, y, z, '#ffb347', 1.0, 0.18)
}

/** Heavy wound burst for a devastating hit. */
export function devastate(e: FxEngine, x: number, y: number, z: number): void {
  e.kick()
  star(e, x, y, z, 3.8, 0.3, '#fff2d0', '#ff4a20', 0, e.rr(0, 3))
  glow(e, x, y, z, 2.4, 4.4, 0.3, '#ffb040', '#a01008', 0.9)
  billboardRing(e, x, y, z, 0.3, 3, 0.34, '#ffe0a0', '#ff4a20', 0.9)
  radialSparks(e, x, y, z, 16, 3, 10, 0.6, 12, '#fff2b0', '#ff3a10', 0.06)
  e.shake(0.1, 0.25, 0, 40)
}

/** A flat expanding ring (targeting, fight clash, objective control). */
export function ring(e: FxEngine, x: number, y: number, z: number, color: string, size: number, life: number, inward = false): void {
  e.kick()
  groundRing(e, x, y, z, inward ? size : 0.3, inward ? 0.3 : size, life, color, 0.9)
  const s = e.begin(L.FLAT_ADD, F.GLOW)
  s.at(x, y + 0.03, z)
  s.life = life
  s.s0 = size * 0.6
  s.s1 = size * 1.5
  s.a0 = 0.25
  s.a1 = 0
  s.col(color)
  e.commit()
}

/** Weapons raised at the start of a fight: a glint, and the family's tell. */
export function fightIntro(e: FxEngine, family: VfxFamily, variant: string, x: number, y: number, z: number, toward: [number, number]): void {
  e.kick()
  const hx = x + toward[0] * 0.5
  const hz = z + toward[1] * 0.5
  if (family === 'blade') {
    star(e, hx, y, hz, 1.1, 0.25, '#ffffff', variant === 'power' ? '#58d8ff' : '#ffe6a0', 0, e.rr(0, 3))
    if (variant === 'chain') {
      sparks(e, hx, y, hz, 8, 2, 6, 0.4, 10, '#fff2b0', '#ff7a1a', 0, 0.6, 0, 1, 0.045)
      smoke(e, hx, y, hz, 1, 0.15, 0.5, 0.7, 0.3, '#9a9a9a', '#5a5a5a', 0, 0, 0.4, 0)
    }
    if (variant === 'power') glow(e, hx, y, hz, 0.8, 1.6, 0.4, '#d8f6ff', '#58d8ff', 0.8)
  } else if (variant === 'thunder') {
    lightning(e, hx, y, hz, hx + e.rr(-0.5, 0.5), y + e.rr(-0.3, 0.5), hz + e.rr(-0.5, 0.5), 3, 0.15, 0.14, 0.05, hex('#58a8ff'), hex('#f0fcff'), 0, 0.1)
    glow(e, hx, y, hz, 0.8, 1.8, 0.35, '#9fdcff', '#4a8cff', 0.7)
  } else {
    glow(e, hx, y, hz, 0.6, 1.2, 0.25, '#ffe6b8', '#ffb347', 0.5)
  }
}

/** An explosion with no shooter (a mine going off). */
export function blastAt(e: FxEngine, x: number, floorY: number, z: number, size: number): void {
  e.kick()
  explosion(e, x, floorY, z, size, 0)
}

/** What happens to a figure that goes down: a puff of mist, dust or fire matching how it died. */
export function death(e: FxEngine, style: 'slump' | 'burn' | 'blast' | 'topple', id: string, x: number, floorY: number, z: number, h: number, dx: number, dz: number, tone: string): void {
  e.kick()
  const l = Math.hypot(dx, dz) || 1
  const ux = dx / l
  const uz = dz / l
  const cy = floorY + h * 0.5
  switch (style) {
    case 'slump':
      flesh(e, x, cy, z, ux, uz, 4, true, tone, floorY)
      dustPuffs(e, x, floorY, z, 4, 0.9, 0.3, 1, 0.9, 0.4, '#b8a98c', 0.35)
      break
    case 'burn':
      e.burn(id, x, floorY, z, h, 2.1, 0, 1.7)
      smoke(e, x, floorY + h, z, 4, 0.5, 1.8, 1.9, 0.5, '#3a3834', '#1c1c1c', 0.3, 0, 1.4, 0, 0.3)
      break
    case 'blast':
      explosion(e, x, floorY, z, 0.5, 0, { shake: false, scorch: true })
      debris(e, x, cy, z, 4, 1.5, 4, 6, 0.16, '#6a5a48', 0.9, 0.05)
      flesh(e, x, cy, z, ux, uz, 5, true, tone, floorY)
      break
    default:
      dustPuffs(e, x + ux * 0.3, floorY, z + uz * 0.3, 6, 1.6, 0.4, 1.3, 0.9, 0.45, '#b8a98c', 0.4)
      groundRing(e, x + ux * 0.3, floorY, z + uz * 0.3, 0.3, 1.6, 0.5, '#c4b494', 0.4, 0.4, false)
      flesh(e, x, cy, z, ux, uz, 3, false, tone, floorY)
      break
  }
}

/** Small spark burst when an operative becomes injured. */
export function wound(e: FxEngine, x: number, y: number, z: number): void {
  e.kick()
  radialSparks(e, x, y, z, 10, 1.5, 5, 0.5, 9, '#fff2b0', '#ff5a10', 0.05)
  glow(e, x, y, z, 1.2, 2, 0.2, '#ffd070', '#ff5a10', 0.7)
}

/** Burning status starts now (for the gallery and the director). */
export function ignite(e: FxEngine, id: string, x: number, floorY: number, z: number, h: number): void {
  e.kick()
  e.burn(id, x, floorY, z, h, e.rr(2.0, 2.9), 0, 1)
}

// ---------------------------------------------------------------- layer inventory

const COMMON_RANGED: FxLayer[] = ['muzzle', 'projectile', 'impact']
/** Which layers each family's recipe actually provides. Kept next to the code that implements them. */
export const LAYERS: Record<VfxFamily, readonly FxLayer[]> = {
  bolt: [...COMMON_RANGED, 'miss', 'flesh', 'trail'],
  plasma: [...COMMON_RANGED, 'trail', 'light', 'shake'],
  flame: ['muzzle', 'stream', 'impact', 'burning', 'light', 'miss'],
  explosive: ['projectile', 'trail', 'explosion', 'shockwave', 'debris', 'dust', 'scorch', 'shake', 'light', 'miss'],
  slugga: [...COMMON_RANGED, 'miss', 'flesh', 'trail'],
  shokka: ['muzzle', 'arc', 'impact', 'light', 'miss'],
  harpoon: [...COMMON_RANGED, 'miss', 'trail'],
  knives: ['projectile', 'impact', 'miss', 'trail'],
  blade: ['arc', 'impact', 'mark', 'light'],
  crush: ['impact', 'mark', 'shockwave', 'dust', 'shake', 'light', 'arc', 'debris'],
}

/** Layers a family is required to have but the recipes lack (empty when complete). */
export function missingLayers(family: VfxFamily): FxLayer[] {
  return REQUIRED_LAYERS[family].filter((l) => !LAYERS[family].includes(l))
}

export type { Proj }
