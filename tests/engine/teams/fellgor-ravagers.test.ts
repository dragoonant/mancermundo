// fellgor-ravagers engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-FG-nnn).
// Fellgor Ravagers are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { step } from '@/engine'
import { act } from '@/engine/actions'
import { abilityOffers, actionForbidden, maxRepeats, refreshFlags } from '@/engine/abilities'
import { applyAplEffect, attackStats, runDeferredRemovals, defenceStats, effectiveRules, parseRules, validTargets, weaponDamage } from '@/engine/attack-common'
import { grenadeSource } from '@/engine/core-hooks'
import { hasKeyword } from '@/engine/conditions'
import { getCodeHook, hookFireCount } from '@/engine/code-hooks'
import { expireEffects, usedThisBattle, usedThisTp } from '@/engine/effects'
import { actionCost } from '@/engine/firefight'
import { interruptActions } from '@/engine/guard'
import { usableRangedWeapons } from '@/engine/shoot'
import { registerHook, runHook, unregisterHook } from '@/engine/hooks'
import { offersFor } from '@/engine/ploys'
import { isPsychicWeapon } from '@/engine/psychic'
import { effectiveApl, effectiveMove } from '@/engine/state'
import { TEAM_ID, isFrenzied, shotBy } from '@/engine/teams/fellgor-ravagers'
import type { Rng } from '@/engine/rng'
import { providerControlApl, providerCostDelta, providerOwnReactions } from '@/engine/team-rules'
import { tokenCount, tokensOnActivationStart } from '@/engine/tokens'
import type { GameState } from '@/engine/types'
import { enumerateLoadouts, loadBundle, validateRoster, type DatacardData } from '../../../src/data'
import { arm, evs, melee, play, ranged, withWeapons } from '../../fixtures/attack'
import { place } from '../../fixtures/helpers'
import { answerDecision } from '@/engine/query'
import type { GameEvent } from '@/engine/events'
import { feature, part, rect } from '../../fixtures/maps'
import { activateOp, edit, hasOption, optionIds, passIt, realBundle, take, withCtx } from '../../fixtures/real'
import { A, ALL, B, WITH_WARRIORS, advanceTo, bTurn, parked, dice, facing, fgRoster, fightAt, frenzy, goTo, hit, open, shootAt, shootingAt, strikes, takeEv, toGambit, usePlayed, withFx } from './fellgor-ravagers.hooks'

const fired = hookFireCount
const data = loadBundle()

void [abilityOffers, maxRepeats, defenceStats, effectiveRules, parseRules, offersFor, goTo, strikes, usePlayed, withFx, hasOption]

