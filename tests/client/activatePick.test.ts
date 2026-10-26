// Touch activation: tapping a legal operative on the board only marks it; the player confirms in the prompt.
import { beforeEach, describe, expect, it } from 'vitest'
import { legalActions, type GameState, type PendingDecision } from '@/engine'
import { RandomBot } from '@/client/bot/randomBot'
import { dataBundle } from '@/client/game/adapter'
import { defaultBuild, resolveLayout, resolveMission, resolveTeam } from '@/client/game/defaults'
import { activateOption, cancelActivate, clickOperative, confirmActivate, pendingPick } from '@/client/interaction/controller'
import { useSettings } from '@/client/presentation/settings'
import { useGame } from '@/client/store/game'
import { useUi } from '@/client/ui/uiStore'

function start(seed: string) {
  const b = dataBundle()
  useSettings.getState().setAnimSpeed('instant')
  useGame.getState().newGame({
    builds: { A: defaultBuild(b, resolveTeam(b, 'aod')), B: defaultBuild(b, resolveTeam(b, 'kom')) },
    seats: { A: 'human', B: 'human' },
    seed,
    missionId: resolveMission(b, 'secure').id,
    layoutId: resolveLayout(b, '01').id,
  })
}

/** Drive with the random bot to the first activate decision (a later one than the opening, so there is something to compare). */
function toActivate(seed: string): { state: GameState; pending: PendingDecision } {
  const bot = new RandomBot(seed)
  for (let i = 0; i < 400; i++) {
    const { state, pending } = useGame.getState()
    if (!state || !pending) break
    if (pending.kind === 'firefight.activate') return { state, pending }
    expect(useGame.getState().dispatch(legalActions(state, pending)?.[0] ?? bot.decide(state, pending))).toBeNull()
  }
  throw new Error('activate decision not reached')
}

const legalId = (p: PendingDecision) => (p.options![0]!.action.payload as { operativeId: string }).operativeId

describe('touch activation pick', () => {
  beforeEach(() => {
    useGame.getState().reset()
    useUi.setState({ pendingActivate: null, selectedOp: null })
  })

  it('tapping a legal operative sets a pending pick and sends nothing', () => {
    start('ap-1')
    const { pending } = toActivate('ap-1')
    const id = legalId(pending)
    clickOperative(id, { touch: true })
    expect(useUi.getState().pendingActivate).toBe(id)
    expect(useUi.getState().selectedOp).toBe(id)
    expect(pendingPick(useGame.getState().pending)).toBe(id)
    expect(useGame.getState().pending?.id).toBe(pending.id)
  })

  it('tapping an operative that is not an option leaves the pick alone and activates nothing', () => {
    start('ap-2')
    const { state, pending } = toActivate('ap-2')
    const legal = new Set((pending.options ?? []).map((o) => (o.action.payload as { operativeId?: string }).operativeId))
    const other = Object.keys(state.operatives).find((k) => !legal.has(k))!
    clickOperative(other, { touch: true })
    expect(useUi.getState().pendingActivate).toBeNull()
    expect(useGame.getState().pending?.id).toBe(pending.id)
    // a second legal operative switches the pick
    const ids = [...legal].filter((x): x is string => !!x)
    clickOperative(ids[0]!, { touch: true })
    clickOperative(other, { touch: true })
    expect(useUi.getState().pendingActivate).toBe(ids[0])
    if (ids.length > 1) {
      clickOperative(ids[1]!, { touch: true })
      expect(useUi.getState().pendingActivate).toBe(ids[1])
    }
  })

  it('confirm sends the activation of the picked operative; cancel drops the pick', () => {
    start('ap-3')
    const { pending } = toActivate('ap-3')
    const id = legalId(pending)
    clickOperative(id, { touch: true })
    cancelActivate()
    expect(useUi.getState().pendingActivate).toBeNull()
    expect(confirmActivate()).toBeNull()
    expect(useGame.getState().pending?.id).toBe(pending.id)
    clickOperative(id, { touch: true })
    expect(confirmActivate()).toBeNull()
    const next = useGame.getState().pending!
    expect(next.kind).toBe('firefight.order')
    expect((next.context as { operativeId?: string }).operativeId).toBe(id)
    expect(useUi.getState().pendingActivate).toBeNull()
  })

  it('a decision change clears the pick, and a stale pick never counts', () => {
    start('ap-4')
    const { pending } = toActivate('ap-4')
    const id = legalId(pending)
    clickOperative(id, { touch: true })
    expect(useGame.getState().choose(activateOption(pending, id)!.id)).toBeNull()
    expect(useUi.getState().pendingActivate).toBeNull()
    useUi.setState({ pendingActivate: id })
    expect(pendingPick(useGame.getState().pending)).toBeNull()
  })

  it('without touch a board click still activates straight away', () => {
    start('ap-5')
    const { pending } = toActivate('ap-5')
    clickOperative(legalId(pending), { touch: false })
    expect(useUi.getState().pendingActivate).toBeNull()
    expect(useGame.getState().pending?.kind).toBe('firefight.order')
  })
})
