// Scenario fixtures for tests and screenshots: `?scenario=<name>` starts a real game (Angels of Death seat A vs
// Kommandos seat B, Volkus Crossing, map prelim-1), plays set-up and the first Strategy phase with the engine's own
// answers, then pins operatives where the scenario needs them. Seat A holds the first activation; both seats are
// human so nothing acts on its own. The engine state is plain data: positions, orders and wounds are edited on a copy,
// every other rule runs unchanged. Pure (no DOM, no store), so tests/client/scenarios.test.ts builds them in node.
import { legalActions, ScriptedRng, step, suggestPlacement, type Action, type GameState, type Order, type PendingDecision, type Seat } from '@/engine'
import { cloneState } from '@/engine/state'

export interface Scenario {
  name: string
  /** what it stages and what the UI should show */
  summary: string
  /** pin operatives on a copy of the state at `firefight.activate` (seat A to act) */
  arrange(s: ScenarioEditor): void
}

/** Helpers for arranging a state: find operatives by datacard, move them, set orders and wounds. */
export interface ScenarioEditor {
  state: GameState
  /** id of the seat's n-th operative with this datacard (default the first) */
  op(seat: Seat, datacardId: string, n?: number): string
  place(id: string, x: number, z: number, y?: number): void
  order(id: string, order: Order): void
  wounds(id: string, wounds: number): void
}

const ROLL_OFF_DICE = [6, 1, 6, 1]
const MAX_STEPS = 800

function pass(p: PendingDecision): Action {
  return { type: 'pass', seat: p.seat, decisionId: p.id, payload: {} }
}

/** The answer the scenario driver gives to every set-up and Strategy decision. */
function answer(s: GameState, p: PendingDecision): Action {
  if (p.kind === 'setup.deploy') {
    const ids = p.constraints?.operativeIds ?? []
    const spot = suggestPlacement(s, p, undefined, Object.keys(s.operatives).indexOf(ids[0] ?? '') * 41)
    if (!spot) throw new Error('scenario: no deploy spot')
    return { type: 'setup.deploy', seat: p.seat, decisionId: p.id, payload: { operativeId: spot.operativeId, x: spot.x, z: spot.z, y: spot.y } }
  }
  if (p.kind === 'strategy.gambit' && p.canPass) return pass(p)
  if (p.kind === 'setup.decideInitiative' || p.kind === 'strategy.decideInitiative') {
    const own = p.options?.find((o) => (o.action.payload as { seat?: string }).seat === p.seat)
    if (own) return own.action
  }
  const legal = legalActions(s, p)
  if (p.options?.length) return p.options[0]!.action
  if (legal?.length) return legal[0]!
  if (p.canPass) return pass(p)
  throw new Error(`scenario: cannot answer ${p.kind}`)
}

/** Play set-up and the first Strategy phase until seat A is asked to activate. */
export function driveToFirefight(state: GameState): GameState {
  const rng = new ScriptedRng(ROLL_OFF_DICE)
  let s = state
  for (let i = 0; i < MAX_STEPS; i++) {
    const p = s.pending
    if (!p) break
    if (p.kind === 'firefight.activate') {
      if (p.seat !== 'A') throw new Error('scenario: seat B holds the first activation')
      return s
    }
    const r = step(s, answer(s, p), rng.remaining > 0 ? rng : undefined)
    if (r.rejection) throw new Error(`scenario: ${p.kind} rejected: ${r.rejection.code} ${r.rejection.reason}`)
    s = r.state
  }
  throw new Error('scenario: never reached the first activation')
}

/** Spread everyone along the far edges so only the staged operatives matter. */
function park(s: GameState): void {
  const slots: Record<Seat, [number, number][]> = {
    A: [-14, -12.5, -11, -9.5, -8, -6.5].map((x) => [x, -10.5] as [number, number]),
    B: [14, 12.5, 11, 9.5, 8, 6.5, 14, 12.5, 11, 9.5, 8].map((x, i) => [x, i < 6 ? 10.5 : -10.5] as [number, number]),
  }
  const next: Record<Seat, number> = { A: 0, B: 0 }
  for (const op of Object.values(s.operatives)) {
    const [x, z] = slots[op.seat][next[op.seat]++ % slots[op.seat].length]!
    op.pos = { x, y: 0, z }
  }
}

