// Board interaction controller: turns hover/click points from the 3D scene into decision answers.
// Deploy and move paths are the two continuous decisions; everything else is chosen from the prompt or by
// clicking an operative. All verdicts come from the engine (`validate`, `planMove`); this file only builds
// candidate actions.
import { act, validate, type Action, type GameState, type PendingDecision, type Rejection, type Waypoint } from '@/engine'
import { markerRadius } from '@/engine/state'
import { planMove, type MoveKind, type MovePlan } from '@/engine/movement'
import { humanToAct, useGame } from '../store/game'
import { useUi, type Pt } from '../ui/uiStore'
import { rejectionText } from '../game/labels'
import { pickDisplaySnapshot, usePresentedStore } from '../presentation/presentedStore'
import { useSight } from './sightStore'

const MOVE_KINDS: MoveKind[] = ['reposition', 'dash', 'fallBack', 'charge']

export function isMoveKind(k: string | undefined): k is MoveKind {
  return !!k && (MOVE_KINDS as string[]).includes(k)
}

export interface MovePreview {
  ok: boolean
  plan: MovePlan | null
  rejection: Rejection | null
}

/** The engine's verdict on a path for the pending move decision. */
export function previewMove(state: GameState, pending: PendingDecision, waypoints: Waypoint[]): MovePreview {
  const c = pending.constraints
  if (!c || !c.operativeId || !isMoveKind(c.kind) || waypoints.length === 0) return { ok: false, plan: null, rejection: null }
  const op = state.operatives[c.operativeId]
  if (!op) return { ok: false, plan: null, rejection: null }
  const r = planMove(state, op, c.kind, waypoints, c.counteract === true)
  return r.ok ? { ok: true, plan: r, rejection: null } : { ok: false, plan: null, rejection: r.rejection }
}

/** The operative to deploy next: the user's pick if still in reserve, else the first. */
export function deployChoice(pending: PendingDecision, picked: string | null): string | null {
  const ids = pending.constraints?.operativeIds ?? []
  return picked && ids.includes(picked) ? picked : (ids[0] ?? null)
}

