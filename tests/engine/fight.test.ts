import { describe, expect, it } from 'vitest'
import { act } from '@/engine/actions'
import { step } from '@/engine'
import { assistersOf } from '@/engine/fight'
import { actionAvailability } from '@/engine/firefight'
import { registerHook, unregisterHook } from '@/engine/hooks'
import { fightOutcome } from '@/engine/query'
import { ScriptedRng } from '@/engine/rng'
import { cloneState, effectiveApl } from '@/engine/state'
import type { Action, DecisionKind, GameState, PendingDecision } from '@/engine/types'
import { expectOk, patchOp } from '../fixtures/helpers'
import { declareFight, evs, melee, pick, play, rolled, stage, type Staged } from '../fixtures/attack'

type Rules = Parameters<typeof melee>[2]

/** Attacker A1 at (0,0.1) and defender B1 at (0.1,1.5) in each other's control range. */
function duel(mine: ReturnType<typeof melee>, theirs: ReturnType<typeof melee> | null, extra: Partial<Parameters<typeof stage>[0]> = {}): Staged {
  return stage({ m: [0, 0.1], e: [0.1, 1.5], mine: [mine], ...(theirs ? { theirs: [theirs] } : {}), ...extra })
}

function startFight(s: Staged, rng: ScriptedRng, answers: Partial<Record<DecisionKind, (p: PendingDecision, st: GameState) => Action | null>> = {}) {
  const st = declareFight(s.state)
  const first = expectOk(step(st, pick(st.pending!, s.e), rng))
  const rest = play(first.state, rng, answers)
  return { state: rest.state, events: [...first.events, ...rest.events], rng }
}

/** Strike with the best die; the defender does the same. */
const strikeAlways: Partial<Record<DecisionKind, (p: PendingDecision) => Action | null>> = {
  'fight.resolve': (p) => p.options!.find((o) => o.id.startsWith('strike'))!.action,
}

