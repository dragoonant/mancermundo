// phobos-strike-team engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-PH-nnn).
// Phobos are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { step } from '@/engine'
import { ScriptedRng } from '@/engine/rng'
import { act } from '@/engine/actions'
import { abilityOffers, actionForbidden, canCounteractWithOrder, maxRepeats, refreshFlags } from '@/engine/abilities'
import { attackStats, commandRerollCost, effectiveRules, inflict, ruleKey, runDeferredRemovals } from '@/engine/attack-common'
import { hasKeyword } from '@/engine/conditions'
import { hookFireCount } from '@/engine/code-hooks'
import { grenadeSource } from '@/engine/core-hooks'
import { selectionProblem } from '@/engine/equipment'
import { directDamage, usedThisBattle, usedThisTp } from '@/engine/effects'
import { runHook } from '@/engine/hooks'
import { findGambit, offersFor, usePloy } from '@/engine/ploys'
import { markerControl } from '@/engine/query'
import { markerInControlRange } from '@/engine/measure'
import { bodyOf } from '@/engine/los'
import { resolvePicks } from '@/engine/operative-picks'
import { shootableWeapons } from '@/engine/shoot'
import { effectiveApl, effectiveMove } from '@/engine/state'
import {
  providerActivationBarred,
  providerCanActivate,
  providerCostDelta,
  providerCounteract,
  providerFixedTargets,
  providerInitiativeReroll,
  providerMoveSurcharge,
  providerReactions,
  providerRerollsBanned,
} from '@/engine/team-rules'
import { ensureMarkers, EXPLOSIVES, explosivesMarker, HAYWIRE, isBolt, TEAM_ID } from '@/engine/teams/phobos-strike-team'
import { hasToken, tokensOnActivationStart, tokensOnRemoval } from '@/engine/tokens'
import type { GameState, PendingDecision } from '@/engine/types'
import { CODE_HOOKS, enumerateLoadouts, loadBundle, validateOperativePicks, validateRoster, type DatacardData } from '../../../src/data'
import { evs, play } from '../../fixtures/attack'
import { feature, part, rect } from '../../fixtures/maps'
import { defaultAnswer, expectOk, place } from '../../fixtures/helpers'
import { activateOp, edit, newRealGame, optionIds, realBundle, realSetupWith, take, withCtx } from '../../fixtures/real'
import { A, B, DEFAULT_CARDS, MATCH, dice, facing, noPloys, open, phRoster, scenarios, shootBoy, startPh, strikes, takePloy, toWindow, withMarkers, withPloy } from './phobos-strike-team.hooks'

const data = loadBundle()
const MATCH_OPTS = { ...MATCH }
const NO_COMMS = ['infiltrator-sergeant', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'infiltrator-veteran', 'incursor-marksman', 'incursor-warrior']

