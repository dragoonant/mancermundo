// hierotek-circle code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The staging helpers below are shared with hierotek-circle.test.ts.
import { expect } from 'vitest'
import { step } from '@/engine'
import { defaultLoadoutFor } from '@/engine/bundle'
import { removeNow } from '@/engine/effects'
import { updateControl } from '@/engine/markers'
import { offersFor, usePloy } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { reanimate, M } from '@/engine/teams/hierotek-circle'
import type { GameState, RosterEntry } from '@/engine/types'
import { play } from '../../fixtures/attack'
import { drive, place } from '../../fixtures/helpers'
import { activateOp, edit, newRealGame, openReal, opOf, realBundle, roster, take, withCtx, type RealOpts } from '../../fixtures/real'

export const HIE = 'hierotek-circle'

/** The full eight: a Chronomancer, both Plasmacytes, an Apprentek, two Deathmarks, a Despotek and a Guardian. */
export const FULL = [
  'hie.chronomancer',
  'hie.plasmacyte-accelerator',
  'hie.plasmacyte-reanimator',
  'hie.apprentek',
  'hie.deathmark',
  'hie.immortal-despotek',
  'hie.immortal-guardian',
  'hie.deathmark',
]

/** The same eight, with the Despotek carrying a tesla carbine. */
export const TESLA_ROSTER: RosterEntry[] = FULL.map((id) =>
  id === 'hie.immortal-despotek' ? { datacardId: id, loadout: { weaponIds: ['hie.w.tesla-carbine'] } } : { datacardId: id, loadout: defaultLoadoutFor(realBundle, id) },
)

/** An open real game: Hierotek Circle (seat A, on turn) against Kommandos, everyone parked in the far corners. */
export function hie(o: RealOpts = {}, cards: string[] = FULL): GameState {
  return openReal({ teams: [HIE, 'kommandos'], rosterA: roster(cards), ...o })
}

export const a = (s: GameState, card: string): string => opOf(s, 'A', card)
export const b = (s: GameState, card: string): string => opOf(s, 'B', card)

/** Put operatives at positions: `at(s, [id, x, z], ...)`. */
export function at(s: GameState, ...spots: [string, number, number][]): GameState {
  let t = s
  for (const [id, x, z] of spots) t = place(t, id, x, z)
  return t
}

/** Incapacitate an operative the way a rule would (before-removal hooks, removal, kill counting). */
export function kill(s: GameState, id: string, rng?: ScriptedRng): GameState {
  return withCtx(
    edit(s, (st) => {
      st.operatives[id]!.wounds = 0
    }),
    (ctx) => {
      removeNow(ctx, id)
      updateControl(ctx)
    },
    rng,
  ).state
}

export const markerOf = (s: GameState, id: string) => s.markers.find((m) => m.equipmentId === M.reanimation && m.placedBy === id)

/** Reanimate the operative tied to a marker at a chosen spot. */
export function raise(s: GameState, id: string, pos = { x: 0, y: 0, z: 0 }, order: 'engage' | 'conceal' = 'engage'): GameState {
  const m = markerOf(s, id)!
  return withCtx(s, (ctx) => {
    expect(reanimate(ctx, m.id, { pos, order })).toBe(true)
  }).state
}

/** Activate the operative of seat A and take one of its actions by option id. */
export function act(s: GameState, id: string, option: string, rng?: ScriptedRng): GameState {
  return take(activateOp(s, id), option, rng).state
}

/** Use a ploy through its window the way a player would (the offer must exist: CP, window and the ploy's own conditions). */
export function usePloyOn(s: GameState, ployId: string, o: { window?: string; subjectId?: string; param?: string; seat?: 'A' | 'B' } = {}): GameState {
  const seat = o.seat ?? 'A'
  const window = o.window ?? 'strategy.gambit'
  const info = { window, ...(o.subjectId ? { subjectId: o.subjectId } : {}) }
  const offer = offersFor(s, seat, window, info).find((x) => x.ployId === ployId && (o.param === undefined || x.param === o.param))
  if (!offer) throw new Error(`${ployId} is not offered in ${window}`)
  return withCtx(s, (ctx) => usePloy(ctx, seat, offer, info)).state
}

/** A low wall just in front of the enemy: a Conceal enemy behind it is in cover from the west, but not from the south. */
export const WALL = { id: 'wall', parts: [{ id: 'wall.0', footprint: [{ x: 0.5, z: -1.5 }, { x: 1, z: -1.5 }, { x: 1, z: 1.5 }, { x: 0.5, z: 1.5 }], height: 1, traits: ['light' as const] }] }

/** A Chronomancer at (-6, 0), an Engage Apprentek at (2, -6) and a lone Conceal Boy behind the wall at (2, 0). */
export function magnifyArena(o: RealOpts = {}, cards = FULL) {
  let s = hie(o, cards)
  const [cx, app, boy] = [a(s, 'hie.chronomancer'), a(s, 'hie.apprentek'), b(s, 'kom.boy')]
  s = edit(at(s, [cx, -6, 0], [app, 2, -6], [boy, 2, 0]), (st) => {
    st.map = { ...st.map, features: [WALL] }
    st.operatives[app]!.order = 'engage'
    st.operatives[boy]!.order = 'conceal'
    // nobody else on the other side is on the board, so the Shoot action stands or falls with this one enemy
    for (const x of Object.values(st.operatives)) if (x.seat === 'B' && x.id !== boy) x.status = 'reserve'
  })
  return { s, cx, app, boy }
}

