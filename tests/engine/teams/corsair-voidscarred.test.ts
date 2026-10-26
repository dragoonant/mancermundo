// corsair-voidscarred engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-CV-nnn).
// Corsair Voidscarred are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { createGame, step, type GameEvent } from '@/engine'
import { act } from '@/engine/actions'
import { actionForbidden } from '@/engine/abilities'
import { attackStats, effectiveRules, inflict, validTargets } from '@/engine/attack-common'
import { getCodeHook, hookFireCount, resetFireCounts } from '@/engine/code-hooks'
import { hasKeyword } from '@/engine/conditions'
import { usedThisBattle, usedThisTp } from '@/engine/effects'
import { runHook } from '@/engine/hooks'
import { planFly } from '@/engine/movement'
import { offersFor, usePloy } from '@/engine/ploys'
import { realSetup } from '@/engine/bundle'
import { markerControl } from '@/engine/query'
import { ScriptedRng } from '@/engine/rng'
import { shootableWeapons } from '@/engine/shoot'
import { afterActionStages, startFreeAction } from '@/engine/firefight'
import { registerFrameResume } from '@/engine/hooks'
import { effectiveApl } from '@/engine/state'
import { providerCanFly, providerCostDelta, providerFightStart, providerStealthy, registerTeamRules, unregisterTeamRules } from '@/engine/team-rules'
import { TEAM_ID, ERUDITE_TOKEN, FAOLCHU_TOKEN, OSA_TOKEN, SHIELD_TOKEN, slicingReach, slicingRoute } from '@/engine/teams/corsair-voidscarred'
import { addToken, hasToken, tokenCount, tokensOnActivationStart, tokensOnRemoval } from '@/engine/tokens'
import type { AttackState, GameState } from '@/engine/types'
import { playGame } from '../../../tools/sim-core'
import { CODE_HOOKS, enumerateLoadouts, loadBundle, loadoutCapProblems, resolveLoadout, validateRoster, type DatacardData } from '../../../src/data'
import { arm, play, ranged, withWeapons } from '../../fixtures/attack'
import { expectOk, place } from '../../fixtures/helpers'
import { activateOp, edit, optionIds, passIt, pick, realBundle, take, withCtx } from '../../fixtures/real'
import { A, B, PSYKERS, playOut, STOP_PLOY, bTurn, boyMoves, cvRoster, dice, engaged, gambitAt, moveTo, open, optionStartingWith, reraise, scenarios, takePloy, usePlayed, withWeapon } from './corsair-voidscarred.hooks'

const data = loadBundle()
const MAINS = ['cv.fate-dealer', 'cv.gunner', 'cv.heavy-gunner', 'cv.kurnathi', 'cv.kurnite-hunter', 'cv.shade-runner', 'cv.soul-weaver', 'cv.way-seeker']
/** Pass the ploy windows an action opens (the activation goes on at its next action decision). */
const settle = (st: GameState): GameState => {
  let s2 = st
  while (s2.pending?.kind === 'ploy.firefight') s2 = passIt(s2).state
  return s2
}
/** The turning point start hook run over a copy of the state (tokens for unspent rules). */
const withTpStart = (st: GameState): GameState => withCtx(st, (ctx) => runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })).state
/** Play on until a fight die is to be resolved (re-roll windows are answered with the engine defaults). */
const toResolve = (st: GameState): GameState => play(st, undefined, { 'ploy.firefight': (p) => act.pass(p) }, ['fight.resolve', 'firefight.action']).state
/** The weapons of an operative that have the target as a valid target now. */
const shootableIds = (st: GameState, op: string, target: string): string[] => shootableWeapons(st, st.operatives[op]!, []).filter((w) => w.targets.some((t) => t.id === target)).map((w) => w.weaponId)
/** B is to activate: A's Kurnathi has acted and ended. */
const bTurnReady = (st: GameState): GameState => bTurn(st, A(st, 'kurnathi'))
/** Play on, passing ploy windows, until a Guard interrupt is offered (or the next action). */
const toGuardInterrupt = (st: GameState): GameState => play(st, dice(), { 'ploy.firefight': (p) => act.pass(p) }, ['guard.interrupt', 'firefight.action', 'firefight.activate']).state
const costOf = (s: GameState, id: string): number => Number(s.pending!.options!.find((o) => o.id === id)!.data!.cost)

/** A free-standing timed effect, for tests that need a ploy "in force" without playing the gambit step. */
const fx = (source: string, extra: Record<string, unknown> = {}) => ({ id: `e-${source}-${Object.keys(extra).length}`, seat: 'A' as const, kind: 'ployFlag', expires: 'turningPoint', source, ...extra })
function withFx(s: GameState, ...list: { source: string; operativeId?: string; expires?: string; data?: Record<string, unknown> }[]): GameState {
  return edit(s, (st) => {
    list.forEach((e, i) => st.effects.push(fx(e.source, { id: `e9${i}${e.source}`, ...(e.operativeId ? { operativeId: e.operativeId } : {}), ...(e.expires ? { expires: e.expires } : {}), ...(e.data ? { data: e.data } : {}) }) as never))
  })
}

