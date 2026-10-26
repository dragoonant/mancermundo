// imperial-navy-breachers engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-NB-nnn).
// The Breachers are seat A against the default Kommandos; the map is open ground unless a test says otherwise. Operatives
// block visibility in this ruleset, so the line tests keep the blocker off the line to the target.
import { describe, expect, it } from 'vitest'
import { step } from '@/engine'
import { abilityOffers, actionForbidden } from '@/engine/abilities'
import { actionAvailability, actionCost, activatableOps } from '@/engine/firefight'
import { attackStats, inflict, ruleSetFor, validTargets, weaponDamage, weaponUnusable } from '@/engine/attack-common'
import { inEnemyCr, killOpIgnored } from '@/engine/conditions'
import { usedThisTp } from '@/engine/effects'
import { runHook } from '@/engine/hooks'
import { moveLimit, planMove } from '@/engine/movement'
import { gambitOffers, offersFor } from '@/engine/ploys'
import { shootableWeapons } from '@/engine/shoot'
import { effectiveApl, effectiveMove } from '@/engine/state'
import { providerActivationBarred, providerBlockCapacity, providerControlApl, providerMoveRestrictions, providerMoveSurcharge } from '@/engine/team-rules'
import { TEAM_ID, spotted } from '@/engine/teams/imperial-navy-breachers'
import { tokenCount, tokensOnTurningPointEnd } from '@/engine/tokens'
import type { GameState } from '@/engine/types'
import { enumerateLoadouts, loadBundle, validateRoster, type DatacardData } from '../../../src/data'
import { play, ranged, withWeapons } from '../../fixtures/attack'
import { place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { bodyOf, visible } from '@/engine/los'
import { activateOp, edit, optionIds, pick, realBundle, take, withCtx } from '../../fixtures/real'
import { A, B, ACCESSIBLE_WALL, FULL, WALL, activating, behindWall, dice, endActivation, nbRoster, open, orderMarker, passPloys, takeGambit, toGambit, useOffer } from './imperial-navy-breachers.hooks'

const data = loadBundle()
const cards = realBundle.datacards
const slot = (main: string[], leader = 'nb.sergeant-at-arms') => ({ leader: [leader], main })
const NINE = ['nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.axejack', 'nb.endurant', 'nb.grenadier', 'nb.hatchcutter', 'nb.surveyor', 'nb.void-jammer']

describe('TEAM-NB Imperial Navy Breachers', () => {
  it('TEAM-NB-000 TEAM-NB-001 TEAM-NB-002 TEAM-NB-003 TEAM-NB-004 playable team, roster rules (Armsman repeats, Gunner cap and errata, half selections, requires) and printed loadouts', () => {
    expect(TEAM_ID).toBe('imperial-navy-breachers')
    const team = data.teams['imperial-navy-breachers']!
    expect(team.playable).toBe(true)
    expect(Object.values(data.byId).filter((r) => (r as DatacardData).team === TEAM_ID && 'figure' in r)).toHaveLength(13)
    // Sergeant plus 10 selections; Armsman repeats, a second Axejack does not
    expect(validateRoster(team, slot([...NINE, 'nb.gunner-meltagun']), cards as never).ok).toBe(true)
    expect(validateRoster(team, slot([...NINE, 'nb.axejack']), cards as never).ok).toBe(false)
    expect(validateRoster(team, slot(NINE), cards as never).ok).toBe(false)
    // errata: two Gunners with the same weapon are fine, a third is not
    const eight = ['nb.armsman', 'nb.armsman', 'nb.axejack', 'nb.endurant', 'nb.grenadier', 'nb.hatchcutter', 'nb.surveyor', 'nb.void-jammer']
    expect(validateRoster(team, slot([...eight, 'nb.gunner-plasma-gun', 'nb.gunner-plasma-gun']), cards as never).ok).toBe(true)
    expect(validateRoster(team, slot([...eight.slice(0, 7), 'nb.gunner-plasma-gun', 'nb.gunner-plasma-gun', 'nb.gunner-las-volley']), cards as never).ok).toBe(false)
    // the C.A.T. Unit and the Gheistskull share one selection, one alone takes a whole one; both need their controller
    const base = ['nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.axejack', 'nb.endurant', 'nb.grenadier', 'nb.hatchcutter', 'nb.surveyor', 'nb.void-jammer']
    expect(validateRoster(team, slot([...base, 'nb.cat-unit', 'nb.gheistskull']), cards as never).ok).toBe(true)
    expect(validateRoster(team, slot([...base, 'nb.cat-unit']), cards as never).ok).toBe(true)
    expect(validateRoster(team, slot([...base, 'nb.gheistskull']), cards as never).ok).toBe(true)
    expect(validateRoster(team, slot([...base, 'nb.cat-unit', 'nb.gheistskull', 'nb.gunner-meltagun']), cards as never).ok).toBe(false)
    // a C.A.T. Unit without a Surveyor, a Gheistskull without a Void-Jammer
    const noSurveyor = ['nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.axejack', 'nb.endurant', 'nb.grenadier', 'nb.hatchcutter', 'nb.void-jammer', 'nb.gunner-meltagun', 'nb.cat-unit']
    expect(validateRoster(team, slot(noSurveyor), cards as never).ok).toBe(false)
    const noJammer = ['nb.armsman', 'nb.armsman', 'nb.armsman', 'nb.axejack', 'nb.endurant', 'nb.grenadier', 'nb.hatchcutter', 'nb.surveyor', 'nb.gunner-meltagun', 'nb.gheistskull']
    expect(validateRoster(team, slot(noSurveyor.slice(0, 9)), cards as never).ok).toBe(false)
    expect(validateRoster(team, slot(noJammer), cards as never).ok).toBe(false)
    // the printed loadouts: the Sergeant has five, each Gunner card brings its whole profile group plus the gun butt
    const count = (id: string) => enumerateLoadouts(data.byId[id] as DatacardData).length
    expect(count('nb.sergeant-at-arms')).toBe(5)
    const s = open({ rosterA: FULL })
    expect(s.operatives[A(s, 'sergeant-at-arms')]!.weapons).toEqual(['nb.w.navis-shotgun-close', 'nb.w.navis-shotgun-long', 'nb.w.navis-hatchet'])
    expect(open({ rosterA: nbRoster('gunner-las-volley') }).operatives['A2']!.weapons).toEqual(['nb.w.las-volley-focused', 'nb.w.las-volley-sweeping', 'nb.w.gun-butt'])
    expect(open({ rosterA: nbRoster('gunner-plasma-gun') }).operatives['A2']!.weapons).toEqual(['nb.w.plasma-gun-standard', 'nb.w.plasma-gun-supercharge', 'nb.w.gun-butt'])
  })

  it('TEAM-NB-005 TEAM-NB-006 Void Armour: a re-roll against Blast or Torrent (two for a Grenadier, none for a sweeping profile or a plain gun), and x" Devastating shrapnel cannot hurt a friendly Breacher', () => {
    const s = open({ rosterA: FULL })
    const g = A(s, 'armsman')
    const gr = A(s, 'grenadier')
    const rk = B(s, 'rokkit-boy')
    const grants = (target: string, weapon: string) => {
      const d = { kind: 'shoot' as const, attackerId: rk, weaponId: weapon, dice: 3, saveDelta: 0, rerolls: [] as unknown[] }
      runHook('modifyDefenceDice', { seat: 'A', state: s, operativeId: target, targetId: rk, weaponId: weapon, data: d as never })
      return d.rerolls.length
    }
    expect(grants(g, 'kom.w.rokkit-launcha-mobile')).toBe(1)
    expect(grants(gr, 'kom.w.rokkit-launcha-mobile')).toBe(2)
    expect(grants(g, 'kom.w.burna-standard')).toBe(1)
    expect(grants(g, 'kom.w.scoped-big-shoota-sweeping')).toBe(0)
    expect(grants(g, 'kom.w.slugga')).toBe(0)
    // shrapnel: the splash does nothing to a friendly Breacher, the target takes the damage
    const hurt = (splash: boolean) => withCtx(s, (ctx) => void inflict(ctx, { targetId: g, attackerId: rk, weaponId: 'kom.w.slugga', amount: 4, source: 'devastating', splash } as never)).state.operatives[g]!.wounds
    expect(hurt(true)).toBe(8)
    expect(hurt(false)).toBe(4)
  })

  it('TEAM-NB-007 TEAM-NB-008 Breach and Clear pairs a ready Breacher within 3" once per turning point; Group Activation owes another Armsman and is switched off for the pair', () => {
    const s = open({ rosterA: FULL })
    const [a1, a2] = Object.values(s.operatives).filter((o) => o.seat === 'A' && o.datacardId === 'nb.armsman').map((o) => o.id) as [string, string]
    const sgt = A(s, 'sergeant-at-arms')
    // Group Activation: the next activation is one of the other Armsmen, then the opponent activates
    const owed = endActivation(s, a1)
    expect(owed.pending!.seat).toBe('A')
    expect(optionIds(owed)).toEqual([a2])
    const after = endActivation(owed, a2)
    expect(after.pending!.seat).toBe('B')
    // Breach and Clear: pick the Sergeant (visible, within 3"); an Armsman partner is also paired, so neither chains
    const t = place(place(s, a1, 0, 0), sgt, 1.6, 0)
    const picked = passPloys(take(take(take(t, a1).state, 'engage').state, `nb.bc:${sgt}`).state)
    expect(usedThisTp(picked, 'A', 'nb.breachAndClear')).toBe(true)
    const paired = take(picked, 'end').state
    expect(paired.pending!.seat).toBe('A')
    expect(optionIds(paired)).toEqual([sgt])
    const done = endActivation(paired, sgt)
    expect(done.pending!.seat).toBe('B')
    // a partner out of reach is not offered
    const far = place(place(s, a1, 0, 0), sgt, 5, 0)
    const win = take(take(far, a1).state, 'engage').state
    expect(win.pending?.kind === 'ploy.firefight' ? optionIds(win).filter((o) => o.startsWith('nb.bc:')) : []).toEqual([])
    // a pair among two Armsmen: the first expended hands over to its partner only, and Group Activation stays off
    const pair = place(place(s, a1, 0, 0), a2, 1.6, 0)
    const p2 = passPloys(take(take(take(pair, a1).state, 'engage').state, `nb.bc:${a2}`).state)
    const p3 = take(p2, 'end').state
    expect(optionIds(p3)).toEqual([a2])
    expect(endActivation(p3, a2).pending!.seat).toBe('B')
  })

  it('TEAM-NB-009 TEAM-NB-010 Command Breach (free orders, redirect once per activation) and the Attack and Defence Orders (Ceaseless, one result re-rolled, markers gone in the Ready step, mutually exclusive)', () => {
    {
      const g = toGambit()
      const free = gambitOffers(g, 'A').filter((o) => o.ployId === 'nb.p.attack-order' || o.ployId === 'nb.p.defence-order')
      expect(free.length).toBeGreaterThan(0)
      expect(free.every((o) => o.cost === 0)).toBe(true)
      const paid = refreshOffers(edit(g, (st) => void (st.operatives['A1']!.status = 'removed')))
      expect(paid.length).toBeGreaterThan(0)
      expect(paid.every((o) => o.cost === 1)).toBe(true)
      // the redirect, in the Sergeant's own activation
      const s = open({ rosterA: FULL })
      const sgt = A(s, 'sergeant-at-arms')
      const t = activating(orderMarker(edit(s, (st) => void (st.players.A.cp = 2)), 'nb.p.attack-order', -5, 0), sgt)
      const info = { subjectId: sgt }
      const swapped = useOffer(t, 'firefight.actionEnded', info, (o) => o.ployId === 'nb.redirect' && o.param === 'swap')
      expect(swapped.markers.find((m) => m.id === 'ord1')!.equipmentId).toBe('nb.p.defence-order')
      expect(swapped.players.A.cp).toBe(2)
      // not both, and not in another operative's activation
      expect(() => useOffer(swapped, 'firefight.actionEnded', info, (o) => o.ployId === 'nb.redirect')).toThrow(/no matching offer/)
      const moved = useOffer(t, 'firefight.actionEnded', info, (o) => o.ployId === 'nb.redirect' && !!o.param?.startsWith('move:'))
      const m = moved.markers.find((k) => k.id === 'ord1')!
      expect(m.equipmentId).toBe('nb.p.attack-order')
      expect(m.pos).not.toEqual({ x: -5, z: 0 })
      expect(() => useOffer(activating(orderMarker(s, 'nb.p.attack-order', -5, 0), A(s, 'armsman')), 'firefight.actionEnded', { subjectId: A(s, 'armsman') }, (o) => o.ployId === 'nb.redirect')).toThrow()
    }
    {
      const g = toGambit()
      const t = takeGambit(g, 'nb.p.attack-order')
      expect(t.markers.some((m) => m.equipmentId === 'nb.p.attack-order' && m.owner === 'A')).toBe(true)
      expect(gambitOffers(t, 'A').some((o) => o.ployId === 'nb.p.defence-order')).toBe(false)
      const d = takeGambit(g, 'nb.p.defence-order')
      expect(gambitOffers(d, 'A').some((o) => o.ployId === 'nb.p.attack-order')).toBe(false)
      const s = open({ rosterA: FULL })
      const gm = A(s, 'armsman')
      const boy = B(s, 'boy')
      const near = orderMarker(place(place(s, gm, 0, 0), boy, 6, 0), 'nb.p.attack-order', 1, 0)
      expect(ruleSetFor(near, near.operatives[gm]!, 'nb.w.navis-shotgun-close', 'shoot', boy).ceaseless).toBe(true)
      expect(ruleSetFor(place(near, gm, 5, 0), near.operatives[gm]!, 'nb.w.navis-shotgun-close', 'shoot', boy).ceaseless).toBe(false)
      const def = orderMarker(place(place(s, gm, 0, 0), boy, 6, 0), 'nb.p.defence-order', 1, 0)
      const dd = { kind: 'shoot' as const, attackerId: boy, weaponId: 'kom.w.slugga', dice: 3, saveDelta: 0, rerolls: [] as { id: string; mode: string }[] }
      runHook('modifyDefenceDice', { seat: 'A', state: def, operativeId: gm, targetId: boy, weaponId: 'kom.w.slugga', data: dd as never })
      expect(dd.rerolls).toMatchObject([{ id: 'nb-defence-order', mode: 'result' }])
      const none = { ...dd, rerolls: [] as unknown[] }
      runHook('modifyDefenceDice', { seat: 'A', state: place(def, gm, 6, 5), operativeId: gm, targetId: boy, weaponId: 'kom.w.slugga', data: none as never })
      expect(none.rerolls).toHaveLength(0)
      // the Ready step clears both markers
      const cleared = withCtx(def, (ctx) => void runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx })).state
      expect(cleared.markers.filter((m) => m.equipmentId?.startsWith('nb.p.'))).toHaveLength(0)
    }
  })

  it('TEAM-NB-011 TEAM-NB-028 Emboldened rolls a D6 only after a Charge, Brace for Counterattack takes 1 off dice of Dmg 3+ against an unmoved or in-territory Breacher, never off Devastating, and Emboldened reads the reduced value', () => {
    const s = open({ rosterA: FULL })
    const ax = A(s, 'axejack')
    const boy = B(s, 'boy')
    const hit = (state: GameState, amount: number, source = 'normal', rng = dice(5)) =>
      state.operatives[ax]!.maxWounds - withCtx(state, (ctx) => void inflict(ctx, { targetId: ax, attackerId: boy, weaponId: 'kom.w.slugga', amount, source } as never), rng).state.operatives[ax]!.wounds
    const charged = edit(s, (st) => void (st.operatives[ax]!.actionsThisTp = ['charge']))
    expect(hit(charged, 3)).toBe(2)
    expect(hit(charged, 3, 'normal', dice(4))).toBe(3)
    expect(hit(charged, 2)).toBe(2)
    expect(hit(s, 3)).toBe(3)
    // Brace: in the territory, or not having moved; Dmg 3+ dice only; Devastating untouched
    const braced = edit(s, (st) => void st.effects.push({ id: 'b1', source: 'nb.p.brace-for-counterattack', seat: 'A', kind: 'ployFlag', expires: 'turningPoint' }))
    expect(hit(braced, 3)).toBe(2)
    expect(hit(braced, 2)).toBe(2)
    expect(hit(braced, 4, 'devastating')).toBe(4)
    // moved out of the territory: no reduction
    const moved = edit(place(braced, ax, 10, 0), (st) => void (st.operatives[ax]!.actionsThisTp = ['reposition']))
    expect(hit(moved, 3)).toBe(3)
    expect(hit(edit(moved, (st) => void (st.operatives[ax]!.actionsThisTp = ['dash'])), 3)).toBe(2)
    // Brace first (4 -> 3), then Emboldened rolls on the reduced die (3 is still 3+): 5 takes it to 2
    const both = edit(braced, (st) => void (st.operatives[ax]!.actionsThisTp = ['charge']))
    expect(hit(both, 4)).toBe(2)
    expect(hit(both, 3)).toBe(2)
  })

  it('TEAM-NB-012 TEAM-NB-013 TEAM-NB-014 TEAM-NB-015 TEAM-NB-016 Machine rules: the C.A.T. Unit is barred in an enemy control range and once its Surveyor falls, offers only move actions and SPOT, cannot climb, jump or assist, counts 1 APL lower for control; a Conceal Machine in cover cannot be picked beyond 2 inches even with Seek; Machines never count for the kill op', () => {
    {
      const s = open({ rosterA: FULL })
      const cat = A(s, 'cat-unit')
      const sk = A(s, 'gheistskull')
      const boy = B(s, 'boy')
      const c = s.operatives[cat]!
      expect(providerActivationBarred(s, c)).toBe(false)
      const engaged = place(place(s, cat, 0, 0), boy, 1.2, 0)
      expect(providerActivationBarred(engaged, engaged.operatives[cat]!)).toBe(true)
      expect(activatableOps(engaged, 'A').map((o) => o.id)).not.toContain(cat)
      expect(pick(engaged, cat).rejection?.code).toBe('E_ACTION_RESTRICTED')
      // no action at all while barred, even a free one
      expect(actionForbidden(engaged, engaged.operatives[cat]!, 'dash')).not.toBeNull()
      // the Surveyor's fall is permanent
      const sv = A(s, 'surveyor')
      const dead = edit(s, (st) => {
        st.operatives[sv]!.wounds = 0
        st.operatives[sv]!.status = 'removed'
      })
      expect(providerActivationBarred(dead, dead.operatives[cat]!)).toBe(true)
      expect(providerActivationBarred(dead, dead.operatives[sk]!)).toBe(false)
      // the whitelists
      const allowed = (id: string, op: string) => actionForbidden(s, s.operatives[op]!, id) === null
      for (const a of ['reposition', 'dash', 'fallBack', 'charge', 'ability:nb.a.spot']) expect(allowed(a, cat), a).toBe(true)
      for (const a of ['shoot', 'fight', 'guard', 'marker:pickUp', 'marker:place', 'ability:nb.a.boost']) expect(allowed(a, cat), a).toBe(false)
      for (const a of ['reposition', 'dash', 'fallBack', 'charge', 'ability:nb.a.boost']) expect(allowed(a, sk), a).toBe(true)
      for (const a of ['shoot', 'fight', 'guard', 'ability:nb.a.spot']) expect(allowed(a, sk), a).toBe(false)
      // Fall Back needs an enemy control range, where the bar forbids everything: it is never available
      expect(actionAvailability(engaged, engaged.operatives[cat]!, 'fallBack', activating(engaged, cat).firefight.activation)).not.toBeNull()
      // no climbing or jumping, no assisting
      expect(providerMoveRestrictions(s, c)).toEqual({ noClimb: true, noJump: true })
      expect(providerMoveRestrictions(s, s.operatives[sk]!)).toEqual({ noClimb: false, noJump: false })
      const g = A(s, 'armsman')
      const assists = ['x']
      const d = { kind: 'fight' as const, atk: 4, hitDelta: 0, accurate: [], lethal: null, rerolls: [], assists: [cat, sk, g, ...assists] }
      runHook('modifyAttackDice', { seat: 'A', state: s, operativeId: g, targetId: boy, weaponId: 'nb.w.navis-hatchet', data: d as never })
      expect(d.assists).toEqual([g, 'x'])
      // marker control counts a Machine 1 APL lower, stacking with Lock it Down
      const m = s.markers.find((k) => k.kind === 'objective')!
      expect(providerControlApl(s, c, m, 2)).toBe(1)
      expect(providerControlApl(s, s.operatives[g]!, m, 2)).toBe(2)
      const locked = edit(s, (st) => void st.effects.push({ id: 'lk', source: 'nb.p.lock-it-down', seat: 'A', kind: 'nb.lock', operativeId: cat, expires: 'battle', data: { markerId: m.id } }))
      expect(providerControlApl(locked, locked.operatives[cat]!, m, 2)).toBe(2)
    }
    {
      for (const card of ['cat-unit', 'gheistskull'] as const) {
        const { s, m, boy } = behindWall(card)
        expect(validTargets(s, s.operatives[boy]!, 'test.seek').some((t) => t.id === m)).toBe(false)
        // out of Conceal, or within 2", it is a target again
        expect(validTargets(edit(s, (st) => void (st.operatives[m]!.order = 'engage')), s.operatives[boy]!, 'test.seek').some((t) => t.id === m)).toBe(true)
        expect(validTargets(place(s, boy, -2.6, 0), s.operatives[boy]!, 'test.seek').some((t) => t.id === m)).toBe(true)
      }
      const s = open({ rosterA: FULL })
      expect(killOpIgnored(s, s.operatives[A(s, 'cat-unit')]!)).toBe(true)
      expect(killOpIgnored(s, s.operatives[A(s, 'gheistskull')]!)).toBe(true)
      expect(killOpIgnored(s, s.operatives[A(s, 'armsman')]!)).toBe(false)
      expect(WALL.id).toBe('rubble')
    }
  })

  it('TEAM-NB-017 SPOT: friendly Breachers shoot the spotted enemy with Seek Light and it cannot be obscured, until the turning point ends, sight is lost or the C.A.T. Unit spots again', () => {
    const s = open({ rosterA: FULL })
    const cat = A(s, 'cat-unit')
    const g = A(s, 'armsman')
    const boy = B(s, 'boy')
    const t = place(place(place(s, cat, 0, 0), g, -2, 0), boy, 6, 0)
    const spot = take(activateOp(t, cat), `ability:nb.a.spot:${boy}`).state
    expect(tokenCount(spot, boy, 'nb.spotted', 'A')).toBe(1)
    expect(spotted(spot, spot.operatives[g]!, boy)).toBe(true)
    expect(spotted(spot, spot.operatives[B(s, 'grot')]!, boy)).toBe(false)
    expect(ruleSetFor(spot, spot.operatives[g]!, 'nb.w.navis-shotgun-long', 'shoot', boy).seekLight).toBe(true)
    expect(ruleSetFor(spot, spot.operatives[g]!, 'nb.w.navis-shotgun-long', 'shoot', B(s, 'grot')).seekLight).toBe(false)
    const status = { obscured: true, inCover: false }
    runHook('target.status', { seat: 'A', state: spot, operativeId: g, targetId: boy, data: status as never })
    expect(status.obscured).toBe(false)
    // a Conceal enemy in Light cover becomes a valid target for the Breacher (Seek Light)
    const hide = edit(spot, (st) => {
      st.map = { ...st.map, features: [WALL] }
      st.operatives[boy]!.order = 'conceal'
      st.operatives[boy]!.pos = { x: -9, y: 0, z: 0 }
      st.operatives[g]!.pos = { x: -1, y: 0, z: 0 }
      st.operatives[cat]!.pos = { x: -1, y: 0, z: 2 }
    })
    // (the wall stands at x -0.8..-0.6, the enemy 8" west of it: still visible to the C.A.T. Unit, so the token stays)
    const ended = (st: GameState) => withCtx(st, (ctx) => void runHook('action.ended', { seat: 'A', state: ctx.state, engine: ctx, operativeId: g, data: { action: 'dash', counteract: false, free: false, activeSeat: 'A' } as never })).state
    expect(tokenCount(ended(spot), boy, 'nb.spotted', 'A')).toBe(1)
    // sight lost: the token goes with the next action
    const blocked = edit(spot, (st) => {
      st.map = { ...st.map, features: [{ id: 'blk', parts: [{ id: 'blk.a', footprint: [{ x: 2, z: -3 }, { x: 3, z: -3 }, { x: 3, z: 3 }, { x: 2, z: 3 }], height: 4, traits: ['blocking' as const] }] }] }
    })
    expect(tokenCount(ended(blocked), boy, 'nb.spotted', 'A')).toBe(0)
    // the turning point's end takes it too
    const tpEnd = withCtx(spot, (ctx) => void tokensOnTurningPointEnd(ctx)).state
    expect(tokenCount(tpEnd, boy, 'nb.spotted', 'A')).toBe(0)
    void hide
  })

  it('TEAM-NB-018 Breachwall: an Engage Endurant shelters the one friendly Breacher touching it when it stands in the line of fire; two touching, Conceal or a clear line leave the target legal', () => {
    const base = open({ rosterA: FULL })
    const e = A(base, 'endurant')
    const g = A(base, 'armsman')
    const g2 = A(base, 'axejack')
    const boy = B(base, 'boy')
    const set = withWeapons(base, ranged('test.gun', { hit: 3 }))
    const stage = (shooter: [number, number], f: (st: GameState) => void = () => undefined) => {
      const t = place(place(place(place(set, e, -1, 0), g, -0.475, 0.909), g2, -13, 9), boy, shooter[0], shooter[1])
      return edit(t, (st) => {
        st.operatives[e]!.order = 'engage'
        st.operatives[boy]!.weapons = ['test.gun']
        f(st)
      })
    }
    const targets = (s: GameState) => validTargets(s, s.operatives[boy]!, 'test.gun').map((t) => t.id)
    expect(targets(stage([-1, -9]))).not.toContain(g)
    expect(targets(stage([-1, -9]))).toContain(e)
    // a shooter whose line to the Armsman does not cross the Endurant
    expect(targets(stage([8, 4]))).toContain(g)
    // Conceal Endurant: no shelter
    expect(targets(stage([-1, -9], (st) => void (st.operatives[e]!.order = 'conceal')))).toContain(g)
    // a second friendly operative touching the Endurant switches the rule off
    expect(targets(stage([-1, -9], (st) => void (st.operatives[g2]!.pos = { x: -2.05, y: 0, z: 0 })))).toContain(g)
  })

  it('TEAM-NB-019 TEAM-NB-020 Shield blocks two successes, Disengage makes the Endurant\'s Fall Back 1 AP (also as a counteraction), BOOST adds 4" to the next Charge once per battle and never in the first turning point', () => {
    const s = open({ rosterA: FULL })
    const e = A(s, 'endurant')
    const boy = B(s, 'boy')
    const attack = (def: string) => ({ kind: 'fight', operativeId: boy, seat: 'B', weaponId: 'kom.w.choppa', seq: { atk: { seat: 'B', operativeId: boy, weaponId: 'kom.w.choppa', dice: [], grants: [] }, def: { seat: 'A', operativeId: e, weaponId: def, dice: [], grants: [] } } }) as never
    expect(providerBlockCapacity(s, attack('nb.w.shield-bash'), 'A', 0)).toBe(2)
    expect(providerBlockCapacity(s, attack('nb.w.navis-heavy-shotgun-close'), 'A', 0)).toBe(1)
    expect(providerBlockCapacity(s, attack('nb.w.shield-bash'), 'B', 0)).toBe(1)
    const engaged = place(place(s, e, 0, 0), boy, 1.3, 0)
    expect(actionCost(engaged, engaged.operatives[e]!, 'fallBack')).toBe(1)
    expect(actionCost(engaged, engaged.operatives[A(s, 'armsman')]!, 'fallBack')).toBe(2)
    const counter = { operativeId: e, seat: 'A' as const, counteract: true, stage: 'action' as const, apSpent: 0, performed: [], declared: null }
    expect(actionAvailability(engaged, engaged.operatives[e]!, 'fallBack', counter)).toBeNull()
    // BOOST
    const sk = A(s, 'gheistskull')
    const tp1 = abilityOffers(s, s.operatives[sk]!, null).some((o) => o.abilityId === 'nb.a.boost')
    expect(tp1).toBe(false)
    const tp2 = edit(s, (st) => void (st.turningPoint = 2))
    expect(abilityOffers(tp2, tp2.operatives[sk]!, null).some((o) => o.abilityId === 'nb.a.boost')).toBe(true)
    const boosted = take(activateOp(tp2, sk), 'ability:nb.a.boost').state
    expect(moveLimit(boosted.operatives[sk]!, 'charge', false, boosted)).toBe(12)
    expect(moveLimit(tp2.operatives[sk]!, 'charge', false, tp2)).toBe(10)
    const used = edit(tp2, (st) => st.operatives[sk]!.oncePerBattleUsed.push('nb.boost.used'))
    expect(abilityOffers(used, used.operatives[sk]!, null).some((o) => o.abilityId === 'nb.a.boost')).toBe(false)
  })

  it('TEAM-NB-021 TEAM-NB-022 Grenadier: its own frag, krak and stun (no smoke), frag and krak hit on 3+; BREACH POINT places a Breach marker, WELD SHUT is never available in the open killzone', () => {
    const s = open({ rosterA: FULL })
    const gr = A(s, 'grenadier')
    const boy = B(s, 'boy')
    const op = s.operatives[gr]!
    expect(op.weapons).toEqual(expect.arrayContaining(['core.w.frag-grenade', 'core.w.krak-grenade']))
    expect(abilityOffers(s, op, null).map((o) => o.abilityId)).not.toContain('core.a.smoke-grenade')
    const near = place(place(s, gr, 0, 0), boy, 4, 0)
    expect(abilityOffers(near, near.operatives[gr]!, null).map((o) => o.abilityId)).toContain('core.a.stun-grenade')
    const need = (w: string) => require_need(near, gr, w, boy)
    expect(need('core.w.frag-grenade')).toBe(3)
    expect(need('core.w.krak-grenade')).toBe(3)
    expect(need('nb.w.navis-shotgun-close')).toBe(3)
    // BREACH POINT beside a wall, and no WELD SHUT
    const h = A(s, 'hatchcutter')
    const wall = { id: 'wall2', parts: [{ id: 'wall2.a', footprint: [{ x: -3.5, z: -3 }, { x: -3, z: -3 }, { x: -3, z: 3 }, { x: -3.5, z: 3 }], height: 3, traits: ['heavy' as const] }] }
    const t = edit(place(s, h, -4.2, 0), (st) => void (st.map = { ...st.map, features: [wall] }))
    const ids = abilityOffers(t, t.operatives[h]!, null).map((o) => o.abilityId)
    expect(ids).toContain('nb.a.breach-point')
    expect(ids).not.toContain('nb.a.weld-shut')
    const placed = take(activateOp(t, h), 'ability:nb.a.breach-point:wall2').state
    const marker = placed.markers.find((m) => m.equipmentId === 'breach')!
    expect(marker.featureId).toBe('wall2')
    expect(marker.owner).toBe('A')
  })

  it('TEAM-NB-023 TEAM-NB-024 TEAM-NB-026 WAYFIND gives +1 APL to a Breacher near the Surveyor or the C.A.T. Unit (never a Machine), REMOTE CONTROL lends the C.A.T. Unit one 3 inch free action, INTERFERENCE PULSE needs a 3+ (+1 on a valid target)', () => {
    const s = open({ rosterA: FULL })
    const sv = A(s, 'surveyor')
    const cat = A(s, 'cat-unit')
    const sk = A(s, 'gheistskull')
    const vj = A(s, 'void-jammer')
    const g = A(s, 'armsman')
    const boy = B(s, 'boy')
    const wayfind = (st: GameState, who: string) => abilityOffers(st, st.operatives[who]!, null).filter((o) => o.abilityId === 'nb.a.wayfind').map((o) => o.params.targetId)
    const near = place(place(place(place(s, sv, 0, 0), g, 3, 0), sk, 2, 3), cat, 10, 9)
    expect(wayfind(near, sv)).toEqual([g])
    expect(wayfind(place(near, g, 7, 0), sv)).toEqual([])
    // within 6" of the C.A.T. Unit counts too
    const viaCat = place(place(place(s, sv, -5, 0), cat, 1, 0), g, 6.5, 0)
    expect(wayfind(viaCat, sv)).toEqual([g])
    // the Comms Device lengthens the reach only from the operative that controls it
    const comms = (nearWho: string, where: [number, number]) =>
      edit(place(place(s, sv, 0, 0), g, 8, 0), (st) => {
        st.operatives[A(s, 'void-jammer')]!.pos = { x: 14, y: 0, z: -9 }
        st.operatives[cat]!.pos = { x: 14, y: 0, z: 9 }
        const o = st.operatives[nearWho]!
        o.pos = { x: where[0], y: 0, z: where[1] }
        st.markers.push({ id: 'cd', kind: 'equipment', pos: { x: o.pos.x + 1.4, z: o.pos.z }, owner: 'A', carriedBy: null, controller: 'A', equipmentId: 'core.e.comms-device' })
      })
    expect(wayfind(comms(sv, [0, 0]), sv)).toEqual([g])
    expect(wayfind(comms(cat, [14, 9]), sv)).toEqual([])
    const done = take(activateOp(near, sv), `ability:nb.a.wayfind:${g}`).state
    expect(done.operatives[g]!.aplMods).toBe(1)
    expect(effectiveApl(done.operatives[g]!)).toBe(3)
    // not while an enemy is in the Surveyor's control range
    expect(wayfind(place(near, boy, 0, 1.5), sv)).toEqual([])
    // REMOTE CONTROL
    const rc = place(place(s, sv, 0, 0), cat, 5, 0)
    const frame = take(activateOp(rc, sv), `ability:nb.a.remote-control:${cat}`).state
    expect(frame.pending!.kind).toBe('firefight.action')
    expect(frame.firefight.activation!.operativeId).toBe(cat)
    expect(optionIds(frame)).toContain('reposition')
    expect(optionIds(frame)).not.toContain('shoot')
    const mv = take(frame, 'reposition').state
    const q = mv.pending!
    expect(step(mv, { type: 'move.path', seat: q.seat, decisionId: q.id, payload: { waypoints: [{ x: 9.5, z: 0 }] } }).rejection).toBeDefined()
    const ok = step(mv, { type: 'move.path', seat: q.seat, decisionId: q.id, payload: { waypoints: [{ x: 7.9, z: 0 }] } })
    expect(ok.rejection).toBeUndefined()
    expect(ok.state.operatives[cat]!.pos.x).toBeCloseTo(7.9, 2)
    // refused while the C.A.T. Unit is barred
    const barred = place(rc, boy, 6.3, 0)
    expect(abilityOffers(barred, barred.operatives[sv]!, null).some((o) => o.abilityId === 'nb.a.remote-control')).toBe(false)
    // INTERFERENCE PULSE
    const pulse = place(place(place(s, vj, 0, 0), sk, 4, 0), boy, 8, 0)
    const apl = (rng: ReturnType<typeof dice>) => take(activateOp(pulse, vj), `ability:nb.a.interference-pulse:${boy}`, rng).state.operatives[boy]!.aplMods
    expect(apl(dice(1))).toBe(0)
    expect(apl(dice(2))).toBe(-1)
    expect(apl(dice(5))).toBe(-1)
    // out of the Gheistskull's reach: not offered
    expect(abilityOffers(place(pulse, boy, 14.5, 0), pulse.operatives[vj]!, null).some((o) => o.abilityId === 'nb.a.interference-pulse')).toBe(false)
  })

  it('TEAM-NB-025 Detonate: the Void-Jammer always shoots its friendly Gheistskull (no target pick), Blast 1 inch adds neighbours of either side, it works on Conceal, once, and needs the Gheistskull', () => {
    const s = open({ rosterA: FULL })
    const vj = A(s, 'void-jammer')
    const sk = A(s, 'gheistskull')
    const boy = B(s, 'boy')
    const t = place(place(place(s, vj, 0, 0), sk, 6, 3), boy, 7.1, 3)
    const weapons = shootableWeapons(t, t.operatives[vj]!, [])
    const det = weapons.find((w) => w.weaponId === 'nb.w.gheistskull-detonator')!
    expect(det.targets.map((x) => x.id)).toEqual([sk])
    const u = take(take(activateOp(t, vj), 'shoot').state, 'nb.w.gheistskull-detonator', dice(6, 6, 6, 6)).state
    expect(u.pending!.kind).not.toBe('shoot.target')
    const r = play(u, dice(...Array<number>(12).fill(6)))
    expect(r.state.operatives[sk]!.wounds).toBeLessThan(5)
    expect(r.state.operatives[boy]!.wounds).toBeLessThan(10)
    // Limited 1
    expect(weaponUnusable(r.state, r.state.operatives[vj]!, 'nb.w.gheistskull-detonator', [], 'shoot')).not.toBeNull()
    // from a Conceal order (Silent), and not without the Gheistskull
    const conceal = activateOp(t, vj, 'conceal')
    expect(pick(conceal, 'shoot').rejection).toBeUndefined()
    const gone = edit(t, (st) => void (st.operatives[sk]!.status = 'removed'))
    expect(shootableWeapons(gone, gone.operatives[vj]!, []).some((w) => w.weaponId === 'nb.w.gheistskull-detonator')).toBe(false)
  })

  it('TEAM-NB-027 TEAM-NB-029 TEAM-NB-030 Close Assault (+1/+1 on shotguns within 3 inches, a fail turns into a normal success, not retaliating), Overwhelm Target (only for a Breach and Clear pair), Blitz (first Shoot or Fight of the turning point against an enemy within 6 inches)', () => {
    const s = open({ rosterA: FULL })
    const g = A(s, 'armsman')
    const sgt = A(s, 'sergeant-at-arms')
    const boy = B(s, 'boy')
    const flag = (st: GameState, ploy: string) => edit(st, (x) => void x.effects.push({ id: `f-${ploy}`, source: ploy, seat: 'A', kind: 'ployFlag', expires: 'turningPoint' }))
    const ca = flag(place(place(s, g, 0, 0), boy, 2.5, 0), 'nb.p.close-assault')
    expect(weaponDamage(ca, g, 'nb.w.navis-shotgun-close', boy, 'shoot')).toEqual({ normal: 4, crit: 4 })
    expect(weaponDamage(ca, g, 'nb.w.navis-shotgun-long', boy, 'shoot')).toEqual({ normal: 2, crit: 3 })
    expect(weaponDamage(ca, g, 'nb.w.navis-hatchet', boy, 'fight')).toEqual({ normal: 3, crit: 4 })
    expect(weaponDamage(place(ca, boy, 5, 0), g, 'nb.w.navis-shotgun-close', boy, 'shoot')).toEqual({ normal: 3, crit: 3 })
    const e = A(s, 'endurant')
    expect(weaponDamage(flag(place(place(s, e, 0, 0), boy, 2, 0), 'nb.p.close-assault'), e, 'nb.w.navis-heavy-shotgun-close', boy, 'shoot')).toEqual({ normal: 4, crit: 4 })
    const rolled = (state: GameState, who: string, fails: number, kind: 'shoot' | 'fight' = 'shoot') => {
      const dice0 = Array.from({ length: fails }, (_, i) => ({ kind: 'fail', value: 2 + i })).concat([{ kind: 'normal', value: 5 }])
      const d = { kind, side: 'attack' as const, targetId: boy, dice: dice0 as never, requests: [], choices: {} }
      runHook('afterAttackRoll', { seat: 'A', state, operativeId: who, targetId: boy, data: d as never })
      return (d.dice as { kind: string; used?: boolean }[]).map((x) => (x.used ? 'used' : x.kind)).join(',')
    }
    expect(rolled(ca, g, 2)).toBe('normal,used,normal')
    expect(rolled(ca, g, 1)).toBe('fail,normal')
    expect(rolled(place(ca, boy, 5, 0), g, 3)).toBe('fail,fail,fail,normal')
    const retal = edit(ca, (st) => void (st.attack = { kind: 'fight', operativeId: boy, seat: 'B' } as never))
    expect(rolled(retal, g, 3, 'fight')).toBe('fail,fail,fail,normal')
    // OVERWHELM TARGET
    const pair = edit(place(place(s, g, 0, 0), sgt, 1.5, 0), (st) => {
      st.players.A.cp = 3
      st.effects.push({ id: 'pr', source: 'nb.a.breach-and-clear', seat: 'A', kind: 'nb.pair', operativeId: g, expires: 'turningPoint', data: { partnerId: sgt } })
    })
    const info = { subjectId: g }
    const early = useOffer(activating(pair, g), 'firefight.activationStart', info, (o) => o.ployId === 'nb.p.overwhelm-target' && o.param === sgt)
    expect(early.operatives[sgt]!.aplMods).toBe(1)
    const self = useOffer(activating(pair, g), 'firefight.activationStart', info, (o) => o.ployId === 'nb.p.overwhelm-target' && o.param === g)
    expect(effectiveApl(self.operatives[g]!)).toBe(3)
    expect(() => useOffer(activating(edit(pair, (st) => void (st.effects = [])), g), 'firefight.activationStart', info, (o) => o.ployId === 'nb.p.overwhelm-target')).toThrow()
    // BLITZ
    const stage = (first: boolean, firstAct: boolean, seq = 7) =>
      edit(place(place(s, g, 0, 0), boy, 4, 0), (st) => {
        st.players.A.cp = 3
        st.firefight.activation = { operativeId: g, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: { action: 'shoot', cost: 1 }, declaredSeq: seq }
        if (first) st.effects.push({ id: 'ef1', source: 'nb.firstShootFight', seat: 'A', kind: 'nb.firstShootFight', operativeId: g, expires: 'turningPoint', data: { seq: 7 } })
        if (firstAct) st.effects.push({ id: 'ef2', source: 'nb.firstActivated', seat: 'A', kind: 'nb.firstActivated', operativeId: g, expires: 'turningPoint' })
      })
    const blitzInfo = { subjectId: g, attackerId: g, targetId: boy, kind: 'shoot' }
    const used = useOffer(stage(true, true), 'shoot.targetSelected', blitzInfo, (o) => o.ployId === 'nb.p.blitz')
    const rs = ruleSetFor(used, used.operatives[g]!, 'nb.w.navis-shotgun-close', 'shoot', boy)
    expect(rs.accurate).toEqual([1])
    expect(rs.severe).toBe(true)
    const second = useOffer(stage(true, false), 'shoot.targetSelected', blitzInfo, (o) => o.ployId === 'nb.p.blitz')
    expect(ruleSetFor(second, second.operatives[g]!, 'nb.w.navis-shotgun-close', 'shoot', boy).severe).toBe(false)
    expect(() => useOffer(stage(false, true), 'shoot.targetSelected', blitzInfo, (o) => o.ployId === 'nb.p.blitz')).toThrow()
    expect(() => useOffer(stage(true, true, 9), 'shoot.targetSelected', blitzInfo, (o) => o.ployId === 'nb.p.blitz')).toThrow()
    expect(() => useOffer(place(stage(true, true), boy, 9, 0), 'shoot.targetSelected', blitzInfo, (o) => o.ployId === 'nb.p.blitz')).toThrow()
  })

  it('TEAM-NB-031 TEAM-NB-032 Lock it Down adds 1 to one operative control APL on the chosen objective until used again; Deck Hand needs APL 1 or 2 and makes one Accessible crossing free', () => {
    const s = open({ rosterA: FULL })
    const g = A(s, 'armsman')
    const g2 = A(s, 'axejack')
    const objs = s.markers.filter((m) => m.kind === 'objective')
    const rich = edit(s, (st) => void (st.players.A.cp = 4))
    const first = useOffer(rich, 'firefight.activationStart', { subjectId: g }, (o) => o.ployId === 'nb.p.lock-it-down' && o.param === objs[0]!.id)
    expect(providerControlApl(first, first.operatives[g]!, objs[0]!, 2)).toBe(3)
    expect(providerControlApl(first, first.operatives[g]!, objs[1]!, 2)).toBe(2)
    expect(providerControlApl(first, first.operatives[g2]!, objs[0]!, 2)).toBe(2)
    // using it again (here on another operative and marker) ends the old bonus
    const again = edit(first, (st) => {
      st.players.A.cp = 4
      st.ledger.A.tp = []
    })
    const second = useOffer(again, 'firefight.activationStart', { subjectId: g2 }, (o) => o.ployId === 'nb.p.lock-it-down' && o.param === objs[1]!.id)
    expect(providerControlApl(second, second.operatives[g]!, objs[0]!, 2)).toBe(2)
    expect(providerControlApl(second, second.operatives[g2]!, objs[1]!, 2)).toBe(3)
    // Deck Hand: Accessible terrain near, APL stat 1 or 2
    const door = edit(place(rich, g, -6, 0), (st) => void (st.map = { ...st.map, features: [ACCESSIBLE_WALL] }))
    const deck = (st: GameState) => offersFor(activating(st, g), 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: g }).some((o) => o.ployId === 'nb.p.deck-hand')
    expect(deck(door)).toBe(true)
    expect(deck(edit(door, (st) => void (st.operatives[g]!.aplMods = 1)))).toBe(false)
    expect(deck(edit(door, (st) => void (st.operatives[g]!.aplMods = -1)))).toBe(true)
    expect(deck(rich)).toBe(false)
    const used = useOffer(activating(door, g), 'firefight.activationStart', { subjectId: g }, (o) => o.ployId === 'nb.p.deck-hand')
    const crossing = { horizontal: 4, accessible: 2, climb: 0, drop: 0 }
    const through = [{ x: -2, y: 0, z: 0 }]
    expect(providerMoveSurcharge(used, used.operatives[g]!, 'reposition', through, crossing)).toBe(-1)
    expect(providerMoveSurcharge(used, used.operatives[g]!, 'reposition', through, { ...crossing, accessible: 0 })).toBe(0)
    expect(providerMoveSurcharge(door, door.operatives[g]!, 'reposition', through, crossing)).toBe(0)
    // spent by the first move that crossed Accessible terrain
    const moved = (toX: number, st: GameState = used) =>
      withCtx(st, (ctx) => {
        const len = toX + 6
        ctx.events.push({ type: 'OperativeMoved', operativeId: g, action: 'reposition', from: { x: -6, y: 0, z: 0 }, to: { x: toX, y: 0, z: 0 }, cost: len, maxInches: 6, segments: [{ from: { x: -6, y: 0, z: 0 }, to: { x: toX, y: 0, z: 0 }, length: len, cost: len, kind: 'walk' }] } as never)
        runHook('action.ended', { seat: 'A', state: ctx.state, engine: ctx, operativeId: g, data: { action: 'reposition', counteract: false, free: false, activeSeat: 'A' } as never })
      }).state
    // a move that stops short of the wall keeps it; the move through the wall spends it
    expect(moved(-5).effects.some((e) => e.kind === 'nb.deckHand')).toBe(true)
    expect(moved(-2).effects.some((e) => e.kind === 'nb.deckHand')).toBe(false)
    // an Obstructing crossing (Razor Wire) is not Accessible terrain: no refund, and the ploy is not spent
    const wire = edit(used, (st) => void (st.map = { ...st.map, features: [feature('wire', part('wire.a', rect(-4.5, -4.0, -3, 3), 1, [], { tags: ['obstructing'] }))] }))
    const path = [{ x: -2, y: 0, z: 0 }]
    expect(providerMoveSurcharge(wire, wire.operatives[g]!, 'reposition', path, { ...crossing, accessible: 1 })).toBe(0)
    expect(providerMoveSurcharge(used, used.operatives[g]!, 'reposition', path, { ...crossing, accessible: 1 })).toBe(-1)
    expect(moved(-2, wire).effects.some((e) => e.kind === 'nb.deckHand')).toBe(true)
  })

  it('TEAM-NB-033 TEAM-NB-034 TEAM-NB-035 Rebreathers (no Shock, APL decreases ignored, increases kept), Slugs (4+ 2/3 Accurate 1, long-range shotgun only, three a turning point), Combat Stimms and the inert System Override Device', () => {
    const s = open({ rosterA: FULL, equipmentA: ['nb.e.rebreathers', 'nb.e.slugs', 'nb.e.combat-stimms'] })
    const g = A(s, 'armsman')
    const e = A(s, 'endurant')
    const boy = B(s, 'boy')
    const shock = (st: GameState, target: string) => {
      const d = { kind: 'fight' as const, targetId: target, rules: [{ rule: 'core.wr.shock' }, { rule: 'core.wr.brutal' }] }
      runHook('modifyWeaponRules', { seat: 'B', state: st, operativeId: boy, targetId: target, weaponId: 'kom.w.power-klaw', data: d as never })
      return d.rules.map((r) => r.rule)
    }
    expect(shock(s, g)).toEqual(['core.wr.brutal'])
    expect(shock(s, B(s, 'grot'))).toEqual(['core.wr.shock', 'core.wr.brutal'])
    const hurt = edit(s, (st) => {
      st.operatives[g]!.aplMods = 0
      st.operatives[g]!.aplFx = [{ delta: -1, source: 'stun-grenade' }, { delta: 1, source: 'nb.a.wayfind' }]
    })
    const scrubbed = withCtx(hurt, (ctx) => void runHook('action.ended', { seat: 'B', state: ctx.state, engine: ctx, operativeId: boy, data: { action: 'dash', counteract: false, free: false, activeSeat: 'B' } as never })).state
    expect(scrubbed.operatives[g]!.aplFx).toEqual([{ delta: 1, source: 'nb.a.wayfind' }])
    expect(scrubbed.operatives[g]!.aplMods).toBe(1)
    // Slugs
    const stage = (who: string, weapon: string, uses = 0) =>
      edit(place(place(s, who, 0, 0), boy, 8, 0), (st) => {
        st.attack = { kind: 'shoot', operativeId: who, seat: 'A', weaponId: weapon } as never
        st.ledger.A.tpUses['nb.slugs'] = uses
      })
    const slugInfo = (who: string, weapon: string) => ({ subjectId: who, weaponId: weapon })
    const slugged = useOffer(stage(g, 'nb.w.navis-shotgun-long'), 'shoot.targetSelected', slugInfo(g, 'nb.w.navis-shotgun-long'), (o) => o.ployId === 'nb.e.slugs')
    expect(attackStats(slugged, g, 'nb.w.navis-shotgun-long', boy, { kind: 'shoot' }).need).toBe(4)
    expect(weaponDamage(slugged, g, 'nb.w.navis-shotgun-long', boy, 'shoot')).toEqual({ normal: 2, crit: 3 })
    expect(ruleSetFor(slugged, slugged.operatives[g]!, 'nb.w.navis-shotgun-long', 'shoot', boy).accurate).toEqual([1])
    expect(ruleSetFor(slugged, slugged.operatives[g]!, 'nb.w.navis-shotgun-close', 'shoot', boy).accurate).toEqual([])
    expect(slugged.ledger.A.tpUses['nb.slugs']).toBe(1)
    expect(() => useOffer(stage(e, 'nb.w.navis-heavy-shotgun-long'), 'shoot.targetSelected', slugInfo(e, 'nb.w.navis-heavy-shotgun-long'), (o) => o.ployId === 'nb.e.slugs')).toThrow()
    expect(() => useOffer(stage(g, 'nb.w.navis-shotgun-long', 3), 'shoot.targetSelected', slugInfo(g, 'nb.w.navis-shotgun-long'), (o) => o.ployId === 'nb.e.slugs')).toThrow()
    // Combat Stimms keep the Move of an injured Breacher; the Hit penalty stays
    const injured = edit(s, (st) => void (st.operatives[g]!.wounds = 2))
    expect(effectiveMove(injured.operatives[g]!, injured)).toBe(6)
    expect(attackStats(place(place(injured, g, 0, 0), boy, 4, 0), g, 'nb.w.navis-shotgun-close', boy, { kind: 'shoot' }).need).toBe(4)
    const bare = open({ rosterA: FULL })
    const bareHurt = edit(bare, (st) => void (st.operatives[g]!.wounds = 2))
    expect(effectiveMove(bareHurt.operatives[g]!, bareHurt)).toBe(4)
    // System Override Device: selectable, does nothing
    expect(data.teams['imperial-navy-breachers']!.equipment).toContain('nb.e.system-override-device')
    expect(() => open({ rosterA: FULL, equipmentA: ['nb.e.system-override-device'] })).not.toThrow()
  })
})

