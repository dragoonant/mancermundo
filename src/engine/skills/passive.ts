// Passive skills, wargear and fighter rules as code hooks (S4K-A). Each one is a `registerCodeHook` whose `install` attaches
// handlers to the engine's hook points (hooks.ts) and applies the rule only to a fighter that carries the skill, wargear or
// rule (skills/util.ts finds it through the data record's `{ "code": ... }`). A handler calls `markFired(name)` when the effect
// actually applies, so tests can prove each hook fires in a real game. The module installs everything when it loads.
//
// Optional effects that can never hurt their owner (Nerves of Steel, Dodge, Spring Up, Inspirational, Unstoppable, Walk It Off,
// Iron Man ...) apply automatically; the genuinely tactical start-of-activation items (Stimm-slug stash, Chem-synth) ask through
// `skill.choice` (skills/choice.ts). Rulings taken here are logged in docs/needs-rules-check.md.
import { takeOutOfAction } from '../casualties'
import { markFired, registerCodeHook, installCodeHooks } from '../code-hooks'
import { d6TestPasses, twoD6TestChance, twoD6TestPasses, strengthTestPasses } from '../dice'
import { rollInjuries, segmentClear } from '../hits'
import { registerHook, runHook, type HookContext } from '../hooks'
import { refreshEngagement, withinPath } from '../measure'
import { findClearSpot, placeAlong } from '../movement'
import { stat, type StatVs } from '../query'
import { clearCondition, setCondition } from '../traits'
import type { Fighter, GameState, Vec2 } from '../types'
import type { ExtraSave } from '../wargear'
import { registerChoice } from './choice'
import { hasCode, ironManFlesh, markUsed, numParam, paramsOf, targetParam, usedOnce, usesOf } from './util'

const T_GAS = 'core.t.gas'
const T_TOXIN = 'core.t.toxin'

type Data = Record<string, unknown>

const subject = (h: HookContext): Fighter | undefined => (h.fighterId ? h.state?.fighters[h.fighterId] : undefined)
const other = (h: HookContext): Fighter | undefined => (h.targetId ? h.state?.fighters[h.targetId] : undefined)
const sumModifiers = (h: HookContext, f: Fighter, data: Data): number => {
  let m = 0
  for (const r of runHook('test.modify', { seat: f.seat, state: h.state, fighterId: f.id, data })) if (r.delta) m += r.delta
  return m
}
const isRecord = (p: Record<string, unknown> | undefined): p is Record<string, unknown> => !!p && typeof p === 'object'

/** Enemies of `f` that are Out of Action or Seriously Injured (Combat Focus). Fled fighters are not counted (ruling). */
function enemiesDown(state: GameState, f: Fighter): number {
  let n = 0
  for (const e of Object.values(state.fighters)) {
    if (e.seat === f.seat) continue
    if (e.location === 'outOfAction' || (e.location === 'board' && e.posture === 'seriouslyInjured')) n++
  }
  return n
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'dodge',
  kind: 'skill',
  params: (p) => (p === undefined || isRecord(p) ? null : 'dodge params must be an object'),
  install() {
    // an invulnerable 6+ save on top of the armour save, against ranged and close combat attacks made by a fighter
    registerHook(
      'save.extra',
      (h) => {
        const f = subject(h)
        const d = h.data as { extras: ExtraSave[]; attacker: boolean; vs: unknown } | undefined
        if (!f || !d || !h.state || !d.attacker || d.vs) return null
        const use = usesOf(h.state, f, 'dodge')[0]
        if (use) d.extras.push({ code: 'dodge', item: 'dodge', need: targetParam(use.params, 'save', 6) })
        return null
      },
      'skl.dodge.save',
    )
    // Blast and Template: a successful save lets the fighter step up to 2" before it is decided whether it is hit
    registerHook(
      'blast.victims',
      (h) => {
        const ctx = h.engine
        const s = ctx?.state
        const d = h.data as { ids: string[]; kind: string; hitAt: (f: Fighter, p: Vec2) => boolean } | undefined
        // only against an attack made by a fighter (as the save: never doors, traps or flames)
        if (!ctx || !s || !d || !h.fighterId) return null
        for (const id of d.ids.slice()) {
          const f = s.fighters[id]
          if (!f || f.location !== 'board' || !hasCode(s, f, 'dodge')) continue
          const params = paramsOf(s, f, 'dodge')
          const need = targetParam(params, 'save', 6)
          const roll = ctx.roll('dodge', 1)[0]!
          const saved = d6TestPasses(roll, need)
          ctx.emit({ type: 'SaveRolled', targetId: f.id, roll, need, saved, item: 'dodge' }, f.seat)
          if (!saved) continue
          const inches = numParam(params, 'templateStepInches', 2)
          const from = { x: f.pos.x, z: f.pos.z }
          const to = findClearSpot(s, f, from, inches, {
            oneInch: true,
            accept: (c) => Math.hypot(c.x - from.x, c.z - from.z) <= inches + 1e-9 && !d.hitAt(f, c) && segmentClear(s, from, c),
          })
          if (!to) continue
          markFired('dodge')
          placeAlong(ctx, f, 'move', to, inches)
          refreshEngagement(ctx)
          d.ids = d.ids.filter((x) => x !== id)
        }
        return null
      },
      'skl.dodge.step',
    )
  },
})

