// Dev fixtures (?test=1&fixture=<name>): play the real engine forward to a decision or screen that is otherwise a long walk away,
// so the screens can be looked at and tested: a shot at a real target, a charge, a fight, a fighter card with conditions, the end of
// a battle. Every step goes through the engine's `step`, so the state is always one the engine can reach; the fixture only chooses
// the answers. Seat A is the human of the test battle: it walks toward the enemy and takes the shot, seat B stands still. When a
// fixture cannot be reached (an engine part has not landed) it returns null and the battle opens at its start as usual.
import { act, legalActions, query, suggest, type Action, type GameState, type PendingDecision, type Seat } from '@/engine'
import { RandomBot } from '../bot/randomBot'
import { stepDetached } from '../store/game'

export const FIXTURES = ['shoot', 'charge', 'fight', 'card', 'end'] as const
export type FixtureName = (typeof FIXTURES)[number]

export interface FixtureResult {
  state: GameState
  /** the fighter whose card should be showing */
  select: string | null
}

type Decide = (s: GameState, p: PendingDecision) => Action | null

/** Apply decisions until `stop` holds on a pending decision; null when the game ends, stalls or the step budget runs out. */
function run(state: GameState, decide: Decide, stop: (s: GameState, p: PendingDecision) => boolean, budget = 6000): GameState | null {
  let s = state
  for (let i = 0; i < budget; i++) {
    const p = s.pending
    if (!p || s.phase === 'ended') {
      console.debug(`[fixture] ended at round ${s.round} (${s.phase}) after ${i} steps`)
      return null
    }
    if (stop(s, p)) return s
    const tries: Action[] = []
    const first = decide(s, p)
    if (first) tries.push(first)
    const sug = suggest(s, p)
    if (sug) tries.push(sug)
    tries.push(...(legalActions(s, p) ?? []))
    if (p.canPass) tries.push(act.pass(p))
    let moved = false
    for (const a of tries) {
      const r = stepDetached(s, a)
      if (!r.rejection) {
        s = r.state
        moved = true
        break
      }
    }
    if (!moved) {
      console.debug(`[fixture] no answer accepted for ${p.kind} (seat ${p.seat})`)
      return null
    }
  }
  console.debug(`[fixture] step budget used up at round ${s.round}`)
  return null
}

/** The action.choose option for an action key; a Shoot only counts when it has a fighter to shoot at (not just a door). */
const chooseOf = (p: PendingDecision, key: string): Action | null =>
  p.options?.find((o) => o.action.type === 'action.choose' && o.action.payload.action === key && (key !== 'shoot' || ((o.data as { targets?: number } | undefined)?.targets ?? 1) > 0))?.action ?? null

/** Seat A activates `prefer` (when listed), then takes the first of `goal` that is offered; seat B ends every activation. */
function actor(prefer: string, goal: string[]): Decide {
  return (_s, p) => {
    if (p.kind === 'action.activate') return p.options?.find((o) => o.action.type === 'action.activate' && o.action.payload.fighterId === prefer)?.action ?? null
    if (p.kind === 'action.group') return p.options?.find((o) => o.action.type === 'action.group' && o.action.payload.done)?.action ?? null
    if (p.kind !== 'action.choose') return null
    if (p.seat === 'B') return chooseOf(p, 'end')
    for (const g of goal) {
      const a = chooseOf(p, g)
      if (a) return a
    }
    return chooseOf(p, 'end')
  }
}

function deployAll(state: GameState): GameState | null {
  return run(state, () => null, (s, p) => p.kind === 'action.activate' || s.phase === 'action')
}

/**
 * Stand one of seat B's fighters `gap` inches (edge to edge) in front of one of seat A's, facing each other, and return the pair. The
 * fighters are moved in a copy of the state; `ok` says whether the A fighter then has something to do (a shot, a charge, a fight).
 */
