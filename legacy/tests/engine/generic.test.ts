// M9 engine prep: the generic capabilities new teams build on (docs/spec/12-rules-test-checklist.md, GEN-nnn).
// Each test registers a throwaway team rule provider or hook and removes it again, so nothing leaks.
import { afterEach, describe, expect, it } from 'vitest'
import { act } from '@/engine/actions'
import { step, view } from '@/engine'
import { abilityOffers, allowedOrders } from '@/engine/abilities'
import { attackStats, inflict, redirectAttack, rerollOptions, validTargets, weaponDamage } from '@/engine/attack-common'
import { shootAvailability } from '@/engine/shoot'
import { feature, part, rect } from '../fixtures/maps'
import { registerCodeHook } from '@/engine/code-hooks'
import { directDamage, regainWounds, removeNow } from '@/engine/effects'
import { actionAvailability, actionCost, raiseAction, reactionDone, startDelegatedAction, startFreeAction } from '@/engine/firefight'
import { registerFrameResume, registerHook, unregisterHook, type HookName, type AttackHookName } from '@/engine/hooks'
import { isMine, updateControl } from '@/engine/markers'
import { planMove } from '@/engine/movement'
import { markerControl } from '@/engine/query'
import { incapacitateOffboard, placementSpots, returnToKillzone } from '@/engine/reserve'
import { selectionProblem } from '@/engine/equipment'
import { stealthyLevel } from '@/engine/handlers'
import { ScriptedRng } from '@/engine/rng'
import { effectiveMove } from '@/engine/state'
import { registerTeamRules, unregisterTeamRules, type TeamRuleProvider } from '@/engine/team-rules'
import { addToken, removeToken, tokenCount } from '@/engine/tokens'
import { placementProblem } from '@/engine/terrain'
import type { DiceSide, GameState } from '@/engine/types'
import { capProblems, slotCost, validateRoster, type TeamData } from '../../src/data'
import { declareFight, evs, melee, pick as pickOpt, play, stage } from '../fixtures/attack'
import { defaultAnswer, drive, expectOk } from '../fixtures/helpers'
import { activateOp, edit, newRealGame, openReal, opOf, passIt, realBundle, roster, take, withCtx } from '../fixtures/real'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})
function provide(p: Omit<TeamRuleProvider, 'id'>): void {
  registerTeamRules({ id: 'test.provider', ...p })
  cleanups.push(() => unregisterTeamRules('test.provider'))
}
function hook(name: HookName | AttackHookName, fn: Parameters<typeof registerHook>[1]): void {
  registerHook(name, fn, `test.${name}`)
  cleanups.push(() => unregisterHook(name, `test.${name}`))
}

/** Open map, A to activate: A's Intercessor Warrior and Captain, B's Boy and Grot. */
function open(): { s: GameState; w: string; cap: string; boy: string; grot: string } {
  const s = openReal()
  return { s, w: opOf(s, 'A', 'aod.intercessor-warrior'), cap: opOf(s, 'A', 'aod.space-marine-captain'), boy: opOf(s, 'B', 'kom.boy'), grot: opOf(s, 'B', 'kom.grot') }
}