registerCodeHook({
  name: 'springUp',
  kind: 'skill',
  params: (p) => (p === undefined || isRecord(p) ? null : 'springUp params must be an object'),
  install() {
    // activated while Pinned: an Initiative test for a free Stand Up
    registerHook(
      'activation.start',
      (h) => {
        const ctx = h.engine
        const f = ctx && h.fighterId ? ctx.state.fighters[h.fighterId] : undefined
        if (!ctx || !f || f.location !== 'board' || f.posture !== 'pinned' || !hasCode(ctx.state, f, 'springUp')) return null
        const roll = ctx.roll('springUp', 1)[0]!
        const need = stat(ctx.state, f.id, 'I')
        const modifier = sumModifiers(h, f, { test: 'initiative', reason: 'springUp' })
        const passed = d6TestPasses(roll, need, modifier)
        ctx.emit({ type: 'InitiativeTest', fighterId: f.id, roll, need: need - modifier, passed, reason: 'springUp' }, f.seat)
        if (!passed) return null
        f.posture = 'standing'
        ctx.emit({ type: 'StatusChanged', fighterId: f.id, from: 'pinned', to: 'standing', reason: 'springUp' }, f.seat)
        const act = ctx.state.action.activation
        if (act && act.fighterId === f.id) act.canTurn = true
        markFired('springUp')
        return null
      },
      'skl.springUp.start',
    )
  },
})

registerCodeHook({
  name: 'ironJaw',
  kind: 'skill',
  params: (p) => (p === undefined || isRecord(p) ? null : 'ironJaw params must be an object'),
  install() {
    // +2 T against close combat attacks whose AP is "-"
    registerHook(
      'stat.modify',
      (h) => {
        const d = h.data as { key?: string; vs?: StatVs } | undefined
        const f = subject(h)
        if (d?.key !== 'T' || !d.vs?.melee || (d.vs.ap ?? 0) !== 0 || !f || !h.state || !hasCode(h.state, f, 'ironJaw')) return null
        markFired('ironJaw')
        return { delta: numParam(paramsOf(h.state, f, 'ironJaw'), 'toughness', 2) }
      },
      'skl.ironJaw.stat',
    )
  },
})

