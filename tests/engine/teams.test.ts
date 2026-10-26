import { describe, expect, it } from 'vitest'
import { createGame, step } from '@/engine'
import { attackStats, effectiveRules } from '@/engine/attack-common'
import { repeatSurcharge } from '@/engine/abilities'
import { actionAvailability, actionCost } from '@/engine/firefight'
import { runHook } from '@/engine/hooks'
import { gambitOffers, offersFor } from '@/engine/ploys'
import { normalBlocksCrit } from '@/engine/teams/angels-of-death'
import { stealthyLevel } from '@/engine/handlers'
import { ScriptedRng } from '@/engine/rng'
import { activeTactics } from '@/engine/conditions'
import { effectiveApl } from '@/engine/state'
import { distToPolygon } from '@/engine/geometry'
import { removeNow } from '@/engine/effects'
import { allowedOrders } from '@/engine/abilities'
import { validTargets } from '@/engine/attack-common'
import { commsBonus } from '@/engine/core-hooks'
import { grappleSpots } from '@/engine/teams/kommandos'
import { validateRoster, validateTeamChoices } from '../../src/data'
import { loadBundle } from '../../src/data'
import { play } from '../fixtures/attack'
import { drive, place } from '../fixtures/helpers'
import { activateOp, edit, hasOption, openReal, opOf, optionIds, passIt, realBundle, realGame, realSetupWith, roster, take, withCtx } from '../fixtures/real'
import type { GameState } from '@/engine/types'

const data = loadBundle()
const pass = (p: { seat: 'A' | 'B'; id: string }) => ({ type: 'pass' as const, seat: p.seat, decisionId: p.id, payload: {} as Record<string, never> })
const noPloys = { 'ploy.firefight': pass }

function rulesVs(s: GameState, opId: string, weaponId: string, kind: 'shoot' | 'fight', targetId?: string): string[] {
  return effectiveRules(s, s.operatives[opId]!, s.data.weapons[weaponId]!, kind, targetId).map((r) => r.rule)
}

const tactics = (primary: string, secondary = 'aod.a.ct-hardy') => ({ A: { 'primary-tactic': `aod.a.ct-${primary}`, 'secondary-tactic': secondary.startsWith('aod') ? secondary : `aod.a.ct-${secondary}` }, B: {} })

