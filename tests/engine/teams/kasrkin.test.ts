// kasrkin engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-KS-nnn).
// Kasrkin are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { step, view } from '@/engine'
import { abilityOffers, actionForbidden, maxRepeats } from '@/engine/abilities'
import { attackStats, defenceStats, effectiveRules, inflict, newSide, parseRules, pushRolled, retainAttack, runDeferredRemovals } from '@/engine/attack-common'
import { hasKeyword } from '@/engine/conditions'
import { directDamage, removeNow, tpUsesOf, usedThisTp, usesOf } from '@/engine/effects'
import { hasOption, optionIds } from '../../fixtures/real'
import { runHook } from '@/engine/hooks'
import { markerInControlRange } from '@/engine/measure'
import { offersFor } from '@/engine/ploys'
import { markerControl } from '@/engine/query'
import { updateControl } from '@/engine/markers'
import { shootableWeapons, usableRangedWeapons } from '@/engine/shoot'
import { beginTurningPoint } from '@/engine/strategy'
import { effectiveApl } from '@/engine/state'
import { providerStealthy } from '@/engine/team-rules'
import { TEAM_ID, isHotShot, isRapid, isScanned, skillsOf, teamSkills } from '@/engine/teams/kasrkin'
import { tokenCount } from '@/engine/tokens'
import type { GameState, PendingDecision } from '@/engine/types'
import { bodyOf } from '@/engine/los'
import { enumerateLoadouts, loadBundle, loadoutCapProblems, validateRoster, type DatacardData } from '../../../src/data'
import { play } from '../../fixtures/attack'
import { expectOk, place } from '../../fixtures/helpers'
import { activateOp, edit, passIt, realBundle, realGame, take, withCtx } from '../../fixtures/real'
import { feature, part, rect } from '../../fixtures/maps'
import { A, B, bTurn, dice, facing, goTo, MATCH, open, shootAgain, shootAt, strikes, takePloy, toGambit, toSeize, usePlayed, withFx, withSkills } from './kasrkin.hooks'

const data = loadBundle()
const SKILL_PLOY = 'ks.p.skill-at-arms'

/** A light wall across the lane: a target just behind it (x 4) is in cover, one at x 6 is not. */
const wall = () => feature('ks-wall', part('ks-wall.a', rect(3, 3.4, -2, 2), 1, ['light']))
/** Terrain for a test; everyone on Engage (a Conceal target in cover cannot be chosen at all). */
const withTerrain = (s: GameState, ...features: ReturnType<typeof feature>[]): GameState =>
  edit(s, (st) => {
    st.map = { ...st.map, features }
    for (const o of Object.values(st.operatives)) o.order = 'engage'
  })
const withWall = (s: GameState): GameState => withTerrain(s, wall())

