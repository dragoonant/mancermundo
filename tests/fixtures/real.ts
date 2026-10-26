// Real-team fixtures: the data adapter's bundle, setups for Angels of Death and Kommandos, and helpers that
// drive a real game to the first activation and pin operatives where a rules test needs them.
import { bundleFromData, defaultLoadoutFor, realSetup, type EngineBundle } from '@/engine/bundle'
import { ScriptedRng } from '@/engine/rng'
import { createGame, step } from '@/engine'
import { cloneState } from '@/engine/state'
import type { GameSetup, GameState, RosterEntry, Seat } from '@/engine/types'
import { loadBundle } from '../../src/data'
import { drive, expectOk, newGame as _unused } from './helpers'

void _unused

export const realBundle: EngineBundle = bundleFromData(loadBundle())

export const AOD = 'angels-of-death'
export const KOM = 'kommandos'

export function roster(ids: string[]): RosterEntry[] {
  return ids.map((id) => ({ datacardId: id, loadout: defaultLoadoutFor(realBundle, id) }))
}

export interface RealOpts {
  /** seat A / B teams (default AoD vs Kommandos) */
  teams?: [string, string]
  missionId?: string
  mapId?: string
  layoutId?: string
  rosterA?: RosterEntry[]
  rosterB?: RosterEntry[]
  equipmentA?: string[]
  equipmentB?: string[]
  equipmentChoices?: GameSetup['equipmentChoices']
  teamChoices?: GameSetup['teamChoices']
  autoObjectives?: boolean
  autoEquipment?: boolean
  /** leave the map / crit op to the engine's rolls */
  rollMap?: boolean
  rollCritOp?: boolean
}

export function realSetupWith(o: RealOpts = {}): GameSetup {
  const setup = realSetup(realBundle, {
    ...(o.teams ? { teams: o.teams } : {}),
    ...(o.layoutId ? { layoutId: o.layoutId } : {}),
    missionId: o.missionId ?? 'mission.prelim-secure',
    mapId: o.mapId ?? 'prelim-1',
    autoObjectives: o.autoObjectives ?? true,
    autoEquipment: o.autoEquipment ?? true,
  })
  if (o.rollMap) delete setup.mission!.mapId
  if (o.rollCritOp) delete setup.mission!.missionId
  if (o.rosterA) setup.rosters.A = o.rosterA
  if (o.rosterB) setup.rosters.B = o.rosterB
  // tests opt in to equipment: the defaults are none, so no mine can fire while operatives deploy
  setup.equipment = { A: o.equipmentA ?? [], B: o.equipmentB ?? [] }
  setup.equipmentChoices = { A: {}, B: {} }
  if (o.equipmentChoices) setup.equipmentChoices = o.equipmentChoices
  else {
    const picks = (ids: string[]) => ({ ...(ids.includes('core.e.utility-grenades') ? { 'core.e.utility-grenades': ['core.a.smoke-grenade', 'core.a.stun-grenade'] } : {}), ...(ids.includes('core.e.explosive-grenades') ? { 'core.e.explosive-grenades': ['core.w.frag-grenade', 'core.w.krak-grenade'] } : {}) })
    setup.equipmentChoices = { A: picks(setup.equipment.A), B: picks(setup.equipment.B) }
  }
  if (o.teamChoices) setup.teamChoices = o.teamChoices
  return setup
}

/** Play set-up and the first Strategy phase (A wins both roll-offs and holds initiative); returns the state at firefight.activate. */
export function realGame(o: RealOpts = {}, seed = 'real', dice: number[] = [6, 1, 6, 1]): GameState {
  const first = newRealGame(o, seed).state
  return drive(first, (st) => st.pending?.kind === 'firefight.activate', 800, new ScriptedRng(dice))
}

export function newRealGame(o: RealOpts = {}, seed = 'real') {
  return createGame(realSetupWith(o), seed, realBundle)
}