describe('GEN generic team capabilities', () => {
  it('GEN-001 tokens stack per owner up to a cap, emit TokenChanged, are removed on request and are visible to both seats', () => {
    const { s, boy } = open()
    const r = withCtx(s, (ctx) => {
      expect(addToken(ctx, boy, { kind: 'test.mark', owner: 'A', count: 3, cap: 4 }, 'test')).toBe(3)
      expect(addToken(ctx, boy, { kind: 'test.mark', owner: 'A', count: 3, cap: 4 }, 'test')).toBe(1)
      addToken(ctx, boy, { kind: 'test.mark', owner: 'B' }, 'test')
      expect(removeToken(ctx, boy, 'test.mark', 'test', 'A', 1)).toBe(1)
    })
    expect(tokenCount(r.state, boy, 'test.mark', 'A')).toBe(3)
    expect(tokenCount(r.state, boy, 'test.mark')).toBe(4)
    expect(evs(r.events, 'TokenChanged').map((e) => e.delta)).toEqual([3, 1, 1, -1])
    expect(view(r.state, 'B').operatives[boy]!.tokens).toEqual(r.state.operatives[boy]!.tokens)
  })

  it('GEN-002 a token that lasts until its source next activates goes when that operative activates', () => {
    const { s, w, boy } = open()
    const marked = edit(s, (st) => {
      st.operatives[boy]!.tokens = [{ kind: 'test.optic', owner: 'A', count: 1, sourceId: w, expires: ['sourceNextActivation'], since: 0 }]
    })
    const after = activateOp(marked, w)
    expect(tokenCount(after, boy, 'test.optic')).toBe(0)
  })

  it('GEN-003 regained wounds never exceed starting wounds and clear the injured state', () => {
    const { s, w } = open()
    const hurt = edit(s, (st) => {
      st.operatives[w]!.wounds = 3
      st.operatives[w]!.flags.injured = true
    })
    const r = withCtx(hurt, (ctx) => expect(regainWounds(ctx, w, 50, 'test')).toBe(11))
    expect(r.state.operatives[w]!.wounds).toBe(14)
    expect(r.state.operatives[w]!.flags.injured).toBe(false)
    expect(evs(r.events, 'WoundsRegained')[0]).toMatchObject({ amount: 11, wounds: 14 })
  })

  it('GEN-004 activation.start runs after the order is chosen; damage that incapacitates there ends the activation', () => {
    const { s, w } = open()
    const seen: string[] = []
    hook('activation.start', (c) => {
      seen.push(`${c.operativeId}:${String(c.data?.previousOrder)}>${String(c.data?.order)}`)
      if (c.engine && c.operativeId === w) directDamage(c.engine, w, 99, 'test', 'test')
      return null
    })
    const after = activateOp(s, w)
    expect(seen).toEqual([`${w}:conceal>engage`])
    expect(after.operatives[w]!.status).toBe('removed')
    expect(after.pending?.kind).toBe('firefight.activate')
    expect(after.pending?.seat).toBe('B')
  })

  it('GEN-005 turningPoint.start runs in the Ready step before CP are gained and operatives readied', () => {
    const calls: { tp: number; cpA: number; readyA: number }[] = []
    hook('turningPoint.start', (c) => {
      const st = c.state!
      calls.push({ tp: Number(c.data?.turningPoint), cpA: st.players.A.cp, readyA: Object.values(st.operatives).filter((o) => o.seat === 'A' && o.ready).length })
      return null
    })
    drive(newRealGame({}, 'gen5').state, (st) => st.pending?.kind === 'firefight.activate', 800, new ScriptedRng([6, 1, 6, 1]))
    expect(calls).toEqual([{ tp: 1, cpA: 2, readyA: 0 }])
  })

  it('GEN-006 a team rule provider changes repeats, orders, counteract, forbidden actions and costs', () => {
    const { s, w } = open()
    provide({
      maxRepeats: (_s, op, a) => (op.id === w && a === 'dash' ? 2 : null),
      orders: (_s, op) => (op.id === w ? ['engage'] : null),
      counteract: (_s, op) => (op.id === w ? 'any' : null),
      actionForbidden: (_s, op, a) => (op.id === w && a === 'guard' ? 'test forbids Guard' : null),
      actionCostDelta: (_s, op, a) => (op.id === w && a === 'reposition' ? 1 : 0),
    })
    const op = s.operatives[w]!
    expect(allowedOrders(s, op)).toEqual(['engage'])
    expect(actionCost(s, op, 'reposition')).toBe(2)
    const act0 = { operativeId: w, seat: 'A' as const, counteract: false, stage: 'action' as const, apSpent: 0, performed: ['dash'], declared: null }
    expect(actionAvailability(s, op, 'dash', act0)).toBeNull()
    expect(actionAvailability(s, op, 'guard', act0)?.reason).toBe('test forbids Guard')
  })

  it('GEN-007 an operative set aside at set-up stays out of the killzone, is readied and activated, and can return', () => {
    provide({ setAsideAtSetup: (st, op) => st.data.datacards[op.datacardId]?.id === 'kom.boy', setAsideCap: (_s, seat) => (seat === 'B' ? 1 : 0) })
    let s = newRealGame({}, 'gen7').state
    let hidden = ''
    const rng = new ScriptedRng([6, 1, 6, 1])
    for (let i = 0; i < 900 && s.pending?.kind !== 'firefight.activate'; i++) {
      const p = s.pending!
      const ids = p.kind === 'setup.deploy' ? ((p.context.setAsideIds as string[] | undefined) ?? []) : []
      if (p.seat === 'B' && !hidden && ids.length > 0) {
        hidden = ids[0]!
        s = expectOk(step(s, act.setAside(p, hidden), rng)).state
        expect((s.pending?.context.setAsideIds as string[] | undefined) ?? []).toEqual([])
      } else s = expectOk(step(s, defaultAnswer(s), rng)).state
    }
    expect(hidden).not.toBe('')
    const op = s.operatives[hidden]!
    expect(op.status).toBe('reserve')
    expect(op.offboard).toBe('setAside')
    expect(op.ready).toBe(true)
    expect(view(s, 'A').operatives[hidden]!.offboard).toBe('setAside')
    const back = withCtx(s, (ctx) => expect(returnToKillzone(ctx, hidden, { pos: { x: 0, y: 0, z: 0 }, order: 'engage', kind: 'emerge' })).toBe(true))
    expect(back.state.operatives[hidden]!.status).toBe('active')
    expect(evs(back.events, 'OperativeReturned')[0]).toMatchObject({ operativeId: hidden, kind: 'emerge' })
  })

  it('GEN-008 an operative that never comes back is incapacitated and counts for the kill op', () => {
    const { s, boy } = open()
    const aside = edit(s, (st) => {
      st.operatives[boy]!.status = 'reserve'
      st.operatives[boy]!.offboard = 'setAside'
    })
    const r = withCtx(aside, (ctx) => {
      incapacitateOffboard(ctx, boy)
      updateControl(ctx)
    })
    expect(r.state.operatives[boy]!.status).toBe('removed')
    expect(r.state.mission!.kills.A).toBe(1)
  })

  it('GEN-009 a removed operative that returns lowers the opponent kill grade and takes back its VP', () => {
    const { s, w } = open()
    const killed = withCtx(edit(s, (st) => (st.operatives[w]!.wounds = 0)), (ctx) => {
      removeNow(ctx, w)
      updateControl(ctx)
    }).state
    const grade = killed.mission!.grade.B
    const vp = killed.players.B.vp
    expect(grade).toBeGreaterThan(0)
    const back = withCtx(killed, (ctx) => returnToKillzone(ctx, w, { pos: { x: -12, y: 0, z: 9 }, order: 'conceal', wounds: 1, ready: false, kind: 'reanimated' })).state
    expect(back.operatives[w]).toMatchObject({ status: 'active', wounds: 1 })
    expect(back.mission!.kills.B).toBe(0)
    expect(back.mission!.grade.B).toBe(0)
    expect(back.players.B.vp).toBe(vp - grade)
  })

  it('GEN-010 a chained activation makes the same seat activate one of the named operatives next, once', () => {
    const { s, w, cap } = open()
    provide({ chainActivation: (_s, op, chained) => (op.id === w && !chained ? [cap] : null) })
    let t = activateOp(s, w)
    t = take(t, 'end').state
    expect(t.pending).toMatchObject({ kind: 'firefight.activate', seat: 'A' })
    expect(t.pending!.options!.map((o) => o.id)).toEqual([cap])
    t = activateOp(t, cap)
    t = take(t, 'end').state
    expect(t.pending?.seat).toBe('B')
  })

  it('GEN-011 an activation gate stops the picked operative this time and the seat picks another', () => {
    const { s, w } = open()
    provide({ gateActivation: (_ctx, op) => op.id === w })
    const r = take(s, w)
    expect(evs(r.events, 'ActivationGated')[0]).toMatchObject({ operativeId: w })
    expect(r.state.pending?.kind).toBe('firefight.activate')
    expect(r.state.pending!.options!.map((o) => o.id)).not.toContain(w)
  })

  it('GEN-012 the non-active player may react after an action; passing or reacting carries on the activation', () => {
    const { s, w, boy } = open()
    let reacted = 0
    registerCodeHook({
      name: 'test.reaction',
      choice(ctx) {
        reacted++
        reactionDone(ctx)
      },
    })
    provide({ reactions: (_s, seat, info) => (seat === 'B' && info.action === 'guard' ? [{ hook: 'test.reaction', operativeId: boy, option: 'x', labelKey: 'test' }] : []) })
    const t = take(activateOp(s, w), 'guard').state
    expect(t.pending).toMatchObject({ kind: 'ability.choice', seat: 'B' })
    const done = take(t, 'react:0').state
    expect(reacted).toBe(1)
    expect(done.pending).toMatchObject({ kind: 'firefight.action', seat: 'A' })
    expect(passIt(t).state.pending).toMatchObject({ kind: 'firefight.action', seat: 'A' })
  })

  it('GEN-013 a delegated free action offers only the allowed actions and caps its move', () => {
    const { s, w, cap } = open()
    registerFrameResume('test.delegated', (ctx) => raiseAction(ctx))
    const at = activateOp(s, w)
    const r = withCtx(at, (ctx) => {
      expect(startDelegatedAction(ctx, { operativeId: cap, resume: 'test.delegated', rules: { oneApOnly: true, maxMove: 2, deny: ['guard'] } })).toBe(true)
    })
    const p = r.state.pending!
    expect(p).toMatchObject({ kind: 'firefight.action', context: { operativeId: cap } })
    const ids = p.options!.map((o) => o.id)
    expect(ids).toContain('reposition')
    expect(ids).not.toContain('guard')
    const moving = take(r.state, 'reposition').state
    expect(moving.pending?.constraints?.maxInches).toBe(2)
    const back = passIt(moving).state
    expect(back.pending).toMatchObject({ kind: 'firefight.action', context: { operativeId: cap } })
    const resumed = take(back, 'end').state
    expect(resumed.pending).toMatchObject({ kind: 'firefight.action', context: { operativeId: w } })
  })

  it('GEN-014 a free Charge can be capped and tied to one enemy control range', () => {
    const { s, w, boy, grot } = open()
    const near = edit(s, (st) => {
      st.operatives[w]!.pos = { x: 0, y: 0, z: 0 }
      st.operatives[w]!.order = 'engage'
      st.operatives[boy]!.pos = { x: 3, y: 0, z: 0 }
      st.operatives[grot]!.pos = { x: -3, y: 0, z: 0 }
    })
    registerFrameResume('test.charge', () => undefined)
    const r = withCtx(near, (ctx) => {
      expect(startFreeAction(ctx, { operativeId: w, action: 'charge', maxMove: 3, endWithinCrOf: boy, resume: 'test.charge' })).toBe(true)
    })
    expect(r.state.pending?.constraints).toMatchObject({ kind: 'charge', maxInches: 3, mustEndInControlRangeOfId: boy })
    const op = near.operatives[w]!
    expect(planMove(near, op, 'charge', [{ x: -1.6, z: 0 }], false, 3, boy).ok).toBe(false)
    expect(planMove(near, op, 'charge', [{ x: 1.6, z: 0 }], false, 3, boy).ok).toBe(true)
  })

  it('GEN-015 control providers change what an operative counts for and a side total, without touching APL', () => {
    const { s, w } = open()
    const m = s.markers.find((k) => k.kind === 'objective')!
    const on = edit(s, (st) => (st.operatives[w]!.pos = { x: m.pos.x + 0.9, y: 0, z: m.pos.z }))
    expect(markerControl(on, m).apl.A).toBe(3)
    provide({ controlApl: (_s, op, _m, apl) => (op.id === w ? apl + 1 : null), controlTotal: (_s, seat, _m, total) => (seat === 'A' ? total - 2 : null) })
    expect(markerControl(on, m).apl.A).toBe(2)
    expect(on.operatives[w]!.aplMods).toBe(0)
  })

  it('GEN-016 Move changes from team rules apply with the 4" floor, and an injury-equivalent worsens Hit once', () => {
    const { s, w, boy } = open()
    const op = s.operatives[w]!
    provide({ moveDelta: (_s, o) => (o.id === w ? 1 : 0) })
    expect(effectiveMove(op, s)).toBe(7)
    expect(effectiveMove(op)).toBe(6)
    unregisterTeamRules('test.provider')
    provide({ moveDelta: (_s, o) => (o.id === w ? -1 : 0), injuredEquivalent: (_s, o) => o.id === w })
    expect(effectiveMove(op, s)).toBe(4)
    const weapon = op.weapons.find((x) => s.data.weapons[x]!.type === 'ranged')!
    const before = attackStats(s, w, weapon, boy, { kind: 'shoot' }).need
    expect(before).toBe(s.data.weapons[weapon]!.hit + 1)
    const injured = edit(s, (st) => (st.operatives[w]!.wounds = 2))
    expect(attackStats(injured, w, weapon, boy, { kind: 'shoot' }).need).toBe(before)
  })

  it('GEN-017 modifyDamage changes the Dmg a weapon deals against one target', () => {
    const { s, w, boy, grot } = open()
    hook('modifyDamage', (c) => {
      if (c.targetId === boy) {
        const d = c.data as { dmg: { normal: number; crit: number } }
        d.dmg.normal += 1
        d.dmg.crit += 1
      }
      return null
    })
    const weapon = s.operatives[w]!.weapons[0]!
    const base = s.data.weapons[weapon]!.dmg
    expect(weaponDamage(s, w, weapon, boy, 'shoot')).toEqual({ normal: base.normal + 1, crit: base.crit + 1 })
    expect(weaponDamage(s, w, weapon, grot, 'shoot')).toEqual(base)
  })

  it('GEN-018 beforeIncapacitated can stop an incapacitation; damage.inflicted reports the wounds actually lost', () => {
    const { s, w, boy } = open()
    hook('beforeIncapacitated', (c) => {
      ;(c.data as { wounds: number }).wounds = 1
      return null
    })
    const lost: number[] = []
    hook('damage.inflicted', (c) => {
      lost.push((c.data as { amount: number }).amount)
      return null
    })
    const r = withCtx(s, (ctx) => inflict(ctx, { targetId: boy, attackerId: w, weaponId: null, amount: 50, source: 'direct' }))
    expect(r.state.operatives[boy]!.wounds).toBe(1)
    expect(evs(r.events, 'OperativeIncapacitated')).toHaveLength(0)
    expect(lost).toEqual([9])
  })

  it('GEN-019 a re-roll ban removes every re-roll option of a side, Command Re-roll included', () => {
    const { s, w } = open()
    const side: DiceSide = { seat: 'A', operativeId: w, weaponId: null, dice: [{ value: 1, kind: 'fail', rerolled: false }], need: 3, lethal: null, grants: [{ id: 'balanced', source: 'x', mode: 'one', used: false }], commandUsed: false, phase: 'grants' }
    const st = edit(s, (x) => (x.attack = { kind: 'shoot', stage: 'attackReroll', operativeId: w, seat: 'A', weaponId: null, pointBlank: false, targets: [], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] }))
    expect(rerollOptions(st, side).grants.length + rerollOptions(st, side).command.length).toBeGreaterThan(0)
    provide({ rerollsBanned: (_s, sd) => sd.seat === 'A' })
    expect(rerollOptions(st, side)).toEqual({ grants: [], command: [] })
  })

  it('GEN-020 fight providers set who resolves first, owe a block-only resolution and bar blocking', () => {
    const s = stage({ m: [0, 0.1], e: [0.1, 1.5], mine: [melee('a', { atk: 2, hit: 3 })], theirs: [melee('b', { atk: 2, hit: 3 })], mineWounds: 20, mineMaxWounds: 20, targetWounds: 20 })
    provide({ fightResolveStart: (_s, a) => ({ queue: [{ seat: a.seat === 'A' ? 'B' : 'A', blockOnly: true }], noBlock: [a.seat] }) })
    const st = declareFight(s.state)
    const rng = new ScriptedRng([4, 4, 4, 4])
    const first = expectOk(step(st, pickOpt(st.pending!, s.e), rng))
    const seen: { seat: string; ids: string[] }[] = []
    play(first.state, rng, {
      'fight.resolve': (p) => {
        seen.push({ seat: p.seat, ids: p.options!.map((o) => o.id) })
        return p.options![0]!.action
      },
    })
    expect(seen[0]!.seat).toBe(s.foe)
    expect(seen[0]!.ids.every((id) => id.startsWith('block'))).toBe(true)
    expect(seen[1]!.seat).toBe(s.me)
    expect(seen.filter((x) => x.seat === s.me).every((x) => x.ids.every((id) => id.startsWith('strike')))).toBe(true)
  })

  it('GEN-021 a shooter may use a viewpoint operative a team rule offers; the Shoot remembers it', () => {
    const { s, w, cap, boy } = open()
    const near = edit(s, (st) => {
      st.operatives[w]!.pos = { x: 0, y: 0, z: 0 }
      st.operatives[cap]!.pos = { x: 2, y: 0, z: 0 }
      st.operatives[boy]!.pos = { x: 8, y: 0, z: 0 }
    })
    provide({ shootViewpoints: (_s, op) => (op.id === w ? [cap] : []) })
    const t = take(activateOp(near, w), 'shoot').state
    const via = t.pending!.options!.filter((o) => o.id.includes('@'))
    expect(via.length).toBeGreaterThan(0)
    const chosen = take(t, via[0]!.id).state
    expect(chosen.attack?.viewpointId).toBe(cap)
    expect(chosen.pending?.kind).toBe('shoot.target')
  })

  it('GEN-022 selection weights count an entry as several selections and caps bound a group', () => {
    const slot = { id: 'main', count: 4, from: ['x.a', 'x.b', 'x.c'], repeatable: ['x.a'], weights: { 'x.b': 2 }, caps: [{ from: ['x.b', 'x.c'], max: 1 }] }
    expect(slotCost(slot, ['x.a', 'x.a', 'x.b'])).toBe(4)
    expect(capProblems(slot, ['x.b', 'x.c'])).toHaveLength(1)
    const team = { selection: { slots: [slot] } } as unknown as TeamData
    expect(validateRoster(team, { main: ['x.a', 'x.a', 'x.b'] }).ok).toBe(true)
    expect(validateRoster(team, { main: ['x.a', 'x.b', 'x.c'] }).ok).toBe(false)
  })

  it('GEN-023 equipment weapon grants go to the operatives its data names (grants.to)', () => {
    const s = openReal({ teams: ['kommandos', 'angels-of-death'], equipmentA: ['kom.e.harpoon'], rosterA: roster(['kom.boss-nob', 'kom.grot', 'kom.boy', 'kom.bomb-squig', 'kom.breacha-boy', 'kom.burna-boy', 'kom.comms-boy', 'kom.dakka-boy', 'kom.rokkit-boy', 'kom.slasha-boy', 'kom.snipa-boy']) })
    expect(s.operatives[opOf(s, 'A', 'kom.boy')]!.weapons).toContain('kom.w.harpoon')
    expect(s.operatives[opOf(s, 'A', 'kom.grot')]!.weapons).not.toContain('kom.w.harpoon')
    expect(s.operatives[opOf(s, 'A', 'kom.bomb-squig')]!.weapons).not.toContain('kom.w.harpoon')
  })

  it('GEN-024 moves add to the distance spent this activation and every action joins the turning point history', () => {
    const { s, w } = open()
    const at = activateOp(edit(s, (st) => (st.operatives[w]!.pos = { x: 0, y: 0, z: 0 })), w)
    const moving = take(at, 'reposition').state
    const r = expectOk(step(moving, act.path(moving.pending!, [{ x: 2, z: 0 }])))
    expect(r.state.operatives[w]!.movedThisActivation).toBe(2)
    expect(r.state.operatives[w]!.actionsThisTp).toEqual(['reposition'])
  })

  it('GEN-025 placement spots are placeable, pass the rule test and are capped', () => {
    const { s, w } = open()
    const op = s.operatives[w]!
    const spots = placementSpots(s, op, { test: (p) => p.x > 5, max: 6 })
    expect(spots).toHaveLength(6)
    for (const p of spots) {
      expect(p.x).toBeGreaterThan(5)
      expect(placementProblem(s, { id: op.id, pos: p, radius: op.baseRadius, height: op.height })).toBeNull()
    }
    void realBundle
  })

  it('GEN-026 an attack can be redirected to another operative, keeping a given cover verdict', () => {
    const { s, w, boy, grot } = open()
    const base = { stage: 'target' as const, operativeId: w, seat: 'A' as const, weaponId: null, pointBlank: false, candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] }
    const shooting = edit(s, (st) => (st.attack = { ...base, kind: 'shoot', targets: [boy], status: { cover: true, obscured: false, improvedCover: false } }))
    const r = withCtx(shooting, (ctx) => expect(redirectAttack(ctx, grot, { cover: false, obscured: true })).toBe(true))
    expect(r.state.attack).toMatchObject({ targets: [grot], status: { cover: false, obscured: true } })
    const fighting = edit(s, (st) => (st.attack = { ...base, kind: 'fight', targets: [boy], fight: { targetId: boy, weaponA: null, weaponD: 'kom.w.choppa', turn: 'A', passes: 0, shockUsed: { A: false, B: false } } }))
    const f = withCtx(fighting, (ctx) => redirectAttack(ctx, grot)).state.attack!.fight!
    expect(f).toMatchObject({ targetId: grot, weaponD: 'kom.w.grot-choppa' })
  })

  it('GEN-027 a move surcharge adds to the cost of a move and can push it over its limit', () => {
    const { s, w } = open()
    const at = edit(s, (st) => (st.operatives[w]!.pos = { x: 0, y: 0, z: 0 }))
    const op = at.operatives[w]!
    provide({ moveSurcharge: (_s, o, kind) => (o.id === w && kind !== 'dash' ? 2 : 0) })
    const short = planMove(at, op, 'reposition', [{ x: 3, z: 0 }])
    expect(short.ok && short.cost).toBe(5)
    expect(planMove(at, op, 'reposition', [{ x: 5, z: 0 }]).ok).toBe(false)
    expect(planMove(at, op, 'dash', [{ x: 3, z: 0 }]).ok).toBe(true)
  })

  it('GEN-028 an action a team rule forbids cannot be taken as a free action either', () => {
    const { s, w } = open()
    registerFrameResume('test.dash', () => undefined)
    provide({ actionForbidden: (_s, op, a) => (op.id === w && a === 'dash' ? 'no Dash' : null) })
    withCtx(s, (ctx) => expect(startFreeAction(ctx, { operativeId: w, action: 'dash', resume: 'test.dash' })).toBe(false))
  })

  it('GEN-029 any equipment with the mines code is a mine; a team rule can exempt its operatives; excluded options are rejected', () => {
    const { s, boy } = open()
    const mined = edit(s, (st) => {
      st.data.equipment = { ...(st.data.equipment ?? {}), 'test.e.traps': { id: 'test.e.traps', name: 'Traps', scope: 'faction', team: 'x', count: 2, effect: { code: 'mines' }, excludes: ['core.e.mines'], text: 't', source: 's' } }
      st.markers.push({ id: 'mk.trap', kind: 'equipment', pos: { x: st.operatives[boy]!.pos.x - 1, z: st.operatives[boy]!.pos.z }, owner: 'B', carriedBy: null, controller: null, equipmentId: 'test.e.traps', hidden: true })
    })
    expect(isMine(mined, mined.markers.find((m) => m.id === 'mk.trap')!)).toBe(true)
    provide({ ignoresMine: (_s, op) => op.seat === 'B' })
    expect(evs(withCtx(mined, (ctx) => updateControl(ctx)).events, 'MineTriggered')).toHaveLength(0)
    unregisterTeamRules('test.provider')
    expect(evs(withCtx(mined, (ctx) => updateControl(ctx)).events, 'MineTriggered')).toHaveLength(1)
    const setup = { equipment: { A: ['test.e.traps', 'core.e.mines'], B: [] } } as unknown as Parameters<typeof selectionProblem>[0]
    expect(selectionProblem(setup, 'A', { equipment: mined.data.equipment!, teamId: 'x', limit: 4 })).toMatch(/cannot be taken with/)
  })

  it('GEN-031 the Shoot action is available when only a team-rule viewpoint has a valid target (Magnify)', () => {
    const { s, w, cap, boy } = open()
    // the Boy is on Conceal behind light cover from the shooter; the viewpoint looks at it from the flank
    const st = edit(s, (x) => {
      x.map = { ...x.map, features: [feature('low', part('low.a', rect(6.8, 7.0, -1.5, 1.5), 1, ['light']))] }
      x.operatives[w]!.pos = { x: 0, y: 0, z: 0 }
      x.operatives[w]!.order = 'engage'
      x.operatives[cap]!.pos = { x: 8, y: 0, z: 6 }
      x.operatives[boy]!.pos = { x: 8, y: 0, z: 0 }
      x.operatives[boy]!.order = 'conceal'
      // the Boy is the only enemy that could be a target (validTargets skips operatives at 0 wounds)
      for (const o of Object.values(x.operatives)) if (o.seat === 'B' && o.id !== boy) o.wounds = 0
    })
    const shooter = st.operatives[w]!
    const weapon = shooter.weapons.find((id) => st.data.weapons[id]?.type === 'ranged')!
    expect(validTargets(st, shooter, weapon).map((t) => t.id)).not.toContain(boy)
    expect(shootAvailability(st, shooter, null)?.code).toBe('E_INVALID_TARGET')
    provide({ shootViewpoints: (_s, op) => (op.id === w ? [cap] : []) })
    expect(validTargets(st, shooter, weapon, undefined, st.operatives[cap]).map((t) => t.id)).toContain(boy)
    expect(shootAvailability(st, shooter, null)?.reason ?? null).toBeNull()
  })

  it('GEN-032 end-of-activation ploy window: offered to the owner before the operative is expended', () => {
    const { s, w } = open()
    const ploy = { id: 'test.p.at-end', name: 'AT END', team: 'angels-of-death', type: 'firefight', cost: 0, window: 'firefight.activationEnded', effect: { cp: 1 }, text: 't', source: 's' }
    const st = edit(s, (x) => {
      x.data.ploys = { ...(x.data.ploys ?? {}), [ploy.id]: ploy as never }
    })
    const r = expectOk(step(activateOp(st, w), (activateOp(st, w).pending!.options!.find((o) => o.id === 'end'))!.action))
    expect(r.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'firefight.activationEnded' })
    expect(r.pending!.options!.map((o) => o.id)).toContain('test.p.at-end')
    expect(evs(r.events, 'OperativeExpended')).toEqual([])
    expect(r.state.firefight.activation?.operativeId).toBe(w)
    const used = take(r.state, 'test.p.at-end')
    expect(evs(used.events, 'PloyUsed').map((e) => e.ployId)).toContain('test.p.at-end')
    expect(evs(used.events, 'OperativeExpended').map((e) => e.operativeId)).toEqual([w])
    expect(used.state.pending?.kind).toBe('firefight.activate')
    // without such a ploy nothing is asked
    const fresh = open()
    const started = activateOp(fresh.s, fresh.w)
    const plain = expectOk(step(started, started.pending!.options!.find((o) => o.id === 'end')!.action))
    expect(evs(plain.events, 'OperativeExpended').map((e) => e.operativeId)).toEqual([fresh.w])
  })

  it('GEN-033 incapacitation ploy window: the owner of an attack victim is asked before removal; hook-only code ploys are not', () => {
    const { s, w, boy } = open()
    const ploy = { id: 'test.p.demise', name: 'DEMISE', team: 'kommandos', type: 'firefight', cost: 0, window: 'operative.incapacitated', effect: { cp: 1 }, text: 't', source: 's' }
    const hookOnly = { ...ploy, id: 'test.p.hook-only', name: 'HOOK ONLY', effect: { code: 'test.noPloyMember' } }
    let st = edit(s, (x) => {
      x.data.ploys = { ...(x.data.ploys ?? {}), [ploy.id]: ploy as never, [hookOnly.id]: hookOnly as never }
      x.operatives[w]!.pos = { x: 0, y: 0, z: 0 }
      x.operatives[boy]!.pos = { x: 6, y: 0, z: 0 }
      x.operatives[boy]!.order = 'engage'
      x.operatives[boy]!.wounds = 1
    })
    st = take(activateOp(st, w), 'shoot').state
    st = take(st, st.pending!.options![0]!.id).state
    const atk = st.data.weapons[st.attack!.weaponId!]!.atk
    const rng = new ScriptedRng(Array(atk).fill(6).concat(Array(60).fill(1)))
    st = take(st, st.pending!.options!.find((o) => (o.action.payload as { targetId?: string }).targetId === boy)!.id, rng).state
    let seen: string[] | null = null
    for (let i = 0; i < 40 && st.pending && st.operatives[boy]!.status === 'active'; i++) {
      const p = st.pending
      if (p.kind === 'ploy.firefight' && p.window === 'operative.incapacitated') {
        seen = p.options!.map((o) => o.id)
        expect(p.seat).toBe('B')
        expect(st.operatives[boy]!.wounds).toBe(0)
        st = take(st, 'test.p.demise').state
        continue
      }
      if (p.kind === 'firefight.action') break
      st = expectOk(step(st, defaultAnswer(st), rng)).state
    }
    expect(seen).toEqual(['test.p.demise'])
    expect(st.operatives[boy]!.status).toBe('removed')
    expect(st.ledger.B.tp).toContain('test.p.demise')
  })

  it('GEN-034 a free move in the Strategy phase is a reaction point; the gambit step goes on afterwards', () => {
    registerCodeHook({ name: 'test.stratReact', choice: (ctx) => reactionDone(ctx) })
    const seen: { actorId: string; strategy?: boolean }[] = []
    provide({
      reactions: (_s, seat, info) => {
        if (seat !== 'A' || !info.strategy) return []
        seen.push({ actorId: info.actorId, strategy: info.strategy })
        return [{ hook: 'test.stratReact', operativeId: Object.values(_s.operatives).find((o) => o.seat === 'A' && o.status === 'active')!.id, option: 'x', labelKey: 'test' }]
      },
    })
    let s = drive(newRealGame({}, 'gen34').state, (st) => st.pending?.kind === 'strategy.gambit', 800, new ScriptedRng([6, 1, 6, 1]))
    s = edit(s, (st) => {
      st.turningPoint = 2
      st.players.B.cp = 3
    })
    s = passIt(s).state // A passes
    s = take(s, 'kom.p.ssssshhhh').state
    expect(s.pending?.kind).toBe('move.path')
    const mover = s.pending!.context.operativeId as string
    const at = s.operatives[mover]!.pos
    let moved = false
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0], [0.5, 0.5]] as const) {
      const r = step(s, act.path(s.pending!, [{ x: at.x + dx, z: at.z + dz }]))
      if (!r.rejection) {
        s = r.state
        moved = true
        break
      }
    }
    expect(moved).toBe(true)
    expect(s.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', window: 'strategy.gambit' })
    expect(s.pending!.context).toMatchObject({ reaction: true, actorId: mover })
    expect(seen.at(-1)).toEqual({ actorId: mover, strategy: true })
    s = take(s, 'react:0').state
    expect(s.firefight.reactionAfter ?? null).toBeNull()
    // the next free Dash of the queue (or the gambit step) carries on
    expect(['move.path', 'strategy.gambit']).toContain(s.pending?.kind)
    while (s.pending?.kind === 'move.path') s = passIt(s).state
    expect(s.pending?.kind).toBe('strategy.gambit')
  })

  it('GEN-035 a unique action repeats in one activation only as often as maxRepeats allows (default once)', () => {
    registerCodeHook({ name: 'test.twice', action: { offers: () => [{ key: '', params: {} }], perform: () => undefined } })
    const { s, w } = open()
    const st = edit(s, (x) => {
      x.data.abilities = { ...x.data.abilities, 'test.a.twice': { id: 'test.a.twice', name: 'TWICE', kind: 'uniqueAction', ap: 1, code: 'test.twice', effect: { code: 'test.twice' } } as never }
      const card = x.data.datacards[x.operatives[w]!.datacardId]!
      x.data.datacards = { ...x.data.datacards, [card.id]: { ...card, uniqueActions: [...(card.uniqueActions ?? []), 'test.a.twice'] } }
    })
    const op = st.operatives[w]!
    const act = (performed: string[]) => ({ operativeId: w, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed }) as never
    const has = (performed: string[]) => abilityOffers(st, op, act(performed)).some((o) => o.abilityId === 'test.a.twice')
    expect(has([])).toBe(true)
    expect(has(['ability:test.a.twice'])).toBe(false)
    provide({ maxRepeats: (_s, _op, id) => (id === 'ability:test.a.twice' ? 2 : null) })
    expect(has(['ability:test.a.twice'])).toBe(true)
    expect(has(['ability:test.a.twice', 'ability:test.a.twice'])).toBe(false)
  })

  it('GEN-036 attacker window on the fresh defence roll, before re-rolls; both fighters on the fresh fight rolls', () => {
    const { s, w, boy } = open()
    const shootPloy = { id: 'test.p.before-def', name: 'BEFORE DEF', team: 'angels-of-death', type: 'firefight', cost: 0, window: 'shoot.beforeDefenceRerolls', effect: { cp: 1 }, text: 't', source: 's' }
    let st = edit(s, (x) => {
      x.data.ploys = { ...(x.data.ploys ?? {}), [shootPloy.id]: shootPloy as never }
      x.operatives[w]!.pos = { x: 0, y: 0, z: 0 }
      x.operatives[boy]!.pos = { x: 6, y: 0, z: 0 }
      x.operatives[boy]!.order = 'engage'
    })
    st = take(activateOp(st, w), 'shoot').state
    st = take(st, st.pending!.options![0]!.id).state
    const kinds: string[] = []
    const r = play(st, new ScriptedRng(Array(40).fill(4)), { 'ploy.firefight': (p) => (kinds.push(p.window), null) }, ['firefight.action'])
    void r
    expect(kinds).toContain('shoot.beforeDefenceRerolls')
    expect(kinds.indexOf('shoot.beforeDefenceRerolls')).toBeLessThan(kinds.indexOf('shoot.defenceRolled') === -1 ? 99 : kinds.indexOf('shoot.defenceRolled'))
    const at = r.events.findIndex((e) => e.type === 'DefenceDiceRolled')
    const used = r.events.findIndex((e) => e.type === 'PloyUsed' && e.ployId === 'test.p.before-def')
    expect(at).toBeGreaterThanOrEqual(0)
    expect(used).toBeGreaterThan(at)
    expect(r.events.slice(at, used).some((e) => e.type === 'DiceRerolled')).toBe(false)
  })

  it('GEN-037 the Firefight phase opens with a ploy window for strategy and firefight ploys that name it', () => {
    const strat = { id: 'test.p.ff-start', name: 'FF START', team: 'angels-of-death', type: 'strategy', cost: 0, window: 'firefight.start', effect: { cp: 1 }, text: 't', source: 's' }
    let s = newRealGame({}, 'gen37').state
    s = edit(s, (x) => {
      x.data.ploys = { ...(x.data.ploys ?? {}), [strat.id]: strat as never }
    })
    s = drive(s, (st) => st.pending?.kind === 'ploy.firefight' || st.pending?.kind === 'firefight.activate', 800, new ScriptedRng([6, 1, 6, 1]))
    expect(s.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.start', seat: 'A' })
    expect(s.phase).toBe('firefight')
    expect(s.pending!.options!.map((o) => o.id)).toContain('test.p.ff-start')
    s = take(s, 'test.p.ff-start').state
    expect(s.pending?.kind).toBe('firefight.activate')
  })

  it('GEN-038 a finished Guard interrupt is a reaction point for the interrupted seat; its activation goes on', () => {
    registerCodeHook({ name: 'test.afterGuard', choice: (ctx) => reactionDone(ctx) })
    const seen: string[] = []
    provide({ reactions: (_s, seat, info) => (info.interrupt && seat === 'B' ? (seen.push(info.actorId), [{ hook: 'test.afterGuard', operativeId: info.actorId, option: 'x', labelKey: 'test' }]) : []) })
    let s = openReal({ teamChoices: { A: { 'primary-tactic': 'aod.a.ct-mobile', 'secondary-tactic': 'aod.a.ct-hardy' }, B: {} }, rosterA: [{ datacardId: 'aod.intercessor-warrior', loadout: { weaponIds: ['aod.w.bolt-rifle'] } }, ...roster(['aod.eliminator-sniper'])] })
    const marine = opOf(s, 'A', 'aod.intercessor-warrior')
    const boy = opOf(s, 'B', 'kom.boy')
    s = edit(s, (x) => {
      x.operatives[marine]!.pos = { x: 0, y: 0, z: 0 }
      x.operatives[boy]!.pos = { x: 9, y: 0, z: 0 }
    })
    s = take(take(activateOp(s, marine), 'guard').state, 'end').state
    s = take(activateOp(s, boy), 'reposition').state
    s = expectOk(step(s, act.path(s.pending!, [{ x: 6, z: 0 }]))).state
    while (s.pending?.kind === 'ploy.firefight') s = passIt(s).state
    expect(s.pending?.kind).toBe('guard.interrupt')
    s = take(s, `${marine}:shoot`).state
    const r = play(s, new ScriptedRng(Array(40).fill(1)), { 'ploy.firefight': (p) => act.pass(p) }, ['ability.choice', 'firefight.action', 'firefight.activate'])
    expect(r.state.pending).toMatchObject({ kind: 'ability.choice', seat: 'B' })
    expect(r.state.pending!.context).toMatchObject({ reaction: true, actorId: marine })
    expect(seen).toEqual([marine])
    const after = take(r.state, 'react:0').state
    expect(after.firefight.reactionAfter ?? null).toBeNull()
    expect(after.pending).toMatchObject({ kind: 'firefight.action', seat: 'B' })
    expect(after.firefight.activation?.operativeId).toBe(boy)
  })

  it('GEN-030 Stealthy-style cover sources from team rules add to the defender level', () => {
    const { s, boy } = open()
    expect(stealthyLevel(s, s.operatives[boy]!)).toBe(0)
    provide({ stealthyCover: (_s, op) => (op.id === boy ? 1 : 0) })
    expect(stealthyLevel(s, s.operatives[boy]!)).toBe(1)
  })
})
