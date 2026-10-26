// warpcoven code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the data
// names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/warpcoven.test.ts.
import { createGame, step } from '@/engine'
import { act } from '@/engine/actions'
import { effectiveRules, inflict } from '@/engine/attack-common'
import { runHook } from '@/engine/hooks'
import { providerBlockCapacity, providerControlApl, providerMarkerActionRelief } from '@/engine/team-rules'
import { usePloy, type PloyOffer } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { effectiveMove } from '@/engine/state'
import type { AttackState, DecisionKind, GameState, PendingDecision, RosterEntry } from '@/engine/types'
import { play } from '../../fixtures/attack'
import { drive, place } from '../../fixtures/helpers'
import { activateOp, edit, openReal, opOf, realBundle, realSetupWith, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['warpcoven', 'kommandos'] as [string, string] }

/** Open ground, every operative parked in its corner; A (Warpcoven) is to activate. */
export const open = (o: Parameters<typeof openReal>[0] = {}): GameState => openReal({ ...MATCH, ...o })
export const A = (s: GameState, card: string): string => opOf(s, 'A', `wc.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** One roster entry: the datacard, its weapons (default: the first legal loadout), and the boon / bombard picks. */
export type Spec = { id: string; weapons?: string[]; boon?: string; bombard?: string }

const SORCERERS = ['wc.sorcerer-of-destiny', 'wc.sorcerer-of-tempyrion', 'wc.sorcerer-of-warpfire']

const BOON_POOL = ['TIME-WALK', 'WARP SWELL', 'TWIST OF FATE', 'INCORPOREAL SIGHT', 'ECHOES FROM THE WARP', 'MUTANT APPENDAGE', 'IMMATERIAL FLIGHT', 'ASTRAL BOMBARDMENT', 'MASTER OF THE IMMATERIUM']

export function wcRoster(specs: Spec[]): RosterEntry[] {
  // Sorcerers without a boon take the first pool boons nobody asked for, so every roster is legal
  const free = BOON_POOL.filter((b) => !specs.some((sp) => sp.boon === b))
  return specs.map((sp) => {
    const base = realBundle.datacards[sp.id]!
    const weaponIds = sp.weapons ?? [...(base.legalLoadouts?.[0] ?? [])]
    const picks: Record<string, string> = {}
    if (sp.boon) picks.boon = sp.boon
    else if (SORCERERS.includes(sp.id)) picks.boon = free.shift()!
    if (sp.bombard) picks.bombard = sp.bombard
    return { datacardId: sp.id, loadout: { weaponIds }, ...(Object.keys(picks).length > 0 ? { picks } : {}) }
  })
}

/** The standard test roster: Destiny, Tempyrion, Warpfire, a Rubric Warrior and a Tzaangor Champion. */
export const STD: Spec[] = [
  { id: 'wc.sorcerer-of-destiny' },
  { id: 'wc.sorcerer-of-tempyrion' },
  { id: 'wc.sorcerer-of-warpfire' },
  { id: 'wc.rubric-marine-warrior' },
  { id: 'wc.tzaangor-champion', weapons: ['wc.w.greataxe'] },
]

/** A forced dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(120).fill(1)])

export function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'wc-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
}

/** Use a ploy through the engine with a hand-made offer (the window itself is not what the scenario is about). */
export function usePlayed(s: GameState, ployId: string, info: Record<string, unknown>, param?: string, seat: 'A' | 'B' = 'A'): GameState {
  const ploy = s.data.ploys![ployId]!
  const offer: PloyOffer = { id: ployId, ployId, name: ploy.name, cost: ploy.cost, seed: param ? { param } : {}, ...(param ? { param } : {}) }
  return withCtx(s, (ctx) => usePloy(ctx, seat, offer, { window: 'x', ...info })).state
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

/** Put a melee between two operatives, ready to be declared. */
export function engaged(s: GameState, a: string, b: string, gapX = 1.4): GameState {
  return place(place(s, a, 0, 0), b, gapX, 0)
}

/** The option id of a unique action (with its target) offered to the activated operative. */
export function actionId(s: GameState, prefix: string): string {
  const o = s.pending!.options!.find((x) => x.id.startsWith(prefix))
  if (!o) throw new Error(`no option ${prefix} in ${s.pending!.options!.map((x) => x.id).join(', ')}`)
  return o.id
}

export const scenarios: Record<string, () => void> = {
  boonsOfTzeentch() {
    const s = open({ rosterA: wcRoster(STD) })
    effectiveMove(s.operatives[A(s, 'sorcerer-of-destiny')]!, s)
  },
  wcSorcerousAutomata() {
    const s = open({ rosterA: wcRoster(STD) })
    const w = A(s, 'rubric-marine-warrior')
    activateOp(place(s, w, 3, 4), w)
  },
  wcIconBearer() {
    const s = open({ rosterA: wcRoster([...STD.slice(0, 3), { id: 'wc.rubric-marine-icon-bearer' }, { id: 'wc.rubric-marine-warrior' }]) })
    const m = s.markers.find((k) => k.kind === 'objective')!
    providerControlApl(s, s.operatives[A(s, 'rubric-marine-icon-bearer')]!, m, 3)
  },
  slowAndPurposeful() {
    const s = open({ rosterA: wcRoster(STD) })
    const w = A(s, 'rubric-marine-warrior')
    effectiveRules(s, s.operatives[w]!, s.data.weapons['wc.w.inferno-boltgun']!, 'shoot', B(s, 'boy'))
  },
  savageBrutality() {
    const s = open({ rosterA: wcRoster(STD) })
    const champ = A(s, 'tzaangor-champion')
    const boy = B(s, 'boy')
    const t = engaged(s, champ, boy)
    const f = take(take(activateOp(t, champ), 'fight').state, boy, dice()).state
    play(f, dice(), { ...strikes, 'ability.choice': (p) => p.options?.find((o) => o.data?.hook === 'savageBrutality')?.action ?? act.pass(p) })
  },
  herdBanner() {
    const s = open({ rosterA: wcRoster([...STD.slice(0, 3), { id: 'wc.tzaangor-icon-bearer' }, { id: 'wc.tzaangor-warrior' }]) })
    const w = A(s, 'tzaangor-warrior')
    withCtx(place(place(s, A(s, 'tzaangor-icon-bearer'), 0, 0), w, 1.2, 0), (ctx) => {
      inflict(ctx, { targetId: w, attackerId: B(s, 'boy'), weaponId: 'kom.w.slugga', amount: 3, source: 'normal' })
    })
  },
  relicHunters() {
    // set-up already fired the hook (the blade & shield Warrior's Save); the cost change is read through the provider
    open({ rosterA: wcRoster([...STD.slice(0, 3), { id: 'wc.tzaangor-warrior', weapons: ['wc.w.tzaangor-blade-and-shield'] }, { id: 'wc.tzaangor-icon-bearer' }]) })
  },
  wcShield() {
    const s = open({ rosterA: wcRoster([...STD.slice(0, 3), { id: 'wc.tzaangor-warrior', weapons: ['wc.w.tzaangor-blade-and-shield'] }, { id: 'wc.tzaangor-icon-bearer' }]) })
    const w = A(s, 'tzaangor-warrior')
    const attack = { kind: 'fight', operativeId: w, seq: { atk: { seat: 'A', weaponId: 'wc.w.tzaangor-blade-and-shield' }, def: null } } as unknown as AttackState
    providerBlockCapacity(s, attack, 'A', 0)
  },
  wcMindburn() {
    const s = open({ rosterA: wcRoster(STD) })
    const lock = A(s, 'sorcerer-of-warpfire')
    const boy = B(s, 'boy')
    withCtx(s, (ctx) => {
      runHook('damage.inflicted', { seat: 'B', state: ctx.state, engine: ctx, operativeId: boy, targetId: lock, weaponId: 'wc.w.mindburn', data: { source: 'crit', attackerId: lock, weaponId: 'wc.w.mindburn', amount: 1, woundsBefore: 5, woundsAfter: 4 } })
    })
  },
  daemonmawWeapons() {
    const s = open({ rosterA: wcRoster(STD), equipmentA: ['wc.e.daemonmaw-weapons'] })
    const w = A(s, 'rubric-marine-warrior')
    effectiveRules(place(place(s, w, 0, 0), B(s, 'boy'), 1.2, 0), s.operatives[w]!, s.data.weapons['wc.w.fists']!, 'fight', B(s, 'boy'))
    withCtx(s, (ctx) => {
      runHook('modifyAttackDice', { seat: 'A', state: ctx.state, engine: ctx, operativeId: w, targetId: B(s, 'boy'), weaponId: 'wc.w.fists', data: { kind: 'fight', atk: 3, hitDelta: 0, accurate: [], lethal: null, rerolls: [], assists: [] } })
    })
  },
  arcaneRobes() {
    const s = open({ rosterA: wcRoster(STD), equipmentA: ['wc.e.arcane-robes'] })
    withCtx(s, (ctx) => {
      inflict(ctx, { targetId: A(s, 'sorcerer-of-destiny'), attackerId: B(s, 'boy'), weaponId: 'kom.w.choppa', amount: 5, source: 'strike-crit' })
    })
  },
  sorcerousScrolls() {
    const s = open({ rosterA: wcRoster(STD), equipmentA: ['wc.e.sorcerous-scrolls'] })
    const so = A(s, 'sorcerer-of-destiny')
    take(take(take(s, so).state, 'engage').state, 'wc.e.sorcerous-scrolls:ECHOES FROM THE WARP')
  },
  protectedByFate() {
    const s = open({ rosterA: wcRoster(STD) })
    const so = A(s, 'sorcerer-of-destiny')
    const t = activateOp(place(s, so, 0, 0), so)
    take(t, actionId(t, `ability:wc.a.protected-by-fate:${so}`))
  },
  ravageDestiny() {
    const s = open({ rosterA: wcRoster(STD) })
    const so = A(s, 'sorcerer-of-destiny')
    const t = activateOp(place(place(s, so, 0, 0), B(s, 'boy'), 6, 0), so)
    take(t, actionId(t, `ability:wc.a.ravage-destiny:${B(s, 'boy')}`))
  },
  alight() {
    const s = open({ rosterA: wcRoster(STD) })
    const so = A(s, 'sorcerer-of-warpfire')
    const t = activateOp(place(place(s, so, 0, 0), B(s, 'boy'), 8, 0), so)
    take(t, actionId(t, `ability:wc.a.alight:${B(s, 'boy')}`))
  },
  reconstitutionRitual() {
    const s = open({ rosterA: wcRoster(STD) })
    const so = A(s, 'sorcerer-of-tempyrion')
    const hurt = edit(place(s, so, 0, 0), (st) => {
      st.operatives[so]!.wounds = 5
    })
    const t = activateOp(hurt, so)
    take(t, actionId(t, `ability:wc.a.reconstitution-ritual:${so}`), dice(4, 4))
  },
  temporalFlux() {
    const s = open({ rosterA: wcRoster(STD) })
    const so = A(s, 'sorcerer-of-tempyrion')
    const t = activateOp(place(s, so, 0, 0), so)
    take(t, actionId(t, `ability:wc.a.temporal-flux:${so}@`))
  },
  brayhorn() {
    const s = open({ rosterA: wcRoster([...STD.slice(0, 3), { id: 'wc.tzaangor-horn-bearer' }, { id: 'wc.tzaangor-warrior' }]) })
    const h = A(s, 'tzaangor-horn-bearer')
    const t = activateOp(place(s, h, 0, 0), h)
    take(t, 'ability:wc.a.brayhorn')
  },
  wcFlagPloy() {
    take(toGambit({ rosterA: wcRoster(STD) }), 'wc.p.aetherial-warding')
  },
  fateItselfIsMyWeapon() {
    take(toGambit({ rosterA: wcRoster(STD) }), 'wc.p.fate-itself-is-my-weapon', dice(5, 5))
  },
  allIsDust() {
    const s = open({ rosterA: wcRoster(STD) })
    const w = A(s, 'rubric-marine-warrior')
    const boy = B(s, 'boy')
    const t = edit(engaged(s, w, boy), (st) => {
      st.operatives[boy]!.order = 'engage'
    })
    const f = take(take(activateOp(bTurnOf(t), boy), 'fight').state, w, dice(4, 4, 4, 4, 1, 1, 1, 1)).state
    play(f, dice(), { ...strikes, ...takePloy('wc.p.all-is-dust') })
  },
  capriciousPlan() {
    const s = open({ rosterA: wcRoster(STD) })
    const so = A(s, 'sorcerer-of-destiny')
    const t = take(activateOp(place(s, so, 0, 0), so), 'end').state
    take(t, 'wc.p.capricious-plan:order')
  },
  psychicCabal() {
    const s = open({ rosterA: wcRoster(STD) })
    const a = A(s, 'sorcerer-of-destiny')
    const b = A(s, 'sorcerer-of-tempyrion')
    const t = take(take(place(place(s, a, 0, 0), b, 4, 0), b).state, 'engage').state
    take(t, `wc.p.psychic-cabal:${a}:w:wc.w.doombolt`)
  },
  mutantHerd() {
    const s = open({ rosterA: wcRoster([...STD.slice(0, 3), { id: 'wc.tzaangor-champion', weapons: ['wc.w.greataxe'] }, { id: 'wc.tzaangor-warrior' }]) })
    const a = A(s, 'tzaangor-champion')
    const b = A(s, 'tzaangor-warrior')
    take(take(take(place(place(s, a, 0, 0), b, 1.5, 0), a).state, 'engage').state, `wc.p.mutant-herd:${b}:engage`)
  },
}

/** B is to activate: A's first ready operative ends at once (kept private to the scenarios). */
function bTurnOf(s: GameState): GameState {
  const first = Object.values(s.operatives).find((o) => o.seat === 'A' && o.ready)!
  return bTurn(s, first.id)
}

void providerMarkerActionRelief

/** Everyone on A has activated and ended while B still has ready operatives: A is offered counteract options. */
export function toCounteract(s: GameState): GameState {
  let t = s
  const mine = Object.values(s.operatives).filter((o) => o.seat === 'A').map((o) => o.id)
  const theirs = Object.values(s.operatives).filter((o) => o.seat === 'B').map((o) => o.id)
  for (let i = 0; i < mine.length; i++) {
    t = take(activateOp(t, mine[i]!), 'end').state
    t = take(activateOp(t, theirs[i]!), 'end').state
  }
  return t
}

/** Answer the pending move.path decision (optionally as a FLY set-up). */
export function movePath(s: GameState, x: number, z: number, fly = false, rng?: ScriptedRng) {
  const p = s.pending!
  return step(s, { type: 'move.path', seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x, z }], ...(fly ? { fly: true } : {}) } }, rng)
}
