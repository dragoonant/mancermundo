// Rejections: a bot seat's rejected answer is only logged, and a human's rejected answers never stack up as
// toasts (at most one rejection toast on screen, the newest replacing the previous one).
import { beforeEach, describe, expect, it } from 'vitest'
import { act } from '@/engine'
import { dataBundle } from '@/client/game/adapter'
import { defaultBuild, resolveLayout, resolveMission, resolveTeam } from '@/client/game/defaults'
import { useFeedStore } from '@/client/presentation/feedStore'
import { useSettings } from '@/client/presentation/settings'
import { useGame } from '@/client/store/game'

function start(seats: { A: 'human' | 'bot'; B: 'human' | 'bot' }) {
  const b = dataBundle()
  useGame.getState().newGame({
    builds: { A: defaultBuild(b, resolveTeam(b, 'aod')), B: defaultBuild(b, resolveTeam(b, 'kom')) },
    seats,
    seed: 'rej-1',
    missionId: resolveMission(b, 'secure').id,
    layoutId: resolveLayout(b, '01').id,
  })
}

describe('rejection toasts', () => {
  beforeEach(() => {
    useSettings.getState().setAnimSpeed('instant')
    useGame.getState().reset()
    useFeedStore.setState({ toasts: [] })
  })

  it('a human sees one toast however many bad answers in a row', () => {
    start({ A: 'human', B: 'human' })
    // walk to the first deploy decision: both roll-offs, the set-up initiative choice, the drop zones
    for (let i = 0; i < 12 && useGame.getState().pending?.kind !== 'setup.deploy'; i++) {
      const g = useGame.getState()
      g.choose(g.pending!.options![0]!.id)
    }
    const g = useGame.getState()
    expect(g.pending?.kind).toBe('setup.deploy')
    const id = g.pending!.constraints!.operativeIds![0]!
    for (let i = 0; i < 4; i++) expect(g.dispatch(act.deploy(useGame.getState().pending!, id, 0, 0))).not.toBeNull()
    const toasts = useFeedStore.getState().toasts.filter((t) => t.kind === 'error')
    expect(toasts.length).toBe(1)
  })

  it('a bot seat\'s rejected answer shows no toast and leaves the state alone', () => {
    start({ A: 'bot', B: 'bot' })
    const before = useGame.getState().state
    const pending = useGame.getState().pending!
    const rej = useGame.getState().dispatch(act.deploy(pending, 'A1', 0, 0))
    expect(rej).not.toBeNull()
    expect(useGame.getState().state).toBe(before)
    expect(useFeedStore.getState().toasts).toEqual([])
  })
})
