// scout-squad engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-SS-nnn).
// Scout Squad are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { step, view } from '@/engine'
import { act } from '@/engine/actions'
import { effectiveRules, parseRules } from '@/engine/attack-common'
import { hasKeyword } from '@/engine/conditions'
import { footprintInsidePolygon, footprintOf } from '@/engine/footprint'
import { distToPolygon } from '@/engine/geometry'
import { attackStats, defenceStats, validTargets } from '@/engine/attack-common'
import { removeNow, tpUsesOf } from '@/engine/effects'
import { updateControl } from '@/engine/markers'
import { offersFor } from '@/engine/ploys'
import { effectiveApl, effectiveMove, markerRadius } from '@/engine/state'
import { runHook } from '@/engine/hooks'
import { defaultMarkerSpot, isScanned, markerProblem, markerSpots, redeployProblem } from '@/engine/teams/scout-squad'
import { tokensOnActivationStart, tokensOnTurningPointEnd } from '@/engine/tokens'
import { terrainOf } from '@/engine/terrain'
import { hasToken } from '@/engine/tokens'
import { abilityOffers, canCounteractWithOrder, maxRepeats, refreshFlags } from '@/engine/abilities'
import { actionAvailability, actionCost } from '@/engine/firefight'
import { shootableWeapons } from '@/engine/shoot'
import type { ScriptedRng } from '@/engine/rng'
import { providerExtraCoverSaves, providerMoveSurcharge, providerStealthy } from '@/engine/team-rules'
import { defaultRosterFor } from '@/engine/bundle'
import { arm, play, ranged, withWeapons, type Played } from '../../fixtures/attack'
import { expectOk, moved, place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { usesOf } from '@/engine/effects'
import { TEAM_ID } from '@/engine/teams/scout-squad'
import type { GameState, PendingDecision } from '@/engine/types'
import { enumerateLoadouts, loadBundle, loadoutCapProblems, validateRoster, type DatacardData } from '../../../src/data'
import { defaultAnswer } from '../../fixtures/helpers'
import { activateOp, hasOption, optionIds, passIt, realBundle, take, withCtx } from '../../fixtures/real'
import { A, B, bTurn, dice, edit, fsOffered, fsPick, goVia, open, shootAgain, shootAt, takePloy, toGambit, toPreBattle, usePlayed, withCp, withFx, withMarker, withToken } from './scout-squad.hooks'

const data = loadBundle()

/** Answer a free-point decision (marker.place with a point handler) at (x, z). */
const pointAt = (s: GameState, x: number, z: number) => step(s, { type: 'marker.place', seat: s.pending!.seat, decisionId: s.pending!.id, payload: { x, z } })
/** The sampled hint spots of a free-point decision. */
const hintSpots = (s: GameState) => (s.pending!.context.spots as { x: number; z: number }[]) ?? []

describe('TEAM-SS Scout Squad', () => {
  it('TEAM-SS-000 TEAM-SS-001 TEAM-SS-002 TEAM-SS-034 playable team, roster rules, printed loadouts and weapons, keywords on every card', () => {
    expect(TEAM_ID).toBe('scout-squad')
    const team = data.teams['scout-squad']!
    expect(team.playable).toBe(true)
    const cards = realBundle.datacards
    const ok = { leader: ['ss.sergeant'], main: ['ss.heavy-gunner', 'ss.heavy-gunner', 'ss.hunter', 'ss.sniper', 'ss.tracker', 'ss.warrior', 'ss.warrior', 'ss.warrior'] }
    expect(validateRoster(team, ok, cards as never).ok).toBe(true)
    // a second Hunter, Sniper or Tracker, and a tenth operative
    for (const dup of ['ss.hunter', 'ss.sniper', 'ss.tracker']) expect(validateRoster(team, { ...ok, main: [...ok.main.slice(0, 7), dup] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: [...ok.main, 'ss.warrior'] }, cards as never).ok).toBe(false)
    // a third Heavy Gunner is not on the list either way: eight Warriors are legal
    expect(validateRoster(team, { leader: ['ss.sergeant'], main: Array<string>(8).fill('ss.warrior') }, cards as never).ok).toBe(true)
    // each heavy weapon at most once
    const bolter = ['ss.w.heavy-bolter-focused', 'ss.w.heavy-bolter-sweeping']
    const missile = ['ss.w.missile-launcher-frag', 'ss.w.missile-launcher-krak']
    expect(loadoutCapProblems(team, [bolter, bolter], data.weaponGroups)).toHaveLength(1)
    expect(loadoutCapProblems(team, [bolter, missile], data.weaponGroups)).toEqual([])
    const count = (id: string) => enumerateLoadouts(data.byId[id] as DatacardData).length
    expect(['ss.sergeant', 'ss.heavy-gunner', 'ss.hunter', 'ss.sniper', 'ss.tracker', 'ss.warrior'].map(count)).toEqual([3, 2, 1, 1, 1, 3])
    // printed numbers
    const w = (id: string) => data.byId[id] as { atk: number; hit: string; dmg: { normal: number; crit: number }; rules: { rule: string; x?: number; inches?: number; only?: string }[] }
    expect(w('ss.w.astartes-shotgun').hit).toBe('2+')
    expect(w('ss.w.fists-sergeant').atk).toBe(4)
    expect(w('ss.w.fists').atk).toBe(3)
    expect(w('ss.w.sniper-rifle-mobile').rules).toEqual([])
    expect(w('ss.w.sniper-rifle-stationary').rules.map((r) => r.rule)).toEqual(['core.wr.devastating', 'core.wr.heavy', 'core.wr.silent'])
    expect(w('ss.w.heavy-bolter-focused')).toMatchObject({ atk: 5, hit: '3+', dmg: { normal: 4, crit: 5 } })
    expect(w('ss.w.missile-launcher-krak')).toMatchObject({ atk: 4, dmg: { normal: 5, crit: 7 } })
    expect(w('ss.w.combat-blade-equipment').atk).toBe(3)
    expect(w('ss.w.combat-blade').atk).toBe(4)
    expect(w('ss.w.chainsword')).toMatchObject({ atk: 5, dmg: { normal: 4, crit: 5 } })
    // stats: only the Sergeant has APL 3 and 11 wounds
    const stat = (id: string) => (data.byId[id] as DatacardData).stats
    expect(stat('ss.sergeant')).toMatchObject({ apl: 3, wounds: 11, save: '4+', move: 6 })
    for (const id of ['ss.heavy-gunner', 'ss.hunter', 'ss.sniper', 'ss.tracker', 'ss.warrior']) expect(stat(id)).toMatchObject({ apl: 2, wounds: 10, save: '4+', move: 6 })
    // keywords and the bolt / heavy weapon sets (T-SS.5)
    const s = open()
    for (const op of Object.values(s.operatives).filter((o) => o.seat === 'A')) {
      for (const k of ['SCOUT SQUAD', 'IMPERIUM', 'ADEPTUS ASTARTES']) expect(hasKeyword(s, op, k), `${op.name} ${k}`).toBe(true)
    }
    expect(hasKeyword(s, s.operatives[A(s, 'sergeant')]!, 'LEADER')).toBe(true)
    // Heavy (Dash only) is the core rule
    expect(parseRules(s.data.weapons['ss.w.heavy-bolter-focused']!.rules).heavy).toEqual({ only: 'dash' })
    void B
  })

  it('TEAM-SS-003 TEAM-SS-004 TEAM-SS-011 Forward Scouting is asked after set-up and before TP1, six picks end it, a pass ends it early, Devise Plan gives 1 CP, Spy is never offered; with Scout Squad on both seats the picks alternate from the set-up initiative holder and a pass leaves the other seat picking', () => {
    const s0 = toPreBattle()
    expect(s0.turningPoint).toBe(0)
    expect(s0.setup.step).toBe('preBattle')
    expect(s0.pending!.seat).toBe('A')
    expect(fsOffered(s0)).toEqual(['redeploy', 'reposition', 'tripAlarm', 'boobyTrap', 'tacticalManoeuvre', 'diversion', 'devisePlan', 'designateTarget'])
    const cp = s0.players.A.cp
    // Devise Plan: 1 CP at once, and the option is gone afterwards
    const s1 = fsPick(s0, 'devisePlan')
    expect(s1.players.A.cp).toBe(cp + 1)
    expect(fsOffered(s1)).not.toContain('devisePlan')
    // Reposition and Trip Alarm twice, the rest once (the picks are public for both seats)
    expect(usesOf(s1, 'A', 'ss.fs')).toBe(1)
    expect(view(s1, 'B').ledger.A.uses['ss.fs:devisePlan']).toBe(1)
    let s = fsPick(s1, 'tripAlarm')
    // a pass sets it up at the default spot (the sampled spot nearest an objective)
    const def = defaultMarkerSpot(s, 'A', 'tripAlarm')!
    s = passIt(s).state
    expect(s.markers.find((m) => m.equipmentId === 'ss.tripAlarm')!.pos).toEqual(def)
    expect(fsOffered(s)).toContain('tripAlarm')
    s = fsPick(s, 'tripAlarm')
    s = expectOk(pointAt(s, hintSpots(s)[1]!.x, hintSpots(s)[1]!.z)).state
    expect(fsOffered(s)).not.toContain('tripAlarm')
    expect(s.markers.filter((m) => m.equipmentId === 'ss.tripAlarm')).toHaveLength(2)
    // six picks: three more (Tactical Manoeuvre, Diversion, Designate Target) end the step
    s = fsPick(s, 'tacticalManoeuvre')
    s = fsPick(s, 'diversion')
    expect(usesOf(s, 'A', 'ss.fs')).toBe(5)
    s = fsPick(s, 'designateTarget')
    s = take(s, s.pending!.options![0]!.id).state
    expect(usesOf(s, 'A', 'ss.fs')).toBe(6)
    expect(s.setup.step).toBe('done')
    expect(s.turningPoint).toBe(1)
    // a pass ends the picks early; fewer than six is legal
    const p = passIt(toPreBattle()).state
    expect(p.setup.step).toBe('done')
    expect(p.turningPoint).toBe(1)
    expect(usesOf(p, 'A', 'ss.fs')).toBe(0)
    // ---- TEAM-SS-004: with Scout Squad on both seats the picks alternate one at a time from the set-up initiative holder
    {
      const s0 = toPreBattle({ teams: ['scout-squad', 'scout-squad'] })
      const first = s0.setup.setupInitiative!
      expect(s0.pending!.seat).toBe(first)
      const other = first === 'A' ? 'B' : 'A'
      let s = fsPick(s0, 'devisePlan')
      expect(s.pending!.seat).toBe(other)
      s = fsPick(s, 'devisePlan')
      expect(s.pending!.seat).toBe(first)
      // the second player passes after the first picked again
      s = fsPick(s, 'tacticalManoeuvre')
      expect(s.pending!.seat).toBe(other)
      s = passIt(s).state
      expect(s.pending!.seat).toBe(first)
      s = fsPick(s, 'diversion')
      expect(s.pending!.seat).toBe(first)
      s = fsPick(s, 'tripAlarm')
      s = passIt(s).state
      expect(s.pending!.seat).toBe(first)
      // the first player runs to six picks: the step ends
      s = fsPick(s, 'tripAlarm')
      s = passIt(s).state
      expect(usesOf(s, first, 'ss.fs')).toBe(5)
      s = fsPick(s, 'designateTarget')
      s = take(s, s.pending!.options![0]!.id).state
      expect(usesOf(s, first, 'ss.fs')).toBe(6)
      expect(s.setup.step).toBe('done')
    }
  })

  it('TEAM-SS-005 Redeploy re-places up to 3 of 9 operatives at spots wholly within the drop zone, each with a Conceal order; nobody twice, a fourth is not offered', () => {
    const s0 = toPreBattle()
    const zone = s0.map.dropZones.find((z) => z.id === s0.players.A.dropZoneId)!.polygon
    let s = fsPick(s0, 'redeploy')
    expect(s.pending!.context.step).toBe('redeploy.op')
    expect(s.pending!.options!.map((o) => o.id)).toHaveLength(10)
    const moved: string[] = []
    for (let i = 0; i < 3; i++) {
      const op = s.pending!.options!.find((o) => o.id !== 'done' && !moved.includes(o.id))!
      moved.push(op.id)
      s = take(s, op.id).state
      // a free-point decision: any legal point of the drop zone, the sampled spots are only hints
      expect(s.pending).toMatchObject({ kind: 'marker.place', canPass: true, context: { pointHook: 'ss.redeploy', operativeId: op.id } })
      const spots = hintSpots(s)
      expect(spots.length).toBeGreaterThan(1)
      for (const p of spots) expect(footprintInsidePolygon(footprintOf(s.operatives[op.id]!, p), zone)).toBe(true)
      const here = s.operatives[op.id]!.pos
      const hint = spots.find((p) => p.x !== here.x || p.z !== here.z)!
      // off the sampler grid: a quarter inch over, when that is legal too
      const off = { x: hint.x + 0.25, z: hint.z }
      const spot = redeployProblem(s, s.operatives[op.id]!, off) ? hint : off
      // outside the drop zone (the killzone centre) is refused with the reason
      expect(pointAt(s, 0, 0).rejection?.reason).toMatch(/drop zone/)
      s = expectOk(pointAt(s, spot.x, spot.z)).state
      const o = s.operatives[op.id]!
      expect(o.pos.x).toBe(spot.x)
      expect(o.pos.z).toBe(spot.z)
      expect(o.order).toBe('conceal')
      if (i < 2) {
        // those already moved are not offered again
        expect(s.pending!.context.step).toBe('redeploy.op')
        for (const m of moved) expect(s.pending!.options!.map((x) => x.id)).not.toContain(m)
      }
    }
    // three done: back to the main menu, Redeploy used up
    expect(s.pending!.context.preBattle).toBe(true)
    expect(fsOffered(s)).not.toContain('redeploy')
  })

  it('TEAM-SS-006 Forward Scouting Reposition: only operatives wholly within the drop zone, the free move may end 3" outside it but not 4" outside; Heavy Weapon Bipod still works in the first activation', () => {
    let s = edit(toPreBattle(), (st) => void (st.map = { ...st.map, features: [] }))
    const zone = s.map.dropZones.find((z) => z.id === s.players.A.dropZoneId)!.polygon
    s = fsPick(s, 'reposition')
    expect(s.pending!.context.step).toBe('reposition.op')
    const ids = s.pending!.options!.map((o) => o.id)
    expect(ids).toHaveLength(9)
    for (const id of ids) expect(footprintInsidePolygon(footprintOf(s.operatives[id]!), zone)).toBe(true)
    // an operative 10" in from the zone edge x = -9 stands at x -10: 3.5" past the edge is refused, 2.3" past it is fine
    const warrior = Object.values(s.operatives).find((o) => o.seat === 'A' && o.pos.x === -10 && o.pos.z === 0.5)!
    s = take(s, warrior.id).state
    expect(s.pending!.kind).toBe('move.path')
    const far = step(s, act.path(s.pending!, [{ x: -5.5, z: 0.5 }]))
    expect(far.rejection?.reason).toMatch(/3"/)
    const near = step(s, act.path(s.pending!, [{ x: -6.7, z: 0.5 }]))
    expect(near.rejection).toBeUndefined()
    s = near.state
    expect(s.operatives[warrior.id]!.pos.x).toBe(-6.7)
    expect(distToPolygon(s.operatives[warrior.id]!.pos, zone)).toBeCloseTo(2.3, 5)
    // the pick is spent, the marker effect is gone, the main menu is back
    expect(s.pending!.context.preBattle).toBe(true)
    expect(usesOf(s, 'A', 'ss.fs:reposition')).toBe(1)
    expect(s.effects.some((e) => e.kind === 'ss.fsRepos')).toBe(false)
    // the same operative may be picked again while it is wholly within the zone only: it no longer is
    s = fsPick(s, 'reposition')
    expect(s.pending!.options!.map((o) => o.id)).not.toContain(warrior.id)
    // the Heavy Gunner (A2 with the heavy bolter) repositions 6" east; its free move is outside any activation
    const hg = A(s, 'heavy-gunner')
    s = take(s, hg).state
    s = step(s, act.path(s.pending!, [{ x: -7, z: -9.5 }])).state
    expect(s.operatives[hg]!.movedThisActivation).toBeGreaterThan(0)
    s = passIt(s).state
    expect(s.setup.step).toBe('done')
    let g = s
    const rng = dice(6, 1, 6, 1)
    for (let i = 0; i < 400 && g.pending && g.pending.kind !== 'firefight.activate'; i++) g = step(g, defaultAnswer(g), rng).state
    expect(g.pending!.kind).toBe('firefight.activate')
    const t = activateOp(g, hg)
    expect(t.operatives[hg]!.movedThisActivation).toBe(0)
    const rules = parseRules(effectiveRules(t, t.operatives[hg]!, t.data.weapons['ss.w.heavy-bolter-focused']!, 'shoot', B(t, 'boy')))
    expect(rules.ceaseless).toBe(true)
  })

  it('TEAM-SS-007 Trip Alarm: spots more than 6" from the opponent drop zone; in TP1 and TP2 a Scout may select a Conceal enemy behind Light terrain within 2" of it (Seek), not at 3"; gone after the Ready step of TP3', () => {
    let p = toPreBattle()
    const zoneB = p.map.dropZones.find((z) => z.id === p.players.B.dropZoneId)!.polygon
    p = fsPick(p, 'tripAlarm')
    expect(p.pending).toMatchObject({ kind: 'marker.place', context: { pointHook: 'ss.marker', kind: 'tripAlarm' } })
    const spots = hintSpots(p)
    expect(spots.length).toBeGreaterThan(4)
    for (const o of spots) expect(distToPolygon(o, zoneB)).toBeGreaterThan(6)
    // inside the opponent's drop zone: refused with the reason
    const inB = { x: zoneB.reduce((n, v) => n + v.x, 0) / zoneB.length, z: zoneB.reduce((n, v) => n + v.z, 0) / zoneB.length }
    expect(pointAt(p, inB.x, inB.z).rejection?.reason).toMatch(/6 inches/)
    // any legal point, off the sampler grid
    const free = [0.3, -0.3, 0.7].map((d) => ({ x: spots[0]!.x + d, z: spots[0]!.z })).find((q) => !markerProblem(p, 'A', 'tripAlarm', q)) ?? spots[0]!
    p = expectOk(pointAt(p, free.x, free.z)).state
    expect(p.markers.find((m) => m.equipmentId === 'ss.tripAlarm')).toMatchObject({ owner: 'A', pos: { x: free.x, z: free.z } })
    // Seek on a Conceal enemy behind a Light wall
    const w = feature('ss-wall', part('ss-wall.a', rect(3, 3.4, -2, 2), 1, ['light']))
    const base = edit(open(), (st) => {
      st.map = { ...st.map, features: [w] }
      for (const o of Object.values(st.operatives)) o.order = 'engage'
      st.operatives[B(open(), 'boy')]!.order = 'conceal'
    })
    const warrior = A(base, 'warrior')
    const boy = B(base, 'boy')
    const targets = (st: GameState) => validTargets(st, st.operatives[warrior]!, 'ss.w.boltgun').map((t) => t.id)
    const at = (st: GameState) => place(place(st, warrior, -2, 0), boy, 4, 0)
    expect(targets(at(base))).not.toContain(boy)
    expect(targets(at(withMarker(base, 'ss.tripAlarm', 5, 0)))).toContain(boy)
    // 3" from the enemy's base (more than 2" from its edge): not selectable
    expect(targets(at(withMarker(base, 'ss.tripAlarm', 7.5, 0)))).not.toContain(boy)
    const seeking = at(withMarker(base, 'ss.tripAlarm', 5, 0))
    expect(parseRules(effectiveRules(seeking, seeking.operatives[warrior]!, seeking.data.weapons['ss.w.boltgun']!, 'shoot', boy)).seek).toBe(true)
    // turning point 3 and the Ready step that removes it
    expect(targets(edit(seeking, (st) => void (st.turningPoint = 3)))).not.toContain(boy)
    const ready = (n: number) => withCtx(edit(seeking, (st) => void (st.turningPoint = n)), (ctx) => runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: n } })).state
    expect(ready(2).markers.some((m) => m.equipmentId === 'ss.tripAlarm')).toBe(true)
    expect(ready(3).markers.some((m) => m.equipmentId === 'ss.tripAlarm')).toBe(false)
  })

  it('TEAM-SS-008 Booby Trap: spots clear of markers, access points and Accessible terrain; an enemy moving past takes 2D3, the marker goes and its move stops where it came within control range; friends never set it off', () => {
    let p = toPreBattle()
    const zoneB = p.map.dropZones.find((z) => z.id === p.players.B.dropZoneId)!.polygon
    p = fsPick(p, 'boobyTrap')
    const accessible = terrainOf(p.map).solids.filter((sd) => sd.accessible || sd.partId.includes('door'))
    for (const pt of hintSpots(p)) {
      expect(distToPolygon(pt, zoneB)).toBeGreaterThan(6)
      for (const m of p.markers) expect(Math.hypot(m.pos.x - pt.x, m.pos.z - pt.z) - markerRadius(m)).toBeGreaterThan(2)
      for (const sd of accessible) expect(distToPolygon(pt, sd.polygon)).toBeGreaterThan(2)
    }
    // within 2" of an objective marker: refused with the reason
    const obj = p.markers.find((m) => m.kind === 'objective')!
    expect(pointAt(p, obj.pos.x + markerRadius(obj) + 1.5, obj.pos.z).rejection?.reason).toMatch(/2 inches|6 inches|terrain|killzone/)
    expect(markerProblem(p, 'A', 'boobyTrap', { x: obj.pos.x + markerRadius(obj) + 1.5, z: obj.pos.z })).not.toBeNull()
    // the bot passes: the trap goes to the default spot
    p = passIt(p).state
    expect(p.markers.filter((m) => m.equipmentId === 'ss.boobyTrap')).toHaveLength(1)
    expect(fsOffered(p)).not.toContain('boobyTrap')
    // the trap at (5, 0); the Boy walks west in two legs and is set off by the first
    const s = withMarker(open(), 'ss.boobyTrap', 5, 0)
    const boy = B(s, 'boy')
    const sg = A(s, 'sergeant')
    const turnB = take(activateOp(place(place(s, boy, 9, 0), sg, -6, 9), sg), 'end').state
    const hp = turnB.operatives[boy]!.wounds
    const r = play(take(activateOp(turnB, boy), 'reposition', dice(6, 6)).state, dice(6, 6), goVia([6, 0], [3, 0]), ['ploy.firefight', 'firefight.action'])
    const after = r.state.operatives[boy]!
    expect(r.state.markers.some((m) => m.equipmentId === 'ss.boobyTrap')).toBe(false)
    expect(hp - after.wounds).toBe(6)
    expect([after.pos.x, after.pos.z]).toEqual([6, 0])
    expect(r.events.some((e) => e.type === 'MineTriggered')).toBe(true)
    // the same walk without the trap ends at the far end; a friend walking through leaves the trap alone
    const clear = edit(turnB, (st) => void (st.markers = st.markers.filter((m) => m.equipmentId !== 'ss.boobyTrap')))
    expect(play(take(activateOp(clear, boy), 'reposition').state, dice(), goVia([6, 0], [3, 0]), ['ploy.firefight', 'firefight.action']).state.operatives[boy]!.pos.x).toBe(3)
    const friend = A(s, 'warrior')
    const walked = play(take(activateOp(place(place(s, friend, 2, 0), boy, 12, 5), friend), 'reposition').state, dice(), goVia([4, 0], [7, 0]), ['ploy.firefight', 'firefight.action']).state
    expect(walked.markers.some((m) => m.equipmentId === 'ss.boobyTrap')).toBe(true)
    expect(walked.operatives[friend]!.pos.x).toBe(7)
  })

  it('TEAM-SS-009 TEAM-SS-010 Tactical Manoeuvre (0 CP, twice per battle, +1 APL) and Diversion (0 CP, once, -1 APL to an enemy within 6" of a killzone edge) need their Forward Scouting pick', () => {
    // without the picks neither gambit is ever offered
    const none = toGambit()
    expect(offersFor(none, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).filter((o) => o.ployId.startsWith('ss.p.tactical') || o.ployId.startsWith('ss.p.diversion'))).toEqual([])
    let s = fsPick(toPreBattle(), 'tacticalManoeuvre')
    s = fsPick(s, 'diversion')
    s = passIt(s).state
    const rng = dice(6, 1, 6, 1)
    for (let i = 0; i < 400 && s.pending && s.pending.kind !== 'strategy.gambit'; i++) s = step(s, defaultAnswer(s), rng).state
    expect(s.pending!.kind).toBe('strategy.gambit')
    const ids = (st: GameState) => st.pending!.options!.map((o) => o.id)
    const a3 = Object.values(s.operatives).find((o) => o.seat === 'A' && o.datacardId === 'ss.heavy-gunner')!.id
    expect(ids(s)).toContain(`ss.p.tactical-manoeuvre:${a3}`)
    const foe = Object.values(s.operatives).filter((o) => o.seat === 'B')[0]!.id
    expect(ids(s)).toContain(`ss.p.diversion:${foe}`)
    const cp = s.players.A.cp
    const t = take(s, `ss.p.tactical-manoeuvre:${a3}`, rng).state
    expect(t.players.A.cp).toBe(cp)
    expect(effectiveApl(t.operatives[a3]!)).toBe(3)
    // it is gone for the rest of this turning point; offered in turning point 2, used up after the second use
    const tp2 = edit(t, (st) => {
      st.turningPoint = 2
      st.ledger.A.tp = []
    })
    const tm = (st: GameState) => offersFor(st, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).filter((o) => o.ployId === 'ss.p.tactical-manoeuvre')
    expect(tm(tp2).length).toBeGreaterThan(0)
    const used2 = usePlayed(tp2, 'ss.p.tactical-manoeuvre', { window: 'strategy.gambit' }, a3)
    const tp3 = edit(used2, (st) => {
      st.turningPoint = 3
      st.ledger.A.tp = []
    })
    expect(tm(tp3)).toEqual([])
    // Diversion: an enemy 7" from every edge is not offered; once it is used it is gone
    const dv = (st: GameState) => offersFor(st, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).filter((o) => o.ployId === 'ss.p.diversion').map((o) => o.param)
    expect(dv(t)).toContain(foe)
    expect(dv(place(t, foe, 7.8, 0))).not.toContain(foe)
    expect(dv(place(t, foe, 8.5, 5))).toContain(foe)
    const hit = usePlayed(t, 'ss.p.diversion', { window: 'strategy.gambit' }, foe)
    expect(effectiveApl(hit.operatives[foe]!)).toBe(hit.operatives[foe]!.apl - 1)
    expect(hit.players.A.cp).toBe(t.players.A.cp)
    expect(dv(edit(hit, (st) => void (st.ledger.A.tp = [])))).toEqual([])
  })

  it('TEAM-SS-012 Designate Target gives an enemy the battle-long Target token: a Scout shooting, fighting or retaliating against it may re-roll one attack die; against another enemy none; the token goes when the enemy does', () => {
    let s = fsPick(toPreBattle(), 'designateTarget')
    expect(s.pending!.options!.length).toBe(11)
    const foe = s.pending!.options![0]!.id
    s = take(s, foe).state
    expect(hasToken(s, foe, 'ss.target', 'A')).toBe(true)
    expect(view(s, 'B').operatives[foe]!.tokens).toEqual([expect.objectContaining({ kind: 'ss.target', owner: 'A' })])
    s = passIt(s).state
    const other = Object.values(s.operatives).find((o) => o.seat === 'B' && o.id !== foe)!.id
    const sg = A(s, 'sergeant')
    const ids = (target: string, weapon: string, kind: 'shoot' | 'fight') => attackStats(s, sg, weapon, target, { kind }).grants.map((g) => g.id)
    expect(ids(foe, 'ss.w.astartes-shotgun', 'shoot')).toContain('ss.designate')
    expect(ids(foe, 'ss.w.fists-sergeant', 'fight')).toContain('ss.designate')
    expect(ids(other, 'ss.w.astartes-shotgun', 'shoot')).not.toContain('ss.designate')
    // a Kommando shooting a Scout gets nothing from the token
    expect(attackStats(s, foe, s.operatives[foe]!.weapons[0]!, sg, { kind: 'shoot' }).grants.map((g) => g.id)).not.toContain('ss.designate')
    const gone = withCtx(s, (ctx) => {
      removeNow(ctx, foe)
      updateControl(ctx)
    }).state
    expect(Object.values(gone.operatives).some((o) => (o.tokens ?? []).some((t) => t.kind === 'ss.target'))).toBe(false)
  })

  it('TEAM-SS-013 TEAM-SS-014 TEAM-SS-015 ASTARTES (two Shoots or two Fights, counteract on any order), Guidance and Experience (0 AP, once per activation, +1 APL) and Heavy Weapon Bipod (Ceaseless when it has not moved)', () => {
    const s = open()
    const sg = A(s, 'sergeant')
    const wr = A(s, 'warrior')
    const hg = A(s, 'heavy-gunner')
    const boy = B(s, 'boy')
    const op = (st: GameState, id: string) => st.operatives[id]!
    // ASTARTES: either two Shoots or two Fights
    expect(maxRepeats(s, op(s, sg), 'shoot', [])).toBe(2)
    expect(maxRepeats(s, op(s, sg), 'fight', ['shoot', 'shoot'])).toBe(1)
    expect(maxRepeats(s, op(s, sg), 'shoot', ['fight', 'fight'])).toBe(1)
    expect(maxRepeats(s, op(s, sg), 'shoot', ['shoot', 'fight'])).toBe(2)
    expect(maxRepeats(s, op(s, wr), 'shoot', ['shoot'])).toBe(1)
    expect(maxRepeats(s, op(s, wr), 'fight', ['fight'])).toBe(1)
    const conceal = edit(s, (st) => void (st.operatives[sg]!.order = st.operatives[wr]!.order = 'conceal'))
    expect(canCounteractWithOrder(conceal, op(conceal, sg))).toBe(true)
    expect(canCounteractWithOrder(conceal, op(conceal, wr))).toBe(false)
    // two real Shoots in one activation, and a third is not on offer (APL 3: one AP left, but Fight needs an enemy in reach)
    const first = shootAt(place(place(s, sg, 0, 0), boy, 5, 0), sg, 'ss.w.astartes-shotgun', boy, dice(1, 1, 1, 1))
    expect(hasOption(first.state, 'shoot')).toBe(true)
    const two = shootAgain(first.state, 'ss.w.astartes-shotgun', boy, dice(1, 1, 1, 1))
    expect(two.state.firefight.activation!.apSpent).toBe(2)
    expect(maxRepeats(two.state, op(two.state, sg), 'shoot', ['shoot', 'shoot'])).toBe(2)
    expect(actionAvailability(two.state, op(two.state, sg), 'shoot', two.state.firefight.activation)).not.toBeNull()
    // GUIDANCE AND EXPERIENCE: a 0 AP action naming another Scout, once per activation, never itself
    const t = activateOp(s, sg)
    const gid = (id: string) => `ability:ss.a.guidance-and-experience:${id}`
    const offered = optionIds(t).filter((i) => i.startsWith('ability:ss.a.guidance-and-experience'))
    expect(offered).toHaveLength(8)
    expect(offered).not.toContain(gid(sg))
    const used = take(t, gid(wr)).state
    expect(effectiveApl(used.operatives[wr]!)).toBe(3)
    expect(used.firefight.activation!.apSpent).toBe(0)
    expect(optionIds(used).some((i) => i.startsWith('ability:ss.a.guidance-and-experience'))).toBe(false)
    // an operative already at +1 gains nothing more; never as a counteraction (needs exactly 1 AP)
    const boosted = edit(t, (st) => void (st.operatives[wr]!.aplMods = 1))
    expect(effectiveApl(take(boosted, gid(wr)).state.operatives[wr]!)).toBe(3)
    expect(abilityOffers(t, op(t, sg), { ...t.firefight.activation!, counteract: true }).some((o) => o.abilityId === 'ss.a.guidance-and-experience')).toBe(false)
    // HEAVY WEAPON BIPOD
    const ready = activateOp(place(place(s, hg, 0, 0), boy, 5, 0), hg)
    const rules = (st: GameState, weapon: string, kind: 'shoot' | 'fight' = 'shoot') => parseRules(effectiveRules(st, op(st, hg), st.data.weapons[weapon]!, kind, boy))
    expect(rules(ready, 'ss.w.heavy-bolter-focused').ceaseless).toBe(true)
    expect(rules(ready, 'ss.w.bolt-pistol').ceaseless).toBe(true)
    expect(rules(ready, 'ss.w.fists', 'fight').ceaseless).toBe(false)
    const dashed = edit(ready, (st) => void (st.firefight.activation!.performed = ['dash']))
    expect(rules(dashed, 'ss.w.heavy-bolter-focused').ceaseless).toBe(false)
    const counter = edit(dashed, (st) => void (st.firefight.activation!.counteract = true))
    expect(rules(counter, 'ss.w.heavy-bolter-focused').ceaseless).toBe(true)
    // only the Heavy Gunner has it
    expect(parseRules(effectiveRules(ready, op(ready, wr), ready.data.weapons['ss.w.boltgun']!, 'shoot', boy)).ceaseless).toBe(false)
  })

  it('TEAM-SS-016 TEAM-SS-017 Grapnel Launcher (every climb costs 2"), Grapnel Assault (a Charge that climbs gives Lethal 3+) and the Sniper Camo Cloak (ignores Saturate, +1 cover improvement)', () => {
    const mid = feature('mid', part('mid.a', rect(-5, -2, -2, 2), 3, ['vantage']))
    const low = feature('low', part('low.a', rect(2, 5, -2, 2), 1, ['vantage']))
    const base = edit(open(), (st) => void (st.map = { ...st.map, features: [mid, low] }))
    const hunter = A(base, 'hunter')
    const wr = A(base, 'warrior')
    const cost = (who: string, x: number, y: number) => {
      const st = take(activateOp(place(base, who, 0, 0), who), 'reposition').state
      return moved(expectOk(step(st, act.path(st.pending!, [{ x, z: 0, y }])))).cost
    }
    // a 3" climb: 3" across + 3" climb for anyone, 3" + 2" for the Hunter; a 1" climb is 2" for both
    expect(cost(wr, -3, 3)).toBe(6)
    expect(cost(hunter, -3, 3)).toBe(5)
    expect(cost(wr, 3, 1)).toBe(5)
    expect(cost(hunter, 3, 1)).toBe(5)
    const hop = (id: string, climbs: number[]) => providerMoveSurcharge(base, base.operatives[id]!, 'reposition', [], { horizontal: 0, accessible: 0, climb: climbs.reduce((n, c) => n + c, 0), drop: 0, climbs })
    expect(hop(hunter, [3, 4])).toBe(-3)
    expect(hop(hunter, [2])).toBe(0)
    expect(hop(wr, [3, 4])).toBe(0)
    // GRAPNEL ASSAULT: a Charge that climbs, drops or jumps gives melee weapons Lethal 3+ for the activation
    const wall = feature('block', part('block.a', rect(-4, -2.5, -2, 2), 1, ['vantage']))
    const charge = (waypoints: { x: number; z: number; y?: number }[], foeX: number) => {
      const st = edit(place(place(edit(base, (x) => void (x.map = { ...x.map, features: [wall] })), hunter, 0, 0), B(base, 'boy'), foeX, 0), (x) => void (x.operatives[B(base, 'boy')]!.order = 'engage'))
      const c = take(activateOp(st, hunter), 'charge').state
      return step(c, act.path(c.pending!, waypoints))
    }
    const lethal = (st: GameState) => parseRules(effectiveRules(st, st.operatives[hunter]!, st.data.weapons['ss.w.combat-blade']!, 'fight', B(base, 'boy'))).lethal
    const climbed = charge([{ x: -3, z: 0, y: 1 }, { x: -4.6, z: 0, y: 0 }], -6)
    expect(climbed.rejection).toBeUndefined()
    expect(lethal(climbed.state)).toBe(3)
    expect(parseRules(effectiveRules(climbed.state, climbed.state.operatives[hunter]!, climbed.state.data.weapons['ss.w.bolt-pistol']!, 'shoot', B(base, 'boy'))).lethal).toBeNull()
    // a flat Charge does not
    const flat = charge([{ x: 4, z: 0, y: 0 }], 5.4)
    expect(flat.rejection).toBeUndefined()
    expect(lethal(flat.state)).toBeNull()
    // CAMO CLOAK (Sniper): Saturate ignored, one more cover improvement
    const sn = A(base, 'sniper')
    const boy = B(base, 'boy')
    const burna = base.data.weapons['kom.w.burna-standard']!
    const saturate = (id: string) => parseRules(effectiveRules(base, base.operatives[boy]!, burna, 'shoot', id)).saturate
    expect(saturate(wr)).toBe(true)
    expect(saturate(sn)).toBe(false)
    expect(providerStealthy(base, base.operatives[sn]!)).toBe(1)
    expect(providerStealthy(base, base.operatives[wr]!)).toBe(0)
  })

  it('TEAM-SS-018 TEAM-SS-019 TEAM-SS-020 TEAM-SS-021 Optics, Track Enemy (8", no sight needed, Seek Light), Auspex Scan (live 8" bubble) and Adaptive Equipment (a Smoke and a Stun Grenade per TP for Warriors)', () => {
    const s = open()
    const sn = A(s, 'sniper')
    const tk = A(s, 'tracker')
    const wr = A(s, 'warrior')
    const boy = B(s, 'boy')
    const status = (st: GameState, shooter: string, target = boy) => {
      const d = { obscured: true, inCover: false }
      runHook('target.status', { seat: 'A', state: st, operativeId: shooter, targetId: target, data: d })
      return d.obscured
    }
    // OPTICS: the Sniper's own shots ignore obscured; not in an enemy control range; the token ends with its next activation
    const at = place(place(s, sn, 0, 0), boy, 6, 0)
    const optics = take(activateOp(at, sn), 'ability:ss.a.optics').state
    expect(optics.firefight.activation!.apSpent).toBe(1)
    const token = optics.operatives[sn]!.tokens!.find((t) => t.kind === 'ss.optics')!
    expect(token.expires).toEqual(['sourceNextActivation', 'sourceIncapacitated'])
    expect(status(optics, sn)).toBe(false)
    expect(status(optics, wr)).toBe(true)
    expect(status(at, sn)).toBe(true)
    expect(optionIds(activateOp(place(place(s, sn, 0, 0), boy, 1.4, 0), sn)).some((i) => i.startsWith('ability:ss.a.optics'))).toBe(false)
    // TRACK ENEMY: an enemy within 8" even behind a Heavy wall (not visible), none at 9"
    const wall = feature('ss-heavy', part('ss-heavy.a', rect(3, 3.5, -3, 3), 3, ['heavy']))
    const hidden = edit(place(place(s, tk, 0, 0), boy, 8, 0), (st) => void (st.map = { ...st.map, features: [wall] }))
    const tid = (id: string) => `ability:ss.a.track-enemy:${id}`
    expect(optionIds(activateOp(hidden, tk))).toContain(tid(boy))
    expect(optionIds(activateOp(place(hidden, boy, 9.2, 0), tk))).not.toContain(tid(boy))
    const tracked = take(activateOp(hidden, tk), tid(boy)).state
    expect(tracked.operatives[boy]!.tokens!.find((t) => t.kind === 'ss.trackEnemy')).toMatchObject({ owner: 'A', expires: ['turningPointEnd'] })
    const sl = (st: GameState, shooter: string, target: string) => parseRules(effectiveRules(st, st.operatives[shooter]!, st.data.weapons['ss.w.boltgun']!, 'shoot', target)).seekLight
    expect(sl(tracked, wr, boy)).toBe(true)
    expect(sl(tracked, wr, B(s, 'breacha-boy'))).toBe(false)
    // a Conceal enemy behind Light terrain becomes selectable; its cover save is kept
    const light = feature('ss-light', part('ss-light.a', rect(3, 3.4, -2, 2), 1, ['light']))
    const lit = edit(place(place(place(tracked, wr, -2, 0), boy, 5, 0), tk, 0, 7), (st) => {
      st.map = { ...st.map, features: [light] }
      st.operatives[boy]!.order = 'conceal'
      st.operatives[wr]!.order = 'engage'
    })
    expect(validTargets(lit, lit.operatives[wr]!, 'ss.w.boltgun').map((t) => t.id)).toContain(boy)
    const untracked = edit(lit, (st) => void (st.operatives[boy]!.tokens = []))
    expect(validTargets(untracked, untracked.operatives[wr]!, 'ss.w.boltgun').map((t) => t.id)).not.toContain(boy)
    // the token goes at the end of the turning point
    expect(withCtx(tracked, (ctx) => tokensOnTurningPointEnd(ctx)).state.operatives[boy]!.tokens ?? []).toEqual([])
    // AUSPEX SCAN: enemies within 8" of the Tracker (live) are not obscured for Scout shooters; an Optics Sniper also gets Seek Light
    const scan = take(activateOp(place(place(s, tk, 0, 0), boy, 6, 0), tk), 'ability:ss.a.auspex-scan').state
    expect(isScanned(scan, scan.operatives[boy]!, 'A')).toBe(true)
    expect(isScanned(place(scan, boy, 10, 0), place(scan, boy, 10, 0).operatives[boy]!, 'A')).toBe(false)
    expect(status(scan, wr)).toBe(false)
    expect(status(place(scan, boy, 10, 0), wr)).toBe(true)
    const scanned = withToken(scan, sn, 'ss.optics')
    const sniperSl = (st: GameState, who: string) => parseRules(effectiveRules(st, st.operatives[who]!, st.data.weapons['ss.w.sniper-rifle-mobile']!, 'shoot', boy)).seekLight
    const rifle = (st: GameState, id: string) => parseRules(effectiveRules(st, st.operatives[id]!, st.data.weapons['ss.w.boltgun']!, 'shoot', boy)).seekLight
    expect(sniperSl(scanned, sn)).toBe(true)
    expect(rifle(scanned, wr)).toBe(false)
    expect(sniperSl(withToken(place(scan, boy, 10, 0), sn, 'ss.optics'), sn)).toBe(false)
    const gone = withCtx(edit(scan, (st) => void (st.operatives[tk]!.wounds = 0)), (ctx) => removeNow(ctx, tk)).state
    expect(isScanned(gone, gone.operatives[boy]!, 'A')).toBe(false)
    // ADAPTIVE EQUIPMENT: one Warrior throws a Smoke Grenade and another a Stun Grenade each TP, no equipment taken
    const [w1, w2] = Object.values(s.operatives).filter((o) => o.seat === 'A' && o.datacardId === 'ss.warrior').map((o) => o.id) as [string, string]
    const u = place(place(place(s, w1, 0, 0), boy, 5, 0), w2, 0, 2)
    const smokeId = 'core.a.smoke-grenade'
    const has = (st: GameState, id: string, ability: string) => abilityOffers(st, st.operatives[id]!, null).some((o) => o.abilityId === ability)
    expect(has(u, w1, smokeId)).toBe(true)
    expect(has(u, tk, smokeId)).toBe(false)
    const thrown = take(activateOp(u, w1), `ability:${smokeId}`).state
    const smoke = take(thrown, thrown.pending!.options![0]!.id).state
    expect(tpUsesOf(smoke, 'A', `ownTp:${smokeId}`)).toBe(1)
    expect(has(smoke, w2, smokeId)).toBe(false)
    expect(has(smoke, w2, 'core.a.stun-grenade')).toBe(true)
  })

  it('TEAM-SS-022 TEAM-SS-023 TEAM-SS-024 TEAM-SS-025 Guerrilla Engagement, Ambush (Balanced or Ceaseless, Relentless with the Bipod), Adaptable Training and Stealth Relocation', () => {
    const base = open()
    const wr = A(base, 'warrior')
    const hg = A(base, 'heavy-gunner')
    const boy = B(base, 'boy')
    const other = B(base, 'breacha-boy')
    // GUERRILLA ENGAGEMENT: in cover, and every enemy that can see the Scout is more than 6" away
    const guerrilla = withFx(place(place(base, wr, 0, 0), boy, 8, 0), { source: 'ss.p.guerrilla-engagement' })
    const grants = (st: GameState, cover: boolean) => {
      const x = edit(st, (y) => void (y.attack = { kind: 'shoot', stage: 'resolve', operativeId: boy, seat: 'B', weaponId: 'kom.w.slugga', pointBlank: false, targets: [wr], candidates: [], index: 0, seq: { targetId: wr, cover } as never, incapacitated: [], stunned: [], inherit: null, windows: [] }))
      return defenceStats(x, wr, boy, 'kom.w.slugga', parseRules(x.data.weapons['kom.w.slugga']!.rules), false).grants.map((g) => g.id)
    }
    expect(grants(guerrilla, true)).toEqual(['ss.guerrilla'])
    expect(grants(guerrilla, false)).toEqual([])
    expect(grants(place(guerrilla, other, 4, 1), true)).toEqual([])
    expect(grants(base, true)).toEqual([])
    // AMBUSH: Conceal to Engage at activation start, or unseen then
    const ambush = withFx(place(place(base, wr, 0, 0), boy, 6, 0), { source: 'ss.p.ambush' })
    const rules = (st: GameState, who: string, weapon: string, kind: 'shoot' | 'fight' = 'shoot') => parseRules(effectiveRules(st, st.operatives[who]!, st.data.weapons[weapon]!, kind, boy))
    const flipped = activateOp(ambush, wr, 'engage')
    expect(rules(flipped, wr, 'ss.w.boltgun')).toMatchObject({ balanced: true, ceaseless: false })
    expect(rules(flipped, wr, 'ss.w.fists', 'fight').balanced).toBe(true)
    const spent = edit(flipped, (st) => void (st.operatives[boy]!.ready = false))
    expect(rules(spent, wr, 'ss.w.boltgun')).toMatchObject({ balanced: false, ceaseless: true })
    // retaliating or counteracting gets nothing
    const retaliating = edit(flipped, (st) => void (st.attack = { kind: 'fight', stage: 'fightWeapon', operativeId: boy, seat: 'B', weaponId: null, pointBlank: false, targets: [wr], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] } as never))
    expect(rules(retaliating, wr, 'ss.w.fists', 'fight').balanced).toBe(false)
    expect(rules(edit(flipped, (st) => void (st.firefight.activation!.counteract = true)), wr, 'ss.w.boltgun').balanced).toBe(false)
    // started Engaged and seen: nothing; started Engaged with nobody able to see it: Balanced
    const seen = activateOp(edit(ambush, (st) => void (st.operatives[wr]!.order = 'engage')), wr, 'engage')
    expect(rules(seen, wr, 'ss.w.boltgun').balanced).toBe(false)
    const wall = feature('ss-heavy', part('ss-heavy.a', rect(2.5, 3, -6, 6), 3, ['heavy']))
    const unseen = edit(ambush, (st) => {
      st.map = { ...st.map, features: [wall] }
      st.operatives[wr]!.order = 'engage'
      for (const o of Object.values(st.operatives)) if (o.seat === 'B' && o.id !== boy) o.status = 'removed'
    })
    expect(rules(activateOp(unseen, wr, 'engage'), wr, 'ss.w.boltgun').balanced).toBe(true)
    // the Bipod and Ambush together: Relentless against an expended target
    const heavy = edit(activateOp(withFx(place(place(base, hg, 0, 0), boy, 6, 0), { source: 'ss.p.ambush' }), hg, 'engage'), (st) => void (st.operatives[boy]!.ready = false))
    expect(rules(heavy, hg, 'ss.w.heavy-bolter-focused')).toMatchObject({ ceaseless: true, relentless: true })
    // ADAPTABLE TRAINING: a D3, then up to that many Scouts more than 4" from every enemy change order
    const g0 = withCp(toGambit(), 3)
    const a9 = Object.values(g0.operatives).filter((o) => o.seat === 'A').at(-1)!
    const near = place(g0, Object.values(g0.operatives).find((o) => o.seat === 'B')!.id, a9.pos.x + 3, a9.pos.z)
    expect(optionIds(near)).toContain('ss.p.adaptable-training')
    let t = take(near, 'ss.p.adaptable-training', dice(5)).state
    expect(t.pending!.kind).toBe('ability.choice')
    const choices = t.pending!.options!.map((o) => o.id)
    expect(choices).toContain('done')
    expect(choices).not.toContain(a9.id)
    const [p1, p2, p3] = choices.filter((c) => c !== 'done').slice(0, 3) as [string, string, string]
    const before = [p1, p2, p3].map((id) => t.operatives[id]!.order)
    t = take(t, p1).state
    t = take(t, p2).state
    expect(t.operatives[p1]!.order).not.toBe(before[0])
    expect(t.operatives[p2]!.order).not.toBe(before[1])
    t = take(t, p3).state // D3 = 3: the third pick ends it
    expect(t.operatives[p3]!.order).not.toBe(before[2])
    expect(t.pending!.kind).toBe('strategy.gambit')
    // STEALTH RELOCATION: not in turning point 1; later D3 Conceal Scouts more than 4" away take a free Dash, an Engaged one is not offered
    expect(offersFor(g0, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'ss.p.stealth-relocation')).toBe(false)
    const g2 = edit(g0, (st) => {
      st.turningPoint = 2
      st.ledger.A.tp = []
      const ops = Object.values(st.operatives).filter((o) => o.seat === 'A')
      ops[0]!.order = 'engage'
    })
    const firstA = Object.values(g2.operatives).find((o) => o.seat === 'A')!.id
    expect(offersFor(g2, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'ss.p.stealth-relocation')).toBe(true)
    let r = usePlayed(g2, 'ss.p.stealth-relocation', { window: 'strategy.gambit' }, undefined, 'A', dice(3))
    expect(r.pending!.kind).toBe('ability.choice')
    const dashers = r.pending!.options!.map((o) => o.id)
    expect(dashers).not.toContain(firstA)
    expect(dashers).toContain('done')
    const mover = dashers.find((d) => d !== 'done')!
    const from = { ...r.operatives[mover]!.pos }
    r = take(r, mover).state
    expect(r.pending!.kind).toBe('move.path')
    r = step(r, act.path(r.pending!, [{ x: from.x + 2.5, z: from.z }])).state
    expect(r.operatives[mover]!.pos.x).toBeCloseTo(from.x + 2.5, 5)
    expect(r.operatives[mover]!.order).toBe('conceal')
    expect(r.pending!.kind).toBe('ability.choice') // one more Dash left (D3 = 2)
    expect(r.pending!.options!.map((o) => o.id)).not.toContain(mover)
    r = take(r, 'done').state
    expect(r.pending!.kind).toBe('strategy.gambit')
  })

  it('TEAM-SS-026 TEAM-SS-027 Astartes Training: fight twice; shoot twice with one bolt weapon among them; two heavy Shoots, the second costing 1 AP more', () => {
    const base = withCp(place(place(open(), A(open(), 'warrior'), 0, 0), B(open(), 'boy'), 5, 0), 3)
    const wr = A(base, 'warrior')
    const hg = A(base, 'heavy-gunner')
    const boy = B(base, 'boy')
    const train = (st: GameState, who: string, option: string) => usePlayed(st, 'ss.p.astartes-training', { window: 'firefight.actionEnded', subjectId: who }, option)
    // (a) fight twice, for this activation only
    const t = activateOp(base, wr)
    expect(maxRepeats(t, t.operatives[wr]!, 'fight', ['fight'])).toBe(1)
    const fight = train(t, wr, 'fight')
    expect(maxRepeats(fight, fight.operatives[wr]!, 'fight', ['fight'])).toBe(2)
    expect(maxRepeats(fight, fight.operatives[wr]!, 'shoot', ['shoot'])).toBe(1)
    expect(fight.effects.find((e) => e.kind === 'ss.training')).toMatchObject({ expires: 'activation', operativeId: wr })
    // (b) shoot twice: a Warrior's boltgun twice; the Heavy Gunner's heavy bolter, then the second Shoot must use a bolt weapon
    const shoot = train(t, wr, 'shoot')
    expect(maxRepeats(shoot, shoot.operatives[wr]!, 'shoot', ['shoot'])).toBe(2)
    const hgBase = place(place(base, hg, 0, 3), boy, 5, 3)
    const one = shootAt(hgBase, hg, 'ss.w.heavy-bolter-focused', boy, dice(1, 1, 1, 1, 1))
    const second = train(one.state, hg, 'shoot')
    expect(shootableWeapons(second, second.operatives[hg]!, ['shoot']).map((x) => x.weaponId)).toEqual(['ss.w.bolt-pistol'])
    expect(actionAvailability(second, second.operatives[hg]!, 'shoot', second.firefight.activation)).toBeNull()
    // without the training there is no second Shoot at all
    expect(actionAvailability(one.state, one.state.operatives[hg]!, 'shoot', one.state.firefight.activation)).not.toBeNull()
    // (c) heavy: the all-heavy option is offered only after heavy Shoots, both Shoots need a heavy weapon, the second costs 2 AP
    const krak = 'ss.w.missile-launcher-krak'
    const mhg = Object.values(base.operatives).filter((o) => o.seat === 'A' && o.datacardId === 'ss.heavy-gunner')[1]!.id
    const missileBase = place(place(base, mhg, 0, -3), boy, 5, -3)
    const apl = (st: GameState, n: number) => edit(st, (x) => void (x.operatives[mhg]!.aplMods = n))
    const heavyOf = (n: number) => {
      const shot = shootAt(apl(missileBase, n), mhg, krak, boy, dice(1, 1, 1, 1, 1)).state
      return train(shot, mhg, 'heavy')
    }
    const three = heavyOf(1)
    expect(effectiveApl(three.operatives[mhg]!)).toBe(3)
    expect(shootableWeapons(three, three.operatives[mhg]!, ['shoot']).map((x) => x.weaponId).sort()).toEqual(['ss.w.missile-launcher-frag', 'ss.w.missile-launcher-krak'])
    expect(actionCost(three, three.operatives[mhg]!, 'shoot', three.firefight.activation)).toBe(2)
    expect(actionAvailability(three, three.operatives[mhg]!, 'shoot', three.firefight.activation)).toBeNull()
    const two = heavyOf(0)
    expect(actionAvailability(two, two.operatives[mhg]!, 'shoot', two.firefight.activation)).not.toBeNull()
    // not offered after a Shoot with a light weapon, and costs the ploy's CP once
    const light = shootAt(missileBase, mhg, 'ss.w.bolt-pistol', boy, dice(1, 1, 1, 1, 1)).state
    expect(offersFor(light, 'A', 'firefight.actionEnded', { window: 'firefight.actionEnded', subjectId: mhg }).filter((o) => o.ployId === 'ss.p.astartes-training').map((o) => o.param).sort()).toEqual(['fight', 'shoot'])
    expect(three.players.A.cp).toBe(2)
  })

  it('TEAM-SS-028 TEAM-SS-029 TEAM-SS-030 Raw Physiology (Move +1", injury ignored), Emboldened Aspirant (a normal success becomes a crit for the first Scout to attack, or against a higher Wounds stat) and Covert Position (not selectable beyond 2" even for Seek)', () => {
    const base = withCp(open(), 3)
    const wr = A(base, 'warrior')
    const boy = B(base, 'boy')
    const nob = B(base, 'boss-nob')
    // RAW PHYSIOLOGY: an injured Scout moves 4", 7" with the ploy; its Hit is the printed one again
    const hurt = edit(activateOp(base, wr), (st) => {
      st.operatives[wr]!.wounds = 4
      st.operatives[wr]!.flags.injured = true
    })
    const hit = (st: GameState) => attackStats(st, wr, 'ss.w.boltgun', boy, { kind: 'shoot' }).need
    expect(effectiveMove(hurt.operatives[wr]!, hurt)).toBe(4)
    expect(hit(hurt)).toBe(4)
    const raw = usePlayed(hurt, 'ss.p.raw-physiology', { window: 'firefight.actionEnded', subjectId: wr })
    expect(effectiveMove(raw.operatives[wr]!, raw)).toBe(7)
    expect(hit(raw)).toBe(3)
    expect(raw.operatives[wr]!.tokens!.find((t) => t.kind === 'ss.rawPhysiology')).toMatchObject({ sourceId: wr, expires: ['sourceNextActivation'] })
    const ended = withCtx(raw, (ctx) => {
      tokensOnActivationStart(ctx, wr)
      refreshFlags(ctx.state)
    }).state
    expect(effectiveMove(ended.operatives[wr]!, ended)).toBe(4)
    // EMBOLDENED ASPIRANT: the first Scout to Shoot this turning point
    const aspirant = (st: GameState, target: string, rng: ScriptedRng) => shootAt(place(place(st, wr, 0, 0), target, 6, 0), wr, 'ss.w.boltgun', target, rng, takePloy('ss.p.emboldened-aspirant'))
    const crits = (r: Played) => (r.events.find((e) => e.type === 'AttackRetained') as { crit: number; normal: number }).crit
    const first = aspirant(base, boy, dice(3, 3, 1, 1, 1, 1, 1, 1))
    expect(crits(first)).toBe(1)
    expect(first.state.players.A.cp).toBe(2)
    // a second Scout against an equal Wounds stat gets nothing; against the Boss Nob (14 against 10) it does
    const second = edit(base, (st) => void (st.operatives[A(base, 'sergeant')]!.actionsThisTp = ['shoot']))
    expect(crits(aspirant(second, boy, dice(3, 3, 1, 1, 1, 1, 1, 1)))).toBe(0)
    expect(crits(aspirant(second, nob, dice(3, 3, 1, 1, 1, 1, 1, 1)))).toBe(1)
    // COVERT POSITION: a Conceal Scout in cover cannot be selected by a Seek weapon from beyond 2"
    const light = feature('ss-light', part('ss-light.a', rect(3, 3.4, -2, 2), 1, ['light']))
    const seeker = ranged('seeker', {}, [{ rule: 'seek' }])
    const arena = (order: 'conceal' | 'engage', gapX: number) =>
      arm(
        withWeapons(
          edit(place(place(withToken(base, wr, 'ss.covertPosition'), wr, 4, 0), boy, 4 - gapX, 0), (st) => {
            st.map = { ...st.map, features: [light] }
            for (const o of Object.values(st.operatives)) o.order = 'engage'
            st.operatives[wr]!.order = order
          }),
          seeker,
        ),
        boy,
        ['seeker'],
      )
    const picked = (st: GameState) => validTargets(st, st.operatives[boy]!, 'seeker').map((x) => x.id)
    expect(picked(arena('conceal', 6))).not.toContain(wr)
    expect(picked(arena('engage', 6))).toContain(wr)
    expect(picked(edit(arena('conceal', 6), (st) => void (st.operatives[wr]!.tokens = [])))).toContain(wr)
    // within 2" (1.4" from its base, outside its control range) it can be selected
    expect(picked(arena('conceal', 2.4))).toContain(wr)
    // the ploy itself leaves the token
    const used = usePlayed(activateOp(base, wr), 'ss.p.covert-position', { window: 'firefight.actionEnded', subjectId: wr })
    expect(hasToken(used, wr, 'ss.covertPosition', 'A')).toBe(true)
  })

  it('TEAM-SS-031 TEAM-SS-032 TEAM-SS-033 TEAM-SS-034 faction equipment: Camo Cloak (one extra cover save, never a crit, not for the Sniper), Targeting Oculars (Lethal 5+ and Saturate, twice per TP), Combat Blade and Tactical Vox-link', () => {
    const bladeSet = realBundle.datacards['ss.warrior']!.legalLoadouts!.find((l) => l.includes('ss.w.combat-blade'))!
    const roster = defaultRosterFor(realBundle, 'scout-squad').map((e, i, all) => (i === all.length - 1 ? { ...e, loadout: { weaponIds: bladeSet } } : e))
    const none = open()
    const eq = withCp(open({ equipmentA: ['ss.e.camo-cloak', 'ss.e.targeting-oculars', 'ss.e.combat-blade', 'ss.e.tactical-vox-link'], rosterA: roster }), 3)
    const wr = A(eq, 'warrior')
    const sn = A(eq, 'sniper')
    const boy = B(eq, 'boy')
    // CAMO CLOAK: an extra cover save for everyone but the Sniper, never as a crit, none without a retained cover save
    type D = { value: number | null; kind: 'normal' | 'crit' | 'fail'; tag?: string; rerolled: boolean }
    const dice3 = (): D[] => [
      { value: null, kind: 'normal', tag: 'cover', rerolled: false },
      { value: 1, kind: 'fail', rerolled: false },
      { value: 2, kind: 'fail', rerolled: false },
    ]
    const defend = (st: GameState, who: string, d = dice3()) => (runHook('afterDefenceRoll', { seat: 'A', state: st, operativeId: who, data: { kind: 'shoot', dice: d } as never }), d)
    const covers = (d: D[]) => d.filter((x) => x.tag === 'cover')
    expect(covers(defend(none, wr))).toHaveLength(1)
    expect(covers(defend(eq, wr))).toHaveLength(2)
    expect(defend(eq, wr).filter((x) => x.kind === 'crit')).toHaveLength(0)
    expect(covers(defend(eq, sn))).toHaveLength(2) // the Sniper's own Camo Cloak, not the equipment's
    expect(covers(defend(eq, wr, [{ value: 1, kind: 'fail', rerolled: false }]))).toHaveLength(0)
    expect(providerExtraCoverSaves(eq, eq.operatives[sn]!)).toBe(0)
    const vantage = (coverMode: string) => edit(eq, (st) => void (st.attack = { kind: 'shoot', stage: 'resolve', operativeId: boy, seat: 'B', weaponId: 'kom.w.slugga', pointBlank: false, targets: [wr], candidates: [], index: 0, seq: { targetId: wr, cover: true, improvedCover: true, coverMode } as never, incapacitated: [], stunned: [], inherit: null, windows: [] }))
    expect(providerExtraCoverSaves(vantage('retainTwo'), eq.operatives[wr]!)).toBe(0)
    expect(providerExtraCoverSaves(vantage('retainCrit'), eq.operatives[wr]!)).toBe(0)
    expect(providerExtraCoverSaves(vantage('retain'), eq.operatives[wr]!)).toBe(1)
    // TARGETING OCULARS: Lethal 5+ makes 5s crits for the whole action; the third use of a turning point is not offered
    const shootOn = (st: GameState) => shootAt(place(place(st, wr, 0, 0), boy, 6, 0), wr, 'ss.w.boltgun', boy, dice(5, 5, 5, 5, 1, 1, 1, 1), takePloy('ss.e.targeting-oculars'))
    const critsOf = (r: Played) => (r.events.find((e) => e.type === 'AttackRetained') as { crit: number }).crit
    const lit = shootOn(eq)
    expect(critsOf(lit)).toBe(4)
    expect(tpUsesOf(lit.state, 'A', 'ss.oculars')).toBe(1)
    expect(critsOf(shootOn(edit(eq, (st) => void (st.ledger.A.tpUses['ss.oculars'] = 2))))).toBe(0)
    expect(critsOf(shootOn(none))).toBe(0)
    const ocular = withFx(eq, { source: 'ss.e.targeting-oculars', kind: 'equipment', operativeId: wr, expires: 'action' })
    expect(parseRules(effectiveRules(ocular, ocular.operatives[wr]!, ocular.data.weapons['ss.w.boltgun']!, 'shoot', boy))).toMatchObject({ lethal: 5, saturate: true })
    // COMBAT BLADE: the 3-Atk equipment blade for everyone without the datacard blade (Hunter, the pistol-and-blade Warrior)
    const hasWeapon = (id: string, w: string) => eq.operatives[id]!.weapons.includes(w)
    const wid = (card: string) => Object.values(eq.operatives).filter((o) => o.seat === 'A' && o.datacardId === card).map((o) => o.id)
    for (const id of [A(eq, 'tracker'), sn, A(eq, 'sergeant'), ...wid('ss.heavy-gunner'), wid('ss.warrior')[0]!]) expect(hasWeapon(id, 'ss.w.combat-blade-equipment'), id).toBe(true)
    for (const id of [A(eq, 'hunter'), wid('ss.warrior').at(-1)!]) {
      expect(hasWeapon(id, 'ss.w.combat-blade'), id).toBe(true)
      expect(hasWeapon(id, 'ss.w.combat-blade-equipment'), id).toBe(false)
    }
    expect(Object.values(none.operatives).some((o) => o.weapons.includes('ss.w.combat-blade-equipment'))).toBe(false)
    // TACTICAL VOX-LINK: the first Astartes Training or Emboldened Aspirant of a turning point costs 0 CP while a Sergeant is in the killzone
    const t = activateOp(place(place(eq, wr, 0, 0), boy, 6, 0), wr)
    const info = { window: 'firefight.actionEnded', subjectId: wr }
    const cost = (st: GameState, ploy: string) => offersFor(st, 'A', 'firefight.actionEnded', info).find((o) => o.ployId === ploy)!.cost
    expect(cost(t, 'ss.p.astartes-training')).toBe(0)
    expect(cost(t, 'ss.p.raw-physiology')).toBe(1)
    const spent = usePlayed(t, 'ss.p.astartes-training', info, 'fight')
    expect(spent.players.A.cp).toBe(t.players.A.cp)
    const again = edit(spent, (st) => {
      st.ledger.A.tp = st.ledger.A.tp.filter((k) => k !== 'ss.p.astartes-training')
      st.effects = st.effects.filter((e) => e.kind !== 'ss.training')
    })
    expect(cost(again, 'ss.p.astartes-training')).toBe(1)
    const noSgt = edit(t, (st) => void (st.operatives[A(t, 'sergeant')]!.status = 'removed'))
    expect(cost(noSgt, 'ss.p.astartes-training')).toBe(1)
  })

  it('TEAM-SS-006 a Forward Scouting Reposition whose free move is cancelled is given back: the pick and the option count return and the same player picks again (a capped number of times)', () => {
    const cancelOne = (st: GameState) => {
      let s = fsPick(st, 'reposition')
      s = take(s, s.pending!.options![0]!.id).state
      expect(s.pending!.kind).toBe('move.path')
      return passIt(s).state
    }
    const s0 = edit(toPreBattle(), (st) => void (st.map = { ...st.map, features: [] }))
    const back = cancelOne(s0)
    expect(usesOf(back, 'A', 'ss.fs')).toBe(0)
    expect(usesOf(back, 'A', 'ss.fs:reposition')).toBe(0)
    expect(back.pending!.seat).toBe('A')
    expect(back.pending!.context.preBattle).toBe(true)
    expect(fsOffered(back)).toContain('reposition')
    // a decider that always cancels: after four give-backs the cancelled pick stays spent
    let s = back
    for (let i = 0; i < 3; i++) s = cancelOne(s)
    expect(usesOf(s, 'A', 'ss.fs')).toBe(0)
    s = cancelOne(s)
    expect(usesOf(s, 'A', 'ss.fs')).toBe(1)
    expect(usesOf(s, 'A', 'ss.fs:reposition')).toBe(1)
    // Scout Squad on both seats: the player who cancelled picks again before the opponent does
    const m0 = toPreBattle({ teams: ['scout-squad', 'scout-squad'] })
    const first = m0.setup.setupInitiative!
    const m1 = cancelOne(m0)
    expect(m1.pending!.seat).toBe(first)
    expect(usesOf(m1, first, 'ss.fs')).toBe(0)
  })

  it('TEAM-SS-007 TEAM-SS-008 Trip Alarm and Booby Trap spots are more than 6" from the opponent drop zone measured from the edge of the marker, not its centre', () => {
    // the opponent's drop zone moved so a grid spot (x = 2) has its centre 6.2" away but its edge only 5.8" away
    const s = edit(toPreBattle(), (st) => {
      st.map = { ...st.map, features: [] }
      const zone = st.map.dropZones.find((z) => z.id === st.players.B.dropZoneId)!
      zone.polygon = [
        { x: 8.2, z: -11 },
        { x: 15, z: -11 },
        { x: 15, z: 11 },
        { x: 8.2, z: 11 },
      ]
    })
    const zoneB = s.map.dropZones.find((z) => z.id === s.players.B.dropZoneId)!.polygon
    const r = markerRadius({ kind: 'equipment' })
    for (const kind of ['tripAlarm', 'boobyTrap'] as const) {
      const spots = markerSpots(s, 'A', kind, 1000)
      expect(spots.length).toBeGreaterThan(10)
      for (const p of spots) expect(distToPolygon(p, zoneB) - r, `${kind} ${p.x},${p.z}`).toBeGreaterThan(6)
      expect(spots.some((p) => p.x === 2)).toBe(false)
      expect(spots.some((p) => p.x === 0)).toBe(true)
    }
  })

  it('TEAM-SS-017 TEAM-SS-031 neither Camo Cloak is cumulative with the Vantage improved cover save: a defender who takes two cover saves (or a crit) from Vantage gets nothing more, one who retains a single cover save still gets the cloak', () => {
    const roof = feature('roof', part('roof.a', rect(-8, -4, -2, 2), 2, ['vantage']))
    const rubble = feature('rubble', part('rubble.a', rect(-2.6, -2.2, -2, 2), 0.5, ['light']))
    const arena = (equipment: string[]) => edit(open({ equipmentA: equipment }), (st) => void (st.map = { ...st.map, features: [roof, rubble] }))
    // a Kommando Boy on the 2" roof shoots a Conceal Scout behind Light rubble: 4 normal hits (slugga Dmg 3), the
    // Scout keeps the cover saves its player chose and rolls the rest as 1s
    const shot = (s0: GameState, card: string, mode: string) => {
      const who = A(s0, card)
      const boy = B(s0, 'boy')
      let s = place(place(s0, who, -1, 0), boy, -6, 0, 2)
      s = edit(s, (st) => void (st.operatives[who]!.order = 'conceal'))
      s = bTurn(s, A(s, 'tracker'))
      const hp = s.operatives[who]!.wounds
      const r = shootAt(s, boy, 'kom.w.slugga', who, dice(4, 4, 4, 4), {
        'shoot.coverSave': (p: PendingDecision) => p.options!.find((o) => o.id === mode)!.action,
      })
      expect(r.events.some((e) => e.type === 'CoverSaveRetained')).toBe(true)
      return hp - r.state.operatives[who]!.wounds
    }
    // the Sniper's own Camo Cloak: two cover saves from Vantage stay two (6 damage), one retained plus the cloak is two
    const bare = arena([])
    expect(shot(bare, 'sniper', 'retainTwo')).toBe(6)
    expect(shot(bare, 'sniper', 'retain')).toBe(6)
    // the equipment on a Warrior: the same, and without it a single retained save blocks one hit only
    const cloaked = arena(['ss.e.camo-cloak'])
    expect(shot(cloaked, 'warrior', 'retainTwo')).toBe(6)
    expect(shot(cloaked, 'warrior', 'retain')).toBe(6)
    expect(shot(bare, 'warrior', 'retain')).toBe(9)
    expect(shot(bare, 'warrior', 'retainTwo')).toBe(6)
  })
})
