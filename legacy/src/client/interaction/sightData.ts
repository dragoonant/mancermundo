// The operative the sight tools describe, and the shared (memoised) evaluation the board layer and the panel read.
import { useMemo } from 'react'
import type { GameState, PendingDecision } from '@/engine'
import { pickDisplaySnapshot, useDisplayState, usePresentedStore, useSettled } from '../presentation/presentedStore'
import { useGame } from '../store/game'
import { useUi } from '../ui/uiStore'
import { previewMove } from './controller'
import { useSight } from './sightStore'
import { sightFor, threatFor, type SightEval, type SightSubject, type ThreatEval } from './sightlines'

export interface SightView {
  opId: string
  /** the operative where it stands now */
  now: SightSubject
  /** the operative at the end of the staged move; null when no valid path is staged */
  after: SightSubject | null
  /** a move prompt of the human seat is open for this operative */
  moving: boolean
  moveKind: string | null
  /** the staged path is not allowed (the numbers shown are for the current position) */
  pathBlocked: boolean
}

/**
 * The operative the sight tools describe: the mover while a `move.path` of a human seat is open (at the planned end
 * point once a path is staged), otherwise the selected operative at its current position.
 */
export function sightView(
  state: GameState | null,
  pending: PendingDecision | null,
  humanTurn: boolean,
  waypoints: { x: number; z: number; y?: number }[],
  selectedOp: string | null,
): SightView | null {
  if (!state || state.phase !== 'firefight') return null
  const act = state.firefight.activation
  const performedOf = (id: string): string[] => (act && act.operativeId === id ? act.performed : [])
  if (humanTurn && pending?.kind === 'move.path') {
    const id = pending.constraints?.operativeId
    const op = id ? state.operatives[id] : undefined
    if (id && op && op.status === 'active') {
      const now: SightSubject = { opId: id, at: { ...op.pos }, performed: performedOf(id) }
      const kind = pending.constraints?.kind ?? null
      const plan = waypoints.length > 0 ? previewMove(state, pending, waypoints).plan : null
      const after: SightSubject | null = plan ? { opId: id, at: { x: plan.end.x, y: plan.end.y, z: plan.end.z }, performed: [...now.performed, ...(kind ? [kind] : [])] } : null
      return { opId: id, now, after, moving: true, moveKind: kind, pathBlocked: waypoints.length > 0 && !plan }
    }
  }
  if (pending?.kind === 'shoot.target' || pending?.kind === 'fight.target') return null
  const op = selectedOp ? state.operatives[selectedOp] : undefined
  if (!op || op.status !== 'active') return null
  return { opId: op.id, now: { opId: op.id, at: { ...op.pos }, performed: performedOf(op.id) }, after: null, moving: false, moveKind: null, pathBlocked: false }
}

export interface SightData {
  state: GameState
  view: SightView
  /** the subject the main numbers describe (end point when staged, else the current position) */
  subject: SightSubject
  sight: SightEval
  /** the same operative before the move, for the before / after comparison */
  before: SightEval | null
  threatOn: boolean
  threat: ThreatEval | null
}

/** The shared evaluation read by the board layer and the panel (the engine work is memoised per state). */
export function useSightData(): SightData | null {
  const state = useDisplayState()
  const settled = useSettled()
  const pending = useGame((g) => g.pending)
  const mode = useGame((g) => (g.pending ? g.seats[g.pending.seat] : null))
  const waypoints = useUi((s) => s.waypoints)
  const selectedOp = useUi((s) => s.selectedOp)
  const on = useSight((s) => s.on)
  const threatPref = useSight((s) => s.threatPref)
  const human = settled && mode === 'human'
  const view = useMemo(() => (on ? sightView(state, pending, human, waypoints, selectedOp) : null), [on, state, pending, human, waypoints, selectedOp])
  return useMemo(() => {
    if (!state || !view) return null
    const subject = view.after ?? view.now
    const sight = sightFor(state, subject)
    const before = view.after ? sightFor(state, view.now) : null
    const threatOn = threatPref ?? view.after !== null
    return { state, view, subject, sight, before, threatOn, threat: threatOn ? threatFor(state, subject) : null }
  }, [state, view, threatPref])
}

/** Is the threat view showing right now? (the T key flips this; automatic means on while a move is staged) */
export function threatShowing(): boolean {
  const p = usePresentedStore.getState()
  const g = useGame.getState()
  const ui = useUi.getState()
  const pref = useSight.getState().threatPref
  if (pref !== null) return pref
  const human = p.presentedSeq >= p.latestSeq && !!g.pending && g.seats[g.pending.seat] === 'human'
  const view = sightView(pickDisplaySnapshot(p.snapshots, p.presentedSeq), g.pending, human, ui.waypoints, ui.selectedOp)
  return view?.after != null
}
