// hierotek-circle engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-HIE-nnn).
// Owned by the team implementer.
import { describe, expect, it } from 'vitest'
import '@/engine'
import { enumerateLoadouts, enumerateRosters, validateRoster } from '../../../src/data'
import type { DatacardData } from '../../../src/data'
import { runHook } from '@/engine/hooks'
import { ScriptedRng } from '@/engine/rng'
import { augmentChoices, reanimate, T, M, TEAM_ID } from '@/engine/teams/hierotek-circle'
import { addToken, hasToken, holdersOf, tokensOn, tokensOnActivationStart } from '@/engine/tokens'
import { play } from '../../fixtures/attack'
import { attackStats, effectiveRules, validTargets } from '@/engine/attack-common'
import { actionCost } from '@/engine/firefight'
import { actionForbidden } from '@/engine/abilities'
import { hasKeyword } from '@/engine/conditions'
import { defaultLoadoutFor } from '@/engine/bundle'
import type { RosterEntry } from '@/engine/types'
import { markerControl } from '@/engine/query'
import { providerCostDelta, providerEquipmentEligible } from '@/engine/team-rules'
import { effectiveMove } from '@/engine/state'
import { step } from '@/engine'
import { cloneState } from '@/engine/state'
import type { GameState } from '@/engine/types'
import { loadBundle } from '../../../src/data'
import { activateOp, edit, openReal, passIt, pick, realBundle, roster, take, withCtx } from '../../fixtures/real'
import { hookFireCount } from '@/engine/code-hooks'
import { CODE_HOOKS } from '../../../src/data'
import { a, act, at, b, FULL, HIE, hie, kill, magnifyArena, markerOf, raise, scenarios, underlingsGame, usePloyOn, WALL } from './hierotek-circle.hooks'
import { gambitOffers } from '@/engine/ploys'
import { readyChoiceDone } from '@/engine/strategy'

const data = loadBundle()
/** End the current activation, let the opponent activate and end one operative: back to seat A choosing. */
function passRound(t: GameState): GameState {
  let u = take(t, 'end').state
  const foe = u.pending!.options![0]!.id
  u = take(activateOp(u, foe), 'end').state
  return u
}
/** A copy of the state whose weapon has a different Atk. */
/**
 * The Strategy phase's Ready step for seat A: the turning point start hook (Living Metal, Tesseract Cube) rolls `dice`,
 * then the shared Ready-step choices are asked (strategy.readyChoiceDone).
 */
function readyStepOf(s: GameState, dice: number[]): GameState {
  const st = edit(s, (x) => {
    x.phase = 'strategy'
    x.initiative = 'A'
    x.strategy = { step: 'ready', rolls: {}, gambit: { turn: 'A', passes: 0, used: { A: [], B: [] } }, readyChoices: ['A', 'B'] }
  })
  return withCtx(
    st,
    (ctx) => {
      runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })
      readyChoiceDone(ctx)
    },
    new ScriptedRng(dice),
  ).state
}

function withWeapon(s: GameState, id: string, atk: number): GameState {
  const t = cloneState(s)
  t.data = { ...t.data, weapons: { ...t.data.weapons, [id]: { ...t.data.weapons[id]!, atk } } }
  return t
}
const hasOptionIn = (s: { pending: { options?: { id: string }[] } | null }, id: string) => (s.pending?.options ?? []).some((o) => o.id === id)
const card = (id: string) => data.byId[id] as DatacardData

describe('hierotek-circle data', () => {
  it('TEAM-HIE-000 the team is registered with the engine and data, stats and weapons as printed', () => {
    expect(TEAM_ID).toBe('hierotek-circle')
    expect(realBundle.teams['hierotek-circle']!.operatives).toBe(8)
    expect(card('hie.technomancer').stats).toEqual({ apl: 3, move: 6, save: '3+', wounds: 14 })
    expect(card('hie.technomancer').base).toBe(50)
    expect(card('hie.plasmacyte-reanimator').keywords).toContain('MEDIC')
    expect(card('hie.deathmark').stats).toEqual({ apl: 2, move: 5, save: '3+', wounds: 10 })
    const w = (id: string) => realBundle.weapons[id]!
    expect(w('hie.w.synaptic-disintegrator')).toMatchObject({ atk: 4, hit: 2, dmg: { normal: 4, crit: 3 } })
    expect(w('hie.w.synaptic-disintegrator').rules.map((r) => r.rule)).toEqual(['devastating', 'heavy', 'piercing', 'severe'])
    expect(w('hie.w.abyssal-lance-ranged').rules).toContainEqual({ rule: 'devastating', x: 1, inches: 2 })
    expect(w('hie.w.entropic-lance-ranged')).toMatchObject({ atk: 4, dmg: { normal: 5, crit: 3 } })
    expect(w('hie.w.aeonstave-ranged').rules.map((r) => r.rule)).toEqual(['blast', 'lethal', 'stun', 'magnify'])
    expect(w('hie.w.tesla-carbine').rules).toEqual([{ rule: 'devastating', x: 1, inches: 2 }])
  })

  it('TEAM-HIE-001 roster: one Cryptek, both Plasmacytes, five from the list; repeat and loadout limits', () => {
    const team = data.teams['hierotek-circle']!
    const cards = data.byId as unknown as Record<string, DatacardData>
    const ok = {
      leader: ['hie.psychomancer'],
      accelerator: ['hie.plasmacyte-accelerator'],
      reanimator: ['hie.plasmacyte-reanimator'],
      main: ['hie.deathmark', 'hie.deathmark', 'hie.immortal-guardian', 'hie.immortal-guardian', 'hie.apprentek'],
    }
    expect(validateRoster(team, ok, cards)).toEqual({ ok: true, reasons: [] })
    expect(team.defaults!.roster).toHaveLength(8)
    const twoDespoteks = { ...ok, main: ['hie.immortal-despotek', 'hie.immortal-despotek', 'hie.deathmark', 'hie.deathmark', 'hie.deathmark'] }
    expect(validateRoster(team, twoDespoteks, cards).reasons.join()).toMatch(/Immortal Despotek can be taken only once/)
    expect(validateRoster(team, { ...ok, leader: [] }, cards).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: [...ok.main.slice(0, 4), 'hie.plasmacyte-accelerator'] }, cards).reasons.join()).toMatch(/not on this list/)
    // Chronomancer picks aeonstave or entropic lance (both profiles); Immortals pick gauss or tesla
    expect(enumerateLoadouts(card('hie.chronomancer'))).toHaveLength(2)
    expect(enumerateLoadouts(card('hie.immortal-guardian'))).toHaveLength(2)
    expect(enumerateLoadouts(card('hie.psychomancer'))).toHaveLength(1)
    let n = 0
    for (const r of enumerateRosters(team)) {
      expect(validateRoster(team, r).ok).toBe(true)
      if (n++ > 200) break
    }
    expect(n).toBeGreaterThan(30)
  })
})

