// wyrmblade code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers below are also used by wyrmblade.test.ts, so both files build the same positions.
import { expect } from 'vitest'
import { act } from '@/engine/actions'
import { step, type GameState, type PendingDecision } from '@/engine'
import { ScriptedRng } from '@/engine/rng'
import { drive, expectOk, place } from '../../fixtures/helpers'
import { play } from '../../fixtures/attack'
import { activateOp, edit, newRealGame, openReal, opOf, passIt, roster, take, type RealOpts } from '../../fixtures/real'

export const TEAMS: [string, string] = ['wyrmblade', 'kommandos']
export const SNIPER_ROSTER = ['wyr.neophyte-leader', 'wyr.gunner-flamer', 'wyr.sanctus-sniper', 'wyr.sanctus-talon', 'wyr.warrior', 'wyr.warrior', 'wyr.warrior', 'wyr.warrior', 'wyr.warrior', 'wyr.warrior', 'wyr.warrior']

/** Wyrmblade (seat A) against Kommandos (seat B) on open ground, A to activate. */
export function wyr(o: RealOpts = {}, seed = 'wyr-open'): GameState {
  return openReal({ teams: TEAMS, ...o }, seed)
}

/** A game with a Sanctus Sniper and a Sanctus Talon. */
export function agents(o: RealOpts = {}): GameState {
  return wyr({ rosterA: roster(SNIPER_ROSTER), ...o }, 'wyr-agents')
}

export function idsOf(s: GameState, seat: 'A' | 'B', card: string): string[] {
  return Object.values(s.operatives)
    .filter((o) => o.seat === seat && o.datacardId === card)
    .map((o) => o.id)
}

/** Dice for a script, padded with 1s so a step never runs dry. */
export function dice(...values: number[]): ScriptedRng {
  return new ScriptedRng([...values, ...Array<number>(60).fill(1)])
}

/** Set the operatives aside in HIDING. */
export function hide(s: GameState, ...ids: string[]): GameState {
  return edit(s, (st) => {
    for (const id of ids) {
      st.operatives[id]!.status = 'reserve'
      st.operatives[id]!.offboard = 'setAside'
    }
  })
}

/** A's Gunner activates and ends: B is next to activate. */
export function bTurn(s: GameState): GameState {
  const g = idsOf(s, 'A', 'wyr.gunner-flamer')[0] ?? opOf(s, 'A', 'wyr.neophyte-leader')
  return take(activateOp(place(s, g, -13.5, 9.5), g), 'end').state
}

/** End the activation in progress and pass the end-of-activation ploy window (Slink Into Darkness) if it opens. */
export function endAct(s: GameState, rng?: ScriptedRng): GameState {
  let t = take(s, 'end', rng).state
  while (t.pending?.kind === 'ploy.firefight' && t.pending.window === 'firefight.activationEnded') t = passIt(t, rng).state
  return t
}

/** Choose the option of the pending decision whose id starts with `prefix`. */
export function takeStarting(s: GameState, prefix: string, rng?: ScriptedRng): GameState {
  const o = s.pending!.options!.find((x) => x.id.startsWith(prefix))
  if (!o) throw new Error(`no option starting ${prefix} in ${s.pending!.kind}: ${s.pending!.options!.map((x) => x.id).join(', ')}`)
  return expectOk(step(s, o.action, rng)).state
}

export function pathTo(s: GameState, x: number, z: number, rng?: ScriptedRng): GameState {
  const p = s.pending!
  return expectOk(step(s, act.path(p, [{ x, z }]), rng)).state
}

/** Passes every ploy window; picks nothing unless `use` names the ploy option id. */
export function ployAnswer(use?: string): (p: PendingDecision) => ReturnType<typeof act.pass> | NonNullable<PendingDecision['options']>[number]['action'] {
  return (p) => (use && p.options?.find((o) => o.id === use)?.action) || act.pass(p)
}

/**
 * Answer decisions until the next action decision or the ploy window after an action, passing every other ploy window.
 * `events` collects what happened on the way.
 */