describe('FIGHT sequence', () => {
  it('FIGHT-001 Fight is rejected with no enemy in control range; the chosen enemy retaliates with a melee weapon', () => {
    const far = stage({ m: [0, 0], e: [0, 6], mine: [melee('a')] })
    expect(actionAvailability(far.state, far.state.operatives[far.m]!, 'fight', far.state.firefight.activation)?.code).toBe('E_ACTION_RESTRICTED')
    expect(step(far.state, act.action(far.state.pending!, 'fight')).rejection?.code).toBe('E_ACTION_RESTRICTED')
    const a = melee('a')
    const b = melee('b')
    const s = duel(a, b)
    const st = declareFight(s.state)
    expect(st.pending!.kind).toBe('fight.target')
    expect(st.pending!.options!.map((o) => o.id)).toEqual([s.e])
    const rng = new ScriptedRng([4, 4, 4, 4, 4, 4, 4, 4])
    const r = expectOk(step(st, pick(st.pending!, s.e), rng))
    expect(evs(r.events, 'FightStarted')[0]).toMatchObject({ operativeId: s.m, targetId: s.e, attackerWeapon: 'a', defenderWeapon: 'b' })
  })

  it('FIGHT-002 both sides roll simultaneously against their own Hit, with no cover or obscured', () => {
    const a = melee('a', { atk: 3, hit: 3 })
    const b = melee('b', { atk: 2, hit: 5 })
    // a Heavy wall between them is irrelevant in a fight
    const s = duel(a, b)
    const rng = new ScriptedRng([3, 4, 5, 5, 4])
    const r = startFight(s, rng, strikeAlways)
    const rolls = evs(r.events, 'AttackDiceRolled')
    expect(rolls.map((x) => [x.operativeId, x.need, x.kinds])).toEqual([
      [s.m, 3, ['normal', 'normal', 'normal']],
      [s.e, 5, ['normal', 'fail']],
    ])
    // the attacker's dice come out of the stream first, then the retaliator's
    expect(rolled(r.events, 'fight.attack')).toEqual([[3, 4, 5]])
    expect(rolled(r.events, 'fight.defence')).toEqual([[5, 4]])
    expect(evs(r.events, 'CoverSaveRetained')).toHaveLength(0)
    expect(evs(r.events, 'DefenceDiceRolled')).toHaveLength(0)
  })

  it('FIGHT-003 each assisting friendly improves the Hit by 1; one in another enemy control range does not assist; Siege Specialist denies', () => {
    const a = melee('a', { atk: 3, hit: 4 })
    const b = melee('b', { atk: 1, hit: 6 })
    const s = duel(a, b, { f: [1.6, 1.9] })
    let st = patchOp(s.state, 'A3', { pos: { x: -1.5, y: 0, z: 1.9 } })
    const base = { ...s, state: st }
    expect(assistersOf(st, st.operatives[s.m]!, st.operatives[s.e]!).sort()).toEqual([s.f, 'A3'].sort())
    const two = startFight(base, new ScriptedRng([4, 4, 4, 1]), strikeAlways)
    expect(evs(two.events, 'AttackDiceRolled')[0]!.need).toBe(2) // 4+ improved twice
    // the retaliator's friend assists the retaliator by the same test: B2 beside the attacker
    st = patchOp(base.state, 'B2', { pos: { x: -1.5, y: 0, z: -0.9 } })
    expect(assistersOf(st, st.operatives['B1']!, st.operatives[s.m]!)).toEqual(['B2'])
    // an assister that is also in the control range of another enemy does not assist
    st = patchOp(base.state, 'B2', { pos: { x: 3.1, y: 0, z: 1.9 } })
    expect(assistersOf(st, st.operatives[s.m]!, st.operatives[s.e]!).sort()).toEqual([s.f, 'A3'].sort().filter((x) => x !== s.f))
    // Siege Specialist: a hook denies the enemy's assists
    registerHook('modifyAttackDice', (c) => {
      const d = c.data as { kind: string; assists: string[] }
      if (d.kind === 'fight') d.assists = []
      return null
    }, 'test.siege')
    try {
      const denied = startFight(base, new ScriptedRng([4, 4, 4, 1]), strikeAlways)
      expect(evs(denied.events, 'AttackDiceRolled')[0]!.need).toBe(4)
    } finally {
      unregisterHook('modifyAttackDice', 'test.siege')
    }
  })

  it('FIGHT-004 resolution alternates one die at a time starting with the attacker; each die strikes or blocks', () => {
    const a = melee('a', { atk: 3, hit: 3 })
    const b = melee('b', { atk: 3, hit: 3 })
    const s = duel(a, b, { mineWounds: 20, mineMaxWounds: 20, targetWounds: 20 })
    const order: string[] = []
    const rng = new ScriptedRng([4, 4, 4, 4, 4, 4])
    const r = startFight(s, rng, {
      'fight.resolve': (p) => {
        order.push(p.seat)
        return p.options!.find((o) => o.id.startsWith('strike'))!.action
      },
    })
    // A strikes, B strikes, A, B, A: then A has no dice left and B's last die resolves without a decision
    expect(order).toEqual(['A', 'B', 'A', 'B', 'A'])
    expect(evs(r.events, 'Struck').map((x) => x.operativeId === s.m)).toEqual([true, false, true, false, true, false])
    expect(r.state.operatives[s.m]!.wounds).toBe(8)
    expect(r.state.operatives[s.e]!.wounds).toBe(8)
  })

  it('FIGHT-005 a normal blocks a normal, a crit blocks a normal or a crit; a normal cannot block a crit', () => {
    const a = melee('a', { atk: 2, hit: 3 })
    const b = melee('b', { atk: 2, hit: 3 })
    const s = duel(a, b)
    const seen: string[][] = []
    const rng = new ScriptedRng([6, 4, 6, 4])
    startFight(s, rng, {
      'fight.resolve': (p) => {
        seen.push(p.options!.map((o) => `${p.seat}:${o.id}`))
        return p.options!.find((o) => o.id.startsWith('strike'))!.action
      },
    })
    // attacker: crit (die 0) and normal (die 1) against the defender's crit (die 0) and normal (die 1)
    expect(seen[0]).toEqual(['A:strike:0', 'A:block:0->0', 'A:block:0->1', 'A:strike:1', 'A:block:1->1'])
    // after the attacker strikes with the crit the defender (crit, normal) faces a lone attacker normal: a crit may block it, a normal too
    expect(seen[1]).toEqual(['B:strike:0', 'B:block:0->1', 'B:strike:1', 'B:block:1->1'])
    // a lone attacker normal and a lone defender crit: the normal can never be offered a block against a crit
    expect(seen[2]).toEqual(['A:strike:1', 'A:block:1->1'])
  })

  it('FIGHT-006 when one side has no unresolved dice the other resolves all its remaining dice without further decisions', () => {
    const a = melee('a', { atk: 1, hit: 3 })
    const b = melee('b', { atk: 3, hit: 3 })
    const s = duel(a, b)
    let decisions = 0
    const rng = new ScriptedRng([4, 4, 4, 4])
    const r = startFight(s, rng, {
      'fight.resolve': (p) => {
        decisions++
        return p.options!.find((o) => o.id.startsWith('strike'))!.action
      },
    })
    expect(decisions).toBe(1) // the attacker's only die; the defender then resolves all three of its dice alone
    expect(evs(r.events, 'Struck')).toHaveLength(4)
    expect(r.state.operatives[s.e]!.wounds).toBe(6)
    expect(r.state.operatives[s.m]!.wounds).toBe(0)
    expect(r.state.operatives[s.m]!.status).toBe('removed')
  })

  it('FIGHT-007 if a fighter is incapacitated the sequence ends at once and unresolved dice are discarded', () => {
    const a = melee('a', { atk: 2, hit: 3, dmg: { normal: 2, crit: 3 } })
    const b = melee('b', { atk: 2, hit: 3, dmg: { normal: 4, crit: 5 } })
    const s = duel(a, b, { mineWounds: 4, mineMaxWounds: 10 })
    const rng = new ScriptedRng([4, 4, 6, 6])
    const r = startFight(s, rng, strikeAlways)
    // A strikes a normal (2), B strikes a crit (5 >= 4 wounds): the attacker is incapacitated, its second die is discarded
    expect(evs(r.events, 'Struck').map((x) => [x.operativeId, x.die])).toEqual([
      [s.m, 'normal'],
      [s.e, 'crit'],
    ])
    expect(r.state.operatives[s.m]!.status).toBe('removed')
    expect(r.state.operatives[s.e]!.wounds).toBe(8)
    expect(r.state.firefight.activation).toBeNull() // the removed operative's activation is over
    expect(evs(r.events, 'FightEnded')).toHaveLength(1)
  })

  it('FIGHT-008 fight re-rolls alternate between players starting with the initiative player until both pass', () => {
    const a = melee('a', { atk: 2, hit: 3 }, [{ rule: 'balanced' }] as Rules)
    const b = melee('b', { atk: 2, hit: 3 }, [{ rule: 'relentless' }] as Rules)
    const s = duel(a, b)
    const record = (log: string[]) => ({
      'dice.reroll': (p: PendingDecision) => {
        log.push(`${p.seat}:reroll`)
        return p.options![0]!.action
      },
      'dice.commandReroll': (p: PendingDecision) => {
        log.push(`${p.seat}:command`)
        return act.pass(p)
      },
      ...strikeAlways,
    })
    // initiative A: A uses Balanced, B uses Relentless, then A and B pass their Command Re-roll windows
    const logA: string[] = []
    startFight(s, new ScriptedRng([1, 4, 1, 4, 4, 4, 4, 4, 4, 4]), record(logA))
    expect(logA).toEqual(['A:reroll', 'B:reroll', 'A:command', 'B:command'])
    // initiative B: B goes first
    const sw = { ...s, state: cloneState(s.state) }
    sw.state.initiative = 'B'
    const logB: string[] = []
    startFight(sw, new ScriptedRng([1, 4, 1, 4, 4, 4, 4, 4, 4, 4]), record(logB))
    expect(logB[0]).toBe('B:reroll')
    expect(logB[1]).toBe('A:reroll')
  })

  it('FIGHT-011 a fighter that cannot retaliate collects no dice and the attacker resolves every die', () => {
    const a = melee('a', { atk: 3, hit: 3 })
    const b = melee('b', { atk: 3, hit: 3 })
    const s = duel(a, b)
    const st = patchOp(s.state, s.e, { flags: { ...s.state.operatives[s.e]!.flags, cannotRetaliate: true } })
    const r = startFight({ ...s, state: st }, new ScriptedRng([4, 4, 4]), strikeAlways)
    expect(evs(r.events, 'AttackDiceRolled')).toHaveLength(1)
    expect(evs(r.events, 'Struck')).toHaveLength(3)
    expect(r.state.operatives[s.e]!.wounds).toBe(0)
  })

  it('FIGHT-012 Brutal: the opponent can block only with crits in a fight', () => {
    const a = melee('a', { atk: 2, hit: 3 }, [{ rule: 'brutal' }] as Rules)
    const b = melee('b', { atk: 2, hit: 3 })
    const s = duel(a, b)
    const seen: string[][] = []
    startFight(s, new ScriptedRng([4, 4, 6, 4]), {
      'fight.resolve': (p) => {
        if (p.seat === 'B') seen.push(p.options!.map((o) => o.id))
        return p.options!.find((o) => o.id.startsWith('strike'))!.action
      },
    })
    // the defender holds a crit (die 0) and a normal (die 1); only the crit may block
    expect(seen[0]).toEqual(['strike:0', 'block:0->1', 'strike:1'])
  })

  it('FIGHT-013 Stun applies in a fight and Devastating is immediate damage on the other fighter', () => {
    const a = melee('a', { atk: 2, hit: 3 }, [{ rule: 'stun' }, { rule: 'devastating', x: 2 }] as Rules)
    const b = melee('b', { atk: 1, hit: 3 })
    const s = duel(a, b)
    const r = startFight(s, new ScriptedRng([6, 2, 2]), strikeAlways)
    expect(evs(r.events, 'DamageInflicted')[0]).toMatchObject({ operativeId: s.e, amount: 2, source: 'devastating' })
    expect(effectiveApl(r.state.operatives[s.e]!)).toBe(r.state.operatives[s.e]!.apl - 1)
  })

  it('FIGHT-014 the fight minimax finds the best block and strike for both fighters', () => {
    const side = (n: number, c: number, w: number) => ({ normals: n, crits: c, dmg: { normal: 4, crit: 5 }, wounds: w, shock: false, brutal: false })
    // GOLD-003 position: both play it out as the example does
    const res = fightOutcome({ a: side(3, 1, 10), d: side(2, 1, 14), turn: 'a' })
    expect(res.best).not.toBeNull()
    // striking with the last die that kills ends the fight at once
    const kill = fightOutcome({ a: side(0, 1, 14), d: side(1, 1, 5), turn: 'a' })
    expect(kill.best).toMatchObject({ op: 'strike', die: 'crit' })
    expect(kill.dWounds).toBe(0)
    expect(kill.value).toBeGreaterThan(500)
  })
})

