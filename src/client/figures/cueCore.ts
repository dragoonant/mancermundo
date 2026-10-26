// Rigid whole-body cues, pure maths and a tiny trigger store with no store imports (so the presentation director
// can trigger them at its own beats without an import cycle). `cues.ts` re-exports this and feeds it from the event log.
// Deaths come in four styles chosen by the weapon that did it: slump (bullets), burn down (flame), knocked back
// (blast, plasma, lightning) and topple (blades, fists).
export type CueKind = 'shoot' | 'melee' | 'hit' | 'death'
export type DeathStyle = 'slump' | 'burn' | 'blast' | 'topple'

export const CUE_MS: Record<CueKind, number> = { shoot: 240, melee: 380, hit: 300, death: 900 }
/** Length of the death animation per style (ms); a styled death also keeps its corpse on the board that long. */
export const DEATH_MS: Record<DeathStyle, number> = { topple: 900, slump: 1100, burn: 1900, blast: 1300 }

interface Active {
  kind: CueKind
  t0: number
}
export interface DeathInfo {
  style: DeathStyle
  /** local-space unit vector (x right, z front) pointing away from whatever killed it */
  dx: number
  dz: number
}

const active = new Map<string, Active>()
const dead = new Map<string, number>()
const deathInfo = new Map<string, DeathInfo>()
/** cues the director already played at their beat: the end-of-step feed must not replay them */
const beat = new Map<string, number>()
const BEAT_WINDOW_MS = 6000

/** Turning toward a target for the length of an attack: yaw offset from the figure's facing, eased in and out. */
interface Aim {
  yaw: number
  t0: number
  hold: number
}
const aims = new Map<string, Aim>()
const AIM_RISE_MS = 110
const AIM_FALL_MS = 240

export type CueSource = 'feed' | 'beat'

export function triggerCue(id: string, kind: CueKind, now = performance.now(), src: CueSource = 'feed'): void {
  const key = `${id}:${kind}`
  if (src === 'feed') {
    const b = beat.get(key)
    if (b !== undefined && now - b < BEAT_WINDOW_MS) return
  } else beat.set(key, now)
  if (kind === 'death') {
    if (!dead.has(id)) dead.set(id, now)
  } else if (!dead.has(id)) active.set(id, { kind, t0: now })
  repaint()
}

let repaint: () => void = () => {}
/** The cue feed wires this to the board's repaint request. */
export function setCueRepaint(fn: () => void): void {
  repaint = fn
}

export function setDeathStyle(id: string, info: DeathInfo): void {
  if (!dead.has(id)) deathInfo.set(id, info)
}
/** Turn `id` by `yaw` radians (relative to its facing) for `holdMs`, starting now. */
export function aimCue(id: string, yaw: number, holdMs: number, now = performance.now()): void {
  if (dead.has(id)) return
  const cur = aims.get(id)
  // a fresh aim while one is held keeps the figure turned instead of snapping back first
  aims.set(id, { yaw, t0: cur && now - cur.t0 < AIM_RISE_MS + cur.hold ? Math.min(now, cur.t0 + AIM_RISE_MS) - AIM_RISE_MS : now, hold: holdMs })
  repaint()
}

export function clearCues(): void {
  aims.clear()
  active.clear()
  dead.clear()
  deathInfo.clear()
  beat.clear()
}
export const isDying = (id: string): boolean => dead.has(id)
export const deathAge = (id: string, now = performance.now()): number => (dead.has(id) ? now - dead.get(id)! : -1)
export const deathMs = (id: string): number => DEATH_MS[deathInfo.get(id)?.style ?? 'topple']
export const cueActive = (id: string, now = performance.now()): boolean => {
  const a = active.get(id)
  const m = aims.get(id)
  return dead.has(id) || (!!a && now - a.t0 < CUE_MS[a.kind]) || (!!m && now - m.t0 < AIM_RISE_MS + m.hold + AIM_FALL_MS)
}

export interface CuePose {
  /** local offset (inches): +z forward, +x right */
  dx: number
  dy: number
  dz: number
  /** pitch about X (positive tips the head forward), yaw about Y (turning toward a target), roll about Z */
  rx: number
  ry: number
  rz: number
  /** uniform y squash used for breathing, and the burn-down collapse */
  sy: number
  /** 0 = gone .. 1 = fully visible (death sink-and-shrink stands in for a fade) */
  vis: number
}