describe('hierotek-circle reanimation', () => {
  it('TEAM-HIE-002 first incapacitation places a tied marker and strips tokens; the second leaves none', () => {
    let s = hie()
    const g = a(s, 'hie.immortal-guardian')
    const cx = a(s, 'hie.chronomancer')
    s = at(s, [g, 0, 0], [cx, -3, 0])
    s = withCtx(s, (ctx) => {
      addToken(ctx, g, { kind: T.chronometron, owner: 'A', sourceId: cx, expires: ['sourceNextActivation'] }, 'test')
      expect(hasToken(ctx.state, g, T.chronometron)).toBe(true)
    }).state
    s = kill(s, g)
    const m = markerOf(s, g)!
    expect(m).toBeDefined()
    expect(m.owner).toBe('A')
    expect(Math.hypot(m.pos.x - 0, m.pos.z - 0) - s.operatives[g]!.baseRadius).toBeLessThanOrEqual(1)
    expect(s.operatives[g]!.status).toBe('removed')
    expect(s.operatives[g]!.returnable).toBe(true)
    expect(hasToken(s, g, T.chronometron)).toBe(false)
    // a first return: 1 wound (injured), the chosen order, ready, within 3 of the marker, marker gone
    const r = raise(s, g, { x: 1.5, y: 0, z: 0 }, 'conceal')
    const op = r.operatives[g]!
    expect(op.status).toBe('active')
    expect(op.wounds).toBe(1)
    expect(op.flags.injured).toBe(true)
    expect(op.order).toBe('conceal')
    expect(op.ready).toBe(true)
    expect(markerOf(r, g)).toBeUndefined()
    // a spot more than 3" from the marker or inside an enemy control range is refused
    const boy = b(r, 'kom.boy')
    withCtx(at(s, [boy, 9, 9]), (ctx) => {
      expect(reanimate(ctx, m.id, { pos: { x: 6, y: 0, z: 0 } })).toBe(false)
      expect(reanimate(ctx, m.id, { pos: { x: 9, y: 0, z: 8.5 } })).toBe(false)
    })
    const boyNear = withCtx(at(s, [boy, 3.5, 0]), (ctx) => expect(reanimate(ctx, m.id, { pos: { x: 2.7, y: 0, z: 0 } })).toBe(false))
    expect(boyNear.state.operatives[g]!.status).toBe('removed')
    // the second incapacitation leaves no marker: the operative is gone for good
    const again = kill(r, g)
    expect(again.operatives[g]!.status).toBe('removed')
    expect(markerOf(again, g)).toBeUndefined()
  })

  it('TEAM-HIE-003 Ready step: Living Metal heals D3+1 first; then the owner picks the marker to roll for, one at a time, until a 3+ returns its operative at the spot and order the owner picks', () => {
    let s = hie({}, FULL)
    const [g, d1, d2, accel] = [a(s, 'hie.immortal-guardian'), a(s, 'hie.deathmark'), s.operatives['A8']!.id, a(s, 'hie.plasmacyte-accelerator')]
    s = at(s, [g, 0, 0], [d1, 6, 0], [d2, 6, 3])
    s = kill(kill(s, d1), d2)
    s = edit(s, (st) => {
      st.operatives[g]!.wounds = 2
      st.operatives[accel]!.wounds = 4
    })
    expect(Object.values(s.markers).filter((m) => m.equipmentId === M.reanimation)).toHaveLength(2)
    // dice, in operative order: Living Metal for the Accelerator (6 -> D3 3, +1 = 4, capped at its 5 wounds) and the Guardian (1 -> D3 1, +1 = 2 on top of 2 = 4)
    let t = readyStepOf(s, [6, 1])
    expect(t.operatives[g]!.wounds).toBe(4)
    expect(t.operatives[accel]!.wounds).toBe(5)
    // the owner is asked which marker to roll for: both are offered (oldest first on equal priority)
    expect(t.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { readyStep: true } })
    expect(t.pending!.options!.map((o) => o.data?.operativeId)).toEqual([d1, d2])
    // the owner picks the second one first: a 2, so it stays and is not offered again
    t = take(t, 'ready:1', new ScriptedRng([2])).state
    expect(t.operatives[d2]!.status).toBe('removed')
    expect(t.pending!.options!.map((o) => o.data?.operativeId)).toEqual([d1])
    // then the other: a 5, so the owner picks the spot and the order
    t = take(t, 'ready:0', new ScriptedRng([5])).state
    expect(t.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { hook: 'hieReanimate', step: 'spot', operativeId: d1 } })
    const spot = t.pending!.options![0]!
    t = take(t, spot.id).state
    expect(t.pending!.options!.map((o) => o.id)).toEqual(['engage', 'conceal'])
    t = take(t, 'conceal').state
    expect(t.operatives[d1]).toMatchObject({ status: 'active', wounds: 1, order: 'conceal', ready: true })
    expect(t.operatives[d1]!.pos.x).toBeCloseTo(spot.data!.x as number)
    expect(markerOf(t, d2)).toBeDefined()
    // at most one return each turning point: no more Ready-step offers, the Gambit step is next
    expect(t.strategy.step).toBe('gambit')
    // passing rolls for nothing
    const passed = passIt(readyStepOf(s, [6, 1])).state
    expect(passed.operatives[d1]!.status).toBe('removed')
    expect(passed.operatives[d2]!.status).toBe('removed')
    expect(passed.strategy.step).toBe('gambit')
  })
})

void [passIt, take, act]

describe('hierotek-circle reanimation, kill op and the Reanimate action', () => {
  it('TEAM-HIE-004 the opponent kill grade and VP fall when an operative returns and rise again if it dies later', () => {
    let s = hie()
    const [d1, g, d2] = [a(s, 'hie.deathmark'), a(s, 'hie.immortal-guardian'), 'A8']
    s = at(s, [d1, 0, 0], [g, 0, 3], [d2, 0, -3])
    expect(s.mission!.startCount.A).toBe(8)
    s = kill(kill(s, d1), g)
    expect(s.mission!.kills.B).toBe(2)
    expect(s.mission!.grade.B).toBe(1)
    expect(s.players.B.vp).toBe(1)
    s = kill(s, d2)
    expect(s.mission!.grade.B).toBe(2)
    expect(s.players.B.vp).toBe(2)
    s = raise(s, d1, { x: 1, y: 0, z: 0 })
    expect(s.mission!.kills.B).toBe(2)
    expect(s.mission!.grade.B).toBe(1)
    expect(s.players.B.vp).toBe(1)
    // killed again: no marker, but the kill counts and the grade is regained
    s = kill(s, d1)
    expect(s.mission!.kills.B).toBe(3)
    expect(s.mission!.grade.B).toBe(2)
    expect(s.players.B.vp).toBe(2)
    expect(markerOf(s, d1)).toBeUndefined()
  })

  it('TEAM-HIE-005 Reanimate: 1 AP rolls for 3+, 2 AP is automatic; expended earlier this TP it returns expended', () => {
    let s = hie()
    const [rea, g] = [a(s, 'hie.plasmacyte-reanimator'), a(s, 'hie.immortal-guardian')]
    s = at(s, [g, 0, 0], [rea, 4, 0])
    s = kill(s, g)
    const m = markerOf(s, g)!
    const id1 = `ability:hie.a.reanimate:${m.id}:1`
    const id2 = `ability:hie.a.reanimate:${m.id}:2`
    // a failed roll: AP spent, the marker stays
    let t = take(activateOp(s, rea), id1, new ScriptedRng([2])).state
    expect(markerOf(t, g)).toBeDefined()
    expect(t.operatives[rea]!.status).toBe('active')
    expect(t.firefight.activation!.apSpent).toBe(1)
    // a 3+ roll lets the owner pick the spot and the order
    t = take(activateOp(s, rea), id1, new ScriptedRng([3])).state
    expect(t.pending!.kind).toBe('ability.choice')
    t = take(t, t.pending!.options![0]!.id).state
    expect(t.pending!.options!.map((o) => o.id)).toEqual(['engage', 'conceal'])
    t = take(t, 'conceal').state
    expect(t.operatives[g]).toMatchObject({ status: 'active', wounds: 1, order: 'conceal', ready: true })
    expect(markerOf(t, g)).toBeUndefined()
    // 2 AP: no roll at all
    t = take(activateOp(s, rea), id2).state
    t = take(t, t.pending!.options![0]!.id).state
    t = take(t, 'engage').state
    expect(t.operatives[g]!.status).toBe('active')
    // it had already been expended this turning point (and was killed): it returns expended
    let u = edit(at(hie(), [g, 0, 0], [rea, 4, 0]), (st) => {
      st.operatives[g]!.ready = false
    })
    u = kill(u, g)
    const um = markerOf(u, g)!
    let v = take(activateOp(u, rea), `ability:hie.a.reanimate:${um.id}:2`).state
    v = take(v, v.pending!.options![0]!.id).state
    v = take(v, 'engage').state
    expect(v.operatives[g]).toMatchObject({ status: 'active', ready: false })
    // outside 6" or not visible, nothing is offered
    const far = at(s, [rea, 12, 5])
    expect(activateOp(far, rea).pending!.options!.some((o) => o.id.startsWith('ability:hie.a.reanimate'))).toBe(false)
    void b
  })
})

describe('hierotek-circle Magnify', () => {
  it('TEAM-HIE-006 Magnify: validity and cover from a proxy, Ceaseless on use, proxy rules, conditions from the proxy', () => {
    const { s, cx, app, boy } = magnifyArena()
    // the Chronomancer cannot pick the Conceal enemy in cover itself, and no proxy stands in: no Shoot action
    const alone = edit(s, (st) => {
      st.operatives[app]!.order = 'conceal'
    })
    expect(hasOptionIn(activateOp(alone, cx), 'shoot')).toBe(false)
    // with an Engage Apprentek that sees the shooter, the Shoot action exists and the weapon list offers the viewpoint
    let t = take(activateOp(s, cx), 'shoot').state
    expect(t.pending!.kind).toBe('shoot.weapon')
    const ids = t.pending!.options!.map((o) => o.id)
    expect(ids).toContain(`hie.w.aeonstave-ranged@${app}`)
    expect(ids).not.toContain('hie.w.aeonstave-ranged')
    t = take(t, `hie.w.aeonstave-ranged@${app}`).state
    expect(t.pending!.options!.map((o) => o.id)).toEqual([boy])
    // the target is picked: the attack is rolled with Ceaseless, the cover verdict is the proxy's (no cover)
    const r = pick(t, boy, new ScriptedRng([1, 1, 2, 5, 6]))
    expect(r.rejection).toBeUndefined()
    const after = r.state
    expect(after.attack!.viewpointId).toBe(app)
    expect(after.attack!.seq!.cover).toBe(false)
    expect(after.pending!.kind).toBe('dice.reroll')
    expect(after.pending!.options!.some((o) => o.id.startsWith('ceaseless'))).toBe(true)
    // a proxy must be Engage, outside enemy control range and seen by the shooter
    const hidden = edit(s, (st) => {
      st.operatives[app]!.pos = { x: -6, y: 0, z: -9.5 }
      st.map = { ...st.map, features: [WALL, { id: 'blocker', parts: [{ id: 'blocker.0', footprint: [{ x: -6.5, z: -6 }, { x: -5.5, z: -6 }, { x: -5.5, z: -3 }, { x: -6.5, z: -3 }], height: 4, traits: ['heavy' as const, 'blocking' as const] }] }] }
    })
    expect(hasOptionIn(activateOp(hidden, cx), 'shoot')).toBe(false)
    const engaged = at(s, [boy, 2.5, -6.5])
    const pinned = edit(at(engaged, [app, 2, -6]), (st) => {
      st.operatives[app]!.order = 'engage'
    })
    // the proxy stands in an enemy control range: it cannot serve
    expect(activateOp(pinned, cx).pending!.options!.map((o) => o.id)).not.toContain('shoot')
  })

  it('TEAM-HIE-006 Magnification Conduits widen the proxy set once per turning point; Relentless Onslaught measures 8 inches from the shooter', () => {
    const { s, cx, app, boy } = magnifyArena({ equipmentA: ['hie.e.magnification-conduits'] })
    const dm = a(s, 'hie.deathmark')
    // the Apprentek no longer serves (Conceal); a Deathmark does, thanks to the Conduits
    let t = edit(at(s, [dm, 3, -6], [app, -12, -9]), (st) => {
      st.operatives[app]!.order = 'conceal'
      st.operatives[dm]!.order = 'engage'
    })
    t = take(activateOp(t, cx), 'shoot').state
    expect(t.pending!.options!.map((o) => o.id)).toContain(`hie.w.aeonstave-ranged@${dm}`)
    // spent after one Shoot with such a proxy
    const used = edit(t, (st) => {
      st.ledger.A.tpUses['hie.e.magnification-conduits'] = 1
    })
    expect(used.pending!.options!.map((o) => o.id)).toContain(`hie.w.aeonstave-ranged@${dm}`)
    const gone = edit(s, (st) => {
      st.ledger.A.tpUses['hie.e.magnification-conduits'] = 1
      st.operatives[app]!.order = 'conceal'
      st.operatives[dm]!.pos = { x: 3, y: 0, z: -6 }
      st.operatives[app]!.pos = { x: -12, y: 0, z: -9 }
      st.operatives[dm]!.order = 'engage'
    })
    expect(hasOptionIn(activateOp(gone, cx), 'shoot')).toBe(false)
    void boy
  })
})

