// pathfinders engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-PF-nnn).
// The first import is the engine index on purpose: it fixes the module load order (ploys.ts and the team files import each other).
import { describe, expect, it } from 'vitest'
import { step } from '@/engine'
import { act } from '@/engine/actions'
import { abilityOffers } from '@/engine/abilities'
import { attackStats, effectiveRules, inflict, ruleSetFor, targetInfo, validTargets } from '@/engine/attack-common'
import { getCodeHook, hookFireCount } from '@/engine/code-hooks'
import { actionAvailability } from '@/engine/firefight'
import { planMove } from '@/engine/movement'
import { offersFor, usePloy } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { effectiveMove } from '@/engine/state'
import { ownEdge } from '@/engine/teams/pathfinders'
import { providerControlApl, providerMoveSurcharge } from '@/engine/team-rules'
import { tokenCount, tokensOnActivationStart, tokensOnTurningPointEnd } from '@/engine/tokens'
import type { Action, GameState, Marker, PendingDecision } from '@/engine/types'
import { CODE_HOOKS, enumerateLoadouts, loadBundle, resolveLoadout, slotCost, validateRoster } from '../../../src/data'
import { play } from '../../fixtures/attack'
import { place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { activateOp, edit, hasOption, openReal, optionIds, passIt, realBundle, take, withCtx } from '../../fixtures/real'
import { A, B, go, lightWall, ML, opsOf, pfOpen, ruleKill, scenarios, toGambit, withEffect, withTerrain, worthyStart } from './pathfinders.hooks'

const data = loadBundle()
const TEAM = data.teams['pathfinders']!

const ml = (id: string, suffix = ''): string => `ability:pf.a.markerlight:${id}${suffix}`

function withTokens(s: GameState, id: string, n: number): GameState {
  return edit(s, (st) => {
    st.operatives[id]!.tokens = n > 0 ? [{ kind: ML, owner: 'A', count: n, since: 0 }] : []
  })
}

function wall(x0: number, x1: number, traits: ('heavy' | 'light' | 'blocking')[], height = 3): ReturnType<typeof feature> {
  return feature('pf-t', part('pf-t.a', rect(x0, x1, -3, 3), height, traits))
}

const pass = (p: { id: string; seat: 'A' | 'B' }): Action => act.pass(p)

function path(s: GameState, ...pts: [number, number][]): Action {
  const p = s.pending!
  return act.path(p, pts.map(([x, z]) => ({ x, z })))
}

/** Pass every ploy window that is open. */
function clear(s: GameState): GameState {
  let t = s
  while (t.pending?.kind === 'ploy.firefight') t = passIt(t).state
  return t
}

/** End the activation in progress; B plays a quick activation, so A is up again. */
function nextA(s: GameState): GameState {
  let u = clear(take(clear(s), 'end').state)
  // a chained activation (Group Activation) is owed first
  while (u.pending?.kind === 'firefight.activate' && u.pending.seat === 'A') u = clear(take(activateOp(u, u.pending.options![0]!.id), 'end').state)
  const b = Object.values(u.operatives).find((o) => o.seat === 'B' && o.ready)!.id
  u = take(activateOp(u, b), 'end').state
  return clear(u)
}

/** A shoots nothing: activate and end, so B is up. */
function endA(s: GameState, who: string): GameState {
  return take(activateOp(s, who), 'end').state
}

describe('pathfinders', () => {
  it('TEAM-PF-000 the team is registered, playable, and every hook its data names is registered and fires', () => {
    expect(realBundle.teams['pathfinders']).toBeDefined()
    expect(TEAM.playable).not.toBe(false)
    const names = CODE_HOOKS.filter((h) => h.usedBy.some((id) => id.startsWith('pf.'))).map((h) => h.name)
    expect(names.length).toBeGreaterThanOrEqual(30)
    const missing: string[] = []
    for (const name of names) {
      expect(getCodeHook(name), name).toBeDefined()
      const run = scenarios[name]
      if (!run) {
        missing.push(name)
        continue
      }
      run()
      expect(hookFireCount(name), `${name} never fired`).toBeGreaterThan(0)
    }
    expect(missing).toEqual([])
  })

  it('TEAM-PF-001 roster: 1 Shas\'ui plus 11 selections, the MB3 counts as two, Shas\'la unlimited, Weapons Expert at most two', () => {
    const cards = data.byId as Record<string, { name: string; team: string }>
    const check = (main: string[]) => validateRoster(TEAM, { leader: ['pf.shasui'], main }, cards as never)
    const ok = (main: string[]) => expect(check(main).reasons, main.join()).toEqual([])
    const bad = (main: string[], re: RegExp) => expect(check(main).reasons.join('|')).toMatch(re)
    const main = TEAM.selection.slots[1]!
    ok(['pf.assault-grenadier', 'pf.blooded', 'pf.comms-specialist', 'pf.drone-controller', 'pf.marksman', 'pf.medical-technician', 'pf.shasla', 'pf.shasla', 'pf.transpectral-interference', 'pf.weapons-expert', 'pf.mv1-gun-drone'])
    // 11 Shas'la is fine
    ok(Array<string>(11).fill('pf.shasla'))
    // the MB3 uses two of the eleven selections
    ok(['pf.mb3-recon-drone', ...Array<string>(9).fill('pf.shasla')])
    bad(['pf.mb3-recon-drone', ...Array<string>(10).fill('pf.shasla')], /12 selections chosen, 11 required/)
    expect(slotCost(main, ['pf.mb3-recon-drone', 'pf.blooded'])).toBe(3)
    // Weapons Expert twice, not three times; every other entry once
    ok(['pf.weapons-expert', 'pf.weapons-expert', ...Array<string>(9).fill('pf.shasla')])
    bad(['pf.weapons-expert', 'pf.weapons-expert', 'pf.weapons-expert', ...Array<string>(8).fill('pf.shasla')], /at most 2/)
    bad(['pf.blooded', 'pf.blooded', ...Array<string>(9).fill('pf.shasla')], /only once/)
    // loadouts: the Weapons Expert picks the ion rifle (both profiles) or the rail rifle, always with the gun butt
    const we = data.byId['pf.weapons-expert'] as never
    const loadouts = enumerateLoadouts(we)
    expect(loadouts).toHaveLength(2)
    const sets = loadouts.map((l) => resolveLoadout(we, l, data.weaponGroups).sort())
    expect(sets).toContainEqual(['pf.w.gun-butt', 'pf.w.ion-rifle-overcharge', 'pf.w.ion-rifle-standard'])
    expect(sets).toContainEqual(['pf.w.gun-butt', 'pf.w.rail-rifle'])
    // a roster must have exactly one leader
    expect(validateRoster(TEAM, { leader: [], main: [] }).ok).toBe(false)
  })

  it('TEAM-PF-002 Markerlight adds a token to a visible enemy, caps at 4, persists, and decays once per enemy activation but never in a counteraction', () => {
    let s = pfOpen()
    const sh = A(s, 'pf.shasui')
    const boy = B(s, 'kom.boy')
    s = place(place(s, sh, 0, 0), boy, 6, 0)
    // one token, visible to both seats
    let t = go(s, sh, ml(boy))
    expect(tokenCount(t, boy, ML, 'A')).toBe(1)
    expect(hasOption(t, ml(boy))).toBe(false) // once per activation
    // the cap is 4
    const capped = go(withTokens(s, boy, 4), sh, ml(boy))
    expect(tokenCount(capped, boy, ML, 'A')).toBe(4)
    // tokens stay across turning points
    expect(tokenCount(withCtx(capped, (ctx) => tokensOnTurningPointEnd(ctx)).state, boy, ML, 'A')).toBe(4)
    // decay: a Dash removes one, a later Reposition in the same activation removes none
    const two = withTokens(s, boy, 2)
    t = take(activateOp(endA(two, sh), boy), 'dash').state
    t = clear(step(t, path(t, [5, 0])).state)
    expect(tokenCount(t, boy, ML, 'A')).toBe(1)
    t = take(t, 'reposition').state
    t = clear(step(t, path(t, [4, 1])).state)
    expect(tokenCount(t, boy, ML, 'A')).toBe(1)
    // a counteraction never removes a token
    const c = edit(withTokens(s, boy, 2), (st) => {
      for (const o of Object.values(st.operatives)) if (o.seat === 'B') o.ready = false
    })
    let u = endA(c, sh)
    expect(hasOption(u, `counteract:${boy}`)).toBe(true)
    u = clear(take(u, `counteract:${boy}`).state)
    u = take(u, 'dash').state
    u = step(u, path(u, [5, 0])).state
    expect(tokenCount(u, boy, ML, 'A')).toBe(2)
  })

  it('TEAM-PF-003 Shoot and Markerlight in one activation share their target in either order; the MB3 is exempt; a Guard shot is not linked', () => {
    let s = pfOpen()
    const sh = A(s, 'pf.shasui')
    const e1 = B(s, 'kom.boy')
    const e2 = B(s, 'kom.dakka-boy')
    s = place(place(place(s, sh, 0, 0), e1, 6, 0), e2, 6, 2.6)
    const targets = (st: GameState) => optionIds(st).filter((id) => st.pending?.kind === 'shoot.target')
    // Shoot first, then Markerlight can only pick the shot target
    let t = take(take(activateOp(s, sh), 'shoot', new ScriptedRng(Array<number>(20).fill(1))).state, 'pf.w.pulse-carbine-shasui').state
    t = take(t, e1, new ScriptedRng(Array<number>(20).fill(1))).state
    t = play(t, new ScriptedRng(Array<number>(20).fill(1)), { 'dice.commandReroll': pass, 'dice.reroll': pass }).state
    expect(t.pending?.kind).toBe('firefight.action')
    expect(optionIds(t).filter((id) => id.startsWith('ability:pf.a.markerlight'))).toEqual([ml(e1)])
    // Markerlight first, then Shoot can only pick the marked target
    const m = go(s, sh, ml(e2))
    const shot = take(m, 'shoot').state
    expect(shot.pending?.kind).toBe('shoot.weapon')
    expect(targets(take(shot, 'pf.w.pulse-carbine-shasui').state)).toEqual([e2])
    // the MB3 is not bound by the link
    const mb3 = A(s, 'pf.mb3-recon-drone')
    const d = go(place(s, mb3, 0, 0), mb3, ml(e2))
    const w = take(take(d, 'shoot').state, 'pf.w.burst-cannon-focused').state
    expect(targets(w)).toEqual(expect.arrayContaining([e1, e2]))
    // a Guard shot (an interrupt frame) ignores the link
    const linked = withEffect(m, 'pf.link', 'A', { operativeId: sh, kind: 'pf.link', expires: 'activation', data: { targetId: e2 } })
    expect(validTargets(linked, linked.operatives[sh]!, 'pf.w.pulse-carbine-shasui').map((x) => x.id)).toEqual([e2])
    const guard = edit(linked, (st) => {
      st.firefight.activation!.frame = { kind: 'interrupt', resume: 'x' }
    })
    expect(validTargets(guard, guard.operatives[sh]!, 'pf.w.pulse-carbine-shasui').map((x) => x.id)).toEqual(expect.arrayContaining([e1, e2]))
  })

  it('TEAM-PF-004 token rows apply cumulatively: Saturate and Balanced, Hit +1 to 3+, no obscured, Seek Light, Seek; the fusion grenade and frag get nothing', () => {
    const base = pfOpen()
    const sla = A(base, 'pf.shasla')
    const sui = A(base, 'pf.shasui')
    const boy = B(base, 'kom.boy')
    const at = (s: GameState, n: number) => withTokens(place(place(place(s, sla, 0, 0), sui, 0, 1.2), boy, 6, 0), boy, n)
    const rules = (s: GameState, who: string, w: string) => effectiveRules(s, s.operatives[who]!, s.data.weapons[w]!, 'shoot', boy).map((r) => r.rule)
    // row 1
    expect(rules(at(base, 0), sla, 'pf.w.pulse-carbine')).not.toContain('saturate')
    expect(rules(at(base, 1), sla, 'pf.w.pulse-carbine')).toEqual(expect.arrayContaining(['saturate', 'balanced']))
    // row 2: Hit improved by 1 but never better than 3+ (the Shas'ui's 3+ carbine is unchanged, a Shas'la's 4+ becomes 3+)
    const need = (s: GameState, who: string, w: string) => attackStats(s, who, w, boy, { kind: 'shoot' }).need
    expect(need(at(base, 1), sla, 'pf.w.pulse-carbine')).toBe(4)
    expect(need(at(base, 2), sla, 'pf.w.pulse-carbine')).toBe(3)
    expect(need(at(base, 2), sui, 'pf.w.pulse-carbine-shasui')).toBe(3)
    const hurt = edit(at(base, 2), (st) => {
      st.operatives[sui]!.wounds = 2
    })
    expect(need(hurt, sui, 'pf.w.pulse-carbine-shasui')).toBe(3) // an injured 3+ weapon is back at 3+, not 2+
    // row 3: the target cannot be obscured
    const walled = withTerrain(at(base, 0), wall(2.9, 3.1, ['heavy']))
    const sees = (s: GameState) => targetInfo(s, s.operatives[sla]!, s.operatives[boy]!, ruleSetFor(s, s.operatives[sla]!, 'pf.w.pulse-carbine', 'shoot', boy)).obscured
    expect(sees(walled)).toBe(true)
    expect(sees(withTokens(walled, boy, 3))).toBe(false)
    // row 4: Seek Light makes a Conceal target in Light cover selectable; row 5 (Target Analysis Optic) Seek does it for Heavy cover
    const lit = edit(withTerrain(at(base, 0), lightWall(4.8, 5.2)), (st) => {
      st.operatives[boy]!.order = 'conceal'
    })
    const valid = (s: GameState) => validTargets(s, s.operatives[sla]!, 'pf.w.pulse-carbine').map((x) => x.id)
    expect(valid(lit)).not.toContain(boy)
    expect(valid(withTokens(lit, boy, 3))).not.toContain(boy)
    expect(valid(withTokens(lit, boy, 4))).toContain(boy)
    const heavy = edit(withTerrain(at(base, 0), feature('pf-h', part('pf-h.a', rect(4.9, 5.2, -2, 2), 1, ['heavy']))), (st) => {
      st.operatives[boy]!.order = 'conceal'
    })
    expect(valid(withTokens(heavy, boy, 4))).not.toContain(boy)
    const optic = withEffect(withTokens(heavy, boy, 4), 'pf.e.target-analysis-optic', 'A', { operativeId: sla, kind: 'equipment', expires: 'action' })
    expect(valid(optic)).toContain(boy)
    // the fusion grenade and frag/krak grenades are not on the benefit list
    const ag = A(base, 'pf.assault-grenadier')
    const g = withTokens(place(place(base, ag, 0, 0), boy, 4, 0), boy, 2)
    expect(rules(g, ag, 'pf.w.fusion-grenade').filter((r) => r === 'balanced')).toHaveLength(0)
    expect(rules(g, ag, 'core.w.frag-grenade')).not.toContain('balanced')
    expect(rules(g, ag, 'pf.w.pulse-carbine')).toContain('balanced')
    // the benefits are read off the target by every Pathfinder, drones too
    const drone = A(base, 'pf.mv1-gun-drone')
    const d = withTokens(place(place(base, drone, 0, 0), boy, 4, 0), boy, 1)
    expect(rules(d, drone, 'pf.w.twin-pulse-carbine')).toContain('balanced')
  })

  it('TEAM-PF-005 Art of War: free of CP, each option once per battle; Mont\'ka +1" Move, Kauyon a free Markerlight for Conceal operatives; Veteran swaps for the Blooded', () => {
    const g = toGambit()
    expect(hasOption(g, 'pf.p.art-of-war:montka')).toBe(true)
    expect(g.pending!.options!.find((o) => o.id === 'pf.p.art-of-war:kauyon')!.data!.cost).toBe(0)
    const afterMontka = take(g, 'pf.p.art-of-war:montka').state
    expect(afterMontka.players.A.cp).toBe(g.players.A.cp)
    const moveOf = (s: GameState, dc: string) => effectiveMove(s.operatives[A(s, dc)]!, s)
    expect(moveOf(afterMontka, 'pf.shasla')).toBe(7)
    expect(moveOf(afterMontka, 'pf.mv1-gun-drone')).toBe(9) // 6 + 1 Mont'ka + 2 Drone Controller
    // each option once per battle: with Mont'ka spent only Kauyon is offered in a later turning point
    const later = edit(afterMontka, (st) => {
      st.ledger.A.tp = []
      st.effects = []
    })
    expect(offersFor(later, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).filter((o) => o.ployId === 'pf.p.art-of-war').map((o) => o.param)).toEqual(['kauyon'])
    // Kauyon: a Conceal operative with Markerlight on its datacard may use it for 0 AP, an Engage one pays
    const k = open(drive(take(g, 'pf.p.art-of-war:kauyon').state))
    const sla = A(k, 'pf.shasla')
    const boy = B(k, 'kom.boy')
    const arena = place(place(k, sla, 0, 0), boy, 6, 0)
    const free = activateOp(arena, sla, 'conceal')
    expect(optionIds(free)).toContain(`ability:pf.a.markerlight-shasla:${boy}`)
    expect(free.pending!.options!.find((o) => o.id === `ability:pf.a.markerlight-shasla:${boy}`)!.data!.cost).toBe(0)
    const paid = activateOp(arena, sla, 'engage')
    expect(paid.pending!.options!.find((o) => o.id === `ability:pf.a.markerlight-shasla:${boy}`)!.data!.cost).toBe(1)
    const used = take(free, `ability:pf.a.markerlight-shasla:${boy}`).state
    expect(used.firefight.activation!.apSpent).toBe(0)
    // the Blooded may swap: Mont'ka picked, it gets Kauyon instead of the Move bonus
    const m = open(drive(afterMontka))
    const bl = A(m, 'pf.blooded')
    const enemy = B(m, 'kom.boy')
    const sw = take(take(place(place(m, bl, 0, 0), enemy, 6, 0), bl).state, 'conceal').state
    expect(sw.pending?.kind).toBe('ploy.firefight')
    expect(effectiveMove(sw.operatives[bl]!, sw)).toBe(7)
    const swapped = take(sw, 'pf.p.veteran').state
    expect(effectiveMove(swapped.operatives[bl]!, swapped)).toBe(6)
    expect(swapped.pending!.options!.find((o) => o.id === `ability:pf.a.markerlight:${enemy}`)!.data!.cost).toBe(0)
    // Kauyon picked, it gets the Move bonus instead of the free Markerlight
    const k2 = open(drive(take(g, 'pf.p.art-of-war:kauyon').state))
    const sw2 = take(take(place(place(k2, A(k2, 'pf.blooded'), 0, 0), B(k2, 'kom.boy'), 6, 0), A(k2, 'pf.blooded')).state, 'conceal').state
    const swapped2 = take(sw2, 'pf.p.veteran').state
    expect(effectiveMove(swapped2.operatives[A(k2, 'pf.blooded')]!, swapped2)).toBe(7)
    expect(swapped2.pending!.options!.find((o) => o.id === `ability:pf.a.markerlight:${B(k2, 'kom.boy')}`)!.data!.cost).toBe(1)
  })

  it('TEAM-PF-006 drones take only their whitelist; Remote Pilot lifts it for a 2" free action, repeatable but never the same drone-action twice; control APL counts 1 lower', () => {
    const s = pfOpen()
    const mv4 = s.operatives[A(s, 'pf.mv4-shield-drone')]!
    const mv1 = s.operatives[A(s, 'pf.mv1-gun-drone')]!
    expect(actionAvailability(s, mv4, 'guard', null)?.reason).toMatch(/Drone/)
    expect(actionAvailability(s, mv4, 'shoot', null)).not.toBeNull()
    expect(actionAvailability(s, mv1, 'guard', null)?.reason).toMatch(/Drone/)
    expect(actionAvailability(s, mv1, 'dash', null)).toBeNull()
    // a drone cannot Markerlight unless its datacard has it, nor Pulse Accelerator unless it is the MV31
    expect(abilityOffers(s, mv1, null).some((o) => o.abilityId === 'pf.a.markerlight')).toBe(false)
    // control APL
    const marker = s.markers.find((m) => m.kind === 'objective')!
    expect(providerControlApl(s, mv1, marker, 2)).toBe(1)
    expect(providerControlApl(s, s.operatives[A(s, 'pf.shasla')]!, marker, 2)).toBe(2)
    // Remote Pilot
    const c = A(s, 'pf.drone-controller')
    const d = mv4.id
    let t = go(place(place(s, c, 0, 0), d, 2, 0), c, `ability:pf.a.remote-pilot:${d}`)
    expect(hasOption(t, 'guard')).toBe(true) // normally forbidden for a drone
    expect(hasOption(t, 'dash')).toBe(true)
    t = take(t, 'guard').state
    expect(t.operatives[d]!.flags.guard).toBe(true)
    // back to the controller's activation: it can pilot again (1 AP left) but the drone cannot Guard twice
    expect(t.pending?.kind).toBe('firefight.action')
    expect(hasOption(t, `ability:pf.a.remote-pilot:${d}`)).toBe(true)
    t = take(t, `ability:pf.a.remote-pilot:${d}`).state
    expect(hasOption(t, 'guard')).toBe(false)
    expect(hasOption(t, 'reposition')).toBe(true)
    // the 2" cap
    t = take(t, 'reposition').state
    const far = step(t, path(t, [5.5, 0]))
    expect(far.rejection?.code).toBe('E_OUT_OF_RANGE')
    const near = step(t, path(t, [3.5, 0]))
    expect(near.rejection).toBeUndefined()
  })

  it('TEAM-PF-007 Medic! saves a non-drone within 3" once per TP at 1 wound with a free Dash and -1 APL for both; blocked in an enemy control range; Medikit heals 2D3 capped and skips the saved operative', () => {
    let s = pfOpen()
    const v = A(s, 'pf.shasla')
    const m = A(s, 'pf.medical-technician')
    const boy = B(s, 'kom.boy')
    s = edit(place(place(place(s, v, 0, 0), m, 2.2, 0), boy, 6, 0), (st) => {
      st.operatives[v]!.wounds = 2
    })
    // the Kommando shoots the Shas'la dead; Medic! leaves it on 1 wound
    let t = endA(s, A(s, 'pf.mv4-shield-drone'))
    t = take(activateOp(t, boy), 'shoot').state
    t = take(t, 'kom.w.slugga').state
    t = take(t, v, new ScriptedRng([6, 6, 6, 6, 1, 1, 1])).state
    const stops: PendingDecision['kind'][] = ['firefight.action', 'ability.choice', 'firefight.activate']
    const rng = new ScriptedRng([6, 6, 6, 6, 1, 1, 1])
    t = play(t, rng, { 'dice.commandReroll': pass, 'dice.reroll': pass }, stops).state
    // the owner is asked before the removal, the operative still at 0 wounds
    expect(t.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { hook: 'medic', operativeId: v, medicId: m } })
    expect(t.operatives[v]).toMatchObject({ status: 'active', wounds: 0 })
    t = play(take(t, 'save').state, rng, { 'dice.commandReroll': pass, 'dice.reroll': pass }, stops).state
    expect(t.operatives[v]!.status).toBe('active')
    expect(t.operatives[v]!.wounds).toBe(1)
    expect(t.operatives[v]!.aplMods).toBe(-1)
    expect(t.operatives[m]!.aplMods).toBe(-1)
    // then the reaction: a free Dash that must end in the medic's control range
    expect(t.pending?.kind).toBe('ability.choice')
    t = take(t, t.pending!.options![0]!.id).state
    expect(t.pending?.kind).toBe('move.path')
    expect(t.pending!.constraints!.mustEndInControlRangeOfId).toBe(m)
    // once per turning point: a second fatal blow does not trigger it again
    const ti = A(s, 'pf.transpectral-interference')
    const again = ruleKill(place(t, ti, 2.2, 2.6), ti, boy)
    expect(again.operatives[ti]!.status).toBe('removed')
    // the same blow in a fresh turning point is offered, and taken
    const fresh = ruleKill(place(edit(t, (st) => void (st.ledger.A.tp = [])), ti, 2.2, 2.6), ti, boy)
    expect(fresh.pending).toMatchObject({ kind: 'ability.choice', context: { hook: 'medic', operativeId: ti } })
    expect(take(fresh, 'save').state.operatives[ti]).toMatchObject({ status: 'active', wounds: 1 })
    // not when the medic or the victim is in an enemy control range
    const engaged = place(place(place(pfOpen(), v, 0, 0), m, 2.2, 0), boy, 2.9, 0)
    expect(ruleKill(engaged, v, boy).operatives[v]!.status).toBe('removed')
    // Medikit heals 2D3 (never above starting wounds), not the operative Medic! saved this turning point
    const wounded = edit(place(place(pfOpen(), m, 0, 0), v, 1.5, 0), (st) => {
      st.operatives[v]!.wounds = 1
    })
    const heal = go(wounded, m, `ability:pf.a.medikit:${v}`, new ScriptedRng([2, 4]))
    expect(heal.operatives[v]!.wounds).toBe(1 + 1 + 2)
    const saved = edit(wounded, (st) => {
      st.ledger.A.tp.push(`pf.medic.saved:${v}`)
    })
    expect(hasOption(activateOp(saved, m), `ability:pf.a.medikit:${v}`)).toBe(false)
  })

  it('TEAM-PF-008 Group Activation forces a second ready Shas\'la activation, never a third', () => {
    const s = pfOpen()
    const [a, b] = opsOf(s, 'A', 'pf.shasla') as [string, string]
    let t = take(activateOp(s, a), 'end').state
    expect(t.pending).toMatchObject({ kind: 'firefight.activate', seat: 'A' })
    expect(optionIds(t)).toEqual([b])
    t = take(activateOp(t, b), 'end').state
    expect(t.pending?.seat).toBe('B')
    // another operative is not chained, and with no ready Shas'la left nothing is owed
    const u = take(activateOp(s, A(s, 'pf.marksman')), 'end').state
    expect(u.pending?.seat).toBe('B')
  })

  it('TEAM-PF-009 Saviour Protocols sends the shot to a drone within 3" even if it is not valid; cover is capped by the original; free with a Drone Controller or the MV4; no effect against Blast', () => {
    const roster = { teams: ['pathfinders', 'kommandos'] as [string, string] }
    const setup = (o: { controller: boolean; drone: string; dronePos: [number, number]; cover?: boolean }) => {
      const ids = ['pf.shasui', 'pf.shasla', 'pf.mv1-gun-drone', 'pf.mv4-shield-drone', ...(o.controller ? ['pf.drone-controller'] : [])]
      const s = pfOpen({ ...roster, rosterA: ids.map((id) => ({ datacardId: id, loadout: { weaponIds: [] } })) as never })
      const target = A(s, 'pf.shasla')
      const drone = A(s, o.drone)
      const boy = B(s, 'kom.boy')
      let u = place(place(place(s, target, 0, 0), drone, o.dronePos[0], o.dronePos[1]), boy, 7.5, 0)
      if (o.cover) u = withTerrain(u, lightWall(1.2, 1.6))
      return { u, target, drone, boy }
    }
    const shoot = (u: GameState, boy: string, target: string) => {
      let t = endA(u, A(u, 'pf.shasui'))
      t = take(activateOp(t, boy), 'shoot').state
      t = take(t, 'kom.w.slugga').state
      return take(t, target).state
    }
    // no Controller, MV1: costs 1 CP; the drone is out of the shooter's range and still becomes the target
    const a = setup({ controller: false, drone: 'pf.mv1-gun-drone', dronePos: [-2.5, 0] })
    let t = shoot(a.u, a.boy, a.target)
    expect(t.pending?.kind).toBe('ploy.firefight')
    expect(t.pending!.options!.find((o) => o.id === `pf.p.saviour-protocols:${a.drone}`)!.data!.cost).toBe(1)
    t = take(t, `pf.p.saviour-protocols:${a.drone}`).state
    expect(t.attack!.targets[0]).toBe(a.drone)
    expect(t.players.A.cp).toBe(a.u.players.A.cp - 1)
    // the MV4 is free to use
    const b = setup({ controller: false, drone: 'pf.mv4-shield-drone', dronePos: [0, 2] })
    expect(shoot(b.u, b.boy, b.target).pending!.options!.find((o) => o.id === `pf.p.saviour-protocols:${b.drone}`)!.data!.cost).toBe(0)
    // a Drone Controller in the killzone makes it free for any drone
    const c = setup({ controller: true, drone: 'pf.mv1-gun-drone', dronePos: [0, 2] })
    expect(shoot(c.u, c.boy, c.target).pending!.options!.find((o) => o.id === `pf.p.saviour-protocols:${c.drone}`)!.data!.cost).toBe(0)
    // the drone is in cover only if the original target was: the target stands in cover, the drone does not
    const d = setup({ controller: true, drone: 'pf.mv1-gun-drone', dronePos: [-2, 0], cover: true })
    const dt = take(shoot(d.u, d.boy, d.target), `pf.p.saviour-protocols:${d.drone}`).state
    expect(dt.attack!.seq!.cover).toBe(false)
    // more than 3" away, or against a Blast weapon, nothing is offered
    const far = setup({ controller: true, drone: 'pf.mv1-gun-drone', dronePos: [0, 4.5] })
    expect(shoot(far.u, far.boy, far.target).pending?.kind).not.toBe('ploy.firefight')
  })

  it('TEAM-PF-010 Point-Blank Fusillade: a ranged weapon as the melee weapon, no blocking, Devastating/Piercing/Torrent off, resolves first only when ready on Engage with a pulse weapon', () => {
    const arena = () => {
      const s = pfOpen()
      const target = A(s, 'pf.shasla')
      const boy = B(s, 'kom.boy')
      return { s: place(place(s, target, 0, 0), boy, 6, 0), target, boy }
    }
    const charge = (s: GameState, boy: string) => {
      let t = endA(s, A(s, 'pf.mv4-shield-drone'))
      t = take(activateOp(t, boy), 'charge').state
      return step(t, path(t, [1.3, 0])).state
    }
    const { s, target, boy } = arena()
    let t = take(take(charge(s, boy), 'fight').state, target).state
    expect(t.pending?.kind).toBe('ploy.firefight')
    expect(hasOption(t, 'pf.p.point-blank-fusillade:pf.w.pulse-carbine')).toBe(true)
    expect(hasOption(t, 'pf.p.point-blank-fusillade:pf.w.fusion-grenade')).toBe(false)
    t = take(t, 'pf.p.point-blank-fusillade:pf.w.pulse-carbine').state
    expect(t.attack!.fight!.weaponD).toBe('pf.w.pulse-carbine')
    const r = play(t, new ScriptedRng([6, 6, 6, 6, 6, 6, 6, 6]), { 'dice.commandReroll': pass, 'dice.reroll': pass }, ['fight.resolve'])
    // the ready Engage Shas'la resolves first with a pulse weapon, and cannot block
    expect(r.state.pending).toMatchObject({ kind: 'fight.resolve', seat: 'A' })
    expect(r.state.pending!.options!.every((o) => o.id.startsWith('strike'))).toBe(true)
    // already activated: the attacker resolves first
    const spent = edit(s, (st) => {
      st.operatives[target]!.ready = false
    })
    const t2 = take(take(take(charge(spent, boy), 'fight').state, target).state, 'pf.p.point-blank-fusillade:pf.w.pulse-carbine').state
    const r2 = play(t2, new ScriptedRng([6, 6, 6, 6, 6, 6, 6, 6]), { 'dice.commandReroll': pass, 'dice.reroll': pass }, ['fight.resolve'])
    expect(r2.state.pending).toMatchObject({ kind: 'fight.resolve', seat: 'B' })
    // not offered when it was already in an enemy control range at the start of the activation
    const engaged = place(s, boy, 1.3, 0)
    let e = endA(engaged, A(engaged, 'pf.mv4-shield-drone'))
    e = take(take(activateOp(e, boy), 'fight').state, target).state
    expect(e.pending?.kind).not.toBe('ploy.firefight')
    // the weapon rules that do nothing under the ploy
    const mk = A(s, 'pf.marksman')
    const fx = withEffect(s, 'pf.p.point-blank-fusillade', 'A', { operativeId: mk, expires: 'action', data: { weaponId: 'pf.w.marksman-rail-rifle-standard' } })
    const fr = effectiveRules(fx, fx.operatives[mk]!, fx.data.weapons['pf.w.marksman-rail-rifle-standard']!, 'fight', boy).map((x) => x.rule)
    expect(fr).toEqual(['lethal'])
    expect(effectiveRules(s, s.operatives[mk]!, s.data.weapons['pf.w.marksman-rail-rifle-standard']!, 'shoot', boy).map((x) => x.rule)).toEqual(expect.arrayContaining(['devastating', 'piercing']))
  })

  it('TEAM-PF-011 Grav-inhibitor: +2" once to a non-Dash move that comes within sight and 6", Obstructing/Accessible extras cancelled, enemy melee Hit worse by 1 within 6"', () => {
    const s0 = pfOpen()
    const g = A(s0, 'pf.mv33-grav-inhibitor-drone')
    const boy = B(s0, 'kom.boy')
    const s = place(place(s0, g, 0, 0), boy, 10, 0)
    const op = s.operatives[boy]!
    // a path that stays out of the zone costs its length, one that ends inside it costs 2" more
    expect(providerMoveSurcharge(s, op, 'reposition', [{ x: 8, y: 0, z: 0 }], { horizontal: 4, accessible: 0, climb: 0, drop: 0 })).toBe(0)
    const outside = planMove(s, op, 'reposition', [{ x: 8, z: 0 }])
    expect(outside.ok && outside.cost).toBe(2)
    const inside = planMove(s, op, 'reposition', [{ x: 6.5, z: 0 }])
    expect(inside.ok && inside.cost).toBe(6) // 3.5" rounds up to 4" and the Grav-inhibitor adds 2"
    const tooFar = planMove(s, op, 'reposition', [{ x: 5, z: 0 }])
    expect(tooFar.ok).toBe(false)
    expect(!tooFar.ok && tooFar.rejection.code).toBe('E_OUT_OF_RANGE')
    expect(providerMoveSurcharge(s, op, 'reposition', [{ x: 5, y: 0, z: 0 }], { horizontal: 4, accessible: 1, climb: 0, drop: 0 })).toBe(1)
    // Dash is exempt
    expect(providerMoveSurcharge(s, op, 'dash', [{ x: 9, y: 0, z: 0 }], { horizontal: 3, accessible: 0, climb: 0, drop: 0 })).toBe(0)
    // out of sight: no surcharge
    const hidden = withTerrain(s, wall(6, 6.3, ['blocking']))
    expect(providerMoveSurcharge(hidden, hidden.operatives[boy]!, 'reposition', [{ x: 9, y: 0, z: 0 }], { horizontal: 3, accessible: 0, climb: 0, drop: 0 })).toBe(0)
    // melee Hit
    const closeBoy = place(s, boy, 4, 0)
    const hit = (st: GameState) => attackStats(st, boy, 'kom.w.choppa', A(st, 'pf.shasui'), { kind: 'fight' }).need
    expect(hit(closeBoy)).toBe(4)
    expect(hit(place(s, boy, 9, 0))).toBe(3)
    const hurt = edit(closeBoy, (st) => {
      st.operatives[boy]!.wounds = 2
    })
    expect(hit(hurt)).toBe(5) // injury and the Grav-inhibitor stack
    expect(attackStats(closeBoy, boy, 'kom.w.slugga', A(closeBoy, 'pf.shasui'), { kind: 'shoot' }).need).toBe(4) // only melee weapons
  })

  it('TEAM-PF-012 Suppressing Fire bans attack re-rolls when the target is not the closest valid one; Supporting Fire adds targets within 6" with friends in their control range', () => {
    const arena = (conceal = false) => {
      let s = withEffect(pfOpen(), 'pf.p.suppressing-fire', 'A')
      const near = A(s, 'pf.shasla')
      const far = A(s, 'pf.shasui')
      const boy = B(s, 'kom.dakka-boy')
      s = place(place(place(s, near, 2, 0), far, 0, 1), boy, 5.5, 0)
      if (conceal) s = edit(s, (st) => void (st.operatives[near]!.order = 'conceal'))
      return { s, near, far, boy }
    }
    const shot = (a: ReturnType<typeof arena>, at: string) => {
      let t = endA(a.s, A(a.s, 'pf.mv1-gun-drone'))
      t = take(activateOp(t, a.boy), 'shoot').state
      t = take(t, 'kom.w.dakka-shoota-short').state
      return take(t, at, new ScriptedRng(Array<number>(40).fill(1))).state
    }
    const a = arena()
    // shooting the farther target: no attack re-roll; the closest target keeps its re-rolls
    expect(shot(a, a.far).pending?.context.side).not.toBe('attack')
    expect(shot(a, a.near).pending?.context.side).toBe('attack')
    // a Conceal Pathfinder is ignored when finding the closest
    const c = arena(true)
    expect(shot(c, c.far).pending?.context.side).toBe('attack')
    // Supporting Fire
    let s = pfOpen()
    const sh = A(s, 'pf.shasui')
    const friend = A(s, 'pf.shasla')
    const boy = B(s, 'kom.boy')
    const far = B(s, 'kom.dakka-boy')
    s = place(place(place(place(s, sh, 2, 0), friend, 4.5, 0), boy, 6, 0), far, 9, 5)
    const valid = (st: GameState) => validTargets(st, st.operatives[sh]!, 'pf.w.pulse-carbine-shasui').map((x) => x.id)
    expect(valid(s)).not.toContain(boy)
    const info = { window: 'firefight.actionDeclared', subjectId: sh, action: 'shoot' }
    const offer = offersFor(s, 'A', 'firefight.actionDeclared', info).find((o) => o.ployId === 'pf.p.supporting-fire')
    expect(offer).toBeDefined()
    const fx = withEffect(s, 'pf.p.supporting-fire', 'A', { operativeId: sh, expires: 'action' })
    expect(valid(fx)).toContain(boy)
    // beyond 6" the ploy does nothing
    const farAway = withEffect(place(s, boy, 9.5, 0), 'pf.p.supporting-fire', 'A', { operativeId: sh, expires: 'action' })
    expect(valid(farAway)).not.toContain(boy)
  })

  it('TEAM-PF-013 equipment limits: Target Analysis Optic once per TP, High-intensity Markerlight twice, Photon Grenade once and 3+ for Move -2" (floor 4) and no Dash, Orbital Survey Uplink once and never combined', () => {
    // High-intensity Markerlight: two tokens, twice per TP, not for the MV7 (which has its own)
    let s = pfOpen({ equipmentA: ['pf.e.high-intensity-markerlight', 'pf.e.orbital-survey-uplink', 'pf.e.photon-grenade', 'pf.e.target-analysis-optic'] })
    const sh = A(s, 'pf.shasui')
    const sla = A(s, 'pf.shasla')
    const cs = A(s, 'pf.comms-specialist')
    const mv7 = A(s, 'pf.mv7-marker-drone')
    const boy = B(s, 'kom.boy')
    const e2 = B(s, 'kom.dakka-boy')
    const e3 = B(s, 'kom.slasha-boy')
    s = place(place(place(place(place(place(place(s, sh, 0, 0), sla, 0, 1.5), cs, 0, -1.6), mv7, -1.6, 0), boy, 6, 0), e2, 6, 2.6), e3, 6, -2.6)
    expect(hasOption(activateOp(s, mv7), ml(boy, ':himl'))).toBe(false)
    let t = go(s, sh, ml(boy, ':himl'))
    expect(tokenCount(t, boy, ML, 'A')).toBe(2)
    t = take(activateOp(nextA(t), sla), `ability:pf.a.markerlight-shasla:${e2}:himl`).state
    expect(tokenCount(t, e2, ML, 'A')).toBe(2)
    expect(t.ledger.A.tpUses['pf.e.high-intensity-markerlight']).toBe(2)
    expect(hasOption(activateOp(nextA(t), cs), ml(e3, ':himl'))).toBe(false)
    expect(tokenCount(go(s, cs, ml(e3)), e3, ML, 'A')).toBe(1)
    // Photon Grenade: 3+ gives Move -2" (floor 4") and no Dash; once per turning point for the whole team, hit or miss
    const p = go(s, sh, `ability:pf.a.photon-grenade:${boy}`, new ScriptedRng([3]))
    expect(tokenCount(p, boy, 'pf.photon', 'A')).toBe(1)
    expect(effectiveMove(p.operatives[boy]!, p)).toBe(4)
    expect(actionAvailability(p, p.operatives[boy]!, 'dash', null)?.reason).toMatch(/Photon/)
    const miss = go(s, sh, `ability:pf.a.photon-grenade:${boy}`, new ScriptedRng([2]))
    expect(tokenCount(miss, boy, 'pf.photon', 'A')).toBe(0)
    expect(hasOption(activateOp(nextA(miss), sla), `ability:pf.a.photon-grenade:${boy}`)).toBe(false)
    // the token ends with the holder's next activation
    const ended = take(activateOp(take(clear(p), 'end').state, boy), 'end').state
    expect(tokenCount(ended, boy, 'pf.photon')).toBe(0)
    // Orbital Survey Uplink: an unseen enemy gets one token, once per turning point
    const blocked = withTerrain(s, wall(2, 2.4, ['blocking']))
    const seenIds = optionIds(activateOp(blocked, sh)).filter((id) => id.includes(boy) && id.includes('markerlight'))
    expect(seenIds).toEqual([ml(boy, '').replace(`:${boy}`, `:osu:${boy}`)])
    const osu = go(blocked, sh, seenIds[0]!)
    expect(tokenCount(osu, boy, ML, 'A')).toBe(1)
    expect(optionIds(activateOp(nextA(osu), cs)).some((id) => id.includes(':osu:'))).toBe(false)
    // Target Analysis Optic is offered once per turning point, as a Shoot is declared; it is spent when the Shoot resolves
    const tao = take(activateOp(s, sh), 'shoot').state
    expect(hasOption(tao, 'pf.e.target-analysis-optic')).toBe(true)
    const used = take(tao, 'pf.e.target-analysis-optic').state
    expect(used.effects.some((e) => e.source === 'pf.e.target-analysis-optic')).toBe(true)
    expect(used.ledger.A.tp).not.toContain('pf.e.target-analysis-optic')
    const aim = take(take(used, 'pf.w.pulse-carbine-shasui').state, boy, new ScriptedRng(Array<number>(30).fill(1))).state
    const done = play(aim, new ScriptedRng(Array<number>(30).fill(1)), { 'dice.commandReroll': pass, 'dice.reroll': pass }).state
    expect(done.ledger.A.tp).toContain('pf.e.target-analysis-optic')
    const second = take(activateOp(nextA(done), sla), 'shoot').state
    expect(hasOption(second, 'pf.e.target-analysis-optic')).toBe(false)
  })

  it('TEAM-PF-014 the MV4 ignores Piercing and one Normal Dmg per TP; Pulse Accelerator gives pulse weapons within 3" Lethal 5+ and Severe until the drone next activates or dies', () => {
    const s0 = pfOpen()
    const mv4 = A(s0, 'pf.mv4-shield-drone')
    const boy = B(s0, 'kom.boy')
    const mk = A(s0, 'pf.marksman')
    // Piercing and Piercing Crits are ignored against the MV4 only
    const rules = (st: GameState, who: string, w: string, vs: string) => effectiveRules(st, st.operatives[who]!, st.data.weapons[w]!, 'shoot', vs)
    const st = place(place(s0, mv4, 0, 0), A(s0, 'pf.weapons-expert'), 3, 0)
    const we = A(s0, 'pf.weapons-expert')
    expect(rules(st, we, 'pf.w.ion-rifle-standard', mv4).some((r) => r.rule === 'piercing')).toBe(false)
    expect(rules(st, we, 'pf.w.ion-rifle-standard', A(s0, 'pf.shasla')).some((r) => r.rule === 'piercing')).toBe(true)
    expect(rules(place(st, mk, 4, 0), mk, 'pf.w.marksman-rail-rifle-standard', mv4).map((r) => r.rule)).not.toContain('piercing')
    // one Normal Dmg per TP; crits are not ignored
    const hit = (state: GameState, source: string) => withCtx(state, (ctx) => void inflict(ctx, { targetId: mv4, attackerId: boy, weaponId: null, amount: 3, source })).state
    const one = hit(s0, 'normal')
    expect(one.operatives[mv4]!.wounds).toBe(s0.operatives[mv4]!.wounds)
    const two = hit(one, 'normal')
    expect(two.operatives[mv4]!.wounds).toBe(s0.operatives[mv4]!.wounds - 3)
    expect(hit(s0, 'crit').operatives[mv4]!.wounds).toBe(s0.operatives[mv4]!.wounds - 3)
    const fresh = edit(two, (x) => {
      x.ledger.A.tp = []
    })
    expect(hit(fresh, 'normal').operatives[mv4]!.wounds).toBe(two.operatives[mv4]!.wounds)
    // Pulse Accelerator
    const mv31 = A(s0, 'pf.mv31-pulse-accelerator-drone')
    const sla = A(s0, 'pf.shasla')
    let t = go(place(place(place(s0, mv31, 0, 0), sla, 2, 0), boy, 8, 0), mv31, 'ability:pf.a.pulse-accelerator')
    const rl = (state: GameState, who: string, w: string) => rules(state, who, w, boy).map((r) => r.rule)
    expect(rl(t, sla, 'pf.w.pulse-carbine')).toEqual(expect.arrayContaining(['lethal', 'severe']))
    expect(rl(t, we, 'pf.w.ion-rifle-standard')).not.toContain('severe') // not a pulse weapon
    expect(rl(place(t, sla, 4.5, 0), sla, 'pf.w.pulse-carbine')).not.toContain('severe') // more than 3" away
    // it ends when the drone next activates, or when it is incapacitated
    expect(tokenCount(withCtx(t, (ctx) => tokensOnActivationStart(ctx, mv31)).state, mv31, 'pf.pulse')).toBe(0)
    t = edit(t, (x) => {
      x.operatives[mv31]!.wounds = 0
    })
    expect(tokenCount(t, mv31, 'pf.pulse', 'A')).toBe(1)
  })

  it('TEAM-PF-015 every operative stat, base size and weapon profile matches the printed tables', () => {
    const stats: [string, number, number, string, number, number][] = [
      ['pf.shasui', 2, 6, '5+', 8, 25],
      ['pf.assault-grenadier', 2, 6, '5+', 7, 25],
      ['pf.blooded', 2, 6, '5+', 8, 25],
      ['pf.comms-specialist', 2, 6, '5+', 7, 25],
      ['pf.drone-controller', 2, 6, '5+', 7, 25],
      ['pf.marksman', 2, 6, '5+', 7, 25],
      ['pf.medical-technician', 2, 6, '5+', 7, 25],
      ['pf.shasla', 2, 6, '5+', 7, 25],
      ['pf.transpectral-interference', 2, 6, '5+', 7, 25],
      ['pf.weapons-expert', 2, 6, '5+', 7, 25],
      ['pf.mb3-recon-drone', 3, 6, '4+', 12, 32],
      ['pf.mv1-gun-drone', 2, 6, '4+', 7, 32],
      ['pf.mv4-shield-drone', 2, 6, '4+', 7, 32],
      ['pf.mv7-marker-drone', 2, 6, '4+', 7, 32],
      ['pf.mv31-pulse-accelerator-drone', 2, 6, '4+', 7, 32],
      ['pf.mv33-grav-inhibitor-drone', 2, 6, '4+', 7, 32],
    ]
    for (const [id, apl, move, save, wounds, base] of stats) {
      const c = data.byId[id] as { stats: { apl: number; move: number; save: string; wounds: number }; base: number; keywords: string[] }
      expect(c.stats, id).toEqual({ apl, move, save, wounds })
      expect(c.base, id).toBe(base)
      expect(c.keywords.slice(0, 2), id).toEqual(['PATHFINDER', "T'AU EMPIRE"])
    }
    const w = (id: string) => data.byId[id] as { type: string; atk: number; hit: string; dmg: { normal: number; crit: number }; rules: { rule: string; x?: number; inches?: number; target?: string; crits?: boolean; only?: string }[] }
    const sig = (id: string) => {
      const x = w(id)
      const rules = x.rules.map((r) => `${r.rule.replace('core.wr.', '')}${r.crits ? ' crits' : ''}${r.x !== undefined ? ` ${r.x}` : ''}${r.inches !== undefined ? ` ${r.inches}"` : ''}${r.target ? ` ${r.target}` : ''}${r.only ? ` (${r.only})` : ''}`)
      return `${x.type[0]} ${x.atk} ${x.hit} ${x.dmg.normal}/${x.dmg.crit} ${rules.join(', ')}`.trim()
    }
    expect(sig('pf.w.pulse-carbine-shasui')).toBe('r 4 3+ 4/5')
    expect(sig('pf.w.pulse-carbine')).toBe('r 4 4+ 4/5')
    expect(sig('pf.w.suppressed-pulse-carbine')).toBe('r 4 3+ 4/5 silent')
    expect(sig('pf.w.fusion-grenade')).toBe('r 4 3+ 4/3 range 6", devastating 2, limited 1, piercing 2, saturate')
    expect(sig('pf.w.marksman-rail-rifle-standard')).toBe('r 4 3+ 4/4 devastating 2, lethal 5+, piercing 1')
    expect(sig('pf.w.marksman-rail-rifle-dart')).toBe('r 4 3+ 3/4 piercing 1, silent')
    expect(sig('pf.w.ion-rifle-standard')).toBe('r 5 4+ 4/5 piercing crits 1')
    expect(sig('pf.w.ion-rifle-overcharge')).toBe('r 5 4+ 4/5 hot, lethal 5+, piercing 1')
    expect(sig('pf.w.rail-rifle')).toBe('r 4 4+ 4/4 devastating 2, lethal 5+, piercing 1')
    expect(sig('pf.w.burst-cannon-focused')).toBe('r 5 4+ 3/4 ceaseless, heavy (reposition), punishing')
    expect(sig('pf.w.burst-cannon-sweeping')).toBe('r 4 4+ 3/4 ceaseless, heavy (reposition), punishing, torrent 1"')
    expect(sig('pf.w.twin-pulse-carbine')).toBe('r 4 4+ 4/5 ceaseless')
    expect(sig('pf.w.gun-butt-shasui')).toBe('m 3 4+ 2/3')
    expect(sig('pf.w.gun-butt')).toBe('m 3 5+ 2/3')
    expect(sig('pf.w.bionic-arm')).toBe('m 3 4+ 3/4')
    expect(sig('pf.w.fists')).toBe('m 3 5+ 2/3')
    expect(sig('pf.w.ram')).toBe('m 3 5+ 2/3')
  })

it('TEAM-PF-016 Recon Sweep dashes the chosen Pathfinders in the player order, only to an end point wholly within 6" of an edge that is not their own; A Worthy Cause gives a free mission action only', () => {
    const g = open(toGambit())
    const recon = (st: GameState) => offersFor(st, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).filter((o) => o.ployId === 'pf.p.recon-sweep')
    expect(recon(g)).toHaveLength(0) // not in the first turning point
    const own = ownEdge(g, 'A')!
    const edge = (['north', 'south', 'west', 'east'] as const).find((e) => e !== own)!
    const near = (k: number): [number, number] => (edge === 'west' ? [-11.5, -3 + k * 2] : edge === 'east' ? [11.5, -3 + k * 2] : edge === 'north' ? [-3 + k * 2, -7.5] : [-3 + k * 2, 7.5])
    const [a, b] = opsOf(g, 'A', 'pf.shasla') as [string, string]
    let s = edit(place(place(g, a, ...near(0)), b, ...near(1)), (st) => {
      st.turningPoint = 2
    })
    const offer = recon(s).find((o) => o.param === edge)
    expect(offer).toBeDefined()
    expect(recon(s).some((o) => o.param === own)).toBe(false) // never the player's own edge
    s = withCtx(s, (ctx) => usePloy(ctx, 'A', offer!, { window: 'strategy.gambit' })).state
    expect(s.pending!.kind).toBe('ability.choice')
    expect(optionIds(s)).toEqual(expect.arrayContaining([a, b, 'done']))
    // the player picks the order: b first
    s = take(s, b).state
    expect(s.pending!.kind).toBe('move.path')
    // a Dash that ends deeper than 6" from every other edge is refused, one that stays near the edge is taken
    const [x, z] = near(1)
    const inward: [number, number] = edge === 'west' ? [x + 3, z] : edge === 'east' ? [x - 3, z] : edge === 'north' ? [x, z + 3] : [x, z - 3]
    expect(step(s, path(s, inward)).rejection?.code).toBe('E_OUT_OF_RANGE')
    const along: [number, number] = edge === 'west' || edge === 'east' ? [x, z + 1] : [x + 1, z]
    s = step(s, path(s, along)).state
    expect(s.operatives[b]!.pos.x).toBeCloseTo(along[0], 1)
    // back to the choice: a is still to go, then done hands the gambit step on
    expect(s.pending!.kind).toBe('ability.choice')
    expect(optionIds(s)).toEqual(expect.arrayContaining([a, 'done']))
    expect(optionIds(s)).not.toContain(b)
    s = take(s, 'done').state
    expect(s.pending!.kind).toBe('strategy.gambit')
    // A Worthy Cause: offered in the ploy window that opens as the Firefight phase starts (no longer a gambit);
    // the picked Pathfinder is offered mission actions only, then the window carries on into the first activation
    const { s: w, sla } = worthyStart()
    expect(w.phase).toBe('firefight')
    const cause = w.pending!.options!.find((o) => o.id.startsWith('pf.p.a-worthy-cause') && (o.action.payload as { operativeId?: string }).operativeId === sla)
    expect(cause).toBeDefined()
    let t = take(w, cause!.id).state
    expect(t.pending!.kind).toBe('firefight.action')
    expect(optionIds(t).filter((id) => id !== 'end').every((id) => id.startsWith('ability:core.a.'))).toBe(true)
    expect(hasOption(t, 'dash')).toBe(false)
    t = take(t, 'end').state
    expect(t.players.A.cp).toBe(w.players.A.cp - 1)
    while (t.pending?.kind === 'ploy.firefight') t = passIt(t).state
    expect(t.pending!.kind).toBe('firefight.activate')
  })
})

/** The same game on open ground, so sight lines never matter. */
function open(s: GameState): GameState {
  return edit(s, (st) => {
    st.map = { ...st.map, features: [] }
  })
}

function drive(s: GameState): GameState {
  let t = s
  for (let i = 0; i < 300 && t.pending && t.pending.kind !== 'firefight.activate'; i++) {
    const p = t.pending
    t = step(t, p.canPass ? act.pass(p) : p.options![0]!.action, new ScriptedRng([6, 1])).state
  }
  return t
}

describe('pathfinders rules verification fixes', () => {
  it('TEAM-PF-007 Medic! under a real enemy Guard interrupt: the free Dash is offered as a reaction once the interrupt is over, then the saved operative\'s activation ends', () => {
    const base = pfOpen()
    const v = A(base, 'pf.shasla')
    const m = A(base, 'pf.medical-technician')
    const boy = B(base, 'kom.boy')
    let s = edit(place(place(place(base, v, 0, 0), m, 2.2, 0), boy, 6, 0), (st) => {
      st.operatives[v]!.wounds = 2
      st.operatives[boy]!.order = 'engage'
      st.operatives[boy]!.flags.guard = true
    })
    s = take(activateOp(s, v), 'dash').state
    s = clear(step(s, path(s, [0, 1])).state)
    expect(s.pending).toMatchObject({ kind: 'guard.interrupt', seat: 'B' })
    s = take(s, `${boy}:shoot`).state
    s = take(s, 'kom.w.slugga').state
    const rng = new ScriptedRng([6, 6, 6, 6, 1, 1, 1, 1, 1, 1])
    s = take(s, v, rng).state
    const stops: PendingDecision['kind'][] = ['ability.choice', 'firefight.action', 'firefight.activate', 'move.path']
    s = play(s, rng, { 'dice.commandReroll': pass, 'dice.reroll': pass }, stops).state
    // the owner takes Medic! before the removal
    expect(s.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { hook: 'medic', operativeId: v } })
    s = play(take(s, 'save').state, rng, { 'dice.commandReroll': pass, 'dice.reroll': pass }, stops).state
    expect(s.operatives[v]).toMatchObject({ status: 'active', wounds: 1 })
    // the interrupt has finished; the Pathfinder player is offered the Dash as a reaction
    expect(s.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { reaction: true } })
    expect(s.pending!.options!.map((o) => o.data?.hook)).toContain('medic')
    s = take(s, s.pending!.options!.find((o) => o.data?.hook === 'medic')!.id).state
    expect(s.pending).toMatchObject({ kind: 'move.path', seat: 'A', constraints: { kind: 'dash', mustEndInControlRangeOfId: m } })
    s = clear(step(s, path(s, [1.2, 0.5])).state)
    expect(s.operatives[v]!.pos.x).toBeCloseTo(1.2)
    // used in its own activation: that activation is over (no AP may be spent); the next one is up (Group Activation
    // owes another Shas'la here)
    expect(s.operatives[v]!.ready).toBe(false)
    expect(s.firefight.activation).toBeNull()
    expect(s.pending).toMatchObject({ kind: 'firefight.activate' })
  })

  it('TEAM-PF-007 Medic! in the saved operative\'s own activation: the activation ends, also under an enemy Guard interrupt, and the free Dash is still offered after the action', () => {
    const base = pfOpen()
    const v = A(base, 'pf.shasla')
    const m = A(base, 'pf.medical-technician')
    const boy = B(base, 'kom.boy')
    const s = activateOp(place(place(place(base, v, 0, 0), m, 2.2, 0), boy, 8, 0), v)
    expect(s.firefight.activation?.operativeId).toBe(v)
    // struck down in its own activation: saved, its activation can spend no more AP, the Dash waits for the action's end
    const own = take(ruleKill(s, v, boy), 'save').state
    expect(own.operatives[v]!.wounds).toBe(1)
    expect(own.firefight.activation!.endsAfterAction).toBe(true)
    // the removal ran after the step: the activation's waiting action choice now offers only End
    expect(own.pending).toMatchObject({ kind: 'firefight.action', seat: 'A' })
    expect(optionIds(own)).toEqual(['end'])
    expect(own.effects.some((e) => e.kind === 'pf.medicDash' && e.operativeId === v)).toBe(true)
    // the Pathfinder player is the active one, so the Dash comes as a 0 CP offer in the action-ended window
    const info = { window: 'firefight.actionEnded', subjectId: v }
    const offer = offersFor(own, 'A', 'firefight.actionEnded', info).find((o) => o.ployId === 'pf.medicDash')
    expect(offer).toMatchObject({ cost: 0, operativeId: v })
    const dash = withCtx(edit(own, (st) => void (st.pending = null)), (ctx) => usePloy(ctx, 'A', offer!, info)).state
    expect(dash.pending?.kind).toBe('move.path')
    expect(dash.pending!.constraints!.mustEndInControlRangeOfId).toBe(m)
    expect(dash.effects.some((e) => e.kind === 'pf.medicDash')).toBe(false)
    // the opponent's window never offers it
    expect(offersFor(own, 'B', 'firefight.actionEnded', info).some((o) => o.ployId === 'pf.medicDash')).toBe(false)
    // under an enemy Guard interrupt the activation underneath is the saved operative's own: it ends too
    const interrupted = edit(s, (st) => {
      st.firefight.stack = [st.firefight.activation]
      st.firefight.activation = { operativeId: boy, seat: 'B', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null, frame: { kind: 'interrupt', resume: 'test' } }
    })
    const guard = take(ruleKill(interrupted, v, boy), 'save').state
    expect(guard.operatives[v]!.wounds).toBe(1)
    expect(guard.firefight.stack![0]!.endsAfterAction).toBe(true)
    expect(guard.firefight.activation!.apSpent).toBe(0)
  })

  it("GEN-086 TEAM-PF-007 Medic! in the saved operative's own activation: its -1 APL is held over and lasts for its next activation; the medic's applies at once", () => {
    const base = pfOpen()
    const v = A(base, 'pf.shasla')
    const m = A(base, 'pf.medical-technician')
    const boy = B(base, 'kom.boy')
    const s = activateOp(place(place(place(base, v, 0, 0), m, 2.2, 0), boy, 8, 0), v)
    const own = take(ruleKill(s, v, boy), 'save').state
    expect(own.operatives[v]!.wounds).toBe(1)
    // the saved operative is mid-activation: nothing yet, a deferred change instead; the medic is not, so -1 now
    expect(own.operatives[v]!.aplMods).toBe(0)
    expect(own.effects.some((e) => e.kind === 'core.aplNext' && e.operativeId === v)).toBe(true)
    expect(own.operatives[m]!.aplMods).toBe(-1)
    // the activation ends, B plays, then (made ready again) the saved operative's next activation starts at -1 APL
    let u = clear(take(clear(own), 'end').state)
    expect(u.operatives[v]!.aplMods).toBe(0)
    if (u.pending?.seat === 'B') u = clear(take(activateOp(u, boy), 'end').state)
    u = edit(u, (st) => {
      st.operatives[v]!.ready = true
      st.firefight.chain = null
      const o = st.pending!.options![0]!
      st.pending!.options!.push({ ...o, id: v, action: { ...o.action, payload: { ...(o.action.payload as object), operativeId: v } } as typeof o.action })
    })
    u = activateOp(u, v)
    expect(u.operatives[v]!.aplMods).toBe(-1)
    expect(u.effects.some((e) => e.kind === 'core.aplNext')).toBe(false)
    // and it ends with that activation
    u = clear(take(clear(u), 'end').state)
    expect(u.operatives[v]!.aplMods).toBe(0)
  })

  it("TEAM-PF-007 Medic! is the owner's choice before removal: declining lets it fall and spends the turning point's use; rule damage waits for the queue; a carried marker stays carried", () => {
    const base = pfOpen()
    const v = A(base, 'pf.shasla')
    const m = A(base, 'pf.medical-technician')
    const ti = A(base, 'pf.transpectral-interference')
    const boy = B(base, 'kom.boy')
    const s = place(place(place(base, v, 0, 0), m, 2.2, 0), boy, 8, 0)
    // rule damage outside an attack: the operative waits at 0 wounds, the step's own decision parked
    const asked = ruleKill(s, v, boy)
    expect(asked.operatives[v]).toMatchObject({ status: 'active', wounds: 0 })
    expect(asked.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', window: 'operative.incapacitated', context: { hook: 'medic', operativeId: v, medicId: m } })
    expect(optionIds(asked)).toEqual(['save', 'none'])
    // declined: removed, nothing applied, the parked decision is back
    const fell = take(asked, 'none').state
    expect(fell.operatives[v]!.status).toBe('removed')
    expect(fell.pending?.id).toBe(s.pending?.id)
    expect(fell.operatives[m]!.aplMods).toBe(0)
    expect(fell.effects.some((e) => e.kind === 'pf.medicDash' || e.kind === 'pf.medicAsk')).toBe(false)
    // "the first time" each turning point: the declined moment spent it, so the next casualty is not offered
    const next = ruleKill(place(fell, ti, 2.2, 2.6), ti, boy)
    expect(next.operatives[ti]!.status).toBe('removed')
    // a carrier saved by Medic! keeps the marker the before-removal step dropped
    const carrier = edit(s, (st) => {
      st.markers.push({ id: 'pf-test-obj', kind: 'objective', pos: { x: 0, z: 0 }, owner: null, carriedBy: v, controller: null } as Marker)
      st.operatives[v]!.flags.carrying = 'pf-test-obj'
    })
    const kept = take(ruleKill(carrier, v, boy), 'save').state
    expect(kept.operatives[v]).toMatchObject({ status: 'active', wounds: 1 })
    expect(kept.operatives[v]!.flags.carrying).toBe('pf-test-obj')
    expect(kept.markers.find((x) => x.id === 'pf-test-obj')!.carriedBy).toBe(v)
  })

  it('TEAM-PF-017 SIGNAL: may be done in a counteraction (no such ban is printed), needs sight of the friend and stays within 6"', () => {
    let s = pfOpen()
    expect(s.data.abilities['pf.a.signal']!.conditions).toEqual({ notInEnemyControlRange: true })
    const c = A(s, 'pf.comms-specialist')
    const sh = A(s, 'pf.shasui')
    const sla = A(s, 'pf.shasla')
    s = place(place(place(s, c, 0, 0), sh, 3, 0), sla, 0, 7.5)
    const counteract = { operativeId: c, seat: 'A' as const, counteract: true, stage: 'action' as const, apSpent: 0, performed: [], declared: null }
    const ids = abilityOffers(s, s.operatives[c]!, counteract).filter((o) => o.abilityId === 'pf.a.signal').map((o) => o.params.targetId)
    expect(ids).toContain(sh)
    // beyond 6": not offered
    expect(ids).not.toContain(sla)
    // a blocking wall between them: the Comms Specialist cannot see the Shas'ui, so it cannot signal it
    const blocked = withTerrain(s, wall(1.2, 1.8, ['heavy', 'blocking'], 4))
    const seen = abilityOffers(blocked, blocked.operatives[c]!, null).filter((o) => o.abilityId === 'pf.a.signal').map((o) => o.params.targetId)
    expect(seen).not.toContain(sh)
  })
})
