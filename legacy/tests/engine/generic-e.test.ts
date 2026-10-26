// Batch D engine prep (docs/spec/12-rules-test-checklist.md GEN-099 onwards): the generic capabilities the batch D
// teams (Blooded, Fellgor Ravagers, Chaos Cult, Goremongers, Scout Squad, Tempestus Aquilons, Exaction Squad) need.
// Throwaway providers, hooks and ploys are removed after each test.
import { afterEach, describe, expect, it } from 'vitest'
import { step } from '@/engine'
import { act } from '@/engine/actions'
import { attackStats, banGrantValues } from '@/engine/attack-common'
import { snapshotData } from '@/engine/bundle'
import { registerCodeHook } from '@/engine/code-hooks'
import { directDamage } from '@/engine/effects'
import { startFreeAction } from '@/engine/firefight'
import { registerFrameResume, registerHook, unregisterHook, type AttackHookName, type HookName } from '@/engine/hooks'
import { killsSince, scoreAsIncapacitated } from '@/engine/kills'
import { markerOffers, updateControl } from '@/engine/markers'
import { incapacitateOffboard, placementSpots } from '@/engine/reserve'
import { ScriptedRng } from '@/engine/rng'
import { preBattleChoiceDone } from '@/engine/setup'
import { effectiveApl } from '@/engine/state'
import { registerTeamRules, unregisterTeamRules, type TeamRuleProvider } from '@/engine/team-rules'
import { transformOperative } from '@/engine/transform'
import type { GameState, RerollGrant, RuntimeDatacard } from '@/engine/types'
import { runHook } from '@/engine/hooks'
import { evs } from '../fixtures/attack'
import { defaultAnswer, expectOk, place } from '../fixtures/helpers'
import { feature, part, rect } from '../fixtures/maps'
import { activateOp, edit, newRealGame, openReal, opOf, passIt, realBundle, take, withCtx } from '../fixtures/real'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})
function provide(p: Omit<TeamRuleProvider, 'id'>): void {
  registerTeamRules({ id: 'test.provider-e', ...p })
  cleanups.push(() => unregisterTeamRules('test.provider-e'))
}
function hook(name: HookName | AttackHookName, fn: Parameters<typeof registerHook>[1]): void {
  registerHook(name, fn, `test-e.${name}`)
  cleanups.push(() => unregisterHook(name, `test-e.${name}`))
}
/** Open map, A to activate: A's Intercessor Warrior and Captain, B's Boy and Grot. */
function open(): { s: GameState; w: string; cap: string; boy: string; grot: string } {
  const s = openReal()
  return { s, w: opOf(s, 'A', 'aod.intercessor-warrior'), cap: opOf(s, 'A', 'aod.space-marine-captain'), boy: opOf(s, 'B', 'kom.boy'), grot: opOf(s, 'B', 'kom.grot') }
}
function withPloy(s: GameState, ploy: Record<string, unknown>): GameState {
  return edit(s, (x) => {
    x.data.ploys = { ...(x.data.ploys ?? {}), [ploy.id as string]: ploy as never }
  })
}
const ploy = (id: string, team: string, window: string | string[]) => ({ id, name: id, team, type: 'firefight', cost: 0, window, effect: { cp: 1 }, text: 't', source: 's' })
function facing(s: GameState, w: string, boy: string): GameState {
  return edit(s, (x) => {
    x.operatives[w]!.pos = { x: 0, y: 0, z: -4 }
    x.operatives[boy]!.pos = { x: 0, y: 0, z: 4 }
  })
}
/** Drive a Shoot of `w` at `boy` with dice all `die`, answering defaults, until `stop` holds; ploy windows seen. */
function shootUntil(s0: GameState, w: string, boy: string, stop: (s: GameState) => boolean, die = 4) {
  let st = take(activateOp(s0, w), 'shoot').state
  const rng = new ScriptedRng(Array(80).fill(die))
  const seen: string[] = []
  for (let i = 0; i < 40 && st.pending && st.pending.kind !== 'firefight.action' && !stop(st); i++) {
    const p = st.pending
    if (p.kind === 'ploy.firefight') seen.push(`${p.seat}:${p.window}`)
    // no ploys, no Command Re-rolls: only the windows under test matter
    let a = (p.kind === 'ploy.firefight' || p.kind === 'dice.commandReroll') && p.canPass ? act.pass(p) : defaultAnswer(st)
    if (p.kind === 'shoot.target') a = p.options!.find((o) => o.id === boy)?.action ?? a
    st = expectOk(step(st, a, rng)).state
  }
  return { st, seen }
}
/** A copy of a datacard as a non-selectable form to change into (Chaos Cult Torment style). */
function formOf(s: GameState, fromId: string, patch: Partial<RuntimeDatacard>): GameState {
  return edit(s, (x) => {
    const base = x.data.datacards[fromId]!
    x.data.datacards['test.form'] = { ...base, id: 'test.form', name: 'Test Form', selectable: false, ...patch }
  })
}