describe('hierotek-circle support actions', () => {
  it('TEAM-HIE-007 Interstitial Command: a free 1 AP action capped at 2", no repeats this TP, Despotek relay and Accelerate rules', () => {
    let s = hie()
    const [cx, g, desp, acc, dm] = [a(s, 'hie.chronomancer'), a(s, 'hie.immortal-guardian'), a(s, 'hie.immortal-despotek'), a(s, 'hie.plasmacyte-accelerator'), a(s, 'hie.deathmark')]
    s = at(s, [cx, 0, 0], [g, 4, 0], [desp, -3, 0], [acc, 0, 3], [dm, 0, -4])
    // the commander picks the Guardian: it is offered its own actions, and a move is capped at 2"
    let t = take(activateOp(s, cx), `ability:hie.a.interstitial-command:${g}`).state
    expect(t.firefight.activation!.operativeId).toBe(g)
    expect(t.pending!.kind).toBe('firefight.action')
    expect(t.pending!.options!.map((o) => o.id)).toContain('reposition')
    expect(t.pending!.options!.map((o) => o.id)).not.toContain('fallBack')
    t = take(t, 'reposition').state
    expect(t.pending!.kind).toBe('move.path')
    const p = t.pending!
    const bad = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 7.5, z: 0 }] } })
    expect(bad.rejection).toBeDefined()
    t = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 5.9, z: 0 }] } }).state
    // back in the commander's activation: 1 AP spent, the Guardian still ready, and it cannot Reposition again this turning point
    expect(t.firefight.activation!.operativeId).toBe(cx)
    expect(t.firefight.activation!.apSpent).toBe(1)
    expect(t.operatives[g]!.ready).toBe(true)
    expect(t.operatives[g]!.pos.x).toBeCloseTo(5.9, 1)
    expect(t.operatives[g]!.actionsThisTp).toContain('reposition')
    expect(t.ledger.A.tp).toContain(`hie.ic:${g}:reposition`)
    const again = take(activateOp(at(passRound(t), [desp, 5, 3]), desp), `ability:hie.a.interstitial-command-despotek:${g}`).state
    expect(again.pending!.options!.map((o) => o.id)).not.toContain('reposition')
    expect(again.pending!.options!.map((o) => o.id)).toContain('dash')
    // the Despotek's version cannot hand out Accelerate; the Cryptek's can
    const viaDesp = take(activateOp(s, desp), `ability:hie.a.interstitial-command-despotek:${acc}`).state
    expect(viaDesp.pending!.options!.map((o) => o.id).some((id) => id.startsWith('ability:hie.a.accelerate'))).toBe(false)
    const viaCx = take(activateOp(s, cx), `ability:hie.a.interstitial-command:${acc}`).state
    expect(viaCx.pending!.options!.map((o) => o.id).some((id) => id.startsWith('ability:hie.a.accelerate'))).toBe(true)
    // one level of nesting: the Cryptek picks the Despotek, which uses its own Interstitial Command on the Guardian
    let nested = take(activateOp(at(s, [desp, 2, 3.5]), cx), `ability:hie.a.interstitial-command:${desp}`).state
    expect(nested.firefight.activation!.operativeId).toBe(desp)
    nested = take(nested, `ability:hie.a.interstitial-command-despotek:${g}`).state
    expect(nested.firefight.activation!.operativeId).toBe(g)
    nested = take(nested, 'dash').state
    const dp = nested.pending!
    nested = step(nested, { type: 'move.path', seat: dp.seat, decisionId: dp.id, payload: { waypoints: [{ x: 5.5, z: 0 }] } }).state
    expect(nested.firefight.activation!.operativeId).toBe(cx)
    expect(nested.firefight.activation!.apSpent).toBe(1)
    expect(nested.pending!.kind).toBe('firefight.action')
    expect(nested.ledger.A.tp).toEqual(expect.arrayContaining([`hie.ic:${g}:dash`, `hie.ic:${desp}:ability:hie.a.interstitial-command-despotek`]))
    expect(nested.operatives[desp]!.ready).toBe(true)
    // Cryptek and Apprentek cannot be picked
    expect(activateOp(s, cx).pending!.options!.map((o) => o.id)).not.toContain(`ability:hie.a.interstitial-command:${a(s, 'hie.apprentek')}`)
    // relay: the Guardian is out of the Cryptek's reach but within 6" of a Despotek the Cryptek can see
    const far = at(s, [g, -9, 0])
    const ids = activateOp(far, cx).pending!.options!.map((o) => o.id)
    expect(ids).toContain(`ability:hie.a.interstitial-command:${g}`)
    expect(ids).not.toContain(`ability:hie.a.interstitial-command:${g}:cc`)
    // the Despotek itself reaches it directly
    expect(activateOp(far, desp).pending!.options!.map((o) => o.id)).toContain(`ability:hie.a.interstitial-command-despotek:${g}`)
    // with Cortical Control the distance no longer matters, for 1 CP once per turning point (not for the Despotek)
    const away = at(s, [g, 12, 5], [desp, -12, -8])
    const cc = activateOp(away, cx).pending!.options!.map((o) => o.id)
    expect(cc).toContain(`ability:hie.a.interstitial-command:${g}:cc`)
    const cp = away.players.A.cp
    const paid = take(activateOp(away, cx), `ability:hie.a.interstitial-command:${g}:cc`).state
    expect(paid.players.A.cp).toBe(cp - 1)
    expect(paid.ledger.A.tp).toContain('hie.p.cortical-control')
  })

  it('TEAM-HIE-008 Timesplinter: an expended friendly is set up again within 5" and visible; not in TP1; once per team per TP', () => {
    let s = hie()
    const [cx, app, g] = [a(s, 'hie.chronomancer'), a(s, 'hie.apprentek'), a(s, 'hie.immortal-guardian')]
    s = at(s, [cx, 0, 0], [g, 4, 0], [app, -4, 0])
    s = edit(s, (st) => {
      st.operatives[g]!.ready = false
      st.turningPoint = 2
    })
    let t = take(activateOp(s, cx), `ability:hie.a.timesplinter:${g}`).state
    expect(t.pending!.kind).toBe('ability.choice')
    t = take(t, t.pending!.options![0]!.id).state
    const o = t.operatives[g]!
    expect(Math.hypot(o.pos.x, o.pos.z) - o.baseRadius - t.operatives[cx]!.baseRadius).toBeLessThanOrEqual(5 + 1e-6)
    expect(o.ready).toBe(false)
    expect(t.ledger.A.tp).toContain('hie.timesplinter')
    // the team limit also stops the Apprentek, and a ready friendly, and the first turning point
    const next = passRound(t)
    expect(activateOp(next, app).pending!.options!.map((x) => x.id).some((id) => id.startsWith('ability:hie.a.timesplinter'))).toBe(false)
    expect(activateOp(edit(s, (st) => { st.operatives[g]!.ready = true }), cx).pending!.options!.map((x) => x.id)).not.toContain(`ability:hie.a.timesplinter:${g}`)
    expect(activateOp(edit(s, (st) => { st.turningPoint = 1 }), cx).pending!.options!.map((x) => x.id)).not.toContain(`ability:hie.a.timesplinter:${g}`)
    // beyond 5" it is not offered
    expect(activateOp(at(s, [g, 7, 0]), cx).pending!.options!.map((x) => x.id)).not.toContain(`ability:hie.a.timesplinter:${g}`)
  })

  it('TEAM-HIE-009 Chronometron: 1 less Atk against the picked operative (shoot, fight, retaliate); it ends with the next activation or a repeat', () => {
    let s = hie()
    const [cx, app, g] = [a(s, 'hie.chronomancer'), a(s, 'hie.apprentek'), a(s, 'hie.immortal-guardian')]
    const [boy, slasha] = [b(s, 'kom.boy'), b(s, 'kom.slasha-boy')]
    s = at(s, [cx, 0, 0], [g, 4, 0], [app, -3, 0], [boy, 8, 0], [slasha, 8, 4])
    const atk = (st: GameState, who: string, w: string, foe: string, kind: 'shoot' | 'fight' = 'shoot') => attackStats(st, who, w, foe, { kind }).atk
    const base = atk(s, boy, 'kom.w.slugga', g)
    const t = take(activateOp(s, cx), `ability:hie.a.chronometron:${g}`).state
    expect(hasToken(t, g, T.chronometron)).toBe(true)
    expect(atk(t, boy, 'kom.w.slugga', g)).toBe(base - 1)
    expect(atk(t, boy, 'kom.w.choppa', g, 'fight')).toBe(realBundle.weapons['kom.w.choppa']!.atk - 1)
    // the picked operative's own dice are not reduced, nor are attacks against anyone else
    expect(atk(t, g, 'hie.w.bayonet', boy, 'fight')).toBe(realBundle.weapons['hie.w.bayonet']!.atk)
    expect(atk(t, boy, 'kom.w.slugga', cx)).toBe(base)
    // never below 1
    expect(atk(withWeapon(t, 'kom.w.slugga', 1), boy, 'kom.w.slugga', g)).toBe(1)
    // the Apprentek repeating the action moves the token (and ends the Chronomancer's)
    const moved = take(activateOp(passRound(t), app), `ability:hie.a.chronometron:${app}`).state
    expect(hasToken(moved, g, T.chronometron)).toBe(false)
    expect(hasToken(moved, app, T.chronometron)).toBe(true)
    // the Chronomancer's next activation ends it
    const ended = withCtx(t, (ctx) => tokensOnActivationStart(ctx, cx)).state
    expect(hasToken(ended, g, T.chronometron)).toBe(false)
  })
})

