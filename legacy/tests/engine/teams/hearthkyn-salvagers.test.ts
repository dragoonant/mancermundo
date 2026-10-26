// hearthkyn-salvagers engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-HK-nnn).
// Hearthkyn Salvagers are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { step, view } from '@/engine'
import { act } from '@/engine/actions'
import { abilityOffers } from '@/engine/abilities'
import { attackStats, defenceStats, effectiveRules, inflict, parseRules, runDeferredRemovals, validTargets } from '@/engine/attack-common'
import { APL_NEXT_FX, applyDeferredApl, queueRemoval, usedThisTp, markUsedTp } from '@/engine/effects'
import { equipmentLimitFor } from '@/engine/equipment'
import { runHook } from '@/engine/hooks'
import { planFly, planMove } from '@/engine/movement'
import { gambitOffers, offersFor, usePloy } from '@/engine/ploys'
import { expectedDamage, markerControl } from '@/engine/query'
import { ScriptedRng } from '@/engine/rng'
import { effectiveApl, effectiveMove } from '@/engine/state'
import { providerCostDelta, providerInitiativeReroll, providerMoveSurcharge, providerReactions } from '@/engine/team-rules'
import { TEAM_ID, beamSets, grudgeCount, GRUDGE, JAM } from '@/engine/teams/hearthkyn-salvagers'
import { tokenCount, tokensOnTurningPointEnd } from '@/engine/tokens'
import type { GameState } from '@/engine/types'
import { loadBundle, validateLoadout, validateRoster, type DatacardData } from '../../../src/data'
import { play } from '../../fixtures/attack'
import { drive, expectOk, place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { activateOp, edit, optionIds, realBundle, roster as realRoster, take, withCtx } from '../../fixtures/real'
import {
  A,
  ALL_HK,
  B,
  bTurn,
  dice,
  engageStart,
  engageWindow,
  go,
  hkOpen,
  lastRetained,
  ruleKill,
  shootAt,
  sturdyShot,
  toGambit,
  wall,
  withEffect,
  withGrudge,
  withTerrain,
  worthItOffer,
  writOffer,
  writReroll,
} from './hearthkyn-salvagers.hooks'

const data = loadBundle()
const team = data.teams['hearthkyn-salvagers']!
const cards = realBundle.datacards as unknown as Record<string, DatacardData>
const evs = (events: { type: string }[], type: string) => events.filter((e) => e.type === type) as unknown as Record<string, number & string & unknown>[]
const passAll = { 'ploy.firefight': (p: { seat: 'A' | 'B'; id: string }) => act.pass(p) }

describe('TEAM-HK Hearthkyn Salvagers: roster and loadouts', () => {
  it('TEAM-HK-000 TEAM-HK-001 the team is playable; Theyn plus 9 picks validates with three Warriors and three different Gunner cards, bad rosters do not', () => {
    expect(TEAM_ID).toBe('hearthkyn-salvagers')
    expect(team.playable).toBe(true)
    const ok = { leader: ['hk.theyn'], main: ['hk.warrior', 'hk.warrior', 'hk.warrior', 'hk.gunner-auto-rifle', 'hk.gunner-rotary-cannon', 'hk.gunner-rail-rifle', 'hk.dozr', 'hk.field-medic', 'hk.lugger'] }
    const check = (r: { leader: string[]; main: string[] }) => validateRoster(team, r, cards as never).ok
    expect(check(ok)).toBe(true)
    // a second Dozr, a fourth Gunner card, the same Gunner card twice and an eleventh operative are all refused
    expect(check({ ...ok, main: ['hk.dozr', 'hk.dozr', ...ok.main.slice(2)] })).toBe(false)
    expect(check({ ...ok, main: ['hk.gunner-auto-rifle', 'hk.gunner-rotary-cannon', 'hk.gunner-rail-rifle', 'hk.gunner-plasma-beamer', ...ok.main.slice(4)] })).toBe(false)
    expect(check({ ...ok, main: ['hk.gunner-auto-rifle', 'hk.gunner-auto-rifle', ...ok.main.slice(2)] })).toBe(false)
    expect(check({ ...ok, main: [...ok.main, 'hk.kinlynk'] })).toBe(false)
    expect(check({ ...ok, leader: ['kom.boss-nob'] })).toBe(false)
  })

  it('TEAM-HK-002 loadouts: the Theyn takes one of six guns and one of two melee weapons; a Warrior takes a bolter or an ion blaster, never both; Gunner cards bring both profiles', () => {
    const theyn = data.byId['hk.theyn'] as DatacardData
    expect(validateLoadout(theyn, { ranged: ['hk.w.ion-pistol'], melee: ['hk.w.plasma-weapon'] })).toEqual([])
    expect(validateLoadout(theyn, { ranged: ['hk.w.ion-pistol'] }).length).toBeGreaterThan(0)
    expect(validateLoadout(theyn, { ranged: ['hk.w.ion-pistol', 'hk.w.autoch-bolter'], melee: ['hk.w.plasma-weapon'] }).length).toBeGreaterThan(0)
    const warrior = data.byId['hk.warrior'] as DatacardData
    expect(validateLoadout(warrior, { ranged: ['hk.w.autoch-bolter'] })).toEqual([])
    expect(validateLoadout(warrior, { ranged: ['hk.w.ion-blaster', 'hk.w.autoch-bolter'] }).length).toBeGreaterThan(0)
    for (const id of ['hk.kinlynk', 'hk.kognitaar', 'hk.lokatr', 'hk.lugger']) expect((data.byId[id] as DatacardData).weapons.fixed).toContain('hk.w.fists')
    const s = hkOpen()
    const rotary = s.operatives[A(s, 'hk.gunner-rotary-cannon')]!
    expect(rotary.weapons).toEqual(expect.arrayContaining(['hk.w.hylas-rotary-cannon-focused', 'hk.w.hylas-rotary-cannon-sweeping', 'hk.w.fists']))
    const missile = s.operatives[A(s, 'hk.gunner-missile-launcher')]!
    expect(missile.weapons).toEqual(expect.arrayContaining(['hk.w.l7-missile-launcher-blast', 'hk.w.l7-missile-launcher-focused']))
  })
})

describe('TEAM-HK Hearthkyn Salvagers: Grudge', () => {
  it('TEAM-HK-003 an enemy that incapacitates a Hearthkyn operative gains a Grudge token (two kills make two); mines, Hot and a Medic! save give none; the token is public', () => {
    const s = hkOpen()
    const boy = B(s, 'kom.boy')
    const kill = (st: GameState, victim: string, attacker: string, source: string) =>
      withCtx(
        edit(st, (x) => (x.operatives[victim]!.wounds = 1)),
        (ctx) => {
          inflict(ctx, { targetId: victim, attackerId: attacker, weaponId: 'kom.w.slugga', amount: 3, source })
          queueRemoval(ctx, victim)
        },
      ).state
    let t = kill(s, A(s, 'hk.warrior'), boy, 'normal')
    expect(tokenCount(t, boy, GRUDGE, 'A')).toBe(1)
    t = kill(t, A(t, 'hk.lugger'), boy, 'crit')
    expect(tokenCount(t, boy, GRUDGE, 'A')).toBe(2)
    // visible to both seats
    expect(view(t, 'B').operatives[boy]!.tokens?.[0]).toMatchObject({ kind: GRUDGE, owner: 'A', count: 2 })
    expect(view(t, 'A').operatives[boy]!.tokens?.[0]).toMatchObject({ kind: GRUDGE, count: 2 })
    // direct damage outside an enemy action (a mine) and the victim's own Hot give none
    expect(tokenCount(kill(s, A(s, 'hk.warrior'), boy, 'direct'), boy, GRUDGE, 'A')).toBe(0)
    expect(tokenCount(kill(s, A(s, 'hk.warrior'), A(s, 'hk.warrior'), 'hot'), boy, GRUDGE, 'A')).toBe(0)
    // a Medic! save is not an incapacitation; declined, the operative falls and the Grudge follows
    const m = A(s, 'hk.field-medic')
    const w = A(s, 'hk.warrior')
    const asked = withCtx(place(place(place(s, w, 0, 0), m, 2, 0), boy, 8, 0), (ctx) => {
      ctx.state.operatives[w]!.wounds = 1
      inflict(ctx, { targetId: w, attackerId: boy, weaponId: 'kom.w.slugga', amount: 3, source: 'normal' })
      queueRemoval(ctx, w)
      runDeferredRemovals(ctx)
    }).state
    expect(asked.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { hook: 'hkMedic', operativeId: w } })
    const saved = take(asked, 'save').state
    expect(saved.operatives[w]!.status).toBe('active')
    expect(tokenCount(saved, boy, GRUDGE, 'A')).toBe(0)
    const fell = take(asked, 'none').state
    expect(fell.operatives[w]!.status).toBe('removed')
    expect(tokenCount(fell, boy, GRUDGE, 'A')).toBe(1)
  })

  it('TEAM-HK-004 two Grudge tokens turn two normals (the Accurate one too) into crits, tokens stay, an obscured target converts nothing, and a Grudge crit lets Rending trigger', () => {
    const s = hkOpen()
    const w = A(s, 'hk.warrior')
    const boy = B(s, 'kom.boy')
    const row = edit(place(place(s, w, 0, 0), boy, 5, 0), (st) => (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40))
    // Autoch-pattern bolter: Atk 4, 4+, Accurate 1: one retained normal plus three rolled 4s = four normals
    const plain = shootAt(row, w, 'hk.w.autoch-bolter', boy, dice(4, 4, 4, 1, 1, 1))
    expect(lastRetained(plain.events)).toMatchObject({ normal: 4, crit: 0 })
    const marked = shootAt(withGrudge(row, boy, 2), w, 'hk.w.autoch-bolter', boy, dice(4, 4, 4, 1, 1, 1))
    expect(lastRetained(marked.events)).toMatchObject({ normal: 2, crit: 2 })
    expect(tokenCount(marked.state, boy, GRUDGE, 'A')).toBe(2)
    // Heavy terrain between the two: the target is obscured, so nothing converts (R-5.8)
    const hidden = withTerrain(withGrudge(row, boy, 2), wall(2, 2.5, ['heavy']))
    const r = shootAt(hidden, w, 'hk.w.autoch-bolter', boy, dice(4, 4, 4, 1, 1, 1))
    expect(lastRetained(r.events)).toMatchObject({ crit: 0, obscured: true })
    // one token and the auto rifle: the Grudge crit makes Rending convert a second normal
    const g = A(s, 'hk.gunner-auto-rifle')
    const rend = shootAt(withGrudge(place(place(s, g, 0, 0), boy, 5, 0), boy, 1), g, 'hk.w.hylas-auto-rifle', boy, dice(4, 4, 4, 4, 1, 1, 1))
    expect(lastRetained(rend.events)).toMatchObject({ crit: 2, normal: 2 })
    const none = shootAt(place(place(s, g, 0, 0), boy, 5, 0), g, 'hk.w.hylas-auto-rifle', boy, dice(4, 4, 4, 4, 1, 1, 1))
    expect(lastRetained(none.events)).toMatchObject({ crit: 0 })
  })

  it('TEAM-HK-004 the engine odds agree with the Shoot: Grudge raises expected damage in the open and changes nothing against an obscured target', () => {
    const s = hkOpen()
    const w = A(s, 'hk.warrior')
    const boy = B(s, 'kom.boy')
    const row = edit(place(place(s, w, 0, 0), boy, 5, 0), (st) => (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40))
    const odds = (st: GameState) => expectedDamage(st, w, 'hk.w.autoch-bolter', boy).mean
    expect(odds(withGrudge(row, boy, 2))).toBeGreaterThan(odds(row))
    const hidden = withTerrain(row, wall(2, 2.5, ['heavy']))
    expect(expectedDamage(hidden, w, 'hk.w.autoch-bolter', boy).obscured).toBe(true)
    expect(odds(withGrudge(hidden, boy, 2))).toBeCloseTo(odds(hidden), 9)
    // mid-Shoot against the obscured Boy, the odds against a second Kommando in the open still count its Grudge tokens
    // (the hook reads its own sequence's obscured flag, not the live attack's)
    const other = Object.values(s.operatives).find((o) => o.seat === 'B' && o.id !== boy)!.id
    const both = withGrudge(place(hidden, other, 0, 5), other, 2)
    const mid = take(take(take(activateOp(both, w), 'shoot').state, 'hk.w.autoch-bolter').state, boy).state
    expect(mid.attack?.seq?.obscured).toBe(true)
    const vsOther = (st: GameState) => expectedDamage(st, w, 'hk.w.autoch-bolter', other).mean
    expect(vsOther(mid)).toBeCloseTo(vsOther(both), 9)
    expect(vsOther(both)).toBeGreaterThan(expectedDamage(place(hidden, other, 0, 5), w, 'hk.w.autoch-bolter', other).mean)
  })

  it('TEAM-HK-005 TEAM-HK-006 Eye of the Ancestors marks one enemy (two once three Kin have fallen, none without a Theyn); Weavefield Crest ignores one Normal Dmg die, never a crit', () => {
    const g = toGambit()
    const boy = B(g, 'kom.boy')
    const ids = (st: GameState) => gambitOffers(st, 'A').filter((o) => o.ployId === 'hk.p.eye-of-the-ancestors').map((o) => o.param!)
    expect(ids(g).every((p) => !p.includes('+'))).toBe(true)
    expect(ids(g).length).toBe(11)
    expect(tokenCount(take(g, `hk.p.eye-of-the-ancestors:${boy}`).state, boy, GRUDGE, 'A')).toBe(1)
    const down = edit(g, (st) => {
      for (const id of [A(st, 'hk.dozr'), A(st, 'hk.lokatr'), A(st, 'hk.lugger')]) st.operatives[id]!.status = 'removed'
    })
    const pairs = ids(down).filter((p) => p.includes('+'))
    expect(pairs.length).toBeGreaterThan(0)
    const [a, b] = pairs[0]!.split('+') as [string, string]
    const offer = gambitOffers(down, 'A').find((o) => o.ployId === 'hk.p.eye-of-the-ancestors' && o.param === pairs[0])!
    const t = withCtx(down, (ctx) => usePloy(ctx, 'A', offer, { window: 'strategy.gambit' })).state
    expect([tokenCount(t, a, GRUDGE, 'A'), tokenCount(t, b, GRUDGE, 'A')]).toEqual([1, 1])
    // without the Theyn on the table there is no gambit
    expect(ids(edit(g, (st) => (st.operatives[A(st, 'hk.theyn')]!.status = 'removed')))).toEqual([])
    // Weavefield Crest
    const s = hkOpen()
    const th = A(s, 'hk.theyn')
    const b2 = B(s, 'kom.boy')
    const hit = (st: GameState, source: string, amount: number) => withCtx(st, (ctx) => void inflict(ctx, { targetId: th, attackerId: b2, weaponId: 'kom.w.slugga', amount, source })).state.operatives[th]!.wounds
    const low = edit(s, (st) => (st.operatives[th]!.wounds = 3))
    expect(hit(low, 'normal', 3)).toBe(3)
    expect(hit(low, 'crit', 3)).toBe(0)
    expect(hit(low, 'devastating', 3)).toBe(0)
    // once per battle: the second Normal Dmg die hurts
    const once = withCtx(low, (ctx) => {
      inflict(ctx, { targetId: th, attackerId: b2, weaponId: 'kom.w.slugga', amount: 2, source: 'normal' })
      inflict(ctx, { targetId: th, attackerId: b2, weaponId: 'kom.w.slugga', amount: 2, source: 'normal' })
    }).state
    expect(once.operatives[th]!.wounds).toBe(1)
  })
})

