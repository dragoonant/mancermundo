// Batch D shared integration (docs/spec/12-rules-test-checklist.md GEN-111 onwards): the shared fixes and new windows
// the batch D teams (Blooded, Fellgor Ravagers, Chaos Cult, Goremongers, Scout Squad, Tempestus Aquilons, Exaction
// Squad) asked for. Throwaway providers, hooks and ploys are removed after each test.
import { afterEach, describe, expect, it } from 'vitest'
import { step } from '@/engine'
import { act } from '@/engine/actions'
import { continueRemovals, runDeferredRemovals, saveFromRemoval } from '@/engine/attack-common'
import { registerCodeHook } from '@/engine/code-hooks'
import { addUse, directDamage } from '@/engine/effects'
import { noteWeaponUses, placementIssue } from '@/engine/equipment'
import { canStartFreeAction, continueActivation, startFreeAction } from '@/engine/firefight'
import { stealthyLevel } from '@/engine/handlers'
import { registerFrameResume, registerHook, runHook, unregisterHook, type AttackHookName, type HookName } from '@/engine/hooks'
import { raisePointChoice, registerPointHandler, updateControl } from '@/engine/markers'
import { registerTeamRules, unregisterTeamRules, type TeamRuleProvider } from '@/engine/team-rules'
import type { GameState } from '@/engine/types'
import { apply, defaultAnswer, expectOk, path, place } from '../fixtures/helpers'
import { ScriptedRng } from '@/engine/rng'
import { activate as activateSynth, toFirefight } from '../fixtures/helpers'
import { makeSetup } from '../fixtures/team'
import { activateOp, AOD, edit, openReal, opOf, passIt, roster, take, withCtx } from '../fixtures/real'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})
function provide(p: Omit<TeamRuleProvider, 'id'>): void {
  registerTeamRules({ id: 'test.provider-f', ...p })
  cleanups.push(() => unregisterTeamRules('test.provider-f'))
}
function hook(name: HookName | AttackHookName, fn: Parameters<typeof registerHook>[1]): void {
  registerHook(name, fn, `test-f.${name}`)
  cleanups.push(() => unregisterHook(name, `test-f.${name}`))
}
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
/** A Shoot in progress at `target` with the defender's cover choice already made. */
function underFire(s: GameState, target: string, coverMode: string): GameState {
  return edit(s, (x) => {
    x.attack = { kind: 'shoot', seq: { targetId: target, improvedCover: true, coverMode } } as never
  })
}
registerFrameResume('test-f.free', (ctx) => continueActivation(ctx))

