// hunter-clade code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers below are shared with hunter-clade.test.ts.

import { createGame, step } from '@/engine'
import { resolveLoadoutChoice } from '@/engine/bundle'
import { attackStats, effectiveRules, validTargets } from '@/engine/attack-common'
import { runHook } from '@/engine/hooks'
import { gambitOffers, offersFor, usePloy } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { providerStealthy } from '@/engine/team-rules'
import { E, P } from '@/engine/teams/hunter-clade'
import type { GameState, RosterEntry } from '@/engine/types'
import { ranged, withWeapons } from '../../fixtures/attack'
import { drive, expectOk, place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { activateOp, edit, openReal, opOf, realBundle, realSetupWith, roster, take, withCtx } from '../../fixtures/real'
export const MATCH = { teams: ['hunter-clade', 'kommandos'] as [string, string] }
export const pass = (p: { seat: 'A' | 'B'; id: string }) => ({ type: 'pass' as const, seat: p.seat, decisionId: p.id, payload: {} as Record<string, never> })

/** Open ground, every operative parked in its corner; A (Hunter Clade) is to activate. */
export const open = (o: Parameters<typeof openReal>[0] = {}): GameState => openReal({ ...MATCH, ...o })
export const A = (s: GameState, card: string): string => opOf(s, 'A', `hc.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)
export const entry = (id: string, answer: Record<string, string[]> = {}): RosterEntry => ({ datacardId: id, loadout: resolveLoadoutChoice(realBundle, id, answer) })

/** A roster with the datacards the tests use: both Alphas, both Princeps, Sicarian Warriors, a Diktat and a Surveyor. */
export const FULL = roster([
  'hc.skitarii-ranger-alpha',
  'hc.skitarii-ranger-warrior',
  'hc.skitarii-vanguard-warrior',
  'hc.skitarii-vanguard-alpha',
  'hc.sicarian-ruststalker-princeps',
  'hc.sicarian-ruststalker-warrior',
  'hc.sicarian-infiltrator-princeps',
  'hc.sicarian-infiltrator-warrior',
  'hc.skitarii-ranger-diktat',
  'hc.skitarii-ranger-surveyor',
])

/** The first Strategy-phase gambit decision (A holds initiative). */
export function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'hc-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
}

/** Pass every ploy window that is open. */
export function passAll(s: GameState): GameState {
  let t = s
  while (t.pending?.kind === 'ploy.firefight') t = expectOk(step(t, pass(t.pending))).state
  return t
}

/** The gambit options are fixed when the decision is raised: rebuild them after an edit of the state. */
export function refreshGambit(st: GameState): GameState {
  return edit(st, (x) => {
    const p = x.pending!
    p.options = gambitOffers(x, 'A').map((o) => ({
      id: o.id,
      labelKey: 'strategy.gambit',
      action: { type: 'strategy.gambit', seat: 'A', decisionId: p.id, payload: { gambitId: o.gambitId, ...(o.param ? { param: o.param } : {}) } } as never,
      data: { cost: o.cost },
    }))
  })
}

/** A gambit-step state moved to the open parking layout in turning point 2 with CP to spend. */
function gambitTp2(o: Parameters<typeof openReal>[0], tweak: (st: GameState) => void = () => undefined): GameState {
  return refreshGambit(
    edit(toGambit(o), (st) => {
      st.turningPoint = 2
      st.map = { ...st.map, features: [] }
      st.players.A.cp = 4
      let a = 0
      let b = 0
      for (const op of Object.values(st.operatives)) op.pos = op.seat === 'A' ? { x: -13.5, y: 0, z: -10 + a++ * 1.7 } : { x: 13.5, y: 0, z: -10 + b++ * 1.7 }
      tweak(st)
    }),
  )
}

/** The activation-start ploy window of `who` (A to act, 3 CP). */
function window(s: GameState, who: string): GameState {
  return take(take(edit(s, (st) => (st.players.A.cp = 3)), who).state, 'engage').state
}

const wall = feature('rubble', part('rubble.a', rect(-0.8, -0.6, -3, 3), 1, ['light']))

export const scenarios: Record<string, () => void> = {
  hcCanticleDestruction() {
    const s = open({ rosterA: FULL })
    const rust = A(s, 'sicarian-ruststalker-warrior')
    const t = edit(place(place(s, A(s, 'sicarian-ruststalker-princeps'), 0, 0), rust, 2, 0), (st) => (st.attack = { kind: 'fight', operativeId: rust } as never))
    withCtx(t, (ctx) => {
      runHook('beforeStrike', { seat: 'A', state: ctx.state, engine: ctx, operativeId: rust, targetId: B(s, 'boy'), data: { die: 'crit', amount: 6, cancel: false } })
    })
  },
  hcWastelandStalker() {
    const s = open({ rosterA: FULL })
    if (providerStealthy(s, s.operatives[A(s, 'sicarian-ruststalker-warrior')]!) !== 1) throw new Error('Wasteland Stalker gives one more cover save')
  },
  hcShroudpsalm() {
    const base = open({ rosterA: FULL })
    const inf = A(base, 'sicarian-infiltrator-warrior')
    const boy = B(base, 'boy')
    const s = edit(place(place(withWeapons(base, ranged('test.seek', { hit: 3 }, [{ rule: 'seek' }])), inf, 0, 0), boy, -6, 0), (st) => {
      st.map = { ...st.map, features: [wall] }
      st.operatives[inf]!.order = 'conceal'
      st.operatives[boy]!.weapons = ['test.seek']
      st.operatives[A(base, 'sicarian-infiltrator-princeps')]!.pos = { x: 2, y: 0, z: 0 }
    })
    if (validTargets(s, s.operatives[boy]!, 'test.seek').some((t) => t.id === inf)) throw new Error('the shrouded Infiltrator is still a target')
  },
  hcControlProtocol() {
    const s = edit(place(place(open({ rosterA: FULL }), A(open({ rosterA: FULL }), 'skitarii-ranger-alpha'), 0, 0), A(open({ rosterA: FULL }), 'skitarii-ranger-warrior'), 4, 0), (st) => (st.players.A.cp = 3))
    const w = A(s, 'skitarii-ranger-warrior')
    const info = { window: 'firefight.activationStart', subjectId: w }
    const offer = offersFor(s, 'A', 'firefight.activationStart', info).find((o) => o.ployId === P.override && o.cost === 0)
    if (!offer) throw new Error('Command Override should cost 0 CP with the leader in sight')
    withCtx(s, (ctx) => usePloy(ctx, 'A', offer, info))
  },
  hcElimination() {
    const s = open({ rosterA: FULL })
    const w = A(s, 'skitarii-ranger-warrior')
    const t = place(place(s, A(s, 'skitarii-ranger-alpha'), 0, 0), w, 2, 0)
    effectiveRules(t, t.operatives[w]!, t.data.weapons['hc.w.galvanic-rifle']!, 'shoot', B(s, 'boy'))
  },
  hcTargeting() {
    const s = open({ rosterA: FULL })
    const w = A(s, 'skitarii-ranger-warrior')
    const t = activateOp(place(place(s, w, 0, 0), B(s, 'boy'), 5, 0), w)
    attackStats(t, w, 'hc.w.galvanic-rifle', B(s, 'boy'), { kind: 'shoot' })
  },
  hcRadSaturation() {
    const s = open({ rosterA: FULL })
    const boy = B(s, 'boy')
    const t = place(place(s, A(s, 'skitarii-vanguard-warrior'), 0, 0), boy, 1.5, 0)
    attackStats(t, boy, 'kom.w.slugga', A(s, 'skitarii-ranger-alpha'), { kind: 'shoot' })
  },
  hcGlow() {
    const s = open({ rosterA: FULL })
    const boy = B(s, 'boy')
    const t = place(place(place(s, A(s, 'skitarii-vanguard-warrior'), 0, 0), A(s, 'skitarii-vanguard-alpha'), 0, 2), boy, 1.5, 0)
    attackStats(t, boy, 'kom.w.slugga', A(s, 'skitarii-ranger-alpha'), { kind: 'shoot' })
  },
  hcImperative() {
    const s = edit(open({ rosterA: FULL }), (st) => (st.config.A.doctrine = 'protector'))
    const w = A(s, 'skitarii-ranger-warrior')
    effectiveRules(s, s.operatives[w]!, s.data.weapons['hc.w.galvanic-rifle']!, 'shoot', B(s, 'boy'))
  },
  hcSignal() {
    const s = open({ rosterA: FULL })
    const d = A(s, 'skitarii-ranger-diktat')
    const f = A(s, 'skitarii-ranger-warrior')
    take(activateOp(place(place(s, d, 0, 0), f, 4, 0), d), `ability:hc.a.signal:${f}`)
  },
  hcSpot() {
    const s = open({ rosterA: FULL })
    const sv = A(s, 'skitarii-ranger-surveyor')
    const boy = B(s, 'boy')
    take(activateOp(place(place(s, sv, 0, 0), boy, 9, 0), sv), `ability:hc.a.spot:${boy}`)
  },
  hcDoctrina() {
    take(toGambit(), 'hc.p.doctrina:protector')
  },
  hcDebilitating() {
    take(edit(toGambit({ rosterA: FULL }), (st) => (st.players.A.cp = 3)), 'hc.p.debilitating-irradiation')
  },
  hcNeurostatic() {
    take(edit(toGambit({ rosterA: FULL }), (st) => (st.players.A.cp = 3)), 'hc.p.neurostatic-interference')
  },
  hcAccelerant() {
    take(edit(toGambit({ rosterA: FULL }), (st) => (st.players.A.cp = 3)), 'hc.p.accelerant-agents')
  },
  hcScouting() {
    const g = gambitTp2({ rosterA: FULL }, (st) => {
      for (const o of Object.values(st.operatives)) if (o.seat === 'A') o.order = 'conceal'
    })
    take(take(g, 'hc.p.scouting-protocol').state, 'done')
  },
  hcRadBombardment() {
    const g0 = toGambit({ rosterA: FULL, equipmentA: [E.rad] })
    const m = g0.markers.find((k) => k.kind === 'objective')!
    const boy = B(g0, 'boy')
    const g = gambitTp2({ rosterA: FULL, equipmentA: [E.rad] }, (st) => (st.operatives[boy]!.pos = { x: m.pos.x + 0.5, y: 0, z: m.pos.z }))
    take(g, `hc.p.rad-bombardment:marker:${m.id}`, new ScriptedRng([5]))
  },
  hcControlEdict() {
    const s = open({ rosterA: FULL })
    const a = A(s, 'skitarii-ranger-alpha')
    const w = A(s, 'skitarii-ranger-warrior')
    take(window(place(place(s, a, 0, 0), w, 2, 0), a), `hc.p.control-edict:${w}`)
  },
  hcMindLink() {
    const s = open({ rosterA: FULL, equipmentA: [E.mindLink] })
    const a = A(s, 'skitarii-ranger-alpha')
    const w = A(s, 'skitarii-ranger-warrior')
    take(window(place(place(s, a, 0, 0), w, 2, 0), a), `hc.p.control-edict:${w}:joint:engage`)
  },
  hcScrapcode() {
    const s = open({ rosterA: FULL })
    const inf = A(s, 'sicarian-infiltrator-warrior')
    take(window(place(s, inf, 0, 0), inf), 'hc.p.scrapcode-overload')
  },
  hcCommandOverride() {
    const s = open({ rosterA: FULL })
    const w = A(s, 'skitarii-ranger-warrior')
    take(window(place(s, w, 0, 0), w), 'hc.p.command-override:bulwark')
  },
  hcOmnissiah() {
    const s = edit(open({ rosterA: FULL }), (st) => (st.config.A.doctrine = 'protector'))
    const w = A(s, 'skitarii-ranger-warrior')
    take(window(place(s, w, 0, 0), w), P.omnissiah)
  },
  hcRedundancy() {
    const s = open({ rosterA: FULL, equipmentA: [E.redundancy] })
    const w = A(s, 'skitarii-ranger-warrior')
    take(window(edit(place(s, w, 0, 0), (st) => (st.operatives[w]!.wounds = 2)), w), E.redundancy, new ScriptedRng([3]))
  },
  hcRefractor() {
    const base = open({ rosterA: FULL, equipmentA: [E.refractor] })
    const w = A(base, 'skitarii-ranger-warrior')
    const boy = B(base, 'boy')
    const s = withWeapons(base, ranged('test.pierce', {}, [{ rule: 'piercing', x: 1 }]))
    const info = { window: 'shoot.beforeDefenceRoll', subjectId: w, attackerId: boy, targetId: w, kind: 'shoot', weaponId: 'test.pierce' }
    const offer = offersFor(s, 'A', 'shoot.beforeDefenceRoll', info).find((o) => o.ployId === E.refractor)
    if (!offer) throw new Error('Refractor Field should be offered against a Piercing attack')
    withCtx(s, (ctx) => usePloy(ctx, 'A', offer, info))
  },
}
