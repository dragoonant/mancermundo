// Random-legal bot for bot seats. Ported from the logic in tools/sim-core.ts (tools are never imported by
// src): finite decisions pick a uniformly random legal action; continuous ones (deploy, move.path) build a
// candidate and keep it only if `validate` accepts it. It also implements the engine `Decider` shape.
import { act, legalActions, SeededRng, suggestPlacement, validate, type Action, type Decider, type GameState, type PendingDecision, type PlayerView, type Waypoint } from '@/engine'
import { polygonBBox, round3 } from '@/engine/geometry'
import { terrainOf } from '@/engine/terrain'

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

  /** Never throws for a decision the engine can raise: unknown continuous kinds fall back to pass. */
  decide(state: GameState, pending: PendingDecision): Action {
    const legal = legalActions(state, pending)
    if (legal && legal.length > 0) return this.pickFinite(state, pending, legal)
    if (pending.kind === 'setup.deploy') return this.deploy(state, pending)
    if (pending.kind === 'move.path') return this.move(state, pending)
    if (pending.canPass) return act.pass(pending)
    throw new Error(`bot cannot answer ${pending.kind}`)
  }

  private pickFinite(state: GameState, pending: PendingDecision, legal: Action[]): Action {
    // A bot that ends every activation before acting makes dull, short games: prefer a real action when one exists.
    if (pending.kind === 'firefight.action') {
      const real = legal.filter((a) => a.type === 'firefight.action' && a.payload.action !== 'end')
      if (real.length > 0 && this.float() < 0.85) return real[this.int(real.length)]!
    }
    return legal[this.int(legal.length)]!
  }

  private deploy(state: GameState, pending: PendingDecision): Action {
    const c = pending.constraints!
    const ids = c.operativeIds!
    const box = polygonBBox(c.region!)
    for (let i = 0; i < 80; i++) {
      const id = ids[this.int(ids.length)]!
      const a = act.deploy(
        pending,
        id,
        round3(box.minX + this.float() * (box.maxX - box.minX)),
        round3(box.minZ + this.float() * (box.maxZ - box.minZ)),
      )
      if (!validate(state, a)) return a
    }
    const spot = suggestPlacement(state, pending, undefined, this.int(1000))
    if (!spot) throw new Error('no legal deploy spot')
    return act.deploy(pending, spot.operativeId, spot.x, spot.z, spot.y)
  }

  private move(state: GameState, pending: PendingDecision): Action {
    const c = pending.constraints!
    const op = state.operatives[c.operativeId!]!
    const enemies = Object.values(state.operatives).filter((o) => o.status === 'active' && o.seat !== op.seat)
    const vantage = terrainOf(state.map).solids.filter((s) => s.floors.length > 0)
    const max = c.maxInches ?? 6
    const toward = (tx: number, tz: number, len: number): { x: number; z: number } => {
      const dx = tx - op.pos.x
      const dz = tz - op.pos.z
      const d = Math.hypot(dx, dz) || 1
      const l = Math.min(len, d)
      return { x: round3(op.pos.x + (dx / d) * l), z: round3(op.pos.z + (dz / d) * l) }
    }
    const nearest = enemies.length
      ? enemies.reduce((a, b) => (Math.hypot(a.pos.x - op.pos.x, a.pos.z - op.pos.z) < Math.hypot(b.pos.x - op.pos.x, b.pos.z - op.pos.z) ? a : b))
      : null
    for (let i = 0; i < 80; i++) {
      let wps: Waypoint[]
      const roll = this.float()
      if (c.kind === 'charge' && enemies.length > 0) {
        const e = this.float() < 0.6 && nearest ? nearest : enemies[this.int(enemies.length)]!
        const dx = e.pos.x - op.pos.x
        const dz = e.pos.z - op.pos.z
        const d = Math.hypot(dx, dz) || 1
        const stop = e.baseRadius + op.baseRadius + 0.05 + this.float() * 0.6
        wps = [{ x: round3(e.pos.x - (dx / d) * stop), z: round3(e.pos.z - (dz / d) * stop), y: e.pos.y }]
      } else if (c.kind === 'fallBack' && nearest) {
        const away = toward(2 * op.pos.x - nearest.pos.x, 2 * op.pos.z - nearest.pos.z, 1 + this.float() * Math.max(1, max - 1))
        wps = [{ x: away.x, z: away.z, y: op.pos.y }]
      } else if (op.pos.y > 2 && roll < 0.35) {
        const ang = this.float() * Math.PI * 2
        const len = 1 + this.float() * 3
        const x = round3(op.pos.x + Math.sin(ang) * len)
        const z = round3(op.pos.z + Math.cos(ang) * len)
        wps = this.float() < 0.5 ? [{ x, z, y: this.float() < 0.5 ? 0 : op.pos.y, jump: true }] : [{ x, z, y: 0 }]
      } else if (roll < 0.3 && vantage.length > 0) {
        const s = vantage[this.int(vantage.length)]!
        const tx = round3(s.bbox.minX + this.float() * (s.bbox.maxX - s.bbox.minX))
        const tz = round3(s.bbox.minZ + this.float() * (s.bbox.maxZ - s.bbox.minZ))
        if (Math.hypot(tx - op.pos.x, tz - op.pos.z) <= max) wps = [{ x: tx, z: tz, y: s.floors[0] }]
        else {
          const w = toward(tx, tz, max)
          wps = [{ x: w.x, z: w.z, y: op.pos.y }]
        }
      } else if (roll < 0.7 && nearest) {
        const w = toward(nearest.pos.x, nearest.pos.z, 0.5 + this.float() * max)
        wps = [{ x: w.x, z: w.z, y: op.pos.y }]
      } else {
        const n = 1 + this.int(2)
        wps = []
        let x = op.pos.x
        let z = op.pos.z
        for (let k = 0; k < n; k++) {
          const ang = this.float() * Math.PI * 2
          const len = 0.5 + this.float() * Math.max(0.5, max / n - 0.5)
          x = round3(x + Math.sin(ang) * len)
          z = round3(z + Math.cos(ang) * len)
          wps.push({ x, z, y: op.pos.y })
        }
      }
      const a = act.path(pending, wps)
      if (!validate(state, a)) return a
    }
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
