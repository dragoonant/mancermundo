// Menu-flow store: which screen is showing and the pre-game configuration (seats, teams, mission, layout,
// seed, rosters). The game itself lives in store/game.ts; this store only hands it a NewGameOptions.
import { create } from 'zustand'
import type { Seat } from '@/engine'
import { dataBundle, type SeatBuild } from '../game/adapter'
import { defaultBuild, layoutList, missionList, resolveLayout, resolveMission, resolveTeam, teamList } from '../game/defaults'
import type { SeatMode, UrlParams } from '../params'
import { getBotTier, setBotTier, type BotTier } from '../bot/botTier'
import { getMatPref, setMatPref } from '../board/mats'
import { useGame, type NewGameOptions } from './game'

export type Screen = 'start' | 'builder' | 'briefing' | 'battle'

export interface Session {
  screen: Screen
  seats: Record<Seat, SeatMode>
  seed: string
  missionId: string
  layoutId: string
  /** 'auto' lets the seed roll the map */
  mapId: string
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
  setScreen(s: Screen): void
  setSeat(seat: Seat, mode: SeatMode): void
  setSeed(seed: string): void
  setMission(id: string): void
  setLayout(id: string): void
  setMap(id: string): void
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

function initial(): Pick<Session, 'seats' | 'seed' | 'missionId' | 'layoutId' | 'mapId' | 'builds' | 'builderSeat' | 'manualPlacement'> {
  const b = dataBundle()
  const teams = teamList(b)
  const tA = teams[0]!
  const tB = teams[1] ?? teams[0]!
  return {
    seats: { A: 'human', B: 'bot' },
    seed: randomSeed(),
    missionId: missionList(b)[0]!.id,
    layoutId: layoutList(b)[0]!.id,
    mapId: 'auto',
    builds: { A: defaultBuild(b, tA), B: defaultBuild(b, tB) },
    builderSeat: 'A',
    manualPlacement: false,
  }
}

export const useSession = create<Session>((set, get) => ({
  screen: 'start',
  ...initial(),
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
  setMap: (mapId) => set({ mapId }),
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
      mapId: s.mapId === 'auto' ? null : s.mapId,
      manualPlacement: s.manualPlacement,
      botTier: s.botTier,
      ...(prepare ? { prepare } : {}),
    })
    set({ screen: 'battle' })
  },
  swapSeats() {
    const s = get()
    set({ builds: { A: s.builds.B, B: s.builds.A }, seats: { A: s.seats.B, B: s.seats.A }, seed: randomSeed() })
    get().launch()
  },
  backToMenu() {
    useGame.getState().reset()
    set({ screen: 'start' })
  },
}))

/** ?test=1: skip the menus. Default rosters, chosen teams/mission/layout/seats/seed, straight to the battle. */
export function startFromParams(p: UrlParams): void {
  const b = dataBundle()
  const teams = teamList(b)
  const tA = resolveTeam(b, p.teams?.[0], 0)
  const tB = resolveTeam(b, p.teams?.[1], teams.length > 1 ? 1 : 0)
  const mission = resolveMission(b, p.mission)
  const layout = resolveLayout(b, p.layout)
  useSession.setState({
    seats: { A: p.seats[0], B: p.seats[1] },
    seed: p.seed ?? 'test',
    missionId: mission.id,
    layoutId: layout.id,
    mapId: p.map ?? 'auto',
    builds: { A: defaultBuild(b, tA), B: defaultBuild(b, tB) },
    manualPlacement: p.place === 'manual',
  })
  if (p.scenario) {
    // dev fixtures load on demand so they never weigh on the menus
    const name = p.scenario
    void import('../dev/scenarios').then(({ buildScenario }) => {
      useSession.setState({ seats: { A: 'human', B: 'human' }, builds: { A: defaultBuild(b, resolveTeam(b, 'aod')), B: defaultBuild(b, resolveTeam(b, 'kom')) }, layoutId: resolveLayout(b, '01').id, mapId: 'prelim-1', missionId: resolveMission(b, 'secure').id, seed: p.seed ?? `scenario-${name}` })
      useSession.getState().launch((state) => buildScenario(name, state))
    })
    return
  }
  useSession.getState().launch()
}
