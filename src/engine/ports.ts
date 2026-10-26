// Ports from the board and movement code to the attack code that lands in S3a. A rule in S2 that must cause a hit (a door
// closing on a fighter, a booby-trapped casket) calls the port; `hits.ts` registers the real resolver in S3a. Until one is
// registered the call reports `false` and does nothing, so S2 tests can register a spy and S3a replaces it.
import type { Ctx } from './registry'
import type { Vec2 } from './types'

/** One hit on one fighter, resolved with the normal wound / save / damage sequence (R-11). */
export interface HitSpec {
  targetId: string
  strength: number
  ap: number
  damage: number
  /** 'door' | 'casket' | 'blaze' | ... for the log */
  source: string
  /** saves are allowed unless a rule says otherwise */
  saves?: boolean
}

/** A Blast marker with no hit roll: every fighter under it takes the hit, ranged-pinned (R-9.5). */
export interface BlastSpec {
  centre: Vec2
  radius: number
  strength: number
  ap: number
  damage: number
  source: string
  knockback?: boolean
}

type HitPort = (ctx: Ctx, spec: HitSpec) => void
type BlastPort = (ctx: Ctx, spec: BlastSpec) => void

let hitPort: HitPort | null = null
let blastPort: BlastPort | null = null

export function registerHitPort(fn: HitPort | null): void {
  hitPort = fn
}

export function registerBlastPort(fn: BlastPort | null): void {
  blastPort = fn
}

/** Resolve a hit; false when no resolver is registered (before S3a). */
export function resolveHit(ctx: Ctx, spec: HitSpec): boolean {
  if (!hitPort) return false
  hitPort(ctx, spec)
  return true
}

/** Resolve a blast without a hit roll; false when no resolver is registered (before S3a). */
export function resolveBlast(ctx: Ctx, spec: BlastSpec): boolean {
  if (!blastPort) return false
  blastPort(ctx, spec)
  return true
}