describe('TEAM-HK Hearthkyn Salvagers: Dôzr, Field Medic, Grenadier', () => {
  it('TEAM-HK-007 Brawler: assists are removed, an enemy Normal Dmg of 4 does 3, and a Dôzr cut down mid-fight first strikes with an unresolved crit', () => {
    const s = hkOpen()
    const dozr = A(s, 'hk.dozr')
    const boy = B(s, 'kom.boy')
    expect(attackStats(s, boy, 'kom.w.choppa', dozr, { kind: 'fight', assists: [B(s, 'kom.grot')] }).assists).toEqual([])
    expect(attackStats(s, boy, 'kom.w.choppa', A(s, 'hk.warrior'), { kind: 'fight', assists: [B(s, 'kom.grot')] }).assists).toEqual([B(s, 'kom.grot')])
    const dmg = (amount: number, source: string) => withCtx(s, (ctx) => void inflict(ctx, { targetId: dozr, attackerId: boy, weaponId: 'kom.w.choppa', amount, source })).state.operatives[dozr]!.wounds
    const full = s.operatives[dozr]!.wounds
    expect(dmg(4, 'strike-normal')).toBe(full - 3)
    expect(dmg(3, 'strike-normal')).toBe(full - 3)
    expect(dmg(5, 'strike-crit')).toBe(full - 5)
    // the fight: the Boy's first crit takes the Dozr (3 wounds) to 0; its own crit strikes back for 4 and finishes the 4-wound Boy
    let f = edit(place(place(s, dozr, 0, 0), boy, 1.3, 0), (st) => {
      st.operatives[dozr]!.wounds = 3
      st.operatives[boy]!.wounds = 4
    })
    f = bTurn(f, A(f, 'hk.kinlynk'))
    const rng = dice(...Array<number>(20).fill(6))
    f = take(take(activateOp(f, boy), 'fight').state, dozr, rng).state
    const r = play(f, rng, passAll)
    expect(r.state.operatives[dozr]!.status).toBe('removed')
    expect(r.state.operatives[boy]!.status).toBe('removed')
    expect(evs(r.events, 'Struck').length).toBeGreaterThanOrEqual(2)
  })

  it('TEAM-HK-008 Knux Smash: not offered without an enemy in control range; pushes up to 3", D3+1 damage, APL -1 on a 3, then a free Charge of at most 3"', () => {
    const s = hkOpen()
    const d = A(s, 'hk.dozr')
    const boy = B(s, 'kom.boy')
    const far = place(place(s, d, 0, 0), boy, 5, 0)
    expect(abilityOffers(activateOp(far, d), far.operatives[d]!, null).some((o) => o.abilityId === 'hk.a.knux-smash')).toBe(false)
    const near = edit(place(place(s, d, 0, 0), boy, 1.3, 0), (st) => (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40))
    const choose = go(near, d, `ability:hk.a.knux-smash:${boy}`)
    expect(choose.pending?.kind).toBe('ability.choice')
    const spots = choose.pending!.options!.filter((o) => o.id !== 'stay')
    expect(spots.length).toBeGreaterThan(0)
    for (const o of spots) {
      const [x, z] = o.id.split(',').map(Number) as [number, number]
      expect(Math.hypot(x - 1.3, z)).toBeLessThanOrEqual(3 + 1e-6)
    }
    // a 3 on the D3 (die 5 or 6): 4 damage and APL -1; the Dozr may then Charge up to 3" (free)
    const pushed = take(choose, spots[0]!.id, dice(5)).state
    expect(pushed.operatives[boy]!.wounds).toBe(36)
    expect(pushed.operatives[boy]!.aplMods).toBe(-1)
    expect(pushed.operatives[boy]!.pos).not.toEqual(near.operatives[boy]!.pos)
    expect(pushed.pending?.kind).toBe('move.path')
    expect(pushed.firefight.activation?.frame).toBeDefined()
    expect(pushed.firefight.activation?.declared?.params?.maxInches).toBe(3)
    // a 1 or 2 on the D3 is 2 or 3 damage and no APL change; leaving the enemy in place is allowed
    const stay = take(choose, 'stay', dice(1)).state
    expect(stay.operatives[boy]!.wounds).toBe(38)
    expect(stay.operatives[boy]!.aplMods).toBe(0)
  })

  it('TEAM-HK-009 TEAM-HK-010 Medic! keeps a casualty within 3" on 1 wound (once per TP, not in an enemy control range); Medikit heals up to 2D3, itself included, never the saved operative', () => {
    const s = hkOpen()
    const v = A(s, 'hk.warrior')
    const v2 = A(s, 'hk.lugger')
    const m = A(s, 'hk.field-medic')
    const boy = B(s, 'kom.boy')
    const lay = place(place(place(place(s, v, 0, 0), v2, 0, 2.5), m, 2, 1), boy, 8, 0)
    const asked = withCtx(lay, (ctx) => {
      inflict(ctx, { targetId: v, attackerId: boy, weaponId: null, amount: 99, source: 'direct' })
      queueRemoval(ctx, v)
      // a second casualty the same turning point: the medic has used its rule, so it falls at once
      inflict(ctx, { targetId: v2, attackerId: boy, weaponId: null, amount: 99, source: 'direct' })
      queueRemoval(ctx, v2)
      runDeferredRemovals(ctx)
    }).state
    expect(asked.operatives[v2]!.status).toBe('removed')
    expect(asked.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { hook: 'hkMedic', operativeId: v, medicId: m } })
    const r = { state: take(asked, 'save').state }
    expect(r.state.operatives[v]).toMatchObject({ status: 'active', wounds: 1 })
    expect([r.state.operatives[v]!.aplMods, r.state.operatives[m]!.aplMods]).toEqual([-1, -1])
    expect(r.state.effects.some((e) => e.kind === 'hk.medicDash' && e.operativeId === v)).toBe(true)
    expect(providerReactions(r.state, 'A', { actorId: boy, action: 'shoot', activeSeat: 'B', moved: false }).map((o) => o.operativeId)).toEqual([v])
    // an enemy in the casualty's control range, or the medic's, stops it
    expect(ruleKill(place(lay, boy, 1.3, 0), v, boy).operatives[v]!.status).toBe('removed')
    expect(ruleKill(place(lay, boy, 2.8, 1), v, boy).operatives[v]!.status).toBe('removed')
    // Medikit
    const hurt = edit(lay, (st) => {
      st.operatives[m]!.wounds = 2
      st.operatives[v]!.wounds = 3
    })
    const self = go(hurt, m, `ability:hk.a.medikit:${m}`, new ScriptedRng([6, 6]))
    expect(self.operatives[m]!.wounds).toBe(8)
    const savedThisTp = edit(hurt, (st) => markUsedTp(st, 'A', `hk.medic.saved:${v}`))
    const ids = abilityOffers(activateOp(savedThisTp, m), savedThisTp.operatives[m]!, savedThisTp.firefight.activation).map((o) => o.id)
    expect(ids).toContain(`ability:hk.a.medikit:${m}`)
    expect(ids).not.toContain(`ability:hk.a.medikit:${v}`)
    expect(usedThisTp(savedThisTp, 'A', `hk.medic.saved:${v}`)).toBe(true)
  })

  it("GEN-086 TEAM-HK-009 Medic! in the saved operative's own activation holds its -1 APL over to its next activation", () => {
    const s = hkOpen()
    const v = A(s, 'hk.warrior')
    const m = A(s, 'hk.field-medic')
    const boy = B(s, 'kom.boy')
    const lay = activateOp(place(place(place(s, v, 0, 0), m, 2, 1), boy, 8, 0), v)
    const r = take(ruleKill(lay, v, boy), 'save').state
    expect(r.operatives[v]!.wounds).toBe(1)
    // the removal ran after the step: the activation's waiting action choice now offers only End
    expect(r.firefight.activation!.endsAfterAction).toBe(true)
    expect(optionIds(r)).toEqual(['end'])
    expect([r.operatives[v]!.aplMods, r.operatives[m]!.aplMods]).toEqual([0, -1])
    expect(r.effects.find((e) => e.kind === APL_NEXT_FX && e.operativeId === v)?.data).toMatchObject({ delta: -1, source: 'hk.a.medic' })
    // its next activation starts with the penalty
    const next = withCtx(r, (ctx) => applyDeferredApl(ctx, v)).state
    expect(next.operatives[v]!.aplMods).toBe(-1)
    expect(next.effects.some((e) => e.kind === APL_NEXT_FX)).toBe(false)
  })

  it('TEAM-HK-011 TEAM-HK-012 the Grenadier throws its own frag grenade at Hit 3+ and smoke and stun without team picks; a Utility Grenade marker taxes mission actions for either side and clears after D3 activations', () => {
    const s = hkOpen()
    const g = A(s, 'hk.grenadier')
    const boy = B(s, 'kom.boy')
    expect(s.operatives[g]!.weapons).toEqual(expect.arrayContaining(['core.w.frag-grenade', 'core.w.krak-grenade']))
    expect(attackStats(s, g, 'core.w.frag-grenade', boy, { kind: 'shoot' }).need).toBe(3)
    const lay = edit(place(place(s, g, 0, 0), boy, 4, 0), (st) => (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40))
    const kit = abilityOffers(activateOp(lay, g), lay.operatives[g]!, null).map((o) => o.action)
    expect(kit).toEqual(expect.arrayContaining(['ability:core.a.smoke-grenade', 'ability:core.a.stun-grenade', 'ability:hk.a.utility-grenade']))
    const thrown = shootAt(lay, g, 'core.w.frag-grenade', boy, dice(5, 5, 5, 5, 1, 1, 1))
    expect(thrown.state.operatives[g]!.weapons).not.toContain('core.w.frag-grenade')
    // the Utility Grenade marker
    const choose = go(lay, g, 'ability:hk.a.utility-grenade')
    const placed = take(choose, choose.pending!.options![0]!.id).state
    const marker = placed.markers.find((m) => m.equipmentId === 'hk.utility-grenade')!
    expect(marker.clearsAfter).toBeNull()
    const nearA = A(placed, 'hk.warrior')
    const nearB = B(placed, 'kom.grot')
    const stood = place(place(placed, nearA, marker.pos.x + 1, marker.pos.z), nearB, marker.pos.x - 1, marker.pos.z)
    for (const id of [nearA, nearB]) expect(providerCostDelta(stood, stood.operatives[id]!, 'marker:pickUp')).toBe(1)
    expect(providerCostDelta(stood, stood.operatives[nearA]!, 'ability:core.a.secure')).toBe(1)
    expect(providerCostDelta(stood, stood.operatives[nearA]!, 'shoot')).toBe(0)
    const away = place(stood, nearA, marker.pos.x + 6, marker.pos.z)
    expect(providerCostDelta(away, away.operatives[nearA]!, 'marker:pickUp')).toBe(0)
    // next Ready step: a D3 is rolled (6 -> 3); only completed activations count, counteractions do not
    const clock = withCtx(placed, (ctx) => {
      runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })
    }, dice(6))
    expect(clock.state.markers.find((m) => m.equipmentId === 'hk.utility-grenade')!.clearsAfter).toBe(3)
    const end = (st: GameState, counteract: boolean) =>
      withCtx(st, (ctx) => runHook('activation.end', { seat: 'A', state: ctx.state, engine: ctx, operativeId: A(st, 'hk.warrior'), data: { counteract } })).state
    let c = end(end(clock.state, true), false)
    expect(c.markers.find((m) => m.equipmentId === 'hk.utility-grenade')!.clearsAfter).toBe(2)
    c = end(end(c, false), false)
    expect(c.markers.some((m) => m.equipmentId === 'hk.utility-grenade')).toBe(false)
    // and a counting marker does not outlast its turning point; one not yet counting does
    const tpEnd = (st: GameState) => withCtx(st, (ctx) => runHook('turningPoint.end', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })).state
    expect(tpEnd(clock.state).markers.some((m) => m.equipmentId === 'hk.utility-grenade')).toBe(false)
    expect(tpEnd(placed).markers.some((m) => m.equipmentId === 'hk.utility-grenade')).toBe(true)
  })
})

