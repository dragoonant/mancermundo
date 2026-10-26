// blooded engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-BL-nnn).
// Blooded are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { createGame, view } from '@/engine'
import { act } from '@/engine/actions'
import { actionCostDelta, chargeUnderConceal, refreshFlags } from '@/engine/abilities'
import { applyAplEffect, attackStats, runDeferredRemovals, defenceStats, effectiveRules, inflict, parseRules, targetInfo, validTargets, weaponDamage } from '@/engine/attack-common'
import { directDamage, markUsedBattle, removeNow, usedThisBattle } from '@/engine/effects'
import { expectedDamage } from '@/engine/query'
import { runHook } from '@/engine/hooks'
import { offersFor } from '@/engine/ploys'
import { poolOf } from '@/engine/pools'
import { beginTurningPoint } from '@/engine/strategy'
import { ScriptedRng } from '@/engine/rng'
import { effectiveApl, effectiveMove } from '@/engine/state'
import { TEAM_ID, holdsToken, inEnemyTerritory, isHolder, underGaze } from '@/engine/teams/blooded'
import { providerExtraCoverSaves, providerRerollBannedValues } from '@/engine/team-rules'
import { hasToken, tokenCount, tokensOnActivationStart } from '@/engine/tokens'
import type { GameState, PendingDecision } from '@/engine/types'
import { enumerateLoadouts, loadBundle, loadoutCapProblems, validateRoster, type DatacardData } from '../../../src/data'
import { play } from '../../fixtures/attack'
import { drive, place } from '../../fixtures/helpers'
import { activateOp, edit, optionIds, realBundle, realSetupWith, roster, take, withCtx } from '../../fixtures/real'
import { feature, part, rect } from '../../fixtures/maps'
import { A, B, MATCH, bTurn, full, dice, engaged, facing, goTo, marked, open, shootAt, strikes, takePloy, toGambit, usePlayed, useDemise, withFx, withPool } from './blooded.hooks'

const data = loadBundle()
const team = data.teams['blooded']!
const cards = realBundle.datacards

const MAIN = ['bl.brimstone-grenadier', 'bl.butcher', 'bl.commsman', 'bl.corpseman', 'bl.flenser', 'bl.gunner', 'bl.sharpshooter', 'bl.thug', 'bl.trench-sweeper']
const rosterOf = (main: string[], heavy: string[]) => ({ leader: ['bl.chieftain'], main, heavy })
const check = (main: string[], heavy: string[]) => validateRoster(team, rosterOf(main, heavy), cards as never)
/** Flags are refreshed after every engine step; a test that edits positions refreshes them itself. */
const settle = (s: GameState): GameState => edit(s, (st) => refreshFlags(st))

/** A light wall across the lane: a target just behind it (x 4) is in cover, one at x 6 is not. */
const wall = () => feature('bl-wall', part('bl-wall.a', rect(3, 3.4, -2, 2), 1, ['light']))
const heavyWall = () => feature('bl-heavy', part('bl-heavy.a', rect(3, 3.4, -2, 2), 3, ['heavy']))
const withTerrain = (s: GameState, ...features: ReturnType<typeof feature>[]): GameState =>
  edit(s, (st) => {
    st.map = { ...st.map, features }
    for (const o of Object.values(st.operatives)) o.order = 'engage'
  })

