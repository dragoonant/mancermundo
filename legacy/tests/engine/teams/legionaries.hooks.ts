// legionaries code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/legionaries.test.ts.
import { createGame } from '@/engine'
import { act } from '@/engine/actions'
import { maxRepeats } from '@/engine/abilities'
import { effectiveRules, inflict } from '@/engine/attack-common'
import { runHook } from '@/engine/hooks'
import { usePloy, type PloyOffer } from '@/engine/ploys'
import { markerControl } from '@/engine/query'
import { ScriptedRng } from '@/engine/rng'
import { effectiveMove } from '@/engine/state'
import { providerFightStart } from '@/engine/team-rules'
import type { AttackState, DecisionKind, GameState, PendingDecision, RosterEntry } from '@/engine/types'
import { play } from '../../fixtures/attack'
import { drive, place } from '../../fixtures/helpers'
import { activateOp, edit, openReal, opOf, realBundle, realSetupWith, roster, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['legionaries', 'kommandos'] as [string, string] }

/** Open ground, every operative parked in its corner; A (Legionaries) is to activate. */
export const open = (o: Parameters<typeof openReal>[0] = {}): GameState => openReal({ ...MATCH, ...o })
export const A = (s: GameState, card: string): string => opOf(s, 'A', `lg.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A Legionary roster with a Mark of Chaos for each entry (SLAANESH unless said: it adds no weapon rule that re-rolls dice). */
export function lgRoster(ids: string[], marks: string[] = []): RosterEntry[] {
  return ids.map((id, i) => ({ ...roster([id])[0]!, picks: { mark: marks[i] ?? 'SLAANESH' } }))
}

/** A forced dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(120).fill(1)])

export function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'lg-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
}

/** Use a ploy through the engine with a hand-made offer (the window itself is not what the scenario is about). */
export function usePlayed(s: GameState, ployId: string, info: Record<string, unknown>, param?: string): GameState {
  const ploy = s.data.ploys![ployId]!
  const offer: PloyOffer = { id: ployId, ployId, name: ploy.name, cost: ploy.cost, seed: param ? { param } : {}, ...(param ? { param } : {}) }
  return withCtx(s, (ctx) => usePloy(ctx, 'A', offer, { window: 'x', ...info })).state
}

/** A's first operative has acted and ended: the next activation is B's. */
export function bTurn(s: GameState, ender: string): GameState {
  return take(activateOp(s, ender), 'end').state
}

/** Stop at the next ploy window (or the next real choice): play() with the usual stop kinds plus ploy.firefight. */
export const STOP_PLOY: DecisionKind[] = ['ploy.firefight', 'firefight.action', 'firefight.activate', 'firefight.order']

/** Answer a ploy window with the option of that id, anything else with a pass. */
export const takePloy = (id: string) => ({ 'ploy.firefight': (p: PendingDecision) => p.options?.find((o) => o.id === id)?.action ?? act.pass(p) })

/** Answer a fight's strike or block choices by striking with the first die offered. */
export const strikes = { 'fight.resolve': (p: PendingDecision) => p.options?.find((o) => o.id.startsWith('strike'))?.action ?? p.options![0]!.action }

/** Put a melee between A's first operative and a Boy, ready to be declared. */
export function engaged(s: GameState, a: string, b: string, gapX = 1.4): GameState {
  return place(place(s, a, 0, 0), b, gapX, 0)
}

export const scenarios: Record<string, () => void> = {
  lgAstartes() {
    const s = open()
    maxRepeats(s, s.operatives[A(s, 'butcher')]!, 'fight', ['fight'])
  },
  disgustingVigour() {
    const s = open()
    withCtx(s, (ctx) => {
      inflict(ctx, { targetId: A(s, 'heavy-gunner'), attackerId: B(s, 'boy'), weaponId: 'kom.w.slugga', amount: 3, source: 'normal' })
    }, dice(5))
  },
  unnaturalAgility() {
    const s = open()
    effectiveMove(s.operatives[A(s, 'icon-bearer')]!, s)
  },
  viciousReavers() {
    const s = open()
    const champ = A(s, 'aspiring-champion')
    const boy = B(s, 'boy')
    effectiveRules(place(place(s, champ, 0, 0), boy, 3, 0), s.operatives[champ]!, s.data.weapons['lg.w.plasma-pistol-standard']!, 'shoot', boy)
  },
  inTheEyesOfTheGods() {
    const s = open()
    const champ = A(s, 'aspiring-champion')
    const boy = B(s, 'boy')
    const t = edit(place(place(s, champ, 0, 0), boy, 1.4, 0), (st) => {
      st.firefight.activation = { operativeId: champ, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null }
    })
    withCtx(t, (ctx) => {
      inflict(ctx, { targetId: boy, attackerId: champ, weaponId: 'lg.w.power-fist', amount: 99, source: 'strike-normal' })
    })
  },
  daemonicAura() {
    const s = open({ rosterA: lgRoster(['lg.chosen', 'lg.butcher', 'lg.gunner', 'lg.heavy-gunner', 'lg.icon-bearer', 'lg.warrior']) })
    const boy = B(s, 'boy')
    const t = bTurn(engaged(s, A(s, 'chosen'), boy), A(s, 'warrior'))
    take(activateOp(t, boy), 'fallBack', dice(5))
  },
  soulGorge() {
    const s = open({ rosterA: lgRoster(['lg.chosen', 'lg.butcher', 'lg.gunner', 'lg.heavy-gunner', 'lg.icon-bearer', 'lg.warrior']) })
    const chosen = A(s, 'chosen')
    const boy = B(s, 'boy')
    const t = edit(engaged(s, chosen, boy), (st) => {
      st.operatives[chosen]!.wounds = 6
      st.operatives[boy]!.wounds = 0
    })
    withCtx(t, (ctx) => {
      runHook('onFightResolved', { seat: 'A', state: ctx.state, engine: ctx, operativeId: chosen, targetId: boy, data: { attackerId: chosen, defenderId: boy, attackerIncapacitated: false, defenderIncapacitated: true } })
    }, dice(4))
  },
  unleashDaemon() {
    const s = open({ rosterA: lgRoster(['lg.aspiring-champion', 'lg.anointed', 'lg.butcher', 'lg.gunner', 'lg.icon-bearer', 'lg.warrior']) })
    const a = A(s, 'anointed')
    take(take(take(s, a).state, 'engage').state, 'lg.a.unleash-daemon')
  },
  siphonLife() {
    const s = open({ rosterA: lgRoster(['lg.aspiring-champion', 'lg.balefire-acolyte', 'lg.butcher', 'lg.gunner', 'lg.icon-bearer', 'lg.warrior']) })
    const acolyte = A(s, 'balefire-acolyte')
    const boy = B(s, 'boy')
    const t = take(take(activateOp(place(place(s, acolyte, 0, 0), boy, 4, 0), acolyte), 'shoot').state, 'lg.w.life-siphon').state
    play(take(t, boy, dice(6, 6, 6, 6, 6, 1, 1, 1)).state, dice(6, 6, 1, 1, 1), takePloy(`lg.a.wr-siphon-life:${acolyte}`))
  },
  devastatingOnslaught() {
    const s = open()
    const butcher = A(s, 'butcher')
    const boy = B(s, 'boy')
    const t = take(activateOp(bTurn(place(place(s, butcher, 0, 0), boy, 2.5, 0), A(s, 'warrior')), boy), 'end').state
    play(take(t, 'react:0').state, dice(), { 'move.path': (q) => ({ type: 'move.path', seat: q.seat, decisionId: q.id, payload: { waypoints: [{ x: 0.9, z: 0 }] } }) })
  },
  lgIconBearer() {
    const s = open()
    const m = s.markers.find((k) => k.kind === 'objective')!
    const icon = A(s, 'icon-bearer')
    markerControl(edit(s, (st) => (st.operatives[icon]!.pos = { x: m.pos.x + 0.9, y: 0, z: m.pos.z })), m)
  },
  favouredOfTheDarkGods() {
    const s = open()
    const m = s.markers.find((k) => k.kind === 'objective')!
    const icon = A(s, 'icon-bearer')
    const t = edit(s, (st) => (st.operatives[icon]!.pos = { x: m.pos.x + 0.9, y: 0, z: m.pos.z }))
    withCtx(t, (ctx) => {
      runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })
    })
  },
  viciousReflexes() {
    const s = open({ rosterA: lgRoster(['lg.aspiring-champion', 'lg.shrivetalon', 'lg.butcher', 'lg.gunner', 'lg.icon-bearer', 'lg.warrior']) })
    const sh = A(s, 'shrivetalon')
    const boy = B(s, 'boy')
    const attack = { kind: 'fight', operativeId: boy, fight: { targetId: sh } } as unknown as AttackState
    providerFightStart(s, attack)
  },
  horrifyingDismemberment() {
    const s = open({ rosterA: lgRoster(['lg.aspiring-champion', 'lg.shrivetalon', 'lg.butcher', 'lg.gunner', 'lg.icon-bearer', 'lg.warrior']) })
    const sh = A(s, 'shrivetalon')
    const boy = B(s, 'boy')
    const other = B(s, 'boss-nob')
    const t = edit(place(place(engaged(s, sh, boy), other, 0, 2.5), A(s, 'warrior'), -13.5, 10), (st) => {
      st.operatives[boy]!.wounds = 1
    })
    const f = take(take(activateOp(t, sh), 'fight').state, boy, dice(6, 6, 6, 6, 6, 1, 1, 1, 1, 1)).state
    play(f, dice(), { ...strikes, ...takePloy(`lg.a.horrifying-dismemberment:${other}`) })
  },
  grislyMark() {
    const s = open({ rosterA: lgRoster(['lg.aspiring-champion', 'lg.shrivetalon', 'lg.butcher', 'lg.gunner', 'lg.icon-bearer', 'lg.warrior']) })
    const sh = A(s, 'shrivetalon')
    const t = activateOp(place(s, sh, 0, 0), sh)
    take(t, t.pending!.options!.find((o) => o.id.startsWith('ability:lg.a.grisly-mark'))!.id)
  },
  infernalPact() {
    const s = open()
    const w = A(s, 'warrior')
    take(take(take(s, w).state, 'engage').state, 'lg.a.infernal-pact:KHORNE')
  },
  lgFlagPloy() {
    take(toGambit(), 'lg.p.implacable')
  },
  unendingBloodshed() {
    const s = open()
    const butcher = A(s, 'butcher')
    const boy = B(s, 'boy')
    const t = edit(engaged(s, butcher, boy), (st) => {
      st.operatives[butcher]!.wounds = 1
    })
    const f = take(take(activateOp(t, butcher), 'fight').state, boy, dice(6, 6, 1, 1, 1, 6, 6, 6, 6)).state
    play(f, dice(), { ...strikes, ...takePloy('lg.p.unending-bloodshed:crit') })
  },
  mutabilityAndChange() {
    const s = open()
    const g = A(s, 'gunner')
    take(take(take(s, g).state, 'engage').state, 'lg.p.mutability-and-change')
  },
  malignantAura() {
    const s = open()
    const hg = A(s, 'heavy-gunner')
    const boy = B(s, 'boy')
    const t = take(take(activateOp(place(place(s, hg, 0, 0), boy, 2.5, 0), hg), 'shoot').state, 'lg.w.bolt-pistol').state
    play(take(t, boy).state, dice(6, 1, 1, 1, 1, 1, 1, 1), takePloy('lg.p.malignant-aura'))
  },
  sickeningCaptivation() {
    const s = open()
    const icon = A(s, 'icon-bearer')
    const boy = B(s, 'boy')
    take(take(take(place(place(s, icon, 0, 0), boy, 3, 0), icon).state, 'engage').state, `lg.p.sickening-captivation:${boy}`)
  },
  wardedArmour() {
    const g = toGambit({ equipmentA: ['lg.e.warded-armour'] })
    take(g, g.pending!.options!.find((o) => o.id.startsWith('lg.p.warded-armour:'))!.id)
  },
  chaosTalismans() {
    const g = toGambit({ equipmentA: ['lg.e.chaos-talismans'] })
    take(g, g.pending!.options!.find((o) => o.id.startsWith('lg.p.chaos-talismans:'))!.id)
  },
  taintedRounds() {
    const s = open({ equipmentA: ['lg.e.tainted-rounds'] })
    const hg = A(s, 'heavy-gunner')
    const boy = B(s, 'boy')
    const t = take(take(activateOp(place(place(s, hg, 0, 0), boy, 3, 0), hg), 'shoot').state, 'lg.w.bolt-pistol').state
    play(take(t, boy).state, dice(6, 1, 1, 1, 1, 1, 1, 1), takePloy('lg.e.tainted-rounds'))
  },
}
