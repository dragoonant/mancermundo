// Interaction glue against the real engine: deploy candidates, activation by operative, the move preview
// (engine planMove) for legal and illegal paths, and the generic prompt path for unknown kinds.
import { beforeEach, describe, expect, it } from 'vitest'
import { act, legalActions, type GameState, type PendingDecision } from '@/engine'
import { RandomBot } from '@/client/bot/randomBot'
import { dataBundle } from '@/client/game/adapter'
import { defaultBuild, resolveLayout, resolveMission, resolveTeam } from '@/client/game/defaults'
import { deployAction, deployChoice, moveReach, previewMove, snapStep } from '@/client/interaction/controller'
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

/** A ploy window (Adjust Doctrine and the like) may open after an action is declared: decline it to reach the action's own decision. */
function declinePloys(): void {
  for (let i = 0; i < 5 && useGame.getState().pending?.kind === 'ploy.firefight'; i++) expect(useGame.getState().pass()).toBeNull()
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
    declinePloys()
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

  /** Start a reposition and return the move.path decision with its operative. */
  function startMovePath(seed: string) {
    start(seed)
    const { pending } = driveUntil((p, s) => {
      if (p.kind !== 'firefight.action') return false
      const op = s.operatives[String(p.context.operativeId)]!
      return !!p.options?.some((o) => o.action.type === 'firefight.action' && o.action.payload.action === 'reposition') && op.status === 'active'
    }, seed)
    const reposition = pending.options!.find((o) => o.action.type === 'firefight.action' && o.action.payload.action === 'reposition')!
    expect(useGame.getState().dispatch(reposition.action)).toBeNull()
    declinePloys()
    const move = useGame.getState().pending!
    const state = useGame.getState().state!
    return { state, move, op: state.operatives[move.constraints!.operativeId!]! }
  }

  it('moveReach with no waypoints is a full circle of the move around the operative, terrain ignored', () => {
    const { state, move, op } = startMovePath('ix-3')
    const reach = moveReach(state, move, [])
    expect(reach).not.toBeNull()
    expect(reach!.centre).toEqual({ x: op.pos.x, y: op.pos.y, z: op.pos.z })
    expect(reach!.left).toBe(move.constraints!.maxInches ?? Number(move.context.maxInches))
    for (const p of reach!.points) expect(Math.hypot(p.x - op.pos.x, p.z - op.pos.z)).toBeCloseTo(reach!.left, 6)
  })

  it('moveReach after a waypoint centres on the plan end with the inches left', () => {
    const { state, move, op } = startMovePath('ix-3')
    const wp = [0, 1, 2, 3, 4, 5, 6, 7]
      .map((k) => ({ x: op.pos.x + Math.sin(k * 0.8) * 1.5, z: op.pos.z + Math.cos(k * 0.8) * 1.5, y: op.pos.y }))
      .find((w) => previewMove(state, move, [w]).ok)!
    expect(wp).toBeDefined()
    const plan = previewMove(state, move, [wp]).plan!
    const reach = moveReach(state, move, [wp])!
    expect(reach.centre).toEqual({ x: plan.end.x, y: plan.end.y, z: plan.end.z })
    expect(reach.left).toBe(plan.maxInches - plan.cost)
    for (const p of reach.points) expect(Math.hypot(p.x - reach.centre.x, p.z - reach.centre.z)).toBeCloseTo(reach.left, 6)
  })

  it('a flat click past the range snaps to its edge and the engine accepts the full move', () => {
    const { state, move, op } = startMovePath('ix-3')
    const max = move.constraints!.maxInches!
    // the open bearing where a straight full-length step is legal
    const dir = Array.from({ length: 48 }, (_, i) => (i / 48) * Math.PI * 2).find((b) => {
      const snapped = snapStep(state, move, [], { x: op.pos.x + Math.sin(b) * 20, z: op.pos.z + Math.cos(b) * 20, y: op.pos.y })
      return previewMove(state, move, [snapped]).ok
    })
    expect(dir).toBeDefined()
    const snapped = snapStep(state, move, [], { x: op.pos.x + Math.sin(dir!) * 20, z: op.pos.z + Math.cos(dir!) * 20, y: op.pos.y })
    expect(Math.hypot(snapped.x - op.pos.x, snapped.z - op.pos.z)).toBeCloseTo(max, 2)
    expect(previewMove(state, move, [snapped]).plan!.cost).toBe(max)
    // a click inside the range is left where it is
    const inside = { x: op.pos.x + Math.sin(dir!) * 1.2, z: op.pos.z + Math.cos(dir!) * 1.2, y: op.pos.y }
    expect(snapStep(state, move, [], inside)).toEqual(inside)
  })

  it('moveReach returns to the original range when the path is undone', () => {
    const { state, move } = startMovePath('ix-3')
    const op = state.operatives[move.constraints!.operativeId!]!
    const first = moveReach(state, move, [])
    const wp = [0, 1, 2, 3, 4, 5, 6, 7]
      .map((k) => ({ x: op.pos.x + Math.sin(k * 0.8) * 1.5, z: op.pos.z + Math.cos(k * 0.8) * 1.5, y: op.pos.y }))
      .find((w) => previewMove(state, move, [w]).ok)!
    const moved = moveReach(state, move, [wp])!
    expect(moved.left).toBeLessThan(first!.left)
    expect(moveReach(state, move, [])).toEqual(first)
  })
})
