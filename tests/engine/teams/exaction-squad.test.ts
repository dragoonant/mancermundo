// exaction-squad engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-EX-nnn).
// Exaction Squad are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { view } from '@/engine'
import { abilityOffers, actionForbidden } from '@/engine/abilities'
import { applyAplEffect, attackStats, defenceStats, effectiveRules, inflict, parseRules, runDeferredRemovals, torrentCandidates, validTargets } from '@/engine/attack-common'
import { bodyOf } from '@/engine/los'
import { inControlRange } from '@/engine/measure'
import { getCodeHook } from '@/engine/code-hooks'
import { hasKeyword } from '@/engine/conditions'
import { directDamage, removeNow, tpUsesOf, usedThisTp } from '@/engine/effects'
import { updateControl } from '@/engine/markers'
import { usableRangedWeapons } from '@/engine/shoot'
import { providerAny, providerCostDelta, providerRerollBannedValues } from '@/engine/team-rules'
import { actionAvailability } from '@/engine/firefight'
import { runHook } from '@/engine/hooks'
import { offersFor } from '@/engine/ploys'
import { markerControl } from '@/engine/query'
import { effectiveApl, effectiveMove } from '@/engine/state'
import { TEAM_ID, apprehended, isShellsWeapon, markOf, patternsOf } from '@/engine/teams/exaction-squad'
import { tokenCount } from '@/engine/tokens'
import type { GameState } from '@/engine/types'
import { enumerateLoadouts, loadBundle, loadoutCapProblems, validateRoster, type DatacardData } from '../../../src/data'
import { evs, play, rolled } from '../../fixtures/attack'
import { feature, part, rect } from '../../fixtures/maps'
import { place } from '../../fixtures/helpers'
import { activateOp, edit, optionIds, passIt, realBundle, take, withCtx } from '../../fixtures/real'
import { A, ALL, B, PASS_PLOYS, WITH_CHOICES, bTurn, passPloys, dice, exRoster, facing, goTo, open, rulesOf, shootAt, toGambit, usePlayed, withFx, withPloy } from './exaction-squad.hooks'

const data = loadBundle()