function facingPair(state: GameState, gap: number, ok: (s: GameState, aId: string, bId: string) => boolean): { state: GameState; a: string; b: string } | null {
  const mine = Object.values(state.fighters).filter((f) => f.seat === 'A' && f.location === 'board')
  const theirs = Object.values(state.fighters).filter((f) => f.seat === 'B' && f.location === 'board')
  const g = theirs[0]
  if (!g) return null
  for (const f of mine) {
    for (const extra of [0, 2, -1, 4, 6]) {
      for (let k = 0; k < 24; k++) {
        const s = structuredClone(state)
        const a = s.fighters[f.id]!
        const b = s.fighters[g.id]!
        const d = Math.max(0, gap + extra) + a.baseRadius + b.baseRadius
        const dir = (k * Math.PI) / 12
        b.pos = { x: a.pos.x + Math.sin(dir) * d, y: a.pos.y, z: a.pos.z + Math.cos(dir) * d }
        a.facing = dir
        b.facing = dir + Math.PI
        if (Object.values(s.fighters).some((o) => o.id !== b.id && o.id !== a.id && o.location === 'board' && Math.hypot(o.pos.x - b.pos.x, o.pos.z - b.pos.z) < o.baseRadius + b.baseRadius + 0.2)) continue
        if (ok(s, a.id, b.id)) return { state: s, a: a.id, b: b.id }
      }
    }
  }
  return null
}

const canShoot = (s: GameState, a: string, b: string): boolean => {
  try {
    return query.shootOptions(s, a).some((o) => query.shootTargets(s, a, o.weaponId, o.profileId).some((t) => t.targetId === b))
  } catch {
    return false
  }
}
const inRange = (s: GameState, a: string, b: string): boolean => {
  try {
    return query.distance(s, a, b) <= 12 && query.pathDistance(s, a, b) < 40
  } catch {
    return false
  }
}

export function buildFixture(name: string, start: GameState): FixtureResult | null {
  const base = structuredClone(start)
  switch (name as FixtureName) {
    case 'shoot': {
      const placed = (() => {
        const d = deployAll(base)
        return d ? facingPair(d, 7, canShoot) : null
      })()
      if (!placed) return null
      const s = run(placed.state, actor(placed.a, ['shoot']), (_s, p) => p.seat === 'A' && p.kind === 'shoot.target')
      return s ? { state: s, select: String(s.pending?.context.fighterId ?? placed.a) } : null
    }
    case 'charge': {
      const d = deployAll(base)
      const placed = d ? facingPair(d, 4, (s, a, b) => inRange(s, a, b)) : null
      if (!placed) return null
      const s = run(placed.state, actor(placed.a, []), (_s, p) => p.seat === 'A' && p.kind === 'action.choose' && !!chooseOf(p, 'charge'))
      return s ? { state: s, select: String(s.pending?.context.fighterId ?? placed.a) } : null
    }
    case 'fight': {
      const d = deployAll(base)
      const placed = d ? facingPair(d, 0, (s, a, b) => inRange(s, a, b)) : null
      if (!placed) return null
      const s = run(placed.state, actor(placed.a, ['fight', 'charge']), (_s, p) => p.kind.startsWith('fight.'))
      return s ? { state: s, select: String(s.pending?.context.fighterId ?? placed.a) } : null
    }
    case 'card': {
      const s = deployAll(base)
      if (!s) return null
      const leader = Object.values(s.fighters).find((f) => f.seat === 'A' && f.role === 'leader') ?? Object.values(s.fighters).find((f) => f.seat === 'A')
      if (!leader) return null
      // dress the fighter up so the card has something to show: a Flesh Wound lowers T, a lost Wound, Concussion lowers I
      const f = s.fighters[leader.id]!
      f.fleshWounds = 1
      f.wounds = Math.max(1, f.wounds - 1)
      f.conditions.concussion = { since: s.round }
      if (f.weapons[1]) f.weapons[1].ammo = 'out'
      return { state: s, select: f.id }
    }
    case 'end': {
      const bots: Record<Seat, RandomBot> = { A: new RandomBot('fx:A'), B: new RandomBot('fx:B') }
      let s = base
      for (let i = 0; i < 2600 && s.pending && s.phase !== 'ended'; i++) {
        const p = s.pending
        const r = stepDetached(s, bots[p.seat].decide(s, p))
        if (r.rejection) break
        s = r.state
      }
      if (s.pending && s.phase !== 'ended') {
        const r = stepDetached(s, { type: 'resign', seat: s.pending.seat, decisionId: s.pending.id, payload: {} })
        if (!r.rejection) s = r.state
      }
      return s.phase === 'ended' ? { state: s, select: null } : null
    }
    default:
      return null
  }
}