describe('TEAM-AOD Angels of Death', () => {
  it('TEAM-AOD-001 roster validation: 1 leader and 5 others, only WARRIORs repeat, loadouts are enforced', () => {
    const team = data.teams['angels-of-death']!
    const cards = realBundle.datacards
    const ok = { leader: ['aod.intercessor-sergeant'], main: ['aod.intercessor-warrior', 'aod.intercessor-warrior', 'aod.assault-intercessor-warrior', 'aod.heavy-intercessor-gunner', 'aod.eliminator-sniper'] }
    expect(validateRoster(team, ok, cards as never).ok).toBe(true)
    expect(validateRoster(team, { ...ok, leader: ['aod.intercessor-sergeant', 'aod.space-marine-captain'] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: ['aod.eliminator-sniper', 'aod.eliminator-sniper', 'aod.intercessor-warrior', 'aod.heavy-intercessor-gunner', 'aod.intercessor-gunner'] }, cards as never).reasons.join()).toMatch(/only once/)
    expect(validateRoster(team, { ...ok, main: ok.main.slice(1) }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, leader: ['kom.boss-nob'] }, cards as never).ok).toBe(false)
    // the two tactics must differ and come from the Chapter Tactic group
    expect(validateTeamChoices(team, { 'primary-tactic': 'aod.a.ct-hardy', 'secondary-tactic': 'aod.a.ct-hardy' }, realBundle.abilities)).not.toEqual([])
    expect(validateTeamChoices(team, { 'primary-tactic': 'aod.a.ct-hardy', 'secondary-tactic': 'aod.a.astartes' }, realBundle.abilities)).not.toEqual([])
    // the engine refuses an illegal loadout, and a repeated tactic
    const bad = realSetupWith()
    bad.rosters.A[1] = { datacardId: 'aod.intercessor-warrior', loadout: { weaponIds: ['aod.w.bolt-pistol'] } }
    expect(() => createGame(bad, 's', realBundle)).toThrow(/legal loadouts/)
    const same = realSetupWith({ teamChoices: { A: { 'primary-tactic': 'aod.a.ct-hardy', 'secondary-tactic': 'aod.a.ct-hardy' }, B: {} } })
    expect(() => createGame(same, 's', realBundle)).toThrow(/must differ/)
  })

  it('TEAM-AOD-002 ASTARTES: two Shoot actions need a bolt weapon; the repeated sniper rifle or heavy bolter costs 1 more', () => {
    let s = openReal({ teamChoices: { A: { 'primary-tactic': 'aod.a.ct-mobile', 'secondary-tactic': 'aod.a.ct-resolute' }, B: {} } })
    const warrior = opOf(s, 'A', 'aod.intercessor-warrior')
    const boss = opOf(s, 'B', 'kom.boss-nob')
    s = edit(place(place(s, warrior, 0, 0), boss, 5, 0), (st) => {
      st.operatives[boss]!.wounds = st.operatives[boss]!.maxWounds = 60
      st.operatives[boss]!.save = 6
    })
    let t = activateOp(s, warrior)
    t = play(take(t, 'shoot').state, undefined, { ...noPloys, 'shoot.target': (p) => p.options!.find((o) => o.id === boss)?.action ?? null }).state
    expect(t.pending!.kind).toBe('firefight.action')
    expect(hasOption(t, 'shoot')).toBe(true) // the second Shoot of the activation
    t = play(take(t, 'shoot').state, undefined, { ...noPloys, 'shoot.target': (p) => p.options!.find((o) => o.id === boss)?.action ?? null }).state
    expect(t.firefight.activation!.performed.filter((a) => a === 'shoot')).toHaveLength(2)
    expect(t.firefight.activation!.apSpent).toBe(2)
    expect(hasOption(t, 'shoot')).toBe(false) // never a third
    // the Captain has plasma pistols and a power fist: no bolt weapon, so no second Shoot
    const cap = s.operatives[opOf(s, 'A', 'aod.space-marine-captain')]!
    const act = { operativeId: cap.id, seat: 'A' as const, counteract: false, stage: 'action' as const, apSpent: 1, performed: ['shoot'], declared: null }
    expect(actionAvailability(s, cap, 'shoot', act)?.code).toBe('E_ACTION_RESTRICTED')
    // the second Shoot with the same sniper rifle / heavy bolter costs 1 AP more (asked for by the weapon choice)
    const sniper = s.operatives[opOf(s, 'A', 'aod.eliminator-sniper')]!
    const sniperAct = { operativeId: sniper.id, seat: 'A' as const, counteract: false, stage: 'action' as const, apSpent: 1, performed: ['shoot'], declared: null, weaponsUsed: ['aod.w.bolt-sniper-rifle-executioner'] }
    expect(repeatSurcharge(s, sniper, sniperAct, 'aod.w.bolt-sniper-rifle-executioner')).toBe(1)
    expect(repeatSurcharge(s, sniper, sniperAct, 'aod.w.bolt-pistol')).toBe(0)
    expect(repeatSurcharge(s, sniper, { ...sniperAct, weaponsUsed: ['aod.w.bolt-pistol'] }, 'aod.w.bolt-sniper-rifle-executioner')).toBe(0)
  })

  it('TEAM-AOD-002b ASTARTES: two Fight actions in one activation', () => {
    let s = openReal({ teamChoices: { A: { 'primary-tactic': 'aod.a.ct-mobile', 'secondary-tactic': 'aod.a.ct-resolute' }, B: {} } })
    const warrior = opOf(s, 'A', 'aod.intercessor-warrior')
    const boss = opOf(s, 'B', 'kom.boss-nob')
    s = edit(place(place(s, warrior, 0, 0), boss, 1.5, 0), (st) => {
      st.operatives[boss]!.wounds = st.operatives[boss]!.maxWounds = 80
      st.operatives[warrior]!.wounds = st.operatives[warrior]!.maxWounds = 80
    })
    let t = activateOp(s, warrior)
    t = play(take(t, 'fight').state, undefined, noPloys).state
    expect(hasOption(t, 'fight')).toBe(true)
    t = play(take(t, 'fight').state, undefined, noPloys).state
    expect(t.firefight.activation!.performed).toEqual(['fight', 'fight'])
    expect(hasOption(t, 'fight')).toBe(false)
  })

  it('TEAM-AOD-003 an Angel of Death operative can counteract with a Conceal order; a Kommando cannot', () => {
    let s = openReal({ rosterA: roster(['aod.intercessor-warrior']), rosterB: roster(['kom.boss-nob', 'kom.boy']) })
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = activateOp(s, marine, 'conceal')
    s = take(s, 'end').state
    s = activateOp(s, opOf(s, 'B', 'kom.boss-nob'), 'conceal')
    s = take(s, 'end').state
    expect(s.pending).toMatchObject({ kind: 'firefight.activate', seat: 'A' })
    expect(hasOption(s, `counteract:${marine}`)).toBe(true)
  })

  it('TEAM-AOD-004 Combat Doctrine gives Balanced under the picked doctrine; Adjust Doctrine changes it', () => {
    let s = openReal({ teamChoices: { A: { 'primary-tactic': 'aod.a.ct-mobile', 'secondary-tactic': 'aod.a.ct-resolute' }, B: {} } })
    const warrior = opOf(s, 'A', 'aod.intercessor-warrior')
    const near = opOf(s, 'B', 'kom.boy')
    const far = opOf(s, 'B', 'kom.boss-nob')
    s = place(place(place(s, warrior, 0, 0), near, 4, 0), far, 9, 0)
    const bolt = 'aod.w.bolt-rifle'
    const withDoctrine = (d: string | null) =>
      edit(s, (st) => {
        st.config.A.doctrine = d
      })
    expect(rulesVs(withDoctrine(null), warrior, bolt, 'shoot', near)).not.toContain('balanced')
    expect(rulesVs(withDoctrine('devastator'), warrior, bolt, 'shoot', far)).toContain('balanced') // more than 6"
    expect(rulesVs(withDoctrine('devastator'), warrior, bolt, 'shoot', near)).not.toContain('balanced')
    expect(rulesVs(withDoctrine('tactical'), warrior, bolt, 'shoot', near)).toContain('balanced') // within 6"
    expect(rulesVs(withDoctrine('tactical'), warrior, bolt, 'shoot', far)).not.toContain('balanced')
    expect(rulesVs(withDoctrine('assault'), warrior, 'aod.w.fists', 'fight', near)).toContain('balanced')
    expect(rulesVs(withDoctrine('assault'), warrior, bolt, 'shoot', near)).not.toContain('balanced')
    // Kommandos are not Angels of Death
    expect(rulesVs(edit(s, (st) => (st.config.A.doctrine = 'assault')), near, 'kom.w.choppa', 'fight', warrior)).not.toContain('balanced')
    // Adjust Doctrine: offered after Combat Doctrine was used, changes the doctrine
    const used = edit(s, (st) => {
      st.config.A.doctrine = 'devastator'
      st.ledger.A.tp.push('aod.p.combat-doctrine')
      // keep the Captain engaged so Heroic Leader (c) does not make it free
      st.operatives[opOf(st, 'A', 'aod.space-marine-captain')]!.pos = { x: -8, y: 0, z: 0 }
      st.operatives[opOf(st, 'B', 'kom.grot')]!.pos = { x: -8, y: 0, z: 1.5 }
    })
    let t = activateOp(used, warrior)
    t = take(t, 'shoot').state
    expect(t.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A' })
    expect(optionIds(t).sort()).toEqual(['aod.p.adjust-doctrine:assault', 'aod.p.adjust-doctrine:tactical'])
    const cp = t.players.A.cp
    t = take(t, 'aod.p.adjust-doctrine:tactical').state
    expect(t.config.A.doctrine).toBe('tactical')
    expect(t.players.A.cp).toBe(cp - 1)
  })

  it('TEAM-AOD-005 Aggressive: melee weapons gain Rending', () => {
    const s = realGame({ teamChoices: tactics('aggressive') })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    expect(rulesVs(s, w, 'aod.w.fists', 'fight')).toContain('rending')
    expect(rulesVs(s, w, 'aod.w.bolt-rifle', 'shoot')).not.toContain('rending')
    expect(rulesVs(realGame(), w, 'aod.w.fists', 'fight')).not.toContain('rending')
  })

  it('TEAM-AOD-005 Dueller: normal successes block crits except against Brutal', () => {
    const s = realGame({ teamChoices: tactics('dueller') })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    expect(normalBlocksCrit(s, w, false)).toBe(true)
    expect(normalBlocksCrit(s, w, true)).toBe(false)
    expect(normalBlocksCrit(realGame(), w, false)).toBe(false)
  })

  it('TEAM-AOD-005 Resolute: ignores APL changes and Shock does not affect it', () => {
    const s = realGame({ teamChoices: tactics('resolute') })
    const w = s.operatives[opOf(s, 'A', 'aod.intercessor-warrior')]!
    expect(effectiveApl({ ...w, aplMods: -1 })).toBe(3)
    const boss = opOf(s, 'B', 'kom.boss-nob')
    expect(rulesVs(realGame(), boss, 'kom.w.power-klaw', 'fight', w.id)).toContain('shock')
    expect(rulesVs(s, boss, 'kom.w.power-klaw', 'fight', w.id)).not.toContain('shock')
    expect(rulesVs(s, boss, 'kom.w.power-klaw', 'fight', opOf(s, 'A', 'aod.heavy-intercessor-gunner'))).not.toContain('shock') // team-wide
  })

  it('TEAM-AOD-005 Stealthy: with a cover save retained, keep one more or one cover save as a crit; Camo Cloak adds both', () => {
    const s = realGame({ teamChoices: tactics('stealthy') })
    const warrior = opOf(s, 'A', 'aod.intercessor-warrior')
    const sniper = opOf(s, 'A', 'aod.eliminator-sniper')
    expect(stealthyLevel(s, s.operatives[warrior]!)).toBe(1)
    expect(stealthyLevel(s, s.operatives[sniper]!)).toBe(2) // team Stealthy plus Camo Cloak
    expect(stealthyLevel(realGame(), realGame().operatives[sniper]!)).toBe(2) // the default secondary tactic is Stealthy too
    expect(stealthyLevel(realGame({ teamChoices: tactics('hardy', 'aod.a.ct-mobile') }), realGame().operatives[sniper]!)).toBe(1) // Camo Cloak alone
    type D = { value: number | null; kind: 'fail' | 'normal' | 'crit'; rerolled: boolean; tag?: string }
    const dice = (): D[] => [
      { value: null, kind: 'normal', rerolled: false, tag: 'cover' },
      { value: 1, kind: 'fail', rerolled: false },
      { value: 2, kind: 'fail', rerolled: false },
    ]
    const run = (opId: string, d: D[] = dice()) => {
      runHook('afterDefenceRoll', { seat: 'A', state: s, operativeId: opId, targetId: opOf(s, 'B', 'kom.boy'), data: { kind: 'shoot', side: 'defence', dice: d, requests: [], choices: {} } })
      return d
    }
    // one source: a spare failure becomes an extra retained success
    expect(run(warrior).map((d) => d.kind)).toEqual(['normal', 'normal', 'fail'])
    // no failure to convert: the cover save becomes a crit instead
    const noFail: D[] = [{ value: null, kind: 'normal', rerolled: false, tag: 'cover' }, { value: 4, kind: 'normal', rerolled: false }]
    expect(run(warrior, noFail).map((d) => d.kind)).toEqual(['crit', 'normal'])
    // two sources (Camo Cloak with Stealthy): both at once
    expect(run(sniper).map((d) => d.kind)).toEqual(['crit', 'normal', 'fail'])
    // nothing without a retained cover save
    const open: D[] = [{ value: 1, kind: 'fail', rerolled: false }]
    expect(run(warrior, open).map((d) => d.kind)).toEqual(['fail'])
  })

  it('TEAM-AOD-005 Mobile: Fall Back costs 1 less AP and the operative may Charge from inside an enemy control range', () => {
    let s = openReal({ teamChoices: tactics('mobile') })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    const boy = opOf(s, 'B', 'kom.boy')
    const target = opOf(s, 'B', 'kom.burna-boy')
    s = place(place(place(s, w, 0, 0), boy, 1.6, 0), target, -1.2, 5)
    let t = activateOp(s, w)
    expect(t.pending!.options!.find((o) => o.id === 'fallBack')!.data!.cost).toBe(1)
    expect(hasOption(t, 'charge')).toBe(true) // in the Boy's control range, a Charge is still allowed
    // the Charge may leave the Boy's control range and end in another enemy's
    t = take(t, 'charge').state
    const p = t.pending!
    const r = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: -0.6, z: 3.4 }] } })
    expect(r.rejection).toBeUndefined()
    // without Mobile the same Charge is not offered at all
    const plain = activateOp(place(place(place(openReal(), opOf(s, 'A', 'aod.intercessor-warrior'), 0, 0), boy, 1.6, 0), target, -1.2, 5), w)
    expect(hasOption(plain, 'charge')).toBe(false)
  })

  it('TEAM-AOD-005 Hardy: defence results of 5+ are crits', () => {
    const s = realGame({ teamChoices: tactics('hardy', 'aod.a.ct-mobile') })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    const d = [3, 4, 5, 6].map((v) => ({ value: v, kind: v === 6 ? ('crit' as const) : ('normal' as const), rerolled: false }))
    runHook('afterDefenceRoll', { seat: 'A', state: s, operativeId: w, targetId: opOf(s, 'B', 'kom.boy'), data: { kind: 'shoot', side: 'defence', dice: d, requests: [], choices: {} } })
    expect(d.map((x) => x.kind)).toEqual(['normal', 'normal', 'crit', 'crit'])
    // it is a defence rule: attack dice are not touched
    const a = [{ value: 5, kind: 'normal' as const, rerolled: false }]
    runHook('afterAttackRoll', { seat: 'A', state: s, operativeId: w, targetId: opOf(s, 'B', 'kom.boy'), data: { kind: 'shoot', side: 'attack', dice: a, requests: [], choices: {} } })
    expect(a[0]!.kind).toBe('normal')
  })

  it('TEAM-AOD-005 Sharpshooter: bolt weapons gain Accurate 1 and Severe when shooting in an activation without Charge, Fall Back or Reposition', () => {
    const s = realGame({ teamChoices: tactics('sharpshooter') })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    const plain = (st: GameState) => rulesVs(st, w, 'aod.w.bolt-rifle', 'shoot')
    expect(plain(s)).toEqual(expect.arrayContaining(['accurate', 'severe']))
    // a pistol that is not a bolt weapon gets nothing (Captain's plasma pistol)
    expect(rulesVs(s, opOf(s, 'A', 'aod.space-marine-captain'), 'aod.w.plasma-pistol-standard', 'shoot')).not.toContain('severe')
    for (const prior of ['reposition', 'charge', 'fallBack']) {
      const t = edit(s, (st) => {
        st.firefight.activation = { operativeId: w, seat: 'A', counteract: false, stage: 'action', apSpent: 1, performed: [prior], declared: null }
      })
      expect(plain(t)).not.toContain('severe')
    }
    const dashed = edit(s, (st) => {
      st.firefight.activation = { operativeId: w, seat: 'A', counteract: false, stage: 'action', apSpent: 1, performed: ['dash'], declared: null }
    })
    expect(plain(dashed)).toContain('severe')
  })

  it('TEAM-AOD-005 Siege Specialist: ranged weapons gain Saturate and enemies cannot assist against it', () => {
    const s = realGame({ teamChoices: tactics('siege-specialist') })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    expect(rulesVs(s, w, 'aod.w.bolt-rifle', 'shoot')).toContain('saturate')
    expect(rulesVs(s, w, 'aod.w.fists', 'fight')).not.toContain('saturate')
    const boy = opOf(s, 'B', 'kom.boy')
    const data = { kind: 'fight' as const, atk: 4, hitDelta: -1, accurate: [], lethal: null, rerolls: [], assists: [opOf(s, 'B', 'kom.burna-boy')] }
    runHook('modifyAttackDice', { seat: 'B', state: s, operativeId: boy, targetId: w, weaponId: 'kom.w.choppa', data })
    expect(data.assists).toEqual([])
  })

  it('TEAM-AOD-006 Heroic Leader: a ploy that names the Captain costs 0 CP once per turning point; Doctrine Warfare discounts are once per battle', () => {
    const s = openReal({ rosterA: roster(['aod.space-marine-captain', 'aod.intercessor-sergeant', 'aod.assault-intercessor-sergeant']) })
    const cap = opOf(s, 'A', 'aod.space-marine-captain')
    const info = { window: 'shoot.defenceRolled', subjectId: cap }
    const offers = offersFor(s, 'A', 'shoot.defenceRolled', info)
    expect(offers.find((o) => o.ployId === 'aod.p.transhuman-physiology')).toBeUndefined() // no normal success to upgrade yet
    const free = edit(s, () => undefined)
    // price check through a Shock Assault window for the Captain (activation includes a Charge)
    free.firefight.activation = { operativeId: cap, seat: 'A', counteract: false, stage: 'action', apSpent: 1, performed: ['charge'], declared: null }
    const sa = offersFor(free, 'A', 'fight.rolled', { window: 'fight.rolled', subjectId: cap, attackerId: cap, targetId: opOf(s, 'B', 'kom.boy'), kind: 'fight' }).find((o) => o.ployId === 'aod.p.shock-assault')
    expect(sa).toMatchObject({ cost: 0, via: 'heroicLeader' })
    const spent = edit(free, (st) => {
      st.ledger.A.tp.push('aod.a.heroic-leader')
    })
    expect(offersFor(spent, 'A', 'fight.rolled', { window: 'fight.rolled', subjectId: cap, attackerId: cap, targetId: opOf(s, 'B', 'kom.boy'), kind: 'fight' }).find((o) => o.ployId === 'aod.p.shock-assault')).toMatchObject({ cost: 1 })
    // Doctrine Warfare: the Sergeants make Combat Doctrine free for their doctrines, once per battle each
    const g = gambitOffers(s, 'A')
    const cost = (d: string) => g.find((o) => o.gambitId === 'aod.p.combat-doctrine' && o.param === d)!.cost
    expect([cost('assault'), cost('tactical'), cost('devastator')]).toEqual([0, 0, 0]) // both sergeants are present
    const used = edit(s, (st) => {
      for (const op of Object.values(st.operatives)) if (op.seat === 'A') op.oncePerBattleUsed.push('dw:assault', 'dw:tactical', 'dw:devastator')
    })
    const g2 = gambitOffers(used, 'A')
    expect(g2.find((o) => o.gambitId === 'aod.p.combat-doctrine' && o.param === 'assault')!.cost).toBe(1)
    // only the sergeant of the matching squad covers its doctrine
    const onlyAssault = openReal({ rosterA: roster(['aod.assault-intercessor-sergeant', 'aod.intercessor-warrior']) })
    const g3 = gambitOffers(onlyAssault, 'A')
    expect(g3.find((o) => o.gambitId === 'aod.p.combat-doctrine' && o.param === 'devastator')!.cost).toBe(1)
    expect(g3.find((o) => o.gambitId === 'aod.p.combat-doctrine' && o.param === 'assault')!.cost).toBe(0)
  })

  it('TEAM-AOD-006b using a Doctrine Warfare discount spends that doctrine once; the Captain makes Adjust Doctrine free', () => {
    let s = openReal({ rosterA: roster(['aod.space-marine-captain', 'aod.assault-intercessor-sergeant']) })
    s = edit(s, () => undefined)
    // the gambit step is already over in this state: play the gambit directly through the ploy rules
    const sgt = opOf(s, 'A', 'aod.assault-intercessor-sergeant')
    const offer = gambitOffers(s, 'A').find((o) => o.gambitId === 'aod.p.combat-doctrine' && o.param === 'assault')!
    expect(offer.via).toMatch(/^doctrineWarfare:/)
    return import('@/engine/ploys').then(({ usePloy }) => {
      return import('../fixtures/real').then(({ withCtx }) => {
        const r = withCtx(s, (ctx) => usePloy(ctx, 'A', offer, { window: 'strategy.gambit' }))
        expect(r.state.operatives[sgt]!.oncePerBattleUsed).toContain('dw:assault')
        expect(r.state.players.A.cp).toBe(s.players.A.cp) // free
        expect(r.state.config.A.doctrine).toBe('assault')
        const again = gambitOffers(edit(r.state, (st) => st.ledger.A.tp.splice(0)), 'A').find((o) => o.gambitId === 'aod.p.combat-doctrine' && o.param === 'assault')!
        expect(again.cost).toBe(1)
        // Adjust Doctrine is free for the Captain when it is out of enemy control range (Heroic Leader c)
        const adj = offersFor(edit(r.state, () => undefined), 'A', 'firefight.actionEnded', { window: 'firefight.actionEnded', subjectId: sgt }).find((o) => o.ployId === 'aod.p.adjust-doctrine')
        expect(adj).toMatchObject({ cost: 0, via: 'heroicLeader' })
      })
    })
  })

  it('TEAM-AOD-007 Iron Halo ignores one Normal Dmg hit once per battle', () => {
    const s = realGame()
    const cap = opOf(s, 'A', 'aod.space-marine-captain')
    const hit = (st: GameState, source: string) => {
      const d = { source, attackerId: opOf(st, 'B', 'kom.boy'), weaponId: 'kom.w.slugga', amount: 3 }
      runHook('onDamageInflicted', { seat: 'A', state: st, operativeId: cap, targetId: d.attackerId, weaponId: d.weaponId, data: d })
      return d.amount
    }
    expect(hit(s, 'crit')).toBe(3) // a crit is not ignored
    const first = edit(s, () => undefined)
    expect(hit(first, 'normal')).toBe(0)
    expect(first.operatives[cap]!.oncePerBattleUsed).toContain('aod.a.iron-halo')
    expect(hit(first, 'strike-normal')).toBe(3) // once per battle
    // only the Captain has it
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    const d = { source: 'normal', attackerId: 'x', weaponId: null, amount: 3 }
    runHook('onDamageInflicted', { seat: 'A', state: s, operativeId: marine, data: d })
    expect(d.amount).toBe(3)
  })

  it('TEAM-AOD-008 Camo Cloak ignores Saturate; OPTICS stops obscured until the next activation', () => {
    const s = realGame()
    const sniper = opOf(s, 'A', 'aod.eliminator-sniper')
    const boy = opOf(s, 'B', 'kom.boy')
    // the Burna's flamer has Saturate: against the Eliminator it does not
    expect(rulesVs(s, boy, 'kom.w.burna-standard', 'shoot', sniper)).not.toContain('saturate')
    expect(rulesVs(s, boy, 'kom.w.burna-standard', 'shoot', opOf(s, 'A', 'aod.intercessor-warrior'))).toContain('saturate')
    // OPTICS
    let t = activateOp(openReal(), opOf(openReal(), 'A', 'aod.eliminator-sniper'))
    t = take(t, 'ability:aod.a.optics').state
    const data = { obscured: true, inCover: false }
    runHook('target.status', { seat: 'A', state: t, operativeId: sniper, targetId: boy, data: data as never })
    expect(data.obscured).toBe(false)
    const other = { obscured: true, inCover: false }
    runHook('target.status', { seat: 'A', state: t, operativeId: opOf(t, 'A', 'aod.intercessor-warrior'), targetId: boy, data: other as never })
    expect(other.obscured).toBe(true)
    // it ends when the Eliminator activates again
    const next = edit(t, (st) => {
      st.effects = st.effects.filter((e) => e.expires !== `startOfActivation:${sniper}`)
    })
    const after = { obscured: true, inCover: false }
    runHook('target.status', { seat: 'A', state: next, operativeId: sniper, targetId: boy, data: after as never })
    expect(after.obscured).toBe(true)
  })

  it('TEAM-AOD-009 the Grenadier throws frag and krak with Hit improved by 1, separately from the team uses', () => {
    const s = realGame({ equipmentA: ['core.e.explosive-grenades'], equipmentChoices: { A: { 'core.e.explosive-grenades': ['core.w.frag-grenade', 'core.w.krak-grenade'] }, B: {} } })
    const grenadier = opOf(s, 'A', 'aod.assault-intercessor-grenadier')
    const warrior = opOf(s, 'A', 'aod.intercessor-warrior')
    const hit = (id: string) => {
      const d = { kind: 'shoot' as const, atk: 4, hitDelta: 0, accurate: [], lethal: null, rerolls: [], assists: [] }
      runHook('modifyAttackDice', { seat: 'A', state: s, operativeId: id, targetId: opOf(s, 'B', 'kom.boy'), weaponId: 'core.w.frag-grenade', data: d })
      return d.hitDelta
    }
    expect(hit(grenadier)).toBe(-1) // 4+ becomes 3+
    expect(hit(warrior)).toBe(0)
    // without the equipment the Grenadier still carries both grenades
    const bare = realGame()
    expect(bare.operatives[opOf(bare, 'A', 'aod.assault-intercessor-grenadier')]!.weapons).toEqual(expect.arrayContaining(['core.w.frag-grenade', 'core.w.krak-grenade']))
    expect(bare.operatives[opOf(bare, 'A', 'aod.intercessor-warrior')]!.weapons).not.toContain('core.w.frag-grenade')
  })

  it('TEAM-AOD-010 stats, bases and weapon profiles match the team tables', () => {
    const rows: [string, number, number, number, number, number][] = [
      // id, APL, move, save, wounds, base
      ['aod.space-marine-captain', 3, 6, 3, 15, 40],
      ['aod.assault-intercessor-sergeant', 3, 6, 3, 15, 32],
      ['aod.intercessor-sergeant', 3, 6, 3, 15, 32],
      ['aod.assault-intercessor-grenadier', 3, 6, 3, 14, 32],
      ['aod.assault-intercessor-warrior', 3, 6, 3, 14, 32],
      ['aod.intercessor-gunner', 3, 6, 3, 14, 32],
      ['aod.intercessor-warrior', 3, 6, 3, 14, 32],
      ['aod.heavy-intercessor-gunner', 3, 5, 3, 18, 40],
      ['aod.eliminator-sniper', 3, 7, 3, 12, 40],
    ]
    for (const [id, apl, move, save, wounds, base] of rows) expect(realBundle.datacards[id]).toMatchObject({ apl, move, save, wounds, baseMm: base })
    const w = realBundle.weapons
    const prof = (id: string, atk: number, hit: number, n: number, c: number, rules: string[]) => {
      expect(w[id], id).toMatchObject({ atk, hit, dmg: { normal: n, crit: c } })
      expect(w[id]!.rules.map((r) => r.rule).sort()).toEqual([...rules].sort())
    }
    prof('aod.w.hand-flamer', 4, 2, 3, 3, ['range', 'saturate', 'torrent'])
    prof('aod.w.heavy-bolt-pistol', 4, 3, 3, 4, ['range', 'piercing'])
    prof('aod.w.plasma-pistol-supercharge', 4, 3, 4, 5, ['range', 'hot', 'lethal', 'piercing'])
    prof('aod.w.stalker-bolt-rifle-heavy', 4, 3, 3, 5, ['heavy', 'lethal', 'piercing'])
    prof('aod.w.aux-grenade-launcher-krak', 4, 3, 4, 5, ['piercing'])
    prof('aod.w.heavy-bolter-focused', 5, 3, 4, 5, ['piercing'])
    prof('aod.w.bolt-sniper-rifle-mortis', 4, 2, 3, 3, ['devastating', 'heavy', 'piercing', 'silent'])
    prof('aod.w.power-fist-captain', 5, 3, 5, 7, ['brutal'])
    prof('aod.w.thunder-hammer-intercessor', 4, 4, 5, 6, ['shock', 'stun'])
    prof('aod.w.fists', 4, 3, 3, 4, [])
    void ScriptedRng
    void actionCost
  })
})