describe('TEAM-HK Hearthkyn Salvagers: Gunner, Jump Pack Warrior, Kinlynk', () => {
  it('TEAM-HK-013 Beam: each retained beamer crit deals D3 to everything on the chosen line behind the target (friends too), never the target; Heavy terrain excludes; obscured means no beam', () => {
    const s = hkOpen()
    const g = A(s, 'hk.gunner-plasma-beamer')
    const boy = B(s, 'kom.boy')
    const rear = B(s, 'kom.dakka-boy')
    const friend = A(s, 'hk.warrior')
    const base = edit(place(place(place(place(s, g, 0, 0), boy, 5, 0), rear, 8, 0), friend, 8, 1.2), (st) => {
      for (const id of [boy, rear, friend]) st.operatives[id]!.wounds = st.operatives[id]!.maxWounds = 40
    })
    const sets = beamSets(base, base.operatives[g]!, base.operatives[boy]!)
    expect(sets.map((x) => x.map((o) => o.id)).sort()).toEqual([[rear], [friend]].sort())
    // two crits (6 6), a normal and a fail; the beam then rolls D3 for each crit (die 5 is 3, die 3 is 2)
    const script = () => dice(6, 6, 4, 1, 5, 3, 1, 1, 1)
    const best = shootAt(base, g, 'hk.w.etacarn-plasma-beamer', boy, script())
    expect(best.state.operatives[rear]!.wounds).toBe(35)
    expect(best.state.operatives[friend]!.wounds).toBe(40)
    // the shooter may pick the friendly line instead: friend burns, the enemy behind does not, the target takes only its dice damage
    const pickFriend = shootAt(base, g, 'hk.w.etacarn-plasma-beamer', boy, script(), {
      ...passAll,
      'weapon.choice': (p) => p.options!.find((o) => o.labelKey.includes('Hearthkyn'))!.action,
    })
    expect(pickFriend.state.operatives[friend]!.wounds).toBe(35)
    expect(pickFriend.state.operatives[rear]!.wounds).toBe(40)
    expect(tokenCount(pickFriend.state, g, GRUDGE, 'B')).toBe(0)
    // a low Heavy wall across the line to the enemy behind the target keeps it out of the beam
    const blocked = withTerrain(base, { id: 'hk-w', parts: [{ id: 'hk-w.a', footprint: [{ x: 6.5, z: -1 }, { x: 7, z: -1 }, { x: 7, z: 0.2 }, { x: 6.5, z: 0.2 }], height: 0.5, traits: ['heavy'] }] })
    expect(beamSets(blocked, blocked.operatives[g]!, blocked.operatives[boy]!).map((x) => x.map((o) => o.id))).toEqual([[friend]])
    // an obscured target: no crit is retained, so no beam at all
    const hidden = shootAt(withTerrain(base, wall(2, 2.5, ['heavy'])), g, 'hk.w.etacarn-plasma-beamer', boy, script())
    expect(hidden.state.operatives[rear]!.wounds).toBe(40)
    expect(hidden.state.operatives[friend]!.wounds).toBe(40)
  })

  it('TEAM-HK-014 TEAM-HK-015 Jump Pack: FLY sets up within Move (3" for a Dash, 2" counteracting), never into a control range except by Charge, no +2" on a Charge; Force Impact is Brutal only after the Warrior Charged in its own activation', () => {
    const s = hkOpen()
    const j = A(s, 'hk.jump-pack-warrior')
    const boy = B(s, 'kom.boy')
    const st = place(place(s, j, 0, 0), boy, 9.9, 0)
    const op = st.operatives[j]!
    expect(planFly(st, op, 'reposition', [{ x: 7.5, z: 0 }]).ok).toBe(true)
    expect(planFly(st, op, 'reposition', [{ x: 8.5, z: 0 }]).ok).toBe(false)
    expect(planFly(st, op, 'dash', [{ x: 2.5, z: 0 }]).ok).toBe(true)
    expect(planFly(st, op, 'dash', [{ x: 3.5, z: 0 }]).ok).toBe(false)
    expect(planFly(st, op, 'reposition', [{ x: 1.5, z: 0 }], true).ok).toBe(true)
    expect(planFly(st, op, 'reposition', [{ x: 2.5, z: 0 }], true).ok).toBe(false)
    // landing next to the Boy is a Charge, not a Reposition
    expect(planFly(st, op, 'reposition', [{ x: 8, z: 0 }]).ok).toBe(false)
    expect(planFly(st, op, 'charge', [{ x: 8, z: 0 }]).ok).toBe(true)
    expect(planFly(st, op, 'charge', [{ x: 8.5, z: 0 }]).ok).toBe(false)
    // the real thing: Charge with FLY, then fight with the plasma weapon
    let t = take(activateOp(st, j), 'charge').state
    expect(t.pending?.kind).toBe('move.path')
    const flown = expectOk(step(t, act.fly(t.pending!, { x: 8, z: 0 })))
    expect(flown.events.find((e) => e.type === 'OperativeMoved')).toMatchObject({ operativeId: j, segments: [{ kind: 'fly' }] })
    t = flown.state
    expect(attackStats(t, j, 'hk.w.plasma-weapon-jpw', boy, { kind: 'fight' }).rules.brutal).toBe(true)
    // no Charge in the activation: no Brutal; retaliating in the enemy's activation: no Brutal either
    const noCharge = place(place(activateOp(s, j), j, 0, 0), boy, 1.3, 0)
    expect(attackStats(noCharge, j, 'hk.w.plasma-weapon-jpw', boy, { kind: 'fight' }).rules.brutal).toBe(false)
    const theirTurn = bTurn(withEffect(place(place(s, j, 0, 0), boy, 1.3, 0), 'hk.a.jump-pack', 'A', { kind: 'hk.charged', operativeId: j, expires: 'activation' }), A(s, 'hk.kinlynk'))
    expect(attackStats(activateOp(theirTurn, boy), j, 'hk.w.plasma-weapon-jpw', boy, { kind: 'fight' }).rules.brutal).toBe(false)
  })

  it('TEAM-HK-016 TEAM-HK-017 Signal gives +1 APL to another Hearthkyn anywhere, not itself or in an enemy control range; System Jam keeps an enemy from activating while the player has an unjammed ready operative, then wears off', () => {
    const s = hkOpen()
    const k = A(s, 'hk.kinlynk')
    const th = A(s, 'hk.theyn')
    const boy = B(s, 'kom.boy')
    const lay = place(place(place(s, k, 0, 0), th, 12, 6), boy, 7, 0)
    const offers = (st: GameState) => abilityOffers(activateOp(st, k), st.operatives[k]!, null).map((o) => o.id)
    expect(offers(lay)).toContain(`ability:hk.a.signal:${th}`)
    expect(offers(lay)).not.toContain(`ability:hk.a.signal:${k}`)
    const boosted = go(lay, k, `ability:hk.a.signal:${th}`)
    expect(effectiveApl(boosted.operatives[th]!)).toBe(3)
    expect(offers(place(lay, boy, 1.3, 0)).some((id) => id.startsWith('ability:hk.a.signal') || id.startsWith('ability:hk.a.system-jam'))).toBe(false)
    // System Jam
    expect(offers(lay)).toContain(`ability:hk.a.system-jam:${boy}`)
    const jammed = go(lay, k, `ability:hk.a.system-jam:${boy}`)
    expect(tokenCount(jammed, boy, JAM, 'A')).toBe(1)
    expect(offers(edit(lay, (x) => (x.operatives[boy]!.tokens = [{ kind: JAM, owner: 'A', count: 1 }]))).includes(`ability:hk.a.system-jam:${boy}`)).toBe(false)
    const tokened = edit(lay, (x) => (x.operatives[boy]!.tokens = [{ kind: JAM, owner: 'A', count: 1 }]))
    const toB = take(activateOp(tokened, A(tokened, 'hk.lugger')), 'end').state
    expect(toB.pending?.kind).toBe('firefight.activate')
    expect(toB.pending!.seat).toBe('B')
    expect(optionIds(toB)).not.toContain(boy)
    expect(optionIds(toB).length).toBeGreaterThan(5)
    // only jammed operatives left ready: the opponent may activate one, and the token goes
    const lone = edit(tokened, (x) => {
      for (const o of Object.values(x.operatives)) if (o.seat === 'B' && o.id !== boy) o.ready = false
    })
    const only = take(activateOp(lone, A(lone, 'hk.lugger')), 'end').state
    expect(optionIds(only)).toEqual([boy])
    const woke = activateOp(only, boy)
    expect(tokenCount(woke, boy, JAM, 'A')).toBe(0)
  })
})

