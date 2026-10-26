// Plague Marines rules-verification fixes (M9 review), named by checklist id (docs/spec/12-rules-test-checklist.md).
// Seat A is Plague Marines against the default Kommandos on open ground, as in plague-marines.test.ts.
import { describe, expect, it } from 'vitest'
import { step } from '@/engine'
import { abilityOffers, maxRepeats } from '@/engine/abilities'
import { offersFor } from '@/engine/ploys'
import { runHook } from '@/engine/hooks'
import { ScriptedRng } from '@/engine/rng'
import { POISON, fightLike, inTerritory } from '@/engine/teams/plague-marines'
import { tokenCount } from '@/engine/tokens'
import type { Action, GameState, Marker, Operative, PendingDecision } from '@/engine/types'
import { play } from '../../fixtures/attack'
import { expectOk, place } from '../../fixtures/helpers'
import { activateOp, edit, openReal, opOf, passIt, take } from '../../fixtures/real'

const MATCH = { teams: ['plague-marines', 'kommandos'] as [string, string] }
const open = (): GameState => openReal({ ...MATCH })
const A = (s: GameState, card: string): string => opOf(s, 'A', `pm.${card}`)
const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)
const pass = (p: { seat: 'A' | 'B'; id: string }) => ({ type: 'pass' as const, seat: p.seat, decisionId: p.id, payload: {} as Record<string, never> })
const ones = (n: number) => Array<number>(n).fill(1)

