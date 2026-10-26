// Board interaction controller: turns hover/click points from the 3D scene into decision answers. Deploy, move paths, casket
// spots and aim points are the continuous decisions; everything else is chosen from the prompt or by clicking a fighter or a
// door. All verdicts and numbers come from the engine (`validate`, `planMove`, `planToward`); this file only builds candidate
// actions and reads what the engine said.
import '@/engine' // the engine's modules import each other in a cycle: enter through the index before any submodule
import { act, validate, type Action, type DecisionOption, type GameState, type PendingDecision, type Vec2, type Waypoint } from '@/engine'
import { planMove, planToward, type VoluntaryKind } from '@/engine/movement'
import { humanToAct, useGame } from '../store/game'
import { optionDoor, optionFighter, rejectionText } from '../game/labels'
import { pushToast } from '../presentation/feedStore'
import { useUi, type Pt } from '../ui/uiStore'

const VOLUNTARY: readonly string[] = ['move', 'takeCover', 'crawl', 'carry']

/** Decisions whose options are answered by clicking the fighter they name. */
const FIGHTER_CLICK_KINDS: readonly string[] = ['action.activate', 'action.group', 'shoot.target', 'shoot.allocate', 'fight.after', 'action.flee', 'setup.crew']

// ---------------------------------------------------------------- facing

const round3 = (n: number): number => Math.round(n * 1000) / 1000

/** Turn `f` by `delta` radians and keep it in (-PI, PI]. */
export function turnedBy(f: number, delta: number): number {
  let r = f + delta
  while (r > Math.PI) r -= Math.PI * 2
  while (r <= -Math.PI) r += Math.PI * 2
  return round3(r)
}

/** Bearing from one point to another (radians, +Z = 0, +X = a quarter turn): the engine's facing convention. */
export function bearingTo(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z)
}

// ---------------------------------------------------------------- deployment

/** The fighter the next deploy click places: the picked one if still to deploy, else the first left. */
export function deployFighterFor(pending: PendingDecision, picked: string | null): string | null {
  const ids = pending.constraints?.fighterIds ?? []
  return picked && ids.includes(picked) ? picked : (ids[0] ?? null)
}

/** The facing a fighter is set up with: the player's choice, else the engine's default for the seat. */
export function deployFacing(pending: PendingDecision, chosen: number | null): number {
  if (chosen !== null) return chosen
  const f = pending.context.facing
  return typeof f === 'number' ? f : 0
}

export interface Verdict {
  ok: boolean
  /** the engine's reason when not ok */
  text: string
}

/** The engine's verdict on setting a fighter up at a point. */
export function previewDeploy(state: GameState, pending: PendingDecision, fighterId: string, pt: Vec2, facing: number): Verdict {
  const rej = validate(state, act.deploy(pending, fighterId, round3(pt.x), round3(pt.z), facing))
  return rej ? { ok: false, text: rejectionText(rej) } : { ok: true, text: 'Deploy here' }
}

// ---------------------------------------------------------------- move paths

export interface MoveRoute {
  ok: boolean
  /** the centre path after the fighter's own position */
  waypoints: Waypoint[]
  /** the engine's cost of the path (length plus obstacle crossings) and the allowance */
  cost: number
  max: number
  left: number
  end: Vec2 | null
  /** the route stops before the clicked point (allowance, a wall or the 1" rule) */
  short: boolean
  /** the engine's reason when there is no legal route */
  reason: string | null
}

const NO_ROUTE = (max: number, reason: string | null): MoveRoute => ({ ok: false, waypoints: [], cost: 0, max, left: max, end: null, short: false, reason })

/**
 * The route a click at `pt` would take for the pending move.path: the engine's shortest legal route toward the point, cut to the
 * allowance (`planToward`), verified and costed by `planMove`. Retreat and Consolidate paths are straight lines the engine checks.
 */
export function routeTo(state: GameState, pending: PendingDecision, pt: Vec2): MoveRoute {
  const c = pending.constraints
  const f = c?.fighterId ? state.fighters[c.fighterId] : undefined
  if (!c || !f) return NO_ROUTE(0, null)
  const max = c.maxInches ?? Number(pending.context.maxInches ?? 0)
  const oneInch = c.oneInch ?? 'enemy'
  const target = { x: round3(pt.x), z: round3(pt.z) }
  let wps: Vec2[] | null = null
  if (VOLUNTARY.includes(c.kind)) wps = planToward(state, f, c.kind as VoluntaryKind, max, target, oneInch)
  if (!wps) wps = [target]
  const plan = planMove(state, f, wps, { maxInches: max, oneInch, allowEmpty: c.kind === 'takeCover' })
  if (!plan.ok) return NO_ROUTE(max, rejectionText(plan.rejection))
  const end = plan.end
  const short = Math.hypot(end.x - target.x, end.z - target.z) > 0.05
  return { ok: true, waypoints: wps.map((w) => ({ x: w.x, z: w.z })), cost: plan.cost, max, left: Math.max(0, max - plan.cost), end, short, reason: null }
}

// ---------------------------------------------------------------- pointer entry points

function live(): { state: GameState; pending: PendingDecision } | null {
  const { state, pending } = useGame.getState()
  if (!state || !pending || !humanToAct()) return null
  return { state, pending }
}