registerCodeHook({
  name: 'nervesOfSteel',
  kind: 'skill',
  params: (p) => (p === undefined || isRecord(p) ? null : 'nervesOfSteel params must be an object'),
  install() {
    // hit by a ranged attack: a Cool test (no supporters) avoids the Pin
    registerHook(
      'pin.allowed',
      (h) => {
        const f = subject(h)
        const s = h.state
        if (!f || !s || !h.targetId || !hasCode(s, f, 'nervesOfSteel')) return null
        const need = stat(s, f.id, 'Cl')
        const modifier = sumModifiers(h, f, { test: 'cool', reason: 'nervesOfSteel' })
        const d = h.data as { preview?: boolean; pVeto?: number } | undefined
        if (d?.preview) {
          // a failed Cool test may still be rescued by an Inspirational friend (`test.failed`)
          const rescue = { test: 'cool', reason: 'nervesOfSteel', rescued: false, preview: true, chance: 0 }
          runHook('test.failed', { seat: f.seat, state: s, fighterId: f.id, data: rescue })
          const base = twoD6TestChance(need, modifier)
          const p = base + (1 - base) * rescue.chance
          d.pVeto = 1 - (1 - (d.pVeto ?? 0)) * (1 - p)
          return null
        }
        const ctx = h.engine
        if (!ctx) return null
        const roll = ctx.roll('nervesOfSteel', 1, '2d6')[0]!
        const passed = twoD6TestPasses(roll, need, modifier)
        ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'nervesOfSteel', detail: 'cool', roll, need: need - modifier, passed }, f.seat)
        if (!passed) {
          const rescue = { test: 'cool', reason: 'nervesOfSteel', rescued: false }
          runHook('test.failed', { seat: f.seat, state: ctx.state, engine: ctx, fighterId: f.id, data: rescue })
          if (!rescue.rescued) return null
        }
        markFired('nervesOfSteel')
        return { allow: false, reason: 'nervesOfSteel' }
      },
      'skl.nervesOfSteel.pin',
    )
  },
})

registerCodeHook({
  name: 'unstoppable',
  kind: 'skill',
  params: (p) => (p === undefined || isRecord(p) ? null : 'unstoppable params must be an object'),
  install() {
    // before a Recovery test: a D6, 4+ removes a Flesh Wound, or with none adds a die to choose between
    registerHook(
      'recovery.start',
      (h) => {
        const ctx = h.engine
        const f = ctx && h.fighterId ? ctx.state.fighters[h.fighterId] : undefined
        if (!ctx || !f || !hasCode(ctx.state, f, 'unstoppable')) return null
        const params = paramsOf(ctx.state, f, 'unstoppable')
        const roll = ctx.roll('unstoppable', 1)[0]!
        const on = numParam(params, 'on', 4)
        const ok = roll >= on
        const d = h.data as { extraDice: number }
        if (ok && f.fleshWounds > 0) {
          f.fleshWounds -= 1
          ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'unstoppable', detail: 'fleshWoundRemoved', roll, need: on, passed: true }, f.seat)
          markFired('unstoppable')
        } else if (ok) {
          d.extraDice += 1
          ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'unstoppable', detail: 'extraRecoveryDie', roll, need: on, passed: true }, f.seat)
          markFired('unstoppable')
        } else {
          ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'unstoppable', detail: 'failed', roll, need: on, passed: false }, f.seat)
        }
        return null
      },
      'skl.unstoppable.recovery',
    )
  },
})

registerCodeHook({
  name: 'inspirational',
  kind: 'skill',
  params: (p) => (p === undefined || isRecord(p) ? null : 'inspirational params must be an object'),
  install() {
    // a friend within 6" fails a Cool test: this fighter passes a Leadership test and the original test counts as passed
    registerHook(
      'test.failed',
      (h) => {
        const s = h.state
        const tester = subject(h)
        const d = h.data as { preview?: boolean; chance?: number; rescued?: boolean } | undefined
        if (!s || !tester || !d || d.rescued) return null
        const rescuers = Object.values(s.fighters)
          .filter(
            (g) =>
              g.id !== tester.id &&
              g.seat === tester.seat &&
              g.location === 'board' &&
              hasCode(s, g, 'inspirational') &&
              withinPath(s, tester, g, numParam(paramsOf(s, g, 'inspirational'), 'radius', 6)),
          )
          .sort((a, b) => (a.id < b.id ? -1 : 1))
        if (rescuers.length === 0) return null
        if (d.preview) {
          let fail = 1 - (d.chance ?? 0)
          for (const g of rescuers) fail *= 1 - twoD6TestChance(stat(s, g.id, 'Ld'), 0)
          d.chance = 1 - fail
          return null
        }
        const ctx = h.engine
        if (!ctx) return null
        for (const g of rescuers) {
          const need = stat(ctx.state, g.id, 'Ld')
          const roll = ctx.roll('inspirational', 1, '2d6')[0]!
          const passed = twoD6TestPasses(roll, need)
          ctx.emit({ type: 'SkillUsed', fighterId: g.id, skill: 'inspirational', detail: `rescued:${tester.id}`, roll, need, passed }, g.seat)
          if (passed) {
            d.rescued = true
            markFired('inspirational')
            break
          }
        }
        return null
      },
      'skl.inspirational.rescue',
    )
  },
})

