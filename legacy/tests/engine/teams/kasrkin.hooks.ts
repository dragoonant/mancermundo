// kasrkin code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/kasrkin.test.ts.
import { createGame, step } from '@/engine'
import { act } from '@/engine/actions'
import { maxRepeats } from '@/engine/abilities'
import { defenceStats, effectiveRules, inflict, parseRules, runDeferredRemovals } from '@/engine/attack-common'
import { directDamage } from '@/engine/effects'
import { runHook } from '@/engine/hooks'
import { offersFor, usePloy, type PloyOffer } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { usableRangedWeapons } from '@/engine/shoot'
import { effectiveMove } from '@/engine/state'
import type { DecisionKind, GameState, PendingDecision, RosterEntry } from '@/engine/types'
import { play, type Played } from '../../fixtures/attack'
import { defaultAnswer, drive, expectOk, place } from '../../fixtures/helpers'
import { activateOp, edit, openReal, opOf, realBundle, realSetupWith, roster, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['kasrkin', 'kommandos'] as [string, string] }

/** Open ground, every operative parked in its corner; A (Kasrkin) is to activate. */
export function open(o: Parameters<typeof openReal>[0] = {}): GameState {
  const s = openReal({ ...MATCH, ...o })
  // openReal keeps only the objective markers: put the Demo-Trooper's carried Melta Mine back
  const demo = Object.values(s.operatives).find((x) => x.seat === 'A' && x.datacardId === 'ks.demo-trooper')
  if (!demo || !demo.flags.carrying || s.markers.some((m) => m.equipmentId === 'ks.meltaMine')) return s
  return edit(s, (st) => {
    st.markers.push({ id: demo.flags.carrying!, kind: 'equipment', pos: { x: demo.pos.x, z: demo.pos.z }, owner: 'A', carriedBy: demo.id, controller: null, equipmentId: 'ks.meltaMine', pickable: true, placedBy: demo.id })
  })
}
export const A = (s: GameState, card: string): string => opOf(s, 'A', `ks.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A forced dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(160).fill(1)])

/** A Kasrkin roster of the given datacards with their first legal loadouts. */
export const ksRoster = (ids: string[]): RosterEntry[] => roster(ids)

/** The Strategy phase of turning point 1 at A's first gambit decision. */
export function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'ks-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 1200, new ScriptedRng([6, 1, 6, 1]))
}

/** Seat B (Kasrkin) at the Firefight phase start window (Kommandos hold initiative): the Seize the Initiative offer. */
export function toSeize(): GameState {
  const setup = realSetupWith({ teams: ['kommandos', 'kasrkin'] })
  let s = createGame(setup, 'ks-seize', realBundle).state
  const rng = new ScriptedRng([6, 1, 6, 1])
  for (let i = 0; i < 1500; i++) {
    const p = s.pending
    if (!p) break
    if (p.kind === 'ploy.firefight' && p.window === 'firefight.start') return s
    if (p.kind === 'firefight.activate') break
    s = expectOk(step(s, defaultAnswer(s), rng)).state
  }
  throw new Error(`no firefight.start window: ${s.pending?.kind}`)
}

/** Use a ploy through the engine with a hand-made offer (the window itself is not what the scenario is about). */
export function usePlayed(s: GameState, ployId: string, info: Record<string, unknown> = {}, param?: string): GameState {
  const ploy = s.data.ploys![ployId]!
  const offer: PloyOffer = { id: ployId, ployId, name: ploy.name, cost: ploy.cost, seed: param ? { param } : {}, ...(param ? { param } : {}) }
  return withCtx(s, (ctx) => usePloy(ctx, 'A', offer, { window: 'x', ...info })).state
}

/** A's first operative has acted and ended: the next activation is B's. */
export function bTurn(s: GameState, ender: string): GameState {
  return take(activateOp(s, ender), 'end').state
}

/** Stop at the next ploy window (or the next real choice). */
export const STOP_PLOY: DecisionKind[] = ['ploy.firefight', 'firefight.action', 'firefight.activate', 'firefight.order']

/** Answer a ploy window with the option of that id, anything else with a pass. */
export const takePloy = (id: string) => ({ 'ploy.firefight': (p: PendingDecision) => p.options?.find((o) => o.id === id)?.action ?? act.pass(p) })

/** Answer a fight's strike or block choices by striking with the first die offered. */
export const strikes = { 'fight.resolve': (p: PendingDecision) => p.options?.find((o) => o.id.startsWith('strike'))?.action ?? p.options![0]!.action }

/** Answer a move decision with one waypoint. */
export const goTo = (x: number, z: number) => ({ 'move.path': (q: PendingDecision) => ({ type: 'move.path' as const, seat: q.seat, decisionId: q.id, payload: { waypoints: [{ x, z }] } }) })

/** Put the Kasrkin with this datacard and a Boy face to face (a melee), or at a distance in the open. */
export function facing(s: GameState, a: string, b: string, gapX = 1.4): GameState {
  return place(place(s, a, 0, 0), b, gapX, 0)
}

/** Add timed effects the hooks read (a strategy ploy in force, a skill): `expires` defaults to the turning point. */
export function withFx(s: GameState, ...list: { source: string; kind?: string; operativeId?: string; expires?: string; data?: Record<string, unknown> }[]): GameState {
  return edit(s, (st) => {
    list.forEach((e, i) => st.effects.push({ id: `ek${i}${st.effects.length}`, seat: 'A', kind: e.kind ?? 'ployFlag', expires: e.expires ?? 'turningPoint', source: e.source, ...(e.operativeId ? { operativeId: e.operativeId } : {}), ...(e.data ? { data: e.data } : {}) } as never))
  })
}

/** The team skills in force: one effect per skill (as Skill at Arms leaves them). */
export const withSkills = (s: GameState, ...skills: string[]): GameState =>
  withFx(s, ...skills.map((k) => ({ source: 'ks.p.skill-at-arms', kind: 'ks.skill', expires: 'turningPointStart', data: { skill: k } })))

/** One Shoot by `who` with `weaponId` at `targetId`, all dice scripted; returns the state at the next action decision. */
export function shootAt(s: GameState, who: string, weaponId: string, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}, order: 'engage' | 'conceal' = 'engage'): Played {
  let t = take(activateOp(s, who, order, rng), 'shoot', rng).state
  t = take(t, weaponId, rng).state
  t = take(t, targetId, rng).state
  return play(t, rng, answers)
}

/** The next Shoot of an activation already under way (the operative waits at firefight.action). */
export function shootAgain(s: GameState, weaponId: string, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}): Played {
  let t = take(s, 'shoot', rng).state
  t = take(t, weaponId, rng).state
  t = take(t, targetId, rng).state
  return play(t, rng, answers)
}

/** Turning point 2's gambit step: use Relocate with this first pick through its real offer (the decision's own options are fixed at turning point 1). */
export function useRelocate(first: string): GameState {
  const g = edit(toGambit(), (st) => {
    st.turningPoint = 2
    st.players.A.cp = 3
  })
  const o = offersFor(g, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).find((x) => x.ployId === 'ks.p.relocate' && x.param === first)
  if (!o) throw new Error('Relocate is not on offer')
  return withCtx(g, (ctx) => usePloy(ctx, 'A', o, { window: 'strategy.gambit' })).state
}

export const scenarios: Record<string, () => void> = {
  ksConcealedPosition() {
    const s = open()
    const sh = A(s, 'sharpshooter')
    const boy = B(s, 'boy')
    const t = place(place(s, sh, 0, 0), boy, 8, 0)
    // the first Shoot of the battle: the concealed profile is on offer; afterwards it is not
    const after = shootAt(t, sh, 'ks.w.hot-shot-marksman-rifle-mobile', boy, dice(1, 1, 1, 1, 1, 1, 1, 1), {}, 'engage').state
    usableRangedWeapons(after, after.operatives[sh]!, [])
  },
  ksTacticalCommand() {
    const s = open()
    const sg = A(s, 'sergeant')
    const t = activateOp(s, sg)
    take(take(t, `ability:ks.a.tactical-command:${A(s, 'trooper')}`).state, 'light-em-up')
  },
  ksSkillAtArms() {
    take(toGambit(), 'ks.p.skill-at-arms:ice-in-your-veins+for-cadia')
  },
  ksVeteranLeadership() {
    take(toGambit(), 'ks.p.skill-at-arms:light-em-up+strike-fast')
  },
  ksMedic() {
    const s = open()
    const medic = A(s, 'combat-medic')
    const tr = A(s, 'trooper')
    const t = edit(place(place(s, medic, 0, 0), tr, 2, 0), (st) => {
      st.operatives[tr]!.wounds = 2
    })
    // the casualty waits in the deferred removal queue; the Kasrkin player takes the save
    const asked = withCtx(t, (ctx) => {
      directDamage(ctx, tr, 5, B(s, 'boy'), 'test')
      runDeferredRemovals(ctx)
    }).state
    take(asked, 'save')
  },
  ksMedikit() {
    const s = open()
    const medic = A(s, 'combat-medic')
    const sg = A(s, 'sergeant')
    const t = edit(place(place(s, medic, 0, 0), sg, 1.3, 0), (st) => {
      st.operatives[sg]!.wounds = 3
    })
    take(activateOp(t, medic), `ability:ks.a.medikit:${sg}`, dice(6, 6))
  },
  ksMeltaMine() {
    open()
  },
  ksProximityMine() {
    const s = open()
    const boy = B(s, 'boy')
    const mine = s.markers.find((m) => m.equipmentId === 'ks.meltaMine')!
    const t = edit(place(place(s, A(s, 'sergeant'), -6, 9), boy, 9, 0), (st) => {
      const m = st.markers.find((k) => k.id === mine.id)!
      m.carriedBy = null
      m.pos = { x: 5, z: 0 }
      st.operatives[A(s, 'demo-trooper')]!.flags.carrying = null
    })
    play(take(activateOp(bTurn(t, A(s, 'sergeant')), boy), 'reposition', dice(4, 4, 4, 4)).state, dice(4, 4), goTo(6.2, 0))
  },
  ksBlastPadding() {
    const s = open()
    const demo = A(s, 'demo-trooper')
    const boy = B(s, 'boy')
    defenceStats(s, demo, boy, 'kom.w.burna-standard', parseRules(s.data.weapons['kom.w.burna-standard']!.rules), false)
    withCtx(s, (ctx) => {
      inflict(ctx, { targetId: demo, attackerId: boy, weaponId: 'kom.w.burna-standard', amount: 4, source: 'devastating', splash: true })
    })
  },
  ksReconnoitre() {
    useRelocate(A(toGambit(), 'recon-trooper'))
  },
  ksAuspexScan() {
    const s = open()
    const rt = A(s, 'recon-trooper')
    const boy = B(s, 'boy')
    const t = take(activateOp(place(place(s, rt, 0, 0), boy, 6, 0), rt), `ability:ks.a.auspex-scan`).state
    // a scanned enemy cannot be obscured against a Kasrkin shooter
    effectiveRules(t, t.operatives[rt]!, t.data.weapons['ks.w.hot-shot-lasgun']!, 'shoot', boy)
    runHook('target.status', { seat: 'A', state: t, operativeId: A(s, 'trooper'), targetId: boy, data: { obscured: true, inCover: false } })
  },
  ksCamoCloak() {
    const s = open()
    const sh = A(s, 'sharpshooter')
    const boy = B(s, 'boy')
    effectiveRules(place(place(s, sh, 0, 0), boy, 4, 0), s.operatives[boy]!, s.data.weapons['kom.w.burna-standard']!, 'shoot', sh)
  },
  ksAdaptiveEquipment() {
    const s = open()
    const tr = A(s, 'trooper')
    take(activateOp(place(place(s, tr, 0, 0), B(s, 'boy'), 6, 0), tr), 'ability:core.a.smoke-grenade')
  },
  ksBattleComms() {
    const s = open()
    const vox = A(s, 'vox-trooper')
    take(activateOp(s, vox), `ability:ks.a.battle-comms:${A(s, 'trooper')}`)
  },
  ksRapidFire() {
    const s = open()
    const tr = A(s, 'trooper')
    const t = edit(activateOp(s, tr), (st) => {
      st.firefight.activation!.performed = ['shoot']
      st.firefight.activation!.weaponsUsed = ['ks.w.hot-shot-lasgun']
    })
    maxRepeats(t, t.operatives[tr]!, 'shoot', ['shoot'])
  },
  ksLightEmUp() {
    const s = withSkills(open(), 'light-em-up')
    const tr = A(s, 'trooper')
    const boy = B(s, 'boy')
    effectiveRules(place(place(s, tr, 0, 0), boy, 5, 0), s.operatives[tr]!, s.data.weapons['ks.w.hot-shot-lasgun']!, 'shoot', boy)
  },
  ksStrikeFast() {
    const s = withSkills(open(), 'strike-fast')
    const tr = A(s, 'trooper')
    take(activateOp(s, tr), 'reposition')
    effectiveMove(s.operatives[tr]!, s)
  },
  ksIceInYourVeins() {
    const s = withSkills(open(), 'ice-in-your-veins')
    const tr = A(s, 'trooper')
    const boy = B(s, 'boy')
    withCtx(place(place(s, tr, 0, 0), boy, 4, 0), (ctx) => {
      ctx.state.attack = { kind: 'shoot', stage: 'resolve', operativeId: boy, seat: 'B', weaponId: 'kom.w.slugga', pointBlank: false, targets: [tr], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] }
      inflict(ctx, { targetId: tr, attackerId: boy, weaponId: 'kom.w.slugga', amount: 3, source: 'normal' })
    })
  },
  ksForCadia() {
    const s = withSkills(open(), 'for-cadia')
    const tr = A(s, 'trooper')
    const boy = B(s, 'boy')
    const t = edit(facing(s, tr, boy), (st) => {
      st.operatives[boy]!.wounds = 40
      st.operatives[boy]!.maxWounds = 40
    })
    const f = take(take(activateOp(t, tr), 'fight').state, boy, dice(6, 6, 6, 6, 1, 1, 1, 1)).state
    play(f, dice(), strikes)
  },
  ksForegrip() {
    const s = open({ equipmentA: ['ks.e.foregrip'] })
    const tr = A(s, 'trooper')
    const boy = B(s, 'boy')
    effectiveRules(place(place(s, tr, 0, 0), boy, 2.5, 0), s.operatives[tr]!, s.data.weapons['ks.w.hot-shot-lasgun']!, 'shoot', boy)
  },
  ksLongRangeScope() {
    const s = open({ equipmentA: ['ks.e.long-range-scope'] })
    const tr = A(s, 'trooper')
    const boy = B(s, 'boy')
    const t = take(take(activateOp(place(place(s, tr, 0, 0), boy, 9, 0), tr), 'shoot').state, 'ks.w.hot-shot-lasgun').state
    play(take(t, boy, dice(6, 3, 3, 3, 1, 1, 1, 1)).state, dice(1, 1, 1), {})
  },
  ksRelicsOfCadia() {
    const s = open({ equipmentA: ['ks.e.relics-of-cadia'] })
    const tr = A(s, 'trooper')
    const boy = B(s, 'boy')
    const t = take(take(activateOp(place(place(s, tr, 0, 0), boy, 5, 0), tr), 'shoot').state, 'ks.w.hot-shot-lasgun').state
    play(take(t, boy, dice(1, 1, 3, 3)).state, dice(1, 1, 1), takePloy('ks.e.relics-of-cadia'))
  },
  ksFlagPloy() {
    take(toGambit(), 'ks.p.elimination-pattern')
  },
  ksClearanceSweep() {
    const g = toGambit()
    take(g, g.pending!.options!.find((o) => o.id.startsWith('ks.p.clearance-sweep:'))!.id)
  },
  ksRelocate() {
    useRelocate(A(toGambit(), 'trooper'))
  },
  ksSeizeInitiative() {
    const s = toSeize()
    take(s, s.pending!.options!.find((o) => o.id.startsWith('ks.p.seize-the-initiative'))!.id)
  },
  ksCoverRetreat() {
    const s = open()
    const t1 = A(s, 'trooper')
    const sg = A(s, 'sergeant')
    const boy = B(s, 'boy')
    const t = place(place(place(s, t1, 0, 0), boy, 1.4, 0), sg, -3, 0)
    const f = take(activateOp(t, t1), 'fallBack').state
    play(f, dice(), { ...goTo(-3, 3), ...takePloy(`ks.p.cover-retreat:${sg}`) })
  },
  ksNeutraliseTarget() {
    const s = open()
    const tr = A(s, 'trooper')
    const boy = B(s, 'boy')
    const t = take(take(activateOp(place(place(s, tr, 0, 0), boy, 5, 0), tr), 'shoot').state, 'ks.w.hot-shot-lasgun').state
    play(take(t, boy, dice(1, 1, 1, 1)).state, dice(6, 6, 6, 6, 1, 1, 1), takePloy('ks.p.neutralise-target'))
  },
  ksGiveNoGround() {
    const s = open()
    const m = s.markers.find((k) => k.kind === 'objective')!
    const tr = A(s, 'trooper')
    const t = place(place(s, tr, m.pos.x + 0.9, m.pos.z), B(s, 'boy'), m.pos.x - 0.9, m.pos.z)
    let u = take(t, tr).state
    u = take(u, 'engage').state
    take(u, `ks.p.give-no-ground:${m.id}`)
  },
}
