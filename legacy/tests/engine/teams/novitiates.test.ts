// novitiates engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-NV-nnn).
// Novitiates are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { step } from '@/engine'
import { act } from '@/engine/actions'
import { abilityOffers, maxRepeats } from '@/engine/abilities'
import { attackStats, effectiveRules, inflict, validTargets, weaponDamage } from '@/engine/attack-common'
import { getCodeHook } from '@/engine/code-hooks'
import { hasKeyword } from '@/engine/conditions'
import { directDamage, usedThisTp } from '@/engine/effects'
import { actionCost } from '@/engine/firefight'
import { registerHook, runHook, unregisterHook } from '@/engine/hooks'
import { offersFor } from '@/engine/ploys'
import { markerControl } from '@/engine/query'
import { isPsychicWeapon, psychicAllowed, psychicSelectable } from '@/engine/psychic'
import { shootableWeapons } from '@/engine/shoot'
import { effectiveApl, effectiveMove } from '@/engine/state'
import { providerReactions, providerRerollsBanned, registerTeamRules, unregisterTeamRules } from '@/engine/team-rules'
import { hasToken } from '@/engine/tokens'
import { actUseful, FAITH, TEAM_ID } from '@/engine/teams/novitiates'
import type { AttackDie, DiceSide, GameState } from '@/engine/types'
import { enumerateLoadouts, loadBundle, validateRoster, type DatacardData } from '../../../src/data'
import { melee, withWeapons } from '../../fixtures/attack'
import { feature, part, rect } from '../../fixtures/maps'
import { place } from '../../fixtures/helpers'
import { activateOp, edit, inTp, openReal, opOf, optionIds, passIt, realBundle, take, withCtx } from '../../fixtures/real'
import { A, B, DONE, aim, attackerStrikesDefenderBlocks, aura, blazing, bTurn, brawl, dice, engaged, faith, lgPsyker, martyrdom, medicSave, nvRoster, nvWindows, open, opt, passPloys, takeLike, toGambit, toWindow, useGambit, walk, withFaith, type Walked } from './novitiates.hooks'

const data = loadBundle()

