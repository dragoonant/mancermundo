// hearthkyn-salvagers code-hook firing scenarios, merged into tests/engine/code-hooks.test.ts (which proves every hook the
// data names fires in a real game). One entry per hook name this team's data uses. Owned by the team implementer.
// The helpers are exported for tests/engine/teams/hearthkyn-salvagers.test.ts.
import { expect } from 'vitest'
import { act } from '@/engine/actions'
import { attackStats, inflict, runDeferredRemovals } from '@/engine/attack-common'
import { queueRemoval, removeNow } from '@/engine/effects'
import { markerControl } from '@/engine/query'
import { ScriptedRng } from '@/engine/rng'
import { providerCanFly, providerCostDelta, providerMoveSurcharge } from '@/engine/team-rules'
import { GRUDGE } from '@/engine/teams/hearthkyn-salvagers'
import { tokenCount } from '@/engine/tokens'
import type { GameState } from '@/engine/types'
import { play } from '../../fixtures/attack'
import { drive, place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { activateOp, edit, newRealGame, openReal, opOf, roster, take, withCtx, type RealOpts } from '../../fixtures/real'

/**
 * Rule damage that incapacitates `id` outside an attack (mines, direct damage): the removal waits for the end-of-step
 * queue (attack-common.runDeferredRemovals), where a before-removal decision such as Medic! is asked.
 */
export function ruleKill(s: GameState, id: string, by: string, amount = 99, source = 'direct'): GameState {
  return withCtx(s, (ctx) => {
    inflict(ctx, { targetId: id, attackerId: by, weaponId: null, amount, source })
    queueRemoval(ctx, id)
    runDeferredRemovals(ctx)
  }).state
}

export const ALL_HK = [
  'hk.theyn',
  'hk.dozr',
  'hk.field-medic',
  'hk.grenadier',
  'hk.gunner-plasma-beamer',
  'hk.gunner-auto-rifle',
  'hk.gunner-rotary-cannon',
  'hk.gunner-missile-launcher',
  'hk.gunner-rail-rifle',
  'hk.jump-pack-warrior',
  'hk.kinlynk',
  'hk.kognitaar',
  'hk.lokatr',
  'hk.lugger',
  'hk.warrior',
]

export function hkOpts(o: RealOpts = {}): RealOpts {
  return { teams: ['hearthkyn-salvagers', 'kommandos'], rosterA: roster(ALL_HK), ...o }
}

/** Every operative parked in a tidy grid at its own end of an open killzone, all on Engage; tests then place who they need. */
function park(s: GameState): GameState {
  return edit(s, (st) => {
    let a = 0
    let b = 0
    for (const op of Object.values(st.operatives)) {
      const i = op.seat === 'A' ? a++ : b++
      const col = i % 3
      const row = Math.floor(i / 3)
      op.pos = { x: op.seat === 'A' ? -13.5 + col * 1.8 : 13.5 - col * 1.8, y: 0, z: -10 + row * 1.7 }
      op.order = 'engage'
    }
  })
}

/** Hearthkyn Salvagers (A, all fifteen datacards) against the default Kommandos (B), open ground, A to activate. */
export function hkOpen(o: RealOpts = {}): GameState {
  return park(openReal(hkOpts(o), 'hk-open'))
}

export const A = (s: GameState, id: string): string => opOf(s, 'A', id)
export const B = (s: GameState, id: string): string => opOf(s, 'B', id)

/** Activate (Engage, ploy windows passed) and take one option. */
export function go(s: GameState, who: string, optionId: string, rng?: ScriptedRng): GameState {
  return take(activateOp(s, who), optionId, rng).state
}

export function dice(...values: number[]): ScriptedRng {
  return new ScriptedRng([...values, ...Array<number>(80).fill(1)])
}

/** The strategy phase with A to pick a gambit (A holds initiative, 2 CP), open ground, everyone parked. */
export function toGambit(o: RealOpts = {}): GameState {
  const g = drive(newRealGame(hkOpts(o), 'hk-gambit').state, (st) => st.pending?.kind === 'strategy.gambit', 1200, new ScriptedRng([6, 1, 6, 1]))
  return edit(g, (st) => {
    st.players.A.cp = 2
    st.map = { ...st.map, features: [] }
    let a = 0
    let b = 0
    for (const op of Object.values(st.operatives)) {
      const i = op.seat === 'A' ? a++ : b++
      op.pos = { x: op.seat === 'A' ? -13.5 + (i % 3) * 1.8 : 13.5 - (i % 3) * 1.8, y: 0, z: -10 + Math.floor(i / 3) * 1.7 }
    }
    st.markers = st.markers.filter((m) => m.kind === 'objective')
    st.equipment.placed = []
  })
}

/** An effect the way a ploy would leave it (for rules that read ploy flags). */
export function withEffect(s: GameState, source: string, seat: 'A' | 'B', extra: { operativeId?: string; expires?: string; data?: Record<string, unknown>; kind?: string } = {}): GameState {
  return edit(s, (st) => {
    st.effects.push({ id: `e${st.nextEffect++}`, source, seat, kind: extra.kind ?? 'ployFlag', expires: extra.expires ?? 'turningPoint', ...(extra.operativeId ? { operativeId: extra.operativeId } : {}), ...(extra.data ? { data: extra.data } : {}) })
  })
}

/** A Grudge token of seat A on an enemy. */
export function withGrudge(s: GameState, id: string, count = 1): GameState {
  return edit(s, (st) => {
    st.operatives[id]!.tokens = [{ kind: GRUDGE, owner: 'A', count, since: 0 }]
  })
}

export function withTerrain(s: GameState, ...features: ReturnType<typeof feature>[]): GameState {
  return edit(s, (st) => {
    st.map = { ...st.map, features }
  })
}

/** A wall of the given traits between x0 and x1 across the lane. */
export function wall(x0: number, x1: number, traits: ('heavy' | 'light')[], height = 0.5): ReturnType<typeof feature> {
  return feature('hk-wall', part('hk-wall.a', rect(x0, x1, -4, 4), height, traits))
}

/** A's first operative has acted and ended: the next activation is B's. */
export function bTurn(s: GameState, ender: string): GameState {
  return take(activateOp(s, ender), 'end').state
}

/** The attack-roll record of the latest Shoot or Fight in a played sequence. */
export function lastRetained(events: { type: string }[]): { normal: number; crit: number; obscured: boolean } {
  const e = [...events].reverse().find((x) => x.type === 'AttackRetained') as { normal: number; crit: number; obscured: boolean } | undefined
  if (!e) throw new Error('no AttackRetained event')
  return e
}

const noPloys = { 'ploy.firefight': (p: { seat: 'A' | 'B'; id: string }) => act.pass(p) }

/** A shoots B's Boy with `weapon`, dice scripted, ploy windows passed; returns the played sequence. */
export function shootAt(s: GameState, shooter: string, weapon: string, target: string, rng: ScriptedRng, answers: Parameters<typeof play>[2] = noPloys) {
  let t = take(take(activateOp(s, shooter), 'shoot').state, weapon).state
  if (t.pending?.kind === 'shoot.target') t = take(t, target, rng).state
  return play(t, rng, answers)
}

/** Worth It: the Warrior on an objective in turning point 2 is shot dead; the incapacitation window offers the free mission action. */
export function worthItOffer(): { s: GameState; warrior: string } {
  const s0 = edit(hkOpen(), (st) => {
    st.turningPoint = 2
    st.players.A.cp = 2
  })
  const w = A(s0, 'hk.warrior')
  const boy = B(s0, 'kom.boy')
  const m = s0.markers.find((k) => k.kind === 'objective')!
  let s = edit(place(place(s0, w, m.pos.x + 0.6, m.pos.z), boy, m.pos.x + 6, m.pos.z), (st) => {
    st.operatives[w]!.wounds = 1
  })
  s = bTurn(s, A(s, 'hk.kinlynk'))
  s = take(take(activateOp(s, boy), 'shoot').state, 'kom.w.slugga').state
  if (s.pending?.kind === 'shoot.target') s = take(s, w, dice(6, 6, 6, 6, 1, 1, 1)).state
  const r = play(s, dice(6, 6, 6, 6, 1, 1, 1), { 'ploy.firefight': (p) => (p.window === 'operative.incapacitated' ? p.options!.find((o) => o.id === 'hk.p.worth-it')!.action : act.pass(p)) })
  expect(r.state.pending?.kind).toBe('firefight.action')
  expect(r.state.firefight.activation?.operativeId).toBe(w)
  return { s: r.state, warrior: w }
}

/** Sturdy: the Boy shoots a Hearthkyn Warrior and rolls a crit; the defender's window turns it into a normal. */
export function sturdyShot(): { s: GameState; events: { type: string }[] } {
  const s0 = hkOpen()
  const w = A(s0, 'hk.warrior')
  const boy = B(s0, 'kom.boy')
  let s = bTurn(place(place(s0, w, -3, 4), boy, 3, 4), A(s0, 'hk.kinlynk'))
  s = take(take(activateOp(s, boy), 'shoot').state, 'kom.w.slugga').state
  if (s.pending?.kind === 'shoot.target') s = take(s, w, dice(6, 4, 4, 1, 1, 1, 1)).state
  const r = play(s, dice(6, 4, 4, 1, 1, 1, 1), { 'ploy.firefight': (p) => p.options?.find((o) => o.id === 'hk.p.sturdy')?.action ?? act.pass(p) })
  return { s: r.state, events: r.events }
}

/** Engage to Acquire: the Warrior shoots a Boy that does (or does not) hold an objective; returns the state after the target is picked. */
export function engageStart(controls: boolean): GameState {
  const s0 = hkOpen()
  const w = A(s0, 'hk.warrior')
  const boy = B(s0, 'kom.boy')
  const m = s0.markers.find((k) => k.kind === 'objective')!
  const s = place(place(s0, w, m.pos.x - 7, m.pos.z), boy, controls ? m.pos.x + 0.6 : m.pos.x - 3, controls ? m.pos.z : m.pos.z + 6)
  let t = take(take(activateOp(s, w), 'shoot').state, 'hk.w.autoch-bolter').state
  if (t.pending?.kind === 'shoot.target') t = take(t, boy, dice(2, 2, 2, 2)).state
  return t
}

/** Engage to Acquire: the Boy holds an objective; the Warrior's Shoot opens the re-roll window and the ploy grants it. */
export function engageWindow(): GameState {
  const t = engageStart(true)
  expect(t.pending).toMatchObject({ kind: 'ploy.firefight', window: 'shoot.beforeAttackRerolls' })
  const u = take(t, 'hk.p.engage-to-acquire').state
  expect(u.pending?.kind).toBe('dice.reroll')
  return u
}

/** Writ of Claim: A holds `held` objectives at the initiative roll-off, rolls low and is offered the re-roll; returns the state after the offer. */
export function writOffer(held: number): GameState {
  const first = newRealGame(hkOpts({ equipmentA: ['hk.e.writ-of-claim'] }), 'hk-writ').state
  let s = drive(first, (st) => st.pending?.kind === 'strategy.initiative', 1200, new ScriptedRng([6, 1, 6, 1]))
  s = edit(s, (st) => {
    const objs = st.markers.filter((k) => k.kind === 'objective')
    const who = [A(s, 'hk.warrior'), A(s, 'hk.lugger')]
    for (let i = 0; i < held; i++) st.operatives[who[i]!]!.pos = { x: objs[i]!.pos.x + 0.6, y: 0, z: objs[i]!.pos.z }
  })
  s = take(s, 'roll', dice(1)).state
  return take(s, 'roll', dice(6)).state
}

/** Writ of Claim: two objectives held, A rolls low, takes the re-roll. */
export function writReroll(): GameState {
  const s = writOffer(2)
  expect(s.pending?.context.reroll).toBe(true)
  return take(s, 'reroll', dice(5)).state
}

export const scenarios: Record<string, () => void> = {
  hkGrudge() {
    const s = hkOpen()
    const w = A(s, 'hk.warrior')
    const boy = B(s, 'kom.boy')
    const r = withCtx(s, (ctx) => {
      ctx.state.operatives[w]!.wounds = 1
      inflict(ctx, { targetId: w, attackerId: boy, weaponId: 'kom.w.slugga', amount: 3, source: 'normal' })
      removeNow(ctx, w)
    })
    expect(tokenCount(r.state, boy, GRUDGE, 'A')).toBe(1)
  },
  eyeOfTheAncestors() {
    const g = toGambit()
    const boy = B(g, 'kom.boy')
    const t = take(g, `hk.p.eye-of-the-ancestors:${boy}`).state
    expect(tokenCount(t, boy, GRUDGE, 'A')).toBe(1)
  },
  hkBeam() {
    const s = hkOpen()
    const g = A(s, 'hk.gunner-plasma-beamer')
    const boy = B(s, 'kom.boy')
    const rear = B(s, 'kom.dakka-boy')
    const t = edit(place(place(place(s, g, 0, 0), boy, 5, 0), rear, 8, 0), (st) => {
      st.operatives[rear]!.wounds = st.operatives[rear]!.maxWounds = 40
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
    })
    const r = shootAt(t, g, 'hk.w.etacarn-plasma-beamer', boy, dice(6, 6, 4, 4, 1, 1, 1, 6, 6, 6, 6, 6))
    expect(r.state.operatives[rear]!.wounds).toBeLessThan(40)
  },
  hkForceImpact() {
    const s = hkOpen()
    const j = A(s, 'hk.jump-pack-warrior')
    const boy = B(s, 'kom.boy')
    const t = withEffect(activateOp(place(place(s, j, 0, 0), boy, 1.3, 0), j), 'hk.a.jump-pack', 'A', { kind: 'hk.charged', operativeId: j, expires: 'activation' })
    const rules = attackStats(t, j, 'hk.w.plasma-weapon-jpw', boy, { kind: 'fight' }).rules
    expect(rules.brutal).toBe(true)
  },
  weavefieldCrest() {
    const s = hkOpen()
    const th = A(s, 'hk.theyn')
    const boy = B(s, 'kom.boy')
    const r = withCtx(
      edit(s, (st) => {
        st.operatives[th]!.wounds = 3
      }),
      (ctx) => {
        inflict(ctx, { targetId: th, attackerId: boy, weaponId: 'kom.w.slugga', amount: 3, source: 'normal' })
      },
    )
    expect(r.state.operatives[th]!.wounds).toBe(3)
  },
  hkBrawler() {
    const s = hkOpen()
    const dozr = A(s, 'hk.dozr')
    const boy = B(s, 'kom.boy')
    const r = withCtx(s, (ctx) => {
      inflict(ctx, { targetId: dozr, attackerId: boy, weaponId: 'kom.w.choppa', amount: 4, source: 'strike-normal' })
    })
    expect(r.state.operatives[dozr]!.wounds).toBe(s.operatives[dozr]!.wounds - 3)
  },
  knuxSmash() {
    const s = hkOpen()
    const d = A(s, 'hk.dozr')
    const boy = B(s, 'kom.boy')
    const t = go(place(place(s, d, 0, 0), boy, 1.3, 0), d, `ability:hk.a.knux-smash:${boy}`)
    expect(t.pending?.kind).toBe('ability.choice')
    take(t, 'stay', dice(5))
  },
  hkMedic() {
    const s = hkOpen()
    const v = A(s, 'hk.warrior')
    const m = A(s, 'hk.field-medic')
    const boy = B(s, 'kom.boy')
    // the removal waits for the before-removal queue, where the owner takes Medic!
    const asked = ruleKill(place(place(place(s, v, 0, 0), m, 2, 0), boy, 6, 0), v, boy)
    expect(asked.pending).toMatchObject({ kind: 'ability.choice', context: { hook: 'hkMedic', operativeId: v } })
    expect(take(asked, 'save').state.operatives[v]).toMatchObject({ status: 'active', wounds: 1 })
  },
  hkMedikit() {
    const s = edit(hkOpen(), (st) => {
      Object.values(st.operatives).find((o) => o.seat === 'A' && o.datacardId === 'hk.warrior')!.wounds = 3
    })
    const m = A(s, 'hk.field-medic')
    const w = A(s, 'hk.warrior')
    const t = go(place(place(edit(s, (st) => (st.operatives[w]!.wounds = 1)), m, 0, 0), w, 1.5, 0), m, `ability:hk.a.medikit:${w}`, new ScriptedRng([4, 6]))
    expect(t.operatives[w]!.wounds).toBe(6)
  },
  hkGrenadier() {
    // set-up gives the Grenadier its own frag and krak grenades; frag is 3+ for it
    const s = hkOpen()
    const g = A(s, 'hk.grenadier')
    expect(s.operatives[g]!.weapons).toContain('core.w.frag-grenade')
    expect(attackStats(s, g, 'core.w.frag-grenade', B(s, 'kom.boy'), { kind: 'shoot' }).need).toBe(3)
  },
  hkUtilityGrenade() {
    const s = hkOpen()
    const g = A(s, 'hk.grenadier')
    const boy = B(s, 'kom.boy')
    const t = go(place(place(s, g, 0, 0), boy, 5, 0), g, 'ability:hk.a.utility-grenade')
    expect(t.pending?.kind).toBe('ability.choice')
    const u = take(t, t.pending!.options![0]!.id).state
    expect(u.markers.some((m) => m.equipmentId === 'hk.utility-grenade')).toBe(true)
    // either side pays 1 more AP for a mission action next to it
    const near = u.markers.find((m) => m.equipmentId === 'hk.utility-grenade')!
    const w = place(u, A(u, 'hk.warrior'), near.pos.x + 1, near.pos.z)
    expect(providerCostDelta(w, w.operatives[A(w, 'hk.warrior')]!, 'marker:pickUp')).toBe(1)
  },
  hkJumpPack() {
    const s = hkOpen()
    expect(providerCanFly(s, s.operatives[A(s, 'hk.jump-pack-warrior')]!, 'reposition')).toBe(true)
    expect(providerCanFly(s, s.operatives[A(s, 'hk.warrior')]!, 'reposition')).toBe(false)
  },
  hkSignal() {
    const s = hkOpen()
    const k = A(s, 'hk.kinlynk')
    const th = A(s, 'hk.theyn')
    const t = go(place(place(s, k, 0, 0), th, 12, 5), k, `ability:hk.a.signal:${th}`)
    expect(t.operatives[th]!.aplMods).toBe(1)
  },
  hkSystemJam() {
    const s = hkOpen()
    const k = A(s, 'hk.kinlynk')
    const boy = B(s, 'kom.boy')
    const t = go(place(place(s, k, 0, 0), boy, 7, 0), k, `ability:hk.a.system-jam:${boy}`)
    expect(tokenCount(t, boy, 'hk.system-jam', 'A')).toBe(1)
  },
  hkTactician() {
    const g = toGambit()
    const t = take(g, 'hk.p.tactician:attack').state
    expect(t.pending?.kind).toBe('ability.choice')
    const u = take(t, t.pending!.options![0]!.id).state
    expect(u.markers.some((m) => m.equipmentId === 'hk.attack-marker')).toBe(true)
  },
  acceleratedAppraisal() {
    const s = hkOpen()
    const k = A(s, 'hk.kognitaar')
    const t = go(s, k, 'ability:hk.a.accelerated-appraisal:defence')
    const u = take(t, t.pending!.options![0]!.id).state
    expect(u.markers.some((m) => m.equipmentId === 'hk.defence-marker')).toBe(true)
  },
  hkSpot() {
    const s = hkOpen()
    const l = A(s, 'hk.lokatr')
    const boy = B(s, 'kom.boy')
    const t = go(place(place(s, l, 0, 0), boy, 7, 0), l, `ability:hk.a.spot:${boy}`)
    expect(tokenCount(t, boy, 'hk.spot', 'A')).toBe(1)
  },
  panSpectralScan() {
    const s = hkOpen()
    const l = A(s, 'hk.lokatr')
    const t = go(s, l, 'ability:hk.a.pan-spectral-scan')
    const u = take(t, t.pending!.options![0]!.id).state
    expect(u.markers.some((m) => m.equipmentId === 'hk.pan-spectral-scan')).toBe(true)
  },
  hkWellSupplied() {
    const s = hkOpen()
    // the Lugger's player starts the battle with 1 more CP than the other
    expect(s.players.A.cp).toBe(s.players.B.cp + 1)
  },
  secureSalvage() {
    // the Warrior contests the objective and takes 1 less from the first damaging success of an attack
    const s = hkOpen()
    const w = A(s, 'hk.warrior')
    const boy = B(s, 'kom.boy')
    const m = s.markers.find((k) => k.kind === 'objective')!
    const t = bTurn(place(place(s, w, m.pos.x + 0.6, m.pos.z), boy, m.pos.x + 6, m.pos.z), A(s, 'hk.kinlynk'))
    const r = shootAt(t, boy, 'kom.w.slugga', w, dice(6, 4, 4, 4, 1, 1, 1))
    const dmg = r.events.filter((e) => e.type === 'DamageInflicted').map((e) => (e as unknown as { amount: number }).amount)
    expect(dmg[0]).toBe(3)
  },
  needKeeps() {
    const g = toGambit()
    const m = g.markers.find((k) => k.kind === 'objective')!
    const t = take(g, `hk.p.need-keeps:${m.id}`).state
    expect(t.effects.some((e) => e.source === 'hk.p.need-keeps')).toBe(true)
    // a Hearthkyn operative contesting it counts 1 higher
    const w = A(t, 'hk.warrior')
    const u = place(t, w, m.pos.x + 0.6, m.pos.z)
    expect(markerControl(u, m).apl.A).toBe(u.operatives[w]!.apl + 1)
  },
  toilEarns() {
    const g = toGambit()
    const m = g.markers.find((k) => k.kind === 'objective')!
    const t = take(g, `hk.p.toil-earns:${m.id}`).state
    expect(t.effects.some((e) => e.source === 'hk.p.toil-earns')).toBe(true)
  },
  wroughtDefence() {
    take(toGambit(), 'hk.p.wrought-defence')
  },
  proximateFirepower() {
    const t = take(toGambit(), 'hk.p.proximate-firepower').state
    const w = A(t, 'hk.warrior')
    const boy = B(t, 'kom.boy')
    const u = place(place(t, w, 0, 0), boy, 5, 0)
    expect(attackStats(u, w, 'hk.w.autoch-bolter', boy, { kind: 'shoot' }).need).toBe(3)
  },
  ancestorsAreWatching() {
    const s = hkOpen()
    const w = A(s, 'hk.warrior')
    const boy = B(s, 'kom.boy')
    let t = take(take(place(place(s, w, 0, 0), boy, 6, 0), w).state, 'engage').state
    expect(t.pending?.kind).toBe('ploy.firefight')
    t = take(t, 'hk.p.the-ancestors-are-watching:shoot').state
    expect(t.firefight.activation?.frame).toBeDefined()
  },
  hkWorthIt() {
    worthItOffer()
  },
  hkSturdy() {
    sturdyShot()
  },
  engageToAcquire() {
    engageWindow()
  },
  hkClimbingRigs() {
    // a move in the warrior's own activation (the rigs work only there)
    const open = hkOpen({ equipmentA: ['hk.e.climbing-rigs'] })
    const s = activateOp(open, A(open, 'hk.warrior'))
    const w = s.operatives[A(s, 'hk.warrior')]!
    expect(providerMoveSurcharge(s, w, 'reposition', [], { horizontal: 2, accessible: 0, climb: 4, drop: 0 })).toBe(-2)
  },
  hkExcavationTools() {
    const s = hkOpen({ equipmentA: ['hk.e.excavation-tools'] })
    expect(providerCostDelta(s, s.operatives[A(s, 'hk.warrior')]!, 'marker:pickUp')).toBe(-1)
  },
  hkWritOfClaim() {
    writReroll()
  },
}

