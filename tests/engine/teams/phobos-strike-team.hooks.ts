// phobos-strike-team code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/phobos-strike-team.test.ts.
import { step } from '@/engine'
import { act } from '@/engine/actions'
import { maxRepeats } from '@/engine/abilities'
import { effectiveRules, inflict, runDeferredRemovals } from '@/engine/attack-common'
import { directDamage } from '@/engine/effects'
import { runHook } from '@/engine/hooks'
import { offersFor, usePloy, type PloyOffer } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { ensureMarkers, EXPLOSIVES, HAYWIRE } from '@/engine/teams/phobos-strike-team'
import { providerCostDelta, providerInitiativeReroll, providerMoveSurcharge, providerRerollsBanned } from '@/engine/team-rules'
import type { DecisionKind, GameState, PendingDecision, RosterEntry, Seat } from '@/engine/types'
import { DEFAULT_STOP, play } from '../../fixtures/attack'
import { defaultAnswer, expectOk, place } from '../../fixtures/helpers'
import { activateOp, edit, newRealGame, opOf, roster, take, withCtx, type RealOpts } from '../../fixtures/real'

export const MATCH = { teams: ['phobos-strike-team', 'kommandos'] as [string, string] }

/** Every ploy window passed: the shared drivers pick the first offered option, which here could be Patient Ambush. */
export const pass = (p: { seat: Seat; id: string }) => ({ type: 'pass' as const, seat: p.seat, decisionId: p.id, payload: {} as Record<string, never> })

/** Dice for scripted steps, then 1s (every later die fails). */
export const dice = (...d: number[]): ScriptedRng => new ScriptedRng([...d, ...Array<number>(120).fill(1)])

/** The four roll-off dice (A wins both), then 1s: the Commsman's Strategic Oversight roll fails and nothing else needs luck. */
const SETUP_DICE = [6, 1, 6, 1, ...Array<number>(80).fill(1)]

/** Play set-up and the first Strategy phase (A wins both roll-offs) to the first activation; every ploy window is passed. */
export function startPh(o: RealOpts = {}, seed = 'ph', gambits: string[] = [], setupDice: number[] = SETUP_DICE): GameState {
  let s = newRealGame({ ...MATCH, ...o }, seed).state
  const rng = new ScriptedRng(setupDice)
  for (let i = 0; i < 800 && s.pending && s.pending.kind !== 'firefight.activate'; i++) {
    const p = s.pending
    let a = defaultAnswer(s)
    if (p.kind === 'ploy.firefight') a = act.pass(p)
    else if (p.kind === 'strategy.gambit') {
      const mine = p.seat === 'A' ? p.options!.find((x) => gambits.includes(x.id)) : undefined
      a = mine ? mine.action : act.pass(p)
    }
    s = expectOk(step(s, a, rng)).state
  }
  return s
}

/** The Gambit step, stopped there (A to decide). */
export function toGambit(o: RealOpts = {}, seed = 'ph-gambit'): GameState {
  let s = newRealGame({ ...MATCH, ...o }, seed).state
  const rng = new ScriptedRng(SETUP_DICE)
  for (let i = 0; i < 800 && s.pending && !(s.pending.kind === 'strategy.gambit' && s.pending.seat === 'A'); i++) {
    s = expectOk(step(s, defaultAnswer(s), rng)).state
  }
  return s
}

/** Play on until a ploy decision of `seat` in `window` is pending (every other ploy window passed). */
export function toWindow(window: string, seat: Seat = 'A', o: RealOpts = {}, gambits: string[] = [], seed = 'ph-window'): GameState {
  let s = newRealGame({ ...MATCH, ...o }, seed).state
  const rng = new ScriptedRng(SETUP_DICE)
  for (let i = 0; i < 800 && s.pending; i++) {
    const p = s.pending
    if (p.kind === 'ploy.firefight' && p.window === window && p.seat === seat) return s
    let a = defaultAnswer(s)
    if (p.kind === 'ploy.firefight') a = act.pass(p)
    else if (p.kind === 'strategy.gambit') {
      const mine = p.seat === 'A' ? p.options!.find((x) => gambits.includes(x.id)) : undefined
      a = mine ? mine.action : act.pass(p)
    }
    s = expectOk(step(s, a, rng)).state
  }
  throw new Error(`no ${window} window for ${seat}`)
}