registerCodeHook({
  name: 'ironWill',
  kind: 'skill',
  params: (p) => (p === undefined || isRecord(p) ? null : 'ironWill params must be an object'),
  install() {
    // -1 to the gang's Bottle roll while a fighter with Iron Will is on the battlefield and not Seriously Injured (does not stack)
    registerHook(
      'bottle.mods',
      (h) => {
        const s = h.state
        if (!s) return null
        const carrier = Object.values(s.fighters).find((g) => g.seat === h.seat && g.location === 'board' && g.posture !== 'seriouslyInjured' && hasCode(s, g, 'ironWill'))
        if (!carrier) return null
        markFired('ironWill')
        return { delta: numParam(paramsOf(s, carrier, 'ironWill'), 'bottleRoll', -1) }
      },
      'skl.ironWill.bottle',
    )
  },
})

registerCodeHook({
  name: 'ironMan',
  kind: 'skill',
  params: (p) => (p === undefined || isRecord(p) ? null : 'ironMan params must be an object'),
  install() {
    // Flesh Wounds never lower Toughness (the Out of Action check at Flesh Wounds >= T is hits.ts `fleshWound`)
    registerHook(
      'stat.modify',
      (h) => {
        const d = h.data as { key?: string } | undefined
        const f = subject(h)
        if (d?.key !== 'T' || !f || !h.state || f.fleshWounds <= 0 || !hasCode(h.state, f, 'ironMan')) return null
        markFired('ironMan')
        return { delta: f.fleshWounds }
      },
      'skl.ironMan.stat',
    )
  },
})

registerCodeHook({
  name: 'combatFocus',
  kind: 'skill',
  params: (p) => (p === undefined || isRecord(p) ? null : 'combatFocus params must be an object'),
  install() {
    // +1 Willpower and +1 Cool for each enemy fighter Out of Action or Seriously Injured (a natural 2 still fails)
    registerHook(
      'stat.modify',
      (h) => {
        const d = h.data as { key?: string } | undefined
        const f = subject(h)
        if ((d?.key !== 'Cl' && d?.key !== 'Wil') || !f || !h.state || !hasCode(h.state, f, 'combatFocus')) return null
        const n = enemiesDown(h.state, f) * numParam(paramsOf(h.state, f, 'combatFocus'), 'perEnemy', 1)
        if (n <= 0) return null
        markFired('combatFocus')
        return { delta: n }
      },
      'skl.combatFocus.stat',
    )
  },
})

