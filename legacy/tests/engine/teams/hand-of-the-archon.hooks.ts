// hand-of-the-archon code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers exported first are shared with hand-of-the-archon.test.ts (the glob that merges scenarios ignores them).
import { step } from '@/engine'
import { act } from '@/engine/actions'
import { offersFor, usePloy, type PloyOffer } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import type { GameState, Seat } from '@/engine/types'
import { defaultAnswer, expectOk, place } from '../../fixtures/helpers'
import { activateOp, edit, newRealGame, opOf, take, withCtx, type RealOpts } from '../../fixtures/real'

export const MATCH = { teams: ['hand-of-the-archon', 'kommandos'] as [string, string] }

/** Every ploy window passed: the shared drivers pick the first offered option, which here would be a ploy or an Omen. */
export const pass = (p: { seat: Seat; id: string }) => ({ type: 'pass' as const, seat: p.seat, decisionId: p.id, payload: {} as Record<string, never> })
export const noPloys = { 'ploy.firefight': pass }

/** Dice for scripted steps, then 1s (every later die fails). */
export const dice = (...d: number[]): ScriptedRng => new ScriptedRng([...d, ...Array<number>(120).fill(1)])

/** Play set-up and the first Strategy phase (A wins both roll-offs) and stop at the first activation; every ploy window is passed. */
export function startHa(o: RealOpts = {}, seed = 'ha'): GameState {
  let s = newRealGame({ ...MATCH, ...o }, seed).state
  const rng = new ScriptedRng([6, 1, 6, 1])
  for (let i = 0; i < 800 && s.pending && s.pending.kind !== 'firefight.activate'; i++) {
    const p = s.pending
    s = expectOk(step(s, p.kind === 'ploy.firefight' ? act.pass(p) : defaultAnswer(s), rng)).state
  }
  return s
}

/**
 * Play set-up and the Strategy phase until a ploy decision of `seat` in `window` is pending (A wins both roll-offs);
 * ploy windows before that are passed, and `gambits` lists the strategy ploys `A` takes in the Gambit step on the way.
 */