describe('TEAM-HK Hearthkyn Salvagers: Kognitâar, Lokâtr, Lugger, Warrior', () => {
  it('TEAM-HK-018 the Attack marker gives Balanced within 3", the Defence marker one defence re-roll to Hearthkyn targets within 3"; only one marker is in play; both go in the next Ready step', () => {
    const g = toGambit()
    const t = take(g, 'hk.p.tactician:attack').state
    expect(t.pending?.kind).toBe('ability.choice')
    const spot = t.pending!.options!.find((o) => o.id.startsWith('0,') || o.id === '0,0') ?? t.pending!.options![0]!
    const placed = take(t, spot.id).state
    const marker = placed.markers.find((m) => m.equipmentId === 'hk.attack-marker')!
    expect(marker).toBeDefined()
    const w = A(placed, 'hk.warrior')
    const boy = B(placed, 'kom.boy')
    const far = B(placed, 'kom.grot')
    const lay = place(place(place(placed, w, marker.pos.x - 6, marker.pos.z), boy, marker.pos.x + 2, marker.pos.z), far, marker.pos.x + 5, marker.pos.z)
    const rulesAgainst = (st: GameState, target: string) => effectiveRules(st, st.operatives[w]!, st.data.weapons['hk.w.autoch-bolter']!, 'shoot', target).map((r) => r.rule)
    expect(rulesAgainst(lay, boy)).toContain('balanced')
    expect(rulesAgainst(lay, far)).not.toContain('balanced')
    // Accelerated Appraisal replaces it with the Defence marker; the Defence marker re-rolls one defence die
    const running = drive(lay, (x) => x.pending?.kind === 'firefight.activate', 200, new ScriptedRng([6, 1]))
    const k = A(running, 'hk.kognitaar')
    const pick = go(running, k, 'ability:hk.a.accelerated-appraisal:defence')
    const swapped = take(pick, pick.pending!.options![0]!.id).state
    expect(swapped.markers.filter((m) => m.equipmentId === 'hk.attack-marker' || m.equipmentId === 'hk.defence-marker').map((m) => m.equipmentId)).toEqual(['hk.defence-marker'])
    const dm = swapped.markers.find((m) => m.equipmentId === 'hk.defence-marker')!
    const near = place(place(swapped, w, dm.pos.x + 1, dm.pos.z), boy, dm.pos.x + 7, dm.pos.z)
    const rules = parseRules(effectiveRules(near, near.operatives[boy]!, near.data.weapons['kom.w.slugga']!, 'shoot', w))
    expect(defenceStats(near, w, boy, 'kom.w.slugga', rules, false).grants.map((x) => x.id)).toContain('hk-defence-marker')
    const away = place(near, w, dm.pos.x + 6, dm.pos.z)
    expect(defenceStats(away, w, boy, 'kom.w.slugga', rules, false).grants.map((x) => x.id)).not.toContain('hk-defence-marker')
    // the next Ready step removes it
    const ready = withCtx(swapped, (ctx) => runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })).state
    expect(ready.markers.some((m) => m.equipmentId === 'hk.defence-marker')).toBe(false)
  })

  it('TEAM-HK-019 TEAM-HK-020 Spot: a shooter within 3" of the Lokâtr can pick a Conceal enemy in Light cover and it is not obscured, one 4" away gets nothing; Pan Spectral Scan grants Accurate 1 and Saturate near its marker until the Lokâtr activates or falls, not by a counteraction', () => {
    const s = hkOpen()
    const l = A(s, 'hk.lokatr')
    const w = A(s, 'hk.warrior')
    const boy = B(s, 'kom.boy')
    const cover = feature('hk-cover', part('hk-cover.a', rect(4.2, 4.6, -3, 3), 1, ['light']))
    const lay = withTerrain(edit(place(place(place(s, w, 0, 0), l, 1, 2), boy, 5.2, 0), (st) => (st.operatives[boy]!.order = 'conceal')), cover)
    const targets = (st: GameState) => validTargets(st, st.operatives[w]!, 'hk.w.autoch-bolter').map((x) => x.id)
    expect(targets(lay)).not.toContain(boy)
    const spotted = go(lay, l, `ability:hk.a.spot:${boy}`)
    expect(tokenCount(spotted, boy, 'hk.spot', 'A')).toBe(1)
    expect(targets(spotted)).toContain(boy)
    const data = { obscured: true, inCover: false }
    runHook('target.status', { seat: 'A', state: spotted, operativeId: w, targetId: boy, data })
    expect(data.obscured).toBe(false)
    // 4" away from the Lokatr: nothing
    const apart = place(spotted, l, 4, 3)
    expect(targets(apart)).not.toContain(boy)
    const data2 = { obscured: true, inCover: false }
    runHook('target.status', { seat: 'A', state: apart, operativeId: w, targetId: boy, data: data2 })
    expect(data2.obscured).toBe(true)
    // the token ends with the turning point
    const over = withCtx(spotted, (ctx) => tokensOnTurningPointEnd(ctx)).state
    expect(tokenCount(over, boy, 'hk.spot', 'A')).toBe(0)
    // Pan Spectral Scan
    const open = place(place(place(hkOpen(), w, 0, 0), l, 1, 2), boy, 5, 0)
    const pick = go(open, l, 'ability:hk.a.pan-spectral-scan')
    const scan = take(pick, '5,0').state
    const marker = scan.markers.find((m) => m.equipmentId === 'hk.pan-spectral-scan')!
    expect(marker.pos).toEqual({ x: 5, z: 0 })
    const rulesAt = (st: GameState, target: string) => effectiveRules(st, st.operatives[w]!, st.data.weapons['hk.w.autoch-bolter']!, 'shoot', target).map((r) => r.rule)
    expect(rulesAt(scan, boy)).toEqual(expect.arrayContaining(['accurate', 'saturate']))
    expect(rulesAt(place(scan, boy, 12, 0), boy)).not.toContain('saturate')
    // a new use moves it (one marker); the Lokatr activating again, or falling, removes it
    const fresh = edit(open, (st) => void st.markers.push({ ...marker }))
    const again = take(go(fresh, l, 'ability:hk.a.pan-spectral-scan'), '0,0').state
    expect(again.markers.filter((m) => m.equipmentId === 'hk.pan-spectral-scan')).toHaveLength(1)
    const activated = withCtx(scan, (ctx) => runHook('activation.start', { seat: 'A', state: ctx.state, engine: ctx, operativeId: l, data: { previousOrder: 'engage', order: 'engage' } })).state
    expect(activated.markers.some((m) => m.equipmentId === 'hk.pan-spectral-scan')).toBe(false)
    const fallen = withCtx(scan, (ctx) => runHook('operative.incapacitated', { seat: 'A', state: ctx.state, engine: ctx, operativeId: l })).state
    expect(fallen.markers.some((m) => m.equipmentId === 'hk.pan-spectral-scan')).toBe(false)
    // another operative activating leaves it alone (a counteraction runs no activation.start)
    const other = withCtx(scan, (ctx) => runHook('activation.start', { seat: 'A', state: ctx.state, engine: ctx, operativeId: w, data: { previousOrder: 'engage', order: 'engage' } })).state
    expect(other.markers.some((m) => m.equipmentId === 'hk.pan-spectral-scan')).toBe(true)
  })

  it('TEAM-HK-021 TEAM-HK-022 the Lugger gives one more equipment option and 1 extra CP in turning point 1 only, and one cheaper mission action per activation; the Warrior on an objective takes 1 less from the first damaging success', () => {
    const s = hkOpen()
    const noLugger = hkOpen({ rosterA: realRoster(ALL_HK.filter((id) => id !== 'hk.lugger')) })
    expect(s.players.A.cp).toBe(noLugger.players.A.cp + 1)
    const cardsById = data.byId as Record<string, { extraEquipment?: number }>
    expect(equipmentLimitFor(cardsById, ['hk.theyn', 'hk.lugger', 'hk.warrior'], 4)).toBe(5)
    expect(equipmentLimitFor(cardsById, ['hk.theyn', 'hk.warrior'], 4)).toBe(4)
    const tp2 = withCtx(edit(s, (st) => (st.turningPoint = 2)), (ctx) => runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } }))
    expect(tp2.state.players.A.cp).toBe(s.players.A.cp)
    // I've Got It: the first mission action of the activation costs 0, the next one full price
    const m = s.markers.find((k) => k.kind === 'objective')!
    const lug = A(s, 'hk.lugger')
    const at = activateOp(place(edit(s, (st) => (st.turningPoint = 2)), lug, m.pos.x + 0.6, m.pos.z), lug)
    const cost = (st: GameState) => abilityOffers(st, st.operatives[lug]!, st.firefight.activation).find((o) => o.abilityId === 'core.a.secure')!.cost
    expect(cost(at)).toBe(0)
    expect(cost(edit(at, (st) => (st.firefight.activation!.used = ['hk.a.ive-got-it'])))).toBe(1)
    // Secure Salvage
    const w = A(s, 'hk.warrior')
    const boy = B(s, 'kom.boy')
    const shot = (x: number) => {
      const lay = bTurn(edit(place(place(s, w, x, m.pos.z), boy, x + 6, m.pos.z), (st) => (st.operatives[w]!.wounds = st.operatives[w]!.maxWounds = 40)), A(s, 'hk.kinlynk'))
      const r = shootAt(lay, boy, 'kom.w.slugga', w, dice(6, 4, 4, 4, 1, 1, 1))
      return evs(r.events, 'DamageInflicted').reduce((n, e) => n + (e.amount as number), 0)
    }
    expect(shot(m.pos.x + 0.6) + 1).toBe(shot(m.pos.x - 8))
  })
})

