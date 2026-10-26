// tempestus-aquilons engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-TA-nnn).
// The Aquilons are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { legalActions, step, validate } from '@/engine'
import { act } from '@/engine/actions'
import { abilityOffers, actionForbidden, maxRepeats } from '@/engine/abilities'
import { attackStats, defenceStats, effectiveRules, parseRules, validTargets } from '@/engine/attack-common'
import { hasKeyword } from '@/engine/conditions'
import { effectiveApl, effectiveMove, enemiesOf, readyOps } from '@/engine/state'
import { planMove } from '@/engine/movement'
import { beginTurningPoint } from '@/engine/strategy'
import { tokenCount, tokensOnTurningPointEnd } from '@/engine/tokens'
import { markerControl } from '@/engine/query'
import { usedThisBattle, usedThisTp, usesOf } from '@/engine/effects'
import { grenadeSource } from '@/engine/core-hooks'
import { offersFor, usePloy } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { usableRangedWeapons } from '@/engine/shoot'
import { providerCommandRerollCost, providerOwnReactions, teamRuleProviders } from '@/engine/team-rules'
import { continueActivation, startFreeAction } from '@/engine/firefight'
import { registerFrameResume } from '@/engine/hooks'
import { dropZoneOf, isAbove, landingSpots, landReach, TEAM_ID } from '@/engine/teams/tempestus-aquilons'
import { circleInsidePolygon, distToPolygon } from '@/engine/geometry'
import { baseUnderVantage, bodyOf, visible } from '@/engine/los'
import { enemiesInControlRange, gapToMarker } from '@/engine/measure'
import { runHook } from '@/engine/hooks'
import type { GameState, PendingDecision } from '@/engine/types'
import { enumerateLoadouts, loadBundle, loadoutCapProblems, validateRoster, type DatacardData } from '../../../src/data'
import { play } from '../../fixtures/attack'
import { feature, part, rect } from '../../fixtures/maps'
import { defaultAnswer, expectOk, place } from '../../fixtures/helpers'
import { activateOp, edit, hasOption, newRealGame, optionIds, realBundle, take, withCtx } from '../../fixtures/real'
import { A, B, above, bTurn, dice, goTo, strikes, MATCH, open, setUp, shootAt, shootAgain, toGambit, usePlayed, withDrops, withFx } from './tempestus-aquilons.hooks'

const data = loadBundle()

const dropMk = (state: GameState) => state.markers.find((m) => m.equipmentId === 'ta.drop')!
const roster = (main: string[]) => ({ leader: ['ta.tempestor'], servo: ['ta.servo-sentry'], main })
const T = (n: number) => Array<string>(n).fill('ta.trooper')

registerFrameResume('ta.test.free', (ctx) => continueActivation(ctx))

