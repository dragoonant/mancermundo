// The activation planner and the hit-chain valuation, on the hand-built fixtures: a gunner with a clear shot shoots, an
// Engaged fighter fights, a Broken fighter runs, a Seriously Injured enemy at hand gets the Coup de Grace, a fighter behind a
// closed door opens it, and the AI's hit chain agrees with the engine's `expectedOutcome` (AI-0xx ids).
import { describe, expect, it } from 'vitest'
import { legalActions, query, step, view, type GameState, type PendingDecision } from '@/engine'
import { createAiDecider, makeCtx } from '../../src/ai/decider'
import { hitChain, shotOutcome } from '../../src/ai/eval'
import { goalsFor } from '../../src/ai/goals'
import { newMemory } from '../../src/ai/tiers'
import { shootingGame } from '../fixtures/attack'
import { edit } from '../fixtures/helpers'
import { meleeGame, TOUCH } from '../fixtures/melee'
import { corridorWithDoor } from '../fixtures/boards'

/** What the normal AI answers to the pending decision of a state. */
function answerOf(state: GameState, tier: 'normal' | 'easy' = 'normal') {
  const p = state.pending!
  const d = createAiDecider(tier, { seed: 'planner' })
  return d.decideSync(view(state, p.seat), p, legalActions(state, p))
}

const chosen = (state: GameState): string => {
  const a = answerOf(state).action
  return a.type === 'action.choose' ? a.payload.action : a.type
}

describe('AI: the planner answers the situation in front of it', () => {
  it('AI-010 a gunner with a clear shot at an enemy in the open shoots, then picks that enemy', () => {
    const s = shootingGame({
      spots: { A3: { x: 0, z: -4, facing: 0 }, B3: { x: 0, z: 2 } },
      active: 'A3',
      loadouts: { A3: { weapons: ['atk.w.plain'] }, B3: { weapons: [], wargear: [] } },
    })
    expect(s.pending!.kind).toBe('action.choose')
    expect(chosen(s)).toBe('shoot')
    const r = step(s, answerOf(s).action)
    // one weapon: the weapon step is skipped and the target decision comes next
    expect(r.pending!.kind).toBe('shoot.target')
    const t = answerOf(r.state)
    expect(t.fallback).toBe(false)
    expect(t.action.type === 'shoot.target' && t.action.payload.targetId).toBe('B3')
  })

  it('AI-011 an Engaged fighter fights rather than ending its activation', () => {
    const s = meleeGame({
      spots: { A3: { x: 0, z: 0, facing: 0 }, B3: { x: 0, z: TOUCH, facing: Math.PI } },
      active: 'A3',
      loadouts: { A3: { weapons: ['cc.w.knife'] }, B3: { weapons: ['cc.w.knife'] } },
    })
    expect(chosen(s)).toBe('fight')
  })

  it('AI-012 a Broken fighter runs for cover (the only thing it may do)', () => {
    const s = edit(
      shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 0, z: 4 } }, loadouts: { A3: { weapons: ['atk.w.plain'] } } }),
      (d) => {
        d.fighters.A3!.conditions.broken = { since: 1 }
      },
    )
    // A3 is Broken, so it is activated through the menu of a Broken fighter
    const act = legalActions(s, s.pending!)!.find((a) => a.type === 'action.activate' && a.payload.fighterId === 'A3')
    expect(act).toBeTruthy()
    const r = step(s, act!)
    const pending: PendingDecision = r.pending!.kind === 'action.group' ? step(r.state, legalActions(r.state, r.pending!)!.find((a) => a.type === 'action.group' && a.payload.done)!).pending! : r.pending!
    expect(pending.kind).toBe('action.choose')
    const st = r.pending!.kind === 'action.group' ? step(r.state, legalActions(r.state, r.pending!)!.find((a) => a.type === 'action.group' && a.payload.done)!).state : r.state
    expect(chosen(st)).toBe('runForCover')
  })

  it('AI-013 a Seriously Injured enemy within reach gets the Coup de Grace', () => {
    const s = shootingGame({
      spots: { A3: { x: 0, z: 0, facing: 0 }, B3: { x: 0, z: 1.8, posture: 'seriouslyInjured' } },
      active: 'A3',
      loadouts: { A3: { weapons: ['atk.w.plain'] } },
    })
    const a = answerOf(s).action
    expect(a.type === 'action.choose' && a.payload.action).toBe('coupDeGrace')
  })

  it('AI-014 a fighter facing away from the only enemy turns to face it before shooting', () => {
    const s = shootingGame({
      spots: { A3: { x: 0, z: -4, facing: Math.PI }, B3: { x: 0, z: 2 } },
      active: 'A3',
      loadouts: { A3: { weapons: ['atk.w.plain'] } },
    })
    expect(chosen(s)).toBe('turn')
    const turn = answerOf(s).action
    const r = step(s, turn)
    expect(r.pending!.kind).toBe('action.choose')
    expect(chosen(r.state)).toBe('shoot')
  })

  it('AI-015 the easy tier also answers (a legal option) and never returns a random action type', () => {
    const s = shootingGame({
      spots: { A3: { x: 0, z: -4, facing: 0 }, B3: { x: 0, z: 2 } },
      active: 'A3',
      loadouts: { A3: { weapons: ['atk.w.plain'] } },
    })
    const r = answerOf(s, 'easy')
    expect(r.fallback).toBe(false)
    expect(legalActions(s, s.pending!)!.some((l) => JSON.stringify(l.payload) === JSON.stringify(r.action.payload))).toBe(true)
  })
})

