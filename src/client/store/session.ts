// Menu-flow store: which screen is showing and the pre-game configuration (seats, teams, mission, layout,
// seed, rosters). The game itself lives in store/game.ts; this store only hands it a NewGameOptions.
import { create } from 'zustand'
import type { Seat } from '@/engine'
import { dataBundle, type SeatBuild } from '../game/adapter'
import { AUTO_LAYOUT, defaultBuild, effectiveLayout, fullBuild, missionList, resolveLayout, resolveMission, resolveTeam, teamList } from '../game/defaults'
import type { SeatMode, UrlParams } from '../params'
import { getBotTier, setBotTier, type BotTier } from '../bot/botTier'
import { getMatPref, setMatPref } from '../board/mats'
import { useGame, type NewGameOptions } from './game'
import { clearSave, DISCARD_MESSAGE, readSave, summarize, type DiscardReason, type SaveSummary } from './saveGame'

export type Screen = 'start' | 'builder' | 'briefing' | 'battle'

export interface Session {
  screen: Screen
  seats: Record<Seat, SeatMode>
  seed: string
  missionId: string
  /** a layout id, or 'auto' to roll one of the six official cards from the seed */
  layoutId: string
  builds: Record<Seat, SeatBuild>
  builderSeat: Seat
  /** place objective and equipment markers by hand instead of taking the engine's suggestions */
  manualPlacement: boolean
  setManualPlacement(v: boolean): void
  /** AI tier for bot seats; persisted */
  botTier: BotTier
  setBotTier(t: BotTier): void
  /** floor mat: a mat id or 'random'; persisted */
  matId: string
  setMat(id: string): void
  /** the briefing was opened from the Start screen's How to play link (scroll to Controls, Back returns to Start) */
  howTo: boolean
  openHowTo(): void
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
  setScreen(s: Screen): void
  setSeat(seat: Seat, mode: SeatMode): void
  setSeed(seed: string): void
  setMission(id: string): void
  setLayout(id: string): void
  setTeam(seat: Seat, teamId: string): void
  setBuild(seat: Seat, build: SeatBuild): void
  setBuilderSeat(seat: Seat): void
  launch(prepare?: NewGameOptions['prepare']): void
  /** exchange the two sides (teams, rosters, human/bot) and start again with a fresh seed */
  swapSeats(): void
  backToMenu(): void
}

export function randomSeed(): string {
  return `ms-${Math.floor(Math.random() * 1_000_000).toString(36)}`
}

function initial(): Pick<Session, 'seats' | 'seed' | 'missionId' | 'layoutId' | 'builds' | 'builderSeat' | 'manualPlacement'> {
  const b = dataBundle()
  const teams = teamList(b)
  const tA = teams[0]!
  const tB = teams[1] ?? teams[0]!
  return {
    seats: { A: 'human', B: 'bot' },
    seed: randomSeed(),
    missionId: missionList(b)[0]!.id,
    layoutId: AUTO_LAYOUT,
    builds: { A: defaultBuild(b, tA), B: defaultBuild(b, tB) },
    builderSeat: 'A',
    manualPlacement: false,
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
    set({ seats: { ...m.seats }, seed: m.seed, missionId: m.missionId, layoutId: m.layoutId, builds: m.builds, botTier: m.botTier, saveNotice: null, confirmReplace: false, screen: 'battle' })
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
    set({ screen: 'start', savedGame: null, saveNotice: null, confirmReplace: false, howTo: false })
  },
  dismissSaveNotice: () => set({ saveNotice: null }),
  setManualPlacement: (manualPlacement) => set({ manualPlacement }),
  botTier: getBotTier(),
  setBotTier: (botTier) => {
    setBotTier(botTier)
    set({ botTier })
  },
  matId: getMatPref(),
  setMat: (matId) => {
    setMatPref(matId)
    set({ matId })
  },
  howTo: false,
  openHowTo: () => set({ howTo: true, screen: 'briefing' }),
  setScreen: (screen) => set(screen === 'start' || screen === 'builder' ? { screen, howTo: false } : { screen }),
  setSeat: (seat, mode) => set((s) => ({ seats: { ...s.seats, [seat]: mode } })),
  setSeed: (seed) => set({ seed }),
  setMission: (missionId) => set({ missionId }),
  setLayout: (layoutId) => set({ layoutId }),
  setTeam: (seat, teamId) =>
    set((s) => {
      const b = dataBundle()
      return { builds: { ...s.builds, [seat]: defaultBuild(b, b.teams[teamId]!) } }
    }),
  setBuild: (seat, build) => set((s) => ({ builds: { ...s.builds, [seat]: build } })),
  setBuilderSeat: (builderSeat) => set({ builderSeat }),
  launch(prepare) {
    const s = get()
    useGame.getState().newGame({
      builds: s.builds,
      seats: s.seats,
      seed: s.seed,
      missionId: s.missionId,
      layoutId: s.layoutId,
      manualPlacement: s.manualPlacement,
      botTier: s.botTier,
      ...(prepare ? { prepare } : {}),
    })
    set({ screen: 'battle', saveNotice: null, confirmReplace: false })
    get().refreshSave()
  },
  swapSeats() {
    const s = get()
    // same layout on the new seed: a rolled card stays the one just played
    const layoutId = effectiveLayout(dataBundle(), s.layoutId, s.seed).id
    set({ builds: { A: s.builds.B, B: s.builds.A }, seats: { A: s.seats.B, B: s.seats.A }, seed: randomSeed(), layoutId })
    get().launch()
  },
  backToMenu() {
    useGame.getState().reset()
    set({ screen: 'start' })
    // the game in progress stays saved: the Start screen offers Continue
    get().refreshSave()
  },
}))

/** ?test=1: skip the menus. Default rosters, chosen teams/mission/layout/seats/seed, straight to the battle. */
export function startFromParams(p: UrlParams): void {
  const b = dataBundle()
  const teams = teamList(b)
  const tA = resolveTeam(b, p.teams?.[0], 0)
  const tB = resolveTeam(b, p.teams?.[1], teams.length > 1 ? 1 : 0)
  const mission = resolveMission(b, p.mission)
  // ?layout=auto rolls one of the cards from the seed; no layout param keeps the first card so test runs stay put
  const layoutId = p.layout?.toLowerCase() === AUTO_LAYOUT ? AUTO_LAYOUT : resolveLayout(b, p.layout).id
  useSession.setState({
    seats: { A: p.seats[0], B: p.seats[1] },
    seed: p.seed ?? 'test',
    missionId: mission.id,
    layoutId,
    builds: { A: defaultBuild(b, tA), B: defaultBuild(b, tB) },
    manualPlacement: p.place === 'manual',
  })
  if (p.scenario) {
    // dev fixtures load on demand so they never weigh on the menus
    const name = p.scenario
    void import('../dev/scenarios').then(({ buildScenario }) => {
      useSession.setState({ seats: { A: 'human', B: 'human' }, builds: { A: fullBuild(b, resolveTeam(b, 'aod')), B: fullBuild(b, resolveTeam(b, 'kom')) }, layoutId: resolveLayout(b, '1').id, missionId: resolveMission(b, 'secure').id, seed: p.seed ?? `scenario-${name}` })
      useSession.getState().launch((state) => buildScenario(name, state))
    })
    return
  }
  useSession.getState().launch()
}
