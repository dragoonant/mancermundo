// wyrmblade engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-WYR-nnn).
// Positions and flows are shared with the hook firing scenarios (wyrmblade.hooks.ts).
import { describe, expect, it } from 'vitest'
import { act } from '@/engine/actions'
import { step, view, type GameState, type PendingDecision } from '@/engine'
import { attackStats, effectiveRules, inflict, ruleSetFor, runDeferredRemovals, targetInfo, validTargets } from '@/engine/attack-common'
import { queueRemoval } from '@/engine/effects'
import { chargeUnderConceal, maxRepeats } from '@/engine/abilities'
import { stealthyLevel } from '@/engine/handlers'
import { markerControl } from '@/engine/query'
import { tokenCount } from '@/engine/tokens'
import { runHook } from '@/engine/hooks'
import { isMine, updateControl } from '@/engine/markers'
import { selectionProblem } from '@/engine/equipment'
import { providerReactions } from '@/engine/team-rules'
import { TEAM_ID } from '@/engine/teams/wyrmblade'
import { validateRoster, loadBundle } from '../../../src/data'
import type { RosterSelection, TeamData } from '../../../src/data'
import { defaultAnswer, drive, expectOk } from '../../fixtures/helpers'
import { evs, play } from '../../fixtures/attack'
import { activateOp, edit, hasOption, inTp, newRealGame, opOf, passIt, realBundle, take, withCtx } from '../../fixtures/real'
import { ScriptedRng } from '@/engine/rng'
import {
  TEAMS,
  agents,
  bTurn,
  dashNearLocus,
  dice,
  emerged,
  endAct,
  hide,
  idsOf,
  loyaltyShot,
  pathTo,
  playToActionEnd,
  talonAmbush,
  takeStarting,
  toGambit,
  warriorShotDead,
  wyr,
} from './wyrmblade.hooks'
import { place } from '../../fixtures/helpers'

const team = loadBundle().teams['wyrmblade'] as TeamData
const cards = Object.fromEntries(Object.values(loadBundle().byId).filter((r) => 'stats' in r).map((r) => [(r as { id: string }).id, r as { name: string; team: string }]))
const rosterOf = (leader: string[], main: string[]): RosterSelection => ({ leader, main })
const LEADER = ['wyr.neophyte-leader']
const warriors = (n: number) => Array<string>(n).fill('wyr.warrior')
const reasons = (r: RosterSelection) => validateRoster(team, r, cards as never).reasons

