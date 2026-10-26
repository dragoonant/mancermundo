// tempestus-aquilons code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/tempestus-aquilons.test.ts.
import { createGame, step } from '@/engine'
import { act } from '@/engine/actions'
import { usePloy, type PloyOffer } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import type { GameState, PendingDecision, RosterEntry } from '@/engine/types'
import { effectiveMove } from '@/engine/state'
import { play, type Played } from '../../fixtures/attack'
import { defaultAnswer, drive, expectOk, place } from '../../fixtures/helpers'
import { activateOp, edit, newRealGame, openReal, opOf, realBundle, realSetupWith, roster, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['tempestus-aquilons', 'kommandos'] as [string, string] }

/** Open ground, every operative parked in its corner; A (Tempestus Aquilons) is to activate. */
export function open(o: Parameters<typeof openReal>[0] = {}): GameState {
  return openReal({ ...MATCH, ...o })
}
export const A = (s: GameState, card: string): string => opOf(s, 'A', `ta.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A forced dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(160).fill(1)])

export const taRoster = (ids: string[]): RosterEntry[] => roster(ids)

/** Put operatives above: set aside, ready, off the table (T-TA.5). */
export function above(s: GameState, ...ids: string[]): GameState {
  return edit(s, (st) => {
    for (const id of ids) {
      const o = st.operatives[id]!
      o.status = 'reserve'
      o.offboard = 'setAside'
      o.ready = true
      o.pos = { x: 0, y: 0, z: 0 }
    }
  })
}

/** Seat A's Drop markers at these points. */
export function withDrops(s: GameState, ...pts: [number, number][]): GameState {
  return edit(s, (st) => {
    pts.forEach(([x, z], i) => st.markers.push({ id: `tadrop${i}`, kind: 'equipment', pos: { x, z }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'ta.drop' }))
  })
}

/** Add timed effects the hooks read: `expires` defaults to the turning point. */
export function withFx(s: GameState, ...list: { source: string; kind?: string; operativeId?: string; expires?: string; data?: Record<string, unknown>; seat?: 'A' | 'B' }[]): GameState {
  return edit(s, (st) => {
    list.forEach((e, i) => st.effects.push({ id: `eta${i}${st.effects.length}`, seat: e.seat ?? 'A', kind: e.kind ?? 'ployFlag', expires: e.expires ?? 'turningPoint', source: e.source, ...(e.operativeId ? { operativeId: e.operativeId } : {}), ...(e.data ? { data: e.data } : {}) } as never))
  })
}

/** Use a ploy through the engine with a hand-made offer (the window itself is not what the scenario is about). */
export function usePlayed(s: GameState, ployId: string, info: Record<string, unknown> = {}, param?: string, seat: 'A' | 'B' = 'A', rng?: ScriptedRng): GameState {
  const ploy = s.data.ploys![ployId]!
  const offer: PloyOffer = { id: ployId, ployId, name: ploy.name, cost: ploy.cost, seed: param ? { param } : {}, ...(param ? { param } : {}) }
  return withCtx(s, (ctx) => usePloy(ctx, seat, offer, { window: 'x', ...info }), rng).state
}

/** A's first operative has acted and ended: the next activation is B's. */
export function bTurn(s: GameState, ender: string): GameState {
  return take(activateOp(s, ender), 'end').state
}

/** The Strategy phase of turning point 1 at A's first gambit decision. */
export function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'ta-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 1200, new ScriptedRng([6, 1, 6, 1]))
}

/**
 * Play set-up by hand: A (holding the setup initiative) sets the batches in `plan` aside ('aside') or deploys them
 * ('deploy'); the pre-battle step answers `markers` (a function from the pending decision to an option id; the
 * first option by default). Stops at `until` (default the first gambit decision of turning point 1).
 */
export function setUp(plan: ('aside' | 'deploy')[], until: (s: GameState) => boolean = (s) => s.pending?.kind === 'strategy.gambit', markers?: (p: PendingDecision) => string | null, seed = 'ta-setup'): GameState {
  let s = createGame(realSetupWith({ ...MATCH }), seed, realBundle).state
  const rng = new ScriptedRng([6, 1, 6, 1])
  for (let i = 0; i < 1500; i++) {
    const p = s.pending
    if (!p || until(s)) return s
    if (p.kind === 'setup.deploy' && p.seat === 'A') {
      const batch = s.setup.batches!.A!
      const ids = (p.context.setAsideIds as string[] | undefined) ?? []
      if (plan[batch - 1] === 'aside' && ids.length > 0 && s.setup.deploy.aside !== false) {
        s = expectOk(step(s, act.setAside(p, ids[0]!), rng)).state
        continue
      }
    }
    if (p.kind === 'ability.choice' && p.context.preBattle === true && markers) {
      const id = markers(p)
      if (id === null) {
        s = expectOk(step(s, act.pass(p), rng)).state
        continue
      }
      s = take(s, id, rng).state
      continue
    }
    s = expectOk(step(s, defaultAnswer(s), rng)).state
  }
  throw new Error(`set-up did not finish: ${s.pending?.kind}`)
}

/** A one-hit scripted Shoot by `who` with `weaponId` at `targetId`; returns the state at the next action decision. */
export function shootAt(s: GameState, who: string, weaponId: string, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}, order: 'engage' | 'conceal' = 'engage'): Played {
  let t = take(activateOp(s, who, order, rng), 'shoot', rng).state
  t = take(t, weaponId, rng).state
  t = take(t, targetId, rng).state
  return play(t, rng, answers)
}

export function shootAgain(s: GameState, weaponId: string, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}): Played {
  let t = take(s, 'shoot', rng).state
  t = take(t, weaponId, rng).state
  t = take(t, targetId, rng).state
  return play(t, rng, answers)
}

/** Answer a fight's strike or block choices by striking with the first die offered. */
export const strikes = { 'fight.resolve': (p: PendingDecision) => p.options?.find((o) => o.id.startsWith('strike'))?.action ?? p.options![0]!.action }

/** Answer a move decision with one waypoint. */
export const goTo = (x: number, z: number) => ({ 'move.path': (q: PendingDecision) => ({ type: 'move.path' as const, seat: q.seat, decisionId: q.id, payload: { waypoints: [{ x, z }] } }) })

/** Stop answering at these decisions when a scenario wants to look at them. */
export const STOP = ['ability.choice', 'firefight.action', 'firefight.activate'] as never

/** An Aquilon operative above with one Drop marker, the Aquilon player to activate (the Trooper A9, marker at (-3, 0)). */
export function aboveWithMarker(card = 'trooper'): { s: GameState; id: string } {
  const base = open()
  const id = A(base, card)
  return { s: withDrops(above(base, id), [-3, 0]), id }
}

/** The Gunfighter shot at by a Boy (2 fails): the state at the Gunfighter's reaction. */
export function gunfightReaction(): GameState {
  const s = open()
  const gf = A(s, 'gunfighter')
  const boy = B(s, 'boy')
  const ender = A(s, 'trooper')
  const base = edit(place(place(place(s, gf, 0, 0), boy, 5, 0), ender, -12, 9), (st) => {
    st.operatives[gf]!.wounds = st.operatives[gf]!.maxWounds = 40
    st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
  })
  const rng = dice(1, 1, 6, 6)
  const t = bTurn(base, ender)
  const r1 = take(take(take(activateOp(t, boy, 'engage', rng), 'shoot', rng).state, 'kom.w.slugga', rng).state, gf, rng)
  return play(r1.state, rng, {}, STOP).state
}

export const scenarios: Record<string, () => void> = {
  taCommand() {
    const s = open()
    const t = A(s, 'tempestor')
    const tr = A(s, 'trooper')
    take(activateOp(place(place(s, t, 0, 0), tr, 4, 0), t), `ability:ta.a.command:${tr}`)
  },
  taLand() {
    const { s, id } = aboveWithMarker()
    const spots = take(activateOp(s, id), 'ability:ta.a.land').state
    take(spots, spots.pending!.options![0]!.id)
  },
  taDropMarkers() {
    setUp(['deploy', 'aside', 'deploy'])
  },
  taGunfight() {
    take(gunfightReaction(), 'react:0', dice(1, 1, 1))
  },
  taDynamic() {
    const s = open()
    const pr = A(s, 'precursor')
    const boy = B(s, 'boy')
    const staged = edit(place(place(s, pr, 0, 0), boy, 5, 0), (st) => void (st.operatives[boy]!.order = 'engage'))
    const r1 = take(take(take(activateOp(staged, pr), 'shoot').state, 'ta.w.hot-shot-laspistol').state, boy, dice(1, 1, 1, 1))
    const r2 = play(r1.state, dice(1, 1, 1, 1), {}, STOP)
    take(r2.state, 'react:0')
  },
  taRapidInsertion() {
    take(toGambit(), 'ta.p.rapid-insertion')
  },
  taDropMove() {
    const g = take(setUp(['deploy', 'aside', 'deploy']), 'ta.p.drop-insertion').state
    take(g, g.pending!.options!.find((o) => o.id.endsWith('=stay'))!.id)
  },
  taSuddenOffensive() {
    take(toGambit(), 'ta.p.sudden-offensive')
  },
  taMaintainMomentum() {
    take(toGambit(), 'ta.p.maintain-momentum')
  },
  taEyeAbove() {
    const g = toGambit()
    take(g, g.pending!.options!.find((o) => o.id.startsWith('ta.p.eye-above:'))!.id)
  },
  taDropAndSecure() {
    const g = toGambit()
    take(g, g.pending!.options!.find((o) => o.id.startsWith('ta.p.drop-and-secure:'))!.id)
  },
  taHotDrop() {
    const s = open()
    usePlayed(s, 'ta.p.hot-drop', { subjectId: A(s, 'trooper') })
  },
  taAdjustCoordinates() {
    const s = open()
    usePlayed(s, 'ta.p.adjust-coordinates', { subjectId: A(s, 'trooper') })
  },
  taExemplars() {
    const s = open()
    usePlayed(s, 'ta.p.tempestus-exemplars', { subjectId: A(s, 'trooper') })
  },
  taProgena() {
    const s = open()
    usePlayed(s, 'ta.p.progena', { subjectId: A(s, 'trooper') })
  },
  taDropAugury() {
    const { s, id } = aboveWithMarker()
    const staged = edit(s, (st) => void (st.players.A.equipment = ['ta.e.drop-augury']))
    // activate the operative above: the free Drop Augury offer comes with the activation-start window
    let t = take(staged, id).state
    t = take(t, 'engage').state
    t = take(t, 'ta.e.drop-augury').state
    take(t, t.pending!.options![0]!.id)
  },
  taCombatStimms() {
    const s = open({ equipmentA: ['ta.e.combat-stimms'] })
    const tr = A(s, 'trooper')
    const hurt = edit(s, (st) => void (st.operatives[tr]!.wounds = 2))
    if (effectiveMove(hurt.operatives[tr]!, hurt) !== 6) throw new Error('Combat Stimms did not keep the Move')
  },
  taRemoteOverseer() {
    let g = newRealGame({ ...MATCH, equipmentA: ['ta.e.remote-overseer'] }, 'ta-overseer-hook').state
    const rng = new ScriptedRng([6, 1, 2, 5, 6, ...Array<number>(60).fill(1)])
    for (let i = 0; i < 400 && g.pending && !(g.pending.kind === 'strategy.initiative' && g.pending.context.reroll === true); i++) g = expectOk(step(g, defaultAnswer(g), rng)).state
    take(g, 'reroll', rng)
  },
}

