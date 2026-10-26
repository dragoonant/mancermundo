// blooded code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/blooded.test.ts.
import { createGame, step } from '@/engine'
import { act } from '@/engine/actions'
import { offersFor, usePloy, type PloyOffer } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import type { DecisionKind, GameState, PendingDecision } from '@/engine/types'
import { play } from '../../fixtures/attack'
import { drive, place } from '../../fixtures/helpers'
import { activateOp, edit, openReal, opOf, passIt, realBundle, realSetupWith, roster, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['blooded', 'kommandos'] as [string, string] }

/** Open ground, every operative parked in its corner; A (Blooded) is to activate. */
export function open(o: Parameters<typeof openReal>[0] = {}): GameState {
  return openReal({ ...MATCH, ...o })
}
/** Every Blooded datacard once (two Troopers): the rosters rules tests need (the default roster leaves some out). */
export const ALL = ['bl.chieftain', 'bl.brimstone-grenadier', 'bl.butcher', 'bl.commsman', 'bl.corpseman', 'bl.flenser', 'bl.gunner', 'bl.ogryn', 'bl.enforcer', 'bl.sharpshooter', 'bl.thug', 'bl.trench-sweeper', 'bl.trooper', 'bl.trooper']
export function full(o: Parameters<typeof openReal>[0] = {}): GameState {
  return openReal({ ...MATCH, rosterA: roster(ALL), ...o })
}
export const A = (s: GameState, card: string): string => opOf(s, 'A', `bl.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A forced dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(160).fill(1)])

/** The Strategy phase of turning point 1 at A's first gambit decision. */
export function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'bl-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 1200, new ScriptedRng([6, 1, 6, 1]))
}

/** Put an operative token on an operative (the Blooded gambit would have assigned it). */
export function marked(s: GameState, ids: string[], kind = 'bl.blooded', owner: 'A' | 'B' = 'A', expires: string[] = ['battle']): GameState {
  return edit(s, (st) => {
    for (const id of ids) {
      const op = st.operatives[id]!
      op.tokens = [...(op.tokens ?? []).filter((t) => !(t.kind === kind && t.owner === owner)), { kind, owner, count: 1, since: 0, expires: expires as never }]
    }
  })
}

/** Add timed effects the hooks read (a strategy ploy in force): `expires` defaults to the turning point. */
export function withFx(s: GameState, ...list: { source: string; kind?: string; operativeId?: string; expires?: string; seat?: 'A' | 'B'; data?: Record<string, unknown> }[]): GameState {
  return edit(s, (st) => {
    list.forEach((e, i) => st.effects.push({ id: `ek${i}${st.effects.length}`, seat: e.seat ?? 'A', kind: e.kind ?? 'ployFlag', expires: e.expires ?? 'turningPoint', source: e.source, ...(e.operativeId ? { operativeId: e.operativeId } : {}), ...(e.data ? { data: e.data } : {}) } as never))
  })
}

/** Set the unassigned tokens of seat A. */
export function withPool(s: GameState, n: number, seat: 'A' | 'B' = 'A'): GameState {
  return edit(s, (st) => {
    st.players[seat].pools = { ...(st.players[seat].pools ?? {}), 'bl.blooded': n }
  })
}

/** Use a ploy through the engine with a hand-made offer (the window itself is not what the scenario is about). */
export function usePlayed(s: GameState, ployId: string, info: Record<string, unknown> = {}, param?: string, seat: 'A' | 'B' = 'A'): GameState {
  const ploy = s.data.ploys![ployId]!
  const offer: PloyOffer = { id: ployId, ployId, name: ploy.name, cost: ploy.cost, seed: param ? { param } : {}, ...(param ? { param } : {}) }
  return withCtx(s, (ctx) => usePloy(ctx, seat, offer, { window: 'x', ...info })).state
}

/** A's first operative has acted and ended: the next activation is B's. */
export function bTurn(s: GameState, ender: string): GameState {
  return take(activateOp(s, ender), 'end').state
}

/** Stop at the next ploy window (or the next real choice). */
export const STOP_PLOY: DecisionKind[] = ['ploy.firefight', 'firefight.action', 'firefight.activate', 'firefight.order']

/** Answer a ploy window with the option of that id, anything else with a pass. */
export const takePloy = (id: string) => ({ 'ploy.firefight': (p: PendingDecision) => p.options?.find((o) => o.id === id)?.action ?? act.pass(p) })

/** Answer a fight's strike or block choices by striking with the first die offered. */
export const strikes = { 'fight.resolve': (p: PendingDecision) => p.options?.find((o) => o.id.startsWith('strike'))?.action ?? p.options![0]!.action }

/** Answer a move decision with one waypoint. */
export const goTo = (x: number, z: number) => ({ 'move.path': (q: PendingDecision) => ({ type: 'move.path' as const, seat: q.seat, decisionId: q.id, payload: { waypoints: [{ x, z }] } }) })

/** Put the Blooded operative and a Boy face to face (a melee). */
export function facing(s: GameState, a: string, b: string, gapX = 1.4): GameState {
  return place(place(s, a, 0, 0), b, gapX, 0)
}

/**
 * One Shoot by `who` with `weaponId` at `targetId`, all dice scripted; returns the state at the next action decision.
 * `declared` is a ploy option taken in the action-declared window (Callous Disregard); other windows there are passed.
 */
export function shootAt(s: GameState, who: string, weaponId: string, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}, stop?: DecisionKind[], declared?: string): ReturnType<typeof play> {
  let t = take(activateOp(s, who, 'engage', rng), 'shoot', rng).state
  if (declared) t = take(t, declared, rng).state
  while (t.pending?.kind === 'ploy.firefight') t = passIt(t, rng).state
  t = take(t, weaponId, rng).state
  t = take(t, targetId, rng).state
  return play(t, rng, answers, stop)
}

/** Everything on Engage, no terrain: the verdicts are the plain ones. */
export function engaged(s: GameState): GameState {
  return edit(s, (st) => {
    for (const o of Object.values(st.operatives)) o.order = 'engage'
  })
}

export const scenarios: Record<string, () => void> = {
  blGambit() {
    const g = toGambit()
    const t = take(g, 'bl.p.blooded').state
    take(t, t.pending!.options![0]!.id)
  },
  blNameWhispered() {
    const g = toGambit()
    take(g, g.pending!.options!.find((o) => o.id.startsWith('bl.p.name-whispered:'))!.id)
  },
  blGloryKill() {
    let s = place(place(open(), A(open(), 'trooper'), 0, 0), B(open(), 'boy'), 6, 0)
    s = engaged(s)
    const o = offersFor(s, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).find((x) => x.ployId === 'bl.p.glory-kill' && x.param === B(s, 'boy'))
    if (!o) throw new Error('Glory Kill is not on offer')
    withCtx(edit(s, (st) => void (st.players.A.cp = 3)), (ctx) => usePloy(ctx, 'A', o, { window: 'strategy.gambit' }))
  },
  blFlagPloy() {
    const s = edit(open(), (st) => void (st.players.A.cp = 3))
    usePlayed(s, 'bl.p.malevolent-grit')
  },
  blSignal() {
    const s = open()
    const comms = A(s, 'commsman')
    const tr = A(s, 'trooper')
    take(activateOp(place(place(s, comms, 0, 0), tr, 3, 0), comms), `ability:bl.a.signal:${tr}`)
  },
  blActuation() {
    const s = marked(open(), [A(open(), 'commsman')])
    take(activateOp(s, A(s, 'commsman')), 'ability:bl.a.sacrilegious-actuation')
  },
  blRegularDosage() {
    // the default Blooded roster has a Corpseman: the pre-battle step offers it while the game is created
    open()
  },
  blStimms() {
    const s = open()
    const doc = A(s, 'corpseman')
    take(activateOp(s, doc), `ability:bl.a.stimms:${doc}:enraged`)
  },
  blEnforce() {
    const s = open()
    const enf = A(s, 'enforcer')
    const tr = A(s, 'trooper')
    const t = take(activateOp(place(place(s, enf, 0, 0), tr, 2.5, 0), enf), `ability:bl.a.enforce:${tr}`).state
    take(t, t.pending!.options!.find((o) => o.id === 'end')!.id)
  },
  blCallousDisregard() {
    const s = engaged(open())
    const gn = A(s, 'gunner')
    const boy = B(s, 'boy')
    const t = place(place(place(s, gn, -5, 0), boy, 2, 0), A(s, 'trooper'), 2.9, 0)
    const info = { window: 'firefight.actionDeclared', subjectId: gn, action: 'shoot' }
    const o = offersFor(edit(t, (st) => void (st.players.A.cp = 3)), 'A', 'firefight.actionDeclared', info).find((x) => x.ployId === 'bl.p.callous-disregard')
    if (!o) throw new Error('Callous Disregard is not on offer')
    withCtx(edit(t, (st) => void (st.players.A.cp = 3)), (ctx) => usePloy(ctx, 'A', o, info))
  },
  blMomentOfRepute() {
    const s = marked(open(), [A(open(), 'trooper')], 'bl.gaze', 'A', ['turningPointEnd'])
    const tr = A(s, 'trooper')
    const info = { window: 'firefight.activationStart', subjectId: tr }
    const o = offersFor(edit(s, (st) => void (st.players.A.cp = 3)), 'A', 'firefight.activationStart', info).find((x) => x.ployId === 'bl.p.moment-of-repute')
    if (!o) throw new Error('Moment of Repute is not on offer')
    withCtx(edit(s, (st) => void (st.players.A.cp = 3)), (ctx) => usePloy(ctx, 'A', o, info))
  },
  blRewardEarned() {
    const s0 = open()
    const tr = A(s0, 'trooper')
    const boy = B(s0, 'boy')
    const s = marked(place(place(s0, tr, 0, 0), boy, 1.5, 0), [tr])
    const info = { window: 'operative.killed', subjectId: tr, removedId: boy, removedPos: { x: 1.5, z: 0 } }
    const o = offersFor(edit(s, (st) => void (st.players.A.cp = 3)), 'A', 'operative.killed', info).find((x) => x.ployId === 'bl.p.reward-earned')
    if (!o) throw new Error('Reward Earned is not on offer')
    withCtx(edit(s, (st) => void (st.players.A.cp = 3)), (ctx) => usePloy(ctx, 'A', o, info))
  },
  blDarkFavour() {
    const s0 = engaged(open())
    const tr = A(s0, 'trooper')
    const sw = A(s0, 'trench-sweeper')
    const boy = B(s0, 'boy')
    const s = marked(edit(place(place(place(s0, sw, 2.5, 0), tr, 1, 0), boy, 5, 0), (st) => void (st.players.A.cp = 3)), [sw])
    // the Kommandos shoot the marked Trench Sweeper: the Trooper next to it takes the shot instead
    shootAt(bTurn(s, A(s, 'ogryn')), boy, 'kom.w.slugga', sw, dice(), takePloy(`bl.p.dark-favour:${tr}`))
  },
  blDemise() {
    const s0 = engaged(open())
    const g = A(s0, 'brimstone-grenadier')
    const boy = B(s0, 'boy')
    const s = edit(place(place(s0, g, 0, 0), boy, 4, 0), (st) => void (st.operatives[g]!.wounds = 1))
    // the Boy's shot incapacitates the Grenadier: Explosive Demise is asked inside the removal queue
    shootAt(bTurn(s, A(s, 'ogryn')), boy, 'kom.w.slugga', g, dice(6, 6, 6, 6, 1, 1, 1), useDemise)
  },
}

/** Answer an ability.choice with the option of that id (Explosive Demise: 'use'). */
export const useDemise = { 'ability.choice': (p: PendingDecision) => p.options?.find((o) => o.id === 'use')?.action ?? p.options![0]!.action }