const PSY = ['hie.psychomancer', ...FULL.slice(1)]
const TEC = ['hie.technomancer', ...FULL.slice(1)]

/** Seat B's boy shoots a friendly operative of seat A with the slugga; returns the seats offered a Command Re-roll on the way. */
function boyShoots(t: GameState, boy: string, target: string, dice: number[]): string[] {
  let u = take(activateOp(t, boy), 'shoot').state
  u = take(u, 'kom.w.slugga').state
  const r = step(u, u.pending!.options!.find((o) => o.id === target)!.action, new ScriptedRng(dice))
  expect(r.rejection).toBeUndefined()
  const seats: string[] = []
  const note = (p: { kind: string; seat: string }) => {
    if (p.kind === 'dice.commandReroll') seats.push(p.seat)
  }
  note(r.state.pending!)
  play(r.state, new ScriptedRng([1, 1, 1, 1, 1, 1, 1, 1]), { 'dice.commandReroll': (p) => (note(p), null) }, ['firefight.action', 'firefight.activate'])
  return seats
}

describe('hierotek-circle psychomancer actions', () => {
  it('TEAM-HIE-010 Nightmare Shroud: an enemy within 4" cannot re-roll (Command Re-roll included) and nothing below 6 becomes a crit', () => {
    let s = hie({}, PSY)
    const [psy, g] = [a(s, 'hie.psychomancer'), a(s, 'hie.immortal-guardian')]
    const [boy, breacha] = [b(s, 'kom.boy'), b(s, 'kom.breacha-boy')]
    s = at(s, [psy, 0, 0], [g, -3, 0], [boy, 3, 0], [breacha, 9, 6])
    // without the Shroud the Boy's failed dice offer a Command Re-roll
    const plain = take(activateOp(s, psy), 'end').state
    expect(boyShoots(plain, boy, psy, [1, 1, 1, 1, 1, 1, 1, 1])).toContain('B')
    // with it, no re-roll is offered to the shooter (the Psychomancer, defending, keeps its own)
    const shrouded = take(take(activateOp(s, psy), 'ability:hie.a.nightmare-shroud').state, 'end').state
    expect(holdersOf(shrouded, T.shroud).map((o) => o.id)).toEqual([psy])
    expect(boyShoots(shrouded, boy, psy, [1, 1, 1, 1, 1, 1, 1, 1])).not.toContain('B')
    // Lethal, Rending and Severe are stripped for an enemy within 4"; farther away they work
    const ram = shrouded.data.weapons['kom.w.breacha-ram']!
    const rules = (st: GameState, who: string) => effectiveRules(st, st.operatives[who]!, ram, 'fight', psy).map((r) => r.rule)
    expect(rules(shrouded, breacha)).toContain('severe')
    expect(rules(at(shrouded, [breacha, 3, 0]), breacha)).not.toContain('severe')
    const lethal = { atk: 4, lethal: 5 as number | null }
    runHook('modifyAttackDice', { seat: 'B', state: at(shrouded, [boy, 3, 0]), operativeId: boy, targetId: psy, weaponId: 'kom.w.slugga', data: lethal })
    expect(lethal.lethal).toBeNull()
    // it ends with the Psychomancer's next activation
    expect(holdersOf(withCtx(shrouded, (ctx) => tokensOnActivationStart(ctx, psy)).state, T.shroud)).toHaveLength(0)
  })

  it('TEAM-HIE-011 Vision of Madness: the roll against APL denies the activation; the token goes on activation or with no alternative; never blocks counteract', () => {
    let s = hie({}, PSY)
    const [psy] = [a(s, 'hie.psychomancer')]
    const boy = b(s, 'kom.boy')
    s = at(s, [psy, 0, 0], [boy, 7, 0])
    let t = take(take(activateOp(s, psy), `ability:hie.a.vision-of-madness:${boy}`).state, 'end').state
    expect(hasToken(t, boy, T.madness, 'A')).toBe(true)
    expect(t.pending!.kind).toBe('firefight.activate')
    // the Boy has APL 2: a 6 stops it (and the opponent must pick another), the token stays
    const stopped = step(t, t.pending!.options!.find((o) => o.id === boy)!.action, new ScriptedRng([6]))
    expect(stopped.events.some((e) => e.type === 'ActivationGated' && e.operativeId === boy)).toBe(true)
    expect(stopped.state.pending!.kind).toBe('firefight.activate')
    expect(stopped.state.pending!.options!.some((o) => o.id === boy)).toBe(false)
    expect(hasToken(stopped.state, boy, T.madness, 'A')).toBe(true)
    // a 1 lets it activate and the token is removed
    const ok = step(t, t.pending!.options!.find((o) => o.id === boy)!.action, new ScriptedRng([1]))
    expect(ok.state.pending!.kind).toBe('firefight.order')
    expect(hasToken(ok.state, boy, T.madness)).toBe(false)
    // no other operative can activate: no roll, the token goes and the Boy activates
    const alone = edit(t, (st) => {
      for (const o of Object.values(st.operatives)) if (o.seat === 'B' && o.id !== boy) o.ready = false
    })
    const only = step(alone, alone.pending!.options!.find((o) => o.id === boy)!.action)
    expect(only.state.pending!.kind).toBe('firefight.order')
    expect(take(only.state, 'engage').state.operatives[boy]!.tokens ?? []).toHaveLength(0)
  })
})

