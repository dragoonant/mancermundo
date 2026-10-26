// plague-marines engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-PM-nnn).
// Plague Marines are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { createGame } from '@/engine'
import { abilityOffers, canCounteractWithOrder, maxRepeats } from '@/engine/abilities'
import { attackStats, effectiveRules, inflict, runDeferredRemovals, weaponDamage, weaponUnusable } from '@/engine/attack-common'
const ID_DEMISE = 'pm.p.poisonous-demise'
import { addUse, removeNow, usesOf } from '@/engine/effects'
import { territoryOf } from '@/engine/equipment'
import { runHook } from '@/engine/hooks'
import { gambitOffers, offersFor, usePloy } from '@/engine/ploys'
import { markerControl } from '@/engine/query'
import { ScriptedRng } from '@/engine/rng'
import { shootableWeapons } from '@/engine/shoot'
import { effectiveApl, effectiveMove } from '@/engine/state'
import { TEAM_ID, POISON, contagionApplies, lumberingApplies, nurglingTargets } from '@/engine/teams/plague-marines'
import { tokenCount } from '@/engine/tokens'
import type { Action, GameState, PendingDecision } from '@/engine/types'
import { loadBundle, validateRoster } from '../../../src/data'
import { play } from '../../fixtures/attack'
import { drive, place } from '../../fixtures/helpers'
import { activateOp, edit, hasOption, openReal, opOf, realBundle, realGame, realSetupWith, roster, take, withCtx } from '../../fixtures/real'

const data = loadBundle()
const ICONS = roster(['pm.champion', 'pm.icon-bearer', 'pm.warrior', 'pm.fighter', 'pm.bombardier', 'pm.heavy-gunner'])
const MATCH = { teams: ['plague-marines', 'kommandos'] as [string, string] }
const pass = (p: { seat: 'A' | 'B'; id: string }) => ({ type: 'pass' as const, seat: p.seat, decisionId: p.id, payload: {} as Record<string, never> })
const noPloys = { 'ploy.firefight': pass }

/** Open ground, every operative parked in its corner; A (Plague Marines) is to activate. */
const open = (o: Parameters<typeof openReal>[0] = {}): GameState => openReal({ ...MATCH, ...o })
const A = (s: GameState, card: string): string => opOf(s, 'A', `pm.${card}`)
const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A token of owner A on an operative, placed before the current action. */
function poison(s: GameState, id: string, since = 0): GameState {
  return edit(s, (st) => {
    st.operatives[id]!.tokens = [{ kind: POISON, owner: 'A', count: 1, since }]
  })
}

/** A's first operative has acted and ended: the next activation is B's. */
function bTurn(s: GameState, ender: string): GameState {
  return take(activateOp(s, ender), 'end').state
}

function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'pm-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
}

