// hunter-clade engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-HC-nnn).
// Hunter Clade are seat A against the default Kommandos; the map is open ground unless a test says otherwise.

import { describe, expect, it } from 'vitest'
import { step, view } from '@/engine'
import { actionAvailability } from '@/engine/firefight'
import { act } from '@/engine/actions'
import { maxRepeats } from '@/engine/abilities'
import { applyAplEffect, attackStats, defenceStats, effectiveRules, parseRules, rerollOptions, validTargets, weaponDamage } from '@/engine/attack-common'
import { discCentres, footprintOf } from '@/engine/footprint'
import { runHook } from '@/engine/hooks'
import { baseUnderVantage } from '@/engine/los'
import { bodyOf } from '@/engine/measure'
import { planMove } from '@/engine/movement'
import { offersFor, usePloy, type PloyOffer } from '@/engine/ploys'
import { inControlRangeOf, markerControl } from '@/engine/query'
import { ScriptedRng } from '@/engine/rng'
import { effectiveApl, effectiveMove } from '@/engine/state'
import { providerAfterResolution, providerMoveSurcharge, providerStealthy } from '@/engine/team-rules'
import { E, MODES, P, T, TEAM_ID, bombardmentVictims, edictPartners, modeOf, overrideMode, primaryMode, radSaturated, scoutingQueue, signalTargets, stationary, teamMode } from '@/engine/teams/hunter-clade'
import { tokenCount, tokensOnTurningPointEnd } from '@/engine/tokens'
import type { GameState } from '@/engine/types'
import { enumerateLoadouts, loadBundle, loadoutCapProblems, validateRoster, type DatacardData } from '../../../src/data'
import { evs, melee, pick as pickOpt, play, ranged, withWeapons } from '../../fixtures/attack'
import { drive, expectOk, place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { activateOp, edit, hasOption, inTp, passIt, realBundle, roster, take, withCtx } from '../../fixtures/real'
import { A, B, FULL, entry, open, pass, passAll, refreshGambit, toGambit } from './hunter-clade.hooks'
const data = loadBundle()
const noPloys = { 'ploy.firefight': pass }

describe('TEAM-HC Hunter Clade', () => {
  it(`TEAM-HC-000 TEAM-HC-001 TEAM-HC-002 TEAM-HC-003 the team is playable; roster shape, repeatable Warriors and Gunners, Diktat, Surveyor, Sicarian and seven-operative limits; one of each special weapon across Gunners; the Alpha picks one of three sets and set (c) asks for a pistol and a melee weapon`, () => {
    {
      expect(TEAM_ID).toBe('hunter-clade')
      const team = data.teams['hunter-clade']!
      expect(team.playable).toBe(true)
      const cards = realBundle.datacards
      const ok = { leader: ['hc.skitarii-ranger-alpha'], main: ['hc.sicarian-infiltrator-warrior', 'hc.sicarian-ruststalker-warrior', 'hc.skitarii-ranger-diktat', 'hc.skitarii-ranger-gunner', 'hc.skitarii-ranger-surveyor', 'hc.skitarii-ranger-warrior', 'hc.skitarii-vanguard-gunner', 'hc.skitarii-vanguard-warrior', 'hc.skitarii-vanguard-warrior'] }
      const valid = (roster: { leader: string[]; main: string[] }) => validateRoster(team, roster, cards as never).ok
      expect(valid(ok)).toBe(true)
      // a second Diktat or Surveyor (Ranger plus Vanguard), a duplicate non-repeatable card, or a short roster
      expect(valid({ ...ok, main: [...ok.main.slice(0, 5), 'hc.skitarii-vanguard-diktat', ...ok.main.slice(6)] })).toBe(false)
      expect(valid({ ...ok, main: [...ok.main.slice(0, 5), 'hc.skitarii-vanguard-surveyor', ...ok.main.slice(6)] })).toBe(false)
      expect(valid({ ...ok, main: ['hc.skitarii-ranger-diktat', ...ok.main.slice(1)] })).toBe(false)
      expect(valid({ ...ok, main: ok.main.slice(0, 8) })).toBe(false)
      expect(valid({ ...ok, leader: ['hc.skitarii-ranger-diktat'] })).toBe(false)
      // repeated Ranger and Vanguard Warriors are accepted
      expect(valid({ ...ok, main: ['hc.skitarii-ranger-warrior', 'hc.skitarii-ranger-warrior', 'hc.skitarii-vanguard-warrior', 'hc.skitarii-vanguard-warrior', ...ok.main.slice(4, 9)] })).toBe(true)
      // five Sicarians beside a Skitarii leader are fine; beside a Sicarian Princeps they make six
      const five = ['hc.sicarian-infiltrator-warrior', 'hc.sicarian-infiltrator-warrior', 'hc.sicarian-infiltrator-warrior', 'hc.sicarian-ruststalker-warrior', 'hc.sicarian-ruststalker-warrior']
      const rest = ['hc.skitarii-ranger-warrior', 'hc.skitarii-vanguard-warrior', 'hc.skitarii-ranger-warrior', 'hc.skitarii-vanguard-warrior']
      expect(valid({ leader: ['hc.skitarii-vanguard-alpha'], main: [...five, ...rest] })).toBe(true)
      expect(valid({ leader: ['hc.sicarian-infiltrator-princeps'], main: [...five, ...rest] })).toBe(false)
      expect(valid({ leader: ['hc.sicarian-infiltrator-princeps'], main: [...five.slice(0, 4), ...rest, 'hc.skitarii-ranger-diktat'] })).toBe(true)
      // at most seven of Sicarian Warriors and Gunners together (two Gunner cards, repeated)
      const gunners = ['hc.skitarii-ranger-gunner', 'hc.skitarii-ranger-gunner', 'hc.skitarii-vanguard-gunner']
      expect(valid({ leader: ['hc.skitarii-ranger-alpha'], main: [...five, ...gunners, 'hc.skitarii-ranger-warrior'] })).toBe(false)
      expect(valid({ leader: ['hc.skitarii-ranger-alpha'], main: [...five.slice(0, 4), ...gunners, 'hc.skitarii-ranger-warrior', 'hc.skitarii-vanguard-warrior'] })).toBe(true)
      expect(Object.values(open().operatives).filter((o) => o.seat === 'A')).toHaveLength(10)
    }
    {
      const team = data.teams['hunter-clade']!
      const groups = realBundle.weaponGroups
      const arc = ['hc.w.gun-butt', 'hc.w.arc-rifle']
      const caliver = ['hc.w.gun-butt', 'hc.w.plasma-caliver-standard', 'hc.w.plasma-caliver-supercharge']
      const arquebus = ['hc.w.gun-butt', 'hc.w.transuranic-arquebus-mobile', 'hc.w.transuranic-arquebus-stationary']
      expect(loadoutCapProblems(team, [arc, caliver], groups)).toEqual([])
      expect(loadoutCapProblems(team, [arc, caliver, arquebus], groups)).toEqual([])
      expect(loadoutCapProblems(team, [arc, arc], groups)).toHaveLength(1)
      expect(loadoutCapProblems(team, [caliver, caliver], groups)).toHaveLength(1)
      expect(loadoutCapProblems(team, [arquebus, arc, arquebus], groups)).toHaveLength(1)
      // the shipped default roster stays inside the caps
      const defaults = open().operatives
      const gun = Object.values(defaults).filter((o) => o.seat === 'A' && o.datacardId.endsWith('gunner'))
      expect(gun.map((o) => o.weapons.filter((w) => w !== 'hc.w.gun-butt')[0])).toEqual(['hc.w.arc-rifle', 'hc.w.plasma-caliver-standard'])
      // the Alpha's loadout tree: exactly three sets, set (c) has a pistol slot and a melee slot
      const alpha = data.byId['hc.skitarii-ranger-alpha'] as DatacardData
      const slot = alpha.weapons.options![0]!
      expect(slot.sets!.map((s) => s.id)).toEqual(['rifle', 'master-crafted', 'pistol-and-melee'])
      expect(slot.sets![2]!.options!.map((o) => o.id)).toEqual(['pistol', 'melee'])
      expect(enumerateLoadouts(alpha)).toHaveLength(1 + 1 + 4)
      const vanguard = data.byId['hc.skitarii-vanguard-alpha'] as DatacardData
      expect(vanguard.weapons.options![0]!.sets![0]!.fixed).toEqual(['hc.w.radium-carbine', 'hc.w.gun-butt'])
    }
  })

  it(`TEAM-HC-004 TEAM-HC-005 TEAM-HC-006 an arquebus Gunner stands on a 60x35 oval (a caliver Gunner on a circle); a 90 degree turn is paid for in movement and a crab-walk is not; Targeting Protocol: a Ranger that has not moved shoots with Lethal 5+; not after a Dash, always when counteracting, never for a Vanguard`, () => {
    {
      const base = open({ rosterA: [entry('hc.skitarii-ranger-alpha', { loadout: ['rifle'] }), entry('hc.skitarii-ranger-gunner', { weapon: ['hc.wg.transuranic-arquebus'] }), entry('hc.skitarii-vanguard-gunner', { weapon: ['hc.wg.plasma-caliver'] })] })
      const g = A(base, 'skitarii-ranger-gunner')
      const round = A(base, 'skitarii-vanguard-gunner')
      expect(base.operatives[round]!.ovalHalfAxis).toBeUndefined()
      expect(base.operatives[round]!.baseRadius).toBeCloseTo(25 / 25.4 / 2, 3)
      expect(base.operatives[g]!.ovalHalfAxis).toBeCloseTo(25 / 25.4 / 2, 3)
      expect(base.operatives[g]!.baseRadius).toBeCloseTo(35 / 25.4 / 2, 3)
      const boy = B(base, 'boy')
      const r = base.operatives[boy]!.baseRadius
      const put = (x: number, z: number) => edit(base, (st) => {
        const op = st.operatives[g]!
        op.pos = { x: 0, y: 0, z: 0 }
        op.facing = 0
        st.operatives[boy]!.pos = { x, y: 0, z }
      })
      // an enemy whose base edge is 2.0" from the centre: along the long axis the gap is 0.82", across it 1.31"
      expect(inControlRangeOf(put(0, 2 + r), g, boy)).toBe(true)
      expect(inControlRangeOf(put(2 + r, 0), g, boy)).toBe(false)
      expect(discCentres(footprintOf(put(0, 5).operatives[g]!))).toHaveLength(3)
      // movement: Move 6", 5" ahead plus a quarter turn (1.181 x pi/2 = 1.86", rounded up to 2") is too far; the crab-walk is fine
      const s = put(0, 9)
      const op = s.operatives[g]!
      expect(planMove(s, op, 'reposition', [{ x: 0, z: -5 }], false, undefined, undefined, Math.PI / 2).ok).toBe(false)
      expect(planMove(s, op, 'reposition', [{ x: 5, z: 0 }]).ok).toBe(true)
      const turned = planMove(s, op, 'reposition', [{ x: 0, z: -4 }], false, undefined, undefined, Math.PI / 2)
      expect(turned.ok && turned.cost).toBe(6)
      // a pure turn counts as having moved
      const at = activateOp(edit(s, (st) => (st.operatives[g]!.movedThisActivation = 0)), g)
      expect(stationary(at, at.operatives[g]!)).toBe(true)
      const moving = take(at, 'reposition').state
      const done = expectOk(step(moving, act.pathFacing(moving.pending!, [{ x: 0, z: 0 }], Math.PI / 2))).state
      expect(done.operatives[g]!.movedThisActivation).toBeGreaterThan(0)
      expect(stationary(done, done.operatives[g]!)).toBe(false)
    }
    {
      const s0 = open()
      const w = A(s0, 'skitarii-ranger-warrior')
      const v = A(s0, 'skitarii-vanguard-warrior')
      const boy = B(s0, 'boy')
      const lethal = (st: GameState, id: string, weapon: string) => attackStats(st, id, weapon, boy, { kind: 'shoot' }).rules.lethal
      const still = activateOp(place(place(s0, w, 0, 0), boy, 5, 0), w)
      expect(lethal(still, w, 'hc.w.galvanic-rifle')).toBe(5)
      // after a Dash in the same activation (or any movement) there is no Lethal
      const dashed = edit(still, (st) => {
        st.firefight.activation!.performed = ['dash']
        st.operatives[w]!.movedThisActivation = 3
      })
      expect(lethal(dashed, w, 'hc.w.galvanic-rifle')).toBeNull()
      // a counteraction always qualifies, even after its 2" move
      const counter = edit(dashed, (st) => {
        st.firefight.activation!.counteract = true
      })
      expect(lethal(counter, w, 'hc.w.galvanic-rifle')).toBe(5)
      // a Vanguard Warrior never gets it
      const vs = activateOp(place(place(s0, v, 0, 0), boy, 5, 0), v)
      expect(lethal(vs, v, 'hc.w.radium-carbine')).toBeNull()
      // a real Shoot: dice 5 3 2 1 with Lethal 5+ and Hit 3+ is one crit, one normal
      const t = take(take(still, 'shoot').state, 'hc.w.galvanic-rifle').state
      const r = play(t, new ScriptedRng([5, 3, 2, 1, 1, 1, 1, 1, 1, 1]), noPloys)
      const rolled = r.events.find((e) => e.type === 'AttackDiceRolled')
      expect(rolled && 'kinds' in rolled ? rolled.kinds : null).toEqual(['crit', 'normal', 'fail', 'fail'])
    }
  })

  it('TEAM-HC-007 Rad-Saturation worsens an enemy Hit within 2" of a Vanguard (no sight, once, not on top of injury); Canticle of the Glow also takes 1 Atk within 3"', () => {
    const s0 = open({ rosterA: FULL })
    const warrior = A(s0, 'skitarii-vanguard-warrior')
    const alpha = A(s0, 'skitarii-vanguard-alpha')
    const boy = B(s0, 'boy')
    const stats = (st: GameState) => attackStats(st, boy, 'kom.w.slugga', A(st, 'skitarii-ranger-alpha'), { kind: 'shoot' })
    const base = stats(s0)
    // a Heavy wall between them: no visibility is needed
    const wall = feature('wall', part('wall.a', rect(-0.1, 0.1, -3, 3), 3, ['heavy']))
    const r = s0.operatives[boy]!.baseRadius + s0.operatives[warrior]!.baseRadius
    const near = (gap: number) => edit(place(place(s0, warrior, 0, 0), boy, r + gap, 0), (st) => (st.map = { ...st.map, features: [wall] }))
    expect(stats(near(1.6)).need).toBe(base.need + 1)
    expect(radSaturated(near(1.6), near(1.6).operatives[boy]!)).toBe(true)
    // at 2.1" there is no change; two Vanguards still give one step
    expect(stats(near(2.1)).need).toBe(base.need)
    const two = edit(near(1.6), (st) => (st.operatives[alpha]!.pos = { x: 0, y: 0, z: 1.2 }))
    expect(stats(two).need).toBe(base.need + 1)
    // an injured enemy is worsened only once
    const hurt = edit(near(1.6), (st) => (st.operatives[boy]!.wounds = 1))
    const hurtFar = edit(near(2.1), (st) => (st.operatives[boy]!.wounds = 1))
    expect(stats(hurt).need).toBe(stats(hurtFar).need)
    // the Vanguard Alpha's glow: within 3" of it an enemy under Rad-Saturation also loses 1 Atk
    const glow = edit(near(1.6), (st) => (st.operatives[alpha]!.pos = { x: 0, y: 0, z: 2 }))
    expect(stats(glow).atk).toBe(base.atk - 1)
    const noGlow = edit(near(1.6), (st) => (st.operatives[alpha]!.pos = { x: 0, y: 0, z: 8 }))
    expect(stats(noGlow).atk).toBe(base.atk)
    // a Ranger does not irradiate
    const ranger = edit(s0, (st) => {
      st.operatives[A(s0, 'skitarii-ranger-warrior')]!.pos = { x: 0, y: 0, z: 0 }
      st.operatives[boy]!.pos = { x: r + 1, y: 0, z: 0 }
    })
    expect(stats(ranger).need).toBe(base.need)
  })

  it('TEAM-HC-008 TEAM-HC-018 TEAM-HC-019 Canticle of Destruction (first crit strike of a fight, not retaliating), Wasteland Stalker and Canticle of Elimination', () => {
    const s0 = open({ rosterA: FULL })
    const princeps = A(s0, 'sicarian-ruststalker-princeps')
    const rust = A(s0, 'sicarian-ruststalker-warrior')
    const boy = B(s0, 'boy')
    const strike = (st: GameState, who: string, die: 'crit' | 'normal' = 'crit') => {
      const data = { die, amount: 6, cancel: false }
      const out = withCtx(st, (ctx) => {
        runHook('beforeStrike', { seat: 'A', state: ctx.state, engine: ctx, operativeId: who, targetId: boy, data })
      })
      return { state: out.state, amount: data.amount }
    }
    const fighting = (pos: number) =>
      edit(place(place(s0, princeps, 0, 0), rust, pos, 0), (st) => {
        st.attack = { kind: 'fight', operativeId: rust } as never
      })
    expect(strike(fighting(2), rust).amount).toBe(7)
    // only the first crit of the sequence, and not a normal strike
    const once = strike(fighting(2), rust)
    expect(strike(once.state, rust).amount).toBe(6)
    expect(strike(fighting(2), rust, 'normal').amount).toBe(6)
    // the Princeps counts as within 3" of itself; beyond 3" nothing
    const self = edit(place(s0, princeps, 0, 0), (st) => (st.attack = { kind: 'fight', operativeId: princeps } as never))
    expect(strike(self, princeps).amount).toBe(7)
    expect(strike(fighting(5), rust).amount).toBe(6)
    // retaliating (the fight was started by the other operative) gets nothing
    const retaliating = edit(fighting(2), (st) => (st.attack = { kind: 'fight', operativeId: boy } as never))
    expect(strike(retaliating, rust).amount).toBe(6)
    // Wasteland Stalker: Ruststalkers retain one more cover save; not on top of Vantage's improved cover
    expect(providerStealthy(s0, s0.operatives[rust]!)).toBe(1)
    expect(providerStealthy(s0, s0.operatives[princeps]!)).toBe(1)
    expect(providerStealthy(s0, s0.operatives[A(s0, 'skitarii-ranger-alpha')]!)).toBe(0)
    // the core's Stealthy step: no extra cover save once the Vantage improvement was taken (two cover saves, or one
    // as a crit); a defender who retained a single cover save under Vantage still gets it (shared RULING)
    const coverSaves = (coverMode: string): number => {
      const st = edit(s0, (x) => {
        x.attack = { kind: 'shoot', operativeId: boy, seq: { targetId: rust, improvedCover: true, coverMode } } as never
      })
      const dice = [
        { value: null, kind: 'normal', tag: 'cover' },
        { value: 2, kind: 'fail' },
      ]
      runHook('afterDefenceRoll', { seat: 'A', state: st, operativeId: rust, data: { kind: 'shoot', dice } })
      return dice.filter((d) => d.tag === 'cover').length
    }
    expect(coverSaves('retainTwo')).toBe(1)
    expect(coverSaves('retainCrit')).toBe(1)
    expect(coverSaves('retain')).toBe(2)
    // Canticle of Elimination: Punishing on a Ranger's ranged weapons within 3" of the Ranger Alpha
    const alpha = A(s0, 'skitarii-ranger-alpha')
    const warrior = A(s0, 'skitarii-ranger-warrior')
    const vanguard = A(s0, 'skitarii-vanguard-warrior')
    const rules = (st: GameState, who: string, w: string) => effectiveRules(st, st.operatives[who]!, st.data.weapons[w]!, 'shoot', boy).map((x) => x.rule)
    const grouped = place(place(place(s0, alpha, 0, 0), warrior, 2, 0), vanguard, -2, 0)
    expect(rules(grouped, warrior, 'hc.w.galvanic-rifle')).toContain('core.wr.punishing')
    expect(rules(grouped, alpha, 'hc.w.galvanic-rifle')).toContain('core.wr.punishing')
    expect(rules(grouped, vanguard, 'hc.w.radium-carbine')).not.toContain('core.wr.punishing')
    expect(rules(place(grouped, warrior, 6, 0), warrior, 'hc.w.galvanic-rifle')).not.toContain('core.wr.punishing')
  })

  it('TEAM-HC-009 Canticle of Shroudpsalm: an Infiltrator on Conceal in cover near the Princeps cannot be picked, even by a Seek weapon, unless the shooter is within 2"', () => {
    const base = open({ rosterA: FULL })
    const princeps = A(base, 'sicarian-infiltrator-princeps')
    const inf = A(base, 'sicarian-infiltrator-warrior')
    const boy = B(base, 'boy')
    const wall = feature('rubble', part('rubble.a', rect(-0.8, -0.6, -3, 3), 1, ['light']))
    const seek = ranged('test.seek', { hit: 3 }, [{ rule: 'seek' }])
    const stage = (o: { princeps: boolean; order: 'conceal' | 'engage' }) =>
      edit(place(place(withWeapons(base, seek), inf, 0, 0), boy, -6, 0), (st) => {
        st.map = { ...st.map, features: [wall] }
        st.operatives[inf]!.order = o.order
        st.operatives[boy]!.weapons = ['test.seek']
        st.operatives[boy]!.order = 'engage'
        st.operatives[princeps]!.pos = o.princeps ? { x: 2, y: 0, z: 0 } : { x: 13, y: 0, z: 9 }
      })
    const targets = (st: GameState) => validTargets(st, st.operatives[boy]!, 'test.seek').map((t) => t.id)
    expect(targets(stage({ princeps: false, order: 'conceal' }))).toContain(inf)
    expect(targets(stage({ princeps: true, order: 'conceal' }))).not.toContain(inf)
    // an Engage Infiltrator is an ordinary target
    expect(targets(stage({ princeps: true, order: 'engage' }))).toContain(inf)
    // the Princeps protects itself too
    const self = edit(stage({ princeps: true, order: 'conceal' }), (st) => {
      st.operatives[princeps]!.order = 'conceal'
      st.operatives[princeps]!.pos = { x: 0, y: 0, z: 0 }
      st.operatives[inf]!.pos = { x: 13, y: 0, z: 9 }
    })
    expect(targets(self)).not.toContain(princeps)
    // a shooter within 2" can pick it
    const close = edit(stage({ princeps: true, order: 'conceal' }), (st) => (st.operatives[boy]!.pos = { x: -3, y: 0, z: 0 }))
    expect(targets(close)).toContain(inf)
  })

  it('TEAM-HC-010 TEAM-HC-014 the Primary Mode comes from the team choice and shows in both views; the gambit offers five Imperatives plus the Primary without Deprecation once per battle; the Imperative ends with the turning point', () => {
    const g = toGambit({ teamChoices: { A: { 'primary-mode': 'hc.a.imp-bulwark' }, B: {} } })
    expect(g.config.A.choices['primary-mode']).toBe('hc.a.imp-bulwark')
    expect(view(g, 'B').config.A.choices['primary-mode']).toBe('hc.a.imp-bulwark')
    expect(primaryMode(g, 'A')).toBe('bulwark')
    const ids = g.pending!.options!.map((o) => o.id).filter((id) => id.startsWith('hc.p.doctrina'))
    expect(ids).toEqual(['hc.p.doctrina:bulwark', 'hc.p.doctrina:bulwark:ignore', 'hc.p.doctrina:protector', 'hc.p.doctrina:conqueror', 'hc.p.doctrina:aggressor', 'hc.p.doctrina:neutral'])
    expect(g.pending!.options!.find((o) => o.id === 'hc.p.doctrina:bulwark')!.data!.cost).toBe(0)
    // the plain Primary Mode: Optimisation and Deprecation both
    const plain = take(g, 'hc.p.doctrina:bulwark').state
    expect(teamMode(plain, 'A')).toBe('bulwark')
    expect(modeOf(plain, plain.operatives[A(plain, 'skitarii-ranger-warrior')]!)).toEqual({ mode: 'bulwark', deprecated: true })
    expect(plain.ledger.A.battle).not.toContain('hc.primary-ignore')
    // with the Deprecation ignored: only the Optimisation, and the ignore is spent for the battle
    const ignored = take(g, 'hc.p.doctrina:bulwark:ignore').state
    expect(modeOf(ignored, ignored.operatives[A(ignored, 'skitarii-ranger-warrior')]!)).toEqual({ mode: 'bulwark', deprecated: false })
    expect(ignored.ledger.A.battle).toContain('hc.primary-ignore')
    expect(effectiveMove(ignored.operatives[A(ignored, 'skitarii-ranger-warrior')]!, ignored)).toBe(6)
    expect(effectiveMove(plain.operatives[A(plain, 'skitarii-ranger-warrior')]!, plain)).toBe(5)
    // the next turning point: the Imperative is gone, the ignore is no longer offered, the plain pick is
    const t = drive(ignored, (st) => st.turningPoint === 2 && st.pending?.kind === 'strategy.gambit' && st.pending.seat === 'A', 4000)
    expect(t.turningPoint).toBe(2)
    expect(teamMode(t, 'A')).toBeNull()
    expect(t.effects.some((e) => e.kind === 'hc.ignore')).toBe(false)
    const again = t.pending!.options!.map((o) => o.id).filter((id) => id.startsWith('hc.p.doctrina'))
    expect(again).toEqual(['hc.p.doctrina:bulwark', 'hc.p.doctrina:protector', 'hc.p.doctrina:conqueror', 'hc.p.doctrina:aggressor', 'hc.p.doctrina:neutral'])
  })

  it('TEAM-HC-011 TEAM-HC-012 TEAM-HC-013 Optimisations and Deprecations: Protector and Conqueror trade Ceaseless for a worse Hit (not on top of injury), Bulwark trims normal Dmg 3+ and Move, Aggressor adds Move and worsens Save', () => {
    const g = toGambit()
    const ranger = A(g, 'skitarii-ranger-warrior')
    const boy = B(g, 'boy')
    const rulesOf = (st: GameState, w: string, kind: 'shoot' | 'fight') => effectiveRules(st, st.operatives[ranger]!, st.data.weapons[w]!, kind, boy).map((r) => r.rule)
    const need = (st: GameState, w: string, kind: 'shoot' | 'fight') => attackStats(st, ranger, w, boy, { kind }).need
    const none = need(g, 'hc.w.galvanic-rifle', 'shoot')
    const noneMelee = need(g, 'hc.w.gun-butt', 'fight')
    // Protector: ranged Ceaseless, melee Hit worse by 1
    const protector = take(g, 'hc.p.doctrina:protector').state
    expect(rulesOf(protector, 'hc.w.galvanic-rifle', 'shoot')).toContain('core.wr.ceaseless')
    expect(rulesOf(protector, 'hc.w.gun-butt', 'fight')).not.toContain('core.wr.ceaseless')
    expect(need(protector, 'hc.w.galvanic-rifle', 'shoot')).toBe(none)
    expect(need(protector, 'hc.w.gun-butt', 'fight')).toBe(noneMelee + 1)
    // ... not worse again when injured
    const hurt = edit(protector, (st) => (st.operatives[ranger]!.wounds = 1))
    expect(need(hurt, 'hc.w.gun-butt', 'fight')).toBe(noneMelee + 1)
    expect(need(edit(g, (st) => (st.operatives[ranger]!.wounds = 1)), 'hc.w.gun-butt', 'fight')).toBe(noneMelee + 1)
    // Conqueror: the reverse
    const conqueror = take(g, 'hc.p.doctrina:conqueror').state
    expect(rulesOf(conqueror, 'hc.w.gun-butt', 'fight')).toContain('core.wr.ceaseless')
    expect(rulesOf(conqueror, 'hc.w.galvanic-rifle', 'shoot')).not.toContain('core.wr.ceaseless')
    expect(need(conqueror, 'hc.w.galvanic-rifle', 'shoot')).toBe(none + 1)
    expect(need(conqueror, 'hc.w.gun-butt', 'fight')).toBe(noneMelee)
    // Bulwark: Normal Dmg 3 or more deals 1 less to a friendly operative; crits, Dmg 2 and enemies are untouched; Move 5"
    const four = melee('test.four', { dmg: { normal: 4, crit: 5 } })
    const two = melee('test.two', { dmg: { normal: 2, crit: 5 } })
    const bulwark = withWeapons(take(g, 'hc.p.doctrina:bulwark').state, four, two)
    expect(weaponDamage(bulwark, boy, 'test.four', ranger, 'fight')).toEqual({ normal: 3, crit: 5 })
    expect(weaponDamage(bulwark, boy, 'test.two', ranger, 'fight')).toEqual({ normal: 2, crit: 5 })
    expect(weaponDamage(bulwark, ranger, 'hc.w.galvanic-rifle', boy, 'shoot')).toEqual({ normal: 3, crit: 4 })
    expect(weaponDamage(withWeapons(g, four), boy, 'test.four', ranger, 'fight')).toEqual({ normal: 4, crit: 5 })
    expect(effectiveMove(bulwark.operatives[ranger]!, bulwark)).toBe(5)
    // Aggressor: Move 7", a 4+ Save becomes 5+
    const aggressor = take(g, 'hc.p.doctrina:aggressor').state
    expect(effectiveMove(aggressor.operatives[ranger]!, aggressor)).toBe(7)
    const save = (st: GameState) => defenceStats(st, ranger, boy, 'kom.w.slugga', parseRules([]), false).need
    expect(save(g)).toBe(4)
    expect(save(aggressor)).toBe(5)
    // Neutral is legal and changes nothing
    const neutral = take(g, 'hc.p.doctrina:neutral').state
    expect(effectiveMove(neutral.operatives[ranger]!, neutral)).toBe(6)
    expect(need(neutral, 'hc.w.galvanic-rifle', 'shoot')).toBe(none)
    // no Imperative at all means no rule applies
    expect(modeOf(g, g.operatives[ranger]!)).toBeNull()
    expect(MODES).toHaveLength(5)
  })

  it('TEAM-HC-015 TEAM-HC-013 COMMAND OVERRIDE gives one operative its own Imperative (token in view) for 0 CP when a leader sees it, 1 CP when none does', () => {
    const base = open({ rosterA: FULL })
    const alpha = A(base, 'skitarii-ranger-alpha')
    const warrior = A(base, 'skitarii-ranger-warrior')
    const vanguard = A(base, 'skitarii-vanguard-warrior')
    const wall = feature('wall', part('wall.a', rect(1.9, 2.1, -3, 3), 3, ['heavy']))
    const at = (blocked: boolean) =>
      edit(place(place(place(base, alpha, 0, 0), warrior, 4, 0), vanguard, 8, 0), (st) => {
        st.players.A.cp = 3
        st.config.A.doctrine = 'protector'
        if (blocked) st.map = { ...st.map, features: [wall] }
      })
    const offers = (st: GameState, who: string) => offersFor(st, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: who }).filter((o) => o.ployId === P.override)
    // a leader sees the Ranger: 0 CP, every Imperative but its current one (Protector); with a wall in the way 1 CP
    expect(offers(at(false), warrior).map((o) => [o.param, o.cost])).toEqual([['conqueror', 0], ['bulwark', 0], ['aggressor', 0], ['neutral', 0]])
    expect(offers(at(true), warrior).every((o) => o.cost === 1)).toBe(true)
    // the leader can use it on itself for 0 CP even with nobody else in sight
    expect(offers(at(true), alpha)[0]!.cost).toBe(0)
    // through the window: the token shows in the other seat's view, others keep the team's Imperative
    const s = at(false)
    const t = take(take(s, warrior).state, 'engage').state
    expect(hasOption(t, 'hc.p.command-override:bulwark')).toBe(true)
    const u = take(t, 'hc.p.command-override:bulwark').state
    expect(u.players.A.cp).toBe(3)
    expect(overrideMode(u, u.operatives[warrior]!)).toBe('bulwark')
    expect(modeOf(u, u.operatives[warrior]!)).toEqual({ mode: 'bulwark', deprecated: true })
    expect(modeOf(u, u.operatives[vanguard]!)).toEqual({ mode: 'protector', deprecated: true })
    expect(view(u, 'B').operatives[warrior]!.tokens?.some((k) => k.kind === T.doctrine && k.data?.mode === 'bulwark')).toBe(true)
    expect(effectiveMove(u.operatives[warrior]!, u)).toBe(5)
    // a leader that cannot see the operative: the override costs the CP
    const paid = take(take(take(at(true), warrior).state, 'engage').state, 'hc.p.command-override:aggressor').state
    expect(paid.players.A.cp).toBe(2)
    // the override ends with the turning point
    const gone = withCtx(u, (ctx) => {
      tokensOnTurningPointEnd(ctx)
    }).state
    expect(overrideMode(gone, gone.operatives[warrior]!)).toBeNull()
  })

  it(`TEAM-HC-016 TEAM-HC-017 SIGNAL gives another visible friend within 6" +1 APL for its next activation only; not to itself, not in an enemy control range, never above +1; SPOT marks an enemy: a friendly shooter within 3" of the Surveyor gets Seek Light and the enemy cannot be obscured; farther away nothing; the mark ends with the turning point`, () => {
    {
      const base = open({ rosterA: FULL })
      const diktat = A(base, 'skitarii-ranger-diktat')
      const friend = A(base, 'skitarii-ranger-warrior')
      const far = A(base, 'skitarii-vanguard-warrior')
      const boy = B(base, 'boy')
      const s = place(place(place(base, diktat, 0, 0), friend, 4, 0), far, 9, 0)
      const t = activateOp(s, diktat)
      expect(signalTargets(s, s.operatives[diktat]!).map((o) => o.id)).toEqual([friend])
      expect(hasOption(t, `ability:hc.a.signal:${friend}`)).toBe(true)
      expect(hasOption(t, `ability:hc.a.signal:${diktat}`)).toBe(false)
      expect(hasOption(t, `ability:hc.a.signal:${far}`)).toBe(false)
      const u = take(t, `ability:hc.a.signal:${friend}`).state
      expect(effectiveApl(u.operatives[friend]!)).toBe(3)
      // a second boost does not exceed +1
      const twice = withCtx(u, (ctx) => applyAplEffect(ctx, friend, 1, 'again')).state
      expect(effectiveApl(twice.operatives[friend]!)).toBe(3)
      // it lasts through the friend's next activation only
      const done = take(activateOp(take(u, 'end').state, boy, 'engage'), 'end').state
      expect(effectiveApl(done.operatives[friend]!)).toBe(3)
      const after = take(activateOp(done, friend), 'end').state
      expect(effectiveApl(after.operatives[friend]!)).toBe(2)
      // not while an enemy is in control range
      const engaged = place(s, boy, 1.2, 0)
      expect(hasOption(activateOp(engaged, diktat), `ability:hc.a.signal:${friend}`)).toBe(false)
    }
    {
      const base = open({ rosterA: FULL })
      const surveyor = A(base, 'skitarii-ranger-surveyor')
      const near = A(base, 'skitarii-ranger-warrior')
      const farOne = A(base, 'skitarii-vanguard-warrior')
      const boy = B(base, 'boy')
      const s = place(place(place(place(base, surveyor, 0, 0), near, 0, 2), farOne, 0, 4.6), boy, 10, 0)
      const t = take(activateOp(s, surveyor), `ability:hc.a.spot:${boy}`).state
      expect(tokenCount(t, boy, T.spot, 'A')).toBe(1)
      const rules = (st: GameState, who: string, w: string) => effectiveRules(st, st.operatives[who]!, st.data.weapons[w]!, 'shoot', boy).map((r) => r.rule)
      expect(rules(t, near, 'hc.w.galvanic-rifle')).toContain('core.wr.seek-light')
      expect(rules(t, surveyor, 'hc.w.galvanic-rifle')).toContain('core.wr.seek-light')
      expect(rules(t, farOne, 'hc.w.radium-carbine')).not.toContain('core.wr.seek-light')
      expect(rules(s, near, 'hc.w.galvanic-rifle')).not.toContain('core.wr.seek-light')
      const obscured = (st: GameState, who: string) => {
        const data = { obscured: true, inCover: false }
        runHook('target.status', { seat: 'A', state: st, operativeId: who, targetId: boy, data })
        return data.obscured
      }
      expect(obscured(t, near)).toBe(false)
      expect(obscured(t, farOne)).toBe(true)
      expect(obscured(s, near)).toBe(true)
      // the Surveyor falling takes the mark with it; so does the turning point
      const lost = edit(t, (st) => (st.operatives[surveyor]!.status = 'removed'))
      expect(rules(lost, near, 'hc.w.galvanic-rifle')).not.toContain('core.wr.seek-light')
      const gone = withCtx(t, (ctx) => tokensOnTurningPointEnd(ctx)).state
      expect(tokenCount(gone, boy, T.spot)).toBe(0)
    }
  })

  it('TEAM-HC-020 TEAM-HC-021 DEBILITATING IRRADIATION lowers a Rad-Saturated enemy Normal Dmg against a Vanguard to a floor of 3; NEUROSTATIC INTERFERENCE bans every attack re-roll within 6" of an Infiltrator', () => {
    const g0 = edit(toGambit({ rosterA: FULL }), (st) => (st.players.A.cp = 4))
    const vanguard = A(g0, 'skitarii-vanguard-warrior')
    const ranger = A(g0, 'skitarii-ranger-warrior')
    const inf = A(g0, 'sicarian-infiltrator-warrior')
    const boy = B(g0, 'boy')
    const four = melee('test.four', { dmg: { normal: 4, crit: 5 } })
    const three = melee('test.three', { dmg: { normal: 3, crit: 5 } })
    const r = g0.operatives[boy]!.baseRadius + g0.operatives[vanguard]!.baseRadius
    const dmg = (st: GameState, w: string, target: string) => weaponDamage(withWeapons(st, four, three), boy, w, target, 'fight')
    const placed = (st: GameState, gap: number) => place(place(place(st, vanguard, 0, 0), boy, r + gap, 0), ranger, -5, 5)
    // without the ploy nothing changes
    expect(dmg(placed(g0, 1), 'test.four', vanguard)).toEqual({ normal: 4, crit: 5 })
    const g = take(g0, 'hc.p.debilitating-irradiation').state
    expect(dmg(placed(g, 1), 'test.four', vanguard)).toEqual({ normal: 3, crit: 5 })
    expect(dmg(placed(g, 1), 'test.three', vanguard)).toEqual({ normal: 3, crit: 5 })
    // shooting a Ranger, or fighting from outside 2" of every Vanguard, is unaffected
    expect(dmg(placed(g, 1), 'test.four', ranger)).toEqual({ normal: 4, crit: 5 })
    expect(dmg(placed(g, 2.5), 'test.four', vanguard)).toEqual({ normal: 4, crit: 5 })
    // NEUROSTATIC: Balanced and Command Re-roll offers vanish within 6" of an Infiltrator and return at 6.1"
    const n = take(g0, 'hc.p.neurostatic-interference').state
    const ri = n.operatives[inf]!.baseRadius + n.operatives[boy]!.baseRadius
    const side = { seat: 'B' as const, operativeId: boy, weaponId: 'kom.w.slugga', dice: [{ value: 1, kind: 'fail' as const, rerolled: false }], need: 3, lethal: null, grants: [{ id: 'balanced', source: 'test', mode: 'one' as const, used: false }], commandUsed: false, phase: 'grants' as const }
    const offered = (gap: number, attack: 'shoot' | 'fight' = 'shoot') => {
      const st = edit(place(place(n, inf, 0, 0), boy, ri + gap, 0), (x) => {
        x.players.B.cp = 2
        x.attack = { kind: attack, operativeId: boy, weaponId: 'kom.w.slugga' } as never
      })
      const o = rerollOptions(st, side)
      return o.grants.length + o.command.length
    }
    expect(offered(5.9)).toBe(0)
    expect(offered(5.9, 'fight')).toBe(0)
    expect(offered(6.1)).toBeGreaterThan(0)
    expect(rerollOptions(edit(place(place(g, inf, 0, 0), boy, ri + 5, 0), (x) => (x.attack = { kind: 'shoot', operativeId: boy } as never)), side).grants).not.toHaveLength(0)
  })

  it(`TEAM-HC-022 TEAM-HC-023 SCOUTING PROTOCOL is not offered in TP1; in TP2 each Conceal Ranger more than 6" from every enemy may Dash in the order chosen, an Engage Ranger or one 5" away is skipped; ACCELERANT AGENTS: a Ruststalker Fights twice, the second for 0 AP, and a third Fight is not offered; other operatives are unaffected`, () => {
    {
      const park = (st: GameState) => {
        st.map = { ...st.map, features: [] }
        let a = 0
        let b = 0
        for (const op of Object.values(st.operatives)) op.pos = op.seat === 'A' ? { x: -13.5, y: 0, z: -10 + a++ * 1.7 } : { x: 13.5, y: 0, z: -10 + b++ * 1.7 }
        st.players.A.cp = 3
      }
      const base = toGambit({ rosterA: FULL })
      const ranger = (st: GameState, card: string) => A(st, card)
      const refresh = refreshGambit
      const tp1 = edit(base, (st) => {
        park(st)
        for (const c of ['skitarii-ranger-alpha', 'skitarii-ranger-warrior']) st.operatives[ranger(st, c)]!.order = 'conceal'
      })
      expect(hasOption(refresh(tp1), 'hc.p.scouting-protocol')).toBe(false)
      const alpha = A(base, 'skitarii-ranger-alpha')
      const warrior = A(base, 'skitarii-ranger-warrior')
      const diktat = A(base, 'skitarii-ranger-diktat')
      const near = A(base, 'skitarii-ranger-surveyor')
      const tp2 = refresh(edit(tp1, (st) => {
        st.turningPoint = 2
        st.operatives[diktat]!.order = 'engage'
        st.operatives[near]!.order = 'conceal'
        st.operatives[near]!.pos = { x: 8.5, y: 0, z: 0 }
      }))
      expect(scoutingQueue(tp2, 'A').sort()).toEqual([alpha, warrior].sort())
      expect(hasOption(tp2, 'hc.p.scouting-protocol')).toBe(true)
      let t = take(tp2, 'hc.p.scouting-protocol').state
      expect(t.pending!.kind).toBe('ability.choice')
      expect(t.pending!.options!.map((o) => o.id).sort()).toEqual([alpha, warrior, 'done'].sort())
      // dash the Ranger Warrior first, 3" towards the enemy, then the Alpha, in the order chosen
      const from = t.operatives[warrior]!.pos
      t = take(t, warrior).state
      expect(t.pending!.kind).toBe('move.path')
      t = expectOk(step(t, act.path(t.pending!, [{ x: from.x + 3, z: from.z }]))).state
      expect(t.operatives[warrior]!.pos.x).toBeCloseTo(from.x + 3, 3)
      expect(t.pending!.kind).toBe('ability.choice')
      expect(t.pending!.options!.map((o) => o.id).sort()).toEqual([alpha, 'done'].sort())
      // the Alpha may decline; the gambit step goes on
      t = take(t, 'done').state
      expect(t.pending!.kind).toBe('strategy.gambit')
      expect(t.operatives[alpha]!.pos.x).toBeCloseTo(-13.5, 3)
      expect(t.ledger.A.tp).toContain('hc.p.scouting-protocol')
    }
    {
      const base = open({ rosterA: FULL })
      const rust = A(base, 'sicarian-ruststalker-warrior')
      const ranger = A(base, 'skitarii-ranger-warrior')
      const boy = B(base, 'boy')
      const flagged = edit(place(place(base, rust, 0, 0), boy, 1.9, 0), (st) => {
        st.effects.push({ id: 'e-acc', source: P.accelerant, seat: 'A', kind: 'ployFlag', expires: 'turningPoint' })
      })
      expect(maxRepeats(flagged, flagged.operatives[rust]!, 'fight', ['fight'])).toBe(2)
      expect(maxRepeats(flagged, flagged.operatives[ranger]!, 'fight', ['fight'])).toBe(1)
      expect(maxRepeats(base, base.operatives[rust]!, 'fight', ['fight'])).toBe(1)
      const rng = () => new ScriptedRng(Array(40).fill(1))
      const fightOnce = (st: GameState) => play(take(take(st, 'fight', rng()).state, boy, rng()).state, rng(), noPloys)
      const first = fightOnce(activateOp(flagged, rust))
      expect(evs(first.events, 'ApSpent')[0]!.amount).toBe(1)
      expect(hasOption(first.state, 'fight')).toBe(true)
      // the second Fight costs nothing; a third is not offered (the activation has nothing left to offer and ends)
      const second = fightOnce(first.state)
      expect(evs(second.events, 'ApSpent')[0]!.amount).toBe(0)
      const act2 = { ...first.state.firefight.activation!, performed: ['fight', 'fight'] }
      expect(actionAvailability(first.state, first.state.operatives[rust]!, 'fight', act2)?.code).toBe('E_ACTION_RESTRICTED')
      // without the ploy a second Fight is not offered at all
      const plain = fightOnce(activateOp(edit(place(place(base, rust, 0, 0), boy, 1.9, 0), () => undefined), rust))
      expect(hasOption(plain.state, 'fight')).toBe(false)
    }
  })

  it('TEAM-HC-024 TEAM-HC-030 CONTROL EDICT activates the leader, then a partner within 3" before the opponent (never two Sicarians); EXTREMIS MIND-LINK makes it free once and activates both together', () => {
    const base = open({ rosterA: FULL, equipmentA: [E.mindLink] })
    const alpha = A(base, 'skitarii-ranger-alpha')
    const warrior = A(base, 'skitarii-ranger-warrior')
    const far = A(base, 'skitarii-vanguard-warrior')
    const boy = B(base, 'boy')
    const s = edit(place(place(place(base, alpha, 0, 0), warrior, 2, 0), far, 5.5, 0), (st) => (st.players.A.cp = 3))
    // partners: visible, within 3" of the leader, ready; a partner 4" away is not offered
    expect(edictPartners(s, s.operatives[alpha]!).map((o) => o.id)).toEqual([warrior])
    expect(edictPartners(s, s.operatives[warrior]!).map((o) => o.id)).toEqual([alpha])
    // never two Sicarians: the Sicarian Princeps pairs with a Skitarii, not with a Sicarian Warrior
    const princeps = A(base, 'sicarian-infiltrator-princeps')
    const sicarian = A(base, 'sicarian-infiltrator-warrior')
    const pair = place(place(place(s, princeps, 10, 0), sicarian, 12, 0), A(base, 'skitarii-ranger-diktat'), 10, 2)
    expect(edictPartners(pair, pair.operatives[princeps]!).map((o) => o.id)).toEqual([A(base, 'skitarii-ranger-diktat')])
    // in sequence: the Alpha acts and ends, the Warrior activates at once, and only then does the opponent
    const window = take(take(s, alpha).state, 'engage').state
    expect(window.pending!.kind).toBe('ploy.firefight')
    const used = take(window, `hc.p.control-edict:${warrior}`).state
    expect(used.players.A.cp).toBe(2)
    const ended = take(passAll(used), 'end').state
    expect(ended.pending!.kind).toBe('firefight.activate')
    expect(ended.pending!.seat).toBe('A')
    expect(ended.pending!.options!.map((o) => o.id)).toEqual([warrior])
    const second = take(take(ended, warrior).state, 'engage').state
    const done = take(passAll(second), 'end').state
    expect(done.pending!.seat).toBe('B')
    // MIND-LINK: free (once per battle), both operatives active together, actions in any order, both expended at the end
    expect(window.pending!.options!.map((o) => o.id)).toEqual(expect.arrayContaining([`hc.p.control-edict:${warrior}:joint:engage`, `hc.p.control-edict:${warrior}:joint:conceal`]))
    const joint = take(window, `hc.p.control-edict:${warrior}:joint:engage`).state
    expect(joint.players.A.cp).toBe(3)
    expect(joint.ledger.A.battle).toContain('hc.mind-link')
    const jt = passAll(joint)
    expect(jt.firefight.activation!.partner?.operativeId).toBe(warrior)
    expect(hasOption(jt, 'switch')).toBe(true)
    expect(jt.operatives[warrior]!.ready).toBe(false)
    // switch, act and end with the partner, then end with the leader: the opponent activates next
    const other = take(jt, 'switch').state
    expect(other.firefight.activation!.operativeId).toBe(warrior)
    const back = take(other, 'end').state
    expect(back.firefight.activation!.operativeId).toBe(alpha)
    const both = take(back, 'end').state
    expect(both.pending!.seat).toBe('B')
    expect(both.operatives[alpha]!.ready).toBe(false)
    // once per battle: the free variants are gone afterwards
    const again = edit(window, (st) => st.ledger.A.battle.push('hc.mind-link'))
    expect(offersFor(again, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: alpha }).filter((o) => o.ployId === P.edict).map((o) => o.param)).toEqual([warrior])
    void boy
  })

  it('TEAM-HC-025 SCRAPCODE OVERLOAD takes 1 off the enemy contesting total when a contesting enemy is within 3" of the Infiltrator, ends when it next activates, and is offered when a nearby enemy declares Pick Up Marker', () => {
    const base = open({ rosterA: FULL })
    const inf = A(base, 'sicarian-infiltrator-warrior')
    const ally = A(base, 'skitarii-ranger-warrior')
    const boy = B(base, 'boy')
    const marker = base.markers.find((m) => m.kind === 'objective')!
    const mp = marker.pos
    const rBoy = base.operatives[boy]!.baseRadius
    // APL 2 (Ranger) against APL 2 (Boy) on the objective: a tie; the Infiltrator stands 2.5" behind the Boy
    const tied = (infX: number) =>
      edit(place(place(place(base, ally, mp.x + 0.9, mp.z), boy, mp.x - 0.9, mp.z), inf, infX, mp.z + 5), (st) => {
        st.players.A.cp = 3
        st.operatives[inf]!.pos = { x: infX, y: 0, z: mp.z - rBoy - 2.5 - base.operatives[inf]!.baseRadius }
      })
    const withFx = (st: GameState) => edit(st, (x) => x.effects.push({ id: 'e-scrap', source: P.scrapcode, seat: 'A', kind: 'hc.scrapcode', operativeId: inf, expires: `startOfActivation:${inf}` }))
    const control = (st: GameState) => markerControl(st, st.markers.find((m) => m.id === marker.id)!)
    const near = tied(mp.x - 0.9)
    expect(control(near).apl).toEqual({ A: 2, B: 2 })
    expect(control(near).controller).toBeNull()
    expect(control(withFx(near)).apl).toEqual({ A: 2, B: 1 })
    expect(control(withFx(near)).controller).toBe('A')
    // the Infiltrator more than 3" from the contesting Boy: nothing changes
    const far = tied(mp.x - 0.9 + 6)
    expect(control(withFx(far)).apl).toEqual({ A: 2, B: 2 })
    // activating the Infiltrator ends the effect
    const ended = take(passAll(take(take(withFx(near), inf).state, 'engage').state), 'end').state
    expect(ended.effects.some((e) => e.kind === 'hc.scrapcode')).toBe(false)
    // used at the Infiltrator's activation
    const window = take(take(near, inf).state, 'engage').state
    expect(hasOption(window, 'hc.p.scrapcode-overload')).toBe(true)
    // offered to the Hunter Clade player when an enemy within 3" of an Infiltrator declares Pick Up Marker (not Operate Hatch)
    const asked = (st: GameState, action: string) =>
      offersFor(st, 'A', 'firefight.opponentActionDeclared', { window: 'firefight.opponentActionDeclared', actorId: boy, action, counteracting: false }).filter((o) => o.ployId === P.scrapcode)
    expect(asked(near, 'marker:pickUp').map((o) => o.operativeId)).toEqual([inf])
    expect(asked(near, 'ability:core.a.secure')).toHaveLength(1)
    expect(asked(near, 'ability:core.a.operate-hatch')).toHaveLength(0)
    expect(asked(near, 'reposition')).toHaveLength(0)
    expect(asked(far, 'marker:pickUp')).toHaveLength(0)
  })

  it("TEAM-HC-031 SCRAPCODE OVERLOAD is offered when the Infiltrator itself is about to perform a mission action, in its activation and in a counteraction, and not for its other actions", () => {
    const start = inTp(open({ rosterA: roster(['hc.sicarian-infiltrator-warrior']), rosterB: roster(['kom.boss-nob', 'kom.boy', 'kom.boy']) }), 2)
    const inf = A(start, 'sicarian-infiltrator-warrior')
    const obj = start.markers.find((m) => m.kind === 'objective')!
    const s = edit(place(start, inf, obj.pos.x, obj.pos.z), (st) => (st.players.A.cp = 3))
    const secure = `ability:core.a.secure:${obj.id}`
    // in its own activation: declaring Secure opens the declaration window with the ploy
    const own = take(activateOp(s, inf), secure).state
    expect(own.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A' })
    expect(hasOption(own, P.scrapcode)).toBe(true)
    const used = take(own, P.scrapcode).state
    expect(used.players.A.cp).toBe(2)
    expect(used.effects.some((e) => e.kind === 'hc.scrapcode' && e.operativeId === inf)).toBe(true)
    // a Reposition opens no window for it
    const moved = take(activateOp(s, inf), 'reposition').state
    expect(moved.pending!.kind).not.toBe('ploy.firefight')
    // the wider declaration window (batch C/D shared: Fall Back, Charge, Reposition, free actions) adds no offer for
    // moves; a free mission action is still a mission action
    const declared = (action: string, free = false) =>
      offersFor(s, 'A', 'firefight.actionDeclared', { window: 'firefight.actionDeclared', subjectId: inf, action, ...(free ? { free: true } : {}) } as never).some((o) => o.ployId === P.scrapcode)
    for (const action of ['fallBack', 'charge', 'reposition', 'dash']) expect(declared(action), action).toBe(false)
    expect(declared('ability:core.a.secure', true)).toBe(true)
    // in a counteraction: A's only operative is expended, a Kommando activates, the Infiltrator counteracts into Secure
    let c = take(activateOp(s, inf), 'end').state
    c = take(activateOp(c, B(c, 'boss-nob')), 'end').state
    c = take(c, `counteract:${inf}`).state
    while (c.pending?.kind === 'ploy.firefight') c = passIt(c).state
    c = take(c, secure).state
    expect(c.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A' })
    expect(hasOption(c, P.scrapcode)).toBe(true)
    expect(take(c, P.scrapcode).state.effects.some((e) => e.kind === 'hc.scrapcode' && e.operativeId === inf)).toBe(true)
  })

  it("TEAM-HC-026 TEAM-HC-027 OMNISSIAH'S IMPERATIVE adds a rule from the current Imperative: Protector Severe, Bulwark Save and a fourth die when shot, Conqueror a second strike, Aggressor a free 2\" of climbing; Neutral is not offered; no self-damage", () => {
    const base = open({ rosterA: FULL })
    const warrior = A(base, 'skitarii-ranger-warrior')
    const boy = B(base, 'boy')
    const start = (mode: string | null) => edit(place(place(base, warrior, 0, 0), boy, 6, 0), (st) => {
      st.players.A.cp = 3
      st.config.A.doctrine = mode
    })
    const window = (st: GameState) => take(take(st, warrior).state, 'engage').state
    // Protector: offered in the activation, gives Severe on ranged weapons and costs no wounds
    const p = start('protector')
    const w = window(p)
    expect(hasOption(w, P.omnissiah)).toBe(true)
    const used = take(w, P.omnissiah).state
    expect(used.players.A.cp).toBe(2)
    expect(used.operatives[warrior]!.wounds).toBe(used.operatives[warrior]!.maxWounds)
    const rules = (st: GameState) => effectiveRules(st, st.operatives[warrior]!, st.data.weapons['hc.w.galvanic-rifle']!, 'shoot', boy).map((r) => r.rule)
    expect(rules(used)).toContain('core.wr.severe')
    expect(rules(p)).not.toContain('core.wr.severe')
    // under Neutral (or no Imperative) it is not offered at all
    expect(hasOption(window(start('neutral')), P.omnissiah)).toBe(false)
    expect(hasOption(window(start(null)), P.omnissiah)).toBe(false)
    // Bulwark when shot: used once the enemy's attack dice are final, the Ranger saves on 3+ with four defence dice
    const b = start('bulwark')
    const ender = A(b, 'skitarii-vanguard-warrior')
    const turn = take(activateOp(b, ender), 'end').state
    expect(turn.pending!.seat).toBe('B')
    const aim = take(take(activateOp(turn, boy), 'shoot').state, 'kom.w.slugga').state
    const rng = new ScriptedRng([6, 6, 6, 6, 3, 3, 3, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
    const r = play(aim, rng, {
      'shoot.target': (q) => pickOpt(q, warrior),
      'ploy.firefight': (q) => (q.seat === 'A' && q.options?.find((o) => o.id === P.omnissiah)?.action) || pass(q),
    })
    const def = evs(r.events, 'DefenceDiceRolled')[0]!
    expect(def.need).toBe(3)
    expect(def.collected).toBe(4)
    // Conqueror: after its first resolved die a fighter resolves another at once (once per fight)
    const conq = edit(start('conqueror'), (st) => {
      st.operatives[warrior]!.tokens = [{ kind: T.omnissiah, owner: 'A', count: 1, data: { mode: 'conqueror' } }]
      st.attack = { kind: 'fight', operativeId: warrior, fight: {} } as never
    })
    expect(providerAfterResolution(conq, conq.attack!, 'A', 'strike')).toEqual([{ seat: 'A' }])
    // Aggressor: the first 2" of a climb up cost nothing
    const agg = edit(start('aggressor'), (st) => {
      st.operatives[warrior]!.tokens = [{ kind: T.omnissiah, owner: 'A', count: 1, data: { mode: 'aggressor' } }]
    })
    const climb = (st: GameState, inches: number) => providerMoveSurcharge(st, st.operatives[warrior]!, 'reposition', [], { horizontal: 0, accessible: 0, climb: inches, drop: 0 })
    expect(climb(agg, 2)).toBe(-2)
    expect(climb(agg, 1)).toBe(-1)
    expect(climb(agg, 4)).toBe(-2)
    expect(climb(start('aggressor'), 2)).toBe(0)
  })

  it(`TEAM-HC-028 TEAM-HC-029 RAD BOMBARDMENT is a once-per-battle gambit from TP2: each enemy in the picked objective control range rolls, 4+ costs APL, 6 adds D3 damage, and standing under Vantage turns a 6 into a 5; REDUNDANCY SYSTEMS heals D3+2 at activation outside an enemy control range once per TP; REFRACTOR FIELD takes 1 off Piercing for one sequence, once per TP`, () => {
    {
      const g = toGambit({ rosterA: FULL, equipmentA: [E.rad] })
      const marker = g.markers.find((m) => m.kind === 'objective')!
      const boy = B(g, 'boy')
      const grot = B(g, 'grot')
      const nob = B(g, 'boss-nob')
      const staged = (tp: number, vantage = false) =>
        refreshGambit(
          edit(g, (st) => {
            st.turningPoint = tp
            const m = st.markers.find((k) => k.kind === 'objective')!
            st.map = { ...st.map, features: vantage ? [feature('tower', part('tower.a', rect(m.pos.x - 3, m.pos.x + 3, m.pos.z - 3, m.pos.z + 3), 3, ['vantage'], { bottom: 2.5 }))] : [] }
            let a = 0
            let b = 0
            for (const op of Object.values(st.operatives)) op.pos = op.seat === 'A' ? { x: -13.5, y: 0, z: -10 + a++ * 1.7 } : { x: 13.5, y: 0, z: -10 + b++ * 1.7 }
            st.operatives[boy]!.pos = { x: marker.pos.x + 0.5, y: 0, z: marker.pos.z }
            st.operatives[grot]!.pos = { x: marker.pos.x, y: 0, z: marker.pos.z + 0.7 }
            st.operatives[nob]!.pos = { x: marker.pos.x + 10, y: 0, z: marker.pos.z + 5 }
            st.markers = st.markers.filter((m) => m.kind === 'objective')
            for (const m of st.markers) m.controller = null
          }),
        )
      const id = `hc.p.rad-bombardment:marker:${marker.id}`
      expect(hasOption(staged(1), id)).toBe(false)
      const s = staged(2)
      expect(hasOption(s, id)).toBe(true)
      const [hit, miss] = bombardmentVictims(s, 'A', `marker:${marker.id}`).map((o) => o.id)
      expect([hit, miss].sort()).toEqual([boy, grot].sort())
      // the first (in id order) rolls 6 and then 4 for damage (D3 = 2); the second rolls 3: untouched
      const t = take(s, id, new ScriptedRng([6, 4, 3])).state
      expect(effectiveApl(t.operatives[hit!]!)).toBe(t.operatives[hit!]!.apl - 1)
      expect(t.operatives[hit!]!.wounds).toBe(t.operatives[hit!]!.maxWounds - 2)
      expect(effectiveApl(t.operatives[miss!]!)).toBe(t.operatives[miss!]!.apl)
      expect(t.operatives[miss!]!.wounds).toBe(t.operatives[miss!]!.maxWounds)
      expect(t.operatives[nob]!.wounds).toBe(t.operatives[nob]!.maxWounds)
      expect(t.ledger.A.battle).toContain('hc.rad-bombardment')
      // a 4 costs APL only; a 3 nothing
      const four = take(s, id, new ScriptedRng([4, 3])).state
      expect(effectiveApl(four.operatives[hit!]!)).toBe(four.operatives[hit!]!.apl - 1)
      expect(four.operatives[hit!]!.wounds).toBe(four.operatives[hit!]!.maxWounds)
      // once per battle
      expect(hasOption(edit(t, (st) => (st.turningPoint = 3)), id)).toBe(false)
      expect(offersFor(edit(t, (st) => (st.turningPoint = 3)), 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === P.radBombardment)).toBe(false)
      // under Vantage a natural 6 is a 5: APL only, no damage
      const v = staged(2, true)
      expect(baseUnderVantage(v, bodyOf(v.operatives[grot]!))).toBe(true)
      expect(baseUnderVantage(v, bodyOf(v.operatives[boy]!))).toBe(true)
      expect(hasOption(v, id)).toBe(true)
      const under = take(v, id, new ScriptedRng([6, 6, 6, 6])).state
      for (const who of [boy, grot]) {
        expect(effectiveApl(under.operatives[who]!)).toBe(under.operatives[who]!.apl - 1)
        expect(under.operatives[who]!.wounds).toBe(under.operatives[who]!.maxWounds)
      }
    }
    {
      const base = open({ rosterA: FULL, equipmentA: [E.redundancy, E.refractor] })
      const warrior = A(base, 'skitarii-ranger-warrior')
      const boy = B(base, 'boy')
      const hurt = edit(place(base, warrior, 0, 0), (st) => {
        st.operatives[warrior]!.wounds = 1
      })
      const window = (st: GameState) => take(take(st, warrior).state, 'engage').state
      expect(hasOption(window(hurt), E.redundancy)).toBe(true)
      const healed = take(window(hurt), E.redundancy, new ScriptedRng([4])).state
      expect(healed.operatives[warrior]!.wounds).toBe(5) // D3 of a roll of 4 is 2: 1 + 2 + 2
      expect(healed.ledger.A.tp).toContain(E.redundancy)
      // never above starting wounds, not at full wounds, not in an enemy control range
      const nearlyFull = edit(hurt, (st) => (st.operatives[warrior]!.wounds = 6))
      expect(take(window(nearlyFull), E.redundancy, new ScriptedRng([6])).state.operatives[warrior]!.wounds).toBe(7)
      expect(hasOption(window(edit(hurt, (st) => (st.operatives[warrior]!.wounds = 7))), E.redundancy)).toBe(false)
      expect(hasOption(window(place(hurt, boy, 1.5, 0)), E.redundancy)).toBe(false)
      // REFRACTOR FIELD: Piercing 1 disappears, Piercing 2 becomes 1, Piercing Crits goes too; none offered for a weapon without Piercing
      const weapons = [ranged('t.p1', {}, [{ rule: 'piercing', x: 1 }]), ranged('t.p2', {}, [{ rule: 'piercing', x: 2 }]), ranged('t.pc', {}, [{ rule: 'piercing', x: 1, crits: true }]), ranged('t.none')]
      const s = withWeapons(hurt, ...weapons)
      const info = (w: string) => ({ window: 'shoot.beforeDefenceRoll', subjectId: warrior, attackerId: boy, targetId: warrior, kind: 'shoot', weaponId: w })
      const offer = (st: GameState, w: string) => offersFor(st, 'A', 'shoot.beforeDefenceRoll', info(w)).find((o) => o.ployId === E.refractor)
      expect(offer(s, 't.none')).toBeUndefined()
      const piercing = (st: GameState, w: string) => parseRules(effectiveRules(st, st.operatives[boy]!, st.data.weapons[w]!, 'shoot', warrior))
      const use = (st: GameState, w: string): GameState => withCtx(st, (ctx) => usePloy(ctx, 'A', offer(st, w) as PloyOffer, info(w))).state
      expect(piercing(use(s, 't.p1'), 't.p1').piercing).toBe(0)
      expect(piercing(use(s, 't.p2'), 't.p2').piercing).toBe(1)
      expect(piercing(use(s, 't.pc'), 't.pc').piercingCrits).toBe(0)
      expect(piercing(s, 't.p2').piercing).toBe(2)
      // once per turning point, and it affects only the bearer
      const spent = use(s, 't.p1')
      expect(offer(spent, 't.p1')).toBeUndefined()
      expect(effectiveRules(spent, spent.operatives[boy]!, spent.data.weapons['t.p1']!, 'shoot', A(base, 'skitarii-ranger-diktat')).some((r) => r.rule === 'piercing')).toBe(true)
    }
  })
})