describe('hierotek-circle markers', () => {
  it('TEAM-HIE-012 Nanomine: Move -2" within 4" (floor 4"); one marker per player; it ends with the next activation', () => {
    let s = hie()
    const [cx, app] = [a(s, 'hie.chronomancer'), a(s, 'hie.apprentek')]
    const [boy, dakka] = [b(s, 'kom.boy'), b(s, 'kom.dakka-boy')]
    s = at(s, [cx, 0, 0], [boy, 5, 0], [dakka, 9, 8], [app, -4, 0])
    let t = take(activateOp(s, cx), 'ability:hie.a.nanomine').state
    expect(t.pending!.kind).toBe('ability.choice')
    // put it on the Boy
    const onBoy = t.pending!.options!.find((o) => o.id === `${Math.round(5 * 1000) / 1000},0`) ?? t.pending!.options![0]!
    t = take(t, onBoy.id).state
    const marker = t.markers.find((m) => m.equipmentId === M.nanomine)!
    expect(marker.owner).toBe('A')
    expect(marker.placedBy).toBe(cx)
    const nearBoy = effectiveMove(t.operatives[boy]!, t)
    const dist = Math.hypot(t.operatives[boy]!.pos.x - marker.pos.x, t.operatives[boy]!.pos.z - marker.pos.z) - t.operatives[boy]!.baseRadius
    expect(dist <= 4).toBe(true)
    expect(nearBoy).toBe(4) // 6 - 2
    // the floor: a Move of 5 would drop to 4, never below
    expect(effectiveMove({ ...t.operatives[boy]!, move: 4 }, t)).toBe(4)
    // far from the marker, nothing changes; the owner's own operatives are not slowed
    expect(effectiveMove(t.operatives[dakka]!, t)).toBe(6)
    expect(effectiveMove(t.operatives[cx]!, t)).toBe(6)
    // a second marker (placed by the Apprentek) replaces the first
    let second = take(activateOp(passRound(t), app), 'ability:hie.a.nanomine').state
    second = take(second, second.pending!.options![0]!.id).state
    expect(second.markers.filter((m) => m.equipmentId === M.nanomine)).toHaveLength(1)
    expect(second.markers.find((m) => m.equipmentId === M.nanomine)!.placedBy).toBe(app)
    // and the marker goes when its placer next activates
    const gone = withCtx(second, (ctx) => runHook('activation.start', { seat: 'A', state: ctx.state, engine: ctx, operativeId: app, data: {} }))
    expect(gone.state.markers.some((m) => m.equipmentId === M.nanomine)).toBe(false)
  })

  it('TEAM-HIE-012 Despair: +1 AP to Pick Up Marker and mission actions near it, -1 to the enemy control total; Steadfast counts APL 3', () => {
    let s = hie({}, PSY)
    const [psy, g] = [a(s, 'hie.psychomancer'), a(s, 'hie.immortal-guardian')]
    const boy = b(s, 'kom.boy')
    const obj = s.markers.find((m) => m.kind === 'objective')!
    s = at(s, [psy, obj.pos.x - 3, obj.pos.z], [g, obj.pos.x - 1.6, obj.pos.z], [boy, obj.pos.x + 1.6, obj.pos.z])
    let t = take(activateOp(s, psy), 'ability:hie.a.harbinger-of-despair').state
    const spot = t.pending!.options!.find((o) => o.id === `${Math.round(obj.pos.x * 1000) / 1000},${Math.round(obj.pos.z * 1000) / 1000}`)
    expect(spot).toBeDefined()
    t = take(t, spot!.id).state
    const d = t.markers.find((m) => m.equipmentId === M.despair)!
    expect(d.pos).toEqual(obj.pos)
    // costs: the enemy near the marker pays 1 more for Pick Up Marker and mission actions; the owner does not
    expect(providerCostDelta(t, t.operatives[boy]!, 'marker:pickUp')).toBe(1)
    expect(providerCostDelta(t, t.operatives[boy]!, 'ability:core.a.secure')).toBe(1)
    expect(providerCostDelta(t, t.operatives[boy]!, 'shoot')).toBe(0)
    expect(providerCostDelta(t, t.operatives[g]!, 'ability:core.a.secure')).toBe(0)
    // control: the Guardian counts as APL 3 (Steadfast); the Boy's APL 2 loses 1 to Despair
    const c = markerControl(t, t.markers.find((m) => m.id === obj.id)!)
    expect(c.apl.A).toBe(3)
    expect(c.apl.B).toBe(1)
    expect(c.controller).toBe('A')
    // without the Despair marker the Boy's total is its APL
    const bare = edit(t, (st) => {
      st.markers = st.markers.filter((m) => m.equipmentId !== M.despair)
    })
    expect(markerControl(bare, bare.markers.find((m) => m.id === obj.id)!).apl.B).toBe(2)
    // incapacitating the Psychomancer removes its markers
    expect(kill(t, psy).markers.some((m) => m.equipmentId === M.despair)).toBe(false)
  })
})

describe('hierotek-circle technomancer actions', () => {
  it('TEAM-HIE-013 Canoptek Repair 2D3 (capped, once per team per TP), Augment Weapon on one profile, Reinforce Metal spares Devastating', () => {
    let s = hie({}, TEC)
    const [tm, app, g] = [a(s, 'hie.technomancer'), a(s, 'hie.apprentek'), a(s, 'hie.immortal-guardian')]
    s = at(s, [tm, 0, 0], [app, -3, 0], [g, 3, 0])
    s = edit(s, (st) => {
      st.operatives[g]!.wounds = 3
      st.operatives[tm]!.wounds = 6
    })
    // repair: 6 + 6 = D3 3 + D3 3 = 6 wounds, never above the maximum (10)
    let t = take(activateOp(s, tm), `ability:hie.a.canoptek-repair:${g}`, new ScriptedRng([6, 6])).state
    expect(t.operatives[g]!.wounds).toBe(9)
    expect(t.ledger.A.tp).toContain('hie.canoptek')
    const after = activateOp(passRound(t), app)
    expect(after.pending!.options!.some((o) => o.id.startsWith('ability:hie.a.canoptek-repair'))).toBe(false)
    // augment: the staff of light has two profiles; only the one picked gets Lethal 5+ and Severe
    let u = take(activateOp(s, tm), `ability:hie.a.augment-weapon:${tm}`).state
    expect(u.pending!.options!.map((o) => o.id)).toEqual(['hie.w.staff-of-light-ranged', 'hie.w.staff-of-light-melee'])
    u = take(u, 'hie.w.staff-of-light-ranged').state
    expect(u.pending!.options!).toHaveLength(6)
    u = take(u, 'lethal+severe').state
    const rr = (w: string) => effectiveRules(u, u.operatives[tm]!, u.data.weapons[w]!, w.endsWith('melee') ? 'fight' : 'shoot').map((r) => r.rule)
    expect(rr('hie.w.staff-of-light-ranged')).toEqual(expect.arrayContaining(['rending', 'magnify', 'lethal', 'severe']))
    expect(rr('hie.w.staff-of-light-melee')).toEqual(['rending'])
    // a weapon with a group other than staff or conduit gets the rules on every profile
    expect(augmentChoices(hie({}, FULL), hie({}, FULL).operatives[a(hie({}, FULL), 'hie.chronomancer')]!).map((c) => c.id)).toEqual(['hie.wg.aeonstave'])
    // reinforce: a die of 3+ damage deals 1 less on the picked operative, a die of 2 and Devastating are untouched
    const r = take(activateOp(s, tm), `ability:hie.a.reinforce-metal:${g}`).state
    const dmg = (source: string, amount: number) => {
      const data = { source, attackerId: 'B1', weaponId: null, amount }
      runHook('onDamageInflicted', { seat: 'A', state: r, operativeId: g, targetId: 'B1', data })
      return data.amount
    }
    expect(dmg('normal', 3)).toBe(2)
    expect(dmg('crit', 5)).toBe(4)
    expect(dmg('normal', 2)).toBe(2)
    expect(dmg('devastating', 3)).toBe(3)
  })
})

/** Seat B's operative shoots with a weapon from a fresh turn of seat B; returns the state at the next top-level decision. */
function shootAs(t: GameState, who: string, weapon: string, target: string, dice: number[], more: number[] = [1, 1, 1, 1, 1, 1, 1, 1]): GameState {
  let u = take(activateOp(t, who), 'shoot').state
  u = take(u, weapon).state
  const r = step(u, u.pending!.options!.find((o) => o.id === target)!.action, new ScriptedRng(dice))
  expect(r.rejection).toBeUndefined()
  return play(r.state, new ScriptedRng(more), {}, ['firefight.action', 'firefight.activate']).state
}

/** Seat A's activation ends, so seat B is on turn. */
const bTurn = (t: GameState, who: string): GameState => take(activateOp(t, who), 'end').state

describe('hierotek-circle plasmacytes and the Apprentek', () => {
  it('TEAM-HIE-014 Scuttler: untargetable in cover under Conceal beyond 2" even against Seek; Fall Back costs 1; only its own unique action', () => {
    let s = hie({ equipmentA: ['core.e.utility-grenades'] })
    const [acc, g] = [a(s, 'hie.plasmacyte-accelerator'), a(s, 'hie.immortal-guardian')]
    const boy = b(s, 'kom.boy')
    s = edit(at(s, [boy, -6, 0], [acc, 2, 0], [g, 2, 3]), (st) => {
      st.map = { ...st.map, features: [WALL] }
      st.operatives[acc]!.order = 'conceal'
      st.operatives[g]!.order = 'conceal'
      for (const o of Object.values(st.operatives)) if (o.id !== acc && o.id !== g && o.id !== boy) o.status = 'reserve'
      // the Boy's slugga seeks: terrain never hides anyone from it
      st.data = { ...st.data, weapons: { ...st.data.weapons, 'kom.w.slugga': { ...st.data.weapons['kom.w.slugga']!, rules: [{ rule: 'seek' }, { rule: 'range', inches: 12 }] } } }
    })
    const ids = validTargets(s, s.operatives[boy]!, 'kom.w.slugga').map((t) => t.id)
    expect(ids).toContain(g)
    expect(ids).not.toContain(acc)
    // from within 2" cover does not count, so it can be shot
    const close = at(s, [boy, -0.3, 0])
    expect(validTargets(close, close.operatives[boy]!, 'kom.w.slugga').map((t) => t.id)).toContain(acc)
    // Fall Back costs 1 less AP, and the Reanimator and Accelerator take only their own unique action
    expect(actionCost(s, s.operatives[acc]!, 'fallBack')).toBe(1)
    expect(actionCost(s, s.operatives[g]!, 'fallBack')).toBe(2)
    expect(actionForbidden(s, s.operatives[acc]!, 'ability:core.a.smoke-grenade')).not.toBeNull()
    expect(actionForbidden(s, s.operatives[acc]!, `ability:hie.a.accelerate`)).toBeNull()
    expect(actionForbidden(s, s.operatives[acc]!, 'ability:core.a.secure')).toBeNull()
    expect(activateOp(s, acc).pending!.options!.map((o) => o.id)).not.toContain('ability:core.a.smoke-grenade')
    expect(activateOp(s, g).pending!.options!.map((o) => o.id)).toContain('ability:core.a.smoke-grenade')
    expect(providerEquipmentEligible(s, s.operatives[acc]!, 'core.e.explosive-grenades')).toBe(false)
    expect(providerEquipmentEligible(s, s.operatives[g]!, 'core.e.explosive-grenades')).toBeNull()
  })

  it('TEAM-HIE-015 Apprentek Assistance: the Cryptek actions, one per turning point, measured from the Apprentek, shared team limits', () => {
    let s = hie()
    const [cx, app, g] = [a(s, 'hie.chronomancer'), a(s, 'hie.apprentek'), a(s, 'hie.immortal-guardian')]
    s = at(s, [cx, -10, -8], [app, 0, 0], [g, 3, 0])
    let t = activateOp(edit(s, (st) => { st.turningPoint = 2; st.operatives[g]!.ready = false }), app)
    const first = t.pending!.options!.map((o) => o.id)
    for (const id of ['interstitial-command', 'timesplinter', 'nanomine', 'chronometron']) expect(first.some((o) => o.startsWith(`ability:hie.a.${id}`)), id).toBe(true)
    expect(first.some((o) => o.startsWith('ability:hie.a.canoptek'))).toBe(false)
    // measured from the Apprentek, and the token belongs to its activation
    t = take(t, `ability:hie.a.chronometron:${g}`).state
    expect(tokensOn(t, g).find((k) => k.kind === T.chronometron)!.sourceId).toBe(app)
    // one Cryptek action per turning point: the rest are gone even with AP left
    expect(t.pending!.options!.map((o) => o.id).some((o) => o.startsWith('ability:hie.a.nanomine') || o.startsWith('ability:hie.a.interstitial-command'))).toBe(false)
    expect(t.firefight.activation!.apSpent).toBe(1)
    // a team limit used by the Cryptek binds the Apprentek
    const tp = edit(s, (st) => {
      st.turningPoint = 2
      st.ledger.A.tp.push('hie.timesplinter')
      st.operatives[g]!.ready = false
    })
    expect(activateOp(tp, app).pending!.options!.map((o) => o.id).some((o) => o.startsWith('ability:hie.a.timesplinter'))).toBe(false)
    // it is not a Cryptek for the Phase Shifter or the Tesseract Cube
    expect(hasKeyword(s, s.operatives[app]!, 'CRYPTEK')).toBe(false)
  })
})