describe('TEAM-KS Kasrkin', () => {
  it('TEAM-KS-000 TEAM-KS-001 TEAM-KS-002 TEAM-KS-032 playable team, roster rules, printed loadouts and weapons, name tests and keywords', () => {
    expect(TEAM_ID).toBe('kasrkin')
    const team = data.teams['kasrkin']!
    expect(team.playable).toBe(true)
    const cards = realBundle.datacards
    const ok = { leader: ['ks.sergeant'], main: ['ks.trooper', 'ks.trooper', 'ks.trooper', 'ks.trooper', 'ks.gunner', 'ks.gunner', 'ks.gunner', 'ks.sharpshooter', 'ks.combat-medic'] }
    expect(validateRoster(team, ok, cards as never).ok).toBe(true)
    // a fifth Gunner-or-Sharpshooter, a second Combat Medic, an eleventh operative
    expect(validateRoster(team, { ...ok, main: ['ks.trooper', 'ks.gunner', 'ks.gunner', 'ks.gunner', 'ks.gunner', 'ks.sharpshooter', 'ks.combat-medic', 'ks.recon-trooper', 'ks.vox-trooper'] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: [...ok.main.slice(0, 8), 'ks.combat-medic', 'ks.combat-medic'] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: [...ok.main, 'ks.vox-trooper'] }, cards as never).ok).toBe(false)
    // five Troopers plus four Gunners and no Sharpshooter is legal
    expect(validateRoster(team, { leader: ['ks.sergeant'], main: [...Array<string>(5).fill('ks.trooper'), ...Array<string>(4).fill('ks.gunner')] }, cards as never).ok).toBe(true)
    // each Gunner weapon at most once
    const carried = (w: string[]) => [w]
    expect(loadoutCapProblems(team, [...carried(['ks.w.flamer']), ...carried(['ks.w.flamer'])], data.weaponGroups)).toHaveLength(1)
    expect(loadoutCapProblems(team, [...carried(['ks.w.flamer']), ...carried(['ks.w.meltagun'])], data.weaponGroups)).toEqual([])
    const count = (id: string) => enumerateLoadouts(data.byId[id] as DatacardData).length
    expect([count('ks.sergeant'), count('ks.gunner'), count('ks.trooper'), count('ks.sharpshooter')]).toEqual([4, 5, 1, 1])
    // printed numbers
    const w = (id: string) => data.byId[id] as { atk: number; hit: string; dmg: { normal: number; crit: number }; rules: { rule: string }[] }
    expect(w('ks.w.gun-butt-sergeant').hit).toBe('3+')
    expect(w('ks.w.gun-butt').hit).toBe('4+')
    expect(w('ks.w.power-weapon').rules.map((r) => r.rule)).toEqual(['core.wr.lethal'])
    expect(w('ks.w.meltagun').dmg).toEqual({ normal: 6, crit: 3 })
    expect(w('ks.w.hot-shot-marksman-rifle-mobile').rules).toEqual([])
    expect(w('ks.w.hot-shot-marksman-rifle-concealed').rules.map((r) => r.rule)).toEqual(['core.wr.devastating', 'core.wr.heavy', 'core.wr.silent', 'ks.a.wr-concealed-position'])
    // name tests (T-KS.5)
    const s = open()
    const hot = Object.keys(s.data.weapons).filter((id) => id.startsWith('ks.') && isHotShot(s, id)).sort()
    expect(hot).toEqual(['ks.w.hot-shot-lasgun', 'ks.w.hot-shot-laspistol', 'ks.w.hot-shot-marksman-rifle-concealed', 'ks.w.hot-shot-marksman-rifle-mobile', 'ks.w.hot-shot-marksman-rifle-stationary', 'ks.w.hot-shot-volley-gun-focused', 'ks.w.hot-shot-volley-gun-sweeping'])
    expect(Object.keys(s.data.weapons).filter((id) => id.startsWith('ks.') && isRapid(s, id)).sort()).toEqual(['ks.w.bolt-pistol', 'ks.w.hot-shot-lasgun', 'ks.w.hot-shot-laspistol'])
    for (const op of Object.values(s.operatives).filter((o) => o.seat === 'A')) {
      for (const k of ['KASRKIN', 'IMPERIUM', 'ASTRA MILITARUM']) expect(hasKeyword(s, op, k), `${op.name} ${k}`).toBe(true)
      expect(hasKeyword(s, op, 'MEDIC')).toBe(op.datacardId === 'ks.combat-medic')
    }
  })

  it('TEAM-KS-003 SKILL AT ARMS: two different picks with the Sergeant, one without, public for both seats, once per turning point, ends at the next Ready step', () => {
    const g = toGambit()
    const skillIds = (st: GameState) => optionIds(st).filter((i) => i.startsWith(`${SKILL_PLOY}:`))
    expect(skillIds(g)).toHaveLength(6)
    expect(skillIds(g).every((i) => i.includes('+'))).toBe(true)
    // the Sergeant incapacitated: single picks
    const noSgt = edit(g, (st) => void (st.operatives[A(g, 'sergeant')]!.status = 'removed'))
    const single = offersFor(noSgt, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).filter((o) => o.ployId === SKILL_PLOY)
    expect(single.map((o) => o.param).sort()).toEqual(['for-cadia', 'ice-in-your-veins', 'light-em-up', 'strike-fast'])
    expect(single.every((o) => o.cost === 0)).toBe(true)
    // used: public, and gone from the offers
    const used = take(g, `${SKILL_PLOY}:light-em-up+for-cadia`).state
    for (const seat of ['A', 'B'] as const) {
      expect(view(used, seat).effects.filter((e) => e.kind === 'ks.skill').map((e) => e.data!.skill).sort()).toEqual(['for-cadia', 'light-em-up'])
    }
    expect(teamSkills(used, 'A').sort()).toEqual(['for-cadia', 'light-em-up'])
    expect(skillsOf(used, used.operatives[A(g, 'trooper')]!).sort()).toEqual(['for-cadia', 'light-em-up'])
    expect(offersFor(used, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).filter((o) => o.ployId === SKILL_PLOY)).toEqual([])
    // the Ready step of the next Strategy phase ends it
    const next = withCtx(used, (ctx) => beginTurningPoint(ctx)).state
    expect(next.effects.filter((e) => e.kind === 'ks.skill')).toEqual([])
  })

  it('TEAM-KS-004 TEAM-KS-005 Light Em Up (Severe on ranged weapons, never against an obscured target) and Strike Fast (Reposition +1 inch, Dash and Charge unchanged)', () => {
    {
    const s = withSkills(open(), 'light-em-up')
    const tr = A(s, 'trooper')
    const boy = B(s, 'boy')
    const op = s.operatives[tr]!
    const roll = (rules: ReturnType<typeof parseRules>, obscured: boolean) => {
      const side = newSide('A', tr, 'ks.w.hot-shot-lasgun', 3, null, [])
      pushRolled(side, [3, 3, 1, 1])
      retainAttack(side, rules, obscured)
      return side.dice.map((d) => d.kind).sort()
    }
    const rules = parseRules(effectiveRules(s, op, s.data.weapons['ks.w.hot-shot-lasgun']!, 'shoot', boy))
    expect(rules.severe).toBe(true)
    expect(roll(rules, false)).toEqual(['crit', 'fail', 'fail', 'normal'])
    // obscured discards one success and makes no crit
    expect(roll(rules, true)).toEqual(['fail', 'fail', 'fail', 'normal'])
    expect(parseRules(effectiveRules(s, op, s.data.weapons['ks.w.gun-butt']!, 'fight', boy)).severe).toBe(false)
    // only Kasrkin with the skill: the Kommandos get nothing
    expect(parseRules(effectiveRules(s, s.operatives[boy]!, s.data.weapons['kom.w.slugga']!, 'shoot', tr)).severe).toBe(false)
    }
    {
      const s = withSkills(open(), 'strike-fast')
      const tr = A(s, 'trooper')
      const limit = (st: GameState, action: string) => take(activateOp(st, tr), action).state.pending!.context.maxInches
      expect(limit(s, 'reposition')).toBe(7)
      expect(limit(s, 'dash')).toBe(3)
      const injured = edit(s, (st) => void (st.operatives[tr]!.wounds = 3))
      expect(limit(injured, 'reposition')).toBe(5)
      // the Charge is Move plus 2" with or without the skill
      const near = place(place(s, tr, 0, 0), B(s, 'boy'), 4, 0)
      expect(limit(near, 'charge')).toBe(limit(place(place(open(), tr, 0, 0), B(s, 'boy'), 4, 0), 'charge'))
    }
  })

  it('TEAM-KS-006 TEAM-KS-007 Ice In Your Veins (first Normal Dmg 3 die of a sequence deals 1 less, nothing else is reduced) and For Cadia (melee Atk +1 to 4, first strike of the attacker +1 damage)', () => {
    {
    const s = withSkills(open(), 'ice-in-your-veins')
    const tr = A(s, 'trooper')
    const boy = B(s, 'boy')
    const lost = (amounts: [number, string, number?][]) => {
      const out: number[] = []
      withCtx(s, (ctx) => {
        ctx.state.attack = { kind: 'shoot', stage: 'resolve', operativeId: boy, seat: 'B', weaponId: 'kom.w.slugga', pointBlank: false, targets: [tr], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] }
        for (const [amount, source, index] of amounts) {
          if (index !== undefined) ctx.state.attack!.index = index
          out.push(inflict(ctx, { targetId: tr, attackerId: boy, weaponId: 'kom.w.slugga', amount, source }))
        }
      })
      return out
    }
    expect(lost([[3, 'normal'], [3, 'normal']])).toEqual([2, 3])
    // a crit, a Dmg 2 normal and Devastating damage never use up the reduction
    expect(lost([[4, 'crit'], [2, 'normal'], [3, 'devastating'], [3, 'normal']])).toEqual([4, 2, 3, 2])
    // a new sequence (the next Blast target) is reduced again
    expect(lost([[3, 'normal', 0], [3, 'normal', 0], [3, 'normal', 1]])).toEqual([2, 3, 2])
    }
    {
    const s = withSkills(open(), 'for-cadia')
    const tr = A(s, 'trooper')
    const sg = A(s, 'sergeant')
    const boy = B(s, 'boy')
    expect(attackStats(s, tr, 'ks.w.gun-butt', boy, { kind: 'fight' }).atk).toBe(4)
    expect(attackStats(s, tr, 'ks.w.combat-dagger', boy, { kind: 'fight' }).atk).toBe(4)
    expect(attackStats(s, sg, 'ks.w.power-weapon', boy, { kind: 'fight' }).atk).toBe(4)
    expect(attackStats(open(), tr, 'ks.w.gun-butt', boy, { kind: 'fight' }).atk).toBe(3)
    // a fight: four crits, first strike 3 + 1, then 3, 3, 3
    const t = edit(facing(s, tr, boy), (st) => {
      st.operatives[boy]!.wounds = 40
      st.operatives[boy]!.maxWounds = 40
    })
    const f = take(take(activateOp(t, tr), 'fight').state, boy, dice(6, 6, 6, 6, 1, 1, 1, 1)).state
    const r = play(f, dice(), strikes)
    expect(40 - r.state.operatives[boy]!.wounds).toBe(13)
    // retaliating: no extra strike damage
    const fx = withCtx(edit(s, (st) => void (st.attack = { kind: 'fight', operativeId: boy, seat: 'B', fight: { targetId: tr } } as never)), (ctx) => {
      const d = { die: 'crit', amount: 3, cancel: false }
      runHook('beforeStrike', { seat: 'A', state: ctx.state, engine: ctx, operativeId: tr, targetId: boy, data: d })
      expect(d.amount).toBe(3)
    })
    expect(fx.state.effects.some((e) => e.source === 'ks.cadia.spent')).toBe(false)
    }
  })

  it('TEAM-KS-008 RAPID FIRE: two Shoots without moving with Rapid Fire weapons; no second after a move or a flamer; after two Shoots no move or Guard', () => {
    const s = open()
    const tr = A(s, 'trooper')
    const sg = A(s, 'sergeant')
    const gn = A(s, 'gunner')
    const boy = B(s, 'boy')
    const lasgun = 'ks.w.hot-shot-lasgun'
    // two Shoots with the lasgun
    const first = shootAt(place(place(s, tr, 0, 0), boy, 5, 0), tr, lasgun, boy, dice(1, 1, 1, 1))
    expect(hasOption(first.state, 'shoot')).toBe(true)
    // after a Reposition, one Shoot only
    const moved = take(activateOp(place(place(s, tr, 0, 0), boy, 5, 0), tr), 'reposition').state
    const back = play(moved, dice(), goTo(0.5, 0)).state
    expect(hasOption(shootAgain(back, lasgun, boy, dice(1, 1, 1, 1)).state, 'shoot')).toBe(false)
    // a Gunner whose first Shoot used the flamer gets no second
    expect(hasOption(shootAt(place(place(s, gn, 0, 0), boy, 4, 0), gn, 'ks.w.flamer', boy, dice(1, 1, 1, 1)).state, 'shoot')).toBe(false)
    // the Sergeant (APL 3): after two bolt pistol Shoots no Reposition, Dash or Guard though 1 AP is left
    const sgState = place(place(s, sg, 0, 0), boy, 5, 0)
    const one = shootAt(sgState, sg, 'ks.w.bolt-pistol', boy, dice(1, 1, 1, 1))
    expect(hasOption(one.state, 'reposition')).toBe(true)
    const two = shootAgain(one.state, 'ks.w.bolt-pistol', boy, dice(1, 1, 1, 1))
    expect(two.state.firefight.activation!.apSpent).toBe(2)
    for (const a of ['reposition', 'dash', 'guard', 'fallBack', 'charge']) expect(hasOption(two.state, a), a).toBe(false)
    expect(actionForbidden(two.state, two.state.operatives[sg]!, 'guard')).toMatch(/Rapid Fire/)
    // a second Shoot with another weapon is barred, and a non-Rapid first Shoot allows no second
    expect(maxRepeats(one.state, one.state.operatives[sg]!, 'shoot', ['shoot'])).toBe(2)
    expect(shootableWeapons(one.state, one.state.operatives[sg]!, ['shoot']).map((x) => x.weaponId)).toEqual(['ks.w.bolt-pistol'])
  })

  it('TEAM-KS-009 TACTICAL COMMAND: a free skill the team lacks, a second use replaces the first, a Clearance Sweep mode, not in enemy control range or as a counteraction, ends at the Ready step', () => {
    const s = withSkills(open(), 'light-em-up')
    const sg = A(s, 'sergeant')
    const tr = A(s, 'trooper')
    const pick = take(activateOp(s, sg), `ability:ks.a.tactical-command:${tr}`).state
    expect(pick.pending!.kind).toBe('ability.choice')
    expect(optionIds(pick).sort()).toEqual(['for-cadia', 'ice-in-your-veins', 'strike-fast'])
    const done = take(pick, 'strike-fast').state
    expect(done.firefight.activation!.apSpent).toBe(0)
    expect(skillsOf(done, done.operatives[tr]!).sort()).toEqual(['light-em-up', 'strike-fast'])
    expect(skillsOf(done, done.operatives[A(s, 'gunner')]!)).toEqual(['light-em-up'])
    expect(tokenCount(done, tr, 'ks.tacticalCommand', 'A')).toBe(1)
    expect(optionIds(done).some((i) => i.startsWith('ability:ks.a.tactical-command'))).toBe(false)
    // a later use on the same operative replaces the first
    const held = withFx(s, { source: 'ks.a.tactical-command', kind: 'ks.skillOp', operativeId: tr, expires: 'turningPointStart', data: { skill: 'strike-fast' } })
    const again = take(take(activateOp(held, sg), `ability:ks.a.tactical-command:${tr}`).state, 'for-cadia').state
    expect(skillsOf(again, again.operatives[tr]!).sort()).toEqual(['for-cadia', 'light-em-up'])
    expect(again.effects.filter((e) => e.kind === 'ks.skillOp' && e.operativeId === tr)).toHaveLength(1)
    // not in an enemy control range, not as a counteraction
    const engaged = place(place(s, sg, 0, 0), B(s, 'boy'), 1.4, 0)
    expect(optionIds(activateOp(engaged, sg)).some((i) => i.startsWith('ability:ks.a.tactical-command'))).toBe(false)
    const counter = edit(s, (st) => void (st.firefight.activation = { operativeId: sg, seat: 'A', counteract: true, stage: 'action', apSpent: 0, performed: [], declared: null }))
    expect(abilityOffers(counter, counter.operatives[sg]!, counter.firefight.activation).some((o) => o.abilityId === 'ks.a.tactical-command')).toBe(false)
    // the alternative: move the Clearance Sweep marker
    const swept = usePlayed(s, 'ks.p.clearance-sweep', {}, '-5,0')
    expect(swept.markers.find((m) => m.equipmentId === 'ks.p.clearance-sweep')!.pos).toEqual({ x: -5, z: 0 })
    const mv = take(activateOp(swept, sg), 'ability:ks.a.tactical-command:sweep').state
    const moved = take(mv, mv.pending!.options!.find((o) => o.id === '4,0' || o.id.startsWith('4'))?.id ?? mv.pending!.options![0]!.id).state
    expect(moved.markers.filter((m) => m.equipmentId === 'ks.p.clearance-sweep')).toHaveLength(1)
    expect(moved.markers.find((m) => m.equipmentId === 'ks.p.clearance-sweep')!.pos).not.toEqual({ x: -5, z: 0 })
    // the Ready step removes the skill, the token and the marker
    const next = withCtx(edit(done, (st) => void st.markers.push(...swept.markers.filter((m) => m.equipmentId === 'ks.p.clearance-sweep'))), (ctx) => {
      beginTurningPoint(ctx)
      runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })
    }).state
    expect(next.effects.filter((e) => e.kind === 'ks.skillOp' || e.kind === 'ks.skill')).toEqual([])
    expect(tokenCount(next, tr, 'ks.tacticalCommand')).toBe(0)
    expect(next.markers.some((m) => m.equipmentId === 'ks.p.clearance-sweep')).toBe(false)
  })

  it('TEAM-KS-010 TEAM-KS-011 Medic! is the player\'s choice while the casualty waits for removal (save: 1 wound, APL -1 for both, its own activation ends; decline: removed, the use spent); MEDIKIT heals 2D3 for free, itself included, never the Medic! target', () => {
    const s = open()
    const medic = A(s, 'combat-medic')
    const tr = A(s, 'trooper')
    const boy = B(s, 'boy')
    const ask = (st: GameState) => st.effects.some((e) => e.kind === 'ks.medicAsk' && e.operativeId === tr)
    // an enemy Shoot: the removal queue stops on the Kasrkin player's question
    const lane = edit(place(place(place(s, medic, -2, 0), tr, 0, 0), boy, 6, 0), (st) => void (st.operatives[tr]!.wounds = 2))
    const rng = dice(6, 6, 6, 6)
    let t = take(activateOp(bTurn(lane, A(s, 'sergeant')), boy), 'shoot', rng).state
    t = take(take(t, 'kom.w.slugga', rng).state, tr, rng).state
    const asked = play(t, rng, {}, ['ability.choice', 'firefight.action', 'firefight.activate']).state
    expect(asked.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { hook: 'ksMedic', operativeId: tr } })
    expect(optionIds(asked)).toEqual(['save', 'decline'])
    expect(asked.operatives[tr]!.status).toBe('active')
    const saved = take(asked, 'save').state
    expect(saved.operatives[tr]).toMatchObject({ status: 'active', wounds: 1 })
    expect(saved.operatives[tr]!.aplMods).toBe(-1)
    expect(saved.operatives[medic]!.aplMods).toBe(-1)
    expect(saved.effects.some((e) => e.kind === 'ks.medicDash' && e.operativeId === tr)).toBe(true)
    expect(usedThisTp(saved, 'A', `ks.medic.saved:${tr}`)).toBe(true)
    const declined = take(asked, 'decline').state
    expect(declined.operatives[tr]!.status).toBe('removed')
    expect(declined.operatives[medic]!.aplMods).toBe(0)
    expect(usedThisTp(declined, 'A', `ks.medic:${medic}`)).toBe(true)
    // damage outside an attack in the casualty's own activation: the removal waits for the step's end, then the
    // activation ends at once and the casualty's APL -1 waits for its next activation
    const near = edit(place(place(s, medic, 0, 0), tr, 2, 0), (st) => void (st.operatives[tr]!.wounds = 2))
    const own = activateOp(near, tr)
    const asked2 = withCtx(own, (ctx) => {
      directDamage(ctx, tr, 5, boy, 'test')
      runDeferredRemovals(ctx)
    }).state
    expect(asked2.pending).toMatchObject({ kind: 'ability.choice', context: { hook: 'ksMedic' } })
    const saved2 = take(asked2, 'save').state
    expect(saved2.operatives[tr]).toMatchObject({ status: 'active', wounds: 1 })
    expect(saved2.firefight.activation?.operativeId).not.toBe(tr)
    expect(saved2.operatives[tr]!.aplMods).toBe(0)
    expect(saved2.effects.some((e) => e.kind === 'core.aplNext' && e.operativeId === tr)).toBe(true)
    // spent for the turning point: the next casualty is not asked about
    const hit = (st: GameState, amount: number) => withCtx(st, (ctx) => void inflict(ctx, { targetId: tr, attackerId: boy, weaponId: 'kom.w.choppa', amount, source: 'normal' })).state
    expect(ask(hit(edit(near, (st) => void st.ledger.A.tp.push(`ks.medic:${medic}`)), 5))).toBe(false)
    expect(ask(hit(near, 5))).toBe(true)
    // no question: out of 3", an enemy in control range, the Medic a Blast secondary target
    expect(ask(hit(place(near, tr, 5, 0), 5))).toBe(false)
    expect(ask(hit(place(near, boy, 3, 0), 5))).toBe(false)
    const secondary = edit(near, (st) => void (st.attack = { kind: 'shoot', stage: 'resolve', operativeId: boy, seat: 'B', weaponId: 'kom.w.slugga', pointBlank: false, targets: [tr, medic], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] }))
    expect(ask(hit(secondary, 5))).toBe(false)
    // MEDIKIT: 0 AP, 2D3 (here 1 + 1), never above the starting wounds
    const sg = A(s, 'sergeant')
    const hurt = edit(place(place(s, medic, 0, 0), sg, 1.3, 0), (st) => {
      st.operatives[sg]!.wounds = 3
      st.operatives[medic]!.wounds = 4
    })
    const kit = take(activateOp(hurt, medic), `ability:ks.a.medikit:${sg}`, dice(2, 2))
    expect(kit.state.operatives[sg]!.wounds).toBe(5)
    expect(kit.state.firefight.activation!.apSpent).toBe(0)
    expect(optionIds(kit.state).some((i) => i.startsWith('ability:ks.a.medikit'))).toBe(false)
    expect(optionIds(activateOp(hurt, medic))).toContain(`ability:ks.a.medikit:${medic}`)
    expect(take(activateOp(hurt, medic), `ability:ks.a.medikit:${sg}`, dice(6, 6)).state.operatives[sg]!.wounds).toBe(9)
    const marked = edit(hurt, (st) => void st.ledger.A.tp.push(`ks.medic.saved:${sg}`))
    expect(optionIds(activateOp(marked, medic))).not.toContain(`ability:ks.a.medikit:${sg}`)
  })

  it('TEAM-KS-012 TEAM-KS-013 Melta Mine: starts carried, placed only outside enemy control range with an optional free Dash, picked up again; Proximity Mine hits the first other operative for 2D6+3 once, never the Demo-Trooper or a carried marker', () => {
    // the real game state, before a test parks anyone
    const g = realGame({ ...MATCH })
    const demoId = A(g, 'demo-trooper')
    const carried = g.markers.find((m) => m.equipmentId === 'ks.meltaMine')!
    expect(carried.carriedBy).toBe(demoId)
    expect(g.operatives[demoId]!.flags.carrying).toBe(carried.id)
    const s = open()
    const demo = A(s, 'demo-trooper')
    const boy = B(s, 'boy')
    // placement is the shared Place Marker: every offered spot is outside the enemy control range, others are refused
    const mineId = s.markers.find((m) => m.equipmentId === 'ks.meltaMine')!.id
    const t = activateOp(place(place(s, demo, 0, 0), boy, 2.2, 0), demo)
    const placing = take(t, `marker:place:${mineId}`).state
    const p = placing.pending!
    expect(p.kind).toBe('marker.place')
    const spots = p.context.spots as { x: number; z: number }[]
    expect(spots.length).toBeGreaterThan(2)
    for (const o of spots) {
      const probe = { ...placing.markers.find((m) => m.id === mineId)!, carriedBy: null, pos: o }
      expect(markerInControlRange(placing, bodyOf(placing.operatives[boy]!), probe), `${o.x},${o.z}`).toBe(false)
    }
    expect(step(placing, { type: 'marker.place', seat: p.seat, decisionId: p.id, payload: { x: 1, z: 0 } }).rejection?.code).toBe('E_ACTION_RESTRICTED')
    expect(optionIds(t).some((i) => i.startsWith('ability:ks.a.place'))).toBe(false)
    // the free Dash is a 0 CP offer right after the action, and may be declined; Place Marker itself costs 1 AP
    const placed = expectOk(step(placing, { type: 'marker.place', seat: p.seat, decisionId: p.id, payload: spots[0]! })).state
    expect(placed.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.actionEnded' })
    expect(optionIds(placed)).toContain(`ks.mineDash:${demo}`)
    expect(take(placed, `ks.mineDash:${demo}`).state.pending!.kind).toBe('move.path')
    let done = placed
    while (done.pending!.kind === 'ploy.firefight') done = passIt(done).state
    expect(done.pending!.kind).toBe('firefight.action')
    expect(done.firefight.activation!.apSpent).toBe(1)
    expect(done.operatives[demo]!.flags.carrying).toBeNull()
    expect(done.markers.find((m) => m.equipmentId === 'ks.meltaMine')!.carriedBy).toBeNull()
    expect(optionIds(done).some((i) => i.startsWith('marker:pickUp'))).toBe(false)
    // after another action the Dash is no longer on offer
    expect(done.effects.some((e) => e.kind === 'ks.mineDash')).toBe(true)
    const guarded = take(done, 'guard').state
    expect(guarded.effects.some((e) => e.kind === 'ks.mineDash')).toBe(false)
    // later it can pick the marker up again
    const standing = edit(s, (st) => {
      const m = st.markers.find((k) => k.equipmentId === 'ks.meltaMine')!
      m.carriedBy = null
      m.pos = { x: 0.9, z: 0 }
      st.operatives[demo]!.flags.carrying = null
    })
    expect(optionIds(activateOp(place(standing, demo, 0, 0), demo)).some((i) => i.startsWith('marker:pickUp'))).toBe(true)
    // an incapacitated carrier: a legal spot keeps the marker, none removes it
    const dying = edit(place(s, demo, 0, 0), (st) => void (st.operatives[demo]!.wounds = 0))
    expect(withCtx(dying, (ctx) => removeNow(ctx, demo)).state.markers.some((m) => m.equipmentId === 'ks.meltaMine' && m.carriedBy === null)).toBe(true)
    const around = place(place(place(place(place(s, demo, 0, 0), boy, 1.6, 0), B(s, 'boss-nob'), -1.6, 0), B(s, 'burna-boy'), 0, 1.6), B(s, 'comms-boy'), 0, -1.6)
    const surrounded = edit(around, (st) => void (st.operatives[demo]!.wounds = 0))
    expect(withCtx(surrounded, (ctx) => removeNow(ctx, demo)).state.markers.some((m) => m.equipmentId === 'ks.meltaMine')).toBe(false)
    // Proximity Mine
    const tr = A(s, 'trooper')
    const live = edit(place(place(s, boy, 9, 0), tr, -9, 0), (st) => {
      const m = st.markers.find((k) => k.equipmentId === 'ks.meltaMine')!
      m.carriedBy = null
      m.pos = { x: 5, z: 0 }
      st.operatives[demo]!.flags.carrying = null
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
    })
    const trigger = (st: GameState, id: string) =>
      withCtx(st, (ctx) => runHook('action.ended', { seat: 'B', state: ctx.state, engine: ctx, operativeId: id, data: { action: 'reposition', counteract: false, free: false, activeSeat: 'B' } }), dice(4, 4)).state
    const mineLeft = (st: GameState) => st.markers.some((m) => m.equipmentId === 'ks.meltaMine')
    // out of reach: nothing happens
    expect(mineLeft(trigger(live, boy))).toBe(true)
    const hitBoy = trigger(place(live, boy, 6.2, 0), boy)
    expect(hitBoy.operatives[boy]!.maxWounds - hitBoy.operatives[boy]!.wounds).toBe(11)
    expect(mineLeft(hitBoy)).toBe(false)
    // a friendly Trooper sets it off too, the Demo-Trooper never does
    const friend = trigger(place(live, tr, 4, 0), tr)
    expect(friend.operatives[tr]!.wounds).toBe(0) // 11 damage against 8 wounds
    const demoNear = trigger(place(live, demo, 4.2, 0), demo)
    expect(demoNear.operatives[demo]!.wounds).toBe(demoNear.operatives[demo]!.maxWounds)
    expect(mineLeft(demoNear)).toBe(true)
    // a carried marker never triggers
    const held = edit(place(live, boy, 0.9, 0), (st) => {
      const m = st.markers.find((k) => k.equipmentId === 'ks.meltaMine')!
      m.carriedBy = demo
      m.pos = { x: 0, z: 0 }
    })
    expect(trigger(held, boy).operatives[boy]!.wounds).toBe(held.operatives[boy]!.maxWounds)
  })

  it('TEAM-KS-014 Blast Padding: a re-roll of one die against Blast or Torrent unless the weapon has a sweeping profile; splash Devastating does nothing unless it is the target', () => {
    const s = open()
    const demo = A(s, 'demo-trooper')
    const boy = B(s, 'boy')
    const grants = (weaponId: string) => defenceStats(s, demo, boy, weaponId, parseRules(s.data.weapons[weaponId]!.rules), false).grants.map((g) => g.id)
    expect(grants('ks.w.grenade-launcher-frag')).toEqual(['ks.padding'])
    expect(grants('kom.w.burna-standard')).toEqual(['ks.padding'])
    expect(grants('ks.w.hot-shot-volley-gun-sweeping')).toEqual([])
    expect(grants('ks.w.hot-shot-volley-gun-focused')).toEqual([])
    expect(grants('ks.w.hot-shot-lasgun')).toEqual([])
    const lose = (id: string, splash: boolean) => {
      const r = withCtx(s, (ctx) => void inflict(ctx, { targetId: id, attackerId: boy, weaponId: 'kom.w.burna-standard', amount: 4, source: 'devastating', ...(splash ? { splash: true } : {}) }))
      return s.operatives[id]!.wounds - r.state.operatives[id]!.wounds
    }
    expect(lose(demo, true)).toBe(0)
    expect(lose(demo, false)).toBe(4)
    expect(lose(A(s, 'trooper'), true)).toBe(4)
  })

  it('TEAM-KS-015 RELOCATE: 0 CP with the Recon-Trooper first and 1 CP otherwise, never in turning point 1; the first pick and friends within 3" clear of enemies take optional free Dashes in the chosen order', () => {
    const g = edit(toGambit(), (st) => {
      st.turningPoint = 2
      st.players.A.cp = 3
      st.map = { ...st.map, features: [] }
    })
    const recon = A(g, 'recon-trooper')
    const tr = A(g, 'trooper')
    const vox = A(g, 'vox-trooper')
    const offers = (st: GameState) => offersFor(st, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).filter((o) => o.ployId === 'ks.p.relocate')
    expect(offers(toGambit())).toEqual([])
    expect(offers(g).find((o) => o.param === recon)!.cost).toBe(0)
    expect(offers(g).find((o) => o.param === tr)!.cost).toBe(1)
    // the group: the recon pick, friends within 3" of it, not one far away
    const grouped = place(place(place(place(g, recon, -5, 0), tr, -4, 0), vox, -2.5, 0), A(g, 'sergeant'), 0, 8)
    const used = usePlayed(grouped, 'ks.p.relocate', {}, recon)
    expect(used.pending!.kind).toBe('ability.choice')
    const ids = optionIds(used)
    expect(ids).toEqual(expect.arrayContaining([recon, tr, vox, 'done']))
    expect(ids).not.toContain(A(g, 'sergeant'))
    // the Trooper first: a free Dash (optional), then the choice continues with the rest
    const dash = take(used, tr).state
    expect(dash.pending!.kind).toBe('move.path')
    const after = play(dash, dice(), goTo(-4, 1.5), ['ability.choice']).state
    expect(after.pending!.kind).toBe('ability.choice')
    expect(optionIds(after)).not.toContain(tr)
    expect(optionIds(after)).toContain(recon)
    // an enemy within 3" of the pick bars it
    const near = place(place(g, recon, -5, 0), B(g, 'boy'), -3, 0)
    expect(offers(near).some((o) => o.param === recon)).toBe(false)
    expect(offers(place(near, B(g, 'boy'), -10, 0)).some((o) => o.param === recon)).toBe(true)
  })

  it('TEAM-KS-016 TEAM-KS-017 TEAM-KS-018 Auspex Scan (live 8" bubble, no obscured for Kasrkin shooters), Concealed Position (first Shoot of the battle only, Heavy on the other profiles), Camo Cloak (no Saturate, one more cover improvement)', () => {
    const s = open()
    const rt = A(s, 'recon-trooper')
    const boy = B(s, 'boy')
    const scanned = take(activateOp(place(place(s, rt, 0, 0), boy, 6, 0), rt), 'ability:ks.a.auspex-scan').state
    expect(scanned.firefight.activation!.apSpent).toBe(1)
    expect(isScanned(scanned, scanned.operatives[boy]!, 'A')).toBe(true)
    expect(isScanned(place(scanned, boy, 10, 0), place(scanned, boy, 10, 0).operatives[boy]!, 'A')).toBe(false)
    const token = scanned.operatives[rt]!.tokens!.find((t) => t.kind === 'ks.auspexScan')!
    expect(token.expires).toEqual(['sourceNextActivation', 'sourceIncapacitated'])
    const status = (st: GameState, shooter: string) => {
      const d = { obscured: true, inCover: false }
      runHook('target.status', { seat: st.operatives[shooter]!.seat, state: st, operativeId: shooter, targetId: boy, data: d })
      return d.obscured
    }
    expect(status(scanned, A(s, 'trooper'))).toBe(false)
    expect(status(open(), A(s, 'trooper'))).toBe(true)
    // incapacitated: the scan goes with it
    const gone = withCtx(edit(scanned, (st) => void (st.operatives[rt]!.wounds = 0)), (ctx) => removeNow(ctx, rt)).state
    expect(isScanned(gone, gone.operatives[boy]!, 'A')).toBe(false)
    // Concealed Position
    const sh = A(s, 'sharpshooter')
    const at = place(place(s, sh, 0, 0), boy, 8, 0)
    const conceal = activateOp(at, sh, 'conceal')
    expect(usableRangedWeapons(conceal, conceal.operatives[sh]!, [])).toEqual(['ks.w.hot-shot-marksman-rifle-concealed'])
    const used = shootAt(at, sh, 'ks.w.hot-shot-marksman-rifle-concealed', boy, dice(1, 1, 1, 1, 1, 1, 1), {}, 'conceal').state
    const later = edit(used, (st) => void (st.operatives[sh]!.order = 'engage'))
    expect(usableRangedWeapons(later, later.operatives[sh]!, [])).not.toContain('ks.w.hot-shot-marksman-rifle-concealed')
    expect(usableRangedWeapons(later, later.operatives[sh]!, [])).toContain('ks.w.hot-shot-marksman-rifle-stationary')
    const mobile = shootAt(at, sh, 'ks.w.hot-shot-marksman-rifle-mobile', boy, dice(1, 1, 1, 1, 1, 1, 1)).state
    expect(usableRangedWeapons(mobile, mobile.operatives[sh]!, [])).not.toContain('ks.w.hot-shot-marksman-rifle-concealed')
    // Heavy: after moving only the mobile profile is usable
    const engaged = edit(at, (st) => void (st.operatives[sh]!.order = 'engage'))
    expect(usableRangedWeapons(engaged, engaged.operatives[sh]!, ['reposition'])).toEqual(['ks.w.hot-shot-marksman-rifle-mobile'])
    // Camo Cloak
    const burna = s.data.weapons['kom.w.burna-standard']!
    const rulesAgainst = (id: string) => parseRules(effectiveRules(s, s.operatives[boy]!, burna, 'shoot', id)).saturate
    expect(rulesAgainst(A(s, 'trooper'))).toBe(true)
    expect(rulesAgainst(sh)).toBe(false)
    expect(providerStealthy(s, s.operatives[sh]!)).toBe(1)
    expect(providerStealthy(s, s.operatives[A(s, 'trooper')]!)).toBe(0)
  })

  it('TEAM-KS-019 TEAM-KS-020 Adaptive Equipment (a Smoke and a Stun Grenade per turning point for Troopers, no equipment used) and BATTLE COMMS (+1 APL to a friend, never above 3, twice per activation)', () => {
    const s = open()
    const [t1, t2] = Object.values(s.operatives).filter((o) => o.seat === 'A' && o.datacardId === 'ks.trooper').map((o) => o.id) as [string, string]
    const boy = B(s, 'boy')
    const u = place(place(place(s, t1, 0, 0), boy, 5, 0), t2, 0, 2)
    const smokeId = 'core.a.smoke-grenade'
    const has = (st: GameState, id: string, ability: string) => abilityOffers(st, st.operatives[id]!, null).some((o) => o.abilityId === ability)
    expect(has(u, t1, smokeId)).toBe(true)
    expect(has(u, A(s, 'gunner'), smokeId)).toBe(false)
    const thrown = take(activateOp(u, t1), `ability:${smokeId}`).state
    const smoke = take(thrown, thrown.pending!.options![0]!.id).state
    expect(tpUsesOf(smoke, 'A', `ownTp:${smokeId}`)).toBe(1)
    expect(usesOf(smoke, 'A', smokeId)).toBe(0)
    // the second Smoke Grenade of the turning point is refused, the Stun Grenade is still there
    expect(has(smoke, t2, smokeId)).toBe(false)
    expect(has(smoke, t2, 'core.a.stun-grenade')).toBe(true)
    expect(optionIds(smoke)).not.toContain(`ability:${smokeId}`)
    // BATTLE COMMS
    const vox = A(s, 'vox-trooper')
    const sg = A(s, 'sergeant')
    const comms = open()
    const first = take(activateOp(comms, vox), `ability:ks.a.battle-comms:${t1}`).state
    expect(effectiveApl(first.operatives[t1]!)).toBe(3)
    expect(first.firefight.activation!.apSpent).toBe(1)
    // the same target is at APL 3 now, the Sergeant already is, the Vox-Trooper cannot pick itself
    expect(optionIds(first)).not.toContain(`ability:ks.a.battle-comms:${t1}`)
    expect(optionIds(first)).not.toContain(`ability:ks.a.battle-comms:${sg}`)
    expect(optionIds(first)).not.toContain(`ability:ks.a.battle-comms:${vox}`)
    const second = take(first, `ability:ks.a.battle-comms:${t2}`).state
    expect(effectiveApl(second.operatives[t2]!)).toBe(3)
    expect(effectiveApl(second.operatives[t1]!)).toBe(3)
    expect(second.firefight.activation).toBeNull() // both AP spent
    // a stunned Sergeant (APL 2) goes back to 3
    const stunned = edit(comms, (st) => void (st.operatives[sg]!.aplMods = -1))
    expect(effectiveApl(take(activateOp(stunned, vox), `ability:ks.a.battle-comms:${sg}`).state.operatives[sg]!)).toBe(3)
    // not while in an enemy control range
    expect(optionIds(activateOp(place(place(comms, vox, 0, 0), boy, 1.4, 0), vox)).some((i) => i.startsWith('ability:ks.a.battle-comms'))).toBe(false)
  })

  it('TEAM-KS-021 TEAM-KS-022 TEAM-KS-023 TEAM-KS-026 Elimination Pattern, Engage from Cover, Clearance Sweep and Neutralise Target', () => {
    const base = open()
    const tr = A(base, 'trooper')
    const rt = A(base, 'recon-trooper')
    const boy = B(base, 'boy')
    const rulesOf = (st: GameState, weaponId: string, shooter = tr) => parseRules(effectiveRules(st, st.operatives[shooter]!, st.data.weapons[weaponId]!, 'shoot', boy))
    // ELIMINATION PATTERN
    const elim = withFx(place(place(base, tr, 0, 0), boy, 6, 0), { source: 'ks.p.elimination-pattern' })
    expect(rulesOf(elim, 'ks.w.hot-shot-lasgun').piercingCrits).toBe(1)
    expect(rulesOf(elim, 'ks.w.hot-shot-volley-gun-focused').piercing).toBe(1)
    expect(rulesOf(elim, 'ks.w.meltagun').piercing).toBe(2)
    expect(rulesOf(elim, 'ks.w.meltagun').piercingCrits).toBe(0)
    expect(rulesOf(place(base, tr, 0, 0), 'ks.w.hot-shot-lasgun').piercingCrits).toBe(0)
    // a target in cover is not eligible unless it is scanned
    const covered = withWall(place(place(withFx(base, { source: 'ks.p.elimination-pattern' }), tr, 0, 0), boy, 4, 0))
    expect(rulesOf(covered, 'ks.w.hot-shot-lasgun').piercingCrits).toBe(0)
    const scannedIn = edit(place(covered, rt, 1, 3), (st) => void (st.operatives[rt]!.tokens = [{ kind: 'ks.auspexScan', owner: 'A', count: 1 }]))
    expect(rulesOf(scannedIn, 'ks.w.hot-shot-lasgun').piercingCrits).toBe(1)
    // a Severe crit triggers it: the defence pool loses a die
    const severe = withSkills(withFx(place(place(base, tr, 0, 0), boy, 6, 0), { source: 'ks.p.elimination-pattern' }), 'light-em-up')
    const r = shootAt(severe, tr, 'ks.w.hot-shot-lasgun', boy, dice(3, 3, 1, 1, 1, 1, 1))
    expect(r.events.filter((e) => e.type === 'DefenceDiceRolled').map((e) => (e as { collected: number }).collected)).toEqual([2])
    // ENGAGE FROM COVER: one defence die re-rolled when the Kasrkin target is in cover in this sequence
    const efc = withFx(base, { source: 'ks.p.engage-from-cover' })
    const asTarget = (cover: boolean) => {
      const st = edit(efc, (x) => void (x.attack = { kind: 'shoot', stage: 'resolve', operativeId: boy, seat: 'B', weaponId: 'kom.w.slugga', pointBlank: false, targets: [tr], candidates: [], index: 0, seq: { targetId: tr, cover } as never, incapacitated: [], stunned: [], inherit: null, windows: [] }))
      return defenceStats(st, tr, boy, 'kom.w.slugga', parseRules(st.data.weapons['kom.w.slugga']!.rules), false).grants.map((g) => g.id)
    }
    expect(asTarget(true)).toEqual(['ks.efc'])
    expect(asTarget(false)).toEqual([])
    // CLEARANCE SWEEP: Ceaseless when shooter and target are within 5" of the marker
    const swept = usePlayed(place(place(base, tr, -3, 0), boy, 3, 0), 'ks.p.clearance-sweep', {}, '0,0')
    expect(rulesOf(swept, 'ks.w.hot-shot-lasgun').ceaseless).toBe(true)
    expect(rulesOf(place(swept, boy, 7, 0), 'ks.w.hot-shot-lasgun').ceaseless).toBe(false)
    expect(rulesOf(place(swept, tr, -7, 0), 'ks.w.hot-shot-lasgun').ceaseless).toBe(false)
    // NEUTRALISE TARGET: re-roll any attack dice against a target with no cover save; none against one in cover
    const open2 = place(place(base, tr, 0, 0), boy, 5, 0)
    const hit = shootAt(open2, tr, 'ks.w.hot-shot-lasgun', boy, dice(1, 1, 1, 1, 6, 6, 6, 6, 1, 1, 1), takePloy('ks.p.neutralise-target'))
    expect(hit.events.filter((e) => e.type === 'DiceRerolled').length).toBeGreaterThan(0)
    expect((hit.events.find((e) => e.type === 'AttackRetained') as { crit: number }).crit).toBe(4)
    const blocked = shootAt(withWall(place(place(base, tr, 0, 0), boy, 4, 0)), tr, 'ks.w.hot-shot-lasgun', boy, dice(1, 1, 1, 1, 6, 6, 6, 6, 1, 1, 1), takePloy('ks.p.neutralise-target'))
    expect(blocked.events.filter((e) => e.type === 'DiceRerolled')).toEqual([])
  })

  it('TEAM-KS-028 TEAM-KS-029 TEAM-KS-030 TEAM-KS-031 Foregrip, Long-Range Scope, Relics of Cadia and Combat Daggers', () => {
    const base = open({ equipmentA: ['ks.e.foregrip', 'ks.e.long-range-scope', 'ks.e.relics-of-cadia', 'ks.e.combat-daggers'] })
    const tr = A(base, 'trooper')
    const sg = A(base, 'sergeant')
    const boy = B(base, 'boy')
    const rulesFor = (st: GameState, id: string, weaponId: string) => parseRules(effectiveRules(st, st.operatives[id]!, st.data.weapons[weaponId]!, 'shoot', boy))
    // FOREGRIP
    const close = place(place(base, tr, 0, 0), boy, 2.5, 0)
    expect(rulesFor(close, tr, 'ks.w.hot-shot-lasgun').accurate).toEqual([1])
    expect(rulesFor(place(close, boy, 5, 0), tr, 'ks.w.hot-shot-lasgun').accurate).toEqual([])
    expect(rulesFor(place(place(base, sg, 0, 0), boy, 2.5, 0), sg, 'ks.w.bolt-pistol').accurate).toEqual([])
    expect(rulesFor(close, tr, 'core.w.frag-grenade').accurate).toEqual([])
    // LONG-RANGE SCOPE: a crit at range turns Saturate on (no cover save is offered); no crit, close range or the laspistol keep the cover save
    const wallAt = (x0: number) => withTerrain(base, feature('ks-w2', part('ks-w2.a', rect(x0, x0 + 0.4, -2, 2), 1, ['light'])))
    const asked = (st: GameState, weaponId: string, rolled: number[], x: number) => {
      let t = take(take(activateOp(place(place(st, tr, 0, 0), boy, x, 0), tr), 'shoot').state, weaponId).state
      t = take(t, boy, dice(...rolled, 1, 1, 1)).state
      return play(t, dice(1, 1, 1), {}).kinds.includes('shoot.coverSave')
    }
    expect(asked(wallAt(8), 'ks.w.hot-shot-lasgun', [6, 3, 3, 3], 9)).toBe(false)
    expect(asked(wallAt(8), 'ks.w.hot-shot-lasgun', [3, 3, 3, 3], 9)).toBe(true)
    expect(asked(wallAt(4), 'ks.w.hot-shot-lasgun', [6, 3, 3, 3], 5)).toBe(true)
    const pistolOnly = edit(wallAt(6), (st) => void (st.operatives[tr]!.weapons = ['ks.w.hot-shot-laspistol']))
    expect(asked(pistolOnly, 'ks.w.hot-shot-laspistol', [6, 3, 3, 3], 7)).toBe(true)
    // RELICS OF CADIA: two fails become one normal success, once per turning point, shooting or fighting
    const two = place(place(base, tr, 0, 0), boy, 5, 0)
    const withRelics = shootAt(two, tr, 'ks.w.hot-shot-lasgun', boy, dice(1, 1, 3, 3, 1, 1, 1), takePloy('ks.e.relics-of-cadia'))
    expect((withRelics.events.find((e) => e.type === 'AttackRetained') as { normal: number }).normal).toBe(3)
    expect(usedThisTp(withRelics.state, 'A', 'ks.e.relics-of-cadia')).toBe(true)
    const oneFail = shootAt(two, tr, 'ks.w.hot-shot-lasgun', boy, dice(1, 3, 3, 3, 1, 1, 1), takePloy('ks.e.relics-of-cadia'))
    expect((oneFail.events.find((e) => e.type === 'AttackRetained') as { normal: number }).normal).toBe(3)
    expect(usedThisTp(oneFail.state, 'A', 'ks.e.relics-of-cadia')).toBe(false)
    const used = edit(two, (st) => void st.ledger.A.tp.push('ks.e.relics-of-cadia'))
    const refused = shootAt(used, tr, 'ks.w.hot-shot-lasgun', boy, dice(1, 1, 3, 3, 1, 1, 1), takePloy('ks.e.relics-of-cadia'))
    expect((refused.events.find((e) => e.type === 'AttackRetained') as { normal: number }).normal).toBe(2)
    const melee = edit(facing(base, sg, boy), (st) => {
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
      st.operatives[sg]!.weapons = ['ks.w.power-weapon']
    })
    const fought = play(take(take(activateOp(melee, sg), 'fight').state, boy, dice(1, 1, 3, 3, 1, 1, 1, 1)).state, dice(), { ...strikes, ...takePloy('ks.e.relics-of-cadia') })
    expect(fought.events.filter((e) => e.type === 'Struck')).toHaveLength(3)
    // COMBAT DAGGERS
    for (const op of Object.values(base.operatives).filter((o) => o.seat === 'A')) expect(op.weapons, op.name).toContain('ks.w.combat-dagger')
    expect(base.operatives[boy]!.weapons).not.toContain('ks.w.combat-dagger')
    expect(base.data.weapons['ks.w.combat-dagger']).toMatchObject({ atk: 3, hit: 4, dmg: { normal: 3, crit: 4 } })
  })

  it('TEAM-KS-024 TEAM-KS-025 TEAM-KS-027 Seize the Initiative (only the player without it, a 1 AP action that does not move), Cover Retreat (a ready, visible friend within 6" shoots free after the Fall Back), Give No Ground (exactly 2 against exactly 2)', () => {
    // SEIZE THE INITIATIVE: Kasrkin as seat B while the Kommandos hold initiative
    const w = toSeize()
    expect(w.pending).toMatchObject({ kind: 'ploy.firefight', seat: 'B', window: 'firefight.start' })
    const seizeIds = optionIds(w).filter((i) => i.startsWith('ks.p.seize-the-initiative'))
    expect(seizeIds.length).toBe(10)
    const trB = Object.values(w.operatives).find((o) => o.seat === 'B' && o.datacardId === 'ks.trooper')!.id
    const kom = Object.values(w.operatives).find((o) => o.seat === 'A' && o.datacardId === 'kom.boy')!.id
    const set = edit(place(place(w, trB, 0, 0), kom, 6, 0), (st) => void (st.operatives[trB]!.order = 'engage'))
    const free = take(set, `ks.p.seize-the-initiative:${trB}`).state
    expect(free.pending!.kind).toBe('firefight.action')
    expect(optionIds(free)).toEqual(expect.arrayContaining(['shoot', 'guard']))
    for (const id of ['reposition', 'dash', 'charge', 'fallBack']) expect(optionIds(free)).not.toContain(id)
    expect(free.firefight.activation!.apSpent).toBe(0)
    // the player holding initiative is never offered it
    const holder = open()
    expect(offersFor(holder, 'A', 'firefight.start', { window: 'firefight.start' }).filter((o) => o.ployId === 'ks.p.seize-the-initiative')).toEqual([])
    // COVER RETREAT
    const s = open()
    const t1 = A(s, 'trooper')
    const sg = A(s, 'sergeant')
    const boy = B(s, 'boy')
    const setup = place(place(place(s, t1, 0, 0), boy, 1.4, 0), sg, -3, 0)
    const fall = (st: GameState) => play(take(activateOp(st, t1), 'fallBack').state, dice(), goTo(-3, 3), ['ploy.firefight', 'firefight.action']).state
    const offered = fall(setup)
    // between the Fall Back's move and the end of that action
    expect(offered.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.fallBackMoved' })
    expect(offered.firefight.activation!.declared?.action).toBe('fallBack')
    expect(optionIds(offered)).toContain(`ks.p.cover-retreat:${sg}`)
    const retreat = take(offered, `ks.p.cover-retreat:${sg}`).state
    expect(retreat.pending!.kind).toBe('shoot.weapon')
    expect(retreat.firefight.activation!.operativeId).toBe(sg)
    const aimed = take(take(retreat, retreat.pending!.options![0]!.id).state, boy, dice(1, 1, 1, 1, 1, 1, 1))
    const played = play(aimed.state, dice(), {}, ['firefight.action', 'firefight.activate'])
    const afterShoot = played.state
    expect(afterShoot.operatives[sg]!.ready).toBe(true)
    expect(afterShoot.operatives[sg]!.flags.guard).toBe(false)
    // the free Shoot resolves first, then the Fall Back ends
    const resolved = [...aimed.events, ...played.events].filter((e) => e.type === 'ActionResolved').map((e) => (e as { action: string }).action)
    expect(resolved.indexOf('shoot')).toBeGreaterThanOrEqual(0)
    expect(resolved.indexOf('shoot')).toBeLessThan(resolved.indexOf('fallBack'))
    // an expended or distant friend is not offered, and a Conceal friend changes to Engage
    expect(optionIds(fall(edit(setup, (st) => void (st.operatives[sg]!.ready = false))))).not.toContain(`ks.p.cover-retreat:${sg}`)
    expect(optionIds(fall(place(setup, sg, -9, 0)))).not.toContain(`ks.p.cover-retreat:${sg}`)
    const hidden = take(fall(edit(setup, (st) => void (st.operatives[sg]!.order = 'conceal'))), `ks.p.cover-retreat:${sg}`).state
    expect(hidden.operatives[sg]!.order).toBe('engage')
    // GIVE NO GROUND
    const m = s.markers.find((k) => k.kind === 'objective')!
    const tie = edit(place(place(s, t1, m.pos.x + 0.9, m.pos.z), boy, m.pos.x - 0.9, m.pos.z), () => undefined)
    expect(markerControl(tie, m).controller).toBeNull()
    const start = take(take(tie, t1).state, 'engage').state
    expect(start.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.activationStart' })
    const held = take(start, `ks.p.give-no-ground:${m.id}`).state
    expect(markerControl(held, held.markers.find((k) => k.id === m.id)!).controller).toBe('A')
    expect(held.effects.find((e) => e.kind === 'ks.gng')!.expires).toBe('activation')
    // 3 against 3: nothing to offer, and no control
    const threes = edit(tie, (st) => {
      st.operatives[t1]!.apl = 3
      st.operatives[boy]!.apl = 3
    })
    expect(offersFor(threes, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: t1, counteracting: false }).filter((o) => o.ployId === 'ks.p.give-no-ground')).toEqual([])
    expect(markerControl(usePlayed(threes, 'ks.p.give-no-ground', { window: 'firefight.activationStart' }, m.id), m).controller).toBeNull()
    // at the end of the Firefight phase it decides the turning point's scoring, and lasts until the next turning point
    const endOffers = offersFor(tie, 'A', 'turningPoint.end', { window: 'turningPoint.end' }).filter((o) => o.ployId === 'ks.p.give-no-ground')
    expect(endOffers.map((o) => o.param)).toEqual([m.id])
    const ended = usePlayed(tie, 'ks.p.give-no-ground', { window: 'turningPoint.end' }, m.id)
    expect(ended.effects.find((e) => e.kind === 'ks.gng')!.expires).toBe('turningPointStart')
    expect(markerControl(ended, m).controller).toBe('A')
  })

  // --- rules verification fixes -----------------------------------------------------------------------------------

  /** The Melta Mine on the ground at (x, z), nobody carrying it. */
  const mineAt = (s: GameState, x: number, z: number): GameState =>
    edit(s, (st) => {
      const m = st.markers.find((k) => k.equipmentId === 'ks.meltaMine')!
      const demo = st.operatives[m.carriedBy ?? A(st, 'demo-trooper')]!
      m.carriedBy = null
      m.pos = { x, z }
      demo.flags.carrying = null
    })

  it('TEAM-KS-013 Proximity Mine ends the action of an operative that survives it: a move through the mine stops at the increment that set it off', () => {
    const s = open()
    const tr = A(s, 'trooper')
    const armed = edit(mineAt(place(s, tr, 0, 0), 3, 1.2), (st) => void (st.operatives[tr]!.wounds = st.operatives[tr]!.maxWounds = 40))
    const path = { 'move.path': (q: PendingDecision) => ({ type: 'move.path' as const, seat: q.seat, decisionId: q.id, payload: { waypoints: [{ x: 3, z: 0 }, { x: 6, z: 0 }] } }) }
    const r = play(take(activateOp(armed, tr), 'reposition').state, dice(4, 4), path, ['ploy.firefight', 'firefight.action'])
    const after = r.state.operatives[tr]!
    expect(after.wounds).toBe(29) // 2D6+3 = 11
    expect(r.state.markers.some((m) => m.equipmentId === 'ks.meltaMine')).toBe(false)
    expect([after.pos.x, after.pos.z]).toEqual([3, 0])
    const moved = r.events.find((e) => e.type === 'OperativeMoved') as { to: { x: number }; segments: unknown[]; cost: number }
    expect(moved.to.x).toBe(3)
    expect(moved.segments).toHaveLength(1)
    expect(moved.cost).toBe(3)
    // the same path with no mine finishes at the far end
    const clear = edit(armed, (st) => void (st.markers = st.markers.filter((m) => m.equipmentId !== 'ks.meltaMine')))
    const free = play(take(activateOp(clear, tr), 'reposition').state, dice(), path, ['ploy.firefight', 'firefight.action']).state
    expect(free.operatives[tr]!.pos.x).toBe(6)
  })

  it('TEAM-KS-012 Place Melta Mine is the Place Marker action: not in the activation the mine was picked up in', () => {
    const s = open()
    const demo = A(s, 'demo-trooper')
    let t = activateOp(place(mineAt(s, 0.9, 0), demo, 0, 0), demo)
    const pick = optionIds(t).find((i) => i.startsWith('marker:pickUp'))!
    t = take(t, pick).state
    while (t.pending!.kind === 'ploy.firefight') t = passIt(t).state
    expect(t.pending!.kind).toBe('firefight.action')
    expect(t.operatives[demo]!.flags.carrying).toBeTruthy()
    expect(optionIds(t).some((i) => i.startsWith('marker:place'))).toBe(false)
  })

  it('TEAM-KS-013 Proximity Mine goes off after a forced move outside any action too (provider checkMines), without stopping it', () => {
    const s = open()
    const boy = B(s, 'boy')
    const armed = edit(mineAt(place(s, boy, 9, 0), 5, 0), (st) => void (st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40))
    const pushed = withCtx(
      armed,
      (ctx) => {
        ctx.state.operatives[boy]!.pos = { x: 6.2, y: 0, z: 0 }
        updateControl(ctx)
      },
      dice(4, 4),
    ).state
    expect(pushed.operatives[boy]!.wounds).toBe(29)
    expect(pushed.operatives[boy]!.pos.x).toBe(6.2)
    expect(pushed.markers.some((m) => m.equipmentId === 'ks.meltaMine')).toBe(false)
  })

  it('TEAM-KS-024 Seize the Initiative with Place Melta Mine: the mine is placed but no free Dash follows (the action may not move)', () => {
    const w = toSeize()
    const demo = Object.values(w.operatives).find((o) => o.seat === 'B' && o.datacardId === 'ks.demo-trooper')!.id
    const set = place(w, demo, 0, -6)
    expect(set.markers.find((m) => m.equipmentId === 'ks.meltaMine')!.carriedBy).toBe(demo)
    const free = take(set, `ks.p.seize-the-initiative:${demo}`).state
    const mineId = set.markers.find((m) => m.equipmentId === 'ks.meltaMine')!.id
    const placing = take(free, `marker:place:${mineId}`).state
    const p = placing.pending!
    expect(p.kind).toBe('marker.place')
    const placed = expectOk(step(placing, { type: 'marker.place', seat: p.seat, decisionId: p.id, payload: (p.context.spots as { x: number; z: number }[])[0]! })).state
    expect(placed.markers.find((m) => m.equipmentId === 'ks.meltaMine')!.carriedBy).toBeNull()
    expect(placed.pending!.kind).not.toBe('move.path')
    expect(optionIds(placed).some((i) => i.startsWith('ks.mineDash'))).toBe(false)
  })

  it('TEAM-KS-014 Blast Padding against a friendly shooter too: a Kasrkin flamer catching the Demo-Trooper still allows the re-roll', () => {
    const s = open()
    const demo = A(s, 'demo-trooper')
    const gunner = A(s, 'gunner')
    const grants = defenceStats(s, demo, gunner, 'ks.w.flamer', parseRules(s.data.weapons['ks.w.flamer']!.rules), false).grants.map((g) => g.id)
    expect(grants).toEqual(['ks.padding'])
  })
})
