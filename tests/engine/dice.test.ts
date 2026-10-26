import { describe, expect, it } from 'vitest'
import { createCtx } from '@/engine/registry'
import { ScriptedRng } from '@/engine'
import { d3FromD6, d66, d6SumChance, d6TestChance, d6TestPasses, parseDiceExpr, parseTarget, rollExpr, strengthTestPasses, twoD6TestChance, twoD6TestPasses, uniformInt } from '@/engine/dice'
import { withinPath, pathGap } from '@/engine/measure'
import { stat } from '@/engine/query'
import { bundleWith, makeBoard } from '../fixtures/boards'
import { edit, place, startGame } from '../fixtures/helpers'
import { testBundle } from '../fixtures/gang'

describe('DICE and TEST: dice and characteristic tests', () => {
  it('DICE-001 D3 maps D6 faces 1-2, 3-4 and 5-6 to 1, 2 and 3; D66 reads tens then units', () => {
    expect([1, 2, 3, 4, 5, 6].map(d3FromD6)).toEqual([1, 1, 2, 2, 3, 3])
    expect(d66(3, 5)).toBe(35)
    // the same mapping through the context's D3 roll
    const s = startGame().state
    const ctx = createCtx(structuredClone(s), new ScriptedRng([1, 2, 3, 4, 5, 6]), null, 0)
    expect(ctx.roll('t', 6, 'd3')).toEqual([1, 1, 2, 2, 3, 3])
  })

  it('DICE-005 proximity "within 3 inches" uses path distance: 2 inches away through a wall but far around it is not within 3', () => {
    // a wall across z = 0 from the left edge to x = 4 leaves a gap on the right
    const board = makeBoard({ id: 'test.wall', walls: [{ a: { x: -12, z: 0 }, b: { x: 4, z: 0 } }] })
    const bundle = bundleWith(board)
    const base = startGame({ bundle, setup: { boardId: board.id } }).state
    const s = place(base, { A3: { x: 0, z: -1.5 }, B3: { x: 0, z: 1.5 } })
    const a = s.fighters.A3!
    const b = s.fighters.B3!
    const straight = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) - a.baseRadius - b.baseRadius
    expect(straight).toBeLessThan(3)
    expect(pathGap(s, a, b)).toBeGreaterThan(6)
    expect(withinPath(s, a, b, 3)).toBe(false)
    // without the wall the same two fighters are within 3 inches
    const open = place(startGame().state, { A3: { x: 0, z: -1.5 }, B3: { x: 0, z: 1.5 } })
    expect(withinPath(open, open.fighters.A3!, open.fighters.B3!, 3)).toBe(true)
  })

  it('TEST-001 a BS 4+ test passes on a 4 and fails on a 3; a modified 1 always fails', () => {
    expect(d6TestPasses(4, 4)).toBe(true)
    expect(d6TestPasses(3, 4)).toBe(false)
    expect(d6TestPasses(3, 4, 1)).toBe(true)
    expect(d6TestPasses(1, 4, +5)).toBe(false)
    expect(d6TestChance(4)).toBeCloseTo(3 / 6)
    expect(d6TestChance(2, 3)).toBeCloseTo(5 / 6)
    expect(parseTarget('4+')).toBe(4)
  })

  it('TEST-002 a Cl 7+ test passes on 2D6 = 7; a total of 2 fails even with +6; an S test passes on a roll at or under S', () => {
    expect(twoD6TestPasses(7, 7)).toBe(true)
    expect(twoD6TestPasses(6, 7)).toBe(false)
    expect(twoD6TestPasses(2, 7, 6)).toBe(false)
    expect(twoD6TestChance(7)).toBeCloseTo(21 / 36)
    expect(strengthTestPasses(3, 3)).toBe(true)
    expect(strengthTestPasses(4, 3)).toBe(false)
    expect(d6SumChance(3, 9)).toBeCloseTo(1 / 6)
  })

  it('TEST-003 Flesh Wounds lowering T below 1 go on down to 0 (Out of Action) instead of clamping at 1', () => {
    const s = edit(startGame().state, (d) => {
      d.fighters.A3!.fleshWounds = 2
    })
    expect(stat(s, 'A3', 'T')).toBe(1)
    const dead = edit(s, (d) => {
      d.fighters.A3!.fleshWounds = 3
    })
    expect(stat(dead, 'A3', 'T')).toBe(0)
    expect(stat(edit(s, (d) => (d.fighters.A3!.fleshWounds = 4)), 'A3', 'T')).toBe(-1)
  })

  it('dice expressions parse and roll through the context', () => {
    expect(parseDiceExpr('2D6')).toEqual({ count: 1, die: '2d6', add: 0 })
    expect(parseDiceExpr('D3+1')).toEqual({ count: 1, die: 'd3', add: 1 })
    expect(parseDiceExpr(4)).toEqual({ count: 0, die: null, add: 4 })
    const ctx = createCtx(structuredClone(startGame().state), new ScriptedRng([5, 6, 4, 6, 3]), null, 0)
    expect(rollExpr(ctx, 't', '2D6')).toBe(11)
    expect(rollExpr(ctx, 't', 'D3+1')).toBe(3)
    expect(rollExpr(ctx, 't', 3)).toBe(3)
    expect(ctx.events.filter((e) => e.type === 'DiceRolled')).toHaveLength(2)
  })

  it('uniformInt draws a fair index from D6 rolls only and rejects the biased tail', () => {
    const ctx = createCtx(structuredClone(startGame().state), new ScriptedRng([6, 1, 2]), null, 0)
    // k = 4 needs 1 digit; 6 -> v=5, limit = 6 - 6 % 4 = 4, so 5 is rejected; 1 -> v=0
    expect(uniformInt(ctx, 't', 4)).toBe(0)
    expect(uniformInt(ctx, 't', 1)).toBe(0)
    void testBundle
  })
})
