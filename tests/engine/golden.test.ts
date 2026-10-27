import { describe, expect, it } from 'vitest'
import { act, createGame, step, suggest, type Action, type GameEvent, type GameState, type PendingDecision } from '@/engine'
import { ScriptedRng } from '@/engine/rng'
import { openBox } from '../fixtures/boards'
import { edit, place } from '../fixtures/helpers'
import { realBundle, realSetup } from '../fixtures/real'

// A golden round: the Goliath and Escher starter gangs on an open 24" x 36" floor, forced dice, one scripted policy that charges
// when it can, shoots when it can and otherwise ends the activation, played through round 1's Action phase and End phase into
// round 2. The dice are a fixed pseudo-random stream (an LCG, so no platform difference) and the policy only reads the engine's
// own menus, so every number below is a pure function of the rules code. When a rules change moves them on purpose, run
//   GOLDEN_PRINT=1 npx vitest run tests/engine/golden.test.ts
// to print the new digest, review the diff of the events it lists, and paste the values here.

/** A reproducible stream of D6 results. */
function dieStream(n: number, seed = 12345): number[] {
  const out: number[] = []
  let x = seed
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff
    out.push(((x >>> 16) % 6) + 1)
  }
  return out
}

const GOLDEN = {
  hash: 'd8f0bdfc',
  decisions: 57,
  events: {
    ActionDeclared: 15,
    ActionResolved: 15,
    ActivationEnded: 17,
    AttackDiceSplit: 11,
    BottleTest: 2,
    ConditionChanged: 4,
    CoupDeGrace: 3,
    DamageInflicted: 13,
    DecisionRequested: 57,
    DiceRolled: 102,
    EngagementChanged: 31,
    FightHitRolled: 26,
    FightStarted: 11,
    FighterActivated: 17,
    FighterMoved: 15,
    FighterOutOfAction: 4,
    FighterTurned: 6,
    FightersReadied: 1,
    FleshWound: 6,
    InjuryRolled: 10,
    NerveTest: 7,
    Parried: 3,
    PhaseEnded: 3,
    PhaseStarted: 3,
    PointsScored: 4,
    PriorityDecided: 1,
    ReactionStarted: 8,
    RoundEnded: 1,
    RoundStarted: 1,
    SaveRolled: 7,
    SkillUsed: 1,
    StatusChanged: 3,
    WoundRolled: 23,
  } as Record<string, number>,
  casualties: [
    'a1:seriouslyInjured:esc.w.shock-whip',
    'a1:outOfAction:coupDeGrace',
    'a2:seriouslyInjured:esc.w.needle-pistol',
    'a2:outOfAction:coupDeGrace',
    'b6:seriouslyInjured:gol.w.brute-cleaver',
    'b6:outOfAction:coupDeGrace',
    'b9:outOfAction:gol.w.axe',
  ] as string[],
  points: { A: 2, B: 5 },
  dice: 128,
}

/** The engine's first sensible answer: charge, then shoot, else the first option; continuous decisions use `suggest`. */
function policy(state: GameState, p: PendingDecision): Action {
  switch (p.kind) {
    case 'action.activate':
    case 'fight.weapons':
    case 'shoot.weapon':
    case 'shoot.target':
    case 'shoot.allocate':
    case 'fight.split':
    case 'fight.after':
    case 'end.recoveryPick':
    case 'confirm':
    case 'setup.role':
      return p.options![0]!.action
    case 'action.group':
      return act.groupDone(p)
    case 'action.flee':
      return act.fleeDone(p)
    case 'end.bottle':
      return act.bottle(p, 'test')
    case 'end.assist':
      return act.assistNone(p)
    case 'action.choose': {
      const by = (id: string) => p.options!.find((o) => (o.action.payload as { action: string }).action === id)
      return (by('charge') ?? by('shoot') ?? by('end'))!.action
    }
    default: {
      const s = suggest(state, p)
      if (!s) throw new Error(`no answer for ${p.kind}`)
      return s
    }
  }
}

describe('golden: one forced-dice round of the two starter gangs', () => {
  it('GOLDEN-001 Goliath against Escher, round 1 through the End phase, reproduces its digest', () => {
    const base = realBundle()
    const box = openBox()
    const engine = { ...base, boards: { ...base.boards, [box.id]: box } }
    const setup = realSetup({ boardId: box.id, options: { autoCrew: true, autoDeploy: true, firstPriority: 'A' } })
    const created = createGame(setup, 'golden', engine)
    let state = step(created.state, created.pending!.options![0]!.action).state
    expect(state.round).toBe(1)
    // bring the gangs face to face: a staggered line each, 5" apart across the middle of the floor
    const spots: Parameters<typeof place>[1] = {}
    for (const seat of ['A', 'B'] as const) {
      const ids = Object.values(state.fighters)
        .filter((f) => f.seat === seat && f.location === 'board')
        .map((f) => f.id)
      ids.forEach((id, k) => {
        spots[id] = { x: -10.5 + (k % 8) * 3, z: seat === 'A' ? -2.5 - Math.floor(k / 8) * 2 : 2.5 + Math.floor(k / 8) * 2, facing: seat === 'A' ? 0 : Math.PI }
      })
    }
    state = edit(place(state, spots), () => {})

    const rng = new ScriptedRng(dieStream(1500))
    const events: GameEvent[] = []
    let decisions = 0
    while (state.round === 1 && state.pending && decisions < 2000) {
      const r = step(state, policy(state, state.pending), rng)
      if (r.rejection) throw new Error(`golden policy rejected: ${r.rejection.code} ${r.rejection.reason} at ${state.pending.kind}`)
      events.push(...r.events)
      state = r.state
      decisions++
    }
    expect(state.round).toBe(2)
    expect(state.phase).toBe('action')

    const counts: Record<string, number> = {}
    for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1
    const digest = {
      hash: state.hash,
      decisions,
      events: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1))),
      casualties: state.casualties.map((c) => `${c.fighterId}:${c.kind}:${c.cause}`),
      points: { A: state.players.A.points, B: state.players.B.points },
      dice: 1500 - rng.remaining,
    }
    if (process.env.GOLDEN_PRINT) console.log(JSON.stringify(digest, null, 1))

    // the round did what the policy meant it to: charges, shots, hits and an End phase happened
    expect((counts.ActionDeclared ?? 0) > 0 && (counts.ShootStarted ?? 0) + (counts.FightStarted ?? 0) > 0).toBe(true)
    expect(counts.PhaseEnded).toBeGreaterThanOrEqual(3)
    expect(counts.RoundEnded).toBe(1)
    expect(digest).toEqual(GOLDEN)
  })
})
