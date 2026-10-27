// Close combat skills and the actions they grant (S4K-B): scores for Headbutt, Hurl, Overseer, Immovable Stance and Unleash the
// Beast in the activation planner (moves.ts adds Somersault, which needs the spot ranking), and the `skill.choice` policy for
// Hit and Run, Lightning Reflexes, Hurl instead of the free Fight, the Hurl direction and Naaargah!. Same units as the rest of the
// planner ("ganger units"); every probability is the engine's (`query.headbuttOutcome`, `query.hurlOutcome`,
// `query.fightOutcome`).
import { query, type Action, type DecisionOption, type Fighter, type GameState } from '@/engine'
import { getFighter, isBroken } from '@/engine/state'
import { inBaseContact } from '@/engine/skills/hurl'
import { fighterValue } from './eval'
import { bestShot } from './shots'
import { exposure } from './threat'
import type { AiCtx } from './tiers'

const centre = (f: Fighter) => ({ x: f.pos.x, z: f.pos.z })

/** Value of an outcome distribution on a fighter, in ganger units (kills, Seriously Injured, wounds worn off). */
function strikeValue(ctx: AiCtx, state: GameState, t: Fighter, o: { pOutOfAction: number; pSeriouslyInjured: number; expectedWounds: number }): number {
  return ctx.w.dmg * fighterValue(state, t) * (o.pOutOfAction + 0.65 * o.pSeriouslyInjured + 0.1 * Math.min(1, o.expectedWounds / Math.max(1, t.wounds)))
}

/** Headbutt is free, so a Headbutt that is worth more than its fumble risk comes before anything else; otherwise it is never taken. */
export function headbuttScore(ctx: AiCtx, state: GameState, f: Fighter, t: Fighter): number {
  const o = query.headbuttOutcome(state, f.id, t.id)
  const net = strikeValue(ctx, state, t, o.hit) - strikeValue(ctx, state, f, o.fumble)
  return net > 0.03 ? 1.5 + net : net - 1
}

/**
 * Hurl: the target is hurled when it fails its Initiative test, takes a Strength 3 hit and is Pinned (no longer Engaged, so it
 * cannot hit back until it stands up). Worth the hit plus a share of the target's value for the pin; no reaction attacks follow
 * a Hurl, which is what a Fight would owe.
 */
export function hurlScore(ctx: AiCtx, state: GameState, f: Fighter, t: Fighter): number {
  const o = query.hurlOutcome(state, f.id, t.id)
  const pin = t.posture === 'standing' ? ctx.w.pin * fighterValue(state, t) * 2.2 : 0
  return o.pHurled * (strikeValue(ctx, state, t, o.hit) + pin)
}

/**
 * Overseer: the order is worth the ordered fighter's activation (as the planner values it: its best single action, and the ordered
 * fighter has two, hence the 1.7) times the chance the Leadership test passes, minus what the Overseer would have done with its
 * own two actions.
 */
export function overseerScore(ctx: AiCtx, chance: number, valueOfOrdered: number, valueOfSelf: number): number {
  return chance * 1.7 * valueOfOrdered - 0.85 * valueOfSelf
}

/**
 * Immovable Stance: +2 to saves, no Pinning, no shoving. Worth a share of what the fighter stands to lose where it stands (shots at it
 * and the blows of the enemies near it), so it is taken by a fighter that will be shot at and has nothing better to do.
 */
export function stanceScore(ctx: AiCtx, state: GameState, f: Fighter): number {
  const loss = exposure(ctx, state, f, centre(f), f.posture).loss
  return ctx.w.threat * ctx.params.threatScale * loss * 0.4 - 0.06
}

/**
 * Unleash the Beast: each enemy in base contact that fails a Strength test is pushed away from the fight (its blows are lost for a
 * turn), each friend pushed is a cost. Worth the dangerous enemies pushed, minus the friends.
 */
export function unleashScore(ctx: AiCtx, state: GameState, f: Fighter): number {
  let v = 0
  for (const e of inBaseContact(state, f)) {
    const pPush = 1 - Math.min(6, Math.max(0, query.stat(state, e.id, 'S'))) / 6
    if (e.seat === f.seat) {
      v -= pPush * 0.15 * fighterValue(state, e)
      continue
    }
    if (e.posture === 'seriouslyInjured' || isBroken(e)) continue
    const rr = query.fightOutcome(state, e.id, undefined, [f.id], {}).targets[0]
    const threat = rr ? fighterValue(state, f) * (rr.pOutOfAction + 0.65 * rr.pSeriouslyInjured) : 0
    v += pPush * (0.5 * ctx.w.threat * threat + 0.04)
  }
  return v - 0.06
}