// Rules verification (August '26 cards): defects found against the sources, one test each.
describe('TEAM-NB rules verification fixes', () => {
  it('TEAM-NB-017 wide view: the C.A.T. Unit spots an enemy that its head point cannot see but another part of its body can', () => {
    const s = open({ rosterA: FULL })
    const cat = A(s, 'cat-unit')
    const boy = B(s, 'boy')
    const g = A(s, 'armsman')
    // a tall wall ends at z 0.3: every line from the centre of the C.A.T. Unit to the enemy crosses it, lines from its flank do not
    const t = edit(place(place(place(s, cat, 0, 0), boy, 6, 0), g, -6, 6), (st) => {
      st.map = { ...st.map, features: [feature('blk', part('blk.a', rect(2, 3, -3, 0.3), 4, ['blocking']))] }
    })
    // the head point alone (an Armsman standing where the C.A.T. Unit is) does not see the enemy
    expect(visible(t, { ...bodyOf(t.operatives[g]!), pos: t.operatives[cat]!.pos }, bodyOf(t.operatives[boy]!))).toBe(false)
    expect(abilityOffers(t, t.operatives[cat]!, null).filter((o) => o.abilityId === 'nb.a.spot').map((o) => o.params.targetId)).toContain(boy)
    // a wall that hides the enemy from every part of the C.A.T. Unit still stops it
    const hidden = edit(t, (st) => {
      st.map = { ...st.map, features: [feature('blk', part('blk.a', rect(2, 3, -3, 3), 4, ['blocking']))] }
    })
    expect(abilityOffers(hidden, hidden.operatives[cat]!, null).some((o) => o.abilityId === 'nb.a.spot' && o.params.targetId === boy)).toBe(false)
  })

  it('TEAM-NB-017 TEAM-NB-012 wide view through the shared viewpoints provider: core visibility (so control range and every target test) draws lines from any part of the C.A.T. Unit, also from a ghost on a planned path', () => {
    const s = open({ rosterA: FULL })
    const cat = A(s, 'cat-unit')
    const boy = B(s, 'boy')
    const t = edit(place(place(s, cat, 0, 0), boy, 6, 0), (st) => {
      st.map = { ...st.map, features: [feature('blk', part('blk.a', rect(2, 3, -3, 0.3), 4, ['blocking']))] }
    })
    const catBody = bodyOf(t.operatives[cat]!)
    const boyBody = bodyOf(t.operatives[boy]!)
    // core visible: the head point is blocked, a flank eye is not
    expect(visible(t, catBody, boyBody)).toBe(true)
    // the eyes are built around the body asked about: a ghost of the C.A.T. Unit moved behind the full wall sees nothing
    const wide = edit(t, (st) => {
      st.map = { ...st.map, features: [feature('blk', part('blk.a', rect(2, 3, -3, 3), 4, ['blocking']))] }
    })
    expect(visible(wide, { ...catBody, pos: { x: 0, y: 0, z: 0 } }, boyBody)).toBe(false)
    // and a ghost stepped to the open side sees the enemy from its flank
    expect(visible(t, { ...catBody, pos: { x: 0, y: 0, z: 0.1 } }, boyBody)).toBe(true)
    // only the C.A.T. Unit has it: the enemy's own view of the C.A.T. Unit is the plain head-point test
    expect(visible(t, boyBody, catBody)).toBe(visible(edit(t, (st) => void (st.operatives[cat]!.datacardId = st.operatives[A(s, 'armsman')]!.datacardId)), boyBody, catBody))
  })

  it('TEAM-NB-032 Deck Hand reads the move breakdown: one Accessible crossing is free, an Obstructing one (Razor Wire) never is, in a real planned move', () => {
    const s = edit(open({ rosterA: FULL }), (st) => void (st.players.A.cp = 4))
    const g = A(s, 'armsman')
    // a wire the base can cross (insignificant, so it blocks nothing) that is Obstructing
    const wire = feature('wire', part('wire.a', rect(-3, -2.5, -3, 3), 1, ['insignificant'], { tags: ['obstructing'] }))
    const both = edit(place(s, g, -6, 0), (st) => void (st.map = { ...st.map, features: [ACCESSIBLE_WALL, wire] }))
    const deck = (st: GameState) => useOffer(activating(st, g), 'firefight.activationStart', { subjectId: g }, (o) => o.ployId === 'nb.p.deck-hand')
    const cost = (st: GameState) => {
      const plan = planMove(st, st.operatives[g]!, 'reposition', [{ x: -2, z: 0 }])
      return plan.ok ? { cost: plan.cost, acc: plan.breakdown.accessible, obs: plan.breakdown.obstructing } : plan.rejection.reason
    }
    // without the ploy: 4" + 1" (Accessible) + 1" (Obstructing)
    expect(cost(activating(both, g))).toMatchObject({ cost: 6, acc: 2, obs: 1 })
    // with it the Accessible inch is free, the Razor Wire inch is not
    expect(cost(deck(both))).toMatchObject({ cost: 5 })
    expect(providerMoveSurcharge(deck(both), deck(both).operatives[g]!, 'reposition', [{ x: -2, y: 0, z: 0 }], { horizontal: 4, accessible: 2, climb: 0, drop: 0, obstructing: 1 })).toBe(-1)
    // Razor Wire alone (the ploy in force): nothing to refund
    const onlyWire = edit(deck(both), (st) => void (st.map = { ...st.map, features: [wire] }))
    expect(cost(onlyWire)).toMatchObject({ cost: 5, acc: 1, obs: 1 })
    expect(providerMoveSurcharge(onlyWire, onlyWire.operatives[g]!, 'reposition', [{ x: -2, y: 0, z: 0 }], { horizontal: 4, accessible: 1, climb: 0, drop: 0, obstructing: 1 })).toBe(0)
  })

  it('TEAM-NB-026 INTERFERENCE PULSE: an enemy with a friendly operative in its control range is still a valid target for the +1', () => {
    const s = open({ rosterA: FULL })
    const vj = A(s, 'void-jammer')
    const sk = A(s, 'gheistskull')
    const g = A(s, 'armsman')
    const boy = B(s, 'boy')
    const t = place(place(place(place(s, vj, 0, 0), sk, 4, 0), boy, 8, 0), g, 8, 1.5)
    expect(inEnemyCr(t, t.operatives[boy]!)).toBe(true)
    const apl = take(activateOp(t, vj), `ability:nb.a.interference-pulse:${boy}`, dice(2)).state.operatives[boy]!.aplMods
    expect(apl).toBe(-1)
  })

  it('TEAM-NB-010 TEAM-NB-027 Defence Order and Close Assault name "an operative": a friendly shot (the Detonate) counts too', () => {
    const s = open({ rosterA: FULL })
    const vj = A(s, 'void-jammer')
    const sk = A(s, 'gheistskull')
    const g = A(s, 'armsman')
    // Defence Order: a friendly Breacher near the marker caught by the Void-Jammer's detonator
    const t = orderMarker(place(place(place(s, vj, 0, 0), sk, 6, 3), g, 7.2, 3), 'nb.p.defence-order', 7, 4)
    const d = { kind: 'shoot' as const, attackerId: vj, weaponId: 'nb.w.gheistskull-detonator', dice: 3, saveDelta: 0, rerolls: [] as { source: string }[] }
    runHook('modifyDefenceDice', { seat: 'A', state: t, operativeId: g, targetId: vj, weaponId: 'nb.w.gheistskull-detonator', data: d as never })
    expect(d.rerolls.map((r) => r.source)).toContain('nb.p.defence-order')
    // Close Assault: the Void-Jammer shooting its own Gheistskull within 3" turns a fail into a normal success
    const ca = edit(place(place(s, vj, 0, 0), sk, 2.5, 0), (x) => void x.effects.push({ id: 'f-ca', source: 'nb.p.close-assault', seat: 'A', kind: 'ployFlag', expires: 'turningPoint' }))
    const roll = { kind: 'shoot' as const, side: 'attack' as const, targetId: sk, dice: [{ kind: 'fail', value: 2 }, { kind: 'fail', value: 3 }, { kind: 'normal', value: 5 }] as { kind: string; value: number; used?: boolean }[], requests: [], choices: {} }
    runHook('afterAttackRoll', { seat: 'A', state: ca, operativeId: vj, targetId: sk, data: roll as never })
    expect(roll.dice.map((x) => (x.used ? 'used' : x.kind)).join(',')).toBe('normal,used,normal')
  })

  it('TEAM-NB-032 Deck Hand is offered whenever Accessible terrain or a Breach marker is within a Dash plus a Charge (and Boost) of the operative', () => {
    const s = edit(open({ rosterA: FULL }), (st) => void (st.players.A.cp = 4))
    const g = A(s, 'armsman')
    const deck = (st: GameState) => offersFor(activating(st, g), 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: g }).some((o) => o.ployId === 'nb.p.deck-hand')
    const far = feature('far-hatch', part('far-hatch.a', rect(11, 11.5, -3, 3), 3, ['accessible']))
    const withFar = edit(s, (st) => void (st.map = { ...st.map, features: [far] }))
    // 10.5" away: a Dash then a Charge reaches it
    expect(deck(place(withFar, g, 0, 0))).toBe(true)
    expect(deck(place(withFar, g, -3, 0))).toBe(false)
    // a Breach marker counts for an operative within 1" of it
    const breach = edit(place(s, g, 0, 0), (st) => {
      st.map = { ...st.map, features: [] }
      st.markers.push({ id: 'br', kind: 'equipment', pos: { x: 13.9, z: 0 }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'breach', featureId: 'x' })
    })
    expect(deck(breach)).toBe(true)
  })
})

function refreshOffers(st: GameState) {
  return gambitOffers(st, 'A').filter((o) => o.ployId === 'nb.p.attack-order' || o.ployId === 'nb.p.defence-order')
}

function require_need(s: GameState, shooter: string, weapon: string, target: string): number {
  return attackStats(s, shooter, weapon, target, { kind: 'shoot' }).need
}

