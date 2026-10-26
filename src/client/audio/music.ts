// Music director: the title music on the menus and during set-up, battle-a / battle-b alternating per round with a crossfade,
// the tense track when a gang has bottled or is close to it (half its crew down) or the battle runs late, and a victory / defeat
// piece at the end; an ambience bed runs under the battle. `musicPlan` is pure; `startMusicDirector` wires it to the session and
// the presented (not the live) game state, so the music never gives a result away early.
import type { GameResult, GameState, Seat } from '@/engine'
import { pickDisplaySnapshot, usePresentedStore } from '../presentation/presentedStore'
import { useGame } from '../store/game'
import { useSession, type Screen } from '../store/session'
import type { AmbienceId, MusicId } from './ids'
import type { AudioManager } from './manager'

/** From this round on the battle music turns tense. */
export const LATE_ROUND = 6

export interface MusicInput {
  screen: Screen
  phase: GameState['phase'] | null
  round: number
  /** per gang: starting crew, fighters down (Out of Action, fled, Seriously Injured) and whether it has bottled */
  gangs: Record<Seat, { crew: number; down: number; bottled: boolean }> | null
  result: GameResult | null
  perspective: Seat
}

export interface MusicPlan {
  id: MusicId
  /** false for the end-of-battle pieces, which play once */
  loop: boolean
  tense: boolean
  ambience: AmbienceId | null
}

const seats: Seat[] = ['A', 'B']

export function musicPlan(i: MusicInput): MusicPlan {
  const menu: MusicPlan = { id: 'music-title', loop: true, tense: false, ambience: null }
  if (i.screen !== 'battle' || i.phase === null || i.phase === 'setup' || i.round < 1) return menu
  if (i.phase === 'ended') {
    const w = i.result?.winner
    if (!w || w === 'draw') return menu
    return { id: w === i.perspective ? 'music-victory' : 'music-defeat', loop: false, tense: false, ambience: null }
  }
  const nearBottle = !!i.gangs && seats.some((s) => i.gangs![s].bottled || (i.gangs![s].crew > 0 && i.gangs![s].down * 2 >= i.gangs![s].crew))
  const tense = nearBottle || i.round >= LATE_ROUND
  return { id: tense ? 'music-tense' : i.round % 2 === 1 ? 'music-battle-a' : 'music-battle-b', loop: true, tense, ambience: 'amb-hive-hum' }
}

function gangsOf(st: GameState): NonNullable<MusicInput['gangs']> {
  const one = (seat: Seat) => ({
    crew: st.players[seat].startingCrew,
    down: Object.values(st.fighters).filter((f) => f.seat === seat && (f.location === 'outOfAction' || f.location === 'fled' || f.posture === 'seriouslyInjured')).length,
    bottled: st.players[seat].bottled,
  })
  return { A: one('A'), B: one('B') }
}

function currentInput(): MusicInput {
  const screen = useSession.getState().screen
  const { seats: modes } = useGame.getState()
  const perspective: Seat = modes.A === 'human' ? 'A' : modes.B === 'human' ? 'B' : 'A'
  const p = usePresentedStore.getState()
  const st = screen === 'battle' ? pickDisplaySnapshot(p.snapshots, p.presentedSeq) : null
  return { screen, phase: st?.phase ?? null, round: st?.round ?? 0, gangs: st ? gangsOf(st) : null, result: st?.result ?? null, perspective }
}

let started = false

/** Idempotent. Subscribes to the session and the presentation cursor and keeps the manager's music and ambience current. */
export function startMusicDirector(audio: AudioManager): void {
  if (started || typeof window === 'undefined') return
  started = true
  let last = ''
  const update = () => {
    const plan = musicPlan(currentInput())
    const key = `${plan.id}|${plan.loop}|${plan.ambience}`
    if (key === last) return
    last = key
    audio.setMusic({ id: plan.id, rate: 1, loop: plan.loop, fadeMs: plan.loop ? 1800 : 600 })
    audio.setAmbience(plan.ambience)
  }
  useSession.subscribe(update)
  usePresentedStore.subscribe(update)
  useGame.subscribe((s, prev) => {
    if (s.seats !== prev.seats) update()
  })
  update()
}
