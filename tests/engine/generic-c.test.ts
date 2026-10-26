// M9 batch C engine prep: the generic capabilities Kasrkin, Novitiates, Phobos Strike Team, Corsair Voidscarred,
// Warpcoven, Farstalker Kinband and Imperial Navy Breachers build on (docs/spec/12-rules-test-checklist.md, GEN-070
// onwards). Throwaway providers, hooks and code hooks are removed after each test, so nothing leaks.
import { afterEach, describe, expect, it } from 'vitest'
import { step, view } from '@/engine'
import { act as actions } from '@/engine/actions'
import { abilityOffers, repeatSurcharge } from '@/engine/abilities'
import { weaponUnusable } from '@/engine/attack-common'
import { registerCodeHook } from '@/engine/code-hooks'
import { hasKeyword } from '@/engine/conditions'
import { grenadeSource } from '@/engine/core-hooks'
import { activatableOps } from '@/engine/firefight'
import { registerHook, unregisterHook, type AttackHookName, type HookName } from '@/engine/hooks'
import { markerOffers } from '@/engine/markers'
import { moveLimit, planFly, planMove } from '@/engine/movement'
import { keywordPicks, pickAlternatives, resolvePicks } from '@/engine/operative-picks'
import { gainPool, poolOf, setPool, spendPool } from '@/engine/pools'
import { isPsychicAbility, isPsychicWeapon, psychicAllowed, psychicSelectable } from '@/engine/psychic'
import { ScriptedRng } from '@/engine/rng'
import { registerTeamRules, unregisterTeamRules, type TeamRuleProvider } from '@/engine/team-rules'
import type { GameState, RuntimeTeam } from '@/engine/types'
import { defaultRosterPicks, rosterPickProblems, teamCapProblems, type TeamData } from '../../src/data'
import { evs, ranged, withWeapons } from '../fixtures/attack'
import { expectOk } from '../fixtures/helpers'
import { activateOp, edit, hasOption, openReal, opOf, take, withCtx } from '../fixtures/real'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})
function provide(p: Omit<TeamRuleProvider, 'id'>): void {
  registerTeamRules({ id: 'test.provider-c', ...p })
  cleanups.push(() => unregisterTeamRules('test.provider-c'))
}
function hook(name: HookName | AttackHookName, fn: Parameters<typeof registerHook>[1]): void {
  registerHook(name, fn, `test-c.${name}`)
  cleanups.push(() => unregisterHook(name, `test-c.${name}`))
}

/** Open map, A to activate: A's Intercessor Warrior and Captain, B's Boy and Grot. */
function open(o: Parameters<typeof openReal>[0] = {}): { s: GameState; w: string; cap: string; boy: string; grot: string } {
  const s = openReal(o)
  return { s, w: opOf(s, 'A', 'aod.intercessor-warrior'), cap: opOf(s, 'A', 'aod.space-marine-captain'), boy: opOf(s, 'B', 'kom.boy'), grot: opOf(s, 'B', 'kom.grot') }
}
function endIt(s: GameState) {
  return expectOk(step(s, s.pending!.options!.find((o) => o.id === 'end')!.action))
}
/** Answer decisions with the engine defaults (or `prefer` when it returns an option id) until `until` holds. */
function drive(s0: GameState, until: (s: GameState) => boolean, prefer: (s: GameState) => string | null = () => null, dice = 6, max = 60) {
  let s = s0
  const events: ReturnType<typeof step>['events'] = []
  for (let i = 0; i < max && s.pending && !until(s); i++) {
    const id = prefer(s)
    const opt = id ? s.pending.options?.find((o) => o.id === id) : undefined
    const a = opt?.action ?? s.pending.options?.[0]?.action ?? actions.pass(s.pending)
    const r = expectOk(step(s, a, new ScriptedRng(Array(60).fill(dice))))
    events.push(...r.events)
    s = r.state
  }
  return { s, events }
}