describe('AI: valuation uses the engine odds', () => {
  const weapons = ['atk.w.plain', 'atk.w.rf2', 'atk.w.melta', 'atk.w.knock', 'atk.w.dual']
  for (const w of weapons) {
    it(`AI-016 hit chain x hit chance equals query.expectedOutcome for ${w}`, () => {
      const s = shootingGame({
        spots: { A3: { x: 0, z: -5, facing: 0 }, B3: { x: 0, z: 1 } },
        active: 'A3',
        loadouts: { A3: { weapons: [w] }, B3: { weapons: [], wargear: ['atk.g.carapace'] } },
      })
      const state = s
      const p = state.data.weapons[w]!.profiles[0]!
      const ctx = makeCtx('normal', view(state, 'A'), state.pending!, null, { seed: 'x' }, newMemory())
      const a = state.fighters.A3!
      const t = state.fighters.B3!
      const pHit = query.hitChance(state, 'A3', w, p.id, 'B3')
      expect(pHit).toBeGreaterThan(0)
      const mine = shotOutcome(hitChain(ctx, state, a, w, p, t), pHit, t)
      const theirs = query.expectedOutcome(state, 'A3', w, p.id, 'B3')
      for (const k of ['pHit', 'expectedHits', 'expectedWounds', 'pSeriouslyInjured', 'pOutOfAction', 'pPinned'] as const) {
        expect(mine[k], k).toBeCloseTo(theirs[k], 9)
      }
    })
  }
})

describe('AI: doors and goals', () => {
  it('AI-017 with the only way to the enemy behind a closed door the door becomes the goal, and the fighter opens it when it stands at it', () => {
    const board = corridorWithDoor()
    const far = shootingGame({ board: board.id, spots: { A3: { x: -4, z: -5, facing: 0 }, B3: { x: 4, z: 5 } }, loadouts: { A3: { weapons: ['atk.w.plain'] } } })
    const p = far.pending!
    const ctx = makeCtx('normal', view(far, 'A'), p, legalActions(far, p), { seed: 'x' }, newMemory())
    const goals = goalsFor(ctx, ctx.view, ctx.view.fighters.A3!)
    expect(goals[0]!.kind).toBe('door')
    expect(goals[0]!.doorId).toBe('door1')
    // standing at the door it opens it
    const near = shootingGame({ board: board.id, spots: { A3: { x: 0, z: -1.3, facing: 0 }, B3: { x: 4, z: 5 } }, active: 'A3', loadouts: { A3: { weapons: ['atk.w.plain'] } } })
    const a = answerOf(near).action
    expect(a.type === 'action.choose' && a.payload.action).toBe('operateDoor')
  })
})


describe('AI: the rarer decisions', () => {
  /** Drive the pending decisions with the AI until `until` says stop; returns the kinds seen. */
  function drive(state: GameState, until: (s: GameState) => boolean, max = 60): { state: GameState; kinds: string[] } {
    const kinds: string[] = []
    const d = createAiDecider('normal', { seed: 'rare' })
    let s = state
    for (let i = 0; i < max && s.pending && !until(s); i++) {
      const p = s.pending
      kinds.push(p.kind)
      const r = d.decideSync(view(s, p.seat), p, legalActions(s, p))
      expect(r.fallback, p.kind).toBe(false)
      const next = step(s, r.action)
      expect(next.rejection, p.kind).toBeUndefined()
      s = next.state
    }
    return { state: s, kinds }
  }

  it('AI-020 a fighter engaged with two enemies splits its dice and finishes the fight with no fallback', () => {
    const s = meleeGame({
      spots: { A3: { x: 0, z: 0, facing: 0 }, B3: { x: -TOUCH * 0.866, z: TOUCH * 0.5, facing: Math.PI }, B4: { x: TOUCH * 0.866, z: TOUCH * 0.5, facing: Math.PI } },
      active: 'A3',
      loadouts: { A3: { weapons: ['cc.w.knife'] }, B3: { weapons: ['cc.w.knife'] }, B4: { weapons: ['cc.w.knife'] } },
      tweak: (d) => {
        d.fighters.A3!.stats.A = 3
      },
    })
    const { kinds } = drive(s, (st) => !st.action.activation || st.action.activation.fighterId !== 'A3' || st.phase !== 'action', 30)
    expect(kinds).toContain('fight.split')
  })

  it('AI-021 a Rapid Fire shot with a second enemy near the first allocates its extra hits', () => {
    const s = shootingGame({
      spots: { A3: { x: 0, z: -5, facing: 0 }, B3: { x: 0, z: 1 }, B4: { x: 1.8, z: 1.4 } },
      active: 'A3',
      loadouts: { A3: { weapons: ['atk.w.rf2'] } },
    })
    const { kinds } = drive(s, (st) => !st.action.activation || st.action.activation.fighterId !== 'A3', 40)
    expect(kinds).toContain('shoot.target')
  })
})

describe('AI: templates and blasts', () => {
  it('AI-022 a flamer is aimed at the enemies in its cone and away from friends', () => {
    const s = shootingGame({
      spots: { A4: { x: 0, z: -3, facing: 0 }, B3: { x: 0.2, z: 2 }, B4: { x: -0.4, z: 3.2 }, A3: { x: 6, z: -3 } },
      active: 'A4',
      loadouts: { A4: { weapons: ['test.w.flamer'] } },
    })
    expect(chosen(s)).toBe('shoot')
    let r = step(s, answerOf(s).action)
    // a single weapon skips the weapon step; the template asks for its direction
    expect(r.pending!.kind).toBe('shoot.aim')
    const aim = answerOf(r.state)
    expect(aim.fallback).toBe(false)
    expect(aim.action.type).toBe('shoot.aim')
    r = step(r.state, aim.action)
    expect(r.rejection).toBeUndefined()
  })
})