function editor(state: GameState): ScenarioEditor {
  return {
    state,
    op(seat, datacardId, n = 0) {
      const hit = Object.values(state.operatives).filter((o) => o.seat === seat && o.datacardId === datacardId)[n]
      if (!hit) throw new Error(`scenario: no ${datacardId} #${n} for seat ${seat}`)
      return hit.id
    },
    place(id, x, z, y = 0) {
      state.operatives[id]!.pos = { x, y, z }
    },
    order(id, order) {
      state.operatives[id]!.order = order
    },
    wounds(id, wounds) {
      state.operatives[id]!.wounds = wounds
    },
  }
}

const INTERCESSOR = 'aod.intercessor-gunner'
const ASSAULT = 'aod.assault-intercessor-warrior'
const BOY = 'kom.boy'
const GROT = 'kom.grot'

export const SCENARIOS: Record<string, Scenario> = {
  'shoot-cover': {
    name: 'shoot-cover',
    summary: 'An Intercessor Gunner (auto bolt rifle) with three Kommandos in view: an Engaged Boy in light cover, an Engaged Boy in the open, and a Concealed Boy in cover that cannot be targeted.',
    arrange(e) {
      const shooter = e.op('A', INTERCESSOR)
      e.place(shooter, -2.5, 3.8)
      const cover = e.op('B', BOY)
      const open = e.op('B', 'kom.grot')
      const hidden = e.op('B', 'kom.breacha-boy')
      // the cover pair stand behind the light rubble heap on the centreline, the Grot in the open beside the heavy rubble
      e.place(cover, 1.2, -1.8)
      e.place(open, -1.8, 8.5)
      e.place(hidden, -1.3, -1.8)
      e.order(cover, 'engage')
      e.order(open, 'engage')
      e.order(hidden, 'conceal')
    },
  },
  fight: {
    name: 'fight',
    summary: 'An Assault Intercessor Warrior in control range of a Boy and the Boss Nob, so Fight offers a target, a weapon and strike or block.',
    arrange(e) {
      const hero = e.op('A', ASSAULT)
      e.place(hero, 0, 0)
      e.place(e.op('B', BOY), 1.7, 0)
      e.place(e.op('B', 'kom.boss-nob'), -0.9, 1.5)
      e.place(e.op('A', INTERCESSOR), -2.5, -1.5)
    },
  },
  vantage: {
    name: 'vantage',
    summary: 'An Intercessor Gunner on the upper floor of the large ruin shooting a Boy on the ground 3 inches below: Vantage grants Accurate 1 against the Engaged Boy, not against the Concealed Grot beside him.',
    arrange(e) {
      const shooter = e.op('A', INTERCESSOR)
      e.place(shooter, 6.4, -4.2, 3)
      const target = e.op('B', BOY)
      e.place(target, 2.6, -4.4)
      e.order(target, 'engage')
      const concealed = e.op('B', GROT)
      e.place(concealed, 2.6, -2.9)
      e.order(concealed, 'conceal')
    },
  },
  'objective-contest': {
    name: 'objective-contest',
    summary: 'The centre objective (inside the stronghold on the centreline) with two Angels of Death and one Kommando inside its control range: seat A holds it 2 to 1 on contesting operatives.',
    arrange(e) {
      e.place(e.op('A', INTERCESSOR), -0.6, -4.4)
      e.place(e.op('A', ASSAULT), 0.4, -6)
      e.place(e.op('B', BOY), 0.9, -4.4)
    },
  },
}

export const SCENARIO_NAMES = Object.keys(SCENARIOS)

/** The state a scenario starts from: `base` is a freshly created game (Angels of Death vs Kommandos). */
export function buildScenario(name: string, base: GameState): GameState {
  const def = SCENARIOS[name]
  if (!def) throw new Error(`unknown scenario "${name}" (have ${SCENARIO_NAMES.join(', ')})`)
  const s = cloneState(driveToFirefight(base))
  park(s)
  def.arrange(editor(s))
  return s
}
