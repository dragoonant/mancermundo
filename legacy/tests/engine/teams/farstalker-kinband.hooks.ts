// farstalker-kinband code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/farstalker-kinband.test.ts.
import { createGame, step } from '@/engine'
import { answerDecision } from '@/engine/query'
import type { GameEvent } from '@/engine/events'
import type { Rng } from '@/engine/rng'
import { act } from '@/engine/actions'
import { ScriptedRng } from '@/engine/rng'
import { usePloy, type PloyOffer } from '@/engine/ploys'
import type { Action, DecisionKind, GameState, PendingDecision } from '@/engine/types'
import { play } from '../../fixtures/attack'
import { drive, place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { activateOp, edit, openReal, opOf, realBundle, realSetupWith, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['farstalker-kinband', 'kommandos'] as [string, string] }

/** Open ground, every operative parked in its corner; A (Farstalker Kinband) is to activate. */
export const open = (o: Parameters<typeof openReal>[0] = {}): GameState => openReal({ ...MATCH, ...o })
export const A = (s: GameState, card: string): string => opOf(s, 'A', `fk.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A forced dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(160).fill(1)])

export function toGambit(o: Parameters<typeof openReal>[0] = {}, rolls: number[] = [6, 1, 6, 1]): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'fk-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng(rolls))
}

/** The first Ready step: the Farstalker seat (A) is asked for its Ready-step choice (FARSTALKER order changes). */
export function toReady(o: Parameters<typeof openReal>[0] = {}, rolls: number[] = [6, 1, 6, 1]): GameState {
  return drive(
    createGame(realSetupWith({ ...MATCH, ...o }), 'fk-gambit', realBundle).state,
    (st) => st.pending?.kind === 'ability.choice' && st.pending.seat === 'A' && st.pending.context?.readyStep === true,
    800,
    new ScriptedRng(rolls),
  )
}

/** Use a ploy through the engine with a hand-made offer (the window itself is not what the scenario is about). */
export function usePlayed(s: GameState, ployId: string, info: Record<string, unknown>, param?: string): GameState {
  const ploy = s.data.ploys![ployId]!
  const offer: PloyOffer = { id: ployId, ployId, name: ploy.name, cost: ploy.cost, seed: param ? { param } : {}, ...(param ? { param } : {}) }
  return withCtx(s, (ctx) => usePloy(ctx, 'A', offer, { window: 'x', ...info })).state
}

/** Stop at the next ploy window (or the next real choice). */
export const STOP_PLOY: DecisionKind[] = ['ploy.firefight', 'firefight.action', 'firefight.activate', 'firefight.order']

/** Answer a ploy window with the option of that id, anything else with a pass. */
export const takePloy = (id: string) => ({ 'ploy.firefight': (p: PendingDecision) => p.options?.find((o) => o.id === id)?.action ?? act.pass(p) })

/** Answer a fight's strike or block choices by striking with the first die offered. */
export const strikes = { 'fight.resolve': (p: PendingDecision) => p.options?.find((o) => o.id.startsWith('strike'))?.action ?? p.options![0]!.action }

/** A move.path answer: the pending move goes `dx` along x from where the operative stands. */
export const moveBy = (dx: number, dz = 0) => ({
  'move.path': (p: PendingDecision, s: GameState): Action => {
    const op = s.operatives[String(p.constraints?.operativeId)]!
    return { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: Math.round((op.pos.x + dx) * 1000) / 1000, z: Math.round((op.pos.z + dz) * 1000) / 1000 }] } }
  },
})

/**
 * Answer decisions (the engine's default answer, a pass in every ploy window) until `until` holds; `answers` override by kind.
 * Used to reach one ploy window among the opponent's.
 */
export function playUntil(
  state: GameState,
  rng: Rng | undefined,
  until: (s: GameState) => boolean,
  answers: Partial<Record<DecisionKind, (p: PendingDecision, s: GameState) => Action | null>> = {},
  events?: GameEvent[],
  max = 120,
): GameState {
  let s = state
  for (let i = 0; i < max; i++) {
    const p = s.pending
    if (!p || until(s)) return s
    const custom = answers[p.kind]?.(p, s) ?? null
    const a = custom ?? (p.kind === 'ploy.firefight' ? act.pass(p) : (answerDecision(s, p) ?? p.options?.[0]?.action ?? act.pass(p)))
    const r = step(s, a, rng)
    if (r.rejection) throw new Error(`rejected ${r.rejection.code}: ${r.rejection.reason}`)
    events?.push(...r.events)
    s = r.state
  }
  throw new Error('playUntil: step limit')
}

/** The pending decision is a ploy window of that id. */
export const inWindow = (id: string) => (s: GameState): boolean => s.pending?.kind === 'ploy.firefight' && s.pending.window === id

/** A's first operative has acted and ended: the next activation is B's. */
export function bTurn(s: GameState, ender: string): GameState {
  return take(activateOp(s, ender), 'end').state
}

/** Put a melee between a Farstalker operative and an enemy, ready to be declared. */
export function engaged(s: GameState, a: string, b: string, gapX = 1.4): GameState {
  return place(place(s, a, 0, 0), b, gapX, 0)
}

/** A Light terrain block on the map. */
export function withTerrain(s: GameState, x0: number, x1: number, z0: number, z1: number, traits: ('light' | 'heavy')[] = ['light']): GameState {
  return edit(s, (st) => {
    st.map = { ...st.map, features: [...st.map.features, feature(`fk-t${st.map.features.length}`, part(`fk-p${st.map.features.length}`, rect(x0, x1, z0, z1), 1, traits))] }
  })
}

/** The state where A has nothing ready and it is A's turn: the activate decision offers FARSTALKER's order change. */
export function altState(s: GameState): GameState {
  const hound = A(s, 'hound')
  const t = edit(s, (st) => {
    for (const o of Object.values(st.operatives)) if (o.seat === 'A' && o.id !== hound) o.ready = false
  })
  const afterA = bTurn(t, hound)
  return take(activateOp(afterA, B(s, 'boy')), 'end').state
}

export const scenarios: Record<string, () => void> = {
  fkFarstalker() {
    const s = altState(open())
    const alt = s.pending!.options!.find((o) => o.id.startsWith('alt:'))!
    take(s, alt.id)
  },
  fkReadyStep() {
    const r = toReady()
    const t = take(r, 'ready:0').state
    take(t, t.pending!.options![0]!.id)
  },
  fkCallTheKill() {
    const g = toGambit()
    take(g, `fk.p.call-the-kill:${B(g, 'boy')}`)
  },
  fkFlagPloy() {
    take(toGambit(), 'fk.p.rogue')
  },
  fkEnergise() {
    const s = open()
    take(activateOp(s, A(s, 'bow-hunter')), 'ability:fk.a.energise')
  },
  fkLongSight() {
    const s = open()
    take(activateOp(s, A(s, 'long-sight')), 'ability:fk.a.long-sight')
  },
  fkEyeAbove() {
    const s = open()
    const tr = A(s, 'tracker')
    const w = A(s, 'warrior')
    const t = place(place(s, tr, 0, 0), w, 3, 0)
    take(activateOp(t, tr), `ability:fk.a.from-the-eye-above:${w}`)
  },
  fkMarkedForTheHunt() {
    const s = open()
    const tr = A(s, 'tracker')
    const t = take(activateOp(place(s, tr, 0, 0), tr), 'ability:fk.a.marked-for-the-hunt').state
    take(t, t.pending!.options![0]!.id)
  },
  fkGather() {
    const s = open()
    const h = A(s, 'hound')
    const t = take(activateOp(place(s, h, 0, 0), h), 'ability:fk.a.gather:reposition').state
    play(t, dice(), moveBy(2))
  },
  fkStealthAttack() {
    const s = open()
    const st = A(s, 'stalker')
    const boy = B(s, 'boy')
    const t = withTerrain(place(place(s, st, 0, 0), boy, 5, 0), -1, 1, 0.9, 1.9)
    take(activateOp(t, st, 'conceal'), 'ability:fk.a.stealth-attack')
  },
  fkBadTempered() {
    const s = open()
    const h = A(s, 'hound')
    const w = A(s, 'warrior')
    const boy = B(s, 'boy')
    const t = place(place(place(s, h, 0, 0), w, 2, 0), boy, 8, 0)
    const b = activateOp(bTurn(t, A(s, 'cut-skin')), boy)
    const c = take(b, 'charge').state
    const r = play(c, dice(), moveBy(-4.7), ['ability.choice'])
    take(r.state, 'react:0')
  },
  fkSavageAmbush() {
    const s = open()
    const w = A(s, 'warrior')
    const boy = B(s, 'boy')
    const t = withTerrain(place(place(s, w, 0, 0), boy, -1.4, 0), 0.8, 1.8, -1, 1)
    const b = bTurn(t, A(s, 'cut-skin'))
    const f = take(take(activateOp(b, boy), 'fight').state, w).state
    play(f, dice(), { ...strikes, ...takePloy('fk.p.savage-ambush') })
  },
  fkSlipAway() {
    const s = open()
    const w = A(s, 'warrior')
    const boy = B(s, 'boy')
    const t = engaged(s, w, boy)
    const o = take(take(t, w).state, 'engage').state
    take(o, 'fk.p.slip-away')
  },
  fkPoach() {
    const s = open()
    const w = A(s, 'warrior')
    const boy = B(s, 'boy')
    const m = s.markers.find((k) => k.kind === 'objective')!
    const t = place(place(s, w, m.pos.x + 0.9, m.pos.z), boy, m.pos.x - 1.5, m.pos.z)
    const o = take(take(t, w).state, 'engage').state
    take(o, 'fk.p.poach')
  },
  fkVengeance() {
    const s = open()
    const w = A(s, 'warrior')
    const boy = B(s, 'boy')
    const t = edit(place(place(s, w, 0, 0), boy, 4, 0), (st) => {
      st.operatives[w]!.wounds = 1
    })
    const b = bTurn(t, A(s, 'cut-skin'))
    const f = take(take(activateOp(b, boy), 'shoot').state, 'kom.w.slugga').state
    play(take(f, w, dice(6, 6, 6, 6, 6)).state, dice(1, 1, 1, 1, 1), takePloy(`fk.p.vengeance-for-the-kinband:${boy}`))
  },
}
