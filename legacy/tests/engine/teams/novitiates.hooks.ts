// novitiates code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/novitiates.test.ts.
import { act } from '@/engine/actions'
import type { GameEvent } from '@/engine/events'
import { effectiveRules, inflict, weaponDamage } from '@/engine/attack-common'
import { resolveLoadoutChoice } from '@/engine/bundle'
import { directDamage } from '@/engine/effects'
import { createGame, step } from '@/engine'
import { runHook } from '@/engine/hooks'
import { psychicAllowed, psychicSelectable } from '@/engine/psychic'
import { answerDecision, markerControl } from '@/engine/query'
import { ScriptedRng } from '@/engine/rng'
import { effectiveMove } from '@/engine/state'
import { poolOf } from '@/engine/pools'
import { FAITH } from '@/engine/teams/novitiates'
import type { Action, DecisionKind, GameState, PendingDecision, RosterEntry, Seat } from '@/engine/types'
import { play } from '../../fixtures/attack'
import { drive, place } from '../../fixtures/helpers'
import { offersFor, usePloy } from '@/engine/ploys'
import { activateOp, edit, inTp, openReal, opOf, passIt, realBundle, realSetupWith, roster, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['novitiates', 'kommandos'] as [string, string] }
const ALL_NV = ['nv.superior', 'nv.condemnor', 'nv.dialogus', 'nv.duellist', 'nv.exactor', 'nv.hospitaller', 'nv.militant', 'nv.penitent', 'nv.preceptor', 'nv.pronatus', 'nv.purgatus', 'nv.reliquarius']

/** A roster entry with a named loadout set (Superior, Militant). */
export function entry(id: string, setId: string): RosterEntry {
  return { datacardId: id, loadout: resolveLoadoutChoice(realBundle, id, { loadout: [setId] }) }
}

/** Every Novitiate datacard once (the Militant with the autogun), the way the tests like to pick operatives. */
export function nvRoster(): RosterEntry[] {
  return ALL_NV.map((id) => (id === 'nv.militant' ? entry(id, 'autogun-gun-butt') : roster([id])[0]!))
}