describe('WPN fight rules', () => {
  it('WPN-024 Shock: the first striking crit discards one enemy unresolved normal (or a crit if none)', () => {
    const a = melee('a', { atk: 3, hit: 3 }, [{ rule: 'shock' }] as Rules)
    const b = melee('b', { atk: 3, hit: 3 })
    const s = duel(a, b, { targetWounds: 20 })
    // attacker 6,6,4 (two crits); defender 4,4,4 (three normals)
    const r = startFight(s, new ScriptedRng([6, 6, 4, 4, 4, 4]), strikeAlways)
    const shocks = evs(r.events, 'ShockDiscard')
    expect(shocks).toHaveLength(1) // only the first crit strike shocks
    expect(shocks[0]).toMatchObject({ operativeId: s.m, discarded: 'normal' })
    // the defender lost one of its three dice before resolving: only two strikes come back
    expect(evs(r.events, 'Struck').filter((x) => x.operativeId === s.e)).toHaveLength(2)
    // with only crits left on the other side the discard takes a crit
    const t = duel(a, melee('c', { atk: 1, hit: 3 }), { targetWounds: 20 })
    const q = startFight(t, new ScriptedRng([6, 4, 4, 6]), strikeAlways)
    expect(evs(q.events, 'ShockDiscard')[0]).toMatchObject({ discarded: 'crit' })
    expect(evs(q.events, 'Struck').filter((x) => x.operativeId === t.e)).toHaveLength(0)
  })
})