describe('TEAM-FG Fellgor Ravagers', () => {
  it('TEAM-FG-000 TEAM-FG-001 TEAM-FG-002 playable team, roster rules, printed loadouts, stats, keywords and the PSYCHIC tech-curse', () => {
    expect(TEAM_ID).toBe('fellgor-ravagers')
    const team = data.teams['fellgor-ravagers']!
    expect(team.playable).toBe(true)
    const cards = realBundle.datacards
    const nine = ['fg.deathknell', 'fg.fluxbray', 'fg.gnarlscar', 'fg.gorehorn', 'fg.herd-goad', 'fg.mangler', 'fg.shaman', 'fg.toxhorn', 'fg.vandal']
    const ok = (main: string[], leader = ['fg.ironhorn']) => validateRoster(team, { leader, main }, cards as never).ok
    expect(ok(nine)).toBe(true)
    // Warriors are unlimited, every other entry once
    expect(ok([...Array<string>(5).fill('fg.warrior'), ...nine.slice(0, 4)])).toBe(true)
    expect(ok(Array<string>(9).fill('fg.warrior'))).toBe(true)
    expect(ok([...nine.slice(0, 8), 'fg.mangler'])).toBe(false)
    expect(ok([...nine.slice(0, 8), 'fg.deathknell'])).toBe(false)
    expect(ok(nine, ['fg.ironhorn', 'fg.ironhorn'])).toBe(false)
    expect(ok([...nine, 'fg.warrior'])).toBe(false)
    // loadouts: the Ironhorn and the Warrior pick one of two sets, everyone else is fixed
    const count = (id: string) => enumerateLoadouts(data.byId[id] as DatacardData).length
    expect([count('fg.ironhorn'), count('fg.warrior'), ...nine.map(count)]).toEqual([2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    const weaponsOf = (id: string) => (data.byId[id] as DatacardData).weapons
    expect(weaponsOf('fg.herd-goad').fixed).toEqual(['fg.w.autopistol', 'fg.w.crackthorn-whip-ranged', 'fg.w.crackthorn-whip-melee'])
    const plasma = [...realBundle.datacards['fg.ironhorn']!.legalLoadouts!.find((l) => l.includes('fg.w.bludgeon'))!]
    expect(plasma.sort()).toEqual(['fg.w.bludgeon', 'fg.w.plasma-pistol-standard', 'fg.w.plasma-pistol-supercharge'])
    // printed numbers
    const w = (id: string) => data.byId[id] as { atk: number; hit: string; dmg: { normal: number; crit: number }; rules: { rule: string }[] }
    expect(w('fg.w.vicious-claws').hit).toBe('4+')
    expect(w('fg.w.vicious-claws').dmg).toEqual({ normal: 4, crit: 6 })
    expect(w('fg.w.mancrusher').dmg).toEqual({ normal: 5, crit: 5 })
    expect(w('fg.w.tech-curse').rules.map((r) => r.rule)).toEqual(['fg.a.wr-psychic', 'core.wr.rending', 'core.wr.saturate', 'core.wr.seek-light'])
    expect(w('fg.w.crackthorn-whip-ranged').hit).toBe('2+')
    expect(w('fg.w.bludgeon').dmg).toEqual({ normal: 4, crit: 4 })
    const stat = (id: string) => (data.byId[id] as DatacardData).stats
    expect(stat('fg.ironhorn')).toMatchObject({ wounds: 11, save: '5+', apl: 2, move: 6 })
    expect(stat('fg.deathknell')).toMatchObject({ wounds: 10, save: '4+' })
    for (const id of [...nine.filter((n) => n !== 'fg.deathknell'), 'fg.warrior']) expect(stat(id)).toMatchObject({ wounds: 10, save: '5+' })
    // keywords, in a real game
    const s = open({ rosterA: fgRoster(ALL) })
    expect(isPsychicWeapon(s, 'fg.w.tech-curse')).toBe(true)
    for (const op of Object.values(s.operatives).filter((o) => o.seat === 'A')) {
      for (const k of ['FELLGOR RAVAGER', 'CHAOS']) expect(hasKeyword(s, op, k), `${op.name} ${k}`).toBe(true)
      expect(hasKeyword(s, op, 'PSYKER')).toBe(op.datacardId === 'fg.shaman')
      expect(hasKeyword(s, op, 'LEADER')).toBe(op.datacardId === 'fg.ironhorn')
      expect(op.baseRadius).toBeCloseTo(16 / 25.4, 2)
    }
  })

  it('TEAM-FG-003 TEAM-FG-004 TEAM-FG-005 Frenzy gain: a Shoot and a Fight keep the operative on 1 wound with a token, Engage, a kill for the opponent and the rest of the dice discarded; Hot, direct and friendly damage trigger it; never twice', () => {
    {
      const s0 = open({ rosterA: fgRoster(WITH_WARRIORS) })
      const wr = A(s0, 'warrior')
      const boy = B(s0, 'boy')
      const gun = ranged('t.gun', { atk: 4, hit: 3, dmg: { normal: 5, crit: 6 } })
      let s = arm(withWeapons(place(place(s0, wr, 0, 0), boy, 6, 0), gun), boy, ['t.gun'])
      s = edit(s, (st) => {
        st.operatives[wr]!.wounds = 4
        st.operatives[wr]!.order = 'conceal'
        st.operatives[boy]!.order = 'engage'
      })
      s = bTurn(s, A(s0, 'ironhorn'))
      const r = shootAt(s, boy, 't.gun', wr, dice(3, 3, 3, 1, 1, 1, 1))
      const w = r.state.operatives[wr]!
      expect(w.status).toBe('active')
      expect(w.wounds).toBe(1)
      expect(w.order).toBe('engage')
      expect(isFrenzied(r.state, w)).toBe(true)
      // only the first of the three unblocked normal dice dealt damage
      expect(evs(r.events, 'DamageInflicted').filter((e) => e.operativeId === wr)).toHaveLength(1)
      // the opponent counted it at token gain, with one log entry and no second count at removal
      expect(r.state.mission!.kills.B).toBe(1)
      expect(r.state.kills).toHaveLength(1)
      expect(r.state.kills![0]).toMatchObject({ removedId: wr, cause: 'scored', killerId: boy })
      expect(fired('fgFrenzy')).toBeGreaterThan(0)
    }
    {
      const s0 = open({ rosterA: fgRoster(WITH_WARRIORS) })
      const wr = A(s0, 'warrior')
      const boy = B(s0, 'boy')
      const club = melee('t.club', { atk: 4, hit: 3, dmg: { normal: 5, crit: 6 } })
      let s = arm(withWeapons(facing(s0, wr, boy), club), boy, ['t.club'])
      s = edit(s, (st) => void (st.operatives[wr]!.wounds = 3))
      // the Boy attacks, the Warrior retaliates: the Boy rolls four normal successes, the Warrior four fails
      const f = fightAt(bTurn(s, A(s0, 'ironhorn')), boy, wr, dice(4, 4, 4, 4, 1, 1, 1, 1))
      expect(f.state.operatives[wr]!.wounds).toBe(1)
      expect(isFrenzied(f.state, f.state.operatives[wr]!)).toBe(true)
      expect(evs(f.events, 'Struck')).toHaveLength(1)
      expect(f.state.operatives[boy]!.wounds).toBe(f.state.operatives[boy]!.maxWounds)
      expect(f.state.mission!.kills.B).toBe(1)
      expect(f.state.attack).toBeNull()
      // Hot, direct damage and a friend's damage all trigger it; a frenzied operative gains no second token
      const vandal = A(s0, 'vandal')
      for (const [amount, source] of [[4, 'hot'], [4, 'direct']] as [number, string][]) {
        const t = edit(s0, (st) => void (st.operatives[wr]!.wounds = 2))
        const after = hit(t, wr, source === 'hot' ? wr : boy, null, [[amount, source]]).state
        expect(after.operatives[wr]!.wounds, source).toBe(1)
        expect(tokenCount(after, wr, 'fg.frenzy')).toBe(1)
        expect(hit(after, wr, boy, null, [[9, 'direct']]).state.operatives[wr]!.wounds).toBe(1)
      }
      const friendly = edit(s0, (st) => void (st.operatives[wr]!.wounds = 2))
      expect(isFrenzied(hit(friendly, wr, vandal, null, [[3, 'direct']]).state, friendly.operatives[wr])).toBe(true)
    }
  })

  it('TEAM-FG-006 Frenzy state: Engage only, injured (Move 4, Hit worse) even when healed, no Pick Up, unique, mission or grenade actions (Sweeping Blow excepted), APL 1 for control', () => {
    const s0 = open({ rosterA: fgRoster(ALL), equipmentA: ['core.e.utility-grenades'] })
    const dk = A(s0, 'deathknell')
    const vd = A(s0, 'vandal')
    const gh = A(s0, 'gorehorn')
    const s = frenzy(frenzy(frenzy(s0, dk), vd), gh)
    // healed to full wounds, still injured by Frenzy; the Hit is worse too
    const healed = edit(s, (st) => void (st.operatives[gh]!.wounds = 10))
    expect(effectiveMove(healed.operatives[gh]!, healed)).toBe(4)
    expect(attackStats(healed, gh, 'fg.w.skullcleaver', B(s0, 'boy'), { kind: 'fight' }).need).toBe(4)
    expect(attackStats(s0, gh, 'fg.w.skullcleaver', B(s0, 'boy'), { kind: 'fight' }).need).toBe(3)
    // Engage is the only order; Gong Knell and the grenades are not offered, Sweeping Blow is
    expect(optionIds(take(s, dk).state)).toEqual(['engage'])
    expect(optionIds(activateOp(s, dk)).filter((i) => i.startsWith('ability:'))).toEqual([])
    expect(actionForbidden(s, s.operatives[dk]!, 'ability:fg.a.gong-knell')).toMatch(/frenzied/)
    expect(actionForbidden(s, s.operatives[dk]!, 'ability:core.a.smoke-grenade')).toMatch(/frenzied/)
    expect(actionForbidden(s, s.operatives[dk]!, 'marker:pickUp')).toMatch(/frenzied/)
    expect(actionForbidden(s, s.operatives[vd]!, 'ability:fg.a.sweeping-blow')).toBeNull()
    expect(optionIds(activateOp(s, vd))).toContain('ability:fg.a.sweeping-blow')
    // control: APL 1 whatever the changes, except the Deathknell who counts 1 higher than its APL
    const marker = s.markers[0]!
    const w0 = open({ rosterA: fgRoster(WITH_WARRIORS) })
    const w = A(w0, 'warrior')
    const raised = edit(frenzy(w0, w), (st) => void (st.operatives[w]!.aplMods = 1))
    expect(effectiveApl(raised.operatives[w]!)).toBe(3)
    expect(providerControlApl(raised, raised.operatives[w]!, marker, 3)).toBe(1)
    expect(providerControlApl(s, s.operatives[dk]!, marker, 2)).toBe(3)
    expect(providerControlApl(s0, s0.operatives[A(s0, 'gnarlscar')]!, marker, 2)).toBe(2)
  })

  it('TEAM-FG-007 TEAM-FG-008 Frenzy deaths: the second normal strike, a critical strike, a critical shooting die or two normal dice in one Shoot kill; Devastating, Hot and direct damage never do', () => {
    {
      const s0 = open({ rosterA: fgRoster(WITH_WARRIORS) })
      const wr = A(s0, 'warrior')
      const boy = B(s0, 'boy')
      const s = frenzy(place(s0, wr, 0, 0), wr)
      const w = (st: GameState) => st.operatives[wr]!.wounds
      const one = hit(s, wr, boy, 'kom.w.choppa', [[4, 'strike-normal']])
      expect(one.dealt).toEqual([0])
      expect(w(one.state)).toBe(1)
      // the second strike counts even from a later Fight action against another enemy
      const two = hit(one.state, wr, B(s0, 'grot'), 'kom.w.choppa', [[2, 'strike-normal']])
      expect(w(two.state)).toBe(0)
      expect(w(hit(s, wr, boy, 'kom.w.choppa', [[5, 'strike-crit']]).state)).toBe(0)
      expect(w(hit(s, wr, boy, 'kom.w.choppa', [[0, 'strike-crit']]).state)).toBe(1)
      // Devastating, Hot and direct damage never hurt it
      expect(hit(s, wr, boy, 'kom.w.choppa', [[9, 'devastating'], [9, 'hot'], [9, 'direct']]).dealt).toEqual([0, 0, 0])
    }
    {
      const s0 = open({ rosterA: fgRoster(WITH_WARRIORS) })
      const wr = A(s0, 'warrior')
      const boy = B(s0, 'boy')
      const s = shootingAt(frenzy(place(place(s0, wr, 0, 0), boy, 6, 0), wr), boy, wr, 'kom.w.slugga')
      const w = (st: GameState) => st.operatives[wr]!.wounds
      expect(w(hit(s, wr, boy, 'kom.w.slugga', [[3, 'normal']]).state)).toBe(1)
      expect(w(hit(s, wr, boy, 'kom.w.slugga', [[3, 'normal'], [3, 'normal']]).state)).toBe(0)
      expect(w(hit(s, wr, boy, 'kom.w.slugga', [[5, 'crit']]).state)).toBe(0)
      // a new Shoot action starts again
      const first = hit(s, wr, boy, 'kom.w.slugga', [[3, 'normal']]).state
      const next = withCtx(first, (ctx) => void expireEffects(ctx, 'action')).state
      expect(w(hit(next, wr, boy, 'kom.w.slugga', [[3, 'normal']]).state)).toBe(1)
      // a Blast secondary is a sequence of its own
      const secondary = edit(first, (st) => void (st.attack!.index = 1))
      expect(w(hit(secondary, wr, boy, 'kom.w.slugga', [[3, 'normal']]).state)).toBe(1)
      expect(w(hit(secondary, wr, boy, 'kom.w.slugga', [[3, 'normal'], [3, 'normal']]).state)).toBe(0)
    }
  })

  it('TEAM-FG-009 TEAM-FG-010 Frenzy ends with the activation (or the counteraction, or the battle) and is scored once: one kill log entry, one operative.removed, no second kill op', () => {
    const calls: { cause: string; killerId: string | null }[] = []
    registerHook('operative.removed', (c) => void calls.push({ cause: (c.data as { cause: string }).cause, killerId: (c.data as { killerId: string | null }).killerId }) as never, 'fg.test.spy')
    try {
      const s0 = open({ rosterA: fgRoster(WITH_WARRIORS) })
      const wr = A(s0, 'warrior')
      const boy = B(s0, 'boy')
      const gun = ranged('t.gun', { atk: 4, hit: 3, dmg: { normal: 5, crit: 6 } })
      let s = arm(withWeapons(place(place(s0, wr, 0, 0), boy, 6, 0), gun), boy, ['t.gun'])
      s = edit(s, (st) => void (st.operatives[wr]!.wounds = 4))
      const r = shootAt(bTurn(s, A(s0, 'ironhorn')), boy, 't.gun', wr, dice(3, 3, 3, 1, 1, 1, 1))
      expect(calls).toEqual([{ cause: 'scored', killerId: boy }])
      // it lives through the enemy's activation, dies as its own ends, and nothing is counted twice
      let t = take(r.state, 'end').state
      while (t.pending!.kind === 'ploy.firefight') t = passIt(t).state
      expect(t.operatives[wr]!.status).toBe('active')
      t = take(activateOp(t, wr), 'end').state
      expect(t.operatives[wr]!.status).toBe('removed')
      expect(t.mission!.kills.B).toBe(1)
      expect(t.kills).toHaveLength(1)
      expect(t.kills![0]!.removedLater).toBe(true)
      expect(calls).toHaveLength(1)
      // the end of a counteraction kills it too (counteraction.end, once it performed an action), and the last turning
      // point's end (not an earlier one)
      const frenzied = frenzy(place(s0, wr, 0, 0), wr)
      const counter = edit(frenzied, (st) => void (st.firefight.activation = { operativeId: wr, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }))
      const counterEnd = (performed: string[]) =>
        withCtx(counter, (ctx) => {
          runHook('counteraction.end', { seat: 'A', state: ctx.state, engine: ctx, operativeId: wr, data: { performed, removed: false } })
          runDeferredRemovals(ctx)
        }).state
      expect(counterEnd(['reposition']).operatives[wr]!.status).toBe('removed')
      // a counteraction ended without an action was declined: the operative lives on
      expect(counterEnd([]).operatives[wr]!.status).toBe('active')
      // the action's end alone no longer kills it (the counteraction may go on: a bonus action)
      const midway = withCtx(counter, (ctx) => void runHook('action.ended', { seat: 'A', state: ctx.state, engine: ctx, operativeId: wr, data: { action: 'reposition', counteract: true, free: false, activeSeat: 'A' } })).state
      expect(midway.operatives[wr]!.status).toBe('active')
      const endOf = (n: number) => withCtx(frenzied, (ctx) => void runHook('turningPoint.end', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: n } })).state.operatives[wr]!.status
      expect([endOf(2), endOf(4)]).toEqual(['active', 'removed'])
    } finally {
      unregisterHook('operative.removed', 'fg.test.spy')
    }
  })

  it('TEAM-FG-011 TEAM-FG-012 TEAM-FG-033 WAR GONG, the Warrior never injured while frenzied, and SWEEPING BLOW (D3+1 to everything within 2", friends too, can push a friend into Frenzy)', () => {
    {
      const s0 = open({ rosterA: fgRoster([...WITH_WARRIORS.slice(0, 1), 'fg.warrior', 'fg.warrior', 'fg.warrior', 'fg.deathknell', 'fg.gorehorn', 'fg.herd-goad', 'fg.shaman', 'fg.toxhorn', 'fg.vandal']) })
      const wr = A(s0, 'warrior')
      const dk = A(s0, 'deathknell')
      const boy = B(s0, 'boy')
      const gun = ranged('t.gun', { atk: 4, hit: 3, dmg: { normal: 3, crit: 5 } })
      const melta = ranged('t.melta', { atk: 4, hit: 3, dmg: { normal: 6, crit: 3 } })
      const club = melee('t.club', { atk: 4, hit: 3, dmg: { normal: 3, crit: 5 } })
      const base = withWeapons(place(place(place(s0, wr, 0, 0), dk, 2, 0), boy, -6, 0), gun, melta, club)
      const crit = (st: GameState, weapon: string) => hit(shootingAt(st, boy, wr, weapon), wr, boy, weapon, [[weapon === 't.melta' ? 3 : 5, 'crit']]).dealt[0]
      expect(crit(base, 't.gun')).toBe(3)
      expect(crit(place(base, dk, 5.5, 0), 't.gun')).toBe(5)
      expect(crit(frenzy(base, dk), 't.gun')).toBe(5)
      expect(crit(base, 't.melta')).toBe(3)
      // against a frenzied Warrior a converted shooting crit is a normal die: it survives one, the second kills
      const f = frenzy(base, wr)
      const sh = shootingAt(f, boy, wr, 't.gun')
      expect(hit(sh, wr, boy, 't.gun', [[5, 'crit']]).state.operatives[wr]!.wounds).toBe(1)
      expect(hit(sh, wr, boy, 't.gun', [[5, 'crit'], [5, 'crit']]).state.operatives[wr]!.wounds).toBe(0)
      // a crit strike in a fight deals Normal Dmg but still kills
      expect(hit(f, wr, boy, 't.club', [[5, 'strike-crit']]).state.operatives[wr]!.wounds).toBe(0)
      // the Deathknell protects itself, and the fight crit of a non-Fellgor target is untouched
      expect(hit(base, dk, boy, 't.club', [[5, 'strike-crit']]).dealt[0]).toBe(3)
      expect(hit(base, boy, wr, 't.club', [[5, 'strike-crit']]).dealt[0]).toBe(5)
      // FRENZY and the Warrior: not injured on 1 wound (Move 6, Hit unchanged); the Gorehorn is
      expect(effectiveMove(f.operatives[wr]!, f)).toBe(6)
      expect(attackStats(f, wr, 'fg.w.bludgeon', boy, { kind: 'fight' }).need).toBe(3)
      const gh = A(s0, 'gorehorn')
      expect(effectiveMove(frenzy(s0, gh).operatives[gh]!, frenzy(s0, gh))).toBe(4)
      expect(fired('fgWarGong')).toBeGreaterThan(0)
      expect(fired('fgWarriorFrenzy')).toBeGreaterThan(0)
    }
    {
      const s0 = open({ rosterA: fgRoster(WITH_WARRIORS) })
      const vd = A(s0, 'vandal')
      const wr = A(s0, 'warrior')
      const boy = B(s0, 'boy')
      const s = edit(place(place(place(s0, vd, 0, 0), boy, 1.5, 0), wr, -1.5, 0), (st) => void (st.operatives[wr]!.wounds = 2))
      expect(optionIds(activateOp(s, vd))).toContain('ability:fg.a.sweeping-blow')
      expect(optionIds(activateOp(s, vd, 'conceal'))).not.toContain('ability:fg.a.sweeping-blow')
      const r = take(activateOp(s, vd), 'ability:fg.a.sweeping-blow', dice(6, 2)).state
      // the enemy takes ceil(6/2) + 1 = 4 first, the friend 1 + 1 = 2: Frenzy
      expect(r.operatives[boy]!.wounds).toBe(r.operatives[boy]!.maxWounds - 4)
      expect(r.operatives[wr]!.wounds).toBe(1)
      expect(isFrenzied(r, r.operatives[wr]!)).toBe(true)
      expect(r.firefight.activation!.apSpent).toBe(1)
    }
  })

  it('TEAM-FG-013 TEAM-FG-014 TEAM-FG-015 TEAM-FG-017 CALL THE ATTACK, GONG KNELL, BLADE WHIRL and SAGACIOUS', () => {
    {
      const g = parked(toGambit({ rosterA: fgRoster(ALL) }))
      const iron = A(g, 'ironhorn')
      const dk = A(g, 'deathknell')
      const fx = A(g, 'fluxbray')
      const gn = A(g, 'gnarlscar')
      const mg = A(g, 'mangler')
      const placed = place(place(place(place(place(g, iron, -5, 0), dk, -3, 0), fx, -3, 2), gn, -8.5, 0), mg, 6, 0)
      const offers = (st: GameState) => offersFor(st, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).filter((o) => o.ployId === 'fg.p.call-the-attack')
      expect(offers(placed).map((o) => o.param).sort()).toEqual([iron, dk, fx, gn].sort())
      expect(offers(placed).every((o) => o.cost === 0)).toBe(true)
      expect(offers(frenzy(placed, iron))).toEqual([])
      expect(offers(edit(placed, (st) => void (st.operatives[iron]!.status = 'removed')))).toEqual([])
      const used = usePlayed(placed, 'fg.p.call-the-attack', {}, dk)
      expect(used.pending!.kind).toBe('ability.choice')
      expect(optionIds(used)).toEqual(expect.arrayContaining([dk, iron, fx, 'done']))
      expect(optionIds(used)).not.toContain(gn)
      // the Fluxbray first: a free Dash (optional), then the choice continues with the rest
      const dash = take(used, fx).state
      expect(dash.pending!.kind).toBe('move.path')
      const after = play(dash, dice(), goTo(-3, 3.5), ['ability.choice']).state
      expect(after.operatives[fx]!.pos.z).toBeCloseTo(3.5, 1)
      expect(optionIds(after)).not.toContain(fx)
      expect(optionIds(after)).toContain(dk)
      // used once per turning point
      expect(offers(used)).toEqual([])
    }
    {
      const s0 = open({ rosterA: fgRoster(ALL) })
      const dk = A(s0, 'deathknell')
      const boy = B(s0, 'boy')
      const rules = parseRules(effectiveRules(s0, s0.operatives[boy]!, s0.data.weapons['kom.w.slugga']!, 'shoot', dk))
      const need = (st: GameState) => defenceStats(st, dk, boy, 'kom.w.slugga', rules, false).need
      expect(need(s0)).toBe(4)
      const used = take(activateOp(s0, dk), 'ability:fg.a.gong-knell').state
      expect(used.firefight.activation!.apSpent).toBe(1)
      expect(tokenCount(used, dk, 'fg.gongKnell')).toBe(1)
      expect(need(used)).toBe(3)
      // other Fellgor are untouched
      expect(defenceStats(used, A(s0, 'gorehorn'), boy, 'kom.w.slugga', rules, false).need).toBe(5)
      // the token goes when the Deathknell next activates
      const next = withCtx(used, (ctx) => void tokensOnActivationStart(ctx, dk)).state
      expect(tokenCount(next, dk, 'fg.gongKnell')).toBe(0)
      expect(need(next)).toBe(4)
    }
    {
      const s0 = open({ rosterA: fgRoster(ALL) })
      const fx = A(s0, 'fluxbray')
      const gn = A(s0, 'gnarlscar')
      const boy = B(s0, 'boy')
      const club = melee('t.club', { atk: 4, hit: 3, dmg: { normal: 1, crit: 1 } })
      const base = arm(withWeapons(s0, club), boy, ['t.club'])
      const firstResolve = (st: GameState, target: string, rng = dice(4, 4, 4, 4, 4, 4, 4, 4)) => {
        const t = bTurn(facing(st, target, boy), A(s0, 'ironhorn'))
        const f = take(take(activateOp(t, boy, 'engage', rng), 'fight', rng).state, target, rng).state
        return play(f, rng, {}, ['fight.resolve']).state.pending!
      }
      const p = firstResolve(base, fx)
      expect(p.kind).toBe('fight.resolve')
      expect(p.seat).toBe('A')
      expect(p.options!.every((o) => o.id.startsWith('block'))).toBe(true)
      // no Blade Whirl for the Gnarlscar: the attacker's side resolves first, and may strike
      const q = firstResolve(base, gn)
      expect(q.seat).toBe('B')
      expect(q.options!.some((o) => o.id.startsWith('strike'))).toBe(true)
      // frenzied, it resolves in the normal order
      expect(firstResolve(frenzy(base, fx), fx).seat).toBe('B')
      expect(fired('fgBladeWhirl')).toBeGreaterThan(0)
    }
    {
      const s0 = open({ rosterA: fgRoster(ALL) })
      const gn = A(s0, 'gnarlscar')
      const ended = take(activateOp(s0, gn), 'end').state
      expect(ended.pending!.kind).toBe('ploy.firefight')
      expect(optionIds(ended)).toContain('fg.x.sagacious')
      const done = take(ended, 'fg.x.sagacious').state
      expect(done.operatives[gn]!.order).toBe('conceal')
      expect(done.players.A.cp).toBe(ended.players.A.cp)
      const info = { window: 'firefight.activationEnded', subjectId: gn }
      expect(offersFor(ended, 'A', 'firefight.activationEnded', { ...info, counteracting: true }).some((o) => o.ployId === 'fg.x.sagacious')).toBe(false)
      expect(offersFor(frenzy(ended, gn), 'A', 'firefight.activationEnded', { ...info, counteracting: false }).some((o) => o.ployId === 'fg.x.sagacious')).toBe(false)
    }
  })

  it('TEAM-FG-016 TEAM-FG-018 CLEAVER FLURRY (a Fall Back path of Move + 2" through control ranges, D3+1 to each enemy passed) and UNCOMPROMISING ATTACK (a free Fight and a free autopistol Shoot in either order)', () => {
    {
      const s0 = open({ rosterA: fgRoster(ALL) })
      const fx = A(s0, 'fluxbray')
      const b1 = B(s0, 'boy')
      const b2 = B(s0, 'grot')
      const s = place(place(place(s0, fx, 0, 0), b1, 3, 1.9), b2, 6, -1.9)
      const t = take(activateOp(s, fx), 'ability:fg.a.cleaver-flurry').state
      expect(t.pending!.kind).toBe('move.path')
      expect(t.pending!.context.maxInches).toBe(8)
      // an end spot inside an enemy control range is refused
      const bad = step(t, { type: 'move.path', seat: 'A', decisionId: t.pending!.id, payload: { waypoints: [{ x: 4, z: 0 }] } })
      expect(bad.rejection).toBeDefined()
      // the full 8" past both: 4 then 6 on the D3 rolls (3 and 4 damage)
      const done = step(t, { type: 'move.path', seat: 'A', decisionId: t.pending!.id, payload: { waypoints: [{ x: 8, z: 0 }] } }, dice(4, 6))
      expect(done.rejection).toBeUndefined()
      const r = done.state
      expect(r.operatives[fx]!.pos.x).toBeCloseTo(8, 1)
      expect(r.operatives[b1]!.wounds).toBe(r.operatives[b1]!.maxWounds - 3)
      expect(r.operatives[b2]!.wounds).toBe(r.operatives[b2]!.maxWounds - 4)
      expect(evs(done.events, 'ApSpent').map((e) => e.amount)).toEqual([2])
      // not offered on Conceal, in an enemy control range, or frenzied
      expect(optionIds(activateOp(s, fx, 'conceal'))).not.toContain('ability:fg.a.cleaver-flurry')
      expect(optionIds(activateOp(place(s, fx, 3, 0.3), fx))).not.toContain('ability:fg.a.cleaver-flurry')
      expect(optionIds(activateOp(frenzy(s, fx), fx))).not.toContain('ability:fg.a.cleaver-flurry')
      // an ordinary Reposition still has its plain limit afterwards
      expect(take(activateOp(s, fx), 'reposition').state.pending!.context.maxInches).toBe(6)
    }
    {
      const s0 = open({ rosterA: fgRoster(WITH_WARRIORS.slice(0, 1).concat(['fg.warrior', 'fg.gnarlscar', 'fg.deathknell', 'fg.gorehorn', 'fg.herd-goad', 'fg.shaman', 'fg.toxhorn', 'fg.vandal', 'fg.fluxbray'])) })
      const gn = A(s0, 'gnarlscar')
      const wr = A(s0, 'warrior')
      const boy = B(s0, 'boy')
      const s = edit(place(place(place(s0, gn, 0, 0), boy, 1.4, 0), wr, 1.4, 1.4), (st) => {
        st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 60
      })
      const offered = optionIds(activateOp(s, gn))
      expect(offered).toEqual(expect.arrayContaining(['ability:fg.a.uncompromising-attack:fight', 'ability:fg.a.uncompromising-attack:shoot']))
      const order = (first: string) => {
        const t = take(activateOp(s, gn), `ability:fg.a.uncompromising-attack:${first}`).state
        const r = play(t, dice(), { 'fight.resolve': strikes['fight.resolve'] })
        return { r, kinds: r.events.filter((e) => e.type === 'FightEnded' || e.type === 'ShootEnded').map((e) => e.type) }
      }
      expect(order('fight').kinds).toEqual(['FightEnded', 'ShootEnded'])
      const shootFirst = order('shoot')
      expect(shootFirst.kinds).toEqual(['ShootEnded', 'FightEnded'])
      // the whole thing cost 1 AP and the Shoot used the autopistol, point-blank, at an enemy in its control range
      expect(evs(shootFirst.r.events, 'ApSpent').filter((e) => e.operativeId === gn).map((e) => e.amount)).toEqual([1])
      const targeted = shootFirst.r.events.find((e) => e.type === 'TargetSelected')
      expect(targeted).toMatchObject({ targetId: boy, weaponId: 'fg.w.autopistol' })
    }
  })

  it('TEAM-FG-019 TEAM-FG-020 TEAM-FG-021 TEAM-FG-022 CHAMPION and HEADTAKER, WHIP CONTROL, INCITE FURY and TACTUAL HUNTER', () => {
    {
      const s0 = open({ rosterA: fgRoster(ALL) })
      const gh = A(s0, 'gorehorn')
      const boy = B(s0, 'boy')
      expect(maxRepeats(s0, s0.operatives[gh]!, 'fight', ['fight'])).toBe(2)
      expect(maxRepeats(s0, s0.operatives[A(s0, 'gnarlscar')]!, 'fight', ['fight'])).toBe(1)
      const s = edit(s0, (st) => {
        st.operatives[gh]!.wounds = 5
        st.operatives[boy]!.wounds = 2
      })
      const crit = (st: GameState) => weaponDamage(st, gh, 'fg.w.skullcleaver', boy, 'fight').crit
      expect(crit(s)).toBe(5)
      // the kill rolls a 4: D3 = 2
      const k1 = hit(s, boy, gh, 'fg.w.skullcleaver', [[4, 'strike-normal']], dice(4))
      expect(k1.state.operatives[gh]!.wounds).toBe(7)
      expect(crit(k1.state)).toBe(7)
      expect(usedThisBattle(k1.state, 'A', `fg.fightKill:${gh}`)).toBe(true)
      // a second kill rolls a 6 (3): wounds back, Critical Dmg capped at 8
      const k2 = hit(edit(k1.state, (st) => void (st.operatives[boy]!.wounds = 2)), boy, gh, 'fg.w.skullcleaver', [[4, 'strike-normal']], dice(6))
      expect(k2.state.operatives[gh]!.wounds).toBe(10)
      expect(crit(k2.state)).toBe(8)
      // frenzied: nothing regained, the Dmg still rises; another weapon of the Gorehorn does not count
      const f = hit(frenzy(s, gh), boy, gh, 'fg.w.skullcleaver', [[4, 'strike-normal']], dice(4))
      expect(f.state.operatives[gh]!.wounds).toBe(1)
      expect(crit(f.state)).toBe(7)
      expect(crit(hit(s, boy, gh, 'fg.w.autopistol', [[4, 'strike-normal']], dice(4)).state)).toBe(5)
      expect(fired('fgHeadtaker')).toBeGreaterThan(0)
    }
    {
      const s0 = open({ rosterA: fgRoster(['fg.ironhorn', 'fg.herd-goad', 'fg.warrior', 'fg.warrior', 'fg.shaman', 'fg.deathknell', 'fg.gorehorn', 'fg.toxhorn', 'fg.vandal', 'fg.fluxbray']) })
      const hg = A(s0, 'herd-goad')
      const boy = B(s0, 'boy')
      const grot = B(s0, 'grot')
      const atk = (st: GameState, who: string, weapon: string) => attackStats(st, who, weapon, A(s0, 'warrior'), { kind: 'fight' }).atk
      const near = place(place(s0, hg, 0, 0), boy, 2.5, 0)
      expect(atk(near, boy, 'kom.w.choppa')).toBe(3)
      expect(atk(place(near, boy, 6, 0), boy, 'kom.w.choppa')).toBe(4)
      expect(atk(near, grot, 'kom.w.grot-choppa')).toBe(atk(s0, grot, 'kom.w.grot-choppa'))
      // a weapon with Atk 1 stays at 1
      const one = withWeapons(near, melee('t.one', { atk: 1 }))
      expect(attackStats(arm(one, boy, ['t.one']), boy, 't.one', A(s0, 'warrior'), { kind: 'fight' }).atk).toBe(1)
      const fallBack = (st: GameState) => actionCost(st, st.operatives[boy]!, 'fallBack')
      expect(fallBack(near)).toBe(fallBack(s0) + 1)
      // a second enemy in the Herd-Goad's control range ends the whip for the first (the second is the only one in range, so it is whipped)
      const two = place(near, grot, 0, 1.6)
      expect(atk(two, boy, 'kom.w.choppa')).toBe(4)
      expect(atk(two, grot, 'kom.w.grot-choppa')).toBe(atk(s0, grot, 'kom.w.grot-choppa') - 1)
      // INCITE FURY
      const wr = A(s0, 'warrior')
      const shaman = A(s0, 'shaman')
      const iron = A(s0, 'ironhorn')
      const s = place(place(place(place(place(s0, hg, 0, 0), wr, 2, 0), shaman, 0, 2), iron, -2, 0), A(s0, 'gorehorn'), 6, 0)
      const opts = optionIds(activateOp(s, hg)).filter((i) => i.startsWith('ability:fg.a.incite-fury'))
      expect(opts).toEqual([`ability:fg.a.incite-fury:${wr}`])
      const used = take(activateOp(s, hg), `ability:fg.a.incite-fury:${wr}`).state
      expect(effectiveApl(used.operatives[wr]!)).toBe(3)
      expect(used.firefight.activation!.apSpent).toBe(1)
      expect(optionIds(activateOp(place(s, boy, 1.4, 0), hg)).some((i) => i.startsWith('ability:fg.a.incite-fury'))).toBe(false)
      expect(fired('fgWhipControl')).toBeGreaterThan(0)
    }
    {
      const s0 = open({ rosterA: fgRoster(ALL) })
      const mg = A(s0, 'mangler')
      const boy = B(s0, 'boy')
      const base = edit(facing(s0, mg, boy), (st) => {
        st.operatives[mg]!.wounds = st.operatives[mg]!.maxWounds = 80
        st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 80
      })
      const order = (expended: boolean) => {
        const s = edit(base, (st) => void (st.operatives[boy]!.ready = !expended))
        // the Mangler rolls four crits, the Boy four normal successes
        const r = fightAt(s, mg, boy, dice(6, 6, 6, 6, 4, 4, 4, 4))
        return evs(r.events, 'Struck').map((e) => (e.operativeId === mg ? 'M' : 'B')).join('')
      }
      expect(order(false)).toBe('MBMBMBMB')
      expect(order(true)).toBe('MMBMBMBB')
      expect(fired('fgTactualHunter')).toBeGreaterThan(0)
    }
  })

  it('TEAM-FG-023 TEAM-FG-024 BERSERKER (no Shoot, a guarding Mangler may only Fight, Pick Up and mission actions cost 1 more) and SAVAGE (one free Fight after the first Fight of the activation)', () => {
    const s0 = open({ rosterA: fgRoster(ALL) })
    const mg = A(s0, 'mangler')
    const boy = B(s0, 'boy')
    const grot = B(s0, 'grot')
    const armed = arm(withWeapons(s0, ranged('t.gun')), mg, ['fg.w.vicious-claws', 't.gun'])
    expect(actionForbidden(armed, armed.operatives[mg]!, 'shoot')).toMatch(/Berserker/)
    expect(usableRangedWeapons(armed, armed.operatives[mg]!, [])).toEqual([])
    expect(hasOption(activateOp(place(armed, boy, 6, 0), mg), 'shoot')).toBe(false)
    const duel = facing(armed, mg, boy)
    expect(interruptActions(duel, duel.operatives[mg]!)).toEqual(['fight'])
    expect(providerCostDelta(s0, s0.operatives[mg]!, 'marker:pickUp')).toBe(1)
    expect(providerCostDelta(s0, s0.operatives[mg]!, 'ability:core.a.secure')).toBe(1)
    expect(providerCostDelta(s0, s0.operatives[mg]!, 'ability:core.a.smoke-grenade')).toBe(0)
    expect(providerCostDelta(s0, s0.operatives[A(s0, 'vandal')]!, 'marker:pickUp')).toBe(0)
    // SAVAGE: after the first Fight a window offers the free Fight (0 CP); after the second no third
    const base = edit(place(facing(s0, mg, boy), grot, 0, 1.4), (st) => {
      for (const id of [boy, grot, mg]) st.operatives[id]!.wounds = st.operatives[id]!.maxWounds = 80
    })
    const rng = dice(6, 6, 6, 6, 1, 1, 1, 1)
    const t = take(activateOp(base, mg, 'engage', rng), 'fight', rng).state
    const first = play(take(t, boy, rng).state, rng, { 'fight.resolve': strikes['fight.resolve'] }, ['ploy.firefight', 'firefight.action'])
    let ws = first.state
    // (the Animalistic Fury window comes first: pass it)
    while (ws.pending!.kind === 'ploy.firefight' && !optionIds(ws).includes('fg.x.savage')) ws = play(passIt(ws, rng).state, rng, { 'fight.resolve': strikes['fight.resolve'] }, ['ploy.firefight', 'firefight.action']).state
    expect(ws.pending!.kind).toBe('ploy.firefight')
    expect(optionIds(ws)).toContain('fg.x.savage')
    const cp = ws.players.A.cp
    const second = take(ws, 'fg.x.savage', rng).state
    expect(second.players.A.cp).toBe(cp)
    expect(second.pending!.kind).toBe('fight.target')
    const rng2 = dice(6, 6, 6, 6, 1, 1, 1, 1)
    let done = play(take(second, grot, rng2).state, rng2, { 'fight.resolve': strikes['fight.resolve'] }, ['ploy.firefight', 'firefight.action'])
    // the window carries on without a second Savage, and the Fight action is not offered again
    let end = done.state
    const evAll = [...first.events, ...done.events]
    void evAll
    while (end.pending!.kind === 'ploy.firefight') {
      expect(optionIds(end)).not.toContain('fg.x.savage')
      done = play(passIt(end, rng2).state, rng2, { 'fight.resolve': strikes['fight.resolve'] }, ['ploy.firefight', 'firefight.action'])
      evAll.push(...done.events)
      end = done.state
    }
    expect(end.pending!.kind).toBe('firefight.action')
    expect(hasOption(end, 'fight')).toBe(false)
    // the Mangler had nothing left to do: its activation ended after exactly one AP and two Fights, and B is up
    expect(end.firefight.activation!.seat).toBe('B')
    expect(end.operatives[mg]!.ready).toBe(false)
    expect(end.operatives[boy]!.wounds).toBeLessThan(80)
    expect(end.operatives[grot]!.wounds).toBeLessThan(80)
  })

  it('TEAM-FG-025 TEAM-FG-026 TEAM-FG-028 TEAM-FG-029 TEAM-FG-030 APOPLECTIC REJUVENATION, MANTLE OF DARKNESS, TOXIC BLESSINGS, POX BOMB and VICIOUS BLOWS', () => {
    {
      const s0 = open({ rosterA: fgRoster(WITH_WARRIORS) })
      const sh = A(s0, 'shaman')
      const wr = A(s0, 'warrior')
      const boy = B(s0, 'boy')
      const s = edit(place(place(s0, sh, 0, 0), wr, 4, 0), (st) => {
        st.operatives[wr]!.wounds = 2
        st.operatives[sh]!.wounds = 5
      })
      const id = (who: string) => `ability:fg.a.apoplectic-rejuvenation:${who}`
      expect(optionIds(activateOp(s, sh))).toEqual(expect.arrayContaining([id(wr), id(sh)]))
      const healed = take(activateOp(s, sh), id(wr), dice(2, 4)).state
      expect(healed.operatives[wr]!.wounds).toBe(5)
      expect(healed.firefight.activation!.apSpent).toBe(1)
      // capped at the starting wounds; out of 6" and frenzied are not offered
      expect(take(activateOp(s, sh), id(wr), dice(6, 6)).state.operatives[wr]!.wounds).toBe(8)
      expect(optionIds(activateOp(place(s, wr, 7.5, 0), sh))).not.toContain(id(wr))
      expect(optionIds(activateOp(frenzy(s, wr), sh))).not.toContain(id(wr))
      expect(optionIds(activateOp(place(s, boy, 1.4, 0), sh)).some((i) => i.startsWith('ability:fg.a.apoplectic'))).toBe(false)
      // a fight kill unlocks 6; a shooting kill does not
      const weak = edit(s, (st) => void (st.operatives[boy]!.wounds = 1))
      const melee6 = hit(weak, boy, wr, 'fg.w.bludgeon', [[9, 'strike-normal']]).state
      const shot = hit(weak, boy, wr, 'fg.w.autopistol', [[9, 'normal']]).state
      expect(usedThisBattle(melee6, 'A', `fg.fightKill:${wr}`)).toBe(true)
      expect(usedThisBattle(shot, 'A', `fg.fightKill:${wr}`)).toBe(false)
      const six = edit(melee6, (st) => void (st.operatives[wr]!.wounds = 1))
      expect(take(activateOp(six, sh), id(wr), dice(1, 1)).state.operatives[wr]!.wounds).toBe(7)
    }
    {
      const s0 = open({ rosterA: fgRoster(WITH_WARRIORS) })
      const sh = A(s0, 'shaman')
      const wr = A(s0, 'warrior')
      const boy = B(s0, 'boy')
      const seek = ranged('t.seek', { atk: 4, hit: 3, dmg: { normal: 3, crit: 4 } }, [{ rule: 'seek' }])
      const wall = feature('fg-wall', part('fg-wall.a', rect(3, 3.4, -2, 2), 1, ['light']))
      let s = withWeapons(place(place(place(s0, boy, -2, 0), wr, 4, 0), sh, 4, 2), seek)
      s = edit(arm(s, boy, ['t.seek']), (st) => {
        st.map = { ...st.map, features: [wall] }
        for (const o of Object.values(st.operatives)) o.order = 'engage'
        st.operatives[wr]!.order = 'conceal'
      })
      const targets = (st: GameState) => validTargets(st, st.operatives[boy]!, 't.seek').map((t) => t.id)
      expect(targets(s)).toContain(wr)
      const cast = take(activateOp(s, sh), 'ability:fg.a.mantle-of-darkness').state
      expect(tokenCount(cast, sh, 'fg.mantle')).toBe(1)
      expect(targets(cast)).not.toContain(wr)
      expect(targets(cast)).toContain(sh)
      // within 2" of the shooter, on Engage, out of cover, and a Shaman too far away: pickable again
      expect(targets(place(cast, boy, 1.5, 0))).toContain(wr)
      expect(targets(edit(cast, (st) => void (st.operatives[wr]!.order = 'engage')))).toContain(wr)
      expect(targets(place(cast, wr, 6, 0))).toContain(wr)
      expect(targets(place(cast, sh, 4, 6))).toContain(wr)
      // the token goes when the Shaman next activates
      expect(targets(withCtx(cast, (ctx) => void tokensOnActivationStart(ctx, sh)).state)).toContain(wr)
      expect(fired('fgMantleOfDarkness')).toBeGreaterThan(0)
    }
    {
      const s0 = open({ rosterA: fgRoster(ALL), equipmentA: [] })
      const tx = A(s0, 'toxhorn')
      const boy = B(s0, 'boy')
      // TOXIC BLESSINGS
      const stunned = withCtx(s0, (ctx) => {
        applyAplEffect(ctx, tx, -1, 'stun')
        refreshFlags(ctx.state)
      }).state
      expect(effectiveApl(stunned.operatives[tx]!)).toBe(2)
      expect(effectiveApl(withCtx(stunned, (ctx) => applyAplEffect(ctx, tx, 1, 'fg.a.incite-fury')).state.operatives[tx]!)).toBe(3)
      expect(effectiveApl(withCtx(s0, (ctx) => applyAplEffect(ctx, A(s0, 'vandal'), -1, 'stun')).state.operatives[A(s0, 'vandal')]!)).toBe(1)
      const shock = melee('t.shock', {}, [{ rule: 'shock' }])
      const rulesOf = (st: GameState, target: string) => effectiveRules(st, st.operatives[boy]!, shock, 'fight', target).map((r) => r.rule)
      const withShock = withWeapons(s0, shock)
      expect(rulesOf(withShock, tx)).toEqual([])
      expect(rulesOf(withShock, A(s0, 'gorehorn'))).toEqual(['shock'])
      const gun = ranged('t.gun', { atk: 4, hit: 3, dmg: { normal: 4, crit: 6 } })
      const d6 = (roll: number, list: [number, string][]) => hit(shootingAt(withWeapons(s0, gun), boy, tx, 't.gun'), tx, boy, 't.gun', list, dice(roll)).dealt
      expect(d6(5, [[4, 'normal']])).toEqual([3])
      expect(d6(4, [[4, 'normal']])).toEqual([4])
      expect(d6(6, [[2, 'normal']])).toEqual([2])
      expect(d6(6, [[6, 'crit']])).toEqual([6])
      // POX BOMB: no grenade equipment, one Stun Grenade of its own; the test of 5 also deals 3
      const near = place(place(s0, tx, 0, 0), boy, 4, 0)
      const friend = A(s0, 'vandal')
      const withFriend = edit(place(near, friend, 4, 1.5), (st) => void 0)
      expect(optionIds(activateOp(near, tx))).toContain(`ability:fg.a.pox-bomb-stun:${boy}`)
      expect(optionIds(activateOp(near, tx)).some((i) => i.startsWith('ability:core.a.stun-grenade'))).toBe(false)
      const thrown = take(activateOp(withFriend, tx), `ability:fg.a.pox-bomb-stun:${boy}`, dice(5, 5)).state
      expect(thrown.operatives[boy]!.wounds).toBe(thrown.operatives[boy]!.maxWounds - 3)
      expect(thrown.operatives[boy]!.aplMods).toBe(-1)
      expect(thrown.operatives[friend]!.aplMods).toBe(-1)
      expect(thrown.operatives[friend]!.wounds).toBe(thrown.operatives[friend]!.maxWounds)
      expect(grenadeSource(thrown, thrown.operatives[tx]!, 'core.a.stun-grenade')).toBeNull()
      // a low test does nothing; the team's picked Stun Grenades also deal the damage once the own one is spent
      expect(take(activateOp(near, tx), `ability:fg.a.pox-bomb-stun:${boy}`, dice(2)).state.operatives[boy]!.wounds).toBe(near.operatives[boy]!.maxWounds)
      const team = open({ rosterA: fgRoster(ALL), equipmentA: ['core.e.utility-grenades'] })
      expect(grenadeSource(team, team.operatives[tx]!, 'core.a.stun-grenade')).toBe('own')
      const spent = edit(team, (st) => {
        st.ledger.A.uses[`own:${tx}:core.a.stun-grenade`] = 1
      })
      expect(grenadeSource(spent, spent.operatives[tx]!, 'core.a.stun-grenade')).toBe('team')
      // VICIOUS BLOWS
      const vd = A(s0, 'vandal')
      const fightBy = (attacker: string) => edit(s0, (st) => void (st.attack = { kind: 'fight', operativeId: attacker, seat: st.operatives[attacker]!.seat, fight: { targetId: attacker === vd ? boy : vd } } as never))
      const ceaseless = (st: GameState) => effectiveRules(st, st.operatives[vd]!, st.data.weapons['fg.w.mancrusher']!, 'fight', boy).some((r) => r.rule === 'ceaseless')
      expect(ceaseless(fightBy(vd))).toBe(true)
      expect(ceaseless(fightBy(boy))).toBe(false)
      expect(ceaseless(s0)).toBe(false)
      expect(fired('fgViciousBlows')).toBeGreaterThan(0)
    }
  })

  it('TEAM-FG-031 TEAM-FG-032 TEAM-FG-034 TEAM-FG-035 VIOLENT TEMPERAMENT, AMBUSH, PELTING FIREPOWER and RECKLESS DETERMINATION', () => {
    {
      const s0 = open({ rosterA: fgRoster(WITH_WARRIORS) })
      const wr = A(s0, 'warrior')
      const boy = B(s0, 'boy')
      const flagged = withFx(edit(facing(s0, wr, boy), (st) => void (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 60)), { source: 'fg.p.violent-temperament' })
      const rng = dice(1, 1, 1, 1, 1, 1, 1, 1, 6, 6, 6, 6)
      const window = advanceTo(take(take(activateOp(flagged, wr, 'engage', rng), 'fight', rng).state, boy, rng).state, 'fg.x.violent-temperament', rng)
      expect(window.pending!.kind).toBe('ploy.firefight')
      // one die was already re-rolled by someone else: it is left alone
      const marked = edit(window, (st) => void (st.attack!.seq!.atk.dice[0]!.rerolled = true))
      const used = take(marked, 'fg.x.violent-temperament', rng).state
      const dicesA = used.attack!.seq!.atk.dice
      expect(dicesA.map((d) => d.rerolled)).toEqual([true, true, true, true])
      expect(dicesA.map((d) => d.value)).toEqual([1, 6, 6, 6])
      expect(used.players.A.cp).toBe(window.players.A.cp)
      expect(optionIds(used)).not.toContain('fg.x.violent-temperament')
      // not offered without the ploy in force
      expect(() => advanceTo(take(take(activateOp(facing(s0, wr, boy), wr, 'engage', rng), 'fight', rng).state, boy, rng).state, 'fg.x.violent-temperament', rng)).toThrow()
      // AMBUSH: Conceal to Engage, then two normal successes retain as one normal and one crit
      const kinds = (st: GameState, order: 'conceal' | 'engage', flag = true) => {
        const base = edit(facing(s0, wr, boy), (st2) => {
          st2.operatives[wr]!.order = order
          st2.operatives[boy]!.wounds = st2.operatives[boy]!.maxWounds = 60
        })
        const s1 = flag ? withFx(base, { source: 'fg.p.ambush' }) : base
        const r = fightAt(s1, wr, boy, dice(4, 4, 1, 1, 1, 1, 1, 1))
        void st
        const a = evs(r.events, 'AttackRetained').find((e) => e.operativeId === wr)!
        return [a.normal, a.crit]
      }
      expect(kinds(flagged, 'conceal')).toEqual([1, 1])
      expect(kinds(flagged, 'engage')).toEqual([2, 0])
      expect(kinds(flagged, 'conceal', false)).toEqual([2, 0])
    }
    {
      const s0 = open({ rosterA: fgRoster(WITH_WARRIORS) })
      const dk = A(s0, 'deathknell')
      const gh = A(s0, 'gorehorn')
      const hg = A(s0, 'herd-goad')
      const wr = A(s0, 'warrior')
      const boy = B(s0, 'boy')
      const rulesOf = (st: GameState, who: string) => effectiveRules(st, st.operatives[who]!, st.data.weapons['fg.w.autopistol']!, 'shoot', boy).map((r) => r.rule)
      // a real Shoot by the Deathknell writes the ledger
      const shot = shootAt(place(place(s0, dk, 0, 0), boy, 5, 0), dk, 'fg.w.autopistol', boy, dice(1, 1, 1, 1, 1, 1, 1)).state
      expect(shotBy(shot, 'A', boy)).toEqual([dk])
      const flagged = withFx(shot, { source: 'fg.p.pelting-firepower' })
      expect(rulesOf(flagged, gh)).toContain('ceaseless')
      expect(rulesOf(flagged, dk)).not.toContain('ceaseless')
      expect(rulesOf(shot, gh)).not.toContain('ceaseless')
      const two = edit(flagged, (st) => void st.ledger.A.tp.push(`fg.shot:${boy}:${hg}`))
      expect(rulesOf(two, gh)).toContain('relentless')
      expect(rulesOf(two, gh)).not.toContain('ceaseless')
      // RECKLESS DETERMINATION
      const gun = ranged('t.gun', { atk: 4, hit: 3, dmg: { normal: 2, crit: 3 } })
      const blocked = (opts: { ready: boolean; flag: boolean; cover?: boolean }) => {
        let s = arm(withWeapons(place(place(s0, wr, 0, 0), boy, 6, 0), gun), boy, ['t.gun'])
        s = edit(s, (st) => {
          st.operatives[wr]!.ready = opts.ready
          st.operatives[wr]!.wounds = st.operatives[wr]!.maxWounds = 40
          for (const o of Object.values(st.operatives)) o.order = 'engage'
          if (opts.cover) st.map = { ...st.map, features: [feature('fg-wall', part('fg-wall.a', rect(0.9, 1.3, -2, 2), 1, ['light']))] }
        })
        s = bTurn(opts.flag ? withFx(s, { source: 'fg.p.reckless-determination' }) : s, A(s0, 'ironhorn'))
        const r = shootAt(s, boy, 't.gun', wr, dice(3, 3, 3, 3, 1, 1, 1), opts.cover ? { 'shoot.coverSave': (p) => p.options!.find((o) => o.id === 'retain')!.action } : {})
        const b = evs(r.events, 'DiceBlocked')[0]
        return b ? b.blockedNormal : 0
      }
      expect(blocked({ ready: false, flag: true })).toBe(1)
      expect(blocked({ ready: false, flag: false })).toBe(0)
      expect(blocked({ ready: true, flag: true })).toBe(0)
      // in cover with a cover save to retain, the ploy adds nothing (the cover save blocks one die either way)
      expect(blocked({ ready: false, flag: true, cover: true })).toBe(blocked({ ready: false, flag: false, cover: true }))
    }
  })

  it('TEAM-FG-036 TEAM-FG-037 TEAM-FG-038 TEAM-FG-039 RUTHLESS RAMPAGE, WILD RAGE with BRASS ADORNMENTS, ANIMALISTIC FURY and BLOODSENSE', () => {
    const s0 = open({ rosterA: fgRoster(WITH_WARRIORS), equipmentA: ['fg.e.brass-adornments'] })
    const wr = A(s0, 'warrior')
    const boy = B(s0, 'boy')
    const grot = B(s0, 'grot')
    const hg = A(s0, 'herd-goad')
    const kill = edit(place(place(place(s0, wr, 0, 0), boy, 1.4, 0), grot, 4.2, 0), (st) => {
      st.operatives[boy]!.wounds = 1
    })
    // RUTHLESS RAMPAGE: the Boy falls, nothing is left in control range: a Charge of up to 3" into the Grot's
    const rng = dice(6, 6, 6, 6, 1, 1, 1, 1)
    const f = take(take(activateOp(kill, wr, 'engage', rng), 'fight', rng).state, boy, rng).state
    const w = advanceTo(f, 'fg.p.ruthless-rampage', rng)
    const cp = w.players.A.cp
    const charge = take(w, 'fg.p.ruthless-rampage', rng).state
    expect(charge.players.A.cp).toBe(cp - 1)
    expect(charge.pending!.kind).toBe('move.path')
    expect(charge.pending!.context.maxInches).toBeLessThanOrEqual(3)
    const moved = play(charge, rng, goTo(2.6, 0), ['ploy.firefight', 'firefight.action', 'firefight.activate'])
    expect(moved.state.operatives[wr]!.pos.x).toBeCloseTo(2.6, 1)
    // not offered while an enemy is still in control range
    const stuck = edit(kill, (st) => {
      st.operatives[boy]!.wounds = 30
      st.operatives[wr]!.order = 'engage'
    })
    const ended = { window: 'firefight.actionEnded', subjectId: wr, action: 'fight', counteracting: false }
    expect(offersFor(stuck, 'A', 'firefight.actionEnded', ended).some((o) => o.ployId === 'fg.p.ruthless-rampage')).toBe(false)
    expect(offersFor(place(stuck, boy, 9, 0), 'A', 'firefight.actionEnded', ended).some((o) => o.ployId === 'fg.p.ruthless-rampage')).toBe(true)
    // WILD RAGE and BRASS ADORNMENTS: 0 CP the first time in the battle, Move 7
    const calm = open({ rosterA: fgRoster(WITH_WARRIORS), equipmentA: ['fg.e.brass-adornments'] })
    const start = take(take(calm, wr).state, 'engage').state
    expect(start.pending!.kind).toBe('ploy.firefight')
    expect(start.pending!.options!.find((o) => o.id === 'fg.p.wild-rage')!.data!.cost).toBe(0)
    const raged = take(start, 'fg.p.wild-rage').state
    expect(raged.players.A.cp).toBe(start.players.A.cp)
    expect(usedThisBattle(raged, 'A', 'fg.brass:fg.p.wild-rage')).toBe(true)
    expect(take(raged, 'reposition').state.pending!.context.maxInches).toBe(7)
    const later = edit(raged, (st) => void (st.ledger.A.tp = []))
    expect(offersFor(later, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: A(calm, 'gorehorn'), counteracting: false }).find((o) => o.ployId === 'fg.p.wild-rage')!.cost).toBe(1)
    // ANIMALISTIC FURY: armed once the dice are final, +1 on the first critical strike only
    const big = edit(facing(s0, wr, boy), (st) => void (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 60))
    const strikesOf = (st: GameState, buy: boolean) => {
      const r2 = dice(6, 6, 6, 6, 1, 1, 1, 1)
      let t = take(take(activateOp(st, wr, 'engage', r2), 'fight', r2).state, boy, r2).state
      if (buy) t = take(advanceTo(t, 'fg.p.animalistic-fury', r2), 'fg.p.animalistic-fury', r2).state
      const p = play(t, r2, { 'ploy.firefight': (q) => act.pass(q), 'fight.resolve': strikes['fight.resolve'] })
      return 60 - p.state.operatives[boy]!.wounds
    }
    expect(strikesOf(big, false)).toBe(16)
    expect(strikesOf(big, true)).toBe(17)
    // BLOODSENSE: the second Warrior (3" from the fallen Boy) activates next
    const buddy = place(kill, A(kill, 'herd-goad'), 0.5, 2.4)
    void hg
    const r3 = dice(6, 6, 6, 6, 1, 1, 1, 1)
    const kd = take(take(activateOp(buddy, wr, 'engage', r3), 'fight', r3).state, boy, r3).state
    const bs = advanceTo(kd, `fg.p.bloodsense:${A(kill, 'herd-goad')}`, r3)
    // the offer comes from the kill log, written when the Boy was removed (no damage-time note any more)
    expect(bs.kills!.filter((k) => k.removedId === boy)).toMatchObject([{ killerId: wr, cause: 'attack' }])
    expect(bs.effects.some((e) => e.kind === 'fg.killedInAction')).toBe(false)
    const picked = take(bs, `fg.p.bloodsense:${A(kill, 'herd-goad')}`, r3).state
    let end = picked
    while (end.pending!.kind === 'ploy.firefight') end = passIt(end, r3).state
    end = take(end, 'end', r3).state
    while ((end.pending!.kind as string) === 'ploy.firefight') end = passIt(end, r3).state
    expect(end.pending!.kind).toBe('firefight.activate')
    expect(end.pending!.seat).toBe('A')
    expect(optionIds(end)).toEqual([A(kill, 'herd-goad')])
  })

  it('TEAM-FG-040 TEAM-FG-041 TEAM-FG-042 GORE MARKS, CHAOS SIGIL and WAR PAINT', () => {
    const s0 = open({ rosterA: fgRoster(WITH_WARRIORS), equipmentA: ['fg.e.gore-marks', 'fg.e.chaos-sigil', 'fg.e.war-paint'] })
    const wr = A(s0, 'warrior')
    const boy = B(s0, 'boy')
    const base = edit(facing(s0, wr, boy), (st) => void (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 60))
    // GORE MARKS: the Warrior rolls a 2 and three 3s; the 2 is re-rolled into another 1 (a fail): 1 + 1 damage
    const rng = dice(2, 3, 3, 3, 1, 1, 1, 1, 1)
    const w = advanceTo(take(take(activateOp(base, wr, 'engage', rng), 'fight', rng).state, boy, rng).state, 'fg.e.gore-marks:0', rng)
    expect(optionIds(w).filter((i) => i.startsWith('fg.e.gore-marks:'))).toEqual(['fg.e.gore-marks:0', 'fg.e.gore-marks:1'])
    const marked = take(w, 'fg.e.gore-marks:0', rng).state
    expect(marked.operatives[wr]!.wounds).toBe(8)
    expect(marked.attack!.seq!.atk.dice[0]).toMatchObject({ rerolled: true, kind: 'fail' })
    expect(usedThisTp(marked, 'A', 'fg.e.gore-marks')).toBe(true)
    expect(optionIds(marked).some((i) => i.startsWith('fg.e.gore-marks:'))).toBe(false)
    // on 1 wound the damage triggers Frenzy: the fight's dice are all discarded and nothing is re-rolled
    const rng2 = dice(2, 3, 3, 3, 1, 1, 1, 1, 1)
    const hurt = edit(base, (st) => void (st.operatives[wr]!.wounds = 1))
    const w2 = advanceTo(take(take(activateOp(hurt, wr, 'engage', rng2), 'fight', rng2).state, boy, rng2).state, 'fg.e.gore-marks:0', rng2)
    const f = take(w2, 'fg.e.gore-marks:0', rng2).state
    expect(isFrenzied(f, f.operatives[wr]!)).toBe(true)
    expect(f.attack!.seq!.atk.dice.every((d) => d.used)).toBe(true)
    expect(f.attack!.seq!.atk.dice[0]!.rerolled).toBe(false)
    // CHAOS SIGIL: a Piercing 1 weapon keeps all three defence dice, Piercing 2 leaves two, Piercing Crits is unchanged
    const collected = (rules: { rule: string; x?: number; crits?: boolean }[], sigil: boolean) => {
      const pw = ranged('t.pierce', { atk: 4, hit: 3, dmg: { normal: 1, crit: 2 } }, rules)
      let s = arm(withWeapons(place(place(s0, wr, 0, 0), boy, 6, 0), pw), boy, ['t.pierce'])
      s = bTurn(edit(s, (st) => void (st.operatives[wr]!.wounds = st.operatives[wr]!.maxWounds = 60)), A(s0, 'ironhorn'))
      const rng3 = dice(3, 3, 3, 3, 1, 1, 1, 1)
      const acc: GameEvent[] = []
      let t = takeEv(takeEv(takeEv(activateOp(s, boy, 'engage', rng3), 'shoot', rng3, acc), 't.pierce', rng3, acc), wr, rng3, acc)
      if (sigil) t = takeEv(advanceTo(t, 'fg.e.chaos-sigil', rng3), 'fg.e.chaos-sigil', rng3, acc)
      acc.push(...play(t, rng3, { 'ploy.firefight': (p) => act.pass(p) }, ['firefight.action']).events)
      return evs(acc, 'DefenceDiceRolled')[0]!.collected
    }
    expect(collected([{ rule: 'piercing', x: 1 }], false)).toBe(2)
    expect(collected([{ rule: 'piercing', x: 1 }], true)).toBe(3)
    expect(collected([{ rule: 'piercing', x: 2 }], true)).toBe(2)
    // WAR PAINT
    const injured = edit(s0, (st) => void (st.operatives[wr]!.wounds = 3))
    expect(effectiveMove(injured.operatives[wr]!, injured)).toBe(6)
    expect(attackStats(injured, wr, 'fg.w.bludgeon', boy, { kind: 'fight' }).need).toBe(4)
    expect(effectiveMove(frenzy(s0, A(s0, 'gorehorn')).operatives[A(s0, 'gorehorn')]!, frenzy(s0, A(s0, 'gorehorn')))).toBe(6)
    const bare = open({ rosterA: fgRoster(WITH_WARRIORS) })
    expect(effectiveMove(edit(bare, (st) => void (st.operatives[wr]!.wounds = 3)).operatives[wr]!, edit(bare, (st) => void (st.operatives[wr]!.wounds = 3)))).toBe(4)
  })

  // rules verification: free actions still count as the action they are (R-3.9), and Savage's two Fights
  it('TEAM-FG-016 CLEAVER FLURRY is not offered after a Reposition, Fall Back or Charge in the activation (its free Reposition still counts)', () => {
    const s0 = open({ rosterA: fgRoster(ALL) })
    const fx = A(s0, 'fluxbray')
    const s = activateOp(place(s0, fx, 0, 0), fx)
    const flurry = (performed: string[]) => {
      const t = edit(s, (st) => void (st.firefight.activation!.performed = performed))
      return abilityOffers(t, t.operatives[fx]!, t.firefight.activation!).some((o) => o.abilityId === 'fg.a.cleaver-flurry')
    }
    expect(flurry([])).toBe(true)
    expect(flurry(['dash'])).toBe(true)
    for (const done of ['reposition', 'fallBack', 'charge']) expect(flurry([done])).toBe(false)
  })

  it('TEAM-FG-018 UNCOMPROMISING ATTACK: its free Fight counts as the Fight action (no Fight after it, no free Fight after a Fight)', () => {
    const s0 = open({ rosterA: fgRoster(ALL) })
    const gn = A(s0, 'gnarlscar')
    const boy = B(s0, 'boy')
    const s = edit(place(place(s0, gn, 0, 0), boy, 1.4, 0), (st) => {
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 60
    })
    const toAction = (st: GameState, rng: Rng) => {
      let t = st
      for (let i = 0; i < 40 && t.pending && t.pending.kind !== 'firefight.action'; i++) {
        t = t.pending.kind === 'ploy.firefight' ? passIt(t, rng).state : play(t, rng, { 'fight.resolve': strikes['fight.resolve'] }, ['ploy.firefight', 'firefight.action']).state
      }
      return t
    }
    // UA first: 1 AP is left, but the Fight is spent (and Fall Back costs 2), so the activation ends at once
    const rng = dice()
    const after = play(take(activateOp(s, gn, 'engage', rng), 'ability:fg.a.uncompromising-attack:fight', rng).state, rng, { 'fight.resolve': strikes['fight.resolve'] }, ['ploy.firefight', 'firefight.action'])
    let w = after.state
    while (w.pending!.kind === 'ploy.firefight' && !optionIds(w).includes('fg.x.sagacious')) w = play(passIt(w, rng).state, rng, { 'fight.resolve': strikes['fight.resolve'] }, ['ploy.firefight', 'firefight.action']).state
    expect(optionIds(w)).toContain('fg.x.sagacious')
    expect(w.firefight.activation!.operativeId).toBe(gn)
    expect(w.firefight.activation!.apSpent).toBe(1)
    expect(w.firefight.activation!.performed).toEqual(['fight', 'shoot', 'ability:fg.a.uncompromising-attack'])
    // SAGACIOUS is offered once: after the change of order the window does not offer it again
    const flipped = take(w, 'fg.x.sagacious', rng).state
    expect(flipped.operatives[gn]!.order).toBe('conceal')
    if (flipped.pending!.kind === 'ploy.firefight') expect(optionIds(flipped)).not.toContain('fg.x.sagacious')
    // a Fight first: UA then gives only its free Shoot
    const rng2 = dice()
    const fought = toAction(take(take(activateOp(s, gn, 'engage', rng2), 'fight', rng2).state, boy, rng2).state, rng2)
    expect(fought.firefight.activation!.performed).toEqual(['fight'])
    const ua = play(take(fought, 'ability:fg.a.uncompromising-attack:fight', rng2).state, rng2, { 'fight.resolve': strikes['fight.resolve'] })
    expect(ua.events.filter((e) => e.type === 'FightEnded' || e.type === 'ShootEnded').map((e) => e.type)).toEqual(['ShootEnded'])
  })

  it('TEAM-FG-036 RUTHLESS RAMPAGE follows UNCOMPROMISING ATTACK only when its free Fight came last', () => {
    const s0 = open({ rosterA: fgRoster(ALL) })
    const gn = A(s0, 'gnarlscar')
    const s = activateOp(place(place(s0, gn, 0, 0), B(s0, 'boy'), 9, 0), gn)
    const ua = 'ability:fg.a.uncompromising-attack'
    const rampage = (performed: string[]) => {
      const t = edit(s, (st) => void (st.firefight.activation!.performed = performed))
      return offersFor(t, 'A', 'firefight.actionEnded', { window: 'firefight.actionEnded', subjectId: gn, action: ua, counteracting: false }).some((o) => o.ployId === 'fg.p.ruthless-rampage')
    }
    expect(rampage(['shoot', 'fight', ua])).toBe(true)
    expect(rampage(['fight', 'shoot', ua])).toBe(false)
  })

  it('TEAM-FG-024 SAVAGE: Ruthless Rampage cannot come between the two Fights, so using it gives up the free Fight', () => {
    const s0 = open({ rosterA: fgRoster(ALL) })
    const mg = A(s0, 'mangler')
    const boy = B(s0, 'boy')
    const grot = B(s0, 'grot')
    const kill = edit(place(place(place(s0, mg, 0, 0), boy, 1.4, 0), grot, 4.2, 0), (st) => {
      st.operatives[boy]!.wounds = 1
      st.operatives[grot]!.wounds = st.operatives[grot]!.maxWounds = 80
    })
    const rng = dice(6, 6, 6, 6, 1, 1, 1, 1)
    const f = take(take(activateOp(kill, mg, 'engage', rng), 'fight', rng).state, boy, rng).state
    const w = advanceTo(f, 'fg.p.ruthless-rampage', rng)
    const charge = take(w, 'fg.p.ruthless-rampage', rng).state
    const moved = play(charge, rng, goTo(2.6, 0), ['ploy.firefight', 'firefight.action', 'firefight.activate'])
    const t = moved.state
    // now in the Grot's control range, but no Savage window: the Fight is spent and the activation ends
    expect(t.operatives[mg]!.pos.x).toBeCloseTo(2.6, 1)
    expect(t.pending!.kind).toBe('firefight.activate')
    expect(t.operatives[mg]!.ready).toBe(false)
    // the same spot without the ploy used would offer it
    const info = { window: 'firefight.actionEnded', subjectId: mg, action: 'fight', counteracting: false }
    const at = (used: string[]) => edit(t, (st) => void (st.firefight.activation = { operativeId: mg, seat: 'A', counteract: false, stage: 'action', apSpent: 1, performed: ['fight'], declared: null, used }))
    expect(offersFor(at([]), 'A', 'firefight.actionEnded', info).some((o) => o.ployId === 'fg.x.savage')).toBe(true)
    expect(offersFor(at(['fg.x.rampageUsed']), 'A', 'firefight.actionEnded', info).some((o) => o.ployId === 'fg.x.savage')).toBe(false)
  })

  it('TEAM-FG-036 RUTHLESS RAMPAGE after a Guard interrupt Fight: offered at the frame reaction point (own reaction, printed cost), not after in-activation free Fights, paid when taken', () => {
    const s0 = open({ rosterA: fgRoster(WITH_WARRIORS) })
    const wr = A(s0, 'warrior')
    const boy = B(s0, 'boy')
    // a Grot 4.2 inches off is in reach of a 3 inch Charge; the Boy stands far away
    const clear = edit(bTurn(place(place(place(s0, wr, 0, 0), boy, 9, 0), B(s0, 'grot'), 4.2, 0), A(s0, 'gorehorn')), (st) => {
      st.players.A.cp = 2
      st.operatives[wr]!.order = 'engage'
    })
    const info = (extra: Record<string, boolean>) => ({ actorId: wr, action: 'fight', activeSeat: 'A' as const, moved: false, ...extra })
    const offers = providerOwnReactions(clear, 'A', info({ interrupt: true }))
    expect(offers).toMatchObject([{ hook: 'fgRuthlessRampage', operativeId: wr, freeActions: true, option: 'rampage:1' }])
    // an in-activation free Fight returns to a ploy window that offers it already; no CP, or an enemy still close: nothing
    expect(providerOwnReactions(clear, 'A', info({ freeAction: true }))).toEqual([])
    expect(providerOwnReactions(edit(clear, (st) => void (st.players.A.cp = 0)), 'A', info({ interrupt: true }))).toEqual([])
    expect(providerOwnReactions(place(clear, boy, 1.4, 0), 'A', info({ interrupt: true }))).toEqual([])
    // taken: 1 CP, the turning point's use, and a free Charge of up to 3 inches
    const r = withCtx(clear, (ctx) => getCodeHook('fgRuthlessRampage')!.choice!(ctx, ctx.state.operatives[wr]!, 'rampage:1', {})).state
    expect(r.players.A.cp).toBe(1)
    expect(usedThisTp(r, 'A', 'fg.p.ruthless-rampage')).toBe(true)
    expect(r.pending).toMatchObject({ kind: 'move.path', seat: 'A' })
    expect(r.pending!.context.maxInches).toBeLessThanOrEqual(3)
  })
})