/** Open ground, every operative parked in its corner; A (Phobos) is to activate. */
export function open(o: RealOpts = {}, gambits: string[] = []): GameState {
  const s = startPh(o, 'ph-open', gambits)
  return edit(s, (st) => {
    st.map = { ...st.map, features: [] }
    let a = 0
    let b = 0
    for (const op of Object.values(st.operatives)) {
      op.pos = op.seat === 'A' ? { x: -13.5, y: 0, z: -10 + a++ * 1.7 } : { x: 13.5, y: 0, z: -10 + b++ * 1.7 }
    }
    st.markers = st.markers.filter((m) => m.kind === 'objective')
    for (const op of Object.values(st.operatives)) op.flags.carrying = null
    st.equipment.placed = []
    for (const m of st.markers) m.controller = null
  })
}

export const A = (s: GameState, card: string): string => opOf(s, 'A', `ph.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A Phobos roster of the cards named (ids without the ph. prefix), with the Veteran's two Custom picks when asked. */
export function phRoster(cards: string[], picks: Record<number, Record<string, string>> = {}): RosterEntry[] {
  return cards.map((c, i) => ({ ...roster([`ph.${c}`])[0]!, ...(picks[i] ? { picks: picks[i] } : {}) }))
}

export const DEFAULT_CARDS = ['infiltrator-sergeant', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'infiltrator-veteran', 'incursor-marksman']

/** The stripped fixture gets its team markers back (carried by the Saboteur and the Minelayer). */
export function withMarkers(s: GameState): GameState {
  return withCtx(s, (ctx) => ensureMarkers(ctx, true)).state
}

/** The state with `ployId` in force for A (as if used in the Gambit step). */
export function withPloy(s: GameState, ...ployIds: string[]): GameState {
  return edit(s, (st) => {
    ployIds.forEach((ployId, i) => {
      st.effects.push({ id: `e9${i}`, seat: 'A', kind: 'ployFlag', expires: 'turningPoint', source: ployId } as never)
      st.ledger.A.tp.push(ployId)
    })
  })
}

/** Use a ploy through the engine with a hand-made offer (the window itself is not what the scenario is about). */
export function usePlayed(s: GameState, seat: Seat, ployId: string, info: Record<string, unknown>, param?: string): GameState {
  const ploy = s.data.ploys![ployId]!
  const offer: PloyOffer = { id: ployId, ployId, name: ploy.name, cost: ploy.cost, seed: param ? { param } : {}, ...(param ? { param } : {}) }
  return withCtx(s, (ctx) => usePloy(ctx, seat, offer, { window: 'x', ...info })).state
}

/** Stop at the next ploy window (or the next real choice). */
export const STOP_PLOY: DecisionKind[] = ['ploy.firefight', 'firefight.action', 'firefight.activate', 'firefight.order']

/** Answer a ploy window with the option of that id, anything else with a pass. */
export const takePloy = (id: string) => ({ 'ploy.firefight': (p: PendingDecision) => p.options?.find((o) => o.id === id)?.action ?? act.pass(p) })

/** Every ploy window passed. */
export const noPloys = { 'ploy.firefight': (p: PendingDecision) => act.pass(p) }

/** Answer a fight's strike or block choices by striking with the first die offered. */
export const strikes = { 'fight.resolve': (p: PendingDecision) => p.options?.find((o) => o.id.startsWith('strike'))?.action ?? p.options![0]!.action }

/** A Phobos operative on the open board with the Kommando Boy `gap` inches to its right, A to act. */
export function facing(s: GameState, a: string, b: string, gapX = 5): GameState {
  return place(place(s, a, 0, 0), b, gapX, 0)
}

/** Shoot the Boy with one weapon; ploy windows are answered by `answers`, anything else by the engine; stops at the next real choice. */
export function shootBoy(s: GameState, shooter: string, boy: string, weaponId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}) {
  const t = take(take(activateOp(s, shooter), 'shoot').state, weaponId).state
  const first = take(t, boy, rng)
  const rest = play(first.state, rng, answers, DEFAULT_STOP)
  return { ...rest, events: [...first.events, ...rest.events] }
}

export const scenarios: Record<string, () => void> = {
  phAstartes() {
    const s = open()
    maxRepeats(s, s.operatives[A(s, 'infiltrator-sergeant')]!, 'fight', ['fight'])
  },
  phMultiSpectrum() {
    const s = open()
    runHook('target.status', { seat: 'A', state: s, operativeId: A(s, 'incursor-marksman'), targetId: B(s, 'boy'), data: { obscured: true, inCover: false } as never })
  },
  phTerror() {
    const s = open({ rosterA: phRoster(['infiltrator-sergeant', 'reiver-warrior', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-marksman']) })
    const boy = B(s, 'boy')
    const t = place(place(s, A(s, 'reiver-warrior'), 0, 0), boy, 2, 0)
    providerCostDelta(t, t.operatives[boy]!, 'marker:pickUp')
  },
  phTacticalAdvantage() {
    const s = edit(open(), (st) => {
      st.strategy.rolls = { A: 1, B: 6 }
    })
    const p = providerInitiativeReroll(s, 'A')
    if (p.length === 0) throw new Error('Tactical Advantage was not offered')
    withCtx(s, (ctx) => p[0]!.onInitiativeReroll?.(ctx, 'A'))
  },
  phStrategicOversight() {
    const s = open()
    withCtx(s, (ctx) => {
      runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })
    }, dice(6, 6))
  },
  phCommsArray() {
    const s = withPloy(open(), 'ph.p.deadly-shots')
    const info = { window: 'firefight.activationStart', subjectId: A(s, 'infiltrator-sergeant'), counteracting: false }
    const o = offersFor(s, 'A', 'firefight.activationStart', info).find((x) => x.via === 'ph.comms' && x.ployId === 'ph.p.lethal-assaults')
    if (!o) throw new Error('no Comms Array offer')
    withCtx(s, (ctx) => usePloy(ctx, 'A', o, info))
  },
  phMedic() {
    const s = open()
    const hx = A(s, 'infiltrator-helix-adept')
    const sg = A(s, 'infiltrator-sergeant')
    const t = place(place(s, hx, 0, 0), sg, 2, 0)
    // the casualty waits in the deferred removal queue; the Phobos player takes the save
    const asked = withCtx(t, (ctx) => {
      directDamage(ctx, sg, 99, B(s, 'boy'), 'test')
      runDeferredRemovals(ctx)
    }).state
    take(asked, 'save', dice(5))
  },
  phHelixGauntlet() {
    const s = open()
    const hx = A(s, 'infiltrator-helix-adept')
    const sg = A(s, 'infiltrator-sergeant')
    const t = edit(place(place(s, hx, 0, 0), sg, 1.2, 0), (st) => {
      st.operatives[sg]!.wounds = 5
    })
    take(activateOp(t, hx), `ability:ph.a.helix-gauntlet:${sg}`, dice(6))
  },
  phPlantExplosives() {
    withMarkers(open())
  },
  phDetonate() {
    const s = withMarkers(open())
    const sab = A(s, 'infiltrator-saboteur')
    const boy = B(s, 'boy')
    const t = edit(place(place(s, sab, 0, 0), boy, 3.5, 0), (st) => {
      const m = st.markers.find((k) => k.equipmentId === EXPLOSIVES)!
      m.carriedBy = null
      m.pos = { x: 2, z: 0 }
      st.operatives[sab]!.flags.carrying = null
    })
    const w = take(take(activateOp(t, sab), 'shoot').state, 'ph.w.remote-detonator').state
    play(w, dice(6, 6, 6, 6, 1, 1, 1, 1), noPloys)
  },
  phCustom() {
    const s = open()
    const vet = A(s, 'infiltrator-veteran')
    effectiveRules(s, s.operatives[vet]!, s.data.weapons['ph.w.custom-bolt-carbine']!, 'shoot', B(s, 'boy'))
  },
  phVoxbreak() {
    const s = open({ rosterA: phRoster(['infiltrator-sergeant', 'infiltrator-voxbreaker', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-marksman']) })
    const boy = B(s, 'boy')
    const t = place(place(s, A(s, 'infiltrator-voxbreaker'), 0, 0), boy, 4, 0)
    providerRerollsBanned(t, { operativeId: boy } as never, {} as never)
  },
  phAuspexScan() {
    const s = open({ rosterA: phRoster(['infiltrator-sergeant', 'infiltrator-voxbreaker', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-marksman']) })
    take(activateOp(s, A(s, 'infiltrator-voxbreaker')), 'ability:ph.a.auspex-scan:scan')
  },
  phVanguard() {
    const s = open({ rosterA: phRoster(['infiltrator-sergeant', 'infiltrator-warrior', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-marksman']) })
    withCtx(s, (ctx) => {
      runHook('action.declared', { seat: 'A', state: ctx.state, engine: ctx, operativeId: A(s, 'infiltrator-warrior'), data: { action: 'marker:pickUp', counteract: false, free: false, activeSeat: 'A', cancel: false, bar: false } })
    })
  },
  phTrackTarget() {
    const s0 = open()
    const s = edit(s0, (st) => {
      const m = st.operatives[A(s0, 'incursor-marksman')]!
      m.order = 'conceal'
      st.firefight.stack = [null]
      st.firefight.activation = { operativeId: m.id, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null, frame: { kind: 'interrupt', resume: 'guard.interrupt' } }
    })
    withCtx(s, (ctx) => {
      runHook('action.declared', { seat: 'A', state: ctx.state, engine: ctx, operativeId: A(s, 'incursor-marksman'), data: { action: 'shoot', counteract: false, free: true, activeSeat: 'B', cancel: false, bar: false } })
    })
  },
  phHaywireMine() {
    withMarkers(open({ rosterA: phRoster(['infiltrator-sergeant', 'incursor-minelayer', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-marksman']) }))
  },
  phProximityMine() {
    const s = withMarkers(open({ rosterA: phRoster(['infiltrator-sergeant', 'incursor-minelayer', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-marksman']) }))
    const boy = B(s, 'boy')
    const t = edit(place(s, boy, 0, 0), (st) => {
      const m = st.markers.find((k) => k.equipmentId === HAYWIRE)!
      m.carriedBy = null
      m.pos = { x: 0.9, z: 0 }
    })
    withCtx(t, (ctx) => {
      runHook('action.ended', { seat: 'B', state: ctx.state, engine: ctx, operativeId: boy, data: { action: 'dash', counteract: false, free: false, activeSeat: 'B' } })
    }, dice(6, 6, 6, 6))
  },
  phGravChute() {
    const s = open({ rosterA: phRoster(['infiltrator-sergeant', 'reiver-warrior', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'incursor-marksman']) })
    providerMoveSurcharge(s, s.operatives[A(s, 'reiver-warrior')]!, 'reposition', [], { horizontal: 0, accessible: 0, climb: 3, drop: 4 })
  },
  phOmniScrambler() {
    const g = toGambit({ rosterA: phRoster(['infiltrator-sergeant', 'infiltrator-commsman', 'infiltrator-helix-adept', 'infiltrator-saboteur', 'infiltrator-voxbreaker', 'infiltrator-warrior']) })
    const id = g.pending!.options!.find((o) => o.id.startsWith('ph.p.omni-scrambler:'))?.id
    if (!id) throw new Error('no Omni-Scrambler option')
    take(g, id)
  },
  phFlagPloy() {
    take(toGambit(), 'ph.p.deadly-shots')
  },
  phPatientAmbush() {
    take(toWindow('firefight.beforeActivation'), 'ph.p.patient-ambush')
  },
  phCriticalShot() {
    const s = open()
    const sg = A(s, 'infiltrator-sergeant')
    const boy = B(s, 'boy')
    shootBoy(facing(s, sg, boy), sg, boy, 'ph.w.marksman-bolt-carbine', dice(6, 6, 1, 1), takePloy('ph.p.critical-shot'))
  },
  phStealthAssault() {
    const s0 = open()
    const sg = A(s0, 'infiltrator-sergeant')
    const boy = B(s0, 'boy')
    const s = edit(place(place(s0, sg, 0, 0), boy, 4, 0), (st) => {
      st.operatives[sg]!.order = 'conceal'
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
    })
    let t = take(activateOp(s, sg, 'engage'), 'charge').state
    const p = t.pending!
    t = expectOk(step(t, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 2.3, z: 0 }] } })).state
    t = take(take(t, 'fight').state, boy, dice(6, 6, 6, 6, 1, 1, 1, 1)).state
    play(t, dice(), { ...takePloy('ph.p.stealth-assault'), ...strikes })
  },
  phGuerrillaWarfare() {
    const s = open({}, ['ph.p.guerrilla-warfare'])
    const sg = A(s, 'infiltrator-sergeant')
    const t = activateOp(s, sg, 'engage')
    take(t, 'ability:ph.a.guerrilla-warfare:conceal')
  },
  phPuritySeals() {
    const s = open({ equipmentA: ['ph.e.purity-seals'] })
    const sg = A(s, 'infiltrator-sergeant')
    const boy = B(s, 'boy')
    shootBoy(facing(s, sg, boy), sg, boy, 'ph.w.marksman-bolt-carbine', dice(1, 1, 1, 1), takePloy('ph.e.purity-seals'))
  },
  phAdditionalGrenades() {
    const picks = ['core.a.smoke-grenade', 'core.a.smoke-grenade', 'core.a.stun-grenade', 'core.a.stun-grenade']
    open({ equipmentA: ['ph.e.additional-utility-grenades'], equipmentChoices: { A: { 'ph.e.additional-utility-grenades': picks }, B: {} } })
  },
  phSpecialIssueAmmo() {
    const s = open({ equipmentA: ['ph.e.special-issue-ammunition'] })
    const sg = A(s, 'infiltrator-sergeant')
    const boy = B(s, 'boy')
    shootBoy(facing(s, sg, boy), sg, boy, 'ph.w.marksman-bolt-carbine', dice(1, 1, 1, 1), takePloy('ph.e.special-issue-ammunition'))
  },
}