/** The first operative id of the seat whose datacard is `datacardId`. */
export function opOf(state: GameState, seat: Seat, datacardId: string): string {
  const op = Object.values(state.operatives).find((o) => o.seat === seat && o.datacardId === datacardId)
  if (!op) throw new Error(`no ${datacardId} for seat ${seat}`)
  return op.id
}

/** Edit a copy of the state (operatives, markers, ledgers) the way a test needs. */
export function edit(state: GameState, f: (s: GameState) => void): GameState {
  const s = cloneState(state)
  f(s)
  return s
}

export { expectOk, step }

// ---------------------------------------------------------------------------
// Answering decisions by option id
// ---------------------------------------------------------------------------

import type { Rng } from '@/engine/rng'
import type { StepResult } from '@/engine/types'

export function optionIds(state: GameState): string[] {
  return (state.pending?.options ?? []).map((o) => o.id)
}

export function hasOption(state: GameState, id: string): boolean {
  return optionIds(state).includes(id)
}

/** Answer the pending decision with the option of that id; returns the raw result (it may be a rejection). */
export function pick(state: GameState, id: string, rng?: Rng): StepResult {
  const o = state.pending?.options?.find((x) => x.id === id)
  if (!o) throw new Error(`no option ${id} in ${state.pending?.kind} (${optionIds(state).join(', ')})`)
  return step(state, o.action, rng)
}

/** Answer with an option and require acceptance. */
export function take(state: GameState, id: string, rng?: Rng): StepResult {
  return expectOk(pick(state, id, rng))
}

/** Pass the pending decision. */
export function passIt(state: GameState, rng?: Rng): StepResult {
  const p = state.pending!
  return expectOk(step(state, { type: 'pass', seat: p.seat, decisionId: p.id, payload: {} }, rng))
}

/** Activate an operative (Engage unless said) and answer any activation-start ploy window with a pass. */
export function activateOp(state: GameState, id: string, order: 'engage' | 'conceal' = 'engage', rng?: Rng): GameState {
  let s = take(state, id, rng).state
  // a Grot cannot Engage and a Squig cannot Conceal: take the one order that is offered
  s = take(s, hasOption(s, order) ? order : order === 'engage' ? 'conceal' : 'engage', rng).state
  while (s.pending?.kind === 'ploy.firefight') s = passIt(s, rng).state
  return s
}

/** A real game on a map with no terrain, with every operative parked in the far corners (visibility never interferes). */
export function openReal(o: RealOpts = {}, seed = 'open'): GameState {
  const s = realGame(o, seed)
  return edit(s, (st) => {
    st.map = { ...st.map, features: [] }
    let a = 0
    let b = 0
    for (const op of Object.values(st.operatives)) {
      op.pos = op.seat === 'A' ? { x: -13.5, y: 0, z: -10 + a++ * 1.7 } : { x: 13.5, y: 0, z: -10 + b++ * 1.7 }
    }
    // keep only the objective markers and the open ground (tests add what they need)
    st.markers = st.markers.filter((m) => m.kind === 'objective')
    st.equipment.placed = []
    for (const m of st.markers) m.controller = null
  })
}

/** Put the game in turning point n (rules that look at the turning point read only state.turningPoint). */
export function inTp(state: GameState, n: number): GameState {
  return edit(state, (st) => {
    st.turningPoint = n
  })
}

// ---------------------------------------------------------------------------
// Running engine code against a draft state without going through a decision
// ---------------------------------------------------------------------------

import { createCtx, type Ctx } from '@/engine/registry'
import { SeededRng } from '@/engine/rng'
import type { GameEvent } from '@/engine/events'

/** Run `f` with a step context over a copy of the state; returns the resulting state and the events it emitted. */
export function withCtx(state: GameState, f: (ctx: Ctx) => void, rng?: Rng): { state: GameState; events: GameEvent[] } {
  const ctx = createCtx(cloneState(state), rng ?? SeededRng.fromSeed('ctx'), null, state.seq)
  f(ctx)
  return { state: ctx.state, events: ctx.events }
}