registerCodeHook({
  name: 'walkItOff',
  kind: 'skill',
  params: (p) => (p === undefined || isRecord(p) ? null : 'walkItOff params must be an object'),
  install() {
    // two or more Move (Simple) actions: a Toughness test at the end of the activation restores a Wound or a Flesh Wound
    registerHook(
      'activation.end',
      (h) => {
        const ctx = h.engine
        const f = ctx && h.fighterId ? ctx.state.fighters[h.fighterId] : undefined
        const act = ctx?.state.action.activation
        if (!ctx || !f || !act || f.location !== 'board' || f.posture === 'seriouslyInjured' || !hasCode(ctx.state, f, 'walkItOff')) return null
        const minMoves = numParam(paramsOf(ctx.state, f, 'walkItOff'), 'minMoves', 2)
        if (act.performed.filter((a) => a.action === 'move').length < minMoves) return null
        const need = stat(ctx.state, f.id, 'T')
        const roll = ctx.roll('walkItOff', 1)[0]!
        const passed = strengthTestPasses(roll, need)
        if (!passed) {
          ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'walkItOff', detail: 'failed', roll, need, passed }, f.seat)
          return null
        }
        // a Flesh Wound is worth more than a Wound (a fighter with Flesh Wounds is already at 0 Wounds)
        let detail = ''
        if (f.fleshWounds > 0) {
          f.fleshWounds -= 1
          detail = 'fleshWoundRemoved'
        } else if (f.wounds < f.maxWounds) {
          f.wounds += 1
          detail = 'woundRestored'
        }
        ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'walkItOff', detail: detail || 'nothingToRestore', roll, need, passed }, f.seat)
        if (detail) markFired('walkItOff')
        return null
      },
      'skl.walkItOff.end',
    )
  },
})

// ---------------------------------------------------------------------------
// Wargear
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'gasToughnessBonus',
  kind: 'wargear',
  params: (p) => (isRecord(p) && typeof p.value === 'number' && p.value > 0 ? null : 'gasToughnessBonus needs params.value > 0'),
  install() {
    // Respirator +2, Filter plugs +1: Toughness against Gas weapons (filter plugs last the battle; they are lost afterwards, campaign)
    registerHook(
      'stat.modify',
      (h) => {
        const d = h.data as { key?: string; vs?: StatVs } | undefined
        const f = subject(h)
        if (d?.key !== 'T' || !d.vs?.gas || !f || !h.state) return null
        const uses = usesOf(h.state, f, 'gasToughnessBonus')
        if (uses.length === 0) return null
        markFired('gasToughnessBonus')
        return { delta: uses.reduce((n, u) => n + numParam(u.params, 'value', 0), 0) }
      },
      'skl.gasToughnessBonus.stat',
    )
  },
})

registerCodeHook({
  name: 'photoGoggles',
  kind: 'wargear',
  params: (p) => (p === undefined || isRecord(p) ? null : 'photoGoggles params must be an object'),
  install() {
    // the wearer sees (and shoots) through smoke clouds
    registerHook(
      'los.smoke',
      (h) => {
        const f = subject(h)
        const d = h.data as { ignore?: boolean } | undefined
        if (!f || !d || !h.state || !hasCode(h.state, f, 'photoGoggles') || paramsOf(h.state, f, 'photoGoggles').seeThroughSmoke === false) return null
        d.ignore = true
        markFired('photoGoggles')
        return null
      },
      'skl.photoGoggles.smoke',
    )
    // +1 on the Initiative test against Flash
    registerHook(
      'test.modify',
      (h) => {
        const d = h.data as { test?: string; reason?: string } | undefined
        const f = subject(h)
        if (d?.test !== 'initiative' || d.reason !== 'flash' || !f || !h.state || !hasCode(h.state, f, 'photoGoggles')) return null
        markFired('photoGoggles')
        return { delta: numParam(paramsOf(h.state, f, 'photoGoggles'), 'initiativeVsFlash', 1) }
      },
      'skl.photoGoggles.flash',
    )
  },
})

registerCodeHook({
  name: 'heavyCarapace',
  kind: 'wargear',
  params: (p) => (p === undefined || isRecord(p) ? null : 'heavyCarapace params must be an object'),
  install() {
    // -1 Initiative (a worse target number) and -1" when charging; the save values are data
    registerHook(
      'stat.modify',
      (h) => {
        const d = h.data as { key?: string } | undefined
        const f = subject(h)
        if (d?.key !== 'I' || !f || !h.state || !hasCode(h.state, f, 'heavyCarapace')) return null
        markFired('heavyCarapace')
        return { delta: -numParam(paramsOf(h.state, f, 'heavyCarapace'), 'initiativePenalty', 1) }
      },
      'skl.heavyCarapace.stat',
    )
    registerHook(
      'move.limit',
      (h) => {
        const d = h.data as { charge?: boolean } | undefined
        const f = subject(h)
        if (!d?.charge || !f || !h.state || !hasCode(h.state, f, 'heavyCarapace')) return null
        markFired('heavyCarapace')
        return { delta: -numParam(paramsOf(h.state, f, 'heavyCarapace'), 'chargeMovePenalty', 1) }
      },
      'skl.heavyCarapace.charge',
    )
  },
})