export function playToActionEnd(s0: GameState, rng: ScriptedRng, answers: Parameters<typeof play>[2] = {}): { state: GameState; events: ReturnType<typeof play>['events'] } {
  let r = play(s0, rng, answers, ['firefight.action', 'ploy.firefight'])
  const events = [...r.events]
  while (r.state.pending?.kind === 'ploy.firefight' && r.state.pending.window !== 'firefight.actionEnded') {
    r = play(passIt(r.state, rng).state, rng, answers, ['firefight.action', 'ploy.firefight'])
    events.push(...r.events)
  }
  return { state: r.state, events }
}

// ---------------------------------------------------------------------------
// Scenarios used by the tests and the hook firing checks
// ---------------------------------------------------------------------------

/** Hiding Warrior A emerges in the activation at the first spot offered. Returns the state after the choice. */
export function emerged(s: GameState, id: string, order: 'engage' | 'conceal' = 'engage'): GameState {
  let t = activateOp(s, id)
  t = take(t, 'ability:wyr.a.emerge').state
  expect(t.pending!.kind).toBe('ability.choice')
  return takeStarting(t, order)
}

/** Locus A at (-3,0) with an Engage order; an enemy Boy dashes to end `gap` inches from it. Returns the state at the reaction. */
export function dashNearLocus(s0: GameState, gap = 2.5, order: 'engage' | 'conceal' = 'engage'): { s: GameState; locus: string; boy: string } {
  const locus = opOf(s0, 'A', 'wyr.locus')
  const boy = opOf(s0, 'B', 'kom.boy')
  const end = -3 + 0.63 * 2 + gap
  let s = edit(place(place(s0, locus, -3, 0), boy, end + 3, 0), (st) => {
    st.operatives[locus]!.order = order
  })
  s = bTurn(s)
  s = take(activateOp(s, boy), 'dash').state
  s = pathTo(s, end, 0)
  return { s, locus, boy }
}

/** The Talon (Conceal, at -6,0), the Boy at the origin and the Sniper at -3.2,0 standing between them, so the Boy cannot see the Talon. */
export function talonAmbush(s0: GameState): { s: GameState; talon: string; boy: string; blocker: string } {
  const talon = opOf(s0, 'A', 'wyr.sanctus-talon')
  const boy = opOf(s0, 'B', 'kom.boy')
  const blocker = opOf(s0, 'A', 'wyr.sanctus-sniper')
  const s = edit(place(place(place(s0, talon, -6, 0), boy, 0, 0), blocker, -3.2, 0), (st) => {
    st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
    st.operatives[talon]!.wounds = st.operatives[talon]!.maxWounds = 30
  })
  return { s, talon, boy, blocker }
}

/** Kelermorph A at (-2,0), Warrior at (-3.2,0) behind it; the shooter B at (4.5,0) declares Shoot and picks the Kelermorph. */
export function loyaltyShot(s0: GameState, shooterCard = 'kom.boy'): { s: GameState; kel: string; neo: string; boy: string } {
  const kel = opOf(s0, 'A', 'wyr.kelermorph')
  const neo = idsOf(s0, 'A', 'wyr.warrior')[0]!
  const boy = opOf(s0, 'B', shooterCard)
  let s = edit(place(place(place(s0, kel, -2, 0), neo, -3.2, 0), boy, 4.5, 0), (st) => {
    st.players.A.cp = 2
  })
  s = bTurn(s)
  s = take(activateOp(s, boy), 'shoot').state
  s = take(s, s.pending!.options![0]!.id).state
  s = take(s, kel).state
  return { s, kel, neo, boy }
}

/** Icon Bearer, a 1-wound Warrior and an enemy Boy that shoots the Warrior dead; returns the state at the before-removal choice. */
export function warriorShotDead(s0: GameState): { s: GameState; icon: string; warrior: string; boy: string } {
  const icon = opOf(s0, 'A', 'wyr.icon-bearer')
  const warrior = idsOf(s0, 'A', 'wyr.warrior')[0]!
  const boy = opOf(s0, 'B', 'kom.boy')
  let s = edit(place(place(place(s0, icon, -4.5, 2.5), warrior, -4.5, 0), boy, 3, 0), (st) => {
    st.operatives[warrior]!.wounds = 1
  })
  s = bTurn(s)
  s = take(activateOp(s, boy), 'shoot').state
  s = take(s, s.pending!.options![0]!.id).state
  const rng = dice(6, 6, 6, 6, 1, 1, 1)
  s = expectOk(step(s, s.pending!.options!.find((o) => o.id === warrior)!.action, rng)).state
  s = play(s, rng, { 'ploy.firefight': (p) => act.pass(p) }, ['ability.choice', 'firefight.action']).state
  return { s, icon, warrior, boy }
}