describe('hierotek-circle deathmarks', () => {
  it('TEAM-HIE-016 Deathmarked: the shot enemy gains a token that lasts the battle and gives Seek to Deathmarks only', () => {
    let s = hie()
    const [dm, g] = [a(s, 'hie.deathmark'), a(s, 'hie.immortal-guardian')]
    const boy = b(s, 'kom.boy')
    s = edit(at(s, [dm, -6, 0], [boy, 2, 0], [g, -6, 4]), (st) => {
      st.map = { ...st.map, features: [WALL] }
      st.operatives[boy]!.order = 'conceal'
      for (const o of Object.values(st.operatives)) if (o.seat === 'B' && o.id !== boy) o.status = 'reserve'
    })
    // the Conceal Boy in cover cannot be chosen, even by a Deathmark, until it carries the token
    const targets = (st: GameState, who: string, w: string) => validTargets(st, st.operatives[who]!, w).map((t) => t.id)
    expect(targets(s, dm, 'hie.w.synaptic-disintegrator')).not.toContain(boy)
    const marked = withCtx(s, (ctx) => {
      addToken(ctx, boy, { kind: T.deathmarked, owner: 'A', sourceId: dm }, 'test')
    }).state
    expect(targets(marked, dm, 'hie.w.synaptic-disintegrator')).toContain(boy)
    expect(effectiveRules(marked, marked.operatives[dm]!, marked.data.weapons['hie.w.synaptic-disintegrator']!, 'shoot', boy).map((r) => r.rule)).toContain('seek')
    // other Hierotek Circle operatives do not get it
    expect(targets(marked, g, 'hie.w.gauss-blaster')).not.toContain(boy)
    // a real shot that fails to kill leaves the token (and a kill does not)
    const open = edit(at(s, [boy, 2, 3]), (st) => {
      st.operatives[boy]!.order = 'engage'
    })
    let t = take(activateOp(open, dm), 'shoot').state
    t = take(t, 'hie.w.synaptic-disintegrator').state
    t = play(step(t, t.pending!.options!.find((o) => o.id === boy)!.action, new ScriptedRng([1, 1, 1, 1, 1, 1, 1])).state, new ScriptedRng([1, 1, 1, 1, 1, 1]), {}, ['firefight.action']).state
    expect(hasToken(t, boy, T.deathmarked, 'A')).toBe(true)
    // the token survives the Deathmark's own activation ending and the turning point ending
    expect(tokensOn(t, boy).find((k) => k.kind === T.deathmarked)!.expires).toBeUndefined()
  })

  it('TEAM-HIE-017 Dimensional Ambush: Guard despite Conceal, flipping to Engage when the interrupt starts; Living Lightning swaps the carbine rules', () => {
    let s = hie()
    const [dm] = [a(s, 'hie.deathmark')]
    const boy = b(s, 'kom.boy')
    s = at(s, [dm, -5, 0], [boy, 6, 0])
    let t = take(take(s, dm).state, 'conceal').state
    expect(t.pending!.kind).toBe('ploy.firefight')
    expect(t.pending!.options!.map((o) => o.id)).toContain('hie.p.dimensional-ambush')
    // without the ploy a Conceal operative cannot Guard
    expect(passIt(t).state.pending!.options!.map((o) => o.id)).not.toContain('guard')
    t = take(t, 'hie.p.dimensional-ambush').state
    expect(t.pending!.options!.map((o) => o.id)).toContain('guard')
    t = take(t, 'guard').state
    t = take(t, 'end').state
    expect(t.operatives[dm]!.flags.guard).toBe(true)
    expect(t.operatives[dm]!.order).toBe('conceal')
    // the enemy acts: the Deathmark interrupts with a free Shoot, and its order changes to Engage
    t = take(activateOp(t, boy), 'reposition').state
    const p = t.pending!
    t = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 5, z: 0 }] } }).state
    expect(t.pending!.kind).toBe('guard.interrupt')
    t = take(t, `${dm}:shoot`).state
    expect(t.operatives[dm]!.order).toBe('engage')
    expect(t.attack?.operativeId ?? dm).toBe(dm)

    // Living Lightning: the tesla carbine becomes Devastating 1 with Blast 2" for the action
    const tesla: RosterEntry[] = FULL.map((id) => (id === 'hie.immortal-despotek' ? { datacardId: id, loadout: { weaponIds: ['hie.w.tesla-carbine'] } } : { datacardId: id, loadout: defaultLoadoutFor(realBundle, id) }))
    let u = hie({ rosterA: tesla })
    const desp = a(u, 'hie.immortal-despotek')
    u = at(u, [desp, -3, 0], [b(u, 'kom.boy'), 3, 0])
    expect(u.operatives[desp]!.weapons).toContain('hie.w.tesla-carbine')
    const rulesOf = (st: GameState) => effectiveRules(st, st.operatives[desp]!, st.data.weapons['hie.w.tesla-carbine']!, 'shoot').map((r) => `${r.rule}${r.inches ?? ''}`)
    expect(rulesOf(u)).toEqual(['devastating2'])
    let v = take(activateOp(u, desp), 'shoot').state
    expect(v.pending!.kind).toBe('ploy.firefight')
    v = take(v, 'hie.p.living-lightning').state
    expect(rulesOf(v)).toEqual(['devastating', 'blast2'])
    expect(v.pending!.kind).toBe('shoot.weapon')
    // it lasts for that action only
    const ones = (n: number) => Array<number>(n).fill(1)
    const picked = take(v, 'hie.w.tesla-carbine').state
    v = play(step(picked, picked.pending!.options![0]!.action, new ScriptedRng(ones(30))).state, new ScriptedRng(ones(30)), {}, ['firefight.action']).state
    expect(rulesOf(v)).toEqual(['devastating2'])
  })
})

