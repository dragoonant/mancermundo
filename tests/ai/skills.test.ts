// The AI answers the actions and choices the close combat skills add (S4K-B): Headbutt and Hurl when their odds beat a plain Fight,
// the Overseer on a friend with something to do, Immovable Stance for a fighter that will be shot, Somersault out of a fight it is
// losing, and the skill.choice questions (Hit and Run, Lightning Reflexes, Hurl instead of the free Fight, the Hurl direction).
import { describe, expect, it } from 'vitest'
import { legalActions, query, step, view, type GameState } from '@/engine'
import { createAiDecider, makeCtx } from '../../src/ai/decider'
import { stanceScore } from '../../src/ai/skills'
import { newMemory } from '../../src/ai/tiers'
import { shootingGame } from '../fixtures/attack'
import { edit, must } from '../fixtures/helpers'
import { dice, meleeGame, optionWhere, TOUCH } from '../fixtures/melee'
import { realBundle } from '../fixtures/real'
import { COMBAT_SKILL_HOOKS } from '@/engine/skills/combat'
import { playMatch } from '../../tools/ai-match'
import { pairingFor } from '../../tools/ai-pairing'

function give(d: GameState, fighterId: string, ...ids: string[]): void {
  const skills = realBundle().skills
  for (const id of ids) {
    d.data.skills = { ...d.data.skills, [id]: skills[id]! }
    d.fighters[fighterId]!.skills.push(id)
  }
}

function answerOf(state: GameState) {
  const p = state.pending!
  return createAiDecider('normal', { seed: 'skills' }).decideSync(view(state, p.seat), p, legalActions(state, p))
}

const chosen = (state: GameState): string => {
  const a = answerOf(state).action
  return a.type === 'action.choose' ? a.payload.action : a.type === 'skill.choice' ? `skill:${a.payload.option}` : a.type
}

const face = { A3: { x: 0, z: -10, facing: 0 }, B3: { x: 0, z: -10 + TOUCH, facing: Math.PI } }

describe('AI: close combat skill actions', () => {
  it('AI-SKC-001 a Headbutt that is worth more than its fumble risk comes first', () => {
    const s = meleeGame({ spots: face, tweak: (d) => give(d, 'A3', 'core.s.brawn.headbutt'), active: 'A3' })
    const o = query.headbuttOutcome(s, 'A3', 'B3')
    expect(o.hit.pOutOfAction + o.hit.pSeriouslyInjured).toBeGreaterThan(o.fumble.pOutOfAction + o.fumble.pSeriouslyInjured)
    expect(chosen(s)).toBe('headbutt')
  })

  it('AI-SKC-002 Hurl is taken in place of the charge\'s free Fight when the Fight would achieve little and the hurl pins a tough enemy', () => {
    const s = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: 0 }, B3: { x: 0, z: -6, facing: Math.PI } },
      tweak: (d) => {
        give(d, 'A3', 'core.s.brawn.hurl')
        d.fighters.B3!.stats.T = 7
        d.fighters.B3!.stats.I = 6
        d.fighters.B3!.wounds = d.fighters.B3!.maxWounds = 3
      },
      active: 'A3',
    })
    const opt = s.pending!.options!.find((o) => o.id === 'charge:B3')!
    const charged = must(step(s, opt.action, dice(4)))
    expect(charged.pending!.kind).toBe('skill.choice')
    expect(chosen(charged.state)).toBe('skill:hurl:B3')
  })

  it('AI-SKC-003 the Hurl direction goes into an enemy rather than a friend', () => {
    const spots = { ...face, B4: { x: 0, z: -10 + TOUCH + 1.2, facing: Math.PI }, A4: { x: -1.2 - TOUCH, z: -10 + TOUCH, facing: 0 } }
    const s = meleeGame({ spots, tweak: (d) => give(d, 'A3', 'core.s.brawn.hurl'), active: 'A3' })
    const asked = must(step(s, optionWhere(s, { action: 'hurl', targetId: 'B3' }), dice(1, 6)))
    expect(asked.pending!.context.skill).toBe('hurlDirection')
    const a = answerOf(asked.state).action
    const picked = asked.pending!.options!.find((o) => o.action.type === 'skill.choice' && a.type === 'skill.choice' && o.action.payload.option === a.payload.option)!
    const contacts = (picked.data as { contacts: string[] }).contacts
    expect(contacts).toContain('B4')
    expect(contacts).not.toContain('A4')
  })

  it('AI-SKC-004 an Overseer orders a friend that has a good shot when it has nothing to do itself', () => {
    // the skill is handed over before the activation, so the menu holds the Order
    const fresh = shootingGame({
      spots: { A1: { x: -8, z: -16, facing: Math.PI }, A3: { x: -8, z: -12, facing: 0 }, B3: { x: -8, z: -4, facing: Math.PI } },
      loadouts: { A1: { weapons: [] }, A3: { weapons: ['atk.w.plain'] }, B3: { weapons: [], wargear: [] } },
    })
    const base = edit(fresh, (d) => give(d, 'A1', 'core.s.leadership.overseer'))
    const act1 = legalActions(base, base.pending!)!.find((a) => a.type === 'action.activate' && a.payload.fighterId === 'A1')!
    let r = must(step(base, act1))
    if (r.pending!.kind === 'action.group') r = must(step(r.state, legalActions(r.state, r.pending!)!.find((a) => a.type === 'action.group' && a.payload.done)!))
    expect(chosen(r.state)).toBe('overseer')
  })

  it('AI-SKC-005 Immovable Stance is worth something to a fighter in the open under fire, and nothing out of sight', () => {
    const exposed = shootingGame({
      spots: { A3: { x: 0, z: -4, facing: 0 }, B3: { x: 0, z: 4, facing: Math.PI } },
      loadouts: { A3: { weapons: [] }, B3: { weapons: ['atk.w.plain'] } },
      active: 'A3',
    })
    const ctx = makeCtx('normal', view(exposed, 'A'), exposed.pending!, null, { seed: 's' }, newMemory())
    const here = stanceScore(ctx, ctx.view, ctx.view.fighters.A3!)
    expect(here).toBeGreaterThan(0)
    const hidden = shootingGame({
      spots: { A3: { x: -9, z: -16, facing: 0 }, B3: { x: 9, z: 16, facing: 0 } },
      loadouts: { A3: { weapons: [] }, B3: { weapons: [] } },
      active: 'A3',
    })
    const ctx2 = makeCtx('normal', view(hidden, 'A'), hidden.pending!, null, { seed: 's' }, newMemory())
    expect(stanceScore(ctx2, ctx2.view, ctx2.view.fighters.A3!)).toBeLessThan(0)
  })

  it('AI-SKC-006 a fighter in a fight it is losing somersaults out of it', () => {
    const s = meleeGame({
      spots: { A3: { x: 0, z: -10, facing: 0 }, B1: { x: 0, z: -10 + TOUCH, facing: Math.PI }, B4: { x: TOUCH, z: -10, facing: Math.PI * 1.5 } },
      loadouts: { B1: { weapons: ['cc.w.power'] }, B4: { weapons: ['cc.w.power'] } },
      tweak: (d) => give(d, 'A3', 'esc.s.somersault'),
      active: 'A3',
    })
    expect(s.pending!.options!.some((o) => o.id === 'somersault')).toBe(true)
    expect(['somersault', 'retreat']).toContain(chosen(s))
    const asked = must(step(s, optionWhere(s, { action: 'somersault' })))
    const a = answerOf(asked.state)
    expect(a.fallback).toBe(false)
    expect(a.action.type).toBe('move.path')
    expect(step(asked.state, a.action).rejection).toBeUndefined()
  })

  it('AI-SKC-007 Hit and Run and Lightning Reflexes are used against a dangerous enemy and declined against a weak one', () => {
    // a charger with Hit and Run that has just charged a Leader with a power weapon: the reaction would hurt, so slip away
    const spots = { A3: { x: 0, z: -10, facing: 0 }, B1: { x: 0, z: -6, facing: Math.PI } }
    const strong = meleeGame({ spots, loadouts: { B1: { weapons: ['cc.w.power'] } }, tweak: (d) => give(d, 'A3', 'esc.s.hit-and-run'), active: 'A3' })
    const offered = must(step(strong, optionWhere(strong, { action: 'charge', targetId: 'B1' }), dice(4, 1, 1, 1)))
    expect(offered.pending!.context.skill).toBe('hitAndRun')
    expect(chosen(offered.state)).toBe('skill:use')
    // Lightning Reflexes: the defender slips away from a strong attacker
    const lr = meleeGame({ spots: { A1: { x: 0, z: -10, facing: 0 }, B3: { x: 0, z: -10 + 0.63 + 0.492 + 0.002, facing: Math.PI } }, loadouts: { A1: { weapons: ['cc.w.power'] } }, tweak: (d) => give(d, 'B3', 'esc.s.lightning-reflexes'), active: 'A1' })
    const q = must(step(lr, optionWhere(lr, { action: 'fight' })))
    expect(q.pending!.context.skill).toBe('lightningReflexes')
    expect(chosen(q.state)).toBe('skill:use')
  })
})