registerCodeHook({
  name: 'bioBooster',
  kind: 'wargear',
  params: (p) => (p === undefined || isRecord(p) ? null : 'bioBooster params must be an object'),
  install() {
    // the first time in a battle that the wearer rolls Injury dice, one die fewer (a single die: two rolled, the worse dropped)
    registerHook(
      'injury.dice',
      (h) => {
        const f = subject(h)
        if (!f || !h.state || !hasCode(h.state, f, 'bioBooster') || usedOnce(f, 'bioBooster')) return null
        if (h.engine) {
          markUsed(f, 'bioBooster')
          markFired('bioBooster')
          h.engine.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'bioBooster', detail: 'oneInjuryDieFewer' }, f.seat)
        }
        return { delta: numParam(paramsOf(h.state, f, 'bioBooster'), 'injuryDiceDelta', -1) }
      },
      'skl.bioBooster.injury',
    )
  },
})

/** Once per battle, at the start of the wearer's activation (a `skill.choice`): +2 M, S and T for the round, a Flesh Wound shed. */
registerCodeHook({
  name: 'stimmSlugStash',
  kind: 'wargear',
  params: (p) => (isRecord(p) && isRecord(p.modifiers as Record<string, unknown> | undefined) ? null : 'stimmSlugStash needs params.modifiers'),
  install() {
    registerChoice({
      code: 'stimmSlugStash',
      eligible: (s, f) => f.location === 'board' && hasCode(s, f, 'stimmSlugStash') && !usedOnce(f, 'stimmSlugStash') && !f.conditions.stimm,
      info: (s, f) => ({ modifiers: (paramsOf(s, f, 'stimmSlugStash').modifiers as Record<string, number> | undefined) ?? {}, fleshWounds: f.fleshWounds }),
      apply(ctx, f) {
        markUsed(f, 'stimmSlugStash')
        setCondition(ctx, f, 'stimm', 'stimmSlugStash', { round: ctx.state.round })
        if (f.fleshWounds > 0) f.fleshWounds -= 1
        ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'stimmSlugStash', detail: 'used' }, f.seat)
        markFired('stimmSlugStash')
      },
    })
    registerHook(
      'stat.modify',
      (h) => {
        const d = h.data as { key?: string } | undefined
        const f = subject(h)
        if (!d?.key || !f || !f.conditions.stimm || !h.state) return null
        const mods = paramsOf(h.state, f, 'stimmSlugStash').modifiers as Record<string, number> | undefined
        const delta = mods?.[d.key]
        return typeof delta === 'number' && delta !== 0 ? { delta } : null
      },
      'skl.stimmSlugStash.stat',
    )
    // at the start of the End phase: a 1 on a D6 means an Injury roll
    registerHook(
      'phase.end',
      (h) => {
        const ctx = h.engine
        const d = h.data as { name?: string } | undefined
        if (!ctx || d?.name !== 'action') return null
        for (const f of Object.values(ctx.state.fighters)) {
          if (f.location !== 'board' || !f.conditions.stimm) continue
          const risk = (paramsOf(ctx.state, f, 'stimmSlugStash').endPhaseRisk as { on?: number } | undefined) ?? {}
          const roll = ctx.roll('stimm', 1)[0]!
          const hurt = roll <= (risk.on ?? 1)
          ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'stimmSlugStash', detail: hurt ? 'injuryRoll' : 'safe', roll, need: (risk.on ?? 1) + 1, passed: !hurt }, f.seat)
          if (hurt) rollInjuries(ctx, f, 1, { attackerId: null, cause: 'stimm', melta: false, weaponId: null })
        }
        return null
      },
      'skl.stimmSlugStash.endPhase',
    )
    // the boost lasts to the end of the round; a fighter whose Flesh Wounds now reach its normal Toughness goes down
    registerHook(
      'round.end',
      (h) => {
        const ctx = h.engine
        if (!ctx) return null
        for (const f of Object.values(ctx.state.fighters)) {
          if (!f.conditions.stimm) continue
          clearCondition(ctx, f, 'stimm', 'roundEnd')
          if (f.location === 'board' && stat(ctx.state, f.id, 'T') - ironManFlesh(ctx.state, f) <= 0) takeOutOfAction(ctx, f, null, 'stimm')
        }
        return null
      },
      'skl.stimmSlugStash.roundEnd',
    )
  },
})

