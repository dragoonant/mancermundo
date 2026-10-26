// chaos-cult code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/chaos-cult.test.ts.
import { createGame, step } from '@/engine'
import { act } from '@/engine/actions'
import { abilityOffers } from '@/engine/abilities'
import { hookFireCount } from '@/engine/code-hooks'
import { inflict } from '@/engine/attack-common'
import { offersFor, usePloy, type PloyOffer } from '@/engine/ploys'
import { ScriptedRng, type Rng } from '@/engine/rng'
import { transformOperative } from '@/engine/transform'
import { giftsOf, setGift, syncSave, type Gift } from '@/engine/teams/chaos-cult'
import { answerDecision } from '@/engine/query'
import type { Action, DecisionKind, GameState, PendingDecision } from '@/engine/types'
import { play } from '../../fixtures/attack'
import { defaultAnswer, drive, expectOk, place } from '../../fixtures/helpers'
import { activateOp, edit, openReal, opOf, realBundle, realSetupWith, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['chaos-cult', 'kommandos'] as [string, string] }

/** Open ground, every operative parked in its corner; A (the cult) is to activate. */
export const open = (o: Parameters<typeof openReal>[0] = {}): GameState => openReal({ ...MATCH, ...o })

/** The first cult operative of a datacard (`devotee`, `mutant`...) and the first Kommando of one (`boy`, `grot`...). */
export const A = (s: GameState, card: string): string => opOf(s, 'A', `cc.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)
/** Every cult operative of a datacard, in id order. */
export const ALL = (s: GameState, card: string): string[] =>
  Object.values(s.operatives)
    .filter((o) => o.seat === 'A' && o.datacardId === `cc.${card}`)
    .map((o) => o.id)
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))

/** A forced dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(200).fill(1)])

/** The Strategy phase of turning point 1 at A's first gambit decision. */
export function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'cc-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 1200, new ScriptedRng([6, 1, 6, 1, 5]))
}

/** Use a ploy through the engine with a hand-made offer (the window itself is not what the scenario is about). */
export function usePlayed(s: GameState, ployId: string, info: Record<string, unknown> = {}, param?: string): GameState {
  const ploy = s.data.ploys![ployId]!
  const offer: PloyOffer = { id: ployId, ployId, name: ploy.name, cost: ploy.cost, seed: param ? { param } : {}, ...(param ? { param } : {}) }
  return withCtx(s, (ctx) => usePloy(ctx, 'A', offer, { window: 'x', ...info })).state
}

/** Add timed effects the hooks read (a strategy ploy in force): `expires` defaults to the turning point. */
export function withFx(s: GameState, ...list: { source: string; kind?: string; operativeId?: string; expires?: string; data?: Record<string, unknown> }[]): GameState {
  return edit(s, (st) => {
    list.forEach((e, i) => st.effects.push({ id: `ec${i}${st.effects.length}`, seat: 'A', kind: e.kind ?? 'ployFlag', expires: e.expires ?? 'turningPoint', source: e.source, ...(e.operativeId ? { operativeId: e.operativeId } : {}), ...(e.data ? { data: e.data } : {}) } as never))
  })
}

/** A strategy ploy of the cult in force this turning point. */
export const withPloy = (s: GameState, ...ployIds: string[]): GameState => withFx(s, ...ployIds.map((source) => ({ source })))

/** The team ledger set directly: gifts the cult has selected (primary, secondary), and per-operative gifts. */
export function withGifts(s: GameState, g: { primary?: Gift; secondary?: Gift; ops?: Record<string, Gift[]> }): GameState {
  return edit(s, (st) => {
    if (g.primary) setGift(st, 'A', 'primary', g.primary)
    if (g.secondary) setGift(st, 'A', 'secondary', g.secondary)
    for (const [id, gifts] of Object.entries(g.ops ?? {})) for (const gift of gifts) setGift(st, 'A', `op:${id}`, gift)
    for (const o of Object.values(st.operatives)) if (o.seat === 'A') syncSave(st, o)
  })
}

/** Change an operative's datacard the way Mutation does (transformOperative: stats, weapons and base from the new card). */
export function becomes(s: GameState, id: string, card: 'mutant' | 'torment'): GameState {
  return withCtx(s, (ctx) => {
    transformOperative(ctx, id, `cc.${card}`)
    syncSave(ctx.state, ctx.state.operatives[id]!)
  }).state
}

/** Like `drive`, but ploy windows and reactions are declined (the default answer would spend the first ploy offered). */
export function driveQuiet(state: GameState, until: (s: GameState) => boolean, maxSteps = 3000, rng?: Rng): GameState {
  let s = state
  for (let i = 0; i < maxSteps; i++) {
    if (until(s) || !s.pending) return s
    const p = s.pending
    const a = p.kind === 'ploy.firefight' || (p.kind === 'ability.choice' && p.canPass) ? act.pass(p) : defaultAnswer(s)
    s = expectOk(step(s, a, rng)).state
  }
  throw new Error('driveQuiet: step limit reached')
}

/** Answer decisions (strikes for fights, passes for every ploy window) until `until` holds or the pending decision is a stop kind. */
export function playTo(state: GameState, rng: Rng, until: (s: GameState) => boolean, max = 120): GameState {
  let s = state
  for (let i = 0; i < max; i++) {
    const p = s.pending
    if (!p || until(s)) return s
    let a: Action
    if (p.kind === 'fight.resolve') a = p.options!.find((o) => o.id.startsWith('strike'))?.action ?? p.options![0]!.action
    else if (p.kind === 'ploy.firefight' || (p.kind === 'ability.choice' && p.canPass)) a = act.pass(p)
    else a = answerDecision(s, p) ?? p.options?.[0]?.action ?? act.pass(p)
    s = expectOk(step(s, a, rng)).state
  }
  throw new Error('playTo: step limit reached')
}

/** Stop at the next decision a test cares about. */
export const STOP: DecisionKind[] = ['firefight.action', 'firefight.activate', 'firefight.order', 'ability.choice', 'ploy.firefight']

/** Answer a fight's strike or block choices by striking with the first die offered. */
export const strikes = { 'fight.resolve': (p: PendingDecision) => p.options?.find((o) => o.id.startsWith('strike'))?.action ?? p.options![0]!.action }

/** Answer a ploy window with the option of that id, anything else with a pass. */
export const takePloy = (id: string) => ({
  'ploy.firefight': (p: PendingDecision) => p.options?.find((o) => o.id === id)?.action ?? { type: 'pass' as const, seat: p.seat, decisionId: p.id, payload: {} as Record<string, never> },
})

/** A Devotee and a Kommando face to face (a melee), the Kommando on `wounds`. */
export function faceOff(s: GameState, dev: string, foe: string, wounds = 2, gapX = 1.4): GameState {
  return edit(place(place(s, dev, 0, 0), foe, gapX, 0), (st) => {
    st.operatives[foe]!.wounds = wounds
    st.operatives[foe]!.maxWounds = Math.max(wounds, st.operatives[foe]!.maxWounds)
  })
}

/** A Fight by `who` against `foe` with scripted dice (attack dice first), played until the next decision of interest. */
export function fightOnce(s: GameState, who: string, foe: string, script: number[], answers: Parameters<typeof play>[2] = {}, stop: DecisionKind[] = ['firefight.action', 'firefight.activate', 'ability.choice']) {
  const rng = dice(...script)
  const t = take(take(activateOp(s, who, 'engage', rng), 'fight', rng).state, foe, rng).state
  return play(t, rng, { ...strikes, ...answers }, stop)
}

/** The Devotee kills a 2-wound Kommando in melee and waits at the reaction choice (Mutation after a kill). */
export function afterKill(s: GameState = open()): { state: GameState; dev: string; foe: string } {
  const dev = ALL(s, 'devotee')[0]!
  const foe = B(s, 'boy')
  const r = fightOnce(faceOff(s, dev, foe), dev, foe, [6, 6, 6, 6, 1, 1, 1, 1])
  return { state: r.state, dev, foe }
}

/** The ability offers an operative has right now (a unique action's id is `ability:<id>[:key]`). */
export const offerIds = (s: GameState, id: string): string[] => abilityOffers(s, s.operatives[id]!, s.firefight.activation).map((o) => o.id)

/** A hand-made inflict of `amount` on `target` (a dice source) as if `from` struck it. */
export function hurt(s: GameState, target: string, from: string, amount: number, source = 'normal', rng?: Rng, weaponId: string | null = null): { state: GameState; dealt: number } {
  let dealt = 0
  const state = withCtx(
    s,
    (ctx) => {
      dealt = inflict(ctx, { targetId: target, attackerId: from, weaponId, amount, source })
    },
    rng,
  ).state
  return { state, dealt }
}

export { giftsOf, hookFireCount, offersFor, opOf, place, realBundle }

// ---------------------------------------------------------------------------
// Code-hook firing scenarios (one per hook the data names)
// ---------------------------------------------------------------------------

export const scenarios: Record<string, () => void> = {
  ccIncite() {
    const s = open()
    const dem = A(s, 'demagogue')
    const [dev] = ALL(s, 'devotee') as [string]
    const boy = B(s, 'boy')
    const t = place(place(place(s, dem, 0, 0), dev, 5, 0), boy, 6.4, 0)
    take(activateOp(t, dem), `ability:cc.a.incite-slaughter:${dev}`)
  },
  ccRuinousIcon() {
    const s = open()
    const ic = A(s, 'iconarch')
    take(activateOp(s, ic), 'ability:cc.a.ruinous-icon:invigoration')
  },
  ccHeinousDeluge() {
    const s = open()
    const mw = A(s, 'mindwitch')
    const boy = B(s, 'boy')
    take(activateOp(place(place(s, mw, 0, 0), boy, 6, 0), mw), `ability:cc.a.heinous-deluge:${boy}`)
  },
  ccMaleficVortex() {
    const s = open()
    const mw = A(s, 'mindwitch')
    const u = activateOp(place(s, mw, 0, 0), mw)
    take(u, offerIds(u, mw).find((i) => i.startsWith('ability:cc.a.malefic-vortex:'))!)
  },
  ccMutation() {
    take(toGambit(), 'cc.p.mutation')
  },
  ccFlagPloy() {
    take(toGambit(), 'cc.p.fervent-onslaught')
  },
  ccFaithfulFollower() {
    const o = open()
    const dem = A(o, 'demagogue')
    const [dev] = ALL(o, 'devotee') as [string]
    const boy = B(o, 'boy')
    const weapon = o.operatives[boy]!.weapons.find((w) => o.data.weapons[w]!.type === 'ranged')!
    const s = place(place(place(o, dem, 0, 0), dev, 2.5, 0), boy, -6, 0)
    const aim = take(take(take(activateOp(take(activateOp(s, A(o, 'mindwitch')), 'end').state, boy), 'shoot').state, weapon).state, dem).state
    take(aim, `cc.p.faithful-follower:${dev}`)
  },
  ccAbhorrentMutation() {
    const s = open()
    const [dev] = ALL(s, 'devotee') as [string]
    take(take(take(s, dev).state, 'engage').state, 'cc.p.abhorrent-mutation:horned')
  },
  ccFrenziedDemise() {
    const o = open()
    const [m] = ALL(o, 'devotee') as [string]
    const [boy1, boy2] = [B(o, 'boy'), B(o, 'grot')]
    const s = edit(place(place(place(becomes(o, m, 'mutant'), m, 0, 0), boy1, 1.4, 0), boy2, 0, -2.8), (st) => {
      st.operatives[m]!.wounds = 1
      for (const id of [boy1, boy2]) st.operatives[id]!.order = 'engage'
    })
    const rng = dice(6, 6, 6, 6, 1, 1, 1, 1)
    const t = take(take(activateOp(take(activateOp(s, A(o, 'mindwitch')), 'end').state, boy1, 'engage', rng), 'fight', rng).state, m, rng).state
    const w = playTo(t, rng, (st) => st.pending?.kind === 'ploy.firefight' && st.pending.window === 'operative.incapacitated')
    take(w, `cc.p.frenzied-demise:${boy2}`, dice(4))
  },
  ccUnleashTheDaemon() {
    const o = open()
    const [m] = ALL(o, 'devotee') as [string]
    const s = edit(place(place(becomes(o, m, 'mutant'), m, 0, 0), B(o, 'boy'), 1.4, 0), (st) => void (st.operatives[m]!.order = 'engage'))
    take(take(take(s, m).state, 'engage').state, 'cc.p.unleash-the-daemon')
  },
  ccBalefulScript() {
    const g = toGambit({ equipmentA: ['cc.e.baleful-script'] })
    const [d1] = ALL(g, 'devotee') as [string]
    const s = withGifts(becomes(g, d1, 'mutant'), { primary: 'chitinous' })
    usePlayed(s, 'cc.p.baleful-script', {}, 'primary>fleet')
  },
  ccCovertGuises() {
    const g = toGambit({ equipmentA: ['cc.e.covert-guises'] })
    const guiser = ALL(g, 'devotee')[0]!
    const zone = g.map.dropZones.find((z) => z.id === g.players.A.dropZoneId)!
    const xs = zone.polygon.map((p) => p.x)
    const west = (Math.min(...xs) + Math.max(...xs)) / 2 < 0
    take(place(g, guiser, west ? Math.max(...xs) - 1.5 : Math.min(...xs) + 1.5, 0), 'cc.p.covert-guises')
  },
  ccGuisesRoll() {
    // the D3 is rolled as the game is set up with the equipment
    open({ equipmentA: ['cc.e.covert-guises'] })
  },
  ccUnholyTalisman() {
    const t0 = open({ equipmentA: ['cc.e.unholy-talisman'] })
    const dem = A(t0, 'demagogue')
    const boy = B(t0, 'boy')
    const weapon = t0.operatives[boy]!.weapons.find((w) => t0.data.weapons[w]!.type === 'ranged')!
    const atk = t0.data.weapons[weapon]!.atk
    const shot = edit(place(place(t0, dem, 0, 0), boy, -5, 0), (st) => void (st.operatives[boy]!.order = 'engage'))
    const rng = dice(...Array<number>(atk).fill(6), 5, 1, 1)
    const aim = take(take(take(activateOp(take(activateOp(shot, A(t0, 'mindwitch')), 'end').state, boy, 'engage', rng), 'shoot', rng).state, weapon, rng).state, dem, rng).state
    const tal = playTo(aim, rng, (st) => st.pending?.kind === 'ploy.firefight' && st.pending.window === 'shoot.defenceRolled' && st.pending.seat === 'A')
    take(tal, 'cc.e.unholy-talisman', rng)
  },
  ccVileBlessing() {
    const t0 = open({ equipmentA: ['cc.e.vile-blessing'] })
    const dem = A(t0, 'demagogue')
    hurt(edit(t0, (st) => void (st.operatives[dem]!.wounds = 3)), dem, B(t0, 'boy'), 4, 'normal')
  },
}
