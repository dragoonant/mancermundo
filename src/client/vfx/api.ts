// What the presentation director calls: operative-level wrappers around the recipes. They turn engine operatives
// (positions, heights, facing) into effect coordinates, look the weapon up in the family table and keep the
// operative roster the status effects (burning, injured) follow.
import type { GameState, Operative } from '@/engine'
import { factionOf } from '../audio/eventSounds'
import { animPosition } from '../presentation/animStore'
import { speedFactor } from '../presentation/settings'
import { deathStyleFor, vfxOf, type DeathStyle, type VfxFamily } from './families'
import { fx, lowFx, noteSpawn, syncQuality } from './instance'
import * as R from './recipes'

type DieKind = 'fail' | 'normal' | 'crit'
const KIND: Record<DieKind, number> = { fail: R.FAIL, normal: R.NORMAL, crit: R.CRIT }

export const chestY = (op: Operative): number => op.pos.y + op.height * 0.55
const muzzleY = (op: Operative): number => op.pos.y + op.height * 0.6

/** Blood / oil colour by who is bleeding. */
export function toneFor(state: GameState | null, id: string): string {
  switch (factionOf(state, id)) {
    case 'marine':
      return '#a50f0f'
    case 'ork':
      return '#7d1a0f'
    case 'grot':
      return '#5e7a14'
    case 'squig':
      return '#c23a1e'
    default:
      return '#8a1010'
  }
}

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
export function volley(shooter: Operative, target: Operative, weaponId: string, kinds: DieKind[], secondary: boolean, inCover: boolean, onImpact?: (die: number) => void): VolleyTimes {
  begin()
  const v = vfxOf(weaponId)
  const dx = target.pos.x - shooter.pos.x
  const dz = target.pos.z - shooter.pos.z
  const l = Math.hypot(dx, dz) || 1
  const info = R.fireVolley(fx, {
    family: v.family,
    variant: v.variant,
    fx: shooter.pos.x + (dx / l) * 0.5,
    fy: muzzleY(shooter),
    fz: shooter.pos.z + (dz / l) * 0.5,
    tx: target.pos.x,
    ty: chestY(target),
    tz: target.pos.z,
    floorY: target.pos.y,
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
export function strike(attacker: Operative, target: Operative, weaponId: string | null, crit: boolean, index: number): void {
  begin()
  const v = vfxOf(weaponId)
  R.strike(fx, {
    family: v.family,
    variant: v.variant,
    ax: attacker.pos.x,
    az: attacker.pos.z,
    tx: target.pos.x,
    ty: chestY(target),
    tz: target.pos.z,
    floorY: target.pos.y,
    height: target.height,
    crit,
    index,
  })
}

export function parry(blocker: Operative, other: Operative | null, crit: boolean): void {
  begin()
  const ox = other ? other.pos.x : blocker.pos.x
  const oz = other ? other.pos.z : blocker.pos.z
  R.parry(fx, (blocker.pos.x + ox) / 2, blocker.pos.y + blocker.height * 0.6, (blocker.pos.z + oz) / 2, crit)
}

export function shield(target: Operative, count: number, cover: boolean): void {
  begin()
  R.shield(fx, target.pos.x, chestY(target), target.pos.z, count, cover)
}

export function flesh(target: Operative, from: { x: number; z: number } | null, amount: number, crit: boolean, tone: string): void {
  begin()
  R.flesh(fx, target.pos.x, chestY(target), target.pos.z, from ? target.pos.x - from.x : 0, from ? target.pos.z - from.z : 1, amount, crit, tone, target.pos.y)
}

export function devastate(target: Operative): void {
  begin()
  R.devastate(fx, target.pos.x, chestY(target), target.pos.z)
}

export function wound(op: Operative): void {
  begin()
  R.wound(fx, op.pos.x, chestY(op), op.pos.z)
  if (ambientOn()) fx.injured(op.id, true, op.pos.x, op.pos.y, op.pos.z, op.height)
}

export interface DeathPlan {
  style: DeathStyle
  /** local-space direction the body is pushed (x right, z front of the figure) */
  dx: number
  dz: number
}

/** Plays the death effect and returns the kill animation to hand to the figure cue. */
export function death(target: Operative, family: VfxFamily | null, from: { x: number; z: number } | null, tone: string): DeathPlan {
  begin()
  const style = deathStyleFor(family ?? 'crush')
  const wx = from ? target.pos.x - from.x : 0
  const wz = from ? target.pos.z - from.z : -1
  const l = Math.hypot(wx, wz) || 1
  const ux = wx / l
  const uz = wz / l
  R.death(fx, style, target.id, target.pos.x, target.pos.y, target.pos.z, target.height, ux, uz, tone)
  // world -> the figure's local frame (rotation.y = facing, local +z = front)
  const c = Math.cos(target.facing)
  const s = Math.sin(target.facing)
  return { style, dx: ux * c - uz * s, dz: ux * s + uz * c }
}

export function ring(x: number, y: number, z: number, color: string, size: number, life: number, inward = false): void {
  begin()
  R.ring(fx, x, y, z, color, size, life, inward)
}

export function fightIntro(a: Operative, d: Operative, aWeapon: string | null, dWeapon: string | null): void {
  begin()
  const l = Math.hypot(d.pos.x - a.pos.x, d.pos.z - a.pos.z) || 1
  const ux = (d.pos.x - a.pos.x) / l
  const uz = (d.pos.z - a.pos.z) / l
  if (aWeapon) {
    const v = vfxOf(aWeapon)
    R.fightIntro(fx, v.family, v.variant, a.pos.x, a.pos.y + a.height * 0.6, a.pos.z, [ux, uz])
  }
  if (dWeapon) {
    const v = vfxOf(dWeapon)
    R.fightIntro(fx, v.family, v.variant, d.pos.x, d.pos.y + d.height * 0.6, d.pos.z, [-ux, -uz])
  }
}

export function blastAt(op: Operative, size = 0.9): void {
  begin()
  R.blastAt(fx, op.pos.x, op.pos.y, op.pos.z, size)
}

export function chainBurst(op: Operative): void {
  begin()
  R.chainBurst(fx, op.pos.x, chestY(op), op.pos.z)
}

export function hotFlash(op: Operative): void {
  begin()
  R.devastate(fx, op.pos.x, chestY(op), op.pos.z)
}

// ---------------------------------------------------------------- roster (burning / injured follow the figure)

const roster = new Map<string, { x: number; y: number; z: number; h: number }>()

fx.resolve = (id, out) => {
  const a = animPosition(id)
  const r = roster.get(id)
  if (a) {
    out.x = a.x
    out.y = a.y
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

/** Keep the status emitters in step with the displayed state: injured operatives drip, positions follow moves. */
export function syncRoster(state: GameState | null): void {
  roster.clear()
  if (!state) return
  for (const op of Object.values(state.operatives)) {
    if (op.status !== 'active') {
      fx.injured(op.id, false)
      continue
    }
    roster.set(op.id, { x: op.pos.x, y: op.pos.y, z: op.pos.z, h: op.height })
    if (op.flags.injured && ambientOn()) {
      if (!fx.isInjured(op.id)) fx.injured(op.id, true, op.pos.x, op.pos.y, op.pos.z, op.height)
    } else fx.injured(op.id, false)
  }
  if (fx.ambient()) fx.kick()
}

export function resetFx(): void {
  fx.reset()
  roster.clear()
}