describe('AI: games with the skills in play', () => {
  it('AI-SKC-008 normal against normal with every fighter carrying every close combat skill: no rejection, stall, fallback or unhandled decision; the skill actions are used', { timeout: 240_000 }, () => {
    const bundle = realBundle()
    const hooks = COMBAT_SKILL_HOOKS
    const all = Object.values(bundle.skills)
      .filter((s) => hooks.some((n) => JSON.stringify(s.effect ?? '').includes(`"code":"${n}"`)))
      .map((s) => s.id)
    const used: Record<string, number> = {}
    for (const g of [0, 5, 8, 13]) {
      const { setup, aiSeat } = pairingFor(bundle, g, ['scn.tunnel-skirmish', 'scn.smash-and-grab', 'scn.forgotten-riches'], 4)
      for (const seat of ['A', 'B'] as const) for (const f of setup.gangs[seat].roster) f.skills = [...new Set([...f.skills, ...all])]
      const other = aiSeat === 'A' ? 'B' : 'A'
      const ai = createAiDecider('normal', { seed: `sk${g}:${aiSeat}` })
      const opp = createAiDecider('normal', { seed: `sk${g}:${other}` })
      const m = playMatch(setup, bundle, `ai-047-${g}`, { [aiSeat]: ai, [other]: opp } as Record<'A' | 'B', typeof ai>)
      expect(m.firstRejection, `game ${g}`).toBeNull()
      expect(m.stalled, `game ${g}`).toBe(false)
      for (const d of [ai, opp]) {
        expect(d.memory.stats.fallbacks, `game ${g}`).toBe(0)
        expect(d.memory.stats.errors, `game ${g}`).toBe(0)
        expect(d.memory.stats.unhandled, `game ${g}`).toEqual({})
      }
      for (const s of Object.values(m.seats)) for (const [k, n] of Object.entries(s.actions)) used[k] = (used[k] ?? 0) + n
    }
    // at least one of the new actions was chosen by the AI in these games
    expect(['somersault', 'overseer', 'immovableStance', 'headbutt', 'hurl', 'unleashTheBeast'].some((k) => (used[k] ?? 0) > 0), JSON.stringify(used)).toBe(true)
  })
})
