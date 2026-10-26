// Random-legal bot for bot seats, ported from the RandomBot in tools/sim-core.ts (tools are never imported by src). Finite
// decisions pick a random legal action (an action type first, so a rare door option is not drowned by eighteen turn facings);
// continuous ones (deploy, move.path) build a candidate and keep it only if `validate` accepts it, else take the engine's
// `suggest`. It also implements the engine `Decider` shape. The AI tiers (S6) replace it in the store's bot loop later.
import { act, legalActions, SeededRng, suggest, validate, type Action, type Decider, type GameState, type PendingDecision, type PlayerView } from '@/engine'
import { polygonBBox, round3 } from '@/engine/geometry'

export class RandomBot {
  private readonly rng: SeededRng
  constructor(seed: string) {
    this.rng = SeededRng.fromSeed(`bot:${seed}`)
  }

  private float(): number {
    return this.rng.next32() / 0x100000000
  }

  private int(n: number): number {
    return this.rng.int(n)
  }

  /** Never throws for a decision the engine can raise: unknown continuous kinds fall back to the suggestion, then pass. */
  decide(state: GameState, pending: PendingDecision): Action {
    const legal = legalActions(state, pending)
    if (legal && legal.length > 0) return pending.kind === 'action.choose' ? this.choose(legal) : legal[this.int(legal.length)]!
    if (pending.kind === 'setup.deploy') return this.deploy(state, pending)
    if (pending.kind === 'move.path') return this.move(state, pending)
    const s = suggest(state, pending)
    if (s) return s
    if (pending.canPass) return act.pass(pending)
    throw new Error(`bot cannot answer ${pending.kind}`)
  }

  private choose(legal: Action[]): Action {
    const groups = new Map<string, Action[]>()
    for (const a of legal) {
      const key = a.type === 'action.choose' ? a.payload.action : a.type
      const list = groups.get(key)
      if (list) list.push(a)
      else groups.set(key, [a])
    }
    const keys = [...groups.keys()]
    // finishing early and turning are less interesting than acting: half weight
    const weights = keys.map((k) => (k === 'end' || k === 'turn' ? 0.5 : 1))
    let roll = this.float() * weights.reduce((x, y) => x + y, 0)
    let pick = keys[keys.length - 1]!
    for (let i = 0; i < keys.length; i++) {
      roll -= weights[i]!
      if (roll < 0) {
        pick = keys[i]!
        break
      }
    }
    const list = groups.get(pick)!
    return list[this.int(list.length)]!
  }

  private deploy(state: GameState, pending: PendingDecision): Action {
    const c = pending.constraints!
    const ids = c.fighterIds ?? []
    const box = polygonBBox(c.region!)
    for (let i = 0; i < 80 && ids.length > 0; i++) {
      const a = act.deploy(
        pending,
        ids[this.int(ids.length)]!,
        round3(box.minX + this.float() * (box.maxX - box.minX)),
        round3(box.minZ + this.float() * (box.maxZ - box.minZ)),
        round3((this.float() - 0.5) * 2 * Math.PI),
      )
      if (!validate(state, a)) return a
    }
    const s = suggest(state, pending)
    if (!s) throw new Error('no legal deploy spot')
    return s
  }

  /** Mostly the engine's route toward the nearest enemy (so the bot closes in), sometimes a cancel (no action spent). */
  private move(state: GameState, pending: PendingDecision): Action {
    if (this.float() < 0.1 && pending.canPass) return act.pass(pending)
    const s = suggest(state, pending)
    if (s && !validate(state, s)) return s
    return act.pass(pending)
  }
}

/** Engine `Decider` adapter over a state getter (the bot needs full-state helpers the redacted view lacks). */
export class RandomDecider implements Decider {
  private readonly bot: RandomBot
  constructor(
    seed: string,
    private readonly getState: () => GameState,
  ) {
    this.bot = new RandomBot(seed)
  }

  decide(_view: PlayerView, pending: PendingDecision): Promise<Action> {
    try {
      return Promise.resolve(this.bot.decide(this.getState(), pending))
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)))
    }
  }
}
