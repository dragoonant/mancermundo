// corsair-voidscarred code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/corsair-voidscarred.test.ts.
import { createGame, step } from '@/engine'
import { act } from '@/engine/actions'
import { effectiveRules, inflict, validTargets } from '@/engine/attack-common'
import { raiseAction } from '@/engine/firefight'
import { offersFor, usePloy, type PloyOffer } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { resumeGambit } from '@/engine/strategy'
import { providerCanFly, providerFightStart, providerStealthy } from '@/engine/team-rules'
import type { AttackState, DecisionKind, GameState, PendingDecision, RosterEntry } from '@/engine/types'
import { arm, play, ranged, withWeapons } from '../../fixtures/attack'
import { drive, expectOk, place } from '../../fixtures/helpers'
import { activateOp, edit, openReal, opOf, realBundle, realSetupWith, roster, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['corsair-voidscarred', 'kommandos'] as [string, string] }

/** Open ground, every operative parked in its corner; A (Corsair Voidscarred) is to activate. */
export const open = (o: Parameters<typeof openReal>[0] = {}): GameState => openReal({ ...MATCH, ...o })
export const A = (s: GameState, card: string): string => opOf(s, 'A', `cv.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A Corsair roster from datacard ids (each takes its first legal loadout). */
export const cvRoster = (ids: string[]): RosterEntry[] => roster(ids)

/** The default nine, with the Soul Weaver and the Way Seeker in place of the Shade Runner and the Duellist. */
export const PSYKERS = ['cv.felarch', 'cv.fate-dealer', 'cv.gunner', 'cv.heavy-gunner', 'cv.kurnathi', 'cv.kurnite-hunter', 'cv.soul-weaver', 'cv.way-seeker', 'cv.warrior']

/** A roster entry for a datacard with the first legal loadout that carries `weaponId`. */
export function withWeapon(datacardId: string, weaponId: string): RosterEntry {
  const card = realBundle.datacards[datacardId]!
  const loadout = (card.legalLoadouts ?? []).find((l) => l.includes(weaponId))
  if (!loadout) throw new Error(`no ${datacardId} loadout with ${weaponId}`)
  return { datacardId, loadout: { weaponIds: [...loadout] } }
}

/** A forced dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(160).fill(1)])

/** Stop kinds that include ploy windows and ability choices. */
export const STOP_PLOY: DecisionKind[] = ['ploy.firefight', 'firefight.action', 'firefight.activate', 'firefight.order', 'ability.choice']

/** Play on with the engine's defaults and scripted dice, passing every ploy window, until the next action, activation, order or ability choice. */
export function playOut(s: GameState, rng: ScriptedRng = dice()): GameState {
  return play(s, rng, { 'ploy.firefight': (p) => act.pass(p) }, ['firefight.action', 'firefight.activate', 'firefight.order', 'ability.choice']).state
}

/** Answer a ploy window with the option of that id, anything else with a pass. */
export const takePloy = (id: string) => ({ 'ploy.firefight': (p: PendingDecision) => p.options?.find((o) => o.id === id)?.action ?? act.pass(p) })

/** Answer the declared move with a walk (or a warp jump) to a point. */
export function moveTo(s: GameState, x: number, z: number, fly = false, rng?: ScriptedRng): GameState {
  const p = s.pending!
  return expectOk(step(s, fly ? act.fly(p, { x, z }) : act.path(p, [{ x, z }]), rng)).state
}

/** Use a ploy through the engine with a hand-made offer (the window itself is not what the scenario is about). */
export function usePlayed(s: GameState, ployId: string, info: Record<string, unknown> = {}, param?: string, rng?: ScriptedRng): GameState {
  const ploy = s.data.ploys![ployId]!
  const offer: PloyOffer = { id: ployId, ployId, name: ploy.name, cost: ploy.cost, seed: param ? { param } : {}, ...(param ? { param } : {}) }
  return withCtx(s, (ctx) => usePloy(ctx, 'A', offer, { window: 'x', ...info }), rng).state
}

/** The Strategy phase's gambit step with A to choose, in turning point `tp` and with operatives placed by `tweak`. */
export function gambitAt(o: Parameters<typeof openReal>[0] = {}, tp = 1, tweak: (st: GameState) => void = () => undefined): GameState {
  const g = drive(createGame(realSetupWith({ ...MATCH, ...o }), 'cv-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
  const t = edit(g, (st) => {
    st.turningPoint = tp
    st.pending = null
    st.map = { ...st.map, features: [] }
    tweak(st)
  })
  return withCtx(t, (ctx) => resumeGambit(ctx)).state
}

/** A's first operative has acted and ended: the next activation is B's. */
export function bTurn(s: GameState, ender: string): GameState {
  return take(activateOp(s, ender), 'end').state
}

/** Put two operatives beside each other (centres 1.4" apart: in each other's control range). */
export function engaged(s: GameState, a: string, b: string, gapX = 1.4): GameState {
  return place(place(s, a, 0, 0), b, gapX, 0)
}

/** Re-raise the active operative's action decision after the test changed the board. */
export function reraise(s: GameState): GameState {
  return withCtx(s, (ctx) => raiseAction(ctx)).state
}

/** The id of the option of the pending decision that starts with `prefix`. */
export function optionStartingWith(s: GameState, prefix: string): string {
  const o = s.pending?.options?.find((x) => x.id.startsWith(prefix))
  if (!o) throw new Error(`no option ${prefix}* in ${s.pending?.kind}: ${(s.pending?.options ?? []).map((x) => x.id).join(', ')}`)
  return o.id
}

/** B's boy repositions beside A's Felarch's reach so a reaction is offered to A; returns the state at the reaction. */
export function boyMoves(s: GameState, ender: string, to: { x: number; z: number }): GameState {
  const boy = B(s, 'boy')
  return moveTo(take(activateOp(bTurn(s, ender), boy), 'reposition').state, to.x, to.z)
}

export const scenarios: Record<string, () => void> = {
  cvRifles() {
    const s = open()
    const fd = A(s, 'fate-dealer')
    effectiveRules(place(place(s, fd, 0, 0), B(s, 'boy'), 5, 0), s.operatives[fd]!, s.data.weapons['cv.w.ranger-long-rifle-mobile']!, 'shoot', B(s, 'boy'))
  },
  cvAeldariRaiders() {
    const s = open()
    const k = A(s, 'kurnathi')
    moveTo(take(activateOp(place(s, k, 0, 0), k), 'dash').state, 2, 0)
  },
  veteranRaider() {
    const s = open()
    const f = A(s, 'felarch')
    moveTo(take(activateOp(place(s, f, 0, 0), f), 'dash').state, 2, 0)
  },
  cvCamoCloak() {
    const s = open()
    providerStealthy(s, s.operatives[A(s, 'fate-dealer')]!)
  },
  bladedStance() {
    const s = open()
    const attack = { kind: 'fight', operativeId: B(s, 'boy'), fight: { targetId: A(s, 'kurnathi') } } as unknown as AttackState
    providerFightStart(s, attack)
  },
  faolchusBond() {
    const s = open()
    const attack = { kind: 'fight', operativeId: B(s, 'boy'), fight: { targetId: A(s, 'kurnite-hunter') } } as unknown as AttackState
    providerFightStart(s, attack)
  },
  blinkPack() {
    const s = open()
    providerCanFly(s, s.operatives[A(s, 'shade-runner')]!, 'reposition')
  },
  quickOnTheTrigger() {
    const s = open()
    const d = A(s, 'starstorm-duellist')
    validTargets(engaged(s, d, B(s, 'boy')), s.operatives[d]!, 'cv.w.shuriken-pistol')
  },
  prowlingRaiders() {
    const s = open()
    const w = A(s, 'warrior')
    offersFor(s, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: w, counteracting: false })
  },
  diuturnalMantles() {
    const s = open({ equipmentA: ['cv.e.diuturnal-mantles'] })
    withCtx(s, (ctx) => {
      inflict(ctx, { targetId: A(s, 'warrior'), attackerId: B(s, 'boy'), weaponId: 'kom.w.slugga', amount: 3, source: 'devastating', splash: true })
    })
  },
  mistfield() {
    const s0 = open({ equipmentA: ['cv.e.mistfield'] })
    const w = A(s0, 'warrior')
    const boy = B(s0, 'boy')
    const s = arm(withWeapons(place(place(s0, w, 0, 0), boy, 6, 0), ranged('t.pierce', {}, [{ rule: 'piercing', x: 2 }])), boy, ['t.pierce'])
    const info = { window: 'shoot.beforeDefenceRoll', attackerId: boy, targetId: w, subjectId: w, kind: 'shoot', weaponId: 't.pierce' }
    const o = offersFor(s, 'A', 'shoot.beforeDefenceRoll', info).find((x) => x.id === 'cv.e.mistfield')!
    withCtx(s, (ctx) => usePloy(ctx, 'A', o, info))
  },
  runesOfGuidance() {
    const s = open({ rosterA: cvRoster(PSYKERS), equipmentA: ['cv.e.runes-of-guidance'] })
    const sw = A(s, 'soul-weaver')
    const friend = A(s, 'warrior')
    const t = place(place(s, sw, 0, 0), friend, 8, 0)
    take(activateOp(t, sw), `ability:cv.a.soul-heal:${friend}`, dice(3, 3))
  },
  soulChannel() {
    const s = open({ rosterA: cvRoster(PSYKERS) })
    const sw = A(s, 'soul-weaver')
    take(activateOp(place(place(s, sw, 0, 0), A(s, 'felarch'), 2, 0), sw), `ability:cv.a.soul-channel:${A(s, 'felarch')}`)
  },
  soulHeal() {
    const s = open({ rosterA: cvRoster(PSYKERS) })
    const sw = A(s, 'soul-weaver')
    const t = edit(place(place(s, sw, 0, 0), A(s, 'felarch'), 2, 0), (st) => {
      st.operatives[A(s, 'felarch')]!.wounds = 3
    })
    take(activateOp(t, sw), `ability:cv.a.soul-heal:${A(s, 'felarch')}`, dice(4, 4))
  },
  wardingShield() {
    const s = open({ rosterA: cvRoster(PSYKERS) })
    const ws = A(s, 'way-seeker')
    take(activateOp(place(place(s, ws, 0, 0), A(s, 'felarch'), 2, 0), ws), `ability:cv.a.warding-shield:${A(s, 'felarch')}`)
  },
  warpFold() {
    const s = open({ rosterA: cvRoster(PSYKERS) })
    const ws = A(s, 'way-seeker')
    const pair = [A(s, 'felarch'), A(s, 'warrior')].sort().join('+')
    take(activateOp(place(place(place(s, ws, 0, 0), A(s, 'felarch'), 2, 0), A(s, 'warrior'), 0, 2), ws), `ability:cv.a.warp-fold:${pair}`)
  },
  pistolBarrage() {
    const s = open()
    const d = A(s, 'starstorm-duellist')
    const boy = B(s, 'boy')
    const t = take(activateOp(place(place(s, d, 0, 0), boy, 2.5, 0), d), 'ability:cv.a.pistol-barrage:fusion').state
    playOut(t)
  },
  blademaster() {
    const s = open()
    const k = A(s, 'kurnathi')
    const boy = B(s, 'boy')
    const charged = moveTo(take(activateOp(place(place(s, k, 0, 0), boy, 6, 0), k), 'charge').state, 4.7, 0)
    const gone = reraise(edit(charged, (st) => {
      st.operatives[boy]!.status = 'removed'
      st.operatives[boy]!.wounds = 0
    }))
    moveTo(take(gone, 'ability:cv.a.blademaster').state, 7, 0)
  },
  oneStepAhead() {
    const s = open()
    const f = A(s, 'felarch')
    const boy = B(s, 'boy')
    const ready = edit(place(place(s, f, 0, 0), boy, 9, 3), (st) => {
      st.operatives[f]!.order = 'engage'
    })
    const t = boyMoves(ready, A(s, 'warrior'), { x: 6, z: 2 })
    play(take(t, 'react:0', dice(6)).state, dice(), {}, STOP_PLOY)
  },
  eruditeHunter() {
    const s = open()
    const kh = A(s, 'kurnite-hunter')
    const boy = B(s, 'boy')
    const marked = usePlayed(place(place(s, kh, 0, 0), boy, 7, 0), 'cv.p.erudite-hunter', { window: 'strategy.gambit' }, boy)
    const t = boyMoves(marked, A(s, 'warrior'), { x: 5, z: 0 })
    play(take(t, 'react:0').state, dice(), {}, STOP_PLOY)
  },
  slicingAttack() {
    const s = open()
    const sr = A(s, 'shade-runner')
    const boy = B(s, 'boy')
    const t = moveTo(take(activateOp(place(place(s, sr, 0, 0), boy, 3, 1.2), sr), 'reposition').state, 6, 0, true)
    take(t, `cv.a.slicing-attack:${boy}`, dice(2))
  },
  cvFlagPloy() {
    const g = gambitAt()
    take(g, 'cv.p.outcasts')
  },
  cvPlunderers() {
    const g = gambitAt({}, 2)
    const t = take(g, 'cv.p.plunderers', dice(6)).state
    play(take(t, optionStartingWith(t, 'A')).state, dice(), {}, ['ability.choice', 'strategy.gambit'])
  },
  starCharts() {
    const g = gambitAt({ equipmentA: ['cv.e.star-charts'] })
    take(g, 'cv.p.star-charts', dice(3))
  },
  cvOpportunisticFighters() {
    const s = open()
    const f = A(s, 'felarch')
    const boy = B(s, 'boy')
    const t = activateOp(bTurn(place(place(s, f, 0, 0), boy, 1.4, 0), A(s, 'warrior')), boy)
    take(take(t, 'fallBack').state, 'cv.p.opportunistic-fighters', dice(2, 2))
  },
  cvLightFingers() {
    const s = open()
    take(take(take(s, A(s, 'kurnathi')).state, 'engage').state, 'cv.p.light-fingers')
  },
  cvCapriciousFlight() {
    const s = open()
    take(take(take(s, A(s, 'kurnathi')).state, 'engage').state, 'cv.p.capricious-flight')
  },
  cvContemptuousAdventurer() {
    const s = open()
    const k = A(s, 'kurnathi')
    take(take(take(place(s, k, 0, 0), k).state, 'engage').state, 'cv.p.contemptuous-adventurer')
  },
}
