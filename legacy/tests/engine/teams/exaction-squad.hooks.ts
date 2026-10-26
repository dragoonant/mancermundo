// exaction-squad code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/exaction-squad.test.ts.
import { createGame } from '@/engine'
import { act } from '@/engine/actions'
import { actionForbidden } from '@/engine/abilities'
import { applyAplEffect, attackStats, effectiveRules, inflict, runDeferredRemovals, validTargets } from '@/engine/attack-common'
import { directDamage } from '@/engine/effects'
import { providerCostDelta } from '@/engine/team-rules'
import { usableRangedWeapons } from '@/engine/shoot'
import { usePloy, type PloyOffer } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import type { DecisionKind, GameState, PendingDecision, RosterEntry } from '@/engine/types'
import { DEFAULT_STOP, play, type Played } from '../../fixtures/attack'
import { drive, place } from '../../fixtures/helpers'
import { activateOp, edit, openReal, opOf, passIt, realBundle, realSetupWith, roster, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['exaction-squad', 'kommandos'] as [string, string] }

/** Every card once (no Gunner): the Proctor plus the ten single-copy cards. */
export const ALL = ['ex.proctor-exactant', 'ex.castigator', 'ex.chirurgant', 'ex.leashmaster', 'ex.cyber-mastiff', 'ex.malocator', 'ex.marksman', 'ex.revelatum', 'ex.subductor', 'ex.vigilant', 'ex.vox-signifier']

export const exRoster = (ids: string[] = ALL): RosterEntry[] => roster(ids)