/** If Standing at the start of an activation (a `skill.choice`), a free Intelligence test: targets' Toughness -1 against Gas and Toxin this activation. */
registerCodeHook({
  name: 'chemSynth',
  kind: 'wargear',
  params: (p) => (p === undefined || isRecord(p) ? null : 'chemSynth params must be an object'),
  install() {
    registerChoice({
      code: 'chemSynth',
      eligible: (s, f) => f.location === 'board' && f.posture === 'standing' && hasCode(s, f, 'chemSynth') && !f.conditions.chemSynth && carriesGasOrToxin(s, f),
      info: (s, f) => ({ need: stat(s, f.id, 'Int'), chance: twoD6TestChance(stat(s, f.id, 'Int')) }),
      apply(ctx, f) {
        const need = stat(ctx.state, f.id, 'Int')
        const roll = ctx.roll('chemSynth', 1, '2d6')[0]!
        const passed = twoD6TestPasses(roll, need)
        ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'chemSynth', detail: 'intelligence', roll, need, passed }, f.seat)
        if (!passed) return
        setCondition(ctx, f, 'chemSynth', 'chemSynth')
        markFired('chemSynth')
      },
    })
    registerHook(
      'stat.modify',
      (h) => {
        const d = h.data as { key?: string; vs?: StatVs } | undefined
        const s = h.state
        if (d?.key !== 'T' || !s || !d.vs?.attackerId || (!d.vs.gas && !d.vs.toxin)) return null
        const attacker = s.fighters[d.vs.attackerId]
        if (!attacker?.conditions.chemSynth) return null
        markFired('chemSynth')
        return { delta: numParam(paramsOf(s, attacker, 'chemSynth'), 'toughnessDelta', -1) }
      },
      'skl.chemSynth.stat',
    )
    registerHook(
      'activation.end',
      (h) => {
        const ctx = h.engine
        const f = ctx && h.fighterId ? ctx.state.fighters[h.fighterId] : undefined
        if (ctx && f) clearCondition(ctx, f, 'chemSynth', 'activationEnd')
        return null
      },
      'skl.chemSynth.end',
    )
  },
})

function carriesGasOrToxin(state: GameState, f: Fighter): boolean {
  return f.weapons.some((fw) => fw.ammo === 'ok' && state.data.weapons[fw.weaponId]?.profiles.some((p) => p.traits.some((t) => t.trait === T_GAS || t.trait === T_TOXIN)))
}

// ---------------------------------------------------------------------------
// Fighter and house rules
// ---------------------------------------------------------------------------

registerCodeHook({
  name: 'hotHeaded',
  kind: 'rule',
  params: (p) => (p === undefined || isRecord(p) ? null : 'hotHeaded params must be an object'),
  install() {
    // when a Hot-headed fighter goes down its friends owe no nerve test for it (fighters of the same type still do)
    registerHook(
      'nerve.queue',
      (h) => {
        const downed = subject(h)
        const friend = other(h)
        const d = h.data as { skip?: boolean } | undefined
        if (!downed || !friend || !d || !h.state || !hasCode(h.state, downed, 'hotHeaded')) return null
        const params = paramsOf(h.state, downed, 'hotHeaded')
        if (params.exemptsFriends === false) return null
        if (friend.typeId === downed.typeId && params.sameTypeStillTests !== false) return null
        d.skip = true
        markFired('hotHeaded')
        return null
      },
      'skl.hotHeaded.nerve',
    )
  },
})

