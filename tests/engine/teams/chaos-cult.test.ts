// chaos-cult engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-CC-nnn).
// The cult are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { createGame, step } from '@/engine'
import { actionForbidden } from '@/engine/abilities'
import { act } from '@/engine/actions'
import { accurateTotal, applyAplEffect, attackStats, defenceStats, effectiveRules, parseRules, validTargets, weaponDamage } from '@/engine/attack-common'
import { hasKeyword } from '@/engine/conditions'
import { runHook } from '@/engine/hooks'
import { offersFor } from '@/engine/ploys'
import { isPsychicWeapon } from '@/engine/psychic'
import { markerControl } from '@/engine/query'
import type { Rng } from '@/engine/rng'
import { planMove } from '@/engine/movement'
import { effectiveApl, effectiveMove } from '@/engine/state'
import { providerChain, providerCostDelta, providerWeaponForbidden, registerTeamRules, unregisterTeamRules } from '@/engine/team-rules'
import { enemiesInControlRange } from '@/engine/measure'
import { placementProblem } from '@/engine/terrain'
import { TEAM_ID, availableGifts, gambitAllowance, giftsOf, mutationOptionId, mutationOptions, performMutation, primaryGift, secondaryGift } from '@/engine/teams/chaos-cult'
import { tokenCount, tokensOnActivationStart } from '@/engine/tokens'
import type { GameState } from '@/engine/types'
import { loadBundle, validateRoster } from '../../../src/data'
import { melee, play, withWeapons } from '../../fixtures/attack'
import { feature, part, rect } from '../../fixtures/maps'
import { activateOp, edit, optionIds, passIt, realBundle, realSetupWith, take, withCtx } from '../../fixtures/real'
import { A, ALL, B, afterKill, becomes, dice, driveQuiet, playTo, fightOnce, hurt, offerIds, opOf, open, place, strikes, toGambit, usePlayed, withGifts, withPloy } from './chaos-cult.hooks'

const data = loadBundle()

/** A Null Rod stand-in: PSYCHIC rules are switched off until the returned function is called. */
function registerRod(): () => void {
  registerTeamRules({ id: 'cc.test.nullRod', psychicBlocked: () => true })
  return () => unregisterTeamRules('cc.test.nullRod')
}