describe('TEAM-HK Hearthkyn Salvagers: strategy ploys', () => {
  it('TEAM-HK-023 Need Keeps adds 1 to the control total and +1 Atk (Balanced at Atk 4) within 3" of its marker; Toil Earns makes a token-less enemy near its marker convert one success', () => {
    const g = toGambit()
    const m = g.markers.find((k) => k.kind === 'objective')!
    const t = take(g, `hk.p.need-keeps:${m.id}`).state
    const w = A(t, 'hk.warrior')
    const boy = B(t, 'kom.boy')
    expect(markerControl(t, m).apl.A).toBe(0)
    const holding = place(t, w, m.pos.x + 0.6, m.pos.z)
    expect(markerControl(holding, m).apl.A).toBe(holding.operatives[w]!.apl + 1)
    // within 3": Atk 3 fists become Atk 4; Atk 4 melee gains Balanced instead; 6" away nothing changes
    const near = place(place(t, w, m.pos.x + 2, m.pos.z), boy, m.pos.x + 3, m.pos.z)
    expect(attackStats(near, w, 'hk.w.fists', boy, { kind: 'fight' }).atk).toBe(4)
    const th = A(t, 'hk.theyn')
    const withTheyn = place(near, th, m.pos.x + 2, m.pos.z + 1.4)
    expect(attackStats(withTheyn, th, 'hk.w.concussion-gauntlet', boy, { kind: 'fight' }).rules.balanced).toBe(true)
    expect(attackStats(withTheyn, th, 'hk.w.concussion-gauntlet', boy, { kind: 'fight' }).atk).toBe(4)
    const farOff = place(near, w, m.pos.x + 7, m.pos.z)
    expect(attackStats(farOff, w, 'hk.w.fists', boy, { kind: 'fight' }).atk).toBe(3)
    // Toil Earns
    const toil = take(toGambit(), `hk.p.toil-earns:${m.id}`).state
    const enemyNear = place(toil, boy, m.pos.x + 2, m.pos.z)
    expect(grudgeCount(enemyNear, 'A', enemyNear.operatives[boy]!)).toBe(1)
    expect(grudgeCount(place(toil, boy, m.pos.x + 6, m.pos.z), 'A', toil.operatives[boy]!)).toBe(0)
    expect(grudgeCount(withGrudge(enemyNear, boy, 1), 'A', enemyNear.operatives[boy]!)).toBe(2)
    const running = drive(toil, (x) => x.pending?.kind === 'firefight.activate', 200, new ScriptedRng([6, 1]))
    const shot = shootAt(edit(place(place(running, w, m.pos.x - 5, m.pos.z), boy, m.pos.x + 2, m.pos.z), (st) => (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40)), w, 'hk.w.autoch-bolter', boy, dice(4, 4, 4, 1, 1, 1))
    expect(lastRetained(shot.events)).toMatchObject({ crit: 1 })
  })

  it('TEAM-HK-024 Wrought Defence keeps a fail as a normal success when the rolled defence dice show at most one; Proximate Firepower improves a 4+ weapon to 3+ within 6" and leaves a 3+ weapon alone', () => {
    const s = hkOpen()
    const w = A(s, 'hk.warrior')
    const boy = B(s, 'kom.boy')
    const lay = edit(place(place(s, w, -3, 4), boy, 3, 4), (st) => (st.operatives[w]!.wounds = st.operatives[w]!.maxWounds = 40))
    const damage = (base: GameState) => {
      const r = shootAt(bTurn(base, A(base, 'hk.kinlynk')), boy, 'kom.w.slugga', w, dice(4, 4, 4, 1, 3, 1, 1))
      return evs(r.events, 'DamageInflicted').reduce((n, e) => n + (e.amount as number), 0)
    }
    // three normals; one defence success blocks one of them, Wrought Defence makes it two
    expect(damage(lay)).toBe(6)
    expect(damage(withEffect(lay, 'hk.p.wrought-defence', 'A'))).toBe(3)
    // two defence successes already: the ploy has nothing to do
    const two = (base: GameState) => evs(shootAt(bTurn(base, A(base, 'hk.kinlynk')), boy, 'kom.w.slugga', w, dice(4, 4, 4, 1, 3, 3, 1)).events, 'DamageInflicted').reduce((n, e) => n + (e.amount as number), 0)
    expect(two(withEffect(lay, 'hk.p.wrought-defence', 'A'))).toBe(two(lay))
    // Proximate Firepower
    const p = take(toGambit(), 'hk.p.proximate-firepower').state
    const th = A(p, 'hk.theyn')
    const lay2 = place(place(place(p, w, 0, 0), th, 0, 3), boy, 5, 0)
    expect(attackStats(lay2, w, 'hk.w.autoch-bolter', boy, { kind: 'shoot' }).need).toBe(3)
    expect(attackStats(place(lay2, boy, 8, 0), w, 'hk.w.autoch-bolter', boy, { kind: 'shoot' }).need).toBe(4)
    expect(attackStats(lay2, th, 'hk.w.autoch-bolt-pistol-theyn', boy, { kind: 'shoot' }).need).toBe(3)
  })
})

