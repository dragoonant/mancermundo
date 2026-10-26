// legionaries engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-LG-nnn).
// Legionaries are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { view } from '@/engine'
import { act } from '@/engine/actions'
import { abilityOffers, actionForbidden, canCounteractWithOrder, maxRepeats, refreshFlags } from '@/engine/abilities'
import { attackStats, effectiveRules, inflict, weaponDamage } from '@/engine/attack-common'
import { hasKeyword } from '@/engine/conditions'
import { usedThisTp } from '@/engine/effects'
import { registerHook, runHook, unregisterHook } from '@/engine/hooks'
import { resolvePicks } from '@/engine/operative-picks'
import { offersFor } from '@/engine/ploys'
import { markerControl } from '@/engine/query'
import { ScriptedRng } from '@/engine/rng'
import { shootableWeapons } from '@/engine/shoot'
import { effectiveApl, effectiveMove } from '@/engine/state'
import { providerCostDelta, providerReactions } from '@/engine/team-rules'
import { TEAM_ID, isTainted } from '@/engine/teams/legionaries'
import { tokenCount } from '@/engine/tokens'
import type { GameState, Marker } from '@/engine/types'
import { enumerateLoadouts, loadBundle, validateOperativePicks, validateRoster, type DatacardData } from '../../../src/data'
import { play } from '../../fixtures/attack'
import { place } from '../../fixtures/helpers'
import { activateOp, edit, optionIds, passIt, realBundle, take, withCtx } from '../../fixtures/real'
import { A, B, STOP_PLOY, bTurn, dice, engaged, lgRoster, open, strikes, takePloy, toGambit } from './legionaries.hooks'

const data = loadBundle()
const ROSTER = ['lg.aspiring-champion', 'lg.butcher', 'lg.gunner', 'lg.heavy-gunner', 'lg.icon-bearer', 'lg.warrior']
const fx = (id: string, extra: Record<string, unknown>) => ({ id: `e${id}`, seat: 'A' as const, kind: 'ployFlag', expires: 'turningPoint', source: id, ...extra })

/** A state with timed effects added (strategy ploys in force, flags the hooks read). */
function withFx(s: GameState, ...list: { source: string; operativeId?: string; expires?: string; data?: Record<string, unknown> }[]): GameState {
  return edit(s, (st) => {
    list.forEach((e, i) => st.effects.push(fx(e.source, { id: `e9${i}`, ...(e.operativeId ? { operativeId: e.operativeId } : {}), ...(e.expires ? { expires: e.expires } : {}), ...(e.data ? { data: e.data } : {}) }) as never))
    refreshFlags(st)
  })
}

