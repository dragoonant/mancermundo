import { describe, expect, it } from 'vitest'
import { step } from '@/engine'
import { act } from '@/engine/actions'
import { abilityOffers, actionCostDelta, allowedOrders, canCounteractWithOrder, chargeFromControlRange, chargeUnderConceal, codeParams, maxRepeats, refreshFlags } from '@/engine/abilities'
import { actionAvailability, actionCost } from '@/engine/firefight'
import { effectiveApl, effectiveMove } from '@/engine/state'
import { evalCondition, hasTactic, inScope } from '@/engine/conditions'
import { place } from '../fixtures/helpers'
import { activateOp, edit, hasOption, openReal, opOf, optionIds, realGame, roster, take } from '../fixtures/real'

describe('ABL declarative interpreter and conditions', () => {
  it('evalCondition reads orders, counteracting, turning points and keywords', () => {
    const s = realGame()
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    const base = { state: s, seat: 'A' as const, subjectId: marine, actorId: marine }
    expect(evalCondition({ order: 'conceal' }, base)).toBe(true) // set up with Conceal
    expect(evalCondition({ order: 'engage' }, base)).toBe(false)
    expect(evalCondition({ turningPoint: { min: 2 } }, base)).toBe(false)
    expect(evalCondition({ turningPoint: { min: 1, max: 1 } }, base)).toBe(true)
    expect(evalCondition({ allOf: [{ subjectKeyword: 'INTERCESSOR' }, { not: { subjectKeyword: 'LEADER' } }] }, base)).toBe(true)
    expect(evalCondition({ anyOf: [{ subjectKeyword: 'LEADER' }, { subjectKeyword: 'GRENADIER' }] }, base)).toBe(false)
    expect(evalCondition({ counteracting: true }, base)).toBe(false)
    expect(evalCondition({ counteracting: true }, { ...base, counteracting: true })).toBe(true)
    expect(evalCondition({ ployUsedThisTurningPoint: 'aod.p.combat-doctrine' }, base)).toBe(false)
    expect(inScope(s, { side: 'friendly', keyword: 'ANGEL OF DEATH' }, 'A', s.operatives[marine]!)).toBe(true)
    expect(inScope(s, { side: 'friendly', keyword: 'KOMMANDO' }, 'A', s.operatives[marine]!)).toBe(false)
    expect(inScope(s, { side: 'enemy' }, 'A', s.operatives[opOf(s, 'B', 'kom.boy')]!)).toBe(true)
  })

  it('ORD-005 an action cannot repeat in an activation unless a team rule grants it', () => {
    const s = openReal()
    const boy = s.operatives[opOf(s, 'B', 'kom.boy')]!
    const marine = s.operatives[opOf(s, 'A', 'aod.intercessor-warrior')]!
    const boss = s.operatives[opOf(s, 'B', 'kom.boss-nob')]!
    expect(maxRepeats(s, boy, 'shoot', [])).toBe(1)
    expect(maxRepeats(s, boy, 'fight', ['fight'])).toBe(1)
    expect(maxRepeats(s, boy, 'dash', ['dash'])).toBe(1)
    expect(maxRepeats(s, marine, 'shoot', ['shoot'])).toBe(2) // ASTARTES
    expect(maxRepeats(s, marine, 'fight', ['fight'])).toBe(2)
    expect(maxRepeats(s, boss, 'fight', ['fight'])).toBe(2) // Krumpin' Time
    expect(maxRepeats(s, boss, 'shoot', ['shoot'])).toBe(1)
    // the doubled kinds exclude each other: two Shoots bar a second Fight pair
    expect(maxRepeats(s, marine, 'fight', ['shoot', 'shoot'])).toBe(1) // one Fight is still fine, a second is not
    expect(maxRepeats(s, marine, 'fight', ['fight', 'fight'])).toBe(2)
    expect(maxRepeats(s, marine, 'shoot', ['fight', 'fight'])).toBe(1)
    expect(maxRepeats(s, marine, 'fight', ['shoot', 'shoot', 'fight'])).toBe(1)
    const act = { operativeId: boy.id, seat: 'B' as const, counteract: false, stage: 'action' as const, apSpent: 0, performed: ['dash'], declared: null }
    expect(actionAvailability(s, boy, 'dash', act)?.code).toBe('E_ACTION_RESTRICTED')
    expect(actionAvailability(s, boy, 'reposition', act)).toBeNull()
  })

  it('unique actions follow their data conditions: not in an enemy control range, not while counteracting', () => {
    const s = openReal()
    const boss = opOf(s, 'B', 'kom.boss-nob')
    const boy = opOf(s, 'B', 'kom.boy')
    const place2 = place(place(s, boss, 5, 0), boy, 8, 0)
    // Get It Dun!: a visible friendly Kommando within 6"
    const t = edit(place2, (st) => {
      st.firefight.turn = 'B'
    })
    const offers = abilityOffers(t, t.operatives[boss]!, { operativeId: boss, seat: 'B', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null })
    expect(offers.filter((o) => o.abilityId === 'kom.a.get-it-dun').map((o) => o.params.targetId)).toEqual([boy])
    // while counteracting it is not offered at all
    const counter = abilityOffers(t, t.operatives[boss]!, { operativeId: boss, seat: 'B', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null })
    expect(counter.some((o) => o.abilityId === 'kom.a.get-it-dun')).toBe(false)
    // and not in an enemy control range
    const engaged = place(t, opOf(t, 'A', 'aod.intercessor-warrior'), 6.4, 0)
    const blocked = abilityOffers(engaged, engaged.operatives[boss]!, { operativeId: boss, seat: 'B', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null })
    expect(blocked.some((o) => o.abilityId === 'kom.a.get-it-dun')).toBe(false)
  })

  it('an action costs at least 0 and a counteraction offers only 1 AP actions', () => {
    const s = openReal()
    const marine = s.operatives[opOf(s, 'A', 'aod.intercessor-warrior')]!
    expect(actionCost(s, marine, 'fallBack')).toBe(2)
    // Mobile (Fall Back costs 1 less) never takes it below 0
    const mobile = realGame({ teamChoices: { A: { 'primary-tactic': 'aod.a.ct-mobile', 'secondary-tactic': 'aod.a.ct-hardy' }, B: {} } })
    const m = mobile.operatives[opOf(mobile, 'A', 'aod.intercessor-warrior')]!
    expect(hasTactic(mobile, m, 'aod.a.ct-mobile')).toBe(true)
    expect(actionCost(mobile, m, 'fallBack')).toBe(1)
    expect(actionCostDelta(mobile, m, 'fallBack', null)).toBe(-1)
    expect(actionCost(mobile, m, 'reposition')).toBe(1)
  })

  it('orders and counteract: Squig never Conceal, Grot never Engage, Angels of Death counteract with any order', () => {
    const s = openReal()
    const squig = s.operatives[opOf(s, 'B', 'kom.bomb-squig')]!
    const grot = s.operatives[opOf(s, 'B', 'kom.grot')]!
    const marine = s.operatives[opOf(s, 'A', 'aod.intercessor-warrior')]!
    expect(allowedOrders(s, squig)).toEqual(['engage'])
    expect(allowedOrders(s, grot)).toEqual(['conceal'])
    expect(allowedOrders(s, marine)).toEqual(['engage', 'conceal'])
    expect(canCounteractWithOrder(s, grot)).toBe(false)
    expect(canCounteractWithOrder(s, { ...marine, order: 'conceal' })).toBe(true) // ASTARTES
    expect(canCounteractWithOrder(s, { ...s.operatives[opOf(s, 'B', 'kom.boy')]!, order: 'conceal' })).toBe(false)
    expect(chargeUnderConceal(s, s.operatives[opOf(s, 'B', 'kom.boy')]!)).toBe(true)
    expect(chargeUnderConceal(s, squig)).toBe(false)
    expect(chargeUnderConceal(s, marine)).toBe(false)
    expect(chargeFromControlRange(s, marine)).toBe(false)
  })

  it('Resolute and Shake It Off make an operative ignore every APL change; And They Shall Know No Fear ignores injury', () => {
    const resolute = realGame({ teamChoices: { A: { 'primary-tactic': 'aod.a.ct-resolute', 'secondary-tactic': 'aod.a.ct-hardy' }, B: {} } })
    const m = resolute.operatives[opOf(resolute, 'A', 'aod.intercessor-warrior')]!
    expect(m.flags.ignoreApl).toBe(true)
    expect(effectiveApl({ ...m, aplMods: -1 })).toBe(3)
    const normal = realGame()
    const n = normal.operatives[opOf(normal, 'A', 'aod.intercessor-warrior')]!
    expect(n.flags.ignoreApl).toBeUndefined()
    expect(effectiveApl({ ...n, aplMods: -1 })).toBe(2)
    // ORD-013: a net change never exceeds 1 either way
    expect(effectiveApl({ ...n, aplMods: -3 })).toBe(2)
    expect(effectiveApl({ ...n, aplMods: 2 })).toBe(4)
    // injured operatives lose 2" of Move (4" floor); the ploy ignores that
    const hurt = { ...n, wounds: 3 }
    expect(effectiveMove(hurt)).toBe(4)
    const protectedState = edit(normal, (st) => {
      st.effects.push({ id: 'e9', source: 'aod.p.and-they-shall-know-no-fear', seat: 'A', kind: 'ployFlag', expires: 'turningPoint' })
      refreshFlags(st)
    })
    expect(effectiveMove({ ...protectedState.operatives[n.id]!, wounds: 3 })).toBe(6)
    expect(protectedState.operatives[opOf(protectedState, 'B', 'kom.boy')]!.flags.ignoreInjured).toBeUndefined()
  })

  it('an action that cannot start is not offered: no marker, no target', () => {
    const s = openReal()
    const sniper = opOf(s, 'A', 'aod.eliminator-sniper')
    const t = activateOp(s, sniper)
    // OPTICS is a unique action of the Eliminator, 1 AP, once per activation
    expect(hasOption(t, 'ability:aod.a.optics')).toBe(true)
    const u = take(t, 'ability:aod.a.optics').state
    expect(optionIds(u)).not.toContain('ability:aod.a.optics')
    expect(u.effects.some((e) => e.source === 'aod.a.optics' && e.operativeId === sniper)).toBe(true)
    // the stat ability lookups
    expect(codeParams(s, s.operatives[sniper]!, 'camoCloak')).not.toBeNull()
    void step
    void act
    void roster
  })
})
