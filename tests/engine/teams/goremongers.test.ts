// goremongers engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-GM-nnn).
// The Goremongers are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { step, view } from '@/engine'
import { act } from '@/engine/actions'
import { actionForbidden } from '@/engine/abilities'
import { defenceStats, effectiveRules, inflict, parseRules } from '@/engine/attack-common'
import { hasKeyword } from '@/engine/conditions'
import { expireEffects, usedThisBattle, usedThisTp } from '@/engine/effects'
import { placementIssue } from '@/engine/equipment'
import { fightAvailability } from '@/engine/fight'
import { REACTION_DONE, startFreeAction } from '@/engine/firefight'
import { runHook } from '@/engine/hooks'
import { markerOffers } from '@/engine/markers'
import { planMove } from '@/engine/movement'
import { offersFor, usePloy } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { effectiveApl } from '@/engine/state'
import { providerOwnReactions, providerRerollsBanned, providerWeaponForbidden } from '@/engine/team-rules'
import { TEAM_ID, decreaseGore, goreLevel, increaseGore } from '@/engine/teams/goremongers'
import type { GameState, PendingDecision } from '@/engine/types'
import { enumerateLoadouts, loadBundle, validateRoster, type DatacardData } from '../../../src/data'
import { arm, evs, play, ranged, withWeapons } from '../../fixtures/attack'
import { drive, expectOk, place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { edit, newRealGame, passIt, realBundle, take, withCtx } from '../../fixtures/real'
import { A, B, activateStop, answerStop, bTurn, declareShoot, dice, fightFrom, fightWith, ids, MATCH, open, shootAgain, shootAt, STOP_CHOICE, svUsedBy, takePloy, toAction, toGambit, useOffer, withGore, withPloy } from './goremongers.hooks'

const data = loadBundle()

/** Answer the pending move decision with one waypoint. */
function expectMove(s: GameState, x: number): GameState {
  return expectOk(step(s, act.path(s.pending!, [{ x, z: 0 }]))).state
}

/** Aspirant at the origin, a Boy a base-width away (a melee); the Boy has plenty of wounds unless said. */
function melee(s0: GameState, who = 'aspirant', wounds = 40): { s: GameState; a: string; boy: string } {
  const a = A(s0, who)
  const boy = B(s0, 'boy')
  const s = edit(place(place(s0, a, 0, 0), boy, 1.4, 0), (st) => {
    st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = wounds
  })
  return { s, a, boy }
}

describe('TEAM-GM Goremongers', () => {
  it('TEAM-GM-000 TEAM-GM-001 TEAM-GM-002 playable team, roster rules, printed stats, fixed loadouts and the Inciter without a melee weapon', () => {
    expect(TEAM_ID).toBe('goremongers')
    const team = data.teams['goremongers']!
    expect(team.playable).toBe(true)
    const cards = realBundle.datacards
    const ok = { leader: ['gm.blood-herald'], main: ['gm.aspirant', 'gm.aspirant', 'gm.bloodtaker', 'gm.impaler', 'gm.inciter', 'gm.skullclaimer', 'gm.stalker'] }
    expect(validateRoster(team, ok, cards as never).ok).toBe(true)
    expect(validateRoster(team, { leader: ['gm.blood-herald'], main: Array<string>(7).fill('gm.aspirant') }, cards as never).ok).toBe(true)
    // a second Bloodtaker (or any single entry twice), an eighth pick, a second Herald
    expect(validateRoster(team, { ...ok, main: ['gm.aspirant', 'gm.bloodtaker', 'gm.bloodtaker', 'gm.impaler', 'gm.inciter', 'gm.skullclaimer', 'gm.stalker'] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: [...ok.main, 'gm.aspirant'] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { leader: ['gm.blood-herald', 'gm.blood-herald'], main: ok.main }, cards as never).ok).toBe(false)
    // every card is fixed: one loadout
    for (const id of ['gm.blood-herald', 'gm.aspirant', 'gm.bloodtaker', 'gm.impaler', 'gm.inciter', 'gm.skullclaimer', 'gm.stalker']) expect(enumerateLoadouts(data.byId[id] as DatacardData), id).toHaveLength(1)
    const s = open()
    for (const op of Object.values(s.operatives).filter((o) => o.seat === 'A')) {
      expect([op.apl, op.move, op.save, op.baseRadius]).toEqual([2, 7, 5, 0.63])
      expect(op.maxWounds).toBe(op.datacardId === 'gm.blood-herald' ? 11 : 10)
      for (const k of ['GOREMONGER', 'CHAOS']) expect(hasKeyword(s, op, k), `${op.name} ${k}`).toBe(true)
    }
    const w = (id: string) => data.byId[id] as { atk: number; hit: string; dmg: { normal: number; crit: number }; rules: { rule: string; x?: number; crits?: boolean }[] }
    expect(w('gm.w.icon-of-khorne')).toMatchObject({ hit: '2+', dmg: { normal: 4, crit: 4 } })
    expect(w('gm.w.fleshskewer-ranged').rules.map((r) => r.rule)).toEqual(['core.wr.range', 'core.wr.piercing', 'core.wr.stun', 'gm.a.wr-drag'])
    expect(w('gm.w.fleshskewer-ranged').rules[1]).toMatchObject({ x: 1, crits: true })
    expect(w('gm.w.fleshskewer-stab').rules).toEqual([])
    expect(w('gm.w.ritual-blade').rules.map((r) => r.rule)).toEqual(['gm.a.wr-ritual'])
    expect(w('gm.w.great-chainaxe-thrown').rules.map((r) => r.rule)).toEqual(['core.wr.range'])
    expect(w('gm.w.dual-autopistols-point-blank').rules.map((r) => r.rule)).toEqual(['core.wr.ceaseless', 'core.wr.rending'])
    // the Inciter has no melee weapon: no Fight action, and it collects no dice when an enemy fights it
    const inc = A(s, 'inciter')
    const boy = B(s, 'boy')
    const t = place(place(s, inc, 0, 0), boy, 1.4, 0)
    expect(fightAvailability(t, t.operatives[inc]!, null)).not.toBeNull()
    const u = toAction(activateStop(t, inc))
    expect(ids(u)).not.toContain('fight')
    const struck = fightWith(activateStop(bTurn(t, A(s, 'aspirant')), boy), inc, dice())
    expect(evs(struck.events, 'AttackDiceRolled').map((e) => e.operativeId)).toEqual([boy])
  })

  it('TEAM-GM-003 TEAM-GM-004 tanks start at half and are public; kills in control range or visible within 2 inches raise them, further away or with a full tank nothing', () => {
    const s = open()
    const a = A(s, 'aspirant')
    for (const seat of ['A', 'B'] as const) expect(view(s, seat).operatives[a]!.tokens?.map((t) => [t.kind, t.count])).toEqual([['gm.gore', 1]])
    // increases stop at full and decreases at empty; an empty tank holds no token
    const { state: full } = withCtx(s, (ctx) => {
      expect(increaseGore(ctx, a, 't')).toBe(true)
      expect(increaseGore(ctx, a, 't')).toBe(false)
    })
    expect(goreLevel(full, a)).toBe(2)
    const { state: empty } = withCtx(full, (ctx) => {
      expect([decreaseGore(ctx, a, 't'), decreaseGore(ctx, a, 't'), decreaseGore(ctx, a, 't')]).toEqual([true, true, false])
    })
    expect(goreLevel(empty, a)).toBe(0)
    expect(empty.operatives[a]!.tokens ?? []).toEqual([])
    // a fight kill in control range
    const m = melee(s, 'aspirant', 1)
    const fought = fightWith(toAction(activateStop(m.s, m.a)), m.boy, dice(6, 6, 6, 6))
    expect(fought.state.operatives[m.boy]!.status).toBe('removed')
    expect(goreLevel(fought.state, m.a)).toBe(2)
    // a Shoot kill from 1.5 inches (visible within 2") raises it, from 3 inches does not
    const gainFrom = (gapX: number): number => {
      const boy = B(s, 'boy')
      const t = edit(place(place(s, a, 0, 0), boy, gapX, 0), (st) => void (st.operatives[boy]!.wounds = 1))
      const r = shootAt(t, a, 'gm.w.autopistol', boy, dice(6, 6, 6, 6))
      expect(r.state.operatives[boy]!.status).toBe('removed')
      return goreLevel(r.state, a)
    }
    expect(gainFrom(1.26 + 1.5)).toBe(2)
    expect(gainFrom(1.26 + 3)).toBe(1)
  })

  it('TEAM-GM-005 TEAM-GM-006 TEAM-GM-007 Sanguavitae: each rule once, two per activation, a level per use, Rejuvenate heals D3+1, Mania lasts until the next activation, none on an empty tank or in a counteraction', () => {
    const s0 = open()
    const a = A(s0, 'aspirant')
    const hurt = edit(withGore(s0, a, 2), (st) => void (st.operatives[a]!.wounds = 4))
    let t = activateStop(hurt, a)
    expect(ids(t)).toEqual(expect.arrayContaining(['gm.x.rejuvenate', 'gm.x.mania', 'gm.x.fury']))
    // Surge is offered at a Charge or Reposition declaration only, never between actions
    expect(ids(t)).not.toContain('gm.x.surge')
    // Rejuvenate: a 6 is a 3 on the D3, plus 1
    t = take(t, 'gm.x.rejuvenate', dice(6)).state
    expect(t.operatives[a]!.wounds).toBe(8)
    expect(goreLevel(t, a)).toBe(1)
    expect(ids(t)).not.toContain('gm.x.rejuvenate')
    // Mania: APL 3 at once, and the tank is empty, so nothing more is offered (also two rules are used)
    t = take(t, 'gm.x.mania').state
    expect(effectiveApl(t.operatives[a]!)).toBe(3)
    expect(goreLevel(t, a)).toBe(0)
    expect(t.pending?.kind).toBe('firefight.action')
    expect(t.pending?.context.apRemaining).toBe(3)
    // the APL stays for marker control after the activation, and goes at the start of the next one
    const ended = take(t, 'end').state
    expect(effectiveApl(ended.operatives[a]!)).toBe(3)
    const next = withCtx(ended, (ctx) => void runHook('activation.start', { seat: 'A', state: ctx.state, engine: ctx, operativeId: a, data: { previousOrder: 'engage', order: 'engage' } })).state
    expect(effectiveApl(next.operatives[a]!)).toBe(2)
    // never Mania and Fury together, a third rule not even with a full tank
    const full = edit(withGore(s0, a, 2), (st) => void (st.operatives[a]!.wounds = 4))
    let u = take(activateStop(full, a), 'gm.x.fury').state
    expect(ids(u)).not.toContain('gm.x.mania')
    u = take(u, 'gm.x.rejuvenate', dice(2)).state
    expect(u.operatives[a]!.wounds).toBe(6)
    expect(u.pending?.kind).toBe('firefight.action')
    // not offered in a counteraction (Rejuvenate is): the operative is expended and the tank full
    const spent = edit(full, (st) => void (st.operatives[a]!.ready = false))
    const counter = offersFor(spent, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: a, counteracting: true }).map((o) => o.ployId)
    expect(counter).toContain('gm.x.rejuvenate')
    expect(counter).not.toContain('gm.x.mania')
    expect(counter).not.toContain('gm.x.fury')
    // an empty tank, or an unhurt operative for Rejuvenate, gets nothing
    const dry = withGore(s0, a, 0)
    expect(activateStop(dry, a).pending?.kind).toBe('firefight.action')
    expect(activateStop(withGore(s0, A(s0, 'bloodtaker'), 1), A(s0, 'bloodtaker')).pending?.kind).toBe('ploy.firefight')
    expect(ids(activateStop(withGore(s0, A(s0, 'bloodtaker'), 1), A(s0, 'bloodtaker')))).not.toContain('gm.x.rejuvenate')
  })

  it('TEAM-GM-008 Fury: two Fight actions in the activation, the second free (possible with no AP left); one Fight otherwise', () => {
    const { s, a, boy } = melee(open())
    // without Fury the second Fight is refused
    const plain = fightWith(toAction(activateStop(withGore(s, a, 2), a)), boy, dice())
    expect(ids(plain.state)).not.toContain('fight')
    // with Fury a second Fight is on offer and costs 0 AP
    let t = useOffer(activateStop(withGore(s, a, 2), a), 'gm.x.fury')
    t = fightWith(t, boy, dice()).state
    expect(t.firefight.activation!.apSpent).toBe(1)
    const fight = t.pending!.options!.find((o) => o.id === 'fight')
    expect(fight?.data?.cost).toBe(0)
    const second = fightWith(t, boy, dice())
    // nothing is left to do after the second Fight (one AP was spent in all), so the activation ends by itself
    expect(second.state.pending?.kind).toBe('firefight.activate')
    expect(evs(second.events, 'ApSpent').reduce((n, e) => n + e.amount, 0)).toBe(0)
    expect(evs(second.events, 'ActionResolved').map((e) => e.action)).toEqual(['fight'])
    // with no AP left the free Fight is still possible
    const broke = edit(withGore(s, a, 2), (st) => void (st.operatives[a]!.apl = 1))
    let u = useOffer(activateStop(broke, a), 'gm.x.fury')
    u = fightWith(u, boy, dice()).state
    expect(u.pending!.context.apRemaining).toBe(0)
    expect(ids(u)).toContain('fight')
  })

  it('TEAM-GM-009 TEAM-GM-010 Rake (D3 to an enemy in control range once the Charge has moved, activations only) and Surge (+1 inch on a Reposition or Charge, spent when the move is declared)', () => {
    const s0 = open()
    const a = A(s0, 'aspirant')
    const boy = B(s0, 'boy')
    const far = edit(place(place(s0, a, 0, 0), boy, 4, 0), (st) => void (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40))
    let t = toAction(take(toAction(activateStop(far, a)), 'charge').state)
    expect(t.pending!.constraints!.maxInches).toBe(9)
    t = expectMove(t, 2.2)
    expect(t.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.chargeMoved' })
    expect(ids(t)).toContain(`gm.x.rake:${boy}`)
    t = take(t, `gm.x.rake:${boy}`, dice(4)).state
    expect(t.operatives[boy]!.wounds).toBe(38)
    expect(goreLevel(t, a)).toBe(0)
    // not offered on a counteraction's Charge
    const counter = offersFor(edit(t, (st) => void (st.firefight.activation!.counteract = true)), 'A', 'firefight.chargeMoved', { window: 'firefight.chargeMoved', subjectId: a, counteracting: true })
    expect(counter.map((o) => o.ployId)).not.toContain('gm.x.rake')
    // Surge: offered in the Reposition's declaration window and spent there
    let r = take(toAction(activateStop(place(s0, a, 0, 0), a)), 'reposition').state
    expect(r.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.actionDeclared' })
    expect(goreLevel(r, a)).toBe(1)
    r = useOffer(r, 'gm.x.surge:reposition')
    expect(goreLevel(r, a)).toBe(0)
    expect(r.pending!.constraints!.maxInches).toBe(8)
    // ... a Charge gets 10 inches
    const c = useOffer(take(toAction(activateStop(far, a)), 'charge').state, 'gm.x.surge:charge')
    expect(c.pending!.constraints!.maxInches).toBe(10)
    // passed at the declaration: the tank stays and the move is the plain one
    const plain = toAction(take(toAction(activateStop(place(s0, a, 0, 0), a)), 'reposition').state)
    expect(goreLevel(plain, a)).toBe(1)
    expect(plain.pending!.constraints!.maxInches).toBe(7)
    // no Surge on an empty tank, nor on a Dash
    expect(take(toAction(activateStop(withGore(place(s0, a, 0, 0), a, 0), a)), 'reposition').state.pending?.kind).toBe('move.path')
    expect(ids(take(toAction(activateStop(place(s0, a, 0, 0), a)), 'dash').state)).not.toContain('gm.x.surge:dash')
  })

  it('TEAM-GM-010 Surge in a free frame: offered at the declaration of a free Charge inside the activation (info free), never on the Strategy-phase Charge of Hunt for Blood', () => {
    const s0 = open()
    const a = A(s0, 'aspirant')
    const boy = B(s0, 'boy')
    const near = edit(place(place(s0, a, 0, 0), boy, 4, 0), (st) => void (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40))
    // a free Charge started inside the Aspirant's activation (the Obsessive Bloodlust shape) opens the declaration window
    const inAct = withCtx(toAction(activateStop(near, a)), (ctx) => void startFreeAction(ctx, { operativeId: a, action: 'charge', maxMove: 2, resume: REACTION_DONE })).state
    expect(inAct.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.actionDeclared' })
    expect(inAct.window?.info).toMatchObject({ action: 'charge', free: true })
    expect(ids(inAct)).toContain('gm.x.surge:charge')
    // outside any activation (a Strategy-phase free Charge) the Sanguavitae limits have nothing to count against: no offer
    expect(offersFor(near, 'A', 'firefight.actionDeclared', { window: 'firefight.actionDeclared', subjectId: a, action: 'charge', free: true }).map((o) => o.ployId)).not.toContain('gm.x.surge')
  })

  it('TEAM-GM-011 TEAM-GM-026 Rage (+1 Atk for that Fight only) and Enhanced Violence (Balanced at half, Relentless at full, read after the Rage lowering; ranged weapons and an empty tank unchanged)', () => {
    const { s, a, boy } = melee(open())
    const withEv = withPloy(withGore(s, a, 2), 'gm.p.enhanced-violence')
    const rules = (st: GameState, w = 'gm.w.chainglaive') => effectiveRules(st, st.operatives[a]!, st.data.weapons[w]!, w === 'gm.w.autopistol' ? 'shoot' : 'fight', boy).map((r) => r.rule.replace('core.wr.', '')).sort()
    expect(rules(withEv)).toEqual(['relentless', 'rending'])
    expect(rules(withGore(withEv, a, 1))).toEqual(['balanced', 'rending'])
    expect(rules(withGore(withEv, a, 0))).toEqual(['rending'])
    expect(rules(withEv, 'gm.w.autopistol')).toEqual(['range'])
    // Rage on a full tank: Atk 5, and the tank (now half) gives Balanced, not Relentless
    let t = toAction(activateStop(withEv, a))
    t = take(t, 'fight').state
    expect(ids(t)).toContain('gm.x.rage')
    t = take(t, 'gm.x.rage').state
    expect(goreLevel(t, a)).toBe(1)
    while (t.pending?.kind === 'ploy.firefight') t = passIt(t).state
    const r = fightFrom(t, boy, dice())
    expect(evs(r.events, 'AttackDiceRolled').find((e) => e.operativeId === a)!.dice).toHaveLength(5)
    expect(rules(r.state)).toEqual(['balanced', 'rending'])
    // the Atk is for that Fight only
    expect(r.state.effects.some((e) => e.kind === 'gm.rage')).toBe(false)
  })

  it('TEAM-GM-012 Runes of Khorne: 8 wounds at most per Shoot action across its sequences, the next Shoot starts again, a fight is uncapped', () => {
    const s0 = open()
    const a = A(s0, 'aspirant')
    const boy = B(s0, 'boy')
    const shooting = (kind: 'shoot' | 'fight') =>
      edit(s0, (st) => {
        st.attack = { kind, stage: 'resolve', operativeId: boy, seat: 'B', weaponId: null, pointBlank: false, targets: [a], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] } as never
      })
    // 12 damage in one Shoot action: 6 + 6 in two sequences (a Blast secondary counts) loses 8
    let t = withCtx(shooting('shoot'), (ctx) => {
      inflict(ctx, { targetId: a, attackerId: boy, weaponId: null, amount: 6, source: 'normal' })
      inflict(ctx, { targetId: a, attackerId: boy, weaponId: null, amount: 6, source: 'devastating' })
    }).state
    expect(t.operatives[a]!.wounds).toBe(2)
    // the next Shoot action can take the rest
    t = withCtx(t, (ctx) => {
      expireEffects(ctx, 'action')
      inflict(ctx, { targetId: a, attackerId: boy, weaponId: null, amount: 6, source: 'normal' })
    }).state
    expect(t.operatives[a]!.wounds).toBe(0)
    // a fight is uncapped
    const f = withCtx(shooting('fight'), (ctx) => void inflict(ctx, { targetId: a, attackerId: boy, weaponId: null, amount: 12, source: 'strike-crit' })).state
    expect(f.operatives[a]!.wounds).toBe(0)
  })

  it('TEAM-GM-013 TEAM-GM-014 TEAM-GM-015 Khorne\'s Favour (empty tank, once per activation, not in a counteraction), Impending Apotheosis (a discarded success in a Shoot, an ignored lethal strike in a fight, once per battle) and Obsessive Bloodlust (a free 2" Charge after a Fight, once per turning point for the team)', () => {
    const s0 = open()
    const h = A(s0, 'blood-herald')
    // Khorne's Favour
    const dry = withGore(s0, h, 0)
    let t = activateStop(dry, h)
    expect(ids(t)).toContain('gm.x.favour')
    t = take(t, 'gm.x.favour').state
    expect(goreLevel(t, h)).toBe(1)
    expect(ids(t)).not.toContain('gm.x.favour')
    const counter = offersFor(edit(dry, (st) => void (st.operatives[h]!.ready = false)), 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: h, counteracting: true })
    expect(counter.map((o) => o.ployId)).not.toContain('gm.x.favour')
    expect(ids(activateStop(s0, h))).not.toContain('gm.x.favour')
    // Apotheosis in a Shoot: a Boy leaves 2 normals unblocked, the Herald discards one (3 of 11 wounds lost)
    const boy = B(s0, 'boy')
    const facing = place(place(s0, h, 6, 0), boy, 0, 0)
    const bShot = shootAt(bTurn(facing, A(s0, 'aspirant')), boy, 'kom.w.slugga', h, dice(4, 4, 1, 1), takePloy('gm.x.apotheosis'))
    expect(bShot.state.operatives[h]!.wounds).toBe(8)
    expect(bShot.state.operatives[h]!.tokens?.some((k) => k.kind === 'gm.apotheosis')).toBe(true)
    expect(usedThisBattle(bShot.state, 'A', 'gm.apotheosis')).toBe(true)
    // ... once per battle: the next Boy's Shoot loses both hits
    const aspirants = Object.values(s0.operatives).filter((o) => o.datacardId === 'gm.aspirant' && o.seat === 'A')
    const breacha = B(s0, 'breacha-boy')
    const nextShot = place(bTurn(take(bShot.state, 'end').state, aspirants[1]!.id), breacha, 0, 1.5)
    const again = shootAt(nextShot, breacha, 'kom.w.slugga', h, dice(4, 4, 1, 1), takePloy('gm.x.apotheosis'))
    expect(again.state.operatives[h]!.wounds).toBe(2)
    // in a fight the first normal strike that would incapacitate it is ignored
    const close = edit(place(place(s0, h, 0, 0), boy, 1.4, 0), (st) => void (st.operatives[h]!.wounds = 2))
    const hit = fightWith(activateStop(bTurn(close, A(s0, 'aspirant')), boy), h, dice(4, 1, 1, 1))
    expect(hit.state.operatives[h]!.wounds).toBe(2)
    expect(hit.state.operatives[h]!.tokens?.some((k) => k.kind === 'gm.apotheosis')).toBe(true)
    // ... judged after Gory Tenacity: a first strike of 4 halved to 2 does not kill a 3-wound Herald, so it is not spent
    const tenacious = withPloy(edit(place(place(s0, h, 0, 0), boy, 1.4, 0), (st) => void (st.operatives[h]!.wounds = 3)), 'gm.p.gory-tenacity')
    const halved = fightWith(activateStop(bTurn(tenacious, A(s0, 'aspirant')), boy), h, dice(4, 1, 1, 1))
    expect(halved.state.operatives[h]!.wounds).toBe(1)
    expect(usedThisBattle(halved.state, 'A', 'gm.apotheosis')).toBe(false)
    // ... and a lethal first strike it ignores was still the first strike: the next one is not halved
    const strikeHerald = (st: GameState, amount: number): GameState =>
      withCtx(st, (ctx) => {
        const data = { die: 'normal', amount, cancel: false }
        runHook('beforeStrike', { seat: 'B', state: ctx.state, engine: ctx, operativeId: boy, targetId: h, weaponId: 'kom.w.choppa', data })
        if (!data.cancel) inflict(ctx, { targetId: h, attackerId: boy, weaponId: 'kom.w.choppa', amount, source: 'strike-normal' })
      }).state
    const lowHerald = withPloy(edit(s0, (st) => void (st.operatives[h]!.wounds = 3)), 'gm.p.gory-tenacity')
    const ignored = strikeHerald(lowHerald, 6)
    expect(ignored.operatives[h]!.wounds).toBe(3)
    expect(usedThisBattle(ignored, 'A', 'gm.apotheosis')).toBe(true)
    expect(strikeHerald(ignored, 4).operatives[h]!.wounds).toBeLessThanOrEqual(0)
    // Obsessive Bloodlust: the Aspirant kills a lone Boy, another stands 2.5 inches off
    const a = A(s0, 'aspirant')
    const grot = B(s0, 'grot')
    const kill = edit(place(place(place(s0, a, 0, 0), boy, 1.4, 0), grot, 3.62, 0), (st) => void (st.operatives[boy]!.wounds = 1))
    const done = fightWith(activateStop(kill, a), boy, dice(6, 6, 6, 6), {}, STOP_CHOICE)
    expect(done.state.pending).toMatchObject({ kind: 'ability.choice', seat: 'A' })
    expect(done.state.operatives[boy]!.status).toBe('removed')
    let c = take(done.state, 'react:0').state
    // the free Charge opens its declaration window (info free): Surge is offered there, and the 2 inch cap still wins
    expect(c.window?.info).toMatchObject({ action: 'charge', free: true })
    expect(ids(c)).toContain('gm.x.surge:charge')
    c = toAction(c)
    expect(c.pending!.constraints!.maxInches).toBe(2)
    c = expectMove(c, 1.7)
    // Rake is on offer after the free Charge's move too (it is a Charge in its activation)
    expect(ids(c)).toEqual([`gm.x.rake:${grot}`])
    c = toAction(c)
    // the free Charge is not part of the activation: the team's use is spent, the activation's list is just the Fight
    expect(usedThisTp(c, 'A', 'gm.bloodlust')).toBe(true)
    const second = Object.values(c.operatives).filter((o) => o.datacardId === 'gm.aspirant' && o.seat === 'A')[1]!
    expect(providerOwnReactions(c, 'A', { actorId: second.id, action: 'fight', activeSeat: 'A', moved: false })).toEqual([])
  })

  it('TEAM-GM-016 TEAM-GM-017 Ritual (+1 level the first time the ritual blade wounds in a sequence, a kill adds another) and Transfusion Ritual (one level from the Bloodtaker to a friend within 8 inches, outside the Sanguavitae limits)', () => {
    const s0 = open()
    const b = A(s0, 'bloodtaker')
    const boy = B(s0, 'boy')
    // four crits strike one after another, the tank rises once
    const m = melee(withGore(s0, b, 0), 'bloodtaker')
    const long = fightWith(activateStop(m.s, b), boy, dice(6, 6, 6, 6))
    expect(goreLevel(long.state, b)).toBe(1)
    // a kill in the same sequence adds one more
    const weak = edit(m.s, (st) => void (st.operatives[boy]!.wounds = 5))
    const kill = fightWith(activateStop(withGore(weak, b, 0), b), boy, dice(6, 6, 6, 6))
    expect(kill.state.operatives[boy]!.status).toBe('removed')
    expect(goreLevel(kill.state, b)).toBe(2)
    // retaliating counts: the Boy fights the Bloodtaker and the first damage it takes back raises the tank
    // Transfusion: the Aspirant (half) at 3 inches takes a level, a full tank and a distant friend do not
    const a = A(s0, 'aspirant')
    const full = Object.values(s0.operatives).filter((o) => o.datacardId === 'gm.aspirant' && o.seat === 'A')[1]!.id
    const far = A(s0, 'stalker')
    const field = withGore(place(place(place(place(s0, b, 0, 0), a, 3, 0), full, 0, 3), far, 10, 0), full, 2)
    let t = toAction(activateStop(field, b))
    expect(ids(t)).toContain(`ability:gm.a.transfusion-ritual:${a}`)
    expect(ids(t)).not.toContain(`ability:gm.a.transfusion-ritual:${full}`)
    expect(ids(t)).not.toContain(`ability:gm.a.transfusion-ritual:${far}`)
    t = take(t, `ability:gm.a.transfusion-ritual:${a}`).state
    expect([goreLevel(t, b), goreLevel(t, a)]).toEqual([0, 2])
    // not with an empty tank, nor in an enemy control range; it does not count as a Sanguavitae use
    expect(ids(toAction(activateStop(withGore(field, b, 0), b))).some((i) => i.startsWith('ability:gm.a.transfusion-ritual'))).toBe(false)
    const engaged = place(field, boy, 1.4, 0)
    expect(ids(toAction(activateStop(engaged, b))).some((i) => i.startsWith('ability:gm.a.transfusion-ritual'))).toBe(false)
    const two = withGore(field, b, 2)
    const used = take(toAction(activateStop(two, b)), `ability:gm.a.transfusion-ritual:${a}`).state
    expect(svUsedBy(used, b)).toEqual([])
  })

  it('TEAM-GM-018 TEAM-GM-019 Drag (up to 2 inches per unblocked success towards the Impaler, then discards) and Gore-fuel (Severe on both fleshskewer profiles until one is used, outside the Sanguavitae count)', () => {
    const s0 = open()
    const imp = A(s0, 'impaler')
    const boy = B(s0, 'boy')
    const field = place(place(s0, imp, 0, 0), boy, 6, 0)
    // four crits unblocked: x is 8; drag 6 inches (the Boy ends against the Impaler), then discard three of the crits
    const plan = ['gm.x.drag:6', 'gm.x.discard:crit', 'gm.x.discard:crit', 'gm.x.discard:crit']
    let i = 0
    const answers = {
      'ploy.firefight': (p: PendingDecision) => {
        const o = p.window === 'shoot.beforeResolve' && i < plan.length ? p.options!.find((x) => x.id === plan[i]) : undefined
        if (o) i++
        return o?.action ?? act.pass(p)
      },
    }
    const shot = shootAt(field, imp, 'gm.w.fleshskewer-ranged', boy, dice(6, 6, 6, 6), answers)
    expect(i).toBe(4)
    expect(shot.state.operatives[boy]!.pos.x).toBeCloseTo(1.26, 1)
    expect(shot.state.operatives[boy]!.wounds).toBe(5)
    // the offers: every whole inch up to the reach, then the discards; drag 0 only moves on to the discards
    let w = declareShoot(toAction(activateStop(field, imp, 'engage', dice(6, 6, 6, 6))), 'gm.w.fleshskewer-ranged', boy, dice(6, 6, 6, 6)).state
    for (let n = 0; n < 30 && !(w.pending?.kind === 'ploy.firefight' && w.pending.window === 'shoot.beforeResolve'); n++) w = expectOk(step(w, answerStop(w), dice(6, 6, 6, 6))).state
    expect(ids(w)).toContain('gm.x.drag:0')
    expect(ids(w).filter((o) => o.startsWith('gm.x.drag:')).length).toBeGreaterThanOrEqual(6)
    expect(ids(w)).not.toContain('gm.x.discard:crit')
    const dragged0 = take(w, 'gm.x.drag:0').state
    expect(ids(dragged0)).toContain('gm.x.discard:crit')
    expect(ids(dragged0).some((o) => o.startsWith('gm.x.drag:'))).toBe(false)
    // Gore-fuel: Severe on both profiles, the tank drops, no Sanguavitae use is counted, and the next use ends it
    const fuel = take(toAction(activateStop(withGore(field, imp, 2), imp)), 'ability:gm.a.gore-fuel').state
    expect(goreLevel(fuel, imp)).toBe(1)
    expect(svUsedBy(fuel, imp)).toEqual([])
    for (const w2 of ['gm.w.fleshskewer-ranged', 'gm.w.fleshskewer-stab']) {
      expect(effectiveRules(fuel, fuel.operatives[imp]!, fuel.data.weapons[w2]!, 'shoot', boy).map((r) => r.rule)).toContain('severe')
    }
    const retained = (st: GameState) => evs(shootAgain(st, 'gm.w.fleshskewer-ranged', boy, dice(4, 4, 1, 1)).events, 'AttackRetained')[0]!
    expect(retained(fuel)).toMatchObject({ normal: 1, crit: 1 })
    const plain = retained(toAction(activateStop(field, imp)))
    expect(plain).toMatchObject({ normal: 2, crit: 0 })
    const spent = shootAgain(fuel, 'gm.w.fleshskewer-ranged', boy, dice(4, 4, 1, 1)).state
    expect(spent.operatives[imp]!.tokens?.some((k) => k.kind === 'gm.gore-fuel') ?? false).toBe(false)
    // not with an empty tank or in an enemy control range
    expect(ids(toAction(activateStop(withGore(field, imp, 0), imp)))).not.toContain('ability:gm.a.gore-fuel')
    expect(ids(toAction(activateStop(place(field, boy, 1.4, 0), imp)))).not.toContain('ability:gm.a.gore-fuel')
  })

  it('TEAM-GM-020 TEAM-GM-021 TEAM-GM-022 Dash and Spray (a free Dash and a free focused Shoot in either order, then neither again), Incite the Hunt (a kill from more than 2 inches) and Bleeding (one token per survivor, spent for a level)', () => {
    const s0 = open()
    const inc = A(s0, 'inciter')
    const boy = B(s0, 'boy')
    const field = place(place(s0, inc, 0, 0), boy, 10, 0)
    let t = toAction(activateStop(field, inc))
    t = take(t, 'ability:gm.a.dash-and-spray').state
    expect(ids(t)).toEqual(['dash', 'shoot'])
    t = take(t, 'dash').state
    t = expectMove(t, 3)
    // the free Shoot: only the focused profile is on offer
    expect(t.pending!.kind).toBe('shoot.weapon')
    expect(ids(t)).toEqual(['gm.w.dual-autopistols-focused'])
    t = take(t, 'gm.w.dual-autopistols-focused').state
    const done = play(take(t, boy, dice(1, 1, 1, 1)).state, dice(1, 1, 1, 1), takePloy(''))
    expect(done.state.pending?.kind).toBe('firefight.action')
    expect(done.state.firefight.activation!.performed).toEqual(['dash', 'shoot', 'ability:gm.a.dash-and-spray'])
    expect(ids(done.state)).not.toContain('dash')
    expect(ids(done.state)).not.toContain('shoot')
    // not on Conceal, nor in an enemy control range, nor after the Inciter already Dashed
    expect(ids(toAction(activateStop(field, inc, 'conceal')))).not.toContain('ability:gm.a.dash-and-spray')
    expect(ids(toAction(activateStop(place(field, boy, 1.4, 0), inc)))).not.toContain('ability:gm.a.dash-and-spray')
    const dashed = take(toAction(activateStop(field, inc)), 'dash').state
    expect(ids(expectMove(dashed, 3))).not.toContain('ability:gm.a.dash-and-spray')
    // ... nor after a Charge in the activation (its free Dash would be a Dash after a Charge)
    const charged = toAction(edit(activateStop(field, inc), (st) => void st.firefight.activation!.performed.push('charge')))
    expect(ids(charged)).not.toContain('ability:gm.a.dash-and-spray')
    // Incite the Hunt: a kill at 5 inches offers a level to a friend within 8 inches of the dead enemy (the Inciter included)
    const a = A(s0, 'aspirant')
    const far = edit(withGore(place(place(place(s0, inc, 0, 0), boy, 6.26, 0), a, 3, 3), a, 0), (st) => void (st.operatives[boy]!.wounds = 1))
    const kill = shootAt(far, inc, 'gm.w.dual-autopistols-focused', boy, dice(6, 6, 6, 6), takePloy(`gm.x.incite:${a}`))
    expect(kill.state.operatives[boy]!.status).toBe('removed')
    expect(goreLevel(kill.state, a)).toBe(1)
    // ... at 2 inches nothing is offered
    const near = edit(withGore(place(place(place(s0, inc, 0, 0), boy, 3.26, 0), a, -1, 4), a, 0), (st) => void (st.operatives[boy]!.wounds = 1))
    const close = shootAt(near, inc, 'gm.w.dual-autopistols-focused', boy, dice(6, 6, 6, 6), takePloy(`gm.x.incite:${a}`))
    expect(goreLevel(close.state, a)).toBe(0)
    // Bleeding: a surviving enemy gains one token (never two), a friend within 8 inches may spend it for a level
    const tough = edit(withGore(place(place(place(s0, inc, 0, 0), boy, 6.26, 0), a, 3, 3), a, 0), (st) => void (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40))
    const wounded = shootAt(tough, inc, 'gm.w.dual-autopistols-focused', boy, dice(6, 6, 6, 6))
    expect(wounded.state.operatives[boy]!.tokens?.map((k) => [k.kind, k.owner, k.count])).toEqual([['gm.bleeding', 'A', 1]])
    const offered = offersFor(wounded.state, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: a }).filter((o) => o.ployId === 'gm.x.bleeding')
    expect(offered.map((o) => o.param)).toEqual([boy])
    const spent = withCtx(wounded.state, (ctx) => {
      const o = offered[0]!
      usePloy(ctx, 'A', o, { window: 'firefight.activationStart', subjectId: a })
    }).state
    expect(goreLevel(spent, a)).toBe(1)
    expect(spent.operatives[boy]!.tokens ?? []).toEqual([])
    // not with a full tank or at 9 inches
    expect(offersFor(withGore(wounded.state, a, 2), 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: a }).map((o) => o.ployId)).not.toContain('gm.x.bleeding')
    expect(offersFor(place(wounded.state, a, -4, 0), 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: a }).map((o) => o.ployId)).not.toContain('gm.x.bleeding')
  })

  it('TEAM-GM-023 TEAM-GM-024 TEAM-GM-028 Brutish (a crit deals the weapon\'s Normal Dmg, Devastating unchanged), Claim Skull (1 CP once per turning point for a great chainaxe kill) and Gory Tenacity (the first strike halved, rounding up, never below 2, never raised)', () => {
    const s0 = open()
    const sk = A(s0, 'skullclaimer')
    const boy = B(s0, 'boy')
    const lost = (st: GameState, weaponId: string, amount: number, source: string): number =>
      10 - withCtx(st, (ctx) => void inflict(ctx, { targetId: sk, attackerId: boy, weaponId, amount, source })).state.operatives[sk]!.wounds
    expect(lost(s0, 'kom.w.choppa', 5, 'strike-crit')).toBe(4)
    expect(lost(s0, 'kom.w.slugga', 4, 'crit')).toBe(3)
    expect(lost(s0, 'kom.w.power-klaw', 7, 'strike-crit')).toBe(5)
    expect(lost(s0, 'kom.w.choppa', 4, 'strike-normal')).toBe(4)
    expect(lost(s0, 'kom.w.slugga', 3, 'devastating')).toBe(3)
    // Gory Tenacity: 5 -> 3, then 5; 3 -> 2; 1 -> 1; after Brutish a 7 from the klaw is 5 and then 3
    const tough = withPloy(s0, 'gm.p.gory-tenacity')
    expect(lost(tough, 'kom.w.choppa', 5, 'strike-normal')).toBe(3)
    const twice = withCtx(tough, (ctx) => {
      inflict(ctx, { targetId: sk, attackerId: boy, weaponId: 'kom.w.choppa', amount: 5, source: 'strike-normal' })
      inflict(ctx, { targetId: sk, attackerId: boy, weaponId: 'kom.w.choppa', amount: 5, source: 'strike-normal' })
    }).state
    expect(twice.operatives[sk]!.wounds).toBe(2)
    expect(lost(tough, 'kom.w.choppa', 3, 'strike-normal')).toBe(2)
    expect(lost(tough, 'kom.w.choppa', 1, 'strike-normal')).toBe(1)
    expect(lost(tough, 'kom.w.power-klaw', 7, 'strike-crit')).toBe(3)
    expect(lost(tough, 'kom.w.slugga', 4, 'normal')).toBe(4)
    // Claim Skull: two great chainaxe kills with Fury give 1 CP in all; an autopistol kill gives none
    const grot = B(s0, 'grot')
    const duel = edit(withGore(place(place(place(s0, sk, 0, 0), boy, 1.4, 0), grot, -1.3, 0), sk, 2), (st) => {
      st.operatives[boy]!.wounds = 1
      st.operatives[grot]!.wounds = 1
    })
    let t = useOffer(activateStop(duel, sk), 'gm.x.fury')
    const rng = new ScriptedRng([6, 6, 6, 6, 1, 1, 1, 1, 6, 6, 6, 6, ...Array<number>(120).fill(1)])
    t = fightWith(t, boy, rng).state
    t = fightWith(t, grot, rng).state
    expect(t.operatives[boy]!.status).toBe('removed')
    expect(t.operatives[grot]!.status).toBe('removed')
    expect(t.players.A.cp).toBe(1)
    expect(usedThisTp(t, 'A', 'gm.claimSkull')).toBe(true)
    expect(t.operatives[sk]!.tokens?.some((k) => k.kind === 'gm.claim-skull')).toBe(true)
    const shot = edit(place(place(s0, sk, 0, 0), boy, 4, 0), (st) => void (st.operatives[boy]!.wounds = 1))
    const killed = shootAt(shot, sk, 'gm.w.autopistol', boy, dice(6, 6, 6, 6))
    expect(killed.state.operatives[boy]!.status).toBe('removed')
    expect(killed.state.players.A.cp).toBe(0)
  })

  it('TEAM-GM-025 TEAM-GM-027 TEAM-GM-029 TEAM-GM-030 Climbing Picks and Rooftop Stalker, Augmented Endurance, Hunt for Blood and Unbridled Aggression', () => {
    const s0 = open()
    const a = A(s0, 'aspirant')
    const st = A(s0, 'stalker')
    const boy = B(s0, 'boy')
    // Climbing Picks: a 3" climb costs 2" for the Stalker, so a path that is just too long for an Aspirant is fine for it
    const hill = feature('gm-hill', part('gm-hill.a', rect(-5, -2, -2, 2), 3, ['vantage']))
    const land = edit(s0, (x) => void (x.map = { ...x.map, features: [hill] }))
    const climb = (who: string): boolean => {
      const t = place(land, who, 0, 0)
      return planMove(t, t.operatives[who]!, 'reposition', [{ x: -4.2, z: 0, y: 3 }]).ok
    }
    expect(climb(a)).toBe(false)
    expect(climb(st)).toBe(true)
    // Rooftop Stalker: a Charge down off the Vantage hill (a 3" drop) gives Relentless when it fights; so does an enemy up on the hill
    const rules = (state: GameState, attackerId: string, targetId: string): string[] =>
      effectiveRules(
        edit(state, (x) => {
          x.attack = { kind: 'fight', stage: 'resolve', operativeId: attackerId, seat: x.operatives[attackerId]!.seat, weaponId: null, pointBlank: false, targets: [targetId], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] } as never
        }),
        state.operatives[st]!,
        state.data.weapons['gm.w.pickrippers']!,
        'fight',
        targetId,
      ).map((r) => r.rule.replace('core.wr.', ''))
    expect(rules(land, st, boy)).toEqual(['rending'])
    const down = edit(place(place(land, st, -3.5, 0, 3), boy, 0.6, 0), (x) => void (x.operatives[boy]!.wounds = x.operatives[boy]!.maxWounds = 40))
    let t = toAction(take(toAction(activateStop(down, st)), 'charge').state)
    t = expectOk(step(t, act.path(t.pending!, [{ x: -1, z: 0, y: 0 }]))).state
    t = toAction(t)
    expect(t.effects.some((e) => e.kind === 'gm.dropped' && e.operativeId === st)).toBe(true)
    expect(rules(t, st, boy)).toEqual(['rending', 'relentless'])
    // ... but not when retaliating
    expect(rules(t, boy, st)).toEqual(['rending'])
    // an enemy on the hill, 2" or more up, also gives it
    const up = place(place(land, st, -3.5, 0.8, 3), boy, -3.5, -0.8, 3)
    expect(rules(up, st, boy)).toEqual(['rending', 'relentless'])
    expect(rules(place(place(land, st, -3.5, 0.8, 0), boy, -3.5, -0.8, 0), st, boy)).toEqual(['rending'])
    // Augmented Endurance: one re-roll at half, any at full, none when empty
    const grants = (lv: 0 | 1 | 2): string[] =>
      defenceStats(withGore(withPloy(s0, 'gm.p.augmented-endurance'), a, lv), a, boy, 'kom.w.slugga', parseRules(s0.data.weapons['kom.w.slugga']!.rules), false).grants.map((g) => `${g.id}:${g.mode}`)
    expect(grants(2)).toEqual(['gm.endurance:any'])
    expect(grants(1)).toEqual(['gm.endurance:one'])
    expect(grants(0)).toEqual([])
    // Unbridled Aggression: after a Charge, Severe turns a normal into a crit (not without the Charge)
    const far = edit(place(place(s0, a, 0, 0), boy, 4, 0), (x) => {
      x.players.A.cp = 1
      x.operatives[boy]!.wounds = x.operatives[boy]!.maxWounds = 40
    })
    let c = toAction(take(toAction(activateStop(far, a)), 'charge').state)
    c = toAction(expectMove(c, 2.2))
    const charged = fightWith(c, boy, dice(3, 3, 2, 2), takePloy('gm.p.unbridled-aggression'))
    expect(evs(charged.events, 'AttackRetained')[0]).toMatchObject({ operativeId: a, normal: 1, crit: 1 })
    expect(charged.state.players.A.cp).toBe(0)
    const still = edit(place(place(s0, a, 0, 0), boy, 1.4, 0), (x) => {
      x.players.A.cp = 1
      x.operatives[boy]!.wounds = x.operatives[boy]!.maxWounds = 40
    })
    const walked = fightWith(activateStop(still, a), boy, dice(3, 3, 2, 2), takePloy('gm.p.unbridled-aggression'))
    expect(evs(walked.events, 'AttackRetained')[0]).toMatchObject({ operativeId: a, normal: 2, crit: 0 })
    expect(walked.state.players.A.cp).toBe(1)
    // Hunt for Blood: a Conceal Goremonger becomes Engage and may Charge up to 3" in the Strategy phase
    const g = edit(place(place(toGambit(), a, 0, 0), boy, 3, 0), (x) => {
      x.players.A.cp = 2
      x.operatives[a]!.order = 'conceal'
    })
    let h = take(g, `gm.p.hunt-for-blood:${a}`).state
    expect(h.operatives[a]!.order).toBe('engage')
    expect(h.pending).toMatchObject({ kind: 'move.path', seat: 'A' })
    expect(h.pending!.constraints!.maxInches).toBe(3)
    h = expectMove(h, 1.2)
    expect(h.pending?.kind).toBe('strategy.gambit')
    expect(h.players.A.cp).toBe(1)
    expect(h.operatives[a]!.pos.x).toBeCloseTo(1.2)
  })

  it('TEAM-GM-031 TEAM-GM-032 TEAM-GM-033 Gorethirst (a Conceal Goremonger counteracts for 1 CP as an Engage operative that may only Charge, Shoot or Fight), Destructive Demise (damage by the tank when an attack takes it down) and Lacerate Flesh (a level now, a level back or D3 damage at the end)', () => {
    const s0 = open()
    const h = A(s0, 'blood-herald')
    const a = A(s0, 'aspirant')
    const boy = B(s0, 'boy')
    // everyone but the Herald is expended; the Herald ends, a Boy ends, and the Goremongers may counteract
    const counterSetup = (cp: number): GameState =>
      edit(s0, (st) => {
        st.players.A.cp = cp
        for (const o of Object.values(st.operatives)) if (o.seat === 'A' && o.id !== h) o.ready = false
        st.operatives[a]!.order = 'conceal'
      })
    const toCounter = (cp: number): GameState => {
      let t = take(toAction(activateStop(counterSetup(cp), h)), 'end').state
      t = take(toAction(activateStop(t, boy)), 'end').state
      return t
    }
    expect(ids(toCounter(0))).not.toContain(`counteract:${a}`)
    expect(ids(toCounter(0))).toContain(`counteract:${h}`)
    let t = toCounter(1)
    expect(ids(t)).toContain(`counteract:${a}`)
    t = take(t, `counteract:${a}`).state
    expect(ids(t)).toContain('gm.p.gorethirst')
    // unpaid it can do nothing at all: no action, and no Sanguavitae (Surge), Bleeding or Lacerate Flesh before the ploy
    expect(actionForbidden(t, t.operatives[a]!, 'charge')).not.toBeNull()
    expect(ids(t)).toEqual(['gm.p.gorethirst'])
    const dryCounter = take(withGore(toCounter(2), a, 0), `counteract:${a}`).state
    expect(ids(dryCounter)).toEqual(['gm.p.gorethirst'])
    expect(ids(take(dryCounter, 'gm.p.gorethirst').state)).toContain('gm.p.lacerate-flesh')
    t = take(t, 'gm.p.gorethirst').state
    // paid: Surge is offered when the counteraction's Charge is declared
    expect(ids(take(t, 'charge').state)).toContain('gm.x.surge:charge')
    expect(t.operatives[a]!.order).toBe('engage')
    expect(t.players.A.cp).toBe(0)
    expect(usedThisTp(t, 'A', 'gm.p.gorethirst')).toBe(true)
    expect(actionForbidden(t, t.operatives[a]!, 'charge')).toBeNull()
    expect(actionForbidden(t, t.operatives[a]!, 'reposition')).not.toBeNull()
    expect(actionForbidden(t, t.operatives[a]!, 'guard')).not.toBeNull()
    // Destructive Demise: a Boy takes a 1-wound Aspirant down in a fight and takes D3 + 2 (full tank) back
    const duel = edit(withGore(place(place(s0, a, 0, 0), boy, 1.4, 0), a, 2), (st) => {
      st.players.A.cp = 1
      st.operatives[a]!.wounds = 1
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 20
    })
    const rng = new ScriptedRng([6, 6, 6, 6, 1, 1, 1, 1, 6, ...Array<number>(120).fill(1)])
    const demise = fightWith(activateStop(bTurn(duel, A(s0, 'bloodtaker')), boy), a, rng, takePloy(`gm.p.destructive-demise:${boy}`))
    expect(demise.state.operatives[a]!.status).toBe('removed')
    expect(demise.state.operatives[boy]!.wounds).toBe(15)
    expect(demise.state.players.A.cp).toBe(0)
    // Lacerate Flesh: an empty tank rises to half and falls back at the end of the activation
    const dry = edit(withGore(s0, a, 0), (st) => void (st.players.A.cp = 2))
    let l = take(activateStop(dry, a), 'gm.p.lacerate-flesh').state
    expect(goreLevel(l, a)).toBe(1)
    expect(l.players.A.cp).toBe(1)
    expect(ids(l)).not.toContain('gm.p.lacerate-flesh')
    const calm = take(toAction(l), 'end').state
    expect(goreLevel(calm, a)).toBe(0)
    expect(calm.operatives[a]!.wounds).toBe(10)
    // ... or, if a Sanguavitae use emptied it meanwhile, the operative takes D3 instead
    l = take(l, 'gm.x.mania').state
    expect(goreLevel(l, a)).toBe(0)
    const hurt = take(toAction(l), 'end', dice(4)).state
    expect(hurt.operatives[a]!.wounds).toBe(8)
    // not with a tank above empty
    expect(ids(activateStop(edit(s0, (st) => void (st.players.A.cp = 2)), a))).not.toContain('gm.p.lacerate-flesh')
  })

  it('TEAM-GM-034 TEAM-GM-035 TEAM-GM-036 TEAM-GM-037 TEAM-GM-038 Gory Totem (no attack re-rolls within 3 inches), Bloody Cadaver (Goremongers only pick it up; a level in the Ready step), Chaos Sigil (Piercing one lower) and Wrist Chains (thrown melee weapons once per turning point)', () => {
    const picks = ['gm.e.bloody-cadaver', 'gm.e.gory-totem']
    // set-up: both markers are placed in the territory more than 2 inches from every other marker; the Cadaver is a Goremonger-only pick-up
    let g = drive(newRealGame({ ...MATCH, equipmentA: picks }, 'gm-cadaver').state, (x) => x.pending?.kind === 'strategy.initiative', 900, new ScriptedRng([6, 1, 6, 1]))
    const cad = g.markers.find((m) => m.equipmentId === 'gm.e.bloody-cadaver')!
    const tot = g.markers.find((m) => m.equipmentId === 'gm.e.gory-totem')!
    expect([cad.owner, tot.owner]).toEqual(['A', 'A'])
    // (the pair may stand within 2 inches of each other: each ignores the other, TEAM-GM-034 set-up below)
    expect(Math.hypot(cad.pos.x - tot.pos.x, cad.pos.z - tot.pos.z)).toBeGreaterThan(0)
    // set-up spacing: the Totem ignores the Cadaver (and the Cadaver the Totem), never another marker
    {
      const spot = { x: tot.pos.x, z: tot.pos.z }
      const near = (equipmentId: string, kind = 'equipment') =>
        edit(g, (x) => {
          x.markers = x.markers.filter((m) => m.id !== tot.id && m.id !== cad.id)
          x.markers.push({ id: 'pair', kind, pos: { x: spot.x + 1, z: spot.z }, owner: 'A', carriedBy: null, controller: null, equipmentId } as never)
        })
      const totemAt = (st: GameState) => placementIssue(st, 'A', { key: 'k', equipmentId: 'gm.e.gory-totem', kind: 'marker' }, spot, 0)?.reason ?? null
      const cadaverAt = (st: GameState) => placementIssue(st, 'A', { key: 'k', equipmentId: 'gm.e.bloody-cadaver', kind: 'marker' }, spot, 0)?.reason ?? null
      expect(totemAt(near('gm.e.bloody-cadaver'))).toBeNull()
      expect(cadaverAt(near('gm.e.gory-totem'))).toBeNull()
      expect(totemAt(near('gm.e.other'))).toMatch(/more than 2/)
    }
    const asp = A(g, 'aspirant')
    const boy = B(g, 'boy')
    // the Aspirant stands at the Cadaver when the first Ready step comes: it is offered a level, once
    g = edit(g, (x) => void (x.operatives[asp]!.pos = { x: cad.pos.x + 0.9, y: 0, z: cad.pos.z }))
    g = take(g, 'roll', new ScriptedRng([6, 1, 6, 1])).state
    while (g.pending && g.pending.kind !== 'ability.choice' && g.pending.kind !== 'strategy.gambit') g = expectOk(step(g, answerStop(g), new ScriptedRng([6, 1, 6, 1]))).state
    expect(g.pending).toMatchObject({ kind: 'ability.choice', seat: 'A' })
    expect(g.pending!.context.readyStep).toBe(true)
    expect(g.markers.find((m) => m.id === cad.id)).toMatchObject({ pickable: true, pickableBy: 'A' })
    g = take(g, 'ready:0').state
    expect(goreLevel(g, asp)).toBe(2)
    expect(g.pending?.kind).not.toBe('ability.choice')
    // an enemy cannot pick it up, a Goremonger can
    const field = open({ equipmentA: picks })
    const withCad = (st: GameState): GameState =>
      edit(st, (x) => {
        x.markers.push({ id: 'cad', kind: 'equipment', pos: { x: 0.5, z: 0 }, owner: 'A', carriedBy: null, controller: null, pickable: true, pickableBy: 'A', equipmentId: 'gm.e.bloody-cadaver' })
      })
    const aspirant = A(field, 'aspirant')
    const enemyThere = withCad(place(place(field, aspirant, 0, 8), boy, 0.9, 0))
    const friendThere = withCad(place(place(field, aspirant, 0, 0), boy, 0, 8))
    expect(markerOffers(enemyThere, enemyThere.operatives[boy]!, null).map((o) => o.markerId)).not.toContain('cad')
    expect(markerOffers(friendThere, friendThere.operatives[aspirant]!, null).map((o) => o.markerId)).toContain('cad')
    // Gory Totem: an enemy within 3 inches cannot re-roll its attack dice (fighting, retaliating or shooting); at 4 inches it can
    const totem = edit(field, (x) => {
      x.markers.push({ id: 'tot', kind: 'equipment', pos: { x: 0, z: 0 }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'gm.e.gory-totem' })
    })
    const ban = (state: GameState, kind: 'fight' | 'shoot', attacker: string, roller: string): boolean => providerRerollsBanned(state, { operativeId: roller } as never, { kind, operativeId: attacker } as never)
    const near = place(totem, boy, 2.5, 0)
    expect(ban(near, 'fight', boy, boy)).toBe(true)
    expect(ban(near, 'shoot', boy, boy)).toBe(true)
    expect(ban(near, 'fight', A(field, 'aspirant'), boy)).toBe(true)
    expect(ban(near, 'shoot', A(field, 'aspirant'), boy)).toBe(false)
    expect(ban(place(totem, boy, 4.5, 0), 'fight', boy, boy)).toBe(false)
    expect(ban(place(near, A(field, 'aspirant'), 2, 0), 'fight', boy, A(field, 'aspirant'))).toBe(false)
    // Chaos Sigil: against Piercing 2 the Aspirant rolls 2 defence dice instead of 1, once per turning point
    const pierce = withWeapons(field, ranged('test.w.pierce', { atk: 4, hit: 3, dmg: { normal: 2, crit: 3 } }, [{ rule: 'piercing', x: 2 }]))
    const armed = place(place(arm(pierce, boy, ['test.w.pierce']), A(field, 'aspirant'), 6, 0), boy, 0, 0)
    const sigil = edit(armed, (x) => void (x.players.A.equipment = ['gm.e.chaos-sigil']))
    const shot = (st: GameState, answers: Parameters<typeof play>[2] = {}) => shootAt(bTurn(st, A(field, 'bloodtaker')), boy, 'test.w.pierce', A(field, 'aspirant'), dice(4, 4, 4, 4), answers)
    expect(evs(shot(sigil, takePloy('gm.x.sigil')).events, 'DefenceDiceRolled')[0]!.collected).toBe(2)
    expect(evs(shot(sigil).events, 'DefenceDiceRolled')[0]!.collected).toBe(1)
    expect(evs(shot(armed).events, 'DefenceDiceRolled')[0]!.collected).toBe(1)
    // Wrist Chains: thrown twins of the melee weapons on the datacard, Range 2", once per turning point, great chainaxe without Brutal
    const wrist = open({ equipmentA: ['gm.e.wrist-chains'] })
    const own = (card: string) => wrist.operatives[A(wrist, card)]!.weapons
    expect(own('aspirant')).toContain('gm.w.chainglaive-thrown')
    expect(own('skullclaimer')).toContain('gm.w.great-chainaxe-thrown')
    expect(own('stalker')).toContain('gm.w.pickrippers-thrown')
    expect(own('blood-herald')).toContain('gm.w.chainblade-thrown')
    expect(own('inciter').some((w) => w.endsWith('-thrown'))).toBe(false)
    expect(wrist.data.weapons['gm.w.great-chainaxe-thrown']!.rules.map((r) => r.rule)).toEqual(['range'])
    expect(open().operatives[A(open(), 'aspirant')]!.weapons).not.toContain('gm.w.chainglaive-thrown')
    // a thrown Shoot from 1.8 inches; the second thrown Shoot of the turning point is refused
    const a2 = Object.values(wrist.operatives).filter((o) => o.datacardId === 'gm.aspirant' && o.seat === 'A')
    const cast = edit(place(place(wrist, a2[0]!.id, 0, 0), boy, 1.26 + 1.8, 0), (x) => void (x.operatives[boy]!.wounds = x.operatives[boy]!.maxWounds = 40))
    const thrown = shootAt(cast, a2[0]!.id, 'gm.w.chainglaive-thrown', boy, dice(6, 6, 1, 1))
    expect(thrown.state.operatives[boy]!.wounds).toBeLessThan(40)
    expect(usedThisTp(thrown.state, 'A', 'gm.wristChains')).toBe(true)
    expect(providerWeaponForbidden(thrown.state, thrown.state.operatives[a2[1]!.id]!, 'gm.w.chainglaive-thrown', 'shoot')).not.toBeNull()
    // Enhanced Violence at full: the thrown chainglaive has Relentless
    const full = withPloy(withGore(wrist, a2[0]!.id, 2), 'gm.p.enhanced-violence')
    expect(effectiveRules(full, full.operatives[a2[0]!.id]!, full.data.weapons['gm.w.chainglaive-thrown']!, 'shoot', boy).map((r) => r.rule)).toContain('relentless')
    // the Chaos Sigil and the Cadaver are in the printed data too: ritual blade and fleshskewer carry the team weapon rules
    expect(data.byId['gm.w.ritual-blade']).toMatchObject({ rules: [{ rule: 'gm.a.wr-ritual' }] })
  })

  it('TEAM-GM-032 TEAM-GM-033 Lacerate Flesh settles when a counteraction ends (counteraction.end); Destructive Demise is offered for a removal outside an attack (Lacerate Flesh damage)', () => {
    const s0 = open()
    const a = A(s0, 'aspirant')
    const h = A(s0, 'blood-herald')
    const boy = B(s0, 'boy')
    const counterSetup = edit(withGore(s0, a, 0), (st) => {
      st.players.A.cp = 3
      st.operatives[a]!.order = 'engage'
      for (const o of Object.values(st.operatives)) if (o.seat === 'A' && o.id !== h) o.ready = false
    })
    let t = take(toAction(activateStop(counterSetup, h)), 'end').state
    t = take(toAction(activateStop(t, boy)), 'end').state
    t = take(t, `counteract:${a}`).state
    t = take(t, 'gm.p.lacerate-flesh').state
    expect(goreLevel(t, a)).toBe(1)
    // the counteraction ends with no action: the level goes back at its end
    const calm = take(toAction(t), 'end').state
    expect(goreLevel(calm, a)).toBe(0)
    expect(calm.operatives[a]!.wounds).toBe(s0.operatives[a]!.wounds)
    expect(calm.effects.some((e) => e.kind === 'gm.lacerate')).toBe(false)
    // emptied meanwhile: D3 damage at the counteraction's end (a 4 is a 2)
    const drained = take(withGore(toAction(t), a, 0), 'end', dice(4)).state
    expect(drained.operatives[a]!.wounds).toBe(s0.operatives[a]!.wounds - 2)
    // the D3 takes it down with an enemy in its control range: the removal waits and Destructive Demise is offered
    const brink = edit(withGore(place(place(toAction(t), a, 0, 0), boy, 1.4, 0), a, 0), (st) => {
      st.operatives[a]!.wounds = 1
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 20
    })
    const asked = take(brink, 'end', dice(4)).state
    expect(asked.operatives[a]!.status).toBe('active')
    expect(asked.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'operative.incapacitated' })
    expect(ids(asked)).toContain(`gm.p.destructive-demise:${boy}`)
    const paid = take(asked, `gm.p.destructive-demise:${boy}`, dice(6)).state
    expect(paid.operatives[boy]!.wounds).toBe(20 - 3)
    const after = paid.pending?.kind === 'ploy.firefight' && paid.pending.window === 'operative.incapacitated' ? passIt(paid).state : paid
    expect(after.operatives[a]!.status).toBe('removed')
  })
})
