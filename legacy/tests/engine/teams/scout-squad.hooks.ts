// scout-squad code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/scout-squad.test.ts.
import { createGame, step } from '@/engine'
import { act } from '@/engine/actions'
import { offersFor, usePloy, type PloyOffer } from '@/engine/ploys'
import { providerExtraCoverSaves } from '@/engine/team-rules'
import { ScriptedRng } from '@/engine/rng'
import type { GameState, PendingDecision } from '@/engine/types'
import { play, type Played } from '../../fixtures/attack'
import { defaultAnswer, drive, expectOk, place } from '../../fixtures/helpers'
import { activateOp, edit, openReal, opOf, realBundle, realSetupWith, take, withCtx } from '../../fixtures/real'

export const MATCH = { teams: ['scout-squad', 'kommandos'] as [string, string] }

/** Open ground, every operative parked in its corner; A (Scout Squad) is to activate. */
export function open(o: Parameters<typeof openReal>[0] = {}): GameState {
  return openReal({ ...MATCH, ...o })
}
export const A = (s: GameState, card: string): string => opOf(s, 'A', `ss.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** A forced dice script: the head, then ones. */
export const dice = (...head: number[]): ScriptedRng => new ScriptedRng([...head, ...Array<number>(160).fill(1)])

/** The Strategy phase of turning point 1 at A's first gambit decision. */
export function toGambit(o: Parameters<typeof openReal>[0] = {}): GameState {
  return drive(createGame(realSetupWith({ ...MATCH, ...o }), 'ss-gambit', realBundle).state, (st) => st.pending?.kind === 'strategy.gambit', 1500, new ScriptedRng([6, 1, 6, 1]))
}

/** Use a ploy through the engine with a hand-made offer (the window itself is not what the scenario is about). */
export function usePlayed(s: GameState, ployId: string, info: Record<string, unknown> = {}, param?: string, seat: 'A' | 'B' = 'A', rng?: ScriptedRng): GameState {
  const window = String(info.window ?? 'firefight.actionEnded')
  const winfo = { window, ...info }
  const o: PloyOffer | undefined = offersFor(s, seat, window, winfo).find((x) => x.ployId === ployId && (param === undefined || x.param === param))
  if (!o) throw new Error(`${ployId}${param ? `:${param}` : ''} is not offered in ${window}`)
  return withCtx(s, (ctx) => usePloy(ctx, seat, o, winfo), rng).state
}

/** Give seat A a number of CP. */
export function withCp(s: GameState, cp: number, seat: 'A' | 'B' = 'A'): GameState {
  return edit(s, (st) => {
    st.players[seat].cp = cp
  })
}

/**
 * A new game at the Forward Scouting step (set-up done, before turning point 1): A is Scout Squad and the setup
 * initiative holder (the roll-off dice are forced).
 */
export function toPreBattle(o: Parameters<typeof openReal>[0] = {}, seed = 'ss-prebattle'): GameState {
  let s = createGame(realSetupWith({ ...MATCH, ...o }), seed, realBundle).state
  const rng = new ScriptedRng([6, 1, 6, 1])
  for (let i = 0; i < 1500; i++) {
    const p = s.pending
    if (!p) break
    if (p.kind === 'ability.choice' && p.context.preBattle === true) return s
    if (s.setup.step === 'preBattle' || s.turningPoint > 0) break
    s = expectOk(step(s, defaultAnswer(s), rng)).state
  }
  throw new Error(`no pre-battle choice: ${s.pending?.kind} ${s.setup.step}`)
}

/** Answer the pending Forward Scouting decision with the offer whose option slug is `slug`. */
export function fsPick(s: GameState, slug: string, rng?: ScriptedRng): GameState {
  const p = s.pending as PendingDecision
  const offers = (p.context.offers as { option: string }[]) ?? []
  const i = offers.findIndex((x) => x.option === slug)
  if (i < 0) throw new Error(`${slug} is not offered (${offers.map((x) => x.option).join(', ')})`)
  return take(s, `prebattle:${i}`, rng).state
}

/** The slugs of the Forward Scouting options offered now. */
export function fsOffered(s: GameState): string[] {
  return ((s.pending?.context.offers as { option: string }[]) ?? []).map((x) => x.option)
}

/** Put a Scout Squad team marker (Trip Alarm, Booby Trap) into play at a spot for seat A. */
export function withMarker(s: GameState, equipmentId: 'ss.tripAlarm' | 'ss.boobyTrap', x: number, z: number): GameState {
  return edit(s, (st) => {
    st.markers.push({ id: `ssm${st.markers.length}`, kind: 'equipment', pos: { x, z }, owner: 'A', carriedBy: null, controller: null, equipmentId })
  })
}

/** Add timed effects the hooks read (a strategy ploy in force): `expires` defaults to the turning point. */
export function withFx(s: GameState, ...list: { source: string; kind?: string; operativeId?: string; expires?: string; data?: Record<string, unknown> }[]): GameState {
  return edit(s, (st) => {
    list.forEach((e, i) => st.effects.push({ id: `ek${i}${st.effects.length}`, seat: 'A', kind: e.kind ?? 'ployFlag', expires: e.expires ?? 'turningPoint', source: e.source, ...(e.operativeId ? { operativeId: e.operativeId } : {}), ...(e.data ? { data: e.data } : {}) } as never))
  })
}

/** Give an operative tokens the hooks read. */
export function withToken(s: GameState, opId: string, kind: string, owner: 'A' | 'B' = 'A', count = 1): GameState {
  return edit(s, (st) => {
    const o = st.operatives[opId]!
    o.tokens = [...(o.tokens ?? []), { kind, owner, count, ...(kind === 'ss.optics' || kind === 'ss.auspexScan' ? { sourceId: opId, expires: ['sourceNextActivation', 'sourceIncapacitated'] } : {}) } as never]
  })
}

/** Answer a move decision with these waypoints. */
export const goVia = (...pts: [number, number][]) => ({ 'move.path': (q: PendingDecision) => ({ type: 'move.path' as const, seat: q.seat, decisionId: q.id, payload: { waypoints: pts.map(([x, z]) => ({ x, z })) } }) })

/** Ploy windows are passed unless a test says otherwise (the engine default would use the first ploy offered). */
const PASS_PLOYS = { 'ploy.firefight': (p: PendingDecision) => act.pass(p) }

/** A's first operative has acted and ended: the next activation is B's. */
export function bTurn(s: GameState, ender: string): GameState {
  return take(activateOp(s, ender), 'end').state
}

/** Answer a ploy window with the option of that id, anything else with a pass. */
export const takePloy = (id: string) => ({ 'ploy.firefight': (p: PendingDecision) => p.options?.find((o) => o.id === id)?.action ?? act.pass(p) })

/** One Shoot by `who` with `weaponId` at `targetId`, all dice scripted; returns the state at the next action decision. */
export function shootAt(s: GameState, who: string, weaponId: string, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}, order: 'engage' | 'conceal' = 'engage'): Played {
  let t = take(activateOp(s, who, order, rng), 'shoot', rng).state
  t = take(t, weaponId, rng).state
  t = take(t, targetId, rng).state
  return play(t, rng, { ...PASS_PLOYS, ...answers })
}

/** The next Shoot of an activation already under way (the operative waits at firefight.action). */
export function shootAgain(s: GameState, weaponId: string, targetId: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}): Played {
  let t = take(s, 'shoot', rng).state
  t = take(t, weaponId, rng).state
  t = take(t, targetId, rng).state
  return play(t, rng, { ...PASS_PLOYS, ...answers })
}

export { act, activateOp, edit, place }

const EQUIP = ['ss.e.camo-cloak', 'ss.e.targeting-oculars', 'ss.e.combat-blade', 'ss.e.tactical-vox-link']

/** A Scout (activated) with the ploy used through its real offer in the action-ended window. */
function trained(option: string): GameState {
  const s = withCp(open({ equipmentA: EQUIP }), 3)
  const wr = A(s, 'warrior')
  return usePlayed(activateOp(s, wr), 'ss.p.astartes-training', { window: 'firefight.actionEnded', subjectId: wr }, option)
}

export const scenarios: Record<string, () => void> = {
  ssGuidance() {
    const s = open()
    take(activateOp(s, A(s, 'sergeant')), `ability:ss.a.guidance-and-experience:${A(s, 'warrior')}`)
  },
  ssOptics() {
    const s = open()
    take(activateOp(s, A(s, 'sniper')), 'ability:ss.a.optics')
  },
  ssTrackEnemy() {
    const s = open()
    const tk = A(s, 'tracker')
    const boy = B(s, 'boy')
    take(activateOp(place(place(s, tk, 0, 0), boy, 6, 0), tk), `ability:ss.a.track-enemy:${boy}`)
  },
  ssAuspexScan() {
    const s = open()
    const tk = A(s, 'tracker')
    take(activateOp(place(place(s, tk, 0, 0), B(s, 'boy'), 6, 0), tk), 'ability:ss.a.auspex-scan')
  },
  ssForwardScouting() {
    fsPick(toPreBattle(), 'devisePlan')
  },
  ssFlagPloy() {
    take(toGambit(), 'ss.p.guerrilla-engagement')
  },
  ssAdaptableTraining() {
    take(withCp(toGambit(), 3), 'ss.p.adaptable-training', dice(5))
  },
  ssStealthRelocation() {
    const g = edit(withCp(toGambit(), 3), (st) => {
      st.turningPoint = 2
      st.ledger.A.tp = []
    })
    usePlayed(g, 'ss.p.stealth-relocation', { window: 'strategy.gambit' }, undefined, 'A', dice(3))
  },
  ssGambit() {
    const g = edit(toGambit(), (st) => void (st.ledger.A.uses['ss.fs:tacticalManoeuvre'] = 1))
    usePlayed(g, 'ss.p.tactical-manoeuvre', { window: 'strategy.gambit' }, A(g, 'warrior'))
  },
  ssAstartesTraining() {
    trained('fight')
  },
  ssRawPhysiology() {
    const s = withCp(open(), 3)
    const wr = A(s, 'warrior')
    usePlayed(activateOp(s, wr), 'ss.p.raw-physiology', { window: 'firefight.actionEnded', subjectId: wr })
  },
  ssCovertPosition() {
    const s = withCp(open(), 3)
    const wr = A(s, 'warrior')
    usePlayed(activateOp(s, wr), 'ss.p.covert-position', { window: 'firefight.actionEnded', subjectId: wr })
  },
  ssEmboldenedAspirant() {
    const s = withCp(open(), 3)
    const wr = A(s, 'warrior')
    const boy = B(s, 'boy')
    shootAt(place(place(s, wr, 0, 0), boy, 6, 0), wr, 'ss.w.boltgun', boy, dice(3, 3, 1, 1, 1, 1, 1, 1), takePloy('ss.p.emboldened-aspirant'))
  },
  ssCamoCloak() {
    const s = open({ equipmentA: EQUIP })
    providerExtraCoverSaves(s, s.operatives[A(s, 'warrior')]!)
  },
  ssTargetingOculars() {
    const s = withCp(open({ equipmentA: EQUIP }), 3)
    const wr = A(s, 'warrior')
    const boy = B(s, 'boy')
    shootAt(place(place(s, wr, 0, 0), boy, 6, 0), wr, 'ss.w.boltgun', boy, dice(5, 5, 5, 5, 1, 1, 1, 1), takePloy('ss.e.targeting-oculars'))
  },
  ssVoxLink() {
    trained('shoot')
  },
}