describe('TEAM-HK Hearthkyn Salvagers: firefight ploys', () => {
  it('TEAM-HK-025 The Ancestors Are Watching gives one free Shoot or Fight (not a second Shoot) and an injured operative keeps its printed Hit while its Move stays cut', () => {
    const s = hkOpen()
    const w = A(s, 'hk.warrior')
    const boy = B(s, 'kom.boy')
    const hurt = edit(place(place(s, w, 0, 0), boy, 6, 0), (st) => (st.operatives[w]!.wounds = 3))
    expect(attackStats(hurt, w, 'hk.w.autoch-bolter', boy, { kind: 'shoot' }).need).toBe(5)
    let t = take(take(hurt, w).state, 'engage').state
    expect(t.pending?.kind).toBe('ploy.firefight')
    expect(optionIds(t)).toEqual(expect.arrayContaining(['hk.p.the-ancestors-are-watching:shoot']))
    expect(optionIds(t)).not.toContain('hk.p.the-ancestors-are-watching:fight')
    t = take(t, 'hk.p.the-ancestors-are-watching:shoot').state
    expect(attackStats(t, w, 'hk.w.autoch-bolter', boy, { kind: 'shoot' }).need).toBe(4)
    expect(effectiveMove(t.operatives[w]!, t)).toBeLessThan(t.operatives[w]!.move)
    expect(t.players.A.cp).toBe(hurt.players.A.cp - 1)
    // already shot this activation: no second free Shoot
    const shot = edit(activateOp(hurt, w), (st) => (st.firefight.activation!.performed = ['shoot']))
    const info = { window: 'firefight.actionEnded', subjectId: w }
    expect(offersFor(shot, 'A', 'firefight.actionEnded', info).filter((o) => o.ployId === 'hk.p.the-ancestors-are-watching').map((o) => o.param)).not.toContain('shoot')
    // the effect ends with the activation
    expect(effectiveMove(hurt.operatives[w]!, hurt)).toBeLessThan(hurt.operatives[w]!.move)
  })

  it('TEAM-HK-026 Worth It lets an incapacitated Hearthkyn operative take one free mission action before it is removed', () => {
    const { s, warrior } = worthItOffer()
    const secure = s.pending!.options!.find((o) => o.id.startsWith('ability:core.a.secure'))!
    expect(s.players.A.cp).toBe(1)
    const done = take(s, secure.id)
    expect(Object.values(done.state.mission!.secured)).toContain('A')
    let t = done.state
    for (let i = 0; i < 6 && t.pending && t.pending.kind !== 'firefight.activate'; i++) t = expectOk(step(t, t.pending.options?.[0]?.action ?? act.pass(t.pending))).state
    expect(t.operatives[warrior]!.status).toBe('removed')
  })

  it('TEAM-HK-027 Sturdy turns the attacker\'s retained crit into a normal success', () => {
    const base = sturdyShot()
    const amounts = (events: { type: string }[]) => evs(events, 'DamageInflicted').map((e) => e.amount as number)
    const s0 = hkOpen()
    const w = A(s0, 'hk.warrior')
    const boy = B(s0, 'kom.boy')
    const lay = bTurn(place(place(s0, w, -3, 4), boy, 3, 4), A(s0, 'hk.kinlynk'))
    const plain = shootAt(lay, boy, 'kom.w.slugga', w, dice(6, 4, 4, 1, 1, 1, 1))
    expect(amounts(plain.events)).toContain(4)
    expect(amounts(base.events)).not.toContain(4)
    expect(amounts(base.events).every((a) => a === 3)).toBe(true)
    expect(base.s.players.A.cp).toBe(s0.players.A.cp - 1)
  })

  it('TEAM-HK-028 Engage to Acquire grants a re-roll of any attack dice only against an enemy that controls an objective, and never when retaliating', () => {
    const on = engageWindow()
    expect(on.players.A.cp).toBe(engageStart(true).players.A.cp - 1)
    const off = engageStart(false)
    expect(off.pending?.kind).not.toBe('ploy.firefight')
    // retaliating: the Boy attacks the Warrior; the window offers nothing to the retaliator
    const s0 = hkOpen()
    const w = A(s0, 'hk.warrior')
    const boy = B(s0, 'kom.boy')
    const m = s0.markers.find((k) => k.kind === 'objective')!
    const lay = bTurn(place(place(s0, w, m.pos.x - 2.4, m.pos.z), boy, m.pos.x - 0.3, m.pos.z), A(s0, 'hk.kinlynk'))
    expect(markerControl(lay, m).controller).toBe('B')
    const f = take(take(activateOp(lay, boy), 'fight').state, w, new ScriptedRng([2, 2, 2, 2, 2, 2, 2, 2])).state
    expect(f.pending?.kind === 'ploy.firefight' ? f.pending.options!.map((o) => o.id) : []).not.toContain('hk.p.engage-to-acquire')
  })
})