const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

/** Pose for one figure. `walking` adds the bob, `phase` de-syncs idle breathing between figures. */
export function cuePose(id: string, now: number, walking: boolean, phase = 0): CuePose {
  const p: CuePose = { dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0, sy: 1 + 0.012 * Math.sin(now / 520 + phase), vis: 1 }
  const m = aims.get(id)
  if (m && !walking && !dead.has(id)) {
    const t = now - m.t0
    let k = 0
    if (t >= 0 && t < AIM_RISE_MS) k = smooth(t / AIM_RISE_MS)
    else if (t < AIM_RISE_MS + m.hold) k = 1
    else if (t < AIM_RISE_MS + m.hold + AIM_FALL_MS) k = 1 - smooth((t - AIM_RISE_MS - m.hold) / AIM_FALL_MS)
    else aims.delete(id)
    p.ry = m.yaw * k
  }
  if (walking) {
    const s = Math.sin(now / 90)
    p.dy += Math.abs(s) * 0.045
    p.rz += s * 0.05
    p.rx += 0.04
  }
  const d = dead.get(id)
  if (d !== undefined) {
    const info = deathInfo.get(id)
    const style: DeathStyle | null = info?.style ?? null
    const t = (now - d) / DEATH_MS[style ?? 'topple']
    if (!info || style === 'topple') {
      // topple: fall away from the blow when known, else backwards; then sink and shrink
      const k = smooth(clamp01(t / 0.6)) * (Math.PI / 2)
      if (info) {
        p.rx = k * info.dz
        p.rz = -k * info.dx
        p.dx = info.dx * 0.3 * smooth(clamp01(t / 0.5))
        p.dz = info.dz * 0.3 * smooth(clamp01(t / 0.5))
      } else p.rx = -k
      p.dy -= Math.max(0, (t - 0.6) / 0.4) * 0.5
      p.vis = 1 - smooth(clamp01((t - 0.6) / 0.4))
    } else if (style === 'slump') {
      // bullets: the knees go, the body folds forward and settles
      const a = smooth(clamp01(t / 0.55))
      p.rx = 0.85 * a
      p.dy -= 0.5 * smooth(clamp01(t / 0.7))
      p.dz += 0.12 * a
      p.vis = 1 - smooth(clamp01((t - 0.72) / 0.28))
    } else if (style === 'burn') {
      // flame: it staggers, curls and burns down to a smoulder
      const a = smooth(clamp01(t / 0.8))
      p.sy *= 1 - 0.85 * a
      p.rx = 0.35 * a + 0.04 * Math.sin(now / 55) * (1 - a)
      p.rz = 0.08 * Math.sin(now / 70) * (1 - a)
      p.vis = 1 - smooth(clamp01((t - 0.88) / 0.12))
    } else {
      // blast: thrown clear, tumbling, landing hard
      const u = clamp01(t / 0.5)
      const e = 1 - (1 - u) * (1 - u)
      const reach = 2.2
      p.dx = info!.dx * reach * e
      p.dz = info!.dz * reach * e
      p.dy += 1.3 * 4 * u * (1 - u)
      const k = smooth(clamp01(t / 0.5)) * Math.PI * 0.95
      p.rx = k * info!.dz
      p.rz = -k * info!.dx
      p.vis = 1 - smooth(clamp01((t - 0.75) / 0.25))
    }
    return p
  }
  const a = active.get(id)
  if (a) {
    const t = (now - a.t0) / CUE_MS[a.kind]
    if (t >= 1) active.delete(id)
    else {
      const bump = Math.sin(Math.PI * t) // 0 -> 1 -> 0
      if (a.kind === 'shoot') {
        p.dz -= 0.07 * bump
        p.rx -= 0.14 * bump
      } else if (a.kind === 'melee') {
        p.dz += 0.28 * bump
        p.rx += 0.3 * bump
      } else {
        p.dz -= 0.09 * bump
        p.rz += 0.18 * Math.sin(Math.PI * 3 * t) * (1 - t)
        p.rx -= 0.12 * bump
      }
    }
  }
  return p
}