describe('GEN batch D shared', () => {
  it('GEN-111 Stealthy, Camo Cloak and extraCoverSaves add nothing once the Vantage improvement was taken; a single retained save still gets them', () => {
    const s = openReal()
    const sniper = opOf(s, 'A', 'aod.eliminator-sniper')
    expect(stealthyLevel(s, s.operatives[sniper]!)).toBe(2)
    provide({ extraCoverSaves: (_st, op) => (op.id === sniper ? 1 : 0) })
    type D = { value: number | null; kind: 'fail' | 'normal' | 'crit'; rerolled: boolean; tag?: string }
    const roll = (st: GameState, mode: string) => {
      const dice: D[] =
        mode === 'retainTwo'
          ? [{ value: null, kind: 'normal', rerolled: false, tag: 'cover' }, { value: null, kind: 'normal', rerolled: false, tag: 'cover' }, { value: 1, kind: 'fail', rerolled: false }]
          : [{ value: null, kind: 'normal', rerolled: false, tag: 'cover' }, { value: 1, kind: 'fail', rerolled: false }, { value: 2, kind: 'fail', rerolled: false }]
      const at = underFire(st, sniper, mode)
      runHook('afterDefenceRoll', { seat: 'A', state: at, operativeId: sniper, targetId: opOf(s, 'B', 'kom.boy'), data: { kind: 'shoot', side: 'defence', dice, requests: [], choices: {} } })
      return dice.map((d) => d.kind)
    }
    // Vantage improvement taken (two saves, or one as a crit): the cloak, the tactic and the provider add nothing
    expect(roll(s, 'retainTwo')).toEqual(['normal', 'normal', 'fail'])
    // one save retained: Camo Cloak with Stealthy gives both options (one more and a crit), the provider one more
    expect(roll(s, 'retain')).toEqual(['crit', 'normal', 'normal'])
  })

  it('GEN-112 the kill log is written at removal time, before the step ends, and the step-end pass does not log it twice', () => {
    const { s, w, boy } = open()
    const r = withCtx(edit(s, (x) => void (x.operatives[boy]!.wounds = 2)), (ctx) => {
      directDamage(ctx, boy, 3, w, 'test')
      // no updateControl yet: a window raised in this same step already sees the kill
      expect(ctx.state.kills).toMatchObject([{ removedId: boy, killerId: w, cause: 'direct' }])
      updateControl(ctx)
    })
    expect(r.state.kills).toHaveLength(1)
  })

  it('GEN-113 a removal outside an attack waits for the end-of-step queue when a rule asks; its decision may remove or save the operative, then the parked decision returns', () => {
    const { s, w, boy } = open()
    registerCodeHook({
      name: 'test-f.demise',
      choice(ctx, op, option) {
        if (option === 'save') saveFromRemoval(ctx, op.id, 1)
        continueRemovals(ctx)
      },
    })
    provide({ pausableRemoval: (_st, op) => op.id === boy })
    hook('operative.incapacitated', (c) => {
      if (c.operativeId !== boy || !c.engine || !c.state?.removal || c.state.pending) return null
      c.engine.raise({
        kind: 'ability.choice',
        seat: 'B',
        window: 'operative.incapacitated',
        context: { hook: 'test-f.demise', operativeId: boy },
        options: ['save', 'die'].map((id) => ({ id, labelKey: id, type: 'ability.choice' as const, payload: { option: id } })),
      })
      return null
    })
    const parked = s.pending!
    const asked = withCtx(s, (ctx) => {
      directDamage(ctx, boy, 99, w, 'test')
      expect(ctx.state.operatives[boy]!.status).toBe('active')
      expect(ctx.state.deferredRemovals).toEqual([boy])
      runDeferredRemovals(ctx)
    }).state
    expect(asked.pending).toMatchObject({ kind: 'ability.choice', seat: 'B', context: { hook: 'test-f.demise' } })
    const died = take(asked, 'die').state
    expect(died.operatives[boy]!.status).toBe('removed')
    expect(died.kills).toMatchObject([{ removedId: boy, cause: 'direct', killerId: w }])
    expect(died.pending?.id).toBe(parked.id)
    const saved = take(asked, 'save').state
    expect(saved.operatives[boy]).toMatchObject({ status: 'active', wounds: 1 })
    expect(saved.kills ?? []).toEqual([])
    expect(saved.pending?.id).toBe(parked.id)
    // with nothing to ask the removal stays immediate
    const plain = withCtx(s, (ctx) => directDamage(ctx, opOf(s, 'B', 'kom.grot'), 99, w, 'test')).state
    expect(plain.operatives[opOf(s, 'B', 'kom.grot')]!.status).toBe('removed')
  })

  it('GEN-114 a rule kill opens the killer seat\'s operative.killed window (cause direct), in any activation', () => {
    const { s: s0, w, boy } = open()
    const s = withPloy(s0, ploy('test.f.killed', AOD, 'operative.killed'))
    const asked = withCtx(s, (ctx) => {
      directDamage(ctx, boy, 99, w, 'test')
      expect(ctx.state.operatives[boy]!.status).toBe('active')
      runDeferredRemovals(ctx)
      expect(ctx.state.window).toMatchObject({ id: 'operative.killed', info: { subjectId: w, removedId: boy, cause: 'direct' } })
    }).state
    expect(asked.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'operative.killed' })
    const after = passIt(asked).state
    expect(after.operatives[boy]!.status).toBe('removed')
    expect(after.pending?.id).toBe(s.pending!.id)
  })

  it('GEN-115 counteraction.end runs when a counteraction ends, with the actions it performed', () => {
    const seen: string[] = []
    hook('counteraction.end', (c) => (seen.push(`${c.operativeId}:${(c.data as { performed: string[] }).performed.join(',')}`), null))
    let s = toFirefight(makeSetup({ sizeA: 2, sizeB: 3 }), 'counter')
    const end = (st: GameState) => apply(st, (p) => act.action(p, 'end')).state
    s = end(activateSynth(s, 'A1'))
    s = end(activateSynth(s, 'B1'))
    s = end(activateSynth(s, 'A2'))
    s = end(activateSynth(s, 'B2'))
    s = edit(s, (x) => void (x.operatives['A1']!.pos = { x: 0, y: 0, z: 0 }))
    s = apply(s, (p) => act.activate(p, 'A1', true)).state
    expect(seen).toEqual([])
    s = apply(s, (p) => act.action(p, 'reposition')).state
    s = expectOk(path(s, [{ x: 1, z: 0, y: 0 }])).state
    expect(seen).toEqual(['A1:reposition'])
    expect(s.firefight.activation).toBeNull()
  })

  it('GEN-116 firefight.actionDeclared opens for Charge and Reposition, and inside free-action frames with info.free', () => {
    const { s: s0, w } = open()
    const s = withPloy(s0, ploy('test.f.declared', AOD, 'firefight.actionDeclared'))
    const st = take(activateOp(s, w), 'reposition').state
    expect(st.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'A', window: 'firefight.actionDeclared' })
    expect(st.window?.info).toMatchObject({ action: 'reposition', subjectId: w })
    const free = withCtx(s, (ctx) => expect(startFreeAction(ctx, { operativeId: w, action: 'reposition', resume: 'test-f.free' })).toBe(true)).state
    expect(free.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.actionDeclared' })
    expect(free.window?.info).toMatchObject({ action: 'reposition', free: true })
  })

  it('GEN-122 a "before or after an action" ploy (Adjust Doctrine) is offered at a declaration only before the first action, never in a free frame: one offer per action plus one', () => {
    const { s: s0, w } = open()
    const s = edit(s0, (x) => {
      x.players.A.cp = 6
      if (!x.ledger.A.tp.includes('aod.p.combat-doctrine')) x.ledger.A.tp.push('aod.p.combat-doctrine')
      x.config.A.doctrine = 'tactical'
    })
    const seen: string[] = []
    // pass every ploy window, noting where Adjust Doctrine was on offer, until the next action choice
    const settle = (st: GameState, drive = false): GameState => {
      const rng = new ScriptedRng(Array(60).fill(4))
      for (let i = 0; i < 60 && st.pending && (st.pending.kind === 'ploy.firefight' || (drive && st.pending.kind !== 'firefight.action' && st.pending.kind !== 'firefight.activate')); i++) {
        if (st.pending.kind !== 'ploy.firefight') {
          st = expectOk(step(st, defaultAnswer(st), rng)).state
          continue
        }
        if (st.pending.options!.some((o) => o.id.startsWith('aod.p.adjust-doctrine'))) seen.push(`${st.pending.window}:${String(st.window?.info.action)}`)
        st = passIt(st).state
      }
      return st
    }
    const boy = opOf(s, 'B', 'kom.boy')
    const lane = edit(s, (x) => {
      x.operatives[w]!.pos = { x: 0, y: 0, z: -4 }
      x.operatives[boy]!.pos = { x: 0, y: 0, z: 6 }
    })
    let st = settle(take(activateOp(lane, w), 'reposition').state)
    st = settle(expectOk(path(st, [{ x: st.operatives[w]!.pos.x + 1, z: st.operatives[w]!.pos.z }])).state)
    // the Shoot's declaration is not offered again: the Reposition's actionEnded offer was that moment
    st = settle(take(st, 'shoot').state, true)
    expect(seen).toEqual(['firefight.actionDeclared:reposition', 'firefight.actionEnded:reposition', 'firefight.actionEnded:shoot'])
    // a free Reposition inside the activation: no declaration offer
    const free = withCtx(settle(take(activateOp(s, w), 'reposition').state), (ctx) => void startFreeAction(ctx, { operativeId: w, action: 'reposition', resume: 'test-f.free' })).state
    expect(free.pending?.kind).toBe('move.path')
  })

  it('GEN-117 checkPerformed: a free action inside the operative\'s own activation keeps R-3.7 and the move bars and counts as performed; outside it does not', () => {
    const { s, w, cap } = open()
    const inAct = (performed: string[]) => edit(activateOp(s, w), (x) => void (x.firefight.activation!.performed = performed))
    const dash = { operativeId: w, action: 'dash' as const, resume: 'test-f.free' }
    expect(canStartFreeAction(inAct(['charge']), dash)).toBe(true) // default: unchanged
    expect(canStartFreeAction(inAct(['charge']), { ...dash, checkPerformed: true })).toBe(false)
    expect(canStartFreeAction(inAct(['dash']), { ...dash, checkPerformed: true })).toBe(false)
    expect(canStartFreeAction(inAct(['shoot']), { ...dash, checkPerformed: true })).toBe(true)
    expect(canStartFreeAction(inAct(['charge']), { ...dash, checkPerformed: true, ignorePerformed: true })).toBe(true)
    // another operative's activation: R-3.9, its own activation is untouched
    expect(canStartFreeAction(inAct(['dash']), { ...dash, operativeId: cap, checkPerformed: true })).toBe(true)
    // the finished free Reposition is recorded on the activation
    const started = withCtx(inAct([]), (ctx) => expect(startFreeAction(ctx, { operativeId: w, action: 'reposition', resume: 'test-f.free', checkPerformed: true })).toBe(true)).state
    const pos = started.operatives[w]!.pos
    const moved = expectOk(path(started, [{ x: pos.x + 1, z: pos.z }])).state
    expect(moved.firefight.activation!.performed).toEqual(['reposition'])
    expect(moved.pending).toMatchObject({ kind: 'firefight.action', seat: 'A' })
    expect(moved.pending!.options!.map((o) => o.id)).not.toContain('reposition')
  })

  it('GEN-118 clearances[].except ignores the named markers only', () => {
    const { s } = open()
    const st = edit(s, (x) => {
      x.data.equipment = {
        ...(x.data.equipment ?? {}),
        'test.totem': { id: 'test.totem', name: 'T', scope: 'faction', count: 1, setup: { type: 'marker', markerMm: 20, clearances: [{ from: ['otherMarkers'], moreThan: 2, except: ['test.cadaver'] }] }, text: 't', source: 's' } as never,
      }
      x.markers = [] // no objectives near the test points
      x.markers.push({ id: 'cad', kind: 'equipment', pos: { x: 0, z: 0 }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'test.cadaver' } as never)
      x.markers.push({ id: 'other', kind: 'equipment', pos: { x: 0, z: 8 }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'test.other' } as never)
    })
    const item = { key: 'k', equipmentId: 'test.totem', kind: 'marker' as const }
    expect(placementIssue(st, 'A', item, { x: 1, z: 0 }, 0)?.reason ?? null).toBeNull()
    expect(placementIssue(st, 'A', item, { x: 1, z: 8 }, 0)?.reason).toMatch(/more than 2/)
  })

  it('GEN-119 a free-point decision accepts any point its handler allows, rejects others with the reason, and passes to the rule', () => {
    const { s } = open()
    const got: string[] = []
    registerPointHandler('test-f.point', {
      problem: (_st, _seat, p) => (Math.abs(p.x) > 3 ? 'too far from the centre line' : null),
      done(ctx, seat, p) {
        got.push(p ? `${seat}:${p.x},${p.z}` : `${seat}:pass`)
        continueActivation(ctx)
      },
    })
    const asked = withCtx(activateOp(s, opOf(s, 'A', 'aod.intercessor-warrior')), (ctx) => raisePointChoice(ctx, { handler: 'test-f.point', seat: 'A', window: 'firefight.actionEnded', spots: [{ x: 0, z: 0 }], suggestion: { x: 0, z: 0 } })).state
    expect(asked.pending).toMatchObject({ kind: 'marker.place', canPass: true, context: { pointHook: 'test-f.point', spots: [{ x: 0, z: 0 }] } })
    const answer = (x: number, z: number) => step(asked, { type: 'marker.place', seat: 'A', decisionId: asked.pending!.id, payload: { x, z } })
    expect(answer(5, 1).rejection).toMatchObject({ code: 'E_OUT_OF_RANGE', reason: 'too far from the centre line' })
    expect(answer(1.25, -2).rejection).toBeUndefined()
    passIt(asked)
    expect(got).toEqual(['A:1.25,-2', 'A:pass'])
  })

  it('GEN-120 a Grenadier keeps its own frag grenade once the team picks are spent; other operatives lose it', () => {
    const s0 = openReal({ equipmentA: ['core.e.explosive-grenades'], rosterA: roster(['aod.space-marine-captain', 'aod.assault-intercessor-grenadier', 'aod.intercessor-warrior']) })
    const gr = opOf(s0, 'A', 'aod.assault-intercessor-grenadier')
    const w = opOf(s0, 'A', 'aod.intercessor-warrior')
    const frag = 'core.w.frag-grenade'
    const s = edit(s0, (x) => {
      for (const id of [gr, w]) if (!x.operatives[id]!.weapons.includes(frag)) x.operatives[id]!.weapons.push(frag)
      for (let i = 0; i < 10; i++) addUse(x, 'A', `limit:${frag}`)
    })
    const r = withCtx(s, (ctx) => noteWeaponUses(ctx)).state
    expect(r.operatives[gr]!.weapons).toContain(frag)
    expect(r.operatives[w]!.weapons).not.toContain(frag)
    // its own throw spent: it goes too
    const spent = withCtx(edit(s, (x) => void (x.operatives[gr]!.usedLimited[frag] = 1)), (ctx) => noteWeaponUses(ctx)).state
    expect(spent.operatives[gr]!.weapons).not.toContain(frag)
  })

  it('GEN-121 a free action in the actor\'s own activation asks the actor\'s ownReactions (freeActions) first, then the other seat\'s reactions', () => {
    const { s, w, boy } = open()
    const asked: string[] = []
    registerCodeHook({ name: 'test-f.react', choice: () => undefined })
    provide({
      ownReactions: (_st, seat, info) => (seat === 'A' && info.freeAction ? [{ hook: 'test-f.react', operativeId: w, option: 'x', labelKey: 'own', freeActions: true }] : []),
      reactions: (_st, seat, info) => (seat === 'B' && info.freeAction ? [{ hook: 'test-f.react', operativeId: boy, option: 'y', labelKey: 'theirs', freeActions: true }] : []),
    })
    const started = withCtx(activateOp(s, w), (ctx) => void startFreeAction(ctx, { operativeId: w, action: 'reposition', resume: 'test-f.free' })).state
    const pos = started.operatives[w]!.pos
    let st = expectOk(path(started, [{ x: pos.x + 1, z: pos.z }])).state
    for (let i = 0; i < 3 && st.pending?.kind === 'ability.choice'; i++) {
      asked.push(`${st.pending.seat}:${st.pending.options![0]!.labelKey}`)
      st = passIt(st).state
    }
    expect(asked).toEqual(['A:own', 'B:theirs'])
    expect(st.pending).toMatchObject({ kind: 'firefight.action', seat: 'A' })
    void place
  })
})