describe('wyrmblade', () => {
  it('TEAM-WYR-001 the roster validator counts cult agents as two selections and caps them at two', () => {
    expect(TEAM_ID).toBe('wyrmblade')
    expect(reasons(rosterOf(LEADER, warriors(13)))).toEqual([])
    expect(reasons(rosterOf(LEADER, ['wyr.kelermorph', 'wyr.locus', ...warriors(9)]))).toEqual([])
    // three cult agents: the cap, and 12 weighted selections come up one short
    expect(reasons(rosterOf(LEADER, ['wyr.kelermorph', 'wyr.locus', 'wyr.sanctus-sniper', ...warriors(7)])).join(' ')).toMatch(/at most 2 of Cult Agents/)
    expect(reasons(rosterOf(LEADER, ['wyr.kelermorph', 'wyr.locus', ...warriors(8)])).join(' ')).toMatch(/12 selections chosen, 13 required/)
    // every other entry once
    expect(reasons(rosterOf(LEADER, ['wyr.icon-bearer', 'wyr.icon-bearer', ...warriors(11)])).join(' ')).toMatch(/only once/)
  })

  it('TEAM-WYR-002 the Gunner and Heavy Gunner caps count variants together', () => {
    expect(reasons(rosterOf(LEADER, ['wyr.gunner-flamer', 'wyr.gunner-flamer', ...warriors(11)])).join(' ')).toMatch(/only once/)
    expect(reasons(rosterOf(LEADER, ['wyr.gunner-flamer', 'wyr.gunner-webber', ...warriors(11)]))).toEqual([])
    expect(reasons(rosterOf(LEADER, ['wyr.gunner-flamer', 'wyr.gunner-webber', 'wyr.gunner-grenade-launcher', ...warriors(10)])).join(' ')).toMatch(/at most 2 of Gunners/)
    expect(reasons(rosterOf(LEADER, ['wyr.heavy-gunner-heavy-stubber', 'wyr.heavy-gunner-mining-laser', 'wyr.heavy-gunner-seismic-cannon', ...warriors(10)])).join(' ')).toMatch(/at most 2 of Heavy Gunners/)
  })

  it('TEAM-WYR-003 set-up allows at most a third of the team in HIDING, Neophytes only', () => {
    let s = newRealGame({ teams: TEAMS }, 'wyr-setup').state
    const rng = new ScriptedRng([6, 1, 6, 1, ...Array<number>(10).fill(1)])
    const hidden: string[] = []
    let offered: string[] = []
    for (let i = 0; i < 900 && s.pending?.kind !== 'firefight.activate'; i++) {
      const p = s.pending!
      const aside = p.kind === 'setup.deploy' ? ((p.context.setAsideIds as string[] | undefined) ?? []) : []
      if (p.kind === 'setup.deploy' && p.seat === 'A' && aside.length > 0) {
        offered = aside
        hidden.push(aside[0]!)
        s = step(s, act.setAside(p, aside[0]!), rng).state
      } else s = step(s, defaultAnswer(s), rng).state
    }
    expect(hidden).toHaveLength(4)
    // 12 operatives: a third is 4; no cult agent was ever offered; the opponent has no hiding
    expect(Object.values(s.operatives).filter((o) => o.seat === 'A')).toHaveLength(12)
    for (const id of hidden) expect(s.operatives[id]).toMatchObject({ status: 'reserve', offboard: 'setAside' })
    expect(offered.every((id) => realBundle.datacards[s.operatives[id]!.datacardId]!.keywords.includes('NEOPHYTE'))).toBe(true)
    expect(Object.values(s.operatives).filter((o) => o.seat === 'B' && o.offboard)).toHaveLength(0)
    const cultAgents = Object.values(s.operatives).filter((o) => realBundle.datacards[o.datacardId]!.keywords.includes('CULT AGENT'))
    expect(cultAgents.every((o) => o.status === 'active')).toBe(true)
  })

  it('TEAM-WYR-004 emerging is a Reposition: legal spots only, 1 AP, no Charge or Fall Back, expending always legal', () => {
    const base = wyr()
    const w = idsOf(base, 'A', 'wyr.warrior')[0]!
    const s = hide(base, w)
    const t = take(activateOp(s, w), 'ability:wyr.a.emerge').state
    expect(hasOption(activateOp(s, w), 'end')).toBe(true)
    const zone = t.map.dropZones.find((z) => z.id === t.players.A.dropZoneId)!
    const spots = t.pending!.options!.map((o) => o.data as { x: number; z: number; order: string })
    expect(spots.length).toBeGreaterThan(2)
    for (const p of spots) {
      const xs = zone.polygon.map((q) => q.x)
      const zs = zone.polygon.map((q) => q.z)
      const dx = Math.max(Math.min(...xs) - p.x, 0, p.x - Math.max(...xs))
      const dz = Math.max(Math.min(...zs) - p.z, 0, p.z - Math.max(...zs))
      // within 6" of the drop zone (the base radius counts), and more than 6" from every enemy
      expect(Math.hypot(dx, dz) + t.operatives[w]!.baseRadius).toBeLessThanOrEqual(6 + 1e-6)
      for (const e of Object.values(t.operatives).filter((o) => o.seat === 'B' && o.status === 'active')) {
        expect(Math.hypot(e.pos.x - p.x, e.pos.z - p.z) - e.baseRadius - t.operatives[w]!.baseRadius).toBeGreaterThan(6)
      }
    }
    const out = takeStarting(t, 'conceal')
    expect(out.operatives[w]).toMatchObject({ status: 'active', order: 'conceal' })
    expect(out.operatives[w]!.offboard).toBeUndefined()
    expect(out.pending).toMatchObject({ kind: 'firefight.action', context: { apSpent: 1, apRemaining: 1 } })
    const ids = out.pending!.options!.map((o) => o.id)
    for (const barred of ['charge', 'fallBack', 'reposition']) expect(ids, barred).not.toContain(barred)
    expect(ids).toContain('end')
    expect(evs(step(t, t.pending!.options![0]!.action).events, 'OperativeReturned')[0]).toMatchObject({ operativeId: w, kind: 'emerge' })
  })

  it('TEAM-WYR-005 an emerged Heavy Gunner cannot use its Heavy weapon that activation', () => {
    const base = wyr()
    const hg = idsOf(base, 'A', 'wyr.heavy-gunner-heavy-stubber')[0]!
    const boy = opOf(base, 'B', 'kom.boy')
    // control: the same Heavy Gunner standing in the open can shoot
    const open = edit(place(place(base, hg, -8, 0), boy, 0, 0), () => undefined)
    expect(hasOption(activateOp(open, hg), 'shoot')).toBe(true)
    const hidden = hide(place(base, boy, 10, 0), hg)
    const out = emerged(hidden, hg)
    expect(out.operatives[hg]!.status).toBe('active')
    expect(out.pending!.options!.map((o) => o.id)).not.toContain('shoot')
  })

  it('TEAM-WYR-006 operatives still hiding when the second turning point ends are incapacitated and feed the kill op', () => {
    const base = wyr()
    const ws = idsOf(base, 'A', 'wyr.warrior').slice(0, 2)
    const s = inTp(hide(base, ...ws), 2)
    const early = withCtx(inTp(s, 1), (ctx) => {
      runHook('turningPoint.end', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 1 } })
      updateControl(ctx)
    })
    expect(ws.every((id) => early.state.operatives[id]!.status === 'reserve')).toBe(true)
    const r = withCtx(s, (ctx) => {
      runHook('turningPoint.end', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })
      updateControl(ctx)
    })
    for (const id of ws) expect(r.state.operatives[id]).toMatchObject({ status: 'removed', wounds: 0 })
    expect(evs(r.events, 'OperativeIncapacitated')).toHaveLength(2)
    expect(r.state.mission!.kills.B).toBe(2)
    expect(r.state.mission!.startCount.A).toBe(12)
  })

  it('TEAM-WYR-007 a ready hiding operative blocks counteracting and is open information', () => {
    const base = wyr()
    const h = idsOf(base, 'A', 'wyr.warrior')[0]!
    const x = idsOf(base, 'A', 'wyr.gunner-flamer')[0]!
    const boy = opOf(base, 'B', 'kom.boy')
    const prepared = edit(hide(base, h), (st) => {
      for (const o of Object.values(st.operatives)) if (o.seat === 'A' && o.id !== h && o.id !== x) (o.ready = false), (o.order = 'engage')
      st.operatives[x]!.order = 'engage'
    })
    expect(view(prepared, 'B').operatives[h]).toMatchObject({ status: 'reserve', offboard: 'setAside' })
    const aTurnAgain = (s0: GameState): GameState => take(activateOp(take(activateOp(s0, x), 'end').state, boy), 'end').state
    // H is ready: A must activate it (expending it in HIDING is the way out), there is no counteract option
    const blocked = aTurnAgain(prepared)
    expect(blocked.pending).toMatchObject({ kind: 'firefight.activate', seat: 'A', canPass: false })
    expect(blocked.pending!.options!.map((o) => o.id)).toEqual([h])
    // control: with H expended the all-expended team may counteract instead
    const free = aTurnAgain(edit(prepared, (st) => (st.operatives[h]!.ready = false)))
    expect(free.pending!.seat).toBe('A')
    expect(free.pending!.options!.every((o) => o.id.startsWith('counteract:'))).toBe(true)
    // expending H without emerging keeps it hiding
    const stay = take(activateOp(blocked, h), 'end').state
    expect(stay.operatives[h]).toMatchObject({ status: 'reserve', offboard: 'setAside', ready: false })
  })

  it('TEAM-WYR-008 Cult Ambush gives Ceaseless after a Conceal to Engage switch or when unseen, only in the own attack', () => {
    const base = wyr()
    const w = idsOf(base, 'A', 'wyr.warrior')[0]!
    const boy = opOf(base, 'B', 'kom.boy')
    const rules = (st: GameState, weapon = 'wyr.w.autogun', kind: 'shoot' | 'fight' = 'shoot', foe = boy) =>
      effectiveRules(st, st.operatives[w]!, st.data.weapons[weapon]!, kind, foe).map((r) => r.rule)
    const wall = { id: 'wall', parts: [{ id: 'wall.0', footprint: [{ x: -0.5, z: -12 }, { x: 0.5, z: -12 }, { x: 0.5, z: 12 }, { x: -0.5, z: 12 }], height: 3, traits: ['heavy' as const] }] }
    const near = (s0: GameState) => place(s0, w, -4, 0)
    // (a) switched from Conceal (the set-up order) to Engage
    const switched = activateOp(near(base), w, 'engage')
    expect(rules(switched)).toContain('ceaseless')
    // (c) already Engage and seen by the enemy: nothing
    const seen = activateOp(near(edit(base, (st) => (st.operatives[w]!.order = 'engage'))), w, 'engage')
    expect(rules(seen)).not.toContain('ceaseless')
    // (b) already Engage but no enemy can see it: Ceaseless
    const hiddenBehind = edit(near(edit(base, (st) => (st.operatives[w]!.order = 'engage'))), (st) => {
      st.map = { ...st.map, features: [wall] }
    })
    expect(rules(activateOp(hiddenBehind, w, 'engage'))).toContain('ceaseless')
    // not when the operative is retaliating or shot at: the effect only counts in its own attack
    const retaliating = edit(switched, (st) => {
      st.attack = { kind: 'fight', stage: 'resolve', operativeId: boy, seat: 'B', weaponId: null, pointBlank: false, targets: [], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] }
    })
    expect(rules(retaliating, 'wyr.w.gun-butt', 'fight')).not.toContain('ceaseless')
    // a counteraction is not an activation
    const g = idsOf(base, 'A', 'wyr.gunner-flamer')[0]!
    const spent = edit(near(base), (st) => {
      for (const o of Object.values(st.operatives)) if (o.seat === 'A' && o.id !== g) (o.ready = false), (o.order = 'engage')
    })
    let c = take(activateOp(spent, g), 'end').state
    c = take(activateOp(c, opOf(c, 'B', 'kom.boy')), 'end').state
    expect(c.pending!.options!.some((o) => o.id === `counteract:${w}`)).toBe(true)
    c = take(c, `counteract:${w}`).state
    expect(c.firefight.activation).toMatchObject({ operativeId: w, counteract: true })
    expect(rules(c)).not.toContain('ceaseless')
  })

  it('TEAM-WYR-009 Group Activation owes one more Warrior, never a third; an emerging Warrior ignores it', () => {
    const base = wyr()
    const [w1, w2, w3, w4] = idsOf(base, 'A', 'wyr.warrior')
    let s = endAct(activateOp(base, w1!))
    expect(s.pending).toMatchObject({ kind: 'firefight.activate', seat: 'A' })
    expect(s.pending!.options!.map((o) => o.id).sort()).toEqual([w2, w3, w4].sort())
    s = endAct(activateOp(s, w2!))
    expect(s.pending!.seat).toBe('B')
    // a Warrior that emerges is not owed a partner
    const hidden = hide(base, w1!)
    const out = endAct(emerged(hidden, w1!))
    expect(out.pending!.seat).toBe('B')
    // one that stays hidden is, and the partner may be hiding too (a hiding operative gets no end-of-activation window)
    const two = hide(base, w1!, w2!)
    const stay = take(activateOp(two, w1!), 'end').state
    expect(stay.pending!.options!.map((o) => o.id)).toContain(w2)
  })

  it('TEAM-WYR-010 Quicksilver Strike charges up to 3" into the mover\'s control range; an impossible one is not offered or spent', () => {
    const { s, locus, boy } = dashNearLocus(wyr())
    expect(s.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { reaction: true } })
    const t = take(s, 'react:0').state
    expect(t.pending).toMatchObject({ kind: 'move.path', seat: 'A', constraints: { kind: 'charge', maxInches: 3, mustEndInControlRangeOfId: boy } })
    const u = pathTo(t, -1.2, 0)
    expect(u.operatives[locus]!.pos.x).toBeCloseTo(-1.2)
    expect(u.ledger.A.tp).toContain(`wyr.a.quicksilver-strike:${locus}`)
    // the enemy's activation carries on
    expect(u.pending).toMatchObject({ kind: 'firefight.action', seat: 'B' })
    // too far for a 3" Charge: no interruption and nothing spent
    const far = dashNearLocus(wyr(), 4.6)
    expect(far.s.pending).toMatchObject({ kind: 'firefight.action', seat: 'B' })
    expect(far.s.ledger.A.tp.filter((k) => k.startsWith('wyr.a.quicksilver'))).toEqual([])
    // a Conceal Locus switches to Engage to do it
    const sneaky = dashNearLocus(wyr(), 2.5, 'conceal')
    const v = pathTo(take(sneaky.s, 'react:0').state, -1.2, 0)
    expect(v.operatives[sneaky.locus]!.order).toBe('engage')
    // declining spends nothing
    const declined = passIt(dashNearLocus(wyr()).s).state
    expect(declined.ledger.A.tp.filter((k) => k.startsWith('wyr.a.quicksilver'))).toEqual([])
    expect(providerReactions(far.s, 'A', { actorId: far.boy, action: 'dash', activeSeat: 'B', moved: true })).toEqual([])
  })

  it('TEAM-WYR-011 a retaliating Locus blocks one enemy success before the attacker strikes', () => {
    const base = wyr()
    const locus = opOf(base, 'A', 'wyr.locus')
    const warrior = idsOf(base, 'A', 'wyr.warrior')[0]!
    const boy = opOf(base, 'B', 'kom.boy')
    const fight = (defender: string): GameState => {
      let s = bTurn(edit(place(place(base, defender, 0, 0), boy, 1.7, 0), (st) => (st.operatives[defender]!.order = 'engage')))
      s = take(activateOp(s, boy), 'fight').state
      s = take(s, defender).state
      return play(s, dice(6, 5, 3, 1, 6, 6, 5, 4, 3), { 'ploy.firefight': (p) => act.pass(p) }, ['fight.resolve', 'firefight.action']).state
    }
    const stance = fight(locus)
    expect(stance.pending).toMatchObject({ kind: 'fight.resolve', seat: 'A' })
    expect(stance.pending!.options!.every((o) => o.id.startsWith('block:'))).toBe(true)
    // control: an ordinary defender waits for the attacker to resolve first
    const plain = fight(warrior)
    expect(plain.pending).toMatchObject({ kind: 'fight.resolve', seat: 'B' })
  })

  it('TEAM-WYR-012 Assassinate needs an enemy that cannot see the Talon; its Fight strikes twice before the defender', () => {
    const { s, talon, boy, blocker } = talonAmbush(agents())
    const id = `ability:wyr.a.assassinate:${boy}`
    expect(hasOption(activateOp(s, talon, 'conceal'), id)).toBe(true)
    // seen: not offered; Engage: not offered
    expect(hasOption(activateOp(place(s, blocker, -13.5, 9), talon, 'conceal'), id)).toBe(false)
    expect(hasOption(activateOp(s, talon, 'engage'), id)).toBe(false)
    // out of reach (more than Move + control range away)
    expect(hasOption(activateOp(place(s, talon, -12, 0), talon, 'conceal'), id)).toBe(false)
    let t = take(activateOp(s, talon, 'conceal'), id).state
    expect(t.pending).toMatchObject({ kind: 'move.path', constraints: { kind: 'charge', maxInches: 6, mustEndInControlRangeOfId: boy } })
    const rng = dice(6, 5, 4, 1, 6, 5, 4, 3)
    t = pathTo(t, -1.5, 0, rng)
    expect(t.pending).toMatchObject({ kind: 'fight.target', seat: 'A' })
    expect(t.pending!.options!.map((o) => o.id)).toEqual([boy])
    expect(t.operatives[talon]!.order).toBe('conceal')
    const seats: { seat: string; strikeOnly: boolean }[] = []
    const answers = {
      'fight.resolve': (p: PendingDecision) => {
        seats.push({ seat: p.seat, strikeOnly: p.options!.every((o) => o.id.startsWith('strike:')) })
        return p.options!.find((o) => o.id.startsWith('strike:'))?.action ?? null
      },
    }
    // every ploy window is passed except the one after the action, where Creeping Shadow is offered
    const r = playToActionEnd(take(t, boy, rng).state, rng, answers)
    const events = r.events
    expect(seats.slice(0, 3).map((x) => x.seat)).toEqual(['A', 'A', 'B'])
    expect(seats[1]!.strikeOnly).toBe(true)
    expect(evs(events, 'Struck').slice(0, 2).map((e) => e.operativeId)).toEqual([talon, talon])
    // Creeping Shadow: a free Fall Back of up to 3" follows the Fight (still in the enemy's control range)
    expect(r.state.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A' })
    expect(r.state.pending!.options!.map((o) => o.id)).toContain('wyr.a.creeping-shadow:fallBack')
    const back = take(r.state, 'wyr.a.creeping-shadow:fallBack').state
    expect(back.pending).toMatchObject({ kind: 'move.path', constraints: { kind: 'fallBack', maxInches: 3 } })
  })

  it('TEAM-WYR-013 Unquestioning Loyalty moves a Shoot onto a Neophyte the shooter cannot see; Blast and Torrent refuse it', () => {
    const { s, kel, neo, boy } = loyaltyShot(wyr())
    expect(validTargets(s, s.operatives[boy]!, 'kom.w.slugga').map((t) => t.id)).toEqual([kel])
    expect(s.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A' })
    const used = take(s, `wyr.p.unquestioning-loyalty:${neo}`)
    const r = play(used.state, dice(6, 6, 1, 1, 1, 1, 1, 1), { 'ploy.firefight': (p) => act.pass(p) })
    expect(evs([...used.events, ...r.events], 'TargetSelected')[0]).toMatchObject({ operativeId: boy, targetId: neo })
    expect(r.state.players.A.cp).toBe(1)
    const blast = loyaltyShot(wyr(), 'kom.rokkit-boy')
    expect(blast.s.pending!.kind).not.toBe('ploy.firefight')
  })

  it('TEAM-WYR-014 a stationary Heavy Gunner shoots with Ceaseless, or Relentless when Cult Ambush already gave it Ceaseless', () => {
    const base = wyr()
    const hg = idsOf(base, 'A', 'wyr.heavy-gunner-heavy-stubber')[0]!
    const boy = opOf(base, 'B', 'kom.boy')
    const rules = (st: GameState) => effectiveRules(st, st.operatives[hg]!, st.data.weapons['wyr.w.heavy-stubber-focused']!, 'shoot', boy).map((r) => r.rule)
    const open = edit(place(place(base, hg, -6, 0), boy, 0, 0), (st) => (st.operatives[hg]!.order = 'engage'))
    const plain = activateOp(open, hg, 'engage')
    expect(rules(plain)).toContain('ceaseless')
    expect(rules(plain)).not.toContain('relentless')
    // switched from Conceal: Cult Ambush gives Ceaseless, the bipod upgrades it
    const ambush = activateOp(place(place(base, hg, -6, 0), boy, 0, 0), hg, 'engage')
    expect(rules(ambush)).toContain('relentless')
    expect(rules(ambush)).not.toContain('ceaseless')
    // having moved: neither; a counteraction: Ceaseless even after moving
    const moved = edit(plain, (st) => (st.operatives[hg]!.movedThisActivation = 3))
    expect(rules(moved)).not.toContain('ceaseless')
    const counter = edit(moved, (st) => (st.firefight.activation = { ...st.firefight.activation!, counteract: true }))
    expect(rules(counter)).toContain('ceaseless')
    // only weapons from its own datacard
    expect(effectiveRules(plain, plain.operatives[hg]!, plain.data.weapons['wyr.w.gun-butt']!, 'fight', boy).map((r) => r.rule)).not.toContain('ceaseless')
  })

  it('TEAM-WYR-015 a Neophyte shot dead near the Icon Bearer shoots before removal; Plan Generations is the incapacitation ploy window, for 0 CP through Overthrow', () => {
    const { s, warrior } = warriorShotDead(wyr())
    expect(s.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { operativeId: warrior } })
    expect(s.pending!.options!.map((o) => o.id)).toEqual(['overthrow-shoot', 'none'])
    const rng = dice()
    const r = play(take(s, 'overthrow-shoot', rng).state, rng, { 'ploy.firefight': (p) => act.pass(p) })
    expect(evs(r.events, 'ShootStarted')[0]).toMatchObject({ operativeId: warrior })
    expect(r.state.operatives[warrior]).toMatchObject({ status: 'removed', order: 'engage' })
    expect(r.state.pending).toMatchObject({ kind: 'firefight.action', seat: 'B' })
    expect(r.state.ledger.A.tp).toContain('wyr.a.overthrow-the-oppressors')
    // letting it fall removes it at once
    expect(take(s, 'none').state.operatives[warrior]!.status).toBe('removed')

    // melee: the enemy in its control range bars the free Shoot and the mission action, so nothing is offered
    const base = inTp(wyr(), 2)
    const icon = opOf(base, 'A', 'wyr.icon-bearer')
    const w = idsOf(base, 'A', 'wyr.warrior')[0]!
    const boy = opOf(base, 'B', 'kom.boy')
    const objective = (st: GameState) => st.markers.find((k) => k.kind === 'objective')!
    const pinned = edit(base, (st) => {
      objective(st).pos = { x: -2, z: 0 }
      st.operatives[w]!.wounds = 1
    })
    let f = bTurn(place(place(place(pinned, icon, -0.5, 3), w, -0.5, 0), boy, 1.1, 0))
    f = take(activateOp(f, boy), 'fight').state
    const rng2 = dice(6, 6, 6, 6, 1, 1, 1)
    f = play(take(f, w, rng2).state, rng2, { 'ploy.firefight': (p) => act.pass(p) }).state
    expect(f.operatives[w]!.status).toBe('removed')
    expect(f.pending).toMatchObject({ kind: 'firefight.action', seat: 'B' })

    // shot dead on an objective: Overthrow offers the free mission action for 0 CP (the rule's own choice); letting it
    // go, the ploy is offered at its printed cost in the shared operative.incapacitated window, before removal
    let g = bTurn(place(place(place(pinned, icon, -0.5, 3), w, -0.5, 0), boy, 5.5, 0))
    g = take(activateOp(g, boy), 'shoot').state
    g = take(g, g.pending!.options![0]!.id).state
    const rng3 = dice(6, 6, 6, 6, 1, 1, 1)
    g = play(expectOk(step(g, g.pending!.options!.find((o) => o.id === w)!.action, rng3)).state, rng3, { 'ploy.firefight': (p) => act.pass(p) }, ['ability.choice', 'firefight.action']).state
    expect(g.pending!.options!.map((o) => o.id)).toEqual(['overthrow-plan', 'overthrow-shoot', 'none'])
    const cp = g.players.A.cp
    let p = take(g, 'none').state
    expect(p.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'operative.incapacitated', context: { subjectId: w } })
    expect(p.pending!.options!.find((o) => o.id === 'wyr.p.a-plan-generations-in-the-making')!.data).toMatchObject({ cost: 1 })
    expect(p.operatives[w]!.status).toBe('active')
    p = take(p, 'wyr.p.a-plan-generations-in-the-making').state
    expect(p.pending).toMatchObject({ kind: 'firefight.action', seat: 'A', context: { operativeId: w } })
    p = takeStarting(p, 'ability:core.a.secure')
    expect(p.mission!.secured[objective(p).id]).toBe('A')
    expect(p.players.A.cp).toBe(cp - 1)
    expect(p.operatives[w]!.status).toBe('removed')
    expect(p.pending).toMatchObject({ kind: 'firefight.action', seat: 'B' })
    // passing the window too removes it with nothing done
    const fell = passIt(take(g, 'none').state).state
    expect(fell.operatives[w]!.status).toBe('removed')
    expect(fell.players.A.cp).toBe(cp)
    // through Overthrow it costs nothing, and the window has nothing left to offer
    g = take(g, 'overthrow-plan').state
    expect(g.pending).toMatchObject({ kind: 'firefight.action', seat: 'A', context: { operativeId: w } })
    g = takeStarting(g, 'ability:core.a.secure')
    expect(g.mission!.secured[objective(g).id]).toBe('A')
    expect(g.players.A.cp).toBe(cp)
    expect(g.operatives[w]!.status).toBe('removed')
    expect(g.pending).toMatchObject({ kind: 'firefight.action', seat: 'B' })
  })

  it('TEAM-WYR-015 a Neophyte killed by a mine or rule damage waits for the before-removal queue: Overthrow the Oppressors, then A Plan Generations in the Making, are offered as after a Shoot', () => {
    const base = inTp(wyr(), 2)
    const icon = opOf(base, 'A', 'wyr.icon-bearer')
    const w = idsOf(base, 'A', 'wyr.warrior')[0]!
    const boy = opOf(base, 'B', 'kom.boy')
    const objective = (st: GameState) => st.markers.find((k) => k.kind === 'objective')!
    const pinned = edit(base, (st) => {
      objective(st).pos = { x: -2, z: 0 }
      st.operatives[w]!.wounds = 1
    })
    // the Kommando's activation is under way when rule damage (a mine, Poison and the like) takes the Neophyte down
    const g = activateOp(bTurn(place(place(place(pinned, icon, -0.5, 3), w, -0.5, 0), boy, 5.5, 0)), boy)
    const parked = g.pending!
    const asked = withCtx(g, (ctx) => {
      inflict(ctx, { targetId: w, attackerId: boy, weaponId: null, amount: 3, source: 'direct' })
      queueRemoval(ctx, w)
      expect(ctx.state.operatives[w]!.status).toBe('active')
      runDeferredRemovals(ctx)
    }).state
    expect(asked.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', window: 'operative.incapacitated', context: { hook: 'planGenerations', operativeId: w } })
    expect(asked.pending!.options!.map((o) => o.id)).toEqual(['overthrow-plan', 'overthrow-shoot', 'none'])
    // let it go: the ploy at its printed cost in the incapacitation window; passed, it is removed and play goes on
    const cp = asked.players.A.cp
    const win = take(asked, 'none').state
    expect(win.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'operative.incapacitated', context: { subjectId: w } })
    expect(win.pending!.options!.find((o) => o.id === 'wyr.p.a-plan-generations-in-the-making')!.data).toMatchObject({ cost: 1 })
    const fell = passIt(win).state
    expect(fell.operatives[w]!.status).toBe('removed')
    expect(fell.players.A.cp).toBe(cp)
    expect(fell.pending?.id).toBe(parked.id)
    // through Overthrow: the free mission action for 0 CP, then the removal, then the Kommando carries on
    let p = take(asked, 'overthrow-plan').state
    expect(p.pending).toMatchObject({ kind: 'firefight.action', seat: 'A', context: { operativeId: w } })
    p = takeStarting(p, 'ability:core.a.secure')
    expect(p.mission!.secured[objective(p).id]).toBe('A')
    expect(p.players.A.cp).toBe(cp)
    expect(p.operatives[w]!.status).toBe('removed')
    expect(p.pending).toMatchObject({ kind: 'firefight.action', seat: 'B' })
    // nothing to offer (no Icon Bearer in sight, no CP for the ploy): removed at once
    const alone = edit(place(g, icon, 12, -9), (st) => (st.players.A.cp = 0))
    const gone = withCtx(alone, (ctx) => {
      inflict(ctx, { targetId: w, attackerId: boy, weaponId: null, amount: 3, source: 'direct' })
      queueRemoval(ctx, w)
    }).state
    expect(gone.operatives[w]!.status).toBe('removed')
  })

  it('TEAM-WYR-016 Divert and Disappear: a Cult Agent uses two of the three slots and its Fall Back costs it 1 APL', () => {
    const g0 = toGambit()
    const k = opOf(g0, 'A', 'wyr.kelermorph')
    const locus = opOf(g0, 'A', 'wyr.locus')
    const boy = opOf(g0, 'B', 'kom.boy')
    const [w1] = idsOf(g0, 'A', 'wyr.warrior')
    const g = place(place(g0, k, 0, 0), boy, 1.6, 0)
    let s = take(g, 'wyr.p.divert-and-disappear').state
    expect(s.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { slotsLeft: 3 } })
    const ids = s.pending!.options!.map((o) => o.id)
    expect(ids).toContain(`${k}:fallBack`)
    expect(ids).not.toContain(`${k}:dash`)
    expect(ids).toContain(`${locus}:dash`)
    expect(ids).toContain(`${w1}:dash`)
    s = take(s, `${k}:fallBack`).state
    expect(s.pending).toMatchObject({ kind: 'move.path', constraints: { kind: 'fallBack', maxInches: 3 } })
    s = pathTo(s, -2.6, 0)
    // one slot left: no second Cult Agent
    expect(s.pending).toMatchObject({ kind: 'ability.choice', context: { slotsLeft: 1 } })
    expect(s.pending!.options!.map((o) => o.id).some((id) => id.startsWith(`${locus}:`))).toBe(false)
    expect(s.operatives[k]!.aplMods).toBe(-1)
    s = take(s, `${w1}:dash`).state
    s = pathTo(s, s.operatives[w1!]!.pos.x + 2, s.operatives[w1!]!.pos.z)
    expect(s.pending).toMatchObject({ kind: 'strategy.gambit', seat: 'B' })
  })

  it('TEAM-WYR-017 a Wyrmblade operative never triggers or is hurt by its own Explosive Traps; an enemy does', () => {
    const base = wyr()
    const a = opOf(base, 'A', 'wyr.warrior')
    const boy = opOf(base, 'B', 'kom.boy')
    const s = edit(base, (st) => {
      st.markers.push({ id: 'mk.trap', kind: 'equipment', pos: { x: 0, z: 0 }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'wyr.e.explosive-traps', hidden: true })
    })
    expect(isMine(s, s.markers.find((m) => m.id === 'mk.trap')!)).toBe(true)
    const own = withCtx(place(s, a, 0.5, 0), (ctx) => updateControl(ctx))
    expect(evs(own.events, 'MineTriggered')).toHaveLength(0)
    expect(own.state.markers.some((m) => m.id === 'mk.trap')).toBe(true)
    const foe = withCtx(place(s, boy, 0.5, 0), (ctx) => updateControl(ctx))
    expect(evs(foe.events, 'MineTriggered')).toHaveLength(1)
    // it gives two hidden markers and cannot be taken with the universal Mines
    const eq = realBundle.equipment!
    expect(eq['wyr.e.explosive-traps']).toMatchObject({ count: 2, hidden: true, excludes: ['core.e.mines'] })
    const setup = { equipment: { A: ['wyr.e.explosive-traps', 'core.e.mines'], B: [] } } as never
    expect(selectionProblem(setup, 'A', { equipment: eq, teamId: 'wyrmblade', limit: 4 })).toMatch(/cannot be taken with/)
    const placed = drive(newRealGame({ teams: TEAMS, equipmentA: ['wyr.e.explosive-traps'], autoEquipment: true }, 'wyr-traps').state, (st) => st.pending?.kind === 'firefight.activate', 800, new ScriptedRng([6, 1, 6, 1, ...Array<number>(10).fill(1)]))
    expect(placed.markers.filter((m) => m.equipmentId === 'wyr.e.explosive-traps')).toHaveLength(2)
    expect(view(placed, 'B').markers.filter((m) => m.equipmentId === 'wyr.e.explosive-traps')).toHaveLength(0)
  })

  it('TEAM-WYR-018 rule grants: Soulsight, Heroic Inspiration, Crossfire, The Day Is At Hand, Target Vulnerability, Cult Agent', () => {
    const rulesOf = (st: GameState, op: string, weapon: string, kind: 'shoot' | 'fight', foe: string) =>
      effectiveRules(st, st.operatives[op]!, st.data.weapons[weapon]!, kind, foe)
    const names = (rs: { rule: string }[]) => rs.map((r) => r.rule)
    const fx = (st: GameState, source: string, seat: 'A' | 'B', kind: string, operativeId?: string) =>
      st.effects.push({ id: `t${st.effects.length}`, source, seat, kind, expires: 'turningPoint', ...(operativeId ? { operativeId } : {}) })
    // Soulsight token: the Sniper's rifle gets Saturate, the Talon's dagger Brutal and Balanced
    const a = agents()
    const [sn, ta, boy] = [opOf(a, 'A', 'wyr.sanctus-sniper'), opOf(a, 'A', 'wyr.sanctus-talon'), opOf(a, 'B', 'kom.boy')]
    const marked = edit(a, (st) => (st.operatives[boy]!.tokens = [{ kind: 'wyr.soulsight', owner: 'A', count: 1 }]))
    expect(names(rulesOf(a, sn, 'wyr.w.sanctus-sniper-rifle-mobile', 'shoot', boy))).not.toContain('saturate')
    expect(names(rulesOf(marked, sn, 'wyr.w.sanctus-sniper-rifle-mobile', 'shoot', boy))).toContain('saturate')
    expect(names(rulesOf(marked, sn, 'wyr.w.sanctus-sniper-rifle-stationary', 'shoot', boy))).toContain('saturate')
    expect(names(rulesOf(marked, ta, 'wyr.w.sanctus-bio-dagger', 'fight', boy))).toEqual(expect.arrayContaining(['brutal', 'balanced']))
    expect(names(rulesOf(a, ta, 'wyr.w.sanctus-bio-dagger', 'fight', boy))).not.toContain('brutal')
    // Target Vulnerability: Lethal 5+ on the stationary profile only
    const tv = take(activateOp(a, sn), 'ability:wyr.a.target-vulnerability').state
    expect(rulesOf(tv, sn, 'wyr.w.sanctus-sniper-rifle-stationary', 'shoot', boy)).toContainEqual({ rule: 'lethal', target: 5 })
    expect(names(rulesOf(tv, sn, 'wyr.w.sanctus-sniper-rifle-mobile', 'shoot', boy))).not.toContain('lethal')

    const base = wyr()
    const [k, w, hg] = [opOf(base, 'A', 'wyr.kelermorph'), idsOf(base, 'A', 'wyr.warrior')[0]!, idsOf(base, 'A', 'wyr.heavy-gunner-mining-laser')[0]!]
    const b = opOf(base, 'B', 'kom.boy')
    // Heroic Inspiration: only after a kill this turning point, only within 3" and in sight of the Kelermorph
    const inspired = edit(place(place(base, k, 0, 0), w, 2, 0), (st) => fx(st, 'wyr.kill', 'A', 'wyr.kill', k))
    expect(names(rulesOf(inspired, w, 'wyr.w.autogun', 'shoot', b))).toContain('severe')
    expect(names(rulesOf(inspired, w, 'wyr.w.gun-butt', 'fight', b))).toContain('severe')
    expect(names(rulesOf(place(inspired, w, 5, 0), w, 'wyr.w.autogun', 'shoot', b))).not.toContain('severe')
    expect(names(rulesOf(place(place(base, k, 0, 0), w, 2, 0), w, 'wyr.w.autogun', 'shoot', b))).not.toContain('severe')
    // Crossfire: Accurate 1 against an enemy another Wyrmblade operative has shot this turning point
    const cf = edit(base, (st) => {
      fx(st, 'wyr.p.crossfire', 'A', 'ployFlag')
      st.ledger.A.tp.push(`wyr.shot:${b}:${k}`)
    })
    expect(rulesOf(cf, w, 'wyr.w.autogun', 'shoot', b)).toContainEqual({ rule: 'accurate', x: 1 })
    expect(names(rulesOf(cf, k, 'wyr.w.liberator-autostubs-short-range', 'shoot', b))).not.toContain('accurate')
    // The Day Is At Hand: Rending on ranged and +1 Atk (cap 5) on melee after a Conceal to Engage switch
    const flagged = () => edit(base, (st) => fx(st, 'wyr.p.the-day-is-at-hand', 'A', 'ployFlag'))
    const day = activateOp(flagged(), w, 'engage')
    expect(names(rulesOf(day, w, 'wyr.w.autogun', 'shoot', b))).toContain('rending')
    expect(attackStats(day, w, 'wyr.w.gun-butt', b, { kind: 'fight' }).atk).toBe(4)
    const locus = opOf(base, 'A', 'wyr.locus')
    expect(attackStats(activateOp(flagged(), locus, 'engage'), locus, 'wyr.w.locus-blades', b, { kind: 'fight' }).atk).toBe(5)
    expect(names(rulesOf(base, w, 'wyr.w.autogun', 'shoot', b))).not.toContain('rending')
    // Cult Agent: Piercing and Saturate are ignored against it
    const burna = opOf(base, 'B', 'kom.burna-boy')
    expect(names(rulesOf(base, burna, 'kom.w.burna-standard', 'shoot', w))).toContain('saturate')
    expect(names(rulesOf(base, burna, 'kom.w.burna-standard', 'shoot', k))).not.toContain('saturate')
    expect(names(rulesOf(base, hg, 'wyr.w.mining-laser', 'shoot', w))).toContain('piercing')
    expect(names(rulesOf(base, hg, 'wyr.w.mining-laser', 'shoot', k))).not.toContain('piercing')
    expect(stealthyLevel(base, base.operatives[k]!)).toBe(1)
    expect(stealthyLevel(base, base.operatives[w]!)).toBe(0)
    // not cumulative with Vantage (T-WYR.28): the core's Stealthy step adds nothing once the improvement was taken
    const coverSaves = (coverMode: string): number => {
      const st = edit(base, (x) => {
        x.attack = { kind: 'shoot', operativeId: b, seq: { targetId: k, improvedCover: true, coverMode } } as never
      })
      const dice = [
        { value: null, kind: 'normal', tag: 'cover' },
        { value: 2, kind: 'fail' },
      ]
      runHook('afterDefenceRoll', { seat: 'A', state: st, operativeId: k, data: { kind: 'shoot', dice } })
      return dice.filter((d) => d.tag === 'cover').length
    }
    expect(coverSaves('retainTwo')).toBe(1)
    expect(coverSaves('retain')).toBe(2)
  })

  it('TEAM-WYR-019 obscured: Hypersense, Soulsight and Spotlights remove it, One With The Shadows adds it', () => {
    const base = wyr()
    const [k, w] = [opOf(base, 'A', 'wyr.kelermorph'), idsOf(base, 'A', 'wyr.warrior')[0]!]
    const boy = opOf(base, 'B', 'kom.boy')
    const low = (id: string, trait: 'heavy' | 'light', x = 0) => ({ id, parts: [{ id: `${id}.0`, footprint: [{ x: x - 0.5, z: -6 }, { x: x + 0.5, z: -6 }, { x: x + 0.5, z: 6 }, { x: x - 0.5, z: 6 }], height: 0.8, traits: [trait] }] })
    const field = (trait: 'heavy' | 'light', x = 0) => edit(place(place(place(base, k, -3, 0), boy, 3, 0), w, -3, 2), (st) => (st.map = { ...st.map, features: [low('low', trait, x)] }))
    const obscured = (st: GameState, shooter: string, target: string, weapon: string) => {
      const t = edit(st, (x) => {
        x.attack = { kind: 'shoot', stage: 'target', operativeId: shooter, seat: x.operatives[shooter]!.seat, weaponId: weapon, pointBlank: false, targets: [], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] }
      })
      const rules = ruleSetFor(t, t.operatives[shooter]!, weapon, 'shoot', target)
      return targetInfo(t, t.operatives[shooter]!, t.operatives[target]!, rules).obscured
    }
    const heavy = field('heavy')
    expect(obscured(heavy, k, boy, 'wyr.w.liberator-autostubs-short-range')).toBe(true)
    expect(obscured(heavy, k, boy, 'wyr.w.liberator-autostubs-hypersense')).toBe(false)
    // Spotlights: a Neophyte of the shooter's team that sees the target within 6"
    const lit = edit(heavy, (st) => (st.players.A.equipment = ['wyr.e.spotlights']))
    expect(obscured(lit, k, boy, 'wyr.w.liberator-autostubs-short-range')).toBe(false)
    expect(obscured(edit(lit, (st) => (st.players.A.equipment = [])), k, boy, 'wyr.w.liberator-autostubs-short-range')).toBe(true)
    expect(obscured(place(lit, w, -12, 8), k, boy, 'wyr.w.liberator-autostubs-short-range')).toBe(true)
    // Soulsight: the Sniper's target cannot be obscured
    const ag = agents()
    const [sn, b2] = [opOf(ag, 'A', 'wyr.sanctus-sniper'), opOf(ag, 'B', 'kom.boy')]
    const wall = edit(place(place(ag, sn, -3, 0), b2, 3, 0), (st) => (st.map = { ...st.map, features: [low('low', 'heavy')] }))
    expect(obscured(wall, sn, b2, 'wyr.w.sanctus-sniper-rifle-mobile')).toBe(true)
    expect(obscured(edit(wall, (st) => (st.operatives[b2]!.tokens = [{ kind: 'wyr.soulsight', owner: 'A', count: 1 }])), sn, b2, 'wyr.w.sanctus-sniper-rifle-mobile')).toBe(false)
    // One With The Shadows: a Conceal Wyrmblade target behind Light terrain more than 1" from both
    const shadows = edit(field('light'), (st) => {
      st.effects.push({ id: 'ots', source: 'wyr.p.one-with-the-shadows', seat: 'A', kind: 'ployFlag', expires: 'turningPoint' })
      st.operatives[k]!.order = 'conceal'
    })
    expect(obscured(shadows, boy, k, 'kom.w.slugga')).toBe(true)
    expect(obscured(edit(shadows, (st) => (st.operatives[k]!.order = 'engage')), boy, k, 'kom.w.slugga')).toBe(false)
    expect(obscured(edit(shadows, (st) => st.effects.pop()), boy, k, 'kom.w.slugga')).toBe(false)
    // Light terrain within 1" of the target does not count
    expect(obscured(place(shadows, k, -0.9 - 0.63, 0), boy, k, 'kom.w.slugga')).toBe(false)
  })

  it('TEAM-WYR-020 follow-up free actions and ploys: Expert Swordsman, Slink Into Darkness with Shadow Vector, Coiled Serpent', () => {
    const base = wyr()
    // Expert Swordsman: the Fight leaves no enemy in control range, so a free 3" Charge is offered and does not count as the Charge action
    const locus = opOf(base, 'A', 'wyr.locus')
    const boy = opOf(base, 'B', 'kom.boy')
    const second = opOf(base, 'B', 'kom.slasha-boy')
    let s = edit(place(place(place(base, locus, 0, 0), boy, 1.7, 0), second, 5, 0), (st) => {
      st.operatives[locus]!.order = 'engage'
    })
    s = take(activateOp(s, locus), 'fight').state
    const rng = dice(6, 6, 6, 6, 6, 1, 1, 1, 1)
    const r = playToActionEnd(take(s, boy, rng).state, rng)
    expect(r.state.operatives[boy]!.status).toBe('removed')
    expect(r.state.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'firefight.actionEnded' })
    expect(r.state.pending!.options!.map((o) => o.id)).toContain('wyr.a.expert-swordsman')
    let t = take(r.state, 'wyr.a.expert-swordsman').state
    expect(t.pending).toMatchObject({ kind: 'move.path', constraints: { kind: 'charge', maxInches: 3 } })
    t = pathTo(t, 3, 0)
    expect(t.operatives[locus]!.pos.x).toBeCloseTo(3)
    expect(t.pending).toMatchObject({ kind: 'firefight.action', seat: 'A', context: { performed: ['fight'] } })

    // Slink Into Darkness at the end of the activation; Shadow Vector makes it free for a Neophyte the Leader sees, not for the Leader
    const w = idsOf(base, 'A', 'wyr.warrior')[0]!
    const leader = opOf(base, 'A', 'wyr.neophyte-leader')
    const slink = (id: string, o: GameState) => {
      let u = take(activateOp(o, id, 'engage'), 'guard').state
      u = take(u, 'dash').state
      return pathTo(u, u.operatives[id]!.pos.x + 2, u.operatives[id]!.pos.z)
    }
    const arranged = place(place(base, leader, -6, 4), w, -6, 0)
    const slunk = slink(w, arranged)
    expect(slunk.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'firefight.activationEnded' })
    const opt = slunk.pending!.options!.find((o) => o.id === 'wyr.p.slink-into-darkness')!
    expect(opt.data).toMatchObject({ cost: 0, via: 'shadowVector' })
    const after = take(slunk, 'wyr.p.slink-into-darkness').state
    expect(after.operatives[w]!.order).toBe('conceal')
    expect(after.operatives[w]!.oncePerBattleUsed).toContain('wyr.slink')
    expect(after.players.A.cp).toBe(slunk.players.A.cp)
    expect(after.ledger.A.tp).toContain('wyr.a.shadow-vector')
    const lead = slink(leader, arranged)
    expect(lead.pending!.options!.find((o) => o.id === 'wyr.p.slink-into-darkness')!.data).toMatchObject({ cost: 1 })

    // Coiled Serpent: a normal success becomes a critical one, once, only after a Conceal to Engage switch
    const g = idsOf(base, 'A', 'wyr.gunner-webber')[0]!
    const shot = (order: 'engage' | 'conceal') => {
      let u = edit(place(place(base, g, -4, 0), boy, 2, 0), (st) => {
        st.operatives[g]!.order = order
        st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
      })
      u = take(activateOp(u, g, 'engage'), 'shoot').state
      u = take(u, u.pending!.options![0]!.id).state
      const d = dice(4, 1, 1, 1)
      const chosen = expectOk(step(u, u.pending!.options!.find((o) => o.id === boy)!.action, d))
      const first = play(chosen.state, d, {}, ['firefight.action', 'ploy.firefight'])
      const used = first.state.pending?.kind === 'ploy.firefight' && first.state.pending.options!.some((o) => o.id === 'wyr.p.coiled-serpent')
      return { first, d, used }
    }
    const sw = shot('conceal')
    expect(sw.used).toBe(true)
    const coiled = take(sw.first.state, 'wyr.p.coiled-serpent', sw.d)
    const rr = play(coiled.state, sw.d, { 'ploy.firefight': (p) => act.pass(p) })
    expect(evs([...coiled.events, ...rr.events], 'AttackRetained')[0]).toMatchObject({ normal: 0, crit: 1 })
    expect(shot('engage').used).toBe(false)
  })

  it('TEAM-WYR-021 actions and stats: two Shoots or Fights, Charge under Conceal, Icon Bearer control, one Soulsight token', () => {
    const base = wyr()
    const [k, locus, w, icon] = [opOf(base, 'A', 'wyr.kelermorph'), opOf(base, 'A', 'wyr.locus'), idsOf(base, 'A', 'wyr.warrior')[0]!, opOf(base, 'A', 'wyr.icon-bearer')]
    const op = (id: string) => base.operatives[id]!
    expect(maxRepeats(base, op(k), 'shoot', ['shoot'])).toBe(2)
    expect(maxRepeats(base, op(k), 'fight', ['fight'])).toBe(1)
    expect(maxRepeats(base, op(locus), 'fight', ['fight'])).toBe(2)
    expect(maxRepeats(base, op(w), 'shoot', ['shoot'])).toBe(1)
    // a kill by the Kelermorph is remembered for Heroic Inspiration; one by anybody else is not
    const b0 = opOf(base, 'B', 'kom.boy')
    const killed = (by: string) => withCtx(base, (ctx) => inflict(ctx, { targetId: b0, attackerId: by, weaponId: null, amount: 99, source: 'direct' })).state.effects.some((e) => e.source === 'wyr.kill')
    expect(killed(k)).toBe(true)
    expect(killed(w)).toBe(false)
    const ag = agents()
    expect(chargeUnderConceal(ag, ag.operatives[opOf(ag, 'A', 'wyr.sanctus-talon')]!)).toBe(true)
    expect(chargeUnderConceal(ag, ag.operatives[opOf(ag, 'A', 'wyr.sanctus-sniper')]!)).toBe(false)
    // the Icon Bearer counts one more at an objective, without changing its APL
    const m = base.markers.find((x) => x.kind === 'objective')!
    const on = place(place(base, icon, m.pos.x + 1, m.pos.z), w, m.pos.x - 1, m.pos.z)
    expect(markerControl(on, m).apl.A).toBe(3 + 2)
    expect(on.operatives[icon]!.aplMods).toBe(0)
    // one Soulsight token per team: the Talon taking the action moves the Sniper's token
    const [sn, ta] = [opOf(ag, 'A', 'wyr.sanctus-sniper'), opOf(ag, 'A', 'wyr.sanctus-talon')]
    const [b1, b2] = [opOf(ag, 'B', 'kom.boy'), opOf(ag, 'B', 'kom.slasha-boy')]
    let s = take(take(activateOp(ag, sn), `ability:wyr.a.familiars-soulsight-sniper:${b1}`).state, 'end').state
    expect(tokenCount(s, b1, 'wyr.soulsight', 'A')).toBe(1)
    expect(view(s, 'B').operatives[b1]!.tokens).toEqual(s.operatives[b1]!.tokens)
    s = take(activateOp(s, opOf(s, 'B', 'kom.grot'), 'conceal'), 'end').state
    s = take(activateOp(s, ta), `ability:wyr.a.familiars-soulsight-talon:${b2}`).state
    expect(tokenCount(s, b1, 'wyr.soulsight')).toBe(0)
    expect(tokenCount(s, b2, 'wyr.soulsight', 'A')).toBe(1)
  })
})