registerCodeHook({
  name: 'combatChemsStash',
  kind: 'rule',
  params: (p) => (isRecord(p) && Array.isArray(p.table) ? null : 'combatChemsStash needs params.table'),
  install() {
    // "can roll" a D6 when activated (a `skill.choice`, since a 1 can lower Attacks): 1 sets Attacks to 1, 2 adds 1, 3-4 adds 2,
    // 5-6 adds 3 for the round (it raises the characteristic). Not asked of a Seriously Injured fighter (it makes no attacks).
    registerChoice({
      code: 'combatChemsStash',
      eligible: (s, f) => f.location === 'board' && f.posture !== 'seriouslyInjured' && !f.conditions.combatChems && hasCode(s, f, 'combatChemsStash'),
      info: (s, f) => ({ attacks: stat(s, f.id, 'A') }),
      apply(ctx, f) {
        const table = (paramsOf(ctx.state, f, 'combatChemsStash').table as { min: number; max: number; attacks: { set?: number; add?: number } }[] | undefined) ?? []
        const roll = ctx.roll('combatChems', 1)[0]!
        const row = table.find((r) => roll >= r.min && roll <= r.max)
        if (!row) return
        const mode = row.attacks.set !== undefined ? 'set' : 'add'
        const n = row.attacks.set ?? row.attacks.add ?? 0
        setCondition(ctx, f, 'combatChems', 'combatChemsStash', { mode, n, roll })
        ctx.emit({ type: 'SkillUsed', fighterId: f.id, skill: 'combatChemsStash', detail: `${mode}:${n}`, roll }, f.seat)
        markFired('combatChemsStash')
      },
    })
    registerHook(
      'stat.modify',
      (h) => {
        const d = h.data as { key?: string; value?: number } | undefined
        const f = subject(h)
        const c = f?.conditions.combatChems
        if (d?.key !== 'A' || !c?.data || typeof d.value !== 'number') return null
        const n = Number(c.data.n)
        return { delta: c.data.mode === 'set' ? n - d.value : n }
      },
      'skl.combatChemsStash.stat',
    )
    registerHook(
      'round.end',
      (h) => {
        const ctx = h.engine
        if (!ctx) return null
        for (const f of Object.values(ctx.state.fighters)) clearCondition(ctx, f, 'combatChems', 'roundEnd')
        return null
      },
      'skl.combatChemsStash.roundEnd',
    )
  },
})

registerCodeHook({
  name: 'poisonBlood',
  kind: 'rule',
  params: (p) => (p === undefined || isRecord(p) ? null : 'poisonBlood params must be an object'),
  install() {
    // a natural 1 on the Toughness roll of a Toxin weapon may be re-rolled (judged before modifiers; it can never hurt)
    registerHook(
      'attack.reroll',
      (h) => {
        const f = subject(h)
        const d = h.data as { purpose?: string; roll?: number; reroll?: boolean } | undefined
        if (!f || !d || d.purpose !== 'toxin' || d.roll !== 1 || !h.state || !hasCode(h.state, f, 'poisonBlood')) return null
        d.reroll = true
        markFired('poisonBlood')
        return null
      },
      'skl.poisonBlood.toxin',
    )
  },
})

/** Every name this file registers (tests and docs read it). */
export const PASSIVE_CODE_HOOKS = [
  'dodge', 'springUp', 'ironJaw', 'nervesOfSteel', 'unstoppable', 'inspirational', 'ironWill', 'ironMan', 'combatFocus', 'walkItOff',
  'gasToughnessBonus', 'photoGoggles', 'heavyCarapace', 'bioBooster', 'stimmSlugStash', 'chemSynth', 'hotHeaded', 'combatChemsStash', 'poisonBlood',
] as const

installCodeHooks(PASSIVE_CODE_HOOKS)