// ---------------------------------------------------------------------------
// skill.choice
// ---------------------------------------------------------------------------

const optionOf = (opts: readonly DecisionOption[], id: string): DecisionOption | undefined => opts.find((o) => o.id === id)

/** What a Fight (the charge's free one) is worth, by the engine's odds. */
function fightValue(ctx: AiCtx, state: GameState, f: Fighter): number {
  const fo = query.fightOutcome(state, f.id, undefined, f.engagedWith, { charge: true })
  let dealt = 0
  for (const t of fo.targets) {
    const tf = getFighter(state, t.targetId)
    dealt += strikeValue(ctx, state, tf, t)
  }
  return dealt
}

/** The share of the incoming blows' danger a fighter faces from the enemies engaged with it (their reaction attacks, or their next fight). */
function incomingDanger(state: GameState, f: Fighter, from: readonly string[]): number {
  let taken = 0
  for (const id of from) {
    const e = getFighter(state, id)
    if (e.posture === 'seriouslyInjured' || isBroken(e)) continue
    const rr = query.fightOutcome(state, e.id, undefined, [f.id], {}).targets[0]
    if (rr) taken += fighterValue(state, f) * (rr.pOutOfAction + 0.65 * rr.pSeriouslyInjured)
  }
  return taken
}

/** `skill.choice`: answered from the engine's odds; an unknown skill takes the first offer that is not a decline. */
export function skillChoice(ctx: AiCtx): Action | null {
  const p = ctx.pending
  const opts = p.options ?? []
  const state = ctx.view
  const skill = String(p.context.skill ?? '')
  const pick = (id: string): Action | null => optionOf(opts, id)?.action ?? null
  const who = typeof p.context.fighterId === 'string' ? state.fighters[p.context.fighterId] : undefined
  switch (skill) {
    case 'hitAndRun': {
      if (!who) break
      const chance = Number((optionOf(opts, 'use')?.data as { chance?: number } | undefined)?.chance ?? 0.5)
      // slip away when the reaction attacks would hurt and the Initiative test is a fair bet
      return pick(incomingDanger(state, who, who.engagedWith) >= 0.1 && chance >= 0.4 ? 'use' : 'decline')
    }
    case 'lightningReflexes': {
      if (!who) break
      const chance = Number((optionOf(opts, 'use')?.data as { chance?: number } | undefined)?.chance ?? 0.5)
      const attacker = typeof p.context.attackerId === 'string' ? p.context.attackerId : ''
      return pick(attacker && incomingDanger(state, who, [attacker]) >= 0.15 && chance >= 0.5 ? 'use' : 'decline')
    }
    case 'hurlFight': {
      if (!who) break
      let best: { id: string; v: number } = { id: 'fight', v: fightValue(ctx, state, who) }
      for (const o of opts) {
        const target = (o.data as { targetId?: string } | undefined)?.targetId
        if (!target) continue
        const v = hurlScore(ctx, state, who, getFighter(state, target))
        if (v > best.v) best = { id: o.id, v }
      }
      return pick(best.id)
    }
    case 'hurlDirection': {
      // fly where it hurts the enemy and spares friends: into enemies is good, into friends is bad, farther is better
      let best: { o: DecisionOption; v: number } | null = null
      for (const o of opts) {
        const d = o.data as { contacts?: string[]; moved?: number } | undefined
        let v = 0.01 * (d?.moved ?? 0)
        for (const id of d?.contacts ?? []) {
          const c = getFighter(state, id)
          v += (c.seat === ctx.seat ? -0.4 : 0.3) * fighterValue(state, c)
        }
        if (!best || v > best.v) best = { o, v }
      }
      return best ? best.o.action : null
    }
    case 'naaargah': {
      if (!who) break
      const chance = Number((optionOf(opts, 'attempt')?.data as { chance?: number } | undefined)?.chance ?? 0.5)
      if (chance < 0.5) return pick('decline')
      // a third action is worth taking when there is something to do with it: a shot, or a fight it is already in
      const shot = bestShot(ctx, state, who, { aimed: false, mode: 'shoot', actionsLeft: 1 })
      const fighting = who.engagedWith.length > 0
      return pick((shot && shot.cost === 'basic' && shot.value > 0.2) || fighting ? 'attempt' : 'decline')
    }
  }
  const decline = /^(no|none|decline|skip|pass|cancel)/i
  const first = opts.find((o) => !decline.test(o.id)) ?? opts[0]
  return first ? first.action : null
}