describe('TEAM-CC Chaos Cult', () => {
  it('TEAM-CC-000 TEAM-CC-001 TEAM-CC-002 TEAM-CC-003 TEAM-CC-004 TEAM-CC-005 registered and playable, fixed roster of 14, printed weapons and stats, mutation cards in the snapshot, the PSYCHIC infernal gaze', () => {
    {
      expect(TEAM_ID).toBe('chaos-cult')
      const team = data.teams['chaos-cult']!
      expect(team.playable).toBe(true)
      expect(team.archetypes).toEqual(['infiltration', 'seek-and-destroy'])
      const cards = realBundle.datacards
      const ok = { leader: ['cc.demagogue'], 'blessed-blades': ['cc.blessed-blade', 'cc.blessed-blade'], devotees: Array<string>(9).fill('cc.devotee'), iconarch: ['cc.iconarch'], mindwitch: ['cc.mindwitch'] }
      expect(validateRoster(team, ok, cards as never).ok).toBe(true)
      expect(validateRoster(team, { ...ok, devotees: Array<string>(10).fill('cc.devotee') }, cards as never).ok).toBe(false)
      expect(validateRoster(team, { ...ok, 'blessed-blades': ['cc.blessed-blade'] }, cards as never).ok).toBe(false)
      expect(validateRoster(team, { ...ok, devotees: [...Array<string>(8).fill('cc.devotee'), 'cc.mutant'] }, cards as never).ok).toBe(false)
      expect(validateRoster(team, { ...ok, devotees: [...Array<string>(8).fill('cc.devotee'), 'cc.torment'] }, cards as never).ok).toBe(false)
      // the default roster is the fixed 14 and starts a game
      expect(team.defaults!.roster).toHaveLength(14)
      const s = open()
      expect(Object.values(s.operatives).filter((o) => o.seat === 'A')).toHaveLength(14)
      // Mutant and Torment are in the game's snapshot but never selectable, so the Team Builder cannot offer them
      for (const id of ['cc.mutant', 'cc.torment']) {
        expect(s.data.datacards[id]!.selectable).toBe(false)
        expect(team.selection.slots.flatMap((sl) => sl.from)).not.toContain(id)
      }
      expect(Object.values(s.operatives).some((o) => o.datacardId === 'cc.mutant' || o.datacardId === 'cc.torment')).toBe(false)
      // stats, bases, keywords (20.2)
      const stat = (id: string) => {
        const c = s.data.datacards[id]!
        return [c.apl, c.move, c.save, c.wounds, c.baseMm]
      }
      expect(stat('cc.demagogue')).toEqual([2, 6, 5, 8, 32])
      expect(stat('cc.blessed-blade')).toEqual([2, 6, 5, 8, 28])
      expect(stat('cc.iconarch')).toEqual([2, 6, 5, 8, 32])
      expect(stat('cc.mindwitch')).toEqual([2, 6, 5, 8, 32])
      expect(stat('cc.devotee')).toEqual([2, 6, 5, 7, 25])
      expect(stat('cc.mutant')).toEqual([2, 6, 5, 7, 25])
      expect(stat('cc.torment')).toEqual([2, 6, 5, 13, 40])
      for (const op of Object.values(s.operatives).filter((o) => o.seat === 'A')) {
        expect(hasKeyword(s, op, 'CHAOS CULT') && hasKeyword(s, op, 'CHAOS'), op.name).toBe(true)
        const dark = ['cc.demagogue', 'cc.blessed-blade', 'cc.iconarch', 'cc.mindwitch'].includes(op.datacardId)
        expect(hasKeyword(s, op, 'DARK COMMUNE'), op.name).toBe(dark)
        expect(hasKeyword(s, op, 'PSYKER')).toBe(op.datacardId === 'cc.iconarch' || op.datacardId === 'cc.mindwitch')
        expect(hasKeyword(s, op, 'LEADER')).toBe(op.datacardId === 'cc.demagogue')
      }
      // printed weapons (20.3)
      const w = (id: string) => data.byId[`cc.w.${id}`] as { atk: number; hit: string; dmg: { normal: number; crit: number }; rules: { rule: string; x?: number; inches?: number; target?: string }[] }
      const line = (id: string) => [w(id).atk, w(id).hit, w(id).dmg.normal, w(id).dmg.crit, ...w(id).rules.map((r) => `${r.rule.replace('core.wr.', '')}${r.x ?? r.inches ?? r.target ?? ''}`)]
      expect(line('diabolical-stave-ranged')).toEqual([4, '4+', 3, 6, 'range2', 'stun'])
      expect(line('pistol')).toEqual([4, '4+', 2, 3, 'range8'])
      expect(line('burning-censer')).toEqual([4, '2+', 4, 4, 'range5', 'saturate', 'torrent2'])
      expect(line('infernal-gaze')).toEqual([5, '3+', 0, 0, 'cc.a.wr-psychic', 'range6', 'devastating2', 'lethal3+'])
      expect(line('diabolical-stave-melee')).toEqual([4, '4+', 3, 6, 'shock', 'stun'])
      expect(line('commune-blade')).toEqual([4, '4+', 4, 6, 'lethal5+'])
      expect(line('crude-melee-weapon-iconarch')).toEqual([3, '4+', 2, 3])
      expect(line('crude-melee-weapon')).toEqual([4, '4+', 2, 3])
      expect(line('fists')).toEqual([3, '5+', 1, 2])
      expect(line('blasphemous-appendages')).toEqual([4, '4+', 3, 4, 'ceaseless', 'rending'])
      expect(line('hideous-mutations')).toEqual([5, '4+', 4, 5, 'ceaseless', 'rending'])
      const carried = (id: string) => data.byId[id] && (realBundle.datacards[id]!.fixedWeapons as string[])
      expect(carried('cc.demagogue')).toEqual(['cc.w.diabolical-stave-ranged', 'cc.w.pistol', 'cc.w.diabolical-stave-melee'])
      expect(carried('cc.iconarch')).toEqual(['cc.w.burning-censer', 'cc.w.pistol', 'cc.w.crude-melee-weapon-iconarch'])
      expect(carried('cc.mindwitch')).toEqual(['cc.w.infernal-gaze', 'cc.w.fists'])
    }
    {
      const s = open()
      const mw = A(s, 'mindwitch')
      const boy = B(s, 'boy')
      const rules = parseRules(effectiveRules(s, s.operatives[mw]!, s.data.weapons['cc.w.infernal-gaze']!, 'shoot', boy))
      expect(isPsychicWeapon(s, 'cc.w.infernal-gaze')).toBe(true)
      expect(rules.lethal).toBe(3)
      // 3, 4 and 6 are all crits with Lethal 3+; three crits, 2 Devastating damage each, no other damage (0/0)
      const t = edit(place(place(s, mw, 0, 0), boy, 5, 0), (st) => {
        st.operatives[boy]!.wounds = 20
        st.operatives[boy]!.maxWounds = 20
      })
      const rng = dice(3, 4, 6, 1, 1)
      let u = take(activateOp(t, mw, 'engage', rng), 'shoot', rng).state
      u = take(u, 'cc.w.infernal-gaze', rng).state
      u = take(u, boy, rng).state
      const end = play(u, rng, {}, ['firefight.action', 'firefight.activate', 'ability.choice']).state
      expect(20 - end.operatives[boy]!.wounds).toBe(6)
    }
  })

  it('TEAM-CC-006 TEAM-CC-007 INCITE SLAUGHTER gives a free Fight to a visible friend within 9", INCITE URGENCY a free Dash or a Charge of at most 3"', () => {
    const s = open()
    const dem = A(s, 'demagogue')
    const [near, far, idle] = ALL(s, 'devotee')
    const boy = B(s, 'boy')
    // Devotee 1 fights beside the Demagogue's lane, Devotee 2 is 12" away with an enemy, Devotee 3 has no enemy near
    const t = edit(place(place(place(place(place(s, dem, 0, 0), near!, 5, 0), boy, 6.4, 0), far!, -12, 0), idle!, 0, 5), (st) => {
      st.operatives[boy]!.wounds = 20
      st.operatives[boy]!.maxWounds = 20
      st.operatives[near!]!.order = 'engage'
    })
    const u = activateOp(t, dem)
    const slaughter = offerIds(u, dem).filter((i) => i.startsWith('ability:cc.a.incite-slaughter:'))
    expect(slaughter).toEqual([`ability:cc.a.incite-slaughter:${near}`])
    // the free Fight is the friend's own action: a delegated frame with no AP spent
    const f = take(u, slaughter[0]!).state
    expect(f.firefight.activation!.operativeId).toBe(near)
    expect(optionIds(f)).toContain('fight')
    expect(optionIds(f)).not.toContain('shoot')
    const r = play(take(take(f, 'fight', dice(6, 6, 6, 6, 1, 1, 1, 1)).state, boy, dice(6, 6, 6, 6, 1, 1, 1, 1)).state, dice(), strikes, ['firefight.action', 'ability.choice'])
    expect(r.state.operatives[boy]!.wounds).toBeLessThan(20)
    // a free action outside the friend's own activation does not stop it Fighting in its activation (core free actions)
    const later = take(activateOp(take(r.state, 'end').state, B(s, 'grot')), 'end').state
    expect(optionIds(activateOp(later, near!))).toContain('fight')
    // INCITE URGENCY: all three friends are offered a move (Devotee 3 can Dash), the one beside the foe can Charge
    const urgency = offerIds(u, dem).filter((i) => i.startsWith('ability:cc.a.incite-urgency:'))
    expect(urgency).toContain(`ability:cc.a.incite-urgency:${idle}`)
    expect(urgency).not.toContain(`ability:cc.a.incite-urgency:${far}`)
    // a Charge of 3": a foe that would still be out of reach after 3" refuses it, a nearer one allows it
    const g = edit(t, (st) => {
      st.operatives[boy]!.pos = { x: 10.5, y: 0, z: 0 }
    })
    const go = take(take(activateOp(g, dem), `ability:cc.a.incite-urgency:${near}`).state, 'charge').state
    expect(step(go, act.path(go.pending!, [{ x: 8, z: 0 }])).rejection).toBeDefined()
    const h = edit(t, (st) => {
      st.operatives[boy]!.pos = { x: 8.2, y: 0, z: 0 }
    })
    const go2 = take(take(activateOp(h, dem), `ability:cc.a.incite-urgency:${near}`).state, 'charge').state
    expect(go2.pending!.context.maxInches).toBe(3)
    const moved = step(go2, act.path(go2.pending!, [{ x: 6.8, z: 0 }]))
    expect(moved.rejection).toBeUndefined()
    // not offered while the Demagogue is in an enemy's control range
    const caught = place(t, boy, 1.5, 0)
    expect(offerIds(activateOp(caught, dem), dem).filter((i) => i.includes('incite'))).toEqual([])
  })

  it('TEAM-CC-008 TEAM-CC-009 TEAM-CC-010 the Blessed Blades and the Iconarch: Cut Them Down before a Fall Back, Attuned In Purpose joint activations, Icon Bearer marker control', () => {
    {
      const s = open()
      const [b1, b2] = ALL(s, 'blessed-blade')
      const boy = B(s, 'boy')
      const far = A(s, 'mindwitch')
      const base = (extra: (st: GameState) => void = () => {}): GameState => {
        const t = edit(place(place(place(s, b1!, 0, 0), boy, 1.4, 0), b2!, -20, 0), (st) => {
          st.operatives[boy]!.wounds = 12
          st.operatives[boy]!.maxWounds = 12
          extra(st)
        })
        // A activates a far-away operative first so the Kommandos are on turn
        return take(activateOp(t, far), 'end').state
      }
      const fallBack = (st: GameState, rng: Rng): GameState => take(take(activateOp(st, boy, 'engage', rng), 'fallBack', rng).state, 'fallBack', rng).state
      // one Blade in control range: D3+1 (dice 1 gives D3 1, so 2 damage)
      const one = take(activateOp(base(), boy, 'engage', dice(1)), 'fallBack', dice(1)).state
      expect(one.operatives[boy]!.wounds).toBe(12 - 2)
      expect(one.pending!.kind).toBe('move.path')
      // two Blades: 2D3+2 once (6 and 6 are D3 3 each: 8 damage)
      const two = take(activateOp(base((st) => void (st.operatives[b2!]!.pos = { x: 1.4, y: 0, z: 1.4 })), boy, 'engage', dice(6, 6)), 'fallBack', dice(6, 6)).state
      expect(two.operatives[boy]!.wounds).toBe(12 - 8)
      // a kill: the Fall Back is cancelled, the Kommando never moves and the Blade is the killer
      const dead = take(activateOp(base((st) => void (st.operatives[boy]!.wounds = 1)), boy, 'engage', dice(1)), 'fallBack', dice(1)).state
      expect(dead.operatives[boy]!.status).toBe('removed')
      expect(dead.operatives[boy]!.pos.x).toBeCloseTo(1.4)
      expect(dead.pending!.kind).toBe('firefight.activate')
      expect(dead.kills!.at(-1)).toMatchObject({ removedId: boy, killerId: b1, cause: 'direct' })
      void fallBack
    }
    {
      const s = open()
      const [b1, b2] = ALL(s, 'blessed-blade')
      const joint = (st: GameState): string[] => optionIds(take(take(st, b1!).state, 'engage').state).filter((i) => i.startsWith('cc.a.attuned-in-purpose:'))
      const near = place(place(s, b1!, 0, 0), b2!, 5, 0)
      expect(joint(near)).toEqual([`cc.a.attuned-in-purpose:${b2}:engage`, `cc.a.attuned-in-purpose:${b2}:conceal`])
      // 7" away (more than 6" between the bases), or the other Blade already expended: no joint option
      expect(joint(place(near, b2!, 7.5, 0))).toEqual([])
      expect(joint(edit(near, (st) => void (st.operatives[b2!]!.ready = false)))).toEqual([])
      // both act action by action: the partner is activated and expended on its own, with its own AP
      let u = take(take(near, b1!).state, 'engage').state
      u = take(u, `cc.a.attuned-in-purpose:${b2}:engage`).state
      expect(u.firefight.activation!.partner!.operativeId).toBe(b2)
      expect(u.operatives[b2!]!.ready).toBe(false)
      expect(optionIds(u)).toContain('switch')
      // ICON BEARER: the Iconarch and a Devotee (2 + 1 + 2 = 5) against two APL 2 Kommandos (4) at an objective marker
      const m = s.markers.find((k) => k.kind === 'objective')!
      const ic = A(s, 'iconarch')
      const dev = ALL(s, 'devotee')[0]!
      const [boy1, boy2] = [B(s, 'boy'), B(s, 'grot')]
      const at = (st: GameState, id: string, dx: number, dz: number): GameState => place(st, id, m.pos.x + dx, m.pos.z + dz)
      let c = at(at(at(at(s, ic, -1.2, 0), dev, 1.2, 0), boy1, 0, 1.2), boy2, 0, -1.2)
      const control = markerControl(c, m)
      expect(control.contesting.A.slice().sort()).toEqual([ic, dev].sort())
      expect(control.apl).toEqual({ A: 5, B: 4 })
      expect(control.controller).toBe('A')
      // without the Iconarch it is a tie
      c = edit(c, (st) => void (st.operatives[ic]!.status = 'removed'))
      expect(markerControl(c, m).apl.A).toBe(2)
    }
  })

  it('TEAM-CC-011 TEAM-CC-012 TEAM-CC-013 the PSYCHIC actions: Ruinous Icon, Heinous Deluge and Malefic Vortex', () => {
    {
      const base = withWeapons(open(), melee('t.w.big', { dmg: { normal: 4, crit: 6 } }), melee('t.w.mid', { dmg: { normal: 3, crit: 4 } }))
      const ic = A(base, 'iconarch')
      const [d1, d2] = ALL(base, 'devotee')
      const boy = B(base, 'boy')
      const mw = A(base, 'mindwitch')
      const s0 = place(place(place(place(place(base, ic, 0, 0), d1!, 3, 0), d2!, 6, 0), boy, -3, 0), mw, -3, 3)
      const dmg = (st: GameState, weapon: string, from: string, to: string) => {
        const d = weaponDamage(st, from, weapon, to, 'fight')
        return [d.normal, d.crit]
      }
      // Invigoration
      const inv = take(activateOp(s0, ic), 'ability:cc.a.ruinous-icon:invigoration').state
      expect(tokenCount(inv, ic, 'cc.ruinousIcon')).toBe(1)
      expect(dmg(inv, 't.w.big', boy, d1!)).toEqual([3, 5])
      expect(dmg(inv, 't.w.mid', boy, d1!)).toEqual([3, 3])
      expect(dmg(inv, 't.w.big', boy, ic)).toEqual([3, 5])
      expect(dmg(inv, 't.w.big', boy, d2!)).toEqual([4, 6])
      expect(dmg(inv, 't.w.big', d1!, boy)).toEqual([4, 6])
      // the other effect is its own pick; using the action again would replace the token (one token per Iconarch)
      const det = take(activateOp(s0, ic), 'ability:cc.a.ruinous-icon:deterioration').state
      expect(det.operatives[ic]!.tokens![0]!.data!.effect).toBe('deterioration')
      expect(inv.operatives[ic]!.tokens![0]!.data!.effect).toBe('invigoration')
      expect(tokenCount(det, ic, 'cc.ruinousIcon')).toBe(1)
      expect(dmg(det, 't.w.big', d1!, boy)).toEqual([5, 7])
      expect(dmg(det, 't.w.mid', d1!, boy)).toEqual([4, 5])
      expect(dmg(det, 't.w.big', boy, d1!)).toEqual([4, 6])
      // the infernal gaze (0/0) becomes 1/1 against an enemy near the Iconarch
      expect(dmg(det, 'cc.w.infernal-gaze', mw, boy)).toEqual([1, 1])
      expect(dmg(det, 'cc.w.infernal-gaze', mw, A(det, 'demagogue'))).toEqual([0, 0])
      // the Iconarch's next activation ends it
      expect(withCtx(det, (ctx) => tokensOnActivationStart(ctx, ic)).state.operatives[ic]!.tokens ?? []).toEqual([])
      // a Null Rod within 6" switches it off
      const unrod = registerRod()
      expect(dmg(det, 't.w.big', d1!, boy)).toEqual([4, 6])
      unrod()
    }
    {
      const wall = feature('cc-wall', part('cc-wall.a', rect(3, 3.4, -4, 4), 1, ['light']))
      const o = open()
      const mw = A(o, 'mindwitch')
      const boy = B(o, 'boy')
      const grot = B(o, 'grot')
      const s = edit(place(place(place(o, mw, 0, 0), boy, 9, 6), grot, 4, 0), (st) => {
        st.map = { ...st.map, features: [wall] }
        for (const x of Object.values(st.operatives)) x.order = 'engage'
      })
      const targets = (st: GameState): string[] => offerIds(st, mw).filter((i) => i.startsWith('ability:cc.a.heinous-deluge:')).map((i) => i.split(':').at(-1)!)
      const u = activateOp(s, mw)
      expect(targets(u)).toEqual(expect.arrayContaining([boy, grot]))
      // behind the Light wall on Conceal: in cover, so not a valid target
      const hidden = edit(s, (st) => void (st.operatives[grot]!.order = 'conceal'))
      expect(targets(activateOp(hidden, mw))).not.toContain(grot)
      expect(targets(activateOp(hidden, mw))).toContain(boy)
      const v = take(u, `ability:cc.a.heinous-deluge:${boy}`).state
      expect(effectiveApl(v.operatives[boy]!)).toBe(v.operatives[boy]!.apl - 1)
    }
    {
      const s0 = open()
      const mw = A(s0, 'mindwitch')
      const boy = B(s0, 'boy')
      const dev = ALL(s0, 'devotee')[0]!
      const s = edit(place(place(place(s0, mw, 0, 0), boy, 7, 0), dev, 5.4, 1.2), (st) => {
        st.operatives[boy]!.wounds = 9
        st.operatives[boy]!.maxWounds = 9
      })
      const u = activateOp(s, mw)
      const spots = offerIds(u, mw).filter((i) => i.startsWith('ability:cc.a.malefic-vortex:'))
      expect(spots.length).toBeGreaterThan(3)
      const spotOf = (id: string): { x: number; z: number } => {
        const [x, z] = id.split(':').at(-1)!.split(',').map(Number)
        return { x: x!, z: z! }
      }
      const nearest = (to: { x: number; z: number }) => spots.slice().sort((a, b) => Math.hypot(spotOf(a).x - to.x, spotOf(a).z - to.z) - Math.hypot(spotOf(b).x - to.x, spotOf(b).z - to.z))[0]!
      const v = take(u, nearest({ x: 7, z: 0 })).state
      const marker = v.markers.filter((m) => m.equipmentId === 'cc.maleficVortex')
      expect(marker).toHaveLength(1)
      expect(v.operatives[boy]!.wounds).toBe(8)
      expect(v.operatives[dev]!.wounds).toBe(v.operatives[dev]!.maxWounds)
      // the Ready step of the next Strategy phase: 1 more damage to enemies only
      const ready = (st: GameState, tp: number): GameState => withCtx(st, (ctx) => void runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: tp } })).state
      expect(ready(v, 2).operatives[boy]!.wounds).toBe(7)
      expect(ready(v, 2).operatives[dev]!.wounds).toBe(ready(v, 2).operatives[dev]!.maxWounds)
      // re-use elsewhere (a later activation): the old marker leaves, one marker stands, the old spot no longer hurts
      const old = marker[0]!
      const w = edit(s, (st) => {
        st.markers.push({ ...old })
        st.effects.push({ id: 'evx', seat: 'A', kind: 'cc.vortex', source: 'cc.maleficVortex', expires: 'cc.never', data: { markerId: old.id, y: 0, mindwitchId: mw } } as never)
      })
      const again = take(activateOp(w, mw), nearest({ x: -8, z: 4 })).state
      expect(again.markers.filter((m) => m.equipmentId === 'cc.maleficVortex')).toHaveLength(1)
      expect(again.markers.find((m) => m.equipmentId === 'cc.maleficVortex')!.pos).not.toEqual(old.pos)
      expect(ready(again, 3).operatives[boy]!.wounds).toBe(again.operatives[boy]!.wounds)
    }
    {
      // any visible spot is legal, so three enemies standing close together can all be caught by one placement
      const s0 = open()
      const mw = A(s0, 'mindwitch')
      const boy = B(s0, 'boy')
      const grot = B(s0, 'grot')
      const third = Object.values(s0.operatives).find((o) => o.seat === 'B' && o.id !== boy && o.id !== grot)!.id
      const s = edit(place(place(place(place(s0, mw, 0, 0), boy, 3.1, -5.3), grot, 5, -4.2), third, 4, -6.9), (st) => {
        for (const id of [boy, grot, third]) {
          st.operatives[id]!.wounds = 9
          st.operatives[id]!.maxWounds = 9
        }
      })
      const nearestTo = (st: GameState, to: { x: number; z: number }): string => {
        const spots = offerIds(st, mw).filter((i) => i.startsWith('ability:cc.a.malefic-vortex:'))
        const d = (id: string) => {
          const [x, z] = id.split(':').at(-1)!.split(',').map(Number)
          return Math.hypot(x! - to.x, z! - to.z)
        }
        return spots.sort((a, b) => d(a) - d(b))[0]!
      }
      const u = activateOp(s, mw)
      const v = take(u, nearestTo(u, { x: 4, z: -5.5 })).state
      expect([v.operatives[boy]!.wounds, v.operatives[grot]!.wounds, v.operatives[third]!.wounds]).toEqual([8, 8, 8])
      // the same positions behind a tall Heavy wall: no spot the Mindwitch sees reaches the two farther ones (spots are
      // worked out per map, so the open-ground offers are not reused)
      const walled = edit(s, (st) => void (st.map = { ...st.map, features: [feature('cc-wall2', part('cc-wall2.a', rect(1.5, 1.9, -11, 11), 6, ['heavy']))] }))
      const w = activateOp(walled, mw)
      const hit = take(w, nearestTo(w, { x: 4, z: -5.5 })).state
      expect([hit.operatives[grot]!.wounds, hit.operatives[third]!.wounds]).toEqual([9, 9])
    }
  })

  it('TEAM-CC-014 Group Activation: expending a Devotee forces another ready Devotee next, which does not chain on; a Devotee that mutated does not chain', () => {
    const s = open()
    const [d1, d2] = ALL(s, 'devotee')
    const done = take(activateOp(s, d1!), 'end').state
    // the cult activates again, and only a Devotee may be picked
    expect(done.pending!.kind).toBe('firefight.activate')
    expect(done.pending!.seat).toBe('A')
    expect(done.firefight.chain!.ids.sort()).toEqual(ALL(s, 'devotee').filter((id) => id !== d1).sort())
    expect(optionIds(done).every((id) => ALL(s, 'devotee').includes(id))).toBe(true)
    expect(step(done, act.activate(done.pending!, A(s, 'iconarch'))).rejection).toBeDefined()
    // the chained Devotee ends: the opponent activates as normal
    const next = take(activateOp(done, d2!), 'end').state
    expect(next.pending!.seat).toBe('B')
    expect(next.firefight.chain ?? null).toBeNull()
    // a Devotee that turned into a Mutant during its activation is no longer a DEVOTEE: no chain
    const mutated = becomes(activateOp(s, d1!), d1!, 'mutant')
    expect(take(mutated, 'end').state.pending!.seat).toBe('B')
    // and a Mutant is never chained into
    expect(providerChain(becomes(s, d2!, 'mutant'), s.operatives[d1!]!, false)).not.toContain(d2)
  })

  it('TEAM-CC-015 TEAM-CC-016 TEAM-CC-017 the Mutant and the Torment: Accursed Mutant, Unnatural Regeneration, Accursed Torment', () => {
    {
      const s0 = open({ equipmentA: ['core.e.utility-grenades', 'core.e.explosive-grenades'] })
      const [d1, d2] = ALL(s0, 'devotee')
      const s = becomes(s0, d1!, 'mutant')
      const mu = s.operatives[d1!]!
      expect(mu.datacardId).toBe('cc.mutant')
      const ids = (st: GameState, id: string): string[] => offerIds(activateOp(st, id), id)
      expect(ids(s, d2!).some((i) => i.startsWith('ability:core.a.smoke-grenade'))).toBe(true)
      expect(ids(s, d1!).filter((i) => i.startsWith('ability:core.a.') && !i.includes('secure') && !i.includes('loot'))).toEqual([])
      expect(actionForbidden(s, mu, 'ability:core.a.smoke-grenade')).not.toBeNull()
      expect(actionForbidden(s, mu, 'ability:core.a.stun-grenade')).not.toBeNull()
      expect(mu.weapons).toContain('core.w.frag-grenade')
      expect(actionForbidden(s, mu, 'shoot')).toBeNull()
      // costs: Pick Up Marker and mission actions 1 more, Operate Hatch and other actions unchanged
      expect(providerCostDelta(s, mu, 'marker:pickUp')).toBe(1)
      expect(providerCostDelta(s, mu, 'ability:core.a.secure')).toBe(1)
      expect(providerCostDelta(s, mu, 'ability:core.a.loot')).toBe(1)
      expect(providerCostDelta(s, mu, 'ability:mission.operate-hatch')).toBe(0)
      expect(providerCostDelta(s, mu, 'marker:place')).toBe(0)
      expect(providerCostDelta(s, s.operatives[d2!]!, 'marker:pickUp')).toBe(0)
      expect(actionForbidden(s, mu, 'ability:core.a.secure')).toBeNull()
    }
    {
      const o = open()
      const [mu, plain] = ALL(o, 'devotee') as [string, string]
      const s = becomes(o, mu, 'mutant')
      const boy = B(s, 'boy')
      expect(hurt(s, mu, boy, 3, 'normal', dice(5)).dealt).toBe(2)
      expect(hurt(s, mu, boy, 3, 'normal', dice(4)).dealt).toBe(3)
      expect(hurt(s, mu, boy, 4, 'crit', dice(6)).dealt).toBe(3)
      expect(hurt(s, mu, boy, 3, 'strike-normal', dice(6)).dealt).toBe(2)
      // 2 damage is not rolled for, Devastating damage is not an attack die, and a Devotee has no such rule
      expect(hurt(s, mu, boy, 2, 'normal', dice(6)).dealt).toBe(2)
      expect(hurt(s, mu, boy, 3, 'devastating', dice(6)).dealt).toBe(3)
      expect(hurt(s, plain, boy, 3, 'normal', dice(6)).dealt).toBe(3)
      // a Torment regenerates too
      const t = becomes(s, mu, 'torment')
      expect(hurt(t, mu, boy, 3, 'normal', dice(5)).dealt).toBe(2)
    }
    {
      const s0 = open({ equipmentA: ['core.e.explosive-grenades'] })
      const d1 = ALL(s0, 'devotee')[0]!
      const mutant = becomes(s0, d1, 'mutant')
      expect(mutant.operatives[d1]!.weapons).toContain('core.w.frag-grenade')
      const carrying = edit(mutant, (st) => void (st.operatives[d1]!.flags.carrying = 'carried-marker'))
      const s = becomes(carrying, d1, 'torment')
      const to = s.operatives[d1]!
      expect(to.datacardId).toBe('cc.torment')
      expect(to.flags.carrying).toBe('carried-marker')
      expect(providerWeaponForbidden(s, to, 'core.w.frag-grenade', 'shoot')).not.toBeNull()
      expect(providerWeaponForbidden(s, to, 'core.w.krak-grenade', 'shoot')).not.toBeNull()
      expect(providerWeaponForbidden(s, to, 'cc.w.hideous-mutations', 'fight')).toBeNull()
      expect(actionForbidden(s, to, 'marker:pickUp')).not.toBeNull()
      expect(actionForbidden(s, to, 'ability:core.a.smoke-grenade')).not.toBeNull()
      expect(actionForbidden(s, to, 'ability:core.a.secure')).not.toBeNull()
      expect(actionForbidden(s, to, 'ability:mission.operate-hatch')).toBeNull()
      expect(actionForbidden(s, to, 'marker:place')).toBeNull()
      // the base is 40mm and the wounds are the Torment's
      expect(to.baseRadius).toBeCloseTo(40 / 25.4 / 2, 2)
      expect(to.maxWounds).toBe(13)
    }
  })

  it('TEAM-CC-018 Brute: a Torment on Conceal behind Light terrain can be selected as a Shoot target and keeps its cover save; behind Heavy terrain it cannot', () => {
    const o = open()
    const shooter = B(o, 'dakka-boy')
    const dev = ALL(o, 'devotee')[0]!
    const stage = (traits: ('light' | 'heavy')[], card: 'devotee' | 'torment'): GameState => {
      const s = card === 'torment' ? becomes(o, dev, 'torment') : o
      return edit(place(place(s, shooter, -6, 0), dev, 4, 0), (st) => {
        st.map = { ...st.map, features: [feature('cc-wall', part('cc-wall.a', rect(3, 3.4, -2, 2), 1, traits))] }
        st.operatives[dev]!.order = 'conceal'
        st.operatives[shooter]!.order = 'engage'
      })
    }
    const weapon = o.operatives[shooter]!.weapons.find((w) => o.data.weapons[w]!.type === 'ranged')!
    const targets = (st: GameState): string[] => validTargets(st, st.operatives[shooter]!, weapon).map((t) => t.id)
    // Light terrain: a Devotee on Conceal in cover cannot be selected, a Torment can
    expect(targets(stage(['light'], 'devotee'))).not.toContain(dev)
    const light = stage(['light'], 'torment')
    expect(targets(light)).toContain(dev)
    // ...and it is still in cover for the cover save
    const info = validTargets(light, light.operatives[shooter]!, weapon).find((t) => t.id === dev)!
    expect(info.inCover).toBe(true)
    // Heavy terrain still protects it
    expect(targets(stage(['heavy'], 'torment'))).not.toContain(dev)
  })

  it('TEAM-CC-019 TEAM-CC-020 TEAM-CC-041 TEAM-CC-043 Mutation: the free gambit picks up to 2 operatives, a Devotee that kills in melee mutates after the action and finishes its activation as a Mutant', () => {
    // the gambit: 0 CP, up to 2 picks in turning point 1 (3 in the third, 4 from the fourth), none twice, regain for the Demagogue
    expect([1, 2, 3, 4, 5].map(gambitAllowance)).toEqual([2, 2, 3, 4, 4])
    const g = toGambit()
    expect(offersFor(g, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).find((o) => o.ployId === 'cc.p.mutation')!.cost).toBe(0)
    let m = take(g, 'cc.p.mutation').state
    expect(m.pending!.kind).toBe('ability.choice')
    expect(m.pending!.context).toMatchObject({ hook: 'ccMutation', mode: 'gambit', left: 2 })
    const [d1, d2, d3] = ALL(g, 'devotee')
    const dem = A(g, 'demagogue')
    expect(optionIds(m)).toContain(`${dem}|regain`)
    expect(optionIds(m)).not.toContain(`${dem}|mutant`)
    expect(optionIds(m).filter((i) => i.startsWith(`${d1}|`)).sort()).toEqual(['regain', ...['chitinous', 'fleet', 'sinewed', 'horned', 'barbed', 'deformed-wings'].map((x) => `mutant:${x}`)].map((x) => `${d1}|${x}`).sort())
    m = take(m, `${d1}|mutant:chitinous`).state
    expect(m.operatives[d1!]!.datacardId).toBe('cc.mutant')
    expect(m.operatives[d1!]!.save).toBe(4)
    // the primary gift is chosen once: the next pick no longer names a gift, and the first operative is not offered again
    expect(m.pending!.context.left).toBe(1)
    expect(optionIds(m)).toContain(`${d2}|mutant`)
    expect(optionIds(m).some((i) => i.startsWith(`${d1}|`))).toBe(false)
    m = take(m, `${d2}|mutant`).state
    expect(m.operatives[d2!]!.datacardId).toBe('cc.mutant')
    expect(m.operatives[d2!]!.save).toBe(4)
    expect(m.pending!.kind).toBe('strategy.gambit')
    expect(giftsOf(m, m.operatives[d2!]!)).toEqual(['chitinous'])
    expect(giftsOf(m, m.operatives[d3!]!)).toEqual([])
    // not offered twice in a turning point
    expect(offersFor(m, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'cc.p.mutation')).toBe(false)

    // a kill in melee: the choice comes after the Fight, in the Devotee's own activation
    const { state: k, dev, foe } = afterKill()
    expect(k.pending!.kind).toBe('ability.choice')
    expect(k.pending!.context.hook).toBe('reaction')
    expect(k.operatives[foe]!.status).toBe('removed')
    expect(k.kills!.at(-1)).toMatchObject({ removedId: foe, killerId: dev, cause: 'attack' })
    expect(optionIds(k).length).toBe(7)
    // a Stun on the Devotee before its turn survives the change and ends with that activation (1 AP left, spent on the Fight)
    const stunned = withCtx(open(), (ctx) => applyAplEffect(ctx, ALL(open(), 'devotee')[0]!, -1, 'stun')).state
    const sk = afterKill(stunned)
    expect(sk.state.operatives[sk.dev]!.aplFx).toEqual([{ delta: -1, source: 'stun' }])
    const turned = take(sk.state, 'react:0')
    expect(turned.state.operatives[sk.dev]!.datacardId).toBe('cc.mutant')
    expect(turned.events.some((e) => e.type === 'OperativeTransformed' && e.operativeId === sk.dev)).toBe(true)
    expect(turned.events.some((e) => e.type === 'AplModified' && e.reason === 'stun.expired')).toBe(true)
    // with AP left it finishes the activation as a Mutant: its weapon is the appendages, it has no ranged weapon to Shoot with
    const fresh = afterKill()
    const mutated = take(fresh.state, 'react:0').state
    const mu = mutated.operatives[fresh.dev]!
    expect(mu.datacardId).toBe('cc.mutant')
    expect(mutated.pending!.kind).toBe('firefight.action')
    expect(mutated.firefight.activation!.operativeId).toBe(fresh.dev)
    expect(mu.weapons).toEqual(['cc.w.blasphemous-appendages'])
    expect(optionIds(mutated)).not.toContain('shoot')
    // declining keeps the Devotee a Devotee; a Devotee that already mutated this turning point is not asked
    expect(passIt(fresh.state).state.operatives[fresh.dev]!.datacardId).toBe('cc.devotee')
    const spent = afterKill(edit(open(), (st) => void st.ledger.A.tp.push(`cc.mutated:${ALL(open(), 'devotee')[0]}`)))
    expect(spent.state.pending!.kind).toBe('firefight.action')
    // a pistol kill at range gives nothing: the victim was not in the Devotee's control range
    const o = open()
    const shooter = ALL(o, 'devotee')[0]!
    const foe2 = B(o, 'boy')
    const far = edit(place(place(o, shooter, 0, 0), foe2, 6, 0), (st) => {
      st.operatives[foe2]!.wounds = 2
      st.operatives[foe2]!.maxWounds = 8
    })
    const rng = dice(6, 6, 6, 6, 1, 1, 1, 1, 1)
    let u = take(activateOp(far, shooter, 'engage', rng), 'shoot', rng).state
    u = take(u, 'cc.w.pistol', rng).state
    u = take(u, foe2, rng).state
    const shot = play(u, rng, {}, ['firefight.action', 'firefight.activate', 'ability.choice'])
    expect(shot.state.operatives[foe2]!.status).toBe('removed')
    expect(shot.state.pending!.kind).toBe('firefight.action')
    expect(shot.state.effects.some((e) => e.kind === 'cc.mutRight')).toBe(false)
    // a retaliation kill in the enemy's activation offers it to the cult at the end of that activation
    const b = edit(place(place(o, shooter, 0, 0), foe2, 1.4, 0), (st) => {
      st.operatives[foe2]!.wounds = 2
      st.operatives[foe2]!.maxWounds = 8
    })
    const bTurn = take(activateOp(b, A(b, 'mindwitch')), 'end').state
    const r2 = dice(1, 1, 1, 1, 6, 6, 6, 6, 1, 1)
    const fought = play(take(take(activateOp(bTurn, foe2, 'engage', r2), 'fight', r2).state, shooter, r2).state, r2, strikes, ['firefight.action', 'firefight.activate', 'ability.choice'])
    expect(fought.state.operatives[foe2]!.status).toBe('removed')
    expect(fought.state.pending).toMatchObject({ kind: 'ability.choice', seat: 'A' })
    expect(fought.state.pending!.context.hook).toBe('reaction')
  })

  it('TEAM-CC-021 TEAM-CC-022 TEAM-CC-023 TEAM-CC-042 Mutation caps, what a new form keeps, gift choices, and the 40mm base of a Torment', () => {
    const o = open()
    const devs = ALL(o, 'devotee')
    const optionsOf = (st: GameState, id: string): string[] => mutationOptions(st, st.operatives[id]!).map(mutationOptionId)
    // never more than five Mutants: with five in the killzone no Devotee can turn, and a place frees up when one dies
    let five = o
    for (const id of devs.slice(0, 5)) five = becomes(five, id, 'mutant')
    expect(optionsOf(five, devs[5]!)).toEqual(['regain'])
    expect(optionsOf(edit(five, (st) => void (st.operatives[devs[0]!]!.status = 'removed')), devs[5]!).filter((i) => i.startsWith('mutant'))).toHaveLength(6)
    // never more than three Torments, and a Mutant that becomes a Torment frees a Mutant place
    let three = five
    for (const id of devs.slice(0, 3)) three = becomes(three, id, 'torment')
    expect(optionsOf(three, devs[3]!).filter((i) => i.startsWith('torment'))).toEqual([])
    expect(optionsOf(three, devs[5]!).filter((i) => i.startsWith('mutant'))).toHaveLength(6)
    // at most two Torment turns per turning point across the team
    const twice = edit(five, (st) => void (st.ledger.A.tpUses['cc.torments'] = 2))
    expect(optionsOf(twice, devs[3]!).filter((i) => i.startsWith('torment'))).toEqual([])
    expect(optionsOf(five, devs[3]!).filter((i) => i.startsWith('torment'))).toHaveLength(6)
    // every gift already selected (Abhorrent Mutation): the first turns still happen, with no gift left to pick
    const noneLeft = withGifts(o, { ops: { [devs[8]!]: ['chitinous', 'fleet', 'sinewed', 'horned', 'barbed', 'deformed-wings'] } })
    expect(optionsOf(noneLeft, devs[0]!)).toEqual(['mutant', 'regain'])
    const bare = withCtx(noneLeft, (ctx) => void performMutation(ctx, ctx.state.operatives[devs[0]!]!, 'mutant')).state
    expect([bare.operatives[devs[0]!]!.datacardId, primaryGift(bare, 'A')]).toEqual(['cc.mutant', undefined])

    // what the new form keeps: wounds already lost, order, readiness, Stun, tokens; injured is recomputed
    const d = devs[0]!
    const hurt1 = edit(o, (st) => {
      const op = st.operatives[d]!
      op.wounds = 2
      op.flags.injured = true
      op.order = 'conceal'
      op.ready = false
      op.aplMods = -1
      op.aplFx = [{ delta: -1, source: 'stun' }]
      op.tokens = [{ kind: 'x.test', owner: 'B', count: 2 }]
    })
    const turn = (st: GameState, option: string) => withCtx(st, (ctx) => void performMutation(ctx, ctx.state.operatives[d]!, option))
    const asMutant = turn(hurt1, 'mutant:chitinous')
    const mu = asMutant.state.operatives[d]!
    expect([mu.datacardId, mu.wounds, mu.maxWounds, mu.flags.injured]).toEqual(['cc.mutant', 2, 7, true])
    expect([mu.order, mu.ready, mu.aplFx!.length, mu.tokens![0]!.count, mu.save]).toEqual(['conceal', false, 1, 2, 4])
    expect(asMutant.events.filter((e) => e.type === 'OperativeTransformed')).toEqual([expect.objectContaining({ operativeId: d, from: 'cc.devotee', to: 'cc.mutant' })])
    expect(asMutant.state.mission!.startCount.A).toBe(14)
    // a Mutant on 2 of 7 becomes a Torment on 8 of 13: no longer injured, and still has the primary gift's Save
    const next = edit(asMutant.state, (st) => void (st.ledger.A.tp = []))
    expect(optionsOf(next, d).filter((i) => i.startsWith('torment'))).toHaveLength(5)
    expect(optionsOf(next, d)).not.toContain('torment:chitinous')
    const asTorment = turn(next, 'torment:fleet')
    const to = asTorment.state.operatives[d]!
    expect([to.datacardId, to.wounds, to.maxWounds, to.flags.injured, to.save]).toEqual(['cc.torment', 8, 13, false, 4])
    expect([primaryGift(asTorment.state, 'A'), secondaryGift(asTorment.state, 'A')]).toEqual(['chitinous', 'fleet'])
    expect(giftsOf(asTorment.state, to)).toEqual(['chitinous', 'fleet'])
    // Devotees have no team gift, and no gift is ever offered twice
    expect(giftsOf(asTorment.state, asTorment.state.operatives[devs[1]!]!)).toEqual([])
    expect(availableGifts(asTorment.state, 'A').sort()).toEqual(['barbed', 'deformed-wings', 'horned', 'sinewed'])
    // an illegal option changes nothing
    expect(turn(next, 'torment:chitinous').state.operatives[d]!.datacardId).toBe('cc.mutant')

    // the Torment's 40mm base would overlap a friend: it is placed at the nearest legal spot, and still in the enemy's control range
    const boy = B(o, 'boy')
    const crowd = edit(place(place(place(o, d, 0, 0), boy, 1.5, 0), devs[1]!, 0, 1.1), (st) => {
      st.ledger.A.battle.push('cc.gift:primary:chitinous', 'cc.gift:sel:chitinous')
    })
    const crowded = becomes(crowd, d, 'mutant')
    expect(enemiesInControlRange(crowded, crowded.operatives[d]!, 'A').map((x) => x.id)).toEqual([boy])
    const placed = turn(crowded, 'torment:fleet').state.operatives[d]!
    expect(placementProblem(crowded, { id: d, pos: placed.pos, radius: placed.baseRadius, height: placed.height })).toBeNull()
    expect(enemiesInControlRange(turn(crowded, 'torment:fleet').state, placed, 'A').map((x) => x.id)).toEqual([boy])
    expect(Math.hypot(placed.pos.x, placed.pos.z)).toBeGreaterThan(0)
  })

  it('TEAM-CC-019 TEAM-CC-021 TEAM-CC-022 a full mutation chain in a real game: gambit in turning point 1 turns a Devotee into a Mutant, the gambit of turning point 2 turns it into a Torment', () => {
    const g1 = toGambit()
    const dev = ALL(g1, 'devotee')[0]!
    let s = take(take(g1, 'cc.p.mutation').state, `${dev}|mutant:horned`).state
    expect(s.pending!.context).toMatchObject({ hook: 'ccMutation', left: 1 })
    s = take(s, 'done').state
    expect(s.pending!.kind).toBe('strategy.gambit')
    expect(s.operatives[dev]!.datacardId).toBe('cc.mutant')
    // play on to the next Strategy phase
    const tp2 = driveQuiet(s, (st) => st.turningPoint === 2 && st.pending?.kind === 'strategy.gambit' && st.pending.seat === 'A', 3000, dice(6, 1, 6, 1))
    expect(tp2.turningPoint).toBe(2)
    expect(tp2.operatives[dev]!.datacardId).toBe('cc.mutant')
    expect(tp2.operatives[dev]!.ready).toBe(true)
    let t = take(take(tp2, 'cc.p.mutation').state, `${dev}|torment:chitinous`).state
    t = take(t, 'done').state
    const op = t.operatives[dev]!
    expect([op.datacardId, op.maxWounds, op.save, op.baseRadius > 0.75]).toEqual(['cc.torment', 13, 4, true])
    expect(giftsOf(t, op)).toEqual(['horned', 'chitinous'])
    // the mutation card has been used up for this turning point, and Torment is as far as it goes
    expect(mutationOptions(t, op)).toEqual([])
  })

  it('TEAM-CC-024 TEAM-CC-025 TEAM-CC-026 Deformed Wings, Fleet and Chitinous', () => {
    const o = open()
    const [d1] = ALL(o, 'devotee') as [string]
    const towers = [feature('cc-tower', part('cc-tower.a', rect(1.4, 3.4, -1, 1), 3, ['vantage'])), feature('cc-tall', part('cc-tall.a', rect(-3.4, -1.4, -1, 1), 6, ['vantage']))]
    const plain = edit(place(becomes(o, d1, 'mutant'), d1, 0, 0), (st) => void (st.map = { ...st.map, features: towers }))
    const wings = withGifts(plain, { primary: 'deformed-wings' })
    const cost = (st: GameState, kind: 'reposition' | 'dash', y: number, from: { x: number; y: number }) => {
      const t = edit(st, (x) => void (x.operatives[d1]!.pos = { x: from.x, y: from.y, z: 0 }))
      const plan = planMove(t, t.operatives[d1]!, kind, [{ x: y === 3 ? 2 : 0, z: 0, y }])
      return plan.ok ? plan.cost : plan.rejection.code
    }
    // a 3" climb costs 3" normally and 2" with Deformed Wings; a 6" drop costs 4" (too far for 6" of Move) and nothing with them
    expect(cost(plain, 'reposition', 3, { x: 0, y: 0 })).toBe(5)
    expect(cost(wings, 'reposition', 3, { x: 0, y: 0 })).toBe(4)
    expect(cost(plain, 'reposition', 0, { x: -2.4, y: 6 })).toBe('E_OUT_OF_RANGE')
    expect(cost(wings, 'reposition', 0, { x: -2.4, y: 6 })).toBe(3)
    // a Dash still cannot climb
    expect(cost(wings, 'dash', 3, { x: 0, y: 0 })).not.toBe(2)
    expect(typeof cost(wings, 'dash', 3, { x: 0, y: 0 })).toBe('string')
    // Fleet: Move 7" (5" when injured), and the Reposition reaches that far
    const fleet = withGifts(becomes(o, d1, 'mutant'), { primary: 'fleet' })
    expect(effectiveMove(fleet.operatives[d1]!, fleet)).toBe(7)
    expect(take(activateOp(fleet, d1), 'reposition').state.pending!.context.maxInches).toBe(7)
    const hurtMutant = edit(fleet, (st) => void (st.operatives[d1]!.wounds = 3))
    expect(effectiveMove(hurtMutant.operatives[d1]!, hurtMutant)).toBe(5)
    expect(effectiveMove(fleet.operatives[ALL(fleet, 'devotee')[0]!]!, fleet)).toBe(6)
    // Chitinous: Save 4+; it is kept through the next change of form and lost when Baleful Script takes the gift away
    const chit = withGifts(becomes(o, d1, 'mutant'), { primary: 'chitinous' })
    expect(chit.operatives[d1]!.save).toBe(4)
    const torment = becomes(chit, d1, 'torment')
    expect(torment.operatives[d1]!.save).toBe(4)
    expect(becomes(o, d1, 'mutant').operatives[d1]!.save).toBe(5)
  })

  it('TEAM-CC-027 TEAM-CC-028 TEAM-CC-029 TEAM-CC-043 Horned, Sinewed and Barbed', () => {
    const o = open()
    const [d1, d2] = ALL(o, 'devotee') as [string, string]
    const [boy1, boy2] = [B(o, 'boy'), B(o, 'grot')]
    const foes = (s: GameState, w1 = 30, w2 = 30): GameState =>
      edit(s, (st) => {
        for (const [id, w] of [[boy1, w1], [boy2, w2]] as const) {
          st.operatives[id]!.wounds = w
          st.operatives[id]!.maxWounds = Math.max(w, 10)
        }
      })
    // HORNED: a Mutant ending a Charge in control range of two enemies may hurt one of them for 1 (a Torment D3)
    const stage = (card: 'mutant' | 'torment', rng: Rng): GameState => {
      const s = withGifts(becomes(foes(place(place(place(o, d1, 0, 0), boy1, 3.5, 0), boy2, 3.5, 1.9)), d1, card), { primary: 'horned' })
      const c = take(activateOp(s, d1, 'engage', rng), 'charge', rng).state
      return step(c, act.path(c.pending!, [{ x: 2.4, z: 0.9 }]), rng).state
    }
    const m = stage('mutant', dice())
    expect(m.pending!.kind).toBe('ploy.firefight')
    expect(optionIds(m)).toEqual(expect.arrayContaining([`cc.a.gift-horned:${boy1}`, `cc.a.gift-horned:${boy2}`]))
    const gored = take(m, `cc.a.gift-horned:${boy2}`, dice()).state
    expect(gored.operatives[boy2]!.wounds).toBe(29)
    expect(gored.operatives[boy1]!.wounds).toBe(30)
    // used once: the Charge window offers no more goring (the next window is the end of the action)
    expect(optionIds(gored).some((i) => i.startsWith('cc.a.gift-horned'))).toBe(false)
    const t = stage('torment', dice(6))
    expect(take(t, `cc.a.gift-horned:${boy2}`, dice(6)).state.operatives[boy2]!.wounds).toBe(27)

    // SINEWED: an injured Mutant keeps Hit 4+ on its melee weapon, which has Brutal; its Move is still reduced
    const sin = edit(withGifts(becomes(o, d1, 'mutant'), { primary: 'sinewed' }), (st) => void (st.operatives[d1]!.wounds = 3))
    const injured = edit(becomes(o, d1, 'mutant'), (st) => void (st.operatives[d1]!.wounds = 3))
    expect(attackStats(sin, d1, 'cc.w.blasphemous-appendages', boy1, { kind: 'fight' }).need).toBe(4)
    expect(attackStats(injured, d1, 'cc.w.blasphemous-appendages', boy1, { kind: 'fight' }).need).toBe(5)
    expect(attackStats(sin, d1, 'cc.w.blasphemous-appendages', boy1, { kind: 'fight' }).rules.brutal).toBe(true)
    expect(attackStats(injured, d1, 'cc.w.blasphemous-appendages', boy1, { kind: 'fight' }).rules.brutal).toBe(false)
    expect(effectiveMove(sin.operatives[d1]!, sin)).toBe(4)

    // BARBED: the enemy fighter gets no assist; on its first strike every other enemy in control range takes 1 (a Torment D3)
    const bar = withGifts(becomes(place(place(place(o, d1, 0, 0), boy1, 1.4, 0), boy2, 0, 1.4), d1, 'mutant'), { primary: 'barbed' })
    const assisters = ['x1', 'x2']
    const boyMelee = o.operatives[boy1]!.weapons.find((w) => o.data.weapons[w]!.type === 'melee')!
    expect(attackStats(bar, boy1, boyMelee, d1, { kind: 'fight', assists: assisters }).assists).toEqual([])
    expect(attackStats(becomes(o, d1, 'mutant'), boy1, boyMelee, d1, { kind: 'fight', assists: assisters }).assists).toEqual(assisters)
    const barbed = foes(bar)
    const f = fightOnce(barbed, d1, boy1, [6, 6, 1, 1, 1, 1, 1, 1], {}, ['firefight.action', 'ability.choice']).state
    // two strikes at boy1, but one splash for the other enemy only
    expect(f.operatives[boy2]!.wounds).toBe(29)
    expect(30 - f.operatives[boy1]!.wounds).toBe(8)
    const tor = foes(withGifts(becomes(place(place(place(o, d1, 0, 0), boy1, 1.4, 0), boy2, 0, 1.4), d1, 'torment'), { primary: 'barbed' }))
    const ft = fightOnce(tor, d1, boy1, [6, 6, 6, 6, 6, 1, 1, 1, 1, 6], {}, ['firefight.action', 'ability.choice']).state
    expect(ft.operatives[boy2]!.wounds).toBe(27)
    // a Devotee with Barbed (Abhorrent Mutation) whose splash incapacitates an enemy is the killer and is offered Mutation
    const dev = withGifts(foes(place(place(place(o, d2, 0, 0), boy1, 1.4, 0), boy2, 0, 1.4), 30, 1), { ops: { [d2]: ['barbed'] } })
    const splash = fightOnce(dev, d2, boy1, [6, 1, 1, 1, 1, 1, 1, 1], {}, ['firefight.action', 'ability.choice'])
    expect(splash.state.operatives[boy2]!.status).toBe('removed')
    expect(splash.state.kills!.at(-1)).toMatchObject({ removedId: boy2, killerId: d2 })
    expect(splash.state.pending).toMatchObject({ kind: 'ability.choice' })
    expect(splash.state.pending!.context.hook).toBe('reaction')
  })

  it('TEAM-CC-030 TEAM-CC-031 TEAM-CC-032 TEAM-CC-033 the strategy ploys: Exaltation in Pain, Fervent Onslaught, Creatures of Nightmare, Sickening Aura', () => {
    const o = open()
    const [d1, d2] = ALL(o, 'devotee') as [string, string]
    const boy = B(o, 'boy')
    const ranged = (id: string, s: GameState = o): string => s.operatives[id]!.weapons.find((w) => s.data.weapons[w]!.type === 'ranged')!
    const shoot = ranged(boy)
    const defence = (st: GameState, target: string) => defenceStats(st, target, boy, shoot, parseRules(effectiveRules(st, st.operatives[boy]!, st.data.weapons[shoot]!, 'shoot', target)), false).grants.map((g) => g.id)
    // EXALTATION IN PAIN: an injured Devotee's pistol keeps Hit 4+ but its Move is 4"; a wounded friendly shot at re-rolls one defence die
    const hurt1 = edit(o, (st) => void (st.operatives[d1]!.wounds = 3))
    const ex = withPloy(hurt1, 'cc.p.exaltation-in-pain')
    expect(attackStats(hurt1, d1, 'cc.w.pistol', boy, { kind: 'shoot' }).need).toBe(5)
    expect(attackStats(ex, d1, 'cc.w.pistol', boy, { kind: 'shoot' }).need).toBe(4)
    expect(attackStats(ex, d1, 'cc.w.crude-melee-weapon', boy, { kind: 'fight' }).need).toBe(4)
    expect(effectiveMove(ex.operatives[d1]!, ex)).toBe(4)
    expect(defence(ex, d1)).toEqual(['cc.exaltation'])
    expect(defence(ex, d2)).toEqual([])
    expect(defence(hurt1, d1)).toEqual([])
    // the Kommandos get nothing from it
    expect(attackStats(edit(ex, (st) => void (st.operatives[boy]!.wounds = 2)), boy, shoot, d1, { kind: 'shoot' }).need).toBe(attackStats(edit(o, (st) => void (st.operatives[boy]!.wounds = 2)), boy, shoot, d1, { kind: 'shoot' }).need)

    // FERVENT ONSLAUGHT: Accurate 1 on a Devotee's melee weapon, Accurate 2 on a Mutant's; ranged weapons gain nothing
    const fv = withPloy(becomes(o, d2, 'mutant'), 'cc.p.fervent-onslaught')
    const acc = (st: GameState, id: string, w: string) => accurateTotal(parseRules(effectiveRules(st, st.operatives[id]!, st.data.weapons[w]!, w.includes('pistol') ? 'shoot' : 'fight', boy)).accurate)
    expect(acc(fv, d1, 'cc.w.crude-melee-weapon')).toBe(1)
    expect(acc(fv, d2, 'cc.w.blasphemous-appendages')).toBe(2)
    expect(acc(fv, d1, 'cc.w.pistol')).toBe(0)
    expect(acc(becomes(o, d2, 'mutant'), d2, 'cc.w.blasphemous-appendages')).toBe(0)
    expect(accurateTotal(parseRules(effectiveRules(fv, fv.operatives[boy]!, fv.data.weapons[o.operatives[boy]!.weapons.find((w) => o.data.weapons[w]!.type === 'melee')!]!, 'fight', d1)).accurate)).toBe(0)

    // CREATURES OF NIGHTMARE: two APL 2 enemies against two APL 2 cultists, one enemy within 2" of a Mutant: 4 counts as 3
    const m = o.markers.find((k) => k.kind === 'objective')!
    const [boy2] = [B(o, 'grot')]
    const at = (st: GameState, id: string, dx: number, dz: number): GameState => place(st, id, m.pos.x + dx, m.pos.z + dz)
    const base = at(at(at(at(becomes(o, d2, 'mutant'), d1, -1.2, 0), d2, 1.2, 0), boy, 0, 1.2), boy2, 0, -1.2)
    expect(markerControl(base, m).apl).toEqual({ A: 4, B: 4 })
    const cr = withPloy(base, 'cc.p.creatures-of-nightmare')
    expect(markerControl(cr, m).apl).toEqual({ A: 4, B: 3 })
    expect(markerControl(cr, m).controller).toBe('A')
    // with no Mutant or Torment within 2" of the enemy, nothing changes
    const none = withPloy(at(at(at(at(o, d1, -1.2, 0), d2, 1.2, 0), boy, 0, 1.2), boy2, 0, -1.2), 'cc.p.creatures-of-nightmare')
    expect(markerControl(none, m).apl).toEqual({ A: 4, B: 4 })

    // SICKENING AURA: an enemy within 2" of a Torment shoots at Hit one worse; an injured enemy is not worsened again; at 3" nothing
    const tor = becomes(place(place(o, d1, 0, 0), boy, 3.2, 0), d1, 'torment')
    const sick = withPloy(tor, 'cc.p.sickening-aura')
    const need = (st: GameState) => attackStats(st, boy, shoot, d2, { kind: 'shoot' }).need
    expect(need(sick)).toBe(need(tor) + 1)
    const injuredBoy = edit(sick, (st) => void (st.operatives[boy]!.wounds = 2))
    expect(need(injuredBoy)).toBe(need(edit(tor, (st) => void (st.operatives[boy]!.wounds = 2))))
    expect(need(place(sick, boy, 4.5, 0))).toBe(need(tor))
    // a cult mirror match: the other cult's Devotee near the Torment is an enemy and is worsened as well
    const mo = open({ teams: ['chaos-cult', 'chaos-cult'] })
    const [md1, md2] = ALL(mo, 'devotee')
    const foe = opOf(mo, 'B', 'cc.devotee')
    const mtor = becomes(place(place(mo, md1!, 0, 0), foe, 3.2, 0), md1!, 'torment')
    const mneed = (st: GameState) => attackStats(st, foe, 'cc.w.pistol', md2!, { kind: 'shoot' }).need
    expect(mneed(withPloy(mtor, 'cc.p.sickening-aura'))).toBe(mneed(mtor) + 1)
  })

  it('TEAM-CC-034 TEAM-CC-035 Faithful Follower redirects a Shoot or a Fight aimed at a DARK COMMUNE operative, Abhorrent Mutation gives a gift that stays through mutation', () => {
    const o = open()
    const dem = A(o, 'demagogue')
    const [dev, d2] = ALL(o, 'devotee') as [string, string]
    const boy = B(o, 'boy')
    const rokkit = B(o, 'rokkit-boy')
    const far = A(o, 'mindwitch')
    const shootWeapon = o.operatives[boy]!.weapons.find((w) => o.data.weapons[w]!.type === 'ranged')!
    // B's turn (a far-away cult operative activated and ended first)
    const bTurn = (s: GameState): GameState => take(activateOp(s, far), 'end').state
    const aimed = (s: GameState, who: string, weapon: string): GameState => {
      const u = take(activateOp(bTurn(s), who), 'shoot').state
      return take(take(u, weapon).state, dem).state
    }
    const stage = place(place(place(place(o, dem, 0, 0), dev, 2.5, 0), boy, -6, 0), rokkit, -6, 3)
    const w = aimed(stage, boy, shootWeapon)
    expect(w.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A' })
    expect(optionIds(w)).toContain(`cc.p.faithful-follower:${dev}`)
    // a Devotee 4" away is out of reach of the ploy; nothing else is eligible
    expect(optionIds(aimed(place(stage, dev, 4.5, 0), boy, shootWeapon)).filter((i) => i.startsWith('cc.p.faithful'))).toEqual([])
    const taken = take(w, `cc.p.faithful-follower:${dev}`).state
    expect(taken.attack!.targets[taken.attack!.index]).toBe(dev)
    expect(taken.players.A.cp).toBe(o.players.A.cp - 1)
    // no effect against a Blast weapon
    const blast = o.operatives[rokkit]!.weapons.find((x) => o.data.weapons[x]!.rules.some((r) => r.rule === 'blast'))
    if (blast) expect(optionIds(aimed(stage, rokkit, blast)).filter((i) => i.startsWith('cc.p.faithful'))).toEqual([])
    // in a Fight: the Devotee is fought instead though it is not in the fighter's control range
    const near = edit(place(place(place(o, dem, 0, 0), dev, 0, 2.8), boy, 1.4, 0), (st) => void (st.operatives[boy]!.order = 'engage'))
    const f = take(take(activateOp(bTurn(near), boy), 'fight').state, dem).state
    expect(f.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A' })
    expect(optionIds(f)).toContain(`cc.p.faithful-follower:${dev}`)
    const fought = take(f, `cc.p.faithful-follower:${dev}`).state
    expect(fought.attack!.fight!.targetId).toBe(dev)

    // ABHORRENT MUTATION: as a Devotee activates, give it a gift nobody has selected; a DARK COMMUNE operative is not offered
    const activated = take(take(o, dev).state, 'engage').state
    expect(activated.pending!.kind).toBe('ploy.firefight')
    expect(optionIds(activated).filter((i) => i.startsWith('cc.p.abhorrent-mutation:')).sort()).toEqual(['barbed', 'chitinous', 'deformed-wings', 'fleet', 'horned', 'sinewed'].map((g) => `cc.p.abhorrent-mutation:${g}`).sort())
    expect(optionIds(take(take(o, A(o, 'iconarch')).state, 'engage').state).some((i) => i.startsWith('cc.p.abhorrent-mutation'))).toBe(false)
    const horned = take(activated, 'cc.p.abhorrent-mutation:horned').state
    expect(giftsOf(horned, horned.operatives[dev]!)).toEqual(['horned'])
    expect(availableGifts(horned, 'A')).not.toContain('horned')
    // it keeps the gift through both changes of form, and is never offered the ploy again
    const grown = becomes(becomes(horned, dev, 'mutant'), dev, 'torment')
    expect(giftsOf(withGifts(grown, { primary: 'fleet', secondary: 'sinewed' }), grown.operatives[dev]!).sort()).toEqual(['fleet', 'horned', 'sinewed'])
    const nextTp = edit(horned, (st) => void (st.ledger.A.tp = []))
    const names = (id: string): (string | undefined)[] => offersFor(nextTp, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: id }).filter((x) => x.ployId === 'cc.p.abhorrent-mutation').map((x) => x.param)
    expect(names(dev)).toEqual([])
    expect(names(d2).length).toBe(5)
    expect(names(d2)).not.toContain('horned')
  })

  it('TEAM-CC-036 TEAM-CC-037 Frenzied Demise hurts a visible enemy within 2" as a Mutant (D3) or Torment (D6) dies, Unleash the Daemon gives a Mutant two Fights with one free', () => {
    const o = open()
    const [m] = ALL(o, 'devotee') as [string]
    const [boy1, boy2, boy3] = [B(o, 'boy'), B(o, 'grot'), B(o, 'slasha-boy')]
    const far = A(o, 'mindwitch')
    const stage = (card: 'mutant' | 'torment'): GameState => {
      const s = becomes(o, m, card)
      return edit(place(place(place(place(s, m, 0, 0), boy1, 1.4, 0), boy2, -3.8, 0), boy3, 0, -2.8), (st) => {
        st.operatives[m]!.wounds = 1
        for (const id of [boy1, boy2, boy3]) {
          st.operatives[id]!.wounds = 30
          st.operatives[id]!.maxWounds = 30
          st.operatives[id]!.order = 'engage'
        }
      })
    }
    const demise = (card: 'mutant' | 'torment', script: number[]) => {
      const rng = dice(...script)
      const s = take(activateOp(stage(card), far), 'end').state
      const t = take(take(activateOp(s, boy1, 'engage', rng), 'fight', rng).state, m, rng).state
      return playTo(t, rng, (st) => st.pending?.kind === 'ploy.firefight' && st.pending.window === 'operative.incapacitated')
    }
    const mutantDies = demise('mutant', [6, 6, 6, 6, 1, 1, 1, 1])
    expect(mutantDies.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A' })
    // before removal: the Mutant is still on the table, the enemy 3" away is not offered, the one within 2" is
    expect(mutantDies.operatives[m]!.status).toBe('active')
    const dIds = optionIds(mutantDies).filter((i) => i.startsWith('cc.p.frenzied-demise:'))
    expect(dIds).toEqual([`cc.p.frenzied-demise:${boy1}`, `cc.p.frenzied-demise:${boy3}`].sort())
    const rngM = dice(5)
    const after = take(mutantDies, `cc.p.frenzied-demise:${boy3}`, rngM).state
    expect(30 - after.operatives[boy3]!.wounds).toBe(3)
    const tormentDies = demise('torment', [6, 6, 6, 6, 1, 1, 1, 1, 1])
    expect(optionIds(tormentDies)).toContain(`cc.p.frenzied-demise:${boy3}`)
    expect(30 - take(tormentDies, `cc.p.frenzied-demise:${boy3}`, dice(5)).state.operatives[boy3]!.wounds).toBe(5)
    // UNLEASH THE DAEMON: two Fights, the first free; at APL 2 one more 1 AP action is left
    const s = edit(place(place(becomes(o, m, 'mutant'), m, 0, 0), boy1, 1.4, 0), (st) => {
      st.operatives[boy1]!.wounds = 30
      st.operatives[boy1]!.maxWounds = 30
      st.operatives[m]!.order = 'engage'
    })
    const start = take(take(s, m).state, 'engage').state
    expect(optionIds(start)).toContain('cc.p.unleash-the-daemon')
    expect(optionIds(take(take(s, ALL(o, 'devotee')[1]!).state, 'engage').state)).not.toContain('cc.p.unleash-the-daemon')
    let u = take(start, 'cc.p.unleash-the-daemon').state
    // the window carries on (Abhorrent Mutation is still on offer); decline it
    if (u.pending!.kind === 'ploy.firefight') u = passIt(u).state
    const cost = (st: GameState) => st.pending!.options!.find((x) => x.id === 'fight')?.data?.cost
    expect(cost(u)).toBe(0)
    const ready = (st: GameState): GameState => play(st, dice(), strikes, ['firefight.action', 'firefight.activate']).state
    u = ready(take(take(u, 'fight', dice()).state, boy1, dice()).state)
    expect(u.firefight.activation!.apSpent).toBe(0)
    expect(cost(u)).toBe(1)
    const second = play(take(take(u, 'fight', dice()).state, boy1, dice()).state, dice(), strikes, ['firefight.action', 'firefight.activate'])
    expect(second.events.filter((e) => e.type === 'ApSpent')).toEqual([expect.objectContaining({ amount: 1, total: 1 })])
    // two Fights is the limit, and in an enemy's control range nothing else is left: the activation ends with 1 AP unspent
    expect(second.state.firefight.activation).toBeNull()
    expect(second.state.operatives[m]!.ready).toBe(false)
  })

  it('TEAM-CC-038 TEAM-CC-039 TEAM-CC-040 the equipment: Baleful Script, Covert Guises, Unholy Talisman and Vile Blessing', () => {
    const baleful = (s: GameState) => offersFor(s, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).filter((o) => o.ployId === 'cc.p.baleful-script')
    // BALEFUL SCRIPT: not offered before a gift exists; then it replaces a gift, once per battle
    const g0 = toGambit({ equipmentA: ['cc.e.baleful-script'] })
    expect(baleful(g0)).toEqual([])
    const [d1, d2] = ALL(g0, 'devotee') as [string, string]
    const withGift = withGifts(edit(becomes(becomes(g0, d1, 'mutant'), d2, 'mutant'), (st) => void (st.ledger.A.tp = [])), { primary: 'chitinous', ops: { [d2]: ['horned'] } })
    const params = baleful(withGift).map((o) => o.param)
    expect(params).toContain('primary>fleet')
    expect(params).toContain(`op:${d2}:horned>barbed`)
    expect(params).not.toContain('primary>chitinous')
    expect(params).not.toContain('primary>horned')
    expect(withGift.operatives[d1]!.save).toBe(4)
    // the team's primary gift changes for every Mutant: Chitinous is gone, so their Save is 5+ again
    const swapped = usePlayed(withGift, 'cc.p.baleful-script', {}, 'primary>fleet')
    expect([primaryGift(swapped, 'A'), swapped.operatives[d1]!.save, swapped.operatives[d2]!.save]).toEqual(['fleet', 5, 5])
    expect(giftsOf(swapped, swapped.operatives[d1]!)).toEqual(['fleet'])
    expect(availableGifts(swapped, 'A')).not.toContain('chitinous')
    expect(baleful(edit(swapped, (st) => void (st.ledger.A.tp = [])))).toEqual([])
    // one operative's own gift changes for that operative only
    const own = usePlayed(withGift, 'cc.p.baleful-script', {}, `op:${d2}:horned>barbed`)
    expect(giftsOf(own, own.operatives[d2]!).sort()).toEqual(['barbed', 'chitinous'])
    expect(giftsOf(own, own.operatives[d1]!)).toEqual(['chitinous'])

    // COVERT GUISES: a D3 is rolled, that many Devotees wholly in the drop zone may Reposition, ending wholly within 3" of it
    // the D3 is rolled as the equipment is revealed (the game's set-up), before any operative is deployed, and shown
    // to both players; a cult without the equipment rolls nothing
    const created = createGame(realSetupWith({ teams: ['chaos-cult', 'kommandos'], equipmentA: ['cc.e.covert-guises'] }), 'cc-guises', realBundle)
    expect(created.state.ledger.A.uses['cc.guises']).toBeGreaterThanOrEqual(1)
    expect(created.state.ledger.A.uses['cc.guises']).toBeLessThanOrEqual(3)
    expect(created.events.some((e) => e.type === 'AbilityUsed' && e.abilityId === 'cc.e.covert-guises' && e.seat === null)).toBe(true)
    expect(createGame(realSetupWith({ teams: ['chaos-cult', 'kommandos'] }), 'cc-guises', realBundle).state.ledger.A.uses['cc.guises']).toBeUndefined()
    const g = toGambit({ equipmentA: ['cc.e.covert-guises'] })
    const rolled = g.ledger.A.uses['cc.guises']!
    expect([1, 2, 3]).toContain(rolled)
    expect(offersFor(g, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'cc.p.covert-guises')).toBe(true)
    expect(offersFor(edit(g, (st) => void (st.turningPoint = 2)), 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'cc.p.covert-guises')).toBe(false)
    const zone = g.map.dropZones.find((z) => z.id === g.players.A.dropZoneId)!
    // the zone runs along a short edge: its inner edge is the one nearest the middle of the board
    const xs = zone.polygon.map((p) => p.x)
    const west = (Math.min(...xs) + Math.max(...xs)) / 2 < 0
    const edge = west ? Math.max(...xs) : Math.min(...xs)
    const out = (d: number): number => (west ? edge + d : edge - d)
    const guiser = ALL(g, 'devotee')[0]!
    const placed = place(g, guiser, out(-1.5), 0)
    let c = take(placed, 'cc.p.covert-guises').state
    expect(c.pending!.context).toMatchObject({ hook: 'ccCovertGuises', left: rolled })
    c = take(c, guiser).state
    expect(c.pending!.kind).toBe('move.path')
    // 4.2" outside the drop zone is refused, 2" outside is fine
    expect(step(c, act.path(c.pending!, [{ x: out(4.2), z: 0 }])).rejection).toBeDefined()
    const moved = step(c, act.path(c.pending!, [{ x: out(2), z: 0 }]))
    expect(moved.rejection).toBeUndefined()
    expect(moved.state.operatives[guiser]!.pos.x).toBeCloseTo(out(2))

    // UNHOLY TALISMAN: one normal defence success counts as a crit, once per turning point
    const t0 = open({ equipmentA: ['cc.e.unholy-talisman', 'cc.e.vile-blessing'] })
    const dem = A(t0, 'demagogue')
    const boy = B(t0, 'boy')
    const weapon = t0.operatives[boy]!.weapons.find((w) => t0.data.weapons[w]!.type === 'ranged')!
    const atk = t0.data.weapons[weapon]!.atk
    const shot = edit(place(place(t0, dem, 0, 0), boy, -5, 0), (st) => void (st.operatives[boy]!.order = 'engage'))
    const rng = dice(...Array<number>(atk).fill(6), 5, 1, 1)
    const aim = take(take(take(activateOp(take(activateOp(shot, A(t0, 'mindwitch')), 'end').state, boy, 'engage', rng), 'shoot', rng).state, weapon, rng).state, dem, rng).state
    const tal = playTo(aim, rng, (st) => st.pending?.kind === 'ploy.firefight' && st.pending.window === 'shoot.defenceRolled' && st.pending.seat === 'A')
    expect(optionIds(tal)).toContain('cc.e.unholy-talisman')
    expect(tal.attack!.seq!.def!.dice.map((d) => d.kind).sort()).toEqual(['fail', 'fail', 'normal'])
    // the lone normal success could not block a crit, the crit it becomes can
    const blocked = (r: ReturnType<typeof take>) => r.events.find((e) => e.type === 'DiceBlocked')
    const used1 = take(tal, 'cc.e.unholy-talisman', rng)
    expect(blocked(used1)).toMatchObject({ blockedCrit: 1 })
    expect(used1.state.ledger.A.tp).toContain('cc.e.unholy-talisman')
    expect(blocked(passIt(tal, rng))).toMatchObject({ blockedCrit: 0 })
    // VILE BLESSING: the first Normal Dmg die that would incapacitate a non-Devotee is ignored, once per battle
    const lethal = edit(t0, (st) => void (st.operatives[dem]!.wounds = 3))
    const first = hurt(lethal, dem, boy, 4, 'normal')
    expect(first.dealt).toBe(0)
    expect(first.state.operatives[dem]!.wounds).toBe(3)
    expect(first.state.ledger.A.battle).toContain('cc.e.vile-blessing')
    expect(hurt(first.state, dem, boy, 4, 'normal').dealt).toBe(4)
    // never on a crit, a Devastating die, a die that would not incapacitate, or a Devotee
    expect(hurt(lethal, dem, boy, 4, 'crit').dealt).toBe(4)
    expect(hurt(lethal, dem, boy, 4, 'devastating').dealt).toBe(4)
    expect(hurt(edit(t0, (st) => void (st.operatives[dem]!.wounds = 8)), dem, boy, 3, 'normal').dealt).toBe(3)
    const dv = edit(t0, (st) => void (st.operatives[d1]!.wounds = 2))
    expect(hurt(dv, d1, boy, 3, 'normal').state.operatives[d1]!.wounds).toBe(0)
    // a Mutant uses it instead of the Regeneration roll: no die is rolled
    const mu = edit(becomes(t0, d1, 'mutant'), (st) => void (st.operatives[d1]!.wounds = 2))
    const none = dice()
    const before = none.remaining
    expect(hurt(mu, d1, boy, 3, 'normal', none).dealt).toBe(0)
    expect(none.remaining).toBe(before)
  })

})