/** Open ground, every operative parked in its corner; A (Exaction Squad) is to activate. */
export function open(o: Parameters<typeof openReal>[0] = {}): GameState {
  return openReal({ ...MATCH, rosterA: exRoster(), ...o })
}
export const A = (s: GameState, card: string): string => opOf(s, 'A', `ex.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A forced dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(160).fill(1)])

/** The Strategy phase of turning point 1 at A's first gambit decision. */
export function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, rosterA: exRoster(), ...o }), 'ex-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 1200, new ScriptedRng([6, 1, 6, 1]))
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

/** Stop at the next ploy window (or the next real choice). */
export const STOP_PLOY: DecisionKind[] = ['ploy.firefight', 'firefight.action', 'firefight.activate', 'firefight.order']

/** Answer a ploy window with the option of that id, anything else with a pass. */
export const takePloy = (id: string) => ({ 'ploy.firefight': (p: PendingDecision) => p.options?.find((o) => o.id === id)?.action ?? act.pass(p) })

/** Answer a fight's strike or block choices by striking with the first die offered. */
export const strikes = { 'fight.resolve': (p: PendingDecision) => p.options?.find((o) => o.id.startsWith('strike'))?.action ?? p.options![0]!.action }

/** Answer a move decision with one waypoint. */
export const goTo = (x: number, z: number) => ({ 'move.path': (q: PendingDecision) => ({ type: 'move.path' as const, seat: q.seat, decisionId: q.id, payload: { waypoints: [{ x, z }] } }) })

/** Put an Exaction operative and a Kommando face to face (a melee), or at a distance in the open. */
export function facing(s: GameState, a: string, b: string, gapX = 1.4): GameState {
  return place(place(s, a, 0, 0), b, gapX, 0)
}

/** Add timed effects the hooks read (a strategy ploy in force, a mark): `expires` defaults to the turning point. */
export function withFx(s: GameState, ...list: { source: string; kind?: string; operativeId?: string; expires?: string; seat?: 'A' | 'B'; data?: Record<string, unknown> }[]): GameState {
  return edit(s, (st) => {
    list.forEach((e, i) => st.effects.push({ id: `ek${i}${st.effects.length}`, seat: e.seat ?? 'A', kind: e.kind ?? 'ployFlag', expires: e.expires ?? 'turningPoint', source: e.source, ...(e.operativeId ? { operativeId: e.operativeId } : {}), ...(e.data ? { data: e.data } : {}) } as never))
  })
}

/** A strategy ploy of the team in force this turning point. */
export const withPloy = (s: GameState, ployId: string, seat: 'A' | 'B' = 'A'): GameState => withFx(s, { source: ployId, seat })

/** Ploy windows are declined unless a test answers them. */
export const PASS_PLOYS = { 'ploy.firefight': (p: PendingDecision) => act.pass(p) }

/** Pass every ploy window that is open (Long Arm and the like are offered at the declaration). */
export function passPloys(s: GameState, rng?: ScriptedRng): GameState {
  let t = s
  while (t.pending?.kind === 'ploy.firefight') t = passIt(t, rng).state
  return t
}

/** One Shoot by `who` with `weaponId` at `targetId`, all dice scripted; returns the state at the next action decision. */
export function shootAt(s: GameState, who: string, weaponId: string, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}, order: 'engage' | 'conceal' = 'engage', stop: DecisionKind[] = DEFAULT_STOP): Played {
  let t = passPloys(take(activateOp(s, who, order, rng), 'shoot', rng).state, rng)
  t = take(t, weaponId, rng).state
  t = take(t, targetId, rng).state
  return play(t, rng, { ...PASS_PLOYS, ...answers }, stop)
}

/** The next Shoot of an activation already under way (the operative waits at firefight.action). */
export function shootAgain(s: GameState, weaponId: string, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}, stop: DecisionKind[] = DEFAULT_STOP): Played {
  let t = passPloys(take(s, 'shoot', rng).state, rng)
  t = take(t, weaponId, rng).state
  t = take(t, targetId, rng).state
  return play(t, rng, { ...PASS_PLOYS, ...answers }, stop)
}

/** The stat-line seen through the same hooks the dice use: the weapon's rules as the shooter or fighter has them. */
export function rulesOf(s: GameState, who: string, weaponId: string, kind: 'shoot' | 'fight', targetId?: string): string[] {
  const op = s.operatives[who]!
  return effectiveRules(s, op, s.data.weapons[weaponId]!, kind, targetId).map((r) => `${r.rule.replace(/^core\.wr\./, '')}${r.x ? ` ${r.x}` : ''}${r.target ? ` ${r.target}+` : ''}${r.inches ? ` ${r.inches}` : ''}`)
}

/** Stop at reaction choices too (the new mark, Exact Punishment, Medic!'s Dash). */
export const WITH_CHOICES: DecisionKind[] = [...DEFAULT_STOP, 'ability.choice']

/** The Exaction player holding a spare command point or two. */
export const withCp = (s: GameState, cp = 3): GameState => edit(s, (st) => void (st.players.A.cp = cp))

const optionIdsOf = (s: GameState): string[] => (s.pending?.options ?? []).map((o) => o.id)

export const scenarios: Record<string, () => void> = {
  exRepress() {
    const s = open()
    const sub = A(s, 'subductor')
    const boy = B(s, 'boy')
    const rng = dice(6, 1, 1, 1, 4, 4, 1, 1)
    play(take(take(activateOp(facing(s, sub, boy), sub, 'engage', rng), 'fight', rng).state, boy, rng).state, rng, PASS_PLOYS, ['fight.resolve'])
  },
  exConcealedPosition() {
    const s = open()
    const mk = A(s, 'marksman')
    const boy = B(s, 'boy')
    const ground = edit(place(place(s, mk, 0, 0), boy, 9, 0), (st) => void (st.operatives[mk]!.order = 'engage'))
    const fired = shootAt(ground, mk, 'ex.w.executioner-shotgun-mobile', boy, dice(1, 1, 1, 1, 1, 1, 1)).state
    usableRangedWeapons(fired, fired.operatives[mk]!, ['shoot'])
  },
  exAssaultShield() {
    const maulSet = [{ datacardId: 'ex.proctor-exactant', loadout: { weaponIds: ['ex.w.shotpistol-proctor', 'ex.w.dominator-maul-assault-shield'] } }, ...exRoster(ALL.slice(1))]
    open({ rosterA: maulSet })
  },
  exNuncioAquila() {
    const s = edit(open(), (st) => void (st.turningPoint = 2))
    const obj = s.markers.find((m) => m.kind === 'objective')!
    const boy = B(s, 'boy')
    const near = edit(place(s, boy, obj.pos.x - 1.2, obj.pos.z), (st) => void st.markers.push({ id: 'exnun9', kind: 'equipment', pos: { x: obj.pos.x, z: obj.pos.z }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'ex.nuncio' }))
    providerCostDelta(near, near.operatives[boy]!, 'ability:core.a.secure')
  },
  exDeployNuncio() {
    const s = open()
    const pick = take(activateOp(s, A(s, 'proctor-exactant')), 'ability:ex.a.deploy-nuncio-aquila').state
    take(pick, pick.pending!.options![0]!.id)
  },
  exMedic() {
    const s = open()
    const med = A(s, 'chirurgant')
    const vig = A(s, 'vigilant')
    const t = edit(place(place(s, med, 0, 0), vig, 2, 0), (st) => void (st.operatives[vig]!.wounds = 2))
    // rule damage outside an attack: the removal waits and the owner uses Medic!
    const asked = withCtx(t, (ctx) => {
      directDamage(ctx, vig, 5, B(s, 'boy'), 'test.rule')
      runDeferredRemovals(ctx)
    }).state
    take(asked, 'use')
  },
  exMedikit() {
    const s = open()
    const med = A(s, 'chirurgant')
    const sub = A(s, 'subductor')
    const t = edit(place(place(s, med, 0, 0), sub, 1.3, 0), (st) => void (st.operatives[sub]!.wounds = 3))
    take(activateOp(t, med), `ability:ex.a.medikit:${sub}`, dice(2, 2))
  },
  exHandler() {
    const s0 = open()
    const leash = A(s0, 'leashmaster')
    const dog = A(s0, 'cyber-mastiff')
    const s = place(place(s0, leash, 0, 0), dog, 2.5, 2.5)
    take(take(take(s, leash).state, 'engage').state, `ex.x.handler:${dog}:engage`)
  },
  exAttackPattern() {
    take(toGambit(), 'ex.p.attack-pattern:aggressive+swift')
  },
  exCommand() {
    const s = usePlayed(open(), 'ex.p.attack-pattern', {}, 'swift+defensive')
    take(activateOp(s, A(s, 'leashmaster')), `ability:ex.a.r-vr-command:${A(s, 'cyber-mastiff')}:swift`)
  },
  exBeast() {
    const s = open()
    actionForbidden(s, s.operatives[A(s, 'cyber-mastiff')]!, 'shoot')
  },
  exApprehend() {
    const s = open()
    const dog = A(s, 'cyber-mastiff')
    const boy = B(s, 'boy')
    take(activateOp(place(place(s, dog, 0, 0), boy, 1.4, 0), dog), `ability:ex.a.apprehend:${boy}`)
  },
  exEngenderedFocus() {
    const s = open()
    const cas = A(s, 'castigator')
    const t = edit(s, (st) => void (st.operatives[cas]!.wounds = 3))
    attackStats(t, cas, 'ex.w.excruciator-maul', B(s, 'boy'), { kind: 'fight' })
  },
  exZealousDedication() {
    const s = open()
    withCtx(s, (ctx) => void inflict(ctx, { targetId: A(s, 'castigator'), attackerId: B(s, 'boy'), weaponId: 'kom.w.choppa', amount: 4, source: 'normal' }), dice(5))
  },
  exCastigatorsArrest() {
    const s = open()
    const t = place(place(s, A(s, 'castigator'), 0, 0), B(s, 'boy'), 1.4, 0)
    actionForbidden(t, t.operatives[B(s, 'boy')]!, 'fallBack')
  },
  exAcuteFocus() {
    const s = edit(open(), (st) => void (st.turningPoint = 2))
    const mal = A(s, 'malocator')
    const t = activateOp(s, mal)
    providerCostDelta(t, t.operatives[mal]!, 'ability:ex.a.veriscant')
  },
  exVeriscant() {
    const s = open()
    const mal = A(s, 'malocator')
    const boy = B(s, 'boy')
    take(activateOp(place(place(s, mal, 0, 0), boy, 6, 0), mal), `ability:ex.a.veriscant:${boy}`)
  },
  exOptics() {
    const s = open()
    const mk = A(s, 'marksman')
    take(activateOp(place(s, mk, 0, 0), mk), 'ability:ex.a.optics')
  },
  exFirstInTheField() {
    const g = toGambit()
    take(g, `ex.p.first-in-the-field:${A(g, 'revelatum')}`)
  },
  exSpot() {
    const s = open()
    const r = A(s, 'revelatum')
    const boy = B(s, 'boy')
    take(activateOp(place(place(s, r, 0, 0), boy, 7, 0), r), `ability:ex.a.spot:${boy}`)
  },
  exStubbornSubjugator() {
    const s = open()
    const sub = A(s, 'subductor')
    const t = edit(s, (st) => void (st.operatives[sub]!.wounds = 3))
    attackStats(t, sub, 'ex.w.shock-maul-assault-shield', B(s, 'boy'), { kind: 'fight' })
  },
  exCloseQuartersVigilance() {
    const s = open()
    const vig = A(s, 'vigilant')
    const t = edit(place(place(s, vig, 0, 0), B(s, 'boy'), 1.4, 0), (st) => void (st.operatives[vig]!.order = 'engage'))
    validTargets(t, t.operatives[vig]!, 'ex.w.combat-shotgun-close')
  },
  exSignal() {
    const s = open()
    const vox = A(s, 'vox-signifier')
    const vig = A(s, 'vigilant')
    take(activateOp(place(place(s, vox, 0, 0), vig, 3, 0), vox), `ability:ex.a.signal:${vig}`)
  },
  exRuthlessEfficiency() {
    const s = open()
    const vig = A(s, 'vigilant')
    const boy = B(s, 'boy')
    const t = edit(place(place(place(s, vig, 0, 0), A(s, 'subductor'), 3.6, 0), boy, 5, 0), (st) => void (st.operatives[vig]!.order = 'engage'))
    validTargets(t, t.operatives[vig]!, 'ex.w.combat-shotgun-long')
  },
  exMarkedForJustice() {
    const g = toGambit()
    take(g, `ex.p.marked-for-justice:${B(g, 'boy')}`)
  },
  exFlagPloy() {
    take(toGambit(), 'ex.p.dispense-justice')
  },
  exLongArm() {
    const base = open()
    const s = withCp(place(place(base, A(base, 'leashmaster'), 0, 0), B(base, 'boy'), 10, 0))
    take(take(activateOp(s, A(s, 'leashmaster')), 'shoot').state, 'ex.p.long-arm')
  },
  exExactPunishment() {
    const s0 = withCp(open())
    const vig = A(s0, 'vigilant')
    const boy = B(s0, 'boy')
    const field = place(place(s0, vig, 0, 0), boy, 5, 0)
    const rng = dice(1, 1, 1, 1, 1, 1, 1)
    let t = bTurn(field, A(field, 'proctor-exactant'))
    t = passPloys(take(activateOp(t, boy, 'engage', rng), 'shoot', rng).state, rng)
    t = take(take(t, 'kom.w.slugga', rng).state, vig, rng).state
    const r = play(t, rng, PASS_PLOYS, ['ability.choice', 'firefight.action', 'firefight.activate'])
    take(r.state, optionIdsOf(r.state)[0]!)
  },
  exBrutalBackup() {
    const s0 = withCp(open())
    const sub = A(s0, 'subductor')
    const vig = A(s0, 'vigilant')
    const boy = B(s0, 'boy')
    const field = place(place(place(s0, sub, 0, 0), boy, 1.4, 0), vig, 1.4, 1.4)
    const start = take(take(field, sub).state, 'engage').state
    take(start, `ex.p.brutal-backup:${boy}+${vig}`, dice(6, 6, 6, 1, 1, 1, 1, 1))
  },
  exExecutionOrder() {
    const s0 = edit(open(), (st) => {
      st.turningPoint = 2
      st.players.A.cp = 4
    })
    const boy = B(s0, 'boy')
    const obj = s0.markers.find((m) => m.kind === 'objective')!
    const onObjective = place(s0, boy, obj.pos.x - 1.2, obj.pos.z)
    const declared = take(activateOp(bTurn(onObjective, A(s0, 'vigilant')), boy), `ability:core.a.secure:${obj.id}`).state
    take(declared, `ex.p.execution-order:${boy}`)
  },
  exMirrorVisor() {
    const s = open({ equipmentA: ['ex.e.reinforced-mirror-visor'] })
    withCtx(s, (ctx) => void applyAplEffect(ctx, A(s, 'vigilant'), -1, 'stun'))
  },
  exManacles() {
    const s = edit(open({ equipmentA: ['ex.e.manacles'] }), (st) => void (st.players.A.cp = 2))
    const boy = B(s, 'boy')
    const pin = place(place(s, A(s, 'vigilant'), 0, 0), boy, 1.4, 0)
    const rng = dice(5)
    take(activateOp(bTurn(pin, A(pin, 'proctor-exactant')), boy, 'engage', rng), 'fallBack', rng)
  },
  exStrobing() {
    const s = open({ equipmentA: ['ex.e.strobing-phosphor-lumen'] })
    const vig = A(s, 'vigilant')
    const dakka = B(s, 'dakka-boy')
    attackStats(place(place(s, vig, 0, 0), dakka, 2.5, 0), dakka, 'kom.w.dakka-shoota-short', vig, { kind: 'shoot' })
  },
  exSpecialIssueShells() {
    const s0 = open({ equipmentA: ['ex.e.special-issue-shells'] })
    const vig = A(s0, 'vigilant')
    const boy = B(s0, 'boy')
    const field = withCp(place(place(s0, vig, 0, 0), boy, 5, 0))
    const t = take(take(passPloys(take(activateOp(field, vig), 'shoot').state), 'ex.w.combat-shotgun-close').state, boy).state
    take(t, 'ex.x.shells-saturate')
  },
}