export function deployAction(pending: PendingDecision, opId: string, pt: Pt): Action {
  return act.deploy(pending, opId, round(pt.x), round(pt.z), pt.y)
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

export interface SpotOption {
  id: string
  x: number
  z: number
}

/** Decisions answered by clicking one of a list of board spots: objective placement and spot-style ability choices. */
export function spotOptions(pending: PendingDecision | null): SpotOption[] {
  if (!pending) return []
  if (pending.kind !== 'setup.objective' && pending.kind !== 'ability.choice') return []
  const out: SpotOption[] = []
  for (const o of pending.options ?? []) {
    const p = o.action.payload as { x?: unknown; z?: unknown }
    const d = o.data ?? {}
    const x = typeof p.x === 'number' ? p.x : typeof d.x === 'number' ? d.x : null
    const z = typeof p.z === 'number' ? p.z : typeof d.z === 'number' ? d.z : null
    if (x !== null && z !== null) out.push({ id: o.id, x, z })
  }
  return out
}

/** The spot closest to a board point, if one lies within `maxDist` inches. */
export function nearestSpot(spots: SpotOption[], pt: { x: number; z: number }, maxDist: number): SpotOption | null {
  let best: SpotOption | null = null
  let bd = maxDist
  for (const s of spots) {
    const d = Math.hypot(s.x - pt.x, s.z - pt.z)
    if (d <= bd) {
      bd = d
      best = s
    }
  }
  return best
}

const SPOT_REACH: Record<string, number> = { 'setup.objective': 3, 'ability.choice': 1.6 }

/** The answer for a free-position placement (marker.place, setup.equipMarker) at a board point. */
export function placementAction(pending: PendingDecision, pt: { x: number; z: number }): Action | null {
  const x = round(pt.x)
  const z = round(pt.z)
  if (pending.kind === 'marker.place') return { type: 'marker.place', seat: pending.seat, decisionId: pending.id, payload: { x, z } }
  if (pending.kind === 'setup.equipMarker') {
    const yaw = (pending.context.suggestion as { yaw?: number } | undefined)?.yaw
    return { type: 'setup.equipMarker', seat: pending.seat, decisionId: pending.id, payload: yaw === undefined ? { x, z } : { x, z, yaw } }
  }
  return null
}

/** Radius of the marker being placed (for the ghost), in inches. */
export function placedMarkerRadius(state: GameState, pending: PendingDecision): number {
  if (pending.kind === 'marker.place') {
    const m = state.markers.find((k) => k.id === pending.context.markerId)
    return m ? markerRadius(m) : 0.4
  }
  return markerRadius({ kind: 'equipment' })
}

export function hoverPoint(pt: Pt | null): void {
  const ui = useUi.getState()
  if (!pt) {
    if (ui.hover || ui.hoverSpot) ui.set({ hover: null, hoverNote: null, hoverSpot: null })
    return
  }
  const { pending, state } = useGame.getState()
  let note: { ok: boolean; text: string } | null = null
  if (pending?.kind === 'setup.deploy' && state && humanToAct()) {
    const id = deployChoice(pending, ui.deployOp)
    if (id) {
      const rej = validate(state, deployAction(pending, id, pt))
      note = rej ? { ok: false, text: rejectionText(rej) } : { ok: true, text: 'Legal spot: click to deploy.' }
    }
  }
  let spot: string | null = null
  if (pending && state && humanToAct()) {
    const spots = spotOptions(pending)
    if (spots.length > 0) spot = nearestSpot(spots, pt, SPOT_REACH[pending.kind] ?? 2)?.id ?? null
    const place = placementAction(pending, pt)
    if (place) {
      const rej = validate(state, place)
      note = rej ? { ok: false, text: rejectionText(rej) } : { ok: true, text: 'Legal spot: click to place.' }
    }
  }
  useUi.setState({ hover: pt, hoverNote: note, hoverSpot: spot ?? (ui.hoverSpot === 'suggestion' ? 'suggestion' : null) })
}

export function clickPoint(pt: Pt): void {
  // the measure tool takes every board click (read-only: it never reaches the engine, even between decisions or on a bot turn)
  if (useSight.getState().measureOn) {
    useSight.getState().measureClick({ x: round(pt.x), y: pt.y, z: round(pt.z) })
    return
  }
  const { pending, state, dispatch } = useGame.getState()
  const ui = useUi.getState()
  if (!pending || !state || !humanToAct()) {
    ui.set({ selectedOp: null })
    return
  }
  if (pending.kind === 'setup.deploy') {
    const id = deployChoice(pending, ui.deployOp)
    if (id) dispatch(deployAction(pending, id, pt))
    return
  }
  if (pending.kind === 'setup.objective' || pending.kind === 'ability.choice') {
    const hit = nearestSpot(spotOptions(pending), pt, SPOT_REACH[pending.kind] ?? 2)
    if (hit) useGame.getState().choose(hit.id)
    return
  }
  if (pending.kind === 'marker.place' || pending.kind === 'setup.equipMarker') {
    const a = placementAction(pending, pt)
    if (a) dispatch(a)
    return
  }
  if (pending.kind === 'move.path') {
    if (ui.waypoints.length >= 12) return
    const wp: Waypoint = { x: round(pt.x), z: round(pt.z), y: pt.y }
    if (ui.jumpNext) wp.jump = true
    useUi.setState({ waypoints: [...ui.waypoints, wp], jumpNext: false })
    return
  }
  ui.set({ selectedOp: null })
}

/** The operative id an option refers to (target / operative payload fields), if any. */
export function optionOperative(o: { action: { payload: unknown }; data?: Record<string, unknown> }): string | null {
  const p = o.action.payload as Record<string, unknown>
  for (const k of ['targetId', 'target', 'operativeId', 'defenderId']) {
    const v = p[k] ?? o.data?.[k]
    if (typeof v === 'string') return v
  }
  return null
}

/** Clicking an operative: choose it when it is an option of the pending decision (activation, shoot/fight target), otherwise just select it for the card. */
export function clickOperative(id: string): void {
  if (useSight.getState().measureOn) {
    const p = usePresentedStore.getState()
    const op = pickDisplaySnapshot(p.snapshots, p.presentedSeq)?.operatives[id]
    if (op) useSight.getState().measureClick({ x: op.pos.x, y: op.pos.y, z: op.pos.z, opId: id })
    return
  }
  const { pending, choose } = useGame.getState()
  const ui = useUi.getState()
  ui.set({ selectedOp: id })
  if (!pending || !humanToAct()) return
  if (pending.kind === 'firefight.activate') {
    const opt = pending.options?.find((o) => {
      const p = o.action.payload as { operativeId?: string; counteract?: boolean }
      return p.operativeId === id && !p.counteract
    })
    if (opt) choose(opt.id)
    return
  }
  // target-style decisions the engine adds later: exactly one option naming the clicked operative picks it
  if (pending.kind === 'shoot.target' || pending.kind === 'fight.target' || pending.kind === 'guard.interrupt') {
    const hits = (pending.options ?? []).filter((o) => optionOperative(o) === id)
    if (hits.length === 1) choose(hits[0]!.id)
  }
}

export function confirmPath(): Rejection | null {
  const { pending, dispatch } = useGame.getState()
  const ui = useUi.getState()
  if (pending?.kind !== 'move.path' || ui.waypoints.length === 0) return null
  const rej = dispatch(act.path(pending, ui.waypoints))
  if (!rej) ui.resetPath()
  return rej
}

export function cancelPath(): void {
  const { pending, dispatch } = useGame.getState()
  useUi.getState().resetPath()
  if (pending?.kind === 'move.path' && pending.canPass) dispatch(act.pass(pending))
}