describe('TEAM-NV Novitiates', () => {
  it('TEAM-NV-000 TEAM-NV-001 TEAM-NV-002 playable team, roster rules, printed loadouts and keywords', () => {
    expect(TEAM_ID).toBe('novitiates')
    const team = data.teams['novitiates']!
    expect(team.playable).toBe(true)
    const cards = realBundle.datacards as never
    const singles = ['nv.condemnor', 'nv.dialogus', 'nv.duellist', 'nv.exactor', 'nv.hospitaller', 'nv.preceptor', 'nv.pronatus', 'nv.reliquarius', 'nv.penitent']
    const leader = ['nv.superior']
    expect(validateRoster(team, { leader, main: singles }, cards).ok).toBe(true)
    // three Militants and two Purgatus are legal; a third Purgatus, a second copy of anything else, or a tenth pick is not
    expect(validateRoster(team, { leader, main: ['nv.militant', 'nv.militant', 'nv.militant', 'nv.purgatus', 'nv.purgatus', 'nv.condemnor', 'nv.dialogus', 'nv.duellist', 'nv.exactor'] }, cards).ok).toBe(true)
    expect(validateRoster(team, { leader, main: ['nv.militant', 'nv.militant', 'nv.purgatus', 'nv.purgatus', 'nv.purgatus', 'nv.condemnor', 'nv.dialogus', 'nv.duellist', 'nv.exactor'] }, cards).ok).toBe(false)
    expect(validateRoster(team, { leader, main: ['nv.condemnor', 'nv.condemnor', ...singles.slice(2)] }, cards).ok).toBe(false)
    expect(validateRoster(team, { leader, main: [...singles, 'nv.militant'] }, cards).ok).toBe(false)
    expect(validateRoster(team, { leader: ['nv.condemnor'], main: singles }, cards).ok).toBe(false)

    const count = (id: string) => enumerateLoadouts(data.byId[id] as DatacardData).length
    expect(count('nv.superior')).toBe(3)
    expect(count('nv.militant')).toBe(2)
    for (const id of ['nv.condemnor', 'nv.dialogus', 'nv.duellist', 'nv.exactor', 'nv.hospitaller', 'nv.penitent', 'nv.preceptor', 'nv.pronatus', 'nv.purgatus', 'nv.reliquarius']) expect(count(id), id).toBe(1)
    const weaponsOf = (id: string) => (realBundle.datacards[id]!.legalLoadouts ?? []).map((l) => [...realBundle.datacards[id]!.fixedWeapons, ...l].sort())
    // the Preceptor has only the mace; the Exactor always carries both whips
    expect(weaponsOf('nv.preceptor')).toEqual([['nv.w.mace-of-the-righteous']])
    expect(weaponsOf('nv.exactor')).toEqual([['nv.w.neural-whips-melee', 'nv.w.neural-whips-ranged']])
    // the Superior's pairs: the plasma pistol brings both profiles
    const sup = realBundle.datacards['nv.superior']!.legalLoadouts!.map((l) => [...l].sort())
    expect(sup).toContainEqual(['nv.w.plasma-pistol-standard', 'nv.w.plasma-pistol-supercharge', 'nv.w.power-weapon'].sort())
    expect(sup).toContainEqual(['nv.w.gun-butt-superior', 'nv.w.relic-boltgun'])
    expect(sup).toContainEqual(['nv.w.power-weapon', 'nv.w.relic-bolt-pistol'])
    // the Superior's gun butt hits on 3+, everyone else's on 4+
    const s = open()
    expect(s.data.weapons['nv.w.gun-butt-superior']!.hit).toBe(3)
    expect(s.data.weapons['nv.w.gun-butt']!.hit).toBe(4)
    // keywords, stats
    for (const op of Object.values(s.operatives).filter((o) => o.seat === 'A')) expect(hasKeyword(s, op, 'NOVITIATE'), op.id).toBe(true)
    expect(hasKeyword(s, s.operatives[A(s, 'hospitaller')]!, 'MEDIC')).toBe(true)
    expect(hasKeyword(s, s.operatives[A(s, 'militant')]!, 'MEDIC')).toBe(false)
    expect(s.operatives[A(s, 'superior')]).toMatchObject({ apl: 3, save: 3, maxWounds: 9 })
    expect(s.operatives[A(s, 'militant')]).toMatchObject({ apl: 2, save: 4, maxWounds: 7 })
  })

  it('TEAM-NV-003 Faith: half the living Novitiates (rounded up) in each Ready step, kept between turning points with no cap, every change announced', () => {
    // ten operatives: 5 in the first turning point
    const ten = openReal({ teams: ['novitiates', 'kommandos'] })
    expect(faith(ten)).toBe(5)
    expect(faith(ten, 'B')).toBe(0)
    expect(ten.players.A.pools).toEqual({ [FAITH]: 5 })
    // three fall; the next Ready step adds 4 (7 alive) on top of the 5, with no cap
    const hurt = edit(ten, (st) => {
      for (const id of ['A2', 'A3', 'A4']) st.operatives[id]!.status = 'removed'
    })
    const r = withCtx(hurt, (ctx) => {
      runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })
    })
    expect(faith(r.state)).toBe(9)
    const changes = r.events.filter((e) => e.type === 'PoolChanged')
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: FAITH, delta: 4, value: 9 })
    // an odd count rounds up
    const odd = edit(hurt, (st) => {
      st.operatives['A5']!.status = 'removed'
    })
    expect(faith(withCtx(odd, (ctx) => runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })).state)).toBe(5 + 3)
    // the Faith is public: the opponent sees it
    expect(faith(ten, 'A')).toBe(5)
  })

  it('TEAM-NV-004 Guidance: 1 Faith adds a one-die re-roll on the shooter\'s roll, on a shot Novitiate\'s defence roll and in a fight; never on the enemy\'s dice', () => {
    const s = withFaith(open(), 5)
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    // attack dice: four fails, the re-roll finds a crit
    const rng = dice(1, 1, 1, 1, 6)
    const r = take(aim(s, mil, boy, 'nv.w.autogun'), boy, rng).state
    expect(r.pending!.window).toBe('shoot.beforeAttackRerolls')
    expect(optionIds(r)).toEqual(['nv.a.guidance'])
    const g = take(r, 'nv.a.guidance').state
    expect(faith(g)).toBe(4)
    expect(g.pending!.kind).toBe('dice.reroll')
    expect(optionIds(g)).toEqual(['nv.guidance:0'])
    const w = walk(g, rng)
    const rerolled = w.events.find((e) => e.type === 'DiceRerolled')!
    expect(rerolled).toMatchObject({ source: 'nv.guidance', before: [1], after: [6] })
    // a crit of 3 Dmg gets through the Boy's failed saves
    expect(w.state.operatives[boy]!.wounds).toBe(7)
    expect(faith(w.state)).toBe(4)
    // spending is final: passing the re-roll wastes the Faith
    const waste = walk(take(take(aim(s, mil, boy, 'nv.w.autogun'), boy, dice(1, 1, 1, 1)).state, 'nv.a.guidance').state, dice(), { 'dice.reroll': (p) => act.pass(p) })
    expect(faith(waste.state)).toBe(4)

    // a shot Novitiate: the Boy shoots the Duellist (Save 4+); its defence roll fails, Guidance finds a crit save
    const duel = A(s, 'duellist')
    const shot = take(aim(withFaith(s, 5), boy, duel, 'kom.w.slugga', 6, 'B'), duel, dice(4, 4, 1, 1, 1, 1, 1, 6)).state
    const sw = walk(shot, dice(6), { 'ploy.firefight': (p) => opt('nv.a.guidance')(p, shot) })
    expect(nvWindows(sw)).toEqual(['shoot.defenderBeforeRerolls:nv.a.guidance'])
    expect(faith(sw.state)).toBe(4)
    expect(sw.events.find((e) => e.type === 'DiceRerolled' && e.side === 'defence')).toMatchObject({ source: 'nv.guidance' })

    // a fight: either fighter's dice
    const pen = A(s, 'penitent')
    const fb = place(place(s, pen, 0, 0), boy, 1.4, 0)
    const f = take(take(passPloys(take(activateOp(fb, pen), 'fight').state), boy, dice(1, 1, 1, 1, 1, 1, 1, 1)).state, 'nv.a.guidance').state
    expect(f.pending!.kind).toBe('dice.reroll')
    expect(faith(f)).toBe(4)
  })

  it('TEAM-NV-005 Blessing: 2 Faith turns a normal success into a crit before Rending and Severe; not offered against an obscured target; a cover save is not changed', () => {
    const s = withFaith(open(), 5)
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    const roll = (script: number[], blessed: boolean) => {
      const rng = dice(...script)
      const r = take(aim(s, mil, boy, 'nv.w.autogun'), boy, rng).state
      const w = walk(r, rng, blessed ? { 'ploy.firefight': (p) => opt('nv.a.blessing')(p, r) } : {})
      return w
    }
    // one normal (4), three fails: 2 damage; blessed it is a crit: 3 damage
    const plain = roll([4, 1, 1, 1], false)
    expect(plain.state.operatives[boy]!.wounds).toBe(8)
    const blessed = roll([4, 1, 1, 1], true)
    expect(blessed.state.operatives[boy]!.wounds).toBe(7)
    expect(faith(blessed.state)).toBe(3)
    expect(nvWindows(blessed)).toContain('shoot.attackRolled:nv.a.blessing+nv.a.intervention')
    // the Hospitaller's Rending sees the blessed crit as a retained crit: two normals become two crits
    const hos = A(s, 'hospitaller')
    const fb = place(place(s, hos, 0, 0), boy, 1.4, 0)
    const rng = dice(4, 4, 1, 1, 1, 1, 1, 1)
    const f = take(passPloys(take(activateOp(fb, hos), 'fight').state), boy, rng).state
    const fw = walk(f, rng, { 'ploy.firefight': (p) => opt('nv.a.blessing')(p, f) }, ['fight.resolve'])
    const kept = fw.events.find((e) => e.type === 'AttackRetained' && e.operativeId === hos)!
    expect(kept).toMatchObject({ normal: 0, crit: 2 })
    expect((kept as unknown as { converted: string[] }).converted).toContain('rending')

    // obscured target: not offered
    const atRolled = (obscured: boolean) => {
      const rr = dice(4, 1, 1, 1)
      const x = take(aim(s, mil, boy, 'nv.w.autogun'), boy, rr).state
      const st = toWindow(x, rr, 'shoot.attackRolled').state
      return edit(st, (e) => {
        e.attack!.seq!.obscured = obscured
      })
    }
    const info = { window: 'shoot.attackRolled', attackerId: mil, targetId: boy, kind: 'shoot', action: 'shoot', subjectId: mil, weaponId: 'nv.w.autogun' }
    const blessingOffered = (st: GameState) => offersFor(st, 'A', 'shoot.attackRolled', info).some((o) => o.ployId === 'nv.a.blessing')
    expect(blessingOffered(atRolled(false))).toBe(true)
    expect(blessingOffered(atRolled(true))).toBe(false)
    // a retained cover save die is never turned into a crit, and a defence roll's blessing is fine
    const side = (dice: Partial<AttackDie>[]): DiceSide => ({ seat: 'A', operativeId: mil, weaponId: null, dice: dice.map((d) => ({ value: 4, kind: 'normal', rerolled: false, ...d })) as AttackDie[], need: 4, lethal: null, grants: [], commandUsed: false, phase: 'grants' })
    expect(actUseful(s, 'blessing', side([{ value: null, tag: 'cover' }]), false)).toBe(false)
    expect(actUseful(s, 'blessing', side([{ value: null, tag: 'cover' }, { value: 5 }]), false)).toBe(true)
  })

  it('TEAM-NV-006 Intervention: 3 Faith turns a fail into a normal success on attack dice and on defence dice (an extra save that blocks)', () => {
    const s = withFaith(open(), 5)
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    const rng = dice(1, 1, 1, 1)
    const r = take(aim(s, mil, boy, 'nv.w.autogun'), boy, rng).state
    const w = walk(r, rng, { 'ploy.firefight': opt('nv.a.intervention') })
    // four fails become one normal success: 2 Dmg
    expect(w.state.operatives[boy]!.wounds).toBe(8)
    expect(faith(w.state)).toBe(2)
    // a shot Duellist: the Boy's two normals, three failed saves; Intervention gives one block
    const duel = A(s, 'duellist')
    const shot = (answers: Parameters<typeof walk>[2]) => {
      const rr = dice(4, 4, 1, 1, 1, 1, 1)
      const x = take(aim(s, boy, duel, 'kom.w.slugga', 6, 'B'), duel, rr).state
      return walk(x, rr, answers)
    }
    expect(shot({}).state.operatives[duel]!.wounds).toBe(1)
    const saved = shot({ 'ploy.firefight': opt('nv.a.intervention') })
    expect(saved.state.operatives[duel]!.wounds).toBe(4)
    expect(faith(saved.state)).toBe(2)
  })

  it("TEAM-NV-007 one act per sequence, a new sequence for every Torrent target, nothing the pool cannot pay, nothing on the enemy's dice", () => {
    const s = withFaith(open(), 5)
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    // Guidance used: no Blessing or Intervention later in the same sequence although 4 Faith remain
    const rng = dice(1, 1, 1, 1, 1)
    const r = take(aim(s, mil, boy, 'nv.w.autogun'), boy, rng).state
    const w = walk(r, rng, { 'ploy.firefight': opt('nv.a.guidance') })
    expect(nvWindows(w)).toEqual(['shoot.beforeAttackRerolls:nv.a.guidance'])
    expect(faith(w.state)).toBe(4)
    // the pool decides what is offered: 2 Faith cannot buy Intervention
    const two = withFaith(s, 2)
    const r2 = take(aim(two, mil, boy, 'nv.w.autogun'), boy, dice(4, 1, 1, 1)).state
    const w2 = walk(r2, dice(), {})
    expect(nvWindows(w2)).toEqual(['shoot.beforeAttackRerolls:nv.a.guidance', 'shoot.attackRolled:nv.a.blessing'])
    const none = withFaith(s, 0)
    expect(nvWindows(walk(take(aim(none, mil, boy, 'nv.w.autogun'), boy, dice(4, 1, 1, 1)).state, dice(), {}))).toEqual([])
    // a Torrent flamer: every target is its own sequence with its own act
    const pur = A(s, 'purgatus')
    const nob = B(s, 'boss-nob')
    const t = place(aim(s, pur, boy, 'nv.w.ministorum-flamer'), nob, 4, 1.5)
    const pick = take(t, boy).state
    expect(optionIds(pick)).toContain('add:' + nob)
    const rt = dice()
    const sequences = walk(take(pick, 'add:' + nob, rt).state, rt, { 'ploy.firefight': opt('nv.a.guidance') })
    expect(nvWindows(sequences).filter((x) => x.startsWith('shoot.beforeAttackRerolls'))).toHaveLength(2)
    expect(faith(sequences.state)).toBe(3)
    // the enemy's dice: the Boy shoots the Duellist, the Novitiate player is asked only about its own defence dice
    const duel = A(s, 'duellist')
    const rb = dice(4, 4, 1, 1, 1, 1, 1)
    const shot = take(aim(s, boy, duel, 'kom.w.slugga', 6, 'B'), duel, rb).state
    const sw = walk(shot, rb, {})
    expect(nvWindows(sw)).toEqual(['shoot.defenderBeforeRerolls:nv.a.guidance', 'shoot.defenceRolled:nv.a.intervention'])
  })

  it('TEAM-NV-008 Icon of Faith: a second, different act in one sequence once per turning point, spent only when the second act is taken', () => {
    const s = withFaith(open({ equipmentA: ['nv.e.icon-of-faith'] }), 9)
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    const rng = dice(1, 1, 5, 1)
    const r = take(aim(s, mil, boy, 'nv.w.autogun'), boy, rng).state
    // one act: the Icon is not spent
    const one = take(r, 'nv.a.guidance').state
    expect(usedThisTp(one, 'A', 'nv.icon.tp')).toBe(false)
    const w = toWindow(one, rng, 'shoot.attackRolled')
    // Guidance is not offered twice; the other acts are
    expect(optionIds(w.state)).toEqual(['nv.a.blessing', 'nv.a.intervention'])
    const two = take(w.state, 'nv.a.intervention').state
    expect(usedThisTp(two, 'A', 'nv.icon.tp')).toBe(true)
    expect(faith(two)).toBe(9 - 1 - 3)
    // the next sequence this turning point is back to one act
    const used = edit(s, (st) => {
      st.ledger.A.tp.push('nv.icon.tp')
    })
    const r2 = take(aim(used, mil, boy, 'nv.w.autogun'), boy, dice(1, 1, 1, 1)).state
    const w2 = walk(r2, dice(), { 'ploy.firefight': opt('nv.a.guidance') })
    expect(nvWindows(w2)).toEqual(['shoot.beforeAttackRerolls:nv.a.guidance'])
    // without the Icon the second act is never offered
    const plain = take(aim(withFaith(open(), 9), mil, boy, 'nv.w.autogun'), boy, dice(1, 1, 5, 1)).state
    expect(nvWindows(walk(take(plain, 'nv.a.guidance').state, dice(), {}))).toEqual([])
  })

  it("TEAM-NV-009 Auto-chastisers: once per turning point an act on attack dice for free, paid in damage equal to its cost, never enough to incapacitate; it is the sequence's one act", () => {
    const s = open({ equipmentA: ['nv.e.auto-chastisers'] })
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    const before = faith(s)
    const rng = dice(1, 1, 1, 1)
    const r = take(aim(s, mil, boy, 'nv.w.autogun'), boy, rng).state
    expect(optionIds(r)).toEqual(['nv.a.guidance', 'nv.a.guidance:free'])
    const g = take(r, 'nv.a.guidance:free').state
    expect(g.operatives[mil]!.wounds).toBe(6)
    expect(faith(g)).toBe(before)
    expect(usedThisTp(g, 'A', 'nv.chastisers.tp')).toBe(true)
    // it is the sequence's one act and the turning point's one use
    const w = walk(g, rng)
    expect(nvWindows(w)).toEqual([])
    // too little life: Guidance costs 1 damage, which would incapacitate a Militant on 1 wound
    const weak = edit(s, (st) => {
      st.operatives[mil]!.wounds = 1
    })
    const rw = take(aim(weak, mil, boy, 'nv.w.autogun'), boy, dice(4, 1, 1, 1)).state
    expect(optionIds(rw)).toEqual(['nv.a.guidance'])
    // Blessing costs 2 damage: offered with 3 wounds, not with 2
    const blessWith = (wounds: number) => {
      const st = edit(s, (e) => {
        e.operatives[mil]!.wounds = wounds
      })
      const rr = dice(5, 1, 1, 1)
      const x = take(aim(withFaith(st, 0), mil, boy, 'nv.w.autogun'), boy, rr).state
      return toWindow(x, rr, 'shoot.attackRolled').state
    }
    expect(optionIds(blessWith(3))).toContain('nv.a.blessing:free')
    expect(optionIds(blessWith(2))).not.toContain('nv.a.blessing:free')
    // only attack dice: a shot Militant is never offered it
    const rb = dice(4, 4, 1, 1, 1, 1, 1)
    const shot = take(aim(withFaith(s, 5), boy, mil, 'kom.w.slugga', 6, 'B'), mil, rb).state
    const sw = walk(shot, rb, {})
    expect(sw.seen.flatMap((x) => x.options).filter((o) => o.endsWith(':free'))).toEqual([])
    // an injury the self-damage causes changes the stats only after the action (R-3.16): the flamer's second Torrent
    // sequence still hits on 2+, and the Hit is worse only once the Shoot is over
    const pur = A(s, 'purgatus')
    const grot = B(s, 'grot')
    const laid = place(
      edit(s, (st) => {
        st.operatives[pur]!.wounds = 5
      }),
      grot,
      4,
      1.6,
    )
    const fr = dice()
    const picked = take(take(aim(laid, pur, boy, 'nv.w.ministorum-flamer'), boy, fr).state, `add:${grot}`, fr).state
    const first = toWindow(picked, fr, 'shoot.attackRolled').state
    expect(first.attack!.seq!.targetId).toBe(boy)
    const paid = take(first, 'nv.a.intervention:free', fr).state
    expect(paid.operatives[pur]!.wounds).toBe(2)
    const second = walk(paid, fr, {}, DONE, (st) => st.attack?.seq?.targetId === grot && st.pending?.kind === 'ploy.firefight').state
    expect(second.attack!.seq!.atk.need).toBe(2)
    const after = walk(second, fr).state
    expect(after.pending!.kind).toBe('firefight.action')
    expect(attackStats(after, pur, 'nv.w.ministorum-flamer', grot, { kind: 'shoot' }).need).toBe(3)
  })

  it('TEAM-NV-010 Sanctified Rounds: Piercing Crits 1 after a Faith spend in the sequence (an act or one point on its own), not for a flamer, not after a free Auto-chastisers act', () => {
    const s = withFaith(open({ equipmentA: ['nv.e.sanctified-rounds', 'nv.e.auto-chastisers'] }), 5)
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    const rulesNow = (st: GameState) => effectiveRules(st, st.operatives[mil]!, st.data.weapons['nv.w.autogun']!, 'shoot', boy)
    const hasCrits = (st: GameState) => rulesNow(st).some((r) => r.rule === 'piercing' && r.crits === true)
    const rng = dice(6, 6, 1, 1)
    const r = take(aim(s, mil, boy, 'nv.w.autogun'), boy, rng).state
    expect(hasCrits(r)).toBe(false)
    // a free act spends no Faith: no Piercing Crits, and the standalone point is still on offer later
    const free = take(r, 'nv.a.guidance:free').state
    expect(hasCrits(free)).toBe(false)
    const lateFree = toWindow(free, dice(), 'shoot.attackRolled').state
    expect(optionIds(lateFree)).toContain('nv.e.sanctified-rounds')
    // a paid act qualifies
    const paid = take(r, 'nv.a.guidance').state
    expect(hasCrits(paid)).toBe(true)
    // one Faith point on its own
    const at = toWindow(r, rng, 'shoot.attackRolled').state
    const bought = take(at, 'nv.e.sanctified-rounds').state
    expect(faith(bought)).toBe(4)
    expect(hasCrits(bought)).toBe(true)
    // the extra rule bites at the defence roll: 3 dice become 2
    const done = walk(bought, rng)
    expect(done.events.find((e) => e.type === 'DefenceDiceRolled')).toMatchObject({ collected: 2 })
    // not offered to a flamer
    const pur = A(s, 'purgatus')
    const flamer = toWindow(take(aim(s, pur, boy, 'nv.w.ministorum-flamer'), boy, dice(6, 6, 1, 1)).state, dice(), 'shoot.attackRolled').state
    expect(optionIds(flamer)).not.toContain('nv.e.sanctified-rounds')
  })

  it('TEAM-NV-011 Blessed Rejuvenation: each Faith spend heals the operative it was spent on D3 at the end of the action, also when it defended; nothing for a free act', () => {
    const flag = { id: 'e900', source: 'nv.p.blessed-rejuvenation', seat: 'A', kind: 'ployFlag', expires: 'turningPoint' }
    const base = (extra: string[] = []) =>
      withFaith(
        edit(open({ equipmentA: extra }), (st) => {
          st.effects.push(flag as never)
        }),
        5,
      )
    const s = base()
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    const hurt = edit(s, (st) => {
      st.operatives[mil]!.wounds = 4
    })
    // attack: Guidance (1 Faith), then D3 = 2 (a 4) at the end of the Shoot
    const rng = dice(1, 1, 1, 1, 1, 1, 1, 1, 4)
    const r = take(aim(hurt, mil, boy, 'nv.w.autogun'), boy, rng).state
    const w = walk(r, rng, { 'ploy.firefight': opt('nv.a.guidance') })
    expect(w.state.operatives[mil]!.wounds).toBe(6)
    expect(w.events.filter((e) => e.type === 'WoundsRegained')).toHaveLength(1)
    // no ploy, no healing
    const off = edit(hurt, (st) => {
      st.effects = []
    })
    const rng2 = dice(1, 1, 1, 1, 1, 1, 1, 1, 4)
    const w2 = walk(take(aim(off, mil, boy, 'nv.w.autogun'), boy, rng2).state, rng2, { 'ploy.firefight': opt('nv.a.guidance') })
    expect(w2.state.operatives[mil]!.wounds).toBe(4)
    // defence: the Boy shoots the Duellist, Intervention (3 Faith) blocks one hit, then D3 = 3 at the end of the Boy's Shoot
    const duel = A(s, 'duellist')
    const rd = dice(4, 4, 1, 1, 1, 1, 1, 6)
    const shot = take(aim(s, boy, duel, 'kom.w.slugga', 6, 'B'), duel, rd).state
    const dw = walk(shot, rd, { 'ploy.firefight': opt('nv.a.intervention') })
    // 7 - 3 = 4, then +3
    expect(dw.state.operatives[duel]!.wounds).toBe(7)
    // a free act costs no Faith: no healing
    const free = base(['nv.e.auto-chastisers'])
    const rf = dice(1, 1, 1, 1, 1, 1, 1, 1, 6)
    const fw = walk(take(aim(edit(free, (st) => (st.operatives[mil]!.wounds = 4)), mil, boy, 'nv.w.autogun'), boy, rf).state, rf, { 'ploy.firefight': opt('nv.a.guidance:free') })
    expect(fw.state.operatives[mil]!.wounds).toBe(3)
  })

  it('TEAM-NV-012 Militant Faith: the Faith of the act comes back when an enemy falls in the sequence; not when the Militant was the one shot; with the Icon only one act is refunded', () => {
    const s = withFaith(open({ equipmentA: ['nv.e.icon-of-faith'] }), 9)
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    const shoot = (wounds: number, script: number[]) => {
      const t = edit(s, (st) => {
        st.operatives[boy]!.wounds = wounds
      })
      const rng = dice(...script)
      const r = take(aim(t, mil, boy, 'nv.w.autogun'), boy, rng).state
      return walk(r, rng, { 'ploy.firefight': opt('nv.a.guidance') })
    }
    // a kill: Guidance found the hit, the Boy (1 wound) falls, the point is back
    const kill = shoot(1, [1, 1, 1, 1, 6])
    expect(kill.state.operatives[boy]!.status).toBe('removed')
    expect(faith(kill.state)).toBe(9)
    // a hit that does not kill: the Faith stays spent
    const hit = shoot(40, [1, 1, 1, 1, 6])
    expect(hit.state.operatives[boy]!.wounds).toBe(37)
    expect(faith(hit.state)).toBe(8)
    // two acts with the Icon: the ledger refunds one act's cost (the larger)
    const rng = dice(1, 1, 5, 1)
    const r = take(aim(s, mil, boy, 'nv.w.autogun'), boy, rng).state
    const w = toWindow(take(r, 'nv.a.guidance').state, rng, 'shoot.attackRolled')
    const two = take(w.state, 'nv.a.intervention').state
    expect(two.attack!.seq!.choices['nv.mf.A']).toBe('3')
    // the Militant shot at: the act is spent but never refunded
    const rb = dice(4, 4, 1, 1, 1, 1, 1)
    const shot = take(aim(s, boy, mil, 'kom.w.slugga', 6, 'B'), mil, rb).state
    const dw = toWindow(shot, rb, 'shoot.defenceRolled').state
    const spent = take(dw, 'nv.a.intervention').state
    expect(spent.attack!.seq!.choices['nv.mf.A']).toBeUndefined()
  })

  it('TEAM-NV-013 Inspirational Example: the Superior incapacitating an enemy gains 1 Faith (2 against a Wounds stat of 12 or more); other Novitiates gain nothing', () => {
    const s = open()
    const sup = A(s, 'superior')
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    const nob = B(s, 'boss-nob')
    const kill = (who: string, target: string, weapon: string) => {
      const t = edit(engaged(s, who, target), (st) => {
        st.operatives[target]!.wounds = 2
      })
      return faith(withCtx(t, (ctx) => inflict(ctx, { targetId: target, attackerId: who, weaponId: weapon, amount: 5, source: 'strike-normal' })).state)
    }
    const before = faith(s)
    expect(kill(sup, boy, 'nv.w.power-weapon')).toBe(before + 1)
    // the Boss Nob has 14 Wounds
    expect(kill(sup, nob, 'nv.w.power-weapon')).toBe(before + 2)
    expect(kill(mil, boy, 'nv.w.novitiate-blade')).toBe(before)
    // wounded but alive: nothing
    const alive = edit(engaged(s, sup, boy), (st) => {
      st.operatives[boy]!.wounds = 10
    })
    expect(faith(withCtx(alive, (ctx) => inflict(ctx, { targetId: boy, attackerId: sup, weaponId: 'nv.w.power-weapon', amount: 5, source: 'strike-normal' })).state)).toBe(before)
  })

  it('TEAM-NV-014 Unflinching Example: the Preceptor gains Faith for a ready enemy within its control range, not an expended or distant one', () => {
    const s = open()
    const pre = A(s, 'preceptor')
    const boy = B(s, 'boy')
    const kill = (gap: number, ready: boolean) => {
      const t = edit(engaged(s, pre, boy, gap), (st) => {
        st.operatives[boy]!.wounds = 2
        st.operatives[boy]!.ready = ready
      })
      return faith(withCtx(t, (ctx) => inflict(ctx, { targetId: boy, attackerId: pre, weaponId: 'nv.w.mace-of-the-righteous', amount: 5, source: 'strike-normal' })).state)
    }
    const before = faith(s)
    expect(kill(1.4, true)).toBe(before + 1)
    expect(kill(1.4, false)).toBe(before)
    expect(kill(3, true)).toBe(before)
  })

  it('TEAM-NV-015 Null Rod: within 6" nobody uses PSYCHIC actions, ranged weapons or rules, nobody can be picked by a PSYCHIC action, a PSYCHIC ranged weapon never hurts the Condemnor; an incapacitated Condemnor has no effect', () => {
    const s = open({ teams: ['novitiates', 'legionaries'], rosterB: lgPsyker() })
    const rod = A(s, 'condemnor')
    const acolyte = opOf(s, 'B', 'lg.balefire-acolyte')
    const engage = edit(s, (st) => {
      for (const o of Object.values(st.operatives)) o.order = 'engage'
    })
    const near = place(place(engage, rod, 0, 0), acolyte, 6.5, 0)
    const far = place(place(engage, rod, 0, 0), acolyte, 7.5, 0)
    const op = (st: GameState, id: string) => st.operatives[id]!
    expect(psychicAllowed(near, op(near, acolyte))).toBe(false)
    expect(psychicSelectable(near, op(near, acolyte))).toBe(false)
    // the Condemnor itself cannot be picked either
    expect(psychicSelectable(near, op(near, rod))).toBe(false)
    expect(psychicAllowed(far, op(far, acolyte))).toBe(true)
    expect(psychicSelectable(far, op(far, acolyte))).toBe(true)
    // friend and foe alike: a Novitiate beside the Condemnor is unpickable too
    const mil = A(s, 'militant')
    const beside = place(place(far, rod, 0, 0), mil, 2, 0)
    expect(psychicSelectable(beside, op(beside, mil))).toBe(false)
    // ranged PSYCHIC weapons are switched off in range; the bolt pistol is not
    const usable = (st: GameState) => shootableWeapons(st, op(st, acolyte), []).map((w) => w.weaponId)
    expect(usable(near)).toContain('lg.w.bolt-pistol')
    expect(usable(near)).not.toContain('lg.w.fireblast')
    expect(usable(near)).not.toContain('lg.w.life-siphon')
    expect(usable(far)).toContain('lg.w.fireblast')
    // a PSYCHIC ranged weapon from beyond 6" deals nothing to the Condemnor, of any kind; a bolt pistol does
    const hit = (st: GameState, weaponId: string, source: string) => {
      const r = withCtx(st, (ctx) => inflict(ctx, { targetId: rod, attackerId: acolyte, weaponId, amount: 4, source }))
      return st.operatives[rod]!.wounds - r.state.operatives[rod]!.wounds
    }
    expect(hit(far, 'lg.w.fireblast', 'crit')).toBe(0)
    expect(hit(far, 'lg.w.fireblast', 'devastating')).toBe(0)
    expect(hit(far, 'lg.w.bolt-pistol', 'normal')).toBe(4)
    // once the Condemnor is incapacitated nothing applies
    const dead = edit(near, (st) => {
      st.operatives[rod]!.wounds = 0
    })
    expect(psychicAllowed(dead, op(dead, acolyte))).toBe(true)
    expect(psychicSelectable(dead, op(dead, acolyte))).toBe(true)
  })

  it('TEAM-NV-016 Null Rod and Siphon Life: a Fell dagger fight within 6" of the Condemnor has no Siphon Life pick (its rules are gone); away from it the pick is offered', () => {
    const s0 = open({ teams: ['novitiates', 'legionaries'], rosterB: lgPsyker() })
    const rod = A(s0, 'condemnor')
    const mil = A(s0, 'militant')
    const acolyte = opOf(s0, 'B', 'lg.balefire-acolyte')
    const fight = (rodAt: number) => {
      const t = brawl(place(s0, rod, rodAt, 4), acolyte, mil, dice(6, 6, 6, 1, 1, 1), 'B')
      const armed = t.pending?.kind === 'fight.weapon' ? take(t, 'lg.w.fell-dagger').state : t
      expect(armed.attack!.fight!.weaponA).toBe('lg.w.fell-dagger')
      return walk(armed, dice(), {}, DONE, (st) => st.pending?.kind === 'ploy.firefight' && st.pending.window === 'fight.rolled' && st.pending.seat === 'B')
    }
    const siphon = (w: Walked) => w.seen.concat(w.state.pending ? [{ kind: w.state.pending.kind, window: w.state.pending.window, seat: w.state.pending.seat, options: (w.state.pending.options ?? []).map((o) => o.id) }] : []).some((x) => x.seat === 'B' && x.options.some((o) => o.startsWith('lg.a.wr-siphon-life')))
    // the Condemnor 4" from the fight: the dagger has no weapon rules, so no Siphon Life
    const near = fight(0)
    expect(effectiveRules(near.state, near.state.operatives[acolyte]!, near.state.data.weapons['lg.w.fell-dagger']!, 'fight', mil)).toEqual([])
    expect(siphon(near)).toBe(false)
    // far away: the dagger keeps Siphon Life and the pick is offered at the start of the Resolve Attack Dice step
    const far = fight(-14)
    expect(far.state.pending).toMatchObject({ kind: 'ploy.firefight', window: 'fight.rolled', seat: 'B' })
    expect(siphon(far)).toBe(true)
  })

  it('TEAM-NV-016 Null Rod: a PSYCHIC melee weapon near the Condemnor has no weapon rules and never exceeds Dmg 3/4, even after another team\'s bonus', () => {
    const s0 = open({ teams: ['novitiates', 'legionaries'], rosterB: lgPsyker() })
    const rod = A(s0, 'condemnor')
    const acolyte = opOf(s0, 'B', 'lg.balefire-acolyte')
    const s = withWeapons(s0, melee('test.psychic-axe', { dmg: { normal: 5, crit: 6 } }, [{ rule: 'psychic' }, { rule: 'lethal', target: 5 }, { rule: 'rending' }]))
    const near = place(place(s, rod, 0, 0), acolyte, 4, 0)
    const far = place(place(s, rod, 0, 0), acolyte, 9, 0)
    const rulesOf = (st: GameState) => effectiveRules(st, st.operatives[acolyte]!, st.data.weapons['test.psychic-axe']!, 'fight', rod).map((r) => r.rule)
    expect(rulesOf(near)).toEqual([])
    expect(rulesOf(far)).toEqual(['psychic', 'lethal', 'rending'])
    expect(weaponDamage(near, acolyte, 'test.psychic-axe', rod, 'fight')).toEqual({ normal: 3, crit: 4 })
    expect(weaponDamage(far, acolyte, 'test.psychic-axe', rod, 'fight')).toEqual({ normal: 5, crit: 6 })
    // another team registered after the Novitiates: its added rule, its Dmg bonus and its damage bonus are all held
    // back near the Condemnor, whatever the handler order (the bonus applies normally away from it)
    registerHook('modifyWeaponRules', (c) => {
      const d = c.data as { rules: { rule: string }[] }
      if (c.weaponId === 'test.psychic-axe') d.rules.push({ rule: 'ceaseless' })
      return null
    }, 'test.nv.rule')
    registerHook('modifyDamage', (c) => {
      const d = c.data as { dmg: { normal: number; crit: number } }
      if (c.weaponId === 'test.psychic-axe') {
        d.dmg.normal += 2
        d.dmg.crit += 2
      }
      return null
    }, 'test.nv.bonus')
    registerHook('onDamageInflicted', (c) => {
      const d = c.data as { amount: number; weaponId: string | null }
      if (d.weaponId === 'test.psychic-axe') d.amount += 2
      return null
    }, 'test.nv.extra')
    try {
      expect(rulesOf(near)).toEqual([])
      expect(rulesOf(far)).toEqual(['psychic', 'lethal', 'rending', 'ceaseless'])
      expect(weaponDamage(near, acolyte, 'test.psychic-axe', rod, 'fight')).toEqual({ normal: 3, crit: 4 })
      expect(weaponDamage(far, acolyte, 'test.psychic-axe', rod, 'fight')).toEqual({ normal: 7, crit: 8 })
      const dealt = (st: GameState, src: string, amount: number) => {
        const before = st.operatives[rod]!.wounds
        return before - withCtx(st, (ctx) => inflict(ctx, { targetId: rod, attackerId: acolyte, weaponId: 'test.psychic-axe', amount, source: src })).state.operatives[rod]!.wounds
      }
      expect(dealt(near, 'strike-normal', 3)).toBe(3)
      expect(dealt(near, 'strike-crit', 4)).toBe(4)
      expect(dealt(far, 'strike-normal', 3)).toBe(5)
    } finally {
      unregisterHook('modifyWeaponRules', 'test.nv.rule')
      unregisterHook('modifyDamage', 'test.nv.bonus')
      unregisterHook('onDamageInflicted', 'test.nv.extra')
    }
    // the weapon is still PSYCHIC: it is the same record, only its rules are gone
    expect(isPsychicWeapon(near, 'test.psychic-axe')).toBe(true)
  })

  it('TEAM-NV-017 Anti-PSYKER: +1/+1 Dmg and Lethal 5+ against a PSYKER only; Devastating stays 2', () => {
    const s = open({ teams: ['novitiates', 'legionaries'], rosterB: lgPsyker() })
    const rod = A(s, 'condemnor')
    const acolyte = opOf(s, 'B', 'lg.balefire-acolyte')
    const warrior = opOf(s, 'B', 'lg.warrior')
    const t = place(place(place(s, rod, 0, 0), acolyte, 5, 0), warrior, 5, 3)
    for (const [weapon, kind, base] of [
      ['nv.w.condemnor-stakethrower', 'shoot', 3],
      ['nv.w.null-rod', 'fight', 3],
    ] as const) {
      expect(weaponDamage(t, rod, weapon, acolyte, kind), weapon).toEqual({ normal: base + 1, crit: base + 1 })
      expect(weaponDamage(t, rod, weapon, warrior, kind), weapon).toEqual({ normal: base, crit: base })
      const rules = (target: string) => effectiveRules(t, t.operatives[rod]!, t.data.weapons[weapon]!, kind, target)
      expect(rules(acolyte)).toContainEqual({ rule: 'lethal', target: 5 })
      expect(rules(warrior).some((r) => r.rule === 'lethal')).toBe(false)
    }
    expect(effectiveRules(t, t.operatives[rod]!, t.data.weapons['nv.w.condemnor-stakethrower']!, 'shoot', acolyte)).toContainEqual({ rule: 'devastating', x: 2 })
    // a Kommandos is no PSYKER
    const k = open()
    const boy = B(k, 'boy')
    expect(weaponDamage(k, A(k, 'condemnor'), 'nv.w.condemnor-stakethrower', boy, 'shoot')).toEqual({ normal: 3, crit: 3 })
  })

  it('TEAM-NV-018 Stirring Rhetoric and Auto-broadcaster: +1 APL (3 at most) for a Novitiate near the Dialogus or the marker; the 0 AP marker is placed or moved within 8" and bans enemy attack dice re-rolls within 3"', () => {
    const s = open()
    const dia = A(s, 'dialogus')
    const mil = A(s, 'militant')
    const rel = A(s, 'reliquarius')
    const sup = A(s, 'superior')
    const targets = (st: GameState) => abilityOffers(st, st.operatives[dia]!, null).filter((o) => o.abilityId === 'nv.a.stirring-rhetoric').map((o) => o.params.targetId)
    const lay = place(place(place(place(s, dia, 0, 0), mil, 5, 0), rel, 7.5, 0), sup, 3, 3)
    // visible and within 6": the Militant; the Reliquarius is 6.4" off; the Superior already has APL 3
    expect(targets(lay)).toEqual([mil])
    const marker = { id: 'nvm1', kind: 'equipment', pos: { x: 9, z: 0 }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'nv.auto-broadcaster', placedBy: dia }
    const withMarker = edit(lay, (st) => {
      st.markers.push(marker as never)
    })
    // the marker's 6" needs no visibility
    expect(targets(withMarker).sort()).toEqual([mil, rel].sort())
    const done = take(activateOp(lay, dia), `ability:nv.a.stirring-rhetoric:${mil}`).state
    expect(effectiveApl(done.operatives[mil]!)).toBe(3)
    expect(done.operatives[mil]!.aplFx).toEqual([{ delta: 1, source: 'nv.a.stirring-rhetoric' }])
    expect(done.firefight.activation!.apSpent).toBe(1)
    // not offered to one already at the cap
    expect(targets(done)).toEqual([])

    // the marker: 0 AP, a spot within 8" of the Dialogus
    const start = place(s, dia, 0, 0)
    const a = take(activateOp(start, dia), 'ability:nv.a.auto-broadcaster').state
    expect(a.pending!.kind).toBe('ability.choice')
    const spots = a.pending!.options!.map((o) => o.id.split(',').map(Number) as [number, number])
    expect(spots.length).toBeGreaterThan(5)
    for (const [x, z] of spots) expect(Math.hypot(x, z) - start.operatives[dia]!.baseRadius).toBeLessThanOrEqual(8.001)
    const placed = take(a, a.pending!.options!.find((o) => o.id === '4,0' || true)!.id).state
    expect(placed.markers.filter((m) => m.equipmentId === 'nv.auto-broadcaster')).toHaveLength(1)
    expect(placed.firefight.activation!.apSpent).toBe(0)
    // once per activation (R-3.7) ...
    expect(optionIds(placed).some((o) => o.startsWith('ability:nv.a.auto-broadcaster'))).toBe(false)
    // ... in a later activation it moves the same marker, up to 8" from where it stands
    const m1 = placed.markers.find((m) => m.equipmentId === 'nv.auto-broadcaster')!
    const later = edit(start, (st) => {
      st.markers.push({ ...m1 })
    })
    const again = take(activateOp(later, dia), 'ability:nv.a.auto-broadcaster').state
    for (const o of again.pending!.options!) {
      const [x, z] = o.id.split(',').map(Number) as [number, number]
      expect(Math.hypot(x - m1.pos.x, z - m1.pos.z)).toBeLessThanOrEqual(8.001)
    }
    const moved = take(again, again.pending!.options![0]!.id).state
    expect(moved.markers.filter((m) => m.equipmentId === 'nv.auto-broadcaster')).toHaveLength(1)
    expect(moved.markers.find((m) => m.equipmentId === 'nv.auto-broadcaster')!.pos).not.toEqual(m1.pos)
    // not while in an enemy control range
    const boy = B(s, 'boy')
    expect(optionIds(activateOp(place(place(s, dia, 0, 0), boy, 1.4, 0), dia)).some((o) => o.startsWith('ability:nv.a.auto-broadcaster'))).toBe(false)
    // it goes when the Dialogus does
    const gone = withCtx(placed, (ctx) => {
      directDamage(ctx, dia, 99, boy, 'test')
    }).state
    expect(gone.markers.some((m) => m.equipmentId === 'nv.auto-broadcaster')).toBe(false)

    // the ban: enemy attack dice within 3" of the marker cannot be re-rolled (Command Re-roll included); defence dice can
    const mirror = open({ teams: ['novitiates', 'novitiates'], rosterB: nvRoster() })
    const shooter = A(mirror, 'militant')
    const target = opOf(mirror, 'B', 'nv.condemnor')
    const bMarker = (x: number) => ({ id: 'nvm2', kind: 'equipment', pos: { x, z: 0 }, owner: 'B', carriedBy: null, controller: null, equipmentId: 'nv.auto-broadcaster', placedBy: opOf(mirror, 'B', 'nv.dialogus') })
    const shootWith = (x: number) => {
      const t = edit(withFaith(mirror, 5), (st) => {
        st.markers.push(bMarker(x) as never)
      })
      const rng = dice(1, 1, 1, 1)
      const r = take(aim(t, shooter, target, 'nv.w.autogun'), target, rng).state
      return walk(r, rng, {})
    }
    const banned = shootWith(1)
    expect(banned.seen.filter((x) => x.seat === 'A').map((x) => x.kind)).not.toContain('dice.commandReroll')
    // Guidance is a re-roll, so it is not offered; Intervention is not and still is
    expect(nvWindows(banned)).toEqual(['shoot.attackRolled:nv.a.intervention'])
    const free = shootWith(30)
    expect(free.seen.filter((x) => x.seat === 'A').map((x) => x.kind)).toContain('dice.commandReroll')
    expect(nvWindows(free)).toContain('shoot.beforeAttackRerolls:nv.a.guidance')
    const attackSide = { operativeId: shooter } as never
    const defenceSide = { operativeId: target } as never
    const ctxState = edit(mirror, (st) => {
      st.markers.push(bMarker(1) as never)
      st.operatives[target]!.pos = { x: 1, y: 0, z: 0 }
      st.operatives[shooter]!.pos = { x: 0, y: 0, z: 0 }
    })
    const attack = { kind: 'shoot', operativeId: shooter } as never
    expect(providerRerollsBanned(ctxState, attackSide, attack)).toBe(true)
    expect(providerRerollsBanned(ctxState, defenceSide, attack)).toBe(false)
  })

  it("TEAM-NV-019 TEAM-NV-022 Riposte: a crit block also deals the Critical Dmg and ends the fight if it incapacitates; Zealous Rage: Ceaseless when the Penitent fights, never when it retaliates", () => {
    const s = open()
    const duel = A(s, 'duellist')
    const boy = B(s, 'boy')
    const bigBoy = edit(s, (st) => {
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
    })
    const fight = (st: GameState, boyDice: number[], duelDice: number[]) => {
      const rng = dice(...boyDice, ...duelDice)
      const f = brawl(st, boy, duel, rng, 'B')
      return walk(f, rng, attackerStrikesDefenderBlocks)
    }
    // the Duellist blocks with a crit: 5 Riposte damage, then its other crit strikes for 5 more
    const crit = fight(bigBoy, [4, 4, 1, 1], [6, 6, 1, 1])
    expect(crit.events.some((e) => e.type === 'AbilityUsed' && e.abilityId === 'nv.a.wr-riposte')).toBe(true)
    expect(crit.state.operatives[boy]!.wounds).toBe(30)
    expect(crit.state.operatives[duel]!.wounds).toBe(3)
    // blocking with a normal does nothing extra: the Boy takes only the one strike left
    const normal = fight(bigBoy, [4, 4, 1, 1], [4, 4, 1, 1])
    expect(normal.events.some((e) => e.type === 'AbilityUsed' && e.abilityId === 'nv.a.wr-riposte')).toBe(false)
    expect(normal.state.operatives[boy]!.wounds).toBe(36)
    // Riposte can incapacitate: the fight ends there, the Duellist's second crit never strikes
    const dying = edit(bigBoy, (st) => {
      st.operatives[boy]!.wounds = 5
    })
    const end = fight(dying, [4, 4, 1, 1], [6, 6, 1, 1])
    expect(end.state.operatives[boy]!.status).toBe('removed')
    expect(end.events.filter((e) => e.type === 'Struck')).toHaveLength(1)
    expect(end.events.some((e) => e.type === 'FightEnded')).toBe(true)

    // Zealous Rage
    const pen = A(s, 'penitent')
    const fighting = engaged(s, pen, boy)
    const rules = (st: GameState) => effectiveRules(st, st.operatives[pen]!, st.data.weapons['nv.w.penitent-eviscerator']!, 'fight', boy).map((r) => r.rule)
    expect(rules(fighting)).toContain('ceaseless')
    const retaliating = edit(fighting, (st) => {
      st.attack = { kind: 'fight', operativeId: boy } as never
    })
    expect(rules(retaliating)).not.toContain('ceaseless')
    // in a real fight: the Penitent attacking is offered the Ceaseless re-roll, the Penitent retaliating is not
    const rng = dice(1, 1, 1, 1, 1, 1, 1, 1)
    const attacking = walk(take(passPloys(take(activateOp(fighting, pen), 'fight').state), boy, rng).state, rng, {}, DONE)
    expect(attacking.seen.some((x) => x.kind === 'dice.reroll' && x.seat === 'A' && x.options.some((o) => o.startsWith('ceaseless')))).toBe(true)
    const rng2 = dice(1, 1, 1, 1, 1, 1, 1, 1)
    const defending = walk(brawl(s, boy, pen, rng2, 'B'), rng2, {}, DONE)
    expect(defending.seen.some((x) => x.kind === 'dice.reroll' && x.seat === 'A' && x.options.some((o) => o.startsWith('ceaseless')))).toBe(false)
  })

  it('TEAM-NV-020 Whip Into Frenzy: +1 APL, +1" Move and two Fights for a friendly Novitiate (not the Superior) in its next activation, the first Fight free; no stacking; it ends with that activation', () => {
    const s = open()
    const exa = A(s, 'exactor')
    const mil = A(s, 'militant')
    const sup = A(s, 'superior')
    const boy = B(s, 'boy')
    const lay = place(place(place(place(s, exa, 0, 0), mil, 2, 0), sup, 2, 2), boy, 3.4, 0)
    const targets = (st: GameState) => abilityOffers(st, st.operatives[exa]!, null).filter((o) => o.abilityId === 'nv.a.whip-into-frenzy').map((o) => o.params.targetId)
    // never the Superior; the Militant is 2" off and visible
    expect(targets(lay)).toContain(mil)
    expect(targets(lay)).not.toContain(sup)
    const whipped = take(activateOp(lay, exa), `ability:nv.a.whip-into-frenzy:${mil}`).state
    expect(hasToken(whipped, mil, 'nv.whip')).toBe(true)
    expect(effectiveApl(whipped.operatives[mil]!)).toBe(3)
    expect(effectiveMove(whipped.operatives[mil]!, whipped)).toBe(7)
    expect(targets(whipped)).not.toContain(mil)
    // the Militant's next activation: the first Fight is free, there is a second, never a third
    const next = take(activateOp(take(whipped, 'end').state, boy), 'end').state
    const t = activateOp(next, mil)
    const op = t.operatives[mil]!
    expect(actionCost(t, op, 'fight', t.firefight.activation)).toBe(0)
    const rng = dice()
    const fight = (st: GameState) => walk(take(passPloys(take(st, 'fight').state), boy, rng).state, rng, {}, DONE).state
    const f1 = fight(t)
    expect(f1.firefight.activation!.apSpent).toBe(0)
    expect(optionIds(f1)).toContain('fight')
    expect(actionCost(f1, f1.operatives[mil]!, 'fight', f1.firefight.activation)).toBe(1)
    const f2 = fight(f1)
    expect(f2.firefight.activation!.apSpent).toBe(1)
    expect(optionIds(f2)).not.toContain('fight')
    // it ends with the activation
    const over = take(f2, 'end').state
    expect(hasToken(over, mil, 'nv.whip')).toBe(false)
    expect(effectiveApl(over.operatives[mil]!)).toBe(2)
    expect(effectiveMove(over.operatives[mil]!, over)).toBe(6)
    // not while in an enemy control range
    const hemmed = place(lay, boy, 1.4, 0)
    expect(optionIds(activateOp(hemmed, exa)).some((o) => o.startsWith('ability:nv.a.whip-into-frenzy'))).toBe(false)
  })

  it('TEAM-NV-021 Absolution Through Destruction: a free Fight after each Fight, never after the free one; under Whip Into Frenzy four Fights; it can be declined', () => {
    const s = open()
    const pen = A(s, 'penitent')
    const exa = A(s, 'exactor')
    const nob = B(s, 'boss-nob')
    const boy = B(s, 'boy')
    const absolve = { 'ploy.firefight': opt('nv.a.absolution-through-destruction') }
    const fights = (w: Walked) => w.events.filter((e) => e.type === 'FightEnded').length
    const lay = place(place(s, pen, 0, 0), nob, 1.4, 0)
    const rng = dice()
    const first = walk(take(passPloys(take(activateOp(lay, pen), 'fight').state), nob, rng).state, rng, absolve, DONE)
    expect(fights(first)).toBe(2)
    expect(nvWindows(first)).toContain('firefight.actionEnded:nv.a.absolution-through-destruction')
    // the free Fight cost nothing and did not trigger another; the Penitent has nothing left to do
    expect(first.events.filter((e) => e.type === 'ApSpent').reduce((n, e) => n + (e as unknown as { amount: number }).amount, 0)).toBe(1)
    expect(first.state.operatives[pen]!.ready).toBe(false)
    // declined: one Fight
    const rng2 = dice()
    const declined = walk(take(passPloys(take(activateOp(lay, pen), 'fight').state), nob, rng2).state, rng2, {}, DONE)
    expect(fights(declined)).toBe(1)
    // under Whip Into Frenzy: Fight (free), Absolution, Fight (1 AP), Absolution
    const whipLay = place(place(place(s, exa, 0, 3), pen, 0, 0), nob, 1.4, 0)
    const whipped = take(activateOp(whipLay, exa), `ability:nv.a.whip-into-frenzy:${pen}`).state
    const next = take(activateOp(take(whipped, 'end').state, boy), 'end').state
    const rng3 = dice()
    let st = activateOp(next, pen)
    const all: Walked[] = []
    for (let i = 0; i < 2; i++) {
      const w = walk(take(passPloys(take(st, 'fight').state), nob, rng3).state, rng3, absolve, DONE)
      all.push(w)
      st = w.state
    }
    expect(all.reduce((n, w) => n + fights(w), 0)).toBe(4)
    // the first Fight was free, the second cost 1 AP, both free follow-ups cost nothing
    const spent = all.flatMap((w) => w.events).filter((e) => e.type === 'ApSpent').reduce((n, e) => n + (e as unknown as { amount: number }).amount, 0)
    expect(spent).toBe(1)
    // a third Fight is not allowed
    expect(optionIds(st)).not.toContain('fight')
  })

  it("TEAM-NV-023 Medic! and Chirurgeon's Tools: a Novitiate within 3\" survives on 1 wound once per turning point, both lose 1 APL and the casualty takes a free Dash; 2D3 healing (itself included) but not the saved one", () => {
    const m = medicSave()
    const hos = A(m, 'hospitaller')
    const duel = A(m, 'duellist')
    const boy = B(m, 'boy')
    expect(m.operatives[duel]!.wounds).toBe(1)
    expect(m.operatives[duel]!.status).toBe('active')
    expect(m.operatives[duel]!.aplMods).toBe(-1)
    expect(m.operatives[hos]!.aplMods).toBe(-1)
    expect(m.ledger.A.tp).toContain(`nv.medic:${hos}`)
    // nothing more can take it down for the rest of that action
    const again = withCtx(m, (ctx) => inflict(ctx, { targetId: duel, attackerId: boy, weaponId: 'kom.w.slugga', amount: 5, source: 'normal' })).state
    expect(again.operatives[duel]!.wounds).toBe(1)
    // the action over, a second casualty in the same turning point is not saved (once per turning point)
    const later = edit(m, (st) => {
      st.effects = st.effects.filter((e) => e.kind !== 'nv.medicFloor')
    })
    const dead = withCtx(later, (ctx) => inflict(ctx, { targetId: duel, attackerId: boy, weaponId: 'kom.w.slugga', amount: 5, source: 'normal' })).state
    expect(dead.operatives[duel]!.wounds).toBe(0)
    // the free Dash: a reaction while the other player is active, a 0 CP offer in the owner's action-ended window
    const reactions = providerReactions(m, 'A', { actorId: boy, action: 'shoot', activeSeat: 'B', moved: false })
    expect(reactions.map((r) => [r.hook, r.operativeId, r.option])).toEqual([['nvMedic', duel, 'dash']])
    const own = edit(m, (st) => {
      st.firefight.activation = { operativeId: A(m, 'militant'), seat: 'A', counteract: false, stage: 'action', apSpent: 1, performed: ['shoot'], declared: null }
    })
    const info = { window: 'firefight.actionEnded', subjectId: A(m, 'militant'), counteracting: false, action: 'shoot' }
    expect(offersFor(own, 'A', 'firefight.actionEnded', info).map((o) => o.id)).toContain(`nv.medicDash@${duel}`)
    const dash = withCtx(m, (ctx) => getCodeHook('nvMedic')!.choice!(ctx, m.operatives[duel]!, 'dash', {})).state
    expect(dash.pending!.kind).toBe('move.path')
    expect(dash.pending!.constraints!.mustEndInControlRangeOfId).toBe(hos)
    // not while the Hospitaller is in an enemy control range
    const hemmed = edit(medicSave(), () => undefined)
    const s = open()
    const blocked = edit(place(place(place(s, A(s, 'hospitaller'), 0, 0), A(s, 'duellist'), 2, 0), B(s, 'boy'), -1.4, 0), (st) => {
      st.operatives[A(s, 'duellist')]!.wounds = 2
    })
    const lost = withCtx(blocked, (ctx) => inflict(ctx, { targetId: A(s, 'duellist'), attackerId: B(s, 'boy'), weaponId: 'kom.w.slugga', amount: 5, source: 'normal' })).state
    expect(lost.operatives[A(s, 'duellist')]!.wounds).toBe(0)
    void hemmed

    // Chirurgeon's Tools
    const t = edit(place(place(place(s, A(s, 'hospitaller'), 0, 0), A(s, 'militant'), 1.5, 0), A(s, 'penitent'), 5, 0), (st) => {
      st.operatives[A(s, 'militant')]!.wounds = 2
      st.operatives[A(s, 'penitent')]!.wounds = 2
      st.operatives[A(s, 'hospitaller')]!.wounds = 5
    })
    const offered = (st: GameState) => abilityOffers(st, st.operatives[A(s, 'hospitaller')]!, null).filter((o) => o.abilityId === 'nv.a.chirurgeons-tools').map((o) => o.params.targetId)
    // in its control range (and itself), wounded only; the Penitent 5" away is out
    expect(offered(t).sort()).toEqual([A(s, 'hospitaller'), A(s, 'militant')].sort())
    const healed = take(activateOp(t, A(s, 'hospitaller')), `ability:nv.a.chirurgeons-tools:${A(s, 'militant')}`, dice(4, 5)).state
    // ceil(4/2) + ceil(5/2) = 5, capped at the 7 starting wounds
    expect(healed.operatives[A(s, 'militant')]!.wounds).toBe(7)
    const self = take(activateOp(t, A(s, 'hospitaller')), `ability:nv.a.chirurgeons-tools:${A(s, 'hospitaller')}`, dice(2, 2)).state
    expect(self.operatives[A(s, 'hospitaller')]!.wounds).toBe(7)
    // the operative Medic! saved this turning point cannot be picked
    const saved = edit(t, (st) => {
      st.ledger.A.tp.push(`nv.medic.saved:${A(s, 'militant')}`)
    })
    expect(offered(saved)).toEqual([A(s, 'hospitaller')])
  })

  it('TEAM-NV-024 Glorious Hymnal: Novitiates within 3" of the Preceptor (itself included) have Severe; one at 4" does not', () => {
    const s = open()
    const pre = A(s, 'preceptor')
    const dia = A(s, 'dialogus')
    const boy = B(s, 'boy')
    const rules = (st: GameState, who: string, weapon: string) => effectiveRules(st, st.operatives[who]!, st.data.weapons[weapon]!, 'fight', boy).map((r) => r.rule)
    const near = place(place(place(s, pre, 0, 0), dia, 3.4, 0), boy, 20, 0)
    const far = place(near, dia, 4.4, 0)
    expect(rules(near, dia, 'nv.w.dialogus-stave')).toContain('severe')
    expect(rules(far, dia, 'nv.w.dialogus-stave')).not.toContain('severe')
    // the Preceptor's own mace has Severe anyway; the rule never doubles it
    expect(rules(near, pre, 'nv.w.mace-of-the-righteous').filter((r) => r === 'severe')).toHaveLength(1)
    // an incapacitated Preceptor gives nothing
    const gone = edit(near, (st) => {
      st.operatives[pre]!.wounds = 0
    })
    expect(rules(gone, dia, 'nv.w.dialogus-stave')).not.toContain('severe')
    // the enemy gains nothing from it
    expect(effectiveRules(near, near.operatives[boy]!, near.data.weapons['kom.w.choppa']!, 'fight', dia).map((r) => r.rule)).not.toContain('severe')
    // Comms Device (M-5.1): +3" only while the Preceptor itself controls the team's device, not another friendly
    const comms = (st: GameState, at: string) =>
      edit(st, (e) => {
        const p = e.operatives[at]!.pos
        e.markers.push({ id: 'nv-test-comms', kind: 'equipment', pos: { x: p.x, z: p.z }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'core.e.comms-device' })
      })
    expect(rules(comms(far, pre), dia, 'nv.w.dialogus-stave')).toContain('severe')
    expect(rules(comms(far, dia), dia, 'nv.w.dialogus-stave')).not.toContain('severe')
  })

  it('TEAM-NV-025 Relic Seeker and Divine Acquisition: the Pronatus\'s mission action costs 1 AP less once per activation, and gains Faith equal to the turning point once per turning point', () => {
    const s = inTp(open(), 2)
    const pro = A(s, 'pronatus')
    const rel = A(s, 'reliquarius')
    const m = s.markers.find((k) => k.kind === 'objective')!
    const at = (id: string) =>
      edit(s, (st) => {
        st.operatives[id]!.pos = { x: m.pos.x + 0.9, y: 0, z: m.pos.z }
      })
    const cost = (st: GameState, id: string) => abilityOffers(st, st.operatives[id]!, st.firefight.activation).find((o) => o.abilityId === 'core.a.secure')?.cost
    const p = activateOp(at(pro), pro)
    expect(cost(p, pro)).toBe(0)
    expect(cost(activateOp(at(rel), rel), rel)).toBe(1)
    const before = faith(s)
    const done = takeLike(p, 'ability:core.a.secure').state
    expect(done.firefight.activation!.apSpent).toBe(0)
    expect(faith(done)).toBe(before + 2)
    // once per turning point
    expect(usedThisTp(done, 'A', 'nv.divine.tp')).toBe(true)
    // another operative's mission action gives no Faith
    const other = takeLike(activateOp(at(rel), rel), 'ability:core.a.secure').state
    expect(faith(other)).toBe(before)
    // turning point 3 pays 3
    const tp3 = inTp(at(pro), 3)
    expect(faith(takeLike(activateOp(tp3, pro), 'ability:core.a.secure').state)).toBe(before + 3)
    // the marker part is live whenever a marker can be picked up: Pick Up Marker costs 0 AP for the Pronatus, once
    // per activation (it shares the once with the mission action)
    const loose = (id: string) =>
      edit(s, (st) => {
        st.markers = st.markers.filter((k) => k.kind !== 'objective')
        st.operatives[id]!.pos = { x: 0, y: 0, z: 0 }
        st.markers.push({ id: 'nv-test-loose', kind: 'equipment', pos: { x: 0.9, z: 0 }, owner: null, carriedBy: null, controller: null, equipmentId: 'test.loose', pickable: true })
      })
    const pick = (st: GameState, id: string) => abilityOffers(st, st.operatives[id]!, st.firefight.activation).find((o) => o.action === 'marker:pickUp')?.cost
    expect(pick(activateOp(loose(pro), pro), pro)).toBe(0)
    expect(pick(activateOp(loose(rel), rel), rel)).toBe(1)
  })

  it('TEAM-NV-026 Icon Bearer and Raise Icon: the Reliquarius counts APL +1 for marker control; Raise Icon gains 1 Faith, plus the turning point number on an objective, once per turning point', () => {
    const s = inTp(open(), 2)
    const rel = A(s, 'reliquarius')
    const mil = A(s, 'militant')
    const m = s.markers.find((k) => k.kind === 'objective')!
    const at = (id: string) =>
      edit(s, (st) => {
        st.operatives[id]!.pos = { x: m.pos.x + 0.9, y: 0, z: m.pos.z }
      })
    expect(markerControl(at(rel), m).apl.A).toBe(3)
    expect(markerControl(at(mil), m).apl.A).toBe(2)
    const before = faith(s)
    // away from every objective: 1 Faith
    const raise = take(activateOp(s, rel), 'ability:nv.a.raise-icon').state
    expect(faith(raise)).toBe(before + 1)
    expect(optionIds(raise)).not.toContain('ability:nv.a.raise-icon')
    // holding an objective in turning point 2: 1 + 2
    const held = take(activateOp(at(rel), rel), 'ability:nv.a.raise-icon').state
    expect(faith(held)).toBe(before + 3)
    // once per turning point, across activations
    const used = edit(s, (st) => {
      st.ledger.A.tp.push(`nv.raise:${rel}`)
    })
    expect(optionIds(activateOp(used, rel)).some((o) => o.startsWith('ability:nv.a.raise-icon'))).toBe(false)
  })

  it('TEAM-NV-027 Blazing Inferno and Purge with Flame: one flamer-crit target gets a Blaze token for 0 CP once per turning point per Purgatus; the token burns D3 at each activation and can be shed for -1 APL', () => {
    const s = open()
    const pur = A(s, 'purgatus')
    const boy = B(s, 'boy')
    const cp = s.players.A.cp
    const b = blazing()
    expect(hasToken(b, boy, 'nv.blaze')).toBe(true)
    expect(b.players.A.cp).toBe(cp)
    expect(usedThisTp(b, 'A', 'nv.p.blazing-inferno')).toBe(true)
    expect(usedThisTp(b, 'A', `nv.purge:${pur}`)).toBe(true)
    // the Boy's activation: D3 damage (a 6 is 3), then the choice to give up 1 APL for the activation to shed the token
    const wounds = b.operatives[boy]!.wounds
    const rng = dice(6)
    const ended = take(b, 'end').state
    const picked = take(take(ended, boy).state, 'engage', rng).state
    expect(picked.operatives[boy]!.wounds).toBe(wounds - 3)
    expect(picked.pending!.window).toBe('firefight.activationStart')
    expect(optionIds(picked)).toContain('nv.a.blaze-token:remove')
    const shed = take(picked, 'nv.a.blaze-token:remove').state
    expect(hasToken(shed, boy, 'nv.blaze')).toBe(false)
    expect(shed.operatives[boy]!.aplMods).toBe(-1)
    // declining keeps the token (and the burn comes again next activation)
    const kept = passIt(picked).state
    expect(hasToken(kept, boy, 'nv.blaze')).toBe(true)
    // without the free use the ploy costs 1 CP, and the token is still only given once
    const paid = edit(s, (st) => {
      st.ledger.A.tp.push(`nv.purge:${pur}`)
    })
    const t = edit(aim(paid, pur, boy, 'nv.w.ministorum-flamer'), (st) => {
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 40
    })
    const rt = dice(6, 6, 1, 1)
    const r = take(t, boy, rt).state
    const w = walk(r, rt, {}, ['ploy.firefight', 'firefight.action'])
    void w
    const atResolved = toWindow(r, rt, 'shoot.resolved')
    const offer = atResolved.state.pending!.options!.find((o) => o.id === `nv.p.blazing-inferno:${boy}`)!
    expect(offer.data).toMatchObject({ cost: 1 })
    const afterPaid = take(atResolved.state, offer.id).state
    expect(afterPaid.players.A.cp).toBe(cp - 1)
    expect(hasToken(afterPaid, boy, 'nv.blaze')).toBe(true)
    // a target that already burns is not offered again, and a ploy used this turning point is gone
    expect(offersFor(afterPaid, 'A', 'shoot.resolved', { window: 'shoot.resolved', attackerId: pur })).toEqual([])
  })

  it('TEAM-NV-028 Ardent Vengeance: Punishing against an expended enemy, not a ready one, and not when the ploy is not in force', () => {
    const s = open()
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    const flag = { id: 'e902', source: 'nv.p.ardent-vengeance', seat: 'A', kind: 'ployFlag', expires: 'turningPoint' }
    const on = edit(place(place(s, mil, 0, 0), boy, 4, 0), (st) => {
      st.effects.push(flag as never)
    })
    const punishing = (st: GameState) => effectiveRules(st, st.operatives[mil]!, st.data.weapons['nv.w.autogun']!, 'shoot', boy).some((r) => r.rule === 'punishing')
    expect(punishing(edit(on, (st) => (st.operatives[boy]!.ready = false)))).toBe(true)
    expect(punishing(edit(on, (st) => (st.operatives[boy]!.ready = true)))).toBe(false)
    expect(punishing(edit(on, (st) => { st.operatives[boy]!.ready = false; st.effects = [] }))).toBe(false)
    // fights too, checked per target
    const fights = (st: GameState) => effectiveRules(st, st.operatives[mil]!, st.data.weapons['nv.w.gun-butt']!, 'fight', boy).some((r) => r.rule === 'punishing')
    expect(fights(edit(on, (st) => (st.operatives[boy]!.ready = false)))).toBe(true)
  })

  it('TEAM-NV-029 Defenders of the Faith: one normal success of a sequence against a Novitiate on an objective is halved (round up, 2 at least); crits never; nothing off the objective', () => {
    const s0 = open()
    const duel = A(s0, 'duellist')
    const boy = B(s0, 'boy')
    const m = s0.markers.find((k) => k.id === 'obj1')!
    const flag = { id: 'e903', source: 'nv.p.defenders-of-the-faith', seat: 'A', kind: 'ployFlag', expires: 'turningPoint' }
    const dir = { x: 1, z: 0 }
    const lay = (onObjective: boolean, defenders: boolean) =>
      edit(s0, (st) => {
        const home = onObjective ? { x: m.pos.x + 0.9, z: m.pos.z } : { x: m.pos.x + 0.9, z: m.pos.z + 5 }
        st.operatives[duel]!.pos = { x: home.x, y: 0, z: home.z }
        st.operatives[duel]!.wounds = st.operatives[duel]!.maxWounds = 20
        st.operatives[boy]!.pos = { x: home.x + dir.x * 6, y: 0, z: home.z + dir.z * 6 }
        if (defenders) st.effects.push(flag as never)
      })
    // the Boy's three normals (Dmg 3 each) against failed saves
    const shoot = (st: GameState, script: number[]) => {
      const placed = edit(st, (e) => {
        e.operatives[boy]!.order = 'engage'
      })
      const rng = dice(...script)
      const aimed = take(passPloys(take(activateOp(bTurn(placed, A(s0, 'reliquarius')), boy), 'shoot').state), 'kom.w.slugga').state
      const r = take(aimed, duel, rng).state
      return 20 - walk(r, rng, {}).state.operatives[duel]!.wounds
    }
    expect(shoot(lay(true, false), [4, 4, 4, 1])).toBe(9)
    expect(shoot(lay(true, true), [4, 4, 4, 1])).toBe(8)
    // a crit (Dmg 4) is never halved
    expect(shoot(lay(true, true), [6, 1, 1, 1])).toBe(4)
    // off the objective: no help
    expect(shoot(lay(false, true), [4, 4, 4, 1])).toBe(9)
    // a single normal of 2 is not touched: nothing below 3 changes
    const one = edit(lay(true, true), (st) => {
      st.effects.push(flag as never)
    })
    expect(shoot(one, [4, 1, 1, 1])).toBe(2)
  })

  it('TEAM-NV-030 Righteous Advance: not in the first turning point; up to a third of the Novitiates (at least one) take a free Dash that must end closer to the closest enemy, objective or enemy drop zone', () => {
    // not in turning point 1
    const first = toGambit()
    expect(first.pending!.options!.map((o) => o.id)).not.toContain('nv.p.righteous-advance')
    const g = edit(toGambit({}, 2), (st) => {
      st.map = { ...st.map, features: [] }
    })
    expect(offersFor(g, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).map((o) => o.ployId)).toContain('nv.p.righteous-advance')
    const t = useGambit(g, 'A', 'nv.p.righteous-advance')
    expect(t.pending!.kind).toBe('ability.choice')
    const runner = A(g, 'duellist')
    expect(t.pending!.options!.map((o) => o.id)).toContain(runner)
    expect(t.pending!.options!.map((o) => o.id)).toContain('done')
    const dash = take(t, runner).state
    expect(dash.pending!.kind).toBe('move.path')
    const from = dash.operatives[runner]!.pos
    const go = (to: { x: number; z: number }) => step(dash, act.path(dash.pending!, [to]))
    // the enemy sits at the other side of the board: a step along the line to the nearest one is closer, the opposite step is not
    const foe = Object.values(dash.operatives).filter((o) => o.seat === 'B').sort((p, q) => Math.hypot(p.pos.x - from.x, p.pos.z - from.z) - Math.hypot(q.pos.x - from.x, q.pos.z - from.z))[0]!
    const len = Math.hypot(foe.pos.x - from.x, foe.pos.z - from.z)
    const unit = { x: (foe.pos.x - from.x) / len, z: (foe.pos.z - from.z) / len }
    // away from the enemy, every objective and the enemy drop zone: refused
    const back = go({ x: from.x - unit.x, z: from.z - unit.z })
    expect(back.rejection).toBeDefined()
    // towards the enemy: allowed, and then the next Dash is offered while there are picks left (12 Novitiates: 4 Dashes)
    const forward = go({ x: from.x + unit.x * 3, z: from.z + unit.z * 3 })
    expect(forward.rejection).toBeUndefined()
    expect(forward.state.operatives[runner]!.pos.x).toBeCloseTo(from.x + unit.x * 3, 1)
    expect(forward.state.pending!.kind).toBe('ability.choice')
    expect(forward.state.pending!.options!.map((o) => o.id)).not.toContain(runner)
    // 3 Novitiates left: one Dash, then the gambit step carries on
    const few = edit(g, (st) => {
      for (const o of Object.values(st.operatives)) if (o.seat === 'A' && !['A1', 'A2', 'A3'].includes(o.id)) o.status = 'removed'
    })
    const one = useGambit(few, 'A', 'nv.p.righteous-advance')
    const p2 = few.operatives['A2']!.pos
    const toFoe = Object.values(few.operatives).filter((o) => o.seat === 'B').sort((p, q) => Math.hypot(p.pos.x - p2.x, p.pos.z - p2.z) - Math.hypot(q.pos.x - p2.x, q.pos.z - p2.z))[0]!
    const l2 = Math.hypot(toFoe.pos.x - p2.x, toFoe.pos.z - p2.z)
    const picked = take(one, 'A2').state
    const after = step(picked, act.path(picked.pending!, [{ x: p2.x + ((toFoe.pos.x - p2.x) / l2) * 3, z: p2.z + ((toFoe.pos.z - p2.z) / l2) * 3 }]))
    expect(after.rejection).toBeUndefined()
    expect(after.state.pending!.kind).toBe('strategy.gambit')
  })

  it('TEAM-NV-031 Glorious Martyrdom: 1 Faith and D3 damage for each visible enemy within 2" of a falling Novitiate; the Superior\'s Inspirational Example ignores it, the Preceptor\'s Unflinching Example counts it; a Medic! save never qualifies', () => {
    const m = martyrdom()
    const duel = A(m, 'duellist')
    const boy = B(m, 'boy')
    expect(m.operatives[duel]!.status).toBe('removed')
    expect(faith(m)).toBe(3)
    expect(m.operatives[boy]!.wounds).toBe(9)
    expect(m.players.A.cp).toBe(2)
    // a dying Superior: the ploy's Faith only, even though its Martyrdom damage finishes the Boy
    const s = withFaith(open(), 2)
    const sup = A(s, 'superior')
    const boy2 = B(s, 'boy')
    const dying = (who: string) =>
      edit(engaged(s, who, boy2), (st) => {
        st.operatives[who]!.wounds = 1
        st.operatives[boy2]!.wounds = 1
      })
    const play1 = (who: string) => {
      const rng = dice(6, 6, 6, 6, 1, 1, 1, 1)
      const f = brawl(dying(who), boy2, who, rng, 'B')
      return walk(f, rng, { ...attackerStrikesDefenderBlocks, 'ploy.firefight': opt('nv.p.glorious-martyrdom') }, DONE)
    }
    const sw = play1(sup)
    expect(sw.state.operatives[boy2]!.status).toBe('removed')
    expect(faith(sw.state)).toBe(3)
    // the Preceptor's rule has no such exclusion: the Boy was ready and in its control range
    const pre = A(s, 'preceptor')
    const pw = play1(pre)
    expect(pw.state.operatives[boy2]!.status).toBe('removed')
    expect(faith(pw.state)).toBe(4)
    // saved by Medic!: no incapacitation, so no window
    const hos = A(s, 'hospitaller')
    const duel2 = A(s, 'duellist')
    const saved = edit(place(s, hos, 8, 0), (st) => {
      st.operatives[duel2]!.wounds = 1
    })
    const rng = dice(6, 6, 1, 1, 1, 1, 1)
    const shot = take(aim(saved, boy2, duel2, 'kom.w.slugga', 6, 'B'), duel2, rng).state
    const sv = walk(shot, rng, {}, DONE)
    expect(sv.seen.some((x) => x.window === 'operative.incapacitated')).toBe(false)
    expect(sv.state.operatives[duel2]!.wounds).toBe(1)
    expect(sv.state.operatives[duel2]!.status).toBe('active')
  })

  it('TEAM-NV-032 Blinding Aura: the shooter must pick another valid target (the Novitiate stays unpickable while more than 2" away for the activation); with none left the Shoot ends as performed', () => {
    const a = aura()
    expect(optionIds(a)).toEqual(['nv.p.blinding-aura'])
    const duel = A(a, 'duellist')
    const mil = A(a, 'militant')
    const boy = B(a, 'boy')
    const cp = a.players.A.cp
    const used = take(a, 'nv.p.blinding-aura').state
    expect(used.players.A.cp).toBe(cp - 1)
    // the Boy (seat B) selects again through the Shoot's own target decision, among the others: the Militant; it
    // cannot pass (the action is no longer cancellable)
    expect(used.pending!.kind).toBe('shoot.target')
    expect(used.pending!.seat).toBe('B')
    expect(optionIds(used)).toEqual([mil])
    expect(step(used, act.pass(used.pending!), dice()).rejection).toBeDefined()
    const rng = dice(1, 1, 1, 1)
    const redirect = step(used, used.pending!.options![0]!.action, rng)
    const w = walk(redirect.state, rng, {}, DONE)
    expect(redirect.events.concat(w.events).find((e) => e.type === 'TargetSelected')).toMatchObject({ targetId: mil })
    expect(w.events.some((e) => e.type === 'AttackDiceRolled' && e.targetId === duel)).toBe(false)
    expect(w.state.firefight.activation!.performed).toContain('shoot')
    // for the rest of the activation the Duellist cannot be picked; the effect ends with the activation
    expect(validTargets(w.state, w.state.operatives[boy]!, 'kom.w.slugga').map((t) => t.id)).not.toContain(duel)
    expect(validTargets(w.state, w.state.operatives[boy]!, 'kom.w.slugga').map((t) => t.id)).toContain(mil)
    const over = take(w.state, 'end').state
    expect(over.effects.some((e) => e.kind === 'nv.aura')).toBe(false)

    // nothing else to shoot: the Shoot ends as performed (AP spent, no dice rolled)
    const s = open()
    const duel2 = A(s, 'duellist')
    const boy2 = B(s, 'boy')
    const alone = place(place(s, boy2, 0, 0), duel2, 6, 0)
    const b = activateOp(bTurn(alone, A(s, 'reliquarius')), boy2)
    const c = take(take(passPloys(take(b, 'shoot').state), 'kom.w.slugga').state, duel2).state
    expect(optionIds(c)).toEqual(['nv.p.blinding-aura'])
    const ended = step(c, c.pending!.options![0]!.action, dice())
    expect(ended.rejection).toBeUndefined()
    const done = walk(ended.state, dice(), {}, DONE)
    expect(done.state.pending!.kind).toBe('firefight.action')
    expect(done.state.firefight.activation!.apSpent).toBe(1)
    expect(done.state.firefight.activation!.performed).toContain('shoot')
    expect(ended.events.concat(done.events).some((e) => e.type === 'AttackDiceRolled')).toBe(false)
    // within 2" the Aura is pointless: not offered
    const close = place(place(s, boy2, 0, 0), duel2, 2.5, 0)
    const c2 = take(take(passPloys(take(activateOp(bTurn(close, A(s, 'reliquarius')), boy2), 'shoot').state), 'kom.w.slugga').state, duel2).state
    expect(optionIds(c2)).not.toContain('nv.p.blinding-aura')

    // the re-selection runs the weapon's own target rules again for the new primary. Torrent: the secondaries are
    // picked afresh, and the barred Novitiate cannot be picked as one either (it would be selected as a valid target)
    const sup = A(s, 'superior')
    const burna = B(s, 'burna-boy')
    const lay = place(place(place(place(s, burna, 0, 0), duel2, 6, 0), A(s, 'militant'), 6, 2.5), sup, 6, 4)
    const tb = take(take(passPloys(take(activateOp(bTurn(lay, A(s, 'reliquarius')), burna), 'shoot').state), 'kom.w.burna-standard').state, duel2).state
    const tc = tb.pending!.kind === 'shoot.target' ? take(tb, 'done').state : tb
    expect(optionIds(tc)).toContain('nv.p.blinding-aura')
    const tu = take(tc, 'nv.p.blinding-aura').state
    expect(tu.pending!.kind).toBe('shoot.target')
    expect(optionIds(tu)).not.toContain(duel2)
    const repicked = take(tu, A(s, 'militant')).state
    expect(repicked.pending!.kind).toBe('shoot.target')
    expect(repicked.pending!.context.secondary).toBe(true)
    expect(optionIds(repicked)).toContain(`add:${sup}`)
    expect(optionIds(repicked)).not.toContain(`add:${duel2}`)
    // Blast: the secondaries are recomputed around the new primary, and the barred Novitiate can be one of them
    // (it is not selected); the old primary's sequence never runs
    const rokkit = B(s, 'rokkit-boy')
    const bl = place(place(place(s, rokkit, 0, 0), duel2, 6, 0), A(s, 'militant'), 6, 1.3)
    const rb = take(take(passPloys(take(activateOp(bTurn(bl, A(s, 'reliquarius')), rokkit), 'shoot').state), 'kom.w.rokkit-launcha-mobile').state, duel2).state
    expect(rb.attack!.targets).toEqual([duel2, A(s, 'militant')])
    const ru = take(rb, 'nv.p.blinding-aura').state
    expect(optionIds(ru)).not.toContain(duel2)
    const rr = take(ru, A(s, 'militant')).state
    expect(rr.attack!.targets).toEqual([A(s, 'militant'), duel2])
  })

  it('TEAM-NV-033 Guided by Faith: the chosen ranged weapon has Seek Light against targets within 6", so a Conceal enemy in Light cover there is a valid target; not beyond 6"', () => {
    const s = open()
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    const cover = feature('nv-cover', part('nv-cover.a', rect(4.2, 4.6, -3, 3), 1, ['light']))
    const lay = (x: number) =>
      edit(place(place(s, mil, 0, 0), boy, x, 0), (st) => {
        st.map = { ...st.map, features: [cover] }
        st.operatives[boy]!.order = 'conceal'
      })
    const targets = (st: GameState) => validTargets(st, st.operatives[mil]!, 'nv.w.autogun').map((t) => t.id)
    // without the ploy the Conceal enemy behind Light cover cannot be picked
    expect(targets(lay(5.2))).not.toContain(boy)
    const declared = take(activateOp(lay(5.2), mil), 'shoot').state
    expect(optionIds(declared)).toEqual(['nv.p.guided-by-faith'])
    const cp = declared.players.A.cp
    const guided = take(declared, 'nv.p.guided-by-faith').state
    expect(guided.players.A.cp).toBe(cp - 1)
    expect(guided.pending!.kind).toBe('shoot.weapon')
    expect(targets(guided)).toContain(boy)
    const picked = take(take(guided, 'nv.w.autogun').state, boy).state
    expect(effectiveRules(picked, picked.operatives[mil]!, picked.data.weapons['nv.w.autogun']!, 'shoot', boy).some((r) => r.rule === 'seek-light')).toBe(true)
    // 8" away: not within 6", no Seek Light, no extra target
    const far = edit(lay(5.2), (st) => {
      st.operatives[boy]!.pos = { x: 8, y: 0, z: 0 }
      st.map = { ...st.map, features: [feature('nv-cover2', part('nv-cover2.a', rect(7, 7.4, -3, 3), 1, ['light']))] }
    })
    const farGuided = take(take(activateOp(far, mil), 'shoot').state, 'nv.p.guided-by-faith').state
    expect(targets(farGuided)).not.toContain(boy)
    expect(effectiveRules(farGuided, farGuided.operatives[mil]!, farGuided.data.weapons['nv.w.autogun']!, 'shoot', boy).some((r) => r.rule === 'seek-light')).toBe(false)
    // the effect ends with the action
    const finished = walk(picked, dice(), {}, DONE).state
    expect(finished.effects.some((e) => e.source === 'nv.p.guided-by-faith')).toBe(false)
  })

  it('TEAM-NV-034 Holy Embrocations: an injured Novitiate keeps its full Move but still suffers the Hit worsening', () => {
    const s = open({ equipmentA: ['nv.e.holy-embrocations'] })
    const mil = A(s, 'militant')
    const boy = B(s, 'boy')
    const hurt = (st: GameState) =>
      edit(st, (e) => {
        e.operatives[mil]!.wounds = 3
      })
    expect(effectiveMove(hurt(s).operatives[mil]!, hurt(s))).toBe(6)
    const plain = open()
    expect(effectiveMove(hurt(plain).operatives[mil]!, hurt(plain))).toBe(4)
    // healthy: unchanged either way
    expect(effectiveMove(s.operatives[mil]!, s)).toBe(6)
    // the Hit is still worse by 1 (4+ becomes 5+)
    expect(attackStats(hurt(s), mil, 'nv.w.autogun', boy, { kind: 'shoot' }).need).toBe(5)
    expect(attackStats(s, mil, 'nv.w.autogun', boy, { kind: 'shoot' }).need).toBe(4)
    // it adds to a Whip Into Frenzy bonus
    const whipped = edit(hurt(s), (st) => {
      st.operatives[mil]!.tokens = [{ kind: 'nv.whip', owner: 'A', count: 1 }]
    })
    expect(effectiveMove(whipped.operatives[mil]!, whipped)).toBe(7)
    // an enemy rule that treats it as injured (Contagion) keeps its own 2": only the injury's change is ignored
    registerTeamRules({ id: 'test.nv.injuredEq', injuredEquivalent: (_st, op) => op.id === mil })
    try {
      expect(effectiveMove(hurt(s).operatives[mil]!, hurt(s))).toBe(4)
      expect(effectiveMove(s.operatives[mil]!, s)).toBe(4)
    } finally {
      unregisterTeamRules('test.nv.injuredEq')
    }
    expect(effectiveMove(hurt(s).operatives[mil]!, hurt(s))).toBe(6)
    // only Novitiates: an injured Boy still loses its 2"
    expect(effectiveMove(edit(s, (st) => (st.operatives[boy]!.wounds = 3)).operatives[boy]!, s)).toBe(4)
    expect(maxRepeats(s, s.operatives[mil]!, 'fight', ['fight'])).toBe(1)
  })
})

