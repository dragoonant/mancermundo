// What the presentation director calls: fighter-level wrappers around the recipes. They turn engine fighters (positions, heights,
// facing) into effect coordinates, look the weapon up in the family table and keep the fighter roster the status effects
// (the Seriously Injured drip) follow.
import type { GameState } from '@/engine'
import { heightOf } from '../lab/placement'
import { animPosition } from '../presentation/animStore'
import { speedFactor } from '../presentation/settings'
import { deathStyleFor, vfxOf, type DeathStyle, type VfxFamily } from './families'
import { fx, lowFx, noteSpawn, syncQuality } from './instance'
import * as R from './recipes'

type DieKind = 'fail' | 'normal' | 'crit'
const KIND: Record<DieKind, number> = { fail: R.FAIL, normal: R.NORMAL, crit: R.CRIT }

/** A fighter as the effects see it: where its feet are, how tall it is, which way it faces. */
export interface Body {
  id: string
  x: number
  y: number
  z: number
  height: number
  facing: number
}

/** The body of a fighter in the state, or null when it is not there. */
export function bodyOf(state: GameState, id: string): Body | null {
  const f = state.fighters[id]
  return f ? { id, x: f.pos.x, y: f.pos.y, z: f.pos.z, height: heightOf(f.role), facing: f.facing } : null
}

export const chestY = (b: Body): number => b.y + b.height * 0.55
const muzzleY = (b: Body): number => b.y + b.height * 0.6

/** Blood colour of whoever is bleeding. */
export const BLOOD = '#8a1010'

function begin(): void {
  syncQuality()
  noteSpawn()
}

/** Volley timings plus, per attack die, the seconds until its tracer lands (index = die). */
export interface VolleyTimes extends R.VolleyInfo {
  impacts: number[]
}

/** Seconds until each of `n` tracers lands, spread evenly from the first impact to the last. */
export function impactTimes(n: number, first: number, duration: number): number[] {
  const f = Number.isFinite(first) ? first : duration
  return Array.from({ length: n }, (_, i) => (n <= 1 ? f : f + ((duration - f) * i) / (n - 1)))
}

/**
 * A shooter fires one volley at a target; returns the timings. `onImpact(die)` (optional) is called once per attack
 * die when its tracer arrives (timers, so it also runs when the effects layer is paused or not drawing).
 */
export function volley(
  state: GameState | null,
  shooter: Body,
  target: Body,
  weapon: { id: string; profileId?: string | null },
  kinds: DieKind[],
  secondary: boolean,
  inCover: boolean,
  onImpact?: (die: number) => void,
): VolleyTimes {
  begin()
  const v = vfxOf(state, weapon.id, weapon.profileId)
  const dx = target.x - shooter.x
  const dz = target.z - shooter.z
  const l = Math.hypot(dx, dz) || 1
  const info = R.fireVolley(fx, {
    family: v.family,
    variant: v.variant,
    fx: shooter.x + (dx / l) * 0.5,
    fy: muzzleY(shooter),
    fz: shooter.z + (dz / l) * 0.5,
    tx: target.x,
    ty: chestY(target),
    tz: target.z,
    floorY: target.y,
    height: target.height,
    targetId: target.id,
    kinds: kinds.map((k) => KIND[k]),
    secondary,
    inCover,
  })
  const impacts = impactTimes(kinds.length, info.first, info.duration)
  if (onImpact) {
    impacts.forEach((t, die) => {
      setTimeout(() => {
        try {
          onImpact(die)
        } catch (err) {
          console.warn('[vfx] volley impact callback failed', err)
        }
      }, Math.max(0, Math.round(t * 1000)))
    })
  }
  return { ...info, impacts }
}

/** One melee blow landing (a strike die). */
export function strike(state: GameState | null, attacker: Body, target: Body, weapon: { id: string | null }, crit: boolean, index: number): void {
  begin()
  const v = vfxOf(state, weapon.id)
  R.strike(fx, {
    family: v.family,
    variant: v.variant,
    ax: attacker.x,
    az: attacker.z,
    tx: target.x,
    ty: chestY(target),
    tz: target.z,
    floorY: target.y,
    height: target.height,
    crit,
    index,
  })
}

export function parry(blocker: Body, other: Body | null, crit: boolean): void {
  begin()
  const ox = other ? other.x : blocker.x
  const oz = other ? other.z : blocker.z
  R.parry(fx, (blocker.x + ox) / 2, blocker.y + blocker.height * 0.6, (blocker.z + oz) / 2, crit)
}

export function shield(target: Body, count: number, cover: boolean): void {
  begin()
  R.shield(fx, target.x, chestY(target), target.z, count, cover)
}

export function flesh(target: Body, from: { x: number; z: number } | null, amount: number, crit: boolean, tone: string = BLOOD): void {
  begin()
  R.flesh(fx, target.x, chestY(target), target.z, from ? target.x - from.x : 0, from ? target.z - from.z : 1, amount, crit, tone, target.y)
}