describe('TEAM-LG Legionaries', () => {
  it('TEAM-LG-000 TEAM-LG-001 TEAM-LG-002 TEAM-LG-003 playable team, roster rules, printed loadouts, one public mark per Legionary (never KHORNE on the Balefire Acolyte)', () => {
    expect(TEAM_ID).toBe('legionaries')
    const team = data.teams['legionaries']!
    expect(team.playable).toBe(true)
    const cards = realBundle.datacards
    const ok = { leader: ['lg.chosen'], main: ['lg.anointed', 'lg.balefire-acolyte', 'lg.butcher', 'lg.gunner', 'lg.icon-bearer'] }
    expect(validateRoster(team, ok, cards as never).ok).toBe(true)
    expect(validateRoster(team, { leader: ['lg.aspiring-champion'], main: ok.main }, cards as never).ok).toBe(true)
    expect(validateRoster(team, { leader: ['lg.chosen', 'lg.aspiring-champion'], main: ok.main }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: ['lg.butcher', 'lg.butcher', ...ok.main.slice(2)] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: [...ok.main, 'lg.shrivetalon'] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: Array(5).fill('lg.warrior') }, cards as never).ok).toBe(true)
    const count = (id: string) => enumerateLoadouts(data.byId[id] as DatacardData).length
    expect(count('lg.aspiring-champion')).toBe(8)
    expect(count('lg.chosen')).toBe(2)
    expect([count('lg.gunner'), count('lg.heavy-gunner'), count('lg.icon-bearer'), count('lg.warrior')]).toEqual([3, 3, 2, 2])
    expect([count('lg.anointed'), count('lg.butcher'), count('lg.shrivetalon'), count('lg.balefire-acolyte')]).toEqual([1, 1, 1, 1])

    {
      const card = data.byId['lg.balefire-acolyte'] as DatacardData
      expect(validateOperativePicks(team, card, { mark: 'KHORNE' }).length).toBeGreaterThan(0)
      expect(validateOperativePicks(team, card, { mark: 'NURGLE' })).toEqual([])
      expect(validateOperativePicks(team, data.byId['lg.warrior'] as DatacardData, { mark: 'KHORNE' })).toEqual([])
      expect(validateOperativePicks(team, data.byId['lg.warrior'] as DatacardData, {}).length).toBeGreaterThan(0)
      expect(resolvePicks(realBundle.teams['legionaries'], realBundle.datacards['lg.balefire-acolyte']!, { mark: 'KHORNE' }).problem).not.toBeNull()
      const s = open()
      const hg = A(s, 'heavy-gunner')
      expect(hasKeyword(s, s.operatives[hg]!, 'NURGLE')).toBe(true)
      expect(hasKeyword(s, s.operatives[hg]!, 'KHORNE')).toBe(false)
      // both seats see every mark
      expect(view(s, 'B').operatives[hg]!.picks).toEqual({ mark: 'NURGLE' })
      expect(view(s, 'A').operatives[hg]!.picks).toEqual({ mark: 'NURGLE' })
    }
  })

  it('TEAM-LG-004 ASTARTES: two Shoots need a bolt weapon in one of them, any Legionary fights twice, any order can counteract', () => {
    const s = open({ rosterA: lgRoster(['lg.aspiring-champion', 'lg.balefire-acolyte', 'lg.gunner', 'lg.heavy-gunner', 'lg.icon-bearer', 'lg.warrior'], ['UNDIVIDED', 'NURGLE']) })
    const get = (id: string) => s.operatives[id]!
    // the Champion's default pistol is the plasma pistol, so it has no bolt weapon and shoots once
    expect(maxRepeats(s, get(A(s, 'aspiring-champion')), 'shoot', ['shoot'])).toBe(1)
    expect(maxRepeats(s, get(A(s, 'aspiring-champion')), 'fight', ['fight'])).toBe(2)
    expect(maxRepeats(s, get(A(s, 'warrior')), 'shoot', ['shoot'])).toBe(2)
    expect(maxRepeats(s, get(A(s, 'warrior')), 'shoot', ['shoot', 'shoot'])).toBe(2)
    expect(maxRepeats(s, get(A(s, 'warrior')), 'fight', ['shoot', 'shoot'])).toBe(1)
    expect(maxRepeats(s, get(B(s, 'boy')), 'shoot', ['shoot'])).toBe(1)
    expect(canCounteractWithOrder(edit(s, (st) => (st.operatives[A(s, 'warrior')]!.order = 'conceal')), get(A(s, 'warrior')))).toBe(true)
    const target = B(s, 'boy')
    const second = (id: string, used: string[]) => {
      const t = edit(place(place(activateOp(place(place(s, id, 0, 0), target, 5, 0), id), id, 0, 0), target, 5, 0), (st) => {
        st.firefight.activation!.performed = ['shoot']
        st.firefight.activation!.weaponsUsed = used
      })
      return shootableWeapons(t, t.operatives[id]!, ['shoot']).map((w) => w.weaponId)
    }
    // Gunner: flamer then bolt pistol, but not the flamer twice; the same bolt weapon twice is fine
    const gunner = second(A(s, 'gunner'), ['lg.w.flamer'])
    expect(gunner).toContain('lg.w.bolt-pistol')
    expect(gunner).not.toContain('lg.w.flamer')
    expect(second(A(s, 'gunner'), ['lg.w.bolt-pistol'])).toEqual(expect.arrayContaining(['lg.w.bolt-pistol', 'lg.w.flamer']))
    // Balefire Acolyte: Fireblast (PSYCHIC) does not count as a bolt weapon, so Life siphon is barred after it
    const acolyte = second(A(s, 'balefire-acolyte'), ['lg.w.fireblast'])
    expect(acolyte).toContain('lg.w.bolt-pistol')
    expect(acolyte).not.toContain('lg.w.life-siphon')
    // Heavy Gunner: the second Shoot after the heavy weapon is the bolt pistol
    expect(second(A(s, 'heavy-gunner'), ['lg.w.heavy-bolter-focused'])).toEqual(['lg.w.bolt-pistol'])
  })

  it('TEAM-LG-005 In the Eyes of the Gods: the first kill in the Champion\'s own activation gives +1 APL once; counteractions add nothing', () => {
    const s = open({ rosterA: lgRoster(ROSTER) })
    const champ = A(s, 'aspiring-champion')
    const boy = B(s, 'boy')
    const t = edit(engaged(s, champ, boy), (st) => {
      st.operatives[boy]!.wounds = 3
    })
    const f = take(take(activateOp(t, champ), 'fight').state, boy, dice(6, 6, 6, 6, 6, 1, 1, 1, 1)).state
    const r = play(f, dice(), strikes)
    expect(r.state.operatives[boy]!.status).toBe('removed')
    expect(effectiveApl(r.state.operatives[champ]!)).toBe(4)
    expect(r.state.pending!.kind).toBe('firefight.action')
    expect(r.state.firefight.activation!.apSpent).toBe(1)
    // a second kill in the same activation adds nothing
    const again = withCtx(r.state, (ctx) => {
      inflict(ctx, { targetId: B(s, 'boss-nob'), attackerId: champ, weaponId: 'lg.w.power-fist', amount: 99, source: 'strike-normal' })
    }).state
    expect(again.operatives[champ]!.aplMods).toBe(1)
    // a kill while counteracting adds nothing
    const counter = edit(engaged(s, champ, boy), (st) => {
      st.firefight.activation = { operativeId: champ, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }
    })
    const c = withCtx(counter, (ctx) => {
      inflict(ctx, { targetId: boy, attackerId: champ, weaponId: 'lg.w.power-fist', amount: 99, source: 'strike-normal' })
    }).state
    expect(c.operatives[champ]!.aplMods).toBe(0)
  })

  it('TEAM-LG-006 Daemonic Aura: a Fall Back declared in the Chosen\'s control range is cancelled on 3+ with no AP spent and cannot be retried', () => {
    const s = open({ rosterA: lgRoster(['lg.chosen', 'lg.butcher', 'lg.gunner', 'lg.heavy-gunner', 'lg.icon-bearer', 'lg.warrior']) })
    const boy = B(s, 'boy')
    const t = activateOp(bTurn(engaged(s, A(s, 'chosen'), boy), A(s, 'warrior')), boy)
    const cancelled = take(t, 'fallBack', dice(3)).state
    expect(cancelled.pending!.kind).toBe('firefight.action')
    expect(cancelled.firefight.activation!.apSpent).toBe(0)
    expect(cancelled.firefight.activation!.barred).toContain('fallBack')
    expect(optionIds(cancelled)).not.toContain('fallBack')
    // on a 2 the Fall Back goes ahead
    const goes = take(t, 'fallBack', dice(2)).state
    expect(goes.pending!.kind).toBe('move.path')
  })

  it('TEAM-LG-007 Soul Gorge: the Chosen regains D3+1 after killing the enemy fighter or after a damaging crit strike, never above 15', () => {
    const s = open({ rosterA: lgRoster(['lg.chosen', 'lg.butcher', 'lg.gunner', 'lg.heavy-gunner', 'lg.icon-bearer', 'lg.warrior']) })
    const chosen = A(s, 'chosen')
    const boy = B(s, 'boy')
    const fight = (boyWounds: number, chosenWounds: number, attack: number[], gorge: number) => {
      const t = edit(engaged(s, chosen, boy), (st) => {
        st.operatives[boy]!.wounds = boyWounds
        st.operatives[chosen]!.wounds = chosenWounds
      })
      const f = take(take(activateOp(t, chosen), 'fight').state, boy, dice(...attack, 1, 1, 1, 1)).state
      return play(f, dice(gorge), strikes).state
    }
    // kill: 6 + (D3 roll 4 -> 2) + 1
    expect(fight(3, 6, [6, 1, 1, 1, 1], 4).operatives[chosen]!.wounds).toBe(9)
    // a damaging crit strike without a kill heals too
    expect(fight(40, 6, [6, 1, 1, 1, 1], 6).operatives[chosen]!.wounds).toBe(10)
    // neither: only fails
    expect(fight(40, 6, [1, 1, 1, 1, 1], 6).operatives[chosen]!.wounds).toBe(6)
    // never above the starting wounds
    expect(fight(3, 14, [6, 1, 1, 1, 1], 6).operatives[chosen]!.wounds).toBe(15)
    // an incapacitated Chosen heals nothing
    const dead = edit(engaged(s, chosen, boy), (st) => {
      st.operatives[chosen]!.wounds = 0
    })
    const r = withCtx(dead, (ctx) => {
      runHook('onFightResolved', { seat: 'A', state: ctx.state, engine: ctx, operativeId: chosen, targetId: boy, data: { attackerId: chosen, defenderId: boy, attackerIncapacitated: true, defenderIncapacitated: true } })
    }, dice(6))
    expect(r.state.operatives[chosen]!.wounds).toBe(0)
  })

  it('TEAM-LG-008 TEAM-LG-009 TEAM-LG-010 Unleash Daemon and Disgusting Vigour: reductions per die, never stacked, never on crits or Devastating', () => {
    const roster = lgRoster(['lg.aspiring-champion', 'lg.anointed', 'lg.butcher', 'lg.gunner', 'lg.icon-bearer', 'lg.warrior'], ['UNDIVIDED', 'NURGLE'])
    const s = open({ rosterA: roster })
    const an = A(s, 'anointed')
    const unleashed = edit(s, (st) => {
      st.operatives[an]!.tokens = [{ kind: 'lg.unleash', owner: 'A', count: 1 }]
    })
    const hit = (state: GameState, amount: number, source: string, rng: ScriptedRng) => {
      const r = withCtx(state, (ctx) => {
        inflict(ctx, { targetId: an, attackerId: B(s, 'boy'), weaponId: 'kom.w.choppa', amount, source })
      }, rng)
      return state.operatives[an]!.wounds - r.state.operatives[an]!.wounds
    }
    // NURGLE Unleashed Anointed: Dmg 4 normal takes 3 with no Disgusting Vigour roll; Dmg 3 normal rolls Vigour
    const none = new ScriptedRng([5])
    expect(hit(unleashed, 4, 'normal', none)).toBe(3)
    expect(none.remaining).toBe(1)
    const rolled = new ScriptedRng([5])
    expect(hit(unleashed, 3, 'normal', rolled)).toBe(2)
    expect(rolled.remaining).toBe(0)
    // a crit of Dmg 5 loses 1 to Unleash Daemon; Devastating is never reduced
    expect(hit(unleashed, 5, 'crit', new ScriptedRng([5]))).toBe(4)
    expect(hit(unleashed, 4, 'devastating', new ScriptedRng([5]))).toBe(4)
    // Disgusting Vigour alone: 5+ takes 1 off a normal 3, 4 does not, crits and Devastating never roll
    expect(hit(s, 3, 'normal', new ScriptedRng([5]))).toBe(2)
    expect(hit(s, 3, 'normal', new ScriptedRng([4]))).toBe(3)
    const crit = new ScriptedRng([5])
    expect(hit(s, 5, 'crit', crit)).toBe(5)
    expect(crit.remaining).toBe(1)
    expect(hit(s, 3, 'devastating', new ScriptedRng([5]))).toBe(3)
    // the claw gains Ceaseless and Lethal 5+; Pick Up Marker and mission actions are barred
    const claw = unleashed.data.weapons['lg.w.daemonic-claw']!
    const plain = effectiveRules(s, s.operatives[an]!, claw, 'fight', B(s, 'boy')).map((r) => r.rule)
    const rules = effectiveRules(unleashed, unleashed.operatives[an]!, claw, 'fight', B(s, 'boy'))
    expect(plain).not.toContain('ceaseless')
    expect(rules.map((r) => r.rule)).toEqual(expect.arrayContaining(['ceaseless', 'lethal']))
    expect(actionForbidden(unleashed, unleashed.operatives[an]!, 'marker:pickUp')).not.toBeNull()
    expect(actionForbidden(unleashed, unleashed.operatives[an]!, 'ability:core.a.secure')).not.toBeNull()
    expect(actionForbidden(s, s.operatives[an]!, 'ability:core.a.secure')).toBeNull()
    // the offer at activation start: a carried marker is placed at once
    const carrying = edit(s, (st) => {
      const m = st.markers.find((k) => k.kind === 'objective')!
      m.carriedBy = an
      st.operatives[an]!.flags.carrying = m.id
    })
    const done = take(take(take(carrying, an).state, 'engage').state, 'lg.a.unleash-daemon').state
    expect(tokenCount(done, an, 'lg.unleash')).toBe(1)
    expect(done.operatives[an]!.flags.carrying).toBeNull()
    expect(done.markers.find((k) => k.kind === 'objective')!.carriedBy).toBeNull()
    // once per battle: not offered again
    expect(done.operatives[an]!.oncePerBattleUsed).toContain('lg.unleash.used')
  })

  it('TEAM-LG-011 TEAM-LG-012 TEAM-LG-013 marks: KHORNE and TZEENTCH give Severe, SLAANESH Move 7", UNDIVIDED Ceaseless within 6"', () => {
    const s = open()
    const rules = (id: string, w: string, kind: 'shoot' | 'fight', target = B(s, 'boy')) => effectiveRules(s, s.operatives[id]!, s.data.weapons[w]!, kind, target).map((r) => r.rule)
    // Butcher is KHORNE, Gunner TZEENTCH
    const butcher = A(s, 'butcher')
    expect(rules(butcher, 'lg.w.double-handed-chainaxe', 'fight')).toContain('severe')
    expect(rules(butcher, 'lg.w.bolt-pistol', 'shoot')).not.toContain('severe')
    const gunner = A(s, 'gunner')
    expect(rules(gunner, 'lg.w.bolt-pistol', 'shoot')).toContain('severe')
    expect(rules(gunner, 'lg.w.fists', 'fight')).not.toContain('severe')
    // SLAANESH Icon Bearer: 7", 5" when injured
    const icon = A(s, 'icon-bearer')
    expect(effectiveMove(s.operatives[icon]!, s)).toBe(7)
    expect(effectiveMove(edit(s, (st) => (st.operatives[icon]!.wounds = 5)).operatives[icon]!, edit(s, (st) => (st.operatives[icon]!.wounds = 5)))).toBe(5)
    expect(effectiveMove(s.operatives[A(s, 'heavy-gunner')]!, s)).toBe(6)
    // UNDIVIDED Champion: Ceaseless against an enemy within 6", not at 7"
    const champ = A(s, 'aspiring-champion')
    const boy = B(s, 'boy')
    const near = place(place(s, champ, 0, 0), boy, 5, 0)
    const far = place(place(s, champ, 0, 0), boy, 9, 0)
    const ceaseless = (st: GameState) => effectiveRules(st, st.operatives[champ]!, st.data.weapons['lg.w.plasma-pistol-standard']!, 'shoot', boy).map((r) => r.rule).includes('ceaseless')
    expect(ceaseless(near)).toBe(true)
    expect(ceaseless(far)).toBe(false)
  })

  it('TEAM-LG-014 Infernal Pact: once per battle at activation start; Mutability and Change on a TZEENTCH Warrior bars it that turning point', () => {
    const marks = ['UNDIVIDED', 'KHORNE', 'TZEENTCH', 'NURGLE', 'SLAANESH', 'TZEENTCH']
    const s = open({ rosterA: lgRoster(ROSTER, marks) })
    const w = A(s, 'warrior')
    const start = take(take(s, w).state, 'engage').state
    expect(start.pending!.kind).toBe('ploy.firefight')
    // the Warrior is TZEENTCH: Pact offers the other four marks, Mutability is offered too
    expect(optionIds(start)).toEqual(expect.arrayContaining(['lg.a.infernal-pact:KHORNE', 'lg.a.infernal-pact:NURGLE', 'lg.p.mutability-and-change']))
    expect(optionIds(start)).not.toContain('lg.a.infernal-pact:TZEENTCH')
    // Mutability first: +1 APL, one action of each kind, and Pact is gone for this Warrior this TP
    const mut = take(start, 'lg.p.mutability-and-change').state
    expect(effectiveApl(mut.operatives[w]!)).toBe(4)
    expect(maxRepeats(mut, mut.operatives[w]!, 'shoot', ['shoot'])).toBe(1)
    expect(maxRepeats(mut, mut.operatives[w]!, 'fight', ['fight'])).toBe(1)
    expect(optionIds(mut).some((id) => id.startsWith('lg.a.infernal-pact'))).toBe(false)
    // Pact instead: the mark changes at once and the new rule applies to the first action
    const pact = take(start, 'lg.a.infernal-pact:KHORNE').state
    expect(pact.operatives[w]!.picks).toEqual({ mark: 'KHORNE' })
    const sword = pact.data.weapons['lg.w.chainsword']!
    expect(effectiveRules(pact, pact.operatives[w]!, sword, 'fight', B(s, 'boy')).map((r) => r.rule)).toContain('severe')
    expect(pact.ledger.A.battle).toContain('lg.pact')
    // once per battle for the team: the Icon Bearer's turn later offers none
    const icon = pact.operatives[A(s, 'icon-bearer')]!
    expect(offersFor(pact, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: A(s, 'warrior') }).some((o) => o.id.startsWith('lg.a.infernal-pact'))).toBe(false)
    void icon
  })

  it('TEAM-LG-015 Siphon Life: picked once the defence dice are final; Life siphon heals a friend within 6" 1 per damaging normal and D3 per crit; once per turning point', () => {
    const s = open({ rosterA: lgRoster(['lg.aspiring-champion', 'lg.balefire-acolyte', 'lg.butcher', 'lg.gunner', 'lg.icon-bearer', 'lg.warrior']) })
    const acolyte = A(s, 'balefire-acolyte')
    const friend = A(s, 'aspiring-champion')
    const boy = B(s, 'boy')
    const t0 = edit(place(place(place(s, acolyte, 0, 0), boy, 4, 0), friend, 2, 2), (st) => {
      st.operatives[friend]!.wounds = 8
    })
    const t = take(take(activateOp(t0, acolyte), 'shoot').state, 'lg.w.life-siphon').state
    // attack: crit, normal, normal, fail, fail; defence all fails; the crit heals D3 (6 -> 3)
    let rolled = play(take(t, boy, dice(6, 4, 3, 1, 1)).state, dice(), {}, STOP_PLOY).state
    // the opponent's own windows are passed on the way
    for (let i = 0; i < 6 && rolled.pending?.kind === 'ploy.firefight' && rolled.pending.seat === 'B'; i++) rolled = play(passIt(rolled, dice()).state, dice(), {}, STOP_PLOY).state
    // the pick comes at the start of the Resolve Attack Dice step: after the defence roll, not after the attack roll
    expect(rolled.pending).toMatchObject({ kind: 'ploy.firefight', window: 'shoot.attackerDefenceRolled', seat: 'A' })
    expect(rolled.attack!.seq!.def!.dice.map((d) => d.value)).toEqual([1, 1, 1])
    expect(optionIds(rolled)).toContain(`lg.a.wr-siphon-life:${friend}`)
    const at = (st: GameState, w: string) => offersFor(st, 'A', w, { window: w, attackerId: acolyte, targetId: boy, subjectId: acolyte }).some((o) => o.id.startsWith('lg.a.wr-siphon-life'))
    expect(at(rolled, 'shoot.attackRolled')).toBe(false)
    // GEN-096: the rules the weapon has now count (a rule that strips Siphon Life, as the Null Rod does, removes the pick)
    const strip = (c: { data?: Record<string, unknown> }) => {
      const rules = (c.data as { rules: { rule: string }[] }).rules
      for (let i = rules.length - 1; i >= 0; i--) if (rules[i]!.rule.toLowerCase().replace(/[^a-z]/g, '').endsWith('siphonlife')) rules.splice(i, 1)
      return null
    }
    registerHook('modifyWeaponRules', strip, 'test.strip-siphon')
    try {
      expect(at(rolled, 'shoot.attackerDefenceRolled')).toBe(false)
    } finally {
      unregisterHook('modifyWeaponRules', 'test.strip-siphon')
    }
    expect(at(rolled, 'shoot.attackerDefenceRolled')).toBe(true)
    const r = play(rolled, dice(6), takePloy(`lg.a.wr-siphon-life:${friend}`))
    expect(r.state.operatives[friend]!.wounds).toBe(8 + 3 + 1 + 1)
    expect(usedThisTp(r.state, 'A', 'lg.siphon.tp')).toBe(true)
    // not offered a second time this turning point
    expect(offersFor(r.state, 'A', 'shoot.attackerDefenceRolled', { window: 'shoot.attackerDefenceRolled', subjectId: acolyte }).some((o) => o.id.startsWith('lg.a.wr-siphon-life'))).toBe(false)
  })

  it('TEAM-LG-016 TEAM-LG-017 Butcher: no assists against it; a free 2" Charge after an enemy activation, only when a legal path exists', () => {
    const s = open()
    const butcher = A(s, 'butcher')
    const boy = B(s, 'boy')
    const assisting = (target: string) => attackStats(s, boy, 'kom.w.choppa', target, { kind: 'fight', assists: [B(s, 'boss-nob')] }, undefined).assists
    expect(assisting(butcher)).toEqual([])
    expect(assisting(A(s, 'warrior'))).toEqual([B(s, 'boss-nob')])
    // the reaction
    const near = place(place(s, butcher, 0, 0), boy, 2.5, 0)
    const ended = take(activateOp(bTurn(near, A(s, 'warrior')), boy), 'end').state
    expect(ended.pending!.kind).toBe('ability.choice')
    expect(ended.pending!.seat).toBe('A')
    const r = play(take(ended, 'react:0').state, dice(), { 'move.path': (q) => ({ type: 'move.path', seat: q.seat, decisionId: q.id, payload: { waypoints: [{ x: 0.9, z: 0 }] } }) })
    expect(r.state.operatives[butcher]!.pos.x).toBeCloseTo(0.9)
    expect(r.state.pending!.kind).toBe('firefight.activate')
    // a Conceal Butcher switches to Engage to do it
    const conceal = edit(near, (st) => (st.operatives[butcher]!.order = 'conceal'))
    const c = take(take(activateOp(bTurn(conceal, A(s, 'warrior')), boy), 'end').state, 'react:0').state
    expect(c.operatives[butcher]!.order).toBe('engage')
    // no offer when the enemy is beyond 2", or when the Butcher already stands in an enemy control range
    const info = (counteract: boolean) => ({ actorId: boy, action: 'activationEnded', activeSeat: 'B' as const, moved: false, activationEnded: true, counteract })
    expect(providerReactions(near, 'A', info(false))).toHaveLength(1)
    expect(providerReactions(near, 'A', info(true))).toHaveLength(1)
    expect(providerReactions(place(place(s, butcher, 0, 0), boy, 4.5, 0), 'A', info(false))).toHaveLength(0)
    expect(providerReactions(place(place(s, butcher, 0, 0), boy, 1.5, 0), 'A', info(false))).toHaveLength(0)
  })

  it('TEAM-LG-018 Icon Bearer and Favoured of the Dark Gods: APL 4 for marker control, taints a controlled objective for 1 CP, once per objective', () => {
    const s = open()
    const icon = A(s, 'icon-bearer')
    const m = s.markers.find((k) => k.kind === 'objective')!
    const t = edit(s, (st) => (st.operatives[icon]!.pos = { x: m.pos.x + 0.9, y: 0, z: m.pos.z }))
    expect(markerControl(t, m).apl.A).toBe(4)
    expect(markerControl(t, m).controller).toBe('A')
    const ready = (state: GameState) => withCtx(state, (ctx) => runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })).state
    const once = ready(t)
    expect(once.players.A.cp).toBe(t.players.A.cp + 1)
    expect(isTainted(once, m.id)).toBe(true)
    // the next Ready step does not taint it again
    expect(ready(once).players.A.cp).toBe(once.players.A.cp)
    // nor can the opponent's Icon Bearer, if it controlled the same marker
    expect(isTainted(t, m.id)).toBe(false)
  })

  it('TEAM-LG-019 TEAM-LG-020 Shrivetalon: resolves first when retaliating, saps a bystander when it kills, and lays one Grisly marker', () => {
    const roster = lgRoster(['lg.aspiring-champion', 'lg.shrivetalon', 'lg.butcher', 'lg.gunner', 'lg.icon-bearer', 'lg.warrior'])
    const s = open({ rosterA: roster })
    const sh = A(s, 'shrivetalon')
    const boy = B(s, 'boy')
    const other = B(s, 'boss-nob')
    // retaliating: the Shrivetalon's seat resolves the first die although B is the attacker
    const attacked = take(take(activateOp(bTurn(engaged(s, sh, boy), A(s, 'warrior')), boy), 'fight').state, sh, dice(6, 6, 1, 1, 1, 6, 6, 1, 1, 1)).state
    const stopped = play(attacked, dice(), {}, ['fight.resolve', 'firefight.action', 'firefight.activate'])
    expect(stopped.state.pending!.kind).toBe('fight.resolve')
    expect(stopped.state.pending!.seat).toBe('A')
    // killing its opponent: another enemy within 3" of the victim loses 1 APL
    const kill = edit(place(place(engaged(s, sh, boy), other, 0, 2.5), A(s, 'warrior'), -13.5, 10), (st) => {
      st.operatives[boy]!.wounds = 1
    })
    const f = take(take(activateOp(kill, sh), 'fight').state, boy, dice(6, 6, 6, 6, 6, 1, 1, 1, 1, 1)).state
    const dismembered = play(f, dice(), { ...strikes, ...takePloy(`lg.a.horrifying-dismemberment:${other}`) }).state
    expect(dismembered.operatives[other]!.aplMods).toBe(-1)
    // Grisly Mark: 2 AP, once per battle, never in an enemy control range
    const g = activateOp(place(s, sh, 0, 0), sh)
    const opt = g.pending!.options!.find((o) => o.id.startsWith('ability:lg.a.grisly-mark'))!
    expect(opt.data?.cost).toBe(2)
    const placed = take(g, opt.id).state
    expect(placed.markers.filter((k) => k.equipmentId === 'lg.grisly')).toHaveLength(1)
    expect(placed.firefight.activation!.apSpent).toBe(2)
    expect(abilityOffers(placed, placed.operatives[sh]!, placed.firefight.activation).some((o) => o.abilityId === 'lg.a.grisly-mark')).toBe(false)
    // an enemy within 3" pays 1 more AP for Pick Up Marker and mission actions, and counts 1 lower at a contested objective
    const m = s.markers.find((k) => k.kind === 'objective')!
    const mark: Marker = { id: 'grisly9', kind: 'equipment', pos: { x: m.pos.x + 1, z: m.pos.z }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'lg.grisly' }
    const laid = edit(place(s, boy, m.pos.x - 0.9, m.pos.z), (st) => {
      st.markers.push(mark)
    })
    expect(providerCostDelta(laid, laid.operatives[boy]!, 'marker:pickUp')).toBe(1)
    expect(providerCostDelta(laid, laid.operatives[boy]!, 'ability:core.secure')).toBe(0)
    expect(providerCostDelta(laid, laid.operatives[boy]!, 'ability:core.a.secure')).toBe(1)
    expect(providerCostDelta(laid, laid.operatives[A(s, 'butcher')]!, 'marker:pickUp')).toBe(0)
    const bare = edit(place(s, boy, m.pos.x - 0.9, m.pos.z), () => undefined)
    expect(markerControl(laid, m).apl.B).toBe(markerControl(bare, m).apl.B - 1)
  })

  it('TEAM-LG-021 TEAM-LG-022 TEAM-LG-023 TEAM-LG-024 strategy ploys: Blood for the Blood God, Implacable, Quicksilver Speed, Fickle Fates', () => {
    const s = open({ rosterA: lgRoster(ROSTER, ['UNDIVIDED', 'KHORNE', 'TZEENTCH', 'NURGLE', 'SLAANESH', 'TZEENTCH']) })
    const champ = A(s, 'aspiring-champion')
    const butcher = A(s, 'butcher')
    const boy = B(s, 'boy')
    // Blood for the Blood God
    const bf = withFx(s, { source: 'lg.p.blood-for-the-blood-god' })
    expect(weaponDamage(bf, butcher, 'lg.w.double-handed-chainaxe', boy, 'fight')).toEqual({ normal: 6, crit: 7 })
    expect(weaponDamage(s, butcher, 'lg.w.double-handed-chainaxe', boy, 'fight')).toEqual({ normal: 5, crit: 7 })
    const strike = (state: GameState, who: string, amount: number) => {
      const out = { amount, die: 'normal', cancel: false }
      const r = withCtx(state, (ctx) => {
        runHook('beforeStrike', { seat: 'A', state: ctx.state, engine: ctx, operativeId: who, data: out })
      })
      return { amount: out.amount, state: r.state }
    }
    const fighting = edit(bf, (st) => {
      st.attack = { kind: 'fight', operativeId: champ } as never
    })
    const first = strike(fighting, champ, 5)
    expect(first.amount).toBe(6)
    expect(strike(first.state, champ, 5).amount).toBe(5)
    expect(strike(fighting, champ, 7).amount).toBe(7)
    // retaliating (the enemy is the attacker): nothing extra
    expect(strike(edit(bf, (st) => (st.attack = { kind: 'fight', operativeId: boy } as never)), champ, 5).amount).toBe(5)
    // Implacable: Piercing 1 becomes Piercing Crits 1 against a Legionary, Piercing 2 is unchanged, injured NURGLE keeps full Move
    const imp = withFx(s, { source: 'lg.p.implacable' })
    const hg = A(s, 'heavy-gunner')
    const pierce = (state: GameState, w: string) => effectiveRules(state, state.operatives[boy]!, state.data.weapons[w]!, 'shoot', champ).find((r) => r.rule === 'piercing')
    expect(pierce(imp, 'lg.w.plasma-pistol-standard')).toMatchObject({ x: 1, crits: true })
    expect(pierce(s, 'lg.w.plasma-pistol-standard')?.crits).toBeUndefined()
    expect(pierce(imp, 'lg.w.meltagun')).toMatchObject({ x: 2 })
    expect(pierce(imp, 'lg.w.meltagun')?.crits).toBeUndefined()
    const hurt = (state: GameState) => edit(state, (st) => (st.operatives[hg]!.wounds = 5))
    expect(effectiveMove(hurt(s).operatives[hg]!, hurt(s))).toBe(4)
    expect(effectiveMove(hurt(imp).operatives[hg]!, hurt(imp))).toBe(6)
    // Quicksilver Speed: Hit worse by 1 against a Legionary that moved, a SLAANESH one only from more than 6"
    const icon = A(s, 'icon-bearer')
    const qs = withFx(place(place(place(s, champ, 0, 0), boy, 1.4, 0), icon, -13, 8), { source: 'lg.p.quicksilver-speed' }, { source: 'lg.qs.moved', operativeId: champ }, { source: 'lg.qs.moved', operativeId: icon })
    const need = (state: GameState, w: string, kind: 'fight' | 'shoot', target: string) => attackStats(state, boy, w, target, { kind }).need
    const base = need(place(place(s, champ, 0, 0), boy, 1.4, 0), 'kom.w.choppa', 'fight', champ)
    expect(need(qs, 'kom.w.choppa', 'fight', champ)).toBe(base + 1)
    const farShot = place(qs, boy, -13, 15.5)
    const nearShot = place(qs, boy, -13, 12)
    expect(need(farShot, 'kom.w.slugga', 'shoot', icon)).toBe(need(place(s, boy, -13, 15.5), 'kom.w.slugga', 'shoot', icon) + 1)
    expect(need(nearShot, 'kom.w.slugga', 'shoot', icon)).toBe(need(place(s, boy, -13, 12), 'kom.w.slugga', 'shoot', icon))
    // never on top of the enemy being injured
    const injured = edit(qs, (st) => (st.operatives[boy]!.wounds = 3))
    expect(need(injured, 'kom.w.choppa', 'fight', champ)).toBe(need(edit(place(place(s, champ, 0, 0), boy, 1.4, 0), (st) => (st.operatives[boy]!.wounds = 3)), 'kom.w.choppa', 'fight', champ))
    // Fickle Fates: Balanced against a ready enemy, not against an expended one; Relentless when it already has Balanced
    const ff = withFx(s, { source: 'lg.p.fickle-fates' })
    const rulesOf = (state: GameState, extra: { rule: string }[] = []) =>
      effectiveRules(state, state.operatives[champ]!, { ...state.data.weapons['lg.w.boltgun']!, rules: extra }, 'shoot', boy).map((r) => r.rule)
    expect(rulesOf(ff)).toEqual(['balanced'])
    expect(rulesOf(edit(ff, (st) => (st.operatives[boy]!.ready = false)))).toEqual([])
    expect(rulesOf(ff, [{ rule: 'balanced' }])).toEqual(['balanced', 'relentless'])
    // ... and a ready TZEENTCH defender that retains a crit also retains one fail
    const gunner = A(s, 'gunner')
    const defence = (state: GameState) => {
      const dice = [
        { value: 6, kind: 'crit' as const, rerolled: false },
        { value: 1, kind: 'fail' as const, rerolled: false },
        { value: 2, kind: 'fail' as const, rerolled: false },
      ]
      withCtx(state, (ctx) => {
        runHook('afterDefenceRoll', { seat: 'A', state: ctx.state, engine: ctx, operativeId: gunner, targetId: boy, data: { kind: 'shoot', side: 'defence', targetId: boy, dice, requests: [], choices: {} } })
      })
      return dice.map((d) => d.kind)
    }
    expect(defence(ff)).toEqual(['crit', 'normal', 'fail'])
    expect(defence(edit(ff, (st) => (st.operatives[gunner]!.ready = false)))).toEqual(['crit', 'fail', 'fail'])
  })

  it('TEAM-LG-025 TEAM-LG-026 firefight ploys: Unending Bloodshed, Malignant Aura, Sickening Captivation', () => {
    const s = open()
    const butcher = A(s, 'butcher')
    const boy = B(s, 'boy')
    const t = edit(engaged(s, butcher, boy), (st) => {
      st.operatives[butcher]!.wounds = 1
    })
    const f = take(take(activateOp(t, butcher), 'fight').state, boy, dice(6, 6, 1, 1, 1, 6, 6, 6, 6)).state
    // without the ploy the Butcher falls and the Boy keeps its remaining wounds
    const without = play(f, dice(), { ...strikes, 'ploy.firefight': (p) => act.pass(p) })
    expect(without.state.operatives[butcher]!.status).toBe('removed')
    expect(without.state.operatives[boy]!.wounds).toBe(3)
    // with it, the unresolved crit (Dmg 7) strikes before the Butcher is removed
    const withPloy = play(f, dice(), { ...strikes, ...takePloy('lg.p.unending-bloodshed:crit') })
    expect(withPloy.state.operatives[butcher]!.status).toBe('removed')
    expect(withPloy.state.operatives[boy]!.status).toBe('removed')

    {
      const s = open()
      const hg = A(s, 'heavy-gunner')
      const boy = B(s, 'boy')
      const aura = (state: GameState, gap: number) => {
        const t = withFx(place(place(state, hg, 0, 0), boy, gap, 0), { source: 'lg.p.malignant-aura', operativeId: hg, expires: 'action' })
        return effectiveRules(t, t.operatives[hg]!, t.data.weapons['lg.w.bolt-pistol']!, 'shoot', boy).some((r) => r.rule === 'piercing' && !r.crits)
    }
    expect(aura(s, 3.5)).toBe(true)
    expect(aura(s, 5.5)).toBe(false)
    // offered in the real shoot window and used
    const t = take(take(activateOp(place(place(s, hg, 0, 0), boy, 2.5, 0), hg), 'shoot').state, 'lg.w.bolt-pistol').state
    expect(optionIds(take(t, boy).state)).toContain('lg.p.malignant-aura')
    // Sickening Captivation
    const icon = A(s, 'icon-bearer')
    const start = take(take(place(place(s, icon, 0, 0), boy, 3, 0), icon).state, 'engage').state
    expect(optionIds(start)).toContain(`lg.p.sickening-captivation:${boy}`)
    const done = take(start, `lg.p.sickening-captivation:${boy}`).state
    expect(done.operatives[boy]!.aplMods).toBe(-1)
    // not offered for an enemy beyond 4"
    const faraway = take(take(place(place(s, icon, 0, 0), boy, 6.5, 0), icon).state, 'engage').state
    expect(faraway.pending!.kind).toBe('firefight.action')
    }
  })

  it('TEAM-LG-027 TEAM-LG-028 equipment: Warded Armour, Tainted Rounds, Chaos Talismans, Malefic Blades', () => {
    const g = toGambit({ equipmentA: ['lg.e.warded-armour', 'lg.e.tainted-rounds'] })
    const opt = g.pending!.options!.find((o) => o.id.startsWith('lg.p.warded-armour:'))!
    const picked = (opt.action.payload as { param: string }).param
    const after = take(g, opt.id).state
    expect(after.operatives[picked]!.save).toBe(2)
    expect(tokenCount(after, picked, 'lg.warded')).toBe(1)
    const ready = withCtx(after, (ctx) => runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })).state
    expect(ready.operatives[picked]!.save).toBe(3)
    expect(tokenCount(ready, picked, 'lg.warded')).toBe(0)
    // Tainted Rounds
    const s = open({ equipmentA: ['lg.e.tainted-rounds'], rosterA: lgRoster(ROSTER) })
    const hg = A(s, 'heavy-gunner')
    const boy = B(s, 'boy')
    const shooting = (weapon: string) => {
      const t = take(take(activateOp(place(place(s, hg, 0, 0), boy, 3, 0), hg), 'shoot').state, weapon).state
      return take(t, boy).state
    }
    expect(optionIds(shooting('lg.w.bolt-pistol'))).toContain('lg.e.tainted-rounds')
    // the tainted bolt pistol is not named by the equipment
    const stub = edit(s, (st) => {
      st.attack = { kind: 'shoot', operativeId: hg, weaponId: 'lg.w.tainted-bolt-pistol' } as never
    })
    expect(offersFor(stub, 'A', 'shoot.targetSelected', { window: 'shoot.targetSelected', subjectId: hg, attackerId: hg, kind: 'shoot' }).some((o) => o.id === 'lg.e.tainted-rounds')).toBe(false)
    // while the action lasts the picked weapon has Rending
    const rending = withFx(s, { source: 'lg.e.tainted-rounds', operativeId: hg, expires: 'action', data: { weaponId: 'lg.w.bolt-pistol' } })
    const has = (w: string) => effectiveRules(rending, rending.operatives[hg]!, rending.data.weapons[w]!, 'shoot', boy).some((r) => r.rule === 'rending')
    expect(has('lg.w.bolt-pistol')).toBe(true)
    expect(has('lg.w.heavy-bolter-focused')).toBe(false)
    // once per turning point
    const used = play(shooting('lg.w.bolt-pistol'), dice(6, 1, 1, 1, 1, 1, 1, 1), takePloy('lg.e.tainted-rounds')).state
    expect(usedThisTp(used, 'A', 'lg.taintedRounds')).toBe(true)

    {
      const s0 = open({ equipmentA: ['lg.e.malefic-blades'], rosterA: lgRoster(ROSTER) })
      for (const o of Object.values(s0.operatives).filter((x) => x.seat === 'A')) expect(o.weapons).toContain('lg.w.malefic-blade')
      expect(s0.data.weapons['lg.w.malefic-blade']).toMatchObject({ atk: 5, hit: 3, dmg: { normal: 3, crit: 4 }, type: 'melee' })
      expect(Object.values(s0.operatives).filter((x) => x.seat === 'B').some((o) => o.weapons.includes('lg.w.malefic-blade'))).toBe(false)
      const warrior = A(s0, 'warrior')
      const boy = B(s0, 'boy')
      const talismans = withFx(place(place(s0, warrior, 0, 0), boy, 3, 0), { source: 'lg.p.chaos-talismans', data: { mark: 'SLAANESH' } })
      const shoot = (state: GameState, rng: ScriptedRng) => {
        const t = take(take(activateOp(state, warrior), 'shoot').state, 'lg.w.boltgun').state
        return play(take(t, boy, rng).state, dice(), {}, STOP_PLOY).state
    }
    const offered = shoot(talismans, dice(1, 1, 1, 1))
    expect(optionIds(offered)).toContain('lg.e.chaos-talismans')
    // D3 (roll 4 -> 2) to the Warrior; one fail becomes a normal success and meets the Boy's failed saves
    const r = play(offered, dice(4, 1, 1, 1), takePloy('lg.e.chaos-talismans')).state
    expect(r.operatives[warrior]!.wounds).toBe(r.operatives[warrior]!.maxWounds - 2)
    expect(r.operatives[boy]!.wounds).toBe(r.operatives[boy]!.maxWounds - 3)
    // not offered for a different mark, or with fewer than two fails
    const other = shoot(withFx(place(place(s0, warrior, 0, 0), boy, 3, 0), { source: 'lg.p.chaos-talismans', data: { mark: 'KHORNE' } }), dice(1, 1, 1, 1))
    expect(optionIds(other)).not.toContain('lg.e.chaos-talismans')
    // a Shoot carries on when the damage incapacitates the shooter
    const frail = edit(talismans, (st) => (st.operatives[warrior]!.wounds = 1))
    const down = play(shoot(frail, dice(1, 1, 1, 1)), dice(6, 1, 1, 1), takePloy('lg.e.chaos-talismans')).state
    expect(down.operatives[warrior]!.status).toBe('removed')
    expect(down.operatives[boy]!.wounds).toBe(down.operatives[boy]!.maxWounds - 3)
    // a Fight roll works the same way, and the fight ends if the damage incapacitates the fighter
    const duel = withFx(engaged(s0, warrior, boy), { source: 'lg.p.chaos-talismans', data: { mark: 'SLAANESH' } })
    const fight = (state: GameState) => play(take(take(activateOp(state, warrior), 'fight').state, boy, dice(1, 1, 1, 1, 1, 1, 1, 1)).state, dice(), {}, STOP_PLOY).state
    const fo = fight(duel)
    expect(optionIds(fo)).toContain('lg.e.chaos-talismans')
    const fr = play(fo, dice(4, 1, 1, 1), { ...strikes, ...takePloy('lg.e.chaos-talismans') }).state
    expect(fr.operatives[warrior]!.wounds).toBe(fr.operatives[warrior]!.maxWounds - 2)
    expect(fr.operatives[boy]!.wounds).toBe(fr.operatives[boy]!.maxWounds - 3)
    const fd = play(fight(edit(duel, (st) => (st.operatives[warrior]!.wounds = 1))), dice(6, 1, 1, 1), { ...strikes, ...takePloy('lg.e.chaos-talismans') }).state
    expect(fd.operatives[warrior]!.status).toBe('removed')
    expect(fd.operatives[boy]!.wounds).toBe(fd.operatives[boy]!.maxWounds)
    }
  })
})

