import { describe, expect, it } from 'vitest'
import { legalActions, view, type GameState, type Seat } from '@/engine'
import { cloneState } from '@/engine/state'
import { makeCtx, createAiDecider } from '../../src/ai/decider'
import { threatAt } from '../../src/ai/threat'
import { newMemory } from '../../src/ai/tiers'
import { ScriptedRng } from '@/engine/rng'
import { arena } from '../fixtures/helpers'
import { declareShoot, play, ranged, stage } from '../fixtures/attack'
import { feature, mapWith, part, rect } from '../fixtures/maps'
import { drive } from './fixtures'

function ctxFor(s: GameState) {
  const p = s.pending!
  return makeCtx('normal', view(s, p.seat), p, legalActions(s, p), { seed: 'planner' }, newMemory())
}

function moveTo(s: GameState, id: string, x: number, z: number): GameState {
  const c = cloneState(s)
  c.operatives[id]!.pos = { x, y: 0, z }
  return c
}

describe('AI planner', () => {
  it('AI-006 the threat map ranks an exposed spot above a cover spot', () => {
    // a Heavy wall between the enemy shooter (east) and the west side of the board
    const map = mapWith(feature('wall', part('wall.a', rect(1.75, 2.25, -3, 3), 3, ['heavy'])))
    const a = arena(map, { m: [-3, 0], e: [7, 0] })
    const ctx = ctxFor(a.state)
    const me = ctx.view.operatives[a.m]!
    const spot = (x: number, z: number, order: 'engage' | 'conceal') => {
      const v = moveTo(ctx.view as GameState, a.m, x, z)
      return threatAt(ctx, v, { ...v.operatives[a.m]!, order })
    }
    const exposed = spot(0.9, 6, 'engage') // past the end of the wall, in the open
    const covered = spot(0.9, 0.2, 'engage') // right behind the wall
    expect(exposed.expected).toBeGreaterThan(covered.expected)
    expect(exposed.seenBy).toBeGreaterThan(covered.seenBy)
    // the same spot under Conceal is never worse than under Engage
    const hidden = spot(0.9, 0.2, 'conceal')
    expect(hidden.expected).toBeLessThanOrEqual(covered.expected + 1e-9)
    void me
  })

  it('AI-007 the shooter picks the target with the higher expected damage', () => {
    // enemy e stands in the open; e2 is tucked behind a low crate (cover)
    const map = mapWith(feature('crate', part('crate.a', rect(-1, 1, 4.2, 5), 1, ['light'])))
    const a = arena(map, { m: [0, 0], e: [7, 0], e2: [0, 5.9] })
    const seed = 'prefer'
    const deciders = { A: createAiDecider('normal', { seed: `${seed}:A` }), B: createAiDecider('normal', { seed: `${seed}:B` }) } as Record<Seat, ReturnType<typeof createAiDecider>>
    const s = drive(a.state, deciders, (st) => st.pending?.kind === 'shoot.target' && st.pending.seat === a.me)
    expect(s.pending?.kind).toBe('shoot.target')
    const p = s.pending!
    const open = p.options!.find((o) => (o.action.payload as { targetId: string }).targetId === a.e)
    const cover = p.options!.find((o) => (o.action.payload as { targetId: string }).targetId === a.e2)
    expect(open, 'the open target is offered').toBeTruthy()
    if (cover) expect(Number(open!.data!.expectedDamage)).toBeGreaterThan(Number(cover.data!.expectedDamage))
    const r = deciders[a.me].decideSync(view(s, a.me), p, legalActions(s, p))
    expect((r.action.payload as { targetId: string }).targetId).toBe(a.e)
  })

  it('AI-008 with a kill on offer the operative shoots rather than wandering off', () => {
    const map = mapWith()
    const a = arena(map, { m: [0, 0], e: [6, 0] })
    // the enemy is nearly dead: any hit kills
    const weak = cloneState(a.state)
    weak.operatives[a.e]!.wounds = 1
    const seed = 'kill'
    const deciders = { A: createAiDecider('normal', { seed: `${seed}:A` }), B: createAiDecider('normal', { seed: `${seed}:B` }) } as Record<Seat, ReturnType<typeof createAiDecider>>
    const s = drive(weak, deciders, (st) => st.pending?.kind === 'shoot.weapon' || st.pending?.kind === 'shoot.target')
    expect(['shoot.weapon', 'shoot.target']).toContain(s.pending?.kind)
  })
})

describe('AI ploys', () => {
  /** A staged shot with scripted attack dice; returns the pending Command Re-roll decision for the attacker. */
  function rerollWindow(dice: number[], targetWounds: number, cp: number) {
    const w = ranged('t.gun', { atk: 4, hit: 3, dmg: { normal: 3, crit: 4 } })
    const staged = stage({ m: [0, -5], e: [0, 4], mine: [w], targetWounds, targetSave: 6 })
    const s0 = cloneState(staged.state)
    s0.players[staged.me].cp = cp
    const s1 = declareShoot(s0)
    const played = play(s1, new ScriptedRng(dice), {}, ['dice.commandReroll', 'firefight.action'])
    return { s: played.state, me: staged.me }
  }

  it('AI-012 Command Re-roll: spends the point when one die finishes the target, keeps it when the gain is small', () => {
    const ai = createAiDecider('normal', { seed: 'cmd' })
    const ask = (r: { s: GameState; me: Seat }) => {
      const p = r.s.pending!
      expect(p.kind).toBe('dice.commandReroll')
      return ai.decideSync(view(r.s, p.seat), p, legalActions(r.s, p)).action
    }
    // one normal success on four dice against a 4-wound target: one more success kills it
    const flip = ask(rerollWindow([1, 1, 1, 5, 1, 1, 1], 4, 1))
    expect(flip.type).toBe('dice.commandReroll')
    // the same roll against a 20-wound target with a single point left: not worth it
    const small = ask(rerollWindow([1, 1, 1, 5, 1, 1, 1], 20, 1))
    expect(small.type).toBe('pass')
    // with points to spare the same re-roll is fine
    const spare = ask(rerollWindow([1, 1, 1, 5, 1, 1, 1], 20, 4))
    expect(spare.type).toBe('dice.commandReroll')
  })
})