describe('TEAM-PM rules verification', () => {
  it('TEAM-PM-010 FLAIL shares the Astartes two-Fight allowance: Fight or FLAIL in any mix, two at most, one after two Shoots', () => {
    let s = open()
    const fighter = A(s, 'fighter')
    const boy = B(s, 'boy')
    s = place(place(s, fighter, 0, 0), boy, 1.4, 0)
    const t = activateOp(s, fighter)
    const op = t.operatives[fighter]!
    const F = 'ability:pm.a.flail'
    // a FLAIL is recorded as the ability plus a shadow `fight` entry: count the real actions only
    expect(fightLike([F, 'fight'])).toBe(1)
    expect(fightLike([F, 'fight', 'fight'])).toBe(2)
    expect(fightLike(['fight', F])).toBe(2)
    expect(fightLike([F, 'fight', F])).toBe(2)
    // FLAIL after one FLAIL is within the allowance (the shared unique-action bar still applies, see RULING)
    expect(maxRepeats(t, op, F, [F, 'fight'])).toBe(2)
    expect(maxRepeats(t, op, F, ['fight'])).toBe(1)
    expect(maxRepeats(t, op, 'fight', [F, 'fight', F])).toBe(1)
    // after two Shoots only one Fight-like action is left
    const offered = (performed: string[]) => {
      const u = edit(t, (st) => (st.firefight.activation!.performed = performed))
      return abilityOffers(u, u.operatives[fighter]!, u.firefight.activation).some((o) => o.abilityId === 'pm.a.flail')
    }
    expect(offered(['shoot', 'shoot'])).toBe(true)
    expect(offered(['shoot', 'shoot', 'fight'])).toBe(false)
    expect(offered(['fight'])).toBe(true)
    expect(offered(['fight', 'fight'])).toBe(false)
    expect(offered(['ability:pm.a.flail', 'fight', 'fight'])).toBe(false)
    // FLAIL + FLAIL: the shared unique-action bar now asks maxRepeats, so a second FLAIL is offered, a third never
    expect(offered(['ability:pm.a.flail', 'fight'])).toBe(true)
    expect(offered(['ability:pm.a.flail', 'fight', 'ability:pm.a.flail'])).toBe(false)
    expect(offered(['shoot', 'shoot', 'ability:pm.a.flail', 'fight'])).toBe(false)
  })

  it('TEAM-PM-023 CURSE OF ROT locks the defence 3s before the defender may re-roll them', () => {
    const curse = (q: PendingDecision): Action => q.options?.find((o) => o.id === 'pm.p.curse-of-rot')?.action ?? pass(q)
    let s = open()
    const hg = A(s, 'heavy-gunner')
    const boy = B(s, 'boy')
    s = edit(place(place(s, hg, 0, 0), boy, 3, 0), (st) => (st.players.B.cp = 3))
    // attack 6 1 1 1, defence 3 3 6: the Boy holds CP for a Command Re-roll
    let seen: { p: PendingDecision; dice: (number | null)[] } | null = null
    play(
      take(take(activateOp(s, hg), 'shoot').state, 'pm.w.bolt-pistol').state,
      new ScriptedRng([6, 1, 1, 1, 3, 3, 6, ...ones(12)]),
      {
        'ploy.firefight': (q) => (q.seat === 'A' ? curse(q) : pass(q)),
        'dice.commandReroll': (q, st) => {
          if (q.seat === 'B' && !seen) seen = { p: q, dice: st.attack!.seq!.def!.dice.map((d) => d.value) }
          return pass(q)
        },
      },
      ['firefight.action'],
    )
    expect(seen).not.toBeNull()
    const p = seen!.p
    const def = { dice: seen!.dice.map((value) => ({ value })) }
    const threes = def.dice.map((d, i) => (d.value === 3 ? i : -1)).filter((i) => i >= 0)
    expect(threes).toHaveLength(2)
    expect((p.options ?? []).length).toBeGreaterThan(0)
    // no re-roll option touches a cursed 3
    for (const o of p.options ?? []) {
      const dice = ((o.action.payload as { dice?: number[] }).dice ?? []) as number[]
      for (const i of threes) expect(dice).not.toContain(i)
    }

    // fighting: the ploy is taken in the window before either side re-rolls (fight.beforeRerolls), so the Boy's
    // cursed 3s are fails it can never re-roll; the Champion rolls 1s, the Boy 3 3 6 1 and holds CP
    let f = open()
    const champ = A(f, 'champion')
    f = edit(place(place(f, champ, 0, 0), boy, 1.4, 0), (st) => {
      st.operatives[boy]!.order = 'engage'
      st.players.B.cp = 3
    })
    const windows: string[] = []
    let offered: { p: PendingDecision; dice: (number | null)[]; kinds: string[] } | null = null
    play(take(activateOp(f, champ), 'fight').state, new ScriptedRng([1, 1, 1, 1, 1, 3, 3, 6, 1, ...ones(20)]), {
      'ploy.firefight': (q) => {
        if (q.seat === 'A' && q.options?.some((o) => o.id === 'pm.p.curse-of-rot')) windows.push(String(q.window))
        return q.seat === 'A' ? curse(q) : pass(q)
      },
      'dice.commandReroll': (q, st) => {
        const side = st.attack!.seq!.def!
        if (q.seat === 'B' && !offered) offered = { p: q, dice: side.dice.map((d) => d.value), kinds: side.dice.map((d) => d.kind) }
        return pass(q)
      },
    })
    expect(windows).toEqual(['fight.beforeRerolls'])
    expect(offered).not.toBeNull()
    const cursed = offered!.dice.map((v, i) => (v === 3 ? i : -1)).filter((i) => i >= 0)
    expect(cursed).toHaveLength(2)
    for (const i of cursed) expect(offered!.kinds[i]).toBe('fail')
    for (const o of offered!.p.options ?? []) {
      const dice = ((o.action.payload as { dice?: number[] }).dice ?? []) as number[]
      for (const i of cursed) expect(dice).not.toContain(i)
    }
  })

  it('TEAM-PM-022 POISONOUS DEMISE is the owner\'s choice in the operative.incapacitated ploy window when an attack kills the Plague Marine', () => {
    let s = open()
    const warrior = A(s, 'warrior')
    const ender = A(s, 'bombardier')
    const boy = B(s, 'boy')
    const nob = B(s, 'boss-nob')
    s = edit(place(place(place(place(s, warrior, 0, 0), boy, 5.5, 0), nob, -2.6, 0), ender, -12, 8), (st) => {
      st.operatives[warrior]!.wounds = 1
      st.operatives[warrior]!.order = 'engage'
    })
    s = take(activateOp(s, ender), 'end').state
    let g = take(activateOp(s, boy), 'shoot').state
    g = take(g, g.pending!.options![0]!.id).state
    const rng = new ScriptedRng([6, 6, 6, 6, ...ones(30)])
    g = expectOk(step(g, g.pending!.options!.find((o) => o.id === warrior)!.action, rng)).state
    // pass the attack's own ploy windows; stop at the incapacitation window, which waits before the removal
    const stops: PendingDecision['kind'][] = ['ploy.firefight', 'ability.choice', 'firefight.action']
    g = play(g, rng, {}, stops).state
    while (g.pending?.kind === 'ploy.firefight' && g.pending.window !== 'operative.incapacitated') g = play(passIt(g, rng).state, rng, {}, stops).state
    expect(g.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'operative.incapacitated', context: { subjectId: warrior } })
    expect(g.pending!.options!.map((o) => o.id)).toEqual(['pm.p.poisonous-demise'])
    expect(g.pending!.options![0]!.data).toMatchObject({ cost: 1 })
    expect(g.operatives[warrior]!.status).toBe('active')
    const cp = g.players.A.cp
    const used = take(g, 'pm.p.poisonous-demise', rng).state
    expect(tokenCount(used, nob, POISON, 'A')).toBe(1)
    expect(used.players.A.cp).toBe(cp - 1)
    expect(used.operatives[warrior]!.status).toBe('removed')
    const kept = passIt(g, rng).state
    expect(tokenCount(kept, nob, POISON)).toBe(0)
    expect(kept.players.A.cp).toBe(cp)
    expect(kept.operatives[warrior]!.status).toBe('removed')
  })

  it('TEAM-PM-022 POISONOUS DEMISE after a FLAIL kills a friendly Plague Marine: the removal waits for the end of the step, and the owner plays the ploy or keeps the CP', () => {
    let s = open()
    const fighter = A(s, 'fighter')
    const warrior = A(s, 'warrior')
    const nob = B(s, 'boss-nob')
    s = edit(place(place(place(s, fighter, 1.5, 0), warrior, 0, 0), nob, -2.6, 0), (st) => {
      st.operatives[warrior]!.wounds = 1
    })
    // the FLAIL's D3+2 takes the Warrior down; it waits at 0 wounds for the operative.incapacitated ploy window
    const g = take(activateOp(s, fighter), 'ability:pm.a.flail', new ScriptedRng([1, 1, 1, 1])).state
    expect(g.operatives[warrior]).toMatchObject({ status: 'active', wounds: 0 })
    // the FLAIL's own action-ended ploy window is open, so the owner is asked by the rule's own choice (same cost)
    expect(g.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', window: 'operative.incapacitated', context: { hook: 'poisonousDemise', operativeId: warrior } })
    expect(g.pending!.options!.map((o) => o.id)).toEqual(['use', 'none'])
    const cp = g.players.A.cp
    const used = take(g, 'use').state
    expect(used.operatives[warrior]!.status).toBe('removed')
    expect(tokenCount(used, nob, POISON, 'A')).toBe(1)
    expect(used.players.A.cp).toBe(cp - 1)
    const kept = take(g, 'none').state
    expect(kept.operatives[warrior]!.status).toBe('removed')
    expect(tokenCount(kept, nob, POISON)).toBe(0)
    expect(kept.players.A.cp).toBe(cp)
    // either way the FLAIL's parked action-ended window comes back, with no second Poisonous Demise offer
    for (const t of [used, kept]) {
      expect(t.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'firefight.actionEnded' })
      expect(t.pending!.options!.some((o) => o.id === 'pm.p.poisonous-demise')).toBe(false)
    }
  })

  it('TEAM-PM-012 Icon of Contagion counts the Icon Bearer as in the territory when any part of its base is inside', () => {
    const square = [
      { x: -1, z: -1 },
      { x: 1, z: -1 },
      { x: 1, z: 1 },
      { x: -1, z: 1 },
    ]
    const at = (x: number) => ({ pos: { x, y: 0, z: 0 }, baseRadius: 0.63 }) as Operative
    expect(inTerritory(at(0), square)).toBe(true)
    expect(inTerritory(at(1.4), square)).toBe(true) // centre outside, base edge 0.23" inside
    expect(inTerritory(at(1.7), square)).toBe(false)
  })

  it('TEAM-PM-018 CLOUD OF FLIES offers a spot between two touching Plague Marines, and it obscures both', () => {
    let s = open()
    const w = A(s, 'warrior')
    const f = A(s, 'fighter')
    const boy = B(s, 'boy')
    s = place(place(place(s, w, 0, 0), f, 1.26, 0), boy, 8, 0)
    const spots = offersFor(s, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).filter((o) => o.ployId === 'pm.p.cloud-of-flies').map((o) => o.param)
    expect(spots).toContain('0.65,0')
    const marker: Marker = { id: 'flies-test', kind: 'equipment', pos: { x: 0.63, z: 0 }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'pm.p.cloud-of-flies' }
    const t = edit(s, (st) => st.markers.push(marker))
    for (const id of [w, f]) {
      const data = { obscured: false, inCover: false }
      runHook('target.status', { seat: 'B', state: t, operativeId: boy, targetId: id, data })
      expect(data.obscured).toBe(true)
    }
  })
})
