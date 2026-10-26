// Music director: title music on the menus, battle-a / battle-b alternating per turning point with a
// crossfade, the same track at 1.07x ("tense") when the human side is 3+ VP behind or in the last turning
// point, and a victory / defeat piece at the end. `musicPlan` is pure; `startMusicDirector` wires it to the
// session and the presented (not the live) game state, so the music never gives a result away early.
import type { GameResult, GameState, Seat } from '@/engine'
import { pickDisplaySnapshot, usePresentedStore } from '../presentation/presentedStore'
import { useGame } from '../store/game'
import { useSession, type Screen } from '../store/session'
import type { MusicId } from './ids'
import type { AudioManager } from './manager'

export const TENSE_RATE = 1.07
export const TENSE_VP_GAP = 3
export const FINAL_TURNING_POINT = 4

export interface MusicInput {
  screen: Screen
  phase: GameState['phase'] | null
  turningPoint: number
  vp: Record<Seat, number> | null
  result: GameResult | null
  perspective: Seat
}

export interface MusicPlan {
  id: MusicId | null
  rate: number
  /** false for the end-of-battle pieces, which play once */
  loop: boolean
  tense: boolean
}

export function musicPlan(i: MusicInput): MusicPlan {
  if (i.screen !== 'battle' || i.phase === null || i.phase === 'setup' || i.turningPoint < 1) {
    return { id: 'music-title', rate: 1, loop: true, tense: false }
  }
  if (i.phase === 'ended') {
    const w = i.result?.winner
    if (!w || w === 'draw') return { id: 'music-title', rate: 1, loop: true, tense: false }
    return { id: w === i.perspective ? 'music-victory' : 'music-defeat', rate: 1, loop: false, tense: false }
  }
  const other: Seat = i.perspective === 'A' ? 'B' : 'A'
  const behind = i.vp ? i.vp[other] - i.vp[i.perspective] >= TENSE_VP_GAP : false
  const tense = behind || i.turningPoint >= FINAL_TURNING_POINT
  return { id: i.turningPoint % 2 === 1 ? 'music-battle-a' : 'music-battle-b', rate: tense ? TENSE_RATE : 1, loop: true, tense }
}

function currentInput(): MusicInput {
  const screen = useSession.getState().screen
  const { seats } = useGame.getState()
  const perspective: Seat = seats.A === 'human' ? 'A' : seats.B === 'human' ? 'B' : 'A'
  const p = usePresentedStore.getState()
  const st = screen === 'battle' ? pickDisplaySnapshot(p.snapshots, p.presentedSeq) : null
  return {
    screen,
    phase: st?.phase ?? null,
    turningPoint: st?.turningPoint ?? 0,
    vp: st ? { A: st.players.A.vp, B: st.players.B.vp } : null,
    result: st?.result ?? null,
    perspective,
  }
}

let started = false

/** Idempotent. Subscribes to the session and the presentation cursor and keeps the manager's music request current. */
export function startMusicDirector(audio: AudioManager): void {
  if (started || typeof window === 'undefined') return
  started = true
  let last = ''
  const update = () => {
    const plan = musicPlan(currentInput())
    const key = `${plan.id}|${plan.rate}|${plan.loop}`
    if (key === last) return
    last = key
    audio.setMusic({ id: plan.id, rate: plan.rate, loop: plan.loop, fadeMs: plan.loop ? 1800 : 600 })
  }
  useSession.subscribe(update)
  usePresentedStore.subscribe(update)
  useGame.subscribe((s, prev) => {
    if (s.seats !== prev.seats) update()
  })
  update()
}