describe('TEAM-PH Phobos Strike Team', () => {
  it('TEAM-PH-000 TEAM-PH-001 TEAM-PH-002 registration: playable team, roster rules, printed loadouts and weapons, and every code hook fires in a real game', () => {
    {
      expect(TEAM_ID).toBe('phobos-strike-team')
      const team = data.teams['phobos-strike-team']!
      const cards = realBundle.datacards
      const ok = { leader: ['ph.infiltrator-sergeant'], main: ['ph.infiltrator-warrior', 'ph.infiltrator-warrior', 'ph.incursor-warrior', 'ph.reiver-warrior', 'ph.reiver-warrior'] }
      expect(validateRoster(team, ok, cards as never).ok).toBe(true)
      for (const leader of ['ph.incursor-sergeant', 'ph.reiver-sergeant']) expect(validateRoster(team, { ...ok, leader: [leader] }, cards as never).ok).toBe(true)
      // a second Saboteur, two Sergeants, a 7th operative and a 5-operative roster are all rejected
      expect(validateRoster(team, { ...ok, main: ['ph.infiltrator-saboteur', 'ph.infiltrator-saboteur', 'ph.infiltrator-warrior', 'ph.incursor-warrior', 'ph.reiver-warrior'] }, cards as never).ok).toBe(false)
      expect(validateRoster(team, { ...ok, leader: ['ph.infiltrator-sergeant', 'ph.reiver-sergeant'] }, cards as never).ok).toBe(false)
      expect(validateRoster(team, { ...ok, main: [...ok.main, 'ph.infiltrator-commsman'] }, cards as never).ok).toBe(false)
      expect(validateRoster(team, { ...ok, main: ok.main.slice(1) }, cards as never).ok).toBe(false)
      // the three WARRIOR cards repeat freely, everything else once
      expect(validateRoster(team, { ...ok, main: Array(5).fill('ph.reiver-warrior') }, cards as never).ok).toBe(true)
      // loadouts: both Reivers take pistol and knife or carbine and fists, every other card has fixed weapons
      const count = (id: string) => enumerateLoadouts(data.byId[id] as DatacardData).length
      expect([count('ph.reiver-sergeant'), count('ph.reiver-warrior')]).toEqual([2, 2])
      for (const id of DEFAULT_CARDS.map((c) => `ph.${c}`)) expect(count(id)).toBe(1)
      const fixed = (id: string) => (data.byId[id] as DatacardData).weapons.fixed
      expect(fixed('ph.incursor-sergeant')).toEqual(['ph.w.occulus-bolt-carbine', 'ph.w.fists'])
      expect(fixed('ph.infiltrator-saboteur')).toContain('ph.w.remote-detonator')
      const reiver = (data.byId['ph.reiver-warrior'] as DatacardData).weapons.options![0]!
      expect(reiver.sets!.map((x) => x.fixed)).toEqual([['ph.w.special-issue-bolt-pistol', 'ph.w.combat-knife'], ['ph.w.bolt-carbine', 'ph.w.fists']])
      // printed numbers
      const w = realBundle.weapons
      expect([w['ph.w.stalker-marksman-bolt-carbine']!.hit, w['ph.w.remote-detonator']!.dmg, w['ph.w.combat-knife']!.dmg, w['ph.w.combat-blade']!.atk]).toEqual([2, { normal: 5, crit: 6 }, { normal: 4, crit: 5 }, 5])
      expect(new Set(team.selection.slots.flatMap((x) => x.from)).size).toBe(13)
      // Custom picks: only the Veteran has them, and they must differ
      const vet = data.byId['ph.infiltrator-veteran'] as DatacardData
      expect(validateOperativePicks(team, vet, { 'custom-1': 'RENDING', 'custom-2': 'LETHAL 5' })).toEqual([])
      expect(validateOperativePicks(team, vet, { 'custom-1': 'RENDING', 'custom-2': 'RENDING' }).length).toBeGreaterThan(0)
      expect(validateOperativePicks(team, data.byId['ph.infiltrator-warrior'] as DatacardData, { 'custom-1': 'RENDING' }).length).toBeGreaterThan(0)
      expect(resolvePicks(realBundle.teams['phobos-strike-team'], realBundle.datacards['ph.infiltrator-veteran']!, {}).picks).toEqual({ 'custom-1': 'BALANCED', 'custom-2': 'LETHAL 5' })
    }
    {
      expect(data.teams['phobos-strike-team']!.playable).toBe(true)
    }
    {
      const failures: string[] = []
      for (const [name, run] of Object.entries(scenarios)) {
        try {
          run()
        } catch (e) {
          failures.push(`${name}: ${(e as Error).message}`)
        }
      }
      expect(failures).toEqual([])
      const names = Object.keys(scenarios)
      for (const n of names) expect(hookFireCount(n), `${n} never fired`).toBeGreaterThan(0)
      // the scenarios cover exactly the hooks this team's records name
      const mine = CODE_HOOKS.filter((h) => h.usedBy.every((id) => id.startsWith('ph.'))).map((h) => h.name)
      expect(mine.sort()).toEqual([...names].sort())
    }
  })

  it('TEAM-PH-003 TEAM-PH-006 ASTARTES double actions and bolt weapons; MULTI-SPECTRUM ARRAY', () => {
    {
      const s = open({ rosterA: phRoster(['infiltrator-sergeant', 'reiver-warrior', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'infiltrator-veteran', 'incursor-marksman']) })
      const get = (id: string) => s.operatives[id]!
      const sg = A(s, 'infiltrator-sergeant')
      expect(maxRepeats(s, get(sg), 'shoot', ['shoot'])).toBe(2)
      expect(maxRepeats(s, get(sg), 'shoot', ['shoot', 'shoot'])).toBe(2)
      expect(maxRepeats(s, get(sg), 'fight', ['fight'])).toBe(2)
      // one kind or the other
      expect(maxRepeats(s, get(sg), 'fight', ['shoot', 'shoot'])).toBe(1)
      expect(maxRepeats(s, get(sg), 'shoot', ['fight', 'fight'])).toBe(1)
      expect(maxRepeats(s, get(B(s, 'boy')), 'shoot', ['shoot'])).toBe(1)
      expect(canCounteractWithOrder(edit(s, (st) => (st.operatives[sg]!.order = 'conceal')), get(sg))).toBe(true)
      expect(isBolt(s, 'ph.w.remote-detonator')).toBe(false)
      expect(isBolt(s, 'core.w.frag-grenade')).toBe(false)
      expect(isBolt(s, 'ph.w.special-issue-bolt-pistol')).toBe(true)
      expect(isBolt(s, 'ph.w.stalker-marksman-bolt-carbine')).toBe(true)
      // the same marksman carbine twice is fine; the Saboteur's second Shoot after the detonator needs the carbine
      const sab = A(s, 'infiltrator-saboteur')
      const target = B(s, 'boy')
      const second = (id: string, used: string[]) => {
        const t = edit(place(place(activateOp(place(place(s, id, 0, 0), target, 5, 0), id), id, 0, 0), target, 5, 0), (st) => {
          st.firefight.activation!.performed = ['shoot']
          st.firefight.activation!.weaponsUsed = used
        })
        return shootableWeapons(t, t.operatives[id]!, ['shoot']).map((x) => x.weaponId)
      }
      expect(second(sg, ['ph.w.marksman-bolt-carbine'])).toContain('ph.w.marksman-bolt-carbine')
      expect(second(sab, ['ph.w.remote-detonator'])).toEqual(['ph.w.marksman-bolt-carbine'])
    }
    {
      const s = open()
      const boy = B(s, 'boy')
      const status = (shooter: string) => {
        const data = { obscured: true, inCover: true }
        runHook('target.status', { seat: 'A', state: s, operativeId: shooter, targetId: boy, data: data as never })
        return data
      }
      expect(status(A(s, 'incursor-marksman'))).toEqual({ obscured: false, inCover: true })
      expect(status(A(s, 'infiltrator-sergeant'))).toEqual({ obscured: true, inCover: true })
    }
  })

  it('TEAM-PH-004 TEAM-PH-005 Omni-Scrambler bars the chosen enemy; TERROR taxes mission actions and contesting totals', () => {
    {
      const base = open({ rosterA: phRoster(['infiltrator-sergeant', 'infiltrator-commsman', 'infiltrator-helix-adept', 'incursor-marksman', 'incursor-warrior', 'reiver-warrior']) })
      const boy = B(base, 'boy')
      const s0 = place(place(base, A(base, 'infiltrator-sergeant'), 0, 0), boy, 5, 0)
      const offer = findGambit(s0, 'A', 'ph.p.omni-scrambler', boy)
      expect(offer).toBeDefined()
      expect(offer!.cost).toBe(0)
      let s = withCtx(s0, (ctx) => usePloy(ctx, 'A', offer!, { window: 'strategy.gambit' })).state
      expect(hasToken(s, boy, 'ph.omni')).toBe(true)
      expect(providerCanActivate(s, s.operatives[boy]!)).toBe(false)
      expect(actionForbidden(s, s.operatives[boy]!, 'dash')).not.toBeNull()
      expect(providerCounteract(s, s.operatives[boy]!)).toBe('never')
      expect(actionForbidden(s, s.operatives[B(base, 'boss-nob')]!, 'dash')).toBeNull()
      // three Infiltrators were in the killzone: the Boy stays out for three enemy activations
      const aIds = [A(base, 'infiltrator-sergeant'), A(base, 'infiltrator-commsman'), A(base, 'infiltrator-helix-adept'), A(base, 'incursor-marksman')]
      const bIds = [B(base, 'boss-nob'), B(base, 'burna-boy'), B(base, 'slasha-boy')]
      for (let i = 0; i < 3; i++) {
        s = take(activateOp(s, aIds[i]!), 'end').state
        expect(optionIds(s)).not.toContain(boy)
        expect(optionIds(s)).toContain(bIds[i]!)
        s = take(activateOp(s, bIds[i]!), 'end').state
      }
      s = take(activateOp(s, aIds[3]!), 'end').state
      expect(optionIds(s)).toContain(boy)
      expect(actionForbidden(s, s.operatives[boy]!, 'dash')).toBeNull()
      // the last ready enemy operative is free at once
      const last = edit(s0, (st) => {
        for (const o of Object.values(st.operatives)) if (o.seat === 'B' && o.id !== boy) o.ready = false
      })
      const lastUsed = withCtx(last, (ctx) => usePloy(ctx, 'A', offer!, { window: 'strategy.gambit' })).state
      expect(providerCanActivate(lastUsed, lastUsed.operatives[boy]!)).toBe(true)
      expect(actionForbidden(lastUsed, lastUsed.operatives[boy]!, 'dash')).toBeNull()
      // not offered without an Infiltrator in the killzone, or without an enemy to pick
      const none = open({ rosterA: phRoster(['incursor-sergeant', 'incursor-marksman', 'incursor-minelayer', 'incursor-warrior', 'reiver-warrior', 'incursor-warrior']) })
      expect(findGambit(place(none, A(none, 'incursor-marksman'), 0, 0), 'A', 'ph.p.omni-scrambler', boy)).toBeUndefined()
      const empty = edit(s0, (st) => {
        for (const o of Object.values(st.operatives)) if (o.seat === 'B') o.status = 'removed'
      })
      expect(findGambit(empty, 'A', 'ph.p.omni-scrambler', boy)).toBeUndefined()
    }
    {
      const base = open({ rosterA: phRoster(['infiltrator-sergeant', 'reiver-warrior', 'reiver-warrior', 'infiltrator-helix-adept', 'incursor-marksman', 'incursor-warrior']) })
      const boy = B(base, 'boy')
      const pos = (reiverGap: number, second = false) => {
        let s = place(place(base, 'A2', 0, 0), boy, reiverGap, 0)
        if (second) s = place(s, 'A3', 0, 1.2)
        return s
      }
      const cost = (s: GameState, action: string) => providerCostDelta(s, s.operatives[boy]!, action)
      expect(cost(pos(2.4), 'marker:pickUp')).toBe(1)
      expect(cost(pos(2.4, true), 'marker:pickUp')).toBe(1)
      expect(cost(pos(5.5), 'marker:pickUp')).toBe(0)
      const mission = Object.values(base.data.abilities).find((a) => (a.keywords ?? []).includes('MISSION'))!
      expect(cost(pos(2.4), `ability:${mission.id}`)).toBe(1)
      expect(providerCostDelta(pos(2.4), pos(2.4).operatives['A1']!, 'marker:pickUp')).toBe(0)
      // the contesting total at an objective
      const m = base.markers.find((k) => k.kind === 'objective')!
      const at = (reiverX: number) => {
        const s = place(place(base, boy, m.pos.x + 0.9, m.pos.z), 'A2', m.pos.x + 0.9 + reiverX, m.pos.z)
        return markerControl(s, m).apl.B
      }
      expect(at(2.5)).toBe(at(9) - 1)
      expect(at(4.5)).toBe(at(9))
    }
  })

  it('TEAM-PH-007 TEAM-PH-008 Tactical Advantage: initiative re-roll, a free firefight ploy, a free Command Re-roll', () => {
    {
      const lost = edit(open(), (st) => {
        st.strategy.rolls = { A: 1, B: 6 }
      })
      const offered = providerInitiativeReroll(lost, 'A')
      expect(offered.length).toBe(1)
      expect(providerInitiativeReroll(edit(lost, (st) => (st.strategy.rolls = { A: 6, B: 1 })), 'A')).toEqual([])
      const used = withCtx(lost, (ctx) => offered[0]!.onInitiativeReroll?.(ctx, 'A')).state
      expect(usedThisBattle(used, 'A', 'ph.ta.initiative')).toBe(true)
      expect(providerInitiativeReroll(used, 'A')).toEqual([])
      const down = edit(lost, (st) => {
        const sg = st.operatives[A(lost, 'infiltrator-sergeant')]!
        sg.status = 'removed'
        sg.wounds = 0
      })
      expect(providerInitiativeReroll(down, 'A')).toEqual([])
      expect(providerInitiativeReroll(lost, 'B')).toEqual([])
    }
    {
      let s = newRealGame(MATCH_OPTS, 'ph-init').state
      const rng = new ScriptedRng([6, 1, 2, 5, 6, ...Array<number>(60).fill(1)])
      for (let i = 0; i < 200 && s.pending && !(s.pending.kind === 'strategy.initiative' && s.pending.context.reroll === true); i++) s = expectOk(step(s, defaultAnswer(s), rng)).state
      expect(s.pending!.kind).toBe('strategy.initiative')
      expect(s.pending!.seat).toBe('A')
      expect(s.pending!.context.reroll).toBe(true)
      s = take(s, 'reroll', rng).state
      expect(s.initiative).toBe('A')
      expect(usedThisBattle(s, 'A', 'ph.ta.initiative')).toBe(true)
    }
    {
      const s = open()
      const sg = A(s, 'infiltrator-sergeant')
      const boy = B(s, 'boy')
      const patient = (state: GameState) => offersFor(state, 'A', 'firefight.beforeActivation', { window: 'firefight.beforeActivation', seat: 'A' }).find((o) => o.ployId === 'ph.p.patient-ambush')
      expect(patient(s)!.cost).toBe(0)
      expect(patient(s)!.via).toBe('ph.ta')
      // in an enemy control range the free Patient Ambush is not available
      expect(patient(place(place(s, sg, 0, 0), boy, 1.4, 0))!.cost).toBe(1)
      // once the battle's use is gone it costs 1 CP again
      expect(patient(edit(s, (st) => st.ledger.A.battle.push('ph.ta.ploy')))!.cost).toBe(1)
      // Critical Shot costs 0 for the Sergeant and 1 for anyone else, the use being spent once
      const cp0 = s.players.A.cp
      const shot = (state: GameState, shooter: string) => shootBoy(facing(state, shooter, boy), shooter, boy, 'ph.w.marksman-bolt-carbine', dice(6, 6, 1, 1), takePloy('ph.p.critical-shot')).state
      const free = shot(s, sg)
      expect(free.players.A.cp).toBe(cp0)
      expect(usedThisBattle(free, 'A', 'ph.ta.ploy')).toBe(true)
      expect(shot(edit(s, (st) => st.ledger.A.battle.push('ph.ta.ploy')), sg).players.A.cp).toBe(cp0 - 1)
      expect(shot(s, A(s, 'infiltrator-commsman')).players.A.cp).toBe(cp0 - 1)
    }
    {
      const s = open()
      const sg = A(s, 'infiltrator-sergeant')
      const boy = B(s, 'boy')
      const cp0 = s.players.A.cp
      let t = take(take(activateOp(facing(s, sg, boy), sg), 'shoot').state, 'ph.w.marksman-bolt-carbine').state
      const rng = dice(1, 1, 1, 1, 6)
      t = take(t, boy, rng).state
      expect(t.pending!.kind).toBe('dice.commandReroll')
      // the Command Re-roll on the Sergeant's dice is priced at 0 CP, so it is on offer even with no CP at all
      expect(t.pending!.options!.find((o) => o.id === 'command:0')!.data!.cost).toBe(0)
      const broke = edit(t, (st) => void (st.players.A.cp = 0))
      expect(optionIds(broke)).toContain('command:0')
      const paid = take(broke, 'command:0', rng)
      expect(paid.state.players.A.cp).toBe(0)
      expect(paid.events.some((e) => e.type === 'CpChanged')).toBe(false)
      t = take(t, 'command:0', rng).state
      const r = play(t, rng, noPloys)
      expect(r.state.players.A.cp).toBe(cp0)
      expect(usedThisBattle(r.state, 'A', 'ph.ta.ploy')).toBe(true)
      // once the use is spent it costs 1 CP again
      const spent = edit(t, (st) => st.ledger.A.battle.push('ph.ta.ploy'))
      expect(commandRerollCost(spent, spent.attack!.seq!.atk)).toBe(1)
    }
  })

  it('TEAM-PH-009 TEAM-PH-010 Strategic Oversight and Comms Array', () => {
    {
      const cp = (roll: number) => startPh({}, 'ph-so', [], [6, 1, 6, 1, roll, ...Array<number>(80).fill(1)]).players.A.cp
      expect(cp(4)).toBe(cp(3) + 1)
      expect(cp(6)).toBe(cp(3) + 1)
      const s = open()
      const com = A(s, 'infiltrator-commsman')
      const gain = (state: GameState, roll: number) =>
        withCtx(state, (ctx) => runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } }), dice(roll)).state.players.A.cp - state.players.A.cp
      expect(gain(s, 4)).toBe(1)
      expect(gain(s, 3)).toBe(0)
      const caught = place(place(s, com, 0, 0), B(s, 'boy'), 1.4, 0)
      expect(gain(caught, 6)).toBe(0)
      expect(gain(edit(s, (st) => (st.operatives[com]!.status = 'removed')), 6)).toBe(0)
    }
    {
      const s = withPloy(open(), 'ph.p.deadly-shots')
      const sub = A(s, 'infiltrator-sergeant')
      const info = { window: 'firefight.activationStart', subjectId: sub, counteracting: false }
      const swaps = (state: GameState, window = 'firefight.activationStart') => offersFor(state, 'A', window, { ...info, window }).filter((o) => o.via === 'ph.comms')
      expect(swaps(s).map((o) => `${o.param}>${o.ployId}`).sort()).toEqual(['ph.p.deadly-shots>ph.p.and-they-shall-know-no-fear', 'ph.p.deadly-shots>ph.p.guerrilla-warfare', 'ph.p.deadly-shots>ph.p.lethal-assaults'])
      expect(swaps(s, 'firefight.actionEnded').length).toBe(3)
      expect(swaps(s).every((o) => o.cost === 0)).toBe(true)
      // never to a ploy already used this turning point
      const both = withPloy(open(), 'ph.p.deadly-shots', 'ph.p.lethal-assaults')
      expect(swaps(both).map((o) => o.ployId).sort()).toEqual(['ph.p.and-they-shall-know-no-fear', 'ph.p.and-they-shall-know-no-fear', 'ph.p.guerrilla-warfare', 'ph.p.guerrilla-warfare'])
      // Deadly Shots gives Balanced to ranged weapons, Lethal Assaults to melee ones: the swap moves it
      const boy = B(s, 'boy')
      const t = activateOp(facing(s, sub, boy), sub)
      const rules = (state: GameState, weapon: string, kind: 'shoot' | 'fight') => effectiveRules(state, state.operatives[sub]!, state.data.weapons[weapon]!, kind, boy).map((r) => r.rule)
      expect(rules(t, 'ph.w.marksman-bolt-carbine', 'shoot')).toContain('balanced')
      const o = swaps(t).find((x) => x.ployId === 'ph.p.lethal-assaults')!
      const swapped = withCtx(t, (ctx) => usePloy(ctx, 'A', o, info)).state
      expect(rules(swapped, 'ph.w.marksman-bolt-carbine', 'shoot')).not.toContain('balanced')
      expect(rules(swapped, 'ph.w.fists', 'fight')).toContain('balanced')
      expect(usedThisTp(swapped, 'A', 'ph.p.lethal-assaults')).toBe(true)
      expect(usedThisTp(swapped, 'A', 'ph.comms')).toBe(true)
      expect(swaps(swapped)).toEqual([])
      // without a Commsman in the killzone nothing is offered
      expect(swaps(withPloy(open({ rosterA: phRoster(NO_COMMS) }), 'ph.p.deadly-shots'))).toEqual([])
      expect(swaps(edit(s, (st) => (st.operatives[A(s, 'infiltrator-commsman')]!.status = 'removed')))).toEqual([])
    }
  })

  it('TEAM-PH-011 TEAM-PH-012 Medic! and Helix Gauntlet', () => {
    {
      const s0 = open()
      const hx = A(s0, 'infiltrator-helix-adept')
      const sg = A(s0, 'infiltrator-sergeant')
      const com = A(s0, 'infiltrator-commsman')
      const boy = B(s0, 'boy')
      const stage = (sgX: number) => place(place(place(s0, hx, 0, 0), sg, sgX, 0), com, 0, 2)
      // damage outside an attack: the removal waits for the end of the step, where the Phobos player is asked
      const fall = (state: GameState, id: string) =>
        withCtx(state, (ctx) => {
          directDamage(ctx, id, 99, boy, 'test')
          runDeferredRemovals(ctx)
        }).state
      const asked = fall(stage(2), sg)
      expect(asked.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { hook: 'phMedic', operativeId: sg } })
      expect(optionIds(asked)).toEqual(['save', 'decline'])
      // saved: D3 wounds (a 5: 3), APL -1 for both, the use spent
      const r = take(asked, 'save', dice(5)).state
      expect(r.operatives[sg]!.wounds).toBe(3)
      expect(r.operatives[sg]!.status).toBe('active')
      expect(effectiveApl(r.operatives[sg]!)).toBe(2)
      expect(effectiveApl(r.operatives[hx]!)).toBe(2)
      expect(usedThisTp(r, 'A', `ph.medic:${hx}`)).toBe(true)
      expect(r.pending!.id).toBe(stage(2).pending!.id)
      // declined: removed, and the use is spent all the same
      const no = take(asked, 'decline').state
      expect(no.operatives[sg]!.status).toBe('removed')
      expect(effectiveApl(no.operatives[hx]!)).toBe(3)
      expect(usedThisTp(no, 'A', `ph.medic:${hx}`)).toBe(true)
      // the first casualty only: a second operative falls without a question
      const second = fall(r, com)
      expect(second.operatives[com]!.status).toBe('removed')
      expect(second.pending!.kind).not.toBe('ability.choice')
      // the free Dash follows: a reaction while the enemy acts, a 0 CP offer while Phobos acts
      expect(providerReactions(r, 'A', { actorId: boy, action: 'shoot', activeSeat: 'B', moved: false }).map((o) => o.hook)).toEqual(['phMedic'])
      const own = edit(r, (st) => {
        st.firefight.activation = { operativeId: com, seat: 'A', counteract: false, stage: 'action', apSpent: 1, performed: ['shoot'], declared: null }
      })
      expect(offersFor(own, 'A', 'firefight.actionEnded', { window: 'firefight.actionEnded', subjectId: com }).some((o) => o.via === 'ph.medicDash')).toBe(true)
      // used in the saved operative's own activation: that activation ends at once
      const inOwn = take(fall(activateOp(stage(2), sg), sg), 'save', dice(5)).state
      expect(inOwn.operatives[sg]!.wounds).toBe(3)
      expect(inOwn.firefight.activation?.operativeId).not.toBe(sg)
      // no question: beyond 3", in an enemy control range (either of them), or the Helix Adept is a Shoot target
      const ask = (state: GameState) =>
        withCtx(state, (ctx) => inflict(ctx, { targetId: sg, attackerId: boy, weaponId: 'kom.w.slugga', amount: 99, source: 'normal' })).state.effects.some((e) => e.kind === 'ph.medicAsk')
      expect(ask(stage(2))).toBe(true)
      expect(ask(stage(4.8))).toBe(false)
      expect(ask(place(stage(2), boy, 3.5, 0))).toBe(false)
      expect(ask(place(stage(2), boy, -1.4, 0))).toBe(false)
      const targeted = edit(stage(2), (st) => {
        st.attack = { kind: 'shoot', targets: [hx], incapacitated: [] } as never
      })
      expect(ask(targeted)).toBe(false)
    }
    {
      const s0 = open()
      const hx = A(s0, 'infiltrator-helix-adept')
      const sg = A(s0, 'infiltrator-sergeant')
      const stage = (sgX: number, sgWounds = 5) =>
        edit(place(place(s0, hx, 0, 0), sg, sgX, 0), (st) => {
          st.operatives[sg]!.wounds = sgWounds
          st.operatives[hx]!.wounds = 6
        })
      const id = (who: string) => `ability:ph.a.helix-gauntlet:${who}`
      const t = activateOp(stage(1.2), hx)
      expect(optionIds(t)).toEqual(expect.arrayContaining([id(sg), id(hx)]))
      expect(take(t, id(sg), dice(6)).state.operatives[sg]!.wounds).toBe(11)
      expect(take(t, id(sg), dice(2)).state.operatives[sg]!.wounds).toBe(9)
      expect(take(t, id(hx), dice(6)).state.operatives[hx]!.wounds).toBe(12)
      // capped at starting wounds
      expect(take(activateOp(stage(1.2, 12), hx), id(sg), dice(6)).state.operatives[sg]!.wounds).toBe(13)
      // not a full-wound friend, not out of control range, not the operative Medic! saved
      expect(optionIds(activateOp(stage(1.2, 13), hx))).not.toContain(id(sg))
      expect(optionIds(activateOp(stage(3), hx))).not.toContain(id(sg))
      expect(optionIds(activateOp(edit(stage(1.2), (st) => st.ledger.A.tp.push(`ph.medic.saved:${sg}`)), hx))).not.toContain(id(sg))
      // never in an enemy control range
      expect(optionIds(activateOp(place(stage(1.2), B(s0, 'boy'), 0, -1.4), hx)).some((o) => o.startsWith('ability:ph.a.helix-gauntlet'))).toBe(false)
    }
  })

  it('TEAM-PH-013 TEAM-PH-014 TEAM-PH-015 Plant Explosives, Detonate and the remote detonator', () => {
    {
      const s = withMarkers(open())
      const sab = A(s, 'infiltrator-saboteur')
      const sg = A(s, 'infiltrator-sergeant')
      const m = s.markers.find((k) => k.equipmentId === EXPLOSIVES)!
      expect(m.carriedBy).toBe(sab)
      expect(explosivesMarker(s, 'A')).toBeUndefined()
      let t = activateOp(place(s, sab, 0, 0), sab)
      expect(optionIds(t)).toContain(`marker:place:${m.id}`)
      t = take(t, `marker:place:${m.id}`).state
      t = expectOk(step(t, { type: 'marker.place', seat: 'A', decisionId: t.pending!.id, payload: { x: 0.9, z: 0 } })).state
      expect(explosivesMarker(t, 'A')!.pos).toEqual({ x: 0.9, z: 0 })
      expect(optionIds(t)).toContain('ph.plantDash')
      t = take(t, 'ph.plantDash').state
      expect(t.pending!.kind).toBe('move.path')
      t = expectOk(step(t, { type: 'move.path', seat: 'A', decisionId: t.pending!.id, payload: { waypoints: [{ x: -2.8, z: 0 }] } })).state
      expect(t.operatives[sab]!.pos.x).toBeCloseTo(-2.8, 1)
      expect(t.pending!.kind).toBe('firefight.action')
      // the free Dash counts as a Dash: no second free Dash offered after another placement, and Dash is spent
      expect(optionIds(t)).not.toContain('dash')
      // nobody else can pick the marker up, the Saboteur can again in a later activation
      const placed = edit(place(s, sab, 0, 0), (st) => {
        const mk = st.markers.find((k) => k.equipmentId === EXPLOSIVES)!
        mk.carriedBy = null
        mk.pos = { x: 0.9, z: 0 }
        st.operatives[sab]!.flags.carrying = null
      })
      const near = place(place(placed, sg, 1.8, 0), B(s, 'boy'), 0.9, 1.4)
      expect(actionForbidden(near, near.operatives[sg]!, 'marker:pickUp')).not.toBeNull()
      expect(actionForbidden(near, near.operatives[B(s, 'boy')]!, 'marker:pickUp')).not.toBeNull()
      expect(actionForbidden(near, near.operatives[sab]!, 'marker:pickUp')).toBeNull()
      expect(optionIds(activateOp(placed, sab))).toContain(`marker:pickUp:${m.id}`)
      expect(optionIds(activateOp(place(placed, sg, 0, 0), sg)).some((o) => o.startsWith('marker:pickUp'))).toBe(false)
    }
    {
      const s0 = withMarkers(open())
      const sab = A(s0, 'infiltrator-saboteur')
      const com = A(s0, 'infiltrator-commsman')
      const boy = B(s0, 'boy')
      const nob = B(s0, 'boss-nob')
      const behind = B(s0, 'slasha-boy')
      const wall = feature('wall', part('wall.a', rect(0.5, 3.5, -1.3, -1.1), 3, ['heavy']))
      const stage = (o: { marker?: boolean } = {}) =>
        edit(place(place(place(place(place(s0, sab, 0, 0), boy, 3.5, 0), nob, 2, 1.7), com, 1.2, 1.2), behind, 2, -2.4), (st) => {
          st.map = { ...st.map, features: [wall] }
          st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
          st.operatives[nob]!.order = 'conceal'
          st.operatives[nob]!.wounds = st.operatives[nob]!.maxWounds = 40
          st.operatives[behind]!.wounds = st.operatives[behind]!.maxWounds = 40
          if (o.marker !== false) {
            const mk = st.markers.find((k) => k.equipmentId === EXPLOSIVES)!
            mk.carriedBy = null
            mk.pos = { x: 2, z: 0 }
            st.operatives[sab]!.flags.carrying = null
          }
        })
      const t = stage()
      // the fixed targets: enemies first (nearest the marker first), then friends, the shooter last; the wall spares the Slasha
      const fixed = providerFixedTargets(t, t.operatives[sab]!, 'ph.w.remote-detonator')!
      expect(fixed.targets).toEqual([boy, nob, com, sab].sort((a, b) => fixed.targets.indexOf(a) - fixed.targets.indexOf(b)))
      expect(fixed.targets.slice(0, 2).sort()).toEqual([boy, nob].sort())
      expect(fixed.targets.slice(2)).toEqual([com, sab])
      expect(fixed.targets).not.toContain(behind)
      expect([fixed.noCover, fixed.noObscured, fixed.blast]).toEqual([true, true, false])
      // fired: one sequence per target, none in cover or obscured, then the marker is gone and the weapon spent
      const w = take(take(activateOp(t, sab), 'shoot').state, 'ph.w.remote-detonator', dice(6, 6, 6, 6, 1, 1, 1, 1, 1, 1))
      const r = play(w.state, dice(6, 6, 6, 6, 1, 1, 1, 1, 1, 1), noPloys)
      const events = [...w.events, ...r.events]
      expect(evs(events, 'TargetSelected').map((e) => e.targetId).sort()).toEqual([boy, nob, com, sab].sort())
      expect(evs(events, 'TargetSelected').every((e) => !e.inCover && !e.obscured)).toBe(true)
      expect(r.state.markers.some((k) => k.equipmentId === EXPLOSIVES)).toBe(false)
      expect(r.state.operatives[boy]!.wounds).toBeLessThan(40)
      expect(r.state.operatives[nob]!.wounds).toBeLessThan(40)
      expect(r.state.operatives[behind]!.wounds).toBe(40)
      expect(r.state.operatives[sab]!.usedLimited['ph.w.remote-detonator']).toBe(1)
      // carried: not selectable; placed with nobody within 2": not selectable; spent: not selectable with a new marker
      const weapons = (state: GameState) => optionIds(take(activateOp(state, sab), 'shoot').state)
      expect(weapons(edit(place(withMarkers(open()), sab, 0, 0), (st) => place(st, boy, 3, 0)))).not.toContain('ph.w.remote-detonator')
      expect(weapons(edit(stage(), (st) => (st.markers.find((k) => k.equipmentId === EXPLOSIVES)!.pos = { x: -9, z: 8 })))).not.toContain('ph.w.remote-detonator')
      expect(weapons(stage())).toContain('ph.w.remote-detonator')
      expect(weapons(edit(stage(), (st) => (st.operatives[sab]!.usedLimited['ph.w.remote-detonator'] = 1)))).not.toContain('ph.w.remote-detonator')
      // Heavy (Dash only): not after a Reposition, still after a Dash
      const st = stage()
      const usable = (performed: string[]) => shootableWeapons(st, st.operatives[sab]!, performed).map((x) => x.weaponId)
      expect(usable(['reposition'])).not.toContain('ph.w.remote-detonator')
      expect(usable(['dash'])).toContain('ph.w.remote-detonator')
    }
  })

  it('TEAM-PH-016 TEAM-PH-017 TEAM-PH-018 Custom picks, Voxbreak and Auspex Scan', () => {
    {
      const cards = ['infiltrator-sergeant', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'infiltrator-veteran', 'incursor-marksman']
      const stage = (picks?: Record<string, string>) => open({ rosterA: phRoster(cards, picks ? { 4: picks } : {}) })
      const keys = (s: GameState) => {
        const vet = A(s, 'infiltrator-veteran')
        return effectiveRules(s, s.operatives[vet]!, s.data.weapons['ph.w.custom-bolt-carbine']!, 'shoot', B(s, 'boy')).map((r) => `${ruleKey(r.rule)}${r.crits ? '-crits' : ''}${r.target ? `@${r.target}` : ''}`)
      }
      const s = stage({ 'custom-1': 'RENDING', 'custom-2': 'LETHAL 5' })
      expect(keys(s)).toEqual(expect.arrayContaining(['rending', 'lethal@5']))
      // unasked picks are filled with the first two rules
      expect(keys(stage())).toEqual(expect.arrayContaining(['balanced', 'lethal@5']))
      expect(keys(stage({ 'custom-1': 'PIERCING CRITS 1', 'custom-2': 'BALANCED' }))).toEqual(expect.arrayContaining(['piercing-crits', 'balanced']))
      expect(keys(stage({ 'custom-1': 'SATURATE', 'custom-2': 'RENDING' }))).toEqual(expect.arrayContaining(['saturate', 'rending']))
      expect(s.operatives[A(s, 'infiltrator-veteran')]!.picks).toEqual({ 'custom-1': 'RENDING', 'custom-2': 'LETHAL 5' })
      expect(s.operatives[A(s, 'infiltrator-sergeant')]!.picks).toBeUndefined()
      // the picks are tags, not keywords
      expect(hasKeyword(s, s.operatives[A(s, 'infiltrator-veteran')]!, 'RENDING')).toBe(false)
      // real dice 5, 3, 1, 1: with Lethal 5+ and Rending both successes are crits; without them one normal and one crit
      const retained = (state: GameState) => {
        const vet = A(state, 'infiltrator-veteran')
        const boy = B(state, 'boy')
        return evs(shootBoy(facing(state, vet, boy), vet, boy, 'ph.w.custom-bolt-carbine', dice(5, 3, 1, 1), noPloys).events, 'AttackRetained')[0]!
      }
      expect([retained(s).normal, retained(s).crit]).toEqual([0, 2])
      const plain = retained(stage({ 'custom-1': 'SATURATE', 'custom-2': 'BALANCED' }))
      expect([plain.normal, plain.crit]).toEqual([2, 0])
    }
    {
      const cards = ['infiltrator-sergeant', 'infiltrator-voxbreaker', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-marksman']
      const s = open({ rosterA: phRoster(cards) })
      const vox = A(s, 'infiltrator-voxbreaker')
      const sg = A(s, 'infiltrator-sergeant')
      const boy = B(s, 'boy')
      const banned = (who: string, x: number) => providerRerollsBanned(place(place(s, vox, 0, 0), boy, x, 0), { operativeId: who } as never, {} as never)
      expect(banned(boy, 6.2)).toBe(true)
      expect(banned(boy, 7.5)).toBe(false)
      expect(banned(sg, 3)).toBe(false)
      // in a real shot: the Boy's Command Re-roll decision is raised only when the Voxbreaker is far
      const shot = (voxAt: { x: number; z: number }) => {
        let t = place(place(place(s, vox, voxAt.x, voxAt.z), sg, 0, 0), boy, 5, 0)
        t = take(activateOp(t, A(s, 'infiltrator-commsman')), 'end').state
        t = take(activateOp(t, boy), 'shoot').state
        const rng = dice(1, 1, 1, 1, 1, 1, 1, 1)
        t = take(take(t, t.pending!.options![0]!.id).state, sg, rng).state
        return `${t.pending!.kind}:${t.pending!.seat}:${String(t.pending!.context.side)}`
      }
      // far away the Boy may Command Re-roll its attack dice; near, the first re-roll offered is the Sergeant's defence
      expect(shot({ x: -9, z: 8 })).toBe('dice.commandReroll:B:attack')
      expect(shot({ x: 3, z: 4 })).toBe('dice.commandReroll:A:defence')
    }
    {
      const cards = ['infiltrator-sergeant', 'infiltrator-voxbreaker', 'incursor-marksman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-warrior']
      const s0 = open({ rosterA: phRoster(cards) })
      const vox = A(s0, 'infiltrator-voxbreaker')
      const sg = A(s0, 'infiltrator-sergeant')
      const mk = A(s0, 'incursor-marksman')
      const boy = B(s0, 'boy')
      const scanned = take(activateOp(place(s0, vox, 0, 0), vox), 'ability:ph.a.auspex-scan:scan').state
      expect(hasToken(scanned, vox, 'ph.auspex')).toBe(true)
      const status = (state: GameState, shooter: string, x: number) => {
        const t = place(state, boy, x, 0)
        const d = { obscured: true, inCover: true }
        runHook('target.status', { seat: 'A', state: t, operativeId: shooter, targetId: boy, data: d as never })
        return d.obscured
      }
      const near = place(scanned, sg, -3, 0)
      expect(status(near, sg, 6)).toBe(false)
      expect(status(near, sg, 10)).toBe(true)
      expect(status(s0, sg, 6)).toBe(true)
      // Seek Light for an Incursor, not for an Infiltrator, only inside 8" of the Voxbreaker
      const seekLight = (state: GameState, shooter: string, x: number) => {
        const t = place(state, boy, x, 0)
        return effectiveRules(t, t.operatives[shooter]!, t.data.weapons[t.operatives[shooter]!.weapons[0]!]!, 'shoot', boy).some((r) => ruleKey(r.rule) === 'seeklight')
      }
      expect(seekLight(scanned, mk, 6)).toBe(true)
      expect(seekLight(scanned, mk, 10)).toBe(false)
      expect(seekLight(scanned, sg, 6)).toBe(false)
      expect(seekLight(s0, mk, 6)).toBe(false)
      // a Conceal enemy in Light cover becomes a valid target for the Incursor
      const rubble = feature('rubble', part('rubble.a', rect(5.2, 5.7, -1.2, 1.2), 1, ['light']))
      const hidden = (state: GameState) => {
        const t = edit(place(place(state, mk, 0, 0), boy, 6.2, 0), (st) => {
          st.map = { ...st.map, features: [rubble] }
          st.operatives[boy]!.order = 'conceal'
          st.operatives[mk]!.order = 'engage'
        })
        return shootableWeapons(t, t.operatives[mk]!, []).some((w) => w.targets.some((x) => x.id === boy))
      }
      expect(hidden(place(s0, vox, 0, 3))).toBe(false)
      expect(hidden(place(scanned, vox, 0, 3))).toBe(true)
      // it ends when the Voxbreaker activates again, or is incapacitated
      expect(hasToken(withCtx(scanned, (ctx) => tokensOnActivationStart(ctx, vox)).state, vox, 'ph.auspex')).toBe(false)
      expect(hasToken(withCtx(scanned, (ctx) => tokensOnRemoval(ctx, vox)).state, vox, 'ph.auspex')).toBe(false)
    }
  })

  it('TEAM-PH-019 TEAM-PH-020 TEAM-PH-023 Vanguard, Track Target and Grav-chute', () => {
    {
      const s = open({ rosterA: phRoster(['infiltrator-sergeant', 'infiltrator-warrior', 'infiltrator-warrior', 'incursor-warrior', 'reiver-warrior', 'incursor-marksman']) })
      const cost = (state: GameState, id: string, action = 'marker:pickUp') => providerCostDelta(state, state.operatives[id]!, action)
      const mission = Object.values(s.data.abilities).find((a) => (a.keywords ?? []).includes('MISSION'))!
      expect([cost(s, 'A2'), cost(s, 'A3'), cost(s, 'A4'), cost(s, 'A5')]).toEqual([-1, -1, -1, -1])
      expect(cost(s, 'A2', `ability:${mission.id}`)).toBe(-1)
      expect(cost(s, 'A1')).toBe(0)
      expect(cost(s, 'A6')).toBe(0)
      const declare = (state: GameState, id: string) =>
        withCtx(state, (ctx) => runHook('action.declared', { seat: 'A', state: ctx.state, engine: ctx, operativeId: id, data: { action: 'marker:pickUp', counteract: false, free: false, activeSeat: 'A', cancel: false, bar: false } })).state
      const t = declare(s, 'A2')
      expect(usedThisTp(t, 'A', 'ph.vanguard')).toBe(true)
      expect(cost(t, 'A3')).toBe(0)
      // the discount returns next turning point
      expect(cost(edit(t, (st) => (st.ledger.A.tp = [])), 'A3')).toBe(-1)
      // a different action does not spend it
      const other = withCtx(s, (ctx) => runHook('action.declared', { seat: 'A', state: ctx.state, engine: ctx, operativeId: 'A2', data: { action: 'dash', counteract: false, free: false, activeSeat: 'A', cancel: false, bar: false } })).state
      expect(usedThisTp(other, 'A', 'ph.vanguard')).toBe(false)
    }
    {
      const s0 = open()
      const mk = A(s0, 'incursor-marksman')
      const sg = A(s0, 'infiltrator-sergeant')
      const boy = B(s0, 'boy')
      const staged = place(place(place(s0, mk, 0, 0), boy, 7, 0), sg, -3, 0)
      expect(optionIds(activateOp(staged, mk, 'conceal'))).toContain('guard')
      expect(optionIds(activateOp(staged, sg, 'conceal'))).not.toContain('guard')
      // Guard, end; the Boy dashes; the Marksman's interrupt is taken on Engage
      let t = take(activateOp(staged, mk, 'conceal'), 'guard').state
      expect(t.operatives[mk]!.order).toBe('conceal')
      expect(t.operatives[mk]!.flags.guard).toBe(true)
      t = take(t, 'end').state
      t = take(activateOp(t, boy), 'dash').state
      t = expectOk(step(t, { type: 'move.path', seat: 'B', decisionId: t.pending!.id, payload: { waypoints: [{ x: 5, z: 0 }] } })).state
      expect(t.pending!.kind).toBe('guard.interrupt')
      t = take(t, `${mk}:shoot`).state
      expect(t.operatives[mk]!.order).toBe('engage')
    }
    {
      const s = open({ rosterA: phRoster(['reiver-sergeant', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-marksman', 'reiver-warrior']) })
      const surcharge = (id: string, climb: number, drop: number) => providerMoveSurcharge(s, s.operatives[id]!, 'reposition', [], { horizontal: 0, accessible: 0, climb, drop })
      // a 3" wall and a 4" drop: 3 - 2 = 1" saved on the way up, all 4" saved on the way down
      expect(surcharge('A1', 3, 0)).toBe(-1)
      expect(surcharge('A1', 0, 4)).toBe(-4)
      expect(surcharge('A1', 3, 4)).toBe(-5)
      expect(surcharge('A6', 6, 0)).toBe(-4)
      expect(surcharge('A1', 2, 0)).toBe(0)
      expect(surcharge('A2', 3, 4)).toBe(0)
    }
  })

  it('TEAM-PH-021 TEAM-PH-022 Haywire Mine and Proximity Mine', () => {
    {
      const cards = ['infiltrator-sergeant', 'incursor-minelayer', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-marksman']
      const s = withMarkers(open({ rosterA: phRoster(cards) }))
      const ml = A(s, 'incursor-minelayer')
      const boy = B(s, 'boy')
      const mine = s.markers.find((m) => m.equipmentId === HAYWIRE)!
      expect(mine.carriedBy).toBe(ml)
      // Place Marker offers only spots outside every enemy control range, and refuses the others
      const near = activateOp(place(place(s, ml, 0, 0), boy, 2.2, 0), ml)
      const placing = take(near, `marker:place:${mine.id}`).state
      const p = placing.pending!
      expect(p.kind).toBe('marker.place')
      const spots = p.context.spots as { x: number; z: number }[]
      expect(spots.length).toBeGreaterThan(0)
      for (const o of spots) expect(markerInControlRange(placing, bodyOf(placing.operatives[boy]!), { ...mine, carriedBy: null, pos: o }), `${o.x},${o.z}`).toBe(false)
      expect(step(placing, { type: 'marker.place', seat: 'A', decisionId: p.id, payload: { x: 1, z: 0 } }).rejection?.code).toBe('E_ACTION_RESTRICTED')
      expect(expectOk(step(placing, { type: 'marker.place', seat: 'A', decisionId: p.id, payload: spots[0]! })).state.markers.find((m) => m.id === mine.id)!.carriedBy).toBeNull()
      // only the Minelayer picks it up
      const down = edit(place(s, ml, 0, 0), (st) => {
        const m = st.markers.find((k) => k.equipmentId === HAYWIRE)!
        m.carriedBy = null
        m.pos = { x: 0.9, z: 0 }
        st.operatives[ml]!.flags.carrying = null
      })
      expect(actionForbidden(down, down.operatives[A(s, 'infiltrator-sergeant')]!, 'marker:pickUp')).toBeNull()
      expect(optionIds(activateOp(down, ml)).some((o) => o.startsWith('marker:pickUp'))).toBe(true)
      // a dying Minelayer drops the mine at the legal spot farthest from enemies, or loses it
      const kill = (state: GameState) => withCtx(state, (ctx) => void directDamage(ctx, ml, 99, boy, 'test'), dice(1)).state
      const open1 = kill(place(place(s, ml, 0, 0), boy, 6, 0))
      const dropped = open1.markers.find((m) => m.equipmentId === HAYWIRE)!
      expect(dropped.carriedBy).toBeNull()
      expect(Math.hypot(dropped.pos.x, dropped.pos.z)).toBeLessThan(1.7)
      const nob = B(s, 'boss-nob')
      const slasha = B(s, 'slasha-boy')
      const burna = B(s, 'burna-boy')
      const boxed = place(place(place(place(place(s, ml, 0, 0), boy, 1.5, 0), nob, -1.5, 0), slasha, 0, 1.5), burna, 0, -1.5)
      expect(kill(boxed).markers.some((m) => m.equipmentId === HAYWIRE)).toBe(false)
    }
    {
      const cards = ['infiltrator-sergeant', 'incursor-minelayer', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-marksman']
      const s0 = withMarkers(open({ rosterA: phRoster(cards) }))
      const ml = A(s0, 'incursor-minelayer')
      const sg = A(s0, 'infiltrator-sergeant')
      const boy = B(s0, 'boy')
      const mined = edit(place(s0, ml, -6, 0), (st) => {
        const m = st.markers.find((k) => k.equipmentId === HAYWIRE)!
        m.carriedBy = null
        m.pos = { x: 3, z: 0 }
        st.operatives[ml]!.flags.carrying = null
        st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
      })
      // the Boy repositions 4.2" along the board past the mine: it is stopped at the first increment within 1" of it
      let t = take(activateOp(place(mined, boy, 7, 0), A(s0, 'infiltrator-commsman')), 'end').state
      t = take(activateOp(t, boy), 'reposition', dice(6, 6, 6, 6)).state
      t = expectOk(step(t, { type: 'move.path', seat: 'B', decisionId: t.pending!.id, payload: { waypoints: [{ x: 4.2, z: 0 }, { x: 4.2, z: -2.5 }] } }, dice(6, 6, 6, 6))).state
      expect(t.operatives[boy]!.pos.x).toBeCloseTo(4.2, 1)
      expect(t.operatives[boy]!.pos.z).toBeCloseTo(0, 1)
      expect(t.operatives[boy]!.wounds).toBe(31)
      // it is in the middle of its own activation, so the APL penalty starts with its next one
      expect(effectiveApl(t.operatives[boy]!)).toBe(t.operatives[boy]!.apl)
      expect(t.effects.some((e) => e.kind === 'ph.aplNext' && e.operativeId === boy)).toBe(true)
      const next = withCtx(t, (ctx) => runHook('activation.start', { seat: 'B', state: ctx.state, engine: ctx, operativeId: boy, data: { previousOrder: 'engage', order: 'engage' } })).state
      expect(effectiveApl(next.operatives[boy]!)).toBe(next.operatives[boy]!.apl - 1)
      expect(t.markers.some((m) => m.equipmentId === HAYWIRE)).toBe(false)
      // a friend sets it off too; the Minelayer never does
      const ended = (state: GameState, who: string) =>
        withCtx(state, (ctx) => runHook('action.ended', { seat: state.operatives[who]!.seat, state: ctx.state, engine: ctx, operativeId: who, data: { action: 'dash', counteract: false, free: false, activeSeat: 'A' } }), dice(6, 6, 6, 6)).state
      const friend = ended(place(mined, sg, 3.9, 0), sg)
      expect(friend.markers.some((m) => m.equipmentId === HAYWIRE)).toBe(false)
      expect(friend.operatives[sg]!.wounds).toBeLessThan(13)
      expect(effectiveApl(friend.operatives[sg]!)).toBe(2)
      const own = ended(place(mined, ml, 3.9, 0), ml)
      expect(own.markers.some((m) => m.equipmentId === HAYWIRE)).toBe(true)
      // once only
      const twice = ended(place(friend, boy, 3.9, 0), boy)
      expect(twice.operatives[boy]!.wounds).toBe(40)
    }
  })

  it('TEAM-PH-024 TEAM-PH-025 TEAM-PH-026 TEAM-PH-027 Guerrilla Warfare, And They Shall Know No Fear, Deadly Shots and Lethal Assaults', () => {
    {
      const s = open({}, ['ph.p.guerrilla-warfare'])
      expect(s.effects.some((e) => e.source === 'ph.p.guerrilla-warfare')).toBe(true)
      const sg = A(s, 'infiltrator-sergeant')
      const com = A(s, 'infiltrator-commsman')
      const boy = B(s, 'boy')
      const change = 'ability:ph.a.guerrilla-warfare:conceal'
      const t = activateOp(s, sg, 'engage')
      expect(optionIds(t)).toContain(change)
      const done = take(t, change).state
      expect(done.operatives[sg]!.order).toBe('conceal')
      expect(done.firefight.activation!.apSpent).toBe(1)
      expect(optionIds(activateOp(s, com, 'conceal'))).toContain('ability:ph.a.guerrilla-warfare:engage')
      // not in an enemy control range
      expect(optionIds(activateOp(place(place(s, sg, 0, 0), boy, 1.4, 0), sg)).some((o) => o.startsWith('ability:ph.a.guerrilla-warfare'))).toBe(false)
      // a counteraction takes it for its 1 AP
      const counter = edit(s, (st) => {
        st.firefight.activation = { operativeId: sg, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }
      })
      const offer = abilityOffers(counter, counter.operatives[sg]!, counter.firefight.activation).find((o) => o.abilityId === 'ph.a.guerrilla-warfare')
      expect(offer?.cost).toBe(1)
      // gone with the turning point
      const later = edit(s, (st) => (st.effects = st.effects.filter((e) => e.source !== 'ph.p.guerrilla-warfare')))
      expect(optionIds(activateOp(later, sg, 'engage')).some((o) => o.startsWith('ability:ph.a.guerrilla-warfare'))).toBe(false)
      // And They Shall Know No Fear: an injured operative keeps its Move and its Hit
      const hurt = (state: GameState) =>
        edit(facing(state, sg, boy), (st) => {
          st.operatives[sg]!.wounds = 3
          st.operatives[sg]!.flags.injured = true
        })
      const fearless = open({}, ['ph.p.and-they-shall-know-no-fear'])
      const bare = hurt(open())
      const brave = hurt(fearless)
      const need = (state: GameState) => attackStats(state, sg, 'ph.w.marksman-bolt-carbine', boy, { kind: 'shoot' }).need
      expect(effectiveMove(bare.operatives[sg]!, bare)).toBe(5)
      expect(effectiveMove(brave.operatives[sg]!, brave)).toBe(7)
      expect(need(bare)).toBe(need(brave) + 1)
      expect(brave.operatives[com]!.flags.ignoreInjured).toBe(true)
    }
    {
      const s0 = withPloy(open(), 'ph.p.deadly-shots', 'ph.p.lethal-assaults')
      const sg = A(s0, 'infiltrator-sergeant')
      const boy = B(s0, 'boy')
      const nob = B(s0, 'boss-nob')
      const rubble = feature('rubble', part('rubble.a', rect(7.3, 7.8, -1, 1), 1, ['light']))
      const stage = (performed: string[], cover = false) =>
        edit(place(place(place(s0, sg, 0, 0), boy, 8.6, 0), nob, 4, 3), (st) => {
          st.firefight.activation = { operativeId: sg, seat: 'A', counteract: false, stage: 'action', apSpent: performed.length, performed, declared: null }
          st.map = { ...st.map, features: cover ? [rubble] : [] }
        })
      const rules = (state: GameState, target: string, weapon = 'ph.w.marksman-bolt-carbine', kind: 'shoot' | 'fight' = 'shoot') =>
        effectiveRules(state, state.operatives[sg]!, state.data.weapons[weapon]!, kind, target).map((r) => `${ruleKey(r.rule)}${r.target ? `@${r.target}` : ''}`)
      // (a) nothing but a Dash so far
      expect(rules(stage([]), nob)).toContain('balanced')
      expect(rules(stage(['dash']), nob)).toContain('balanced')
      // (b) after a Reposition only the far target out of cover qualifies, checked per target
      expect(rules(stage(['reposition']), nob)).not.toContain('balanced')
      expect(rules(stage(['reposition']), boy)).toContain('balanced')
      expect(rules(stage(['charge']), boy)).toContain('balanced')
      expect(rules(stage(['fallBack']), nob)).not.toContain('balanced')
      expect(rules(stage(['reposition'], true), boy)).not.toContain('balanced')
      // Lethal Assaults: Balanced for its own Fight, plus Lethal 5+ after a Charge; none when retaliating
      expect(rules(stage([]), boy, 'ph.w.fists', 'fight')).toEqual(['balanced'])
      expect(rules(stage(['charge']), boy, 'ph.w.fists', 'fight')).toEqual(expect.arrayContaining(['balanced', 'lethal@5']))
      const retaliating = edit(stage(['charge']), (st) => {
        st.attack = { kind: 'fight', operativeId: boy, seat: 'B' } as never
      })
      expect(rules(retaliating, boy, 'ph.w.fists', 'fight')).toEqual([])
      // no ploy, no rules
      const bare = edit(stage(['dash']), (st) => (st.effects = []))
      expect(rules(bare, nob)).not.toContain('balanced')
      expect(rules(bare, boy, 'ph.w.fists', 'fight')).toEqual([])
    }
  })

  it('TEAM-PH-028 TEAM-PH-029 TEAM-PH-030 Patient Ambush, Critical Shot and Transhuman Physiology', () => {
    // Patient Ambush: free for the Sergeant, passes play to the opponent, once per turning point, only when Phobos would activate
    const w = toWindow('firefight.beforeActivation')
    const ambush = w.pending!.options!.find((o) => o.id === 'ph.p.patient-ambush')!
    expect(ambush.action.payload).toMatchObject({ ployId: 'ph.p.patient-ambush' })
    expect((ambush.data as { cost: number }).cost).toBe(0)
    let t = take(w, 'ph.p.patient-ambush').state
    expect(t.pending!.kind).toBe('firefight.activate')
    expect(t.pending!.seat).toBe('B')
    t = take(activateOp(t, B(w, 'boy')), 'end').state
    expect(t.pending!.kind).toBe('firefight.activate')
    expect(t.pending!.seat).toBe('A')
    const s = open()
    const offered = (state: GameState) => offersFor(state, 'A', 'firefight.beforeActivation', { window: 'firefight.beforeActivation', seat: 'A' }).some((o) => o.ployId === 'ph.p.patient-ambush')
    expect(offered(s)).toBe(true)
    expect(offered(edit(s, (st) => (st.ledger.A.tp.push('ph.p.patient-ambush'))))).toBe(false)
    expect(offered(edit(s, (st) => Object.values(st.operatives).forEach((o) => o.seat === 'A' && (o.ready = false))))).toBe(false)
    expect(offered(edit(s, (st) => Object.values(st.operatives).forEach((o) => o.seat === 'B' && (o.ready = false))))).toBe(true)

    // Critical Shot: +D3 on the first crit that deals damage, once per turning point, only with a retained crit
    const sg = A(s, 'infiltrator-sergeant')
    const com = A(s, 'infiltrator-commsman')
    const boy = B(s, 'boy')
    const beefy = edit(facing(s, sg, boy), (st) => (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40))
    const lost = (r: { state: GameState }) => 40 - r.state.operatives[boy]!.wounds
    const crit = (state: GameState, shooter: string, head: number[]) => shootBoy(facing(state, shooter, boy), shooter, boy, 'ph.w.marksman-bolt-carbine', dice(...head), takePloy('ph.p.critical-shot'))
    expect(lost(crit(beefy, sg, [6, 6, 1, 1, 1, 1, 1, 1]))).toBe(9)
    expect(lost(shootBoy(beefy, sg, boy, 'ph.w.marksman-bolt-carbine', dice(6, 6, 1, 1, 1, 1, 1, 1), noPloys))).toBe(8)
    const none = crit(beefy, sg, [1, 1, 1, 1])
    expect(lost(none)).toBe(0)
    expect(none.state.players.A.cp).toBe(beefy.players.A.cp)
    // every crit blocked: the ploy was bought for nothing
    const blocked = crit(edit(beefy, (st) => (st.operatives[boy]!.save = 2)), sg, [6, 6, 1, 1, 6, 6, 6])
    expect(lost(blocked)).toBe(0)
    expect(blocked.state.effects.some((e) => e.kind === 'ph.critShot')).toBe(false)

    // Transhuman Physiology: a normal save becomes a crit and blocks a crit (the Boy's four crits against three normal saves)
    const away = take(activateOp(edit(place(place(place(s, sg, 0, 0), boy, 4, 0), com, -13, 8), (st) => (st.operatives[sg]!.wounds = st.operatives[sg]!.maxWounds = 40)), com), 'end').state
    const shotAt = (answers: Parameters<typeof play>[2]) => {
      const rng = dice(6, 6, 6, 6, 3, 3, 3, 1, 1, 1, 1, 1)
      const weapon = take(activateOp(away, boy), 'shoot').state
      const r1 = take(take(weapon, weapon.pending!.options![0]!.id).state, sg, rng)
      return 40 - play(r1.state, rng, answers).state.operatives[sg]!.wounds
    }
    const plain = shotAt(noPloys)
    const saved = shotAt(takePloy('ph.p.transhuman-physiology'))
    expect(plain).toBeGreaterThan(0)
    expect(saved).toBeLessThan(plain)
  })

  it('TEAM-PH-031 Stealth Assault', () => {
    const s0 = open()
    const sg = A(s0, 'infiltrator-sergeant')
    const boy = B(s0, 'boy')
    const stage = (order: 'conceal' | 'engage', gap: number) =>
      edit(place(place(s0, sg, 0, 0), boy, gap, 0), (st) => {
        st.operatives[sg]!.order = order
        st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
        st.operatives[sg]!.wounds = st.operatives[sg]!.maxWounds = 40
      })
    const fight = (state: GameState, answers: Parameters<typeof play>[2]) => {
      let t = take(activateOp(state, sg, 'engage'), 'charge').state
      t = expectOk(step(t, { type: 'move.path', seat: 'A', decisionId: t.pending!.id, payload: { waypoints: [{ x: 2.3, z: 0 }] } })).state
      const rng = dice(6, 6, 6, 6, 6, 6, 6, 6, 6, 6)
      const r1 = take(take(t, 'fight').state, boy, rng)
      const r = play(r1.state, rng, { ...answers, ...strikes })
      return [...r1.events, ...r.events].filter((e) => e.type === 'Struck').map((e) => (e as { operativeId: string }).operativeId)
    }
    const seen: string[] = []
    const record = (id: string) => ({
      'ploy.firefight': (p: PendingDecision) => {
        seen.push(...(p.options ?? []).map((o) => o.id))
        return p.options?.find((o) => o.id === id)?.action ?? act.pass(p)
      },
    })
    const without = fight(stage('conceal', 4), record('none'))
    expect(seen).toContain('ph.p.stealth-assault')
    expect(without.slice(0, 3)).toEqual([sg, boy, sg])
    const withPloyed = fight(stage('conceal', 4), record('ph.p.stealth-assault'))
    expect(withPloyed.slice(0, 3)).toEqual([sg, sg, boy])
    // an operative that was already on Engage when activated does not qualify
    seen.length = 0
    fight(stage('engage', 4), record('none'))
    expect(seen).not.toContain('ph.p.stealth-assault')
    // nor one whose first action is the Fight (already in control range)
    seen.length = 0
    const close = stage('conceal', 1.4)
    const rng = dice(6, 6, 6, 6, 6, 6, 6, 6)
    const r = take(take(activateOp(close, sg, 'engage'), 'fight').state, boy, rng)
    play(r.state, rng, { ...record('none'), ...strikes })
    expect(seen).not.toContain('ph.p.stealth-assault')
  })

  it('TEAM-PH-032 TEAM-PH-033 TEAM-PH-034 Purity Seals, Additional Utility Grenades, Combat Blades and Special Issue Ammunition', () => {
    {
      const s = open({ equipmentA: ['ph.e.purity-seals'] })
      const sg = A(s, 'infiltrator-sergeant')
      const boy = B(s, 'boy')
      const shot = (state: GameState, head: number[]) => shootBoy(facing(state, sg, boy), sg, boy, 'ph.w.marksman-bolt-carbine', dice(...head), takePloy('ph.e.purity-seals'))
      const used = shot(s, [1, 1, 1, 1])
      expect(usedThisTp(used.state, 'A', 'ph.purity')).toBe(true)
      const retained = evs(used.events, 'AttackRetained')[0]!
      expect([retained.normal, retained.crit]).toEqual([1, 0])
      // once per turning point: the second Shoot of the activation gets no offer
      const spent = shot(edit(s, (st) => st.ledger.A.tp.push('ph.purity')), [1, 1, 1, 1])
      expect(evs(spent.events, 'AttackRetained')[0]!.normal).toBe(0)
      // one fail is not enough, and without the equipment nothing is offered
      expect(usedThisTp(shot(s, [6, 6, 6, 1]).state, 'A', 'ph.purity')).toBe(false)
      const bare = open()
      const noSeals = shootBoy(facing(bare, sg, boy), sg, boy, 'ph.w.marksman-bolt-carbine', dice(1, 1, 1, 1), takePloy('ph.e.purity-seals'))
      expect(evs(noSeals.events, 'AttackRetained')[0]!.normal).toBe(0)
    }
    {
      const picks = ['core.a.smoke-grenade', 'core.a.smoke-grenade', 'core.a.stun-grenade', 'core.a.stun-grenade']
      const opts = { equipmentA: ['ph.e.additional-utility-grenades'], equipmentChoices: { A: { 'ph.e.additional-utility-grenades': picks }, B: {} } }
      const s = open(opts)
      expect(s.equipment.picks.A['core.e.utility-grenades']).toEqual(picks)
      const sg = A(s, 'infiltrator-sergeant')
      expect(grenadeSource(s, s.operatives[sg]!, 'core.a.smoke-grenade')).toBe('team')
      expect(grenadeSource(s, s.operatives[sg]!, 'core.a.stun-grenade')).toBe('team')
      const t = place(place(s, sg, 0, 0), B(s, 'boy'), 4, 0)
      expect(optionIds(activateOp(t, sg)).some((o) => o.startsWith('ability:core.a.stun-grenade'))).toBe(true)
      // the same team without the option has no grenades
      const bare = open()
      expect(grenadeSource(bare, bare.operatives[sg]!, 'core.a.smoke-grenade')).toBeNull()
      // the two options exclude each other
      const both = realSetupWith({ ...MATCH, equipmentA: ['ph.e.additional-utility-grenades', 'core.e.utility-grenades'], equipmentChoices: { A: { 'ph.e.additional-utility-grenades': picks, 'core.e.utility-grenades': picks.slice(0, 2) }, B: {} } })
      const ctx = { equipment: realBundle.equipment, teamId: 'phobos-strike-team', limit: 4 }
      expect(selectionProblem(both, 'A', ctx)).toMatch(/cannot be taken/)
      expect(selectionProblem(realSetupWith({ ...MATCH, ...opts }), 'A', ctx)).toBeNull()
      expect(selectionProblem(realSetupWith({ ...MATCH, equipmentA: ['ph.e.additional-utility-grenades'], equipmentChoices: { A: { 'ph.e.additional-utility-grenades': picks.slice(0, 2) }, B: {} } }), 'A', ctx)).not.toBeNull()
    }
    {
      const cards = ['reiver-sergeant', 'infiltrator-commsman', 'incursor-warrior', 'incursor-marksman', 'infiltrator-saboteur', 'reiver-warrior']
      const s = open({ rosterA: phRoster(cards), equipmentA: ['ph.e.combat-blades', 'ph.e.special-issue-ammunition'] })
      const mine = Object.values(s.operatives).filter((o) => o.seat === 'A')
      expect(mine.every((o) => o.weapons.includes('ph.w.combat-blade'))).toBe(true)
      expect(mine.find((o) => o.datacardId === 'ph.reiver-sergeant')!.weapons).toEqual(expect.arrayContaining(['ph.w.combat-knife', 'ph.w.combat-blade']))
      expect(Object.values(open().operatives).some((o) => o.weapons.includes('ph.w.combat-blade'))).toBe(false)
      expect(Object.values(open({ equipmentA: ['ph.e.combat-blades'] }).operatives).filter((o) => o.seat === 'B').some((o) => o.weapons.includes('ph.w.combat-blade'))).toBe(false)
      // Special Issue Ammunition: an occulus bolt carbine, the rest of the turning point, its second Shoot too
      const iw = A(s, 'incursor-warrior')
      const mk = A(s, 'incursor-marksman')
      const boy = B(s, 'boy')
      const piercing = (state: GameState, id: string, weapon: string) => effectiveRules(state, state.operatives[id]!, state.data.weapons[weapon]!, 'shoot', boy).some((r) => ruleKey(r.rule) === 'piercing' && !r.crits)
      expect(piercing(s, iw, 'ph.w.occulus-bolt-carbine')).toBe(false)
      const fired = shootBoy(facing(s, iw, boy), iw, boy, 'ph.w.occulus-bolt-carbine', dice(1, 1, 1, 1), takePloy('ph.e.special-issue-ammunition'))
      expect(usedThisTp(fired.state, 'A', 'ph.ammo')).toBe(true)
      expect(piercing(fired.state, iw, 'ph.w.occulus-bolt-carbine')).toBe(true)
      // only that operative's weapon, and only once per turning point
      expect(piercing(fired.state, A(s, 'infiltrator-commsman'), 'ph.w.marksman-bolt-carbine')).toBe(false)
      const again = shootBoy(facing(edit(s, (st) => st.ledger.A.tp.push('ph.ammo')), iw, boy), iw, boy, 'ph.w.occulus-bolt-carbine', dice(1, 1, 1, 1), takePloy('ph.e.special-issue-ammunition'))
      expect(again.state.effects.some((e) => e.source === 'ph.e.special-issue-ammunition')).toBe(false)
      // the stalker marksman carbine is not one of the three named weapons
      const stalker = shootBoy(facing(s, mk, boy), mk, boy, 'ph.w.stalker-marksman-bolt-carbine', dice(1, 1, 1, 1), takePloy('ph.e.special-issue-ammunition'))
      expect(usedThisTp(stalker.state, 'A', 'ph.ammo')).toBe(false)
    }
  })

  it('TEAM-PH-007 rules verification: Tactical Advantage re-rolls a tied initiative die when the opponent settles the tie', () => {
    // R-2.1: a tie is decided by the player who did not have initiative last turning point
    const tied = (holder: 'A' | 'B') =>
      edit(open(), (st) => {
        st.strategy.rolls = { A: 4, B: 4 }
        st.initiative = holder
      })
    expect(providerInitiativeReroll(tied('A'), 'A').length).toBe(1)
    expect(providerInitiativeReroll(tied('B'), 'A')).toEqual([])
  })

  it('TEAM-PH-011 TEAM-PH-023 rules verification: Medic! APL in the saved operative own activation; Grav-chute prices each climb', () => {
    {
      // Medic! used in the saved operative's own activation ends it, so its APL -1 is held for its next activation
      const s0 = open()
      const hx = A(s0, 'infiltrator-helix-adept')
      const sg = A(s0, 'infiltrator-sergeant')
      const boy = B(s0, 'boy')
      const staged = edit(place(place(s0, hx, 0, 0), sg, 2, 0), (st) => {
        st.firefight.activation = { operativeId: sg, seat: 'A', counteract: false, stage: 'action', apSpent: 1, performed: [], declared: null }
      })
      const asked = withCtx(staged, (ctx) => {
        directDamage(ctx, sg, 99, boy, 'test')
        runDeferredRemovals(ctx)
      }).state
      const r = take(asked, 'save', dice(5)).state
      expect(r.operatives[sg]!.wounds).toBe(3)
      expect(effectiveApl(r.operatives[sg]!)).toBe(3)
      expect(r.effects.some((e) => e.kind === 'ph.aplNext' && e.operativeId === sg)).toBe(true)
      // the Helix Adept is not in its own activation: its penalty applies at once
      expect(effectiveApl(r.operatives[hx]!)).toBe(2)
      const next = withCtx(r, (ctx) => runHook('activation.start', { seat: 'A', state: ctx.state, engine: ctx, operativeId: sg, data: { previousOrder: 'engage', order: 'engage' } })).state
      expect(effectiveApl(next.operatives[sg]!)).toBe(2)
      expect(next.effects.some((e) => e.kind === 'ph.aplNext')).toBe(false)
    }
    {
      // Grav-chute: every separate climb counts as 2", not the move's total climb
      const s = open({ rosterA: phRoster(['reiver-sergeant', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-marksman', 'reiver-warrior']) })
      const op = s.operatives.A1!
      const o = op.pos
      const at = (dx: number, y: number) => ({ x: o.x + dx, y, z: o.z })
      const surcharge = (points: { x: number; y: number; z: number }[], climb: number) => providerMoveSurcharge(s, op, 'reposition', points, { horizontal: 0, accessible: 0, climb, drop: 0 })
      // two 3" walls with a ledge between: charged 3" + 3", now 2" + 2"
      expect(surcharge([at(1, 3), at(2, 3), at(3, 6)], 6)).toBe(-2)
      // one 4" climb in two increments is a single climb: charged 4", now 2"
      expect(surcharge([at(1, 2), at(1.5, 4)], 4)).toBe(-2)
      // two short climbs (charged 2" each) save nothing
      expect(surcharge([at(1, 1), at(2, 1), at(3, 2)], 4)).toBe(0)
    }
  })
})