describe('GEN batch C generic capabilities', () => {
  it('GEN-070 a team pool gains, spends and refuses to go below zero; it is public and every change is an event', () => {
    const { s } = open()
    const r = withCtx(s, (ctx) => {
      expect(gainPool(ctx, 'A', 'test.faith', 3, 'ready')).toBe(3)
      expect(gainPool(ctx, 'A', 'test.faith', 5, 'kill', 4)).toBe(1)
      expect(spendPool(ctx, 'A', 'test.faith', 5, 'act')).toBe(false)
      expect(spendPool(ctx, 'A', 'test.faith', 2, 'act')).toBe(true)
      setPool(ctx, 'A', 'test.faith', 6, 'refund')
    })
    expect(poolOf(r.state, 'A', 'test.faith')).toBe(6)
    expect(poolOf(r.state, 'B', 'test.faith')).toBe(0)
    expect(evs(r.events, 'PoolChanged').map((e) => e.delta)).toEqual([3, 1, -2, 4])
    expect(view(r.state, 'B').players.A.pools).toEqual({ 'test.faith': 6 })
  })

  it('GEN-071 a PSYCHIC block switches off PSYCHIC ranged weapons and PSYCHIC actions of any team; immunity is asked by the caster', () => {
    const { s: s0, w, boy } = open({ equipmentA: ['core.e.utility-grenades'] })
    let s = withWeapons(s0, ranged('test.psy-bolt', {}, [{ rule: 'psychic' }]), ranged('test.plain'))
    s = edit(s, (st) => {
      st.operatives[w]!.weapons = ['test.psy-bolt', 'test.plain']
      st.operatives[w]!.order = 'engage'
      st.data.abilities = { ...st.data.abilities, 'core.a.smoke-grenade': { ...st.data.abilities['core.a.smoke-grenade']!, keywords: ['PSYCHIC'] } }
    })
    const op = s.operatives[w]!
    expect(isPsychicWeapon(s, 'test.psy-bolt')).toBe(true)
    expect(isPsychicWeapon(s, 'test.plain')).toBe(false)
    expect(isPsychicAbility(s, 'ability:core.a.smoke-grenade')).toBe(true)
    expect(weaponUnusable(s, op, 'test.psy-bolt', [], 'shoot')).toBeNull()
    expect(abilityOffers(s, op, null).some((o) => o.abilityId === 'core.a.smoke-grenade')).toBe(true)
    provide({ psychicBlocked: (_st, o) => o.id === w, psychicImmune: (_st, o) => o.id === boy })
    expect(psychicAllowed(s, op)).toBe(false)
    expect(weaponUnusable(s, op, 'test.psy-bolt', [], 'shoot')?.code).toBe('E_ACTION_RESTRICTED')
    expect(weaponUnusable(s, op, 'test.plain', [], 'shoot')).toBeNull()
    expect(abilityOffers(s, op, null).some((o) => o.abilityId === 'core.a.smoke-grenade')).toBe(false)
    expect(psychicSelectable(s, s.operatives[boy]!)).toBe(false)
  })

  it('GEN-072 a team rule can bar one weapon; options and availability agree', () => {
    const { s: s0, w } = open()
    const s = edit(withWeapons(s0, ranged('test.once'), ranged('test.other')), (st) => {
      st.operatives[w]!.weapons = ['test.once', 'test.other']
      st.operatives[w]!.order = 'engage'
    })
    provide({ weaponForbidden: (_st, o, id) => (o.id === w && id === 'test.once' ? 'only the first Shoot of the battle' : null) })
    expect(weaponUnusable(s, s.operatives[w]!, 'test.once', [], 'shoot')?.reason).toBe('only the first Shoot of the battle')
    expect(weaponUnusable(s, s.operatives[w]!, 'test.other', [], 'shoot')).toBeNull()
  })

  it('GEN-073 a weapon with fixed targets shoots each listed operative with no target decision and forced statuses', () => {
    const { s: s0, w, boy, grot } = open()
    const s = edit(withWeapons(s0, ranged('test.detonate')), (st) => {
      st.operatives[w]!.weapons = ['test.detonate']
      st.operatives[w]!.pos = { x: 0, y: 0, z: 0 }
      st.operatives[boy]!.pos = { x: 8, y: 0, z: 0 }
      st.operatives[grot]!.pos = { x: 8, y: 0, z: 3 }
    })
    provide({ fixedTargets: (_st, o, id) => (o.id === w && id === 'test.detonate' ? { targets: [boy, grot], noCover: true, noObscured: true } : null) })
    const shooting = take(activateOp(s, w), 'shoot').state
    expect(shooting.pending?.kind).toBe('shoot.weapon')
    const r = drive(shooting, (x) => x.pending?.kind === 'firefight.action')
    expect(evs(r.events, 'TargetSelected').map((e) => [e.targetId, e.inCover, e.obscured])).toEqual([
      [boy, false, false],
      [grot, false, false],
    ])
  })

  it('GEN-074 extra primary targets are offered after the first and stop at the maximum', () => {
    const { s: s0, w, boy, grot } = open()
    const s = edit(withWeapons(s0, ranged('test.salvo')), (st) => {
      st.operatives[w]!.weapons = ['test.salvo']
      st.operatives[w]!.pos = { x: 0, y: 0, z: 0 }
      st.operatives[boy]!.pos = { x: 6, y: 0, z: -4 }
      st.operatives[grot]!.pos = { x: 6, y: 0, z: 4 }
    })
    provide({ extraTargets: (_st, o, id, primary) => (o.id === w && id === 'test.salvo' ? { candidates: [boy, grot].filter((x) => x !== primary), max: 1 } : null) })
    let st = take(take(activateOp(s, w), 'shoot').state, 'test.salvo').state
    st = take(st, boy).state
    expect(st.pending).toMatchObject({ kind: 'shoot.target', context: { secondary: true } })
    expect(st.pending!.options!.map((o) => o.id)).toEqual([`add:${grot}`, 'done'])
    const r = expectOk(step(st, st.pending!.options!.find((o) => o.id === `add:${grot}`)!.action, new ScriptedRng(Array(40).fill(4))))
    expect(r.state.pending?.kind).not.toBe('shoot.target')
  })

  it('GEN-075 x" Devastating damage on an operative other than the target is marked as splash', () => {
    const { s: s0, w, boy, grot } = open()
    const s = edit(withWeapons(s0, ranged('test.lightning', {}, [{ rule: 'devastating', x: 1, inches: 2 }])), (st) => {
      st.operatives[w]!.weapons = ['test.lightning']
      st.operatives[w]!.pos = { x: 0, y: 0, z: 0 }
      st.operatives[boy]!.pos = { x: 6, y: 0, z: 0 }
      st.operatives[grot]!.pos = { x: 7.6, y: 0, z: 0 }
    })
    const seen: { id: string; source: string; splash: boolean }[] = []
    hook('onDamageInflicted', (c) => {
      const d = c.data as { source: string; splash?: boolean }
      if (d.source === 'devastating') seen.push({ id: c.operativeId!, source: d.source, splash: d.splash === true })
      return null
    })
    let st = take(take(activateOp(s, w), 'shoot').state, 'test.lightning').state
    st = drive(expectOk(step(st, st.pending!.options!.find((o) => o.id === boy)!.action, new ScriptedRng(Array(40).fill(6)))).state, (x) => x.pending?.kind === 'firefight.action').s
    expect(seen.some((x) => x.id === boy && !x.splash)).toBe(true)
    expect(seen.some((x) => x.id === grot && x.splash)).toBe(true)
    void st
  })

  it('GEN-076 afterBlock runs when a fighter blocks; an owed strike-only resolution offers no blocks', () => {
    const { s: s0, w, boy } = open()
    const s = edit(s0, (st) => {
      st.operatives[w]!.pos = { x: 0, y: 0, z: 0 }
      st.operatives[boy]!.pos = { x: 1.6, y: 0, z: 0 }
    })
    const blocks: string[] = []
    hook('afterBlock', (c) => {
      blocks.push(`${c.operativeId}:${(c.data as { die: string }).die}`)
      return null
    })
    const fighting = take(activateOp(s, w), 'fight').state
    const r = drive(fighting, (x) => x.pending?.kind === 'firefight.action', (x) => x.pending?.options?.find((o) => o.id.startsWith('block'))?.id ?? null)
    expect(blocks.length).toBeGreaterThan(0)
    // strike-only: the defender resolves first and must strike
    provide({ fightResolveStart: (_st, a) => (a.operativeId === w ? { first: 'B', queue: [{ seat: 'B', strikeOnly: true }] } : null) })
    const g = drive(take(activateOp(s, w), 'fight').state, (x) => x.pending?.kind === 'fight.resolve' || x.pending?.kind === 'firefight.action')
    expect(g.s.pending).toMatchObject({ kind: 'fight.resolve', seat: 'B' })
    expect(g.s.pending!.options!.some((o) => o.id.startsWith('block'))).toBe(false)
    expect(g.s.pending!.options!.some((o) => o.id.startsWith('strike'))).toBe(true)
    void r
  })

  it('GEN-077 a team rule can narrow the enemies an operative may fight, never to nothing', () => {
    const { s: s0, w, boy, grot } = open()
    const s = edit(s0, (st) => {
      st.operatives[w]!.pos = { x: 0, y: 0, z: 0 }
      st.operatives[boy]!.pos = { x: 1.6, y: 0, z: 0 }
      st.operatives[grot]!.pos = { x: -1.5, y: 0, z: 0 }
    })
    const both = take(activateOp(s, w), 'fight').state
    expect(both.pending!.options!.map((o) => o.id).sort()).toEqual([boy, grot].sort())
    provide({ fightTargets: () => [grot] })
    expect(take(activateOp(s, w), 'fight').state.pending!.options!.map((o) => o.id)).toEqual([grot])
    unregisterTeamRules('test.provider-c')
    provide({ fightTargets: () => [] })
    expect(take(activateOp(s, w), 'fight').state.pending!.options!.length).toBe(2)
  })

  it('GEN-078 move limits by kind, a FLY distance of its own, and no climbing or jumping', () => {
    const { s, w } = open()
    const op = s.operatives[w]!
    const base = moveLimit(op, 'reposition', false, s)
    provide({
      moveLimitDelta: (_st, o, kind) => (o.id === w && kind === 'reposition' ? 1 : 0),
      canFly: (_st, o) => o.id === w,
      flyLimit: (_st, o) => (o.id === w ? 7 : null),
      moveRestrictions: (_st, o) => (o.id === w ? { noClimb: true, noJump: true } : null),
    })
    expect(moveLimit(op, 'reposition', false, s)).toBe(base + 1)
    expect(moveLimit(op, 'dash', false, s)).toBe(3)
    expect(moveLimit(op, 'reposition', true, s)).toBe(2)
    const far = { x: op.pos.x + 6.9, z: op.pos.z }
    expect(planFly(s, op, 'dash', [far]).ok).toBe(true)
    expect(planFly(s, op, 'dash', [{ x: op.pos.x + 7.5, z: op.pos.z }]).ok).toBe(false)
    const climb = planMove(s, op, 'reposition', [{ x: op.pos.x + 1, z: op.pos.z, y: 2 }])
    expect(!climb.ok && climb.rejection.reason).toMatch(/cannot climb/)
    const jump = planMove(s, op, 'reposition', [{ x: op.pos.x + 1, z: op.pos.z, jump: true }])
    expect(!jump.ok && jump.rejection.reason).toMatch(/cannot jump/)
  })

  it('GEN-079 a barred operative stays ready, cannot be activated, and does not stop the turning point ending', () => {
    const { s: s0, w, cap } = open()
    const s = edit(s0, (st) => {
      for (const o of Object.values(st.operatives)) o.ready = o.id === w || o.id === cap
    })
    provide({ activationBarred: (_st, o) => o.id === w })
    expect(activatableOps(s, 'A').map((o) => o.id)).toEqual([cap])
    expect(step(s, s.pending!.options!.find((o) => o.id === w)!.action).rejection?.code).toBe('E_ACTION_RESTRICTED')
    const ended = endIt(activateOp(s, cap))
    expect(evs(ended.events, 'TurningPointEnded').length).toBe(1)
    expect(ended.events.some((e) => e.type === 'OperativeActivated' && e.operativeId === w)).toBe(false)
  })

  it('GEN-080 a team may do something else instead of counteracting; the turn passes and nobody has counteracted', () => {
    const { s: s0, w, cap, boy, grot } = open()
    const s = edit(s0, (st) => {
      for (const o of Object.values(st.operatives)) o.ready = o.id === cap || o.id === boy || o.id === grot
    })
    let used = 0
    registerCodeHook({
      name: 'test-c.alt',
      choice(ctx, op, option) {
        used++
        ctx.state.operatives[op.id]!.order = option as 'engage' | 'conceal'
      },
    })
    provide({ counteractAlternatives: (_st, seat) => (seat === 'A' ? [{ hook: 'test-c.alt', operativeId: w, option: 'engage', labelKey: 'test.alt' }] : []) })
    let st = endIt(activateOp(s, cap)).state
    st = endIt(activateOp(st, boy)).state
    expect(st.pending).toMatchObject({ kind: 'firefight.activate', seat: 'A' })
    expect(hasOption(st, 'alt:0')).toBe(true)
    const r = expectOk(step(st, st.pending!.options!.find((o) => o.id === 'alt:0')!.action))
    expect(used).toBe(1)
    expect(r.state.operatives[w]!.order).toBe('engage')
    expect(r.state.operatives[w]!.flags.counteractedThisTP).toBe(false)
    expect(r.state.pending).toMatchObject({ kind: 'firefight.activate', seat: 'B' })
  })

  it('GEN-081 Pick Up Marker relief: an enemy in control range does not stop it, and contesting can suffice', () => {
    const { s: s0, w, boy, grot } = open()
    const s = edit(s0, (st) => {
      st.operatives[w]!.pos = { x: 0, y: 0, z: 0 }
      st.operatives[boy]!.pos = { x: 1.6, y: 0, z: 0 }
      st.operatives[grot]!.pos = { x: -1.5, y: 0, z: 0 }
      st.operatives[w]!.apl = 1
      st.markers.push({ id: 'test.m', kind: 'equipment', pos: { x: 0.8, z: 0 }, owner: null, carriedBy: null, controller: null, pickable: true, equipmentId: 'test' })
    })
    const op = s.operatives[w]!
    expect(markerOffers(s, op, null)).toEqual([])
    provide({ markerActionRelief: (_st, o, a) => (o.id === w && a === 'marker:pickUp' ? { ignoreEnemyControlRange: true } : null) })
    // the Kommandos out-total the warrior (APL 1 here), so it contests but does not control: still no offer
    expect(markerOffers(s, op, null)).toEqual([])
    unregisterTeamRules('test.provider-c')
    provide({ markerActionRelief: (_st, o, a) => (o.id === w && a === 'marker:pickUp' ? { ignoreEnemyControlRange: true, contestSuffices: true } : null) })
    expect(markerOffers(s, op, null).map((m) => m.markerId)).toEqual(['test.m'])
  })

  it('GEN-082 a per-turning-point grenade allowance for the whole seat, apart from the picks', () => {
    const { s, w, cap } = open()
    provide({ ownGrenades: (_st, o) => (o.seat === 'A' ? { tpActions: { 'core.a.smoke-grenade': 1 } } : null) })
    expect(grenadeSource(s, s.operatives[w]!, 'core.a.smoke-grenade')).toBe('ownTp')
    expect(grenadeSource(s, s.operatives[w]!, 'core.a.stun-grenade')).toBeNull()
    const spent = edit(s, (st) => {
      st.ledger.A.tpUses['ownTp:core.a.smoke-grenade'] = 1
    })
    expect(grenadeSource(spent, spent.operatives[cap]!, 'core.a.smoke-grenade')).toBeNull()
  })

  it('GEN-083 operative picks: unique across the roster, distinct within an operative, and tags that are not keywords', () => {
    const team = {
      operativeChoices: [
        { id: 'boon', label: 'Boon', keywords: ['X', 'Y', 'Z'], unique: true, keyword: false },
        { id: 'r1', label: 'Rule 1', keywords: ['P', 'Q'], keyword: false },
        { id: 'r2', label: 'Rule 2', keywords: ['P', 'Q'], keyword: false, distinctFrom: ['r1'] },
        { id: 'mark', label: 'Mark', keywords: ['M', 'N'] },
      ],
    } as unknown as RuntimeTeam
    const card = { id: 'c', keywords: [] }
    const a = resolvePicks(team, card, {}, { boon: ['X'] })
    expect(a.problem).toBeNull()
    expect(a.picks).toMatchObject({ boon: 'Y', r1: 'P', r2: 'Q' })
    expect(resolvePicks(team, card, { boon: 'X' }, { boon: ['X'] }).problem).toMatch(/already taken/)
    expect(resolvePicks(team, card, { r1: 'P', r2: 'P' }).problem).toMatch(/must differ/)
    // tags are not keywords; the alternatives skip what friends hold
    const { s: s0, w, cap } = open()
    const s = edit(s0, (st) => {
      st.data.teams = { ...st.data.teams, [st.players.A.teamId]: { ...st.data.teams[st.players.A.teamId]!, operativeChoices: (team as unknown as { operativeChoices: never }).operativeChoices } }
      st.operatives[w]!.picks = { boon: 'Y', r1: 'P', r2: 'Q', mark: 'M' }
      st.operatives[cap]!.picks = { boon: 'Z', r1: 'P', r2: 'Q', mark: 'N' }
    })
    expect(keywordPicks(s, s.operatives[w]!)).toEqual(['M'])
    expect(hasKeyword(s, s.operatives[w]!, 'Y')).toBe(false)
    expect(hasKeyword(s, s.operatives[w]!, 'M')).toBe(true)
    expect(pickAlternatives(s, s.operatives[w]!, 'boon')).toEqual(['X'])
    expect(pickAlternatives(s, s.operatives[w]!, 'r2')).toEqual([])
    // data side: roster-aware defaults and the roster-wide check
    const dteam = team as unknown as Pick<TeamData, 'operativeChoices'>
    const picks = defaultRosterPicks(dteam, [card, card, card])
    expect(picks.map((p) => p.boon)).toEqual(['X', 'Y', 'Z'])
    expect(rosterPickProblems(dteam, [{ boon: 'X' }, { boon: 'X' }])).toHaveLength(1)
  })

  it('GEN-084 roster rules: a minimum of a keyword and a datacard that needs another', () => {
    const team = {
      selection: {
        slots: [],
        caps: [{ keyword: 'SORCERER', min: 1, label: 'SORCERER operatives' }],
        requires: [{ id: 'x.skull', needs: ['x.jammer'] }],
      },
    } as unknown as Pick<TeamData, 'selection'>
    const cards = { 'x.sorc': { keywords: ['SORCERER'] }, 'x.skull': { keywords: [] }, 'x.jammer': { keywords: [] } }
    expect(teamCapProblems(team, ['x.skull'], cards)).toHaveLength(2)
    expect(teamCapProblems(team, ['x.sorc', 'x.skull', 'x.jammer'], cards)).toEqual([])
  })

  it('GEN-085 the Astartes repeat surcharge sees two profiles of one weapon as the same weapon', () => {
    const { s: s0, w } = open()
    const s = edit(s0, (st) => {
      st.operatives[w]!.weapons = ['aod.w.heavy-bolter-focused', 'aod.w.heavy-bolter-sweeping']
    })
    const act = { operativeId: w, seat: 'A' as const, counteract: false, stage: 'action' as const, apSpent: 1, performed: ['shoot'], declared: null, weaponsUsed: ['aod.w.heavy-bolter-focused'] }
    expect(repeatSurcharge(s, s.operatives[w]!, act, 'aod.w.heavy-bolter-sweeping')).toBe(1)
    expect(repeatSurcharge(s, s.operatives[w]!, { ...act, weaponsUsed: [] }, 'aod.w.heavy-bolter-sweeping')).toBe(0)
  })
})