describe('TEAM-HK Hearthkyn Salvagers: equipment', () => {
  it('TEAM-HK-029 Plasma Knives skip the Field Medic; Climbing Rigs make a 3" climb cost 2" once per activation; Excavation Tools take 1 AP off Pick Up Marker; Writ of Claim re-rolls initiative once per battle, only holding two objectives', () => {
    const knives = hkOpen({ equipmentA: ['hk.e.plasma-knives'] })
    for (const o of Object.values(knives.operatives).filter((x) => x.seat === 'A')) {
      const has = o.weapons.includes('hk.w.plasma-knife')
      expect(has, o.datacardId).toBe(o.datacardId !== 'hk.field-medic')
    }
    expect(knives.operatives[A(knives, 'hk.field-medic')]!.weapons).toContain('hk.w.plasma-knife-medic')
    // Climbing Rigs: 3" across and up 3" costs 6 against Move 5 without them, 5 with them; the second climb of the activation is not helped
    const hill = feature('hk-hill', part('hk-hill.a', rect(-5, -2, -2, 2), 3, ['vantage']))
    const trial = (opts: Parameters<typeof hkOpen>[0], tweak?: (st: GameState) => void) => {
      const s = withTerrain(hkOpen(opts), hill)
      const w = A(s, 'hk.warrior')
      // planned inside the warrior's own activation (the rigs only work there)
      const lay = edit(activateOp(place(s, w, 0, 0), w), tweak ?? (() => undefined))
      return planMove(lay, lay.operatives[w]!, 'reposition', [{ x: -3, z: 0, y: 3 }]).ok
    }
    expect(trial({})).toBe(false)
    expect(trial({ equipmentA: ['hk.e.climbing-rigs'] })).toBe(true)
    expect(trial({ equipmentA: ['hk.e.climbing-rigs'] }, (st) => st.effects.push({ id: 'e99', source: 'hk.e.climbing-rigs', seat: 'A', kind: 'hk.rigs', operativeId: A(st, 'hk.warrior'), expires: 'activation' }))).toBe(false)
    const rigs = withTerrain(hkOpen({ equipmentA: ['hk.e.climbing-rigs'] }), hill)
    const rw = A(rigs, 'hk.warrior')
    let up = take(activateOp(place(rigs, rw, 0, 0), rw), 'reposition').state
    up = expectOk(step(up, act.path(up.pending!, [{ x: -3, z: 0, y: 3 }]))).state
    expect(up.effects.some((e) => e.kind === 'hk.rigs' && e.operativeId === rw)).toBe(true)
    // a flat walk spends nothing
    const flat = hkOpen({ equipmentA: ['hk.e.climbing-rigs'] })
    expect(providerMoveSurcharge(flat, flat.operatives[A(flat, 'hk.warrior')]!, 'reposition', [], { horizontal: 4, accessible: 0, climb: 0, drop: 0 })).toBe(0)
    // Excavation Tools
    const dig = hkOpen({ equipmentA: ['hk.e.excavation-tools'] })
    expect(providerCostDelta(dig, dig.operatives[A(dig, 'hk.warrior')]!, 'marker:pickUp')).toBe(-1)
    expect(providerCostDelta(hkOpen(), hkOpen().operatives[A(hkOpen(), 'hk.warrior')]!, 'marker:pickUp')).toBe(0)
    // Writ of Claim
    const offered = writOffer(2)
    expect(offered.pending?.context.reroll).toBe(true)
    expect(optionIds(offered)).toEqual(['reroll', 'keep'])
    const done = writReroll()
    expect(done.ledger.A.battle).toContain('hk.e.writ-of-claim')
    expect(done.strategy.rolls.A).toBe(5)
    expect(providerInitiativeReroll(edit(offered, (st) => st.ledger.A.battle.push('hk.e.writ-of-claim')), 'A')).toHaveLength(0)
    // holding one objective only, or having won the roll-off, there is no offer
    expect(writOffer(1).pending?.context.reroll).not.toBe(true)
    expect(optionIds(writOffer(1))).not.toContain('reroll')
  })
})

