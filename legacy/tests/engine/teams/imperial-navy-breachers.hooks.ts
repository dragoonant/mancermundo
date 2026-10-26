// imperial-navy-breachers code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/imperial-navy-breachers.test.ts.
import { createGame, step } from '@/engine'
import { activeOps } from '@/engine/state'
import { act } from '@/engine/actions'
import { inflict, ruleSetFor, validTargets } from '@/engine/attack-common'
import { runHook } from '@/engine/hooks'
import { gambitOffers, offersFor, usePloy, type PloyOffer } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { actionForbidden } from '@/engine/abilities'
import { effectiveMove } from '@/engine/state'
import { providerBlockCapacity, providerControlApl, providerMoveRestrictions, providerOwnGrenades } from '@/engine/team-rules'
import type { GameState, PendingDecision, RosterEntry } from '@/engine/types'
import { ranged, withWeapons } from '../../fixtures/attack'
import { drive, expectOk, place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { activateOp, edit, hasOption, openReal, opOf, optionIds, pick, realBundle, realSetupWith, roster, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['imperial-navy-breachers', 'kommandos'] as [string, string] }
export const pass = (p: { seat: 'A' | 'B'; id: string }) => ({ type: 'pass' as const, seat: p.seat, decisionId: p.id, payload: {} as Record<string, never> })

/** Open ground, every operative parked in its corner; A (Breachers) is to activate. */
export const open = (o: Parameters<typeof openReal>[0] = {}): GameState => openReal({ ...MATCH, ...o })
export const A = (s: GameState, card: string): string => opOf(s, 'A', `nb.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(160).fill(1)])

/** A Breacher roster: the Sergeant first, then the cards given. */
export const nbRoster = (...cards: string[]): RosterEntry[] => roster(['nb.sergeant-at-arms', ...cards.map((c) => `nb.${c}`)])

/** The full roster the tests use: both Machines with their controllers, two Armsmen and the rest. */
export const FULL = nbRoster('armsman', 'armsman', 'axejack', 'endurant', 'grenadier', 'gunner-meltagun', 'hatchcutter', 'surveyor', 'void-jammer', 'cat-unit', 'gheistskull')

/** The first Strategy-phase gambit decision (A holds initiative). */
export function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'nb-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
}

/** The gambit options are fixed when the decision is raised: rebuild them after an edit of the state. */
export function refreshGambit(st: GameState): GameState {
  return edit(st, (x) => {
    const p = x.pending!
    p.options = gambitOffers(x, 'A').map((o) => ({
      id: o.id,
      labelKey: 'strategy.gambit',
      action: { type: 'strategy.gambit', seat: 'A', decisionId: p.id, payload: { gambitId: o.gambitId, ...(o.param ? { param: o.param } : {}) } } as never,
      data: { cost: o.cost },
    }))
  })
}

/** Take the first gambit option of that ploy (the marker spot is the param). */
export function takeGambit(s: GameState, ployId: string): GameState {
  const id = optionIds(s).find((o) => o === ployId || o.startsWith(`${ployId}:`))
  if (!id) throw new Error(`no gambit ${ployId} in ${optionIds(s).join(', ')}`)
  return take(s, id).state
}

/** Use a ploy offered in `window` through the engine. */
export function useOffer(s: GameState, window: string, info: Record<string, unknown>, match: (o: PloyOffer) => boolean, seat: 'A' | 'B' = 'A'): GameState {
  const full = { window, ...info }
  const offer = offersFor(s, seat, window, full).find(match)
  if (!offer) throw new Error(`no matching offer in ${window}: ${offersFor(s, seat, window, full).map((o) => o.id).join(', ')}`)
  return withCtx(s, (ctx) => usePloy(ctx, seat, offer, full)).state
}

/** Put an activation of `who` on the table, as if it had been activated and had performed `performed`. */
export function activating(s: GameState, who: string, performed: string[] = []): GameState {
  return edit(s, (st) => {
    st.firefight.activation = { operativeId: who, seat: st.operatives[who]!.seat, counteract: false, stage: 'action', apSpent: performed.length, performed, declared: null }
  })
}

export function orderMarker(s: GameState, kind: 'nb.p.attack-order' | 'nb.p.defence-order', x: number, z: number, id = 'ord1'): GameState {
  return edit(s, (st) => {
    st.markers.push({ id, kind: 'equipment', pos: { x, z }, owner: 'A', carriedBy: null, controller: null, equipmentId: kind })
  })
}

/** A's ready operative ends its activation: the next decision shows what is owed. */
export function endActivation(s: GameState, who: string): GameState {
  return take(activateOp(s, who), 'end').state
}

/** Pass every ploy window that is open. */
export function passPloys(s: GameState): GameState {
  let t = s
  while (t.pending?.kind === 'ploy.firefight') t = expectOk(step(t, pass(t.pending))).state
  return t
}

const wall = feature('rubble', part('rubble.a', rect(-0.8, -0.6, -3, 3), 1, ['light']))
export const WALL = wall
/** A thin wall with Accessible parts, two inches from the Armsman's usual spot. */
export const ACCESSIBLE_WALL = feature('hatch-wall', part('hatch-wall.a', rect(-4.5, -4.0, -3, 3), 3, ['accessible']))

/** A Conceal Machine behind a low wall, a Kommando shooter 6" away. */
export function behindWall(card: 'cat-unit' | 'gheistskull'): { s: GameState; m: string; boy: string } {
  const base = open({ rosterA: FULL })
  const m = A(base, card)
  const boy = B(base, 'boy')
  const s = edit(place(place(withWeapons(base, ranged('test.seek', { hit: 3 }, [{ rule: 'seek' }])), m, 0, 0), boy, -6, 0), (st) => {
    st.map = { ...st.map, features: [wall] }
    st.operatives[m]!.order = 'conceal'
    st.operatives[boy]!.weapons = ['test.seek']
  })
  return { s, m, boy }
}

export const scenarios: Record<string, () => void> = {
  nbFreeOrders() {
    const s = toGambit()
    const t = takeGambit(s, 'nb.p.attack-order')
    if (t.players.A.cp !== s.players.A.cp) throw new Error('Attack Order should cost 0 CP with the Sergeant in the killzone')
  },
  nbAttackOrder() {
    const s = open({ rosterA: FULL })
    const g = A(s, 'armsman')
    const boy = B(s, 'boy')
    const t = orderMarker(place(place(s, g, 0, 0), boy, 5, 0), 'nb.p.attack-order', 1, 0)
    if (!ruleSetFor(t, t.operatives[g]!, 'nb.w.navis-shotgun-close', 'shoot', boy).ceaseless) throw new Error('Ceaseless near the Attack Order marker')
  },
  nbDefenceOrder() {
    const s = open({ rosterA: FULL })
    const g = A(s, 'armsman')
    const boy = B(s, 'boy')
    const t = orderMarker(place(place(s, g, 0, 0), boy, 5, 0), 'nb.p.defence-order', 1, 0)
    const data = { kind: 'shoot' as const, attackerId: boy, weaponId: 'kom.w.slugga', dice: 3, saveDelta: 0, rerolls: [] as unknown[] }
    runHook('modifyDefenceDice', { seat: 'A', state: t, operativeId: g, targetId: boy, weaponId: 'kom.w.slugga', data: data as never })
    if (!data.rerolls.some((r) => (r as { id: string }).id === 'nb-defence-order')) throw new Error('the Defence Order grants a re-roll of one result')
  },
  nbRedirect() {
    const s = open({ rosterA: FULL })
    const sgt = A(s, 'sergeant-at-arms')
    const t = activating(orderMarker(s, 'nb.p.attack-order', -5, 0), sgt)
    useOffer(t, 'firefight.actionEnded', { subjectId: sgt }, (o) => o.ployId === 'nb.redirect' && o.param === 'swap')
  },
  nbGroupActivation() {
    const s = open({ rosterA: FULL })
    const t = endActivation(s, A(s, 'armsman'))
    if (optionIds(t).length !== 1) throw new Error(`Group Activation owes one other Armsman, saw ${optionIds(t).join(', ')}`)
  },
  nbBreachAndClear() {
    const s = open({ rosterA: FULL })
    const g = A(s, 'armsman')
    const sgt = A(s, 'sergeant-at-arms')
    const t = take(take(place(place(s, g, 0, 0), sgt, 1.5, 0), g).state, 'engage').state
    const u = passPloys(take(t, `nb.bc:${sgt}`).state)
    take(take(u, 'end').state, sgt)
  },
  nbEmboldened() {
    const s = open({ rosterA: FULL })
    const ax = A(s, 'axejack')
    const t = edit(s, (st) => (st.operatives[ax]!.actionsThisTp = ['charge']))
    withCtx(t, (ctx) => {
      inflict(ctx, { targetId: ax, attackerId: B(s, 'boy'), weaponId: 'kom.w.slugga', amount: 3, source: 'normal' })
    }, dice(5))
  },
  nbCatBar() {
    const s = open({ rosterA: FULL })
    const cat = A(s, 'cat-unit')
    const t = place(place(s, cat, 0, 0), B(s, 'boy'), 1.2, 0)
    const r = pick(t, cat)
    if (!r.rejection) throw new Error('a C.A.T. Unit in an enemy control range cannot be activated')
  },
  nbMachineActions() {
    const s = open({ rosterA: FULL })
    if (!actionForbidden(s, s.operatives[A(s, 'cat-unit')]!, 'guard')) throw new Error('a Machine cannot Guard')
  },
  nbMachineLimits() {
    const s = open({ rosterA: FULL })
    if (!providerMoveRestrictions(s, s.operatives[A(s, 'cat-unit')]!).noClimb) throw new Error('the C.A.T. Unit cannot climb')
  },
  nbMachineControl() {
    const s = open({ rosterA: FULL })
    const m = s.markers.find((k) => k.kind === 'objective')!
    if (providerControlApl(s, s.operatives[A(s, 'gheistskull')]!, m, 2) !== 1) throw new Error('a Machine counts 1 APL lower for control')
  },
  nbMachineCover() {
    const { s, m, boy } = behindWall('gheistskull')
    if (validTargets(s, s.operatives[boy]!, 'test.seek').some((t) => t.id === m)) throw new Error('the hidden Machine is still a target')
  },
  nbSpot() {
    const s = open({ rosterA: FULL })
    const cat = A(s, 'cat-unit')
    const boy = B(s, 'boy')
    const t = place(place(s, cat, 0, 0), boy, 5, 0)
    take(activateOp(t, cat), `ability:${'nb.a.spot'}:${boy}`)
  },
  nbBreachwall() {
    const s = open({ rosterA: FULL })
    const e = A(s, 'endurant')
    const g = A(s, 'armsman')
    const boy = B(s, 'boy')
    const t = place(place(place(withWeapons(s, ranged('test.gun', { hit: 3 })), e, -1, 0), g, -0.475, 0.909), boy, -1, -9)
    const u = edit(t, (st) => {
      st.operatives[e]!.order = 'engage'
      st.operatives[boy]!.weapons = ['test.gun']
    })
    validTargets(u, u.operatives[boy]!, 'test.gun')
  },
  nbShield() {
    const s = open({ rosterA: FULL })
    const e = A(s, 'endurant')
    const seq = { atk: { seat: 'B', operativeId: B(s, 'boy'), weaponId: 'kom.w.choppa', dice: [], grants: [] }, def: { seat: 'A', operativeId: e, weaponId: 'nb.w.shield-bash', dice: [], grants: [] } }
    const attack = { kind: 'fight', operativeId: B(s, 'boy'), seat: 'B', weaponId: 'kom.w.choppa', seq } as never
    if (providerBlockCapacity(s, attack, 'A', 0) !== 2) throw new Error('the shield bash blocks two')
  },
  nbBoost() {
    const s = open({ rosterA: FULL })
    const sk = A(s, 'gheistskull')
    const t = edit(s, (st) => (st.turningPoint = 2))
    take(activateOp(t, sk), 'ability:nb.a.boost')
  },
  nbGrenadier() {
    const s = open({ rosterA: FULL })
    if (!providerOwnGrenades(s, s.operatives[A(s, 'grenadier')]!).weapons[`core.w.frag-grenade`]) throw new Error('the Grenadier has its own frag grenade')
  },
  nbBreachPoint() {
    const s = open({ rosterA: FULL })
    const h = A(s, 'hatchcutter')
    const t = edit(place(s, h, -4.2, 0), (st) => {
      st.map = { ...st.map, features: [feature('wall2', part('wall2.a', rect(-3.5, -3.0, -3, 3), 3, ['heavy']))] }
    })
    take(activateOp(t, h), 'ability:nb.a.breach-point:wall2')
  },
  nbWayfind() {
    const s = open({ rosterA: FULL })
    const sv = A(s, 'surveyor')
    const g = A(s, 'armsman')
    const t = place(place(s, sv, 0, 0), g, 3, 0)
    take(activateOp(t, sv), `ability:nb.a.wayfind:${g}`)
  },
  nbRemoteControl() {
    const s = open({ rosterA: FULL })
    const sv = A(s, 'surveyor')
    const cat = A(s, 'cat-unit')
    const t = place(place(s, sv, 0, 0), cat, 5, 0)
    take(activateOp(t, sv), `ability:nb.a.remote-control:${cat}`)
  },
  nbDetonate() {
    const s = open({ rosterA: FULL })
    const vj = A(s, 'void-jammer')
    const sk = A(s, 'gheistskull')
    const t = place(place(s, vj, 0, 0), sk, 6, 3)
    take(take(activateOp(t, vj), 'shoot').state, 'nb.w.gheistskull-detonator')
  },
  nbInterferencePulse() {
    const s = open({ rosterA: FULL })
    const vj = A(s, 'void-jammer')
    const sk = A(s, 'gheistskull')
    const boy = B(s, 'boy')
    const t = place(place(place(s, vj, 0, 0), sk, 4, 0), boy, 8, 0)
    take(activateOp(t, vj), `ability:nb.a.interference-pulse:${boy}`, dice(5))
  },
  nbVoidArmour() {
    const s = open({ rosterA: FULL })
    const g = A(s, 'armsman')
    const rk = B(s, 'rokkit-boy')
    const data = { kind: 'shoot' as const, attackerId: rk, weaponId: 'kom.w.rokkit-launcha-mobile', dice: 3, saveDelta: 0, rerolls: [] as unknown[] }
    runHook('modifyDefenceDice', { seat: 'A', state: place(place(s, g, 0, 0), rk, 8, 0), operativeId: g, targetId: rk, weaponId: 'kom.w.rokkit-launcha-mobile', data: data as never })
    if (data.rerolls.length !== 1) throw new Error('Void Armour: one re-roll against a Blast weapon')
  },
  nbVoidShrapnel() {
    const s = open({ rosterA: FULL })
    const g = A(s, 'armsman')
    withCtx(s, (ctx) => {
      inflict(ctx, { targetId: g, attackerId: B(s, 'boy'), weaponId: 'kom.w.slugga', amount: 4, source: 'devastating', splash: true } as never)
    })
  },
  nbCloseAssault() {
    const s = toGambit()
    take(s, 'nb.p.close-assault')
  },
  nbBrace() {
    const s = toGambit()
    take(s, 'nb.p.brace-for-counterattack')
  },
  nbOverwhelm() {
    const s = open({ rosterA: FULL })
    const g = A(s, 'armsman')
    const sgt = A(s, 'sergeant-at-arms')
    const t = edit(place(place(s, g, 0, 0), sgt, 1.5, 0), (st) => {
      st.effects.push({ id: 'ep', source: 'nb.a.breach-and-clear', seat: 'A', kind: 'nb.pair', operativeId: g, expires: 'turningPoint', data: { partnerId: sgt } })
      st.players.A.cp = 3
    })
    useOffer(activating(t, g), 'firefight.activationStart', { subjectId: g }, (o) => o.ployId === 'nb.p.overwhelm-target' && o.param === g)
  },
  nbBlitz() {
    const s = open({ rosterA: FULL })
    const g = A(s, 'armsman')
    const boy = B(s, 'boy')
    const t = edit(place(place(s, g, 0, 0), boy, 4, 0), (st) => {
      st.players.A.cp = 3
      st.firefight.activation = { operativeId: g, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: { action: 'shoot', cost: 1 }, declaredSeq: 7 }
      st.effects.push({ id: 'ef1', source: 'nb.firstShootFight', seat: 'A', kind: 'nb.firstShootFight', operativeId: g, expires: 'turningPoint', data: { seq: 7 } })
      st.effects.push({ id: 'ef2', source: 'nb.firstActivated', seat: 'A', kind: 'nb.firstActivated', operativeId: g, expires: 'turningPoint' })
    })
    useOffer(t, 'shoot.targetSelected', { subjectId: g, attackerId: g, targetId: boy, kind: 'shoot' }, (o) => o.ployId === 'nb.p.blitz')
  },
  nbLockItDown() {
    const s = open({ rosterA: FULL })
    const g = A(s, 'armsman')
    const m = s.markers.find((k) => k.kind === 'objective')!
    const t = edit(s, (st) => (st.players.A.cp = 3))
    const u = useOffer(t, 'firefight.activationStart', { subjectId: g }, (o) => o.ployId === 'nb.p.lock-it-down' && o.param === m.id)
    if (providerControlApl(u, u.operatives[g]!, m, 2) !== 3) throw new Error('Lock it Down adds 1 to the control APL')
  },
  nbDeckHand() {
    const s = open({ rosterA: FULL })
    const g = A(s, 'armsman')
    const t = edit(place(s, g, -6, 0), (st) => {
      st.players.A.cp = 3
      st.map = { ...st.map, features: [ACCESSIBLE_WALL] }
    })
    useOffer(activating(t, g), 'firefight.activationStart', { subjectId: g }, (o) => o.ployId === 'nb.p.deck-hand')
  },
  nbRebreathers() {
    const s = open({ rosterA: FULL, equipmentA: ['nb.e.rebreathers'] })
    const g = A(s, 'armsman')
    const boy = B(s, 'boy')
    const data = { kind: 'fight' as const, targetId: g, rules: [{ rule: 'core.wr.shock' }] }
    runHook('modifyWeaponRules', { seat: 'B', state: s, operativeId: boy, targetId: g, weaponId: 'kom.w.power-klaw', data: data as never })
    if (data.rules.length !== 0) throw new Error('Shock does nothing against a Breacher with Rebreathers')
  },
  nbSlugs() {
    const s = open({ rosterA: FULL, equipmentA: ['nb.e.slugs'] })
    const g = A(s, 'armsman')
    const boy = B(s, 'boy')
    const t = edit(place(place(s, g, 0, 0), boy, 8, 0), (st) => {
      st.attack = { kind: 'shoot', operativeId: g, seat: 'A', weaponId: 'nb.w.navis-shotgun-long' } as never
    })
    useOffer(t, 'shoot.targetSelected', { subjectId: g, weaponId: 'nb.w.navis-shotgun-long' }, (o) => o.ployId === 'nb.e.slugs')
  },
  nbStimms() {
    const s = open({ rosterA: FULL, equipmentA: ['nb.e.combat-stimms'] })
    const g = A(s, 'armsman')
    const t = edit(s, (st) => (st.operatives[g]!.wounds = 2))
    if (effectiveMove(t.operatives[g]!, t) !== 6) throw new Error('Combat Stimms keep the injured Move')
  },
}

export { act, expectOk, hasOption, step, activeOps }
export type { PendingDecision }