export function toWindow(window: string, seat: Seat = 'A', o: RealOpts = {}, gambits: string[] = [], seed = 'ha-window'): GameState {
  let s = newRealGame({ ...MATCH, ...o }, seed).state
  const rng = new ScriptedRng([6, 1, 6, 1])
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

/** The Gambit step with `A` having taken the listed ploys, then the game on to the first activation (open ground). */
export function openWithGambits(gambits: string[], o: RealOpts = {}, seed = 'ha-gambit'): GameState {
  let s = newRealGame({ ...MATCH, ...o }, seed).state
  const rng = new ScriptedRng([6, 1, 6, 1])
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
  return openGround(s)
}

function openGround(s: GameState): GameState {
  return edit(s, (st) => {
    st.map = { ...st.map, features: [] }
    let a = 0
    let b = 0
    for (const op of Object.values(st.operatives)) op.pos = op.seat === 'A' ? { x: -13.5, y: 0, z: -10 + a++ * 1.7 } : { x: 13.5, y: 0, z: -10 + b++ * 1.7 }
    st.markers = st.markers.filter((m) => m.kind === 'objective')
    st.equipment.placed = []
    for (const m of st.markers) m.controller = null
  })
}

/** Open ground, every operative parked in its corner; Hand of the Archon (A) is to activate. */
export function openHa(o: RealOpts = {}, seed = 'ha'): GameState {
  return openGround(startHa(o, seed))
}

export const A = (s: GameState, card: string): string => opOf(s, 'A', `ha.${card}`)
export const B = (s: GameState, card: string): string => opOf(s, 'B', `kom.${card}`)

/** Put operatives at spots (x, z). */
export function put(s: GameState, spots: Record<string, [number, number]>): GameState {
  let t = s
  for (const [id, [x, z]] of Object.entries(spots)) t = place(t, id, x, z)
  return t
}

/** Use a ploy through the engine with a hand-made offer (the window itself is not what the scenario is about). */
export function usePlayed(s: GameState, seat: Seat, ployId: string, info: Record<string, unknown>, param?: string): GameState {
  const offer = offersFor(s, seat, String(info.window), info as never).find((o) => o.ployId === ployId && (param === undefined || o.param === param))
  if (!offer) throw new Error(`${ployId} is not offered in ${String(info.window)}`)
  return withCtx(s, (ctx) => usePloy(ctx, seat, offer as PloyOffer, info as never)).state
}

/** The Gambit step, A to choose (A holds initiative). */
export function toGambit(o: RealOpts = {}): GameState {
  let s = newRealGame({ ...MATCH, ...o }, 'ha-gambit-step').state
  const rng = new ScriptedRng([6, 1, 6, 1])
  for (let i = 0; i < 800 && s.pending && s.pending.kind !== 'strategy.gambit'; i++) {
    const p = s.pending
    s = expectOk(step(s, p.kind === 'ploy.firefight' ? act.pass(p) : defaultAnswer(s), rng)).state
  }
  return s
}

export const scenarios: Record<string, () => void> = {
  haTormentGrenade() {
    const s = openHa()
    const dis = A(s, 'disciple-of-yaelindra')
    const boy = B(s, 'boy')
    take(activateOp(put(s, { [dis]: [0, 0], [boy]: [4, 0] }), dis), `ability:ha.a.torment-grenade:${boy}`, dice(4, 6))
  },
  haAdministerDrug() {
    const s = openHa()
    const elix = A(s, 'elixicant')
    const hurt = edit(put(s, { [elix]: [0, 0] }), (st) => (st.operatives[elix]!.wounds = 3))
    take(activateOp(hurt, elix), `ability:ha.a.administer-drug:${elix}:heal`, dice(3, 3))
  },
  haMarkAction() {
    const s = openHa()
    const sk = A(s, 'skysplinter-assassin')
    const boy = B(s, 'boy')
    take(activateOp(put(s, { [sk]: [0, 0], [boy]: [5, 0] }), sk), `ability:ha.a.mark:${boy}`)
  },
  haCombatDrugs() {
    // the setup hook runs when the game is created with an Elixicant in the roster
    openHa({ teamChoices: { A: { 'combat-drug': 'ha.a.hypex' }, B: {} } })
  },
  haMercilessSadists() {
    take(toGambit(), 'ha.p.merciless-sadists')
  },
  haFromDarkness() {
    take(toGambit(), 'ha.p.from-darkness-death')
  },
  haDenizens() {
    take(toGambit(), 'ha.p.denizens-of-night')
  },
  haCruelDeception() {
    const s = openHa()
    usePlayed(s, 'A', 'ha.p.cruel-deception', { window: 'firefight.activationStart', subjectId: A(s, 'agent'), counteracting: false })
  },
  haDeviousScheme() {
    const s = openHa()
    const ploy = 'kom.p.shake-it-off'
    const used = usePlayed(s, 'B', ploy, { window: 'firefight.activationStart', subjectId: B(s, 'boy'), counteracting: false })
    usePlayed(used, 'A', 'ha.p.devious-scheme', { window: 'ploy.opponentUsed', ployId: ploy, usedBy: 'B' })
  },
  haHeinousArrogance() {
    take(toWindow('firefight.beforeActivation'), 'ha.p.heinous-arrogance')
  },
  haPreyOnTheWounded() {
    const s0 = openHa()
    const agent = A(s0, 'agent')
    const boy = B(s0, 'boy')
    const s = edit(put(s0, { [agent]: [0, 0], [boy]: [5, 0] }), (st) => (st.operatives[boy]!.wounds = 6))
    const rng = dice(1, 1, 1)
    const w = take(take(take(activateOp(s, agent, 'engage', rng), 'shoot', rng).state, 'ha.w.splinter-rifle', rng).state, boy, rng).state
    take(w, 'ha.p.prey-on-the-wounded', rng)
  },
}