describe('GEN batch D prep', () => {
  it('GEN-099 transformOperative swaps datacard, stats, weapons and base, keeps wounds lost, identity and equipment weapons; selectable: false cards come with their team', () => {
    const { s, boy, grot } = open()
    const nob = 'kom.boy'
    let st = formOf(s, nob, { wounds: 13, apl: 3, move: 5, baseMm: 40, fixedWeapons: ['kom.w.slugga'], legalLoadouts: [[]] })
    st = edit(place(place(st, boy, 0, 0), grot, 1.4, 0), (x) => {
      const o = x.operatives[boy]!
      o.wounds = o.maxWounds - 3
      o.weapons = [...o.weapons, 'core.w.frag-grenade']
      o.order = 'engage'
      o.ready = false
    })
    const r = withCtx(st, (ctx) => expect(transformOperative(ctx, boy, 'test.form')).toBe(true))
    const o = r.state.operatives[boy]!
    expect(o).toMatchObject({ datacardId: 'test.form', name: 'Test Form', apl: 3, move: 5, maxWounds: 13, wounds: 10, order: 'engage', ready: false, seat: 'B' })
    expect(o.weapons).toEqual(['kom.w.slugga', 'core.w.frag-grenade'])
    expect(o.baseRadius).toBeCloseTo(40 / 25.4 / 2, 3)
    // the bigger base overlapped the Grot: moved to the nearest legal spot
    expect(Math.hypot(o.pos.x - r.state.operatives[grot]!.pos.x, o.pos.z - r.state.operatives[grot]!.pos.z)).toBeGreaterThan(o.baseRadius)
    expect(evs(r.events, 'OperativeTransformed')).toMatchObject([{ type: 'OperativeTransformed', operativeId: boy, from: 'kom.boy', to: 'test.form' }])
    // never incapacitates: more wounds lost than the new card has leaves it on 1
    const low = withCtx(formOf(edit(st, (x) => void (x.operatives[boy]!.wounds = 1)), nob, { wounds: 4 }), (ctx) => transformOperative(ctx, boy, 'test.form'))
    expect(low.state.operatives[boy]!.wounds).toBe(1)
    // unknown card or same card: nothing changes
    expect(withCtx(st, (ctx) => expect(transformOperative(ctx, boy, 'nope')).toBe(false)).events).toEqual([])
    // the snapshot brings a team's selectable: false cards even when no roster lists them
    const bundle = { ...realBundle, datacards: { ...realBundle.datacards, 'test.form': { ...realBundle.datacards[nob]!, id: 'test.form', selectable: false } } }
    expect(Object.keys(snapshotData(bundle, [], ['kommandos']).datacards)).toContain('test.form')
    expect(Object.keys(snapshotData(bundle, [], ['angels-of-death']).datacards)).not.toContain('test.form')
  })

  it('GEN-100 the kill log records every removal with its cause and killer, and operative.removed runs once for each', () => {
    const { s, w, boy, grot } = open()
    const seen: string[] = []
    hook('operative.removed', (c) => (seen.push(`${c.operativeId}:${(c.data as { cause: string }).cause}:${(c.data as { killerId: string | null }).killerId}`), null))
    const r = withCtx(edit(s, (x) => void (x.operatives[boy]!.wounds = 2)), (ctx) => {
      directDamage(ctx, boy, 3, w, 'test')
      updateControl(ctx)
    })
    expect(r.state.kills).toMatchObject([{ removedId: boy, victimSeat: 'B', killerId: w, killerSeat: 'A', cause: 'direct' }])
    expect(seen).toEqual([`${boy}:direct:${w}`])
    // a deadline out of the killzone: no killer
    const aside = edit(s, (x) => {
      x.operatives[grot]!.status = 'reserve'
      x.operatives[grot]!.offboard = 'setAside'
    })
    const off = withCtx(aside, (ctx) => {
      incapacitateOffboard(ctx, grot)
      updateControl(ctx)
    })
    expect(off.state.kills).toMatchObject([{ removedId: grot, cause: 'offboard', killerId: null }])
    // an attack kill: cause attack, killer the shooter
    const shot = shootUntil(facing(edit(s, (x) => void (x.operatives[boy]!.wounds = 1)), w, boy), w, boy, () => false, 6).st
    expect(shot.kills).toMatchObject([{ removedId: boy, cause: 'attack', killerId: w }])
    expect(killsSince(shot, 0).map((k) => k.removedId)).toEqual([boy])
    expect(killsSince(shot, shot.seq + 1)).toEqual([])
  })

  it('GEN-101 scoreAsIncapacitated counts the kill op while the operative stays; its later removal is not counted or logged again', () => {
    const { s, w, boy } = open()
    const seen: string[] = []
    hook('operative.removed', (c) => (seen.push(`${c.operativeId}:${(c.data as { cause: string }).cause}`), null))
    const kills0 = s.mission!.kills.A
    const r = withCtx(s, (ctx) => {
      expect(scoreAsIncapacitated(ctx, boy, w)).toBe(true)
      expect(scoreAsIncapacitated(ctx, boy, w)).toBe(false)
    })
    expect(r.state.operatives[boy]!.status).toBe('active')
    expect(r.state.mission!.kills.A).toBe(kills0 + 1)
    expect(r.state.kills).toMatchObject([{ removedId: boy, cause: 'scored', killerId: w }])
    const later = withCtx(edit(r.state, (x) => void (x.operatives[boy]!.wounds = 1)), (ctx) => {
      directDamage(ctx, boy, 5, w, 'test')
      updateControl(ctx)
    })
    expect(later.state.mission!.kills.A).toBe(kills0 + 1)
    expect(later.state.kills).toHaveLength(1)
    expect(later.state.kills![0]!.removedLater).toBe(true)
    expect(seen).toEqual([`${boy}:scored`])
  })

  it('GEN-102 rerollBannedValues keeps those results out of every re-roll: grants (odds included) and the Command Re-roll', () => {
    const { s, w, boy } = open()
    expect(banGrantValues([{ id: 'g', source: 's', mode: 'any', used: false }], [1])[0]!.values).toEqual([2, 3, 4, 5, 6])
    expect(banGrantValues([{ id: 'g', source: 's', mode: 'any', used: false, values: [1] }], [1])).toEqual([])
    hook('modifyAttackDice', (c) => {
      if (c.operativeId === w) (c.data as { rerolls: RerollGrant[] }).rerolls.push({ id: 'test.g', source: 'test', mode: 'any', used: false })
      return null
    })
    const st = facing(s, w, boy)
    const weapon = st.operatives[w]!.weapons.find((x) => st.data.weapons[x]?.type === 'ranged')!
    expect(attackStats(st, w, weapon, boy, { kind: 'shoot' }).grants.find((g) => g.id === 'test.g')!.values).toBeUndefined()
    provide({ rerollBannedValues: (_st, info) => (info.rollerId === w && !info.defence ? [1] : null) })
    expect(attackStats(st, w, weapon, boy, { kind: 'shoot' }).grants.find((g) => g.id === 'test.g')!.values).toEqual([2, 3, 4, 5, 6])
    // every attack die a 1: nothing can be re-rolled, so no re-roll decision reaches A
    const { st: after } = shootUntil(st, w, boy, (t) => (t.pending?.kind === 'dice.reroll' || t.pending?.kind === 'dice.commandReroll') && t.pending.seat === 'A', 1)
    expect((after.pending?.kind === 'dice.reroll' || after.pending?.kind === 'dice.commandReroll') && after.pending.seat === 'A').toBe(false)
  })

  it('GEN-103 preBattleChoices are asked after set-up and before TP1, seats alternating; a choice may run a free Reposition', () => {
    const asked: string[] = []
    registerCodeHook({
      name: 'test-e.prebattle',
      choice: (ctx, op, option) => {
        asked.push(`${op.seat}:${option}`)
        if (option === 'move') {
          if (!startFreeAction(ctx, { operativeId: op.id, action: 'reposition', resume: 'test-e.prebattle-moved' })) preBattleChoiceDone(ctx)
        } else preBattleChoiceDone(ctx)
      },
    })
    registerFrameResume('test-e.prebattle-moved', (ctx) => preBattleChoiceDone(ctx))
    let left: Record<string, number> = { A: 2, B: 1 }
    provide({
      preBattleChoices: (st, seat) => {
        if (st.setup.step !== 'preBattle' || (left[seat] ?? 0) <= 0) return []
        const op = Object.values(st.operatives).find((o) => o.seat === seat && o.status === 'active')!
        return [{ hook: 'test-e.prebattle', operativeId: op.id, option: seat === 'A' && left.A === 2 ? 'move' : 'pick', labelKey: 'test' }]
      },
    })
    hook('operative.removed', () => null)
    let s = newRealGame({}, 'gen103').state
    const rng = new ScriptedRng([6, 1, 6, 1])
    let moved = false
    for (let i = 0; i < 900 && s.pending?.kind !== 'firefight.activate'; i++) {
      const p = s.pending!
      if (p.kind === 'ability.choice' && p.context.preBattle === true) {
        expect(s.turningPoint).toBe(0)
        left = { ...left, [p.seat]: left[p.seat]! - 1 }
        s = take(s, 'prebattle:0', rng).state
        continue
      }
      if (p.kind === 'move.path' && s.setup.step === 'preBattle') {
        const op = s.operatives[s.firefight.activation!.operativeId]!
        const tx = -Math.sign(op.pos.x) || 1
        const tz = -Math.sign(op.pos.z) || 1
        const tries = [[tx * 2, 0], [tx * 3, 0], [0, tz * 2], [tx * 2, tz * 2], [tx * 3, tz * 3], [tx * 4, 0], [0, tz * 4]]
        const ok = tries.map(([dx, dz]) => step(s, act.path(p, [{ x: op.pos.x + dx!, z: op.pos.z + dz! }]), rng)).find((x) => !x.rejection)
        if (!ok) throw new Error(tries.map(([dx, dz]) => step(s, act.path(p, [{ x: op.pos.x + dx!, z: op.pos.z + dz! }]), rng).rejection?.reason).join(" | ") + JSON.stringify(op.pos))
        s = ok!.state
        moved = true
        continue
      }
      s = expectOk(step(s, defaultAnswer(s), rng)).state
    }
    const first = asked[0]!.split(':')[0]
    expect(first).toBe(s.setup.setupInitiative)
    expect(asked).toHaveLength(3)
    expect(asked.map((x) => x.split(':')[0])).toEqual(first === 'A' ? ['A', 'B', 'A'] : ['B', 'A', 'A'])
    expect(moved).toBe(true)
    expect(s.setup.step).toBe('done')
    expect(s.turningPoint).toBe(1)
  })

  it('GEN-104 ignoreAplDecreases drops APL decreases and keeps increases; refreshFlags runs after every step (live flags)', () => {
    const { s, w } = open()
    let on = false
    provide({ flags: (_st, op) => (op.id === w && on ? { ignoreAplDecreases: true } : null) })
    const st = activateOp(s, w)
    expect(st.operatives[w]!.flags.ignoreAplDecreases).toBeUndefined()
    on = true
    const after = activateOp(s, w)
    expect(after.operatives[w]!.flags.ignoreAplDecreases).toBe(true)
    const stunned = edit(after, (x) => {
      const o = x.operatives[w]!
      o.aplMods = -1
      o.aplFx = [{ delta: -1, source: 'stun' }]
    })
    const op = stunned.operatives[w]!
    expect(effectiveApl(op)).toBe(op.apl)
    expect(effectiveApl({ ...op, aplMods: 0, aplFx: [{ delta: -1, source: 'stun' }, { delta: 1, source: 'signal' }] })).toBe(op.apl + 1)
    expect(effectiveApl({ ...op, flags: { ...op.flags, ignoreAplDecreases: false } })).toBe(op.apl - 1)
  })

  it('GEN-105 extraCoverSaves retains more cover saves (never as crits) when one is retained', () => {
    const { s, boy } = open()
    type D = { value: number | null; kind: 'normal' | 'crit' | 'fail'; tag?: string; rerolled: boolean }
    const dice = (): D[] => [
      { value: null, kind: 'normal', tag: 'cover', rerolled: false },
      { value: 1, kind: 'fail', rerolled: false },
      { value: 2, kind: 'fail', rerolled: false },
    ]
    const run = (d: ReturnType<typeof dice>) => (runHook('afterDefenceRoll', { seat: 'B', state: s, operativeId: boy, data: { kind: 'shoot', dice: d } as never }), d)
    expect(run(dice()).filter((d) => d.tag === 'cover')).toHaveLength(1)
    provide({ extraCoverSaves: (_st, op) => (op.id === boy ? 1 : 0) })
    const got = run(dice())
    expect(got.filter((d) => d.tag === 'cover' && d.kind === 'normal')).toHaveLength(2)
    expect(got.filter((d) => d.kind === 'crit')).toHaveLength(0)
    // no cover save retained: nothing
    const bare = run([{ value: 1, kind: 'fail', rerolled: false }])
    expect(bare.filter((d) => d.tag === 'cover')).toHaveLength(0)
  })

  it('GEN-106 Marker.pickableBy limits Pick Up to one seat', () => {
    const { s, w, boy } = open()
    const st = edit(place(place(s, w, 0, 0), boy, 10, 0), (x) => {
      x.markers.push({ id: 'cad', kind: 'equipment', pos: { x: 0.9, z: 0 }, owner: 'B', carriedBy: null, controller: null, pickable: true, pickableBy: 'B', equipmentId: 'test.cadaver' })
    })
    expect(markerOffers(st, st.operatives[w]!, null).map((o) => o.markerId)).not.toContain('cad')
    const theirs = edit(place(place(st, boy, 0, 0), w, 10, 0), () => undefined)
    expect(markerOffers(theirs, theirs.operatives[boy]!, null).map((o) => o.markerId)).toContain('cad')
  })

  it('GEN-107 firefight.chargeMoved opens for the mover between a Charge move and the end of the action', () => {
    const { s, w, boy } = open()
    const st = place(place(withPloy(s, ploy('test.p.rake', 'angels-of-death', 'firefight.chargeMoved')), w, 0, 0), boy, 4, 0)
    let u = take(activateOp(st, w), 'charge').state
    while (u.pending?.kind === 'ploy.firefight') u = passIt(u).state
    expect(u.pending?.kind).toBe('move.path')
    const moved = expectOk(step(u, act.path(u.pending!, [{ x: 2.2, z: 0 }])))
    expect(moved.state.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'firefight.chargeMoved' })
    expect(evs(moved.events, 'ActionResolved')).toEqual([])
    const end = passIt(moved.state)
    expect(evs(end.events, 'ActionResolved').map((e) => e.action)).toEqual(['charge'])
  })

  it('GEN-108 shoot.beforeResolve opens after blocks and before damage; lowering seq.unblocked discards successes', () => {
    const { s, w, boy } = open()
    const st = withPloy(withPloy(facing(s, w, boy), ploy('test.p.drag', 'angels-of-death', 'shoot.beforeResolve')), ploy('test.p.endure', 'kommandos', 'shoot.beforeResolve'))
    const at = shootUntil(st, w, boy, (t) => t.pending?.kind === 'ploy.firefight' && t.pending.window === 'shoot.beforeResolve', 6)
    expect(at.st.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'shoot.beforeResolve' })
    const unblocked = at.st.attack!.seq!.unblocked!
    expect(unblocked.normal + unblocked.crit).toBeGreaterThan(0)
    const before = at.st.operatives[boy]!.wounds
    // discard everything: no damage
    let u = edit(at.st, (x) => void (x.attack!.seq!.unblocked = { normal: 0, crit: 0 }))
    u = passIt(u).state
    expect(u.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'B', window: 'shoot.beforeResolve' })
    u = passIt(u).state
    expect(u.operatives[boy]!.wounds).toBe(before)
    // untouched: the damage lands
    let v = passIt(at.st).state
    while (v.pending?.kind === 'ploy.firefight' && v.pending.window === 'shoot.beforeResolve') v = passIt(v).state
    expect(v.operatives[boy]!.wounds).toBeLessThan(before)
  })

  it('GEN-109 setAsideBatches: the first batch is never set aside, a later batch goes aside whole once its first answer is set-aside', () => {
    provide({ setAsideAtSetup: (_st, op) => op.seat === 'B', setAsideCap: (_s, seat) => (seat === 'B' ? 99 : 0), setAsideBatches: (_s, seat) => (seat === 'B' ? { skipFirst: true } : null) })
    let s = newRealGame({}, 'gen109').state
    const rng = new ScriptedRng([6, 1, 6, 1])
    const asideIdsByBatch: Record<number, number> = {}
    let setAsideBatch = 0
    for (let i = 0; i < 900 && s.pending?.kind !== 'firefight.activate'; i++) {
      const p = s.pending!
      if (p.kind === 'setup.deploy' && p.seat === 'B') {
        const batch = s.setup.batches!.B!
        const ids = (p.context.setAsideIds as string[] | undefined) ?? []
        asideIdsByBatch[batch] = Math.max(asideIdsByBatch[batch] ?? 0, ids.length)
        if (batch === 2 && ids.length > 0) {
          s = expectOk(step(s, act.setAside(p, ids[0]!), rng)).state
          setAsideBatch = batch
          if (s.pending?.kind === 'setup.deploy' && s.pending.seat === 'B') {
            expect(s.pending.context.wholeBatchAside).toBe(true)
            expect(s.pending.constraints!.operativeIds).toEqual([])
            const q = s.pending
            const rid = (q.context.reserveIds as string[])[0]!
            expect(step(s, act.deploy(q, rid, 0, 0), rng).rejection).toMatchObject({ code: 'E_NOT_AN_OPTION' })
          }
          continue
        }
        if (batch === 3 && ids.length > 0 && s.setup.deploy.aside === undefined) {
          // a deploy first keeps the whole batch on the table
          const r = expectOk(step(s, defaultAnswer(s), rng)).state
          if (r.pending?.kind === 'setup.deploy' && r.pending.seat === 'B') expect(r.pending.context.setAsideIds).toEqual([])
          s = r
          continue
        }
      }
      s = expectOk(step(s, defaultAnswer(s), rng)).state
    }
    expect(asideIdsByBatch[1]).toBe(0)
    expect(setAsideBatch).toBe(2)
    const out = Object.values(s.operatives).filter((o) => o.seat === 'B' && o.offboard !== undefined)
    const roster = Object.values(s.operatives).filter((o) => o.seat === 'B').length
    expect(out).toHaveLength(Math.min(Math.ceil(roster / 3), roster - Math.ceil(roster / 3)))
  })

  it('GEN-110 placementSpots with levels also offers spots on terrain floors', () => {
    const { s, w } = open()
    const tower = feature('tw', part('tw.0', rect(-3, 3, -3, 3), 2, ['vantage']))
    const st = edit(place(s, w, -10, 0), (x) => void (x.map = { ...x.map, features: [tower] }))
    const op = st.operatives[w]!
    const flat = placementSpots(st, op, { around: { x: 0, z: 0 }, radius: 2, max: 50 })
    expect(flat.every((p) => p.y === 0)).toBe(true)
    const high = placementSpots(st, op, { around: { x: 0, z: 0 }, radius: 2, max: 50, levels: true })
    expect(high.some((p) => p.y === 2)).toBe(true)
  })
})
