// fellgor-ravagers code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/fellgor-ravagers.test.ts.
import { createGame, step } from '@/engine'
import { act } from '@/engine/actions'
import { actionForbidden, maxRepeats, refreshFlags } from '@/engine/abilities'
import { attackStats, effectiveRules, inflict, validTargets } from '@/engine/attack-common'
import { effectiveMove } from '@/engine/state'
import { providerControlApl } from '@/engine/team-rules'
import { answerDecision } from '@/engine/query'
import type { Rng } from '@/engine/rng'
import type { GameEvent } from '@/engine/events'
import { runHook } from '@/engine/hooks'
import { offersFor, usePloy, type PloyOffer } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import type { DecisionKind, GameState, PendingDecision, RosterEntry } from '@/engine/types'
import { arm, melee, play, ranged, withWeapons, type Played } from '../../fixtures/attack'
import { feature, part, rect } from '../../fixtures/maps'
import { defaultAnswer, drive, expectOk, place } from '../../fixtures/helpers'
import { activateOp, edit, openReal, opOf, optionIds, passIt, realBundle, realSetupWith, roster, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['fellgor-ravagers', 'kommandos'] as [string, string] }

/** Open ground, every operative parked in its corner; A (Fellgor Ravagers) is to activate. */
export function open(o: Parameters<typeof openReal>[0] = {}): GameState {
  return openReal({ ...MATCH, ...o })
}
export const A = (s: GameState, card: string): string => opOf(s, 'A', `fg.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A forced dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(160).fill(1)])

/** A Fellgor roster of the given datacards with their first legal loadouts. */
export const fgRoster = (ids: string[]): RosterEntry[] => roster(ids)

const NINE = ['fg.deathknell', 'fg.fluxbray', 'fg.gnarlscar', 'fg.gorehorn', 'fg.herd-goad', 'fg.mangler', 'fg.shaman', 'fg.toxhorn', 'fg.vandal']
/** The leader, the nine single entries and nothing else. */
export const ALL = ['fg.ironhorn', ...NINE]
/** The leader, three Warriors and six single entries: a roster with Warriors for the Frenzy tests. */
export const WITH_WARRIORS = ['fg.ironhorn', 'fg.warrior', 'fg.warrior', 'fg.warrior', 'fg.deathknell', 'fg.gorehorn', 'fg.herd-goad', 'fg.shaman', 'fg.toxhorn', 'fg.vandal']

/** Park every operative in its corner on open ground (what openReal does), for a state that is not at the first activation. */
export function parked(state: GameState): GameState {
  return edit(state, (st) => {
    st.map = { ...st.map, features: [] }
    let a = 0
    let b = 0
    for (const op of Object.values(st.operatives)) op.pos = op.seat === 'A' ? { x: -13.5, y: 0, z: -10 + a++ * 1.7 } : { x: 13.5, y: 0, z: -10 + b++ * 1.7 }
    st.markers = st.markers.filter((m) => m.kind === 'objective')
    st.equipment.placed = []
  })
}

/** The Strategy phase of turning point 1 at A's first gambit decision. */
export function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'fg-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 1200, new ScriptedRng([6, 1, 6, 1]))
}

/** Use a ploy through the engine with a hand-made offer (the window itself is not what the scenario is about). */
export function usePlayed(s: GameState, ployId: string, info: Record<string, unknown> = {}, param?: string, seat: 'A' | 'B' = 'A'): GameState {
  const ploy = s.data.ploys![ployId]!
  const offer: PloyOffer = { id: ployId, ployId, name: ploy.name, cost: ploy.cost, seed: param ? { param } : {}, ...(param ? { param } : {}) }
  return withCtx(s, (ctx) => usePloy(ctx, seat, offer, { window: 'x', ...info })).state
}

/** A's first operative has acted and ended: the next activation is B's. */
export function bTurn(s: GameState, ender: string): GameState {
  return take(activateOp(s, ender), 'end').state
}

/** Add timed effects the hooks read (a strategy ploy in force): `expires` defaults to the turning point. */
export function withFx(s: GameState, ...list: { source: string; kind?: string; operativeId?: string; expires?: string; seat?: 'A' | 'B'; data?: Record<string, unknown> }[]): GameState {
  return edit(s, (st) => {
    list.forEach((e, i) => st.effects.push({ id: `ek${i}${st.effects.length}`, seat: e.seat ?? 'A', kind: e.kind ?? 'ployFlag', expires: e.expires ?? 'turningPoint', source: e.source, ...(e.operativeId ? { operativeId: e.operativeId } : {}), ...(e.data ? { data: e.data } : {}) } as never))
  })
}

/** Stop at the next ploy window (or the next real choice). */
export const STOP_PLOY: DecisionKind[] = ['ploy.firefight', 'firefight.action', 'firefight.activate', 'firefight.order']

/** Answer a ploy window with the option of that id, anything else with a pass. */
export const takePloy = (id: string) => ({ 'ploy.firefight': (p: PendingDecision) => p.options?.find((o) => o.id === id)?.action ?? act.pass(p) })

/** Answer a fight's strike or block choices by striking with the first die offered. */
export const strikes = { 'fight.resolve': (p: PendingDecision) => p.options?.find((o) => o.id.startsWith('strike'))?.action ?? p.options![0]!.action }

/** Answer a move decision with one waypoint. */
export const goTo = (x: number, z: number) => ({ 'move.path': (q: PendingDecision) => ({ type: 'move.path' as const, seat: q.seat, decisionId: q.id, payload: { waypoints: [{ x, z }] } }) })

/** Put two operatives face to face (a melee), or at a distance in the open. */
export function facing(s: GameState, a: string, b: string, gapX = 1.4): GameState {
  return place(place(s, a, 0, 0), b, gapX, 0)
}

/** Give a Fellgor operative a Frenzy token (and the 1 wound Frenzy holds it on) without playing the incapacitation out. */
export function frenzy(s: GameState, id: string): GameState {
  return edit(s, (st) => {
    const op = st.operatives[id]!
    op.wounds = 1
    op.order = 'engage'
    op.tokens = [...(op.tokens ?? []), { kind: 'fg.frenzy', owner: op.seat, count: 1, since: st.seq, data: { strikes: 0 } }]
    refreshFlags(st)
  })
}

/** One attack state for unit-style damage tests: a Shoot at `target` by `attacker` with `weaponId`. */
export function shootingAt(s: GameState, attacker: string, target: string, weaponId: string): GameState {
  return edit(s, (st) => {
    st.attack = { kind: 'shoot', stage: 'resolve', operativeId: attacker, seat: st.operatives[attacker]!.seat, weaponId, pointBlank: false, targets: [target], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] }
  })
}

/** Inflict a list of damage amounts (amount, source) on `target`, returning the state and the damage actually dealt. */
export function hit(s: GameState, target: string, attacker: string, weaponId: string | null, list: [number, string][], rng?: ScriptedRng): { state: GameState; dealt: number[] } {
  const dealt: number[] = []
  const state = withCtx(s, (ctx) => {
    for (const [amount, source] of list) dealt.push(inflict(ctx, { targetId: target, attackerId: attacker, weaponId, amount, source }))
  }, rng).state
  return { state, dealt }
}

/** One Shoot by `who` with `weaponId` at `targetId`, all dice scripted; returns the state at the next action decision. */
export function shootAt(s: GameState, who: string, weaponId: string, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}, order: 'engage' | 'conceal' = 'engage'): Played {
  let t = take(activateOp(s, who, order, rng), 'shoot', rng).state
  t = take(t, weaponId, rng).state
  t = take(t, targetId, rng).state
  return play(t, rng, answers)
}

/** A Fight begun by `who` against `targetId` (the operative waits at its next decision after the fight target pick). */
export function fightAt(s: GameState, who: string, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}): Played {
  const t = take(take(activateOp(s, who, 'engage', rng), 'fight', rng).state, targetId, rng).state
  return play(t, rng, { 'fight.resolve': strikes['fight.resolve'], ...answers })
}

/** Take an option and keep the events. */
export function takeEv(s: GameState, id: string, rng: Rng, acc: GameEvent[]): GameState {
  const r = take(s, id, rng)
  acc.push(...r.events)
  return r.state
}

/** Answer decisions (passing ploy windows without the option, striking in fights) until `optionId` is on offer. */
export function advanceTo(s: GameState, optionId: string, rng: Rng): GameState {
  let t = s
  for (let i = 0; i < 80; i++) {
    const p = t.pending
    if (!p) break
    if (p.options?.some((o) => o.id === optionId)) return t
    if (p.kind === 'ploy.firefight') t = passIt(t, rng).state
    else if (p.kind === 'fight.resolve') t = take(t, (p.options!.find((o) => o.id.startsWith('strike')) ?? p.options![0]!).id, rng).state
    else t = step(t, answerDecision(t, p) ?? p.options?.[0]?.action ?? act.pass(p), rng).state
  }
  throw new Error(`option ${optionId} never offered (at ${t.pending?.kind}: ${optionIds(t).join(', ')})`)
}

export { expectOk, step, runHook, offersFor }

/** Fight by `attacker` against `target` (both parked face to face), the attacker's dice then the target's. */
function duel(s: GameState, attacker: string, target: string, rng: ScriptedRng, ender = 'fg.ironhorn'): GameState {
  const faced = edit(facing(s, attacker, target), (st) => void (st.operatives[target]!.wounds = st.operatives[target]!.maxWounds = 60))
  const mine = s.operatives[attacker]!.seat === 'A'
  const t = mine ? faced : bTurn(faced, opOf(faced, 'A', ender))
  return take(take(activateOp(t, attacker, 'engage', rng), 'fight', rng).state, target, rng).state
}

const PLAIN = { rosterA: roster(ALL) }
const WARRIORS = { rosterA: roster(WITH_WARRIORS) }
const MG = (s: GameState) => opOf(s, 'A', 'fg.mangler')

export const scenarios: Record<string, () => void> = {
  fgFrenzy() {
    const s = open(WARRIORS)
    hit(edit(s, (st) => void (st.operatives[A(s, 'warrior')]!.wounds = 2)), A(s, 'warrior'), B(s, 'boy'), null, [[5, 'direct']])
  },
  fgIconBearer() {
    const s = open(PLAIN)
    providerControlApl(s, s.operatives[A(s, 'deathknell')]!, s.markers[0]!, 2)
  },
  fgWarGong() {
    const s0 = open(WARRIORS)
    const wr = A(s0, 'warrior')
    const boy = B(s0, 'boy')
    const gun = ranged('t.gun', { dmg: { normal: 3, crit: 5 } })
    const s = shootingAt(withWeapons(place(place(place(s0, wr, 0, 0), A(s0, 'deathknell'), 2, 0), boy, 6, 0), gun), boy, wr, 't.gun')
    hit(s, wr, boy, 't.gun', [[5, 'crit']])
  },
  fgBladeWhirl() {
    const s0 = open(PLAIN)
    const boy = B(s0, 'boy')
    const club = melee('t.club', { dmg: { normal: 1, crit: 1 } })
    const base = arm(withWeapons(s0, club), boy, ['t.club'])
    const rng = dice(4, 4, 4, 4, 4, 4, 4, 4)
    play(duel(base, boy, A(s0, 'fluxbray'), rng), rng, {}, ['fight.resolve'])
  },
  fgSagacious() {
    const s = open(PLAIN)
    take(take(activateOp(s, A(s, 'gnarlscar')), 'end').state, 'fg.x.sagacious')
  },
  fgChampion() {
    const s = open(PLAIN)
    maxRepeats(s, s.operatives[A(s, 'gorehorn')]!, 'fight', ['fight'])
  },
  fgHeadtaker() {
    const s = open(PLAIN)
    const gh = A(s, 'gorehorn')
    const boy = B(s, 'boy')
    hit(edit(s, (st) => void (st.operatives[boy]!.wounds = 2)), boy, gh, 'fg.w.skullcleaver', [[4, 'strike-normal']], dice(4))
  },
  fgWhipControl() {
    const s = open(PLAIN)
    const near = place(place(s, A(s, 'herd-goad'), 0, 0), B(s, 'boy'), 2.5, 0)
    attackStats(near, B(s, 'boy'), 'kom.w.choppa', A(s, 'gnarlscar'), { kind: 'fight' })
  },
  fgTactualHunter() {
    const s0 = open(PLAIN)
    const mg = MG(s0)
    const boy = B(s0, 'boy')
    const base = edit(facing(s0, mg, boy), (st) => {
      st.operatives[mg]!.wounds = st.operatives[mg]!.maxWounds = 80
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 80
      st.operatives[boy]!.ready = false
    })
    fightAt(base, mg, boy, dice(6, 6, 6, 6, 4, 4, 4, 4))
  },
  fgBerserker() {
    const s = open(PLAIN)
    actionForbidden(s, s.operatives[MG(s)]!, 'shoot')
  },
  fgSavage() {
    const s0 = open(PLAIN)
    const rng = dice(6, 6, 6, 6, 1, 1, 1, 1, 1, 1, 1, 1)
    const t = advanceTo(duel(s0, MG(s0), B(s0, 'boy'), rng), 'fg.x.savage', rng)
    take(t, 'fg.x.savage', rng)
  },
  fgToxicBlessings() {
    const s0 = open(PLAIN)
    const tx = A(s0, 'toxhorn')
    const boy = B(s0, 'boy')
    const gun = ranged('t.gun', { dmg: { normal: 4, crit: 6 } })
    hit(shootingAt(withWeapons(s0, gun), boy, tx, 't.gun'), tx, boy, 't.gun', [[4, 'normal']], dice(5))
  },
  fgViciousBlows() {
    const s = open(PLAIN)
    const vd = A(s, 'vandal')
    const fight = edit(s, (st) => void (st.attack = { kind: 'fight', operativeId: vd, seat: 'A', fight: { targetId: B(s, 'boy') } } as never))
    effectiveRules(fight, fight.operatives[vd]!, fight.data.weapons['fg.w.mancrusher']!, 'fight', B(s, 'boy'))
  },
  fgWarriorFrenzy() {
    const s = open(WARRIORS)
    frenzy(s, A(s, 'warrior'))
  },
  fgBrassAdornments() {
    const s = open({ ...WARRIORS, equipmentA: ['fg.e.brass-adornments'] })
    const start = take(take(s, A(s, 'warrior')).state, 'engage').state
    take(start, 'fg.p.wild-rage')
  },
  fgGoreMarks() {
    const s0 = open({ ...WARRIORS, equipmentA: ['fg.e.gore-marks'] })
    const rng = dice(2, 3, 3, 3, 1, 1, 1, 1, 1)
    const w = advanceTo(duel(s0, A(s0, 'warrior'), B(s0, 'boy'), rng), 'fg.e.gore-marks:0', rng)
    take(w, 'fg.e.gore-marks:0', rng)
  },
  fgChaosSigil() {
    const s0 = open({ ...WARRIORS, equipmentA: ['fg.e.chaos-sigil'] })
    const wr = A(s0, 'warrior')
    const boy = B(s0, 'boy')
    const pw = ranged('t.pierce', { atk: 4, hit: 3, dmg: { normal: 1, crit: 2 } }, [{ rule: 'piercing', x: 1 }])
    let s = arm(withWeapons(place(place(s0, wr, 0, 0), boy, 6, 0), pw), boy, ['t.pierce'])
    s = bTurn(edit(s, (st) => void (st.operatives[wr]!.wounds = st.operatives[wr]!.maxWounds = 60)), opOf(s0, 'A', 'fg.ironhorn'))
    const rng = dice(3, 3, 3, 3, 1, 1, 1, 1)
    const t = take(take(take(activateOp(s, boy, 'engage', rng), 'shoot', rng).state, 't.pierce', rng).state, wr, rng).state
    play(take(advanceTo(t, 'fg.e.chaos-sigil', rng), 'fg.e.chaos-sigil', rng).state, rng, { 'ploy.firefight': (p) => act.pass(p) }, ['firefight.action'])
  },
  fgWarPaint() {
    const s = open({ ...WARRIORS, equipmentA: ['fg.e.war-paint'] })
    const wr = A(s, 'warrior')
    const hurt = edit(s, (st) => void (st.operatives[wr]!.wounds = 3))
    effectiveMove(hurt.operatives[wr]!, hurt)
  },
  fgGongKnell() {
    const s = open(PLAIN)
    take(activateOp(s, A(s, 'deathknell')), 'ability:fg.a.gong-knell')
  },
  fgSweepingBlow() {
    const s = open(PLAIN)
    const vd = A(s, 'vandal')
    take(activateOp(place(place(s, vd, 0, 0), B(s, 'boy'), 1.5, 0), vd), 'ability:fg.a.sweeping-blow', dice(4))
  },
  fgInciteFury() {
    const s = open(WARRIORS)
    const hg = A(s, 'herd-goad')
    const wr = A(s, 'warrior')
    take(activateOp(place(place(s, hg, 0, 0), wr, 2, 0), hg), `ability:fg.a.incite-fury:${wr}`)
  },
  fgApoplecticRejuvenation() {
    const s = open(WARRIORS)
    const sh = A(s, 'shaman')
    const wr = A(s, 'warrior')
    const hurt = edit(place(place(s, sh, 0, 0), wr, 3, 0), (st) => void (st.operatives[wr]!.wounds = 2))
    take(activateOp(hurt, sh), `ability:fg.a.apoplectic-rejuvenation:${wr}`, dice(2, 2))
  },
  fgMantleOfDarkness() {
    const s0 = open(WARRIORS)
    const sh = A(s0, 'shaman')
    const wr = A(s0, 'warrior')
    const boy = B(s0, 'boy')
    const seek = ranged('t.seek', {}, [{ rule: 'seek' }])
    const wall = feature('fg-wall', part('fg-wall.a', rect(3, 3.4, -2, 2), 1, ['light']))
    let s = arm(withWeapons(place(place(place(s0, boy, -2, 0), wr, 4, 0), sh, 4, 2), seek), boy, ['t.seek'])
    s = edit(s, (st) => {
      st.map = { ...st.map, features: [wall] }
      for (const o of Object.values(st.operatives)) o.order = 'engage'
      st.operatives[wr]!.order = 'conceal'
    })
    const cast = take(activateOp(s, sh), 'ability:fg.a.mantle-of-darkness').state
    validTargets(cast, cast.operatives[boy]!, 't.seek')
  },
  fgCleaverFlurry() {
    const s0 = open(PLAIN)
    const fx = A(s0, 'fluxbray')
    const s = place(place(place(s0, fx, 0, 0), B(s0, 'boy'), 3, 1.9), B(s0, 'grot'), 6, -1.9)
    const t = take(activateOp(s, fx), 'ability:fg.a.cleaver-flurry').state
    step(t, { type: 'move.path', seat: 'A', decisionId: t.pending!.id, payload: { waypoints: [{ x: 8, z: 0 }] } }, dice(4, 6))
  },
  fgUncompromisingAttack() {
    const s0 = open(PLAIN)
    const gn = A(s0, 'gnarlscar')
    const boy = B(s0, 'boy')
    const s = edit(facing(s0, gn, boy), (st) => void (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 60))
    play(take(activateOp(s, gn), 'ability:fg.a.uncompromising-attack:fight').state, dice(), strikes)
  },
  fgPoxBomb() {
    const s = open(PLAIN)
    const tx = A(s, 'toxhorn')
    const boy = B(s, 'boy')
    take(activateOp(place(place(s, tx, 0, 0), boy, 4, 0), tx), `ability:fg.a.pox-bomb-stun:${boy}`, dice(5))
  },
  fgCallTheAttack() {
    const g = parked(toGambit({ rosterA: roster(ALL) }))
    const iron = A(g, 'ironhorn')
    const dk = A(g, 'deathknell')
    const used = usePlayed(place(place(g, iron, -5, 0), dk, -3, 0), 'fg.p.call-the-attack', {}, dk)
    take(used, 'done')
  },
  fgFlagPloy() {
    usePlayed(toGambit({ rosterA: roster(ALL) }), 'fg.p.violent-temperament')
  },
  fgRuthlessRampage() {
    const s0 = open(WARRIORS)
    const wr = A(s0, 'warrior')
    const boy = B(s0, 'boy')
    const kill = edit(place(place(place(s0, wr, 0, 0), boy, 1.4, 0), B(s0, 'grot'), 4.2, 0), (st) => void (st.operatives[boy]!.wounds = 1))
    const rng = dice(6, 6, 6, 6, 1, 1, 1, 1)
    const w = advanceTo(take(take(activateOp(kill, wr, 'engage', rng), 'fight', rng).state, boy, rng).state, 'fg.p.ruthless-rampage', rng)
    take(w, 'fg.p.ruthless-rampage', rng)
  },
  fgWildRage() {
    const s = open(WARRIORS)
    const start = take(take(s, A(s, 'warrior')).state, 'engage').state
    take(start, 'fg.p.wild-rage')
  },
  fgAnimalisticFury() {
    const s0 = open(WARRIORS)
    const rng = dice(6, 6, 6, 6, 1, 1, 1, 1)
    const t = advanceTo(duel(s0, A(s0, 'warrior'), B(s0, 'boy'), rng), 'fg.p.animalistic-fury', rng)
    take(t, 'fg.p.animalistic-fury', rng)
  },
  fgBloodsense() {
    const s0 = open(WARRIORS)
    const wr = A(s0, 'warrior')
    const boy = B(s0, 'boy')
    const hg = A(s0, 'herd-goad')
    const kill = edit(place(place(place(s0, wr, 0, 0), boy, 1.4, 0), hg, 0.5, 2.4), (st) => void (st.operatives[boy]!.wounds = 1))
    const rng = dice(6, 6, 6, 6, 1, 1, 1, 1)
    const w = advanceTo(take(take(activateOp(kill, wr, 'engage', rng), 'fight', rng).state, boy, rng).state, `fg.p.bloodsense:${hg}`, rng)
    take(w, `fg.p.bloodsense:${hg}`, rng)
  },
}