describe('TEAM-AOD ploys, Chapter Veteran and faction equipment', () => {
  const NEUTRAL = { teamChoices: tactics('mobile', 'aod.a.ct-resolute') }

  it('Chapter Veteran: a Sergeant records one extra Chapter Tactic for the battle', () => {
    const picked = realGame({ rosterA: [{ datacardId: 'aod.intercessor-sergeant', loadout: { weaponIds: ['aod.w.bolt-rifle', 'aod.w.fists'] }, chapterVeteran: 'aod.a.ct-hardy' }, ...roster(['aod.intercessor-warrior'])] })
    const sgt = picked.operatives[opOf(picked, 'A', 'aod.intercessor-sergeant')]!
    expect(activeTactics(picked, sgt)).toEqual(['aod.a.ct-sharpshooter', 'aod.a.ct-stealthy', 'aod.a.ct-hardy'])
    expect(activeTactics(picked, picked.operatives[opOf(picked, 'A', 'aod.intercessor-warrior')]!)).toEqual(['aod.a.ct-sharpshooter', 'aod.a.ct-stealthy'])
    // the extra pick is the Sergeant's own: Hardy applies only to it
    const d = [{ value: 5, kind: 'normal' as const, rerolled: false }]
    runHook('afterDefenceRoll', { seat: 'A', state: picked, operativeId: opOf(picked, 'A', 'aod.intercessor-warrior'), targetId: opOf(picked, 'B', 'kom.boy'), data: { kind: 'shoot', side: 'defence', dice: d, requests: [], choices: {} } })
    expect(d[0]!.kind).toBe('normal')
    // without a pick the engine chooses the first tactic the team lacks
    const dflt = realGame({ rosterA: roster(['aod.assault-intercessor-sergeant', 'aod.intercessor-warrior']) })
    expect(activeTactics(dflt, dflt.operatives[opOf(dflt, 'A', 'aod.assault-intercessor-sergeant')]!)).toHaveLength(3)
    // a non-sergeant cannot have one
    const bad = realSetupWith()
    bad.rosters.A[3] = { ...bad.rosters.A[3]!, chapterVeteran: 'aod.a.ct-hardy' }
    expect(() => createGame(bad, 's', realBundle)).toThrow(/Chapter Veteran/)
  })

  it('Indomitus: with two failed defence dice discard one and keep another as a normal success', () => {
    const first = take(realGameAtGambit(), 'aod.p.indomitus').state
    expect(first.effects.some((e) => e.source === 'aod.p.indomitus' && e.seat === 'A')).toBe(true)
    const w = opOf(first, 'A', 'aod.intercessor-warrior')
    const dice = [1, 2, 6].map((v) => ({ value: v as number | null, kind: v === 6 ? ('crit' as const) : ('fail' as const), rerolled: false, used: undefined as boolean | undefined }))
    runHook('afterDefenceRoll', { seat: 'A', state: first, operativeId: w, targetId: opOf(first, 'B', 'kom.boy'), data: { kind: 'shoot', side: 'defence', dice, requests: [], choices: {} } })
    expect(dice.map((d) => d.kind)).toEqual(['normal', 'fail', 'crit'])
    expect(dice[1]!.used).toBe(true) // the other failure is discarded
    // one failure only: nothing happens
    const one = [{ value: 1 as number | null, kind: 'fail' as const, rerolled: false }]
    runHook('afterDefenceRoll', { seat: 'A', state: first, operativeId: w, targetId: opOf(first, 'B', 'kom.boy'), data: { kind: 'shoot', side: 'defence', dice: one, requests: [], choices: {} } })
    expect(one[0]!.kind).toBe('fail')
  })

  it('And They Shall Know No Fear: injured Angels of Death ignore the Move and Hit penalties for the turning point', () => {
    const g = take(realGameAtGambit(), 'aod.p.and-they-shall-know-no-fear').state
    const w = g.operatives[opOf(g, 'A', 'aod.intercessor-warrior')]!
    expect(w.flags.ignoreInjured).toBe(true)
    const hurt = edit(g, (st) => {
      st.operatives[w.id]!.wounds = 3
    })
    // INJ-001 core rules: injured worsens Hit by 1; ignoring that removes the penalty and never improves Hit
    const boy = opOf(g, 'B', 'kom.boy')
    const printed = realBundle.weapons['aod.w.bolt-rifle']!.hit
    const need = (st: GameState) => attackStats(st, w.id, 'aod.w.bolt-rifle', boy, { kind: 'shoot' }).need
    expect(need(hurt)).toBe(printed) // the +1 injury penalty is cancelled, nothing more
    const plain = edit(hurt, (st) => {
      delete st.operatives[w.id]!.flags.ignoreInjured
    })
    expect(need(plain)).toBe(printed + 1)
    const fresh = edit(g, (st) => {
      st.operatives[w.id]!.wounds = st.operatives[w.id]!.maxWounds
    })
    expect(need(fresh)).toBe(printed) // not injured: nothing to ignore
    expect(g.operatives[opOf(g, 'B', 'kom.boy')]!.flags.ignoreInjured).toBeUndefined()
  })

  it('Purity Seals: once per turning point, two failed attack dice become a retained normal and a discard', () => {
    const s = realGame({ equipmentA: ['aod.e.purity-seals'] })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    type Die = { value: number | null; kind: 'fail' | 'normal' | 'crit'; rerolled: boolean; used?: boolean }
    const mk = (): Die[] => [1, 2, 6].map((v) => ({ value: v, kind: v === 6 ? ('crit' as const) : ('fail' as const), rerolled: false }))
    const run = (st: GameState, dice: Die[]) =>
      withCtxHook(st, (ctx) => runHook('afterAttackRoll', { seat: 'A', state: ctx.state, engine: ctx, operativeId: w, targetId: opOf(st, 'B', 'kom.boy'), data: { kind: 'shoot', side: 'attack', dice, requests: [], choices: {} } }))
    const d1 = mk()
    const r1 = run(s, d1)
    expect(d1.map((d) => d.kind)).toEqual(['normal', 'fail', 'crit'])
    expect(r1.ledger.A.tpUses['aod.e.purity-seals']).toBe(1)
    const d2 = mk()
    run(r1, d2)
    expect(d2.map((d) => d.kind)).toEqual(['fail', 'fail', 'crit']) // spent for this turning point
    // only teams that selected the equipment
    const none = mk()
    run(realGame(), none)
    expect(none.map((d) => d.kind)).toEqual(['fail', 'fail', 'crit'])
  })

  it('Auspex: once per turning point, a Shoot by an Angel of Death means enemies within 8" cannot be obscured', () => {
    let s = openReal({ ...NEUTRAL, equipmentA: ['aod.e.auspex'] })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    const boy = opOf(s, 'B', 'kom.boy')
    s = place(place(s, w, 0, 0), boy, 5, 0)
    let t = activateOp(s, w)
    t = take(t, 'shoot').state
    expect(t.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A' })
    expect(t.pending!.options!.map((o) => o.id)).toContain('aod.e.auspex')
    expect(t.pending!.options!.find((o) => o.id === 'aod.e.auspex')!.data).toMatchObject({ cost: 0 })
    t = take(t, 'aod.e.auspex').state
    expect(t.ledger.A.tp).toContain('aod.e.auspex')
    const near = { obscured: true, inCover: false }
    runHook('target.status', { seat: 'A', state: t, operativeId: w, targetId: boy, data: near as never })
    expect(near.obscured).toBe(false)
    const farBoy = edit(t, (st) => {
      st.operatives[boy]!.pos = { x: 11, y: 0, z: 0 }
    })
    const far = { obscured: true, inCover: false }
    runHook('target.status', { seat: 'A', state: farBoy, operativeId: w, targetId: boy, data: far as never })
    expect(far.obscured).toBe(true) // beyond 8"
  })

  it('Tilting Shields: once per turning point the opponent cannot make crits from results under 6 against the shielded fighter', () => {
    const s = realGame({ equipmentA: ['aod.e.tilting-shields'] })
    const w = opOf(s, 'A', 'aod.intercessor-warrior')
    const slasha = opOf(s, 'B', 'kom.slasha-boy')
    const rules = (st: GameState) => rulesVs(st, slasha, 'kom.w.twin-choppas', 'fight', w)
    expect(rules(realGame())).toContain('lethal')
    // a query (no step context) sees the effect without consuming it
    expect(rules(s)).not.toContain('lethal')
    expect(s.ledger.A.tpUses['aod.e.tilting-shields']).toBeUndefined()
    // inside a step the first use is consumed and lasts for the rest of the action
    const used = withCtxHook(s, (ctx) => {
      const data = { kind: 'fight', targetId: w, rules: realBundle.weapons['kom.w.twin-choppas']!.rules.map((r) => ({ ...r })) }
      runHook('modifyWeaponRules', { seat: 'B', state: ctx.state, engine: ctx, operativeId: slasha, weaponId: 'kom.w.twin-choppas', targetId: w, data })
      expect(data.rules.some((r) => r.rule === 'lethal')).toBe(false)
    })
    expect(used.ledger.A.tpUses['aod.e.tilting-shields']).toBe(1)
    expect(rules(used)).not.toContain('lethal') // still active this action
    const later = edit(used, (st) => {
      st.effects = []
    })
    expect(rules(later)).toContain('lethal') // spent: the next fight is unprotected
  })

  it('Shock Assault: in an activation with a Charge the fighter gains Shock and the first strike deals 1 extra (cap 7)', () => {
    const run = (ploy: boolean) => {
      let s = openReal(NEUTRAL)
      const w = opOf(s, 'A', 'aod.intercessor-warrior')
      const boy = opOf(s, 'B', 'kom.boy')
      s = edit(place(place(s, w, 0, 0), boy, 4, 0), (st) => {
        st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
        st.operatives[w]!.wounds = st.operatives[w]!.maxWounds = 40
      })
      let t = activateOp(s, w)
      t = take(t, 'charge').state
      const p = t.pending!
      t = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 2.2, z: 0 }] } }).state
      t = take(t, 'fight').state
      // marine fists: 6 (crit) 4 (normal) 2 1; boy choppa: all fail
      const r = play(t, new ScriptedRng([6, 4, 2, 1, 1, 1, 1, 1]), {
        'ploy.firefight': (q) => {
          const o = ploy ? q.options!.find((x) => (x.action.payload as { ployId: string }).ployId === 'aod.p.shock-assault') : undefined
          return o ? o.action : pass(q)
        },
      })
      return r.events.filter((e) => e.type === 'Struck').map((e) => (e as { amount: number }).amount)
    }
    const plain = run(false)
    const shocked = run(true)
    expect(plain[0]).toBe(4) // fists crit damage
    expect(shocked[0]).toBe(5) // +1 on the first strike only
    expect(shocked.slice(1)).toEqual(plain.slice(1))
  })
})