/** The state at the first gambit decision, terrain cleared, with Hierotek Circle operatives placed for COMMAND UNDERLINGS. */
export function underlingsGame(): GameState {
  const start = drive(newRealGame({ teams: [HIE, 'kommandos'], rosterA: roster(FULL) }, 'underlings').state, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
  const [cx, g, desp, app, acc, rea, dm, dm2] = ['A1', 'A7', 'A6', 'A4', 'A2', 'A3', 'A5', 'A8']
  return edit(at(start, [cx, 0, 0], [g, 4, 0], [desp, -4, 0], [app, -12, -9], [dm2, -12, -7.5], [acc, 12, -9], [rea, -12, 9], [dm, 12, 9]), (st) => {
    st.map = { ...st.map, features: [] }
  })
}

const PSY = ['hie.psychomancer', ...FULL.slice(1)]
const TEC = ['hie.technomancer', ...FULL.slice(1)]
const choose = (s: GameState): GameState => take(s, s.pending!.options![0]!.id).state
const ones = (n: number): number[] => Array<number>(n).fill(1)

export const scenarios: Record<string, () => void> = {
  magnify() {
    const { s, cx, app, boy } = magnifyArena()
    let t = take(activateOp(s, cx), 'shoot').state
    t = take(t, `hie.w.aeonstave-ranged@${app}`).state
    // Ceaseless is added once the attack is rolled through the proxy
    const r = step(t, t.pending!.options!.find((o) => o.id === boy)!.action, new ScriptedRng([1, 1, 2, 5, 6]))
    expect(r.rejection).toBeUndefined()
  },
  hieInterstitial() {
    const s = at(hie(), ['A1', 0, 0], ['A7', 4, 0])
    act(s, 'A1', 'ability:hie.a.interstitial-command:A7')
  },
  hieCortical() {
    const s = at(hie(), ['A1', 0, 0], ['A7', 12, 5], ['A6', -12, -8])
    const t = act(s, 'A1', 'ability:hie.a.interstitial-command:A7:cc')
    expect(t.ledger.A.tp).toContain('hie.p.cortical-control')
  },
  hieTimesplinter() {
    const s = edit(at(hie(), ['A1', 0, 0], ['A7', 4, 0]), (st) => {
      st.operatives['A7']!.ready = false
      st.turningPoint = 2
    })
    choose(act(s, 'A1', 'ability:hie.a.timesplinter:A7'))
  },
  hieMarker() {
    choose(act(at(hie(), ['A1', 0, 0]), 'A1', 'ability:hie.a.nanomine'))
  },
  hieSupport() {
    const s = at(hie(), ['A1', 0, 0], ['A2', 3, 0], ['A7', 4, 0])
    act(s, 'A1', 'ability:hie.a.chronometron:A1')
    act(s, 'A2', 'ability:hie.a.accelerate:A7')
  },
  hieShroud() {
    act(at(hie({}, PSY), ['A1', 0, 0]), 'A1', 'ability:hie.a.nightmare-shroud')
  },
  hieMadness() {
    const s = hie({}, PSY)
    const boy = b(s, 'kom.boy')
    act(at(s, ['A1', 0, 0], [boy, 6, 0]), 'A1', `ability:hie.a.vision-of-madness:${boy}`)
  },
  hieReanimate() {
    const s = kill(at(hie(), ['A7', 0, 0], ['A3', 4, 0]), 'A7')
    const m = markerOf(s, 'A7')!
    choose(act(s, 'A3', `ability:hie.a.reanimate:${m.id}:2`))
  },
  hieVision() {
    act(at(hie(), ['A5', 0, 0]), 'A5', 'ability:hie.a.multi-dimensional-vision')
  },
  hieRelentless() {
    usePloyOn(hie(), 'hie.p.relentless-onslaught')
  },
  hieUndying() {
    usePloyOn(hie(), 'hie.p.undying-androids')
  },
  hieMethodical() {
    usePloyOn(hie(), 'hie.p.methodical-elimination')
  },
  hieUnderlings() {
    const s = underlingsGame()
    take(s, 'hie.p.command-underlings:cryptek')
  },
  hieReanimatedFunction() {
    const s = hie()
    const obj = s.markers.find((m) => m.kind === 'objective')!
    const t = edit(s, (st) => {
      st.operatives['A7']!.status = 'removed'
      st.markers.push({ id: 'rm1', kind: 'equipment', pos: { x: obj.pos.x - 1.2, z: obj.pos.z }, owner: 'A', carriedBy: null, controller: null, equipmentId: M.reanimation, placedBy: 'A7' })
    })
    usePloyOn(t, 'hie.p.reanimated-function', { window: 'firefight.activationStart', subjectId: 'A4', param: 'rm1' })
  },
  hieLivingLightning() {
    const base = hie({ rosterA: TESLA_ROSTER })
    const u = at(base, ['A6', -3, 0], [b(base, 'kom.boy'), 3, 0])
    take(take(activateOp(u, 'A6'), 'shoot').state, 'hie.p.living-lightning')
  },
  hieAmbush() {
    const base = hie()
    const s = at(base, ['A5', -5, 0], [b(base, 'kom.boy'), 6, 0])
    take(take(take(s, 'A5').state, 'conceal').state, 'hie.p.dimensional-ambush')
  },
}

void [play, TEC]
void ones
