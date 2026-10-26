// warpcoven engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-WC-nnn).
// Warpcoven are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { view } from '@/engine'
import { abilityOffers, canCounteractWithOrder, maxRepeats, repeatSurcharge } from '@/engine/abilities'
import { attackStats, defenceStats, effectiveRules, expireAplEffects, inflict, newSide, parseRules, pushRolled, reclassify, weaponDamage } from '@/engine/attack-common'
import { hasKeyword } from '@/engine/conditions'
import { runHook } from '@/engine/hooks'
import { usedThisTp } from '@/engine/effects'
import { territoryOf } from '@/engine/equipment'
import { pickAlternatives, resolvePicks } from '@/engine/operative-picks'
import { offersFor, usePloy } from '@/engine/ploys'
import { isPsychicAbility, isPsychicWeapon } from '@/engine/psychic'
import { bodyOf, visible } from '@/engine/los'
import { gapToMarker } from '@/engine/measure'
import { markerControl } from '@/engine/query'
import { ScriptedRng } from '@/engine/rng'
import { shootableWeapons } from '@/engine/shoot'
import { effectiveApl, effectiveMove } from '@/engine/state'
import { providerBlockCapacity, providerCanFly, providerCostDelta, providerMarkerActionRelief, providerWeaponForbidden, registerTeamRules, unregisterTeamRules } from '@/engine/team-rules'
import { TEAM_ID } from '@/engine/teams/warpcoven'
import { tokensOnActivationEnd, tokensOnActivationStart, tokensOnRemoval } from '@/engine/tokens'
import type { AttackState, GameState } from '@/engine/types'
import { enumerateLoadouts, loadBundle, validateOperativePicks, validateRoster, type DatacardData } from '../../../src/data'
import { play, ranged, withWeapons } from '../../fixtures/attack'
import { place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { activateOp, edit, expectOk, inTp, optionIds, passIt, realBundle, take, withCtx } from '../../fixtures/real'
import { A, B, bTurn, dice, engaged, movePath, open, STD, STOP_PLOY, strikes, takePloy, toCounteract, toGambit, wcRoster, type Spec } from './warpcoven.hooks'

const data = loadBundle()

/** Pass the opponent's ploy windows until a decision for seat A (or a non-ploy decision) is pending. */
function untilMine(s: GameState, stop = STOP_PLOY): GameState {
  let t = s
  for (let i = 0; i < 10 && t.pending?.kind === 'ploy.firefight' && t.pending.seat === 'B'; i++) t = play(passIt(t, dice()).state, dice(), {}, stop).state
  return t
}
const STOP_REACT: typeof STOP_PLOY = [...STOP_PLOY, 'ability.choice']
const cards = realBundle.datacards

describe('TEAM-WC Warpcoven', () => {
  it('TEAM-WC-000 TEAM-WC-001 playable team: five selections, Tzaangors are halves, WARRIORs repeat, at least one SORCERER', () => {
    expect(TEAM_ID).toBe('warpcoven')
    const team = data.teams['warpcoven']!
    expect(team.playable).toBe(true)
    const ok = (main: string[]) => validateRoster(team, { main }, cards as never)
    const base = ['wc.sorcerer-of-destiny', 'wc.rubric-marine-gunner', 'wc.rubric-marine-icon-bearer', 'wc.rubric-marine-warrior']
    // two Tzaangors cost one selection
    expect(ok([...base, 'wc.tzaangor-champion', 'wc.tzaangor-warrior']).ok).toBe(true)
    // a lone Tzaangor rounds up to a whole one: 4 + 1 = 5
    expect(ok([...base, 'wc.tzaangor-warrior']).ok).toBe(true)
    expect(ok(base).ok).toBe(false)
    // both WARRIOR cards repeat, every other card at most once
    expect(ok(['wc.sorcerer-of-destiny', 'wc.rubric-marine-warrior', 'wc.rubric-marine-warrior', 'wc.rubric-marine-warrior', 'wc.rubric-marine-warrior']).ok).toBe(true)
    expect(ok(['wc.sorcerer-of-destiny', 'wc.tzaangor-warrior', 'wc.tzaangor-warrior', 'wc.tzaangor-warrior', 'wc.tzaangor-warrior', 'wc.tzaangor-warrior', 'wc.tzaangor-warrior', 'wc.tzaangor-warrior', 'wc.tzaangor-warrior']).ok).toBe(true)
    expect(ok(['wc.sorcerer-of-destiny', 'wc.rubric-marine-gunner', 'wc.rubric-marine-gunner', 'wc.rubric-marine-warrior', 'wc.rubric-marine-warrior']).ok).toBe(false)
    // no Sorcerer: rejected
    expect(ok(['wc.rubric-marine-gunner', 'wc.rubric-marine-icon-bearer', 'wc.rubric-marine-warrior', 'wc.rubric-marine-warrior', 'wc.rubric-marine-warrior']).ok).toBe(false)
    // the default roster is legal and fields 5 to 9 operatives
    expect(ok(team.defaults!.roster!).ok).toBe(true)
  })

  it('TEAM-WC-002 loadouts: Sorcerer sidearm options, one warpflame pistol, one soulreaper cannon with both profiles, Champion and Tzaangor Warrior options', () => {
    const count = (id: string) => enumerateLoadouts(data.byId[id] as DatacardData).length
    expect([count('wc.sorcerer-of-destiny'), count('wc.sorcerer-of-tempyrion'), count('wc.sorcerer-of-warpfire')]).toEqual([3, 3, 3])
    expect(count('wc.rubric-marine-gunner')).toBe(2)
    expect(count('wc.tzaangor-champion')).toBe(2)
    expect(count('wc.tzaangor-warrior')).toBe(3)
    for (const id of ['wc.rubric-marine-icon-bearer', 'wc.rubric-marine-warrior', 'wc.tzaangor-horn-bearer', 'wc.tzaangor-icon-bearer']) expect(count(id)).toBe(1)
    const cannon = realBundle.datacards['wc.rubric-marine-gunner']!.legalLoadouts!.find((l) => l.includes('wc.w.soulreaper-cannon-focused'))!
    expect(cannon).toEqual(expect.arrayContaining(['wc.w.soulreaper-cannon-focused', 'wc.w.soulreaper-cannon-sweeping', 'wc.w.fists']))
    // a Sorcerer always has its force stave and the PSYCHIC weapons printed on its card
    const g = open({ rosterA: wcRoster(STD) })
    expect(g.operatives[A(g, 'sorcerer-of-warpfire')]!.weapons).toEqual(expect.arrayContaining(['wc.w.firestorm', 'wc.w.mindburn', 'wc.w.force-stave', 'wc.w.inferno-bolt-pistol']))
    expect(g.operatives[A(g, 'sorcerer-of-destiny')]!.weapons).toEqual(expect.arrayContaining(['wc.w.doombolt', 'wc.w.force-stave']))
  })

  it('TEAM-WC-003 TEAM-WC-005b boons: one per Sorcerer, unique across the roster, tags (not keywords), public, defaults differ', () => {
    const team = data.teams['warpcoven']!
    const destiny = data.byId['wc.sorcerer-of-destiny'] as DatacardData
    expect(validateOperativePicks(team, destiny, { boon: 'TIME-WALK' })).toEqual([])
    expect(validateOperativePicks(team, destiny, { boon: 'NOT A BOON' }).length).toBeGreaterThan(0)
    // a Rubric Marine takes no boon
    expect(validateOperativePicks(team, data.byId['wc.rubric-marine-warrior'] as DatacardData, { boon: 'TIME-WALK' }).length).toBeGreaterThan(0)
    // two Sorcerers cannot share one
    const t = realBundle.teams['warpcoven']
    const taken = { boon: ['TIME-WALK'] }
    expect(resolvePicks(t, realBundle.datacards['wc.sorcerer-of-tempyrion']!, { boon: 'TIME-WALK' }, taken).problem).not.toBeNull()
    expect(resolvePicks(t, realBundle.datacards['wc.sorcerer-of-tempyrion']!, {}, taken).picks.boon).not.toBe('TIME-WALK')
    const s = open({ rosterA: wcRoster(STD) })
    const so = A(s, 'sorcerer-of-destiny')
    expect(s.operatives[so]!.picks!.boon).toBe('TIME-WALK')
    expect(hasKeyword(s, s.operatives[so]!, 'TIME-WALK')).toBe(false)
    expect(view(s, 'B').operatives[so]!.picks).toMatchObject({ boon: 'TIME-WALK' })
    // the default roster gives each default Sorcerer a different boon
    const d = data.teams['warpcoven']!.defaults!
    const boons = d.operativePicks!.map((p) => p.boon).filter(Boolean)
    expect(new Set(boons).size).toBe(boons.length)
    expect(boons.length).toBe(2)
  })

  it('TEAM-WC-004 PSYCHIC tags: five weapons and five actions carry it, and a Null Rod switches off actions, ranged weapons, targeting and lasting effects', () => {
    const s = open({ rosterA: wcRoster(STD) })
    for (const w of ['wc.w.doombolt', 'wc.w.fluxblast', 'wc.w.firestorm', 'wc.w.mindburn', 'wc.w.force-stave']) expect(isPsychicWeapon(s, w), w).toBe(true)
    for (const w of ['wc.w.inferno-bolt-pistol', 'wc.w.warpflame-pistol', 'wc.w.prosperine-khopesh', 'wc.w.fists']) expect(isPsychicWeapon(s, w), w).toBe(false)
    for (const a of ['protected-by-fate', 'ravage-destiny', 'reconstitution-ritual', 'temporal-flux', 'alight']) expect(isPsychicAbility(s, 'wc.a.' + a), a).toBe(true)
    expect(isPsychicAbility(s, 'wc.a.brayhorn')).toBe(false)
    const destiny = A(s, 'sorcerer-of-destiny')
    const boy = B(s, 'boy')
    const field = edit(place(place(s, destiny, 0, 0), boy, 6, 0), (st) => {
      st.firefight.activation = { operativeId: destiny, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null }
      st.operatives[destiny]!.order = 'engage'
    })
    const actions = (st: GameState) => abilityOffers(st, st.operatives[destiny]!, st.firefight.activation).map((o) => o.abilityId)
    const guns = (st: GameState) => shootableWeapons(st, st.operatives[destiny]!, []).map((w) => w.weaponId)
    expect(actions(field)).toEqual(expect.arrayContaining(['wc.a.protected-by-fate', 'wc.a.ravage-destiny']))
    expect(guns(field)).toContain('wc.w.doombolt')
    // the Null Rod stands over the Sorcerer: no PSYCHIC action, no PSYCHIC ranged weapon, the pistol still works
    const blocked = new Set<string>()
    const immune = new Set<string>()
    registerTeamRules({ id: 'test.nullrod', psychicBlocked: (_s, o) => blocked.has(o.id), psychicImmune: (_s, o) => immune.has(o.id) })
    try {
      blocked.add(destiny)
      expect(actions(field)).toEqual([])
      expect(guns(field)).not.toContain('wc.w.doombolt')
      expect(guns(field)).toContain('wc.w.inferno-bolt-pistol')
      // an immune enemy cannot be picked by Ravage Destiny
      blocked.clear()
      immune.add(boy)
      expect(actions(field)).toContain('wc.a.protected-by-fate')
      expect(actions(field)).not.toContain('wc.a.ravage-destiny')
      // a lasting effect does nothing while an operative it touches is in range: Alight's Ceaseless
      immune.clear()
      const lit = edit(field, (st) => {
        st.operatives[boy]!.tokens = [{ kind: 'wc.alight', owner: 'A', count: 1 }]
      })
      const ceaseless = (st: GameState) => effectiveRules(st, st.operatives[destiny]!, st.data.weapons['wc.w.inferno-bolt-pistol']!, 'shoot', boy).some((r) => r.rule === 'ceaseless')
      expect(ceaseless(lit)).toBe(true)
      blocked.add(boy)
      expect(ceaseless(lit)).toBe(false)
      blocked.clear()
      blocked.add(destiny)
      expect(ceaseless(lit)).toBe(false)
    } finally {
      unregisterTeamRules('test.nullrod')
    }
  })

  it('TEAM-WC-005 ASTARTES: no bolt condition, +1 AP for a repeated warpflamer or soulreaper cannon, PSYCHIC weapons once, any order counteracts, Tzaangors get none', () => {
    const cannon = realBundle.datacards['wc.rubric-marine-gunner']!.legalLoadouts!.find((l) => l.includes('wc.w.soulreaper-cannon-focused'))!
    const s = open({ rosterA: wcRoster([...STD.slice(0, 2), { id: 'wc.rubric-marine-gunner', weapons: ['wc.w.warpflamer', 'wc.w.fists'] }, { id: 'wc.rubric-marine-icon-bearer' }, { id: 'wc.tzaangor-warrior', weapons: ['wc.w.autopistol', 'wc.w.chainsword'] }]) })
    const gunner = A(s, 'rubric-marine-gunner')
    const get = (id: string) => s.operatives[id]!
    // two Shoots or two Fights, never both kinds twice
    expect(maxRepeats(s, get(gunner), 'shoot', ['shoot'])).toBe(2)
    expect(maxRepeats(s, get(gunner), 'fight', ['shoot', 'shoot'])).toBe(1)
    expect(maxRepeats(s, get(A(s, 'sorcerer-of-destiny')), 'fight', ['fight'])).toBe(2)
    expect(maxRepeats(s, get(A(s, 'tzaangor-warrior')), 'shoot', ['shoot'])).toBe(1)
    expect(maxRepeats(s, get(A(s, 'tzaangor-warrior')), 'fight', ['fight'])).toBe(1)
    // the surcharge: the same warpflamer twice costs 1 more AP; a weapon not yet used costs nothing
    const act = (op: string, weaponsUsed: string[]) => ({ operativeId: op, seat: 'A' as const, counteract: false, stage: 'action' as const, apSpent: 1, performed: ['shoot'], declared: null, weaponsUsed })
    expect(repeatSurcharge(s, get(gunner), act(gunner, ['wc.w.warpflamer']), 'wc.w.warpflamer')).toBe(1)
    expect(repeatSurcharge(s, get(gunner), act(gunner, []), 'wc.w.warpflamer')).toBe(0)
    // both soulreaper profiles are one weapon
    const c = open({ rosterA: wcRoster([...STD.slice(0, 2), { id: 'wc.rubric-marine-gunner', weapons: cannon }, { id: 'wc.rubric-marine-icon-bearer' }, { id: 'wc.rubric-marine-warrior' }]) })
    const cg = A(c, 'rubric-marine-gunner')
    expect(repeatSurcharge(c, c.operatives[cg]!, act(cg, ['wc.w.soulreaper-cannon-focused']), 'wc.w.soulreaper-cannon-sweeping')).toBe(1)
    // the same PSYCHIC ranged weapon is not selectable twice, a different weapon is
    const destiny = A(s, 'sorcerer-of-destiny')
    const boy = B(s, 'boy')
    const second = (used: string[]) => {
      const t = edit(place(place(activateOp(place(place(s, destiny, 0, 0), boy, 5, 0), destiny), destiny, 0, 0), boy, 5, 0), (st) => {
        st.firefight.activation!.performed = ['shoot']
        st.firefight.activation!.weaponsUsed = used
      })
      return shootableWeapons(t, t.operatives[destiny]!, ['shoot']).map((w) => w.weaponId)
    }
    expect(second(['wc.w.doombolt'])).toContain('wc.w.inferno-bolt-pistol')
    expect(second(['wc.w.doombolt'])).not.toContain('wc.w.doombolt')
    expect(second(['wc.w.inferno-bolt-pistol'])).toContain('wc.w.doombolt')
    // any order counteracts for Sorcerers and Rubric Marines, a Tzaangor needs Engage
    const conceal = (id: string) => edit(s, (st) => (st.operatives[id]!.order = 'conceal'))
    expect(canCounteractWithOrder(conceal(destiny), conceal(destiny).operatives[destiny]!)).toBe(true)
    expect(canCounteractWithOrder(conceal(gunner), conceal(gunner).operatives[gunner]!)).toBe(true)
    const tz = A(s, 'tzaangor-warrior')
    expect(canCounteractWithOrder(conceal(tz), conceal(tz).operatives[tz]!)).toBe(false)
  })

  it('TEAM-WC-006 TEAM-WC-007 boons: Incorporeal Sight, Twist of Fate, Time-Walk (injury still takes 2"), Warp Swell (melee Normal Dmg only)', () => {
    const boon = (b: string): GameState => open({ rosterA: wcRoster(STD.map((x, i): Spec => (i === 0 ? { ...x, boon: b } : x))) })
    const rules = (st: GameState, id: string, w: string, kind: 'shoot' | 'fight') => effectiveRules(st, st.operatives[id]!, st.data.weapons[w]!, kind, B(st, 'boy')).map((r) => r.rule + (r.crits ? ':crits' : ''))
    // Incorporeal Sight
    const sight = boon('INCORPOREAL SIGHT')
    const d = A(sight, 'sorcerer-of-destiny')
    expect(rules(sight, d, 'wc.w.doombolt', 'shoot')).toContain('saturate')
    expect(rules(sight, d, 'wc.w.inferno-bolt-pistol', 'shoot')).toContain('saturate')
    expect(rules(sight, d, 'wc.w.force-stave', 'fight')).not.toContain('saturate')
    expect(rules(boon('WARP SWELL'), d, 'wc.w.doombolt', 'shoot')).not.toContain('saturate')
    // obscured is switched off for the shooter with the boon
    const status = { obscured: true, inCover: false }
    runHook('target.status', { seat: 'A', state: sight, operativeId: d, targetId: B(sight, 'boy'), data: status })
    expect(status.obscured).toBe(false)
    // Twist of Fate: PSYCHIC ranged weapons only
    const twist = boon('TWIST OF FATE')
    expect(rules(twist, d, 'wc.w.doombolt', 'shoot')).toContain('piercing:crits')
    expect(rules(twist, d, 'wc.w.inferno-bolt-pistol', 'shoot')).toContain('piercing')
    expect(rules(twist, d, 'wc.w.inferno-bolt-pistol', 'shoot')).not.toContain('piercing:crits')
    expect(rules(twist, d, 'wc.w.force-stave', 'fight')).not.toContain('piercing:crits')
    // Time-Walk: 7", 5" when injured; others unchanged
    const walk = boon('TIME-WALK')
    expect(effectiveMove(walk.operatives[d]!, walk)).toBe(7)
    const hurt = edit(walk, (st) => (st.operatives[d]!.wounds = 5))
    expect(effectiveMove(hurt.operatives[d]!, hurt)).toBe(5)
    expect(effectiveMove(walk.operatives[A(walk, 'sorcerer-of-tempyrion')]!, walk)).toBe(6)
    // Warp Swell: melee Normal Dmg +1
    const swell = boon('WARP SWELL')
    expect(weaponDamage(swell, d, 'wc.w.force-stave', B(swell, 'boy'), 'fight')).toEqual({ normal: 5, crit: 6 })
    expect(weaponDamage(swell, d, 'wc.w.doombolt', B(swell, 'boy'), 'shoot')).toEqual({ normal: 4, crit: 2 })
    expect(weaponDamage(walk, d, 'wc.w.force-stave', B(walk, 'boy'), 'fight')).toEqual({ normal: 4, crit: 6 })
  })

  it('TEAM-WC-008 Echoes from the Warp: once per battle at a counteraction, order may flip, one more free 1 AP action that differs, one shared 2" move cap', () => {
    const s = open({ rosterA: wcRoster(STD.map((x, i): Spec => (i === 0 ? { ...x, boon: 'ECHOES FROM THE WARP' } : x))) })
    const d = A(s, 'sorcerer-of-destiny')
    const c = toCounteract(s)
    expect(optionIds(c)).toContain(`counteract:${d}`)
    const start = take(c, `counteract:${d}`).state
    expect(start.pending!.kind).toBe('ploy.firefight')
    expect(optionIds(start)).toEqual(expect.arrayContaining(['wc.a.boon-echoes-from-the-warp:keep', 'wc.a.boon-echoes-from-the-warp:flip']))
    const before = start.operatives[d]!.order
    const used = take(start, 'wc.a.boon-echoes-from-the-warp:flip').state
    expect(used.operatives[d]!.order).not.toBe(before)
    expect(used.firefight.activation!.bonus).toBe(1)
    expect(used.ledger.A.battle).toContain('wc.echoes')
    // first action: a 1" Reposition; the second action must differ and may move only what is left of the 2"
    expect(used.pending!.kind).toBe('firefight.action')
    const first = movePath(take(used, 'reposition').state, used.operatives[d]!.pos.x + 1, used.operatives[d]!.pos.z)
    const second = expectOk(first).state
    expect(second.pending!.kind).toBe('firefight.action')
    expect(optionIds(second)).not.toContain('reposition')
    expect(optionIds(second)).toContain('dash')
    expect(take(second, 'dash').state.pending!.constraints!.maxInches).toBe(1)
    // once per battle: a later counteraction (any operative with the boon) is offered no Echoes
    expect(offersFor(second, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: d, counteracting: true }).some((o) => o.id.startsWith('wc.a.boon-echoes'))).toBe(false)
    // keep: no order change, and the bonus action is still granted
    const keep = take(take(c, `counteract:${d}`).state, 'wc.a.boon-echoes-from-the-warp:keep').state
    expect(keep.operatives[d]!.order).toBe(c.operatives[d]!.order)
    expect(keep.firefight.activation!.bonus).toBe(1)
  })

  it('TEAM-WC-009 Mutant Appendage: a mission action with an enemy in control range, and the first marker action of an activation costs 1 less AP', () => {
    const roster = (b: string) => wcRoster(STD.map((x, i): Spec => (i === 0 ? { ...x, boon: b } : x)))
    const mk = (b: string): GameState => {
      const s = inTp(open({ rosterA: roster(b) }), 2)
      const d = A(s, 'sorcerer-of-destiny')
      const m = s.markers.find((k) => k.kind === 'objective')!
      return place(place(s, d, m.pos.x + 0.9, m.pos.z), B(s, 'boy'), m.pos.x + 0.9, m.pos.z + 1.5)
    }
    const d = A(mk('MUTANT APPENDAGE'), 'sorcerer-of-destiny')
    const withBoon = activateOp(mk('MUTANT APPENDAGE'), d)
    const without = activateOp(mk('TIME-WALK'), d)
    const secure = (st: GameState) => st.pending!.options!.find((o) => o.id.startsWith('ability:core.a.secure'))
    expect(secure(without)).toBeUndefined()
    expect(secure(withBoon)).toBeTruthy()
    expect(secure(withBoon)!.data?.cost).toBe(0)
    // relief is for Pick Up Marker and mission actions only
    const op = withBoon.operatives[d]!
    expect(providerMarkerActionRelief(withBoon, op, 'marker:pickUp').ignoreEnemyControlRange).toBe(true)
    expect(providerMarkerActionRelief(withBoon, op, 'ability:core.a.secure').ignoreEnemyControlRange).toBe(true)
    expect(providerMarkerActionRelief(withBoon, op, 'marker:place').ignoreEnemyControlRange).toBe(false)
    // the discount is spent by the first one; a second costs full, and a counteraction never gets it
    expect(providerCostDelta(withBoon, op, 'marker:pickUp')).toBe(-1)
    const spent = edit(withBoon, (st) => {
      st.effects.push({ id: 'e90', seat: 'A', kind: 'ployFlag', expires: 'activation', source: 'wc.appendage.spent', operativeId: d })
    })
    expect(providerCostDelta(spent, spent.operatives[d]!, 'marker:pickUp')).toBe(0)
    const counter = edit(withBoon, (st) => {
      st.firefight.activation!.counteract = true
    })
    expect(providerCostDelta(counter, counter.operatives[d]!, 'marker:pickUp')).toBe(0)
  })

  it('TEAM-WC-010 Immaterial Flight: FLY on Reposition or Charge up to Move (no +2" on Charge), outside enemy control ranges unless Charging, once per turning point, never counteracting', () => {
    const s = open({ rosterA: wcRoster(STD.map((x, i): Spec => (i === 0 ? { ...x, boon: 'IMMATERIAL FLIGHT' } : x))) })
    const d = A(s, 'sorcerer-of-destiny')
    const boy = B(s, 'boy')
    const t = activateOp(place(place(s, d, 0, 0), boy, 10, 0), d)
    const moveOf = (st: GameState, action: string) => take(st, action).state
    // beyond the Move stat is refused, a spot within 6" is fine
    expect(movePath(moveOf(t, 'reposition'), 6.5, 0, true).rejection).toBeTruthy()
    const flown = expectOk(movePath(moveOf(t, 'reposition'), 5.5, 0, true)).state
    expect(flown.operatives[d]!.pos.x).toBeCloseTo(5.5)
    expect(usedThisTp(flown, 'A', `wc.flight:${d}`)).toBe(true)
    // once per turning point
    const second = take(flown, 'dash').state
    expect(second.pending!.kind).toBe('move.path')
    expect(providerCanFly(second, second.operatives[d]!, 'reposition')).toBe(false)
    // a FLY Reposition cannot end in an enemy control range; a Charge must
    const near = activateOp(place(place(s, d, 0, 0), boy, 7, 0), d)
    expect(movePath(moveOf(near, 'reposition'), 5.7, 0, true).rejection).toBeTruthy()
    const charged = expectOk(movePath(moveOf(near, 'charge'), 5.7, 0, true)).state
    expect(charged.operatives[d]!.pos.x).toBeCloseTo(5.7)
    // a Charge by FLY has no +2": 6" at most
    const far = activateOp(place(place(s, d, 0, 0), boy, 13, 0), d)
    expect(movePath(moveOf(far, 'charge'), 7, 0, true).rejection).toBeTruthy()
    // not while counteracting
    const c = take(toCounteract(s), `counteract:${d}`).state
    expect(providerCanFly(c, c.operatives[d]!, 'reposition')).toBe(false)
  })

  it('TEAM-WC-011 TEAM-WC-012 Astral Bombardment and Master of the Immaterium: 2" Devastating 2, Devastating 1, the Warpfire Shoot choice; +3" to the PSYCHIC distances', () => {
    const rules = (st: GameState, id: string, w: string) =>
      effectiveRules(st, st.operatives[id]!, st.data.weapons[w]!, 'shoot', B(st, 'boy'))
        .filter((r) => r.rule === 'devastating' || r.rule === 'seek-light')
        .map((r) => `${r.rule.replace('-', '')}${r.x ?? ''}${r.inches ? `@${r.inches}` : ''}`)
    // doombolt: 2" Devastating 2 instead of Devastating 2
    const bomb = open({ rosterA: wcRoster(STD.map((x, i): Spec => (i === 0 ? { ...x, boon: 'ASTRAL BOMBARDMENT' } : x))) })
    const d = A(bomb, 'sorcerer-of-destiny')
    expect(rules(bomb, d, 'wc.w.doombolt')).toEqual(['devastating2@2'])
    expect(rules(open({ rosterA: wcRoster(STD) }), d, 'wc.w.doombolt')).toEqual(['devastating2'])
    // fluxblast gains Devastating 1
    const flux = open({ rosterA: wcRoster(STD.map((x, i): Spec => (i === 1 ? { ...x, boon: 'ASTRAL BOMBARDMENT' } : x))) })
    expect(rules(flux, A(flux, 'sorcerer-of-tempyrion'), 'wc.w.fluxblast')).toEqual(['devastating1'])
    // the Warpfire: its picked weapon trades Seek Light for Devastating 1, chosen when the Shoot is declared
    const fire = open({ rosterA: wcRoster(STD.map((x, i): Spec => (i === 2 ? { ...x, boon: 'ASTRAL BOMBARDMENT', bombard: 'FIRESTORM' } : x))) })
    const w = A(fire, 'sorcerer-of-warpfire')
    expect(rules(fire, w, 'wc.w.firestorm')).toEqual(['seeklight'])
    const info = { window: 'firefight.actionDeclared', subjectId: w, counteracting: false, action: 'shoot' }
    const offer = offersFor(fire, 'A', 'firefight.actionDeclared', info).find((o) => o.ployId === 'wc.a.boon-astral-bombardment')!
    expect(offer).toBeTruthy()
    const chosen = withCtx(fire, (ctx) => usePloy(ctx, 'A', offer, info)).state
    expect(rules(chosen, w, 'wc.w.firestorm')).toEqual(['devastating1'])
    // the mindburn is not the picked weapon: it keeps Seek Light
    expect(rules(chosen, w, 'wc.w.mindburn')).toEqual(['seeklight'])
    const mind = open({ rosterA: wcRoster(STD.map((x, i): Spec => (i === 2 ? { ...x, boon: 'ASTRAL BOMBARDMENT', bombard: 'MINDBURN' } : x))) })
    expect(rules(mind, A(mind, 'sorcerer-of-warpfire'), 'wc.w.firestorm')).toEqual(['seeklight'])
    // Master of the Immaterium: Ravage Destiny at 11.5" and Reconstitution Ritual at 8.5"; the plain Sorcerer cannot
    const field = (idx: number, b: string, dx: number, dz: number, other: string): GameState => {
      const g = open({ rosterA: wcRoster(STD.map((x, i): Spec => (i === idx ? { ...x, boon: b } : x))) })
      const me = A(g, idx === 0 ? 'sorcerer-of-destiny' : 'sorcerer-of-tempyrion')
      const friend = A(g, other)
      return edit(place(place(place(g, me, 0, 0), B(g, 'boy'), dx, 0), friend, 0, dz), (st) => {
        st.operatives[friend]!.wounds = 5
        st.firefight.activation = { operativeId: me, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null }
        st.operatives[me]!.order = 'engage'
      })
    }
    const ids = (st: GameState, who: string) => abilityOffers(st, st.operatives[A(st, who)]!, st.firefight.activation).map((o) => o.abilityId)
    // distances are base to base: two 32mm bases add 1.26" to the centre distance
    const c = (gap: number) => gap + 1.26
    expect(ids(field(0, 'MASTER OF THE IMMATERIUM', c(11.9), 8.5, 'rubric-marine-warrior'), 'sorcerer-of-destiny')).toContain('wc.a.ravage-destiny')
    expect(ids(field(0, 'MASTER OF THE IMMATERIUM', c(12.1), 8.5, 'rubric-marine-warrior'), 'sorcerer-of-destiny')).not.toContain('wc.a.ravage-destiny')
    expect(ids(field(0, 'TIME-WALK', c(9.1), 8.5, 'rubric-marine-warrior'), 'sorcerer-of-destiny')).not.toContain('wc.a.ravage-destiny')
    expect(ids(field(0, 'TIME-WALK', c(8.9), 8.5, 'rubric-marine-warrior'), 'sorcerer-of-destiny')).toContain('wc.a.ravage-destiny')
    // Reconstitution Ritual: friend at 8.9" with the boon, not at 9.1" or without it
    expect(ids(field(1, 'MASTER OF THE IMMATERIUM', 11, c(8.9), 'rubric-marine-warrior'), 'sorcerer-of-tempyrion')).toContain('wc.a.reconstitution-ritual')
    expect(ids(field(1, 'MASTER OF THE IMMATERIUM', 11, c(9.1), 'rubric-marine-warrior'), 'sorcerer-of-tempyrion')).not.toContain('wc.a.reconstitution-ritual')
    expect(ids(field(1, 'WARP SWELL', 11, c(8.9), 'rubric-marine-warrior'), 'sorcerer-of-tempyrion')).not.toContain('wc.a.reconstitution-ritual')
    // Temporal Flux is picked at 9" with the boon (the 6" return check is not extended, see TEAM-WC-016)
    const fluxTargets = (st: GameState) =>
      new Set(abilityOffers(st, st.operatives[A(st, 'sorcerer-of-tempyrion')]!, st.firefight.activation).filter((o) => o.abilityId === 'wc.a.temporal-flux').map((o) => o.params.targetId))
    const warrior = (st: GameState) => A(st, 'rubric-marine-warrior')
    const withMaster = field(1, 'MASTER OF THE IMMATERIUM', 11, c(8.9), 'rubric-marine-warrior')
    const plain = field(1, 'WARP SWELL', 11, c(8.9), 'rubric-marine-warrior')
    expect(fluxTargets(withMaster).has(warrior(withMaster))).toBe(true)
    expect(fluxTargets(plain).has(warrior(plain))).toBe(false)
    expect(fluxTargets(plain).has(A(plain, 'sorcerer-of-tempyrion'))).toBe(true)
  })

  it('TEAM-WC-013 TEAM-WC-014 TEAM-WC-018 Protected by Fate, Ravage Destiny and Alight: tokens that grant re-rolls, force re-rolls of 6s and give Ceaseless, one live token per seat, gone with the Sorcerer', () => {
    const s = open({ rosterA: wcRoster(STD) })
    const d = A(s, 'sorcerer-of-destiny')
    const f = A(s, 'sorcerer-of-warpfire')
    const w = A(s, 'rubric-marine-warrior')
    const champ = A(s, 'tzaangor-champion')
    const boy = B(s, 'boy')
    const nob = B(s, 'boss-nob')
    const tokens = (st: GameState, id: string) => (st.operatives[id]!.tokens ?? []).map((t) => `${t.kind}:${t.count}`)
    // ---- Protected by Fate: a friend (itself included) it can see, not with an enemy in control range
    const g = activateOp(place(place(s, d, 0, 0), w, 3, 0), d)
    expect(optionIds(g)).toEqual(expect.arrayContaining([`ability:wc.a.protected-by-fate:${w}`, `ability:wc.a.protected-by-fate:${d}`]))
    expect(optionIds(activateOp(engaged(s, d, boy), d)).some((id) => id.startsWith('ability:wc.a.protected-by-fate'))).toBe(false)
    const pbf = take(g, `ability:wc.a.protected-by-fate:${w}`).state
    expect(tokens(pbf, w)).toEqual(['wc.protected:1'])
    expect(pbf.operatives[w]!.tokens![0]).toMatchObject({ owner: 'A', sourceId: d, expires: ['sourceNextActivation', 'sourceIncapacitated'] })
    const grants = (st: GameState, id: string) => defenceStats(st, id, boy, 'kom.w.slugga', parseRules([]), false).grants.map((x) => `${x.id}:${x.mode}`)
    expect(grants(pbf, w)).toEqual(['wc.protected:any'])
    expect(grants(pbf, champ)).toEqual([])
    // a new use anywhere moves the one token; the Sorcerer's next activation, or its incapacitation, ends it
    const held = edit(place(s, d, 0, 0), (st) => {
      st.operatives[w]!.tokens = [{ kind: 'wc.protected', owner: 'A', count: 1, sourceId: A(s, 'sorcerer-of-tempyrion'), expires: ['sourceNextActivation', 'sourceIncapacitated'] }]
    })
    const moved = take(activateOp(place(held, champ, 3, 0), d), `ability:wc.a.protected-by-fate:${champ}`).state
    expect([tokens(moved, w), tokens(moved, champ)]).toEqual([[], ['wc.protected:1']])
    expect(tokens(withCtx(pbf, (ctx) => tokensOnActivationStart(ctx, d)).state, w)).toEqual([])
    expect(tokens(withCtx(pbf, (ctx) => tokensOnRemoval(ctx, d)).state, w)).toEqual([])
    // ---- Ravage Destiny: an enemy it can see within 9"; the holder's 6s on attack dice are re-rolled at once
    const rv = take(activateOp(place(place(s, d, 0, 0), boy, 7, 0), d), `ability:wc.a.ravage-destiny:${boy}`).state
    expect(tokens(rv, boy)).toEqual(['wc.ravaged:1'])
    const roll = (kind: 'shoot' | 'fight', which: 'attack' | 'defence', st = rv) => {
      const side = newSide('B', boy, 'kom.w.slugga', 3, null, [])
      pushRolled(side, [6, 3, 6, 2])
      withCtx(st, (ctx) => {
        runHook('diceRolled', { seat: 'B', state: ctx.state, engine: ctx, operativeId: boy, targetId: d, data: { kind, side: which, diceSide: side } })
      }, dice(2, 4))
      return side.dice.map((x) => `${x.value}${x.rerolled ? '*' : ''}`)
    }
    expect(roll('shoot', 'attack')).toEqual(['2*', '3', '4*', '2'])
    expect(roll('fight', 'attack')).toEqual(['2*', '3', '4*', '2'])
    expect(roll('fight', 'defence')).toEqual(['2*', '3', '4*', '2'])
    expect(roll('shoot', 'defence')).toEqual(['6', '3', '6', '2'])
    // its APL counts 1 lower for marker control, though its APL is unchanged
    const m = s.markers.find((k) => k.kind === 'objective')!
    const atMarker = (st: GameState) => place(st, boy, m.pos.x + 0.9, m.pos.z)
    expect(markerControl(atMarker(rv), m).apl.B).toBe(markerControl(atMarker(s), m).apl.B - 1)
    expect(effectiveApl(rv.operatives[boy]!)).toBe(effectiveApl(s.operatives[boy]!))
    // ---- Alight: any enemy it can see; friendly Warpcoven weapons have Ceaseless against it (shooting, fighting, retaliating)
    const al = take(activateOp(place(place(s, f, 0, 0), boy, 12, 0), f), `ability:wc.a.alight:${boy}`).state
    expect(tokens(al, boy)).toEqual(['wc.alight:1'])
    const has = (st: GameState, who: string, w2: string, kind: 'shoot' | 'fight', foe: string) => effectiveRules(st, st.operatives[who]!, st.data.weapons[w2]!, kind, foe).some((r) => r.rule === 'ceaseless')
    expect(has(al, d, 'wc.w.inferno-bolt-pistol', 'shoot', boy)).toBe(true)
    expect(has(al, d, 'wc.w.force-stave', 'fight', boy)).toBe(true)
    expect(has(al, d, 'wc.w.inferno-bolt-pistol', 'shoot', nob)).toBe(false)
    expect(has(s, d, 'wc.w.inferno-bolt-pistol', 'shoot', boy)).toBe(false)
    expect(tokens(withCtx(al, (ctx) => tokensOnActivationStart(ctx, f)).state, boy)).toEqual([])
  })

  it('TEAM-WC-015 TEAM-WC-016 Reconstitution Ritual and Temporal Flux: 2D3 healing once per turning point for the team; one marker, return at the end of the target\'s own activation only when wholly within 6"', () => {
    const s = open({ rosterA: wcRoster(STD) })
    const t = A(s, 'sorcerer-of-tempyrion')
    const w = A(s, 'rubric-marine-warrior')
    // ---- Reconstitution Ritual
    const hurt = edit(place(place(s, t, 0, 0), w, 4, 0), (st) => {
      st.operatives[w]!.wounds = 5
      st.operatives[t]!.wounds = 9
    })
    const ritual = (st: GameState, who: string, rolls: ScriptedRng) => take(activateOp(st, t), `ability:wc.a.reconstitution-ritual:${who}`, rolls).state
    expect(ritual(hurt, w, dice(4, 5)).operatives[w]!.wounds).toBe(10)
    expect(ritual(edit(hurt, (st) => (st.operatives[w]!.wounds = 13)), w, dice(6, 6)).operatives[w]!.wounds).toBe(14)
    expect(ritual(hurt, t, dice(2, 2)).operatives[t]!.wounds).toBe(11)
    // it is not offered for an unhurt friend, nor again this turning point by anyone
    expect(optionIds(activateOp(hurt, t))).not.toContain(`ability:wc.a.reconstitution-ritual:${A(s, 'sorcerer-of-destiny')}`)
    const done = ritual(hurt, w, dice(4, 5))
    expect(usedThisTp(done, 'A', 'wc.ritual')).toBe(true)
    const again = edit(done, (st) => {
      st.firefight.activation!.performed = []
      st.firefight.activation!.apSpent = 0
    })
    expect(abilityOffers(again, again.operatives[t]!, again.firefight.activation).some((o) => o.abilityId === 'wc.a.reconstitution-ritual')).toBe(false)
    // ---- Temporal Flux: a marker in the target's control range, one at a time
    const g = activateOp(place(place(s, t, 0, 0), w, 4, 0), t)
    const pick = g.pending!.options!.find((o) => o.id.startsWith(`ability:wc.a.temporal-flux:${w}@`))!.id
    const fl = take(g, pick).state
    const marker = fl.markers.find((k) => k.equipmentId === 'wc.flux')!
    expect(marker.owner).toBe('A')
    expect(gapToMarker(bodyOf(fl.operatives[w]!), marker)).toBeLessThanOrEqual(1)
    const next = edit(fl, (st) => {
      st.firefight.activation!.performed = []
      st.firefight.activation!.apSpent = 0
    })
    expect(abilityOffers(next, next.operatives[t]!, next.firefight.activation).some((o) => o.abilityId === 'wc.a.temporal-flux')).toBe(false)
    // the end of the target's own activation: wholly within 6" of the marker it is set up beside it, and the marker goes
    const ends = (st: GameState, dx: number) =>
      withCtx(edit(st, (x) => (x.operatives[w]!.pos = { x: marker.pos.x + dx, y: 0, z: marker.pos.z })), (ctx) => {
        runHook('activation.end', { seat: 'A', state: ctx.state, engine: ctx, operativeId: w, data: { counteract: false } })
      })
    const near = ends(fl, 5.5)
    expect(gapToMarker(bodyOf(near.state.operatives[w]!), marker)).toBeLessThanOrEqual(1)
    expect(near.state.markers.some((k) => k.equipmentId === 'wc.flux')).toBe(false)
    expect(near.state.effects.some((e) => e.source === 'wc.flux')).toBe(false)
    expect(near.events.some((e) => e.type === 'OperativeMoved' && e.action === 'forced')).toBe(true)
    // not wholly within 6": it stays where it is and the marker is removed
    const far = ends(fl, 6.5)
    expect(far.state.operatives[w]!.pos.x).toBeCloseTo(marker.pos.x + 6.5)
    expect(far.state.markers.some((k) => k.equipmentId === 'wc.flux')).toBe(false)
    // incapacitated: the marker goes at once
    const dead = withCtx(fl, (ctx) => {
      runHook('operative.incapacitated', { seat: 'A', state: ctx.state, engine: ctx, operativeId: w })
    })
    expect(dead.state.markers.some((k) => k.equipmentId === 'wc.flux')).toBe(false)
    // ending within a Null Rod's reach: no set-up
    registerTeamRules({ id: 'test.nullrod', psychicBlocked: (_s, o) => o.id === w })
    try {
      const rod = ends(fl, 5.5)
      expect(rod.state.operatives[w]!.pos.x).toBeCloseTo(marker.pos.x + 5.5)
      expect(rod.state.markers.some((k) => k.equipmentId === 'wc.flux')).toBe(false)
    } finally {
      unregisterTeamRules('test.nullrod')
    }
  })

  it('TEAM-WC-017 Mindburn: a damaging crit marks the target, its weapons are 1 worse (not on top of injury), the token goes at its next activation end or when mindburn is used again', () => {
    const s = open({ rosterA: wcRoster(STD) })
    const f = A(s, 'sorcerer-of-warpfire')
    const boy = B(s, 'boy')
    const shot = take(take(activateOp(place(place(s, f, 0, 0), boy, 5, 0), f), 'shoot').state, 'wc.w.mindburn').state
    // two crits (Dmg 1) and three fails; the target's defence dice all fail
    const r = play(take(shot, boy, dice(6, 6, 1, 1, 1, 1, 1, 1)).state, dice(1, 1, 1, 1, 1, 1))
    const marked = r.state
    const token = marked.operatives[boy]!.tokens!.find((x) => x.kind === 'wc.mindburn')
    expect(token).toMatchObject({ owner: 'A', count: 1, expires: ['holderActivationEnd'] })
    const need = (st: GameState) => attackStats(st, boy, 'kom.w.slugga', f, { kind: 'shoot' }).need
    const clean = edit(marked, (x) => (x.operatives[boy]!.tokens = []))
    expect(need(marked)).toBe(need(clean) + 1)
    // injured: the penalty is not cumulative with the token
    const hurtBoth = edit(marked, (x) => (x.operatives[boy]!.wounds = 1))
    const hurtOnly = edit(clean, (x) => (x.operatives[boy]!.wounds = 1))
    expect(need(hurtBoth)).toBe(need(hurtOnly))
    // the holder's next activation ends: the token goes
    expect(withCtx(marked, (ctx) => tokensOnActivationEnd(ctx, boy)).state.operatives[boy]!.tokens ?? []).toEqual([])
    // a friendly operative using mindburn again takes every Mindburn token of its side off (before the new roll)
    const again = withCtx(marked, (ctx) => {
      runHook('modifyAttackDice', { seat: 'A', state: ctx.state, engine: ctx, operativeId: f, targetId: B(s, 'boss-nob'), weaponId: 'wc.w.mindburn', data: { kind: 'shoot', atk: 5, hitDelta: 0, accurate: [], lethal: 5, rerolls: [], assists: [] } })
    }).state
    expect(again.operatives[boy]!.tokens ?? []).toEqual([])
    // normal successes give nothing
    const none = play(take(take(take(activateOp(place(place(s, f, 0, 0), boy, 5, 0), f), 'shoot').state, 'wc.w.mindburn').state, boy, dice(4, 4, 1, 1, 1)).state, dice(1, 1, 1)).state
    expect(none.operatives[boy]!.tokens ?? []).toEqual([])
  })

  it('TEAM-WC-019 TEAM-WC-020 TEAM-WC-021 TEAM-WC-022 TEAM-WC-023 TEAM-WC-024 operative rules: Sorcerous Automata, Icon Bearers, Slow and Purposeful, Savage Brutality, Brayhorn, Herd Banner, Relic Hunters, Shield', () => {
    const roster = wcRoster([
      { id: 'wc.sorcerer-of-destiny' },
      { id: 'wc.rubric-marine-icon-bearer' },
      { id: 'wc.rubric-marine-warrior' },
      { id: 'wc.tzaangor-champion', weapons: ['wc.w.greataxe'] },
      { id: 'wc.tzaangor-icon-bearer' },
      { id: 'wc.tzaangor-horn-bearer' },
      { id: 'wc.tzaangor-warrior', weapons: ['wc.w.tzaangor-blade-and-shield'] },
      { id: 'wc.tzaangor-warrior', weapons: ['wc.w.tzaangor-blades'] },
    ])
    const s = open({ rosterA: roster })
    const d = A(s, 'sorcerer-of-destiny')
    const rubricIcon = A(s, 'rubric-marine-icon-bearer')
    const rw = A(s, 'rubric-marine-warrior')
    const champ = A(s, 'tzaangor-champion')
    const tzIcon = A(s, 'tzaangor-icon-bearer')
    const horn = A(s, 'tzaangor-horn-bearer')
    const boy = B(s, 'boy')
    const [shieldW, bladesW] = Object.values(s.operatives).filter((o) => o.seat === 'A' && o.datacardId === 'wc.tzaangor-warrior').map((o) => o.id) as [string, string]
    // ---- Sorcerous Automata: APL 2 for the activation unless a friendly Sorcerer is within 9"; a counteraction never triggers it
    const lone = activateOp(place(place(s, rw, 0, 0), d, 12, 0), rw)
    expect(effectiveApl(lone.operatives[rw]!)).toBe(2)
    const escorted = activateOp(place(place(s, rw, 0, 0), d, 7, 0), rw)
    expect(effectiveApl(escorted.operatives[rw]!)).toBe(3)
    expect(effectiveApl(withCtx(lone, (ctx) => expireAplEffects(ctx, rw)).state.operatives[rw]!)).toBe(3)
    const cs = take(toCounteract(s), `counteract:${rw}`).state
    expect(effectiveApl(cs.operatives[rw]!)).toBe(3)
    // ---- Icon Bearers count APL +1 for marker control only
    const m = s.markers.find((k) => k.kind === 'objective')!
    const at = (id: string) => markerControl(place(s, id, m.pos.x + 0.9, m.pos.z), m).apl.A
    expect(at(rubricIcon)).toBe(4)
    expect(at(rw)).toBe(3)
    expect(at(tzIcon)).toBe(3)
    expect(at(shieldW)).toBe(2)
    expect(effectiveApl(s.operatives[rubricIcon]!)).toBe(3)
    // ---- Slow and Purposeful: Ceaseless unless it Charged or Repositioned this activation (Dash keeps it); always when counteracting
    const ceaseless = (performed: string[], counteract = false) => {
      const st = edit(s, (x) => {
        x.firefight.activation = { operativeId: rw, seat: 'A', counteract, stage: 'action', apSpent: 0, performed, declared: null }
      })
      return effectiveRules(st, st.operatives[rw]!, st.data.weapons['wc.w.inferno-boltgun']!, 'shoot', boy).some((r) => r.rule === 'ceaseless')
    }
    expect(ceaseless([])).toBe(true)
    expect(ceaseless(['dash'])).toBe(true)
    expect(ceaseless(['fallBack'])).toBe(true)
    expect(ceaseless(['reposition'])).toBe(false)
    expect(ceaseless(['charge'])).toBe(false)
    expect(ceaseless(['charge'], true)).toBe(true)
    expect(effectiveRules(s, s.operatives[rubricIcon]!, s.data.weapons['wc.w.inferno-boltgun']!, 'shoot', boy).some((r) => r.rule === 'ceaseless')).toBe(false)
    // ---- Savage Brutality: a free Fight after the first Fight of its own activation; no third, nothing when counteracting
    const duel = engaged(s, champ, boy)
    const fought = take(take(activateOp(duel, champ), 'fight').state, boy, dice()).state
    const afterFight = untilMine(play(fought, dice(), strikes, STOP_REACT).state, STOP_REACT)
    // T-WC.16 exact: the Champion's own seat reacts at once (ownReactions), before the opponent's reactions
    expect(afterFight.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { hook: 'reaction', actorId: champ } })
    expect(afterFight.pending!.options!.map((o) => o.data?.hook)).toEqual(['savageBrutality'])
    const second = take(afterFight, 'react:0').state
    expect(second.pending!.kind).toBe('fight.target')
    const secondDone = untilMine(play(take(second, boy, dice()).state, dice(), strikes, STOP_PLOY).state)
    // the free Fight leaves nothing else to do and no third Fight is offered: the activation is over
    expect(secondDone.pending!.kind).toBe('firefight.activate')
    expect(secondDone.operatives[champ]!.ready).toBe(false)
    const cc = take(toCounteract(engaged(s, champ, boy)), `counteract:${champ}`).state
    const ccFought = untilMine(play(take(take(cc, 'fight').state, boy, dice()).state, dice(), strikes, STOP_REACT).state, STOP_REACT)
    expect(ccFought.pending?.kind === 'ability.choice' && ccFought.pending.context.hook === 'reaction' && ccFought.pending.seat === 'A').toBe(false)
    // ---- Brayhorn: 0 AP, +1" Move for friendly Tzaangors until the next Ready step; never a counteraction
    const hg = activateOp(place(s, horn, 0, 0), horn)
    expect(hg.pending!.options!.find((o) => o.id === 'ability:wc.a.brayhorn')!.data?.cost).toBe(0)
    const brayed = take(hg, 'ability:wc.a.brayhorn').state
    expect(brayed.firefight.activation!.apSpent).toBe(0)
    expect(brayed.effects.find((e) => e.source === 'wc.brayhorn')).toMatchObject({ seat: 'A', expires: 'turningPointStart' })
    expect(effectiveMove(brayed.operatives[champ]!, brayed)).toBe(7)
    expect(effectiveMove(brayed.operatives[rw]!, brayed)).toBe(5)
    expect(effectiveMove(s.operatives[champ]!, s)).toBe(6)
    const ch = take(toCounteract(s), `counteract:${horn}`).state
    expect(optionIds(ch)).not.toContain('ability:wc.a.brayhorn')
    // ---- Herd Banner: Normal Dmg 3 or more is 1 lower for a Tzaangor visible to and within 3" of the Icon Bearer, crits are not
    const banner = place(place(s, tzIcon, 0, 0), shieldW, 2.5, 0)
    const hit = (st: GameState, who: string, amount: number, source: string) => {
      const r = withCtx(st, (ctx) => {
        inflict(ctx, { targetId: who, attackerId: boy, weaponId: 'kom.w.choppa', amount, source })
      })
      return st.operatives[who]!.wounds - r.state.operatives[who]!.wounds
    }
    expect(hit(banner, shieldW, 3, 'normal')).toBe(2)
    expect(hit(banner, shieldW, 5, 'strike-normal')).toBe(4)
    expect(hit(banner, shieldW, 2, 'normal')).toBe(2)
    expect(hit(banner, shieldW, 5, 'crit')).toBe(5)
    expect(hit(banner, tzIcon, 3, 'normal')).toBe(2)
    expect(hit(place(banner, shieldW, 5, 0), shieldW, 3, 'normal')).toBe(3)
    expect(hit(banner, rw, 3, 'normal')).toBe(3)
    // ---- Relic Hunters: once per battle, a Tzaangor Warrior in the opponent's territory pays 1 less AP for a marker action
    const terr = territoryOf(s, 'B')!
    const inside = { x: terr.reduce((a, p) => a + p.x, 0) / terr.length, z: terr.reduce((a, p) => a + p.z, 0) / terr.length }
    const hunting = place(place(s, shieldW, inside.x, inside.z), bladesW, inside.x + 4, inside.z)
    expect(providerCostDelta(hunting, hunting.operatives[shieldW]!, 'marker:pickUp')).toBe(-1)
    expect(providerCostDelta(hunting, hunting.operatives[shieldW]!, 'marker:place')).toBe(-1)
    expect(providerCostDelta(hunting, hunting.operatives[shieldW]!, 'ability:core.a.secure')).toBe(-1)
    expect(providerCostDelta(hunting, hunting.operatives[champ]!, 'marker:pickUp')).toBe(0)
    expect(providerCostDelta(place(s, shieldW, 0, 0), s.operatives[shieldW]!, 'marker:pickUp')).toBe(0)
    const spent = withCtx(hunting, (ctx) => {
      runHook('action.ended', { seat: 'A', state: ctx.state, engine: ctx, operativeId: shieldW, data: { action: 'marker:pickUp', counteract: false, free: false, activeSeat: 'A' } })
    }).state
    expect(providerCostDelta(spent, spent.operatives[bladesW]!, 'marker:pickUp')).toBe(0)
    expect(providerCostDelta(spent, spent.operatives[shieldW]!, 'marker:pickUp')).toBe(0)
    // ---- Shield: Save 4+ always, and each block cancels two successes while fighting with the blade & shield
    expect([s.operatives[shieldW]!.save, s.operatives[bladesW]!.save, s.operatives[champ]!.save]).toEqual([4, 5, 5])
    const stub = (weapon: string) => ({ kind: 'fight', operativeId: shieldW, seq: { atk: { seat: 'A', weaponId: weapon }, def: null } }) as unknown as AttackState
    expect(providerBlockCapacity(s, stub('wc.w.tzaangor-blade-and-shield'), 'A', 0)).toBe(2)
    expect(providerBlockCapacity(s, stub('wc.w.tzaangor-blades'), 'A', 0)).toBe(1)
    // in a real fight the shield bearer is offered a block that cancels two of the enemy's successes
    const duelState = bTurn(engaged(s, shieldW, boy), horn)
    const rolled = take(take(activateOp(duelState, boy), 'fight').state, shieldW, dice(4, 4, 4, 1, 6, 4, 1, 1)).state
    let p = play(rolled, dice(), {}, ['fight.resolve', 'firefight.action', 'firefight.activate']).state
    for (let i = 0; i < 4 && p.pending!.kind === 'fight.resolve' && p.pending!.seat === 'B'; i++) p = take(p, p.pending!.options![0]!.id).state
    expect(p.pending!.kind).toBe('fight.resolve')
    expect(p.pending!.seat).toBe('A')
    expect(optionIds(p).some((id) => id.startsWith('block2:'))).toBe(true)
  })

  it('TEAM-WC-025 TEAM-WC-026 TEAM-WC-027 TEAM-WC-028 TEAM-WC-029 TEAM-WC-030 TEAM-WC-031 TEAM-WC-032 TEAM-WC-033 TEAM-WC-034 ploys and equipment', () => {
    const roster = wcRoster([...STD.slice(0, 3), { id: 'wc.rubric-marine-warrior' }, { id: 'wc.tzaangor-champion', weapons: ['wc.w.greataxe'] }, { id: 'wc.tzaangor-warrior', weapons: ['wc.w.autopistol', 'wc.w.chainsword'] }, { id: 'wc.tzaangor-icon-bearer' }])
    const s0 = open({ rosterA: roster })
    const d = A(s0, 'sorcerer-of-destiny')
    const t = A(s0, 'sorcerer-of-tempyrion')
    const f = A(s0, 'sorcerer-of-warpfire')
    const rw = A(s0, 'rubric-marine-warrior')
    const champ = A(s0, 'tzaangor-champion')
    const tzw = A(s0, 'tzaangor-warrior')
    const tzi = A(s0, 'tzaangor-icon-bearer')
    const boy = B(s0, 'boy')
    const nob = B(s0, 'boss-nob')
    const startAct = (st: GameState, id: string): GameState => take(take(st, id).state, 'engage').state
    const flag = (st: GameState, ...sources: string[]): GameState =>
      edit(st, (x) => {
        sources.forEach((source, i) => x.effects.push({ id: `e8${i}`, seat: 'A', kind: 'ployFlag', expires: 'turningPoint', source }))
      })
    const rules = (st: GameState, who: string, w: string, kind: 'shoot' | 'fight', foe: string) => effectiveRules(st, st.operatives[who]!, st.data.weapons[w]!, kind, foe).map((r) => `${r.rule}${r.x ?? ''}${r.crits ? 'c' : ''}`)
    // ---- AETHERIAL WARDING: Piercing 1 against a friendly Warpcoven operative becomes Piercing Crits 1; Piercing 2 is untouched
    const synthetic = withWeapons(s0, ranged('t.p1', {}, [{ rule: 'piercing', x: 1 }]), ranged('t.p2', {}, [{ rule: 'piercing', x: 2 }]), ranged('t.pc', {}, [{ rule: 'piercing', x: 1, crits: true }]))
    const warded = flag(synthetic, 'wc.p.aetherial-warding')
    expect(rules(warded, boy, 't.p1', 'shoot', rw)).toEqual(['piercing1c'])
    expect(rules(warded, boy, 't.p2', 'shoot', rw)).toEqual(['piercing2'])
    expect(rules(warded, boy, 't.pc', 'shoot', rw)).toEqual(['piercing1c'])
    expect(rules(synthetic, boy, 't.p1', 'shoot', rw)).toEqual(['piercing1'])
    // ---- BROTHERHOOD OF SORCERERS: PSYCHIC weapons of a Sorcerer have Balanced, or Ceaseless instead with another Sorcerer within 9"
    const brother = flag(place(place(s0, d, 0, 0), t, 12, 0), 'wc.p.brotherhood-of-sorcerers')
    expect(rules(brother, d, 'wc.w.doombolt', 'shoot', boy)).toContain('balanced')
    expect(rules(brother, d, 'wc.w.doombolt', 'shoot', boy)).not.toContain('ceaseless')
    expect(rules(brother, d, 'wc.w.force-stave', 'fight', boy)).toContain('balanced')
    expect(rules(brother, d, 'wc.w.inferno-bolt-pistol', 'shoot', boy)).not.toContain('balanced')
    const near = flag(place(place(s0, d, 0, 0), t, 8, 0), 'wc.p.brotherhood-of-sorcerers')
    expect(rules(near, d, 'wc.w.doombolt', 'shoot', boy)).toContain('ceaseless')
    expect(rules(near, d, 'wc.w.doombolt', 'shoot', boy)).not.toContain('balanced')
    expect(rules(place(place(s0, d, 0, 0), t, 8, 0), d, 'wc.w.doombolt', 'shoot', boy)).not.toContain('ceaseless')
    // ---- SAVAGE HERD: Accurate 1 on Tzaangor melee; Severe when assisted, or fighting visible to and within 6" of a Sorcerer, but not retaliating on that clause
    const herdBase = flag(place(place(s0, champ, 0, 0), boy, 1.4, 0), 'wc.p.savage-herd')
    const lone = herdBase
    expect(rules(lone, champ, 'wc.w.greataxe', 'fight', boy)).toEqual(expect.arrayContaining(['accurate1']))
    expect(rules(lone, champ, 'wc.w.greataxe', 'fight', boy)).not.toContain('severe')
    expect(rules(s0, champ, 'wc.w.greataxe', 'fight', boy)).not.toContain('accurate1')
    const withSorcerer = place(herdBase, d, -3, 0)
    expect(rules(withSorcerer, champ, 'wc.w.greataxe', 'fight', boy)).toContain('severe')
    const retaliating = edit(withSorcerer, (x) => {
      x.attack = { kind: 'fight', operativeId: boy } as never
    })
    expect(rules(retaliating, champ, 'wc.w.greataxe', 'fight', boy)).not.toContain('severe')
    const assisted = place(herdBase, tzi, 1.4, 1.3)
    expect(rules(assisted, champ, 'wc.w.greataxe', 'fight', boy)).toContain('severe')
    expect(rules(edit(assisted, (x) => (x.attack = { kind: 'fight', operativeId: boy } as never)), champ, 'wc.w.greataxe', 'fight', boy)).toContain('severe')
    expect(rules(withSorcerer, rw, 'wc.w.fists', 'fight', boy)).not.toContain('accurate1')
    // ---- FATE ITSELF IS MY WEAPON: two public dice; one replaces an attack die before re-rolls and cannot be changed; the second survives only when the pair summed to 9+
    const fate = (dice2: number[]) =>
      edit(place(place(s0, d, 0, 0), boy, 5, 0), (x) => {
        x.effects.push({ id: 'e70', seat: 'A', kind: 'ployFlag', expires: 'turningPoint', source: 'wc.fate', data: { dice: dice2, sum: dice2[0]! + dice2[1]!, spent: [] } })
      })
    const toWindow = (st: GameState) => take(take(take(activateOp(st, d), 'shoot').state, 'wc.w.doombolt').state, boy, dice(1, 1, 1, 1)).state
    const w1 = toWindow(fate([6, 2]))
    expect(w1.pending).toMatchObject({ kind: 'ploy.firefight', window: 'shoot.beforeAttackRerolls', seat: 'A' })
    expect(optionIds(w1)).toEqual(expect.arrayContaining(['wc.a.fate-reserve:0:a:1', 'wc.a.fate-reserve:1:a:1']))
    const used1 = take(w1, 'wc.a.fate-reserve:0:a:1').state
    const die = used1.attack!.seq!.atk.dice.find((x) => x.tag === 'wc.fate')!
    expect(die).toMatchObject({ value: 6, kind: 'crit', rerolled: true })
    // 6 + 2 = 8 < 9: the other die is gone after the first use; only one die per sequence anyway
    expect(used1.effects.find((e) => e.source === 'wc.fate')!.data!.dice).toEqual([])
    expect(used1.pending?.kind === 'ploy.firefight' ? optionIds(used1).filter((id) => id.startsWith('wc.a.fate-reserve')) : []).toEqual([])
    const w2 = toWindow(fate([6, 4]))
    const used2 = take(w2, 'wc.a.fate-reserve:1:a:1').state
    expect(used2.attack!.seq!.atk.dice.find((x) => x.tag === 'wc.fate')).toMatchObject({ value: 4, kind: 'normal' })
    expect(used2.effects.find((e) => e.source === 'wc.fate')!.data!.dice).toEqual([6])
    expect(used2.pending?.kind === 'ploy.firefight' ? optionIds(used2).filter((id) => id.startsWith('wc.a.fate-reserve')) : []).toEqual([])
    // a tagged die is not rewritten by Rending / Punishing: the reclassification keeps its kind
    const kept = used1.attack!.seq!.atk
    reclassify(kept)
    expect(kept.dice.find((x) => x.tag === 'wc.fate')!.kind).toBe('crit')
    // the ploy itself rolls two public dice
    const played = take(toGambit({ rosterA: roster }), 'wc.p.fate-itself-is-my-weapon', dice(5, 2)).state
    expect(played.effects.find((e) => e.source === 'wc.fate')!.data).toMatchObject({ dice: [5, 2], sum: 7 })
    // ---- ALL IS DUST: the first normal success that damages a Rubric Marine does 1, in a fight and in shooting; crits untouched
    const duel = bTurn(engaged(s0, rw, boy), champ)
    const fightWith = (ploy: boolean) =>
      play(take(take(activateOp(duel, boy), 'fight').state, rw, dice(4, 4, 4, 4, 1, 1, 1, 1)).state, dice(), { ...strikes, ...takePloy(ploy ? 'wc.p.all-is-dust' : 'none') }).state
    expect(fightWith(true).operatives[rw]!.wounds).toBe(14 - 13)
    expect(fightWith(false).operatives[rw]!.status).toBe('removed')
    const gun = bTurn(place(place(s0, rw, 0, 0), boy, 5, 0), champ)
    const shootWith2 = (ploy: boolean) =>
      play(take(take(take(activateOp(gun, boy), 'shoot').state, 'kom.w.slugga').state, rw, dice(4, 4, 4, 4, 1, 1, 1)).state, dice(), takePloy(ploy ? 'wc.p.all-is-dust' : 'none')).state
    expect(shootWith2(true).operatives[rw]!.wounds).toBe(14 - 10)
    expect(shootWith2(false).operatives[rw]!.wounds).toBe(14 - 12)
    // ---- CAPRICIOUS PLAN: at a Sorcerer's activation end a free Dash (even after a Charge) and/or an order change; not after a counteraction
    const cap = edit(place(s0, d, 0, 0), (x) => {
      x.firefight.activation = { operativeId: d, seat: 'A', counteract: false, stage: 'action', apSpent: 1, performed: ['charge'], declared: null }
    })
    const capInfo = { window: 'firefight.activationEnded', subjectId: d, counteracting: false }
    const capOffers = offersFor(cap, 'A', 'firefight.activationEnded', capInfo).filter((o) => o.ployId === 'wc.p.capricious-plan').map((o) => o.param)
    expect(capOffers).toEqual(['dash', 'order', 'both'])
    expect(offersFor(cap, 'A', 'firefight.activationEnded', { ...capInfo, counteracting: true }).some((o) => o.ployId === 'wc.p.capricious-plan')).toBe(false)
    const both = withCtx(cap, (ctx) => usePloy(ctx, 'A', offersFor(cap, 'A', 'firefight.activationEnded', capInfo).find((o) => o.param === 'both')!, capInfo)).state
    expect(both.operatives[d]!.order).not.toBe(cap.operatives[d]!.order)
    expect(both.pending!.kind).toBe('move.path')
    expect(both.firefight.activation!.frame).toBeTruthy()
    // the window really opens when the Sorcerer ends its activation
    const ended = take(activateOp(place(s0, d, 0, 0), d), 'end').state
    expect(ended.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.activationEnded', seat: 'A' })
    const flipped = take(ended, 'wc.p.capricious-plan:order').state
    expect(flipped.operatives[d]!.order).toBe('conceal')
    // ---- PSYCHIC CABAL: lend a PSYCHIC weapon or action of a Sorcerer within 9" for one activation
    const cabal = place(place(s0, d, 0, 0), t, 4, 0)
    const start = startAct(cabal, t)
    expect(optionIds(start)).toEqual(expect.arrayContaining([`wc.p.psychic-cabal:${d}:w:wc.w.doombolt`, `wc.p.psychic-cabal:${d}:a:wc.a.protected-by-fate`, `wc.p.psychic-cabal:${d}:a:wc.a.ravage-destiny`]))
    expect(optionIds(start).some((id) => id.includes(`:${f}:`))).toBe(false)
    const lent = take(start, `wc.p.psychic-cabal:${d}:w:wc.w.doombolt`).state
    expect(lent.operatives[t]!.weapons).toContain('wc.w.doombolt')
    expect(providerWeaponForbidden(lent, lent.operatives[d]!, 'wc.w.doombolt', 'shoot')).toMatch(/lent/)
    expect(rules(lent, t, 'wc.w.doombolt', 'shoot', boy)).toEqual(['psychic', 'devastating2', 'lethal'])
    const over = withCtx(lent, (ctx) => {
      runHook('activation.end', { seat: 'A', state: ctx.state, engine: ctx, operativeId: t, data: { counteract: false } })
    }).state
    expect(over.operatives[t]!.weapons).not.toContain('wc.w.doombolt')
    expect(providerWeaponForbidden(over, over.operatives[d]!, 'wc.w.doombolt', 'shoot')).toMatch(/lent/)
    // a weapon the lender used this turning point cannot be picked
    const usedBefore = edit(cabal, (x) => {
      x.ledger.A.tp.push(`wc.used:${d}:wc.w.doombolt`)
    })
    expect(optionIds(startAct(usedBefore, t)).some((id) => id.endsWith(':w:wc.w.doombolt'))).toBe(false)
    // a borrowed action is performed by the borrower; the lender's boon never travels with the weapon
    const borrowed = take(start, `wc.p.psychic-cabal:${d}:a:wc.a.protected-by-fate`).state
    expect(optionIds(borrowed).some((id) => id.startsWith(`ability:wc.a.protected-by-fate:${rw}`))).toBe(true)
    const asked = open({ rosterA: wcRoster(STD.map((x, i): Spec => (i === 0 ? { ...x, boon: 'ASTRAL BOMBARDMENT' } : i === 1 ? { ...x, boon: 'TWIST OF FATE' } : x))) })
    const withBoons = edit(asked, (x) => (x.operatives[A(asked, 'sorcerer-of-tempyrion')]!.weapons = [...x.operatives[A(asked, 'sorcerer-of-tempyrion')]!.weapons, 'wc.w.doombolt']))
    const tt = A(asked, 'sorcerer-of-tempyrion')
    // Twist of Fate (the borrower's) applies; Astral Bombardment (the lender's) does not come with the weapon
    expect(rules(withBoons, tt, 'wc.w.doombolt', 'shoot', B(asked, 'boy'))).toEqual(['psychic', 'devastating2', 'lethal', 'piercing1c'])
    expect(effectiveRules(withBoons, withBoons.operatives[tt]!, withBoons.data.weapons['wc.w.doombolt']!, 'shoot', B(asked, 'boy')).find((r) => r.rule === 'devastating')!.inches).toBeUndefined()
    // ---- MUTANT HERD: a second ready Tzaangor within 2" activates with the first
    const herd = place(place(s0, champ, 0, 0), tzw, 1.5, 0)
    const hs = startAct(herd, champ)
    expect(optionIds(hs)).toEqual(expect.arrayContaining([`wc.p.mutant-herd:${tzw}:engage`, `wc.p.mutant-herd:${tzw}:conceal`]))
    expect(optionIds(startAct(place(herd, tzw, 6, 0), champ)).some((id) => id.startsWith('wc.p.mutant-herd'))).toBe(false)
    const joint = take(hs, `wc.p.mutant-herd:${tzw}:engage`).state
    expect(joint.firefight.activation!.partner!.operativeId).toBe(tzw)
    expect(joint.operatives[tzw]!.ready).toBe(false)
    // ---- ENSORCELLED ROUNDS and DAEMONMAW WEAPONS
    const geared = open({ rosterA: roster, equipmentA: ['wc.e.ensorcelled-rounds', 'wc.e.daemonmaw-weapons'] })
    const bare = open({ rosterA: roster })
    const dev = (st: GameState, who: string, w: string) => rules(st, who, w, 'shoot', boy).filter((x) => x.startsWith('devastating'))
    expect(dev(geared, A(geared, 'rubric-marine-warrior'), 'wc.w.inferno-boltgun')).toEqual(['devastating1'])
    expect(dev(geared, A(geared, 'sorcerer-of-destiny'), 'wc.w.inferno-bolt-pistol')).toEqual(['devastating1'])
    expect(dev(geared, A(geared, 'tzaangor-warrior'), 'wc.w.autopistol')).toEqual(['devastating1'])
    expect(dev(geared, A(geared, 'sorcerer-of-destiny'), 'wc.w.warpflame-pistol')).toEqual([])
    expect(dev(bare, A(bare, 'rubric-marine-warrior'), 'wc.w.inferno-boltgun')).toEqual([])
    const atk = (st: GameState, who: string, w: string) => attackStats(st, who, w, boy, { kind: 'fight' }).atk
    expect(atk(geared, A(geared, 'rubric-marine-warrior'), 'wc.w.fists')).toBe(4)
    expect(atk(bare, A(bare, 'rubric-marine-warrior'), 'wc.w.fists')).toBe(3)
    expect(atk(geared, A(geared, 'tzaangor-champion'), 'wc.w.greataxe')).toBe(4)
    const retal = edit(geared, (x) => (x.attack = { kind: 'fight', operativeId: boy } as never))
    const rwG = A(geared, 'rubric-marine-warrior')
    expect(rules(retal, rwG, 'wc.w.fists', 'fight', boy)).toContain('accurate1')
    expect(rules(geared, rwG, 'wc.w.fists', 'fight', boy)).not.toContain('accurate1')
    // ---- ARCANE ROBES: once per turning point the first Critical Dmg above Normal Dmg on a Sorcerer is Normal Dmg
    const robed = open({ rosterA: roster, equipmentA: ['wc.e.arcane-robes'] })
    const dd = A(robed, 'sorcerer-of-destiny')
    const crit = (st: GameState, source = 'crit') => {
      const r = withCtx(st, (ctx) => {
        inflict(ctx, { targetId: dd, attackerId: B(robed, 'boy'), weaponId: 'kom.w.slugga', amount: 4, source })
      })
      return { dealt: st.operatives[dd]!.wounds - r.state.operatives[dd]!.wounds, state: r.state }
    }
    const first = crit(robed)
    expect(first.dealt).toBe(3)
    expect(crit(first.state).dealt).toBe(4)
    expect(crit(robed, 'devastating').dealt).toBe(4)
    expect(crit(open({ rosterA: roster }), 'crit').dealt).toBe(4)
    // a weapon whose Critical Dmg is not higher than Normal Dmg (the doombolt, 4/2) does not spend it, nor does a normal success
    const flat = withCtx(robed, (ctx) => {
      inflict(ctx, { targetId: dd, attackerId: B(robed, 'boy'), weaponId: 'wc.w.doombolt', amount: 2, source: 'crit' })
      inflict(ctx, { targetId: dd, attackerId: B(robed, 'boy'), weaponId: 'kom.w.slugga', amount: 3, source: 'normal' })
    }).state
    expect(crit(flat).dealt).toBe(3)
    // ---- SORCEROUS SCROLLS: once per battle swap a Sorcerer's boon for one no other friendly operative has
    const scrolled = open({ rosterA: roster, equipmentA: ['wc.e.sorcerous-scrolls'] })
    const sd = A(scrolled, 'sorcerer-of-destiny')
    const sg = take(take(scrolled, sd).state, 'engage').state
    const boons = new Set(optionIds(sg).filter((id) => id.startsWith('wc.e.sorcerous-scrolls:')).map((id) => id.split(':')[1]))
    const ALL = ['INCORPOREAL SIGHT', 'TIME-WALK', 'ECHOES FROM THE WARP', 'WARP SWELL', 'MUTANT APPENDAGE', 'IMMATERIAL FLIGHT', 'TWIST OF FATE', 'ASTRAL BOMBARDMENT', 'MASTER OF THE IMMATERIUM']
    const held = ['sorcerer-of-destiny', 'sorcerer-of-tempyrion', 'sorcerer-of-warpfire'].map((c) => scrolled.operatives[A(scrolled, c)]!.picks!.boon!)
    expect([...boons].sort()).toEqual(ALL.filter((x) => !held.includes(x)).sort())
    const swapped = take(sg, 'wc.e.sorcerous-scrolls:ECHOES FROM THE WARP').state
    expect(swapped.operatives[sd]!.picks!.boon).toBe('ECHOES FROM THE WARP')
    expect(swapped.ledger.A.battle).toContain('wc.scrolls')
    expect(optionIds(swapped).some((id) => id.startsWith('wc.e.sorcerous-scrolls'))).toBe(false)
    // a boon only an incapacitated Sorcerer held may be taken again
    const tf = scrolled.operatives[A(scrolled, 'sorcerer-of-warpfire')]!.picks!.boon!
    const gone = edit(scrolled, (x) => {
      x.operatives[A(scrolled, 'sorcerer-of-warpfire')]!.status = 'removed'
    })
    expect(pickAlternatives(gone, gone.operatives[sd]!, 'boon')).toContain(tf)
    expect(pickAlternatives(scrolled, scrolled.operatives[sd]!, 'boon')).not.toContain(tf)
    // picking Echoes at a counteraction lets it be used in that same counteraction
    const cs = take(toCounteract(scrolled), `counteract:${sd}`).state
    const echo = take(cs, 'wc.e.sorcerous-scrolls:ECHOES FROM THE WARP').state
    expect(optionIds(echo)).toEqual(expect.arrayContaining(['wc.a.boon-echoes-from-the-warp:keep']))
  })

  it("TEAM-WC-033 Fate Itself is My Weapon on the opponent's Shoot: the defender replaces a fresh attack die before any attack re-roll (shoot.defenderAttackRolled)", () => {
    const s0 = open()
    const d = A(s0, 'sorcerer-of-destiny')
    const champ = A(s0, 'tzaangor-champion')
    const boy = B(s0, 'boy')
    const held = edit(place(place(s0, d, 0, 0), boy, 5, 0), (x) => {
      x.effects.push({ id: 'e71', seat: 'A', kind: 'ployFlag', expires: 'turningPoint', source: 'wc.fate', data: { dice: [1, 2], sum: 3, spent: [] } })
    })
    const shot = take(take(take(activateOp(bTurn(held, champ), boy), 'shoot').state, 'kom.w.slugga').state, d, dice(6, 6, 6, 6)).state
    // the shooter's own window first (passed), then the Warpcoven defender on the fresh roll
    let w = shot
    for (let i = 0; i < 6 && !(w.pending?.kind === 'ploy.firefight' && w.pending.window === 'shoot.defenderAttackRolled'); i++) w = play(passIt(w, dice()).state, dice(), {}, STOP_PLOY).state
    expect(w.pending).toMatchObject({ kind: 'ploy.firefight', window: 'shoot.defenderAttackRolled', seat: 'A' })
    expect(w.attack!.seq!.atk.dice.every((x) => !x.rerolled)).toBe(true)
    expect(optionIds(w)).toEqual(expect.arrayContaining(['wc.a.fate-reserve:0:a:6', 'wc.a.fate-reserve:1:a:6']))
    const used = take(w, 'wc.a.fate-reserve:0:a:6').state
    const die = used.attack!.seq!.atk.dice.find((x) => x.tag === 'wc.fate')!
    expect(die).toMatchObject({ value: 1, kind: 'fail', rerolled: true })
    expect(used.attack!.seq!.atk.dice.filter((x) => x.value === 6)).toHaveLength(used.attack!.seq!.atk.dice.length - 1)
    // 1 + 2 < 9: the pair is spent
    expect(used.effects.find((e) => e.source === 'wc.fate')!.data!.dice).toEqual([])
  })

  it('TEAM-WC-016 TEAM-WC-023 TEAM-WC-028 TEAM-WC-030 verification fixes: Flux on the Tempyrion itself, Flux before a Capricious Dash, Relic Hunters never in a counteraction, Savage Herd sight from the Sorcerer', () => {
    const s = open({ rosterA: wcRoster([...STD, { id: 'wc.tzaangor-warrior' }]) })
    const d = A(s, 'sorcerer-of-destiny')
    const t = A(s, 'sorcerer-of-tempyrion')
    const champ = A(s, 'tzaangor-champion')
    const tzw = A(s, 'tzaangor-warrior')
    const boy = B(s, 'boy')
    // ---- Temporal Flux on itself: the activation it was placed in does not count, the following one does
    const g = activateOp(place(s, t, 0, 0), t)
    const fl = take(g, g.pending!.options!.find((o) => o.id.startsWith(`ability:wc.a.temporal-flux:${t}@`))!.id).state
    const marker = fl.markers.find((k) => k.equipmentId === 'wc.flux')!
    const endOf = (st: GameState) =>
      withCtx(st, (ctx) => {
        runHook('activation.end', { seat: 'A', state: ctx.state, engine: ctx, operativeId: t, data: { counteract: false } })
      }).state
    const first = endOf(fl)
    expect(first.markers.some((k) => k.equipmentId === 'wc.flux')).toBe(true)
    expect(first.effects.some((e) => e.source === 'wc.flux')).toBe(true)
    expect(first.operatives[t]!.pos).toEqual(fl.operatives[t]!.pos)
    const capInfo = { window: 'firefight.activationEnded', subjectId: t, counteracting: false }
    const capParams = (st: GameState) => offersFor(st, 'A', 'firefight.activationEnded', capInfo).filter((o) => o.ployId === 'wc.p.capricious-plan').map((o) => o.param)
    // no Flux-first option in the activation the marker went down
    expect(capParams(fl)).toEqual(['dash', 'order', 'both'])
    // ---- the next activation: it moved 4" off; Temporal Flux and Capricious Plan both trigger, the player orders them
    const later = edit(first, (x) => {
      x.operatives[t]!.pos = { x: marker.pos.x + 4, y: 0, z: marker.pos.z }
      x.firefight.activation = { operativeId: t, seat: 'A', counteract: false, stage: 'action', apSpent: 2, performed: ['reposition'], declared: null }
    })
    expect(capParams(later)).toEqual(['dash', 'order', 'both', 'flux-dash', 'flux-both'])
    const use = (param: string) => withCtx(later, (ctx) => usePloy(ctx, 'A', offersFor(later, 'A', 'firefight.activationEnded', capInfo).find((o) => o.param === param)!, capInfo)).state
    const fluxFirst = use('flux-dash')
    expect(Math.hypot(fluxFirst.operatives[t]!.pos.x - marker.pos.x, fluxFirst.operatives[t]!.pos.z - marker.pos.z)).toBeLessThan(1.5)
    expect(fluxFirst.markers.some((k) => k.equipmentId === 'wc.flux')).toBe(false)
    expect(fluxFirst.effects.some((e) => e.source === 'wc.flux')).toBe(false)
    expect(fluxFirst.pending!.kind).toBe('move.path')
    const flipped = use('flux-both')
    expect(flipped.operatives[t]!.order).not.toBe(later.operatives[t]!.order)
    // Dash first: the Flux waits for the activation.end hook
    const dashFirst = use('dash')
    expect(dashFirst.effects.some((e) => e.source === 'wc.flux')).toBe(true)
    expect(dashFirst.operatives[t]!.pos.x).toBeCloseTo(marker.pos.x + 4)
    // ---- Relic Hunters: a counteraction neither gets the discount (it would make the action 0 AP) nor spends it
    const terr = territoryOf(s, 'B')!
    const inside = { x: terr.reduce((a, p) => a + p.x, 0) / terr.length, z: terr.reduce((a, p) => a + p.z, 0) / terr.length }
    const hunting = place(s, tzw, inside.x, inside.z)
    const counter = edit(hunting, (x) => {
      x.firefight.activation = { operativeId: tzw, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }
    })
    expect(providerCostDelta(hunting, hunting.operatives[tzw]!, 'marker:pickUp')).toBe(-1)
    expect(providerCostDelta(counter, counter.operatives[tzw]!, 'marker:pickUp')).toBe(0)
    const afterCounter = withCtx(counter, (ctx) => {
      runHook('action.ended', { seat: 'A', state: ctx.state, engine: ctx, operativeId: tzw, data: { action: 'marker:pickUp', counteract: true, free: false, activeSeat: 'A' } })
    }).state
    expect(afterCounter.ledger.A.battle).not.toContain('wc.relic')
    // ---- Savage Herd: the Tzaangor must be visible to the Sorcerer (the Sorcerer's line of sight, not the Tzaangor's)
    const herd = (wallX: number) =>
      edit(place(place(place(s, champ, 0, 0), d, 4, 0), boy, -1.4, 0), (x) => {
        x.effects.push({ id: 'e91', seat: 'A', kind: 'ployFlag', expires: 'turningPoint', source: 'wc.p.savage-herd' })
        x.map = { ...x.map, features: [feature('wc-test-wall', part('wc-test-wall.a', rect(wallX, wallX + 0.1, -3, 3), 1.45, ['heavy']))] }
      })
    const severe = (st: GameState) => effectiveRules(st, st.operatives[champ]!, st.data.weapons['wc.w.greataxe']!, 'fight', boy).some((r) => r.rule === 'severe')
    const nearTz = herd(0.8)
    expect(visible(nearTz, bodyOf(nearTz.operatives[d]!), bodyOf(nearTz.operatives[champ]!))).toBe(true)
    expect(visible(nearTz, bodyOf(nearTz.operatives[champ]!), bodyOf(nearTz.operatives[d]!))).toBe(false)
    expect(severe(nearTz)).toBe(true)
    const nearSo = herd(3.1)
    expect(visible(nearSo, bodyOf(nearSo.operatives[d]!), bodyOf(nearSo.operatives[champ]!))).toBe(false)
    expect(visible(nearSo, bodyOf(nearSo.operatives[champ]!), bodyOf(nearSo.operatives[d]!))).toBe(true)
    expect(severe(nearSo)).toBe(false)
  })
})