describe('TEAM-PM Plague Marines', () => {
  it('TEAM-PM-000 TEAM-PM-001 the team is playable; Champion plus five distinct main-list operatives validates, duplicates and a seventh do not', () => {
    expect(TEAM_ID).toBe('plague-marines')
    expect(data.teams['plague-marines']!.playable).toBe(true)
    const team = data.teams['plague-marines']!
    const cards = realBundle.datacards
    const ok = { leader: ['pm.champion'], main: ['pm.bombardier', 'pm.fighter', 'pm.heavy-gunner', 'pm.plaguecaster', 'pm.warrior'] }
    expect(validateRoster(team, ok, cards as never).ok).toBe(true)
    expect(validateRoster(team, { ...ok, main: ['pm.icon-bearer', ...ok.main.slice(1)] }, cards as never).ok).toBe(true)
    expect(validateRoster(team, { ...ok, main: ['pm.warrior', 'pm.warrior', ...ok.main.slice(2)] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: [...ok.main, 'pm.icon-bearer'] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, leader: ['kom.boss-nob'] }, cards as never).ok).toBe(false)
    expect(Object.values(realGame(MATCH).operatives).filter((o) => o.seat === 'A')).toHaveLength(6)
  })

  it('TEAM-PM-002 TEAM-PM-003 ASTARTES: two Shoots need a bolt or PSYCHIC weapon, no PSYCHIC repeat, any order can counteract', () => {
    const s = open()
    const get = (id: string) => s.operatives[id]!
    // the Bombardier (boltgun) and the Heavy Gunner (bolt pistol) may shoot twice, the Champion (plasma pistol only) may not
    expect(maxRepeats(s, get(A(s, 'bombardier')), 'shoot', ['shoot'])).toBe(2)
    expect(maxRepeats(s, get(A(s, 'heavy-gunner')), 'shoot', ['shoot'])).toBe(2)
    expect(maxRepeats(s, get(A(s, 'champion')), 'shoot', ['shoot'])).toBe(1)
    expect(maxRepeats(s, get(A(s, 'champion')), 'fight', ['fight'])).toBe(2)
    expect(maxRepeats(s, get(B(s, 'boy')), 'shoot', ['shoot'])).toBe(1)
    // a Conceal order does not stop a counteraction
    expect(canCounteractWithOrder(edit(s, (st) => (st.operatives[A(s, 'warrior')]!.order = 'conceal')), get(A(s, 'warrior')))).toBe(true)
    // second Shoot weapon choices
    const target = B(s, 'boy')
    const second = (id: string, used: string[]) => {
      const t = edit(place(place(activateOp(place(place(s, id, 0, 0), target, 5, 0), id), id, 0, 0), target, 5, 0), (st) => {
        st.firefight.activation!.performed = ['shoot']
        st.firefight.activation!.weaponsUsed = used
      })
      return shootableWeapons(t, t.operatives[id]!, ['shoot']).map((w) => w.weaponId)
    }
    const caster = second(A(s, 'plaguecaster'), ['pm.w.entropy'])
    expect(caster).toContain('pm.w.plague-wind')
    expect(caster).not.toContain('pm.w.entropy')
    const gunner = second(A(s, 'heavy-gunner'), ['pm.w.plague-spewer'])
    expect(gunner).toEqual(['pm.w.bolt-pistol'])
    expect(second(A(s, 'heavy-gunner'), ['pm.w.bolt-pistol'])).toContain('pm.w.plague-spewer')
  })

  it('TEAM-PM-004 Poison: damage from a success gives one token, never a second, never to a friendly Plague Marine', () => {
    let s = open()
    const hg = A(s, 'heavy-gunner')
    const boy = B(s, 'boy')
    s = place(place(s, hg, 0, 0), boy, 5, 0)
    // attack 6 1 1 1 1 (one crit), defence 1 1 1: the spewer deals 3 damage and the Boy is poisoned
    const r = play(take(take(activateOp(s, hg), 'shoot').state, 'pm.w.plague-spewer').state, new ScriptedRng([6, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), noPloys)
    const boyAfter = r.state.operatives[boy]!
    expect(boyAfter.wounds).toBeLessThan(boyAfter.maxWounds)
    expect(tokenCount(r.state, boy, POISON, 'A')).toBe(1)
    // a second hit adds no second token; a friendly Plague Marine hit by a Poison weapon gets none (Blast secondaries)
    const friend = A(s, 'warrior')
    const hit = (target: string, again = r.state) =>
      withCtx(again, (ctx) => {
        inflict(ctx, { targetId: target, attackerId: hg, weaponId: 'pm.w.plague-spewer', amount: 3, source: 'normal' })
      }).state
    expect(tokenCount(hit(boy), boy, POISON)).toBe(1)
    expect(tokenCount(hit(friend, s), friend, POISON)).toBe(0)
    // damage that is not from a success (Hot, direct) poisons nobody
    const direct = withCtx(s, (ctx) => {
      inflict(ctx, { targetId: boy, attackerId: hg, weaponId: 'pm.w.plague-spewer', amount: 3, source: 'direct' })
    }).state
    expect(tokenCount(direct, boy, POISON)).toBe(0)
  })

  it('TEAM-PM-005 TEAM-PM-027 a poisoned enemy takes 1 damage when activated (D3 with Poison Vents), none when counteracting; Vents can poison', () => {
    const s0 = open({ equipmentA: ['pm.e.poison-vents'] })
    const boy = B(s0, 'boy')
    const warrior = A(s0, 'warrior')
    const far = poison(s0, boy)
    // activated far from any Plague Marine: 1 damage before anything else
    const t = activateOp(bTurn(far, warrior), boy)
    expect(t.operatives[boy]!.wounds).toBe(t.operatives[boy]!.maxWounds - 1)
    // within 3" of a Plague Marine Poison Vents makes it D3 (roll 6 -> 3)
    const near = poison(place(s0, boy, 12.5, 0), boy)
    const nearT = edit(place(near, A(s0, 'bombardier'), 11, 0), () => undefined)
    const r = withCtx(nearT, (ctx) => {
      runHook('activation.start', { seat: 'B', state: ctx.state, engine: ctx, operativeId: boy, data: { previousOrder: 'conceal', order: 'engage' } })
    }, new ScriptedRng([6]))
    expect(r.state.operatives[boy]!.wounds).toBe(r.state.operatives[boy]!.maxWounds - 3)
    // an unpoisoned enemy near a Plague Marine gains a token on a D3 of 3 (roll 5 or 6) and takes no damage
    const clean = edit(place(place(s0, boy, 12.5, 0), A(s0, 'bombardier'), 11, 0), () => undefined)
    const gained = withCtx(clean, (ctx) => {
      runHook('activation.start', { seat: 'B', state: ctx.state, engine: ctx, operativeId: boy, data: { previousOrder: 'conceal', order: 'engage' } })
    }, new ScriptedRng([5]))
    expect(tokenCount(gained.state, boy, POISON, 'A')).toBe(1)
    expect(gained.state.operatives[boy]!.wounds).toBe(gained.state.operatives[boy]!.maxWounds)
    const missed = withCtx(clean, (ctx) => {
      runHook('activation.start', { seat: 'B', state: ctx.state, engine: ctx, operativeId: boy, data: { previousOrder: 'conceal', order: 'engage' } })
    }, new ScriptedRng([2]))
    expect(tokenCount(missed.state, boy, POISON)).toBe(0)
    // a counteraction is not an activation: no Poison damage
    const spent = edit(poison(open(), boy), (st) => {
      for (const o of Object.values(st.operatives)) if (o.seat === 'B') {
        o.ready = false
        o.order = 'engage'
      }
    })
    const c = bTurn(spent, warrior)
    expect(c.pending!.options!.some((o) => o.id === `counteract:${boy}`)).toBe(true)
    const counter = take(c, `counteract:${boy}`).state
    expect(counter.operatives[boy]!.wounds).toBe(counter.operatives[boy]!.maxWounds)
  })

  it('TEAM-PM-006 TEAM-PM-021 Disgustingly Resilient: D6 4+ takes 1 off a die of 3+, never off 2 or non-dice damage; Sickening Resilience needs no roll and floors at 2', () => {
    const s = open()
    const warrior = A(s, 'warrior')
    const boy = B(s, 'boy')
    const hit = (amount: number, source: string, dice: number[], pre?: (st: GameState) => void) => {
      const base = pre ? edit(s, pre) : s
      const r = withCtx(base, (ctx) => {
        inflict(ctx, { targetId: warrior, attackerId: boy, weaponId: 'kom.w.slugga', amount, source })
      }, new ScriptedRng(dice))
      return r.state.operatives[warrior]!.maxWounds - r.state.operatives[warrior]!.wounds
    }
    expect(hit(3, 'normal', [4])).toBe(2)
    expect(hit(3, 'crit', [3])).toBe(3)
    expect(hit(2, 'normal', [])).toBe(2) // never rolled for
    expect(hit(5, 'direct', [])).toBe(5) // Poison, FLAIL and other direct damage is never reduced
    expect(hit(1, 'hot', [])).toBe(1)
    expect(hit(5, 'strike-crit', [6])).toBe(4)
    // SICKENING RESILIENCE: no roll, 4 -> 3, 3 -> 2, 2 stays 2
    const sick = (st: GameState) => {
      st.effects.push({ id: 'e-sick', source: 'pm.p.sickening-resilience', seat: 'A', kind: 'ployFlag', operativeId: warrior, expires: 'activation' })
    }
    expect(hit(4, 'normal', [], sick)).toBe(3)
    expect(hit(3, 'normal', [], sick)).toBe(2)
    expect(hit(2, 'normal', [], sick)).toBe(2)
  })

  it('TEAM-PM-007 Toxic adds 1/1 Dmg only against targets that held a token when the action began', () => {
    const s = open()
    const champ = A(s, 'champion')
    const boy = B(s, 'boy')
    const nob = B(s, 'boss-nob')
    const sword = 'pm.w.plague-sword'
    const withAction = (st: GameState) => {
      st.firefight.activation = { operativeId: champ, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: { action: 'fight', cost: 1 }, declaredSeq: 10 }
    }
    const t = edit(s, (st) => {
      withAction(st)
      st.operatives[boy]!.tokens = [{ kind: POISON, owner: 'A', count: 1, since: 4 }]
      // the Nob was poisoned during this very action (a Blast primary that gained a token)
      st.operatives[nob]!.tokens = [{ kind: POISON, owner: 'A', count: 1, since: 12 }]
    })
    expect(weaponDamage(t, champ, sword, boy, 'fight')).toEqual({ normal: 5, crit: 6 })
    expect(weaponDamage(t, champ, sword, nob, 'fight')).toEqual({ normal: 4, crit: 5 })
    expect(weaponDamage(t, champ, sword, B(s, 'grot'), 'fight')).toEqual({ normal: 4, crit: 5 })
    // the Warrior's boltgun has Toxic, the Bombardier's does not
    expect(weaponDamage(t, A(s, 'warrior'), 'pm.w.boltgun-warrior', boy, 'shoot')).toEqual({ normal: 4, crit: 5 })
    expect(weaponDamage(t, A(s, 'bombardier'), 'pm.w.boltgun-bombardier', boy, 'shoot')).toEqual({ normal: 3, crit: 4 })
  })

  it("TEAM-PM-008 Grandfather's Blessing: the Champion regains wounds a poisoned enemy within 7 inches loses, 3 per turning point at most", () => {
    const base = open()
    const champ = A(base, 'champion')
    const boy = B(base, 'boy')
    const set = (x: number, token = true) => {
      let s = edit(place(place(base, champ, 0, 0), boy, x, 0), (st) => {
        st.operatives[champ]!.wounds = 6
      })
      if (token) s = poison(s, boy)
      return s
    }
    const lose = (s: GameState, n: number) => withCtx(s, (ctx) => {
      inflict(ctx, { targetId: boy, attackerId: A(base, 'warrior'), weaponId: null, amount: n, source: 'direct' })
    }).state
    expect(lose(set(5), 2).operatives[champ]!.wounds).toBe(8)
    // 3 at most per turning point, then nothing more
    const once = lose(set(5), 2)
    const twice = lose(once, 2)
    expect(twice.operatives[champ]!.wounds).toBe(9)
    expect(lose(twice, 2).operatives[champ]!.wounds).toBe(9)
    expect(lose(set(5, false), 2).operatives[champ]!.wounds).toBe(6) // no token
    expect(lose(set(9), 2).operatives[champ]!.wounds).toBe(6) // beyond 7"
    // never above its starting wounds, and not once incapacitated
    const nearly = edit(set(5), (st) => (st.operatives[champ]!.wounds = 14))
    expect(lose(nearly, 3).operatives[champ]!.wounds).toBe(15)
    const dead = edit(set(5), (st) => (st.operatives[champ]!.wounds = 0))
    expect(lose(dead, 3).operatives[champ]!.wounds).toBe(0)
  })

  it('TEAM-PM-009 TEAM-PM-026 Bombardier grenades hit at 3+ with Toxic and spend their own allowance; the team Blight Grenades stop after two uses', () => {
    const s = open({ equipmentA: ['pm.e.blight-grenades'] })
    const bomb = A(s, 'bombardier')
    const boy = B(s, 'boy')
    const op = s.operatives[bomb]!
    expect(op.weapons).toEqual(expect.arrayContaining(['pm.w.blight-grenade-bombardier', 'pm.w.krak-grenade-bombardier', 'pm.w.blight-grenade']))
    expect(attackStats(s, bomb, 'pm.w.blight-grenade-bombardier', boy, { kind: 'shoot' }).need).toBe(3)
    expect(attackStats(s, bomb, 'pm.w.krak-grenade-bombardier', boy, { kind: 'shoot' }).need).toBe(3)
    expect(attackStats(s, bomb, 'pm.w.blight-grenade', boy, { kind: 'shoot' }).need).toBe(4)
    expect(effectiveRules(s, op, s.data.weapons['pm.w.blight-grenade-bombardier']!, 'shoot').map((r) => r.rule)).toEqual(expect.arrayContaining(['toxic', 'poison']))
    // own allowance: 2 blight, 1 krak, separate from the team's
    const spent = edit(s, (st) => {
      st.operatives[bomb]!.order = 'engage'
      st.operatives[bomb]!.usedLimited = { 'pm.w.blight-grenade-bombardier': 2, 'pm.w.krak-grenade-bombardier': 1 }
    })
    expect(weaponUnusable(spent, spent.operatives[bomb]!, 'pm.w.blight-grenade-bombardier', [], 'shoot')).not.toBeNull()
    expect(weaponUnusable(spent, spent.operatives[bomb]!, 'pm.w.krak-grenade-bombardier', [], 'shoot')).not.toBeNull()
    expect(weaponUnusable(spent, spent.operatives[bomb]!, 'pm.w.blight-grenade', [], 'shoot')).toBeNull()
    // the team's second use strips the grenade from everyone
    const fighter = A(s, 'fighter')
    let t = edit(place(place(s, fighter, 0, 0), boy, 5, 0), (st) => addUse(st, 'A', 'limit:pm.w.blight-grenade', 1))
    t = take(take(activateOp(t, fighter), 'shoot').state, 'pm.w.blight-grenade').state
    const r = play(t, new ScriptedRng([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), noPloys)
    expect(usesOf(r.state, 'A', 'limit:pm.w.blight-grenade')).toBe(2)
    expect(Object.values(r.state.operatives).filter((o) => o.seat === 'A' && o.weapons.includes('pm.w.blight-grenade'))).toEqual([])
  })

  it('TEAM-PM-010 FLAIL: D3+2 to every operative visible within 2", a 3 poisons an enemy, counts as a Fight, not with Conceal', () => {
    let s = open()
    const fighter = A(s, 'fighter')
    const boy = B(s, 'boy')
    const nob = B(s, 'boss-nob')
    const friend = A(s, 'warrior')
    s = place(place(place(place(s, fighter, 0, 0), boy, 1.4, 0), nob, 0, 1.6), friend, -1.5, 0)
    const t = activateOp(s, fighter)
    expect(hasOption(t, `ability:pm.a.flail`)).toBe(true)
    // targets in id order: A4.. then B..; rolls 6 (D3 3), 2 (D3 1), 1 (D3 1)
    const ids = Object.values(t.operatives).filter((o) => [boy, nob, friend].includes(o.id)).map((o) => o.id).sort()
    const dice = ids.map((id) => (id === boy ? 6 : id === nob ? 2 : 1))
    const r = take(t, 'ability:pm.a.flail', new ScriptedRng(dice))
    const w = (id: string) => r.state.operatives[id]!.maxWounds - r.state.operatives[id]!.wounds
    expect(w(boy)).toBe(5) // D3 3 + 2
    expect(w(nob)).toBe(3) // D3 1 + 2
    expect(w(friend)).toBe(3) // friendly fire
    expect(tokenCount(r.state, boy, POISON, 'A')).toBe(1)
    expect(tokenCount(r.state, nob, POISON)).toBe(0)
    expect(tokenCount(r.state, friend, POISON)).toBe(0)
    // counts as a Fight: Fight + FLAIL is fine, Fight + FLAIL + Fight is not, FLAIL then Fight then Fight is not
    const done = (performed: string[]) => edit(t, (st) => (st.firefight.activation!.performed = performed))
    expect(maxRepeats(t, t.operatives[fighter]!, 'fight', ['fight', 'ability:pm.a.flail'])).toBe(1)
    expect(maxRepeats(t, t.operatives[fighter]!, 'fight', ['ability:pm.a.flail', 'fight'])).toBe(2)
    const offered = (performed: string[]) => abilityOffers(done(performed), done(performed).operatives[fighter]!, done(performed).firefight.activation).some((o) => o.abilityId === 'pm.a.flail')
    expect(offered(['fight', 'fight'])).toBe(false)
    expect(offered(['fight'])).toBe(true)
    // blocked by a Conceal order
    const hidden = activateOp(s, fighter, 'conceal')
    expect(hasOption(hidden, 'ability:pm.a.flail')).toBe(false)
  })

  it('TEAM-PM-011 TEAM-PM-012 Icon Bearer counts 1 higher for marker control; Contagion is free while it stands in the opponent territory', () => {
    const s = open({ rosterA: ICONS })
    const icon = A(s, 'icon-bearer')
    const m = s.markers.find((k) => k.kind === 'objective')!
    const on = edit(s, (st) => (st.operatives[icon]!.pos = { x: m.pos.x + 0.9, y: 0, z: m.pos.z }))
    expect(markerControl(on, m).apl.A).toBe(4)
    expect(markerControl(edit(on, (st) => (st.operatives[icon]!.aplMods = 1)), m).apl.A).toBe(5)
    // Contagion: 1 CP elsewhere, 0 CP in the opponent's territory
    const g = toGambit({ rosterA: ICONS })
    const cost = (st: GameState) => gambitOffers(st, 'A').find((o) => o.ployId === 'pm.p.contagion')?.cost
    const ic = opOf(g, 'A', 'pm.icon-bearer')
    const home = edit(g, (st) => {
      const home = territoryOf(st, 'A')!
      st.operatives[ic]!.pos = { x: home[0]!.x + 0.3, y: 0, z: home[0]!.z + 0.3 }
    })
    expect(cost(home)).toBe(1)
    const away = edit(g, (st) => {
      const foe = territoryOf(st, 'B')!
      const cx = foe.reduce((a, p) => a + p.x, 0) / foe.length
      const cz = foe.reduce((a, p) => a + p.z, 0) / foe.length
      st.operatives[ic]!.pos = { x: cx, y: 0, z: cz }
    })
    expect(cost(away)).toBe(0)
  })

  it('TEAM-PM-013 POISONOUS MIASMA: poisons an unpoisoned enemy visible within 7", 3 damage to a poisoned one, a valid target at any range, not in an enemy control range', () => {
    let s = open()
    const caster = A(s, 'plaguecaster')
    const boy = B(s, 'boy')
    const wall = { id: 'wall', parts: [{ id: 'wall.0', footprint: [{ x: -1.4, z: -3 }, { x: -1, z: -3 }, { x: -1, z: 3 }, { x: -1.4, z: 3 }], height: 0.8, traits: ['light' as const] }] }
    s = edit(place(place(s, caster, -5, 0), boy, 5, 0), (st) => (st.operatives[boy]!.order = 'engage'))
    const act = `ability:pm.a.poisonous-miasma:${boy}`
    let t = take(activateOp(s, caster), act)
    expect(tokenCount(t.state, boy, POISON, 'A')).toBe(1)
    expect(t.state.operatives[boy]!.wounds).toBe(t.state.operatives[boy]!.maxWounds)
    t = take(activateOp(poison(s, boy), caster), act)
    expect(t.state.operatives[boy]!.wounds).toBe(t.state.operatives[boy]!.maxWounds - 3)
    // a valid target at any range (Engage, visible), beyond 7"
    const far = edit(place(s, boy, 12, 0), () => undefined)
    expect(hasOption(activateOp(far, caster), `ability:pm.a.poisonous-miasma:${boy}`)).toBe(true)
    // a Conceal enemy in cover is not a valid target, but is still chosen when visible within 7"
    const hidden = edit(place(s, boy, 0, 0), (st) => {
      st.map = { ...st.map, features: [wall] }
      st.operatives[boy]!.order = 'conceal'
    })
    expect(hasOption(activateOp(hidden, caster), act)).toBe(true)
    // not while in an enemy control range
    expect(hasOption(activateOp(place(s, boy, -4.4, 0), caster), act)).toBe(false)
  })

  it('TEAM-PM-014 PUTRESCENT VITALITY: heals 7 on a total of 7, else the higher die, can target itself, once per turning point', () => {
    let s = open()
    const caster = A(s, 'plaguecaster')
    const champ = A(s, 'champion')
    s = edit(place(place(s, caster, 0, 0), champ, 2, 0), (st) => {
      st.operatives[champ]!.wounds = 3
      st.operatives[caster]!.wounds = 4
    })
    const heal = (target: string, dice: number[]) => take(activateOp(s, caster), `ability:pm.a.putrescent-vitality:${target}`, new ScriptedRng(dice)).state
    expect(heal(champ, [3, 4]).operatives[champ]!.wounds).toBe(10) // total 7: 7 wounds
    expect(heal(champ, [1, 5]).operatives[champ]!.wounds).toBe(8) // higher die 5
    expect(heal(champ, [6, 6]).operatives[champ]!.wounds).toBe(9) // higher die 6
    expect(heal(caster, [6, 4]).operatives[caster]!.wounds).toBe(10) // self
    // never above the starting wounds
    const nearly = edit(s, (st) => (st.operatives[champ]!.wounds = 13))
    expect(take(activateOp(nearly, caster), `ability:pm.a.putrescent-vitality:${champ}`, new ScriptedRng([3, 4])).state.operatives[champ]!.wounds).toBe(15)
    // a second use in the same turning point is not offered
    const after = heal(champ, [1, 2])
    expect(after.ledger.A.tp).toContain(`pm.vitality:${caster}`)
    const again = edit(after, (st) => {
      st.firefight.activation = null
    })
    expect(abilityOffers(again, again.operatives[caster]!, null).some((o) => o.abilityId === 'pm.a.putrescent-vitality')).toBe(false)
  })

  it('TEAM-PM-015 Repulsive Fortitude: the Warrior defence dice of 5 are crits when shot, nobody else benefits', () => {
    const s = open()
    const warrior = A(s, 'warrior')
    const fighter = A(s, 'fighter')
    const boy = B(s, 'boy')
    const roll = (target: string) => {
      const dice = [5, 3, 6, 4, 2].map((value) => ({ value, kind: value >= 4 ? (value === 6 ? 'crit' : 'normal') : 'fail', rerolled: false }))
      withCtx(s, (ctx) => {
        runHook('afterDefenceRoll', { seat: 'A', state: ctx.state, engine: ctx, operativeId: target, targetId: boy, data: { kind: 'shoot', side: 'defence', targetId: boy, dice, requests: [], choices: {} } })
      })
      return dice.map((d) => d.kind)
    }
    expect(roll(warrior)).toEqual(['crit', 'fail', 'crit', 'normal', 'fail'])
    expect(roll(fighter)).toEqual(['normal', 'fail', 'crit', 'normal', 'fail'])
  })

  it('TEAM-PM-016 CONTAGION: Move -2" and Hit worse by 1 on a poisoned enemy within 3", or near an Icon Bearer; never on top of injury', () => {
    let s = open({ rosterA: ICONS })
    const warrior = A(s, 'warrior')
    const icon = A(s, 'icon-bearer')
    const boy = B(s, 'boy')
    const flag = (st: GameState) => {
      st.effects.push({ id: 'e-contagion', source: 'pm.p.contagion', seat: 'A', kind: 'ployFlag', expires: 'turningPoint' })
    }
    const need = (st: GameState) => attackStats(st, boy, 'kom.w.slugga', warrior, { kind: 'shoot' }).need
    s = place(place(place(s, warrior, 0, 0), boy, 2.5, 0), icon, -13, 9)
    const on = edit(poison(s, boy), flag)
    expect(effectiveMove(on.operatives[boy]!, on)).toBe(4)
    expect(need(on)).toBe(need(s) + 1)
    expect(contagionApplies(on, on.operatives[boy]!)).toBe(true)
    // already injured: no extra penalty
    const hurt = edit(on, (st) => {
      st.operatives[boy]!.wounds = 2
      st.operatives[boy]!.flags.injured = true
    })
    const hurtOnly = edit(s, (st) => {
      st.operatives[boy]!.wounds = 2
      st.operatives[boy]!.flags.injured = true
    })
    expect(effectiveMove(hurt.operatives[boy]!, hurt)).toBe(effectiveMove(hurtOnly.operatives[boy]!, hurtOnly))
    expect(need(hurt)).toBe(need(hurtOnly))
    // an unpoisoned enemy near a plain Plague Marine, or a poisoned one more than 3" away, is unaffected
    const plain = edit(s, flag)
    expect(contagionApplies(plain, plain.operatives[boy]!)).toBe(false)
    const distant = edit(poison(place(s, boy, 4.4, 0), boy), flag)
    expect(contagionApplies(distant, distant.operatives[boy]!)).toBe(false)
    // within 3" of the Icon Bearer it applies without a token
    const near = edit(place(s, icon, 1, 0), flag)
    expect(contagionApplies(near, near.operatives[boy]!)).toBe(true)
  })

  it('TEAM-PM-017 LUMBERING DEATH: Ceaseless after 3" of movement, not after more, always when retaliating, not when counteracting', () => {
    const s = open()
    const warrior = A(s, 'warrior')
    const boy = B(s, 'boy')
    const withPloy = (f: (st: GameState) => void) =>
      edit(s, (st) => {
        st.effects.push({ id: 'e-ld', source: 'pm.p.lumbering-death', seat: 'A', kind: 'ployFlag', expires: 'turningPoint' })
        f(st)
      })
    const ceaseless = (st: GameState, kind: 'shoot' | 'fight' = 'shoot') =>
      effectiveRules(st, st.operatives[warrior]!, st.data.weapons[kind === 'shoot' ? 'pm.w.boltgun-warrior' : 'pm.w.plague-knife-warrior']!, kind, boy).some((r) => r.rule === 'ceaseless')
    const activation = (moved: number, counteract = false) => (st: GameState) => {
      st.firefight.activation = { operativeId: warrior, seat: 'A', counteract, stage: 'action', apSpent: 1, performed: [], declared: null }
      st.operatives[warrior]!.movedThisActivation = moved
    }
    expect(ceaseless(s)).toBe(false) // no ploy
    expect(ceaseless(withPloy(activation(3)))).toBe(true)
    expect(ceaseless(withPloy(activation(0)))).toBe(true)
    expect(ceaseless(withPloy(activation(3.5)))).toBe(false)
    expect(ceaseless(withPloy(activation(4)))).toBe(false) // 2" move plus a 2" climb cost
    expect(ceaseless(withPloy(activation(0, true)))).toBe(false) // a counteraction is not an activation
    // retaliating: the fight was started by the other side
    const retaliating = withPloy((st) => {
      activation(9)(st)
      st.attack = { kind: 'fight', operativeId: boy, seat: 'B', stage: 'fightReroll', weaponId: null, pointBlank: false, targets: [], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] } as never
    })
    expect(ceaseless(retaliating, 'fight')).toBe(true)
    expect(lumberingApplies(retaliating, retaliating.operatives[warrior]!, 'shoot')).toBe(false)
  })

  it('TEAM-PM-018 TEAM-PM-019 TEAM-PM-020 CLOUD OF FLIES obscures and goes; NURGLINGS and VIRULENT POISON pick the right enemies', () => {
    // Cloud of Flies: the strategy ploy places the marker; it obscures against shooters more than 3" away
    let g = toGambit()
    const spot = g.pending!.options!.find((o) => o.id.startsWith('pm.p.cloud-of-flies:'))!
    g = take(g, spot.id).state
    const marker = g.markers.find((m) => m.equipmentId === 'pm.p.cloud-of-flies')!
    expect(marker).toBeDefined()
    const pmId = Object.values(g.operatives).find((o) => o.seat === 'A' && Math.hypot(o.pos.x - marker.pos.x, o.pos.z - marker.pos.z) < 0.4)!.id
    const boy0 = B(g, 'boy')
    const status = (shooterAt: number) => {
      const t = place(g, boy0, marker.pos.x + shooterAt, marker.pos.z)
      const data = { obscured: false, inCover: false }
      runHook('target.status', { seat: 'B', state: t, operativeId: boy0, targetId: pmId, data })
      return data.obscured
    }
    expect(status(6)).toBe(true)
    expect(status(2)).toBe(false)
    // and the marker is removed in the Ready step of the next Strategy phase
    const gone = withCtx(g, (ctx) => {
      runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })
    }).state
    expect(gone.markers.some((m) => m.equipmentId === 'pm.p.cloud-of-flies')).toBe(false)

    // Nurglings: within 3", or poisoned within 7"; an unpoisoned enemy 5" away is not selectable
    let s = open()
    const warrior = A(s, 'warrior')
    const boy = B(s, 'boy')
    const nob = B(s, 'boss-nob')
    const grot = B(s, 'grot')
    s = place(place(place(place(s, warrior, 0, 0), boy, 2.5, 0), nob, 5, 0), grot, 6, 0)
    expect(nurglingTargets(s, 'A').map((o) => o.id)).toEqual([boy])
    expect(nurglingTargets(poison(s, nob), 'A').map((o) => o.id).sort()).toEqual([boy, nob].sort())
    const offer = offersFor(s, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).find((o) => o.ployId === 'pm.p.nurglings' && o.param === boy)!
    const t = withCtx(s, (ctx) => usePloy(ctx, 'A', offer, { window: 'strategy.gambit' })).state
    expect(effectiveApl(t.operatives[boy]!)).toBe(effectiveApl(s.operatives[boy]!) - 1)
    // stacked with Stun the cap holds: still only 1 below the printed APL
    const stunned = edit(t, (st) => {
      st.operatives[boy]!.aplMods -= 1
    })
    expect(effectiveApl(stunned.operatives[boy]!)).toBe(effectiveApl(s.operatives[boy]!) - 1)

    // Virulent Poison: within 3" with no line of sight, or visible within 7", not a hidden one 5" away
    const wall = { id: 'wall', parts: [{ id: 'wall.0', footprint: [{ x: 1, z: -3 }, { x: 1.4, z: -3 }, { x: 1.4, z: 3 }, { x: 1, z: 3 }], height: 3, traits: ['heavy' as const, 'blocking' as const] }] }
    const walled = edit(place(place(place(s, boy, 2.5, 0), nob, 5, 0), grot, 5, 2), (st) => {
      st.map = { ...st.map, features: [wall] }
    })
    const info = { window: 'firefight.activationStart', subjectId: warrior, counteracting: false }
    const targets = offersFor(walled, 'A', 'firefight.activationStart', info).filter((o) => o.ployId === 'pm.p.virulent-poison').map((o) => o.param)
    expect(targets).toEqual([boy])
    const open3 = place(place(place(s, boy, 2.5, 0), nob, 5, 3), grot, 5, -3)
    const clear = offersFor(open3, 'A', 'firefight.actionEnded', { window: 'firefight.actionEnded', subjectId: warrior }).filter((o) => o.ployId === 'pm.p.virulent-poison').map((o) => o.param)
    expect(clear.sort()).toEqual([boy, nob, grot].sort())
    const used = withCtx(s, (ctx) => usePloy(ctx, 'A', offersFor(s, 'A', 'firefight.activationStart', info).find((o) => o.param === boy)!, info)).state
    expect(tokenCount(used, boy, POISON, 'A')).toBe(1)
  })

  it('TEAM-PM-022 POISONOUS DEMISE: poisons unpoisoned enemies visible within 3", 1 damage to poisoned ones (also one poisoned earlier in the action), 1 CP', () => {
    let s = open()
    const warrior = A(s, 'warrior')
    const boy = B(s, 'boy')
    const nob = B(s, 'boss-nob')
    const grot = B(s, 'grot')
    s = edit(place(place(place(place(s, warrior, 0, 0), boy, 2, 1.5), nob, 2, -1.5), grot, 8, 0), (st) => {
      st.operatives[warrior]!.wounds = 0
    })
    s = poison(s, boy)
    const cp = s.players.A.cp
    // M10 batch D shared: outside an attack the removal waits for the end-of-step queue, whose operative.incapacitated
    // window offers the ploy; using it removes the Plague Marine and gives the parked decision back
    const parked = s.pending
    const asked = withCtx(s, (ctx) => {
      removeNow(ctx, warrior)
      expect(ctx.state.operatives[warrior]!.status).toBe('active')
      runDeferredRemovals(ctx)
    })
    expect(asked.state.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'operative.incapacitated' })
    const r = take(asked.state, ID_DEMISE)
    expect(r.state.pending?.id).toBe(parked?.id)
    expect(r.state.operatives[warrior]!.status).toBe('removed')
    expect(r.state.operatives[boy]!.wounds).toBe(r.state.operatives[boy]!.maxWounds - 1) // already poisoned: 1 damage
    expect(tokenCount(r.state, nob, POISON, 'A')).toBe(1) // newly poisoned
    expect(r.state.operatives[nob]!.wounds).toBe(r.state.operatives[nob]!.maxWounds)
    expect(tokenCount(r.state, grot, POISON)).toBe(0) // too far
    expect(r.state.players.A.cp).toBe(cp - 1)
    // no CP left: nothing happens
    const broke = edit(s, (st) => (st.players.A.cp = 0))
    const gone = withCtx(broke, (ctx) => removeNow(ctx, warrior)).state
    expect(gone.operatives[warrior]!.status).toBe('removed') // nothing to offer: removed at once
    expect(tokenCount(gone, nob, POISON)).toBe(0)
  })

  it('TEAM-PM-023 CURSE OF ROT: every 3 the opponent rolls deals 1 damage and cannot be a success, shooting or fighting; not while retaliating', () => {
    const curse = (q: PendingDecision): Action => q.options?.find((o) => o.id === 'pm.p.curse-of-rot')?.action ?? pass(q)
    const answers = { 'ploy.firefight': (q: PendingDecision): Action => (q.seat === 'A' ? curse(q) : pass(q)) }
    // shooting: attack 6 1 1 1 against defence 3 3 6 (the Boy saves on 5+)
    let s = open()
    const hg = A(s, 'heavy-gunner')
    const boy = B(s, 'boy')
    s = place(place(s, hg, 0, 0), boy, 3, 0)
    const shot = play(take(take(activateOp(s, hg), 'shoot').state, 'pm.w.bolt-pistol').state, new ScriptedRng([6, 1, 1, 1, 3, 3, 6, 1, 1, 1, 1, 1, 1, 1]), answers)
    const direct = shot.events.filter((e) => e.type === 'DamageInflicted' && (e as { source: string }).source === 'direct' && (e as { operativeId: string }).operativeId === boy)
    expect(direct).toHaveLength(2)
    expect(shot.state.operatives[boy]!.wounds).toBeLessThanOrEqual(boy ? 10 - 2 : 0)
    // the crit still blocks the attack crit; the two 3s are fails (no block): one attack crit blocked by the defence crit, so only the 2 direct damage lands
    expect(shot.state.operatives[boy]!.wounds).toBe(10 - 2)
    // offered in the window on the fresh defence roll, before the defender's re-rolls (shoot.beforeDefenceRerolls)
    const windows: string[] = []
    const seen = { 'ploy.firefight': (q: PendingDecision): Action => (q.options?.some((o) => o.id === 'pm.p.curse-of-rot') && windows.push(String(q.window)), answers['ploy.firefight'](q)) }
    const curseShot = (st: GameState) => play(take(take(activateOp(st, hg), 'shoot').state, 'pm.w.bolt-pistol').state, new ScriptedRng([6, 1, 1, 1, 3, 3, 6, 1, 1, 1, 1, 1, 1, 1]), seen)
    const directOn = (r: ReturnType<typeof play>) => r.events.filter((e) => e.type === 'DamageInflicted' && (e as { source: string }).source === 'direct' && (e as { operativeId: string }).operativeId === boy)
    expect(directOn(curseShot(place(s, boy, 3, 0)))).toHaveLength(2)
    expect(windows).toEqual(['shoot.beforeDefenceRerolls'])
    // not offered beyond the range (5" away, no token)
    windows.length = 0
    expect(directOn(curseShot(place(s, boy, 5, 0)))).toHaveLength(0)
    expect(windows).toEqual([])
    // but a poisoned target at 7" is in range
    expect(directOn(curseShot(poison(place(s, boy, 7, 0), boy)))).toHaveLength(2)
    // and not when the defence roll shows no 3
    windows.length = 0
    play(take(take(activateOp(place(s, boy, 3, 0), hg), 'shoot').state, 'pm.w.bolt-pistol').state, new ScriptedRng([6, 1, 1, 1, 4, 4, 6, 1, 1, 1, 1, 1, 1, 1]), seen)
    expect(windows).toEqual([])

    // fighting: the Champion's dice 1 1 1 1 1, the Boy's choppa 3 3 6 1
    const fresh = open()
    const champ = A(fresh, 'champion')
    const f = edit(place(place(fresh, champ, 0, 0), boy, 1.4, 0), (st) => {
      st.operatives[boy]!.order = 'engage'
    })
    const fought = play(take(activateOp(f, champ), 'fight').state, new ScriptedRng([1, 1, 1, 1, 1, 3, 3, 6, 1, 1, 1, 1, 1, 1]), seen)
    const dmg = fought.events.filter((e) => e.type === 'DamageInflicted' && (e as { source: string }).source === 'direct' && (e as { operativeId: string }).operativeId === boy)
    expect(dmg).toHaveLength(2)
    expect(windows.at(-1)).toBe('fight.beforeRerolls')
    // not offered to the retaliating side: the Boy attacks the Champion, so the Champion cannot use it
    const info = { window: 'fight.beforeRerolls', attackerId: boy, targetId: champ, kind: 'fight', subjectId: champ }
    expect(offersFor(f, 'A', 'fight.beforeRerolls', info).some((o) => o.ployId === 'pm.p.curse-of-rot')).toBe(false)
  })

  it('TEAM-PM-024 TEAM-PM-025 PLAGUE BELLS keep an injured Plague Marine at full Move and Hit; PLAGUE ROUNDS give bolt weapons Poison and Severe', () => {
    const hurt = (st: GameState, id: string) => {
      st.operatives[id]!.wounds = 3
      st.operatives[id]!.flags.injured = true
    }
    const plain = open()
    const warrior = A(plain, 'warrior')
    const boy = B(plain, 'boy')
    const bad = edit(plain, (st) => hurt(st, warrior))
    expect(effectiveMove(bad.operatives[warrior]!, bad)).toBe(4)
    expect(attackStats(bad, warrior, 'pm.w.boltgun-warrior', boy, { kind: 'shoot' }).need).toBe(4)
    const bells = open({ equipmentA: ['pm.e.plague-bells'] })
    const ok = edit(bells, (st) => hurt(st, warrior))
    expect(effectiveMove(ok.operatives[warrior]!, ok)).toBe(5)
    // the printed Hit (3+); handlers.ts also improves Hit by 1 for any operative that ignores injury, so allow that
    expect(attackStats(ok, warrior, 'pm.w.boltgun-warrior', boy, { kind: 'shoot' }).need).toBeLessThanOrEqual(3)
    expect(attackStats(ok, warrior, 'pm.w.boltgun-warrior', boy, { kind: 'shoot' }).need).toBeLessThan(attackStats(bad, warrior, 'pm.w.boltgun-warrior', boy, { kind: 'shoot' }).need)
    // Plague Rounds
    const rounds = open({ equipmentA: ['pm.e.plague-rounds'] })
    const names = (st: GameState, who: string, w: string, kind: 'shoot' | 'fight' = 'shoot') => effectiveRules(st, st.operatives[who]!, st.data.weapons[w]!, kind, boy).map((r) => r.rule)
    expect(names(rounds, warrior, 'pm.w.boltgun-warrior')).toEqual(expect.arrayContaining(['poison', 'severe', 'toxic']))
    expect(names(rounds, A(rounds, 'fighter'), 'pm.w.bolt-pistol')).toEqual(expect.arrayContaining(['poison', 'severe']))
    expect(names(rounds, A(rounds, 'bombardier'), 'pm.w.boltgun-bombardier')).toEqual(expect.arrayContaining(['poison', 'severe']))
    expect(names(rounds, A(rounds, 'champion'), 'pm.w.plasma-pistol-standard')).toEqual(['range', 'piercing'])
    expect(names(plain, A(plain, 'fighter'), 'pm.w.bolt-pistol')).toEqual(['range'])
  })
})