/** Novitiates (A, all twelve datacards) against the default Kommandos (B), open ground, A to activate. Equipment is opt-in. */
export const open = (o: Parameters<typeof openReal>[0] = {}): GameState => openReal({ ...MATCH, rosterA: nvRoster(), ...o })
export const A = (s: GameState, card: string): string => opOf(s, 'A', `nv.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A forced dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(160).fill(1)])

export const faith = (s: GameState, seat: Seat = 'A'): number => poolOf(s, seat, FAITH)
export const withFaith = (s: GameState, n: number, seat: Seat = 'A'): GameState =>
  edit(s, (st) => {
    st.players[seat].pools = { ...(st.players[seat].pools ?? {}), [FAITH]: n }
  })

export function toGambit(o: Parameters<typeof openReal>[0] = {}, tp = 1): GameState {
  const g = drive(createGame(realSetupWith({ ...MATCH, rosterA: nvRoster(), ...o }), 'nv-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
  return tp === 1 ? g : inTp(g, tp)
}

/** Stop at the next ploy window (or the next real choice). */
export const STOP_PLOY: DecisionKind[] = ['ploy.firefight', 'firefight.action', 'firefight.activate', 'firefight.order']

/** Play until the activation next waits for an action (or the next activation). */
export const DONE: DecisionKind[] = ['firefight.action', 'firefight.activate']

/** Answer a ploy window with the option of that id, anything else with a pass. */
export const takePloy = (id: string) => ({ 'ploy.firefight': (p: PendingDecision) => p.options?.find((o) => o.id === id)?.action ?? act.pass(p) })

/** Answer a fight's strike or block choices by striking with the first die offered. */
export const strikes = { 'fight.resolve': (p: PendingDecision) => p.options?.find((o) => o.id.startsWith('strike'))?.action ?? p.options![0]!.action }
/** ... or by blocking whenever a block is offered. */
export const blocks = { 'fight.resolve': (p: PendingDecision) => p.options?.find((o) => o.id.startsWith('block'))?.action ?? p.options![0]!.action }

/** Answer every ploy window with a pass (the default answer would take the first offer). */
export const skipPloys = { 'ploy.firefight': (p: PendingDecision) => act.pass(p) }

/** Take the option whose id starts with `prefix` (mission actions carry the marker in their id). */
export function takeLike(s: GameState, prefix: string, rng?: ScriptedRng) {
  const o = s.pending!.options!.find((x) => x.id.startsWith(prefix))
  if (!o) throw new Error(`no option ${prefix} in ${s.pending!.kind} (${s.pending!.options!.map((x) => x.id).join(', ')})`)
  return take(s, o.id, rng)
}

/** Use a strategy gambit through the engine with the offer the state itself makes (the pending options were built earlier). */
export function useGambit(s: GameState, seat: Seat, ployId: string, param?: string): GameState {
  const info = { window: 'strategy.gambit' }
  const offer = offersFor(s, seat, 'strategy.gambit', info).find((o) => o.ployId === ployId && (param === undefined || o.param === param))
  if (!offer) throw new Error(`${ployId} is not on offer`)
  return withCtx(s, (ctx) => usePloy(ctx, seat, offer, info)).state
}

/** B strikes whenever it can and A blocks whenever it can (a Novitiate defending against a Kommandos attacker). */
export const attackerStrikesDefenderBlocks = {
  'fight.resolve': (p: PendingDecision) => (p.seat === 'B' ? p.options?.find((o) => o.id.startsWith('strike')) : p.options?.find((o) => o.id.startsWith('block')))?.action ?? p.options![0]!.action,
}

/** Pass every ploy window that is open now. */
export function passPloys(s: GameState): GameState {
  let t = s
  while (t.pending?.kind === 'ploy.firefight') t = passIt(t).state
  return t
}

/** A's first operative has acted and ended: the next activation is B's. */
export function bTurn(s: GameState, ender: string): GameState {
  return take(activateOp(s, ender), 'end').state
}

/** Put two operatives into a melee gap. */
export function engaged(s: GameState, a: string, b: string, gapX = 1.4): GameState {
  return place(place(s, a, 0, 0), b, gapX, 0)
}

/** `shooter` (at 0,0) has declared Shoot with `weaponId` at `target` (gap away): the state waits at shoot.target. */
export function aim(s: GameState, shooter: string, target: string, weaponId: string, away = 4, seat: 'A' | 'B' = 'A'): GameState {
  const t = place(place(s, shooter, 0, 0), target, away, 0)
  const ready = seat === 'A' ? activateOp(t, shooter) : activateOp(bTurn(t, opOf(s, 'A', 'nv.reliquarius')), shooter)
  return take(passPloys(take(ready, 'shoot').state), weaponId).state
}

/** `fighter` has declared Fight at `foe` (both placed in a melee gap): waits at the first decision after the target (weapon pick or a ploy window). */
export function brawl(s: GameState, fighter: string, foe: string, rng: ScriptedRng, seat: 'A' | 'B' = 'A', gapX = 1.4): GameState {
  const t = engaged(s, fighter, foe, gapX)
  const ready = seat === 'A' ? activateOp(t, fighter) : activateOp(bTurn(t, opOf(s, 'A', 'nv.reliquarius')), fighter)
  return take(passPloys(take(ready, 'fight').state), foe, rng).state
}

export { play, withCtx }

export const scenarios: Record<string, () => void> = {
  nvActsOfFaith() {
    // the Ready step of the first turning point has already paid out in open()
    open()
  },
  nvKillFaith() {
    const s = open()
    const sup = A(s, 'superior')
    const nob = B(s, 'boss-nob')
    const t = edit(engaged(s, sup, nob), (st) => {
      st.operatives[nob]!.wounds = 2
    })
    withCtx(t, (ctx) => {
      inflict(ctx, { targetId: nob, attackerId: sup, weaponId: 'nv.w.power-weapon', amount: 5, source: 'strike-normal' })
    })
  },
  nvNullRod() {
    const s = open()
    const rod = A(s, 'condemnor')
    const boy = B(s, 'boy')
    const t = place(place(s, rod, 0, 0), boy, 3, 0)
    psychicAllowed(t, t.operatives[boy]!)
    psychicSelectable(t, t.operatives[boy]!)
  },
  nvAntiPsyker() {
    const s = open({ teams: ['novitiates', 'legionaries'], rosterB: lgPsyker() })
    const rod = A(s, 'condemnor')
    const acolyte = opOf(s, 'B', 'lg.balefire-acolyte')
    weaponDamage(place(place(s, rod, 0, 0), acolyte, 5, 0), rod, 'nv.w.condemnor-stakethrower', acolyte, 'shoot')
  },
  nvRiposte() {
    const s = open()
    const duel = A(s, 'duellist')
    const boy = B(s, 'boy')
    // the Boy fights the Duellist; the Duellist blocks with a crit
    const f = brawl(s, boy, duel, dice(4, 4, 1, 1, 6, 6, 1, 1), 'B')
    play(f, dice(), { ...blocks, ...skipPloys }, DONE)
  },
  nvZealousRage() {
    const s = open()
    const pen = A(s, 'penitent')
    const boy = B(s, 'boy')
    effectiveRules(engaged(s, pen, boy), s.operatives[pen]!, s.data.weapons['nv.w.penitent-eviscerator']!, 'fight', boy)
  },
  nvMilitantFaith() {
    const s = withFaith(open(), 5)
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    const t = edit(aim(s, mil, boy, 'nv.w.autogun'), (st) => {
      st.operatives[boy]!.wounds = 1
    })
    // Guidance on the roll, a re-roll that finds the hit, then the kill refunds the Faith
    const r = take(t, boy, dice(1, 1, 1, 1)).state
    const g = take(r, 'nv.a.guidance').state
    play(g, dice(6, 1, 1, 1), takePloy('none'), DONE)
  },
  nvGloriousHymnal() {
    const s = open()
    const pre = A(s, 'preceptor')
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    const t = place(place(place(s, pre, 0, 0), mil, 2, 0), boy, 7, 0)
    effectiveRules(t, t.operatives[mil]!, t.data.weapons['nv.w.autogun']!, 'shoot', boy)
  },
  nvDivineAcquisition() {
    const s = inTp(open(), 2)
    const pro = A(s, 'pronatus')
    const m = s.markers.find((k) => k.kind === 'objective')!
    const t = edit(s, (st) => {
      st.operatives[pro]!.pos = { x: m.pos.x + 0.9, y: 0, z: m.pos.z }
    })
    const a = activateOp(t, pro)
    takeLike(a, 'ability:core.a.secure')
  },
  nvPurgeWithFlame() {
    blazing()
  },
  nvIconBearer() {
    const s = open()
    const m = s.markers.find((k) => k.kind === 'objective')!
    const icon = A(s, 'reliquarius')
    markerControl(edit(s, (st) => (st.operatives[icon]!.pos = { x: m.pos.x + 0.9, y: 0, z: m.pos.z })), m)
  },
  nvAbsolution() {
    const s = open()
    const pen = A(s, 'penitent')
    const boy = B(s, 'boy')
    const f = brawl(s, pen, boy, dice(1, 1, 1, 1, 1, 1, 1, 1))
    play(f, dice(), { ...strikes, ...takePloy('nv.a.absolution-through-destruction') }, DONE)
  },
  nvMedic() {
    medicSave()
  },
  nvStirringRhetoric() {
    const s = open()
    const dia = A(s, 'dialogus')
    const mil = A(s, 'militant')
    const t = place(place(s, dia, 0, 0), mil, 3, 0)
    take(activateOp(t, dia), `ability:nv.a.stirring-rhetoric:${mil}`)
  },
  nvAutoBroadcaster() {
    broadcaster()
  },
  nvWhipIntoFrenzy() {
    const s = open()
    const exa = A(s, 'exactor')
    const mil = A(s, 'militant')
    const t = place(place(s, exa, 0, 0), mil, 2, 0)
    take(activateOp(t, exa), `ability:nv.a.whip-into-frenzy:${mil}`)
  },
  nvChirurgeonsTools() {
    const s = open()
    const hos = A(s, 'hospitaller')
    const mil = A(s, 'militant')
    const t = edit(place(place(s, hos, 0, 0), mil, 1.5, 0), (st) => {
      st.operatives[mil]!.wounds = 2
    })
    take(activateOp(t, hos), `ability:nv.a.chirurgeons-tools:${mil}`, dice(4, 5))
  },
  nvRaiseIcon() {
    const s = open()
    take(activateOp(s, A(s, 'reliquarius')), 'ability:nv.a.raise-icon')
  },
  nvFlagPloy() {
    take(toGambit(), 'nv.p.ardent-vengeance')
  },
  nvRighteousAdvance() {
    const t = useGambit(toGambit({}, 2), 'A', 'nv.p.righteous-advance')
    take(t, A(t, 'duellist'))
  },
  nvGloriousMartyrdom() {
    martyrdom()
  },
  nvBlazingInferno() {
    blazing()
  },
  nvBlindingAura() {
    take(aura(), 'nv.p.blinding-aura')
  },
  nvGuidedByFaith() {
    const s = open()
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    take(take(activateOp(place(place(s, mil, 0, 0), boy, 4, 0), mil), 'shoot').state, 'nv.p.guided-by-faith')
  },
  nvIconOfFaith() {
    iconOfFaith()
  },
  nvSanctifiedRounds() {
    rounds()
  },
  nvAutoChastisers() {
    chastisers()
  },
  nvHolyEmbrocations() {
    const s = open({ equipmentA: ['nv.e.holy-embrocations'] })
    const mil = A(s, 'militant')
    effectiveMove(edit(s, (st) => (st.operatives[mil]!.wounds = 2)).operatives[mil]!, edit(s, (st) => (st.operatives[mil]!.wounds = 2)))
  },
}

/** A Legionaries roster with a Balefire Acolyte (the PSYKER Anti-PSYKER looks for). */
export function lgPsyker(): RosterEntry[] {
  return ['lg.aspiring-champion', 'lg.balefire-acolyte', 'lg.butcher', 'lg.gunner', 'lg.icon-bearer', 'lg.warrior'].map((id) => ({ ...roster([id])[0]!, picks: { mark: 'SLAANESH' } }))
}

// The longer scenarios live below so the table above stays readable.

export function medicSave(): GameState {
  const s = open()
  const hos = A(s, 'hospitaller')
  const duel = A(s, 'duellist')
  const boy = B(s, 'boy')
  const t = edit(place(place(place(s, hos, 0, 0), duel, 2, 0), boy, 6, 0), (st) => {
    st.operatives[duel]!.wounds = 2
  })
  return withCtx(t, (ctx) => {
    inflict(ctx, { targetId: duel, attackerId: boy, weaponId: 'kom.w.slugga', amount: 5, source: 'normal' })
  }).state
}

export function broadcaster(): GameState {
  const s = open()
  const dia = A(s, 'dialogus')
  const t = place(s, dia, 0, 0)
  const a = take(activateOp(t, dia), 'ability:nv.a.auto-broadcaster').state
  return take(a, a.pending!.options![0]!.id).state
}

export function martyrdom(): GameState {
  const s = withFaith(open({}), 2)
  const duel = A(s, 'duellist')
  const boy = B(s, 'boy')
  const t = edit(engaged(s, duel, boy), (st) => {
    st.operatives[duel]!.wounds = 1
  })
  // the Boy hits the Duellist and kills it; Glorious Martyrdom is offered before it is removed
  const f = brawl(t, boy, duel, dice(6, 6, 6, 6, 1, 1, 1, 1), 'B')
  return play(f, dice(), { ...strikes, ...takePloy('nv.p.glorious-martyrdom') }, DONE).state
}

export function aura(): GameState {
  const s = open()
  const duel = A(s, 'duellist')
  const mil = A(s, 'militant')
  const boy = B(s, 'boy')
  const t = place(place(place(s, boy, 0, 0), duel, 6, 0), mil, 6, 2)
  const b = activateOp(bTurn(t, A(s, 'reliquarius')), boy)
  const c = take(passPloys(take(b, 'shoot').state), 'kom.w.slugga').state
  return take(c, duel).state
}

export function blazing(): GameState {
  const s = open()
  const pur = A(s, 'purgatus')
  const boy = B(s, 'boy')
  const t = edit(aim(s, pur, boy, 'nv.w.ministorum-flamer', 4), (st) => {
    st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
  })
  const r = take(t, boy, dice(6, 6, 1, 1)).state
  return play(r, dice(), takePloy('nv.p.blazing-inferno:' + boy), DONE).state
}

export function iconOfFaith(): GameState {
  const s = withFaith(open({ equipmentA: ['nv.e.icon-of-faith'] }), 9)
  const mil = A(s, 'militant')
  const boy = B(s, 'boy')
  const t = aim(s, mil, boy, 'nv.w.autogun')
  const r = take(t, boy, dice(1, 1, 5, 1)).state
  const g = take(r, 'nv.a.guidance').state
  return play(g, dice(), takePloy('nv.a.intervention'), DONE).state
}

export function rounds(): GameState {
  const s = withFaith(open({ equipmentA: ['nv.e.sanctified-rounds'] }), 5)
  const mil = A(s, 'militant')
  const boy = B(s, 'boy')
  const r = take(aim(s, mil, boy, 'nv.w.autogun'), boy, dice(6, 6, 1, 1)).state
  return play(r, dice(), takePloy('nv.e.sanctified-rounds'), DONE).state
}

export function chastisers(): GameState {
  const s = open({ equipmentA: ['nv.e.auto-chastisers'] })
  const mil = A(s, 'militant')
  const boy = B(s, 'boy')
  const r = take(aim(s, mil, boy, 'nv.w.autogun'), boy, dice(1, 1, 1, 1)).state
  return take(r, 'nv.a.guidance:free').state
}

void directDamage
void runHook

// ---------------------------------------------------------------------------
// Walking a sequence: answer decisions, remember the ploy windows that were open
// ---------------------------------------------------------------------------

export interface Seen {
  kind: string
  window: string
  seat: Seat
  options: string[]
}
export interface Walked {
  state: GameState
  events: GameEvent[]
  seen: Seen[]
}
type Answer = (p: PendingDecision, s: GameState) => Action | null

/** The option of that id, or null when it is not offered. */
export const opt = (id: string): Answer => (p) => p.options?.find((o) => o.id === id)?.action ?? null

/** Step the game with `answers` by decision kind (null = the default: pass a ploy window, else the engine's answer). */
export function walk(state: GameState, rng: ScriptedRng, answers: Partial<Record<DecisionKind, Answer>> = {}, stop: DecisionKind[] = DONE, until?: (s: GameState) => boolean, max = 160): Walked {
  const seen: Seen[] = []
  const events: GameEvent[] = []
  let s = state
  for (let i = 0; i < max; i++) {
    const p = s.pending
    if (!p || stop.includes(p.kind) || until?.(s)) break
    seen.push({ kind: p.kind, window: p.window, seat: p.seat, options: (p.options ?? []).map((o) => o.id) })
    const custom = answers[p.kind]?.(p, s) ?? null
    const a = custom ?? (p.kind === 'ploy.firefight' ? act.pass(p) : (answerDecision(s, p) ?? p.options?.[0]?.action ?? act.pass(p)))
    const r = step(s, a, rng)
    if (r.rejection) throw new Error(`walk: ${p.kind} rejected ${JSON.stringify(a.payload)}: ${r.rejection.reason}`)
    events.push(...r.events)
    s = r.state
  }
  return { state: s, events, seen }
}

const isFaithOffer = (o: string): boolean => o.startsWith('nv.a.') || o.startsWith('nv.e.')

/** The ploy windows (and the Faith offers in them) the Novitiate seat saw. */
export const nvWindows = (w: Walked, seat: Seat = 'A'): string[] => w.seen.filter((x) => x.kind === 'ploy.firefight' && x.seat === seat && x.options.some(isFaithOffer)).map((x) => `${x.window}:${x.options.filter(isFaithOffer).join('+')}`)

/** Walk to the ploy window with that name (the sequence's dice are final there for the roll windows). */
export const toWindow = (state: GameState, rng: ScriptedRng, window: string, answers: Partial<Record<DecisionKind, Answer>> = {}): Walked => walk(state, rng, answers, DONE, (s) => s.pending?.kind === 'ploy.firefight' && s.pending.window === window)