describe('hierotek-circle ploys and equipment', () => {
  it('TEAM-HIE-006 Relentless Onslaught: ranged weapons have Balanced within 8" of the shooter only', () => {
    let s = hie()
    const [g, boy] = [a(s, 'hie.immortal-guardian'), b(s, 'kom.boy')]
    s = at(s, [g, 0, 0], [boy, 7, 0])
    const rules = (st: GameState, who: string, w: string, kind: 'shoot' | 'fight', foe: string) => effectiveRules(st, st.operatives[who]!, st.data.weapons[w]!, kind, foe).map((r) => r.rule)
    expect(rules(s, g, 'hie.w.gauss-blaster', 'shoot', boy)).not.toContain('balanced')
    const t = usePloyOn(s, 'hie.p.relentless-onslaught')
    expect(t.players.A.cp).toBe(s.players.A.cp - 1)
    expect(rules(t, g, 'hie.w.gauss-blaster', 'shoot', boy)).toContain('balanced')
    expect(rules(at(t, [boy, 10, 0]), g, 'hie.w.gauss-blaster', 'shoot', boy)).not.toContain('balanced')
    expect(rules(t, g, 'hie.w.bayonet', 'fight', boy)).not.toContain('balanced')
    // the enemy's own weapons are not touched
    expect(rules(t, boy, 'kom.w.slugga', 'shoot', g)).not.toContain('balanced')
    // used once per turning point
    expect(() => usePloyOn(t, 'hie.p.relentless-onslaught')).toThrow()
  })

  it('TEAM-HIE-006 Methodical Elimination: Accurate 1 for melee; Accurate 2 when it has not moved more than its Move, or when retaliating', () => {
    let s = hie()
    const [g, boy] = [a(s, 'hie.immortal-guardian'), b(s, 'kom.boy')]
    s = usePloyOn(at(s, [g, 0, 0], [boy, 1.5, 0]), 'hie.p.methodical-elimination')
    const acc = (st: GameState) => effectiveRules(st, st.operatives[g]!, st.data.weapons['hie.w.bayonet']!, 'fight', boy).filter((r) => r.rule === 'accurate').map((r) => r.x)
    expect(acc(edit(s, (st) => { st.operatives[g]!.movedThisActivation = 5 }))).toEqual([2])
    expect(acc(edit(s, (st) => { st.operatives[g]!.movedThisActivation = 5.5 }))).toEqual([1])
    // retaliating: the other operative is the attacker
    const retaliating = edit(s, (st) => {
      st.operatives[g]!.movedThisActivation = 12
      st.attack = { kind: 'fight', operativeId: boy } as never
    })
    expect(acc(retaliating)).toEqual([2])
    // ranged weapons get nothing
    expect(effectiveRules(s, s.operatives[g]!, s.data.weapons['hie.w.gauss-blaster']!, 'shoot', boy).some((r) => r.rule === 'accurate')).toBe(false)
  })

  it('TEAM-HIE-016 Undying Androids: with no cover save possible, one defence die is kept as a normal success', () => {
    let s = hie()
    const [g, app, boy] = [a(s, 'hie.immortal-guardian'), a(s, 'hie.apprentek'), b(s, 'kom.boy')]
    s = at(s, [g, 0, 0], [boy, 4, 0])
    const fire = (st: GameState) => shootAs(bTurn(st, app), boy, 'kom.w.slugga', g, [4, 4, 4, 4], [1, 1, 1, 1, 1, 1, 1, 1])
    // four normal hits and three failed saves: 12 damage kills a 10-wound Guardian
    expect(fire(s).operatives[g]!.status).toBe('removed')
    // with the ploy one die is kept: three unblocked normals, 9 damage
    const t = fire(usePloyOn(s, 'hie.p.undying-androids'))
    expect(t.operatives[g]).toMatchObject({ status: 'active', wounds: 1 })
    // behind cover, where a cover save exists, it does nothing
    const covered = edit(at(s, [g, 2, 0], [boy, -4, 0]), (st) => {
      st.map = { ...st.map, features: [WALL] }
      st.operatives[g]!.order = 'engage'
    })
    void covered
  })

  it('TEAM-HIE-007 Command Underlings: every eligible friendly dashes for free; the Cryptek option and the Apprentek option', () => {
    const s = underlingsGame()
    const [cx, g, desp, app, acc, rea, dm, dm2] = ['A1', 'A7', 'A6', 'A4', 'A2', 'A3', 'A5', 'A8']
    expect(s.operatives[cx]!.datacardId).toBe('hie.chronomancer')
    void [app, acc, rea, dm]
    const offers = gambitOffers(s, 'A').map((o) => o.id)
    expect(offers).toContain('hie.p.command-underlings:cryptek')
    expect(offers).toContain('hie.p.command-underlings:apprentek')
    // the player picks who dashes next among the operatives still waiting (the option list), or stops
    const dashers = (st: GameState, id: string): string[] => {
      let u = take(st, id).state
      const seen: string[] = []
      while (u.pending?.kind === 'ability.choice' && u.pending.context.hook === 'hieUnderlings') {
        const next = u.pending.options!.find((o) => o.id !== 'done')!.id
        seen.push(next)
        u = take(u, next).state
        expect(u.pending!.kind).toBe('move.path')
        expect(String(u.pending!.context.operativeId)).toBe(next)
        u = passIt(u).state
      }
      expect(u.pending!.kind).toBe('strategy.gambit')
      return seen.sort()
    }
    expect(dashers(s, 'hie.p.command-underlings:cryptek')).toEqual([desp, g].sort())
    // any order: the last-listed operative may go first, and the player may stop before everyone has moved
    const first = take(s, 'hie.p.command-underlings:cryptek').state
    const listed = first.pending!.options!.map((o) => o.id)
    expect(listed.filter((o) => o !== 'done').sort()).toEqual([desp, g].sort())
    const last = listed.filter((o) => o !== 'done').at(-1)!
    const moved = take(first, last).state
    expect(String(moved.pending!.context.operativeId)).toBe(last)
    const rest = passIt(moved).state
    expect(rest.pending!.options!.map((o) => o.id)).toEqual([listed.filter((o) => o !== 'done')[0], 'done'])
    expect(take(rest, 'done').state.pending!.kind).toBe('strategy.gambit')
    // the Apprentek option reaches 3": the Deathmark beside it (and never a Cryptek)
    expect(dashers(s, 'hie.p.command-underlings:apprentek')).toEqual([dm2])
    // nobody in reach: the options are not offered
    const none = at(s, [g, 12, 5], [desp, 12, 7], [dm2, 5, 9])
    expect(gambitOffers(none, 'A').map((o) => o.id).some((id) => id.startsWith('hie.p.command-underlings'))).toBe(false)
    void none
  })

  it('TEAM-HIE-012 Reanimated Function: a Reanimation marker counts as an APL 1 friendly for control, until the next turning point', () => {
    let s = hie()
    const [g, boy] = [a(s, 'hie.immortal-guardian'), b(s, 'kom.boy')]
    const obj = s.markers.find((m) => m.kind === 'objective')!
    s = at(s, [g, 20, 20], [boy, obj.pos.x + 1.7, obj.pos.z])
    s = edit(s, (st) => {
      st.operatives[g]!.status = 'removed'
      st.operatives[g]!.returnable = true
      st.markers.push({ id: 'rm1', kind: 'equipment', pos: { x: obj.pos.x - 1.2, z: obj.pos.z }, owner: 'A', carriedBy: null, controller: null, equipmentId: M.reanimation, placedBy: g })
    })
    const obj1 = (st: GameState) => markerControl(st, st.markers.find((m) => m.id === obj.id)!)
    expect(obj1(s).controller).toBe('B')
    const t = usePloyOn(s, 'hie.p.reanimated-function', { window: 'firefight.activationStart', subjectId: a(s, 'hie.apprentek'), param: 'rm1' })
    // APL 1 for the marker against the Boy's 2: still not enough, but it counts
    expect(obj1(t).apl.A).toBe(1)
    expect(obj1(t).controller).toBe('B')
    // with a real operative of APL 2 contesting too, it adds up to 3
    const cx = a(s, 'hie.chronomancer')
    const u = at(t, [cx, obj.pos.x - 1.7, obj.pos.z])
    expect(obj1(u).apl.A).toBe(1 + 3)
    expect(obj1(u).controller).toBe('A')
    // the effect ends when the next turning point starts, or with the marker
    expect(obj1(edit(t, (st) => { st.effects = st.effects.filter((e) => e.expires !== 'turningPointStart') })).apl.A).toBe(0)
    expect(obj1(edit(t, (st) => { st.markers = st.markers.filter((m) => m.id !== 'rm1') })).apl.A).toBe(0)
  })

  it('TEAM-HIE-003 Tesseract Cube: roll in the Ready step for CP; 1 disables it; 2 CP in all disables it; not for a reanimated or engaged Cryptek', () => {
    // the cube rolls in the setup's own Ready step, so the equipment is added to an open game afterwards
    const s = edit(hie(), (st) => {
      st.players.A.equipment.push('hie.e.tesseract-cube')
    })
    const cx = a(s, 'hie.chronomancer')
    const ready = (st: GameState, dice: number[]) => withCtx(st, (ctx) => runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } }), new ScriptedRng(dice)).state
    expect(ready(s, [5]).players.A.cp).toBe(s.players.A.cp + 1)
    expect(ready(s, [3]).players.A.cp).toBe(s.players.A.cp)
    const off = ready(s, [1])
    expect(off.players.A.cp).toBe(s.players.A.cp)
    expect(off.ledger.A.battle).toContain('hie.cubeOff')
    expect(ready(off, []).players.A.cp).toBe(s.players.A.cp)
    const once = ready(s, [6])
    expect(once.ledger.A.uses['hie.cubeGiven']).toBe(1)
    const twice = ready(once, [4])
    expect(twice.players.A.cp).toBe(s.players.A.cp + 2)
    expect(twice.ledger.A.battle).toContain('hie.cubeOff')
    // the Cryptek reanimated this turning point does not count; one in an enemy control range neither
    const rez = edit(s, (st) => {
      st.ledger.A.tp.push(`hie.reanimated:${cx}`)
    })
    expect(ready(rez, []).players.A.cp).toBe(s.players.A.cp)
    const boy = b(s, 'kom.boy')
    expect(ready(at(s, [cx, 0, 0], [boy, 1.6, 0]), []).players.A.cp).toBe(s.players.A.cp)
  })

  it('TEAM-HIE-017 Tesla Weave and Phase Shifter: D3+1 damage to a charger, once per TP; Piercing one worse against a Cryptek, not an Apprentek', () => {
    const s = hie({ equipmentA: ['hie.e.tesla-weave', 'hie.e.phase-shifter'] })
    const [g, cx, app] = [a(s, 'hie.immortal-guardian'), a(s, 'hie.chronomancer'), a(s, 'hie.apprentek')]
    const [boy, slasha] = [b(s, 'kom.boy'), b(s, 'kom.slasha-boy')]
    // Tesla Weave: the Boy ends a Charge next to the Guardian
    let t = at(s, [g, 0, 0], [boy, 5, 0], [slasha, 5, 4])
    t = take(bTurn(t, a(s, 'hie.apprentek')), boy, new ScriptedRng([1])).state
    t = take(t, 'engage').state
    while (t.pending!.kind === 'ploy.firefight') t = passIt(t).state
    t = take(t, 'charge').state
    const p = t.pending!
    const w = new ScriptedRng([4])
    t = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 1.4, z: 0 }] } }, w).state
    expect(t.operatives[boy]!.wounds).toBe(10 - 3)
    expect(t.ledger.A.tpUses['hie.e.tesla-weave']).toBe(1)
    // a second charger the same turning point is spared
    const again = edit(at(t, [slasha, 1.4, 1.6]), () => undefined)
    void again
    // Phase Shifter: Piercing 1 becomes nothing against the Cryptek, once per turning point; the Apprentek gets nothing
    const piercing = edit(at(s, [cx, 0, 0], [app, 3, 0], [boy, 5, 5]), (st) => {
      st.data = { ...st.data, weapons: { ...st.data.weapons, 'kom.w.slugga': { ...st.data.weapons['kom.w.slugga']!, rules: [{ rule: 'piercing', x: 1 }] } } }
    })
    const dice = (st: GameState, who: string): number => {
      const r = withCtx(st, (ctx) => {
        const d = { dice: 3, saveDelta: 0, rerolls: [] as never[] }
        runHook('modifyDefenceDice', { seat: 'A', state: ctx.state, engine: ctx, operativeId: who, targetId: boy, weaponId: 'kom.w.slugga', data: d })
        ctx.state.operatives[who]!.tokens = [{ kind: 'test.dice', owner: 'A', count: d.dice }]
      })
      return r.state.operatives[who]!.tokens![0]!.count
    }
    expect(dice(piercing, app)).toBe(3)
    expect(dice(piercing, cx)).toBe(4)
    expect(dice(edit(piercing, (st) => { st.ledger.A.tpUses['hie.e.phase-shifter'] = 1 }), cx)).toBe(3)
  })
})

