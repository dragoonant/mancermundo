// Store reducer glue: the game store is the only step caller; it builds a real setup from src/data, answers
// bot seats, gates results behind the presentation cursor and reports rejections without changing state.
import { beforeEach, describe, expect, it } from 'vitest'
import { act } from '@/engine'
import { buildGameSetup, dataBundle, engineBundle } from '@/client/game/adapter'
import { defaultBuild, resolveLayout, resolveMission, resolveTeam } from '@/client/game/defaults'
import { useGame } from '@/client/store/game'
import { useSettings } from '@/client/presentation/settings'
import { usePresentedStore } from '@/client/presentation/presentedStore'
import { useFeedStore } from '@/client/presentation/feedStore'
import { createGame } from '@/engine'
import { groupFeed } from '@/client/presentation/feedStore'
import { useSession } from '@/client/store/session'

function opts(seats: { A: 'human' | 'bot'; B: 'human' | 'bot' }, seed = 'store-1') {
  const b = dataBundle()
  const tA = resolveTeam(b, 'aod')
  const tB = resolveTeam(b, 'kom')
  return {
    builds: { A: defaultBuild(b, tA), B: defaultBuild(b, tB) },
    seats,
    seed,
    missionId: resolveMission(b, 'secure').id,
    layoutId: resolveLayout(b, '01').id,
  }
}

describe('adapter', () => {
  it('builds a legal engine setup from real data for both teams on every layout and mission', () => {
    const b = dataBundle()
    for (const layout of Object.values(b.layouts)) {
      for (const mission of Object.values(b.missions)) {
        const o = opts({ A: 'human', B: 'bot' })
        const setup = buildGameSetup(b, o.builds.A, o.builds.B, { layoutId: layout.id, missionId: mission.id })
        const r = createGame(setup, 'seed-x', engineBundle())
        expect(r.pending?.kind).toBe('setup.initiative')
        expect(Object.keys(r.state.operatives).length).toBeGreaterThanOrEqual(12)
      }
    }
  })

  it('carries rosters, loadouts and team choices into the setup', () => {
    const b = dataBundle()
    const o = opts({ A: 'human', B: 'bot' })
    const setup = buildGameSetup(b, o.builds.A, o.builds.B, { layoutId: o.layoutId, missionId: o.missionId, mapId: 'auto' })
    expect(setup.rosters.A.length).toBe(6)
    expect(setup.rosters.B.length).toBe(11)
    expect(setup.mission?.missionId).toBe(o.missionId)
    expect(setup.mission?.mapId).toBe('prelim-1') // an official card names its own map (Map 1 is drawn for map prelim-1)
    expect(Object.keys(setup.teamChoices!.A)).toContain('primary-tactic')
  })
})

describe('game store', () => {
  beforeEach(() => {
    useSettings.getState().setAnimSpeed('instant')
    useGame.getState().reset()
    useFeedStore.setState({ toasts: [] })
  })

  it('starts a game on the first decision and keeps the presentation cursor in step', async () => {
    useGame.getState().newGame(opts({ A: 'human', B: 'human' }))
    const g = useGame.getState()
    expect(g.pending?.kind).toBe('setup.initiative')
    expect(g.pending?.seat).toBe('A')
    expect(g.legal?.length).toBe(1)
    await new Promise((r) => setTimeout(r, 20))
    const p = usePresentedStore.getState()
    expect(p.presentedSeq).toBe(p.latestSeq)
  })

  it('dispatches an accepted answer through step and advances the pending decision', async () => {
    useGame.getState().newGame(opts({ A: 'human', B: 'human' }))
    const rej = useGame.getState().choose('roll')
    expect(rej).toBeNull()
    expect(useGame.getState().pending?.seat).toBe('B')
    expect(useGame.getState().state?.seq).toBe(1)
  })

  it('reports a rejection (toast + record) and leaves the state untouched', () => {
    useGame.getState().newGame(opts({ A: 'human', B: 'human' }))
    const before = useGame.getState().state
    const pending = useGame.getState().pending!
    const rej = useGame.getState().dispatch(act.deploy(pending, 'A1', 0, 0))
    expect(rej).not.toBeNull()
    expect(useGame.getState().state).toBe(before)
    expect(useGame.getState().rejection?.code).toBe(rej!.code)
    expect(useFeedStore.getState().toasts.length).toBe(1)
  })

  it('plays two bot seats through setup, strategy and several activations', async () => {
    useGame.getState().newGame(opts({ A: 'bot', B: 'bot' }, 'store-bots'))
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const s = useGame.getState().state
      if (s && (s.phase === 'ended' || s.seq > 160)) break
      await new Promise((r) => setTimeout(r, 25))
    }
    const s = useGame.getState().state!
    expect(s.seq).toBeGreaterThan(80)
    expect(Object.values(s.operatives).every((o) => o.status !== 'reserve')).toBe(true)
  }, 20000)
})

describe('end screen helpers', () => {
  it('groups consecutive dice lines in the event feed and leaves the rest alone', () => {
    const e = (id: number, dice = false) => ({ id, seq: id, seat: null, text: `t${id}`, ...(dice ? { dice: true } : {}) })
    const g = groupFeed([e(1), e(2, true), e(3, true), e(4, true), e(5), e(6, true)])
    expect(g.map((x) => x.map((y) => y.id))).toEqual([[1], [2, 3, 4], [5], [6]])
  })

  it('Swap seats exchanges teams and human/bot and starts a new seed on the other side', () => {
    const s = useSession.getState()
    s.setSeat('A', 'human')
    s.setSeat('B', 'bot')
    s.setTeam('A', 'angels-of-death')
    s.setTeam('B', 'kommandos')
    s.setSeed('swap-1')
    useSession.getState().swapSeats()
    const after = useSession.getState()
    expect(after.builds.A.teamId).toBe('kommandos')
    expect(after.builds.B.teamId).toBe('angels-of-death')
    expect(after.seats).toEqual({ A: 'bot', B: 'human' })
    expect(after.seed).not.toBe('swap-1')
    expect(useGame.getState().state?.players.A.teamId).toBe('kommandos')
    expect(useGame.getState().seats).toEqual({ A: 'bot', B: 'human' })
    useGame.getState().reset()
  })
})
