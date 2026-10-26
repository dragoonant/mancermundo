// Menu-flow store: which screen is showing and the pre-game configuration (seats, scenario, board, starter gangs, seed). The game
// itself lives in store/game.ts; this store only hands it a NewGameOptions. S5c grows the flow (gang picker, briefing, end screen).
import { create } from 'zustand'
import type { Seat } from '@/engine'
import { dataBundle, type SeatBuild } from '../game/adapter'
import { defaultStarters, resolveBoard, resolveScenario, resolveStarter } from '../game/defaults'
import type { SeatMode, UrlParams } from '../params'
import { useGame, type NewGameOptions } from './game'
import { clearSave, DISCARD_MESSAGE, readSave, summarize, type DiscardReason, type SaveSummary } from './saveGame'

export type Screen = 'start' | 'battle'

export interface Session {
  screen: Screen
  seats: Record<Seat, SeatMode>
  seed: string
  scenarioId: string
  boardId: string
  builds: Record<Seat, SeatBuild>
  /** the game in progress kept on this device (Continue card), or null */
  savedGame: SaveSummary | null
  /** shown on the Start screen after a save had to be thrown away */
  saveNotice: string | null
  /** a new game was asked for while a save exists: waiting for the player to confirm replacing it */
  confirmReplace: boolean
  /** re-read the stored save: fills `savedGame`, or discards a bad one and sets `saveNotice` */
  refreshSave(): void
  /** open the saved game; false (save cleared, notice set) when it cannot be restored exactly */
  continueSaved(): boolean
  /** start the battle, but ask first when a save would be replaced */
  requestLaunch(): void
  confirmLaunch(): void
  cancelLaunch(): void
  /** give up the game in progress: clears the save and returns to the Start screen */
  abandonGame(): void
  dismissSaveNotice(): void
  setSeat(seat: Seat, mode: SeatMode): void
  setSeed(seed: string): void
  setScenario(id: string): void
  setBoard(id: string): void
  setStarter(seat: Seat, starterId: string): void
  launch(prepare?: NewGameOptions['prepare']): void
  /** exchange the two sides (gangs, human/bot) and start again with a fresh seed */
  swapSeats(): void
  backToMenu(): void
}

export function randomSeed(): string {
  return `ms-${Math.floor(Math.random() * 1_000_000).toString(36)}`
}

function initial(): Pick<Session, 'seats' | 'seed' | 'scenarioId' | 'boardId' | 'builds'> {
  const b = dataBundle()
  const scn = resolveScenario(b, null)
  const starters = defaultStarters(b)
  return {
    seats: { A: 'human', B: 'bot' },
    seed: randomSeed(),
    scenarioId: scn.id,
    boardId: resolveBoard(b, scn.id, null),
    builds: { A: { starterId: starters.A }, B: { starterId: starters.B } },
  }
}

/** Check the stored save; a bad one is cleared here so the Start screen is never left pointing at it. */
function inspectSave(): { savedGame: SaveSummary | null; saveNotice: string | null } {
  const r = readSave()
  if (r.status === 'ok') {
    try {
      return { savedGame: summarize(r.env), saveNotice: null }
    } catch {
      clearSave()
      return { savedGame: null, saveNotice: DISCARD_MESSAGE.outdated }
    }
  }
  if (r.status === 'bad') {
    clearSave()
    return { savedGame: null, saveNotice: DISCARD_MESSAGE[r.reason] }
  }
  return { savedGame: null, saveNotice: null }
}

export const useSession = create<Session>((set, get) => ({
  screen: 'start',
  ...initial(),
  ...inspectSave(),
  confirmReplace: false,
  refreshSave() {
    const found = inspectSave()
    // keep an earlier notice until the player dismisses it or starts something
    set((s) => ({ savedGame: found.savedGame, saveNotice: found.saveNotice ?? s.saveNotice }))
  },
  continueSaved() {
    const r = readSave()
    if (r.status !== 'ok') {
      clearSave()
      set({ savedGame: null, saveNotice: DISCARD_MESSAGE[r.status === 'bad' ? r.reason : 'outdated'] })
      return false
    }
    const { env } = r
    try {
      useGame.getState().restore(env)
    } catch (e) {
      console.warn('[save] could not restore, discarding', e)
      const reason: DiscardReason = 'outdated'
      clearSave()
      set({ savedGame: null, saveNotice: DISCARD_MESSAGE[reason] })
      return false
    }
    const m = env.meta
    set({ seats: { ...m.seats }, seed: m.seed, scenarioId: m.scenarioId, boardId: m.boardId, builds: m.builds, saveNotice: null, confirmReplace: false, screen: 'battle' })
    return true
  },
  requestLaunch() {
    if (get().savedGame) set({ confirmReplace: true })
    else get().launch()
  },
  confirmLaunch() {
    set({ confirmReplace: false })
    get().launch()
  },
  cancelLaunch: () => set({ confirmReplace: false }),
  abandonGame() {
    clearSave()
    useGame.getState().reset()
    set({ screen: 'start', savedGame: null, saveNotice: null, confirmReplace: false })
  },
  dismissSaveNotice: () => set({ saveNotice: null }),
  setSeat: (seat, mode) => set((s) => ({ seats: { ...s.seats, [seat]: mode } })),
  setSeed: (seed) => set({ seed }),
  setScenario: (scenarioId) => set({ scenarioId, boardId: resolveBoard(dataBundle(), scenarioId, get().boardId) }),
  setBoard: (boardId) => set({ boardId }),
  setStarter: (seat, starterId) => set((s) => ({ builds: { ...s.builds, [seat]: { starterId } } })),
  launch(prepare) {
    const s = get()
    useGame.getState().newGame({
      builds: s.builds,
      seats: s.seats,
      seed: s.seed,
      scenarioId: s.scenarioId,
      boardId: s.boardId,
      ...(prepare ? { prepare } : {}),
    })
    set({ screen: 'battle', saveNotice: null, confirmReplace: false })
    get().refreshSave()
  },
  swapSeats() {
    const s = get()
    set({ builds: { A: s.builds.B, B: s.builds.A }, seats: { A: s.seats.B, B: s.seats.A }, seed: randomSeed() })
    get().launch()
  },
  backToMenu() {
    useGame.getState().reset()
    set({ screen: 'start' })
    // the game in progress stays saved: the Start screen offers Continue
    get().refreshSave()
  },
}))

/** ?test=1: skip the menus. Default gangs, chosen scenario/board/seats/seed, straight to the battle. */
export function startFromParams(p: UrlParams): void {
  const b = dataBundle()
  const scn = resolveScenario(b, p.scenario)
  const defaults = defaultStarters(b)
  const a = p.starters ? resolveStarter(b, p.starters[0], 0).id : p.gangs ? resolveStarter(b, p.gangs[0], 0).id : defaults.A
  const bb = p.starters ? resolveStarter(b, p.starters[1], 1).id : p.gangs ? resolveStarter(b, p.gangs[1], 1).id : defaults.B
  useSession.setState({
    seats: { A: p.seats[0], B: p.seats[1] },
    seed: p.seed ?? 'test',
    scenarioId: scn.id,
    boardId: resolveBoard(b, scn.id, p.board),
    builds: { A: { starterId: a }, B: { starterId: bb } },
  })
  useSession.getState().launch()
}
