// Scenario fixtures (S4): real Goliath and Escher starter gangs on the shipped boards, taken to the first activation of round 1
// with the engine answering the set-up decisions (crews, caskets, deployment), plus helpers for the scenario rules tests.
import { act, createGame, step, suggest, type GameState, type PendingDecision, type Seat } from '@/engine'
import type { Rng } from '@/engine/rng'
import { createCtx, type Ctx } from '@/engine/registry'
import { cloneState } from '@/engine/state'
import { ScriptedRng } from '@/engine/rng'
import { boardsFor, realBundle, realSetup } from './real'

export const TUNNEL = 'scn.tunnel-skirmish'
export const SMASH = 'scn.smash-and-grab'
export const RICHES = 'scn.forgotten-riches'

export interface BattleOptions {
  scenarioId: string
  boardId?: string
  /** the roll-off winner (who is the attacker in Smash & Grab) acts first in round 1 */
  attackerFirst?: boolean
  seed?: string
  /** leave caskets and deployment to the players (default: the engine answers them) */
  manual?: { caskets?: boolean; deploy?: boolean; crew?: boolean }
}

/** Answer set-up decisions with `suggest` until `stop` says the game is somewhere a test wants it. */
export function setupUntil(state: GameState, stop: (s: GameState) => boolean, rng?: Rng): GameState {
  let s = state
  for (let i = 0; i < 400 && !stop(s); i++) {
    const a = suggest(s, s.pending)
    if (!a) throw new Error(`cannot answer ${s.pending?.kind}`)
    const r = step(s, a, rng)
    if (r.rejection) throw new Error(`set-up answer refused: ${r.rejection.code} ${r.rejection.reason}`)
    s = r.state
  }
  return s
}

/** A battle at its first `action.activate` of round 1. */
export function battle(opts: BattleOptions): GameState {
  const bundle = realBundle()
  const boardId = opts.boardId ?? boardsFor(bundle, opts.scenarioId)[0]!
  const seed = opts.seed ?? 'scenario-test'
  const options = (first?: Seat) => ({
    autoCrew: !opts.manual?.crew,
    autoCaskets: !opts.manual?.caskets,
    autoDeploy: !opts.manual?.deploy,
    ...(first ? { firstPriority: first } : {}),
  })
  // the roll-off winner is the one who chooses attacker: probe it to give that seat Priority
  const probe = createGame(realSetup({ scenarioId: opts.scenarioId, boardId, options: options('A') }), seed, bundle)
  const winner = probe.pending!.seat
  const first: Seat = opts.attackerFirst === false ? (winner === 'A' ? 'B' : 'A') : winner
  const created = createGame(realSetup({ scenarioId: opts.scenarioId, boardId, options: options(first) }), seed, bundle)
  return setupUntil(created.state, (s) => s.phase === 'action')
}

/** The seat holding a role in a scenario with attacker and defender. */
export const seatWith = (s: GameState, role: 'attacker' | 'defender'): Seat => (s.players.A.role === role ? 'A' : 'B')

/** The first fighter of a seat with a role that is on the board. */
export function fighterWithRole(s: GameState, seat: Seat, role: string): string {
  const f = Object.values(s.fighters).find((x) => x.seat === seat && x.role === role && x.location === 'board')
  if (!f) throw new Error(`no ${role} on the board for ${seat}`)
  return f.id
}

/** A draft and a step context over scripted dice, to call engine rules directly (the draft is the ctx state). */
export function draft(state: GameState, dice: number[] = []): { ctx: Ctx; rng: ScriptedRng } {
  const rng = new ScriptedRng(dice)
  return { ctx: createCtx(cloneState(state), rng, null, state.seq), rng }
}

export const pendingOf = (s: GameState): PendingDecision => s.pending!

export { act }
