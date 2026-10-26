// goremongers code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/goremongers.test.ts.
import { createGame, step } from '@/engine'
import { act } from '@/engine/actions'
import { inflict } from '@/engine/attack-common'
import { planMove } from '@/engine/movement'
import { ScriptedRng } from '@/engine/rng'
import { providerRerollsBanned } from '@/engine/team-rules'
import { goreLevel } from '@/engine/teams/goremongers'
import type { GameEvent } from '@/engine/events'
import type { DecisionKind, GameState, PendingDecision } from '@/engine/types'
import { arm, play, ranged, withWeapons, type Played } from '../../fixtures/attack'
import { defaultAnswer, drive, expectOk, place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { activateOp, edit, newRealGame, openReal, opOf, passIt, realBundle, realSetupWith, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['goremongers', 'kommandos'] as [string, string] }

/** Open ground, every operative parked in its corner; A (Goremongers) is to activate. */
export function open(o: Parameters<typeof openReal>[0] = {}): GameState {
  // no CP for A unless a test gives some: the paid ploys (Lacerate Flesh) then never crowd the windows under test
  return edit(openReal({ ...MATCH, ...o }), (st) => void (st.players.A.cp = 0))
}
export const A = (s: GameState, card: string): string => opOf(s, 'A', `gm.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A forced dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(200).fill(1)])

/** Set a Goremonger's gore tank to a level (0 empty, 1 half, 2 full). */
export function withGore(s: GameState, opId: string, level: 0 | 1 | 2): GameState {
  return edit(s, (st) => {
    const op = st.operatives[opId]!
    op.tokens = (op.tokens ?? []).filter((t) => t.kind !== 'gm.gore')
    if (level > 0) op.tokens.push({ kind: 'gm.gore', owner: op.seat, count: level, since: 0, expires: ['battle'] })
  })
}

/** Add timed effects the hooks read (a strategy ploy in force, a flag): `expires` defaults to the turning point. */
export function withFx(s: GameState, ...list: { source: string; kind?: string; operativeId?: string; expires?: string; data?: Record<string, unknown> }[]): GameState {
  return edit(s, (st) => {
    list.forEach((e, i) => st.effects.push({ id: `eg${i}${st.effects.length}`, seat: 'A', kind: e.kind ?? 'ployFlag', expires: e.expires ?? 'turningPoint', source: e.source, ...(e.operativeId ? { operativeId: e.operativeId } : {}), ...(e.data ? { data: e.data } : {}) } as never))
  })
}

/** Put a strategy ploy "in force" for seat A (the persistent flags Enhanced Violence, Augmented Endurance, Gory Tenacity). */
export const withPloy = (s: GameState, ployId: string): GameState => withFx(s, { source: ployId })

/** The Strategy phase of turning point 1 at A's first gambit decision. */
export function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'gm-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 1200, new ScriptedRng([6, 1, 6, 1]))
}

/** A's first operative has acted and ended: the next activation is B's. */
export function bTurn(s: GameState, ender: string): GameState {
  return take(activateOp(s, ender), 'end').state
}

/** Stop at the next ploy window (or the next real choice). */
export const STOP_PLOY: DecisionKind[] = ['ploy.firefight', 'firefight.action', 'firefight.activate', 'firefight.order']

/** The usual stops of a played action, plus the reactions and choices a team rule raises. */
export const STOP_CHOICE: DecisionKind[] = ['firefight.action', 'firefight.activate', 'firefight.order', 'ability.choice']

/** Answer a ploy window with the option of that id, anything else with a pass. */
export const takePloy = (id: string) => ({ 'ploy.firefight': (p: PendingDecision) => p.options?.find((o) => o.id === id)?.action ?? act.pass(p) })

/** Answer a fight's strike or block choices by striking with the first die offered. */
export const strikes = { 'fight.resolve': (p: PendingDecision) => p.options?.find((o) => o.id.startsWith('strike'))?.action ?? p.options![0]!.action }

/** Answer a move decision with one waypoint. */
export const goTo = (x: number, z: number) => ({ 'move.path': (q: PendingDecision) => ({ type: 'move.path' as const, seat: q.seat, decisionId: q.id, payload: { waypoints: [{ x, z }] } }) })

/** The Sanguavitae rules an operative has used in its activation (the ledger effects). */
export const svUsedBy = (s: GameState, opId: string): string[] => s.effects.filter((e) => e.kind === 'gm.sv' && e.operativeId === opId).map((e) => String(e.data?.rule))

/** The default answer to a pending decision that is not a ploy window (used while stepping to a window by hand). */
export const answerStop = (s: GameState) => (s.pending?.kind === 'ploy.firefight' ? act.pass(s.pending) : defaultAnswer(s))

/** The ids of the options of the pending decision. */
export const ids = (s: GameState): string[] => (s.pending?.options ?? []).map((o) => o.id)

/** Activate (Engage) and stop at the first decision after the order: a ploy window with 0 CP offers, or the action choice. */
export function activateStop(s: GameState, id: string, order: 'engage' | 'conceal' = 'engage', rng?: ScriptedRng): GameState {
  let t = s
  while (t.pending?.kind === 'ploy.firefight') t = passIt(t, rng).state
  t = take(t, id, rng).state
  return take(t, order, rng).state
}

/** Pass every ploy window until the action decision. */
export function toAction(s: GameState, rng?: ScriptedRng): GameState {
  let t = s
  while (t.pending?.kind === 'ploy.firefight') t = passIt(t, rng).state
  return t
}

/** Take a 0 CP offer (by option id) and pass the remaining windows to the action decision. */
export function useOffer(s: GameState, id: string, rng?: ScriptedRng): GameState {
  let t = take(s, id, rng).state
  return toAction(t, rng)
}

/** Pass every ploy window; an answer for one of them overrides. */
const passWindows = takePloy('')

/** A state with the events of the steps taken since it was started. */
class Run {
  events: GameEvent[] = []
  constructor(public state: GameState, public rng?: ScriptedRng) {}
  take(id: string): this {
    const r = take(this.state, id, this.rng)
    this.state = r.state
    this.events.push(...r.events)
    return this
  }
  pass(): this {
    const r = passIt(this.state, this.rng)
    this.state = r.state
    this.events.push(...r.events)
    return this
  }
  /** Pass ploy windows (those of `window` only when named) */
  passWindows(window?: string): this {
    while (this.state.pending?.kind === 'ploy.firefight' && (!window || this.state.pending.window === window)) this.pass()
    return this
  }
  play(answers: Parameters<typeof play>[2] = {}, stop?: DecisionKind[]): Played {
    const r = play(this.state, this.rng, { ...passWindows, ...answers }, stop)
    return { state: r.state, events: [...this.events, ...r.events], kinds: r.kinds }
  }
}

/** Take the Shoot action of an operative at its action decision and choose the weapon and the target (as the game asks). */
export function declareShoot(s: GameState, weaponId: string, targetId: string, rng?: ScriptedRng): Run {
  const run = new Run(s, rng).passWindows().take('shoot').passWindows()
  if (run.state.pending?.kind === 'shoot.weapon') run.take(weaponId)
  if (run.state.pending?.kind === 'shoot.target') run.take(targetId)
  return run
}

/** One Shoot by `who` with `weaponId` at `targetId`, all dice scripted; returns the state at the next action decision. */
export function shootAt(s: GameState, who: string, weaponId: string, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}, order: 'engage' | 'conceal' = 'engage'): Played {
  return declareShoot(toAction(activateStop(s, who, order, rng), rng), weaponId, targetId, rng).play(answers)
}

/** The next Shoot of an activation already under way (the operative waits at firefight.action). */
export function shootAgain(s: GameState, weaponId: string, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}): Played {
  return declareShoot(s, weaponId, targetId, rng).play(answers)
}

/** A fight already declared (the windows after the declaration may still be open): choose the target and play it out. */
export function fightFrom(s: GameState, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}, stop?: DecisionKind[]): Played {
  const run = new Run(s, rng).passWindows('firefight.actionDeclared')
  if (run.state.pending?.kind === 'fight.target') run.take(targetId)
  return run.play({ 'fight.resolve': strikes['fight.resolve'], ...answers }, stop)
}

/** A fight of the activated operative (at its action decision) against `targetId`; ploy windows pass unless answered. */
export function fightWith(s: GameState, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}, stop?: DecisionKind[]): Played {
  const run = new Run(toAction(s, rng), rng).take('fight')
  const p = fightFrom(run.state, targetId, rng, answers, stop)
  return { state: p.state, events: [...run.events, ...p.events], kinds: p.kinds }
}

// ---- the scenarios: one short, real game situation per hook name ---------------------------------------------------

const asp = (s: GameState): string => A(s, 'aspirant')

/** Aspirant and Boy face to face, the Boy with 40 wounds. */
function duel(s: GameState, who = 'aspirant'): { s: GameState; a: string; boy: string } {
  const a = A(s, who)
  const boy = B(s, 'boy')
  return { s: edit(place(place(s, a, 0, 0), boy, 1.4, 0), (st) => void (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40)), a, boy }
}

/** The Herald's side has everyone but the Herald expended, the Aspirant on Conceal, 1 CP: the counteract decision. */
function toCounter(s0: GameState): GameState {
  const h = A(s0, 'blood-herald')
  const set = edit(s0, (st) => {
    st.players.A.cp = 1
    for (const o of Object.values(st.operatives)) if (o.seat === 'A' && o.id !== h) o.ready = false
    st.operatives[asp(s0)]!.order = 'conceal'
  })
  const t = take(toAction(activateStop(set, h)), 'end').state
  return take(toAction(activateStop(t, B(s0, 'boy'))), 'end').state
}

const hill = feature('gm-hill', part('gm-hill.a', rect(-5, -2, -2, 2), 3, ['vantage']))

export const scenarios: Record<string, () => void> = {
  gmGoreTanks() {
    const s = open()
    if (goreLevel(s, asp(s)) !== 1) throw new Error('the tank did not start at half')
  },
  gmSanguavitae() {
    scenarios.gmRejuvenate!()
  },
  gmRejuvenate() {
    const s = open()
    const a = asp(s)
    useOffer(activateStop(edit(s, (st) => void (st.operatives[a]!.wounds = 4)), a), 'gm.x.rejuvenate', dice(4))
  },
  gmMania() {
    const s = open()
    useOffer(activateStop(s, asp(s)), 'gm.x.mania')
  },
  gmFury() {
    const s = open()
    useOffer(activateStop(s, asp(s)), 'gm.x.fury')
  },
  gmSurge() {
    const s = open()
    const a = asp(s)
    const t = useOffer(take(toAction(activateStop(place(s, a, 0, 0), a)), 'reposition').state, 'gm.x.surge:reposition')
    if (t.pending?.kind !== 'move.path') throw new Error('no move decision')
  },
  gmRage() {
    const m = duel(open())
    take(take(toAction(activateStop(m.s, m.a)), 'fight').state, 'gm.x.rage')
  },
  gmRake() {
    const s = open()
    const a = asp(s)
    const boy = B(s, 'boy')
    let t = toAction(take(toAction(activateStop(place(place(s, a, 0, 0), boy, 4, 0), a)), 'charge').state)
    t = expectOk(step(t, act.path(t.pending!, [{ x: 2.2, z: 0 }]))).state
    take(t, `gm.x.rake:${boy}`, dice(4))
  },
  gmKhornesFavour() {
    const s = open()
    const h = A(s, 'blood-herald')
    take(activateStop(withGore(s, h, 0), h), 'gm.x.favour')
  },
  gmImpendingApotheosis() {
    // a Boy leaves two normals unblocked on the Herald, who discards one
    const s = open()
    const h = A(s, 'blood-herald')
    const boy = B(s, 'boy')
    shootAt(bTurn(place(place(s, h, 6, 0), boy, 0, 0), asp(s)), boy, 'kom.w.slugga', h, dice(4, 4, 1, 1), takePloy('gm.x.apotheosis'))
  },
  gmObsessiveBloodlust() {
    const s = open()
    const a = asp(s)
    const boy = B(s, 'boy')
    const kill = edit(place(place(place(s, a, 0, 0), boy, 1.4, 0), B(s, 'grot'), 3.62, 0), (st) => void (st.operatives[boy]!.wounds = 1))
    const done = fightWith(activateStop(kill, a), boy, dice(6, 6, 6, 6), {}, STOP_CHOICE)
    take(done.state, 'react:0')
  },
  gmRitual() {
    const b = A(open(), 'bloodtaker')
    const m = duel(withGore(open(), b, 0), 'bloodtaker')
    fightWith(activateStop(m.s, b), m.boy, dice(6, 6, 6, 6))
  },
  gmTransfusionRitual() {
    const s = open()
    const b = A(s, 'bloodtaker')
    take(toAction(activateStop(place(place(s, b, 0, 0), asp(s), 3, 0), b)), `ability:gm.a.transfusion-ritual:${asp(s)}`)
  },
  gmDrag() {
    const s = open()
    const imp = A(s, 'impaler')
    const boy = B(s, 'boy')
    shootAt(place(place(s, imp, 0, 0), boy, 6, 0), imp, 'gm.w.fleshskewer-ranged', boy, dice(6, 6, 6, 6), takePloy('gm.x.drag:4'))
  },
  gmGoreFuel() {
    const s = open()
    take(toAction(activateStop(s, A(s, 'impaler'))), 'ability:gm.a.gore-fuel')
  },
  gmDashAndSpray() {
    const s = open()
    const inc = A(s, 'inciter')
    const t = take(toAction(activateStop(place(place(s, inc, 0, 0), B(s, 'boy'), 10, 0), inc)), 'ability:gm.a.dash-and-spray').state
    take(t, 'dash')
  },
  gmInciteTheHunt() {
    // the Inciter wounds a Boy that survives: it gains a Bleeding token when the Shoot action ends
    const s = open()
    const inc = A(s, 'inciter')
    const boy = B(s, 'boy')
    shootAt(edit(place(place(s, inc, 0, 0), boy, 6.26, 0), (st) => void (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40)), inc, 'gm.w.dual-autopistols-focused', boy, dice(6, 6, 6, 6))
  },
  gmBrutish() {
    const s = open()
    withCtx(s, (ctx) => void inflict(ctx, { targetId: A(s, 'skullclaimer'), attackerId: B(s, 'boy'), weaponId: 'kom.w.choppa', amount: 5, source: 'strike-crit' }))
  },
  gmClaimSkull() {
    const sk = A(open(), 'skullclaimer')
    const m = duel(open(), 'skullclaimer')
    fightWith(activateStop(edit(m.s, (st) => void (st.operatives[m.boy]!.wounds = 1)), sk), m.boy, dice(6, 6, 6, 6))
  },
  gmStalker() {
    // Climbing Picks: a 3" climb costs the Stalker 2"
    const s = open()
    const st = A(s, 'stalker')
    const land = edit(place(s, st, 0, 0), (x) => void (x.map = { ...x.map, features: [hill] }))
    if (!planMove(land, land.operatives[st]!, 'reposition', [{ x: -4.2, z: 0, y: 3 }]).ok) throw new Error('the climb was not discounted')
  },
  gmRunesOfKhorne() {
    const s = open()
    const a = asp(s)
    const boy = B(s, 'boy')
    const t = edit(s, (st) => {
      st.attack = { kind: 'shoot', stage: 'resolve', operativeId: boy, seat: 'B', weaponId: null, pointBlank: false, targets: [a], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] } as never
    })
    withCtx(t, (ctx) => void inflict(ctx, { targetId: a, attackerId: boy, weaponId: null, amount: 12, source: 'normal' }))
  },
  gmStrategyFlag() {
    const g = edit(toGambit(), (st) => void (st.players.A.cp = 2))
    take(g, 'gm.p.augmented-endurance')
  },
  gmHuntForBlood() {
    const g = toGambit()
    const a = asp(g)
    const t = edit(place(place(g, a, 0, 0), B(g, 'boy'), 3, 0), (st) => {
      st.players.A.cp = 2
      st.operatives[a]!.order = 'conceal'
    })
    take(t, `gm.p.hunt-for-blood:${a}`)
  },
  gmUnbridledAggression() {
    const s = open()
    const a = asp(s)
    const boy = B(s, 'boy')
    const far = edit(place(place(s, a, 0, 0), boy, 4, 0), (x) => {
      x.players.A.cp = 1
      x.operatives[boy]!.wounds = x.operatives[boy]!.maxWounds = 40
    })
    let c = toAction(take(toAction(activateStop(far, a)), 'charge').state)
    c = toAction(expectOk(step(c, act.path(c.pending!, [{ x: 2.2, z: 0 }]))).state)
    fightWith(c, boy, dice(3, 3, 2, 2), takePloy('gm.p.unbridled-aggression'))
  },
  gmGorethirst() {
    const s = open()
    const t = take(toCounter(s), `counteract:${asp(s)}`).state
    take(t, 'gm.p.gorethirst')
  },
  gmDestructiveDemise() {
    const s = open()
    const a = asp(s)
    const boy = B(s, 'boy')
    const duelled = edit(withGore(place(place(s, a, 0, 0), boy, 1.4, 0), a, 2), (st) => {
      st.players.A.cp = 1
      st.operatives[a]!.wounds = 1
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 20
    })
    const rng = new ScriptedRng([6, 6, 6, 6, 1, 1, 1, 1, 6, ...Array<number>(120).fill(1)])
    fightWith(activateStop(bTurn(duelled, A(s, 'bloodtaker')), boy), a, rng, takePloy(`gm.p.destructive-demise:${boy}`))
  },
  gmLacerateFlesh() {
    const s = open()
    const a = asp(s)
    take(activateStop(edit(withGore(s, a, 0), (st) => void (st.players.A.cp = 1)), a), 'gm.p.lacerate-flesh')
  },
  gmGoryTotem() {
    const s = open()
    const boy = B(s, 'boy')
    const t = edit(place(s, boy, 2.5, 0), (x) => {
      x.markers.push({ id: 'tot', kind: 'equipment', pos: { x: 0, z: 0 }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'gm.e.gory-totem' })
    })
    if (!providerRerollsBanned(t, { operativeId: boy } as never, { kind: 'fight', operativeId: boy } as never)) throw new Error('re-rolls were not banned')
  },
  gmBloodyCadaver() {
    // the Aspirant stands at the Cadaver when the first Ready step comes
    let g = drive(newRealGame({ ...MATCH, equipmentA: ['gm.e.bloody-cadaver'] }, 'gm-cadaver-hook').state, (x) => x.pending?.kind === 'strategy.initiative', 900, new ScriptedRng([6, 1, 6, 1]))
    const cad = g.markers.find((m) => m.equipmentId === 'gm.e.bloody-cadaver')!
    g = edit(g, (x) => void (x.operatives[asp(g)]!.pos = { x: cad.pos.x + 0.9, y: 0, z: cad.pos.z }))
    g = take(g, 'roll', new ScriptedRng([6, 1, 6, 1])).state
    while (g.pending && g.pending.kind !== 'ability.choice' && g.pending.kind !== 'strategy.gambit') g = expectOk(step(g, answerStop(g), new ScriptedRng([6, 1, 6, 1]))).state
    take(g, 'ready:0')
  },
  gmChaosSigil() {
    const s = open({ equipmentA: ['gm.e.chaos-sigil'] })
    const a = asp(s)
    const boy = B(s, 'boy')
    const pierce = withWeapons(s, ranged('test.w.pierce', { atk: 4, hit: 3, dmg: { normal: 2, crit: 3 } }, [{ rule: 'piercing', x: 2 }]))
    const armed = place(place(arm(pierce, boy, ['test.w.pierce']), a, 6, 0), boy, 0, 0)
    shootAt(bTurn(edit(armed, (x) => void (x.players.A.equipment = ['gm.e.chaos-sigil'])), A(s, 'bloodtaker')), boy, 'test.w.pierce', a, dice(4, 4, 4, 4), takePloy('gm.x.sigil'))
  },
  gmWristChains() {
    const s = open({ equipmentA: ['gm.e.wrist-chains'] })
    const a = asp(s)
    const boy = B(s, 'boy')
    shootAt(edit(place(place(s, a, 0, 0), boy, 1.26 + 1.8, 0), (x) => void (x.operatives[boy]!.wounds = x.operatives[boy]!.maxWounds = 40)), a, 'gm.w.chainglaive-thrown', boy, dice(6, 6, 1, 1))
  },
}
