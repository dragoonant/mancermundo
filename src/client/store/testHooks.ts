// window.__ms (docs/spec/50-client.md section 4): test hooks installed when ?test=1 (or ?debug). Read-only views of the store plus
// `dispatch`; the store remains the only step caller.
import { legalActions, suggest, validate, type Action } from '@/engine'
import { cameraApi } from '../board/cameraApi'
import { RandomBot } from '../bot/randomBot'
import { deployFacing, deployFighterFor, previewDeploy, routeTo } from '../interaction/controller'
import { currentParams } from '../params'
import { useAnnouncementStore } from '../presentation/announceStore'
import { useFeedStore } from '../presentation/feedStore'
import { pickDisplaySnapshot, usePresentedStore } from '../presentation/presentedStore'
import { useUi } from '../ui/uiStore'
import { useGame } from './game'
import { useSession } from './session'

export interface MsHooks {
  getState(): unknown
  getPending(): unknown
  /** the engine state as the player currently sees it (the presentation cursor, not the live head) */
  display(): unknown
  legal(): Action[] | null
  dispatch(action: Action): unknown
  choose(optionId: string): unknown
  params(): unknown
  /** presentation caught up with the engine and no banner is showing */
  settled(): boolean
  /** a legal deploy spot for the pending setup.deploy (engine suggest) with its page pixel */
  suggestSpot(): { fighterId: string; x: number; z: number; px: number; py: number } | null
  /** would the engine accept the next deploy click at (x, z)? A dry run: nothing is dispatched */
  deployOk(x: number, z: number): boolean
  /** would a click at (x, z) be accepted for the pending move.path? A dry run: nothing is dispatched */
  routeOk(x: number, z: number): { ok: boolean; cost: number; left: number; reason: string | null }
  project(x: number, y: number, z: number): { x: number; y: number } | null
  camera: typeof cameraApi
  session(): unknown
  ui(): unknown
  /** answer the pending decision (whatever seat) with the random bot's choice; false when nothing is pending */
  autoStep(): boolean
  /** the toasts currently on screen */
  toasts(): { text: string; kind: string }[]
  /** every event of the battle so far */
  events(): unknown[]
}

declare global {
  interface Window {
    __ms?: MsHooks
  }
}

let autoBot: RandomBot | null = null

function autoStep(): boolean {
  const { state, pending, dispatch } = useGame.getState()
  if (!state || !pending || state.phase === 'ended') return false
  autoBot ??= new RandomBot(`auto:${state.seed}`)
  const candidates: Action[] = []
  try {
    candidates.push(autoBot.decide(state, pending))
  } catch {
    /* fall through to the enumerated answers */
  }
  candidates.push(...(legalActions(state, pending) ?? []))
  for (const a of candidates) {
    if (!validate(state, a)) return dispatch(a) === null
  }
  return false
}

export function installTestHooks(): void {
  if (typeof window === 'undefined') return
  const p = currentParams()
  if (!p.test && !new URLSearchParams(location.search).has('debug')) return
  window.__ms = {
    getState: () => useGame.getState().state,
    getPending: () => useGame.getState().pending,
    display: () => {
      const s = usePresentedStore.getState()
      return pickDisplaySnapshot(s.snapshots, s.presentedSeq)
    },
    legal: () => useGame.getState().legal,
    dispatch: (a) => useGame.getState().dispatch(a),
    choose: (id) => useGame.getState().choose(id),
    params: () => p,
    settled: () => {
      const s = usePresentedStore.getState()
      return s.presentedSeq >= s.latestSeq && useAnnouncementStore.getState().current === null
    },
    suggestSpot: () => {
      const { state, pending } = useGame.getState()
      if (!state || !pending || pending.kind !== 'setup.deploy') return null
      const a = suggest(state, pending)
      if (!a || a.type !== 'setup.deploy') return null
      const id = deployFighterFor(pending, useUi.getState().deployFighter)
      const spot = a.payload
      const px = cameraApi.current?.project(spot.x, 0, spot.z)
      return { fighterId: id ?? spot.fighterId, x: spot.x, z: spot.z, px: px?.x ?? -1, py: px?.y ?? -1 }
    },
    deployOk: (x, z) => {
      const { state, pending } = useGame.getState()
      if (!state || !pending || pending.kind !== 'setup.deploy') return false
      const id = deployFighterFor(pending, useUi.getState().deployFighter)
      return !!id && previewDeploy(state, pending, id, { x, z }, deployFacing(pending, useUi.getState().facing)).ok
    },
    routeOk: (x, z) => {
      const { state, pending } = useGame.getState()
      if (!state || !pending || pending.kind !== 'move.path') return { ok: false, cost: 0, left: 0, reason: 'no move pending' }
      const r = routeTo(state, pending, { x, z })
      return { ok: r.ok, cost: r.cost, left: r.left, reason: r.reason }
    },
    project: (x, y, z) => cameraApi.current?.project(x, y, z) ?? null,
    camera: cameraApi,
    session: () => useSession.getState(),
    ui: () => useUi.getState(),
    autoStep,
    toasts: () => useFeedStore.getState().toasts.map((t) => ({ text: t.text, kind: t.kind })),
    events: () => useGame.getState().events,
  }
}