describe('TEAM-TA Tempestus Aquilons', () => {
  it('TEAM-TA-000 TEAM-TA-001 TEAM-TA-002 playable team, roster rules, printed loadouts, weapons and the name tests', () => {
    expect(TEAM_ID).toBe('tempestus-aquilons')
    const team = data.teams['tempestus-aquilons']!
    expect(team.playable).toBe(true)
    const cards = realBundle.datacards
    const ok = roster([...T(5), 'ta.gunner', 'ta.gunner', 'ta.marksman', 'ta.precursor'])
    expect(validateRoster(team, ok, cards as never).ok).toBe(true)
    // nine Troopers are legal; no Servo-Sentry, a second Grenadier, a second Marksman and a twelfth operative are not
    expect(validateRoster(team, roster(T(9)), cards as never).ok).toBe(true)
    expect(validateRoster(team, { leader: ['ta.tempestor'], servo: [], main: T(9) }, cards as never).ok).toBe(false)
    expect(validateRoster(team, roster([...T(7), 'ta.grenadier', 'ta.grenadier']), cards as never).ok).toBe(false)
    expect(validateRoster(team, roster([...T(7), 'ta.marksman', 'ta.marksman']), cards as never).ok).toBe(false)
    expect(validateRoster(team, roster(T(10)), cards as never).ok).toBe(false)
    // one Gunner of each carbine; two plasma Gunners are over the loadout cap
    const plasma = ['ta.w.plasma-carbine-standard', 'ta.w.plasma-carbine-supercharge']
    expect(loadoutCapProblems(team, [plasma, plasma], data.weaponGroups)).toHaveLength(1)
    expect(loadoutCapProblems(team, [['ta.w.melta-carbine'], plasma], data.weaponGroups)).toEqual([])
    const count = (id: string) => enumerateLoadouts(data.byId[id] as DatacardData).length
    expect([count('ta.tempestor'), count('ta.servo-sentry'), count('ta.gunner'), count('ta.trooper'), count('ta.precursor')]).toEqual([3, 3, 2, 1, 1])
    // printed numbers
    const w = (id: string) => data.byId[id] as { type: string; atk: number; hit: string; dmg: { normal: number; crit: number }; rules: { rule: string }[] }
    expect(w('ta.w.fists-tempestor').hit).toBe('3+')
    expect(w('ta.w.fists').hit).toBe('4+')
    expect(w('ta.w.tempestus-dagger-precursor')).toMatchObject({ atk: 4, hit: '3+', dmg: { normal: 3, crit: 4 } })
    expect(w('ta.w.tempestus-dagger-precursor').rules.map((r) => r.rule)).toEqual(['core.wr.ceaseless', 'core.wr.lethal'])
    expect(w('ta.w.tempestus-dagger')).toMatchObject({ atk: 3, hit: '4+', dmg: { normal: 3, crit: 4 } })
    expect(w('ta.w.melta-bomb').rules.map((r) => r.rule)).toContain('core.wr.limited')
    expect(w('ta.w.melta-bomb').dmg).toEqual({ normal: 5, crit: 3 })
    expect(w('ta.w.melta-carbine').dmg).toEqual({ normal: 6, crit: 3 })
    expect(w('ta.w.hot-shot-laspistols-salvo').hit).toBe('4+')
    expect(w('ta.w.hot-shot-laspistols-point-blank').type).toBe('melee')
    expect(w('ta.w.grenade-launcher-frag').hit).toBe('4+')
    expect(w('ta.w.hot-shot-volley-gun-focused')).toMatchObject({ atk: 5, hit: '4+' })
    expect(w('ta.w.hot-shot-long-las-concealed').rules.map((r) => r.rule)).toEqual(['core.wr.devastating', 'core.wr.heavy', 'core.wr.silent', 'ta.a.wr-concealed-position'])
    // stats: the Tempestor APL 3 / 9 wounds, the Servo-Sentry Move 4 / 3+ / 10 / 40mm
    const stats = (id: string) => data.byId[id] as unknown as { stats: { apl: number; move: number; save: string; wounds: number }; base: number }
    expect(stats('ta.tempestor')).toMatchObject({ stats: { apl: 3, move: 6, save: '4+', wounds: 9 }, base: 28 })
    expect(stats('ta.servo-sentry')).toMatchObject({ stats: { apl: 2, move: 4, save: '3+', wounds: 10 }, base: 40 })
    // the Gunfighter's point-blank profile is a fight weapon, not a Shoot weapon
    const s = open()
    const gf = A(s, 'gunfighter')
    const tr = A(s, 'trooper')
    for (const op of Object.values(s.operatives).filter((o) => o.seat === 'A')) {
      for (const k of ['TEMPESTUS AQUILON', 'IMPERIUM']) expect(hasKeyword(s, op, k), `${op.name} ${k}`).toBe(true)
      expect(hasKeyword(s, op, 'ASTRA MILITARUM')).toBe(false)
    }
    const engaged = edit(s, (st) => void (st.operatives[gf]!.order = 'engage'))
    const shootable = usableRangedWeapons(engaged, engaged.operatives[gf]!, [])
    expect(shootable).not.toContain('ta.w.hot-shot-laspistols-point-blank')
    expect(shootable).toEqual(expect.arrayContaining(['ta.w.hot-shot-laspistols-focused', 'ta.w.hot-shot-laspistols-salvo']))
    // a Trooper's fists hit on 4+ (stat read through the attack stats)
    expect(attackStats(s, tr, 'ta.w.fists', B(s, 'boy'), { kind: 'fight' }).need).toBe(4)
    expect(attackStats(s, A(s, 'tempestor'), 'ta.w.fists-tempestor', B(s, 'boy'), { kind: 'fight' }).need).toBe(3)
  })

  it('TEAM-TA-003 TEAM-TA-036 Tempestus Veteran: one free firefight ploy or Command Re-roll for the Tempestor per battle; Remote Overseer re-rolls the own initiative die once', () => {
    const s = open()
    const t = A(s, 'tempestor')
    const tr = A(s, 'trooper')
    const info = (who: string) => ({ window: 'firefight.activationStart', subjectId: who, counteracting: false })
    const progena = (state: GameState, who: string) => offersFor(state, 'A', 'firefight.activationStart', info(who)).find((o) => o.ployId === 'ta.p.progena')!
    expect(progena(s, t)).toMatchObject({ cost: 0, via: 'ta.veteran' })
    expect(progena(s, tr).cost).toBe(1)
    // using it for a Trooper costs 1 CP and keeps the use; using it for the Tempestor is free and spends it
    const cp0 = s.players.A.cp
    const forTrooper = withCtx(s, (ctx) => usePloy(ctx, 'A', progena(ctx.state, tr), info(tr))).state
    expect(forTrooper.players.A.cp).toBe(cp0 - 1)
    expect(usedThisBattle(forTrooper, 'A', 'ta.veteran')).toBe(false)
    const forTempestor = withCtx(s, (ctx) => usePloy(ctx, 'A', progena(ctx.state, t), info(t))).state
    expect(forTempestor.players.A.cp).toBe(cp0)
    expect(usedThisBattle(forTempestor, 'A', 'ta.veteran')).toBe(true)
    // once the use is gone every price is 1 CP
    expect(progena(edit(s, (st) => void st.ledger.A.battle.push('ta.veteran')), t).cost).toBe(1)
    // Command Re-roll: free for dice rolled for the Tempestor (spent once), 1 CP for a Trooper
    const boy = B(s, 'boy')
    const fight = place(place(s, t, 0, 0), boy, 5, 0)
    let c = take(take(activateOp(fight, t), 'shoot').state, 'ta.w.hot-shot-laspistol').state
    const rng = dice(1, 1, 1, 1, 6)
    c = take(c, boy, rng).state
    expect(c.pending!.kind).toBe('dice.commandReroll')
    expect(c.pending!.options!.find((o) => o.id === 'command:0')!.data).toMatchObject({ cost: 0 })
    c = take(c, 'command:0', rng).state
    const done = play(c, rng, { 'ploy.firefight': (p) => act.pass(p) })
    expect(done.state.players.A.cp).toBe(cp0)
    expect(usedThisBattle(done.state, 'A', 'ta.veteran')).toBe(true)
    const side = (id: string) => ({ seat: 'A' as const, operativeId: id, weaponId: null, dice: [], need: 3, lethal: null, grants: [], commandUsed: false, phase: 'grants' as const })
    expect(providerCommandRerollCost(s, side(tr), null)).toBe(1)
    expect(providerCommandRerollCost(done.state, side(t), null)).toBe(1)
    // Remote Overseer: the Aquilon player that lost the roll-off may re-roll its own die, once
    let g = newRealGame({ ...MATCH, equipmentA: ['ta.e.remote-overseer'] }, 'ta-overseer').state
    const init = new ScriptedRng([6, 1, 2, 5, 6, ...Array<number>(60).fill(1)])
    for (let i = 0; i < 400 && g.pending && !(g.pending.kind === 'strategy.initiative' && g.pending.context.reroll === true); i++) g = expectOk(step(g, defaultAnswer(g), init)).state
    expect(g.pending!.seat).toBe('A')
    expect(g.pending!.context.reroll).toBe(true)
    g = take(g, 'reroll', init).state
    expect(g.initiative).toBe('A')
    expect(usedThisBattle(g, 'A', 'ta.overseer')).toBe(true)
    expect(teamRuleProviders().find((p) => p.id === TEAM_ID)!.initiativeReroll!(g, 'A')).toBe(false)
  })

  it('TEAM-TA-004 COMMAND: APL +1 for a visible friendly Aquilon within 6" (never the Servo-Sentry, itself, one above or one too far), until the end of its next activation; not in an enemy control range', () => {
    const s = open()
    const t = A(s, 'tempestor')
    const tr = A(s, 'trooper')
    const servo = A(s, 'servo-sentry')
    const far = A(s, 'precursor')
    const up = A(s, 'marksman')
    const boy = B(s, 'boy')
    const staged = above(place(place(place(place(place(s, t, 0, 0), tr, 4, 0), servo, 0, 4), far, -8, 0), boy, 12, 0), up)
    const targets = (state: GameState) => optionIds(activateOp(state, t)).filter((o) => o.startsWith('ability:ta.a.command')).sort()
    expect(targets(staged)).toEqual([`ability:ta.a.command:${tr}`])
    // not while the Tempestor is in an enemy control range
    expect(targets(place(staged, boy, 1.4, 0))).toEqual([])
    // it costs 1 AP and raises the Trooper to APL 3 until its next activation ends
    let c = take(activateOp(staged, t), `ability:ta.a.command:${tr}`).state
    expect(c.firefight.activation!.apSpent).toBe(1)
    expect(effectiveApl(c.operatives[tr]!)).toBe(3)
    c = take(c, 'end').state
    // B activates and ends, then the Trooper activates with 3 AP and the bonus is gone afterwards
    c = take(activateOp(c, boy), 'end').state
    c = activateOp(c, tr)
    expect(c.pending!.context.apRemaining).toBe(3)
    c = take(c, 'end').state
    expect(effectiveApl(c.operatives[tr]!)).toBe(2)
  })

  it('TEAM-TA-005 TEAM-TA-006 Grenadier: frag and krak grenades at Hit 3+, smoke and stun, no limit on its own uses; Salvo: a second different valid target in its own sequence', () => {
    const s = open()
    const gr = A(s, 'grenadier')
    const tr = A(s, 'trooper')
    const boy = B(s, 'boy')
    const frag = 'core.w.frag-grenade'
    const krak = 'core.w.krak-grenade'
    expect(s.data.weapons[frag]!.hit).toBe(4)
    expect(attackStats(s, gr, frag, boy, { kind: 'shoot' }).need).toBe(3)
    expect(attackStats(s, gr, krak, boy, { kind: 'shoot' }).need).toBe(3)
    expect(attackStats(s, gr, 'ta.w.melta-bomb', boy, { kind: 'shoot' }).need).toBe(3)
    // smoke and stun for the Grenadier with no equipment taken, not for a Trooper
    const near = place(place(place(s, gr, 0, 0), tr, -3, 0), boy, 4, 0)
    const stun = (state: GameState, who: string) => optionIds(activateOp(edit(state, (st) => void (st.operatives[B(s, 'boy')]!.order = 'engage')), who)).filter((o) => o.startsWith('ability:core.a.'))
    expect(stun(near, gr).sort()).toEqual(['ability:core.a.smoke-grenade', `ability:core.a.stun-grenade:${boy}`])
    expect(stun(near, tr)).toEqual([])
    // two throws in a row are never used up: the weapon stays and the stun allowance is not spent for good
    let t = edit(near, (st) => void (st.operatives[boy]!.order = 'engage'))
    t = take(shootAt(t, gr, frag, boy, dice(1, 1, 1, 1, 1, 1, 1, 1)).state, 'end').state
    expect(t.operatives[gr]!.weapons).toContain(frag)
    expect(t.operatives[gr]!.usedLimited[frag]).toBe(1)
    expect(usesOf(t, 'A', 'own:A3:core.a.stun-grenade')).toBe(0)
    const stunned = take(take(activateOp(near, gr), `ability:core.a.stun-grenade:${boy}`, dice(1, 1)).state, 'end').state
    expect(usesOf(stunned, 'A', `own:${gr}:core.a.stun-grenade`)).toBe(1)
    expect(grenadeSource(stunned, stunned.operatives[gr]!, 'core.a.stun-grenade')).toBe('own')
    // Salvo: the second target is optional and may not be one a friend is fighting
    const gf = A(s, 'gunfighter')
    const grot = B(s, 'grot')
    const two = edit(place(place(place(s, gf, 0, 0), boy, 5, 0), grot, 5, 4), (st) => {
      st.operatives[boy]!.order = 'engage'
      st.operatives[grot]!.order = 'engage'
    })
    let f = take(take(activateOp(two, gf), 'shoot').state, 'ta.w.hot-shot-laspistols-salvo').state
    expect(optionIds(f).sort()).toEqual([boy, grot].sort())
    const rng = dice(1, 1, 1, 1, 1, 1, 1, 1)
    f = take(f, boy, rng).state
    expect(optionIds(f)).toEqual([`add:${grot}`, 'done'])
    const added = take(f, `add:${grot}`, rng)
    const volley = play(added.state, rng)
    const targetsRolled = [...added.events, ...volley.events].filter((e) => e.type === 'AttackDiceRolled').map((e) => (e as { targetId: string }).targetId)
    expect(targetsRolled).toEqual([boy, grot])
    // the second target is optional: finishing after the first fires one sequence
    const picked = take(take(take(activateOp(two, gf), 'shoot', rng).state, 'ta.w.hot-shot-laspistols-salvo', rng).state, boy, rng)
    const finished = take(picked.state, 'done', rng)
    const single = play(finished.state, rng)
    expect([...finished.events, ...single.events].filter((e) => e.type === 'AttackDiceRolled')).toHaveLength(1)
    // a target a friendly operative is fighting is no valid target for either part of the volley
    const held = place(two, A(s, 'trooper'), 5, 5)
    const chosen = take(take(activateOp(held, gf), 'shoot').state, 'ta.w.hot-shot-laspistols-salvo').state
    expect(optionIds(chosen)).not.toContain(grot)
  })

  it('TEAM-TA-007 Gunfight: an enemy within 8" that shoots the Gunfighter gives it a free focused Shoot at that enemy with fails + 1 dice (1 to 4), before its own removal if it fell', () => {
    const s = open()
    const gf = A(s, 'gunfighter')
    const boy = B(s, 'boy')
    const ender = A(s, 'trooper')
    const base = edit(place(place(place(s, gf, 0, 0), boy, 5, 0), ender, -12, 9), (st) => {
      st.operatives[gf]!.wounds = st.operatives[gf]!.maxWounds = 40
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
    })
    const STOP = ['ability.choice', 'firefight.action', 'firefight.activate'] as never
    /** B's Boy (or another enemy) shoots the Gunfighter with the given dice; returns the state it stops at and every event */
    const exchange = (state: GameState, shooter: string, weapon: string, rng: ScriptedRng) => {
      let t = bTurn(state, ender)
      const r1 = take(take(take(activateOp(t, shooter, 'engage', rng), 'shoot', rng).state, weapon, rng).state, gf, rng)
      const r2 = play(r1.state, rng, {}, STOP)
      return { state: r2.state, events: [...r1.events, ...r2.events] }
    }
    const rolledBy = (events: { type: string }[], id: string) => events.filter((e) => e.type === 'AttackDiceRolled' && (e as unknown as { operativeId: string }).operativeId === id) as unknown as { dice: number[]; weaponId: string; targetId: string }[]
    // two fails: a reaction offers a free Shoot with 3 dice of the focused profile, aimed at the Boy only
    let r = exchange(base, boy, 'kom.w.slugga', dice(1, 1, 6, 6))
    expect(r.state.pending!.kind).toBe('ability.choice')
    expect(r.state.pending!.seat).toBe('A')
    expect(r.state.pending!.options![0]!.data!.name).toMatch(/3 dice/)
    expect(r.state.operatives[gf]!.order).toBe('conceal')
    const back = take(r.state, 'react:0', dice(1, 1, 1))
    const fired = play(back.state, dice(1, 1, 1, 1, 1, 1), {}, STOP)
    const shots = rolledBy([...back.events, ...fired.events], gf)
    expect(shots).toHaveLength(1)
    expect(shots[0]!.dice).toHaveLength(3)
    expect(shots[0]!.weaponId).toBe('ta.w.hot-shot-laspistols-focused')
    expect(shots[0]!.targetId).toBe(boy)
    expect(fired.state.operatives[gf]!.order).toBe('engage')
    // no fails still rolls one die; four fails (or five, capped) roll four
    const dice0 = rolledBy(play(take(exchange(base, boy, 'kom.w.slugga', dice(6, 6, 6, 6)).state, 'react:0', dice(1)).state, dice(1, 1), {}, STOP).events, gf)
    r = exchange(base, boy, 'kom.w.slugga', dice(6, 6, 6, 6))
    const one = take(r.state, 'react:0', dice(1))
    expect(rolledBy([...one.events, ...play(one.state, dice(1, 1), {}, STOP).events], gf)[0]!.dice).toHaveLength(1)
    void dice0
    r = exchange(base, boy, 'kom.w.slugga', dice(1, 1, 1, 1))
    const four = take(r.state, 'react:0', dice(1))
    expect(rolledBy([...four.events, ...play(four.state, dice(1, 1, 1, 1), {}, STOP).events], gf)[0]!.dice).toHaveLength(4)
    // an enemy more than 8" away (base to base) gives no Gunfight
    const dakka = B(s, 'dakka-boy')
    const far = edit(place(place(place(s, gf, 0, 0), dakka, 10.5, 0), ender, -12, 9), (st) => void (st.operatives[gf]!.wounds = st.operatives[gf]!.maxWounds = 40))
    r = exchange(far, dakka, 'kom.w.dakka-shoota-long', dice(1, 1, 1, 1, 1))
    expect(r.state.pending!.kind).not.toBe('ability.choice')
    // a Gunfighter that falls shoots before it is removed
    const frail = edit(base, (st) => void (st.operatives[gf]!.wounds = 1))
    r = exchange(frail, boy, 'kom.w.slugga', dice(1, 1, 6, 6))
    expect(r.state.pending!.kind).toBe('ability.choice')
    expect(r.state.operatives[gf]!.status).toBe('active')
    expect(optionIds(r.state)).toEqual(['shoot', 'none'])
    const last = take(r.state, 'shoot', dice(1, 1, 1))
    const end = play(last.state, dice(6, 6, 6, 1, 1, 1), {}, STOP)
    expect(rolledBy([...last.events, ...end.events], gf)[0]!.dice).toHaveLength(3)
    expect(end.state.operatives[gf]!.status).toBe('removed')
    expect(end.state.operatives[boy]!.wounds).toBeLessThan(40)
    // declining lets it fall without shooting
    const declined = take(r.state, 'none', dice(1))
    expect(declined.state.operatives[gf]!.status).toBe('removed')
    expect(rolledBy(declined.events, gf)).toHaveLength(0)
  })

  it('TEAM-TA-008 TEAM-TA-009 TEAM-TA-010 Sniper Vantage (Severe from a Vantage floor 2" above an Engage target), Concealed Position (first Shoot only), Vicious Knife Fighter (two dice in a row, attacking only)', () => {
    const tower = feature('ta-tower', part('ta-tower.a', rect(-3, 3, -3, 3), 3, ['vantage']))
    const step = feature('ta-step', part('ta-step.a', rect(7, 9, -1, 1), 2, ['vantage']))
    const s = open()
    const mk = A(s, 'marksman')
    const boy = B(s, 'boy')
    const severe = (state: GameState, weapon: string) => parseRules(effectiveRules(state, state.operatives[mk]!, state.data.weapons[weapon]!, 'shoot', boy)).severe
    const atop = (patch: (st: GameState) => void = () => undefined) =>
      edit(s, (st) => {
        st.map = { ...st.map, features: [tower, step] }
        st.operatives[mk]!.pos = { x: 0, y: 3, z: 0 }
        st.operatives[boy]!.pos = { x: 5, y: 0, z: 0 }
        st.operatives[boy]!.order = 'engage'
        patch(st)
      })
    for (const w of ['ta.w.hot-shot-long-las-concealed', 'ta.w.hot-shot-long-las-mobile', 'ta.w.hot-shot-long-las-stationary']) expect(severe(atop(), w), w).toBe(true)
    // a Conceal target, a target only 1" lower, a shooter on the killzone floor or another weapon: nothing changes
    expect(severe(atop((st) => void (st.operatives[boy]!.order = 'conceal')), 'ta.w.hot-shot-long-las-mobile')).toBe(false)
    expect(severe(atop((st) => void (st.operatives[boy]!.pos = { x: 8, y: 2, z: 0 })), 'ta.w.hot-shot-long-las-mobile')).toBe(false)
    expect(severe(atop((st) => void (st.operatives[mk]!.pos = { x: 0, y: 0, z: 6 })), 'ta.w.hot-shot-long-las-mobile')).toBe(false)
    expect(parseRules(effectiveRules(atop(), atop().operatives[A(s, 'trooper')]!, s.data.weapons['ta.w.hot-shot-lascarbine']!, 'shoot', boy)).severe).toBe(false)
    // Concealed Position: on offer in the first Shoot of the battle, gone after any Shoot (the mobile profile included)
    const open1 = edit(place(place(s, mk, 0, 0), boy, 7, 0), (st) => void (st.operatives[boy]!.order = 'engage'))
    expect(usableRangedWeapons(edit(open1, (st) => void (st.operatives[mk]!.order = 'engage')), open1.operatives[mk]!, [])).toContain('ta.w.hot-shot-long-las-concealed')
    const shot = shootAt(open1, mk, 'ta.w.hot-shot-long-las-mobile', boy, dice(1, 1, 1, 1, 1, 1, 1, 1)).state
    expect(usableRangedWeapons(shot, shot.operatives[mk]!, [])).not.toContain('ta.w.hot-shot-long-las-concealed')
    expect(usableRangedWeapons(shot, shot.operatives[mk]!, [])).toContain('ta.w.hot-shot-long-las-mobile')
    // Vicious Knife Fighter: the attacking Precursor resolves two dice before the Boy resolves one
    const pr = A(s, 'precursor')
    const brawl = edit(place(place(s, pr, 0, 0), boy, 1.4, 0), (st) => {
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 60
      st.operatives[pr]!.wounds = st.operatives[pr]!.maxWounds = 60
    })
    const fought = play(take(take(activateOp(brawl, pr), 'fight').state, boy, dice(6, 6, 6, 6, 6, 6, 6, 6)).state, dice(1), strikes)
    const order = fought.events.filter((e) => e.type === 'Struck' || e.type === 'Blocked').map((e) => (e as { operativeId: string }).operativeId)
    expect(order.slice(0, 4)).toEqual([pr, pr, boy, pr])
    // retaliating, it alternates normally: the Boy attacks, the Precursor answers
    const attack = { kind: 'fight' as const, operativeId: boy, fight: { targetId: pr } }
    const provider = teamRuleProviders().find((p) => p.id === TEAM_ID)!
    expect(provider.afterFightResolution!(brawl, attack as never, 'A', 'strike')).toBeNull()
    const own = { kind: 'fight' as const, operativeId: pr, fight: { targetId: boy } }
    expect(provider.afterFightResolution!(brawl, own as never, 'A', 'strike')).toEqual([{ seat: 'A' }])
  })

  it('TEAM-TA-011 TEAM-TA-012 Dynamic: a free Dash after a Precursor Shoot or Fight (also after a Charge, never from a fight it did not win); Machine and Turret: four actions only, two Shoots, no assists', () => {
    const s = open()
    const pr = A(s, 'precursor')
    const boy = B(s, 'boy')
    const STOP = ['ability.choice', 'firefight.action', 'firefight.activate'] as never
    // after a Shoot the Precursor may Dash for free
    const shot = edit(place(place(s, pr, 0, 0), boy, 5, 0), (st) => void (st.operatives[boy]!.order = 'engage'))
    const r1 = take(take(take(activateOp(shot, pr), 'shoot').state, 'ta.w.hot-shot-laspistol').state, boy, dice(1, 1, 1, 1))
    const r2 = play(r1.state, dice(1, 1, 1, 1), {}, STOP)
    expect(r2.state.pending!.kind).toBe('ability.choice')
    expect(r2.state.pending!.options![0]!.data!.name).toMatch(/Dynamic/)
    const ap = r2.state.firefight.activation!.apSpent
    const dashing = take(r2.state, 'react:0')
    expect(dashing.state.pending!.kind).toBe('move.path')
    expect(dashing.state.pending!.constraints!.maxInches).toBe(3)
    const moved = play(dashing.state, dice(), goTo(-3, 0), STOP)
    expect(moved.state.pending!.kind).toBe('firefight.action')
    expect(moved.state.operatives[pr]!.pos.x).toBeCloseTo(-3, 1)
    expect(moved.state.firefight.activation!.apSpent).toBe(ap)
    // a Charge that finishes the Boy off: the Fight is followed by a free Dash
    const close = edit(place(place(s, pr, 0, 0), boy, 3.5, 0), (st) => {
      st.operatives[boy]!.wounds = 3
      st.operatives[boy]!.order = 'engage'
    })
    let c = take(activateOp(close, pr), 'charge').state
    c = play(c, dice(), goTo(1.6, 0), ['firefight.action'] as never).state
    const ch = take(take(c, 'fight').state, boy, dice(6, 6, 6, 6, 1, 1, 1, 1))
    const fin = play(ch.state, dice(1, 1, 1, 1), strikes, STOP)
    expect(fin.state.operatives[boy]!.status).toBe('removed')
    expect(fin.state.pending!.kind).toBe('ability.choice')
    expect(fin.state.pending!.options![0]!.data!.name).toMatch(/Dynamic/)
    // a Fight whose enemy survives leaves the Precursor in its control range: no Dash
    const tough = edit(place(place(s, pr, 0, 0), boy, 1.4, 0), (st) => {
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 60
      st.operatives[boy]!.order = 'engage'
    })
    const slog = play(take(take(activateOp(tough, pr), 'fight').state, boy, dice(1, 1, 1, 1, 1, 1, 1, 1)).state, dice(1), strikes, STOP)
    expect(slog.state.pending!.kind).not.toBe('ability.choice')
    expect(slog.state.operatives[boy]!.status).toBe('active')
    // Servo-Sentry: Dash, Fall Back, Reposition and Shoot only, a Shoot twice, never a retaliation or an assist
    const sv = A(s, 'servo-sentry')
    const free = edit(place(place(s, sv, 0, 0), boy, 6, 0), (st) => void (st.operatives[boy]!.order = 'engage'))
    const acts = optionIds(activateOp(free, sv))
    expect(acts.sort()).toEqual(['dash', 'end', 'reposition', 'shoot'])
    const pinned = edit(place(place(s, sv, 0, 0), boy, 1.5, 0), (st) => void (st.operatives[boy]!.order = 'engage'))
    expect(optionIds(activateOp(pinned, sv)).sort()).toEqual(['end', 'fallBack'])
    expect(actionForbidden(free, free.operatives[sv]!, 'fight')).toMatch(/Machine/)
    expect(actionForbidden(free, free.operatives[sv]!, 'marker:pickUp')).toMatch(/Machine/)
    expect(actionForbidden(free, free.operatives[sv]!, 'ability:core.a.smoke-grenade')).toMatch(/Machine/)
    expect(actionForbidden(free, free.operatives[sv]!, 'ability:ta.a.land')).toBeNull()
    expect(maxRepeats(free, free.operatives[sv]!, 'shoot', [])).toBe(2)
    expect(free.operatives[sv]!.weapons.every((w) => free.data.weapons[w]!.type === 'ranged')).toBe(true)
    const w1 = shootAt(free, sv, 'ta.w.hot-shot-volley-gun-focused', boy, dice(1, 1, 1, 1, 1))
    expect(hasOption(w1.state, 'shoot')).toBe(true)
    const w2 = shootAgain(w1.state, 'ta.w.hot-shot-volley-gun-focused', boy, dice(1, 1, 1, 1, 1))
    expect(hasOption(w2.state, 'shoot')).toBe(false)
    // an assist from the Servo-Sentry does not help a fight; one from a Trooper does
    const assists = (list: string[]) => attackStats(s, pr, 'ta.w.tempestus-dagger-precursor', boy, { kind: 'fight', assists: list }).need
    expect(assists([sv])).toBe(assists([]))
    expect(assists([A(s, 'trooper')])).toBe(assists([]) - 1)
  })

  it('TEAM-TA-013 TEAM-TA-014 Rapid Insertion (turning point 1 only): each Trooper wholly within the drop zone repositions for free to within 3" of it; Swift Landing: a Trooper lands 4" from a Drop marker, a Gunner 3"', () => {
    const g = toGambit()
    expect(hasOption(g, 'ta.p.rapid-insertion')).toBe(true)
    const troopers = Object.values(g.operatives).filter((o) => o.seat === 'A' && o.datacardId === 'ta.trooper').map((o) => o.id)
    const [t1, t2, t3] = troopers as [string, string, string]
    // the group is fixed at use: a Trooper that went above first is not in it, the others are
    const staged = above(
      edit(g, (st) => {
        st.map = { ...st.map, features: [] }
        st.operatives[t1]!.pos = { x: -10, y: 0, z: 3 }
        st.operatives[t2]!.pos = { x: -10, y: 0, z: 6 }
      }),
      t3,
    )
    let r = take(staged, 'ta.p.rapid-insertion').state
    expect(r.pending!.kind).toBe('ability.choice')
    expect(optionIds(r).sort()).toEqual(['done', t1, t2].sort())
    r = take(r, t1).state
    expect(r.pending!.kind).toBe('move.path')
    const far = step(r, { type: 'move.path', seat: 'A', decisionId: r.pending!.id, payload: { waypoints: [{ x: -5, z: 3 }] } })
    expect(far.rejection?.reason).toMatch(/Rapid Insertion/)
    r = expectOk(step(r, { type: 'move.path', seat: 'A', decisionId: r.pending!.id, payload: { waypoints: [{ x: -6.6, z: 3 }] } })).state
    expect(r.operatives[t1]!.pos.x).toBeCloseTo(-6.6, 1)
    // the choice comes back for the Troopers still to move; the move cost no AP and no CP
    expect(r.pending!.kind).toBe('ability.choice')
    expect(optionIds(r).sort()).toEqual(['done', t2].sort())
    expect(r.players.A.cp).toBe(g.players.A.cp)
    r = take(r, 'done').state
    expect(r.pending!.kind).toBe('strategy.gambit')
    expect(hasOption(r, 'ta.p.rapid-insertion')).toBe(false)
    // not in turning point 2
    const g2 = edit(g, (st) => void (st.turningPoint = 2))
    expect(offersFor(g2, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'ta.p.rapid-insertion')).toBe(false)
    // Swift Landing
    const up = withDrops(above(open(), A(open(), 'trooper'), A(open(), 'gunner')), [0, 0])
    const reach = (card: string) => {
      const op = up.operatives[A(up, card)]!
      // the spots outside the drop zone are the ones the Drop marker's reach allows
      return Math.max(...landingSpots(up, op, landReach(up, op), 40).filter((p) => p.x > -8).map((p) => gapToMarker(bodyOf({ ...op, pos: p }), dropMk(up))))
    }
    expect(landReach(up, up.operatives[A(up, 'trooper')]!)).toBe(4)
    expect(landReach(up, up.operatives[A(up, 'gunner')]!)).toBe(3)
    expect(reach('trooper')).toBeGreaterThan(3)
    expect(reach('trooper')).toBeLessThanOrEqual(4.0001)
    expect(reach('gunner')).toBeLessThanOrEqual(3.0001)
  })

  it('TEAM-TA-015 TEAM-TA-016 TEAM-TA-017 Drop Insertion at set-up: the first batch is never set aside, a later batch goes aside whole, one Drop marker per batch wholly in the drop zone (a pass takes the central spot), and a gambit moves them up to 4"', () => {
    const batch2 = (s: GameState) => s.pending?.kind === 'setup.deploy' && s.pending.seat === 'A' && s.setup.batches?.A === 2
    // batch 1: nothing may go aside; batch 2: every Aquilon still to place may
    const first = setUp([], (s) => s.pending?.kind === 'setup.deploy' && s.pending.seat === 'A')
    expect(first.pending!.context.setAsideIds).toEqual([])
    const second = setUp([], batch2)
    const ids = second.pending!.context.setAsideIds as string[]
    expect(ids).toHaveLength(7)
    // the first answer decides: set aside, and the rest of the batch cannot be deployed
    const p = second.pending!
    const gone = expectOk(step(second, act.setAside(p, ids[0]!)))
    expect(gone.state.pending!.context.wholeBatchAside).toBe(true)
    expect(gone.state.pending!.constraints!.operativeIds).toEqual([])
    expect(step(gone.state, act.deploy(gone.state.pending!, ids[1]!, -12, 0)).rejection).toMatchObject({ code: 'E_NOT_AN_OPTION' })
    // a batch whose first operative was deployed cannot be set aside
    const placed = expectOk(step(second, defaultAnswer(second))).state
    expect(placed.pending!.context.setAsideIds).toEqual([])
    // up to seven of eleven go above: 4 + 3
    const count = (s: GameState) => Object.values(s.operatives).filter((o) => o.seat === 'A' && isAbove(o)).length
    const markersOf = (s: GameState) => s.markers.filter((m) => m.equipmentId === 'ta.drop' && m.owner === 'A')
    const zone = (s: GameState) => dropZoneOf(s, 'A')!.polygon
    const wholly = (s: GameState) => markersOf(s).every((m) => circleInsidePolygon(m.pos, 0.394, zone(s)))
    const both = setUp(['deploy', 'aside', 'aside'])
    expect(count(both)).toBe(7)
    expect(markersOf(both)).toHaveLength(2)
    expect(wholly(both)).toBe(true)
    expect(markersOf(both)[0]!.pos).not.toEqual(markersOf(both)[1]!.pos)
    // one batch above, one marker; none above, no question at all
    const one = setUp(['deploy', 'deploy', 'aside'])
    expect(count(one)).toBe(3)
    expect(markersOf(one)).toHaveLength(1)
    let asked = 0
    expect(markersOf(setUp(['deploy', 'deploy', 'deploy'], undefined, () => (asked++, null)))).toHaveLength(0)
    expect(asked).toBe(0)
    // each marker is a question of its own; a pass places it at the central spot, the first option does too
    let questions = 0
    setUp(['deploy', 'aside', 'aside'], undefined, (q) => (questions++, q.options![1]!.id))
    expect(questions).toBe(2)
    const passed = setUp(['deploy', 'aside', 'deploy'], undefined, () => null)
    const centre = { x: -12, z: 0 }
    const m = markersOf(passed)[0]!
    expect(Math.hypot(m.pos.x - centre.x, m.pos.z - centre.z)).toBeLessThan(2)
    expect(wholly(passed)).toBe(true)
    // the gambit: each marker moves up to 4" (nothing farther is offered), in a decision of its own
    let g = take(both, 'ta.p.drop-insertion').state
    const reach = (st: GameState, mk: { x: number; z: number }) => (st.pending!.options ?? []).map((o) => (o.data as { x: number; z: number }).x === undefined ? 0 : Math.hypot((o.data as { x: number }).x - mk.x, (o.data as { z: number }).z - mk.z))
    const before = markersOf(g).map((k) => ({ ...k.pos }))
    expect(Math.max(...reach(g, before[0]!))).toBeLessThanOrEqual(4.0001)
    expect(Math.max(...reach(g, before[0]!))).toBeGreaterThan(3)
    const far = g.pending!.options!.filter((o) => o.id.includes(',')).sort((a, b) => Math.hypot((b.data as { x: number }).x - before[0]!.x, (b.data as { z: number }).z - before[0]!.z) - Math.hypot((a.data as { x: number }).x - before[0]!.x, (a.data as { z: number }).z - before[0]!.z))[0]!
    g = take(g, far.id).state
    expect(g.pending!.kind).toBe('ability.choice')
    g = take(g, g.pending!.options!.find((o) => o.id.endsWith('=stay'))!.id).state
    expect(g.pending!.kind).toBe('strategy.gambit')
    expect(markersOf(g)[0]!.pos).not.toEqual(before[0])
    expect(markersOf(g)[1]!.pos).toEqual(before[1])
    expect(g.players.A.cp).toBe(both.players.A.cp)
    // turning points 1 and 2, not 3, and never without a marker
    const offered = (st: GameState) => offersFor(st, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'ta.p.drop-insertion')
    expect(offered(edit(both, (st) => void (st.turningPoint = 2)))).toBe(true)
    expect(offered(edit(both, (st) => void (st.turningPoint = 3)))).toBe(false)
    expect(offered(setUp(['deploy', 'deploy', 'deploy']))).toBe(false)
  })

  it('TEAM-TA-018 TEAM-TA-019 TEAM-TA-020 LAND: 1 AP, counts as a Reposition (Dash allowed; no Charge, Fall Back or plain Heavy weapon), floor and Vantage spots near a marker or in the drop zone, none under Vantage or in an enemy control range (the Precursor excepted), obscured until the end of the next activation', () => {
    const base = withDrops(above(open(), A(open(), 'grenadier'), A(open(), 'marksman'), A(open(), 'precursor'), A(open(), 'trooper')), [-3, 0])
    const gr = A(base, 'grenadier')
    const mk = A(base, 'marksman')
    const pr = A(base, 'precursor')
    const tr = A(base, 'trooper')
    const boy = B(base, 'boy')
    // activating an operative above offers Land and End; End keeps it above and expended
    const act = activateOp(base, gr)
    expect(optionIds(act)).toEqual(['ability:ta.a.land', 'end'])
    expect(act.pending!.options!.find((o) => o.id === 'ability:ta.a.land')!.data).toMatchObject({ cost: 1 })
    const stayed = take(act, 'end').state
    expect(stayed.operatives[gr]!.status).toBe('reserve')
    expect(stayed.operatives[gr]!.ready).toBe(false)
    // both orders are offered for every spot
    const spots = take(act, 'ability:ta.a.land').state
    const ids = optionIds(spots)
    expect(ids.some((i) => i.startsWith('engage@')) && ids.some((i) => i.startsWith('conceal@'))).toBe(true)
    // after landing: Dash, Guard and Shoot, not Reposition, Charge or Fall Back; the melta bomb is usable, plain Heavy weapons are not
    const pick = (state: GameState, order = 'engage') => optionIds(state).find((i) => i.startsWith(`${order}@`) && !i.includes('!adj'))!
    // a target is staged next to the chosen spot before landing (the options are worked out when the landing finishes)
    const xyOf = (id: string) => id.split('@')[1]!.split(',').map(Number) as [number, number, number]
    const near = (state: GameState, id: string, dx: number) => {
      const [x, , z] = xyOf(id)
      return edit(state, (st) => {
        st.operatives[boy]!.pos = { x: x + dx, y: 0, z }
        st.operatives[boy]!.order = 'engage'
      })
    }
    const chosen = pick(spots)
    const landed = take(near(spots, chosen, 2.6), chosen).state
    expect(landed.operatives[gr]!.status).toBe('active')
    expect(landed.firefight.activation!.apSpent).toBe(1)
    expect(optionIds(landed)).toEqual(expect.arrayContaining(['dash', 'guard', 'end', 'shoot']))
    for (const a of ['reposition', 'charge', 'fallBack', 'ability:ta.a.land']) expect(optionIds(landed), a).not.toContain(a)
    expect(optionIds(take(landed, 'shoot').state)).toEqual(expect.arrayContaining(['ta.w.melta-bomb', 'ta.w.hot-shot-laspistol']))
    const sniperSpots = take(activateOp(edit(base, (st) => void (st.operatives[gr]!.ready = false)), mk), 'ability:ta.a.land').state
    const mkChosen = pick(sniperSpots)
    const sniper = take(near(sniperSpots, mkChosen, 6), mkChosen).state
    expect(optionIds(take(sniper, 'shoot').state)).toEqual(['ta.w.hot-shot-long-las-mobile'])
    // landing spots: marker reach, the drop zone, Vantage floors; never under Vantage or in an enemy control range
    const tower = feature('ta-tower', part('ta-tower.a', rect(-5, -1.5, -3, 3), 3, ['vantage']))
    const withTower = edit(base, (st) => void (st.map = { ...st.map, features: [tower] }))
    const trooperSpots = landingSpots(withTower, withTower.operatives[tr]!, 4, 60)
    expect(trooperSpots.some((p) => p.y === 3)).toBe(true)
    expect(trooperSpots.some((p) => p.y === 0)).toBe(true)
    const inZone = (p: { x: number }) => p.x < -9.4
    expect(trooperSpots.some(inZone)).toBe(true)
    for (const p of trooperSpots) {
      const body = bodyOf({ ...withTower.operatives[tr]!, pos: p })
      expect(baseUnderVantage(withTower, body)).toBe(false)
      expect(inZone(p) || gapToMarker(body, dropMk(withTower)) <= 4.0001).toBe(true)
    }
    // an enemy next to the marker: no spot in its control range, except for the Precursor
    const watched = place(base, boy, -5, 0)
    const watchedSpots = (id: string) => landingSpots(watched, watched.operatives[id]!, 4, 60)
    expect(watchedSpots(tr).every((p) => enemiesInControlRange(watched, bodyOf({ ...watched.operatives[tr]!, pos: p }), 'A').length === 0)).toBe(true)
    expect(watchedSpots(pr).some((p) => enemiesInControlRange(watched, bodyOf({ ...watched.operatives[pr]!, pos: p }), 'A').length > 0)).toBe(true)
    // obscured: the Boy's Shoot at the landed Trooper discards a success (it is in the open); after the next activation it does not
    const landTrooper = take(take(activateOp(base, tr), 'ability:ta.a.land').state, pick(take(activateOp(base, tr), 'ability:ta.a.land').state)).state
    const trPos = landTrooper.operatives[tr]!.pos
    const setUpShot = (st: GameState, boyId: string, dz = 0) => edit(place(st, boyId, trPos.x + 5, trPos.z + dz), (x) => void (x.operatives[boyId]!.order = 'engage'))
    const obscuredFor = (st: GameState, boyId: string, weapon = 'kom.w.slugga') => {
      const sel = take(take(activateOp(st, boyId), 'shoot').state, weapon)
      const r = take(sel.state, tr, dice(6, 6, 6, 6))
      return r.events.find((e) => e.type === 'TargetSelected') as unknown as { obscured: boolean }
    }
    const afterLand = take(landTrooper, 'end').state
    expect(obscuredFor(setUpShot(afterLand, boy), boy).obscured).toBe(true)
    // a counteraction does not end the status; the end of the next activation does
    expect(afterLand.effects.some((e) => e.kind === 'ta.landed')).toBe(true)
    const counter = withCtx(afterLand, (ctx) => runHook('activation.end', { seat: 'B', state: ctx.state, engine: ctx, operativeId: boy, data: { counteract: true } })).state
    expect(counter.effects.some((e) => e.kind === 'ta.landed')).toBe(true)
    const boyDone = take(activateOp(setUpShot(afterLand, boy), boy), 'end').state
    expect(boyDone.effects.some((e) => e.kind === 'ta.landed')).toBe(false)
    const nob = B(base, 'boss-nob')
    const aTurn = take(activateOp(boyDone, A(base, 'gunner')), 'end').state
    expect(obscuredFor(setUpShot(aTurn, nob, -3), nob).obscured).toBe(false)
  })

  it('TEAM-TA-021 TEAM-TA-022 TEAM-TA-023 TEAM-TA-024 deadlines and markers: fewer than half above after turning point 1, all above gone after turning point 2, a Drop marker lost in each Ready step, operatives above are out of the killzone, Grav-Chute makes drops free', () => {
    // six of eleven still above after turning point 1: one is incapacitated (the latest roster entry), with five none
    const six = above(open(), 'A6', 'A7', 'A8', 'A9', 'A10', 'A11')
    const ended = (st: GameState, tp: number) => withCtx(st, (ctx) => runHook('turningPoint.end', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: tp } })).state
    const after1 = ended(six, 1)
    expect(Object.values(after1.operatives).filter((o) => o.seat === 'A' && isAbove(o))).toHaveLength(5)
    expect(after1.operatives['A11']!.status).toBe('removed')
    expect(ended(above(open(), 'A7', 'A8', 'A9', 'A10', 'A11'), 1).operatives['A11']!.status).toBe('reserve')
    // the whole game with nobody landing: 7 above, 2 fall after turning point 1, the other 5 after turning point 2
    const dead = (st: GameState) => Object.values(st.operatives).filter((o) => o.seat === 'A' && o.status === 'removed').length
    let g = setUp(['deploy', 'aside', 'aside'])
    const rng = new ScriptedRng([4, 3, 2, 5, 6, 1, 3, 2, 4, 5, 2, 6, 1, 3])
    const seen: Record<number, number> = {}
    for (let i = 0; i < 4000 && g.phase !== 'ended'; i++) {
      const q = g.pending!
      if (q.kind === 'ability.choice' && q.context.readyStep === true) {
        // the Ready step of turning point 2 asks which of the two markers goes (A's second marker here), the next one takes the last
        seen[g.turningPoint] = (q.options ?? []).length
        g = take(g, q.options![1]!.id, rng).state
        expect(g.markers.filter((m) => m.equipmentId === 'ta.drop')).toHaveLength(1)
        continue
      }
      if (q.kind === 'strategy.gambit' && !(g.turningPoint in seen)) seen[g.turningPoint] = 0
      if (q.kind === 'strategy.gambit' && g.turningPoint === 2) expect(dead(g)).toBe(2)
      if (q.kind === 'strategy.gambit' && g.turningPoint === 3) {
        expect(dead(g)).toBe(7)
        expect(g.markers.filter((m) => m.equipmentId === 'ta.drop')).toHaveLength(0)
      }
      g = expectOk(step(g, defaultAnswer(g), rng)).state
    }
    expect(seen[2]).toBe(2)
    expect(g.phase).toBe('ended')
    // operatives above: not a target, not contesting, not seen; a ready one stops the seat counteracting
    const base = above(open(), 'A9')
    const boy = B(base, 'boy')
    const obj = base.markers.find((m) => m.kind === 'objective')!
    const parked = edit(place(place(base, 'A9', obj.pos.x, obj.pos.z), boy, obj.pos.x + 4, obj.pos.z), (st) => void (st.operatives[boy]!.order = 'engage'))
    expect(validTargets(parked, parked.operatives[boy]!, 'kom.w.slugga').map((t) => t.id)).not.toContain('A9')
    expect(markerControl(parked, obj).contesting.A).not.toContain('A9')
    expect(enemiesOf(parked, parked.operatives[boy]!).map((o) => o.id)).not.toContain('A9')
    expect(visible(parked, bodyOf(parked.operatives[boy]!), bodyOf(parked.operatives['A9']!))).toBe(true)
    const expended = edit(parked, (st) => {
      for (const o of Object.values(st.operatives)) if (o.seat === 'A' && o.id !== 'A9') o.ready = false
    })
    const stuck = expended.operatives['A1']!
    expect(stuck.ready).toBe(false)
    // it is still a ready operative of the seat, so the seat is not all expended and cannot counteract
    expect(readyOps(expended, 'A').map((o) => o.id)).toEqual(['A9'])
    // Grav-Chute: a 4" drop costs nothing for an Aquilon, 2" for anyone else
    const platform = feature('ta-platform', part('ta-platform.a', rect(-3, 0, -3, 3), 4, ['vantage']))
    const high = (id: string) =>
      edit(open(), (st) => {
        st.map = { ...st.map, features: [platform] }
        st.operatives[id]!.pos = { x: -0.8, y: 4, z: 0 }
      })
    const walkOff = (id: string) => {
      const st = high(id)
      return planMove(st, st.operatives[id]!, 'reposition', [{ x: 0.8, z: 0, y: 0 }, { x: 4.2, z: 0 }])
    }
    const trooperWalk = walkOff('A9')
    expect(trooperWalk.ok).toBe(true)
    expect((trooperWalk as { cost: number }).cost).toBe(6)
    const boyWalk = walkOff(boy)
    expect(boyWalk.ok).toBe(false)
    expect((boyWalk as { rejection: { details?: { cost?: number } } }).rejection.details?.cost).toBe(8)
  })

  it('TEAM-TA-025 TEAM-TA-026 TEAM-TA-027 TEAM-TA-028 strategy ploys: Sudden Offensive (Balanced for the first half of the team activated), Maintain Momentum (Severe against ready enemies), Eye Above (Detected tokens, a defence re-roll, a double block), Drop and Secure (control and melee Atk at a marker)', () => {
    const s = open()
    const boy = B(s, 'boy')
    const rangedOf = (state: GameState, who: string) => state.operatives[who]!.weapons.find((w) => state.data.weapons[w]!.type === 'ranged')!
    const balanced = (state: GameState, who: string) => parseRules(effectiveRules(state, state.operatives[who]!, state.data.weapons[rangedOf(state, who)]!, 'shoot', boy)).balanced
    // Sudden Offensive: seven not incapacitated (two of them above) halve to 4; the first four activations have Balanced
    const seven = above(
      edit(s, (st) => {
        for (const id of ['A8', 'A9', 'A10', 'A11']) st.operatives[id]!.status = 'removed'
      }),
      'A6',
      'A7',
    )
    let g = usePlayed(seven, 'ta.p.sudden-offensive')
    expect(g.effects.find((e) => e.kind === 'ta.sudden')!.data).toMatchObject({ x: 4, ids: [] })
    const order = ['A6', 'A1', 'A3', 'A4', 'A5']
    const foes = [B(s, 'boy'), B(s, 'dakka-boy'), B(s, 'burna-boy'), B(s, 'rokkit-boy'), B(s, 'snipa-boy')]
    const during: boolean[] = []
    for (let i = 0; i < order.length; i++) {
      g = activateOp(g, order[i]!)
      // an operative above has no weapons in play to look at: its slot is counted all the same
      during.push(i === 0 ? true : balanced(g, order[i]!))
      g = take(g, 'end').state
      g = take(activateOp(g, foes[i]!), 'end').state
    }
    expect(during).toEqual([true, true, true, true, false])
    expect((g.effects.find((e) => e.kind === 'ta.sudden')!.data!.ids as string[]).sort()).toEqual(['A1', 'A3', 'A4', 'A6'])
    // after its own activation the Balanced is gone
    expect(balanced(g, 'A1')).toBe(false)
    // Maintain Momentum: Severe against a ready enemy, not an expended one; fighting only as the attacker
    const mm = withFx(s, { source: 'ta.p.maintain-momentum' })
    const severe = (state: GameState, who: string, weapon: string, kind: 'shoot' | 'fight') => parseRules(effectiveRules(state, state.operatives[who]!, state.data.weapons[weapon]!, kind, boy)).severe
    const tr = A(s, 'trooper')
    expect(severe(mm, tr, 'ta.w.hot-shot-lascarbine', 'shoot')).toBe(true)
    expect(severe(edit(mm, (st) => void (st.operatives[boy]!.ready = false)), tr, 'ta.w.hot-shot-lascarbine', 'shoot')).toBe(false)
    expect(severe(s, tr, 'ta.w.hot-shot-lascarbine', 'shoot')).toBe(false)
    const fightBy = (attacker: string) => edit(mm, (st) => void (st.attack = { kind: 'fight', operativeId: attacker, seat: st.operatives[attacker]!.seat, fight: { targetId: attacker === tr ? boy : tr } } as never))
    expect(severe(fightBy(tr), tr, 'ta.w.fists', 'fight')).toBe(true)
    expect(severe(fightBy(boy), tr, 'ta.w.fists', 'fight')).toBe(false)
    // Eye Above: the pick and every enemy within 3" are Detected until the turning point ends
    const grot = B(s, 'grot')
    const nob = B(s, 'boss-nob')
    const spread = edit(place(place(place(s, boy, 0, 0), grot, 2.5, 0), nob, 6, 0), (st) => void (st.operatives[tr]!.order = 'engage'))
    const eye = usePlayed(spread, 'ta.p.eye-above', {}, boy)
    expect([boy, grot, nob].map((id) => tokenCount(eye, id, 'ta.detected', 'A'))).toEqual([1, 1, 0])
    // a Detected enemy shooting an Aquilon: one defence die may be re-rolled; others get nothing
    const grants = (state: GameState, victim: string, attacker: string) =>
      defenceStats(state, victim, attacker, 'kom.w.slugga', parseRules(state.data.weapons['kom.w.slugga']!.rules), false).grants.map((x) => x.source)
    expect(grants(eye, tr, boy)).toEqual(['ta.p.eye-above'])
    expect(grants(eye, tr, nob)).toEqual([])
    expect(grants(eye, boy, tr)).toEqual([])
    // the tokens end with the turning point
    expect(withCtx(eye, (ctx) => void tokensOnTurningPointEnd(ctx)).state.operatives[boy]!.tokens ?? []).toEqual([])
    // fighting a Detected enemy: one Aquilon block cancels two successes, the second block one
    const blocks = { 'fight.resolve': (p: PendingDecision) => (p.options?.find((o) => o.id.startsWith('block2')) ?? p.options?.find((o) => o.id.startsWith('block')) ?? p.options![0]!).action }
    const brawl = (state: GameState) => {
      const staged = edit(place(place(state, tr, 0, 0), boy, 1.4, 0), (st) => {
        st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 60
        st.operatives[tr]!.wounds = st.operatives[tr]!.maxWounds = 60
      })
      return play(take(take(activateOp(staged, tr), 'fight').state, boy, dice(4, 4, 4, 3, 3, 3, 3)).state, dice(1), blocks)
    }
    const plain = brawl(s)
    const watched = brawl(usePlayed(s, 'ta.p.eye-above', {}, boy))
    const lost = (p: ReturnType<typeof brawl>) => 60 - p.state.operatives[tr]!.wounds
    expect(lost(watched)).toBeLessThan(lost(plain))
    // Drop and Secure: 2 APL against 2 APL is a tie; with the ploy the Aquilon counts 3 and controls the marker
    const obj = s.markers.find((m) => m.kind === 'objective')!
    const contest = (state: GameState) => markerControl(state, state.markers.find((m) => m.id === obj.id)!).controller
    const tie = edit(place(place(s, tr, obj.pos.x + 1.4, obj.pos.z), boy, obj.pos.x - 1.4, obj.pos.z), (st) => {
      for (const o of Object.values(st.operatives)) o.apl = 2
    })
    expect(contest(tie)).toBeNull()
    const secured = withFx(tie, { source: 'ta.p.drop-and-secure', kind: 'ta.dropAndSecure', expires: 'turningPointStart', data: { markerId: obj.id } })
    expect(contest(secured)).toBe('A')
    // Atk +1 on melee weapons within 3" of the marker, to a maximum of 4 (fists 3 -> 4, chainsword 4 stays)
    const tp = A(s, 'tempestor')
    const near = edit(place(place(secured, tr, obj.pos.x + 2, obj.pos.z), tp, obj.pos.x - 1, obj.pos.z + 1), (st) => void (st.operatives[tp]!.weapons = ['ta.w.hot-shot-laspistol', 'ta.w.chainsword']))
    expect(attackStats(near, tr, 'ta.w.fists', boy, { kind: 'fight' }).atk).toBe(4)
    expect(attackStats(near, tp, 'ta.w.chainsword', boy, { kind: 'fight' }).atk).toBe(4)
    expect(attackStats(place(near, tr, obj.pos.x + 6, obj.pos.z), tr, 'ta.w.fists', boy, { kind: 'fight' }).atk).toBe(3)
    // the effect ends at the next Ready step
    const next = withCtx(near, (ctx) => beginTurningPoint(ctx)).state
    expect(next.effects.some((e) => e.kind === 'ta.dropAndSecure')).toBe(false)
  })

  it('TEAM-TA-029 TEAM-TA-030 Hot Drop (re-roll any attack dice within 6" after landing, dropping from Vantage 2" up or standing in the opponent territory) and Adjust Coordinates (5" landing for 1 CP, then no Dash, Shoot or Fight)', () => {
    const s0 = open()
    const tr = A(s0, 'trooper')
    const boy = B(s0, 'boy')
    const hotDrop = (state: GameState) => state.pending?.kind === 'ploy.firefight' && state.pending.options!.some((o) => o.id === 'ta.p.hot-drop')
    /** Shoot `boy` with `who` from the activation under way; stops at the first ploy window of the attack (or the end of it). */
    const shootWindow = (state: GameState, who: string, weapon: string) => {
      let t = take(take(state, 'shoot').state, weapon).state
      t = take(t, boy, dice(1, 1, 1, 1)).state
      return play(t, dice(1, 1, 1, 1, 1, 1, 1, 1), {}, ['ploy.firefight', 'firefight.action', 'firefight.activate'] as never)
    }
    void shootWindow
    // landed this activation, target within 6": offered at the attack re-roll window, costing 1 CP; at 7" it is not
    const marked = withDrops(above(s0, tr), [-3, 0])
    const land = take(activateOp(marked, tr), 'ability:ta.a.land').state
    const chosen = optionIds(land).find((i) => i.startsWith('engage@') && !i.endsWith('!adj'))!
    const [lx, , lz] = chosen.split('@')[1]!.split(',').map(Number) as [number, number, number]
    const shotFrom = (gapX: number) => {
      const staged = edit(land, (st) => {
        st.operatives[boy]!.pos = { x: lx + gapX, y: 0, z: lz }
        st.operatives[boy]!.order = 'engage'
      })
      return take(staged, chosen).state
    }
    const afterLand = shotFrom(5)
    let w = take(take(afterLand, 'shoot').state, 'ta.w.hot-shot-lascarbine').state
    w = take(w, boy, dice(1, 1, 1, 1)).state
    const window = play(w, dice(1, 1, 1, 1), {}, ['ploy.firefight', 'firefight.action'] as never)
    expect(hotDrop(window.state)).toBe(true)
    expect(window.state.pending!.options!.find((o) => o.id === 'ta.p.hot-drop')!.data).toMatchObject({ cost: 1 })
    const cp0 = afterLand.players.A.cp
    const used = take(window.state, 'ta.p.hot-drop', dice(6, 6, 6, 6))
    expect(used.state.players.A.cp).toBe(cp0 - 1)
    // farther than 6" (base to base): no offer
    let far = take(take(shotFrom(8), 'shoot').state, 'ta.w.hot-shot-lascarbine').state
    far = take(far, boy, dice(1, 1, 1, 1)).state
    expect(hotDrop(play(far, dice(1, 1, 1, 1), {}, ['ploy.firefight', 'firefight.action'] as never).state)).toBe(false)
    // standing wholly within the opponent territory needs no landing (the Boy 4" away, the Trooper at x 3)
    const inTerritory = edit(place(place(s0, tr, 3, 0), boy, 7, 0), (st) => void (st.operatives[boy]!.order = 'engage'))
    let tw = take(take(activateOp(inTerritory, tr), 'shoot').state, 'ta.w.hot-shot-lascarbine').state
    tw = take(tw, boy, dice(1, 1, 1, 1)).state
    expect(hotDrop(play(tw, dice(1, 1, 1, 1), {}, ['ploy.firefight', 'firefight.action'] as never).state)).toBe(true)
    // ... but at home with no landing or drop it is not
    const home = edit(place(place(s0, tr, -4, 0), boy, 0, 0), (st) => void (st.operatives[boy]!.order = 'engage'))
    let hw = take(take(activateOp(home, tr), 'shoot').state, 'ta.w.hot-shot-lascarbine').state
    hw = take(hw, boy, dice(1, 1, 1, 1)).state
    expect(hotDrop(play(hw, dice(1, 1, 1, 1), {}, ['ploy.firefight', 'firefight.action'] as never).state)).toBe(false)
    // a drop from a Vantage floor 3" up in this activation qualifies; a 1" drop does not
    const dropper = (height: number) => {
      const tower = feature('ta-hd', part('ta-hd.a', rect(-9, -6, -3, 3), height, ['vantage']))
      const st0 = edit(place(place(s0, tr, -6.8, 0, height), boy, -2, 0), (st) => {
        st.map = { ...st.map, features: [tower] }
        st.operatives[boy]!.order = 'engage'
      })
      let t = take(activateOp(st0, tr), 'reposition').state
      t = expectOk(step(t, { type: 'move.path', seat: 'A', decisionId: t.pending!.id, payload: { waypoints: [{ x: -5.2, z: 0, y: 0 }, { x: -4.5, z: 0 }] } })).state
      let sh = take(take(t, 'shoot').state, 'ta.w.hot-shot-lascarbine').state
      sh = take(sh, boy, dice(1, 1, 1, 1)).state
      return hotDrop(play(sh, dice(1, 1, 1, 1), {}, ['ploy.firefight', 'firefight.action'] as never).state)
    }
    expect(dropper(3)).toBe(true)
    expect(dropper(1)).toBe(false)
    // Adjust Coordinates: spots 4" to 5" from the marker are offered for 1 CP; a normal spot costs nothing
    const spots = take(activateOp(marked, tr), 'ability:ta.a.land').state
    const adj = optionIds(spots).filter((i) => i.endsWith('!adj'))
    expect(adj.length).toBeGreaterThan(0)
    for (const id of adj) {
      const [x, y, z] = id.split('@')[1]!.replace('!adj', '').split(',').map(Number) as [number, number, number]
      const gapM = gapToMarker(bodyOf({ ...marked.operatives[tr]!, pos: { x, y, z } }), dropMk(marked))
      expect(gapM).toBeGreaterThan(4)
      expect(gapM).toBeLessThanOrEqual(5.0001)
    }
    const cp1 = marked.players.A.cp
    const normal = take(spots, optionIds(spots).find((i) => i.startsWith('engage@') && !i.endsWith('!adj'))!).state
    expect(normal.players.A.cp).toBe(cp1)
    expect(optionIds(normal)).toContain('dash')
    const adjusted = take(spots, adj.find((i) => i.startsWith('engage@'))!).state
    expect(adjusted.players.A.cp).toBe(cp1 - 1)
    expect(usedThisTp(adjusted, 'A', 'ta.p.adjust-coordinates')).toBe(true)
    for (const a of ['dash', 'shoot', 'fight']) expect(optionIds(adjusted), a).not.toContain(a)
    expect(adjusted.effects.some((e) => e.kind === 'ta.adjusted')).toBe(true)
    // the Tempestor lands by Adjust Coordinates for free (Tempestus Veteran), once
    const tp = A(s0, 'tempestor')
    const lead = take(activateOp(withDrops(above(s0, tp), [-3, 0]), tp), 'ability:ta.a.land').state
    const leadAdj = optionIds(lead).find((i) => i.endsWith('!adj') && i.startsWith('engage@'))!
    expect(take(lead, leadAdj).state.players.A.cp).toBe(s0.players.A.cp)
  })

  it('TEAM-TA-031 TEAM-TA-032 Tempestus Exemplars (marker and mission actions 1 AP cheaper, never for the Servo-Sentry or APL 3) and Progena (2D3 wounds back, APL decreases ignored)', () => {
    const s = open()
    const tr = A(s, 'trooper')
    const tp = A(s, 'tempestor')
    const sv = A(s, 'servo-sentry')
    const obj = s.markers.find((m) => m.kind === 'objective')!
    // a marker the Trooper stands on and may pick up, and a mission action at the objective
    const cache: GameState['markers'][number] = { id: 'ta-cache', kind: 'equipment', pos: { x: 0, z: 0 }, owner: 'B', carriedBy: null, controller: null, equipmentId: 'ta.test-cache', pickable: true }
    const staged = edit(place(place(place(s, tr, obj.pos.x, obj.pos.z), tp, obj.pos.x + 1.4, obj.pos.z + 1.4), sv, obj.pos.x - 1.4, obj.pos.z + 1.4), (st) => {
      st.turningPoint = 2
      st.markers.push({ ...cache, pos: { x: obj.pos.x, z: obj.pos.z } })
    })
    const info = (who: string) => ({ window: 'firefight.activationStart', subjectId: who, counteracting: false })
    const offered = (state: GameState, who: string) => offersFor(state, 'A', 'firefight.activationStart', info(who)).some((o) => o.ployId === 'ta.p.tempestus-exemplars')
    expect(offered(staged, tr)).toBe(true)
    // not for the Servo-Sentry, the Tempestor (APL 3), a Trooper raised to APL 3, or an operative with no such action to take
    expect(offered(staged, sv)).toBe(false)
    expect(offered(staged, tp)).toBe(false)
    expect(offered(edit(staged, (st) => void (st.operatives[tr]!.aplMods = 1)), tr)).toBe(false)
    expect(offered(s, tr)).toBe(false)
    // but a Tempestor whose APL has been reduced to 2 qualifies
    const lead = place(place(staged, tr, 0, 8), tp, obj.pos.x + 0.3, obj.pos.z)
    expect(offered(edit(lead, (st) => void (st.operatives[tp]!.aplMods = -1)), tp)).toBe(true)
    expect(offered(lead, tp)).toBe(false)
    // the discount: Pick Up Marker and the mission action cost 0 AP, other actions are unchanged
    const costOf = (state: GameState, action: string) => abilityOffers(state, state.operatives[tr]!, state.firefight.activation).find((o) => o.action === action)?.cost
    const cheap = withCtx(staged, (ctx) => usePloy(ctx, 'A', offersFor(staged, 'A', 'firefight.activationStart', info(tr)).find((o) => o.ployId === 'ta.p.tempestus-exemplars')!, info(tr))).state
    expect(costOf(staged, 'marker:pickUp')).toBe(1)
    expect(costOf(cheap, 'marker:pickUp')).toBe(0)
    expect(costOf(cheap, 'ability:core.a.secure')).toBe(0)
    expect(costOf(staged, 'ability:core.a.secure')).toBe(1)
    // Progena: 2D3 lost wounds back (never above the starting wounds), printed APL for the activation despite Stun and COMMAND
    const hurt = edit(s, (st) => {
      st.operatives[tr]!.wounds = 2
      st.operatives[tr]!.aplMods = -1
      st.operatives[tr]!.aplFx = [{ delta: -1, source: 'stun' }]
    })
    const progena = (state: GameState, who: string) => offersFor(state, 'A', 'firefight.activationStart', info(who)).find((o) => o.ployId === 'ta.p.progena')
    expect(progena(hurt, sv)).toBeUndefined()
    // an operative above may be picked when it activates and has an APL change to ignore (it heals nothing there)
    expect(progena(above(s, tr), tr)).toBeUndefined()
    expect(progena(edit(above(s, tr), (st) => void (st.operatives[tr]!.aplMods = -1)), tr)).toBeDefined()
    const healed = withCtx(hurt, (ctx) => usePloy(ctx, 'A', progena(ctx.state, tr)!, info(tr)), dice(6, 6)).state
    expect(healed.operatives[tr]!.wounds).toBe(8)
    expect(effectiveApl(healed.operatives[tr]!)).toBe(2)
    const small = withCtx(hurt, (ctx) => usePloy(ctx, 'A', progena(ctx.state, tr)!, info(tr)), dice(1, 2)).state
    expect(small.operatives[tr]!.wounds).toBe(2 + 2)
    expect(effectiveApl(hurt.operatives[tr]!)).toBe(1)
    // the player keeps an increase (COMMAND): only the decreases are ignored (verifier fix)
    const boosted = edit(healed, (st) => {
      st.operatives[tr]!.aplMods = 0
      st.operatives[tr]!.aplFx = [{ delta: -1, source: 'stun' }, { delta: 1, source: 'ta.a.command' }]
    })
    expect(effectiveApl(boosted.operatives[tr]!)).toBe(3)
  })

  it('TEAM-TA-005 TEAM-TA-007 TEAM-TA-011 TEAM-TA-015 TEAM-TA-029 TEAM-TA-032 verifier fixes: Grenadier Hit stacks and never spends team picks, Gunfight counts a sequence once, set-aside batches list their answers, Hot Drop after a climb and drop, Progena keeps COMMAND, Dynamic never repeats a Dash', () => {
    const s = open({ equipmentA: ['core.e.explosive-grenades'] })
    const gr = A(s, 'grenadier')
    const boy = B(s, 'boy')
    const krak = 'core.w.krak-grenade'
    // TEAM-TA-005: the Grenadier's improvement applies on top of any other Hit change (no 3+ floor of its own)
    const mods = { kind: 'shoot', atk: 4, hitDelta: -1, assists: [] as string[] }
    runHook('modifyAttackDice', { seat: 'A', state: s, operativeId: gr, targetId: boy, weaponId: krak, data: mods })
    expect(mods.hitDelta).toBe(-2)
    // ... and a throw is counted on its own allowance, never on the team's krak picks
    const picked = edit(place(place(s, gr, 0, 0), boy, 4, 0), (st) => {
      st.equipment.picks.A = { ...(st.equipment.picks.A ?? {}), 'core.e.explosive-grenades': [krak] }
      st.operatives[boy]!.order = 'engage'
      if (!st.operatives[gr]!.weapons.includes(krak)) st.operatives[gr]!.weapons.push(krak)
    })
    const thrown = take(shootAt(picked, gr, krak, boy, dice(1, 1, 1, 1, 1, 1, 1, 1)).state, 'end').state
    expect(thrown.operatives[gr]!.usedLimited[krak]).toBe(1)
    expect(usesOf(thrown, 'A', 'limit:' + krak)).toBe(0)
    // TEAM-TA-007: the after-roll hooks may run twice for one sequence (a resumed choice); the fails count once
    const gf = A(s, 'gunfighter')
    const near = place(place(s, gf, 0, 0), boy, 5, 0)
    const twice = withCtx(near, (ctx) => {
      const roll = { kind: 'shoot', side: 'attack', targetId: gf, dice: [{ kind: 'fail' }, { kind: 'fail' }, { kind: 'normal' }], requests: [], choices: {}, obscured: false }
      for (let i = 0; i < 2; i++) runHook('afterAttackRoll', { seat: 'B', state: ctx.state, engine: ctx, operativeId: boy, targetId: gf, weaponId: 'kom.w.slugga', data: roll as never })
    }).state
    expect(twice.effects.find((e) => e.kind === 'ta.gunfight')!.data!.fails).toBe(2)
    // TEAM-TA-015: a batch going aside whole is a finite decision: every listed answer sets an operative aside
    const aside = setUp(['deploy', 'aside', 'aside'], (st) => st.pending?.kind === 'setup.deploy' && st.pending.seat === 'A' && st.pending.context.wholeBatchAside === true)
    const legal = legalActions(aside)!
    expect(legal.length).toBeGreaterThan(0)
    for (const a of legal) expect(validate(aside, a)).toBeNull()
    expect(legal.every((a) => (a.payload as { setAside?: boolean }).setAside === true)).toBe(true)
    // TEAM-TA-029: a Reposition that climbs onto a Vantage floor 2" up and drops off it qualifies for Hot Drop
    const tr = A(s, 'trooper')
    const pillar = feature('ta-pillar', part('ta-pillar.a', rect(-6, -4.8, -2, 2), 2, ['vantage']))
    const st0 = edit(place(place(s, tr, -6.6, 0), boy, -1, 0), (st) => {
      st.map = { ...st.map, features: [pillar] }
      st.operatives[boy]!.order = 'engage'
    })
    let t = take(activateOp(st0, tr), 'reposition').state
    const moved = step(t, { type: 'move.path', seat: 'A', decisionId: t.pending!.id, payload: { waypoints: [{ x: -5.4, z: 0, y: 2 }, { x: -4.2, z: 0, y: 0 }] } })
    expect(moved.rejection).toBeUndefined()
    t = moved.state
    expect(t.operatives[tr]!.pos.y).toBe(0)
    expect(t.effects.some((e) => e.kind === 'ta.droppedAct' && e.operativeId === tr)).toBe(true)
    // TEAM-TA-011: Dynamic lifts only the Charge bar: a Precursor that already Dashed this activation gets no second Dash
    const pr = A(s, 'precursor')
    const lane = edit(place(place(s, pr, 0, 0), boy, 6, 0), (st) => void (st.operatives[boy]!.order = 'engage'))
    let d = take(activateOp(lane, pr), 'dash').state
    d = play(d, dice(), goTo(1, 0), ['firefight.action'] as never).state
    d = take(take(take(d, 'shoot').state, 'ta.w.hot-shot-laspistol').state, boy, dice(1, 1, 1, 1)).state
    const after = play(d, dice(1, 1, 1, 1), {}, ['ability.choice', 'firefight.action', 'firefight.activate'] as never)
    expect(after.state.pending!.kind).not.toBe('ability.choice')
  })

  it('TEAM-TA-033 TEAM-TA-034 TEAM-TA-035 equipment: Tempestus Daggers for everyone but the Servo-Sentry, Combat Stimms keep the Move of the injured, Drop Augury moves a marker (once per battle, never toward the enemy)', () => {
    const e = open({ equipmentA: ['ta.e.tempestus-daggers', 'ta.e.combat-stimms'] })
    const weapons = (id: string) => e.operatives[id]!.weapons
    for (const op of Object.values(e.operatives).filter((o) => o.seat === 'A' && o.datacardId !== 'ta.servo-sentry')) expect(op.weapons, op.name).toContain('ta.w.tempestus-dagger')
    expect(weapons(A(e, 'servo-sentry'))).not.toContain('ta.w.tempestus-dagger')
    expect(weapons(A(e, 'precursor'))).toEqual(expect.arrayContaining(['ta.w.tempestus-dagger', 'ta.w.tempestus-dagger-precursor']))
    // Combat Stimms: an injured Trooper still moves 6" (4" without the equipment); its Hit is still one worse
    const tr = A(e, 'trooper')
    const boy = B(e, 'boy')
    const hurt = (state: GameState) => edit(state, (st) => void (st.operatives[tr]!.wounds = 3))
    expect(effectiveMove(hurt(e).operatives[tr]!, hurt(e))).toBe(6)
    const bare = open()
    expect(effectiveMove(hurt(bare).operatives[tr]!, hurt(bare))).toBe(4)
    expect(attackStats(hurt(e), tr, 'ta.w.hot-shot-lascarbine', boy, { kind: 'shoot' }).need).toBe(4)
    expect(attackStats(e, tr, 'ta.w.hot-shot-lascarbine', boy, { kind: 'shoot' }).need).toBe(3)
    // Drop Augury: offered once per battle as an operative above activates, before it lands
    const base = edit(withDrops(above(open({ equipmentA: ['ta.e.drop-augury'] }), A(e, 'trooper'), A(e, 'gunner')), [-3, 0]), (st) => void (st.operatives[A(e, 'gunner')]!.ready = true))
    const second = A(base, 'gunner')
    let t = take(take(base, tr).state, 'engage').state
    expect(t.pending!.kind).toBe('ploy.firefight')
    expect(t.pending!.options!.find((o) => o.id === 'ta.e.drop-augury')!.data).toMatchObject({ cost: 0 })
    t = take(t, 'ta.e.drop-augury').state
    const options = t.pending!.options!
    const marker = dropMk(base)
    const toFoe = (pt: { x: number; z: number }) => distToPolygon(pt, dropZoneOf(base, 'B')!.polygon)
    const home = toFoe(marker.pos)
    // nothing closer to the opponent's zone is on offer, and nothing farther than 4"
    for (const o of options.filter((x) => !x.id.endsWith('=stay'))) {
      const d = o.data as { x: number; z: number }
      expect(Math.hypot(d.x - marker.pos.x, d.z - marker.pos.z)).toBeLessThanOrEqual(4.0001)
      expect(toFoe({ x: d.x, z: d.z })).toBeGreaterThanOrEqual(home - 0.0001)
    }
    const west = options.find((o) => (o.data as { x: number }).x < -6.5 && Math.abs((o.data as { z: number }).z) < 1.5)
    expect(west).toBeDefined()
    t = take(t, west!.id).state
    expect(dropMk(t).pos.x).toBeLessThan(-6.5)
    // the window carries on to the activation: the landing uses the new marker position
    expect(t.pending!.kind).toBe('firefight.action')
    const landing = take(t, 'ability:ta.a.land').state
    const spotX = optionIds(landing).filter((i) => i.startsWith('engage@')).map((i) => Number(i.split('@')[1]!.split(',')[0]))
    expect(spotX.some((x) => x < -6.5 && x > -9)).toBe(true)
    // the use is spent: the next operative above is not offered it
    expect(usedThisBattle(t, 'A', 'ta.augury')).toBe(true)
    let u = take(take(landing, optionIds(landing).find((i) => i.startsWith('engage@'))!).state, 'end').state
    u = take(activateOp(u, B(base, 'boy')), 'end').state
    u = take(take(u, second).state, 'engage').state
    expect(u.pending!.kind).toBe('firefight.action')
  })

  it('TEAM-TA-011 Dynamic after a free Shoot in the Precursor activation (frame ownReactions, info freeAction) and after a Guard interrupt Shoot (info interrupt)', () => {
    const s = open()
    const pr = A(s, 'precursor')
    const boy = B(s, 'boy')
    const STOP = ['ability.choice', 'firefight.action', 'firefight.activate'] as never
    const shot = edit(place(place(s, pr, 0, 0), boy, 5, 0), (st) => {
      st.operatives[boy]!.order = 'engage'
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
    })
    // a free Shoot inside its own activation (a rule granting one): the frame's reaction point offers the Dash
    const free = withCtx(activateOp(shot, pr), (ctx) => void expect(startFreeAction(ctx, { operativeId: pr, action: 'shoot', resume: 'ta.test.free' })).toBe(true)).state
    let f = free
    while (f.pending?.kind === 'ploy.firefight') f = expectOk(step(f, act.pass(f.pending))).state
    f = take(take(f, 'ta.w.hot-shot-laspistol').state, boy, dice(1, 1, 1, 1)).state
    const r = play(f, dice(1, 1, 1, 1), {}, STOP)
    expect(r.state.pending).toMatchObject({ kind: 'ability.choice', seat: 'A' })
    expect(r.state.pending!.options![0]!.data!.name).toMatch(/Dynamic/)
    const dashing = take(r.state, 'react:0').state
    expect(dashing.pending).toMatchObject({ kind: 'move.path', seat: 'A' })
    // a Guard interrupt Shoot in the enemy's activation: the own reaction is offered too
    const theirs = bTurn(shot, A(s, 'tempestor'))
    const offers = providerOwnReactions(theirs, 'A', { actorId: pr, action: 'shoot', activeSeat: 'A', moved: false, interrupt: true })
    expect(offers).toMatchObject([{ hook: 'taDynamic', operativeId: pr, freeActions: true }])
    // never for another action
    expect(providerOwnReactions(theirs, 'A', { actorId: pr, action: 'dash', activeSeat: 'A', moved: true, interrupt: true })).toEqual([])
  })
})
