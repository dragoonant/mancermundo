// Shared helper for the client tests: play a whole game on the real engine with the random bot answering
// both seats, handing every step (state, pending decision about to be answered, events it produced) to a callback.
import { createGame, legalActions, step, type Action, type GameEvent, type GameState, type PendingDecision } from '@/engine'
import { RandomBot } from '@/client/bot/randomBot'
import { buildGameSetup, dataBundle, engineBundle } from '@/client/game/adapter'
import { defaultBuild, resolveLayout, resolveMission, resolveTeam } from '@/client/game/defaults'

export interface PlayOptions {
  seed: string
  teams?: [string, string]
  layout?: string
  mission?: string
  maxSteps?: number
  /** objective and equipment placement is left to the human prompts instead of the engine's suggestions */
  manual?: boolean
}

export interface StepInfo {
  /** state in which `pending` is open */
  state: GameState
  pending: PendingDecision
  /** events produced by the step that raised `pending` */
  events: GameEvent[]
}

export function playGame(opts: PlayOptions, onStep: (s: StepInfo) => void): { final: GameState; steps: number; events: GameEvent[] } {
  const b = dataBundle()
  const teams = opts.teams ?? ['aod', 'kom']
  const setup = buildGameSetup(b, defaultBuild(b, resolveTeam(b, teams[0])), defaultBuild(b, resolveTeam(b, teams[1])), {
    layoutId: resolveLayout(b, opts.layout ?? '01').id,
    missionId: resolveMission(b, opts.mission ?? 'secure').id,
    auto: opts.manual !== true,
  })
  let r = createGame(setup, opts.seed, engineBundle())
  const bots = { A: new RandomBot(`${opts.seed}:A`), B: new RandomBot(`${opts.seed}:B`) }
  const all: GameEvent[] = [...r.events]
  let steps = 0
  let events: GameEvent[] = r.events
  while (r.pending && r.state.phase !== 'ended' && steps < (opts.maxSteps ?? 4000)) {
    onStep({ state: r.state, pending: r.pending, events })
    const pending = r.pending
    const candidates: Action[] = []
    try {
      candidates.push(bots[pending.seat].decide(r.state, pending))
    } catch {
      /* use the enumerated answers */
    }
    candidates.push(...(legalActions(r.state, pending) ?? []))
    const suggestion = pending.context.suggestion as { x: number; z: number; yaw?: number } | undefined
    if (pending.kind === 'setup.equipMarker' && suggestion) {
      candidates.push({ type: 'setup.equipMarker', seat: pending.seat, decisionId: pending.id, payload: { x: suggestion.x, z: suggestion.z, ...(suggestion.yaw !== undefined ? { yaw: suggestion.yaw } : {}) } })
    }
    if (pending.canPass) candidates.push({ type: 'pass', seat: pending.seat, decisionId: pending.id, payload: {} })
    let next = null
    for (const a of candidates) {
      const n = step(r.state, a)
      if (!n.rejection) {
        next = n
        break
      }
    }
    if (!next) throw new Error(`no accepted answer for ${pending.kind} at step ${steps}`)
    r = next
    events = next.events
    all.push(...next.events)
    steps++
  }
  return { final: r.state, steps, events: all }
}