describe('TEAM-CV Corsair Voidscarred', () => {
  it('TEAM-CV-000 TEAM-CV-001 TEAM-CV-002 TEAM-CV-003 playable team, roster rules, the blaster / wraithcannon cap, printed loadouts and keywords', () => {
    expect(TEAM_ID).toBe('corsair-voidscarred')
    const team = data.teams['corsair-voidscarred']!
    expect(team.playable).toBe(true)
    const cards = realBundle.datacards
    const ok = { leader: ['cv.felarch'], main: MAINS }
    expect(validateRoster(team, ok, cards as never).ok).toBe(true)
    expect(validateRoster(team, { ...ok, main: Array(8).fill('cv.warrior') }, cards as never).ok).toBe(true)
    expect(validateRoster(team, { ...ok, main: [...MAINS.slice(0, 7), 'cv.fate-dealer'] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: [...MAINS, 'cv.warrior'] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { leader: [], main: MAINS }, cards as never).ok).toBe(false)
    // the cap: one blaster or wraithcannon in the whole roster
    const card = (id: string) => data.byId[id] as DatacardData
    const carry = (id: string, set: string) => resolveLoadout(card(id), { loadout: [set] }, data.weaponGroups)
    const blaster = carry('cv.gunner', 'blaster')
    const wraith = carry('cv.heavy-gunner', 'wraithcannon')
    const cannon = carry('cv.heavy-gunner', 'shuriken-cannon')
    expect(loadoutCapProblems(team, [blaster, wraith], data.weaponGroups)).toHaveLength(1)
    expect(loadoutCapProblems(team, [blaster, cannon], data.weaponGroups)).toEqual([])
    expect(loadoutCapProblems(team, [carry('cv.gunner', 'shredder'), wraith], data.weaponGroups)).toEqual([])
    // the default roster keeps the cap and brings every printed weapon the datacards list
    const roster = realBundle.teamData!['corsair-voidscarred']!.defaults!.roster!
    expect(roster).toHaveLength(9)
    const carried = roster.map((id) => realBundle.datacards[id]!.legalLoadouts![0]!)
    expect(loadoutCapProblems(team, carried, data.weaponGroups)).toEqual([])
    // printed loadouts
    const count = (id: string) => enumerateLoadouts(card(id)).length
    expect([count('cv.felarch'), count('cv.gunner'), count('cv.heavy-gunner'), count('cv.warrior')]).toEqual([2, 2, 2, 2])
    expect(MAINS.filter((id) => !['cv.gunner', 'cv.heavy-gunner'].includes(id)).map(count)).toEqual([1, 1, 1, 1, 1, 1])
    expect(resolveLoadout(card('cv.felarch'), { loadout: ['neuro-disruptor-power-weapon'] }, data.weaponGroups)).toEqual(['cv.w.neuro-disruptor', 'cv.w.power-weapon'])
    expect(resolveLoadout(card('cv.warrior'), { loadout: ['shuriken-rifle-fists'] }, data.weaponGroups)).toEqual(['cv.w.shuriken-rifle', 'cv.w.fists'])
    expect(cannon).toEqual(expect.arrayContaining(['cv.w.shuriken-cannon-focused', 'cv.w.shuriken-cannon-sweeping']))
    expect(resolveLoadout(card('cv.fate-dealer'), {}, data.weaponGroups)).toEqual(expect.arrayContaining(['cv.w.ranger-long-rifle-mobile', 'cv.w.ranger-long-rifle-stationary']))
    // keywords and stats
    const kw = (id: string) => card(id).keywords
    expect(kw('cv.felarch')).toEqual(expect.arrayContaining(['LEADER', 'FELARCH', 'ANHRATHE', 'AELDARI', 'CORSAIR VOIDSCARRED']))
    expect(kw('cv.soul-weaver')).toEqual(expect.arrayContaining(['PSYKER', 'MEDIC']))
    expect(kw('cv.way-seeker')).toContain('PSYKER')
    expect(kw('cv.way-seeker')).not.toContain('MEDIC')
    expect(card('cv.felarch').stats.wounds).toBe(9)
    expect(MAINS.every((id) => card(id).stats.wounds === 8 && card(id).stats.move === 7 && card(id).stats.apl === 2 && card(id).base === 28)).toBe(true)
    const s = open()
    expect(hasKeyword(s, s.operatives[A(s, 'felarch')]!, 'CORSAIR VOIDSCARRED')).toBe(true)
  })

  it('TEAM-CV-004 TEAM-CV-005 TEAM-CV-006 Aeldari Raiders and Veteran Raider: the first Dash is free, never in a counteraction; the Felarch\'s first 1 AP action is free', () => {
    const s = open()
    const k = A(s, 'kurnathi')
    // a non-Felarch: reposition (1) and guard (1) use both AP, and the Dash is still on offer at 0 AP
    let t = activateOp(s, k)
    expect(costOf(t, 'dash')).toBe(0)
    expect(costOf(t, 'reposition')).toBe(1)
    t = take(settle(moveTo(take(t, 'reposition').state, -12, -10)), 'guard').state
    t = settle(t)
    expect(t.firefight.activation!.apSpent).toBe(2)
    expect(optionIds(t)).toContain('dash')
    expect(costOf(t, 'dash')).toBe(0)
    // after the free Dash a second is barred, and so is a Charge
    t = settle(moveTo(take(t, 'dash').state, -10.5, -10))
    expect(t.operatives[k]!.pos.x).toBeCloseTo(-10.5)
    // nothing is left to do, so the activation ends by itself; a second Dash or a Charge would not have been offered
    expect(t.firefight.activation?.apSpent ?? 2).toBe(2)
    expect(optionIds(t)).not.toContain('dash')
    expect(optionIds(t)).not.toContain('charge')
    // a Charge first bars the Dash, and the free Dash does not exist in a counteraction or a free frame
    const op = t.operatives[k]!
    const counter = edit(s, (st) => {
      st.firefight.activation = { operativeId: k, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }
    })
    expect(providerCostDelta(counter, op, 'dash')).toBe(0)
    const frame = edit(s, (st) => {
      st.firefight.activation = { operativeId: k, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null, frame: { kind: 'free', resume: 'x', data: {} } }
    })
    expect(providerCostDelta(frame, op, 'dash')).toBe(0)
    expect(providerCostDelta(s, op, 'dash')).toBe(0) // no activation: outside its own activation nothing is discounted
    const own = edit(s, (st) => {
      st.firefight.activation = { operativeId: k, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null }
    })
    expect(providerCostDelta(own, op, 'dash')).toBe(-1)
    const charged = edit(own, (st) => {
      st.firefight.activation!.performed = ['charge']
    })
    expect(providerCostDelta(charged, op, 'dash')).toBe(-1)
    expect(actionForbidden(charged, op, 'dash')).toBeNull() // the Charge-then-Dash ban is the core Dash check, not a team rule

    // the Felarch: any 1 AP action once, never an extra free Dash
    const f = A(s, 'felarch')
    const boy = B(s, 'boy')
    let u = activateOp(s, f)
    expect(costOf(u, 'guard')).toBe(0)
    expect(costOf(u, 'dash')).toBe(0)
    u = settle(moveTo(take(u, 'reposition').state, -12, -10))
    expect(u.firefight.activation!.apSpent).toBe(0)
    expect(costOf(u, 'guard')).toBe(1)
    expect(costOf(u, 'dash')).toBe(1)
    const beside = activateOp(place(place(s, f, 0, 0), boy, 1.4, 0), f)
    expect(costOf(beside, 'fight')).toBe(0)
    expect(costOf(beside, 'fallBack')).toBe(2)
    // Capricious Flight makes the Fall Back a 1 AP action, so Veteran Raider makes it free
    const flight = withFx(place(place(s, f, 0, 0), boy, 1.4, 0), { source: 'cv.p.capricious-flight', operativeId: f, expires: 'activation' })
    expect(costOf(activateOp(flight, f), 'fallBack')).toBe(0)
  })

  it('TEAM-CV-007 Rifles: Accurate 1 on a shuriken rifle or either ranger long rifle unless the operative Charged, Fell Back or Repositioned; Dash keeps it', () => {
    const s = open({ rosterA: cvRoster(['cv.felarch', 'cv.fate-dealer']).concat([withWeapon('cv.warrior', 'cv.w.shuriken-rifle')]) })
    const fd = A(s, 'fate-dealer')
    const boy = B(s, 'boy')
    const rules = (st: GameState, op: string, w: string) => effectiveRules(st, st.operatives[op]!, st.data.weapons[w]!, 'shoot', boy).map((r) => `${r.rule}${r.x ?? ''}`)
    const accurate = (st: GameState, op: string, w: string) => rules(st, op, w).some((r) => r.endsWith('accurate1'))
    const did = (performed: string[], op: string, counteract = false) =>
      edit(s, (st) => {
        st.firefight.activation = { operativeId: op, seat: 'A', counteract, stage: 'action', apSpent: 0, performed, declared: null }
      })
    expect(accurate(s, fd, 'cv.w.ranger-long-rifle-mobile')).toBe(true)
    expect(accurate(s, fd, 'cv.w.ranger-long-rifle-stationary')).toBe(true)
    expect(accurate(s, fd, 'cv.w.shuriken-pistol')).toBe(false)
    expect(accurate(s, A(s, 'warrior'), 'cv.w.shuriken-rifle')).toBe(true)
    for (const moved of ['reposition', 'charge', 'fallBack']) expect(accurate(did([moved], fd), fd, 'cv.w.ranger-long-rifle-mobile'), moved).toBe(false)
    expect(accurate(did(['dash'], fd), fd, 'cv.w.ranger-long-rifle-mobile')).toBe(true)
    expect(accurate(did(['shoot'], fd), fd, 'cv.w.ranger-long-rifle-mobile')).toBe(true)
    // a counteraction or an interrupt made by the operative has performed none of the three
    expect(accurate(did([], fd, true), fd, 'cv.w.ranger-long-rifle-mobile')).toBe(true)
    // another operative's earlier moves do not count
    expect(accurate(did(['reposition'], A(s, 'felarch')), fd, 'cv.w.ranger-long-rifle-mobile')).toBe(true)
    // the stationary profile is plain Heavy and Devastating 3, Silent
    expect(rules(s, fd, 'cv.w.ranger-long-rifle-stationary')).toEqual(expect.arrayContaining(['heavy', 'devastating3', 'silent']))
  })

  it('TEAM-CV-008 One Step Ahead: a D6 above the enemy APL gives a free Shoot at that enemy only, then APL -1; the roll spends the battle use even when it fails', () => {
    const s = open()
    const f = A(s, 'felarch')
    const boy = B(s, 'boy')
    const nob = B(s, 'boss-nob')
    const ready = edit(place(place(place(s, f, 0, 0), boy, 9, 3), nob, 7, -2), (st) => {
      st.operatives[f]!.order = 'engage'
    })
    // not offered while the Felarch holds a Conceal order (a Conceal operative cannot Shoot)
    const conceal = edit(ready, (st) => {
      st.operatives[f]!.order = 'conceal'
    })
    expect(boyMoves(conceal, A(s, 'warrior'), { x: 6, z: 2 }).pending!.kind).toBe('firefight.action')
    const t = boyMoves(ready, A(s, 'warrior'), { x: 6, z: 2 })
    expect(t.pending).toMatchObject({ kind: 'ability.choice', seat: 'A' })
    expect(t.pending!.options!.map((o) => o.data?.name)).toEqual(['One Step Ahead: Voidscarred Felarch shoots Boy'])
    expect(tokenCount(t, f, OSA_TOKEN, 'A')).toBe(1)
    // a 2 does not beat the Boy's APL 2: the use is gone, nothing else happens
    const failed = take(t, 'react:0', dice(2)).state
    expect(failed.pending!.kind).toBe('firefight.action')
    expect(usedThisBattle(failed, 'A', 'cv.osa')).toBe(true)
    expect(effectiveApl(failed.operatives[f]!)).toBe(2)
    expect(tokenCount(failed, f, OSA_TOKEN, 'A')).toBe(0)
    // a 3 beats it: the free Shoot may only pick the Boy (the Boss Nob is in range too), then APL -1
    const won = take(t, 'react:0', dice(3)).state
    expect(won.pending!.kind).toBe('shoot.weapon')
    expect(won.firefight.activation!.frame!.resume).toBe('cv.oneStepAhead')
    const picked = take(won, optionStartingWith(won, 'cv.w.shuriken')).state
    expect(picked.pending!.kind).toBe('shoot.target')
    expect(optionIds(picked)).toEqual([boy])
    const done = playOut(take(picked, boy, dice(1, 1, 1, 1, 1, 1, 1, 1)).state)
    expect(done.pending!.kind).toBe('firefight.action')
    expect(effectiveApl(done.operatives[f]!)).toBe(1)
    expect(done.operatives[f]!.aplFx).toEqual([{ delta: -1, source: 'cv.a.one-step-ahead' }])
    // once per battle: the Boy's next move offers nothing
    const again = edit(done, (st) => {
      st.firefight.activation = null
    })
    expect(usedThisBattle(again, 'A', 'cv.osa')).toBe(true)
  })
  it("TEAM-CV-009 TEAM-CV-011 TEAM-CV-012 Camo Cloak, Bladed Stance and Faolchú's Bond", () => {
    const s = open()
    const fd = A(s, 'fate-dealer')
    const boy = B(s, 'boy')
    // Camo Cloak: one more cover save, none on top of the Vantage improved cover; the shooter loses Saturate
    expect(providerStealthy(s, s.operatives[fd]!)).toBe(1)
    expect(providerStealthy(s, s.operatives[A(s, 'warrior')]!)).toBe(0)
    const improved = edit(s, (st) => {
      st.attack = { kind: 'shoot', operativeId: boy, seq: { targetId: fd, improvedCover: true } } as unknown as AttackState
    })
    expect(providerStealthy(improved, improved.operatives[fd]!)).toBe(0)
    const sat = withWeapons(s, ranged('t.sat', {}, [{ rule: 'saturate' }, { rule: 'rending' }]))
    const satRules = (target: string) => effectiveRules(sat, sat.operatives[boy]!, sat.data.weapons['t.sat']!, 'shoot', target).map((r) => r.rule)
    expect(satRules(fd)).toEqual(['rending'])
    expect(satRules(A(s, 'warrior'))).toEqual(['saturate', 'rending'])

    // Bladed Stance: an owed block-only resolution for the Kurnathi, fighting or retaliating
    const kur = A(s, 'kurnathi')
    const fightOf = (attacker: string, defender: string) => ({ kind: 'fight', operativeId: attacker, fight: { targetId: defender } }) as unknown as AttackState
    expect(providerFightStart(s, fightOf(kur, boy))).toEqual({ queue: [{ seat: 'A', blockOnly: true }], noBlock: [] })
    expect(providerFightStart(s, fightOf(boy, kur))).toEqual({ queue: [{ seat: 'A', blockOnly: true }], noBlock: [] })
    expect(providerFightStart(s, fightOf(boy, A(s, 'warrior')))).toEqual({ queue: [], noBlock: [] })
    // in a real fight the Kurnathi's player is offered a block before the usual order
    const f1 = toResolve(take(take(activateOp(engaged(s, kur, boy), kur), 'fight').state, boy, dice(6, 6, 6, 6, 5, 5, 5, 5)).state)
    expect(f1.pending).toMatchObject({ kind: 'fight.resolve', seat: 'A' })
    expect(optionIds(f1).every((id) => id.startsWith('block'))).toBe(true)

    // Faolchú's Bond: the first retaliation of a TP while ready resolves first; spent for the TP by any retaliation
    const kh = A(s, 'kurnite-hunter')
    const bond = (st: GameState) => providerFightStart(st, fightOf(boy, kh))
    expect(bond(s)).toEqual({ first: 'A', queue: [], noBlock: [] })
    expect(tokenCount(withTpStart(s), kh, FAOLCHU_TOKEN, 'A')).toBe(1)
    // not when the Hunter is the attacker, nor when it is expended
    expect(providerFightStart(s, fightOf(kh, boy))).toEqual({ queue: [], noBlock: [] })
    expect(bond(edit(s, (st) => (st.operatives[kh]!.ready = false)))).toEqual({ queue: [], noBlock: [] })
    // a real fight: the Hunter's side resolves the first die; after it, the rule is spent for the turning point
    const duel = engaged(s, kh, boy)
    const fought = bTurn(duel, A(s, 'warrior'))
    const attacked = toResolve(take(take(activateOp(fought, boy), 'fight').state, kh, dice(6, 6, 1, 1, 6, 6, 1, 1)).state)
    expect(attacked.pending).toMatchObject({ kind: 'fight.resolve', seat: 'A' })
    const after = playOut(attacked, dice(6, 5, 1, 1, 1))
    expect(usedThisTp(after, 'A', 'cv.faolchu')).toBe(true)
    expect(tokenCount(after, kh, FAOLCHU_TOKEN, 'A')).toBe(0)
    expect(bond(after)).toEqual({ queue: [], noBlock: [] })
    // the spent flag is cleared with the turning point's ledger
    expect(bond(edit(after, (st) => (st.ledger.A.tp = [])))).toEqual({ first: 'A', queue: [], noBlock: [] })
  })

  it('TEAM-CV-010 Blademaster: a Dash after a Charge with the Charge\'s unused distance (3" at most), free under Aeldari Raiders, never in an enemy control range', () => {
    const s = open()
    const k = A(s, 'kurnathi')
    const boy = B(s, 'boy')
    const fresh = activateOp(s, k)
    expect(optionIds(fresh).some((id) => id.startsWith('ability:cv.a.blademaster'))).toBe(false)
    // Charged 4.7": 9" - 4.7" leaves 4.3", so the Dash is capped at 3"
    const charged = moveTo(take(activateOp(place(place(s, k, 0, 0), boy, 6, 0), k), 'charge').state, 4.7, 0)
    const beside = settle(charged)
    expect(optionIds(beside).some((id) => id.startsWith('ability:cv.a.blademaster'))).toBe(false) // still in the Boy's control range
    const gone = reraise(
      edit(beside, (st) => {
        st.operatives[boy]!.status = 'removed'
        st.operatives[boy]!.wounds = 0
      }),
    )
    expect(costOf(gone, 'ability:cv.a.blademaster')).toBe(0)
    const dash = take(gone, 'ability:cv.a.blademaster').state
    expect(dash.pending!.kind).toBe('move.path')
    expect(dash.pending!.constraints!.maxInches).toBe(3)
    expect(step(dash, act.path(dash.pending!, [{ x: 8.5, z: 0 }])).rejection).toBeDefined()
    const done = settle(moveTo(dash, 7.6, 0))
    expect(done.operatives[k]!.pos.x).toBeCloseTo(7.6)
    expect(done.firefight.activation?.performed ?? ['dash']).toContain('dash')
    // charged 8": only 1" is left
    const far = edit(gone, (st) => {
      st.operatives[k]!.movedThisActivation = 8
    })
    expect(take(far, 'ability:cv.a.blademaster').state.pending!.constraints!.maxInches).toBe(1)
    // charged the whole 9": nothing is left, so no Dash is offered
    const spent = edit(gone, (st) => {
      st.operatives[k]!.movedThisActivation = 9
    })
    expect(optionIds(reraise(spent)).some((id) => id.startsWith('ability:cv.a.blademaster'))).toBe(false)
  })

  it('TEAM-CV-008 TEAM-CV-013 One Step Ahead and Erudite Hunter also follow an enemy free action taken inside its own activation (offers marked freeActions)', () => {
    registerFrameResume('test.cv.freeDash', (ctx) => afterActionStages(ctx, 'continue'))
    const s = open()
    const f = A(s, 'felarch')
    const kh = A(s, 'kurnite-hunter')
    const boy = B(s, 'boy')
    const base = edit(place(place(place(s, f, 0, 0), kh, 0, 4), boy, 8.5, 3), (st) => {
      st.operatives[f]!.order = 'engage'
    })
    const marked = usePlayed(base, 'cv.p.erudite-hunter', { window: 'strategy.gambit' }, boy)
    const bAct = activateOp(bTurn(marked, A(s, 'warrior')), boy)
    expect(bAct.pending).toMatchObject({ kind: 'firefight.action', seat: 'B' })
    // the Boy takes a free Dash inside its own activation (as a ploy or rule of its team would)
    const dashing = withCtx(bAct, (ctx) => {
      expect(startFreeAction(ctx, { operativeId: boy, action: 'dash', resume: 'test.cv.freeDash' })).toBe(true)
    }).state
    expect(dashing.pending!.kind).toBe('move.path')
    const t = moveTo(dashing, 6.5, 3)
    expect(t.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { hook: 'reaction', actorId: boy } })
    const hooks = t.pending!.options!.map((o) => o.data?.hook)
    expect(hooks).toContain('oneStepAhead')
    expect(hooks).toContain('eruditeHunter')
    // declining hands the Boy's activation back
    expect(passIt(t).state.pending).toMatchObject({ kind: 'firefight.action', seat: 'B' })
  })

  it('TEAM-CV-013 Erudite Hunter: the gambit marks an enemy within 9"; after it moves the Kurnite Hunter takes a free Charge (even from Conceal) or a Reposition that ends no farther away, once a turning point', () => {
    const s = open()
    const kh = A(s, 'kurnite-hunter')
    const boy = B(s, 'boy')
    const nob = B(s, 'boss-nob')
    const base = place(place(place(s, kh, 0, 0), boy, 8.5, 0), nob, 10.5, 0)
    const picks = offersFor(base, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).filter((o) => o.ployId === 'cv.p.erudite-hunter')
    expect(picks.map((o) => o.param)).toEqual([boy])
    expect(picks[0]!.cost).toBe(0)
    const marked = usePlayed(base, 'cv.p.erudite-hunter', { window: 'strategy.gambit' }, boy)
    expect(hasToken(marked, boy, ERUDITE_TOKEN, 'A')).toBe(true)
    expect(hasToken(marked, nob, ERUDITE_TOKEN, 'A')).toBe(false)
    // a marked enemy that moves offers a Charge (the Hunter holds Conceal, so it switches) and a Reposition
    const t = boyMoves(marked, A(s, 'warrior'), { x: 6, z: 0 })
    expect(t.pending).toMatchObject({ kind: 'ability.choice', seat: 'A' })
    expect(t.pending!.options!.map((o) => o.data?.name)).toEqual([
      'Erudite Hunter: Voidscarred Kurnite Hunter switches to Engage and charges Boy',
      'Erudite Hunter: Voidscarred Kurnite Hunter repositions towards Boy',
    ])
    // the Charge: Engage order, ends in the Boy's control range
    const charge = take(t, 'react:0').state
    expect(charge.operatives[kh]!.order).toBe('engage')
    expect(charge.pending!.kind).toBe('move.path')
    const hit = settle(moveTo(charge, 4.8, 0))
    expect(Math.abs(hit.operatives[kh]!.pos.x - hit.operatives[boy]!.pos.x)).toBeLessThan(1.8)
    expect(usedThisTp(hit, 'A', 'cv.erudite.react')).toBe(true)
    expect(hasToken(hit, boy, ERUDITE_TOKEN, 'A')).toBe(false)
    // the Reposition may not end farther from the Boy than it started (a path away is refused)
    const repo = take(t, 'react:1').state
    // a path away is refused with Erudite Hunter's own reason (moveProblem), not as an over-long move
    expect(step(repo, act.path(repo.pending!, [{ x: -4, z: 0 }])).rejection).toMatchObject({ code: 'E_ACTION_RESTRICTED', reason: expect.stringContaining('Erudite Hunter') })
    const closer = moveTo(repo, 3, 0)
    expect(closer.operatives[kh]!.pos.x).toBeCloseTo(3)
    expect(usedThisTp(closer, 'A', 'cv.erudite.react')).toBe(true)
  })

  it('TEAM-CV-014 TEAM-CV-015 Blink Pack and Slicing Attack: a 7" warp jump over what blocks a walk, never into an enemy control range; D3+2 to an enemy the route passes, if it was visible at the start', () => {
    const s = open()
    const sr = A(s, 'shade-runner')
    const boy = B(s, 'boy')
    const nob = B(s, 'boss-nob')
    const grot = B(s, 'grot')
    const wall = { id: 'wall', parts: [{ id: 'wall.0', footprint: [{ x: 1.4, z: -0.5 }, { x: 1.8, z: -0.5 }, { x: 1.8, z: 1 }, { x: 1.4, z: 1 }], height: 4, traits: ['heavy', 'blocking'] }] }
    // the Boy stands behind a wall (not visible when the jump begins), the Nob beside the route, the Grot far from it
    const base = edit(place(place(place(place(s, sr, 0, 0), boy, 3, 0.2), nob, 3, -1.5), grot, 6, 6), (st) => {
      st.map = { ...st.map, features: [wall as never] }
    })
    const t = take(activateOp(base, sr), 'reposition').state
    expect(providerCanFly(base, base.operatives[sr]!, 'dash')).toBe(false)
    expect(providerCanFly(base, base.operatives[sr]!, 'reposition')).toBe(true)
    // 7.5" is too far, a spot in an enemy control range is refused, 7" lands
    expect(step(t, act.fly(t.pending!, { x: 7.5, z: 0 })).rejection).toMatchObject({ code: 'E_OUT_OF_RANGE' })
    expect(step(t, act.fly(t.pending!, { x: 4.2, z: -1.5 })).rejection).toMatchObject({ code: 'E_CONTROL_RANGE' })
    const jumped = moveTo(t, 6, 0, true)
    expect(jumped.operatives[sr]!.pos.x).toBeCloseTo(6)
    // Slicing Attack: the Nob is on the route; the hidden Boy and the far Grot are not offered
    expect(jumped.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.actionEnded' })
    const slicing = optionIds(jumped).filter((id) => id.startsWith('cv.a.slicing-attack:'))
    expect(slicing).toEqual([`cv.a.slicing-attack:${nob}`])
    const cut = take(jumped, slicing[0]!, dice(6)).state
    expect(cut.operatives[nob]!.wounds).toBe(14 - 5)
    expect(optionIds(cut).some((id) => id.startsWith('cv.a.slicing-attack:'))).toBe(false)
    // a walking Reposition earns no Slicing Attack
    const walked = settle(moveTo(take(activateOp(base, sr), 'reposition').state, -3, 4))
    expect(optionIds(walked).some((id) => id.startsWith('cv.a.slicing-attack:'))).toBe(false)
    // a counteraction warp jump is capped at 2"
    const counter = edit(base, (st) => {
      st.firefight.activation = { operativeId: sr, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }
    })
    expect(planFly(counter, counter.operatives[sr]!, 'reposition', [{ x: 3.5, z: 4 }], true).ok).toBe(false)
    expect(planFly(counter, counter.operatives[sr]!, 'reposition', [{ x: 1, z: 1.5 }], true).ok).toBe(true)
    // a warp-jump Charge ends in an enemy control range (and may start anywhere within 7")
    const open2 = edit(base, (st) => (st.map = { ...st.map, features: [] }))
    const chargeT = take(activateOp(open2, sr), 'charge').state
    const charged = settle(moveTo(chargeT, 4.4, 0.2, true))
    expect(charged.operatives[sr]!.pos.x).toBeCloseTo(4.4)
  })
  it('TEAM-CV-016 TEAM-CV-024 Soul Channel and Soul Heal pick visible Corsairs within 6" (Soul Heal may pick the Soul Weaver, Soul Channel not); not in an enemy control range; Runes of Guidance reaches 9" once a turning point, spent only by a far pick', () => {
    const runes = ['cv.e.runes-of-guidance']
    const s = open({ rosterA: cvRoster(PSYKERS), equipmentA: runes })
    const sw = A(s, 'soul-weaver')
    const fel = A(s, 'felarch')
    const war = A(s, 'warrior')
    const boy = B(s, 'boy')
    const base = place(place(place(s, sw, 0, 0), fel, 1.5, -2.5), war, 8, 1)
    const plain = place(place(place(open({ rosterA: cvRoster(PSYKERS) }), sw, 0, 0), fel, 1.5, -2.5), war, 8, 1)
    const picks = (st: GameState, kind: string) => optionIds(activateOp(st, sw)).filter((id) => id.startsWith(`ability:cv.a.soul-${kind}:`))
    // Channel never picks its own Soul Weaver; Heal does. 8" (edge to edge 6.9") is beyond 6 unless Runes of Guidance is taken
    expect(picks(plain, 'channel')).toContain(`ability:cv.a.soul-channel:${fel}`)
    expect(picks(plain, 'channel')).not.toContain(`ability:cv.a.soul-channel:${sw}`)
    expect(picks(plain, 'channel')).not.toContain(`ability:cv.a.soul-channel:${war}`)
    expect(picks(plain, 'heal')).toContain(`ability:cv.a.soul-heal:${sw}`)
    expect(picks(base, 'channel')).toContain(`ability:cv.a.soul-channel:${war}`)
    // Soul Channel: +1 APL until the end of the target's next activation; a near pick leaves the Runes unspent
    const near = settle(take(activateOp(base, sw), `ability:cv.a.soul-channel:${fel}`).state)
    expect(effectiveApl(near.operatives[fel]!)).toBe(3)
    expect(near.operatives[fel]!.aplFx).toEqual([{ delta: 1, source: 'cv.a.soul-channel' }])
    expect(usedThisTp(near, 'A', 'cv.runes')).toBe(false)
    expect(tokenCount(near, sw, 'cv.runes', 'A')).toBe(1)
    // a far pick spends the Runes for the turning point: a second far pick is no longer offered
    const far = settle(take(activateOp(base, sw), `ability:cv.a.soul-channel:${war}`).state)
    expect(far.operatives[war]!.aplMods).toBe(1)
    expect(usedThisTp(far, 'A', 'cv.runes')).toBe(true)
    expect(tokenCount(far, sw, 'cv.runes', 'A')).toBe(0)
    expect(picks(edit(base, (st) => st.ledger.A.tp.push('cv.runes')), 'heal')).not.toContain(`ability:cv.a.soul-heal:${war}`)
    expect(picks(base, 'heal')).toContain(`ability:cv.a.soul-heal:${war}`)
    // Soul Heal: 2D3 (a 6 and a 6 are 3 and 3), never above the starting wounds; the Soul Weaver may heal itself
    const hurt = edit(base, (st) => {
      st.operatives[fel]!.wounds = 5
      st.operatives[sw]!.wounds = 7
    })
    const healed = settle(take(activateOp(hurt, sw), `ability:cv.a.soul-heal:${fel}`, dice(6, 6)).state)
    expect(healed.operatives[fel]!.wounds).toBe(9)
    expect(settle(take(activateOp(hurt, sw), `ability:cv.a.soul-heal:${sw}`, dice(2, 2)).state).operatives[sw]!.wounds).toBe(8)
    // not while an enemy has the Soul Weaver in its control range
    const engagedSw = place(base, boy, 1.4, 0.4)
    const stuck = optionIds(activateOp(engagedSw, sw))
    expect(stuck.some((id) => id.startsWith('ability:cv.a.soul-'))).toBe(false)
  })

  it('TEAM-CV-017 TEAM-CV-022 TEAM-CV-023 PSYCHIC under a Null Rod; Warp Fold swaps and bars the ready one; Warding Shield ignores one Normal Dmg die', () => {
    const s = open({ rosterA: cvRoster(PSYKERS) })
    const ws = A(s, 'way-seeker')
    const fel = A(s, 'felarch')
    const war = A(s, 'warrior')
    const sw = A(s, 'soul-weaver')
    const boy = B(s, 'boy')
    const lay = edit(place(place(place(place(place(s, ws, 0, 0), fel, 2, 0), war, 0, 2), A(s, 'kurnathi'), 0, 9), boy, 6, 4), (st) => {
      st.operatives[ws]!.order = 'engage'
    })
    // PSYCHIC across teams: a blocked Way Seeker cannot use its actions or PSYCHIC weapons, and an immune operative cannot be picked
    const stuck = ['ability:cv.a.warp-fold', 'ability:cv.a.warding-shield']
    const nullRod = { id: 'test-null-rod', psychicBlocked: (_st: GameState, op: { id: string }) => op.id === ws, psychicImmune: (_st: GameState, op: { id: string }) => op.id === fel }
    registerTeamRules(nullRod)
    try {
      const t = activateOp(lay, ws)
      expect(optionIds(t).filter((id) => stuck.some((x) => id.startsWith(x)))).toEqual([])
      const shootable = shootableIds(lay, ws, boy)
      expect(shootable).toEqual(expect.arrayContaining(['cv.w.shuriken-pistol']))
      expect(shootable).not.toContain('cv.w.freezing-grasp')
      expect(shootable).not.toContain('cv.w.lightning-strike')
      const sws = optionIds(activateOp(place(lay, sw, -2, 2.5), sw))
      expect(sws.some((id) => id.endsWith(`:${fel}`))).toBe(false)
      expect(sws.some((id) => id.endsWith(`:${war}`))).toBe(true)
    } finally {
      unregisterTeamRules('test-null-rod')
    }
    expect(shootableIds(lay, ws, boy)).toEqual(expect.arrayContaining(['cv.w.freezing-grasp', 'cv.w.lightning-strike']))

    // Warp Fold: the Way Seeker may be one of the two; a pick beyond 5" is not offered
    const t = activateOp(lay, ws)
    const folds = optionIds(t).filter((id) => id.startsWith('ability:cv.a.warp-fold:'))
    expect(folds).toEqual(expect.arrayContaining([`ability:cv.a.warp-fold:${[ws, fel].sort().join('+')}`]))
    expect(folds.some((id) => id.includes(A(s, 'kurnathi')))).toBe(false)
    // the Felarch already Repositioned this turning point and is guarding; the Warrior is ready
    const prepared = edit(lay, (st) => {
      st.operatives[fel]!.actionsThisTp = ['reposition']
      st.operatives[fel]!.flags.guard = true
    })
    const pair = [fel, war].sort().join('+')
    const folded = settle(take(activateOp(prepared, ws), `ability:cv.a.warp-fold:${pair}`).state)
    expect(folded.operatives[fel]!.pos).toMatchObject({ x: 0, z: 2 })
    expect(folded.operatives[war]!.pos).toMatchObject({ x: 2, z: 0 })
    expect(folded.operatives[fel]!.flags.guard).toBe(false)
    const own = (st: GameState, id: string) =>
      edit(st, (x) => {
        x.firefight.activation = { operativeId: id, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null }
      })
    const barred = own(folded, war)
    for (const a of ['reposition', 'fallBack', 'charge']) expect(actionForbidden(barred, barred.operatives[war]!, a), a).not.toBeNull()
    expect(actionForbidden(barred, barred.operatives[war]!, 'dash')).toBeNull()
    // the swapped operatives did not move by their own action, and the Felarch (the mover) is not barred
    expect(actionForbidden(own(folded, fel), folded.operatives[fel]!, 'reposition')).toBeNull()
    // swapping two that moved nothing bars nobody
    const plain = settle(take(activateOp(lay, ws), `ability:cv.a.warp-fold:${pair}`).state)
    expect(plain.effects.some((e) => e.source === 'cv.warpfold.ban')).toBe(false)

    // Warding Shield: the next attack die of Normal Dmg is ignored; a crit and Devastating damage are not
    const shielded = settle(take(activateOp(lay, ws), `ability:cv.a.warding-shield:${fel}`).state)
    expect(hasToken(shielded, fel, SHIELD_TOKEN, 'A')).toBe(true)
    const hit = (st: GameState, amount: number, source: string): GameState =>
      withCtx(st, (ctx) => {
        inflict(ctx, { targetId: fel, attackerId: boy, weaponId: 'kom.w.slugga', amount, source })
      }).state
    expect(hit(shielded, 3, 'crit').operatives[fel]!.wounds).toBe(6)
    expect(hit(shielded, 3, 'devastating').operatives[fel]!.wounds).toBe(6)
    expect(hasToken(hit(shielded, 3, 'crit'), fel, SHIELD_TOKEN, 'A')).toBe(true)
    const once = hit(shielded, 3, 'normal')
    expect(once.operatives[fel]!.wounds).toBe(9)
    expect(hasToken(once, fel, SHIELD_TOKEN, 'A')).toBe(false)
    expect(hit(once, 3, 'normal').operatives[fel]!.wounds).toBe(6)
    expect(hit(shielded, 3, 'strike-normal').operatives[fel]!.wounds).toBe(9)
    // it ends at the Way Seeker's next activation, or when it is incapacitated, and a new cast moves it
    const ended = withCtx(shielded, (ctx) => tokensOnActivationStart(ctx, ws)).state
    expect(hasToken(ended, fel, SHIELD_TOKEN, 'A')).toBe(false)
    const dead = withCtx(shielded, (ctx) => tokensOnRemoval(ctx, ws)).state
    expect(hasToken(dead, fel, SHIELD_TOKEN, 'A')).toBe(false)
    const old = withCtx(lay, (ctx) => addToken(ctx, fel, { kind: SHIELD_TOKEN, owner: 'A', cap: 1, sourceId: ws, expires: ['sourceNextActivation', 'sourceIncapacitated'] }, 'test')).state
    const recast = settle(take(activateOp(old, ws), `ability:cv.a.warding-shield:${war}`).state)
    expect(hasToken(recast, fel, SHIELD_TOKEN, 'A')).toBe(false)
    expect(hasToken(recast, war, SHIELD_TOKEN, 'A')).toBe(true)
    // inside a Null Rod's reach the shield does nothing and stays for later
    registerTeamRules({ id: 'test-null-rod', psychicBlocked: (_st: GameState, op: { id: string }) => op.id === fel })
    try {
      const rodded = hit(shielded, 3, 'normal')
      expect(rodded.operatives[fel]!.wounds).toBe(6)
      expect(hasToken(rodded, fel, SHIELD_TOKEN, 'A')).toBe(true)
    } finally {
      unregisterTeamRules('test-null-rod')
    }
  })

  it('TEAM-CV-018 TEAM-CV-019 TEAM-CV-020 Quick on the Trigger and Pistol Barrage', () => {
    const s = open()
    const d = A(s, 'starstorm-duellist')
    const boy = B(s, 'boy')
    const friend = A(s, 'warrior')
    // in the Boy's control range, with a friend in it too, the Duellist can still pick the Boy; a Kurnathi could not even Shoot
    const stuck = place(place(place(s, d, 0, 0), boy, 1.4, 0), friend, 2.6, 0)
    const targets = validTargets(stuck, stuck.operatives[d]!, 'cv.w.shuriken-pistol').map((t) => t.id)
    expect(targets).toEqual([boy])
    const t = activateOp(stuck, d)
    expect(optionIds(t)).toContain('shoot')
    const k = A(s, 'kurnathi')
    expect(optionIds(activateOp(place(place(stuck, k, 0, 0), d, 0, 6), k))).not.toContain('shoot')
    // the other enemy in view is not a legal target while the Duellist stands in the Boy's control range
    const nob = B(s, 'boss-nob')
    const two = place(stuck, nob, -4, 0)
    expect(validTargets(two, two.operatives[d]!, 'cv.w.shuriken-pistol').map((x) => x.id)).toEqual([boy])
    // a normal Shoot: Hit 3+ (no point-blank penalty), then the Duellist can still retaliate
    const declared = take(t, 'shoot').state
    const picked = take(declared, optionStartingWith(declared, 'cv.w.shuriken-pistol')).state
    expect(picked.pending!.kind).toBe('shoot.target')
    const rolled = take(picked, boy, dice(6, 6, 1, 1, 1, 1, 1, 1)).state
    expect(rolled.attack!.seq!.atk.need).toBe(3)
    expect(rolled.attack!.pointBlank).toBe(false)

    // FAQ: on guard the Duellist interrupts with a normal Shoot, not a point-blank one
    const guard = edit(bTurnReady(stuck), (st) => {
      st.operatives[d]!.flags.guard = true
      st.operatives[d]!.order = 'engage'
      st.operatives[friend]!.pos = { x: -13.5, y: 0, z: -3 }
    })
    const interrupt = toGuardInterrupt(take(activateOp(guard, boy), 'fight').state)
    expect(interrupt.pending!.kind).toBe('guard.interrupt')
    const shot = take(interrupt, `${d}:shoot`).state
    // freeShootInControlRange: an ordinary Shoot, not a point-blank one, so nothing stops the Duellist retaliating
    expect(shot.firefight.activation!.frame!.data!.pointBlank).toBeFalsy()
    const w = take(shot, optionStartingWith(shot, 'cv.w.')).state
    const hitRoll = take(w, boy, dice(6, 6, 1, 1, 1, 1, 1, 1)).state
    expect(hitRoll.attack!.pointBlank).toBe(false)
    expect(hitRoll.attack!.seq!.atk.need).toBe(3)
    expect(hitRoll.operatives[d]!.flags.cannotRetaliate).toBeFalsy()
    const over = playOut(hitRoll)
    expect(over.operatives[d]!.flags.cannotRetaliate).toBeFalsy()

    // Pistol Barrage: one free Shoot with each pistol, in the order chosen; a Shoot is barred after it and it after a Shoot
    const ready = place(place(s, d, 0, 0), boy, 2.5, 0)
    const bt = activateOp(ready, d)
    expect(optionIds(bt)).toEqual(expect.arrayContaining(['ability:cv.a.pistol-barrage:fusion', 'ability:cv.a.pistol-barrage:shuriken']))
    const barraged = take(bt, 'ability:cv.a.pistol-barrage:shuriken')
    const used = (r: { events: GameEvent[] }): (string | undefined)[] => r.events.flatMap((e) => (e.type === 'ShootStarted' ? [e.weaponId] : []))
    const played = play(barraged.state, dice(), { 'ploy.firefight': (p) => act.pass(p) }, ['firefight.action', 'firefight.activate', 'ability.choice'])
    expect([...used(barraged), ...used(played)]).toEqual(['cv.w.shuriken-pistol', 'cv.w.fusion-pistol'])
    expect(optionIds(played.state)).not.toContain('shoot')
    expect(played.state.firefight.activation!.apSpent).toBe(1)
    const declared2 = take(bt, 'shoot').state
    const shooter = take(declared2, optionStartingWith(declared2, 'cv.w.shuriken-pistol')).state
    expect(shooter.pending!.kind).toBe('shoot.target')
    const afterShoot = edit(playOut(take(shooter, boy, dice(1, 1, 1, 1, 1, 1, 1, 1)).state), () => undefined)
    expect(optionIds(afterShoot).some((id) => id.startsWith('ability:cv.a.pistol-barrage'))).toBe(false)
    // out of the fusion pistol's 3" range: only the shuriken pistol shoots, and the fusion Shoot is skipped
    const far = place(place(s, d, 0, 0), boy, 4.5, 0)
    const ft = activateOp(far, d)
    expect(optionIds(ft).filter((id) => id.startsWith('ability:cv.a.pistol-barrage'))).toEqual(['ability:cv.a.pistol-barrage:shuriken'])
    const fr = take(ft, 'ability:cv.a.pistol-barrage:shuriken')
    const fp = play(fr.state, dice(), { 'ploy.firefight': (p) => act.pass(p) }, ['firefight.action', 'firefight.activate', 'ability.choice'])
    expect([...used(fr), ...used(fp)]).toEqual(['cv.w.shuriken-pistol'])
    // not under a Conceal order
    const conceal = edit(ready, (st) => (st.operatives[d]!.order = 'conceal'))
    expect(optionIds(take(take(conceal, d).state, 'conceal').state).some((id) => id.startsWith('ability:cv.a.pistol-barrage'))).toBe(false)
    // in an enemy control range both free Shoots are ordinary Quick on the Trigger Shoots (no point-blank)
    const close = activateOp(stuck, d)
    const cb = take(close, 'ability:cv.a.pistol-barrage:fusion')
    expect(cb.state.firefight.activation!.frame!.data!.pointBlank).toBeFalsy()
    const cp = play(cb.state, dice(), { 'ploy.firefight': (p) => act.pass(p) }, ['firefight.action', 'firefight.activate', 'ability.choice'])
    expect([...used(cb), ...used(cp)]).toEqual(['cv.w.fusion-pistol', 'cv.w.shuriken-pistol'])
    expect(cp.state.operatives[d]!.flags.cannotRetaliate).toBeFalsy()
  })
  it('TEAM-CV-021 TEAM-CV-029 TEAM-CV-030 Prowling Raiders, Opportunistic Fighters and Light Fingers', () => {
    const s = open()
    const war = A(s, 'warrior')
    const kur = A(s, 'kurnathi')
    const boy = B(s, 'boy')
    // Prowling Raiders: free for a Warrior, 1 CP otherwise, and each is still once per turning point
    const start = (st: GameState, id: string) => take(st, id).state
    const wStart = take(start(s, war), 'engage').state
    expect(wStart.pending!.kind).toBe('ploy.firefight')
    expect(costOf(wStart, 'cv.p.light-fingers')).toBe(0)
    expect(costOf(wStart, 'cv.p.capricious-flight')).toBe(0)
    const kStart = take(start(s, kur), 'engage').state
    expect(costOf(kStart, 'cv.p.light-fingers')).toBe(1)
    expect(costOf(kStart, 'cv.p.capricious-flight')).toBe(1)
    const cp = s.players.A.cp
    const flown = take(wStart, 'cv.p.capricious-flight').state
    expect(flown.players.A.cp).toBe(cp)
    expect(usedThisTp(flown, 'A', 'cv.p.capricious-flight')).toBe(true)
    // the Fall Back costs 1 less AP for the rest of that activation (a Warrior's Fall Back: 2 -> 1)
    const caught = place(place(s, war, 0, 0), boy, 1.4, 0)
    const wAct = settle(take(take(take(caught, war).state, 'engage').state, 'cv.p.capricious-flight').state)
    expect(costOf(wAct, 'fallBack')).toBe(1)
    expect(optionIds(wAct)).not.toContain('cv.p.capricious-flight')
    const k2 = take(take(start(s, kur), 'engage').state, 'cv.p.capricious-flight').state
    expect(k2.players.A.cp).toBe(cp - 1)

    // Light Fingers lifts the "enemy in control range" bar for mission actions (SECURE) for that activation only
    const tp2 = edit(s, (st) => {
      st.turningPoint = 2
    })
    const m = tp2.markers.find((k) => k.kind === 'objective')!
    const atObjective = place(place(tp2, kur, m.pos.x + 1.2, m.pos.z), boy, m.pos.x + 2.6, m.pos.z)
    const secureIds = (st: GameState) => optionIds(st).filter((id) => id.startsWith('ability:core.a.secure'))
    expect(secureIds(activateOp(atObjective, kur))).toEqual([])
    const lf = settle(take(take(take(atObjective, kur).state, 'engage').state, 'cv.p.light-fingers').state)
    expect(secureIds(lf).length).toBeGreaterThan(0)
    // the effect ends with the activation
    expect(lf.effects.some((e) => e.source === 'cv.p.light-fingers' && e.expires === 'activation')).toBe(true)

    // Opportunistic Fighters: 2D3 for each Corsair in the Boy's control range, before the Fall Back moves
    const fel = A(s, 'felarch')
    const ring = place(place(place(s, fel, 0, 0), war, 0.2, 1.3), boy, 1.4, 0.2)
    const fb = take(activateOp(bTurn(ring, A(s, 'kurnathi')), boy), 'fallBack').state
    expect(fb.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A' })
    expect(costOf(fb, 'cv.p.opportunistic-fighters')).toBe(1)
    const burned = take(fb, 'cv.p.opportunistic-fighters', dice(2, 2, 6, 6)).state
    expect(burned.operatives[boy]!.wounds).toBe(10 - (1 + 1) - (3 + 3))
    expect(burned.pending!.kind).toBe('move.path') // it survived, so the Fall Back goes ahead
    // enough damage: it never moves and its action ends
    const weak = edit(fb, (st) => {
      st.operatives[boy]!.wounds = 3
    })
    const killed = take(weak, 'cv.p.opportunistic-fighters', dice(6, 6, 6, 6)).state
    expect(killed.operatives[boy]!.status).toBe('removed')
    expect(killed.window).toBeNull()
    expect(killed.pending!.kind).toBe('firefight.activate')
    expect(killed.pending!.seat).toBe('A')
    expect(killed.firefight.activation).toBeNull()
    // not offered for any other action, nor with no Corsair in its control range
    const dashing = activateOp(bTurn(ring, A(s, 'kurnathi')), boy)
    expect(optionIds(take(dashing, 'fight').state).some((id) => id.startsWith('cv.p.opportunistic'))).toBe(false)
  })

  it('TEAM-CV-025 TEAM-CV-026 TEAM-CV-027 TEAM-CV-028 TEAM-CV-031 Plunderers and the strategy and activation ploys', () => {
    const spread = (st: GameState) => {
      let i = 0
      for (const op of Object.values(st.operatives)) {
        op.pos = op.seat === 'A' ? { x: -9 + (i % 3) * 3, y: 0, z: -5 + Math.floor(i / 3) * 3 } : { x: 13.5, y: 0, z: -10 + (i - 9) * 1.7 }
        i++
      }
    }
    // Plunderers: not in turning point 1; in turning point 2 up to D3 Corsairs Dash at once and then cannot Dash in their activations
    expect(optionIds(gambitAt({}, 1, spread))).not.toContain('cv.p.plunderers')
    const g2 = gambitAt({}, 2, spread)
    expect(optionIds(g2)).toContain('cv.p.plunderers')
    const fel = A(g2, 'felarch')
    const kur = A(g2, 'kurnathi')
    const picks = take(g2, 'cv.p.plunderers', dice(6)).state
    expect(picks.pending).toMatchObject({ kind: 'ability.choice', seat: 'A' })
    expect(picks.pending!.context.slotsLeft).toBe(3)
    expect(optionIds(picks)).toEqual(expect.arrayContaining([fel, kur, 'done']))
    let t = moveTo(take(picks, fel).state, picks.operatives[fel]!.pos.x + 1, picks.operatives[fel]!.pos.z)
    expect(t.pending!.context.slotsLeft).toBe(2)
    expect(optionIds(t)).not.toContain(fel)
    t = moveTo(take(t, kur).state, t.operatives[kur]!.pos.x + 1, t.operatives[kur]!.pos.z)
    t = take(t, 'done').state
    const own = (st: GameState, id: string) =>
      edit(st, (x) => {
        x.firefight.activation = { operativeId: id, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null }
      })
    expect(actionForbidden(own(t, kur), t.operatives[kur]!, 'dash')).not.toBeNull()
    expect(actionForbidden(own(t, kur), t.operatives[kur]!, 'ability:cv.a.blademaster')).not.toBeNull()
    expect(actionForbidden(own(t, fel), t.operatives[fel]!, 'dash')).not.toBeNull()
    // the Felarch keeps Veteran Raider, and one that did not take part may still Dash for free
    expect(providerCostDelta(own(t, fel), t.operatives[fel]!, 'guard')).toBe(-1)
    const other = A(g2, 'warrior')
    expect(actionForbidden(own(t, other), t.operatives[other]!, 'dash')).toBeNull()
    expect(providerCostDelta(own(t, other), t.operatives[other]!, 'dash')).toBe(-1)
    // a counteraction Dash is not an activation's Dash
    const counter = edit(t, (x) => {
      x.firefight.activation = { operativeId: kur, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }
    })
    expect(actionForbidden(counter, counter.operatives[kur]!, 'dash')).toBeNull()

    // Piratical Profiteers: Balanced when it or its enemy contests an objective marker
    const s = open()
    const k = A(s, 'kurnathi')
    const boy = B(s, 'boy')
    const m = s.markers.find((x) => x.kind === 'objective')!
    const ploy = (id: string) => usePlayed(s, id)
    const rulesOf = (st: GameState, op: string, target: string) => effectiveRules(st, st.operatives[op]!, st.data.weapons['cv.w.shuriken-pistol']!, 'shoot', target).map((r) => r.rule)
    const prof = ploy('cv.p.piratical-profiteers')
    const onMarker = place(place(prof, k, m.pos.x + 0.9, m.pos.z), boy, m.pos.x + 6, m.pos.z + 3)
    expect(rulesOf(onMarker, k, boy)).toContain('balanced')
    const offMarker = place(place(prof, k, m.pos.x + 5, m.pos.z + 4), boy, m.pos.x + 8, m.pos.z + 4)
    expect(rulesOf(offMarker, k, boy)).not.toContain('balanced')
    const enemyOn = place(place(prof, k, m.pos.x + 5, m.pos.z + 4), boy, m.pos.x - 0.9, m.pos.z)
    expect(rulesOf(enemyOn, k, boy)).toContain('balanced')
    expect(rulesOf(onMarker, k, boy).filter((r) => r === 'balanced')).toHaveLength(1)
    expect(rulesOf(place(open(), k, m.pos.x + 0.9, m.pos.z), k, boy)).not.toContain('balanced')

    // Mobile Engagement: a Corsair that moved in an action this turning point re-rolls one defence die (a free Dash counts)
    const mob = ploy('cv.p.mobile-engagement')
    const data = () => ({ kind: 'shoot', attackerId: boy, weaponId: 'kom.w.slugga', dice: 3, saveDelta: 0, rerolls: [] as { id: string }[] })
    const grants = (st: GameState, op: string) => {
      const d = data()
      runHook('modifyDefenceDice', { seat: 'A', state: st, operativeId: op, targetId: boy, weaponId: 'kom.w.slugga', data: d as never })
      return d.rerolls.map((r) => r.id)
    }
    expect(grants(mob, k)).toEqual([])
    const dashed = settle(moveTo(take(activateOp(place(mob, k, 0, 0), k), 'dash').state, 2, 0))
    expect(dashed.effects.some((e) => e.source === 'cv.moved' && e.operativeId === k)).toBe(true)
    expect(grants(dashed, k)).toEqual(['cv-mobile'])
    expect(grants(dashed, A(s, 'warrior'))).toEqual([])
    expect(grants(edit(dashed, (st) => (st.effects = st.effects.filter((e) => e.source !== 'cv.p.mobile-engagement'))), k)).toEqual([])
    // Outcasts: Punishing when more than 5" from every other friendly operative
    const out = ploy('cv.p.outcasts')
    const alone = place(out, k, 0, 0)
    const withFriend = place(place(out, k, 0, 0), A(s, 'warrior'), 4, 0)
    const farFriend = place(place(out, k, 0, 0), A(s, 'warrior'), 6.5, 0)
    expect(rulesOf(alone, k, boy)).toContain('punishing')
    expect(rulesOf(withFriend, k, boy)).not.toContain('punishing')
    expect(rulesOf(farFriend, k, boy)).toContain('punishing') // base to base 5.4": more than 5" from every friend
    expect(rulesOf(s, k, boy)).not.toContain('punishing')

    // Contemptuous Adventurer: the seat's first activation, more than 5" from every friend; the first Shoot has Relentless
    const lone = place(s, k, 0, 0)
    const shoot = place(lone, boy, 5, 0)
    const ready = take(take(shoot, k).state, 'engage').state
    expect(ready.pending!.kind).toBe('ploy.firefight')
    expect(optionIds(ready)).toContain('cv.p.contemptuous-adventurer')
    const crowded = take(take(place(s, k, -12, -10), k).state, 'engage').state
    expect(optionIds(crowded)).not.toContain('cv.p.contemptuous-adventurer') // within 5" of friends
    const adventurer = settle(take(ready, 'cv.p.contemptuous-adventurer').state)
    const declared = take(adventurer, 'shoot').state
    expect(rulesOf(declared, k, boy)).toContain('relentless')
    expect(rulesOf(adventurer, k, boy)).not.toContain('relentless')
    const shot = playOut(take(take(declared, optionStartingWith(declared, 'cv.w.shuriken-pistol')).state, boy, dice(1, 1, 1, 1, 1, 1, 1, 1)).state)
    expect(rulesOf(shot, k, boy)).not.toContain('relentless')
    // not offered on a later activation of the turning point
    const notFirst = edit(lone, (st) => (st.operatives[A(s, 'warrior')]!.ready = false))
    const second = take(take(notFirst, k).state, 'engage').state
    expect(optionIds(second)).not.toContain('cv.p.contemptuous-adventurer')
  })

  it('TEAM-CV-032 TEAM-CV-033 TEAM-CV-034 Diuturnal Mantles, Mistfield and Star Charts', () => {
    const s = open({ equipmentA: ['cv.e.diuturnal-mantles', 'cv.e.mistfield'] })
    const war = A(s, 'warrior')
    const boy = B(s, 'boy')
    // Mantles: Blast and Torrent weapons let the defender re-roll one defence die; the splash of x" Devastating does nothing
    const blasty = withWeapons(s, ranged('t.blast', {}, [{ rule: 'blast', inches: 2 }]), ranged('t.torrent', {}, [{ rule: 'torrent', inches: 2 }]), ranged('t.plain'))
    const grants = (st: GameState, op: string, weaponId: string) => {
      const d = { kind: 'shoot', attackerId: boy, weaponId, dice: 3, saveDelta: 0, rerolls: [] as { id: string }[] }
      runHook('modifyDefenceDice', { seat: 'A', state: st, operativeId: op, targetId: boy, weaponId, data: d as never })
      return d.rerolls.map((r) => r.id)
    }
    expect(grants(blasty, war, 't.blast')).toEqual(['cv-mantles'])
    expect(grants(blasty, war, 't.torrent')).toEqual(['cv-mantles'])
    expect(grants(blasty, war, 't.plain')).toEqual([])
    expect(grants(withWeapons(open(), ranged('t.blast', {}, [{ rule: 'blast', inches: 2 }])), war, 't.blast')).toEqual([])
    const splash = (st: GameState, victim: string, isSplash: boolean) =>
      withCtx(st, (ctx) => {
        inflict(ctx, { targetId: victim, attackerId: boy, weaponId: 'kom.w.slugga', amount: 3, source: 'devastating', ...(isSplash ? { splash: true } : {}) })
      }).state.operatives[victim]!.wounds
    expect(splash(s, war, true)).toBe(8)
    expect(splash(s, war, false)).toBe(5)
    expect(splash(open(), war, true)).toBe(5)

    // Mistfield: once per turning point against a shot from more than 3" away, only when the weapon has Piercing
    const pierce = (x: number) => arm(withWeapons(place(place(s, war, 0, 0), boy, 6, 0), ranged('t.pierce', {}, [{ rule: 'piercing', x }]), ranged('t.crits', {}, [{ rule: 'piercing', x: 2, crits: true }])), boy, ['t.pierce'])
    const info = (shooter: string, weaponId: string) => ({ window: 'shoot.beforeDefenceRoll', attackerId: shooter, targetId: war, subjectId: war, kind: 'shoot', weaponId })
    const offered = (st: GameState, weaponId = 't.pierce') => offersFor(st, 'A', 'shoot.beforeDefenceRoll', info(boy, weaponId)).some((o) => o.id === 'cv.e.mistfield')
    expect(offered(pierce(2))).toBe(true)
    expect(offered(place(pierce(2), boy, 2.5, 0))).toBe(false) // gap 1.4": within 3"
    expect(offered(arm(pierce(2), boy, ['kom.w.slugga']), 'kom.w.slugga')).toBe(false) // no Piercing
    expect(offered(pierce(1), 't.crits')).toBe(true) // Piercing Crits counts too
    const used2 = (x: number) => {
      const st = pierce(x)
      const o = offersFor(st, 'A', 'shoot.beforeDefenceRoll', info(boy, 't.pierce')).find((q) => q.id === 'cv.e.mistfield')!
      return withCtx(st, (ctx) => usePloy(ctx, 'A', o, info(boy, 't.pierce'))).state
    }
    const lowered = (st: GameState) => effectiveRules(st, st.operatives[boy]!, st.data.weapons['t.pierce']!, 'shoot', war).filter((r) => r.rule === 'piercing')
    expect(lowered(used2(2))).toEqual([{ rule: 'piercing', x: 1 }])
    expect(lowered(used2(1))).toEqual([])
    expect(lowered(pierce(2))).toEqual([{ rule: 'piercing', x: 2 }])
    // another target is untouched, the use is gone for the turning point
    expect(effectiveRules(used2(2), used2(2).operatives[boy]!, used2(2).data.weapons['t.pierce']!, 'shoot', A(s, 'kurnathi')).filter((r) => r.rule === 'piercing')).toEqual([{ rule: 'piercing', x: 2 }])
    expect(usedThisTp(used2(2), 'A', 'cv.mistfield')).toBe(true)
    expect(offered(used2(2))).toBe(false)

    // Star Charts: a D3 above the turning point number gains 1 CP and ends it; a failed roll is tried again later; never from turning point 3
    const g1 = gambitAt({ equipmentA: ['cv.e.star-charts'] }, 1)
    const cp = g1.players.A.cp
    expect(g1.pending!.options!.find((o) => o.id === 'cv.p.star-charts')!.data!.cost).toBe(0)
    const won = take(g1, 'cv.p.star-charts', dice(4)).state // D3 = 2
    expect(won.players.A.cp).toBe(cp + 1)
    expect(usedThisBattle(won, 'A', 'cv.starcharts.done')).toBe(true)
    const lost = take(g1, 'cv.p.star-charts', dice(2)).state // D3 = 1
    expect(lost.players.A.cp).toBe(cp)
    expect(usedThisBattle(lost, 'A', 'cv.starcharts.done')).toBe(false)
    const g2 = gambitAt({ equipmentA: ['cv.e.star-charts'] }, 2)
    expect(optionIds(g2)).toContain('cv.p.star-charts')
    expect(take(g2, 'cv.p.star-charts', dice(6)).state.players.A.cp).toBe(g2.players.A.cp + 1) // D3 = 3 beats 2
    expect(take(g2, 'cv.p.star-charts', dice(4)).state.players.A.cp).toBe(g2.players.A.cp) // D3 = 2 does not
    expect(optionIds(gambitAt({ equipmentA: ['cv.e.star-charts'] }, 3))).not.toContain('cv.p.star-charts')
    expect(optionIds(gambitAt({}, 1))).not.toContain('cv.p.star-charts')
  })

  it('TEAM-CV-015 Slicing Attack: the line keeps out of terrain, bending round a part or climbing over it, within its 7"', () => {
    const s = open()
    const sr = A(s, 'shade-runner')
    const nob = B(s, 'boss-nob')
    const wall = (id: string, z0: number, z1: number, height: number, traits: string[]) => ({
      id,
      parts: [{ id: `${id}.0`, footprint: [{ x: 4.2, z: z0 }, { x: 4.4, z: z0 }, { x: 4.4, z: z1 }, { x: 4.2, z: z1 }], height, traits }],
    })
    // the Nob is in plain sight of the Shade Runner; every other enemy is far off
    const lay = (features: unknown[]) =>
      edit(place(s, sr, 0, 0), (st) => {
        for (const o of Object.values(st.operatives)) if (o.seat === 'B' && o.id !== nob) o.pos = { x: -12, y: 0, z: o.pos.z > 0 ? 9 : -9 }
        st.operatives[nob]!.pos = { x: 3, y: 0, z: -1.5 }
        st.map = { ...st.map, features: features as never }
      })
    const cuts = (st: GameState) => optionIds(moveTo(take(activateOp(st, sr), 'reposition').state, 6, 0, true)).filter((id) => id.startsWith('cv.a.slicing-attack:'))
    expect(cuts(lay([]))).toEqual([`cv.a.slicing-attack:${nob}`])
    // a 5" wall right across the killzone between the Nob and the landing spot: the warp jump passes it, the line
    // would have to climb it, and the terrain-free route (well inside 7") no longer counts
    const tall = lay([wall('tall', -10.9, 10.9, 5, ['heavy', 'blocking'])])
    expect(slicingRoute({ x: 0, z: 0 }, { x: 6, z: 0 }, tall.operatives[sr]!.baseRadius, tall.operatives[nob]!)).toBeLessThan(6)
    expect(slicingReach(tall, { x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, tall.operatives[sr]!.baseRadius, tall.operatives[nob]!)).toBeGreaterThan(7)
    expect(cuts(tall)).toEqual([])
    // a 1" barricade there instead: the line climbs over it and still reaches
    expect(cuts(lay([wall('low', -10.9, 10.9, 1, ['light'])]))).toEqual([`cv.a.slicing-attack:${nob}`])
    // a tall wall with a gap near the landing spot: the line bends round its end
    const gapped = lay([wall('gapped', -10.9, -0.4, 5, ['heavy', 'blocking'])])
    const bent = slicingReach(gapped, { x: 0, y: 0, z: 0 }, { x: 6, y: 0, z: 0 }, gapped.operatives[sr]!.baseRadius, gapped.operatives[nob]!)
    expect(bent).toBeGreaterThan(slicingRoute({ x: 0, z: 0 }, { x: 6, z: 0 }, gapped.operatives[sr]!.baseRadius, gapped.operatives[nob]!) + 0.01)
    expect(bent).toBeLessThan(7)
    expect(cuts(gapped)).toEqual([`cv.a.slicing-attack:${nob}`])
  })

  it('TEAM-CV-022 Warp Fold while counteracting: the Way Seeker swapping itself must land within 2" measured in three dimensions', () => {
    const s = open({ rosterA: cvRoster(PSYKERS) })
    const ws = A(s, 'way-seeker')
    const war = A(s, 'warrior')
    const counter = (y: number) =>
      edit(place(place(s, ws, 0, 0), war, 1.5, 0, y), (st) => {
        for (const o of Object.values(st.operatives)) if (o.seat === 'A' && o.id !== ws && o.id !== war) o.pos = { x: -12, y: 0, z: o.pos.z }
        st.operatives[ws]!.order = 'engage'
        st.firefight.activation = { operativeId: ws, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }
      })
    const pairs = (st: GameState) => getCodeHook('warpFold')!.action!.offers(st, st.operatives[ws]!, st.data.abilities['cv.a.warp-fold']!, st.firefight.activation).map((o) => o.key)
    const key = [ws, war].sort().join('+')
    expect(pairs(counter(1))).toContain(key) // 1.5" across and 1" up: 1.8"
    expect(pairs(counter(1.8))).not.toContain(key) // 1.5" across and 1.8" up: 2.34"
  })

  it('TEAM-CV-030 Light Fingers: Pick Up Marker with an enemy in control range, for that activation', () => {
    const s = open()
    const kur = A(s, 'kurnathi')
    const boy = B(s, 'boy')
    const loot = edit(place(place(s, kur, 0, 0), boy, 1.4, 0), (st) => {
      st.markers.push({ id: 'test-loot', kind: 'equipment', pos: { x: -1, z: 0 }, owner: null, carriedBy: null, controller: null, pickable: true })
    })
    const pickIds = (st: GameState) => optionIds(st).filter((id) => id.startsWith('marker:pickUp'))
    expect(pickIds(activateOp(loot, kur))).toEqual([])
    const lf = settle(take(take(take(loot, kur).state, 'engage').state, 'cv.p.light-fingers').state)
    expect(pickIds(lf)).toEqual(['marker:pickUp:test-loot'])
  })

  it('TEAM-CV-009 TEAM-CV-027 TEAM-CV-033 Camo Cloak, Mobile Engagement and Diuturnal Mantles answer any shooter, a friendly one included', () => {
    const s = open({ equipmentA: ['cv.e.diuturnal-mantles'] })
    const war = A(s, 'warrior')
    const fel = A(s, 'felarch')
    const fd = A(s, 'fate-dealer')
    const st = withFx(withWeapons(s, ranged('t.blast', {}, [{ rule: 'blast', inches: 2 }, { rule: 'saturate' }])), { source: 'cv.p.mobile-engagement' }, { source: 'cv.moved', operativeId: war })
    // the Felarch's Blast clips the Warrior (a friendly sequence): the Warrior still re-rolls under both rules
    const d = { kind: 'shoot', attackerId: fel, weaponId: 't.blast', dice: 3, saveDelta: 0, rerolls: [] as { id: string }[] }
    runHook('modifyDefenceDice', { seat: 'A', state: st, operativeId: war, targetId: fel, weaponId: 't.blast', data: d as never })
    expect(d.rerolls.map((r) => r.id).sort()).toEqual(['cv-mantles', 'cv-mobile'])
    // and the Fate Dealer's cloak strips Saturate from a friendly shooter's weapon too
    expect(effectiveRules(st, st.operatives[fel]!, st.data.weapons['t.blast']!, 'shoot', fd).some((r) => r.rule === 'saturate')).toBe(false)
    expect(effectiveRules(st, st.operatives[fel]!, st.data.weapons['t.blast']!, 'shoot', war).some((r) => r.rule === 'saturate')).toBe(true)
  })

  it('TEAM-CV-035 a full simulated game with the default Corsair roster completes with free Dashes and no engine errors', () => {
    const layout = Object.keys(realBundle.layouts ?? {}).sort()[0]!
    const setup = realSetup(realBundle, { teams: ['corsair-voidscarred', 'angels-of-death'], layoutId: layout })
    const seed = 'cv-sim-1'
    const report = playGame(setup, realBundle, seed)
    expect(report.violations).toEqual([])
    expect(report.rejections).toBe(0)
    expect(report.ended).toBe(true)
    // replay the recorded actions to read the events: at least one free Dash was declared (cost 0)
    let state = createGame(setup, seed, realBundle).state
    let freeDashes = 0
    let declared = 0
    for (const a of report.actions) {
      const r = step(state, a)
      for (const e of r.events) {
        if (e.type === 'ActionDeclared' && e.action === 'dash' && state.operatives[e.operativeId]?.seat === 'A') {
          declared++
          if (e.cost === 0) freeDashes++
        }
      }
      state = r.state
    }
    expect(declared).toBeGreaterThan(0)
    expect(freeDashes).toBeGreaterThan(0)
  }, 120000)

  it('TEAM-CV every code hook the data names fires in a real game', () => {
    resetFireCounts()
    const names = CODE_HOOKS.filter((h) => h.usedBy.every((id) => id.startsWith('cv.'))).map((h) => h.name)
    expect(names.length).toBeGreaterThanOrEqual(28)
    const failures: string[] = []
    for (const [name, run] of Object.entries(scenarios)) {
      try {
        run()
      } catch (e) {
        failures.push(`${name}: ${(e as Error).message}`)
      }
    }
    expect(failures).toEqual([])
    expect(names.filter((n) => hookFireCount(n) === 0)).toEqual([])
    expect(Object.keys(scenarios).sort()).toEqual([...names].sort())
  })
})

void [act, step, createGame, attackStats, inflict, hookFireCount, resetFireCounts, usedThisTp, runHook, planFly, offersFor, markerControl, ScriptedRng, providerCanFly, providerFightStart, providerStealthy, registerTeamRules, unregisterTeamRules, ERUDITE_TOKEN, FAOLCHU_TOKEN, SHIELD_TOKEN, hasToken, expectOk, passIt, pick, arm, ranged, withWeapons, bTurn, engaged, gambitAt, reraise, scenarios, takePloy, usePlayed, withCtx, PSYKERS, edit, shootableWeapons]
void ({} as AttackState)
