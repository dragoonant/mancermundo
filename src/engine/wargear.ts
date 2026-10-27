// Wargear (R-11.3 to R-11.6, R-9.7, R-14.4; 13-gangs 6.1): the armour save. One armour item provides the save (the best one
// for this attack when a fighter somehow carries several); `saveMods` improve it against attacks from the front arc
// (Furnace plates, Heavy carapace) or against Blasts and Templates (Flak); combined armour with a `modifySave` effect
// (Armoured undersuit) adds to it, a fighter with no armour counting as 7+; Blast and Template cover adds +1 / +2 (R-9.7,
// never to field armour, which v1 does not have). The weapon's AP is added to the roll, so it raises the need. Grenades
// are weapons (class `grenade`) and are handled by shoot.ts; wargear code hooks (bio-booster, stimms ...) arrive in S4K.
import { runHook } from './hooks'
import { inVisionArc, ARC_HALF } from './los'
import { angleDelta } from './footprint'
import { saveFloor } from './skills/stance'
import type { Fighter, GameState, Vec2 } from './types'

export interface SaveModifier {
  label: string
  value: number
}

export interface SaveInfo {
  /** final need on the D6 (natural 1 always fails); null = no save at all; above 6 = no roll (R-11.4) */
  need: number | null
  /** the armour item that provides the save (null when the save comes only from a bonus on 7+) */
  item: string | null
  /** the printed save of that item (7 when none) */
  base: number | null
  modifiers: SaveModifier[]
}

export interface SaveContext {
  /** the weapon's AP (0 or negative) */
  ap: number
  /** where the attack comes from (front-arc armour), or null */
  from?: Fighter | Vec2 | null
  /** Blast or Template attacks (flak, cover bonus) */
  vs?: 'blast' | 'template' | null
  /** R-9.7 cover bonus (partial +1, full +2) against Blasts and Templates */
  coverBonus?: number
}

function effectList(effect: unknown): Record<string, unknown>[] {
  if (!effect) return []
  if (Array.isArray(effect)) return effect.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
  if (typeof effect === 'object') return [effect as Record<string, unknown>]
  return []
}

/** Combined-armour save improvement (`modifySave`) from the fighter's wargear. */
function combinedBonus(state: GameState, f: Fighter): { value: number; item: string | null } {
  let value = 0
  let item: string | null = null
  for (const id of f.wargear) {
    const g = state.data.wargear[id]
    if (!g || g.kind === 'armour') continue
    for (const e of effectList(g.effect)) {
      const m = e.modifySave as { value?: number } | undefined
      if (m && typeof m.value === 'number') {
        value += m.value
        item = id
      }
    }
  }
  return { value, item }
}

/** Is the attack coming from the target's front (its vision arc)? A Prone fighter has no front arc. */
function fromFront(target: Fighter, from: Fighter | Vec2 | null | undefined): boolean {
  if (!from || target.posture !== 'standing') return false
  if ('id' in from) return inVisionArc(target, from)
  const bearing = Math.atan2(from.x - target.pos.x, from.z - target.pos.z)
  if (Math.hypot(from.x - target.pos.x, from.z - target.pos.z) <= target.baseRadius) return true
  return Math.abs(angleDelta(target.facing, bearing)) <= ARC_HALF + 1e-9
}

/** An invulnerable save a skill grants on top of the armour save (Dodge): unmodifiable, never ignored (S4K-A `save.extra`). */
export interface ExtraSave {
  /** the code hook that grants it (counted as fired when it saves) */
  code: string
  item: string
  need: number
}

export interface ExtraSaveContext {
  /** a fighter made the attack (environmental hits never allow Dodge) */
  attackerId: string | null
  /** a close combat attack */
  melee: boolean
  /** Blast and Template hits are handled before the hit (Dodge steps clear instead of saving) */
  vs: 'blast' | 'template' | null
}

/** The extra saves the target gets against one hit, in order (the `save.extra` hook; pure, so odds can call it). */
export function extraSaves(state: GameState, target: Fighter, sc: ExtraSaveContext): ExtraSave[] {
  const data = { extras: [] as ExtraSave[], attacker: sc.attackerId !== null, melee: sc.melee, vs: sc.vs }
  runHook('save.extra', { seat: target.seat, state, fighterId: target.id, ...(sc.attackerId ? { targetId: sc.attackerId } : {}), data })
  return data.extras
}

/** The save a fighter makes against one hit (R-11.3 to R-11.6, R-9.7). */
export function armourSave(state: GameState, target: Fighter, sc: SaveContext): SaveInfo {
  const front = fromFront(target, sc.from)
  // best armour item for this attack
  let best: { id: string; base: number; mods: SaveModifier[]; total: number } | null = null
  for (const id of target.wargear) {
    const g = state.data.wargear[id]
    if (!g || g.kind !== 'armour' || typeof g.save !== 'number') continue
    const mods: SaveModifier[] = []
    for (const m of g.saveMods ?? []) {
      if ((m.vs === 'front' && front) || (m.vs === 'blast' && sc.vs === 'blast') || (m.vs === 'template' && sc.vs === 'template')) {
        mods.push({ label: `${g.name} vs ${m.vs}`, value: m.value })
      }
    }
    const total = g.save - mods.reduce((n, m) => n + m.value, 0)
    if (!best || total < best.total) best = { id, base: g.save, mods, total }
  }
  const modifiers: SaveModifier[] = best ? best.mods.slice() : []
  const combined = combinedBonus(state, target)
  if (combined.value) modifiers.push({ label: 'combined armour', value: combined.value })
  if (sc.coverBonus) modifiers.push({ label: 'cover', value: sc.coverBonus })
  for (const r of runHook('save.mods', { seat: target.seat, state, fighterId: target.id, data: { ap: sc.ap, vs: sc.vs ?? null } })) {
    if (r.delta) modifiers.push({ label: r.reason ?? 'rule', value: r.delta })
  }
  const bonus = modifiers.reduce((n, m) => n + m.value, 0)
  if (!best && bonus <= 0) return { need: null, item: null, base: null, modifiers: [] }
  // R-11.6: a fighter with no armour that gains a bonus counts as 7+ before the bonus
  const base = best ? best.base : 7
  if (sc.ap) modifiers.push({ label: 'AP', value: sc.ap })
  // S4K-B: Immovable Stance improves saves to at best 2+ (before the weapon's AP)
  const floor = saveFloor(state, target)
  const need = (floor !== null ? Math.max(floor, base - bonus) : base - bonus) - sc.ap
  return { need, item: best ? best.id : combined.item, base, modifiers }
}