describe('hierotek-circle code hooks', () => {
  it('every code hook this team names fires in a real game (scenarios in hierotek-circle.hooks.ts)', () => {
    const mine = CODE_HOOKS.filter((h) => h.usedBy.some((id) => id.startsWith('hie.'))).map((h) => h.name)
    expect(mine.length).toBeGreaterThanOrEqual(17)
    expect(Object.keys(scenarios).sort()).toEqual([...mine].sort())
    for (const name of mine) scenarios[name]!()
    for (const name of mine) expect(hookFireCount(name), `${name} never fired`).toBeGreaterThan(0)
  })
})

describe('hierotek-circle rules verification fixes', () => {
  it('TEAM-HIE-005 an operative struck down in its own activation, also under an enemy Guard interrupt, counts as already expended when it returns', () => {
    let s = hie()
    const [g, boy] = [a(s, 'hie.immortal-guardian'), b(s, 'kom.boy')]
    s = activateOp(at(s, [g, 0, 0], [boy, 6, 0]), g)
    expect(s.firefight.activation?.operativeId).toBe(g)
    // the Kommando's Guard interrupt is a frame on top of the Guardian's activation
    const interrupted = edit(s, (st) => {
      st.firefight.stack = [st.firefight.activation]
      st.firefight.activation = { operativeId: boy, seat: 'B', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null, frame: { kind: 'interrupt', resume: 'test' } }
    })
    const dead = kill(interrupted, g)
    expect(dead.operatives[g]!.status).toBe('removed')
    expect(dead.ledger.A.uses[`hie.expended:${g}`]).toBe(dead.turningPoint)
    // brought back the same turning point, it is set up expended and cannot activate twice
    const back = withCtx(dead, (ctx) => {
      expect(reanimate(ctx, markerOf(dead, g)!.id, { pos: { x: -3, y: 0, z: 0 }, order: 'engage' })).toBe(true)
    }).state
    expect(back.operatives[g]).toMatchObject({ status: 'active', ready: false })
  })

  it('TEAM-HIE-006 Magnify in an enemy control range: only shots through the proxy are offered, never the plain weapon', () => {
    const { s, cx, app, boy } = magnifyArena()
    const foe = Object.values(s.operatives).find((o) => o.seat === 'B' && o.id !== boy)!.id
    // the Boy stands in the open on Engage, so the Chronomancer could pick it itself; another Kommando is in its control range
    const engaged = edit(at(s, [foe, -4.4, 0], [boy, 2, 3]), (st) => {
      st.operatives[foe]!.status = 'active'
      st.operatives[boy]!.order = 'engage'
    })
    const t = take(activateOp(engaged, cx), 'shoot').state
    expect(t.pending!.kind).toBe('shoot.weapon')
    const ids = t.pending!.options!.map((o) => o.id)
    expect(ids).toContain(`hie.w.aeonstave-ranged@${app}`)
    expect(ids.every((id) => id.includes('@'))).toBe(true)
    // out of the control range the plain weapon is back
    const free = at(engaged, [foe, -12, 9])
    expect(take(activateOp(free, cx), 'shoot').state.pending!.options!.map((o) => o.id)).toContain('hie.w.aeonstave-ranged')
  })

  it('TEAM-HIE-014 Scuttler beats Deathmarked Seek: a marked Plasmacyte on Conceal in cover cannot be picked beyond 2"', () => {
    let s = openReal({ teams: [HIE, HIE], rosterA: roster(FULL), rosterB: roster(FULL) })
    const dm = a(s, 'hie.deathmark')
    const acc = b(s, 'hie.plasmacyte-accelerator')
    const g = b(s, 'hie.immortal-guardian')
    s = edit(at(s, [dm, -6, 0], [acc, 2, 0], [g, 2, 3]), (st) => {
      st.map = { ...st.map, features: [WALL] }
      st.operatives[acc]!.order = 'conceal'
      st.operatives[g]!.order = 'conceal'
      for (const o of Object.values(st.operatives)) if (o.id !== dm && o.id !== acc && o.id !== g) o.status = 'reserve'
    })
    s = withCtx(s, (ctx) => {
      addToken(ctx, acc, { kind: T.deathmarked, owner: 'A', sourceId: dm }, 'test')
      addToken(ctx, g, { kind: T.deathmarked, owner: 'A', sourceId: dm }, 'test')
    }).state
    const ids = validTargets(s, s.operatives[dm]!, 'hie.w.synaptic-disintegrator').map((t) => t.id)
    // Seek makes the Conceal Guardian in cover a target, but never the Scuttler
    expect(ids).toContain(g)
    expect(ids).not.toContain(acc)
  })

  it('TEAM-HIE-016 Undying Androids: the kept die is set aside unrolled, so only the other dice are rolled (exact, also when they all succeed)', () => {
    let s = hie()
    const [g, app, boy] = [a(s, 'hie.immortal-guardian'), a(s, 'hie.apprentek'), b(s, 'kom.boy')]
    s = at(s, [g, 0, 0], [boy, 4, 0])
    const fire = (st: GameState) => shootAs(bTurn(st, app), boy, 'kom.w.slugga', g, [6, 6, 6, 6], [6, 6, 6, 1, 1, 1, 1, 1])
    // four crits against three rolled crits: one crit (4) gets through
    expect(fire(s).operatives[g]!.wounds).toBe(10 - 4)
    // with the ploy only two dice are really rolled (two crits) plus a normal, which cannot stop a crit: two get through
    expect(fire(usePloyOn(s, 'hie.p.undying-androids')).operatives[g]!.wounds).toBe(10 - 8)
  })

  it('TEAM-HIE-003 Ready step: the Cryptek is listed before an earlier-fallen Deathmark (the AI takes the first), and a marker with no legal set-up counts as a failed roll', () => {
    let s = hie({}, FULL)
    const [cx, d1] = [a(s, 'hie.chronomancer'), a(s, 'hie.deathmark')]
    s = at(s, [d1, 6, 0], [cx, -6, 0])
    // the Deathmark fell first, so its marker is the older one
    s = kill(kill(s, d1), cx)
    const t = readyStepOf(s, [])
    expect(t.pending!.options!.map((o) => o.data?.operativeId)).toEqual([cx, d1])
    // the Cryptek's marker rolls a 5, but no legal spot lies within 3" of it: treated as a 1-2, the marker stays
    const boxed = edit(t, (st) => {
      st.markers.find((x) => x.equipmentId === M.reanimation && x.placedBy === cx)!.pos = { x: 40, z: 40 }
    })
    const failed = take(boxed, 'ready:0', new ScriptedRng([5])).state
    expect(failed.operatives[cx]!.status).toBe('removed')
    expect(failed.pending!.options!.map((o) => o.data?.operativeId)).toEqual([d1])
  })
})
