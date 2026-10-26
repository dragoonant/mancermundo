// Interaction glue against the real engine: deploy candidates, activation by operative, the move preview
// (engine planMove) for legal and illegal paths, and the generic prompt path for unknown kinds.
import { beforeEach, describe, expect, it } from 'vitest'
import { act, legalActions, type GameState, type PendingDecision } from '@/engine'
import { RandomBot } from '@/client/bot/randomBot'
import { dataBundle } from '@/client/game/adapter'
import { defaultBuild, resolveLayout, resolveMission, resolveTeam } from '@/client/game/defaults'
import { deployAction, deployChoice, previewMove } from '@/client/interaction/controller'
import { useSettings } from '@/client/presentation/settings'
import { useGame } from '@/client/store/game'

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

/** Drive the game with the random bot until `done` is true for the pending decision. */
function driveUntil(done: (p: PendingDecision, s: GameState) => boolean, seed: string, limit = 400): { state: GameState; pending: PendingDecision } {
  const bot = new RandomBot(seed)
  for (let i = 0; i < limit; i++) {
    const { state, pending } = useGame.getState()
    if (!state || !pending) break
    if (done(pending, state)) return { state, pending }
    const a = pending.kind === 'firefight.action'
      ? (legalActions(state, pending) ?? []).find((x) => x.type === 'firefight.action' && ['reposition', 'dash'].includes(x.payload.action)) ?? bot.decide(state, pending)
      : bot.decide(state, pending)
    expect(useGame.getState().dispatch(a)).toBeNull()
  }
  throw new Error('decision not reached')
}

describe('interaction', () => {
  beforeEach(() => {
    useGame.getState().reset()
  })

  it('picks the first reserve operative to deploy unless the user chose another', () => {
    start('ix-1')
    const { pending } = driveUntil((p) => p.kind === 'setup.deploy', 'ix-1')
    const ids = pending.constraints!.operativeIds!
    expect(deployChoice(pending, null)).toBe(ids[0])
    expect(deployChoice(pending, ids[2]!)).toBe(ids[2])
    expect(deployChoice(pending, 'nobody')).toBe(ids[0])
    const a = deployAction(pending, ids[0]!, { x: 1.23456, z: 2, y: 0 })
    expect(a.type).toBe('setup.deploy')
    expect((a.payload as { x: number }).x).toBe(1.235)
  })

  it('activating an operative by option id advances to the order decision', () => {
    start('ix-2')
    const { pending } = driveUntil((p) => p.kind === 'firefight.activate', 'ix-2')
    const opt = pending.options![0]!
    expect(useGame.getState().choose(opt.id)).toBeNull()
    expect(useGame.getState().pending?.kind).toBe('firefight.order')
  })

  it('previews a legal path with the engine cost and an illegal one with the engine reason', () => {
    start('ix-3')
    const { state, pending } = driveUntil((p, s) => {
      if (p.kind !== 'firefight.action') return false
      const op = s.operatives[String(p.context.operativeId)]!
      return !!p.options?.some((o) => o.action.type === 'firefight.action' && o.action.payload.action === 'reposition') && op.status === 'active'
    }, 'ix-3')
    const reposition = pending.options!.find((o) => o.action.type === 'firefight.action' && o.action.payload.action === 'reposition')!
    expect(useGame.getState().dispatch(reposition.action)).toBeNull()
    const move = useGame.getState().pending!
    expect(move.kind).toBe('move.path')
    expect(move.canPass).toBe(true)
    const op = useGame.getState().state!.operatives[move.constraints!.operativeId!]!
    const near = previewMove(useGame.getState().state!, move, [{ x: op.pos.x + 0.01, z: op.pos.z + 1.5, y: op.pos.y }])
    // either the step is legal (cost 2) or the engine names why not; both come from planMove
    if (near.ok) expect(near.plan!.cost).toBe(2)
    else expect(near.rejection!.reason.length).toBeGreaterThan(0)
    const far = previewMove(useGame.getState().state!, move, [{ x: op.pos.x + 40, z: op.pos.z, y: op.pos.y }])
    expect(far.ok).toBe(false)
    expect(far.rejection).not.toBeNull()
    expect(previewMove(useGame.getState().state!, move, []).rejection).toBeNull()
    // cancelling answers the decision with pass and spends no AP
    const before = state.firefight.activation!.apSpent
    expect(useGame.getState().dispatch(act.pass(move))).toBeNull()
    expect(useGame.getState().state!.firefight.activation?.apSpent ?? before).toBe(before)
  })
})