describe('TEAM-BL Blooded', () => {
  it('TEAM-BL-000 TEAM-BL-001 TEAM-BL-002 TEAM-BL-003 playable team, roster rules, printed loadouts and weapons', () => {
    expect(TEAM_ID).toBe('blooded')
    expect(team.playable).toBe(true)
    // Chieftain, nine main picks and Enforcer plus Ogryn (12); nine main picks and four Troopers (14); Enforcer and two Troopers
    expect(check(MAIN, ['bl.enforcer', 'bl.ogryn']).ok).toBe(true)
    expect(check(['bl.trooper', 'bl.trooper', ...MAIN.slice(0, 7)], Array<string>(4).fill('bl.trooper')).ok).toBe(true)
    expect(check(MAIN, ['bl.enforcer', 'bl.trooper', 'bl.trooper']).ok).toBe(true)
    // the heavy list is filled exactly, the Enforcer and Ogryn once each
    for (const heavy of [['bl.enforcer'], ['bl.enforcer', 'bl.enforcer'], ['bl.ogryn', 'bl.ogryn'], ['bl.enforcer', 'bl.ogryn', 'bl.trooper'], ['bl.trooper', 'bl.trooper', 'bl.trooper']]) {
      expect(check(MAIN, heavy).ok, heavy.join()).toBe(false)
    }
    // a second Butcher, a second Corpseman, a tenth main pick
    expect(check([...MAIN.slice(0, 8), 'bl.butcher'], ['bl.enforcer', 'bl.ogryn']).ok).toBe(false)
    expect(check([...MAIN.slice(0, 8), 'bl.corpseman'], ['bl.enforcer', 'bl.ogryn']).ok).toBe(false)
    expect(check([...MAIN, 'bl.trooper'], ['bl.enforcer', 'bl.ogryn']).ok).toBe(false)
    // three of Gunner and Sharpshooter together are legal, four are not
    const three = ['bl.gunner', 'bl.gunner', 'bl.sharpshooter', 'bl.butcher', 'bl.commsman', 'bl.corpseman', 'bl.flenser', 'bl.thug', 'bl.trooper']
    expect(check(three, ['bl.enforcer', 'bl.ogryn']).ok).toBe(true)
    expect(check(['bl.gunner', 'bl.gunner', 'bl.gunner', 'bl.sharpshooter', ...three.slice(3, 8)], ['bl.enforcer', 'bl.ogryn']).ok).toBe(false)
    // each Gunner weapon at most once; one plasma weapon in the whole kill team
    const flamer = ['bl.w.flamer']
    const melta = ['bl.w.meltagun']
    expect(loadoutCapProblems(team, [flamer, flamer], data.weaponGroups)).toHaveLength(1)
    expect(loadoutCapProblems(team, [flamer, melta], data.weaponGroups)).toEqual([])
    const plasmaGun = ['bl.w.plasma-gun-standard', 'bl.w.plasma-gun-supercharge']
    const plasmaPistol = ['bl.w.plasma-pistol-standard', 'bl.w.plasma-pistol-supercharge', 'bl.w.improvised-blade']
    expect(loadoutCapProblems(team, [plasmaGun, plasmaPistol], data.weaponGroups).length).toBeGreaterThan(0)
    expect(loadoutCapProblems(team, [plasmaGun, ['bl.w.autopistol', 'bl.w.chainsword']], data.weaponGroups)).toEqual([])
    const count = (id: string) => enumerateLoadouts(data.byId[id] as DatacardData).length
    expect([count('bl.chieftain'), count('bl.gunner'), count('bl.trooper'), count('bl.sharpshooter')]).toEqual([7, 4, 1, 1])
    // printed numbers
    const w = (id: string) => data.byId[id] as { atk: number; hit: string; dmg: { normal: number; crit: number }; rules: { rule: string }[] }
    expect(w('bl.w.bayonet-chieftain').hit).toBe('3+')
    expect(w('bl.w.bayonet').hit).toBe('4+')
    expect(w('bl.w.diabolyk-bomb').dmg).toEqual({ normal: 4, crit: 3 })
    expect(w('bl.w.meltagun').dmg).toEqual({ normal: 6, crit: 3 })
    expect(w('bl.w.flamer').hit).toBe('2+')
    for (const g of ['bl.w.grenade-launcher-frag', 'bl.w.grenade-launcher-krak', 'bl.w.meltagun', 'bl.w.plasma-gun-standard', 'bl.w.plasma-gun-supercharge']) expect(w(g).hit, g).toBe('4+')
    expect(w('bl.w.power-fist').rules.map((r) => r.rule)).toEqual(['core.wr.brutal'])
    expect(w('bl.w.power-weapon-cleaver').rules.map((r) => r.rule)).toEqual(['core.wr.ceaseless', 'core.wr.lethal', 'bl.a.wr-blood-offering'])
    expect(w('bl.w.long-las-stationary').rules.map((r) => r.rule)).toEqual(['core.wr.devastating', 'core.wr.heavy', 'core.wr.silent'])
    // twelve to fourteen operatives, every card APL 2 and Move 6, the large bases
    const s = open()
    const mine = Object.values(s.operatives).filter((o) => o.seat === 'A')
    expect(mine).toHaveLength(12)
    for (const o of mine) {
      expect([o.apl, o.move], o.datacardId).toEqual([2, 6])
      expect(s.data.datacards[o.datacardId]!.keywords).toEqual(expect.arrayContaining(['BLOODED', 'CHAOS']))
    }
    expect(data.byId['bl.enforcer']).toMatchObject({ base: 32, stats: { wounds: 9, save: '4+' } })
    expect(data.byId['bl.ogryn']).toMatchObject({ base: 40, stats: { wounds: 16 } })
  })

  it('TEAM-BL-004 token gains: the Ready step, the first enemy down each turning point (any cause), the first friendly down within 6 inches of an enemy', () => {
    const s = open()
    const tr = A(s, 'trooper')
    const boy = B(s, 'boy')
    expect(poolOf(s, 'A', 'bl.blooded')).toBe(1)
    const next = withCtx(s, (ctx) => runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })).state
    expect(poolOf(next, 'A', 'bl.blooded')).toBe(2)
    expect(poolOf(next, 'B', 'bl.blooded')).toBe(0)
    const removed = (st: GameState, id: string, cause: 'attack' | 'direct' | 'scored' | 'offboard') =>
      withCtx(st, (ctx) => {
        ctx.state.operatives[id]!.status = 'removed'
        runHook('operative.removed', { seat: ctx.state.operatives[id]!.seat, state: ctx.state, engine: ctx, operativeId: id, data: { killerId: null, cause } })
      }).state
    // an enemy goes by a mine or a rule (direct): one token; the second in the same turning point none; a deadline out of the killzone none
    expect(poolOf(removed(s, boy, 'direct'), 'A', 'bl.blooded')).toBe(2)
    expect(poolOf(removed(removed(s, boy, 'direct'), B(s, 'grot'), 'attack'), 'A', 'bl.blooded')).toBe(2)
    expect(poolOf(removed(s, boy, 'offboard'), 'A', 'bl.blooded')).toBe(1)
    // a friendly operative falls: only within 6 inches of an enemy, once per turning point
    const near = place(place(s, tr, 0, 0), boy, 5, 0)
    expect(poolOf(removed(near, tr, 'attack'), 'A', 'bl.blooded')).toBe(2)
    expect(poolOf(removed(removed(near, tr, 'attack'), A(s, 'butcher'), 'attack'), 'A', 'bl.blooded')).toBe(2)
    expect(poolOf(removed(place(place(s, tr, 0, 0), boy, 8, 0), tr, 'attack'), 'A', 'bl.blooded')).toBe(1)
    // the Kommandos player has no Blooded pool: nothing for them
    expect(poolOf(removed(s, tr, 'attack'), 'B', 'bl.blooded')).toBe(0)
    // a real Shoot that incapacitates an enemy: the removal pass logs it and the token arrives
    const t = engaged(place(place(s, tr, 0, 0), boy, 5, 0))
    const kill = edit(t, (st) => void (st.operatives[boy]!.wounds = 1))
    const r = shootAt(kill, tr, 'bl.w.lasgun', boy, dice(6, 6, 6, 6, 1, 1, 1))
    expect(r.state.operatives[boy]!.status).toBe('removed')
    expect(poolOf(r.state, 'A', 'bl.blooded')).toBe(2)
  })

  it('TEAM-BL-005 the Blooded gambit assigns pool tokens one at a time (a holder is not offered again), then a Gaze pick with four holders that ends with the turning point', () => {
    const g = toGambit()
    expect(offersFor(g, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).find((o) => o.ployId === 'bl.p.blooded')?.cost).toBe(0)
    // one token in the pool at the start: assign it to the Trooper
    const tr = A(g, 'trooper')
    let t = take(g, 'bl.p.blooded').state
    expect(t.pending!.context.hook).toBe('blGambit')
    expect(optionIds(t)).toContain(tr)
    t = take(t, tr).state
    expect(tokenCount(t, tr, 'bl.blooded', 'A')).toBe(1)
    expect(poolOf(t, 'A', 'bl.blooded')).toBe(0)
    expect(t.pending!.kind).toBe('strategy.gambit')
    expect(t.ledger.A.tp).toContain('bl.p.blooded')
    // five tokens: four assignments, the marked ones are not offered again, then the Gaze
    let u = take(withPool(g, 5), 'bl.p.blooded').state
    const picked: string[] = []
    for (let i = 0; i < 4; i++) {
      expect(u.pending!.context.step).toBe('assign')
      for (const id of picked) expect(optionIds(u)).not.toContain(id)
      const id = u.pending!.options!.find((o) => o.id !== 'done')!.id
      picked.push(id)
      u = take(u, id).state
    }
    expect(poolOf(u, 'A', 'bl.blooded')).toBe(1)
    // the pool still holds one and unmarked operatives remain: another assignment is asked, 'done' moves on to the Gaze
    u = take(u, 'done').state
    expect(u.pending!.context.step).toBe('gaze')
    expect(optionIds(u).sort()).toEqual([...picked, 'none'].sort())
    u = take(u, picked[0]!).state
    expect(hasToken(u, picked[0]!, 'bl.gaze', 'A')).toBe(true)
    expect(underGaze(u, u.operatives[picked[0]!])).toBe(true)
    expect(underGaze(u, u.operatives[picked[1]!])).toBe(false)
    expect(poolOf(u, 'A', 'bl.blooded')).toBe(1)
    // with fewer than four holders and no pool the gambit is not offered
    const none = withPool(g, 0)
    expect(offersFor(none, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'bl.p.blooded')).toBe(false)
  })

  it('TEAM-BL-006 a holder rolls one die fewer with a free Accurate success, under the Gaze that success is a crit (the odds agree) and against an obscured target it stays normal', () => {
    const s0 = engaged(open())
    const tr = A(s0, 'trooper')
    const boy = B(s0, 'boy')
    const base = place(place(s0, tr, 0, 0), boy, 5, 0)
    expect(attackStats(base, tr, 'bl.w.lasgun', boy, { kind: 'shoot' }).accurate).toBe(0)
    const s = marked(base, [tr])
    expect(attackStats(s, tr, 'bl.w.lasgun', boy, { kind: 'shoot' }).accurate).toBe(1)
    // fights as well (the bayonet), and a Kommandos operative with a token of its own seat gets nothing
    expect(attackStats(s, tr, 'bl.w.bayonet', boy, { kind: 'fight' }).accurate).toBe(1)
    expect(attackStats(marked(base, [boy], 'bl.blooded', 'B'), boy, 'kom.w.slugga', tr, { kind: 'shoot' }).accurate).toBe(0)
    // the roll: Accurate success kept as a normal success, or as a crit under the Gaze
    const rolled = (st: GameState) => {
      const r = shootAt(edit(st, (x) => void (x.operatives[boy]!.wounds = 40)), tr, 'bl.w.lasgun', boy, dice(1, 1, 1))
      return r.events.filter((e) => e.type === 'AttackRetained').map((e) => ({ normal: (e as { normal: number }).normal, crit: (e as { crit: number }).crit }))[0]
    }
    expect(rolled(s)).toEqual({ normal: 1, crit: 0 })
    const gazed = marked(s, [tr], 'bl.gaze', 'A', ['turningPointEnd'])
    expect(rolled(gazed)).toEqual({ normal: 0, crit: 1 })
    // the odds agree with the dice: the Gaze raises the expected damage
    expect(expectedMean(gazed, tr, boy)).toBeGreaterThan(expectedMean(s, tr, boy))
    // an obscured sequence makes no crit: the hook leaves the die alone
    const dice1 = [{ value: null, kind: 'normal' as const, rerolled: false, tag: 'accurate' }]
    runHook('afterAttackRoll', { seat: 'A', state: gazed, operativeId: tr, targetId: boy, weaponId: 'bl.w.lasgun', data: { kind: 'shoot', side: 'attack', targetId: boy, dice: dice1, requests: [], choices: {}, obscured: true } })
    expect(dice1[0]!.kind).toBe('normal')
    runHook('afterAttackRoll', { seat: 'A', state: gazed, operativeId: tr, targetId: boy, weaponId: 'bl.w.lasgun', data: { kind: 'shoot', side: 'attack', targetId: boy, dice: dice1, requests: [], choices: {}, obscured: false } })
    expect(dice1[0]!.kind).toBe('crit')
  })

  it("TEAM-BL-007 Blooded Icon returns a holder's token once per turning point (Chieftain within 6 inches); Lead With Strength puts the Chieftain under the Gaze without a token", () => {
    const s0 = open()
    const ch = A(s0, 'chieftain')
    const t1 = A(s0, 'trooper')
    const base = place(place(s0, ch, 0, 0), t1, 4, 0)
    const hold = marked(base, [t1])
    const fall = (st: GameState, id: string) =>
      withCtx(st, (ctx) => {
        ctx.state.operatives[id]!.wounds = 0
        removeNow(ctx, id)
      }).state
    expect(poolOf(fall(hold, t1), 'A', 'bl.blooded')).toBe(2)
    // beyond 6 inches the token is lost; a non-holder gives nothing; the second fall in the turning point is lost
    expect(poolOf(fall(place(hold, t1, 8, 0), t1), 'A', 'bl.blooded')).toBe(1)
    expect(poolOf(fall(base, t1), 'A', 'bl.blooded')).toBe(1)
    const butcher = A(s0, 'butcher')
    const two = marked(place(hold, butcher, 3, 1), [butcher])
    expect(poolOf(fall(fall(two, t1), butcher), 'A', 'bl.blooded')).toBe(2)
    // the Chieftain's own token counts
    expect(poolOf(fall(marked(base, [ch]), ch), 'A', 'bl.blooded')).toBe(2)
    // Lead With Strength: a token, or wholly within the enemy territory (x past 0), puts it under the Gaze; no token means no Accurate
    expect(underGaze(base, base.operatives[ch])).toBe(false)
    expect(underGaze(marked(base, [ch]), base.operatives[ch])).toBe(true)
    const deep = place(base, ch, 6, 0)
    expect(inEnemyTerritory(deep, deep.operatives[ch]!)).toBe(true)
    expect(underGaze(deep, deep.operatives[ch])).toBe(true)
    expect(inEnemyTerritory(place(base, ch, 0.5, 0), base.operatives[ch]!)).toBe(false)
    expect(holdsToken(deep, deep.operatives[ch])).toBe(false)
    expect(attackStats(deep, ch, 'bl.w.chainsword', B(s0, 'boy'), { kind: 'fight' }).accurate).toBe(0)
    expect(underGaze(base, base.operatives[t1])).toBe(false)
  })

  it('TEAM-BL-008 the Brimstone Grenadier throws its own frag and krak at Hit 3+, once each, without spending the team picks; the team frag of another operative stays 4+', () => {
    const s0 = open({ equipmentA: ['core.e.explosive-grenades'] })
    const bg = A(s0, 'brimstone-grenadier')
    const tr = A(s0, 'trooper')
    const boy = B(s0, 'boy')
    const s = place(place(place(s0, bg, 0, 0), boy, 5, 0), tr, -3, 0)
    expect(s.operatives[bg]!.weapons).toEqual(expect.arrayContaining(['core.w.frag-grenade', 'core.w.krak-grenade']))
    expect(attackStats(s, bg, 'core.w.frag-grenade', boy, { kind: 'shoot' }).need).toBe(3)
    expect(attackStats(s, bg, 'core.w.krak-grenade', boy, { kind: 'shoot' }).need).toBe(3)
    // the team's picks: some other operative holds a frag grenade at the printed 4+
    const holder = Object.values(s.operatives).find((o) => o.seat === 'A' && o.id !== bg && o.weapons.includes('core.w.frag-grenade'))
    expect(holder).toBeDefined()
    expect(attackStats(s, holder!.id, 'core.w.frag-grenade', boy, { kind: 'shoot' }).need).toBe(4)
    // the bomb is not a grenade: its Hit stays 3+
    expect(attackStats(s, bg, 'bl.w.diabolyk-bomb', boy, { kind: 'shoot' }).need).toBe(3)
    // one frag throw uses its own allowance: the grenade goes, the krak stays, the team's frag total is untouched
    const after = shootAt(engaged(s), bg, 'core.w.frag-grenade', boy, dice(1, 1, 1, 1)).state
    expect(after.operatives[bg]!.weapons).not.toContain('core.w.frag-grenade')
    expect(after.operatives[bg]!.weapons).toContain('core.w.krak-grenade')
    expect(after.operatives[holder!.id]!.weapons).toContain('core.w.frag-grenade')
  })

  it('TEAM-BL-009 Explosive Demise: asked inside the removal queue, 4+ on two D6 (one in an enemy control range) hurts everything visible within 2 inches, D6+2 with the bomb unused, D3+2 after', () => {
    const s0 = engaged(open())
    const bg = A(s0, 'brimstone-grenadier')
    const tr = A(s0, 'trooper')
    const boy = B(s0, 'boy')
    const grot = B(s0, 'grot')
    const base = edit(place(place(place(place(s0, bg, 0, 0), tr, -1.2, 0), grot, 2.2, 0), boy, 6, 0), (st) => {
      st.operatives[bg]!.wounds = 1
      st.operatives[grot]!.wounds = 20
      st.operatives[grot]!.maxWounds = 20
    })
    const shot = (st: GameState, script: number[], answers = useDemise) => shootAt(bTurn(st, A(s0, 'ogryn')), boy, 'kom.w.slugga', bg, dice(6, 6, 6, 6, 1, 1, 1, ...script), answers)
    // the Grenadier falls in a Shoot with its bomb unused (the Boy is not in reach of it): trigger 6 6, then D6 3 and 4 plus 2 each
    const r = shot(base, [6, 6, 3, 4])
    expect(r.state.operatives[bg]!.status).toBe('removed')
    expect(r.state.operatives[tr]!.wounds).toBe(7 - 5)
    expect(r.state.operatives[grot]!.wounds).toBe(20 - 6)
    // declined: nothing happens
    const no = shot(base, [6, 6, 3, 4], { 'ability.choice': (p) => p.options!.find((o) => o.id === 'decline')!.action })
    expect(no.state.operatives[tr]!.wounds).toBe(7)
    // no 4+ on the dice: nothing
    expect(shot(base, [3, 2, 3, 4]).state.operatives[tr]!.wounds).toBe(7)
    // the bomb used: D3+2 (a D6 of 5 or 6 is a 3)
    const used = edit(base, (st) => void (st.operatives[bg]!.usedLimited['bl.w.diabolyk-bomb'] = 1))
    const small = shot(used, [6, 6, 6, 1])
    expect(small.state.operatives[tr]!.wounds).toBe(7 - 5)
    expect(small.state.operatives[grot]!.wounds).toBe(20 - 3)
    // outside an attack the removal waits for the end-of-step queue, where the owner is asked too (M10 batch D shared)
    const fallAsked = (st: GameState) =>
      withCtx(st, (ctx) => {
        ctx.state.operatives[bg]!.wounds = 0
        removeNow(ctx, bg)
        expect(ctx.state.operatives[bg]!.status).toBe('active')
        runDeferredRemovals(ctx)
      }).state
    // a Grenadier in an enemy control range rolls one die only
    const close = edit(place(base, grot, 0.9, 0), (st) => void (st.operatives[grot]!.order = 'engage'))
    const askedClose = fallAsked(close)
    expect(askedClose.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { hook: 'blDemise', stage: 'explosive' } })
    const one = take(askedClose, 'use', dice(6, 6, 6, 6))
    const triggers = one.events.filter((e) => e.type === 'DiceRolled' && (e as { purpose: string }).purpose === 'bl.explosive.trigger') as { dice: number[] }[]
    expect(triggers).toHaveLength(1)
    expect(triggers[0]!.dice).toHaveLength(1)
    expect(one.state.operatives[bg]!.status).toBe('removed')
    expect(one.state.pending?.id).toBe(close.pending!.id)
    // declined outside an attack: nothing happens, even where the enemy would be caught
    const quiet = take(fallAsked(base), 'decline', dice(6, 6, 6, 6)).state
    expect(quiet.operatives[bg]!.status).toBe('removed')
    expect(quiet.operatives[grot]!.wounds).toBe(20)
    expect(quiet.operatives[tr]!.wounds).toBe(7)
    // used where it catches only a friend: the choice is the owner's, not a heuristic's
    const unwise = take(fallAsked(place(base, grot, 9, 9)), 'use', dice(6, 6, 3, 3)).state
    expect(unwise.operatives[tr]!.wounds).toBe(7 - 5)
  })

  it('TEAM-BL-010 TEAM-BL-011 Blood Offering (the first crit strike of a sequence adds one token, retaliating too) and Unholy Sustenance (D3 wounds back on an incapacitation, plus 1 from Symbols of Bloody Worship)', () => {
    const s0 = engaged(open({ equipmentA: ['bl.e.symbols-of-bloody-worship'] }))
    const bu = A(s0, 'butcher')
    const boy = B(s0, 'boy')
    const fight = (st: GameState, script: number[]) => play(take(take(activateOp(st, bu), 'fight').state, boy, dice(...script)).state, dice(...script.slice(8)), strikes)
    const duel = edit(facing(s0, bu, boy), (st) => {
      st.operatives[boy]!.wounds = 40
      st.operatives[boy]!.maxWounds = 40
    })
    // four crits: one token only; the pool was 1
    const r = fight(duel, [6, 6, 6, 6, 1, 1, 1, 1])
    expect(poolOf(r.state, 'A', 'bl.blooded')).toBe(2)
    // no crit: no token
    expect(poolOf(fight(duel, [4, 4, 4, 4, 1, 1, 1, 1]).state, 'A', 'bl.blooded')).toBe(1)
    // retaliating: the Boy attacks the Butcher and the Butcher strikes with a crit
    const ret = take(take(activateOp(bTurn(duel, A(s0, 'ogryn')), boy), 'fight').state, bu, dice(1, 1, 1, 1, 6, 6, 6, 6)).state
    expect(poolOf(play(ret, dice(), strikes).state, 'A', 'bl.blooded')).toBe(2)
    // Unholy Sustenance: the Boy falls to the first strike; D3 (a 6 is 3) of the Butcher's lost wounds return
    const hurt = edit(duel, (st) => {
      st.operatives[boy]!.wounds = 2
      st.operatives[bu]!.wounds = 3
    })
    const won = fight(hurt, [6, 6, 6, 6, 1, 1, 1, 1, 6])
    expect(won.state.operatives[boy]!.status).toBe('removed')
    // 3 + D3 (3) + 1 from Symbols of Bloody Worship at the end of the action
    expect(won.state.operatives[bu]!.wounds).toBe(7)
    // a Butcher that does not incapacitate gets nothing, and the heal never passes the maximum
    expect(fight(duel, [4, 4, 4, 4, 1, 1, 1, 1, 6]).state.operatives[bu]!.wounds).toBe(8)
    const nearlyFull = edit(hurt, (st) => void (st.operatives[bu]!.wounds = 7))
    expect(fight(nearlyFull, [6, 6, 6, 6, 1, 1, 1, 1, 6]).state.operatives[bu]!.wounds).toBe(8)
  })

  it('TEAM-BL-012 TEAM-BL-013 TEAM-BL-014 Regular Dosage (a pre-battle Enraged or Fortified for one other operative), STIMMS (each rule once per operative, the Corpseman may pick itself), Enraged and Fortified', () => {
    // the pre-battle step offers the Corpseman's gifts: not Rejuvenated, not the Corpseman itself; the stimm shows in view
    let g = createGame(realSetupWith(MATCH), 'bl-dosage', realBundle).state
    g = drive(g, (st) => st.pending?.context?.preBattle === true, 1200, new ScriptedRng([6, 1, 6, 1]))
    const doc = A(g, 'corpseman')
    const offers = g.pending!.options!
    expect(offers.length).toBeGreaterThan(0)
    expect(offers.every((o) => String(o.data?.hook) === 'blRegularDosage' && o.data?.operativeId === doc)).toBe(true)
    expect(offers.some((o) => String(o.data?.targetId) === doc)).toBe(false)
    expect(offers.some((o) => /rejuvenated/i.test(o.labelKey))).toBe(false)
    const fortify = offers.find((o) => /fortified/i.test(o.labelKey) && o.data?.targetId === A(g, 'ogryn'))!
    const done = take(g, fortify.id).state
    expect(hasToken(done, A(g, 'ogryn'), 'bl.stimm-fortified', 'A')).toBe(true)
    expect(view(done, 'B').operatives[A(g, 'ogryn')]!.tokens?.some((t) => t.kind === 'bl.stimm-fortified')).toBe(true)
    // without a Corpseman nothing is offered
    const bare = drive(createGame(realSetupWith({ ...MATCH, rosterA: roster(['bl.chieftain', 'bl.trooper', 'bl.trooper']) }), 'bl-bare', realBundle).state, (st) => st.pending?.context?.preBattle === true || st.pending?.kind === 'firefight.activate', 1200, new ScriptedRng([6, 1, 6, 1]))
    expect(bare.pending?.context?.preBattle).not.toBe(true)

    // STIMMS
    const s0 = open()
    const medic = A(s0, 'corpseman')
    const tr = A(s0, 'trooper')
    const far = A(s0, 'butcher')
    const s = edit(place(place(place(s0, medic, 0, 0), tr, 1.4, 0), far, 5, 0), (st) => {
      st.operatives[tr]!.wounds = 2
    })
    const t = activateOp(s, medic)
    const stimms = optionIds(t).filter((i) => i.startsWith('ability:bl.a.stimms:'))
    expect(stimms.some((i) => i.includes(far))).toBe(false)
    for (const who of [medic, tr]) for (const k of ['rejuvenated', 'enraged', 'fortified']) {
      const given = hasToken(s, who, `bl.stimm.${k}`, 'A')
      expect(stimms.includes(`ability:bl.a.stimms:${who}:${k}`), `${who} ${k}`).toBe(k === 'rejuvenated' || !given)
    }
    // Rejuvenated: 2D3 (6 6 is 3 + 3), capped at the maximum; afterwards the same stimm is not offered for that operative again
    const healed = take(t, `ability:bl.a.stimms:${tr}:rejuvenated`, dice(6, 6)).state
    expect(healed.operatives[tr]!.wounds).toBe(7)
    expect(usedThisBattle(healed, 'A', `bl.stimm:${tr}:rejuvenated`)).toBe(true)
    const spent = optionIds(activateOp(edit(s, (st) => markUsedBattle(st, 'A', `bl.stimm:${tr}:rejuvenated`)), medic))
    expect(spent).not.toContain(`ability:bl.a.stimms:${tr}:rejuvenated`)
    expect(spent).toContain(`ability:bl.a.stimms:${medic}:rejuvenated`)
    expect(spent).toContain(`ability:bl.a.stimms:${tr}:enraged`)
    // an enemy control range stops the action
    const pinned = place(s, B(s, 'boy'), 0.9, 0)
    expect(optionIds(activateOp(pinned, medic)).some((i) => i.startsWith('ability:bl.a.stimms:'))).toBe(false)

    // Enraged: Relentless on melee weapons only
    const enraged = marked(s, [tr], 'bl.stimm-enraged', 'A')
    const boy = B(s, 'boy')
    const rulesOf = (st: GameState, w: string, kind: 'shoot' | 'fight') => parseRules(effectiveRules(st, st.operatives[tr]!, st.data.weapons[w]!, kind, boy))
    expect(rulesOf(enraged, 'bl.w.bayonet', 'fight').relentless).toBe(true)
    expect(rulesOf(enraged, 'bl.w.lasgun', 'shoot').relentless).toBe(false)
    expect(rulesOf(s, 'bl.w.bayonet', 'fight').relentless).toBe(false)
    // Fortified: a D6 for each die dealing 3 or more (5+ takes 1 off); Dmg 2 and Devastating are never rolled for
    const fort = marked(s, [tr], 'bl.stimm-fortified', 'A')
    const hits = (amounts: [number, string][], script: number[]) => {
      const out: number[] = []
      withCtx(fort, (ctx) => {
        for (const [amount, source] of amounts) out.push(inflict(ctx, { targetId: tr, attackerId: boy, weaponId: 'kom.w.slugga', amount, source }))
      }, dice(...script))
      return out
    }
    expect(hits([[3, 'normal'], [4, 'crit'], [3, 'normal']], [5, 4, 6])).toEqual([2, 4, 2])
    expect(hits([[2, 'normal'], [3, 'devastating'], [3, 'direct']], [6, 6, 6])).toEqual([2, 3, 3])
  })

  it('TEAM-BL-015 TEAM-BL-016 SIGNAL (APL +1 for a visible operative within 6 inches, never the Ogryn) and SACRILEGIOUS ACTUATION (a token for the pool, only while the Commsman holds one)', () => {
    const s0 = open()
    const comms = A(s0, 'commsman')
    const tr = A(s0, 'trooper')
    const og = A(s0, 'ogryn')
    const far = A(s0, 'butcher')
    const s = place(place(place(place(s0, comms, 0, 0), tr, 3, 0), og, -3, 0), far, 7, 0)
    const t = activateOp(s, comms)
    const signals = optionIds(t).filter((i) => i.startsWith('ability:bl.a.signal:'))
    expect(signals).toContain(`ability:bl.a.signal:${tr}`)
    expect(signals).not.toContain(`ability:bl.a.signal:${og}`)
    expect(signals).not.toContain(`ability:bl.a.signal:${far}`)
    expect(signals).not.toContain(`ability:bl.a.signal:${comms}`)
    // a wall of heavy terrain between them: not visible
    const walled = withTerrain(s, heavyWall())
    expect(optionIds(activateOp(place(walled, tr, 6, 0), comms)).some((i) => i === `ability:bl.a.signal:${tr}`)).toBe(false)
    // +1 APL for that operative until the end of its next activation
    const after = take(t, `ability:bl.a.signal:${tr}`).state
    expect(effectiveApl(after.operatives[tr]!)).toBe(3)
    const ended = take(after, 'end').state
    expect(effectiveApl(ended.operatives[tr]!)).toBe(3)
    // SUPPORT: while the Commsman controls the Comms Device marker the 6" becomes 9" (another operative on the marker gives it nothing)
    const device = (st: GameState) => edit(st, (x) => void x.markers.push({ id: 'cd', kind: 'equipment', pos: { x: 0, z: 0 }, owner: 'A', carriedBy: null, controller: null, pickable: false, equipmentId: 'core.e.comms-device' } as never))
    const sig = (st: GameState) => optionIds(activateOp(place(st, far, 7, 5), comms)).includes(`ability:bl.a.signal:${tr}`)
    expect(sig(place(s, tr, 8.5, 0))).toBe(false)
    expect(sig(device(place(s, tr, 8.5, 0)))).toBe(true)
    expect(sig(device(place(s, tr, 10.2, 0)))).toBe(false)
    expect(sig(device(place(place(s, comms, 2, 0), tr, 9.5, 0)))).toBe(false)
    // Actuation needs a token
    expect(optionIds(t).some((i) => i === 'ability:bl.a.sacrilegious-actuation')).toBe(false)
    const holder = marked(s, [comms])
    const act = take(activateOp(holder, comms), 'ability:bl.a.sacrilegious-actuation').state
    expect(poolOf(act, 'A', 'bl.blooded')).toBe(2)
    // and not within an enemy control range
    expect(optionIds(activateOp(place(holder, B(s, 'boy'), 0.9, 0), comms)).some((i) => i === 'ability:bl.a.sacrilegious-actuation')).toBe(false)
  })

  it('TEAM-BL-017 TEAM-BL-018 Gruelling Disciplinarian (injury ignored within 6 inches and for the rest of an activation begun there) and ENFORCE (a free 1 AP action, 2 inch moves, no Signal or Actuation for a Commsman)', () => {
    const s0 = open()
    const enf = A(s0, 'enforcer')
    const tr = A(s0, 'trooper')
    const comms = A(s0, 'commsman')
    const boy = B(s0, 'boy')
    const hurt = (st: GameState) => edit(st, (x) => {
      x.operatives[tr]!.wounds = 3
      refreshFlags(x)
    })
    const near = hurt(place(place(s0, enf, 0, 0), tr, 4, 0))
    const farther = hurt(place(place(s0, enf, 0, 0), tr, 9, 0))
    expect(effectiveMove(near.operatives[tr]!, near)).toBe(6)
    expect(effectiveMove(farther.operatives[tr]!, farther)).toBe(4)
    expect(attackStats(place(near, boy, 8, 0), tr, 'bl.w.lasgun', boy, { kind: 'shoot' }).need).toBe(4)
    expect(attackStats(place(farther, boy, 14, 0), tr, 'bl.w.lasgun', boy, { kind: 'shoot' }).need).toBe(5)
    // the Enforcer itself, and its own death ends the aura
    expect(effectiveMove(hurt(place(s0, enf, 0, 0)).operatives[enf]!, s0)).toBe(6)
    void settle
    const down = edit(near, (st) => void (st.operatives[enf]!.wounds = 0))
    // (flags refresh after a step: do it by hand for the edited state)
    refreshFlags(down)
    expect(down.operatives[tr]!.flags.ignoreInjured).not.toBe(true)
    // activated within 6 inches, the operative keeps ignoring injury after moving away, until the activation ends
    const act = activateOp(near, tr)
    const moved = edit(place(act, tr, 12, 0), (st) => refreshFlags(st))
    expect(moved.operatives[tr]!.flags.ignoreInjured).toBe(true)
    const over = edit(take(moved, 'end').state, (st) => refreshFlags(st))
    expect(over.operatives[tr]!.flags.ignoreInjured).not.toBe(true)

    // ENFORCE
    const s = engaged(place(place(place(s0, enf, 0, 0), tr, 2.5, 0), comms, -2.5, 0))
    const e = activateOp(place(s, boy, 9, 0), enf)
    const picks = optionIds(e).filter((i) => i.startsWith('ability:bl.a.enforce:'))
    expect(picks).toEqual(expect.arrayContaining([`ability:bl.a.enforce:${tr}`, `ability:bl.a.enforce:${comms}`]))
    expect(picks).not.toContain(`ability:bl.a.enforce:${A(s0, 'butcher')}`)
    const go = take(e, `ability:bl.a.enforce:${tr}`).state
    // the picked Trooper acts for free: a 1 AP action, never Fall Back (2 AP), a move of at most 2 inches
    expect(optionIds(go)).toEqual(expect.arrayContaining(['shoot', 'reposition']))
    expect(optionIds(go)).not.toContain('fallBack')
    const moving = take(go, 'reposition').state
    expect(moving.pending!.context.maxInches).toBe(2)
    const done = play(moving, dice(), goTo(2.5, 1.5)).state
    expect(done.operatives[tr]!.pos.z).toBeCloseTo(1.5, 1)
    // a Commsman picked this way cannot SIGNAL or SACRILEGIOUS ACTUATION
    const c = take(e, `ability:bl.a.enforce:${comms}`).state
    expect(optionIds(c).some((i) => i.startsWith('ability:bl.a.signal') || i.startsWith('ability:bl.a.sacrilegious'))).toBe(false)
    expect(optionIds(c)).toContain('end')
    // not within an enemy control range
    expect(optionIds(activateOp(place(s, boy, 0.9, 0), enf)).some((i) => i.startsWith('ability:bl.a.enforce:'))).toBe(false)
  })

  it('TEAM-BL-019 TEAM-BL-020 TEAM-BL-021 Stalk (Lethal 5+ with Light or Heavy terrain within 1 inch), Wretched (Charge under Conceal, a last strike on falling) and Avalanche of Muscle (D3 after a Charge move)', () => {
    const s0 = full()
    const fl = A(s0, 'flenser')
    const boy = B(s0, 'boy')
    const blades = s0.data.weapons['bl.w.skinning-blades']!
    const lethal = (st: GameState, x: number) => parseRules(effectiveRules(place(st, fl, x, 0), place(st, fl, x, 0).operatives[fl]!, blades, 'fight', boy)).lethal
    const near = withTerrain(s0, wall())
    expect(lethal(near, 2.2)).toBe(5)
    expect(lethal(near, -2)).toBe(null)
    expect(lethal(withTerrain(s0, heavyWall()), 2.2)).toBe(5)
    expect(lethal(s0, 2.2)).toBe(null)
    // Wretched (a): the Flenser may Charge under a Conceal order, nobody else of the team may
    expect(chargeUnderConceal(s0, s0.operatives[fl]!)).toBe(true)
    expect(chargeUnderConceal(s0, s0.operatives[A(s0, 'trooper')]!)).toBe(false)
    // Wretched (b): the Boy takes the Flenser down with the first strike; the Flenser's unresolved crit lands before removal
    const duel = engaged(edit(facing(s0, fl, boy), (st) => {
      st.operatives[fl]!.wounds = 1
      st.operatives[boy]!.wounds = 40
      st.operatives[boy]!.maxWounds = 40
    }))
    const fall = (script: number[]) => {
      const b = bTurn(duel, A(s0, 'ogryn'))
      const f = take(take(activateOp(b, boy), 'fight').state, fl, dice(...script)).state
      return play(f, dice(), strikes).state
    }
    const traded = fall([6, 6, 6, 6, 6, 6, 6, 6])
    expect(traded.operatives[fl]!.status).toBe('removed')
    expect(traded.operatives[boy]!.wounds).toBe(40 - 4)
    // no unresolved success: nothing
    expect(fall([6, 6, 6, 6, 1, 1, 1, 1]).operatives[boy]!.wounds).toBe(40)
    // both can fall
    const both = edit(duel, (st) => void (st.operatives[boy]!.wounds = 3))
    const b2 = take(take(activateOp(bTurn(both, A(s0, 'ogryn')), boy), 'fight').state, fl, dice(6, 6, 6, 6, 6, 6, 6, 6)).state
    const r2 = play(b2, dice(), strikes).state
    expect(r2.operatives[fl]!.status).toBe('removed')
    expect(r2.operatives[boy]!.status).toBe('removed')

    // Avalanche of Muscle: the offer after a Charge move, D3 to one enemy in its control range
    const og = A(s0, 'ogryn')
    const field = engaged(edit(place(place(s0, og, 0, 0), boy, 5, 0), (st) => {
      st.operatives[boy]!.wounds = 40
      st.operatives[boy]!.maxWounds = 40
    }))
    const charge = take(activateOp(field, og), 'charge').state
    const avalanche = play(charge, dice(6), { ...goTo(3.4, 0), ...takePloy(`bl.avalanche@${boy}`) }, ['firefight.action', 'firefight.activate'])
    expect(avalanche.state.operatives[boy]!.wounds).toBe(40 - 3)
    expect(avalanche.state.operatives[og]!.pos.x).toBeCloseTo(3.4, 1)
    // declined: nothing; after a Reposition there is no offer at all
    const declined = play(charge, dice(6), { ...goTo(3.4, 0), 'ploy.firefight': (p) => act.pass(p) }, ['firefight.action', 'firefight.activate'])
    expect(declined.state.operatives[boy]!.wounds).toBe(40)
    const reposition = take(activateOp(field, og), 'reposition').state
    expect(play(reposition, dice(6), goTo(2.4, 0)).kinds).not.toContain('ploy.firefight')
  })

  it('TEAM-BL-022 TEAM-BL-023 TEAM-BL-024 Chem-enhanced (APL changes and enemy Shock and Stun ignored), Brute (a visible Conceal Ogryn behind Light terrain is a valid target, cover save kept) and Slow-witted', () => {
    const s0 = open()
    const og = A(s0, 'ogryn')
    const tr = A(s0, 'trooper')
    const nob = B(s0, 'boss-nob')
    const boy = B(s0, 'boy')
    // Chem-enhanced
    expect(s0.operatives[og]!.flags.ignoreApl).toBe(true)
    const stunned = withCtx(s0, (ctx) => {
      applyAplEffect(ctx, og, -1, 'stun')
      applyAplEffect(ctx, tr, -1, 'stun')
    }).state
    expect(effectiveApl(stunned.operatives[og]!)).toBe(2)
    expect(effectiveApl(stunned.operatives[tr]!)).toBe(1)
    const klaw = s0.data.weapons['kom.w.power-klaw']!
    expect(parseRules(effectiveRules(s0, s0.operatives[nob]!, klaw, 'fight', og)).shock).toBe(false)
    expect(parseRules(effectiveRules(s0, s0.operatives[nob]!, klaw, 'fight', tr)).shock).toBe(true)
    expect(parseRules(effectiveRules(s0, s0.operatives[nob]!, s0.data.weapons['kom.w.shokka-pistol']!, 'shoot', og)).stun).toBe(false)
    expect(parseRules(effectiveRules(s0, s0.operatives[og]!, s0.data.weapons['bl.w.power-maul-claw']!, 'fight', nob)).shock).toBe(true)
    // Moment of Repute's +1 does nothing for it (the ploy is not even offered)
    const gazed = marked(s0, [og], 'bl.gaze', 'A', ['turningPointEnd'])
    const info = { window: 'firefight.activationStart', subjectId: og }
    expect(offersFor(edit(gazed, (st) => void (st.players.A.cp = 3)), 'A', 'firefight.activationStart', info).some((o) => o.ployId === 'bl.p.moment-of-repute')).toBe(false)

    // Brute: the Ogryn on Conceal behind a Light wall can be shot; behind a Heavy wall it cannot; its cover save is unchanged
    const lane = (terrain: ReturnType<typeof feature>) => {
      const t = withTerrain(place(place(s0, og, 1.8, 0), boy, 7, 0), terrain)
      return edit(t, (st) => void (st.operatives[og]!.order = 'conceal'))
    }
    const targets = (st: GameState) => validTargets(st, st.operatives[boy]!, 'kom.w.dakka-shoota-long').map((x) => x.id)
    expect(targets(lane(wall()))).toContain(og)
    const behind = lane(wall())
    const info2 = targetInfo(behind, behind.operatives[boy]!, behind.operatives[og]!, parseRules([]))
    expect(info2.inCover).toBe(true)
    expect(targets(lane(heavyWall()))).not.toContain(og)
    // the same wall stops another Conceal operative
    const troop = edit(withTerrain(place(place(s0, tr, 2.3, 0), boy, 7, 0), wall()), (st) => void (st.operatives[tr]!.order = 'conceal'))
    expect(validTargets(troop, troop.operatives[boy]!, 'kom.w.dakka-shoota-long').map((x) => x.id)).not.toContain(tr)

    // Slow-witted: Pick Up Marker and mission actions cost 1 more AP; Place Marker does not
    const cost = (id: string, a: string, mission = false) => actionCostDelta(s0, s0.operatives[id]!, a, null, mission)
    expect(cost(og, 'pick-up-marker')).toBe(1)
    expect(cost(og, 'mission-action', true)).toBe(1)
    expect(cost(og, 'place-marker')).toBe(0)
    expect(cost(tr, 'pick-up-marker')).toBe(0)
    expect(cost(tr, 'mission-action', true)).toBe(0)
  })

  it('TEAM-BL-025 TEAM-BL-026 TEAM-BL-027 TEAM-BL-028 Camo Cloak (one more cover save), A Name Whispered In Blood (the Sharpshooter treats its marked enemy as a holder under the Gaze), Tough and Shield', () => {
    const s0 = engaged(full())
    const sh = A(s0, 'sharpshooter')
    const tr = A(s0, 'trooper')
    const boy = B(s0, 'boy')
    // Camo Cloak: in cover, two cover saves where another operative keeps one (slugga: four normals, three dice)
    const cover = (who: string) => {
      const t = place(place(withTerrain(s0, wall()), who, 2.3, 0), boy, 6.5, 0)
      const b = edit(bTurn(edit(t, (st) => {
        st.operatives[who]!.wounds = 20
        st.operatives[who]!.maxWounds = 20
      }), A(s0, 'ogryn')), (st) => void (st.operatives[who]!.order = 'engage'))
      const r = shootAt(b, boy, 'kom.w.slugga', who, dice(4, 4, 4, 4, 1, 1, 1), {}, undefined)
      return 20 - r.state.operatives[who]!.wounds
    }
    expect(cover(tr)).toBe(9)
    expect(cover(sh)).toBe(6)
    expect(providerExtraCoverSaves(s0, s0.operatives[sh]!)).toBe(1)
    expect(providerExtraCoverSaves(s0, s0.operatives[tr]!)).toBe(0)
    // with Vantage's improved cover in force it is not cumulative
    const vantage = edit(s0, (st) => {
      st.attack = { kind: 'shoot', stage: 'resolve', operativeId: boy, seat: 'B', weaponId: 'kom.w.slugga', pointBlank: false, targets: [sh], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [], status: { cover: true, obscured: false, improvedCover: true } }
    })
    expect(providerExtraCoverSaves(vantage, vantage.operatives[sh]!)).toBe(0)

    // A Name Whispered In Blood: turning point 1, with the Sharpshooter; one offer per enemy
    const g = toGambit()
    const grot = B(g, 'grot')
    const name = g.pending!.options!.filter((o) => o.id.startsWith('bl.p.name-whispered:'))
    expect(name).toHaveLength(Object.values(g.operatives).filter((o) => o.seat === 'B').length)
    const t = take(g, `bl.p.name-whispered:${boy}`).state
    expect(hasToken(t, boy, 'bl.name-whispered', 'A')).toBe(true)
    const shg = A(g, 'sharpshooter')
    const s = place(place(t, shg, 0, 0), boy, 8, 0)
    expect(isHolder(s, s.operatives[shg], boy)).toBe(true)
    expect(isHolder(s, s.operatives[shg], grot)).toBe(false)
    expect(underGaze(s, s.operatives[shg], boy)).toBe(true)
    expect(underGaze(s, s.operatives[shg], grot)).toBe(false)
    expect(attackStats(s, shg, 'bl.w.long-las-mobile', boy, { kind: 'shoot' }).accurate).toBe(1)
    expect(attackStats(s, shg, 'bl.w.long-las-mobile', grot, { kind: 'shoot' }).accurate).toBe(0)
    // it is not a holder for the four-holder test, and not offered in turning point 2 or without the Sharpshooter
    expect(holdsToken(s, s.operatives[shg])).toBe(false)
    expect(offersFor(edit(g, (st) => void (st.turningPoint = 2)), 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'bl.p.name-whispered')).toBe(false)
    expect(offersFor(edit(g, (st) => void (st.operatives[shg]!.status = 'removed')), 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'bl.p.name-whispered')).toBe(false)

    // Tough: the Thug takes 1 less from a Normal Dmg of 3 or more, shot or fought, never from a crit or Devastating damage
    const thug = A(s0, 'thug')
    const hits = (amounts: [number, string][]) => {
      const out: number[] = []
      withCtx(s0, (ctx) => {
        for (const [amount, source] of amounts) out.push(inflict(ctx, { targetId: thug, attackerId: boy, weaponId: 'kom.w.slugga', amount, source }))
      })
      return out
    }
    expect(hits([[2, 'normal'], [3, 'normal'], [4, 'crit'], [3, 'strike-normal'], [4, 'strike-crit'], [3, 'devastating']])).toEqual([2, 2, 4, 2, 4, 3])
    expect(hits([[3, 'normal']])).not.toEqual(hits([[3, 'crit']]))

    // Shield: one block cancels two enemy successes (the Trench Sweeper; a Trooper's single block cancels one)
    const sw = A(s0, 'trench-sweeper')
    const brawl = (who: string) => {
      const d = edit(facing(s0, who, boy), (st) => {
        st.operatives[who]!.wounds = 20
        st.operatives[who]!.maxWounds = 20
        st.operatives[boy]!.wounds = 40
        st.operatives[boy]!.maxWounds = 40
      })
      const f = take(take(activateOp(d, who), 'fight').state, boy, dice(4, 4, 4, 4, 4, 4, 4)).state
      return 20 - play(f, dice(), blocksFirst).state.operatives[who]!.wounds
    }
    expect(brawl(sw)).toBe(4)
    expect(brawl(tr)).toBe(8)
  })

  it('TEAM-BL-029 TEAM-BL-030 Shielding (Move 2 inches less and re-roll any defence dice until the next activation; not in a counteraction) and Group Activation (two Troopers in a row)', () => {
    const s0 = open()
    const sw = A(s0, 'trench-sweeper')
    const boy = B(s0, 'boy')
    const field = place(place(s0, sw, 0, 0), boy, 6, 0)
    let t = take(field, sw).state
    t = take(t, 'engage').state
    expect(t.pending!.kind).toBe('ploy.firefight')
    expect(optionIds(t)).toContain(`bl.shielding@${sw}`)
    t = take(t, `bl.shielding@${sw}`).state
    expect(hasToken(t, sw, 'bl.shielding', 'A')).toBe(true)
    expect(effectiveMove(t.operatives[sw]!, t)).toBe(4)
    // injured as well: Move never drops below 4"
    expect(effectiveMove(edit(t, (st) => void (st.operatives[sw]!.wounds = 3)).operatives[sw]!, t)).toBe(4)
    const grants = defenceStats(t, sw, boy, 'kom.w.slugga', parseRules(t.data.weapons['kom.w.slugga']!.rules), false).grants
    expect(grants.some((g) => g.id === 'bl.shielding' && g.mode === 'any')).toBe(true)
    expect(defenceStats(field, sw, boy, 'kom.w.slugga', parseRules(field.data.weapons['kom.w.slugga']!.rules), false).grants).toEqual([])
    // it lasts until the start of the Trench Sweeper's next activation
    const gone = withCtx(t, (ctx) => tokensOnActivationStart(ctx, sw)).state
    expect(hasToken(gone, sw, 'bl.shielding', 'A')).toBe(false)
    // not in a counteraction
    expect(offersFor(field, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: sw, counteracting: true }).some((o) => o.id.startsWith('bl.shielding'))).toBe(false)

    // Group Activation: after a Trooper the only activation options are the other ready Troopers; after that one the opponent acts
    const troopers = Object.values(s0.operatives).filter((o) => o.seat === 'A' && o.datacardId === 'bl.trooper').map((o) => o.id)
    expect(troopers).toHaveLength(2)
    const one = take(activateOp(s0, troopers[0]!), 'end').state
    expect(one.pending!.seat).toBe('A')
    expect(optionIds(one).filter((i) => !i.startsWith('counter'))).toEqual([troopers[1]])
    const two = take(activateOp(one, troopers[1]!), 'end').state
    expect(two.pending!.seat).toBe('B')
    // another operative ending does not chain
    const plain = take(activateOp(s0, A(s0, 'butcher')), 'end').state
    expect(plain.pending!.seat).toBe('B')
    // with no other ready Trooper play passes normally
    const lone = edit(s0, (st) => void (st.operatives[troopers[1]!]!.ready = false))
    expect(take(activateOp(lone, troopers[0]!), 'end').state.pending!.seat).toBe('B')
  })

  it('TEAM-BL-031 TEAM-BL-032 Glory Kill (enemies a Blooded operative sees; Ceaseless, Relentless for a holder, retaliating too), Reckless Aspirant, Malevolent Grit and Bitter Demise', () => {
    const s0 = engaged(open())
    const tr = A(s0, 'trooper')
    const tr2 = A(s0, 'butcher')
    const boy = B(s0, 'boy')
    const grot = B(s0, 'grot')
    const gambit = (st: GameState) => offersFor(edit(st, (x) => void (x.players.A.cp = 3)), 'A', 'strategy.gambit', { window: 'strategy.gambit' })
    // behind a long Heavy wall nobody is visible: no Glory Kill; with one Blooded operative across it, the enemies it sees
    const walled = withTerrain(s0, feature('bl-long', part('bl-long.a', rect(2, 3, -12, 12), 3, ['heavy'])))
    expect(gambit(walled).filter((o) => o.ployId === 'bl.p.glory-kill')).toEqual([])
    const across = place(place(place(walled, tr, 6, 0), boy, 9, 0), grot, 10, 2)
    const picks = gambit(across).filter((o) => o.ployId === 'bl.p.glory-kill').map((o) => o.param)
    expect(picks).toEqual(expect.arrayContaining([boy, grot]))
    expect(picks.length).toBeLessThan(Object.values(s0.operatives).filter((o) => o.seat === 'B').length)
    // the mark: Ceaseless against that enemy only, Relentless for a holder, and when it is the enemy fighting us
    const marked1 = usePlayed(edit(place(place(s0, tr, 0, 0), boy, 5, 0), (st) => void (st.players.A.cp = 3)), 'bl.p.glory-kill', {}, boy)
    const ruleOf = (st: GameState, who: string, w: string, kind: 'shoot' | 'fight', vs: string) => parseRules(effectiveRules(st, st.operatives[who]!, st.data.weapons[w]!, kind, vs))
    expect(ruleOf(marked1, tr, 'bl.w.lasgun', 'shoot', boy)).toMatchObject({ ceaseless: true, relentless: false })
    expect(ruleOf(marked1, tr, 'bl.w.lasgun', 'shoot', grot).ceaseless).toBe(false)
    expect(ruleOf(marked1, tr, 'bl.w.bayonet', 'fight', boy).ceaseless).toBe(true)
    const holder = marked(marked1, [tr])
    expect(ruleOf(holder, tr, 'bl.w.lasgun', 'shoot', boy)).toMatchObject({ relentless: true, ceaseless: false })
    // it ends with the turning point
    expect(holder.operatives[boy]!.tokens?.find((t) => t.kind === 'bl.glory-kill')?.expires).toEqual(['turningPointEnd'])

    // Reckless Aspirant: Accurate 1 for a non-holder wholly in enemy territory (shooting or fighting, not retaliating), Punishing for a holder there
    const deep = usePlayed(edit(place(place(s0, tr, 6, 0), boy, 12, 0), (st) => void (st.players.A.cp = 3)), 'bl.p.reckless-aspirant')
    const home = place(deep, tr, -6, 0)
    expect(attackStats(deep, tr, 'bl.w.lasgun', boy, { kind: 'shoot' }).accurate).toBe(1)
    expect(attackStats(deep, tr, 'bl.w.bayonet', boy, { kind: 'fight' }).accurate).toBe(1)
    expect(attackStats(home, tr, 'bl.w.lasgun', boy, { kind: 'shoot' }).accurate).toBe(0)
    const retaliating = edit(deep, (st) => {
      st.attack = { kind: 'fight', stage: 'resolve', operativeId: boy, seat: 'B', weaponId: 'kom.w.choppa', pointBlank: false, targets: [tr], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [], fight: { targetId: tr, weaponA: 'kom.w.choppa', weaponD: 'bl.w.bayonet', turn: 'A', passes: 0, shockUsed: { A: false, B: false } } }
    })
    expect(attackStats(retaliating, tr, 'bl.w.bayonet', boy, { kind: 'fight' }).accurate).toBe(0)
    const punishing = (st: GameState, kind: 'shoot' | 'fight') => ruleOf(st, tr, kind === 'shoot' ? 'bl.w.lasgun' : 'bl.w.bayonet', kind, boy).punishing
    expect(punishing(deep, 'shoot')).toBe(false)
    expect(punishing(marked(deep, [tr]), 'shoot')).toBe(true)
    expect(punishing(marked(retaliating, [tr]), 'fight')).toBe(true)
    expect(punishing(marked(home, [tr]), 'shoot')).toBe(false)

    // Malevolent Grit: one defence re-roll for a holder or an operative wholly in enemy territory
    const grit = usePlayed(edit(place(place(s0, tr, 0, 0), boy, 5, 0), (st) => void (st.players.A.cp = 3)), 'bl.p.malevolent-grit')
    const grants = (st: GameState, who: string) => defenceStats(st, who, boy, 'kom.w.slugga', parseRules(st.data.weapons['kom.w.slugga']!.rules), false).grants.map((g) => g.id)
    expect(grants(grit, tr)).toEqual([])
    expect(grants(marked(grit, [tr]), tr)).toEqual(['bl.grit'])
    expect(grants(place(grit, tr, 6, 0), tr)).toEqual(['bl.grit'])
    expect(grants(marked(place(s0, tr, 0, 0), [tr]), tr)).toEqual([])

    // Bitter Demise: a holder rolls a D3 (2+), anyone else needs a 3; the damage is the roll, to an enemy visible within 2"
    const bitter = usePlayed(edit(place(place(s0, tr, 0, 0), boy, 1.8, 0), (st) => void (st.players.A.cp = 3)), 'bl.p.bitter-demise')
    const fall = (st: GameState, d: number) =>
      withCtx(st, (ctx) => {
        ctx.state.operatives[tr]!.wounds = 0
        removeNow(ctx, tr)
        runDeferredRemovals(ctx)
      }, dice(d)).state
    expect(bitter.effects.some((e) => e.source === 'bl.p.bitter-demise')).toBe(true)
    expect(fall(marked(bitter, [tr]), 4).operatives[boy]!.wounds).toBe(bitter.operatives[boy]!.wounds - 2)
    expect(fall(bitter, 4).operatives[boy]!.wounds).toBe(bitter.operatives[boy]!.wounds)
    expect(fall(bitter, 6).operatives[boy]!.wounds).toBe(bitter.operatives[boy]!.wounds - 3)
    expect(fall(place(marked(bitter, [tr]), boy, 4, 0), 6).operatives[boy]!.wounds).toBe(bitter.operatives[boy]!.wounds)
    expect(fall(s0, 6).operatives[boy]!.wounds).toBe(s0.operatives[boy]!.wounds)
    // inside an attack's removal queue with two enemies close by, the owner picks the target
    const breacha = B(s0, 'breacha-boy')
    const crowd = engaged(edit(place(place(place(place(place(s0, tr, 0, 0), boy, 6, 0), grot, 2.3, 0), breacha, -2.3, 0), A(s0, 'ogryn'), -12, 9), (st) => {
      st.players.A.cp = 3
      st.operatives[tr]!.wounds = 1
      st.operatives[grot]!.wounds = 12
      st.operatives[grot]!.maxWounds = 12
      st.effects.push({ id: 'ekb', seat: 'A', kind: 'ployFlag', expires: 'turningPoint', source: 'bl.p.bitter-demise' } as never)
    }))
    const asked: string[][] = []
    const shot = shootAt(bTurn(crowd, A(s0, 'ogryn')), boy, 'kom.w.slugga', tr, dice(6, 6, 6, 6, 1, 1, 1, 6), {
      'ability.choice': (p) => {
        expect(p.context.hook).toBe('blDemise')
        asked.push(p.options!.map((o) => o.id))
        return p.options!.find((o) => o.id === grot)!.action
      },
    })
    expect(asked).toEqual([[grot, breacha]])
    expect(shot.state.operatives[tr]!.status).toBe('removed')
    expect(shot.state.operatives[grot]!.wounds).toBe(12 - 3)
    expect(shot.state.operatives[breacha]!.wounds).toBe(crowd.operatives[breacha]!.wounds)
  })

  it('TEAM-BL-033 TEAM-BL-034 TEAM-BL-035 Callous Disregard, Moment of Repute, Reward Earned (any cause, Chaos Sigil), Dark Favour, Sinister Trophies, Symbols of Bloody Worship and Wicked Blades', () => {
    const s0 = engaged(open({ equipmentA: ['bl.e.chaos-sigil', 'bl.e.sinister-trophies', 'bl.e.symbols-of-bloody-worship', 'bl.e.wicked-blades'] }))
    const tr = A(s0, 'trooper')
    const bu = A(s0, 'butcher')
    const sw = A(s0, 'trench-sweeper')
    const boy = B(s0, 'boy')
    const rich = (st: GameState): GameState => edit(st, (x) => void (x.players.A.cp = 3))

    // Callous Disregard: an enemy with only Blooded operatives in its control range can be chosen; each fail hurts one of them
    const pinned = rich(place(place(place(s0, tr, 0, 0), boy, 6, 0), bu, 6.9, 0))
    expect(validTargets(pinned, pinned.operatives[tr]!, 'bl.w.lasgun').map((x) => x.id)).not.toContain(boy)
    const spill = shootAt(pinned, tr, 'bl.w.lasgun', boy, dice(1, 2, 4, 6, 1, 1, 1), {}, undefined, 'bl.p.callous-disregard')
    expect(spill.state.operatives[bu]!.wounds).toBe(8 - 3)
    // two friends in reach: the owner chooses for each fail
    const two = place(pinned, sw, 6.9, 1.2)
    const asked = shootAt(two, tr, 'bl.w.lasgun', boy, dice(5, 3, 4, 6, 1, 1, 1), {
      'weapon.choice': (p) => p.options!.find((o) => o.id === sw)!.action,
    }, undefined, 'bl.p.callous-disregard')
    expect(asked.state.operatives[sw]!.wounds).toBe(9 - 3 - 0)
    expect(asked.state.operatives[bu]!.wounds).toBe(8)
    // a counteracting operative performs a Shoot action too: the ploy is offered there as well
    const declaredInfo = (counteracting: boolean) => ({ window: 'firefight.actionDeclared', subjectId: tr, action: 'shoot', counteracting })
    expect(offersFor(pinned, 'A', 'firefight.actionDeclared', declaredInfo(true)).some((o) => o.ployId === 'bl.p.callous-disregard')).toBe(true)
    expect(offersFor(pinned, 'A', 'firefight.actionDeclared', declaredInfo(false)).some((o) => o.ployId === 'bl.p.callous-disregard')).toBe(true)

    // Moment of Repute: only under the Gaze, once the activation has begun; +1 APL until it ends; not for the Ogryn
    const gazed = rich(marked(s0, [tr], 'bl.gaze', 'A', ['turningPointEnd']))
    const started = take(take(gazed, tr).state, 'engage').state
    expect(started.pending!.kind).toBe('ploy.firefight')
    expect(optionIds(started)).toContain('bl.p.moment-of-repute')
    expect(effectiveApl(started.operatives[tr]!)).toBe(2)
    const boosted = take(started, 'bl.p.moment-of-repute').state
    expect(effectiveApl(boosted.operatives[tr]!)).toBe(3)
    const over = take(boosted, 'end').state
    expect(effectiveApl(over.operatives[tr]!)).toBe(2)
    const plainStart = take(take(rich(s0), tr).state, 'engage').state
    expect(plainStart.pending?.kind === 'ploy.firefight' ? optionIds(plainStart) : []).not.toContain('bl.p.moment-of-repute')

    // Reward Earned: a holder within 2" incapacitates an enemy by a Shoot: 0 CP with the Chaos Sigil, a token for the pool
    const near = marked(rich(place(place(s0, tr, 0, 0), boy, 2.9, 0)), [tr])
    const kill = edit(near, (st) => void (st.operatives[boy]!.wounds = 1))
    const reward = shootAt(kill, tr, 'bl.w.lasgun', boy, dice(6, 6, 6, 6, 1, 1, 1), takePloy('bl.p.reward-earned'))
    expect(reward.state.operatives[boy]!.status).toBe('removed')
    // (the Ready step gave 1, the kill itself 1 more, Reward Earned 1 more)
    expect(poolOf(reward.state, 'A', 'bl.blooded')).toBe(3)
    expect(reward.state.players.A.cp).toBe(3)
    // not from 3 inches away, nor for a non-holder
    const far = edit(marked(rich(place(place(s0, tr, 0, 0), boy, 4.6, 0)), [tr]), (st) => void (st.operatives[boy]!.wounds = 1))
    expect(poolOf(shootAt(far, tr, 'bl.w.lasgun', boy, dice(6, 6, 6, 6, 1, 1, 1), takePloy('bl.p.reward-earned')).state, 'A', 'bl.blooded')).toBe(2)
    const plain = edit(rich(place(place(s0, tr, 0, 0), boy, 2.9, 0)), (st) => void (st.operatives[boy]!.wounds = 1))
    expect(poolOf(shootAt(plain, tr, 'bl.w.lasgun', boy, dice(6, 6, 6, 6, 1, 1, 1), takePloy('bl.p.reward-earned')).state, 'A', 'bl.blooded')).toBe(2)
    // an attack kill is offered once, right after the removal: declined there, the end of the action does not offer it again
    let offered = 0
    const declined = shootAt(kill, tr, 'bl.w.lasgun', boy, dice(6, 6, 6, 6, 1, 1, 1), {
      'ploy.firefight': (p) => {
        if (p.options?.some((o) => o.id === 'bl.p.reward-earned')) offered += 1
        return act.pass(p)
      },
    })
    expect(declined.state.operatives[boy]!.status).toBe('removed')
    expect(offered).toBe(1)
    expect(poolOf(declined.state, 'A', 'bl.blooded')).toBe(2)
    // any cause: an Avalanche of Muscle kill is offered at the end of the action
    const og = A(s0, 'ogryn')
    const rush = marked(edit(place(place(s0, og, 0, 0), boy, 5, 0), (st) => {
      st.players.A.cp = 3
      st.operatives[boy]!.wounds = 1
    }), [og])
    const charged = take(activateOp(rush, og), 'charge').state
    const both = play(charged, dice(6), { ...goTo(3.4, 0), 'ploy.firefight': (p) => p.options!.find((o) => o.id === `bl.avalanche@${boy}` || o.id === 'bl.p.reward-earned')?.action ?? act.pass(p) }, ['firefight.action', 'firefight.activate'])
    expect(both.state.operatives[boy]!.status).toBe('removed')
    expect(poolOf(both.state, 'A', 'bl.blooded')).toBe(3)

    // Dark Favour: a Shoot at a holder goes to a friendly Blooded operative within 3" instead (not against Torrent or Blast)
    const duo = marked(rich(place(place(place(s0, sw, 2.5, 0), tr, 1, 0), boy, 5, 0)), [sw])
    const redirected = shootAt(bTurn(edit(duo, (st) => void (st.players.B.cp = 3)), A(s0, 'ogryn')), boy, 'kom.w.slugga', sw, dice(6, 6, 6, 6, 1, 1, 1, 1), takePloy(`bl.p.dark-favour:${tr}`))
    expect(redirected.state.operatives[sw]!.wounds).toBe(9)
    expect(redirected.state.operatives[tr]!.wounds).toBeLessThan(7)
    const burnt = bTurn(duo, A(s0, 'ogryn'))
    expect(offersFor(withCtx(burnt, (ctx) => void (ctx.state.attack = { kind: 'shoot', stage: 'resolve', operativeId: boy, seat: 'B', weaponId: 'kom.w.burna-standard', pointBlank: false, targets: [sw], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] })).state, 'A', 'shoot.targetSelected', { window: 'shoot.targetSelected', subjectId: sw, targetId: sw, attackerId: boy }).some((o) => o.ployId === 'bl.p.dark-favour')).toBe(false)
    // in a Fight the substitute is fought instead of the holder
    const melee = marked(rich(place(place(place(s0, sw, 0, 0), boy, 1.4, 0), tr, -2.4, 0)), [sw])
    const fought = take(take(activateOp(bTurn(melee, A(s0, 'ogryn')), boy), 'fight', dice(6, 6, 6, 6, 1, 1, 1, 1)).state, sw, dice(6, 6, 6, 6, 1, 1, 1, 1)).state
    const swapped = play(fought, dice(6, 6, 6, 6, 1, 1, 1, 1), { ...takePloy(`bl.p.dark-favour:${tr}`), ...strikes })
    expect(swapped.state.operatives[sw]!.wounds).toBe(9)
    expect(swapped.state.operatives[tr]!.wounds).toBeLessThan(7)

    // Sinister Trophies: an enemy attacking a holder within 2" cannot re-roll 1s (other results, further away and non-holders are fine)
    const ban = (st: GameState, holderId: string, from: string, defence = false) =>
      providerRerollBannedValues(st, { kind: 'shoot', rollerId: from, opponentId: holderId, defence })
    const trophies = marked(place(place(s0, tr, 0, 0), boy, 2.2, 0), [tr])
    expect(ban(trophies, tr, boy)).toEqual([1])
    expect(ban(place(trophies, boy, 5, 0), tr, boy)).toEqual([])
    expect(ban(s0, tr, boy)).toEqual([])
    expect(ban(trophies, tr, boy, true)).toEqual([])
    expect(ban(trophies, boy, tr)).toEqual([])
    expect(attackStats(trophies, boy, 'kom.w.dakka-shoota-short', tr, { kind: 'shoot' }).grants[0]!.values).toEqual([2, 3, 4, 5, 6])
    expect(attackStats(place(trophies, boy, 5, 0), boy, 'kom.w.dakka-shoota-short', tr, { kind: 'shoot' }).grants[0]!.values).toBeUndefined()

    // Symbols of Bloody Worship: nothing for an action that dealt no damage
    const hurt = edit(place(place(s0, tr, 0, 0), boy, 5, 0), (st) => void (st.operatives[tr]!.wounds = 4))
    expect(shootAt(hurt, tr, 'bl.w.lasgun', boy, dice(1, 1, 1, 1, 6, 6, 6)).state.operatives[tr]!.wounds).toBe(4)
    // Wicked Blades: +1 to both Dmg of bayonets and the improvised blade, nothing else
    const dmg = (id: string, st = s0) => weaponDamage(st, tr, id, boy, 'fight')
    expect(dmg('bl.w.bayonet')).toEqual({ normal: 3, crit: 4 })
    expect(dmg('bl.w.bayonet-chieftain')).toEqual({ normal: 3, crit: 4 })
    expect(dmg('bl.w.bayonet-shield')).toEqual({ normal: 3, crit: 4 })
    expect(dmg('bl.w.improvised-blade')).toEqual({ normal: 3, crit: 4 })
    expect(dmg('bl.w.chainsword')).toEqual({ normal: 4, crit: 5 })
    const bare = engaged(open())
    expect(dmg('bl.w.bayonet', bare)).toEqual({ normal: 2, crit: 3 })
  })

  it('TEAM-BL-034 Reward Earned is offered exactly once per kill, in the operative.killed window, for rule kills too and in the opponent activation', () => {
    const s0 = engaged(open())
    const tr = A(s0, 'trooper')
    const og = A(s0, 'ogryn')
    const boy = B(s0, 'boy')
    // an Avalanche of Muscle kill in the holder's own activation: one offer, in operative.killed, none at the action's end
    const rush = marked(edit(place(place(s0, og, 0, 0), boy, 5, 0), (st) => {
      st.players.A.cp = 3
      st.operatives[boy]!.wounds = 1
    }), [og])
    const seen: string[] = []
    const declined = play(take(activateOp(rush, og), 'charge').state, dice(6), {
      ...goTo(3.4, 0),
      'ploy.firefight': (p) => {
        if (p.options?.some((o) => o.id === 'bl.p.reward-earned')) seen.push(p.window ?? '')
        return p.options!.find((o) => o.id === `bl.avalanche@${boy}`)?.action ?? act.pass(p)
      },
    }, ['firefight.action', 'firefight.activate'])
    expect(declined.state.operatives[boy]!.status).toBe('removed')
    expect(seen).toEqual(['operative.killed'])
    expect(poolOf(declined.state, 'A', 'bl.blooded')).toBe(2)
    // a rule kill by a holder in the opponent's activation: the killer's seat is asked once, then the parked decision returns
    const theirs = marked(edit(bTurn(place(place(s0, tr, 0, 0), boy, 1.9, 0), og), (st) => void (st.players.A.cp = 3)), [tr])
    const parked = theirs.pending!
    const asked = withCtx(theirs, (ctx) => {
      directDamage(ctx, boy, 99, tr, 'test.rule')
      runDeferredRemovals(ctx)
    }).state
    expect(asked.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'operative.killed' })
    expect(optionIds(asked)).toContain('bl.p.reward-earned')
    const got = take(asked, 'bl.p.reward-earned').state
    // (the first enemy down this turning point gives 1, Reward Earned 1 more)
    expect(poolOf(got, 'A', 'bl.blooded')).toBe(poolOf(theirs, 'A', 'bl.blooded') + 2)
    expect(got.players.A.cp).toBe(2)
    expect(got.pending?.id).toBe(parked.id)
    // the end-of-action window no longer names Reward Earned
    expect(offersFor(got, 'A', 'firefight.actionEnded', { window: 'firefight.actionEnded', subjectId: tr }).some((o) => o.ployId === 'bl.p.reward-earned')).toBe(false)
  })
})

/** Answer a fight's choices for seat A with a block when one is offered (two successes with a Shield), otherwise a strike. */
const blocksFirst = {
  'fight.resolve': (p: PendingDecision) =>
    p.seat === 'A'
      ? (p.options!.find((o) => o.id.startsWith('block2:')) ?? p.options!.find((o) => o.id.startsWith('block:')) ?? p.options!.find((o) => o.id.startsWith('strike'))!).action
      : p.options!.find((o) => o.id.startsWith('strike'))!.action,
}

function expectedMean(s: GameState, shooter: string, target: string): number {
  return expectedDamage(s, shooter, 'bl.w.lasgun', target).mean
}