/** The strategy phase with A to pick a gambit and 2 CP. */
export function toGambit(o: RealOpts = {}): GameState {
  const g = drive(newRealGame({ teams: TEAMS, ...o }, 'wyr-gambit').state, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
  return edit(g, (st) => {
    st.players.A.cp = 2
    // open ground, everyone parked in the far corners
    st.map = { ...st.map, features: [] }
    let a = 0
    let b = 0
    for (const op of Object.values(st.operatives)) op.pos = op.seat === 'A' ? { x: -13.5, y: 0, z: -10 + a++ * 1.7 } : { x: 13.5, y: 0, z: -10 + b++ * 1.7 }
    st.markers = st.markers.filter((m) => m.kind === 'objective')
    st.equipment.placed = []
  })
}

export const scenarios: Record<string, () => void> = {
  shadowVector() {
    wyr()
  },
  emerge() {
    const s = hide(wyr(), idsOf(wyr(), 'A', 'wyr.warrior')[0]!)
    emerged(s, idsOf(s, 'A', 'wyr.warrior')[0]!)
  },
  targetVulnerability() {
    const s = agents()
    const sn = opOf(s, 'A', 'wyr.sanctus-sniper')
    take(activateOp(s, sn), 'ability:wyr.a.target-vulnerability')
  },
  soulsight() {
    const s = agents()
    const sn = opOf(s, 'A', 'wyr.sanctus-sniper')
    const boy = opOf(s, 'B', 'kom.boy')
    take(activateOp(s, sn), `ability:wyr.a.familiars-soulsight-sniper:${boy}`)
  },
  assassinate() {
    const { s, talon, boy } = talonAmbush(agents())
    take(activateOp(s, talon, 'conceal'), `ability:wyr.a.assassinate:${boy}`)
  },
  quicksilverStrike() {
    const { s } = dashNearLocus(wyr())
    take(s, 'react:0')
  },
  planGenerations() {
    // the Overthrow choice answers through this hook; the ploy itself is played from the incapacitation window
    const { s } = warriorShotDead(wyr())
    take(s, 'overthrow-shoot', dice())
  },
  overthrowOppressors() {
    const { s } = warriorShotDead(wyr())
    take(s, 'overthrow-shoot', dice())
  },
  tpFlagPloy() {
    take(toGambit(), 'wyr.p.crossfire')
  },
  divertAndDisappear() {
    take(toGambit(), 'wyr.p.divert-and-disappear')
  },
  slinkIntoDarkness() {
    const s = wyr()
    const w = idsOf(s, 'A', 'wyr.icon-bearer')[0]!
    const t = take(activateOp(place(s, w, -13.5, 0), w), 'end').state
    expect(t.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.activationEnded' })
    take(t, 'wyr.p.slink-into-darkness')
  },
  coiledSerpent() {
    const s = wyr()
    const w = idsOf(s, 'A', 'wyr.gunner-webber')[0]!
    const boy = opOf(s, 'B', 'kom.boy')
    let t = edit(place(place(s, w, -4, 0), boy, 2, 0), (st) => {
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
    })
    t = take(activateOp(t, w, 'engage'), 'shoot').state
    t = take(t, t.pending!.options![0]!.id).state
    const rng = dice(4, 4, 1, 1)
    t = expectOk(step(t, t.pending!.options!.find((o) => o.id === boy)!.action, rng)).state
    play(t, rng, { 'ploy.firefight': (p) => p.options?.find((o) => o.id === 'wyr.p.coiled-serpent')?.action ?? act.pass(p) })
  },
  unquestioningLoyalty() {
    const { s, neo } = loyaltyShot(wyr())
    take(s, `wyr.p.unquestioning-loyalty:${neo}`)
  },
}