/** Run hook code that needs a step context; returns the resulting state. */
function withCtxHook(s: GameState, f: (ctx: import('@/engine/registry').Ctx) => void): GameState {
  return withCtx(s, f).state
}

function realGameAtGambit(): GameState {
  const first = createGame(realSetupWith(), 'g', realBundle).state
  return drive(first, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
}

// ---------------------------------------------------------------------------
// Kommandos
// ---------------------------------------------------------------------------

describe('TEAM-KOM Kommandos', () => {
  const KOM_NEUTRAL = { teamChoices: tactics('mobile', 'aod.a.ct-hardy') }
  const noTarget = (p: { options?: { id: string; action: never }[] }, id: string) => p.options?.find((o) => o.id === id)?.action ?? null

  it('TEAM-KOM-001 roster validation: Boss Nob plus 9 selections, only BOY repeats, Squig and Grot are half selections', () => {
    const team = data.teams['kommandos']!
    const cards = realBundle.datacards
    const ten = { leader: ['kom.boss-nob'], main: ['kom.boy', 'kom.boy', 'kom.boy', 'kom.breacha-boy', 'kom.burna-boy', 'kom.comms-boy', 'kom.dakka-boy', 'kom.rokkit-boy', 'kom.slasha-boy'] }
    expect(validateRoster(team, ten, cards as never).ok).toBe(true)
    // the Squig and the Grot together count as one selection: 11 operatives
    const eleven = { leader: ['kom.boss-nob'], main: ['kom.bomb-squig', 'kom.grot', 'kom.boy', 'kom.breacha-boy', 'kom.burna-boy', 'kom.comms-boy', 'kom.dakka-boy', 'kom.rokkit-boy', 'kom.slasha-boy', 'kom.snipa-boy'] }
    expect(validateRoster(team, eleven, cards as never).ok).toBe(true)
    // a lone Squig counts as a whole selection
    const lone = { leader: ['kom.boss-nob'], main: ['kom.bomb-squig', 'kom.boy', 'kom.boy', 'kom.breacha-boy', 'kom.burna-boy', 'kom.comms-boy', 'kom.dakka-boy', 'kom.rokkit-boy', 'kom.slasha-boy'] }
    expect(validateRoster(team, lone, cards as never).ok).toBe(true)
    expect(validateRoster(team, { ...ten, main: [...ten.main.slice(0, 8), 'kom.dakka-boy'] }, cards as never).ok).toBe(false) // a second Dakka Boy
    expect(validateRoster(team, { ...ten, main: ten.main.slice(1) }, cards as never).ok).toBe(false)
    expect(Object.values(realGame().operatives).filter((o) => o.seat === 'B')).toHaveLength(11)
  })

  it('TEAM-KOM-002 THROAT SLITTAS: Kommandos (not the Squig) can Charge with a Conceal order and keep it', () => {
    let s = openReal(KOM_NEUTRAL)
    const boy = opOf(s, 'B', 'kom.boy')
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = edit(place(place(s, boy, 0, 0), marine, 3.5, 0), (st) => {
      st.firefight.turn = 'B'
    })
    // B on turn: A ends an activation first so that B can start
    let t = activateOp(s, opOf(s, 'A', 'aod.eliminator-sniper'))
    t = take(t, 'end').state
    t = activateOp(t, boy, 'conceal')
    expect(hasOption(t, 'charge')).toBe(true)
    t = take(t, 'charge').state
    const p = t.pending!
    t = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 1.9, z: 0 }] } }).state
    expect(t.operatives[boy]!.order).toBe('conceal')
    expect(t.firefight.activation!.performed).toEqual(['charge'])
    // the Squig cannot (and Angels of Death still cannot)
    const squig = s.operatives[opOf(s, 'B', 'kom.bomb-squig')]!
    expect(actionAvailability(s, { ...squig, order: 'conceal' }, 'charge', null)?.code).toBe('E_ACTION_RESTRICTED')
    expect(actionAvailability(s, { ...s.operatives[marine]!, order: 'conceal' }, 'charge', null)?.code).toBe('E_ACTION_RESTRICTED')
  })

  it("TEAM-KOM-003 Bomb Squig: Explosives may be shot in an enemy control range with the Squig itself as primary target", () => {
    let s = openReal(KOM_NEUTRAL)
    const squig = opOf(s, 'B', 'kom.bomb-squig')
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = place(place(s, squig, 0, 0), marine, 1.5, 0)
    // B's turn: let A end first
    let t = activateOp(s, opOf(s, 'A', 'aod.eliminator-sniper'))
    t = take(t, 'end').state
    t = activateOp(t, squig)
    expect(hasOption(t, 'shoot')).toBe(true) // in an enemy control range, which forbids Shoot for everyone else
    expect(hasOption(t, 'guard')).toBe(false) // Stoopid: only Charge, Dash, Fight, Reposition, Shoot
    expect(hasOption(t, 'fallBack')).toBe(false)
    t = take(t, 'shoot').state
    const r = play(t, undefined, { ...noPloys })
    const started = r.events.find((e) => e.type === 'ShootStarted') as { weaponId: string } | undefined
    expect(started?.weaponId).toBe('kom.w.explosives')
    expect(r.events.find((e) => e.type === 'TargetSelected')).toMatchObject({ operativeId: squig, targetId: squig })
    // Blast 1" reaches the Marine beside it
    expect(r.events.filter((e) => e.type === 'TargetSelected').map((e) => (e as { targetId: string }).targetId)).toContain(marine)
    // Limited 1: the Explosives are used up
    expect(r.state.operatives[squig]?.usedLimited['kom.w.explosives'] ?? 1).toBe(1)
  })

  it('TEAM-KOM-003b Boom!: an incapacitated Squig that never exploded rolls two dice; a 4+ is a free Explosives shot before removal', () => {
    const s = openReal(KOM_NEUTRAL)
    const squig = opOf(s, 'B', 'kom.bomb-squig')
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    const near = edit(place(place(s, squig, 0, 0), marine, 1.5, 0), (st) => {
      st.operatives[squig]!.wounds = 0
    })
    // boom roll 4 and 1; then the Squig's attack 6,6,5,5,1,1 (an incapacitated Squig is injured: Hit 5+) against the Marine's defence 1,1,1
    const r = withCtx(near, (ctx) => removeNow(ctx, squig), new ScriptedRng([4, 1, 6, 6, 5, 5, 1, 1, 1, 1, 1]))
    expect(r.events.some((e) => e.type === 'AbilityUsed' && (e as { abilityId: string }).abilityId === 'kom.a.boom')).toBe(true)
    expect(r.state.operatives[squig]!.status).toBe('removed')
    expect(r.state.operatives[marine]!.wounds).toBe(0) // 2 crits (5) and 2 normals (4) = 18 >= 14
    expect(r.state.operatives[marine]!.status).toBe('removed')
    // a failed roll: no explosion
    const quiet = withCtx(near, (ctx) => removeNow(ctx, squig), new ScriptedRng([3, 2]))
    expect(quiet.state.operatives[marine]!.wounds).toBe(14)
    expect(quiet.state.operatives[squig]!.status).toBe('removed')
    // already used its explosives: nothing
    const used = edit(near, (st) => {
      st.operatives[squig]!.usedLimited['kom.w.explosives'] = 1
    })
    const none = withCtx(used, (ctx) => removeNow(ctx, squig), new ScriptedRng([6, 6]))
    expect(none.state.operatives[marine]!.wounds).toBe(14)
  })

  it('TEAM-KOM-004 Stoopid and Expendable: no Conceal, only five actions, ignored by the kill op', () => {
    const s = openReal()
    const squig = s.operatives[opOf(s, 'B', 'kom.bomb-squig')]!
    expect(squig.order).toBe('engage')
    expect(allowedOrders(s, squig)).toEqual(['engage'])
    for (const a of ['guard', 'fallBack']) {
      const act = { operativeId: squig.id, seat: 'B' as const, counteract: false, stage: 'action' as const, apSpent: 0, performed: [], declared: null }
      expect(actionAvailability(s, squig, a, act)?.code).toBe('E_ACTION_RESTRICTED')
    }
    expect(realBundle.datacards['kom.bomb-squig']!.expendable).toBe(true)
    expect(s.mission!.startCount.B).toBe(10)
  })

  it('TEAM-KOM-005 Sneaky Zogger: a Grot in cover cannot be selected, even by Seek, except within 2"', () => {
    let s = openReal(KOM_NEUTRAL)
    const grot = opOf(s, 'B', 'kom.grot')
    const sniper = opOf(s, 'A', 'aod.eliminator-sniper')
    // a Light barricade within 1" of the Grot, between it and the shooter
    const wall = { id: 'wall', parts: [{ id: 'wall.0', footprint: [{ x: -1.4, z: -3 }, { x: -1, z: -3 }, { x: -1, z: 3 }, { x: -1.4, z: 3 }], height: 0.8, traits: ['light' as const] }] }
    s = edit(s, (st) => {
      st.map = { ...st.map, features: [wall] }
    })
    s = place(place(s, grot, 0, 0), sniper, -9, 0)
    const executioner = 'aod.w.bolt-sniper-rifle-executioner' // Seek Light, Saturate
    const targets = (st: GameState, sid: string, wid: string) => validTargets(st, st.operatives[sid]!, wid).map((t) => t.id)
    // the wall is Light terrain: Seek Light lets the shooter select a Conceal target behind it
    const boy = opOf(s, 'B', 'kom.boy')
    const withBoy = place(s, boy, 0.2, 2)
    expect(targets(withBoy, sniper, executioner)).toContain(boy)
    // ... but never the Grot
    expect(targets(s, sniper, executioner)).not.toContain(grot)
    // within 2" of the shooter it can be selected
    const close = place(s, sniper, -2.6, 0)
    expect(targets(close, sniper, executioner)).toContain(grot)
    // in the open it is a normal target
    const open = edit(s, (st) => {
      st.map = { ...st.map, features: [] }
    })
    expect(targets(open, sniper, executioner)).toContain(grot)
  })

  it('TEAM-KOM-006 GRAPPLING HOOK: the Grot is set up within 1" of a visible point on a feature; treated as a Reposition', () => {
    let s = openReal(KOM_NEUTRAL)
    const grot = opOf(s, 'B', 'kom.grot')
    const tower = {
      id: 'tower',
      parts: [{ id: 'tower.0', footprint: [{ x: 2, z: -2 }, { x: 5, z: -2 }, { x: 5, z: 2 }, { x: 2, z: 2 }], height: 3, traits: ['vantage' as const] }],
    }
    s = edit(place(s, grot, -0.5, 0), (st) => {
      st.map = { ...st.map, features: [tower] }
    })
    let t = activateOp(place(s, opOf(s, 'A', 'aod.eliminator-sniper'), -13, 9), opOf(s, 'A', 'aod.eliminator-sniper'))
    t = take(t, 'end').state
    t = activateOp(t, grot, 'conceal')
    expect(hasOption(t, 'ability:kom.a.grappling-hook')).toBe(true)
    t = take(t, 'ability:kom.a.grappling-hook').state
    expect(t.pending).toMatchObject({ kind: 'ability.choice', canPass: true })
    const spots = t.pending!.options!.map((o) => o.data as { x: number; y: number; z: number })
    expect(spots.length).toBeGreaterThan(0)
    expect(spots.length).toBeLessThanOrEqual(16)
    // every spot is on a roof or the floor within 1" of the feature
    for (const sp of spots) expect(distToPolygon(sp, tower.parts[0]!.footprint)).toBeLessThanOrEqual(1 + 1e-6)
    const roof = t.pending!.options!.find((o) => (o.data as { y: number }).y === 3)
    expect(roof).toBeDefined()
    const from = t.operatives[grot]!.pos
    t = take(t, roof!.id).state
    expect(t.operatives[grot]!.pos.y).toBe(3)
    expect(Math.hypot(t.operatives[grot]!.pos.x - from.x, t.operatives[grot]!.pos.z - from.z)).toBeGreaterThan(1)
    // treated as a Reposition: no second Reposition, no Charge, Fall Back is not available either
    expect(t.firefight.activation!.performed).toEqual(['ability:kom.a.grappling-hook', 'reposition'])
    expect(optionIds(t)).not.toContain('reposition')
    expect(t.firefight.activation!.apSpent).toBe(1)
  })

  it('TEAM-KOM-006b while counteracting the Grot must be set up wholly within 2"', () => {
    let s = openReal({ rosterB: roster(['kom.boss-nob', 'kom.grot']), rosterA: roster(['aod.intercessor-warrior']), ...KOM_NEUTRAL })
    const grot = opOf(s, 'B', 'kom.grot')
    const tower = {
      id: 'tower',
      parts: [{ id: 'tower.0', footprint: [{ x: 2, z: -2 }, { x: 5, z: -2 }, { x: 5, z: 2 }, { x: 2, z: 2 }], height: 3, traits: ['vantage' as const] }],
    }
    s = edit(place(s, grot, 0.2, 0), (st) => {
      st.map = { ...st.map, features: [tower] }
    })
    const spots = withCtx(edit(s, (st) => {
      st.firefight.activation = { operativeId: grot, seat: 'B', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }
    }), () => undefined).state
    const near = grappleSpots(spots, spots.operatives[grot]!)
    for (const sp of near) expect(Math.max(0, Math.hypot(sp.x - 0.2, sp.z) - 2 * spots.operatives[grot]!.baseRadius)).toBeLessThanOrEqual(2 + 1e-6)
    const free = grappleSpots(edit(spots, (st) => (st.firefight.activation = null)), spots.operatives[grot]!)
    expect(free.length).toBeGreaterThanOrEqual(near.length)
  })

  it('TEAM-KOM-007 BREACH: a marker beside a thin wall makes it Accessible (+1") for operatives within 1" of the marker', () => {
    let s = openReal(KOM_NEUTRAL)
    const wall = { id: 'wall', parts: [{ id: 'wall.0', footprint: [{ x: 0, z: -3 }, { x: 0.5, z: -3 }, { x: 0.5, z: 3 }, { x: 0, z: 3 }], height: 3, thickness: 0.5, traits: ['heavy' as const] }] }
    const breacha = opOf(s, 'B', 'kom.breacha-boy')
    s = edit(place(s, breacha, -1.5, 0), (st) => {
      st.map = { ...st.map, features: [wall] }
    })
    let t = activateOp(place(s, opOf(s, 'A', 'aod.eliminator-sniper'), -13, 9), opOf(s, 'A', 'aod.eliminator-sniper'))
    t = take(t, 'end').state
    t = activateOp(t, breacha)
    // the wall blocks the move before the marker exists
    const blocked = take(t, 'reposition').state
    const pb = blocked.pending!
    expect(step(blocked, { type: 'move.path', seat: pb.seat, decisionId: pb.id, payload: { waypoints: [{ x: 1.8, z: 0 }] } }).rejection?.code).toBe('E_OVERLAP')
    t = take(t, 'ability:kom.a.breach:wall').state
    const marker = t.markers.find((m) => m.equipmentId === 'breach')!
    expect(marker).toMatchObject({ owner: 'B', placedBy: breacha, featureId: 'wall' })
    expect(Math.hypot(marker.pos.x - -1.5, marker.pos.z)).toBeLessThanOrEqual(0.63 + 1 + 1e-6) // placed within its control range
    expect(t.firefight.activation!.apSpent).toBe(1)
    t = take(t, 'reposition').state
    const p = t.pending!
    const r = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 1.8, z: 0 }] } })
    expect(r.rejection).toBeUndefined()
    // 3.3" across is 4 plus the Accessible surcharge of 1"
    expect((r.events.find((e) => e.type === 'OperativeMoved') as { cost: number }).cost).toBe(5)
    // placing it again replaces the old marker
    const again = withCtx(r.state, () => undefined).state
    expect(again.markers.filter((m) => m.equipmentId === 'breach')).toHaveLength(1)
  })

  it('TEAM-KOM-008 DAKKA DASH: a free Dash and a free Shoot with a dakka shoota, in either order', () => {
    let s = openReal(KOM_NEUTRAL)
    const dakka = opOf(s, 'B', 'kom.dakka-boy')
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = edit(place(place(s, dakka, 0, 0), marine, 7, 0), (st) => {
      st.operatives[marine]!.wounds = st.operatives[marine]!.maxWounds = 60
    })
    let t = activateOp(place(s, opOf(s, 'A', 'aod.eliminator-sniper'), -13, 9), opOf(s, 'A', 'aod.eliminator-sniper'))
    t = take(t, 'end').state
    t = activateOp(t, dakka)
    expect(hasOption(t, 'ability:kom.a.dakka-dash')).toBe(true)
    t = take(t, 'ability:kom.a.dakka-dash').state
    expect(optionIds(t)).toEqual(['dash-first', 'shoot-first'])
    t = take(t, 'dash-first').state
    expect(t.pending).toMatchObject({ kind: 'move.path' })
    expect(t.pending!.constraints).toMatchObject({ kind: 'dash', maxInches: 3 })
    const p = t.pending!
    t = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 2.5, z: 0 }] } }).state
    expect(t.pending!.kind).toBe('shoot.weapon')
    // only dakka shoota profiles may be used
    expect(t.pending!.options!.map((o) => o.id).sort()).toEqual(['kom.w.dakka-shoota-long', 'kom.w.dakka-shoota-short'])
    const r = play(t, undefined, { ...noPloys })
    // the Dakka Boy gets its normal weapons back and has spent 1 AP for the whole action
    expect(r.state.operatives[dakka]!.weapons).toEqual(expect.arrayContaining(['kom.w.fists', 'kom.w.dakka-shoota-short', 'kom.w.dakka-shoota-long']))
    expect(r.state.firefight.activation!.apSpent).toBe(1)
    // both free actions count as performed: neither can be taken again in this activation
    expect(r.state.firefight.activation!.performed).toEqual(expect.arrayContaining(['ability:kom.a.dakka-dash', 'dash', 'shoot']))
    expect(hasOption(r.state, 'shoot')).toBe(false)
    expect(hasOption(r.state, 'dash')).toBe(false)
    // not with a Conceal order
    const hid = activateOp(openReal(KOM_NEUTRAL), opOf(openReal(), 'A', 'aod.eliminator-sniper'))
    expect(hid.pending!.kind).toBe('firefight.action')
  })

  it('TEAM-KOM-009 GET IT DUN! and LISTEN IN: +1 APL to a visible Kommando within 6" (9" with the Comms Device), capped at +1', () => {
    let s = openReal({ equipmentB: ['core.e.comms-device'], ...KOM_NEUTRAL })
    const boss = opOf(s, 'B', 'kom.boss-nob')
    const boy = opOf(s, 'B', 'kom.boy')
    const squig = opOf(s, 'B', 'kom.bomb-squig')
    s = place(place(place(s, boss, 0, 0), boy, 8, 0), squig, 3, 0)
    let t = activateOp(place(s, opOf(s, 'A', 'aod.eliminator-sniper'), -13, 9), opOf(s, 'A', 'aod.eliminator-sniper'))
    t = take(t, 'end').state
    t = activateOp(t, boss)
    // 8" is beyond 6" and the Squig is excluded
    expect(hasOption(t, `ability:kom.a.get-it-dun:${boy}`)).toBe(false)
    expect(hasOption(t, `ability:kom.a.get-it-dun:${squig}`)).toBe(false)
    // with the Comms Device marker controlled by the team the range is 9"
    const ranged = edit(place(s, boy, 8.2, 0), (st) => {
      st.markers.push({ id: 'cd', kind: 'equipment', pos: { x: 1.3, z: 0 }, owner: 'B', carriedBy: null, controller: 'B', equipmentId: 'core.e.comms-device' })
    })
    const t2 = activateOp(take(activateOp(place(ranged, opOf(ranged, 'A', 'aod.eliminator-sniper'), -13, 9), opOf(ranged, 'A', 'aod.eliminator-sniper')), 'end').state, boss)
    expect(commsBonus(t2, 'B')).toBe(3)
    expect(hasOption(t2, `ability:kom.a.get-it-dun:${boy}`)).toBe(true)
    // the boost
    const done = take(t2, `ability:kom.a.get-it-dun:${boy}`).state
    expect(done.operatives[boy]!.aplMods).toBe(1)
    expect(effectiveApl(done.operatives[boy]!)).toBe(3)
    // a second boost does not stack beyond +1
    expect(effectiveApl({ ...done.operatives[boy]!, aplMods: 2 })).toBe(3)
    // GET IT DUN! is gone after use: not twice in an activation
    expect(optionIds(done).some((o) => o.startsWith('ability:kom.a.get-it-dun'))).toBe(false)
  })

  it('TEAM-KOM-010 DAKKA! DAKKA! DAKKA! gives ranged Punishing, WAAAGH! melee Balanced, SKULK ABOUT a free retained die on a Conceal Kommando', () => {
    let s = toGambitB()
    s = take(s, 'kom.p.dakka-dakka-dakka').state
    const boy = opOf(s, 'B', 'kom.boy')
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    expect(rulesVs(s, boy, 'kom.w.slugga', 'shoot', marine)).toContain('punishing')
    expect(rulesVs(s, boy, 'kom.w.choppa', 'fight', marine)).not.toContain('punishing')
    expect(rulesVs(s, marine, 'aod.w.bolt-rifle', 'shoot', boy)).not.toContain('punishing')
    s = toGambitB()
    s = take(s, 'kom.p.waaagh').state
    expect(rulesVs(s, boy, 'kom.w.choppa', 'fight', marine)).toContain('balanced')
    expect(rulesVs(s, boy, 'kom.w.slugga', 'shoot', marine)).not.toContain('balanced')
    s = toGambitB()
    s = take(s, 'kom.p.skulk-about').state
    const dice = [1, 1, 1].map((v) => ({ value: v as number | null, kind: 'fail' as const, rerolled: false }))
    // the Boy has Conceal after set-up
    runHook('afterDefenceRoll', { seat: 'B', state: s, operativeId: boy, targetId: marine, data: { kind: 'shoot', side: 'defence', dice, requests: [], choices: {} } })
    expect(dice.map((d) => d.kind)).toEqual(['normal', 'fail', 'fail'])
    const engaged = edit(s, (st) => (st.operatives[boy]!.order = 'engage'))
    const dice2 = [1, 1, 1].map((v) => ({ value: v as number | null, kind: 'fail' as const, rerolled: false }))
    runHook('afterDefenceRoll', { seat: 'B', state: engaged, operativeId: boy, targetId: marine, data: { kind: 'shoot', side: 'defence', dice: dice2, requests: [], choices: {} } })
    expect(dice2.map((d) => d.kind)).toEqual(['fail', 'fail', 'fail'])
  })

  it("TEAM-KOM-010b KUNNIN' BUT BRUTAL: a Conceal Kommando that charged treats its first normal strike as a crit", () => {
    let s = openReal(KOM_NEUTRAL)
    const boy = opOf(s, 'B', 'kom.boy')
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = edit(place(place(s, boy, 0, 0), marine, 3.5, 0), (st) => {
      st.operatives[marine]!.wounds = st.operatives[marine]!.maxWounds = 60
    })
    let t = activateOp(place(s, opOf(s, 'A', 'aod.eliminator-sniper'), -13, 9), opOf(s, 'A', 'aod.eliminator-sniper'))
    t = take(t, 'end').state
    t = activateOp(t, boy, 'conceal')
    t = take(t, 'charge').state
    const p = t.pending!
    t = step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 1.9, z: 0 }] } }).state
    t = take(t, 'fight').state
    // boy choppa 4,4,1,1 (two normals) vs the marine's fists 1,1,1,1
    const strikes = (ploy: boolean) => {
      const r = play(t, new ScriptedRng([4, 4, 1, 1, 1, 1, 1, 1]), {
        'ploy.firefight': (q) => {
          const o = ploy ? q.options!.find((x) => (x.action.payload as { ployId: string }).ployId === 'kom.p.kunnin-but-brutal') : undefined
          return o ? o.action : pass(q)
        },
      })
      return r.events.filter((e) => e.type === 'Struck').map((e) => (e as { amount: number }).amount)
    }
    expect(strikes(false)).toEqual([4, 4])
    expect(strikes(true)).toEqual([5, 4]) // the first normal counts as a crit (Atk 4/5), the second does not
  })

  it('TEAM-KOM-011 Concealed Position: the profile is usable only on the Snipa Boy first Shoot of the battle', () => {
    let s = openReal(KOM_NEUTRAL)
    const snipa = opOf(s, 'B', 'kom.snipa-boy')
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = edit(place(place(s, snipa, 0, 0), marine, 7, 0), (st) => {
      st.operatives[marine]!.wounds = st.operatives[marine]!.maxWounds = 80
    })
    expect(s.operatives[snipa]!.weapons).toContain('kom.w.scoped-big-shoota-concealed')
    let t = activateOp(place(s, opOf(s, 'A', 'aod.eliminator-sniper'), -13, 9), opOf(s, 'A', 'aod.eliminator-sniper'))
    t = take(t, 'end').state
    t = activateOp(t, snipa, 'conceal') // Silent: the Concealed profile may be shot under Conceal
    t = take(t, 'shoot').state
    expect(t.pending!.options!.map((o) => o.id)).toContain('kom.w.scoped-big-shoota-concealed')
    t = play(take(t, 'kom.w.scoped-big-shoota-concealed').state, undefined, { ...noPloys, 'shoot.target': (q) => noTarget(q as never, marine) as never }).state
    expect(t.operatives[snipa]!.weapons).not.toContain('kom.w.scoped-big-shoota-concealed')
    expect(t.operatives[snipa]!.weapons).toContain('kom.w.scoped-big-shoota-stationary')
  })

  it("Krumpin' Time, I Got a Plan Ladz, Dat All You Got?, Taktical Wot-notz", () => {
    // Krumpin' Time: the Boss Nob fights twice (checked in ORD-005); Dat All You Got? after a fight the Slasha Boy survives
    const s = openReal(KOM_NEUTRAL)
    const slasha = opOf(s, 'B', 'kom.slasha-boy')
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    const ran = withCtx(place(place(s, slasha, 0, 0), marine, 1.6, 0), (ctx) => {
      runHook('onFightResolved', { seat: 'B', state: ctx.state, engine: ctx, operativeId: slasha, targetId: marine, data: { attackerId: slasha, defenderId: marine, attackerIncapacitated: false, defenderIncapacitated: false } })
    }, new ScriptedRng([5]))
    expect(ran.state.operatives[marine]!.wounds).toBe(14 - 3) // D6 5 -> D3 3
    const dead = withCtx(place(place(s, slasha, 0, 0), marine, 1.6, 0), (ctx) => {
      runHook('onFightResolved', { seat: 'B', state: ctx.state, engine: ctx, operativeId: slasha, targetId: marine, data: { attackerId: slasha, defenderId: marine, attackerIncapacitated: true, defenderIncapacitated: false } })
    }, new ScriptedRng([5]))
    expect(dead.state.operatives[marine]!.wounds).toBe(14)
    // retaliating counts too: the Slasha Boy as the defender
    const retaliate = withCtx(place(place(s, slasha, 0, 0), marine, 1.6, 0), (ctx) => {
      runHook('onFightResolved', { seat: 'A', state: ctx.state, engine: ctx, operativeId: marine, targetId: slasha, data: { attackerId: marine, defenderId: slasha, attackerIncapacitated: false, defenderIncapacitated: false } })
    }, new ScriptedRng([6]))
    expect(retaliate.state.operatives[marine]!.wounds).toBe(14 - 3)
  })

  it('Taktical Wot-notz: one Boy may throw a Smoke Grenade and one a Stun Grenade per turning point without the team picks', () => {
    let s = openReal(KOM_NEUTRAL)
    const boy = opOf(s, 'B', 'kom.boy')
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    s = place(place(s, boy, 4, 0), marine, 0, 0)
    let t = activateOp(place(s, opOf(s, 'A', 'aod.eliminator-sniper'), -13, 9), opOf(s, 'A', 'aod.eliminator-sniper'))
    t = take(t, 'end').state
    t = activateOp(t, boy)
    expect(hasOption(t, `ability:core.a.stun-grenade:${marine}`)).toBe(true)
    expect(hasOption(t, 'ability:core.a.smoke-grenade')).toBe(true)
    t = take(t, `ability:core.a.stun-grenade:${marine}`, new ScriptedRng([4])).state
    expect(t.ledger.B.tp).toContain('taktical:core.a.stun-grenade')
    expect(t.ledger.B.uses['core.a.stun-grenade']).toBeUndefined() // the team totals are untouched
    expect(t.operatives[marine]!.aplMods).toBe(-1)
    // not again this turning point, but the smoke grenade is still there for another Boy
    expect(optionIds(t).some((o) => o.startsWith('ability:core.a.stun-grenade'))).toBe(false)
  })

  it('TEAM-KOM-012 stats, bases and weapon profiles match the team tables', () => {
    const rows: [string, number, number, number, number, number][] = [
      ['kom.boss-nob', 3, 6, 5, 14, 32],
      ['kom.bomb-squig', 2, 6, 5, 5, 25],
      ['kom.boy', 2, 6, 5, 10, 32],
      ['kom.breacha-boy', 2, 6, 5, 10, 32],
      ['kom.burna-boy', 2, 6, 5, 10, 32],
      ['kom.comms-boy', 2, 6, 5, 10, 32],
      ['kom.dakka-boy', 2, 6, 5, 10, 32],
      ['kom.grot', 2, 6, 5, 5, 25],
      ['kom.rokkit-boy', 2, 6, 5, 10, 32],
      ['kom.slasha-boy', 2, 6, 5, 10, 32],
      ['kom.snipa-boy', 2, 6, 5, 10, 32],
    ]
    for (const [id, apl, move, save, wounds, base] of rows) expect(realBundle.datacards[id], id).toMatchObject({ apl, move, save, wounds, baseMm: base })
    const w = realBundle.weapons
    const prof = (id: string, atk: number, hit: number, n: number, c: number, rules: string[]) => {
      expect(w[id], id).toMatchObject({ atk, hit, dmg: { normal: n, crit: c } })
      expect(w[id]!.rules.map((r) => r.rule).sort()).toEqual([...rules].sort())
    }
    prof('kom.w.slugga', 4, 4, 3, 4, ['range'])
    prof('kom.w.power-klaw', 4, 3, 5, 7, ['brutal', 'shock'])
    prof('kom.w.explosives', 6, 4, 4, 5, ['blast', 'explosive', 'limited'])
    prof('kom.w.breacha-ram', 4, 4, 5, 5, ['brutal', 'severe', 'shock'])
    prof('kom.w.burna-deluge', 4, 2, 3, 3, ['range', 'saturate', 'seek', 'torrent'])
    prof('kom.w.shokka-pistol', 6, 4, 1, 0, ['devastating', 'range', 'severe', 'stun'])
    prof('kom.w.rokkit-launcha-aimed', 6, 4, 4, 5, ['blast', 'ceaseless', 'heavy'])
    prof('kom.w.scoped-big-shoota-concealed', 5, 3, 3, 3, ['concealed-position', 'devastating', 'heavy', 'silent'])
    prof('kom.w.throwing-knives', 4, 3, 2, 5, ['range', 'silent'])
    prof('kom.w.twin-choppas', 4, 3, 4, 5, ['ceaseless', 'lethal'])
    prof('kom.w.grot-choppa', 3, 5, 1, 4, [])
  })
})

function toGambitB(): GameState {
  // A passes its gambit, then B holds the Gambit step
  const g = realGameAtGambit()
  return passIt(g).state
}