/** Pointer moved over the board (null: left it). Computes the engine's verdict for the pending continuous decision. */
export function hoverPoint(pt: Pt | null): void {
  const ui = useUi.getState()
  const g = live()
  if (!pt || !g) {
    if (ui.hover || ui.hoverNote) ui.set({ hover: null, hoverNote: null })
    return
  }
  const { state, pending } = g
  let note: Verdict | null = null
  if (pending.kind === 'setup.deploy') {
    const id = deployFighterFor(pending, ui.deployFighter)
    if (id) note = previewDeploy(state, pending, id, pt, deployFacing(pending, ui.facing))
  } else if (pending.kind === 'move.path') {
    const r = routeTo(state, pending, pt)
    note = r.ok ? { ok: true, text: r.short ? 'Moves as far as it can' : 'Move here' } : { ok: false, text: r.reason ?? 'No route' }
  } else if (pending.kind === 'setup.casket' || pending.kind === 'shoot.aim') {
    const a = pending.kind === 'setup.casket' ? act.casket(pending, round3(pt.x), round3(pt.z)) : act.aim(pending, { x: round3(pt.x), z: round3(pt.z) })
    const rej = validate(state, a)
    note = rej ? { ok: false, text: rejectionText(rej) } : { ok: true, text: pending.kind === 'setup.casket' ? 'Place here' : 'Aim here' }
  }
  ui.set({ hover: { x: pt.x, z: pt.z }, hoverNote: note })
}

/** Click on the board floor. */
export function clickPoint(pt: Pt): void {
  const g = live()
  if (!g) return
  const { state, pending } = g
  const ui = useUi.getState()
  const dispatch = useGame.getState().dispatch
  switch (pending.kind) {
    case 'setup.deploy': {
      const id = deployFighterFor(pending, ui.deployFighter)
      if (!id) return
      const rej = dispatch(act.deploy(pending, id, round3(pt.x), round3(pt.z), deployFacing(pending, ui.facing)))
      if (!rej) ui.set({ deployFighter: null, hoverNote: null })
      return
    }
    case 'move.path': {
      const r = routeTo(state, pending, pt)
      if (!r.ok || r.waypoints.length === 0) {
        pushToast(r.reason ?? 'No route there', 'error')
        return
      }
      const rej = dispatch(act.path(pending, r.waypoints))
      if (!rej) ui.resetDecision()
      return
    }
    case 'setup.casket':
      dispatch(act.casket(pending, round3(pt.x), round3(pt.z)))
      return
    case 'shoot.aim':
      dispatch(act.aim(pending, { x: round3(pt.x), z: round3(pt.z) }))
      return
    default:
      // a click on empty floor clears the selection
      if (ui.selected) ui.set({ selected: null })
  }
}

/** The option of the pending decision that a click on this fighter answers, when exactly one does. */
export function optionForFighter(pending: PendingDecision, id: string): DecisionOption | null {
  if (!FIGHTER_CLICK_KINDS.includes(pending.kind)) return null
  const hits = (pending.options ?? []).filter((o) => optionFighter(o) === id)
  return hits.length === 1 ? hits[0]! : null
}

/** Click on a fighter figure: select it, and answer the pending decision when that fighter is what it asks for. */
export function clickFighter(id: string): void {
  const ui = useUi.getState()
  ui.set({ selected: id })
  const g = live()
  if (!g) return
  const { pending } = g
  if (pending.kind === 'setup.deploy') {
    if ((pending.constraints?.fighterIds ?? []).includes(id)) ui.set({ deployFighter: id })
    return
  }
  const opt = optionForFighter(pending, id)
  if (opt) {
    useGame.getState().dispatch(opt.action)
    return
  }
}

/** Options of the pending decision that name a door. */
export function doorOptions(pending: PendingDecision, doorId: string): DecisionOption[] {
  return (pending.options ?? []).filter((o) => optionDoor(o) === doorId)
}

/** Click on a door panel: do the one thing the pending decision offers for it, or say what is possible. */
export function clickDoor(doorId: string): void {
  const g = live()
  const ui = useUi.getState()
  if (!g) return
  const { pending } = g
  const opts = doorOptions(pending, doorId)
  if (opts.length === 1) {
    useGame.getState().dispatch(opts[0]!.action)
    ui.set({ focusDoor: null })
  } else if (opts.length > 1) {
    ui.set({ focusDoor: doorId })
    pushToast('This door has more than one action: pick one in the panel.', 'info')
  } else if (pending.kind === 'action.choose') {
    pushToast('That door is out of reach: end a fighter\'s move next to it, then click it.', 'info')
  }
}

/** Cancel the pending continuous decision when the engine allows it (a move before anything was rolled). */
export function cancelDecision(): boolean {
  const g = live()
  if (!g || !g.pending.canPass) return false
  useGame.getState().pass()
  useUi.getState().resetDecision()
  return true
}

/** Q / E and the prompt's arrows: turn the facing a fighter is set up with. */
export function rotateFacing(delta: number): void {
  const g = live()
  if (!g || g.pending.kind !== 'setup.deploy') return
  const ui = useUi.getState()
  ui.set({ facing: turnedBy(deployFacing(g.pending, ui.facing), delta) })
  hoverPoint(ui.hover)
}

/** All the actions the pending decision lists (for the test hooks and the prompt). */
export function listedActions(pending: PendingDecision | null): Action[] {
  return (pending?.options ?? []).map((o) => o.action)
}