export function devastate(target: Body): void {
  begin()
  R.devastate(fx, target.x, chestY(target), target.z)
}

export function wound(b: Body): void {
  begin()
  R.wound(fx, b.x, chestY(b), b.z)
  if (ambientOn()) fx.injured(b.id, true, b.x, b.y, b.z, b.height)
}

export interface DeathPlan {
  style: DeathStyle
  /** local-space direction the body is pushed (x right, z front of the figure) */
  dx: number
  dz: number
}

/** Plays the death effect and returns the kill animation to hand to the figure cue. */
export function death(target: Body, family: VfxFamily | null, from: { x: number; z: number } | null, tone: string = BLOOD): DeathPlan {
  begin()
  const style = deathStyleFor(family ?? 'crush')
  const wx = from ? target.x - from.x : 0
  const wz = from ? target.z - from.z : -1
  const l = Math.hypot(wx, wz) || 1
  const ux = wx / l
  const uz = wz / l
  R.death(fx, style, target.id, target.x, target.y, target.z, target.height, ux, uz, tone)
  // world -> the figure's local frame (rotation.y = facing, local +z = front)
  const c = Math.cos(target.facing)
  const s = Math.sin(target.facing)
  return { style, dx: ux * c - uz * s, dz: ux * s + uz * c }
}

export function ring(x: number, y: number, z: number, color: string, size: number, life: number, inward = false): void {
  begin()
  R.ring(fx, x, y, z, color, size, life, inward)
}

export function fightIntro(state: GameState | null, a: Body, d: Body, aWeapon: string | null, dWeapon: string | null): void {
  begin()
  const l = Math.hypot(d.x - a.x, d.z - a.z) || 1
  const ux = (d.x - a.x) / l
  const uz = (d.z - a.z) / l
  if (aWeapon) {
    const v = vfxOf(state, aWeapon)
    R.fightIntro(fx, v.family, v.variant, a.x, a.y + a.height * 0.6, a.z, [ux, uz])
  }
  if (dWeapon) {
    const v = vfxOf(state, dWeapon)
    R.fightIntro(fx, v.family, v.variant, d.x, d.y + d.height * 0.6, d.z, [-ux, -uz])
  }
}

/** A blast burst on the floor at (x, z); `size` 0.9 is a grenade, bigger for a rocket. */
export function blastAt(x: number, floorY: number, z: number, size = 0.9): void {
  begin()
  R.blastAt(fx, x, floorY, z, size)
}

/** A flame template laid on the floor: the stream and burn are the volley's; this is the scorched patch and light. */
export function chainBurst(b: Body): void {
  begin()
  R.chainBurst(fx, b.x, chestY(b), b.z)
}

export function hotFlash(b: Body): void {
  begin()
  R.devastate(fx, b.x, chestY(b), b.z)
}

// ---------------------------------------------------------------- roster (burning / injured follow the figure)

const roster = new Map<string, { x: number; y: number; z: number; h: number }>()

fx.resolve = (id, out) => {
  const a = animPosition(id)
  const r = roster.get(id)
  if (a) {
    out.x = a.x
    out.y = r?.y ?? 0
    out.z = a.z
    out.h = r?.h ?? 1.2
    return true
  }
  if (!r) return false
  out.x = r.x
  out.y = r.y
  out.z = r.z
  out.h = r.h
  return true
}

/**
 * Persistent effects (the injured drip) keep the demand-driven board redrawing a few times a second, so they are off in
 * instant mode (no effects at all, as in the tests) and on the low-graphics path.
 */
function ambientOn(): boolean {
  return speedFactor() > 0 && !lowFx()
}

/** Keep the status emitters in step with the displayed state: Seriously Injured fighters drip, positions follow moves. */
export function syncRoster(state: GameState | null): void {
  roster.clear()
  if (!state) return
  for (const f of Object.values(state.fighters)) {
    if (f.location !== 'board') {
      fx.injured(f.id, false)
      continue
    }
    roster.set(f.id, { x: f.pos.x, y: f.pos.y, z: f.pos.z, h: heightOf(f.role) })
    if (f.posture === 'seriouslyInjured' && ambientOn()) {
      if (!fx.isInjured(f.id)) fx.injured(f.id, true, f.pos.x, f.pos.y, f.pos.z, heightOf(f.role))
    } else fx.injured(f.id, false)
  }
  if (fx.ambient()) fx.kick()
}

export function resetFx(): void {
  fx.reset()
  roster.clear()
}

/** The fighter catches fire (Blaze): the burning emitter follows it for a few seconds. */
export function ignite(b: Body): void {
  begin()
  R.ignite(fx, b.id, b.x, b.y, b.z, b.height)
}