describe('TEAM-EX Exaction Squad', () => {
  it('TEAM-EX-000 TEAM-EX-001 TEAM-EX-002 TEAM-EX-039 TEAM-EX-040 registered team, roster rules, printed loadouts and weapons, keywords, Shells list, mastiff card', () => {
    expect(TEAM_ID).toBe('exaction-squad')
    const team = data.teams['exaction-squad']!
    expect(team.playable).toBe(true)
    const cards = realBundle.datacards
    const main = (...ids: string[]) => ({ leader: ['ex.proctor-exactant'], main: ids })
    const ten = (...head: string[]) => [...head, ...Array<string>(10 - head.length).fill('ex.vigilant')]
    // three Vigilants, four Subductors, two Gunners and a Cyber-mastiff without a Leashmaster
    expect(validateRoster(team, main('ex.vigilant', 'ex.vigilant', 'ex.vigilant', 'ex.subductor', 'ex.subductor', 'ex.subductor', 'ex.subductor', 'ex.gunner', 'ex.gunner', 'ex.cyber-mastiff'), cards as never).ok).toBe(true)
    expect(validateRoster(team, main(...ten('ex.cyber-mastiff', 'ex.castigator')), cards as never).ok).toBe(true)
    // five Vigilants are legal; a third Gunner, a fifth Subductor, a second Malocator and an eleventh pick are not
    expect(validateRoster(team, main(...ten('ex.castigator')), cards as never).ok).toBe(true)
    expect(validateRoster(team, main(...ten('ex.gunner', 'ex.gunner', 'ex.gunner')), cards as never).ok).toBe(false)
    expect(validateRoster(team, main(...ten('ex.subductor', 'ex.subductor', 'ex.subductor', 'ex.subductor', 'ex.subductor')), cards as never).ok).toBe(false)
    expect(validateRoster(team, main(...ten('ex.malocator', 'ex.malocator')), cards as never).ok).toBe(false)
    expect(validateRoster(team, main(...ten(), 'ex.vigilant'), cards as never).ok).toBe(false)
    // a Gunner takes each weapon at most once
    expect(loadoutCapProblems(team, [['ex.w.webber'], ['ex.w.webber']], data.weaponGroups)).toHaveLength(1)
    expect(loadoutCapProblems(team, [['ex.w.webber'], ['ex.w.grenade-launcher']], data.weaponGroups)).toEqual([])
    const count = (id: string) => enumerateLoadouts(data.byId[id] as DatacardData).length
    expect([count('ex.proctor-exactant'), count('ex.gunner'), count('ex.vigilant'), count('ex.marksman'), count('ex.cyber-mastiff')]).toEqual([2, 3, 1, 1, 1])
    // the printed numbers
    const w = (id: string) => data.byId[id] as { atk: number; hit: string; dmg: { normal: number; crit: number }; rules: { rule: string; x?: number; inches?: number; target?: string }[] }
    expect([w('ex.w.combat-shotgun-proctor-close').hit, w('ex.w.combat-shotgun-proctor-long').hit, w('ex.w.combat-shotgun-close').hit, w('ex.w.combat-shotgun-long').hit]).toEqual(['2+', '4+', '3+', '5+'])
    expect([w('ex.w.shotpistol-proctor').hit, w('ex.w.repression-baton-proctor').hit, w('ex.w.shotpistol').hit, w('ex.w.repression-baton').hit]).toEqual(['3+', '3+', '4+', '4+'])
    expect(w('ex.w.grenade-launcher')).toMatchObject({ atk: 5, hit: '4+', dmg: { normal: 4, crit: 5 }, rules: [{ rule: 'core.wr.piercing', x: 1 }] })
    expect(w('ex.w.webber')).toMatchObject({ atk: 4, hit: '3+', dmg: { normal: 4, crit: 5 } })
    expect(w('ex.w.webber').rules.map((r) => r.rule)).toEqual(['core.wr.range', 'core.wr.severe', 'core.wr.stun'])
    expect(w('ex.w.executioner-shotgun-concealed').dmg).toEqual({ normal: 4, crit: 0 })
    expect(w('ex.w.executioner-shotgun-concealed').rules.map((r) => r.rule)).toEqual(['core.wr.devastating', 'core.wr.heavy', 'core.wr.silent', 'ex.a.wr-concealed-position'])
    expect(w('ex.w.executioner-shotgun-mobile').rules).toEqual([])
    expect(w('ex.w.scoped-shotpistol-short').rules.map((r) => r.rule)).toEqual(['core.wr.range', 'core.wr.lethal'])
    expect(w('ex.w.scoped-shotpistol-long').rules).toEqual([])
    expect(w('ex.w.heavy-stubber-sweeping').rules.map((r) => r.rule)).toEqual(['core.wr.heavy', 'core.wr.torrent'])
    expect(w('ex.w.mechanical-bite')).toMatchObject({ atk: 4, hit: '4+', dmg: { normal: 3, crit: 5 }, rules: [{ rule: 'core.wr.lethal', target: '5+' }] })
    for (const id of ['ex.w.dominator-maul-assault-shield', 'ex.w.shock-maul-assault-shield']) expect(w(id).rules.some((r) => r.rule === 'ex.a.wr-repress'), id).toBe(true)
    expect(w('ex.w.excruciator-maul').rules.map((r) => r.rule)).toEqual(['core.wr.rending', 'core.wr.shock'])
    // keywords, wounds, saves, bases and the Shells list
    const s = open()
    for (const op of Object.values(s.operatives).filter((o) => o.seat === 'A')) {
      for (const k of ['EXACTION SQUAD', 'IMPERIUM', 'ADEPTUS ARBITES']) expect(hasKeyword(s, op, k), `${op.name} ${k}`).toBe(true)
      expect(hasKeyword(s, op, 'LEADER')).toBe(op.datacardId === 'ex.proctor-exactant')
      expect(hasKeyword(s, op, 'MEDIC')).toBe(op.datacardId === 'ex.chirurgant')
      expect(op.maxWounds).toBe(op.datacardId === 'ex.proctor-exactant' ? 9 : 8)
      expect(op.baseRadius).toBeCloseTo(op.datacardId === 'ex.cyber-mastiff' ? 25 / 50.8 : 28 / 50.8, 2)
      expect(op.apl).toBe(2)
      expect(op.move).toBe(6)
    }
    expect(s.operatives[A(s, 'subductor')]!.save).toBe(3)
    expect(s.operatives[A(s, 'vigilant')]!.save).toBe(4)
    expect(hasKeyword(s, s.operatives[A(s, 'cyber-mastiff')]!, 'R-VR CYBER-MASTIFF')).toBe(true)
    const mastiff = s.operatives[A(s, 'cyber-mastiff')]!
    expect(mastiff.weapons).toEqual(['ex.w.mechanical-bite'])
    const shells = Object.keys(s.data.weapons).filter((id) => id.startsWith('ex.') && isShellsWeapon(s, id)).sort()
    expect(shells).toEqual([
      'ex.w.combat-shotgun-close',
      'ex.w.combat-shotgun-long',
      'ex.w.combat-shotgun-proctor-close',
      'ex.w.combat-shotgun-proctor-long',
      'ex.w.executioner-shotgun-concealed',
      'ex.w.executioner-shotgun-mobile',
      'ex.w.executioner-shotgun-stationary',
      'ex.w.scoped-shotpistol-long',
      'ex.w.scoped-shotpistol-short',
      'ex.w.shotpistol',
      'ex.w.shotpistol-proctor',
    ])
    // a kill grade for eleven operatives exists: the roster starts a game
    expect(ALL).toHaveLength(11)
    expect(Object.values(s.operatives).filter((o) => o.seat === 'A')).toHaveLength(11)
  })

  it('TEAM-EX-003 MARKED FOR JUSTICE: any enemy is the mark (public), Punishing against it when shooting, fighting and retaliating, a new mark is offered after the action in which it fell, once per turning point', () => {
    const g = toGambit()
    const gambitIds = optionIds(g).filter((i) => i.startsWith('ex.p.marked-for-justice:'))
    expect(gambitIds).toHaveLength(Object.values(g.operatives).filter((o) => o.seat === 'B').length)
    const boy = B(g, 'boy')
    const used = take(g, `ex.p.marked-for-justice:${boy}`).state
    for (const seat of ['A', 'B'] as const) {
      expect(view(used, seat).effects.some((e) => e.kind === 'ex.mark' && e.data!.markId === boy)).toBe(true)
      expect(tokenCount(view(used, seat) as unknown as GameState, boy, 'ex.marked-for-justice')).toBe(1)
    }
    expect(markOf(used, 'A')!.id).toBe(boy)
    // once per turning point
    expect(offersFor(used, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'ex.p.marked-for-justice')).toBe(false)
    // Punishing against the mark only, for shots, fights and retaliation
    const s = open()
    const vig = A(s, 'vigilant')
    const sub = A(s, 'subductor')
    const foe = B(s, 'boy')
    const other = Object.values(s.operatives).find((o) => o.seat === 'B' && o.id !== foe)!.id
    const marked = withFx(s, { source: 'ex.p.marked-for-justice', kind: 'ex.mark', data: { markId: foe } })
    expect(rulesOf(marked, vig, 'ex.w.combat-shotgun-close', 'shoot', foe)).toContain('punishing')
    expect(rulesOf(marked, vig, 'ex.w.combat-shotgun-close', 'shoot', other)).not.toContain('punishing')
    expect(rulesOf(marked, sub, 'ex.w.shock-maul-assault-shield', 'fight', foe)).toContain('punishing')
    expect(rulesOf(marked, B(s, 'boy'), 'kom.w.choppa', 'fight', sub)).not.toContain('punishing')
    // a Vigilant shooting the mark: one crit and a fail keeps the fail as a normal (4 + 4 damage against 40 wounds)
    const target = (st: GameState, id: string) => edit(place(place(st, vig, 0, 0), id, 5, 0), (x) => void (x.operatives[id]!.wounds = x.operatives[id]!.maxWounds = 40))
    const hit = (st: GameState, id: string) => 40 - shootAt(target(st, id), vig, 'ex.w.combat-shotgun-close', id, dice(6, 2, 1, 1, 1, 1, 1)).state.operatives[id]!.wounds
    expect(hit(marked, foe)).toBe(8)
    expect(hit(s, foe)).toBe(4)
    expect(hit(marked, other)).toBe(4)
    // the mark falls to a shot: after the action the Exaction player may name a new mark, and it gets Punishing
    const dying = edit(place(place(marked, vig, 0, 0), foe, 5, 0), (x) => void (x.operatives[foe]!.wounds = 3))
    const shot = shootAt(dying, vig, 'ex.w.combat-shotgun-close', foe, dice(6, 6, 6, 6, 1, 1, 1), {}, 'engage', WITH_CHOICES)
    expect(shot.state.operatives[foe]!.status).toBe('removed')
    expect(shot.state.pending!.kind).toBe('ability.choice')
    const picks = optionIds(shot.state)
    expect(picks.length).toBeGreaterThan(1)
    const next = picks.find((i) => i.startsWith('react:'))!
    expect(shot.state.pending!.options!.find((o) => o.id === next)!.data!.targetId).toBeTruthy()
    const after = take(shot.state, next).state
    expect(after.pending!.kind).toBe('firefight.action')
    const newMark = markOf(after, 'A')!
    expect(newMark.id).not.toBe(foe)
    expect(rulesOf(after, vig, 'ex.w.combat-shotgun-close', 'shoot', newMark.id)).toContain('punishing')
    // declining keeps no mark; no offer when the mark lives
    expect(optionIds(shootAt(target(marked, foe), vig, 'ex.w.combat-shotgun-close', foe, dice(1, 1, 1, 1, 1, 1, 1), {}, 'engage', WITH_CHOICES).state)).toContain('end')
  })

  it('TEAM-EX-004 REPRESS: a Subductor block cancels two enemy successes (a normal block two normals, a crit block any two), a retaliating Subductor resolves first, a baton blocks one', () => {
    const s = open()
    const sub = A(s, 'subductor')
    const vig = A(s, 'vigilant')
    const boy = B(s, 'boy')
    const fightAs = (who: string, ...d: number[]) => {
      const rng = dice(...d)
      return play(take(take(activateOp(facing(s, who, boy), who, 'engage', rng), 'fight', rng).state, boy, rng).state, rng, PASS_PLOYS, ['fight.resolve']).state
    }
    // Subductor attacking: its crit (6) against the boy's two normals (4, 4): the double block is on offer and takes both
    const two = fightAs(sub, 6, 1, 1, 1, 4, 4, 1, 1)
    expect(two.pending!.kind).toBe('fight.resolve')
    const double = optionIds(two).filter((i) => i.startsWith('block2:'))
    expect(double.length).toBeGreaterThan(0)
    const blocked = take(two, double[0]!)
    expect(evs(blocked.events, 'Blocked')).toHaveLength(2)
    // a normal block (4) against a crit and a normal cannot take the crit: no double block; against two normals it can
    const one = fightAs(sub, 4, 1, 1, 1, 6, 4, 1, 1)
    expect(optionIds(one).some((i) => i.startsWith('block2:'))).toBe(false)
    expect(optionIds(fightAs(sub, 4, 1, 1, 1, 4, 4, 1, 1)).some((i) => i.startsWith('block2:'))).toBe(true)
    // the baton blocks one
    expect(optionIds(fightAs(vig, 6, 1, 1, 1, 4, 4, 1, 1)).some((i) => i.startsWith('block2:'))).toBe(false)
    // the attacker resolves first unless the retaliator has Repress
    expect(two.pending!.seat).toBe('A')
    const retaliate = (target: string) => {
      const t = place(place(bTurn(s, A(s, 'proctor-exactant')), target, 0, 0), boy, 1.4, 0)
      const rng = dice(4, 4, 4, 4, 4, 4, 4, 4)
      return play(take(take(activateOp(t, boy, 'engage', rng), 'fight', rng).state, target, rng).state, rng, PASS_PLOYS, ['fight.resolve']).state
    }
    expect(retaliate(sub).pending!.seat).toBe('A')
    expect(retaliate(vig).pending!.seat).toBe('B')
    // both fighters with Repress: the attacker's gives only the double block
    expect(retaliate(A(s, 'proctor-exactant')).pending!.seat).toBe('B')
  })

  it('TEAM-EX-005 RUTHLESS EFFICIENCY: an enemy held by a friendly Exaction operative is still a target (not for frag or krak, not when a non-Exaction friend holds it), also as a Torrent secondary', () => {
    const roster = exRoster([...ALL.slice(0, 10), 'ex.gunner'])
    const s0 = open({ rosterA: roster })
    const vig = A(s0, 'vigilant')
    const sub = A(s0, 'subductor')
    const gun = A(s0, 'gunner')
    const boy = B(s0, 'boy')
    const foes = Object.values(s0.operatives).filter((o) => o.seat === 'B' && o.id !== boy)
    const boy2 = foes[0]!.id
    const s = edit(place(place(place(place(place(s0, vig, 0, 0), sub, 3.6, 0), boy, 5, 0), gun, 0, 2.4), boy2, 5, 1.9), (st) => {
      st.operatives[gun]!.weapons = ['ex.w.heavy-stubber-sweeping', 'ex.w.repression-baton']
    })
    const targets = (st: GameState, who: string, w: string) => validTargets(st, st.operatives[who]!, w).map((t) => t.id)
    expect(inControlRange(s, bodyOf(s.operatives[sub]!), bodyOf(s.operatives[boy]!))).toBe(true)
    expect(targets(s, vig, 'ex.w.combat-shotgun-long')).toContain(boy)
    expect(targets(s, vig, 'ex.w.combat-shotgun-close')).toContain(boy)
    // grenades keep the core rule
    expect(targets(s, vig, 'core.w.frag-grenade')).not.toContain(boy)
    expect(targets(s, vig, 'core.w.krak-grenade')).not.toContain(boy)
    // the same enemy held by a friend that is not Exaction Squad (a test card without the keyword) cannot be chosen
    const plain = edit(s, (st) => {
      const card = st.data.datacards['ex.subductor']!
      st.data = { ...st.data, datacards: { ...st.data.datacards, 'ex.subductor': { ...card, keywords: card.keywords.filter((k) => k !== 'EXACTION SQUAD') } } }
    })
    expect(targets(plain, vig, 'ex.w.combat-shotgun-long')).not.toContain(boy)
    // a Torrent secondary may be the held enemy
    expect(torrentCandidates(s, s.operatives[gun]!, 'ex.w.heavy-stubber-sweeping', boy2, 1)).toContain(boy)
    expect(torrentCandidates(plain, plain.operatives[gun]!, 'ex.w.heavy-stubber-sweeping', boy2, 1)).not.toContain(boy)
  })

  it('TEAM-EX-006 TEAM-EX-007 Nuncio-aquila: enemies near the marker (or the Proctor without it) pay 1 AP more for markers and mission actions and count 1 less APL for control; DEPLOY NUNCIO-AQUILA places and moves it within 6 inches, and it leaves with the Proctor', () => {
    const base = edit(open(), (st) => void (st.turningPoint = 2))
    const proc = A(base, 'proctor-exactant')
    const boy = B(base, 'boy')
    const b1 = B(base, 'boy')
    const b2 = B(base, 'slasha-boy')
    const obj = base.markers.find((m) => m.kind === 'objective')!
    const at = (x: number, z: number) => ({ x: obj.pos.x + x, z: obj.pos.z + z })
    const nuncio = (st: GameState, x: number, z: number): GameState =>
      edit(st, (t) => void t.markers.push({ id: 'exnun9', kind: 'equipment', pos: at(x, z), owner: 'A', carriedBy: null, controller: null, equipmentId: 'ex.nuncio' }))
    const park = (st: GameState, spots: Record<string, [number, number]>): GameState => Object.entries(spots).reduce((acc, [id, [x, z]]) => place(acc, id, obj.pos.x + x, obj.pos.z + z), st)
    const secure = 'ability:core.a.secure'
    const delta = (st: GameState, who: string) => ({ pick: providerCostDelta(st, st.operatives[who]!, 'marker:pickUp'), mission: providerCostDelta(st, st.operatives[who]!, secure), shoot: providerCostDelta(st, st.operatives[who]!, 'shoot') })
    // the marker: 2 AP at 3 inches, 1 AP more at 4
    const withMarker = park(nuncio(base, 0, 0), { [b1]: [-2.6, 0], [b2]: [0, 4.7] })
    expect(delta(withMarker, b1)).toEqual({ pick: 1, mission: 1, shoot: 0 })
    expect(delta(withMarker, b2)).toEqual({ pick: 0, mission: 0, shoot: 0 })
    // the cost shown on the prompt includes it (a mission action on an objective B holds)
    const holds = park(nuncio(base, 0, 0), { [b1]: [-0.9, 0], [A(base, 'vigilant')]: [-6, 6] })
    const opts = activateOp(bTurn(holds, A(base, 'vigilant')), b1).pending!.options!
    expect(opts.find((o) => o.id.startsWith(secure))?.data?.cost).toBe(2)
    expect(activateOp(bTurn(park(base, { [b1]: [-0.9, 0], [A(base, 'vigilant')]: [-6, 6] }), A(base, 'vigilant')), b1).pending!.options!.find((o) => o.id.startsWith(secure))?.data?.cost).toBe(1)
    // no marker: measured from the Proctor, and nothing applies once the Proctor is gone
    const proctorNear = park(base, { [proc]: [-3.5, 0], [b1]: [0, 0.9] })
    expect(delta(proctorNear, b1).mission).toBe(1)
    const noProctor = edit(proctorNear, (st) => void (st.operatives[proc]!.status = 'removed'))
    expect(delta(noProctor, b1)).toEqual({ pick: 0, mission: 0, shoot: 0 })
    // control: two Kommandos (2 + 2) against two Exaction operatives (2 + 2) tie; one Kommando near the marker makes it 3 against 4
    const vigs = [A(base, 'vigilant'), A(base, 'subductor')]
    const tie = park(base, { [b1]: [0.9, 0], [b2]: [0, 0.9], [vigs[0]!]: [-0.9, 0], [vigs[1]!]: [0, -0.9] })
    expect(markerControl(tie, tie.markers.find((m) => m.id === obj.id)!).apl).toEqual({ A: 4, B: 4 })
    expect(markerControl(tie, tie.markers.find((m) => m.id === obj.id)!).controller).toBeNull()
    const marked = nuncio(tie, 2.2, 0)
    const m1 = markerControl(marked, marked.markers.find((m) => m.id === obj.id)!)
    expect(m1.apl).toEqual({ A: 4, B: 3 })
    expect(m1.controller).toBe('A')
    // the reduction is 1 however many are near, and the Exaction player's own total is untouched
    expect(markerControl(marked, marked.markers.find((m) => m.id === obj.id)!).apl.A).toBe(4)
    expect(getCodeHook('exNuncioAquila')).toBeDefined()
    void boy

    // DEPLOY NUNCIO-AQUILA: a spot within 6 inches of the Proctor (0 AP), later moved up to 6 inches from where it stands
    const s = open()
    const p = A(s, 'proctor-exactant')
    const pick = take(activateOp(s, p), 'ability:ex.a.deploy-nuncio-aquila').state
    expect(pick.pending!.kind).toBe('ability.choice')
    for (const o of pick.pending!.options!) {
      expect(Math.max(0, Math.hypot(Number(o.data!.x) - pick.operatives[p]!.pos.x, Number(o.data!.z) - pick.operatives[p]!.pos.z) - pick.operatives[p]!.baseRadius), o.id).toBeLessThanOrEqual(6 + 1e-6)
    }
    const spot = pick.pending!.options![pick.pending!.options!.length - 1]!
    const placed = take(pick, spot.id).state
    expect(placed.firefight.activation!.apSpent).toBe(0)
    expect(placed.markers.find((m) => m.equipmentId === 'ex.nuncio')!.pos).toEqual({ x: spot.data!.x, z: spot.data!.z })
    expect(optionIds(placed).some((i) => i.startsWith('ability:ex.a.deploy-nuncio-aquila'))).toBe(false)
    // later: moved, again within 6 inches of where it stands
    const old = { x: -6, z: 4 }
    const holding = edit(s, (st) => void st.markers.push({ id: 'exnun9', kind: 'equipment', pos: old, owner: 'A', carriedBy: null, controller: null, equipmentId: 'ex.nuncio' }))
    const again = take(activateOp(holding, p), 'ability:ex.a.deploy-nuncio-aquila').state
    for (const o of again.pending!.options!) expect(Math.hypot(Number(o.data!.x) - old.x, Number(o.data!.z) - old.z)).toBeLessThanOrEqual(6 + 1e-6)
    expect(take(again, again.pending!.options![0]!.id).state.markers.filter((m) => m.equipmentId === 'ex.nuncio')).toHaveLength(1)
    // not in an enemy control range, not as a counteraction
    expect(optionIds(activateOp(place(place(s, p, 0, 0), boy, 1.4, 0), p)).some((i) => i.startsWith('ability:ex.a.deploy'))).toBe(false)
    const counter = edit(s, (st) => void (st.firefight.activation = { operativeId: p, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }))
    expect(abilityOffers(counter, counter.operatives[p]!, counter.firefight.activation).some((o) => o.abilityId === 'ex.a.deploy-nuncio-aquila')).toBe(false)
    // the marker leaves with the Proctor
    const gone = withCtx(placed, (ctx) => {
      removeNow(ctx, p)
      updateControl(ctx)
    }).state
    expect(gone.markers.some((m) => m.equipmentId === 'ex.nuncio')).toBe(false)
  })

  it('TEAM-EX-008 Handler: activating the Leashmaster offers the ready mastiff as a joint partner (its own order); never when the mastiff is expended or activated first, nor in a counteraction', () => {
    const s0 = open()
    const leash = A(s0, 'leashmaster')
    const dog = A(s0, 'cyber-mastiff')
    const s = place(place(s0, leash, 0, 0), dog, 2.5, 2.5)
    const start = (st: GameState, who: string) => take(take(st, who).state, 'engage').state
    const t = start(s, leash)
    expect(t.pending!.kind).toBe('ploy.firefight')
    const offers = optionIds(t).filter((i) => i.startsWith('ex.x.handler:'))
    expect(offers.sort()).toEqual([`ex.x.handler:${dog}:conceal`, `ex.x.handler:${dog}:engage`])
    const joint = take(t, `ex.x.handler:${dog}:engage`).state
    // the pair acts action by action: the Leashmaster moves, then the player switches to the mastiff, which has its own AP
    expect(joint.firefight.activation!.partner!.operativeId).toBe(dog)
    expect(joint.operatives[dog]!.ready).toBe(false)
    expect(joint.operatives[dog]!.order).toBe('engage')
    let u = passPloys(joint)
    u = take(u, 'reposition').state
    u = play(u, dice(), goTo(-1.5, 1.5)).state
    expect(optionIds(u)).toContain('switch')
    const asDog = take(u, 'switch').state
    expect(asDog.pending!.context.operativeId).toBe(dog)
    expect(asDog.pending!.context.apRemaining).toBe(2)
    const dogMove = play(take(asDog, 'dash').state, dice(), goTo(4, 3)).state
    expect(dogMove.operatives[dog]!.pos.x).toBeCloseTo(4, 0)
    expect(optionIds(dogMove)).toContain('switch')
    // not when the mastiff is expended, nor when it is activated first (it has no Handler), nor in a counteraction
    const tired = edit(s, (st) => void (st.operatives[dog]!.ready = false))
    expect(optionIds(start(tired, leash)).some((i) => i.startsWith('ex.x.handler'))).toBe(false)
    const dogFirst = take(take(s, dog).state, 'engage').state
    expect(dogFirst.pending!.kind).toBe('firefight.action')
    const counter = edit(s, (st) => {
      st.operatives[leash]!.ready = false
      st.firefight.activation = { operativeId: leash, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }
    })
    expect(offersFor(counter, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: leash, counteracting: true }).some((o) => o.id.startsWith('ex.x.handler'))).toBe(false)
  })

  it('TEAM-EX-009 TEAM-EX-010 Attack Pattern (TP1 gambit, two different patterns kept for the battle) and R-VR COMMAND (swap one): Swift +2 inches Move, Defensive Save 3+, Aggressive Relentless', () => {
    const g = toGambit()
    const ids = optionIds(g).filter((i) => i.startsWith('ex.p.attack-pattern:'))
    expect(ids.sort()).toEqual(['ex.p.attack-pattern:aggressive+defensive', 'ex.p.attack-pattern:aggressive+swift', 'ex.p.attack-pattern:swift+defensive'])
    const dog = A(g, 'cyber-mastiff')
    const leash = A(g, 'leashmaster')
    const used = take(g, 'ex.p.attack-pattern:swift+defensive').state
    expect(patternsOf(used, used.operatives[dog]!)).toEqual(['swift', 'defensive'])
    for (const seat of ['A', 'B'] as const) {
      expect(tokenCount(view(used, seat) as unknown as GameState, dog, 'ex.swift')).toBe(1)
      expect(tokenCount(view(used, seat) as unknown as GameState, dog, 'ex.defensive')).toBe(1)
      expect(tokenCount(view(used, seat) as unknown as GameState, dog, 'ex.aggressive')).toBe(0)
    }
    expect(used.operatives[dog]!.save).toBe(3)
    expect(effectiveMove(used.operatives[dog]!, used)).toBe(8)
    // Swift: the Reposition reaches 8 inches; Defensive: defence dice need 3+; Aggressive: the bite gains Relentless
    const open1 = edit(open(), (st) => void (st.operatives[A(st, 'cyber-mastiff')]!.save = 3))
    expect(open1.operatives[dog]!.save).toBe(3)
    const patterned = (...ps: string[]) => usePlayed(open(), 'ex.p.attack-pattern', {}, ps.join('+'))
    const sd = patterned('swift', 'defensive')
    expect(take(activateOp(sd, dog), 'reposition').state.pending!.context.maxInches).toBe(8)
    const boy = B(sd, 'boy')
    const rules = parseRules(effectiveRules(sd, sd.operatives[dog]!, sd.data.weapons['ex.w.mechanical-bite']!, 'fight', boy))
    expect(rules.relentless).toBe(false)
    const ag = patterned('aggressive', 'swift')
    expect(parseRules(effectiveRules(ag, ag.operatives[dog]!, ag.data.weapons['ex.w.mechanical-bite']!, 'fight', boy)).relentless).toBe(true)
    expect(ag.operatives[dog]!.save).toBe(4)
    expect(defenceStats(sd, dog, boy, 'kom.w.slugga', parseRules([]), false).need).toBe(3)
    expect(defenceStats(ag, dog, boy, 'kom.w.slugga', parseRules([]), false).need).toBe(4)
    // not in turning point 2, not without a Leashmaster; the patterns stay after the Leashmaster falls
    const tp2 = edit(g, (st) => void (st.turningPoint = 2))
    expect(offersFor(tp2, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'ex.p.attack-pattern')).toBe(false)
    const noLeash = toGambit({ rosterA: exRoster(ALL.filter((c) => c !== 'ex.leashmaster')) })
    expect(optionIds(noLeash).some((i) => i.startsWith('ex.p.attack-pattern'))).toBe(false)
    const orphaned = edit(used, (st) => void (st.operatives[leash]!.status = 'removed'))
    expect(patternsOf(orphaned, orphaned.operatives[dog]!)).toEqual(['swift', 'defensive'])

    // R-VR COMMAND: no pattern, no swap; with patterns a held one is swapped for the one missing (0 AP, anywhere)
    const fresh = open()
    expect(optionIds(activateOp(fresh, A(fresh, 'leashmaster'))).some((i) => i.startsWith('ability:ex.a.r-vr-command'))).toBe(false)
    const cmd = (st: GameState) => optionIds(activateOp(st, A(st, 'leashmaster'))).filter((i) => i.startsWith('ability:ex.a.r-vr-command'))
    expect(cmd(sd).sort()).toEqual([`ability:ex.a.r-vr-command:${dog}:defensive`, `ability:ex.a.r-vr-command:${dog}:swift`])
    const swapped = take(activateOp(sd, A(sd, 'leashmaster')), `ability:ex.a.r-vr-command:${dog}:swift`).state
    expect(patternsOf(swapped, swapped.operatives[dog]!).sort()).toEqual(['aggressive', 'defensive'])
    expect(swapped.firefight.activation!.apSpent).toBe(0)
    expect(effectiveMove(swapped.operatives[dog]!, swapped)).toBe(6)
    expect(swapped.operatives[dog]!.save).toBe(3)
    expect(tokenCount(swapped, dog, 'ex.swift')).toBe(0)
    expect(tokenCount(swapped, dog, 'ex.aggressive')).toBe(1)
    const noShield = take(activateOp(sd, A(sd, 'leashmaster')), `ability:ex.a.r-vr-command:${dog}:defensive`).state
    expect(patternsOf(noShield, noShield.operatives[dog]!).sort()).toEqual(['aggressive', 'swift'])
    expect(noShield.operatives[dog]!.save).toBe(4)
    expect(effectiveMove(noShield.operatives[dog]!, noShield)).toBe(8)
  })

  it('TEAM-EX-011 TEAM-EX-012 Beast and APPREHEND: the mastiff takes only its list of actions and no equipment weapons; the apprehended enemy hits 1 worse (not on top of injury) and cannot Fall Back while it stays in the mastiff\'s control range; ASSAULT SHIELD: 3+ Save with the maul set', () => {
    const s0 = open({ equipmentA: ['core.e.explosive-grenades'] })
    const dog = A(s0, 'cyber-mastiff')
    const boy = B(s0, 'boy')
    // no grenades for the Beast; every other operative may have them
    expect(s0.operatives[dog]!.weapons).toEqual(['ex.w.mechanical-bite'])
    expect(s0.operatives[A(s0, 'vigilant')]!.weapons).toContain('core.w.frag-grenade')
    const allowed = ['reposition', 'dash', 'charge', 'fallBack', 'fight', 'guard', 'end']
    const lone = edit(place(s0, dog, 0, 0), (st) => void (st.turningPoint = 2))
    const loneIds = optionIds(activateOp(lone, dog))
    expect(loneIds.filter((i) => !allowed.includes(i) && !i.startsWith('ability:ex.a.apprehend'))).toEqual([])
    expect(loneIds).toContain('guard')
    expect(loneIds).not.toContain('shoot')
    // a mission action on an objective it holds is still refused
    const obj = lone.markers.find((m) => m.kind === 'objective')!
    expect(optionIds(activateOp(place(lone, dog, obj.pos.x + 1, obj.pos.z), dog)).some((i) => i.startsWith('ability:core.a'))).toBe(false)
    expect(actionForbidden(lone, lone.operatives[dog]!, 'shoot')).toMatch(/Beast/)
    // APPREHEND: 0 AP, an enemy in its control range only
    const pinned = place(place(s0, dog, 0, 0), boy, 1.4, 0)
    expect(optionIds(activateOp(place(s0, dog, 0, 0), dog)).some((i) => i.startsWith('ability:ex.a.apprehend'))).toBe(false)
    const act = take(activateOp(pinned, dog), `ability:ex.a.apprehend:${boy}`).state
    expect(act.firefight.activation!.apSpent).toBe(0)
    expect(apprehended(act, act.operatives[boy]!)).toBe(true)
    expect(tokenCount(act, boy, 'ex.apprehend')).toBe(1)
    const hit = (st: GameState) => attackStats(st, boy, 'kom.w.choppa', dog, { kind: 'fight' }).need
    const free = hit(pinned)
    expect(hit(act)).toBe(free + 1)
    // an injured enemy is only 1 worse in total
    const hurt = edit(act, (st) => void (st.operatives[boy]!.wounds = 3))
    expect(hit(hurt)).toBe(hit(edit(pinned, (st) => void (st.operatives[boy]!.wounds = 3))))
    expect(hit(hurt)).toBe(free + 1)
    // it cannot Fall Back
    expect(actionForbidden(act, act.operatives[boy]!, 'fallBack')).toMatch(/apprehended/)
    expect(actionForbidden(pinned, pinned.operatives[boy]!, 'fallBack')).toBeNull()
    expect(optionIds(activateOp(take(act, 'end').state, boy))).not.toContain('fallBack')
    // leaving the control range ends it for good: back in range, nothing is left
    const afterMove = (st: GameState, id: string, x: number, z: number): GameState =>
      withCtx(place(st, id, x, z), (ctx) => runHook('action.ended', { seat: 'B', state: ctx.state, engine: ctx, operativeId: id, data: { action: 'reposition', counteract: false, free: false, activeSeat: 'B' } })).state
    const away = afterMove(act, boy, 6, 0)
    expect(tokenCount(away, boy, 'ex.apprehend')).toBe(0)
    const back = place(away, boy, 1.4, 0)
    expect(apprehended(back, back.operatives[boy]!)).toBe(false)
    // using it on another enemy releases the first
    const second = B(s0, 'slasha-boy')
    const held = edit(place(pinned, second, -1.4, 0), (st) => void (st.operatives[boy]!.tokens = [{ kind: 'ex.apprehend', owner: 'A', count: 1, sourceId: dog, expires: ['sourceIncapacitated'], data: { by: dog } }]))
    expect(apprehended(held, held.operatives[boy]!)).toBe(true)
    const again = take(activateOp(held, dog), `ability:ex.a.apprehend:${second}`).state
    expect(tokenCount(again, boy, 'ex.apprehend')).toBe(0)
    expect(tokenCount(again, second, 'ex.apprehend')).toBe(1)

    // ASSAULT SHIELD: the maul set has a 3+ Save for the whole battle, the shotgun set 4+
    const maulSet = [{ datacardId: 'ex.proctor-exactant', loadout: { weaponIds: ['ex.w.shotpistol-proctor', 'ex.w.dominator-maul-assault-shield'] } }, ...exRoster(ALL.slice(1))]
    const m = open({ rosterA: maulSet })
    const proc = A(m, 'proctor-exactant')
    expect(m.operatives[proc]!.save).toBe(3)
    for (const seat of ['A', 'B'] as const) expect((view(m, seat).operatives[proc] as { save: number }).save).toBe(3)
    expect(defenceStats(m, proc, B(m, 'boy'), 'kom.w.slugga', parseRules([]), false).need).toBe(3)
    expect(open().operatives[A(open(), 'proctor-exactant')]!.save).toBe(4)
  })

  it('TEAM-EX-013 TEAM-EX-014 Medic! saves a falling friend once per turning point (floor at 1, APL -1 for both unless the Mirror-visor, activation ends, a free Dash into the Chirurgant\'s control range); MEDIKIT heals 2D3, itself included, never the Medic! target', () => {
    const s = open()
    const med = A(s, 'chirurgant')
    const vig = A(s, 'vigilant')
    const boy = B(s, 'boy')
    const near = edit(place(place(s, med, 0, 0), vig, 2, 0), (st) => {
      st.operatives[vig]!.wounds = 2
      st.firefight.activation = { operativeId: vig, seat: 'A', counteract: false, stage: 'action', apSpent: 1, performed: [], declared: null }
    })
    // attack damage (a fight by the Boy): inside an attack Medic! is used automatically
    const fightBy = { kind: 'fight', stage: 'resolve', operativeId: boy, seat: 'B', weaponId: 'kom.w.choppa', pointBlank: false, targets: [vig], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] }
    const hit = (st: GameState, amount: number) =>
      withCtx(st, (ctx) => {
        ctx.state.attack ??= structuredClone(fightBy) as never
        inflict(ctx, { targetId: vig, attackerId: boy, weaponId: 'kom.w.choppa', amount, source: 'normal' })
      }).state
    const saved = hit(near, 5)
    expect(saved.operatives[vig]!.wounds).toBe(1)
    expect(saved.operatives[vig]!.aplMods).toBe(-1)
    expect(saved.operatives[med]!.aplMods).toBe(-1)
    expect(saved.firefight.activation!.endsAfterAction).toBe(true)
    expect(saved.effects.some((e) => e.kind === 'ex.medicDash' && e.operativeId === vig)).toBe(true)
    expect(tokenCount(saved, vig, 'ex.medic')).toBe(1)
    // nothing takes it down for the rest of the action; a second save this turning point is not offered
    expect(hit(saved, 9).operatives[vig]!.wounds).toBe(1)
    const later = edit(saved, (st) => void (st.effects = st.effects.filter((e) => e.kind !== 'ex.medicFloor')))
    expect(hit(later, 9).operatives[vig]!.wounds).toBe(0)
    // not saved: out of 3", an enemy in control range, the Chirurgant a Blast secondary target
    expect(hit(edit(place(near, vig, 5, 0), (st) => void (st.operatives[vig]!.wounds = 2)), 5).operatives[vig]!.wounds).toBe(0)
    expect(hit(place(near, boy, 3, 0), 5).operatives[vig]!.wounds).toBe(0)
    const secondary = edit(near, (st) => void (st.attack = { kind: 'shoot', stage: 'resolve', operativeId: boy, seat: 'B', weaponId: 'kom.w.slugga', pointBlank: false, targets: [vig, med], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] }))
    expect(hit(secondary, 5).operatives[vig]!.wounds).toBe(0)
    // the Mirror-visor ignores both APL decreases
    const visor = open({ equipmentA: ['ex.e.reinforced-mirror-visor'] })
    const vNear = edit(place(place(visor, med, 0, 0), vig, 2, 0), (st) => {
      st.operatives[vig]!.wounds = 2
      st.firefight.activation = { operativeId: vig, seat: 'A', counteract: false, stage: 'action', apSpent: 1, performed: [], declared: null }
    })
    const vSaved = hit(vNear, 5)
    expect(vSaved.operatives[vig]!.aplMods).toBe(-1)
    expect(effectiveApl(vSaved.operatives[vig]!)).toBe(2)
    expect(effectiveApl(vSaved.operatives[med]!)).toBe(2)
    // in the enemy's activation the Dash is a reaction after the shot: the Vigilant ends in the Chirurgant's control range
    const shot = edit(place(place(place(s, med, 0, 0), vig, 2, 0), boy, 6, 0), (st) => void (st.operatives[vig]!.wounds = 2))
    const hurt = bTurn(shot, A(shot, 'proctor-exactant'))
    const rng = dice(6, 6, 6, 6, 1, 1, 1)
    let t = passPloys(take(activateOp(hurt, boy, 'engage', rng), 'shoot', rng).state, rng)
    t = take(t, 'kom.w.slugga', rng).state
    t = take(t, vig, rng).state
    const r = play(t, rng, PASS_PLOYS, ['ability.choice', 'firefight.action', 'firefight.activate'])
    expect(r.state.operatives[vig]!.wounds).toBe(1)
    expect(r.state.pending!.kind).toBe('ability.choice')
    const dash = take(r.state, optionIds(r.state).find((i) => i.startsWith('react:'))!).state
    expect(dash.pending!.kind).toBe('move.path')
    const done = play(dash, rng, goTo(1.3, 0), ['firefight.action', 'firefight.activate']).state
    expect(inControlRange(done, bodyOf(done.operatives[vig]!), bodyOf(done.operatives[med]!))).toBe(true)

    // MEDIKIT: 1 AP, 2D3 (here 1 + 1), never above the starting wounds, itself included
    const sub = A(s, 'subductor')
    const hurtSub = edit(place(place(s, med, 0, 0), sub, 1.3, 0), (st) => {
      st.operatives[sub]!.wounds = 3
      st.operatives[med]!.wounds = 4
    })
    const kit = take(activateOp(hurtSub, med), `ability:ex.a.medikit:${sub}`, dice(2, 2))
    expect(kit.state.operatives[sub]!.wounds).toBe(5)
    expect(kit.state.firefight.activation!.apSpent).toBe(1)
    expect(optionIds(activateOp(hurtSub, med))).toContain(`ability:ex.a.medikit:${med}`)
    expect(take(activateOp(hurtSub, med), `ability:ex.a.medikit:${sub}`, dice(6, 6)).state.operatives[sub]!.wounds).toBe(8)
    const marked = edit(hurtSub, (st) => void st.ledger.A.tp.push(`ex.medic.saved:${sub}`))
    expect(optionIds(activateOp(marked, med))).not.toContain(`ability:ex.a.medikit:${sub}`)
    expect(optionIds(activateOp(place(hurtSub, boy, 1.4, 0), med)).some((i) => i.startsWith('ability:ex.a.medikit'))).toBe(false)
  })

  it('TEAM-EX-015 TEAM-EX-016 TEAM-EX-017 TEAM-EX-024 Castigator and Subductor: Engendered Focus (injury, APL decreases and Hit worsenings ignored, not Save), Zealous Dedication (D6 5+ on a die of 3+), Castigator\'s Arrest (a lone enemy cannot Fall Back), Stubborn Subjugator (melee Hit only)', () => {
    const s = open()
    const cas = A(s, 'castigator')
    const sub = A(s, 'subductor')
    const boy = B(s, 'boy')
    const maul = 'ex.w.excruciator-maul'
    const hurt = (st: GameState, id: string) => edit(st, (x) => void (x.operatives[id]!.wounds = 3))
    // Engendered Focus: injured, the Castigator keeps Move 6 and Hit 3+; a Stun does not lower its APL, a Signal raises it to 3
    const c = hurt(s, cas)
    expect(effectiveMove(c.operatives[cas]!, c)).toBe(6)
    expect(attackStats(c, cas, maul, boy, { kind: 'fight' }).need).toBe(3)
    expect(attackStats(c, cas, 'ex.w.combat-shotgun-close', boy, { kind: 'shoot' }).need).toBe(3)
    expect(effectiveMove(hurt(s, A(s, 'vigilant')).operatives[A(s, 'vigilant')]!, s)).toBe(4)
    const apl = withCtx(c, (ctx) => {
      applyAplEffect(ctx, cas, -1, 'stun')
    }).state
    expect(effectiveApl(apl.operatives[cas]!)).toBe(2)
    const signalled = withCtx(apl, (ctx) => {
      applyAplEffect(ctx, cas, 1, 'ex.a.signal')
    }).state
    expect(effectiveApl(signalled.operatives[cas]!)).toBe(3)
    // a worsening of Hit from another rule (a point-blank shot) is ignored too
    expect(attackStats(s, cas, 'ex.w.combat-shotgun-close', boy, { kind: 'shoot', pointBlank: true }).need).toBe(3)
    expect(attackStats(s, A(s, 'vigilant'), 'ex.w.combat-shotgun-close', boy, { kind: 'shoot', pointBlank: true }).need).toBe(4)
    // Save is not covered: Piercing 1 still removes a defence die, and the Save stays 4+
    expect(defenceStats(s, cas, boy, 'kom.w.slugga', parseRules([{ rule: 'piercing', x: 1 }]), false)).toMatchObject({ collected: 2, need: 4 })

    // Zealous Dedication: a die of 3+ damage loses 1 on a 5+; Dmg 2 and Devastating are untouched
    const dmg = (amount: number, source: string, ...roll: number[]) => {
      let dealt = -1
      withCtx(
        s,
        (ctx) => {
          dealt = inflict(ctx, { targetId: cas, attackerId: boy, weaponId: 'kom.w.choppa', amount, source })
        },
        dice(...roll),
      )
      return dealt
    }
    expect(dmg(4, 'normal', 5)).toBe(3)
    expect(dmg(4, 'normal', 4)).toBe(4)
    expect(dmg(4, 'crit', 6)).toBe(3)
    expect(dmg(2, 'normal', 6)).toBe(2)
    expect(dmg(4, 'devastating', 6)).toBe(4)
    expect(dmg(3, 'strike-normal', 5)).toBe(2)

    // Castigator's Arrest: an enemy alone in its control range cannot Fall Back; with a second enemy there both may
    const held = place(place(s, cas, 0, 0), boy, 1.4, 0)
    expect(actionForbidden(held, held.operatives[boy]!, 'fallBack')).toMatch(/Castigator/)
    const two = place(held, B(s, 'slasha-boy'), -1.4, 0)
    expect(actionForbidden(two, two.operatives[boy]!, 'fallBack')).toBeNull()
    expect(actionForbidden(two, two.operatives[B(s, 'slasha-boy')]!, 'fallBack')).toBeNull()

    // Stubborn Subjugator: injured, the shield maul still hits on 4+, the shotpistol on 5+, Move 4
    const u = hurt(s, sub)
    expect(attackStats(u, sub, 'ex.w.shock-maul-assault-shield', boy, { kind: 'fight' }).need).toBe(4)
    expect(attackStats(u, sub, 'ex.w.shotpistol', boy, { kind: 'shoot' }).need).toBe(5)
    expect(effectiveMove(u.operatives[sub]!, u)).toBe(4)
    expect(attackStats(hurt(s, A(s, 'vigilant')), A(s, 'vigilant'), 'ex.w.repression-baton', boy, { kind: 'fight' }).need).toBe(5)
  })

  it('TEAM-EX-018 TEAM-EX-019 Malocator: Acute Focus discounts the first marker or mission action of an activation (never in a counteraction); VERISCANT gives Lethal 5+ and Severe against its enemy until the Malocator next activates, falls or uses it again', () => {
    const s0 = edit(open(), (st) => void (st.turningPoint = 2))
    const mal = A(s0, 'malocator')
    const vig = A(s0, 'vigilant')
    const boy = B(s0, 'boy')
    const obj = s0.markers.find((m) => m.kind === 'objective')!
    // on an objective it holds: Veriscant and Secure both qualify, only the first is free
    const s = place(place(place(s0, mal, obj.pos.x + 1.2, obj.pos.z), boy, obj.pos.x + 6, obj.pos.z + 3), vig, obj.pos.x + 3, obj.pos.z - 2)
    const t = activateOp(s, mal)
    const cost = (st: GameState, prefix: string) => st.pending!.options!.find((o) => o.id.startsWith(prefix))?.data?.cost
    expect(cost(t, `ability:ex.a.veriscant:${boy}`)).toBe(0)
    expect(cost(t, 'ability:core.a.secure')).toBe(0)
    const marked = take(t, `ability:ex.a.veriscant:${boy}`).state
    expect(marked.firefight.activation!.apSpent).toBe(0)
    expect(cost(marked, 'ability:core.a.secure')).toBe(1)
    const counter = edit(s, (st) => void (st.firefight.activation = { operativeId: mal, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }))
    expect(providerCostDelta(counter, counter.operatives[mal]!, 'ability:ex.a.veriscant')).toBe(0)
    expect(providerCostDelta(t, t.operatives[mal]!, 'ability:ex.a.veriscant')).toBe(-1)
    // the mark: Lethal 5+ and Severe for shots, fights and retaliation, against that enemy only
    const other = B(s, 'slasha-boy')
    expect(tokenCount(marked, boy, 'ex.veriscant')).toBe(1)
    const lethalSevere = (st: GameState, who: string, w: string, kind: 'shoot' | 'fight', foe: string) => {
      const r = rulesOf(st, who, w, kind, foe)
      return r.includes('lethal 5+') && r.includes('severe')
    }
    expect(lethalSevere(marked, vig, 'ex.w.combat-shotgun-close', 'shoot', boy)).toBe(true)
    expect(lethalSevere(marked, vig, 'ex.w.repression-baton', 'fight', boy)).toBe(true)
    expect(lethalSevere(marked, vig, 'ex.w.combat-shotgun-close', 'shoot', other)).toBe(false)
    expect(lethalSevere(marked, boy, 'kom.w.slugga', 'shoot', vig)).toBe(false)
    // it ends when the Malocator next activates, falls, or marks another enemy
    const fell = withCtx(marked, (ctx) => {
      removeNow(ctx, mal)
      updateControl(ctx)
    }).state
    expect(tokenCount(fell, boy, 'ex.veriscant')).toBe(0)
    const swapped = take(activateOp(place(edit(s, (st) => void (st.operatives[boy]!.tokens = [{ kind: 'ex.veriscant', owner: 'A', count: 1, sourceId: mal, expires: ['sourceNextActivation', 'sourceIncapacitated'] }])), other, obj.pos.x + 5, obj.pos.z + 2), mal), `ability:ex.a.veriscant:${other}`).state
    expect(tokenCount(swapped, boy, 'ex.veriscant')).toBe(0)
    expect(tokenCount(swapped, other, 'ex.veriscant')).toBe(1)
    const started = activateOp(edit(s, (st) => void (st.operatives[boy]!.tokens = [{ kind: 'ex.veriscant', owner: 'A', count: 1, sourceId: mal, expires: ['sourceNextActivation', 'sourceIncapacitated'] }])), mal)
    expect(tokenCount(started, boy, 'ex.veriscant')).toBe(0)
  })

  it('TEAM-EX-020 TEAM-EX-021 Marksman: the concealed profile only in its first Shoot of the battle, the stationary profile not after a move; OPTICS gives Lethal 5+ on those two profiles and no obscuring for the executioner shotgun until its next activation', () => {
    const s = open()
    const mk = A(s, 'marksman')
    const boy = B(s, 'boy')
    const ground = edit(place(place(s, mk, 0, 0), boy, 9, 0), (st) => void (st.operatives[mk]!.order = 'engage'))
    const usable = (st: GameState, performed: string[] = []) => usableRangedWeapons(st, st.operatives[mk]!, performed)
    // first Shoot of the battle, on Conceal: only the Silent concealed profile; the Shoot uses it up
    const conceal = edit(ground, (st) => void (st.operatives[mk]!.order = 'conceal'))
    expect(usable(conceal)).toEqual(['ex.w.executioner-shotgun-concealed'])
    const fired = shootAt(ground, mk, 'ex.w.executioner-shotgun-concealed', boy, dice(1, 1, 1, 1, 1, 1, 1), {}, 'conceal').state
    expect(fired.ledger.A.battle).toContain(`ex.shot:${mk}`)
    expect(usable(fired, ['shoot'])).not.toContain('ex.w.executioner-shotgun-concealed')
    // a first Shoot with the mobile profile uses it up as well
    const mobile = shootAt(ground, mk, 'ex.w.executioner-shotgun-mobile', boy, dice(1, 1, 1, 1, 1, 1, 1)).state
    expect(usable(edit(mobile, (st) => void (st.operatives[mk]!.order = 'engage')))).not.toContain('ex.w.executioner-shotgun-concealed')
    expect(usable(ground, ['reposition']).sort()).toEqual(['ex.w.executioner-shotgun-mobile'])
    expect(usable(ground).sort()).toEqual(['ex.w.executioner-shotgun-concealed', 'ex.w.executioner-shotgun-mobile', 'ex.w.executioner-shotgun-stationary'])
    // OPTICS: 1 AP, a token on the Marksman until its next activation
    const optics = take(activateOp(ground, mk), 'ability:ex.a.optics').state
    expect(optics.firefight.activation!.apSpent).toBe(1)
    expect(tokenCount(optics, mk, 'ex.marksman-optics')).toBe(1)
    const lethal = (st: GameState, w: string) => rulesOf(st, mk, w, 'shoot', boy).includes('lethal 5+')
    expect(lethal(optics, 'ex.w.executioner-shotgun-concealed')).toBe(true)
    expect(lethal(optics, 'ex.w.executioner-shotgun-stationary')).toBe(true)
    expect(lethal(optics, 'ex.w.executioner-shotgun-mobile')).toBe(false)
    expect(lethal(ground, 'ex.w.executioner-shotgun-stationary')).toBe(false)
    const status = (st: GameState, who: string, w: string) => {
      const data = { obscured: true, inCover: false }
      runHook('target.status', { seat: 'A', state: st, operativeId: who, targetId: boy, weaponId: w, data })
      return data.obscured
    }
    expect(status(optics, mk, 'ex.w.executioner-shotgun-mobile')).toBe(false)
    expect(status(ground, mk, 'ex.w.executioner-shotgun-mobile')).toBe(true)
    expect(status(optics, A(s, 'vigilant'), 'ex.w.combat-shotgun-close')).toBe(true)
    // it ends when the Marksman next activates
    const started = activateOp(edit(ground, (st) => void (st.operatives[mk]!.tokens = [{ kind: 'ex.marksman-optics', owner: 'A', count: 1, sourceId: mk, expires: ['sourceNextActivation', 'sourceIncapacitated'] }])), mk)
    expect(tokenCount(started, mk, 'ex.marksman-optics')).toBe(0)
  })

  it('TEAM-EX-022 TEAM-EX-023 Revelatum: First in the Field gives a free Reposition in TP1 to one wholly in the drop zone; SPOT strips obscuring and gives Seek Light against one enemy within 8 inches until the end of the turning point', () => {
    const g = toGambit()
    const rev = A(g, 'revelatum')
    expect(optionIds(g)).toContain(`ex.p.first-in-the-field:${rev}`)
    const start = g.operatives[rev]!.pos
    const moving = take(g, `ex.p.first-in-the-field:${rev}`).state
    expect(moving.pending!.kind).toBe('move.path')
    expect(moving.pending!.context.maxInches).toBe(6)
    const home = start.x < 0 ? 1 : -1
    const done = play(moving, dice(), goTo(start.x + 3 * home, start.z), ['strategy.gambit', 'firefight.activate']).state
    expect(done.operatives[rev]!.pos.x).toBeCloseTo(start.x + 3 * home, 1)
    expect(done.pending!.kind).toBe('strategy.gambit')
    expect(optionIds(done).some((i) => i.startsWith('ex.p.first-in-the-field'))).toBe(false)
    // not when it stands partly outside the drop zone, nor in turning point 2
    const outside = place(g, rev, 0, 0)
    expect(optionIds(outside)).toContain(`ex.p.first-in-the-field:${rev}`)
    expect(offersFor(outside, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'ex.p.first-in-the-field')).toBe(false)
    expect(offersFor(edit(g, (st) => void (st.turningPoint = 2)), 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'ex.p.first-in-the-field')).toBe(false)

    // SPOT
    const s = open()
    const r = A(s, 'revelatum')
    const vig = A(s, 'vigilant')
    const boy = B(s, 'boy')
    const field = place(place(place(s, r, 0, 0), boy, 7.5, 0), vig, 2, 3)
    const spot = take(activateOp(field, r), `ability:ex.a.spot:${boy}`).state
    expect(spot.firefight.activation!.apSpent).toBe(1)
    expect(tokenCount(spot, boy, 'ex.revelatum-spot')).toBe(1)
    const obscured = (st: GameState, who: string) => {
      const data = { obscured: true, inCover: false }
      runHook('target.status', { seat: 'A', state: st, operativeId: who, targetId: boy, data })
      return data.obscured
    }
    expect(obscured(spot, vig)).toBe(false)
    expect(obscured(field, vig)).toBe(true)
    expect(obscured(spot, B(s, 'slasha-boy'))).toBe(true)
    expect(rulesOf(spot, vig, 'ex.w.combat-shotgun-close', 'shoot', boy)).toContain('seek-light')
    expect(rulesOf(field, vig, 'ex.w.combat-shotgun-close', 'shoot', boy)).not.toContain('seek-light')
    // an enemy beyond 8 inches cannot be picked; the token goes with the turning point
    expect(optionIds(activateOp(place(field, boy, 9.5, 0), r)).some((i) => i.startsWith('ability:ex.a.spot'))).toBe(false)
    expect(spot.operatives[boy]!.tokens!.find((t) => t.kind === 'ex.revelatum-spot')!.expires).toEqual(['turningPointEnd'])
  })

  it('TEAM-EX-025 TEAM-EX-026 TEAM-EX-027 Close Quarters Vigilance (a normal Shoot in an enemy control range, not after a Charge, always as a counteraction, Guard unchanged), SIGNAL (+1 APL for a visible friend) and GUILT REVEALS ITSELF (cover denied at 4 inches, the cover save kept)', () => {
    const s = open()
    const vig = A(s, 'vigilant')
    const sub = A(s, 'subductor')
    const vox = A(s, 'vox-signifier')
    const boy = B(s, 'boy')
    // the Vigilant shoots the enemy in its own control range at its normal Hit; the Subductor cannot Shoot there at all
    const melee = place(place(s, vig, 0, 0), boy, 1.4, 0)
    const t = activateOp(melee, vig)
    expect(optionIds(t)).toContain('shoot')
    expect(optionIds(activateOp(place(place(s, sub, 0, 0), boy, 1.4, 0), sub))).not.toContain('shoot')
    const rng = dice(6, 6, 1, 1, 1, 1, 1)
    const picked = take(passPloys(take(t, 'shoot', rng).state, rng), 'ex.w.combat-shotgun-close', rng).state
    expect(optionIds(picked)).toContain(boy)
    const rolled = take(picked, boy, rng)
    expect(evs(rolled.events, 'AttackDiceRolled')[0]!.need).toBe(3)
    // after a Charge in the same activation there is no Shoot; a counteraction always may
    const far = place(place(s, vig, 0, 0), boy, 4, 0)
    const charged = play(take(activateOp(far, vig), 'charge').state, dice(), goTo(2.6, 0)).state
    expect(optionIds(charged)).not.toContain('shoot')
    const counter = edit(melee, (st) => void (st.operatives[vig]!.order = 'engage', st.firefight.activation = { operativeId: vig, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }))
    expect(actionAvailability(counter, counter.operatives[vig]!, 'shoot', counter.firefight.activation)).toBeNull()
    const charger = edit(melee, (st) => void (st.operatives[vig]!.order = 'engage', st.firefight.activation = { operativeId: vig, seat: 'A', counteract: false, stage: 'action', apSpent: 1, performed: ['charge'], declared: null }))
    expect(actionAvailability(charger, charger.operatives[vig]!, 'shoot', charger.firefight.activation)).not.toBeNull()
    // a Guard interrupt is still point-blank
    expect(providerAny(melee, melee.operatives[vig]!, 'freeShootInControlRange')).toBe(true)
    const guarding = edit(melee, (st) => void (st.operatives[vig]!.flags.guard = true))
    expect(providerAny(guarding, guarding.operatives[vig]!, 'freeShootInControlRange')).toBe(false)

    // SIGNAL: another visible friend, +1 APL, a second Signal adds nothing
    const field = place(place(s, vox, 0, 0), vig, 3, 0)
    const sig = take(activateOp(field, vox), `ability:ex.a.signal:${vig}`).state
    expect(sig.firefight.activation!.apSpent).toBe(1)
    expect(effectiveApl(sig.operatives[vig]!)).toBe(3)
    expect(optionIds(activateOp(field, vox)).some((i) => i === `ability:ex.a.signal:${vox}`)).toBe(false)
    const twice = withCtx(sig, (ctx) => void applyAplEffect(ctx, vig, 1, 'ex.a.signal')).state
    expect(effectiveApl(twice.operatives[vig]!)).toBe(3)
    const walled = edit(field, (st) => void (st.map = { ...st.map, features: [feature('ex-wall', part('ex-wall.a', rect(1.4, 1.8, -4, 4), 3, ['blocking']))] }))
    expect(optionIds(activateOp(walled, vox)).some((i) => i === `ability:ex.a.signal:${vig}`)).toBe(false)

    // GUILT REVEALS ITSELF: a Conceal enemy in cover 3 inches away is a target and keeps its cover save; 4 inches is the limit
    const scene = (boyX: number, w0: number, w1: number, guilt: boolean): GameState => {
      const g = edit(place(place(s, vig, 0, 0), boy, boyX, 0), (st) => {
        st.map = { ...st.map, features: [feature('ex-wall', part('ex-wall.a', rect(w0, w1, -2, 2), 1, ['light']))] }
        st.operatives[boy]!.order = 'conceal'
        st.operatives[vig]!.order = 'engage'
      })
      return guilt ? withPloy(g, 'ex.p.guilt-reveals-itself') : g
    }
    const valid = (st: GameState) => validTargets(st, st.operatives[vig]!, 'ex.w.combat-shotgun-long').map((x) => x.id)
    expect(valid(scene(3.5, 1.5, 1.9, false))).not.toContain(boy)
    const guilty = scene(3.5, 1.5, 1.9, true)
    expect(valid(guilty)).toContain(boy)
    expect(validTargets(guilty, guilty.operatives[vig]!, 'ex.w.combat-shotgun-long').find((x) => x.id === boy)!.inCover).toBe(true)
    const close = scene(2.5, 1.0, 1.4, true)
    expect(valid(close)).toContain(boy)
    expect(validTargets(close, close.operatives[vig]!, 'ex.w.combat-shotgun-long').find((x) => x.id === boy)!.inCover).toBe(false)
    expect(valid(scene(5.7, 5.0, 5.3, false))).not.toContain(boy)
    expect(valid(scene(5.7, 5.0, 5.3, true))).not.toContain(boy)
    // another team's operatives get nothing
    expect(valid(edit(guilty, (st) => void (st.effects = [])))).not.toContain(boy)
  })

  it('TEAM-EX-028 TEAM-EX-029 TEAM-EX-030 TEAM-EX-031 strategy and firefight ploys of the weapon rules: INVIOLATE JURISDICTION (re-roll one defence die near an objective or an enemy), DISPENSE JUSTICE (Ceaseless), TERMINAL DECREE (Balanced within 6 inches, Gunners always), LONG ARM (Range +3 for one action)', () => {
    const s = open({ rosterA: exRoster([...ALL.slice(0, 10), 'ex.gunner']) })
    const vig = A(s, 'vigilant')
    const sub = A(s, 'subductor')
    const gun = A(s, 'gunner')
    const leash = A(s, 'leashmaster')
    const boy = B(s, 'boy')
    const obj = s.markers.find((m) => m.kind === 'objective')!
    // INVIOLATE JURISDICTION: within 2" of an objective marker or of an enemy
    const guard = (st: GameState, ...who: string[]) => defenceStats(withPloy(st, 'ex.p.inviolate-jurisdiction'), who[0]!, boy, 'kom.w.slugga', parseRules([]), false).grants.map((g) => g.id)
    const onObjective = place(place(s, vig, obj.pos.x + 1.5, obj.pos.z), boy, 8, 8)
    expect(guard(onObjective, vig)).toEqual(['ex.inviolate'])
    expect(guard(place(place(s, vig, 0, 4), boy, 8, 8), vig)).toEqual([])
    expect(guard(place(place(s, vig, 0, 4), boy, 1.6, 4), vig)).toEqual(['ex.inviolate'])
    expect(defenceStats(onObjective, vig, boy, 'kom.w.slugga', parseRules([]), false).grants).toEqual([])
    // DISPENSE JUSTICE: not more than its Move in the activation, or fighting outside its own activation
    const fight = (st: GameState, who: string) => rulesOf(withPloy(st, 'ex.p.dispense-justice'), who, 'ex.w.shock-maul-assault-shield', 'fight', boy)
    const act = (op: string, seat: 'A' | 'B', counteract = false) => ({ operativeId: op, seat, counteract, stage: 'action' as const, apSpent: 1, performed: ['reposition'], declared: null })
    const six = edit(s, (st) => {
      st.operatives[sub]!.movedThisActivation = 6
      st.firefight.activation = act(sub, 'A')
    })
    expect(fight(six, sub)).toContain('ceaseless')
    const eight = edit(six, (st) => void (st.operatives[sub]!.movedThisActivation = 8))
    expect(fight(eight, sub)).not.toContain('ceaseless')
    expect(fight(edit(eight, (st) => void (st.firefight.activation = act(sub, 'A', true))), sub)).toContain('ceaseless')
    expect(fight(edit(eight, (st) => void (st.firefight.activation = act(boy, 'B'))), sub)).toContain('ceaseless')
    expect(rulesOf(six, sub, 'ex.w.shock-maul-assault-shield', 'fight', boy)).not.toContain('ceaseless')
    // TERMINAL DECREE: Balanced within 6", a Gunner at any range, per target
    const shot = (st: GameState, who: string, w: string, x: number) => rulesOf(withPloy(place(place(st, who, 0, 0), boy, x, 0), 'ex.p.terminal-decree'), who, w, 'shoot', boy)
    expect(shot(s, vig, 'ex.w.combat-shotgun-long', 5)).toContain('balanced')
    expect(shot(s, vig, 'ex.w.combat-shotgun-long', 8)).not.toContain('balanced')
    expect(shot(s, gun, 'ex.w.grenade-launcher', 14)).toContain('balanced')
    expect(rulesOf(place(place(s, vig, 0, 0), boy, 5, 0), vig, 'ex.w.combat-shotgun-long', 'shoot', boy)).not.toContain('balanced')

    // LONG ARM at the Shoot declaration: the shotpistol reaches 11" and the close shotgun 9", for that action only
    const field = edit(place(place(s, leash, 0, 0), boy, 10, 0), (st) => void (st.players.A.cp = 3))
    const declared = take(activateOp(field, leash), 'shoot').state
    expect(declared.pending!.kind).toBe('ploy.firefight')
    expect(optionIds(declared)).toContain('ex.p.long-arm')
    const longer = take(declared, 'ex.p.long-arm').state
    expect(longer.players.A.cp).toBe(2)
    expect(longer.pending!.kind).toBe('shoot.weapon')
    expect(rulesOf(longer, leash, 'ex.w.shotpistol', 'shoot').filter((r) => r.startsWith('range'))).toEqual(['range 11'])
    expect(rulesOf(longer, leash, 'ex.w.combat-shotgun-close', 'shoot').filter((r) => r.startsWith('range'))).toEqual(['range 9'])
    expect(validTargets(longer, longer.operatives[leash]!, 'ex.w.shotpistol').map((x) => x.id)).toContain(boy)
    expect(validTargets(field, field.operatives[leash]!, 'ex.w.shotpistol').map((x) => x.id)).not.toContain(boy)
    // the webber (Range 12") reaches 15", and the effect belongs to the operative that used it
    expect(rulesOf(longer, gun, 'ex.w.webber', 'shoot')).toEqual(rulesOf(field, gun, 'ex.w.webber', 'shoot'))
    const webber = edit(field, (st) => {
      st.operatives[gun]!.weapons = ['ex.w.webber', 'ex.w.repression-baton']
    })
    expect(rulesOf(usePlayed(place(webber, gun, 0, 2), 'ex.p.long-arm', { subjectId: gun }), gun, 'ex.w.webber', 'shoot').filter((r) => r.startsWith('range'))).toEqual(['range 15'])
    const withEffect = withFx(place(webber, gun, 0, 2), { source: 'ex.p.long-arm', kind: 'ex.longArm', operativeId: gun, expires: 'action' })
    expect(rulesOf(withEffect, gun, 'ex.w.webber', 'shoot').filter((r) => r.startsWith('range'))).toEqual(['range 15'])
    // not for an operative whose only Range weapons are grenades, nor outside a Shoot
    const nade = edit(field, (st) => void (st.operatives[leash]!.weapons = ['core.w.frag-grenade', 'ex.w.repression-baton']))
    expect(offersFor(nade, 'A', 'firefight.actionDeclared', { window: 'firefight.actionDeclared', subjectId: leash, action: 'shoot' }).some((o) => o.ployId === 'ex.p.long-arm')).toBe(false)
    expect(offersFor(field, 'A', 'firefight.actionDeclared', { window: 'firefight.actionDeclared', subjectId: leash, action: 'fight' }).some((o) => o.ployId === 'ex.p.long-arm')).toBe(false)
    expect(offersFor(field, 'A', 'firefight.actionDeclared', { window: 'firefight.actionDeclared', subjectId: A(s, 'marksman'), action: 'shoot' }).some((o) => o.ployId === 'ex.p.long-arm')).toBe(false)
  })

  it('TEAM-EX-032 EXACT PUNISHMENT: after an enemy shoots or fights a surviving friend within 6 inches, 1 CP buys a free Shoot or Fight at that enemy only (not when the friend fell, nor at 7 inches)', () => {
    const s0 = open()
    const vig = A(s0, 'vigilant')
    const sub = A(s0, 'subductor')
    const boy = B(s0, 'boy')
    const other = B(s0, 'slasha-boy')
    const base = edit(s0, (st) => void (st.players.A.cp = 3))
    const enemyShoots = (st: GameState, ...d: number[]) => {
      const rng = dice(...d)
      let t = bTurn(st, A(st, 'proctor-exactant'))
      t = passPloys(take(activateOp(t, boy, 'engage', rng), 'shoot', rng).state, rng)
      t = take(t, 'kom.w.slugga', rng).state
      t = take(t, vig, rng).state
      return play(t, rng, PASS_PLOYS, ['ability.choice', 'firefight.action', 'firefight.activate'])
    }
    const field = place(place(place(base, vig, 0, 0), boy, 5, 0), other, 2, 3)
    // the shot misses: the Exaction player is offered the free Shoot (pay 1 CP), and may only name the shooter
    const missed = enemyShoots(field, 1, 1, 1, 1, 1, 1, 1)
    expect(missed.state.pending!.kind).toBe('ability.choice')
    const offerIds = optionIds(missed.state)
    expect(offerIds.length).toBeGreaterThanOrEqual(1)
    expect(missed.state.pending!.options!.every((o) => o.data!.targetId === boy)).toBe(true)
    const paid = take(missed.state, offerIds[0]!).state
    expect(paid.players.A.cp).toBe(2)
    expect(paid.ledger.A.tp).toContain('ex.p.exact-punishment')
    expect(paid.pending!.kind).toBe('shoot.weapon')
    const weapon = take(paid, 'ex.w.combat-shotgun-close').state
    expect(weapon.pending!.kind).toBe('shoot.target')
    expect(optionIds(weapon)).toEqual([boy])
    // once per turning point: the same trigger is not offered twice
    const done = play(take(weapon, boy, dice(6, 6, 6, 6, 1, 1, 1)).state, dice(6, 6, 6, 6, 1, 1, 1), PASS_PLOYS, ['ability.choice', 'firefight.action', 'firefight.activate'])
    expect(done.state.operatives[boy]!.wounds).toBeLessThan(done.state.operatives[boy]!.maxWounds)
    // the friend fell, or the enemy stands 7 inches off: nothing is offered
    const fell = enemyShoots(edit(field, (st) => void (st.operatives[vig]!.wounds = 1)), 6, 6, 6, 6, 1, 1, 1)
    expect(fell.state.operatives[vig]!.status).toBe('removed')
    expect(fell.state.pending!.kind).toBe('firefight.action')
    const far = enemyShoots(place(field, boy, 8.5, 0), 1, 1, 1, 1, 1, 1, 1)
    expect(far.state.pending!.kind).toBe('firefight.action')
    // without the CP it is not offered either
    expect(enemyShoots(edit(field, (st) => void (st.players.A.cp = 0)), 1, 1, 1, 1, 1, 1, 1).state.pending!.kind).toBe('firefight.action')

    // a fight: the Subductor survives the Boy's attack and may fight it again, free
    const rng = dice(1, 1, 1, 1, 1, 1, 1, 1)
    const melee = place(place(base, sub, 0, 0), boy, 1.4, 0)
    let t = bTurn(melee, A(melee, 'proctor-exactant'))
    t = take(take(activateOp(t, boy, 'engage', rng), 'fight', rng).state, sub, rng).state
    const after = play(t, rng, PASS_PLOYS, ['ability.choice', 'firefight.action', 'firefight.activate'])
    expect(after.state.pending!.kind).toBe('ability.choice')
    const fightOffer = after.state.pending!.options!.find((o) => String(o.data!.name).includes('fights'))!
    expect(fightOffer).toBeTruthy()
    const free = take(after.state, fightOffer.id).state
    expect(free.players.A.cp).toBe(2)
    expect(['fight.target', 'fight.weapon', 'fight.resolve', 'dice.reroll', 'dice.commandReroll', 'ploy.firefight']).toContain(free.pending!.kind)
  })

  it('TEAM-EX-033 BRUTAL BACKUP: in a friend\'s activation, another friend with the same enemy in its control range takes a free Fight at it only (not as a counteraction, and not a joint partner that already fought)', () => {
    const s0 = open()
    const sub = A(s0, 'subductor')
    const vig = A(s0, 'vigilant')
    const boy = B(s0, 'boy')
    const other = B(s0, 'slasha-boy')
    const base = edit(s0, (st) => void (st.players.A.cp = 3))
    // the Subductor and the Vigilant both hold the Boy; the Slasha-boy is beside the Vigilant only
    const field = place(place(place(place(base, sub, 0, 0), boy, 1.4, 0), vig, 1.4, 1.4), other, 2.8, 1.4)
    const start = take(take(field, sub).state, 'engage').state
    expect(start.pending!.kind).toBe('ploy.firefight')
    const ids = optionIds(start).filter((i) => i.startsWith('ex.p.brutal-backup:'))
    expect(ids).toContain(`ex.p.brutal-backup:${boy}+${vig}`)
    expect(ids.some((i) => i.includes(`${other}+`))).toBe(false)
    const rng = dice(6, 6, 6, 1, 1, 1, 1, 1)
    const used = take(start, `ex.p.brutal-backup:${boy}+${vig}`, rng).state
    expect(used.players.A.cp).toBe(2)
    // the free Fight is the Vigilant's, against the Boy only: it runs and the window carries on to the Subductor's actions
    const run = play(used, rng, PASS_PLOYS, ['firefight.action', 'ploy.firefight', 'fight.target'])
    const fighting = run.state
    if (fighting.pending!.kind === 'fight.target') expect(optionIds(fighting)).toEqual([boy])
    const finished = play(fighting, rng, PASS_PLOYS, ['firefight.action']).state
    expect(finished.pending!.kind).toBe('firefight.action')
    expect(finished.operatives[boy]!.wounds).toBeLessThan(finished.operatives[boy]!.maxWounds)
    expect(finished.firefight.activation!.operativeId).toBe(sub)
    expect(finished.firefight.activation!.performed).not.toContain('fight')
    // not as a counteraction
    const counter = edit(field, (st) => {
      st.firefight.activation = { operativeId: sub, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }
    })
    expect(offersFor(counter, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: sub, counteracting: true }).some((o) => o.ployId === 'ex.p.brutal-backup')).toBe(false)
    // a joint partner that has already Fought is not the backup
    const joint = (partnerFought: boolean) =>
      edit(place(place(base, vig, 0, 0), boy, 1.4, 0), (st) => {
        const sub2 = st.operatives[sub]!
        sub2.pos = { x: 0, y: 0, z: 1.4 }
        st.firefight.activation = { operativeId: vig, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null, partner: { operativeId: sub, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: partnerFought ? ['fight'] : [], declared: null } }
      })
    const backups = (st: GameState) => offersFor(st, 'A', 'firefight.actionEnded', { window: 'firefight.actionEnded', subjectId: vig, counteracting: false, action: 'shoot' }).filter((o) => o.ployId === 'ex.p.brutal-backup').map((o) => o.param)
    expect(backups(joint(false))).toContain(`${boy}+${sub}`)
    expect(backups(joint(true))).not.toContain(`${boy}+${sub}`)
  })

  it('TEAM-EX-034 EXECUTION ORDER: named when an enemy declares a mission action or at the end of the Firefight phase on an objective holder; at that enemy\'s next activation a ready friend shoots or fights it first and is expended; one named enemy at a time, lifted when it has activated', () => {
    const s0 = edit(open(), (st) => {
      st.turningPoint = 2
      st.players.A.cp = 4
    })
    const vig = A(s0, 'vigilant')
    const sub = A(s0, 'subductor')
    const boy = B(s0, 'boy')
    const other = B(s0, 'slasha-boy')
    const obj = s0.markers.find((m) => m.kind === 'objective')!
    // (a) the Boy declares Secure on an objective it holds: the Exaction player may name it
    const onObjective = place(s0, boy, obj.pos.x - 1.2, obj.pos.z)
    const declared = take(activateOp(bTurn(onObjective, vig), boy), `ability:core.a.secure:${obj.id}`).state
    expect(declared.pending!.kind).toBe('ploy.firefight')
    expect(declared.pending!.seat).toBe('A')
    expect(optionIds(declared)).toContain(`ex.p.execution-order:${boy}`)
    const named = take(declared, `ex.p.execution-order:${boy}`).state
    expect(named.players.A.cp).toBe(3)
    const lock = named.effects.find((e) => e.kind === 'ex.executionOrder')!
    expect(lock.operativeId).toBe(boy)
    expect(lock.data!.live).toBe(false)
    // one named enemy at a time: nothing more is offered, even for another enemy's mission action
    expect(offersFor(named, 'A', 'turningPoint.end', { window: 'turningPoint.end' }).some((o) => o.ployId === 'ex.p.execution-order')).toBe(false)
    expect(offersFor(named, 'A', 'firefight.opponentActionDeclared', { window: 'firefight.opponentActionDeclared', actorId: other, action: 'ability:core.a.secure' }).some((o) => o.ployId === 'ex.p.execution-order')).toBe(false)
    // (b) the end of the Firefight phase: an enemy holding an objective can be named; Operate Hatch and plain actions cannot trigger (a)
    const holding = place(s0, boy, obj.pos.x - 1.2, obj.pos.z)
    expect(offersFor(holding, 'A', 'turningPoint.end', { window: 'turningPoint.end' }).map((o) => o.id)).toContain(`ex.p.execution-order:${boy}`)
    expect(offersFor(holding, 'A', 'firefight.opponentActionDeclared', { window: 'firefight.opponentActionDeclared', actorId: boy, action: 'shoot' }).some((o) => o.ployId === 'ex.p.execution-order')).toBe(false)
    expect(offersFor(holding, 'A', 'firefight.opponentActionDeclared', { window: 'firefight.opponentActionDeclared', actorId: boy, action: 'ability:core.a.operate-hatch' }).some((o) => o.ployId === 'ex.p.execution-order')).toBe(false)
    expect(offersFor(place(s0, boy, 8, 8), 'A', 'turningPoint.end', { window: 'turningPoint.end' }).some((o) => o.ployId === 'ex.p.execution-order')).toBe(false)

    // the strike: the Boy is activated later; on its first action a ready friend that can shoot it takes a free Shoot, then is expended
    const armed = withFx(place(place(place(s0, vig, 0, 0), boy, 5, 0), sub, -6, 6), { source: 'ex.p.execution-order', kind: 'ex.executionOrder', operativeId: boy, expires: 'battle', data: { armedSeq: 0, live: false } })
    const ready = bTurn(armed, A(armed, 'proctor-exactant'))
    const rng = dice(6, 1, 1, 1, 1, 1, 1)
    const activated = activateOp(ready, boy, 'engage', rng)
    expect(activated.effects.find((e) => e.kind === 'ex.executionOrder')!.data!.live).toBe(true)
    const first = take(activated, 'reposition', rng).state
    expect(first.pending!.kind).toBe('ploy.firefight')
    const strikes_ = optionIds(first).filter((i) => i.startsWith('ex.x.exec-'))
    expect(strikes_).toContain(`ex.x.exec-shoot:${vig}`)
    const cpBefore = first.players.A.cp
    const struck = take(first, `ex.x.exec-shoot:${vig}`, rng).state
    expect(struck.players.A.cp).toBe(cpBefore)
    expect(struck.pending!.kind).toBe('shoot.weapon')
    const aimed = take(struck, 'ex.w.combat-shotgun-close', rng).state
    expect(optionIds(aimed)).toEqual([boy])
    const resolved = play(take(aimed, boy, rng).state, rng, PASS_PLOYS, ['move.path', 'firefight.action'])
    expect(resolved.state.operatives[vig]!.ready).toBe(false)
    expect(resolved.state.operatives[boy]!.wounds).toBeLessThan(resolved.state.operatives[boy]!.maxWounds)
    // the enemy's activation goes on: its declared Reposition asks for a path
    expect(resolved.state.pending!.kind).toBe('move.path')
    const ended = play(resolved.state, rng, goTo(6, 1), ['firefight.action']).state
    // the lock lifts when the enemy's activation ends
    expect(ended.effects.some((e) => e.kind === 'ex.executionOrder')).toBe(true)
    expect(take(ended, 'end').state.effects.some((e) => e.kind === 'ex.executionOrder')).toBe(false)
    // a strike that downs the enemy ends its activation unperformed, and the lock goes with it
    const killRng = dice(6, 6, 6, 6, 1, 1, 1)
    const killed = take(activateOp(ready, boy, 'engage', killRng), 'reposition', killRng).state
    const afterKill = play(take(take(take(killed, `ex.x.exec-shoot:${vig}`, killRng).state, 'ex.w.combat-shotgun-close', killRng).state, boy, killRng).state, killRng, PASS_PLOYS, ['move.path', 'firefight.action', 'firefight.activate']).state
    expect(afterKill.operatives[boy]!.status).toBe('removed')
    expect(afterKill.pending!.kind).not.toBe('move.path')
    expect(afterKill.effects.some((e) => e.kind === 'ex.executionOrder')).toBe(false)
    // a counteraction by the named enemy does not trigger it
    const counter = edit(armed, (st) => {
      st.operatives[boy]!.ready = false
      st.firefight.activation = { operativeId: boy, seat: 'B', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }
    })
    expect(offersFor(counter, 'A', 'firefight.opponentActionDeclared', { window: 'firefight.opponentActionDeclared', actorId: boy, action: 'shoot', counteracting: true }).some((o) => o.id.startsWith('ex.x.exec'))).toBe(false)
    // removed enemy: the lock goes with it
    const dead = withCtx(armed, (ctx) => {
      removeNow(ctx, boy)
      updateControl(ctx)
    }).state
    expect(dead.effects.some((e) => e.kind === 'ex.executionOrder')).toBe(false)
  })

  it('TEAM-EX-035 TEAM-EX-036 TEAM-EX-037 equipment: REINFORCED MIRROR-VISOR (APL decreases and enemy Shock ignored, Signal kept), MANACLES (an enemy alone in a friend\'s control range may be stopped from Falling Back, 4+ on one or two dice), STROBING PHOSPHOR-LUMEN (no re-roll of 1s against a friend within 2 inches)', () => {
    // Mirror-visor
    const v = open({ equipmentA: ['ex.e.reinforced-mirror-visor'] })
    const plain = open()
    const sub = A(v, 'subductor')
    const nob = B(v, 'boss-nob')
    const stunned = (st: GameState) => withCtx(st, (ctx) => void applyAplEffect(ctx, A(st, 'vigilant'), -1, 'stun')).state
    expect(effectiveApl(stunned(v).operatives[A(v, 'vigilant')]!)).toBe(2)
    expect(effectiveApl(stunned(plain).operatives[A(plain, 'vigilant')]!)).toBe(1)
    const signalled = withCtx(stunned(v), (ctx) => void applyAplEffect(ctx, A(v, 'vigilant'), 1, 'ex.a.signal')).state
    expect(effectiveApl(signalled.operatives[A(v, 'vigilant')]!)).toBe(3)
    expect(rulesOf(v, nob, 'kom.w.power-klaw', 'fight', sub)).not.toContain('shock')
    expect(rulesOf(plain, nob, 'kom.w.power-klaw', 'fight', A(plain, 'subductor'))).toContain('shock')
    expect(rulesOf(v, A(v, 'subductor'), 'ex.w.shock-maul-assault-shield', 'fight', nob)).toContain('shock')
    // Strobing Phosphor-lumen
    const st = open({ equipmentA: ['ex.e.strobing-phosphor-lumen'] })
    const vig = A(st, 'vigilant')
    const boy = B(st, 'boy')
    const dakka = B(st, 'dakka-boy')
    const grant = (state: GameState, gap: number) => attackStats(place(place(state, vig, 0, 0), dakka, gap, 0), dakka, 'kom.w.dakka-shoota-short', vig, { kind: 'shoot' }).grants.find((g) => g.id === 'ceaseless')!
    expect(grant(st, 2.5).values ?? [1, 2, 3, 4, 5, 6]).not.toContain(1)
    expect(grant(st, 4).values ?? [1]).toContain(1)
    expect(grant(open(), 2.5).values ?? [1]).toContain(1)
    expect(providerRerollBannedValues(place(place(st, vig, 0, 0), boy, 1.4, 0), { kind: 'fight', rollerId: boy, opponentId: vig, defence: false })).toEqual([1])
    expect(providerRerollBannedValues(place(place(st, vig, 0, 0), boy, 1.4, 0), { kind: 'fight', rollerId: vig, opponentId: boy, defence: false })).toEqual([])
    expect(providerRerollBannedValues(place(place(st, vig, 0, 0), boy, 1.4, 0), { kind: 'shoot', rollerId: vig, opponentId: boy, defence: true })).toEqual([])
    // Manacles
    const mn = edit(open({ equipmentA: ['ex.e.manacles'] }), (x) => void (x.players.A.cp = 2))
    const pin = place(place(mn, A(mn, 'vigilant'), 0, 0), boy, 1.4, 0)
    const fallBack = (state: GameState, who: string, ...d: number[]) => {
      const rng = dice(...d)
      return take(activateOp(bTurn(state, A(state, 'proctor-exactant')), who, 'engage', rng), 'fallBack', rng)
    }
    // one die (the Boy has more Wounds than the Vigilant): a 4+ stops it, no AP spent, barred for the activation
    const stopped = fallBack(pin, boy, 5)
    expect(rolled(stopped.events, 'ex.manacles')).toEqual([[5]])
    expect(stopped.state.firefight.activation!.apSpent).toBe(0)
    expect(stopped.state.pending!.kind).toBe('firefight.action')
    expect(optionIds(stopped.state)).not.toContain('fallBack')
    expect(stopped.state.ledger.A.tp).toContain('ex.e.manacles')
    // a failed roll lets the Fall Back go ahead and keeps the use
    const failed = fallBack(pin, boy, 3)
    expect(failed.state.pending!.kind).toBe('move.path')
    expect(failed.state.ledger.A.tp).not.toContain('ex.e.manacles')
    // two dice for an enemy with no more Wounds; a second enemy in the friend's control range switches the rule off
    const grot = B(mn, 'grot')
    expect(rolled(fallBack(place(place(mn, A(mn, 'vigilant'), 0, 0), grot, 1.4, 0), grot, 2, 4).events, 'ex.manacles')).toEqual([[2, 4]])
    expect(fallBack(place(pin, B(mn, 'slasha-boy'), -1.4, 0), boy, 5).state.pending!.kind).toBe('move.path')
    // once a use succeeded this turning point the next Fall Back goes ahead without a roll
    const used = edit(pin, (x) => void x.ledger.A.tp.push('ex.e.manacles'))
    expect(rolled(fallBack(used, boy, 5).events, 'ex.manacles')).toEqual([])
  })

  it('TEAM-EX-038 SPECIAL ISSUE SHELLS: twice per turning point a Shells weapon gains Saturate, Piercing 1 (only against a Save of 3+ or better) or Torrent 1 inch with one secondary; never the webber', () => {
    const s0 = open({ equipmentA: ['ex.e.special-issue-shells'], rosterA: exRoster([...ALL.slice(0, 10), 'ex.gunner']) })
    const vig = A(s0, 'vigilant')
    const gun = A(s0, 'gunner')
    const boy = B(s0, 'boy')
    const second = B(s0, 'slasha-boy')
    const third = B(s0, 'burna-boy')
    const field = edit(place(place(place(place(s0, vig, 0, 0), boy, 5, 0), second, 5, 1.9), third, 5, -1.9), (x) => void (x.players.A.cp = 3))
    const targeted = (state: GameState, who: string) => take(take(passPloys(take(activateOp(state, who), 'shoot').state), 'ex.w.combat-shotgun-close').state, boy).state
    // Saturate and Piercing 1 once the weapon and target are known; Piercing only against a Save of 3+ or better
    const t = targeted(field, vig)
    expect(t.pending!.kind).toBe('ploy.firefight')
    expect(optionIds(t)).toContain('ex.x.shells-saturate')
    expect(optionIds(t)).not.toContain('ex.x.shells-piercing')
    const armoured = edit(field, (x) => void (x.operatives[boy]!.save = 3))
    expect(optionIds(targeted(armoured, vig))).toContain('ex.x.shells-piercing')
    const sat = take(t, 'ex.x.shells-saturate').state
    expect(sat.players.A.cp).toBe(3)
    expect(tpUsesOf(sat, 'A', 'ex.shells.tp')).toBe(1)
    expect(rulesOf(sat, vig, 'ex.w.combat-shotgun-close', 'shoot', boy)).toContain('saturate')
    expect(rulesOf(t, vig, 'ex.w.combat-shotgun-close', 'shoot', boy)).not.toContain('saturate')
    const pierce = take(targeted(armoured, vig), 'ex.x.shells-piercing').state
    expect(rulesOf(pierce, vig, 'ex.w.combat-shotgun-close', 'shoot', boy)).toContain('piercing 1')
    // against a 4+ target the rule adds nothing even when the effect is in force
    expect(rulesOf(withFx(field, { source: 'ex.e.special-issue-shells', kind: 'ex.shells', operativeId: vig, expires: 'action', data: { kind: 'piercing' } }), vig, 'ex.w.combat-shotgun-close', 'shoot', boy)).not.toContain('piercing 1')
    // a third use in the turning point is refused; the webber is no Shells weapon
    const spent = edit(field, (x) => void (x.ledger.A.tpUses['ex.shells.tp'] = 2))
    expect(optionIds(targeted(spent, vig))).not.toContain('ex.x.shells-saturate')
    expect(isShellsWeapon(field, 'ex.w.webber')).toBe(false)
    const webber = edit(field, (x) => void (x.operatives[gun]!.weapons = ['ex.w.webber', 'ex.w.repression-baton']))
    const asked = place(webber, gun, 0, -3)
    const webberShot = take(take(passPloys(take(activateOp(asked, gun), 'shoot').state), 'ex.w.webber').state, boy).state
    expect(optionIds(webberShot).some((i) => i.startsWith('ex.x.shells'))).toBe(false)
    // Torrent 1" chosen at the declaration: one secondary within 1 inch of the primary, no more
    const decl = take(activateOp(field, vig), 'shoot').state
    expect(optionIds(decl)).toContain('ex.x.shells-torrent')
    const torrent = take(decl, 'ex.x.shells-torrent').state
    const chosen = take(passPloys(torrent), 'ex.w.combat-shotgun-close').state
    const secondaries = take(chosen, boy).state
    expect(secondaries.pending!.kind).toBe('shoot.target')
    expect(optionIds(secondaries).sort()).toEqual([`add:${second}`, `add:${third}`, 'done'].sort())
    const added = take(secondaries, `add:${second}`).state
    expect(added.attack!.targets).toEqual([boy, second])
    expect(added.pending!.kind).not.toBe('shoot.target')
    // the use counted when it was chosen
    expect(tpUsesOf(torrent, 'A', 'ex.shells.tp')).toBe(1)
  })

  it('TEAM-EX-003 MARKED FOR JUSTICE re-pick: a mark that fell with no reaction round after it (outside any action) is offered at the next reaction round, and only there', () => {
    const s = open()
    const vig = A(s, 'vigilant')
    const foe = B(s, 'boy')
    const marked = withFx(place(s, vig, 0, 0), { source: 'ex.p.marked-for-justice', kind: 'ex.mark', data: { markId: foe } })
    const gone = withCtx(marked, (ctx) => {
      removeNow(ctx, foe)
      updateControl(ctx)
    }).state
    expect(gone.operatives[foe]!.status).toBe('removed')
    // the Vigilant's next action ends: its reaction round offers the new mark
    const dashed = play(take(activateOp(gone, vig), 'dash').state, dice(), goTo(2, 0), WITH_CHOICES).state
    expect(dashed.pending!.kind).toBe('ability.choice')
    const picks = dashed.pending!.options!.filter((o) => o.id.startsWith('react:'))
    expect(picks.length).toBeGreaterThan(0)
    const chosen = take(dashed, picks[0]!.id).state
    expect(markOf(chosen, 'A')!.id).toBe(picks[0]!.data!.targetId)
    // declined: the round after the next action offers nothing more
    const declined = passIt(dashed).state
    expect(declined.pending!.kind).toBe('firefight.action')
    const again = play(take(declined, 'reposition').state, dice(), goTo(3, 0), WITH_CHOICES).state
    expect(again.pending?.kind === 'ability.choice' && again.pending.seat === 'A').toBe(false)
    expect(markOf(again, 'A')).toBeUndefined()
  })

  it('TEAM-EX-032 EXACT PUNISHMENT selects no other enemy: a Torrent weapon gets no secondary target, and the offer lapses once that enemy starts another action', () => {
    const s0 = open({ rosterA: exRoster([...ALL.slice(0, 10), 'ex.gunner']) })
    const gun = A(s0, 'gunner')
    const boy = B(s0, 'boy')
    const second = B(s0, 'slasha-boy')
    const base = edit(s0, (st) => {
      st.players.A.cp = 3
      st.operatives[gun]!.weapons = ['ex.w.heavy-stubber-focused', 'ex.w.heavy-stubber-sweeping', 'ex.w.repression-baton']
    })
    const field = place(place(place(base, gun, 0, 0), boy, 5, 0), second, 5, 1.9)
    const rng = dice(1, 1, 1, 1, 1, 1, 1)
    let t = bTurn(field, A(field, 'proctor-exactant'))
    t = passPloys(take(activateOp(t, boy, 'engage', rng), 'shoot', rng).state, rng)
    t = take(take(t, 'kom.w.slugga', rng).state, gun, rng).state
    const r = play(t, rng, PASS_PLOYS, ['ability.choice', 'firefight.action', 'firefight.activate'])
    expect(r.state.pending!.kind).toBe('ability.choice')
    const shootOffer = r.state.pending!.options!.find((o) => String(o.data!.name).includes('shoots'))!
    const paid = take(r.state, shootOffer.id).state
    const weapon = take(paid, 'ex.w.heavy-stubber-sweeping').state
    expect(optionIds(weapon)).toEqual([boy])
    // the sweeping profile's Torrent finds the Slasha within 1 inch, but the ploy bars selecting it
    const primary = take(weapon, boy).state
    expect(primary.attack!.targets).toEqual([boy])
    expect(primary.pending!.kind === 'shoot.target' && optionIds(primary).some((i) => i.startsWith('add:'))).toBe(false)
    // declined, then the Boy starts another action: the record of its shot is gone
    const declined = passIt(r.state).state
    expect(declined.effects.some((e) => e.kind === 'ex.attacked' && e.operativeId === boy)).toBe(true)
    const next = take(declined, 'dash').state
    expect(next.effects.some((e) => e.kind === 'ex.attacked' && e.operativeId === boy)).toBe(false)
  })

  it('TEAM-EX-038 SPECIAL ISSUE SHELLS Torrent 1": the weapon has Torrent 1 inch for the action once the primary is picked, and still takes at most one secondary', () => {
    const s0 = open({ equipmentA: ['ex.e.special-issue-shells'] })
    const vig = A(s0, 'vigilant')
    const boy = B(s0, 'boy')
    const second = B(s0, 'slasha-boy')
    const third = B(s0, 'burna-boy')
    const field = edit(place(place(place(place(s0, vig, 0, 0), boy, 5, 0), second, 5, 1.9), third, 5, -1.9), (x) => void (x.players.A.cp = 3))
    const torrent = take(take(activateOp(field, vig), 'shoot').state, 'ex.x.shells-torrent').state
    const chosen = take(passPloys(torrent), 'ex.w.combat-shotgun-close').state
    expect(chosen.pending!.kind).toBe('shoot.target')
    const secondaries = take(chosen, boy).state
    expect(optionIds(secondaries).sort()).toEqual([`add:${second}`, `add:${third}`, 'done'].sort())
    expect(rulesOf(secondaries, vig, 'ex.w.combat-shotgun-close', 'shoot', second)).toContain('torrent 1')
    const added = take(secondaries, `add:${second}`).state
    expect(added.attack!.targets).toEqual([boy, second])
    expect(parseRules(effectiveRules(added, added.operatives[vig]!, added.data.weapons['ex.w.combat-shotgun-close']!, 'shoot', second)).torrent).toBe(1)
    // the shotgun's other profile, and the same profile without the shell, have no Torrent
    expect(rulesOf(added, vig, 'ex.w.combat-shotgun-long', 'shoot', boy)).toContain('torrent 1')
    expect(rulesOf(field, vig, 'ex.w.combat-shotgun-close', 'shoot', boy)).not.toContain('torrent 1')
  })

  // @@TESTS@@

  it('TEAM-EX-013 Medic! outside an attack (rule damage): the removal waits and its owner may use it or decline it (declined, the turning point chance is gone)', () => {
    const s = open()
    const med = A(s, 'chirurgant')
    const vig = A(s, 'vigilant')
    const boy = B(s, 'boy')
    const near = edit(place(place(place(s, med, 0, 0), vig, 2, 0), boy, 9, 0), (st) => void (st.operatives[vig]!.wounds = 2))
    const parked = near.pending!
    const asked = withCtx(near, (ctx) => {
      directDamage(ctx, vig, 5, boy, 'test.rule')
      expect(ctx.state.operatives[vig]!.status).toBe('active')
      runDeferredRemovals(ctx)
    }).state
    expect(asked.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { hook: 'exMedic', stage: 'save', operativeId: vig, medicId: med } })
    // used: back on 1 wound, both at APL -1, the free Dash waits for the next reaction point, the parked decision returns
    const used = take(asked, 'use').state
    expect(used.operatives[vig]).toMatchObject({ status: 'active', wounds: 1 })
    expect(used.operatives[vig]!.aplMods).toBe(-1)
    expect(used.operatives[med]!.aplMods).toBe(-1)
    expect(used.effects.some((e) => e.kind === 'ex.medicDash' && e.operativeId === vig)).toBe(true)
    expect(used.kills ?? []).toEqual([])
    expect(used.pending?.id).toBe(parked.id)
    // declined: removed, logged as a kill, and no second chance this turning point
    const declined = take(asked, 'decline').state
    expect(declined.operatives[vig]!.status).toBe('removed')
    expect(declined.kills).toMatchObject([{ removedId: vig, cause: 'direct' }])
    expect(usedThisTp(declined, 'A', `ex.medic:${med}`)).toBe(true)
    expect(declined.pending?.id).toBe(parked.id)
    // with an enemy in its control range there is nothing to ask: removed at once
    const plain = withCtx(place(near, boy, 3, 0), (ctx) => directDamage(ctx, vig, 5, boy, 'test.rule')).state
    expect(plain.operatives[vig]!.status).toBe('removed')
  })

  it('TEAM-EX-003 MARKED FOR JUSTICE re-pick after a rule kill: the mark removed (and logged) at removal time in the Exaction operative\'s action is re-picked in that action\'s reaction round', () => {
    const s = open()
    const vig = A(s, 'vigilant')
    const foe = B(s, 'boy')
    const marked = withFx(place(place(s, vig, 0, 0), foe, 12, 0), { source: 'ex.p.marked-for-justice', kind: 'ex.mark', data: { markId: foe } })
    // the Vigilant dashes; the mark falls to rule damage during the Dash (a mine, say) and is logged at once
    let t = take(activateOp(marked, vig), 'dash').state
    t = withCtx(t, (ctx) => void directDamage(ctx, foe, 99, vig, 'test.rule')).state
    expect(t.operatives[foe]!.status).toBe('removed')
    expect(t.kills).toMatchObject([{ removedId: foe, killerId: vig, cause: 'direct' }])
    const dashed = play(t, dice(), goTo(2, 0), WITH_CHOICES).state
    expect(dashed.pending!.kind).toBe('ability.choice')
    const picks = dashed.pending!.options!.filter((o) => o.id.startsWith('react:'))
    expect(picks.length).toBeGreaterThan(0)
    expect(markOf(take(dashed, picks[0]!.id).state, 'A')!.id).toBe(picks[0]!.data!.targetId)
  })
})
