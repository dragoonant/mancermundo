// farstalker-kinband engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-FK-nnn).
// Farstalker Kinband are seat A against the default Kommandos; the map is open ground unless a test says otherwise.
import { describe, expect, it } from 'vitest'
import { abilityOffers, actionForbidden } from '@/engine/abilities'
import { attackStats, effectiveRules, inflict, validTargets } from '@/engine/attack-common'
import { hasKeyword } from '@/engine/conditions'
import { counteractCandidates } from '@/engine/firefight'
import { runHook } from '@/engine/hooks'
import { offersFor } from '@/engine/ploys'
import { ScriptedRng } from '@/engine/rng'
import { shootableWeapons } from '@/engine/shoot'
import { effectiveApl } from '@/engine/state'
import { planMove } from '@/engine/movement'
import { providerCounteractAlternatives, providerMoveSurcharge, providerReactions, providerReadyStepChoices, providerStealthy, providerWeaponForbidden } from '@/engine/team-rules'
import { TEAM_ID, markOf } from '@/engine/teams/farstalker-kinband'
import { hasToken } from '@/engine/tokens'
import { step } from '@/engine'
import type { GameState, PendingDecision } from '@/engine/types'
import { enumerateLoadouts, loadBundle, validateRoster, type DatacardData } from '../../../src/data'
import type { GameEvent } from '@/engine/events'
import { play, ranged, withWeapons } from '../../fixtures/attack'
import { place } from '../../fixtures/helpers'
import { feature, part, rect } from '../../fixtures/maps'
import { activateOp, edit, optionIds, passIt, realBundle, roster, take, withCtx } from '../../fixtures/real'
import { A, B, altState, bTurn, dice, engaged, inWindow, moveBy, open, playUntil, strikes, takePloy, toGambit, toReady, withTerrain } from './farstalker-kinband.hooks'

const data = loadBundle()
const SINGLES = ['fk.bow-hunter', 'fk.cold-blood', 'fk.cut-skin', 'fk.heavy-gunner', 'fk.long-sight', 'fk.pistolier', 'fk.stalker', 'fk.tracker']

/** A state with timed effects added (strategy ploys in force, flags the hooks read). */
function withFx(s: GameState, ...list: { source: string; operativeId?: string; expires?: string; data?: Record<string, unknown> }[]): GameState {
  return edit(s, (st) => {
    list.forEach((e, i) =>
      st.effects.push({ id: `e9${i}`, seat: 'A', kind: 'ployFlag', expires: e.expires ?? 'turningPoint', source: e.source, ...(e.operativeId ? { operativeId: e.operativeId } : {}), ...(e.data ? { data: e.data } : {}) } as never),
    )
  })
}

describe('TEAM-FK Farstalker Kinband', () => {
  it('TEAM-FK-000 TEAM-FK-001 TEAM-FK-002 playable team, 1 + 11 roster with two Hounds at most, printed loadouts, keywords on every card', () => {
    expect(TEAM_ID).toBe('farstalker-kinband')
    const team = data.teams['farstalker-kinband']!
    expect(team.playable).toBe(true)
    const cards = realBundle.datacards
    const ok = { leader: ['fk.kill-broker'], main: [...SINGLES, 'fk.hound', 'fk.hound', 'fk.warrior'] }
    expect(validateRoster(team, ok, cards as never).ok).toBe(true)
    expect(validateRoster(team, { ...ok, main: [...SINGLES, 'fk.hound', 'fk.warrior', 'fk.warrior'] }, cards as never).ok).toBe(true)
    // a third Hound, a second single card and a 13th operative are refused
    expect(validateRoster(team, { ...ok, main: [...SINGLES.slice(0, 7), 'fk.hound', 'fk.hound', 'fk.hound', 'fk.warrior'] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: [...SINGLES.slice(0, 7), 'fk.stalker', 'fk.hound', 'fk.hound', 'fk.warrior'] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: [...ok.main, 'fk.warrior'] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { leader: [], main: ok.main }, cards as never).ok).toBe(false)
    const count = (id: string) => enumerateLoadouts(data.byId[id] as DatacardData).length
    expect([count('fk.kill-broker'), count('fk.heavy-gunner'), count('fk.warrior')]).toEqual([2, 2, 2])
    for (const id of [...SINGLES.filter((c) => c !== 'fk.heavy-gunner'), 'fk.hound']) expect(count(id), id).toBe(1)
    // the bow, the hunting rifle and the pistols bring every profile
    const s = open()
    const weapons = (id: string) => s.operatives[id]!.weapons
    expect(weapons(A(s, 'bow-hunter'))).toEqual(['fk.w.accelerator-bow-fused', 'fk.w.accelerator-bow-glide', 'fk.w.accelerator-bow-voltaic', 'fk.w.blade'])
    expect(weapons(A(s, 'long-sight'))).toHaveLength(4)
    expect(weapons(A(s, 'pistolier'))).toHaveLength(3)
    for (const o of Object.values(s.operatives).filter((x) => x.seat === 'A')) {
      for (const k of ['FARSTALKER KINBAND', "T'AU EMPIRE", 'KROOT']) expect(hasKeyword(s, o, k), `${o.datacardId} ${k}`).toBe(true)
    }
    expect(hasKeyword(s, s.operatives[A(s, 'kill-broker')]!, 'LEADER')).toBe(true)
    // the two Kroot rifles: 3+ for the Kill-Broker and Cold-Blood, 4+ for the Tracker and Warrior
    expect(s.data.weapons['fk.w.kroot-rifle-elite']!.hit).toBe(3)
    expect(s.data.weapons['fk.w.kroot-rifle']!.hit).toBe(4)
    expect(s.operatives[A(s, 'cold-blood')]!.weapons).toContain('fk.w.kroot-rifle-elite')
    expect(s.operatives[A(s, 'tracker')]!.weapons).toContain('fk.w.kroot-rifle')
    // twelve operatives, the Hound moves 8"
    expect(Object.values(s.operatives).filter((o) => o.seat === 'A')).toHaveLength(12)
    expect(s.operatives[A(s, 'hound')]!.move).toBe(8)
    void roster
  })

  it('TEAM-FK-003 TEAM-FK-004 FARSTALKER: the Ready-step order change (the shared Ready-step choice) and the order change instead of a counteraction', () => {
    // ---- the Ready-step order change: in the Ready step, after readying and before any gambit, up to three Farstalker
    // operatives not in an enemy control range flip their orders
    {
      const r0 = toReady()
      expect(r0.strategy.step).toBe('ready')
      expect(r0.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', window: 'turningPoint.start', canPass: true, context: { readyStep: true } })
      expect(Object.values(r0.operatives).filter((o) => o.seat === 'A').every((o) => o.ready)).toBe(true)
      const hound = A(r0, 'hound')
      const boy = B(r0, 'boy')
      const g = place(place(r0, hound, 0, 0), boy, 1.4, 0)
      const orders = (st: GameState, ids: string[]) => ids.map((id) => st.operatives[id]!.order)
      const warriors = [A(g, 'cut-skin'), A(g, 'bow-hunter'), A(g, 'tracker'), A(g, 'stalker')]
      const before = orders(g, warriors)
      const c = take(g, 'ready:0').state
      expect(c.pending).toMatchObject({ kind: 'ability.choice', context: { hook: 'fkReadyStep' } })
      // the Hound stands in an enemy control range: it is not on the list
      expect(optionIds(c)).not.toContain(hound)
      expect(optionIds(c)).toContain('done')
      let t = c
      for (const id of warriors.slice(0, 3)) t = take(t, id).state
      // three picks end the choice and the Gambit step starts: no gambit was used, nobody has passed
      expect(t.pending!.kind).toBe('strategy.gambit')
      expect(t.strategy.gambit.order ?? []).toEqual([])
      expect(t.strategy.gambit.passes).toBe(0)
      const after = orders(t, warriors)
      expect(after.slice(0, 3).every((o, i) => o !== before[i])).toBe(true)
      expect(after[3]).toBe(before[3])
      // "done" ends the choice early
      const d = take(take(take(g, 'ready:0').state, warriors[0]!).state, 'done').state
      expect(d.pending!.kind).toBe('strategy.gambit')
      expect(orders(d, warriors).filter((o, i) => o !== before[i])).toHaveLength(1)
      // a pass keeps every order
      const p = passIt(g).state
      expect(p.pending!.kind).toBe('strategy.gambit')
      expect(orders(p, warriors)).toEqual(before)
    }
    // ---- FARSTALKER counteract alternative: an order change passes the turn, spends no counteract and leaves Guard
    {
      const s0 = open()
      const w = A(s0, 'warrior')
      const s = altState(edit(s0, (st) => {
        st.operatives[w]!.order = 'conceal'
        st.operatives[A(s0, 'tracker')]!.order = 'engage'
        st.operatives[A(s0, 'tracker')]!.flags.guard = true
      }))
      expect(s.pending!.kind).toBe('firefight.activate')
      expect(s.pending!.seat).toBe('A')
      const alts = s.pending!.options!.filter((o) => o.id.startsWith('alt:'))
      // every Farstalker operative outside an enemy control range is offered, whether or not it could counteract
      expect(alts.length).toBe(providerCounteractAlternatives(s, 'A').length)
      expect(alts.length).toBe(12)
      const altFor = (id: string) => alts.find((o) => (o.action.payload as { operativeId: string }).operativeId === id)!
      const next = take(s, altFor(w).id).state
      expect(next.operatives[w]!.order).toBe('engage')
      expect(next.operatives[w]!.flags.counteractedThisTP).toBeFalsy()
      // the turn passes: nobody counteracted, and the flipped operative can still counteract later
      expect(next.pending!.seat).toBe('B')
      expect(counteractCandidates(next, 'A').map((o) => o.id)).toContain(w)
      // a guarding operative flipped this way leaves Guard
      const tr = A(s0, 'tracker')
      expect(s.operatives[tr]!.flags.guard).toBe(true)
      const guarded = take(s, altFor(tr).id).state
      expect(guarded.operatives[tr]!.order).toBe('conceal')
      expect(guarded.operatives[tr]!.flags.guard).toBe(false)
      // an operative in an enemy control range is not offered
      const engagedS = altState(edit(place(place(s0, w, 0, 0), B(s0, 'grot'), 1.4, 0), () => {}))
      const inCr = engagedS.pending!.options!.filter((o) => o.id.startsWith('alt:')).map((o) => (o.action.payload as { operativeId: string }).operativeId)
      expect(inCr).not.toContain(w)
    }
  })

  it('TEAM-FK-003 the Ready-step order change comes before the Gambit step whoever holds initiative, once per turning point, and is not a gambit', () => {
    // B holds initiative: the Kommandos have no Ready-step choice, so A is asked, and the Gambit step then opens on B's turn
    const r = toReady({}, [1, 6, 1, 6])
    expect(r.initiative).toBe('B')
    expect(r.strategy.step).toBe('ready')
    expect(r.strategy.gambit.order ?? []).toEqual([])
    const cs = A(r, 'cut-skin')
    const flipped = take(take(take(r, 'ready:0').state, cs).state, 'done').state
    expect(flipped.operatives[cs]!.order).not.toBe(r.operatives[cs]!.order)
    expect(flipped.pending).toMatchObject({ kind: 'strategy.gambit', seat: 'B' })
    expect(flipped.strategy.gambit.passes).toBe(0)
    // once used, the turning point has no second offer; the gambit list has no stand-in record
    expect(providerReadyStepChoices(flipped, 'A')).toEqual([])
    expect(optionIds(flipped).some((id) => id.includes('farstalker'))).toBe(false)
  })

  it('TEAM-FK-005 TEAM-FK-006 TEAM-FK-007 Call the Kill: a free gambit while the Kill-Broker lives, Balanced against the mark, a new mark after a Blast kill or at the next window, Victory Shriek once per operative', () => {
    // ---- TEAM-FK-007 Call the Kill: a free gambit while the Kill-Broker lives, Balanced against the mark, a new mark af
    {
      const g = toGambit()
      const kb = A(g, 'kill-broker')
      const boy = B(g, 'boy')
      const nob = B(g, 'boss-nob')
      expect(optionIds(g)).toContain(`fk.p.call-the-kill:${boy}`)
      // no Kill-Broker in the killzone: no gambit
      const gone = edit(g, (st) => {
        st.operatives[kb]!.status = 'removed'
      })
      expect(offersFor(gone, 'A', 'strategy.gambit', { window: 'strategy.gambit' }).some((o) => o.ployId === 'fk.p.call-the-kill')).toBe(false)
  
      const cp = g.players.A.cp
      const m = take(g, `fk.p.call-the-kill:${boy}`).state
      expect(m.players.A.cp).toBe(cp)
      expect(markOf(m, 'A')!.id).toBe(boy)
      expect(hasToken(m, boy, 'fk.callTheKill', 'A')).toBe(true)
      // Balanced when shooting, fighting or retaliating against the mark; nothing against another enemy
      const rifle = m.data.weapons['fk.w.kroot-rifle']!
      const blade = m.data.weapons['fk.w.blade']!
      const w = A(m, 'tracker')
      const has = (st: GameState, op: string, weapon: typeof rifle, kind: 'shoot' | 'fight', target: string) => effectiveRules(st, st.operatives[op]!, weapon, kind, target).some((r) => r.rule === 'balanced')
      expect(has(m, w, rifle, 'shoot', boy)).toBe(true)
      expect(has(m, w, blade, 'fight', boy)).toBe(true)
      expect(has(m, w, rifle, 'shoot', nob)).toBe(false)
    }
    // ---- a voltaic Blast kill of the mark offers the new mark after the removal; Victory Shriek picks a kinsman within 
    {
      const s = open()
      const kb = A(s, 'kill-broker')
      const bow = A(s, 'bow-hunter')
      const tracker = A(s, 'tracker')
      const cut = A(s, 'cut-skin')
      const boy = B(s, 'boy')
      const nob = B(s, 'boss-nob')
      const base = withFx(
        edit(place(place(place(place(place(place(s, bow, 0, 0), boy, 5, 0), nob, 5.8, 0), kb, -1, 2), tracker, -2, 3), cut, -3, -5), (st) => {
          st.operatives[boy]!.wounds = 1
        }),
        { source: 'fk.mark', data: { markId: boy, due: 0, shriekedCurrent: false } },
      )
      expect(markOf(base, 'A')!.id).toBe(boy)
      const a = take(take(activateOp(base, bow), 'shoot').state, 'fk.w.accelerator-bow-voltaic').state
      const r = { state: playUntil(take(a, boy, dice(6, 6, 6, 6)).state, dice(), inWindow('operative.killed')) }
      // the mark has fallen: the pick comes in the killer's window, after removal
      expect(r.state.operatives[boy]!.status).toBe('removed')
      const ids = optionIds(r.state)
      expect(ids).toContain(`fk.x.repick:${nob}`)
      // Victory Shriek: the Kill-Broker, the Tracker and the Bow-Hunter itself are within 6" of the Kill-Broker; the Cut-Skin is not
      expect(ids).toContain(`fk.x.shriek:${kb}`)
      expect(ids).toContain(`fk.x.shriek:${tracker}`)
      expect(ids).not.toContain(`fk.x.shriek:${cut}`)
      const picked = take(r.state, `fk.x.repick:${nob}`).state
      expect(markOf(picked, 'A')!.id).toBe(nob)
      // the re-pick is spent; the Shriek is still owed and now offered once
      expect(optionIds(picked).some((x) => x.startsWith('fk.x.repick'))).toBe(false)
      expect(optionIds(picked)).toContain(`fk.x.shriek:${tracker}`)
      const shrieked = take(picked, `fk.x.shriek:${tracker}`).state
      expect(hasToken(shrieked, tracker, 'fk.victoryShriek', 'A')).toBe(true)
      const rifle = shrieked.data.weapons['fk.w.kroot-rifle']!
      // the Shriek makes every weapon of the Tracker Balanced for the battle, whatever it shoots
      expect(effectiveRules(shrieked, shrieked.operatives[tracker]!, rifle, 'shoot', B(s, 'grot')).some((x) => x.rule === 'balanced')).toBe(true)
      // nothing more is owed this fall
      expect(shrieked.pending?.kind === 'ploy.firefight' ? optionIds(shrieked).some((x) => x.startsWith('fk.x.shriek')) : false).toBe(false)
    }
    // ---- a mark that falls to its own Hot (no killer window) is replaced at the next activation-start window of the tur
    {
      const s = open()
      const boy = B(s, 'boy')
      const nob = B(s, 'boss-nob')
      const kb = A(s, 'kill-broker')
      const base = withFx(edit(s, (st) => {
        st.operatives[boy]!.wounds = 0
        st.operatives[boy]!.status = 'removed'
      }), { source: 'fk.mark', data: { markId: boy, due: 0, shriekedCurrent: false } })
      expect(markOf(base, 'A')).toBeUndefined()
      const info = { window: 'firefight.activationStart', subjectId: A(base, 'cut-skin'), counteracting: false }
      const o = offersFor(base, 'A', 'firefight.activationStart', info)
      expect(o.some((x) => x.ployId === 'fk.x.repick')).toBe(true)
      expect(o.some((x) => x.ployId === 'fk.x.shriek' && x.param === kb)).toBe(true)
      void nob
      // without a Call the Kill mark nothing is offered, and the mark lapses with the turning point (expires: turningPoint)
      expect(offersFor(open(), 'A', 'firefight.activationStart', info).some((x) => x.ployId === 'fk.x.repick')).toBe(false)
      // the Kill-Broker out of the killzone: the new mark is still offered, Victory Shriek is not
      const noKb = edit(base, (st) => {
        st.operatives[kb]!.status = 'removed'
      })
      const o2 = offersFor(noKb, 'A', 'firefight.activationStart', info)
      expect(o2.some((x) => x.ployId === 'fk.x.repick')).toBe(true)
      expect(o2.some((x) => x.ployId === 'fk.x.shriek')).toBe(false)
    }
  })

  it('TEAM-FK-008 TEAM-FK-009 TEAM-FK-010 ENERGISE, Hardy and Cold-blooded', () => {
    // ---- ENERGISE: every bow profile has Lethal 5+ until a Shoot with the bow ends; barred in an enemy control range
    {
      const s = open()
      const bow = A(s, 'bow-hunter')
      const boy = B(s, 'boy')
      const a = activateOp(place(place(s, bow, 0, 0), boy, 5, 0), bow)
      const lethal = (st: GameState, id: string) => effectiveRules(st, st.operatives[bow]!, st.data.weapons[id]!, 'shoot', boy).find((r) => r.rule === 'lethal')?.target
      const profiles = ['fk.w.accelerator-bow-fused', 'fk.w.accelerator-bow-glide', 'fk.w.accelerator-bow-voltaic']
      for (const id of profiles) expect(lethal(a, id)).toBeUndefined()
      const e = take(a, 'ability:fk.a.energise').state
      for (const id of profiles) expect(lethal(e, id), id).toBe(5)
      // the bonus is not offered twice, and it does not touch the blade
      expect(optionIds(e)).not.toContain('ability:fk.a.energise')
      expect(effectiveRules(e, e.operatives[bow]!, e.data.weapons['fk.w.blade']!, 'fight', boy).some((r) => r.rule === 'lethal')).toBe(false)
      // a Shoot with the bow spends it
      const shot = take(take(e, 'shoot').state, 'fk.w.accelerator-bow-glide').state
      const done = play(take(shot, boy, dice(1, 1, 1, 1)).state, dice(), {}).state
      expect(done.effects.some((x) => x.source === 'fk.energise')).toBe(false)
      // in an enemy control range the action is not available
      const eng = activateOp(engaged(s, bow, boy), bow)
      expect(optionIds(eng)).not.toContain('ability:fk.a.energise')
    }
    // ---- Hardy turns a crit into the Normal Dmg when lower (never Devastating); Cold-blooded gives Lethal 5+ against th
    {
      const s = open()
      const cb = A(s, 'cold-blood')
      const boy = B(s, 'boy')
      const hit = (st: GameState, weaponId: string, source: string, amount: number) => {
        const before = st.operatives[cb]!.wounds
        const after = withCtx(st, (ctx) => {
          inflict(ctx, { targetId: cb, attackerId: boy, weaponId, amount, source })
        }).state
        return before - after.operatives[cb]!.wounds
      }
      // a 4/5 weapon: a crit deals 4
      expect(hit(s, 'fk.w.pulse-weapon', 'crit', 5)).toBe(4)
      expect(hit(s, 'fk.w.pulse-weapon', 'strike-crit', 5)).toBe(4)
      expect(hit(s, 'fk.w.pulse-weapon', 'devastating', 5)).toBe(5)
      expect(hit(s, 'fk.w.pulse-weapon', 'normal', 4)).toBe(4)
      // a weapon whose Normal Dmg is higher keeps its crit
      const melta = withWeapons(s, ranged('t.melta', { dmg: { normal: 6, crit: 3 } }))
      expect(hit(melta, 't.melta', 'crit', 3)).toBe(3)
      // other operatives do not have it
      const tracker = A(s, 'tracker')
      const other = withCtx(s, (ctx) => {
        inflict(ctx, { targetId: tracker, attackerId: boy, weaponId: 'fk.w.pulse-weapon', amount: 5, source: 'crit' })
      }).state
      expect(other.operatives[tracker]!.maxWounds - other.operatives[tracker]!.wounds).toBe(5)
      // Cold-blooded
      const rifle = s.data.weapons['fk.w.kroot-rifle-elite']!
      const rules = (st: GameState) => effectiveRules(st, st.operatives[cb]!, rifle, 'shoot', boy).map((r) => r.rule)
      expect(rules(s)).toEqual([])
      const wounded = edit(s, (st) => {
        st.operatives[boy]!.wounds = 9
      })
      expect(rules(wounded)).toEqual(['lethal'])
      const injured = edit(s, (st) => {
        st.operatives[boy]!.wounds = 4
      })
      expect(rules(injured)).toEqual(['lethal', 'rending'])
      expect(effectiveRules(injured, injured.operatives[cb]!, injured.data.weapons['fk.w.blade']!, 'fight', boy).map((r) => r.rule)).toEqual(['lethal', 'rending'])
      // for another operative, nothing
      expect(effectiveRules(injured, injured.operatives[tracker]!, rifle, 'shoot', boy)).toEqual([])
    }
  })

  it('TEAM-FK-011 TEAM-FK-012 the Cut-Skin: Vicious Duellist and Savage Assault', () => {
    // ---- Vicious Duellist: 1 direct damage per discarded fail before any die is resolved; a kill ends the fight with no
    {
      const s = open()
      const cs = A(s, 'cut-skin')
      const boy = B(s, 'boy')
      const kill = withFx(
        edit(engaged(s, cs, boy), (st) => {
          st.operatives[boy]!.wounds = 2
        }),
        { source: 'fk.mark', data: { markId: boy, due: 0, shriekedCurrent: false } },
      )
      // the Cut-Skin rolls four crits; the Boy rolls two fails and two crits
      const f = take(take(activateOp(kill, cs), 'fight').state, boy, dice(6, 6, 6, 6, 1, 1, 6, 6)).state
      const evs: GameEvent[] = []
      const stop = (st: GameState) => inWindow('operative.killed')(st) || st.pending?.kind === 'firefight.action'
      const r = { state: playUntil(f, dice(), stop, strikes, evs) }
      expect(r.state.operatives[boy]!.status).toBe('removed')
      expect(r.state.operatives[cs]!.wounds).toBe(r.state.operatives[cs]!.maxWounds)
      expect(evs.filter((e) => e.type === 'Struck')).toHaveLength(0)
      const dmg = evs.filter((e) => e.type === 'DamageInflicted')
      expect(dmg).toHaveLength(1)
      expect(dmg[0]).toMatchObject({ operativeId: boy, sourceId: cs, amount: 2, source: 'direct' })
      // the Cut-Skin counts as the killer: its player gets the operative.killed window (the mark fell)
      expect(inWindow('operative.killed')(r.state)).toBe(true)
      expect(optionIds(r.state)).toContain(`fk.x.repick:${B(s, 'boss-nob')}`)
  
      // a tougher enemy: the damage lands first, then the fight goes on
      const tough = edit(engaged(s, cs, boy), (st) => {
        st.operatives[boy]!.wounds = 10
      })
      const g = take(take(activateOp(tough, cs), 'fight').state, boy, dice(6, 6, 6, 6, 1, 1, 6, 6)).state
      const evs2: GameEvent[] = []
      playUntil(g, dice(), (st) => st.pending?.kind === 'firefight.action', strikes, evs2)
      const order = evs2.filter((e) => e.type === 'DamageInflicted' || e.type === 'Struck').map((e) => (e.type === 'DamageInflicted' ? (e as { source: string }).source : 'struck'))
      expect(order[0]).toBe('direct')
      expect(order.slice(1).every((x) => x !== 'direct')).toBe(true)
      expect(order.length).toBeGreaterThan(1)
      // with no fails there is no damage
      const evs3: GameEvent[] = []
      playUntil(take(take(activateOp(tough, cs), 'fight').state, boy, dice(6, 6, 6, 6, 6, 6, 6, 6)).state, dice(), (st) => st.pending?.kind === 'firefight.action', strikes, evs3)
      expect(evs3.filter((e) => e.type === 'DamageInflicted' && (e as { source: string }).source === 'direct')).toHaveLength(0)
    }
    // ---- Savage Assault: a free Fight against the same enemy after the first Fight of its own activation; not when coun
    {
      const s = open()
      const cs = A(s, 'cut-skin')
      const boy = B(s, 'boy')
      const nob = B(s, 'boss-nob')
      const base = edit(place(place(engaged(s, cs, boy), nob, 0, 1.4), A(s, 'tracker'), -13, 9), (st) => {
        for (const id of [boy, nob, cs]) st.operatives[id]!.wounds = st.operatives[id]!.maxWounds = 60
      })
      const f = take(take(activateOp(base, cs), 'fight').state, boy, dice(1, 1, 1, 1, 1, 1, 1, 1)).state
      const w = playUntil(f, dice(), inWindow('firefight.actionEnded'), strikes)
      expect(optionIds(w)).toContain('fk.x.assault')
      const free = take(w, 'fk.x.assault', dice(1, 1, 1, 1, 1, 1, 1, 1)).state
      // the free Fight can only pick the same enemy, even with another enemy in control range
      expect(free.pending!.kind).toBe('fight.target')
      expect(optionIds(free)).toEqual([boy])
      const evs: GameEvent[] = []
      const begun = take(free, boy, dice(1, 1, 1, 1, 1, 1, 1, 1))
      evs.push(...begun.events)
      const after = playUntil(begun.state, dice(), (st) => st.pending?.kind === 'firefight.action' || st.pending?.kind === 'firefight.activate', strikes, evs)
      expect(evs.filter((e) => e.type === 'FightStarted')).toHaveLength(1)
      // the Cut-Skin has Fought once and nothing else it could do: a second paid Fight is barred
      expect(after.pending!.kind).toBe('firefight.activate')
      // ... even with the AP for it
      const rich = edit(base, (st) => {
        st.operatives[cs]!.aplMods = 1
      })
      const f2 = take(take(activateOp(rich, cs), 'fight').state, boy, dice(1, 1, 1, 1, 1, 1, 1, 1)).state
      const w2 = playUntil(f2, dice(), inWindow('firefight.actionEnded'), strikes)
      const a2 = playUntil(take(take(w2, 'fk.x.assault', dice(1, 1, 1, 1, 1, 1, 1, 1)).state, boy, dice(1, 1, 1, 1, 1, 1, 1, 1)).state, dice(), (st) => st.pending?.kind === 'firefight.action', strikes)
      expect(a2.firefight.activation!.operativeId).toBe(cs)
      expect(optionIds(a2)).not.toContain('fight')
      // not offered again in that activation
      expect(offersFor(a2, 'A', 'firefight.actionEnded', { window: 'firefight.actionEnded', subjectId: cs, counteracting: false }).some((o) => o.ployId === 'fk.x.assault')).toBe(false)
      // a counteraction is not an activation
      const info = { window: 'firefight.actionEnded', subjectId: cs, counteracting: true }
      expect(offersFor(w, 'A', 'firefight.actionEnded', info).some((o) => o.ployId === 'fk.x.assault')).toBe(false)
    }
  })

  it('TEAM-FK-013 TEAM-FK-014 TEAM-FK-015 TEAM-FK-016 the Hound: Beast, Bad-tempered (forced Fight, free Charge) and GATHER', () => {
    // ---- Beast: the Hound has no Shoot, mission, equipment or grenade action and uses only its own weapon; Meat and Tro
    {
      const s = open({ equipmentA: ['fk.e.meat', 'fk.e.trophy', 'core.e.explosive-grenades'] })
      const h = A(s, 'hound')
      const boy = B(s, 'boy')
      const hound = s.operatives[h]!
      for (const id of ['shoot', 'ability:core.a.smoke-grenade', 'ability:core.a.stun-grenade', 'ability:core.a.secure', 'overwatch']) expect(actionForbidden(s, hound, id), id).not.toBeNull()
      for (const id of ['charge', 'dash', 'fallBack', 'fight', 'guard', 'reposition', 'ability:fk.a.gather', 'marker:pickUp', 'marker:place']) expect(actionForbidden(s, hound, id), id).toBeNull()
      expect(hound.weapons).toEqual(['fk.w.ripping-fangs'])
      expect(providerWeaponForbidden(s, hound, 'core.w.frag-grenade', 'shoot')).not.toBeNull()
      // the ready Hound next to an objective with an enemy at range: movement, Fight and Guard stay, Shoot and mission actions do not
      const m = s.markers.find((k) => k.kind === 'objective')!
      const t = place(place(s, h, m.pos.x + 0.9, m.pos.z), boy, m.pos.x + 7, m.pos.z)
      const a = activateOp(t, h)
      const ids = optionIds(a)
      expect(ids).toEqual(expect.arrayContaining(['reposition', 'dash', 'charge', 'guard', 'ability:fk.a.gather:dash', 'ability:fk.a.gather:reposition']))
      expect(ids).not.toContain('shoot')
      expect(ids.filter((x) => x.startsWith('ability:') && !x.startsWith('ability:fk.a.gather'))).toEqual([])
      // Meat and Trophy are for the other operatives only
      const info = { window: 'firefight.activationStart', counteracting: false }
      const hurt = edit(a, (st) => {
        st.operatives[h]!.wounds = 3
        st.operatives[A(s, 'tracker')]!.wounds = 3
      })
      const offers = (id: string) => offersFor(hurt, 'A', 'firefight.activationStart', { ...info, subjectId: id }).map((o) => o.ployId)
      expect(offers(h)).toEqual([])
      const tr = A(s, 'tracker')
      const trActive = edit(hurt, (st) => {
        st.firefight.activation = { operativeId: tr, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null }
      })
      expect(offersFor(trActive, 'A', 'firefight.activationStart', { ...info, subjectId: tr }).map((o) => o.ployId)).toEqual(['fk.e.meat', 'fk.e.trophy'])
    }
    // ---- Bad-tempered: an enemy declaring Fight with a Hound and another Farstalker operative in control range may be f
    {
      const s = open()
      const h = A(s, 'hound')
      const w = A(s, 'warrior')
      const boy = B(s, 'boy')
      const t = place(place(place(s, h, 1.4, 0), w, -1.4, 0), boy, 0, 0)
      const b = bTurn(t, A(s, 'cut-skin'))
      const declared = take(activateOp(b, boy), 'fight').state
      expect(declared.pending!.kind).toBe('ploy.firefight')
      expect(optionIds(declared)).toContain(`fk.x.force:${h}`)
      // declined: both are fight targets
      const free = playUntil(declared, dice(), (st) => st.pending?.kind === 'fight.target')
      expect(optionIds(free).sort()).toEqual([h, w].sort())
      // forced: the Hound is the only one
      const forced = playUntil(take(declared, `fk.x.force:${h}`).state, dice(), (st) => st.pending?.kind === 'fight.target')
      expect(optionIds(forced)).toEqual([h])
      // a Hound alone in control range gives nothing to force
      const alone = place(b, w, -9, 5)
      const d2 = take(activateOp(alone, boy), 'fight').state
      expect(d2.pending!.kind).toBe('fight.target')
    }
    // ---- Bad-tempered: a Charge ending in a Farstalker operative\'s control range within 3" of a free Hound offers it a
    {
      const s = open()
      const h = A(s, 'hound')
      const w = A(s, 'warrior')
      const boy = B(s, 'boy')
      const base = edit(place(place(place(s, h, 0, 0), w, 2, 0), boy, 3.3, 0), (st) => {
        st.operatives[h]!.order = 'conceal'
      })
      const info = { actorId: boy, action: 'charge', activeSeat: 'B' as const, moved: true }
      const offers = (st: GameState) => providerReactions(st, 'A', info)
      expect(offers(base)).toHaveLength(1)
      expect(offers(base)[0]).toMatchObject({ hook: 'fkBadTempered', operativeId: h, option: boy })
      // a Charge onto the Hound itself does not trigger it (no other Farstalker operative is involved)
      expect(offers(place(place(base, w, -9, 5), boy, 1.4, 0))).toHaveLength(0)
      // the Hound must be free of enemy control ranges and within 3" of the charged friend
      expect(offers(place(base, h, 4.6, 0))).toHaveLength(0)
      expect(offers(place(place(base, h, 0, 5), boy, 3.3, 0))).toHaveLength(0)
      // play it: B charges the Warrior, A answers with the Hound's free Charge
      const b = activateOp(bTurn(edit(place(place(place(s, h, 0, 0), w, 2, 0), boy, 8, 0), (st) => {
        st.operatives[h]!.order = 'conceal'
      }), A(s, 'cut-skin')), boy)
      const charged = playUntil(take(b, 'charge').state, dice(), (st) => st.pending?.kind === 'move.path', moveBy(-4.7))
      const moved = play(charged, dice(), moveBy(-4.7), ['ability.choice'])
      expect(moved.state.pending!.options!.map((o) => o.id)).toContain('react:0')
      const react = take(moved.state, 'react:0').state
      expect(react.pending!.kind).toBe('move.path')
      expect(react.operatives[h]!.order).toBe('engage')
      // the free Charge must end in the enemy's control range
      const around = (p: PendingDecision) => ({ type: 'move.path' as const, seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 1, z: -1.8 }, { x: 3.3, z: -2 }] } })
      const bad = step(react, { type: 'move.path', seat: 'A', decisionId: react.pending!.id, payload: { waypoints: [{ x: -2, z: 0 }] } })
      expect(bad.rejection).toBeDefined()
      const end = play(react, dice(), { 'move.path': around }, ['firefight.action', 'firefight.activate'])
      const hound = end.state.operatives[h]!
      expect(Math.hypot(hound.pos.x - 3.3, hound.pos.z)).toBeLessThanOrEqual(2.2)
      expect(hound.order).toBe('engage')
      // it was a reaction, not a counteraction: the Hound is still ready to be activated
      expect(hound.ready).toBe(true)
    }
    // ---- GATHER: a free Reposition of part of the Move, a free Place Marker of a carried marker, then the remaining dis
    {
      const s = open()
      const h = A(s, 'hound')
      const base = edit(place(s, h, 0, 0), (st) => {
        st.markers.push({ id: 'mk-carried', kind: 'equipment', pos: { x: 0, z: 0 }, owner: null, carriedBy: h, controller: null, equipmentId: 'test' } as never)
        st.operatives[h]!.flags.carrying = 'mk-carried'
      })
      const g = take(activateOp(base, h), 'ability:fk.a.gather:reposition').state
      expect(g.pending!.kind).toBe('move.path')
      const mid = play(g, dice(), moveBy(3), ['ability.choice'])
      // the middle step: place the carried marker where the Hound stands, or keep carrying
      expect(mid.state.pending!.kind).toBe('ability.choice')
      expect(optionIds(mid.state)).toEqual(['place', 'skip'])
      const placed = take(mid.state, 'place').state
      const marker = placed.markers.find((k) => k.id === 'mk-carried')!
      expect(marker.carriedBy).toBeNull()
      expect(marker.pos).toEqual({ x: 3, z: 0 })
      expect(placed.operatives[h]!.flags.carrying).toBeNull()
      // the second move has the distance left: 5" of the 8"
      expect(placed.pending!.kind).toBe('move.path')
      const tooFar = step(placed, { type: 'move.path', seat: 'A', decisionId: placed.pending!.id, payload: { waypoints: [{ x: 3 + 5.5, z: 0 }] } })
      expect(tooFar.rejection).toBeDefined()
      const done = play(placed, dice(), moveBy(4.5), ['firefight.action']).state
      expect(done.operatives[h]!.pos.x).toBeCloseTo(7.5, 3)
      expect(done.firefight.activation!.apSpent).toBe(1)
      // it counts as one Reposition: no Charge or second GATHER afterwards
      expect(done.firefight.activation!.performed).toEqual(expect.arrayContaining(['reposition', 'ability:fk.a.gather']))
      expect(optionIds(done)).not.toContain('charge')
      expect(optionIds(done)).not.toContain('reposition')
    }
  })

  it('TEAM-FK-015 TEAM-FK-016 Bad-tempered with two Hounds: each Hound the enemy Charge triggered may make its own free Charge (the shared reaction round re-offers repeat offers)', () => {
    const s = open({ rosterA: roster(['fk.kill-broker', ...SINGLES, 'fk.hound', 'fk.hound', 'fk.warrior']) })
    const [h1, h2] = Object.values(s.operatives).filter((o) => o.seat === 'A' && o.datacardId === 'fk.hound').map((o) => o.id).sort() as [string, string]
    const w = A(s, 'warrior')
    const boy = B(s, 'boy')
    const t = edit(place(place(place(place(s, h1, 0, 0), h2, 2, 2.5), w, 2, 0), boy, 8, 0), (st) => {
      st.operatives[h1]!.order = 'conceal'
    })
    // both Hounds are triggered by one Charge that ends against the Warrior
    expect(providerReactions(place(t, boy, 3.3, 0), 'A', { actorId: boy, action: 'charge', activeSeat: 'B', moved: true }).map((r) => r.operativeId).sort()).toEqual([h1, h2])
    const b = activateOp(bTurn(t, A(s, 'cut-skin')), boy)
    const moved = play(take(b, 'charge').state, dice(), moveBy(-4.7), ['ability.choice'])
    const pick = (st: GameState, id: string) => st.pending!.options!.find((o) => (o.data as { operativeId?: string } | undefined)?.operativeId === id)!.id
    const first = take(moved.state, pick(moved.state, h1)).state
    const around = (p: PendingDecision) => ({ type: 'move.path' as const, seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 1, z: -1.8 }, { x: 3.3, z: -2 }] } })
    // the first Hound's Charge done, the second is offered its own
    const again = play(first, dice(), { 'move.path': around }, ['ability.choice', 'firefight.action', 'firefight.activate']).state
    expect(again.pending!.kind).toBe('ability.choice')
    expect(again.pending!.options!.map((o) => (o.data as { operativeId: string }).operativeId)).toEqual([h2])
    // the shared reaction round asks again: a repeat offer, with the first Hound noted as having reacted
    expect(again.pending!.context).toMatchObject({ hook: 'reaction', offers: [{ hook: 'fkBadTempered', operativeId: h2, repeat: true }] })
    expect(again.firefight.activation!.reacted!.ids).toEqual([h1])
    const second = take(again, pick(again, h2)).state
    expect(second.pending!.kind).toBe('move.path')
    const to = (p: PendingDecision) => ({ type: 'move.path' as const, seat: p.seat, decisionId: p.id, payload: { waypoints: [{ x: 3.3, z: 1.5 }] } })
    const end = play(second, dice(), { 'move.path': to }, ['ability.choice', 'firefight.action', 'firefight.activate']).state
    expect(end.pending!.kind).not.toBe('ability.choice')
    for (const id of [h1, h2]) {
      const hd = end.operatives[id]!
      expect(Math.hypot(hd.pos.x - 3.3, hd.pos.z)).toBeLessThanOrEqual(2.2)
      expect(hd.ready).toBe(true)
    }
    // declining the second offer closes the reaction point
    const declined = passIt(again).state
    expect(declined.pending!.kind).not.toBe('ability.choice')
    expect(declined.operatives[h2]!.pos).toEqual(t.operatives[h2]!.pos)
  })

  it('TEAM-FK-012 Savage Assault: a first Fight that kills the enemy still counts as the first, so a later Fight that activation gets no free Fight', () => {
    const s = open()
    const cs = A(s, 'cut-skin')
    const boy = B(s, 'boy')
    const nob = B(s, 'boss-nob')
    const t = edit(place(engaged(s, cs, boy), nob, 0, 1.4), (st) => {
      st.operatives[boy]!.wounds = 2
      st.operatives[nob]!.wounds = st.operatives[nob]!.maxWounds = 60
      // APL 3, so the activation goes on after the Fight (Fall Back stays possible)
      st.operatives[cs]!.aplMods = 1
    })
    const f = take(take(activateOp(t, cs), 'fight').state, boy, dice(6, 6, 6, 6, 6, 6, 6, 6)).state
    const after = playUntil(f, dice(), (st) => st.pending?.kind === 'firefight.action' || st.pending?.kind === 'firefight.activate', strikes)
    expect(after.pending!.kind).toBe('firefight.action')
    expect(after.operatives[boy]!.status).toBe('removed')
    const fx = after.effects.find((e) => e.source === 'fk.sa.fought' && e.operativeId === cs)
    expect(fx?.data).toMatchObject({ enemyId: boy, offer: false })
    // a second Fight resolved in the same activation (any rule that grants one) is not the first: no Savage Assault offer
    const second = withCtx(after, (ctx) => {
      runHook('onFightResolved', { seat: 'A', state: ctx.state, engine: ctx, data: { attackerId: cs, defenderId: nob, attackerIncapacitated: false, defenderIncapacitated: false } })
    }).state
    expect(offersFor(second, 'A', 'firefight.actionEnded', { window: 'firefight.actionEnded', subjectId: cs, counteracting: false }).some((o) => o.ployId === 'fk.x.assault')).toBe(false)
  })

  it('TEAM-FK-021 STEALTH ATTACK is not offered once its free Charge is barred (after a Reposition this activation)', () => {
    const s = open()
    const stalker = A(s, 'stalker')
    const boy = B(s, 'boy')
    const t = withTerrain(
      edit(place(place(s, stalker, 0, 0), boy, 5, 0), (st) => {
        st.operatives[stalker]!.aplMods = 1
      }),
      -1,
      1,
      0.9,
      1.9,
    )
    const a = activateOp(t, stalker, 'conceal')
    expect(optionIds(a)).toContain('ability:fk.a.stealth-attack')
    const r = play(take(a, 'reposition').state, dice(), moveBy(-0.5), ['firefight.action']).state
    expect(r.firefight.activation!.performed).toContain('reposition')
    expect(r.operatives[stalker]!.pos.x).toBeCloseTo(-0.5, 3)
    expect(optionIds(r)).not.toContain('ability:fk.a.stealth-attack')
  })

  it('TEAM-FK-017 TEAM-FK-018 TEAM-FK-019 hunting rifle: Concealed Position is for the first Shoot of the battle, LONG-SIGHT lasts through enemy turns and denies obscured, Salvo shoots a second target as its own sequence', () => {
    const s = open()
    const ls = A(s, 'long-sight')
    const boy = B(s, 'boy')
    const nob = B(s, 'boss-nob')
    const CONCEALED = 'fk.w.kroot-hunting-rifle-concealed'
    // the concealed profile is Silent: it can be used under Conceal; the others cannot
    const hidden = activateOp(place(place(s, ls, 0, 0), boy, 8, 0), ls, 'conceal')
    const optsConcealed = (st: GameState) => shootableWeapons(st, st.operatives[ls]!, []).map((w) => w.weaponId)
    expect(optsConcealed(hidden)).toEqual([CONCEALED])
    // the first Shoot of any kind uses it up, even with another profile
    const eng = activateOp(place(place(s, ls, 0, 0), boy, 8, 0), ls)
    expect(optsConcealed(eng)).toEqual(expect.arrayContaining([CONCEALED, 'fk.w.kroot-hunting-rifle-mobile', 'fk.w.kroot-hunting-rifle-stationary']))
    const shot = take(take(eng, 'shoot').state, 'fk.w.kroot-hunting-rifle-mobile').state
    const after = play(take(shot, boy, dice(1, 1, 1, 1)).state, dice(), {}).state
    expect(providerWeaponForbidden(after, after.operatives[ls]!, CONCEALED, 'shoot')).not.toBeNull()
    expect(optsConcealed(after)).not.toContain(CONCEALED)
    // LONG-SIGHT: Lethal 5+ on the concealed and stationary profiles only; it survives until the Long-Sight's next activation
    const lethal = (st: GameState, id: string) => effectiveRules(st, st.operatives[ls]!, st.data.weapons[id]!, 'shoot', boy).find((r) => r.rule === 'lethal')?.target
    const lsOn = take(eng, 'ability:fk.a.long-sight').state
    expect(lethal(lsOn, CONCEALED)).toBe(5)
    expect(lethal(lsOn, 'fk.w.kroot-hunting-rifle-stationary')).toBe(5)
    expect(lethal(lsOn, 'fk.w.kroot-hunting-rifle-mobile')).toBeUndefined()
    const enemyTurn = activateOp(take(lsOn, 'end').state, boy)
    expect(lethal(enemyTurn, CONCEALED)).toBe(5)
    // "enemies cannot be obscured": the status hook for the Long-Sight's own hunting-rifle shots
    const obscured = (st: GameState, weaponId: string) => {
      const withAttack = edit(st, (x) => {
        x.attack = { kind: 'shoot', stage: 'weapon', operativeId: ls, seat: 'A', weaponId, pointBlank: false, targets: [], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] }
      })
      const data = { obscured: true, inCover: false }
      runHook('target.status', { seat: 'A', state: withAttack, operativeId: ls, targetId: boy, data })
      return data.obscured
    }
    expect(obscured(lsOn, 'fk.w.kroot-hunting-rifle-mobile')).toBe(false)
    expect(obscured(eng, 'fk.w.kroot-hunting-rifle-mobile')).toBe(true)
    expect(obscured(lsOn, 'fk.w.blade')).toBe(true)
    // the odds before a weapon is picked: no attack in progress, the status hook is told the weapon (HookContext.weaponId)
    const oddsObscured = (st: GameState, weaponId: string) => {
      const data = { obscured: true, inCover: false }
      expect(st.attack).toBeFalsy()
      runHook('target.status', { seat: 'A', state: st, operativeId: ls, targetId: boy, weaponId, data })
      return data.obscured
    }
    expect(oddsObscured(lsOn, 'fk.w.kroot-hunting-rifle-stationary')).toBe(false)
    expect(oddsObscured(lsOn, 'fk.w.blade')).toBe(true)
    expect(oddsObscured(eng, 'fk.w.kroot-hunting-rifle-stationary')).toBe(true)
    // the weapon named wins over an attack in progress with another weapon
    const withBlade = edit(lsOn, (x) => {
      x.attack = { kind: 'shoot', stage: 'weapon', operativeId: ls, seat: 'A', weaponId: 'fk.w.blade', pointBlank: false, targets: [], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [] }
    })
    const named = { obscured: true, inCover: false }
    runHook('target.status', { seat: 'A', state: withBlade, operativeId: ls, targetId: boy, weaponId: 'fk.w.kroot-hunting-rifle-mobile', data: named })
    expect(named.obscured).toBe(false)
    // ... and it ends when the Long-Sight is next activated
    expect(lsOn.effects.find((x) => x.source === 'fk.longSight')!.expires).toBe(`startOfActivation:${ls}`)

    // Salvo: a second, different valid target in its own sequence
    const pist = A(s, 'pistolier')
    const sv = activateOp(place(place(place(s, pist, 0, 0), boy, 6, 0), nob, 6, 3), pist)
    const picked = take(take(sv, 'shoot').state, 'fk.w.dual-kroot-pistols-salvo').state
    const second = take(picked, boy).state
    expect(second.pending!.kind).toBe('shoot.target')
    expect(optionIds(second)).toEqual([`add:${nob}`, 'done'])
    const run = take(second, `add:${nob}`, dice(1, 1, 1, 1, 1, 1, 1, 1, 1, 1))
    const r = play(run.state, dice(1, 1, 1, 1, 1, 1, 1, 1, 1, 1), {})
    const targets = [...run.events, ...r.events].filter((e) => e.type === 'TargetSelected').map((e) => (e as { targetId: string }).targetId)
    expect(targets).toEqual(expect.arrayContaining([boy, nob]))
    // the focused profile has no second target; one target alone is allowed
    const focused = take(take(sv, 'shoot').state, 'fk.w.dual-kroot-pistols-focused').state
    expect(take(focused, boy).state.pending!.kind).not.toBe('shoot.target')
    const one = take(take(take(sv, 'shoot').state, 'fk.w.dual-kroot-pistols-salvo').state, boy).state
    expect(optionIds(one)).toContain('done')
    // a target in a friendly control range is not offered: the Warrior stands beside the Nob
    const covered = activateOp(place(place(place(place(s, pist, 0, 0), boy, 6, 0), nob, 6, 3), A(s, 'warrior'), 6, 4.3), pist)
    const alt = take(take(take(covered, 'shoot').state, 'fk.w.dual-kroot-pistols-salvo').state, boy).state
    expect(optionIds(alt)).not.toContain(`add:${nob}`)
  })

  it('TEAM-FK-020 Quick Draw: when an enemy declares Shoot with the ready Pistolier a valid target, a free focused-pistol Shoot first; once per turning point; the Pistolier stays ready', () => {
    const s = open()
    const pist = A(s, 'pistolier')
    const boy = B(s, 'boy')
    const t = edit(place(place(s, pist, 0, 0), boy, 6, 0), (st) => {
      st.operatives[pist]!.order = 'conceal'
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 60
    })
    const b = bTurn(t, A(s, 'cut-skin'))
    const declared = take(activateOp(b, boy), 'shoot').state
    expect(declared.pending!.kind).toBe('ploy.firefight')
    expect(optionIds(declared)).toContain(`fk.x.quick-draw:${pist}`)
    // an expended Pistolier gets no offer
    const spent = edit(declared, (st) => {
      st.operatives[pist]!.ready = false
    })
    expect(offersFor(spent, 'A', 'firefight.opponentActionDeclared', { window: 'firefight.opponentActionDeclared', actorId: boy, action: 'shoot' }).some((o) => o.ployId === 'fk.x.quick-draw')).toBe(false)
    // used: the focused pistols shoot the enemy, Conceal flipped to Engage, then the enemy's own Shoot goes on
    const used = take(declared, `fk.x.quick-draw:${pist}`)
    expect(used.state.operatives[pist]!.order).toBe('engage')
    // only the focused profile is on offer, and only the enemy that is shooting can be the target
    expect(optionIds(used.state)).toEqual(['fk.w.dual-kroot-pistols-focused'])
    const picked = take(used.state, 'fk.w.dual-kroot-pistols-focused').state
    expect(picked.pending!.kind).toBe('shoot.target')
    expect(optionIds(picked)).toEqual([boy])
    const events: GameEvent[] = []
    const resumed = playUntil(take(picked, boy, dice(6, 6, 6, 6)).state, dice(), (st) => st.pending?.kind === 'shoot.weapon' && st.pending.seat === 'B', {}, events)
    expect(events.filter((e) => e.type === 'DamageInflicted' && (e as { operativeId: string }).operativeId === boy).length).toBeGreaterThan(0)
    expect(resumed.operatives[pist]!.ready).toBe(true)
    expect(resumed.ledger.A.tp).toContain(`fk.quickDraw:${pist}`)
    // the interrupt cannot be repeated this turning point
    expect(offersFor(resumed, 'A', 'firefight.opponentActionDeclared', { window: 'firefight.opponentActionDeclared', actorId: boy, action: 'shoot' }).some((o) => o.ployId === 'fk.x.quick-draw')).toBe(false)
    // if the interrupt kills the shooter, its Shoot ends with no attack
    const frail = edit(t, (st) => {
      st.operatives[boy]!.wounds = 1
      st.operatives[boy]!.maxWounds = 10
    })
    const d2 = take(activateOp(bTurn(frail, A(s, 'cut-skin')), boy), 'shoot').state
    const dead = playUntil(take(take(take(d2, `fk.x.quick-draw:${pist}`).state, 'fk.w.dual-kroot-pistols-focused').state, boy, dice(6, 6, 6, 6)).state, dice(), (st) => st.pending?.kind === 'firefight.activate' || st.pending?.kind === 'shoot.weapon')
    expect(dead.operatives[boy]!.status).toBe('removed')
    expect(dead.pending!.kind).toBe('firefight.activate')
  })

  it('TEAM-FK-021 Stalker charges under Conceal; STEALTH ATTACK (2 AP, Conceal, terrain within 1", no enemy control range) charges no further than Move and its first strike is followed at once by another strike', () => {
    const s = open()
    const stalker = A(s, 'stalker')
    const boy = B(s, 'boy')
    const terr = (st: GameState, near = true) =>
      withTerrain(
        edit(place(place(st, stalker, 0, 0), boy, 5, 0), (x) => {
          x.operatives[boy]!.wounds = x.operatives[boy]!.maxWounds = 60
        }),
        near ? -1 : 8,
        near ? 1 : 9,
        0.9,
        1.9,
      )
    const c = activateOp(terr(s), stalker, 'conceal')
    expect(optionIds(c)).toContain('charge')
    expect(optionIds(c)).toContain('ability:fk.a.stealth-attack')
    // not under Engage, not far from terrain, not in an enemy control range
    expect(optionIds(activateOp(terr(s), stalker, 'engage'))).not.toContain('ability:fk.a.stealth-attack')
    expect(optionIds(activateOp(terr(s, false), stalker, 'conceal'))).not.toContain('ability:fk.a.stealth-attack')
    expect(optionIds(activateOp(withTerrain(engaged(s, stalker, boy), -1, 1, 0.9, 1.9), stalker, 'conceal'))).not.toContain('ability:fk.a.stealth-attack')
    // the free Charge is capped at the Move stat (6"): 7.4" away is out of reach, 4.7" is fine
    const go = take(c, 'ability:fk.a.stealth-attack').state
    expect(go.pending!.kind).toBe('move.path')
    expect(step(go, { type: 'move.path', seat: 'A', decisionId: go.pending!.id, payload: { waypoints: [{ x: 6.2, z: 0 }] } }).rejection).toBeDefined()
    const fighting = play(go, dice(), moveBy(3.7), ['fight.target'])
    expect(fighting.state.operatives[stalker]!.pos.x).toBeCloseTo(3.7, 3)
    // the Stalker's four crits against the Boy's four: its first strike is followed by a second one, then the Boy resolves
    const fight = take(fighting.state, boy, dice(6, 6, 6, 6, 6, 6, 6, 6))
    const r = play(fight.state, dice(), strikes)
    const strikers = [...fight.events, ...r.events].filter((e) => e.type === 'Struck').map((e) => (e as { operativeId: string }).operativeId)
    expect(strikers.slice(0, 3)).toEqual([stalker, stalker, boy])
    // 2 AP are spent and the Charge and Fight count as performed
    const spent = [...fight.events, ...r.events].filter((e) => e.type === 'ApSpent')
    expect(spent.map((e) => (e as { total: number }).total)).toEqual([2])
    // the plain Fight (no Stealth Attack) alternates normally
    const plain = take(take(activateOp(edit(place(place(s, stalker, 0, 0), boy, 1.4, 0), (x) => {
      x.operatives[boy]!.wounds = x.operatives[boy]!.maxWounds = 60
    }), stalker), 'fight').state, boy, dice(6, 6, 6, 6, 6, 6, 6, 6))
    const pr = play(plain.state, dice(), strikes)
    const plainOrder = [...plain.events, ...pr.events].filter((e) => e.type === 'Struck').map((e) => (e as { operativeId: string }).operativeId)
    expect(plainOrder.slice(0, 2)).toEqual([stalker, boy])
  })

  it('TEAM-FK-022 TEAM-FK-023 Tracker: the Pech\'ra marker gives Seek Light against enemies beside it (one marker, gone when the Tracker next activates or leaves); FROM THE EYE ABOVE gives a visible kinsman within 6" APL +1', () => {
    const s = open()
    const tr = A(s, 'tracker')
    const w = A(s, 'warrior')
    const boy = B(s, 'boy')
    const nob = B(s, 'boss-nob')
    const rifle = s.data.weapons['fk.w.kroot-rifle']!
    const seek = (st: GameState, shooter: string, target: string) => effectiveRules(st, st.operatives[shooter]!, rifle, 'shoot', target).some((r) => r.rule === 'seek-light')
    const t = place(place(place(place(s, tr, 0, 0), w, -3, 0), boy, 6, 0), nob, 6.6, 4)
    const a = take(activateOp(t, tr), 'ability:fk.a.marked-for-the-hunt').state
    expect(a.pending!.kind).toBe('ability.choice')
    // any visible point: pick the one under the Boy
    const spot = a.pending!.options!.find((o) => (o.data as { x: number; z: number }).x === 6 && (o.data as { z: number }).z === 0)
    expect(spot).toBeDefined()
    const placed = take(a, spot!.id).state
    const markers = (st: GameState) => st.markers.filter((m) => m.equipmentId === 'fk.pechra')
    expect(markers(placed)).toHaveLength(1)
    expect(seek(placed, w, boy)).toBe(true)
    expect(seek(placed, w, nob)).toBe(false)
    expect(effectiveRules(placed, placed.operatives[w]!, placed.data.weapons['fk.w.blade']!, 'fight', boy).some((r) => r.rule === 'seek-light')).toBe(false)
    // placing it again moves it (one at a time)
    const again = edit(placed, (st) => {
      st.operatives[tr]!.ready = true
    })
    void again
    // a Conceal enemy in Light cover becomes a valid target for the Warrior
    const cover = withTerrain(edit(place(place(place(s, w, 0, 0), boy, 5.2, 0), tr, -3, 3), (st) => {
      st.operatives[boy]!.order = 'conceal'
    }), 4.2, 4.6, -3, 3)
    const marker = { id: 'mk-pechra', kind: 'equipment', pos: { x: 5.2, z: 0 }, owner: 'A', carriedBy: null, controller: null, equipmentId: 'fk.pechra', placedBy: tr }
    const marked = edit(cover, (st) => {
      st.markers.push(marker as never)
    })
    const validIds = (st: GameState) => validTargets(st, st.operatives[w]!, 'fk.w.kroot-rifle').map((x) => x.id)
    expect(validIds(cover)).not.toContain(boy)
    expect(validIds(marked)).toContain(boy)
    // it goes when the Tracker next activates, and when the Tracker leaves the killzone
    const gone = withCtx(marked, (ctx) => {
      runHook('activation.start', { seat: 'A', state: ctx.state, engine: ctx, operativeId: tr, data: { previousOrder: 'engage', order: 'engage' } })
    }).state
    expect(markers(gone)).toHaveLength(0)
    const lost = withCtx(marked, (ctx) => {
      runHook('operative.incapacitated', { seat: 'A', state: ctx.state, engine: ctx, operativeId: tr })
    }).state
    expect(markers(lost)).toHaveLength(0)

    // FROM THE EYE ABOVE
    const eye = activateOp(place(place(place(s, tr, 0, 0), w, 5, 0), A(s, 'stalker'), 8, 0), tr)
    const ids = optionIds(eye)
    expect(ids).toContain(`ability:fk.a.from-the-eye-above:${w}`)
    expect(ids).not.toContain(`ability:fk.a.from-the-eye-above:${A(s, 'stalker')}`)
    expect(ids).not.toContain(`ability:fk.a.from-the-eye-above:${tr}`)
    const boosted = take(eye, `ability:fk.a.from-the-eye-above:${w}`).state
    expect(effectiveApl(boosted.operatives[w]!)).toBe(3)
    expect(effectiveApl(boosted.operatives[tr]!)).toBe(2)
  })

  it('TEAM-FK-024 TEAM-FK-032 TEAM-FK-033 Piercing Shot, Toxin Shot, Meat, Trophy and Ready for Anything', () => {
    // ---- Piercing Shot / Toxin Shot name the Kroot rifle, scattergun and focused pistols only
    const s = open({ equipmentA: ['fk.e.piercing-shot', 'fk.e.toxin-shot'] })
    const w = A(s, 'warrior')
    const boy = B(s, 'boy')
    const rifle = s.data.weapons['fk.w.kroot-rifle']!
    const rules = (st: GameState, id: string, weapon = rifle) => effectiveRules(st, st.operatives[id]!, weapon, 'shoot', boy)
    const shooting = take(take(activateOp(place(place(s, w, 0, 0), boy, 6, 0), w), 'shoot').state, 'fk.w.kroot-rifle')
    const window = shooting.state.pending!.kind === 'shoot.target' ? take(shooting.state, boy).state : shooting.state
    expect(window.pending!.kind).toBe('ploy.firefight')
    const ids = optionIds(window)
    expect(ids).toEqual(expect.arrayContaining(['fk.e.piercing-shot', 'fk.e.toxin-shot', 'fk.x.rfa-piercing-shot', 'fk.x.rfa-toxin-shot']))
    const toxin = take(window, 'fk.e.toxin-shot').state
    expect(rules(toxin, w).map((r) => r.rule).sort()).toEqual(['lethal', 'stun'])
    // never together in one action: the window offers neither again
    expect(toxin.pending?.kind === 'ploy.firefight' ? optionIds(toxin).filter((x) => /shot/.test(x)) : []).toEqual([])
    // each once per turning point
    expect(toxin.ledger.A.tp).toContain('fk.toxin.tp')
    // the pulse weapon and the hunting rifle are not named
    const kb = A(s, 'kill-broker')
    const pulse = edit(s, (st) => {
      st.operatives[kb]!.weapons = ['fk.w.pulse-weapon', 'fk.w.ritual-blade']
    })
    const pw = take(take(activateOp(place(place(pulse, kb, 0, 0), boy, 6, 0), kb), 'shoot').state, 'fk.w.pulse-weapon').state
    expect(pw.pending!.kind === 'ploy.firefight' ? optionIds(pw).filter((x) => /shot/.test(x)) : []).toEqual([])
    const ls = A(s, 'long-sight')
    const hr = take(take(activateOp(place(place(s, ls, 0, 0), boy, 6, 0), ls), 'shoot').state, 'fk.w.kroot-hunting-rifle-mobile').state
    expect(hr.pending!.kind === 'ploy.firefight' ? optionIds(hr).filter((x) => /shot/.test(x)) : []).toEqual([])

    // ---- Ready for Anything: once per TP for the team, without the equipment, even after the equipment was spent
    const plain = open()
    const spent = edit(plain, (st) => {
      st.ledger.A.tp.push('fk.toxin.tp')
    })
    const w2 = A(spent, 'warrior')
    const rfa = take(take(activateOp(place(place(spent, w2, 0, 0), boy, 6, 0), w2), 'shoot').state, 'fk.w.kroot-rifle').state
    const rwin = rfa.pending!.kind === 'shoot.target' ? take(rfa, boy).state : rfa
    expect(optionIds(rwin)).toEqual(expect.arrayContaining(['fk.x.rfa-toxin-shot', 'fk.x.rfa-piercing-shot']))
    const used = take(rwin, 'fk.x.rfa-toxin-shot').state
    expect(used.ledger.A.tp).toContain('fk.rfa.tp')
    // the second use that turning point is refused
    const info = { window: 'shoot.targetSelected', subjectId: A(used, 'cut-skin') }
    void info
    expect(offersFor(edit(used, (st) => { st.effects = st.effects.filter((e) => e.source !== 'fk.ammo') }), 'A', 'shoot.targetSelected', { window: 'shoot.targetSelected', subjectId: w2, attackerId: w2, targetId: boy, kind: 'shoot' }).some((o) => o.ployId.startsWith('fk.x.rfa'))).toBe(false)
    // a non-Warrior never gets Ready for Anything
    const tr = A(spent, 'tracker')
    const t2 = take(take(activateOp(place(place(spent, tr, 0, 0), boy, 6, 0), tr), 'shoot').state, 'fk.w.kroot-rifle').state
    expect(t2.pending!.kind === 'ploy.firefight' ? optionIds(t2).filter((x) => /rfa/.test(x)) : []).toEqual([])

    // ---- Meat and Trophy at the start of an activation
    const m = open({ equipmentA: ['fk.e.meat', 'fk.e.trophy'] })
    const cut = A(m, 'cut-skin')
    const hurt = edit(m, (st) => {
      st.operatives[cut]!.wounds = 3
      st.operatives[A(m, 'tracker')]!.wounds = 3
    })
    const start = take(take(hurt, cut).state, 'engage').state
    expect(optionIds(start)).toEqual(expect.arrayContaining(['fk.e.meat', 'fk.e.trophy']))
    const healed = take(start, 'fk.e.meat', dice(4)).state
    // D3 + 1 with a roll of 4 is 2 + 1
    expect(healed.operatives[cut]!.wounds).toBe(6)
    expect(healed.ledger.A.tp).toContain('fk.meat.tp')
    const boosted = take(healed, 'fk.e.trophy').state
    expect(effectiveApl(boosted.operatives[cut]!)).toBe(3)
    expect(boosted.ledger.A.battle).toContain('fk.trophy.battle')
    // a later activation: Meat is spent for the turning point, Trophy for the battle
    const tr2 = A(m, 'tracker')
    const later = edit(boosted, (st) => {
      st.firefight.activation = { operativeId: tr2, seat: 'A', counteract: false, stage: 'action', apSpent: 0, performed: [], declared: null }
    })
    expect(offersFor(later, 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: tr2, counteracting: false })).toEqual([])
  })

  it('TEAM-FK-025 TEAM-FK-026 TEAM-FK-027 TEAM-FK-028 Cut-Throats, Rogue, Prey and Bound', () => {
    const s = open()
    const boy = B(s, 'boy')
    // Cut-Throats: +1 Atk to melee weapons, 5 at most
    const atk = (st: GameState, id: string, weaponId: string) => attackStats(st, id, weaponId, boy, { kind: 'fight', assists: [] }).atk
    const ct = withFx(s, { source: 'fk.p.cut-throats' })
    const cases: [string, string, number][] = [
      [A(s, 'tracker'), 'fk.w.blade', 4],
      [A(s, 'kill-broker'), 'fk.w.ritual-blade', 5],
      [A(s, 'stalker'), 'fk.w.stalkers-blade', 5],
      [A(s, 'cut-skin'), 'fk.w.cut-skins-blades', 5],
      [A(s, 'hound'), 'fk.w.ripping-fangs', 5],
    ]
    for (const [id, weapon, want] of cases) {
      expect(atk(s, id, weapon), weapon).toBe(want === 4 ? 3 : 4)
      expect(atk(ct, id, weapon), weapon).toBe(want)
    }
    // Rogue: Saturate goes, and one more cover save (or one as a crit) unless Vantage already improved the cover
    const burna = B(s, 'burna-boy')
    const flamer = s.data.weapons['kom.w.burna-standard']!
    const rogue = withFx(s, { source: 'fk.p.rogue' })
    const hasSat = (st: GameState) => effectiveRules(st, st.operatives[burna]!, flamer, 'shoot', A(s, 'tracker')).some((r) => r.rule === 'saturate')
    expect(hasSat(s)).toBe(true)
    expect(hasSat(rogue)).toBe(false)
    expect(providerStealthy(s, rogue.operatives[A(s, 'tracker')]!)).toBe(0)
    expect(providerStealthy(rogue, rogue.operatives[A(s, 'tracker')]!)).toBe(1)
    expect(providerStealthy(rogue, rogue.operatives[burna]!)).toBe(0)
    const vantage = edit(rogue, (st) => {
      st.attack = { kind: 'shoot', stage: 'weapon', operativeId: burna, seat: 'B', weaponId: 'kom.w.burna-standard', pointBlank: false, targets: [], candidates: [], index: 0, seq: null, incapacitated: [], stunned: [], inherit: null, windows: [], status: { cover: true, obscured: false, improvedCover: true } }
    })
    expect(providerStealthy(vantage, vantage.operatives[A(s, 'tracker')]!)).toBe(0)

    // Prey: Balanced + Severe for a shooter that has not Charged, Fallen Back or Repositioned; Ceaseless + Severe on top of Balanced
    const tracker = A(s, 'tracker')
    const rifle = s.data.weapons['fk.w.kroot-rifle']!
    const prey = withFx(s, { source: 'fk.p.prey' })
    const names = (st: GameState, performed: string[], target = boy) => {
      const t = edit(st, (x) => {
        x.firefight.activation = { operativeId: tracker, seat: 'A', counteract: false, stage: 'action', apSpent: performed.length, performed, declared: null }
      })
      return effectiveRules(t, t.operatives[tracker]!, rifle, 'shoot', target).map((r) => r.rule).sort()
    }
    expect(names(s, [])).toEqual([])
    expect(names(prey, [])).toEqual(['balanced', 'severe'])
    expect(names(prey, ['dash'])).toEqual(['balanced', 'severe'])
    expect(names(prey, ['reposition'])).toEqual([])
    expect(names(prey, ['charge'])).toEqual([])
    expect(names(prey, ['fallBack'])).toEqual([])
    const marked = withFx(prey, { source: 'fk.mark', data: { markId: boy, due: 0, shriekedCurrent: false } })
    expect(names(marked, [])).toEqual(['balanced', 'ceaseless', 'severe'])

    // Bound: the first 2" of the first climb in each activation are free, never while counteracting
    const hill = withTerrain(s, 1, 3, -1, 1)
    const stage = edit(hill, (st) => {
      st.map = { ...st.map, features: [feature('hill', part('hill.a', rect(1, 3, -1, 1), 2, ['vantage']))] }
    })
    const climber = A(s, 'cut-skin')
    const at = (st: GameState, counteract = false) => {
      const t = edit(place(st, climber, 0, 0), (x) => {
        x.firefight.activation = { operativeId: climber, seat: 'A', counteract, stage: 'action', apSpent: 0, performed: [], declared: null }
      })
      return planMove(t, t.operatives[climber]!, 'reposition', [{ x: 1.8, z: 0, y: 2 }], counteract)
    }
    const costOf = (r: ReturnType<typeof planMove>) => (r.ok ? r.cost : NaN)
    const full = costOf(at(stage))
    const bound = costOf(at(withFx(stage, { source: 'fk.p.bound' })))
    expect(full - bound).toBe(2)
    expect(bound).toBeLessThan(full)
    // a second climb in the same activation is costed in full
    const spent = withFx(stage, { source: 'fk.p.bound' }, { source: 'fk.bound.used', operativeId: climber, expires: 'activation' })
    expect(costOf(at(spent))).toBe(full)
    // the saving is for the operative's own activation, never a counteraction
    const surcharge = (counteract: boolean) => {
      const t = edit(withFx(stage, { source: 'fk.p.bound' }), (x) => {
        x.firefight.activation = { operativeId: climber, seat: 'A', counteract, stage: 'action', apSpent: 0, performed: [], declared: null }
      })
      return providerMoveSurcharge(t, t.operatives[climber]!, 'reposition', [], { horizontal: 1, accessible: 0, climb: 2, drop: 0 })
    }
    expect(surcharge(false)).toBe(-2)
    expect(surcharge(true)).toBe(0)
  })

  it('TEAM-FK-029 TEAM-FK-030 TEAM-FK-031 Savage Ambush, Slip Away, Poach and Vengeance for the Kinband', () => {
    // ---- Savage Ambush: the ready defender with terrain in its control range resolves first
    const s = open()
    const w = A(s, 'warrior')
    const boy = B(s, 'boy')
    const near = withTerrain(edit(place(place(s, w, 0, 0), boy, -1.4, 0), (st) => {
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 60
      st.operatives[w]!.wounds = st.operatives[w]!.maxWounds = 60
    }), 0.8, 1.8, -1, 1)
    const b = bTurn(near, A(s, 'cut-skin'))
    const declared = playUntil(take(take(activateOp(b, boy), 'fight').state, w, dice(6, 6, 6, 6, 6, 6, 6, 6)).state, dice(), inWindow('fight.weaponsSelected'))
    void declared
    const rolledWindow = playUntil(take(take(activateOp(b, boy), 'fight').state, w).state, dice(6, 6, 6, 6, 6, 6, 6, 6), inWindow('fight.weaponsSelected'))
    expect(optionIds(rolledWindow)).toContain('fk.p.savage-ambush')
    const evs: GameEvent[] = []
    const amb = playUntil(take(rolledWindow, 'fk.p.savage-ambush').state, dice(6, 6, 6, 6, 6, 6, 6, 6), (st) => st.pending?.kind === 'firefight.action' || st.pending?.kind === 'firefight.activate', strikes, evs)
    const first = evs.filter((e) => e.type === 'Struck' || e.type === 'Blocked').map((e) => (e as { operativeId: string }).operativeId)
    expect(first[0]).toBe(w)
    void amb
    // not offered to an expended defender or one with no terrain beside it
    const expended = edit(rolledWindow, (st) => {
      st.operatives[w]!.ready = false
    })
    expect(offersFor(expended, 'A', 'fight.weaponsSelected', { window: 'fight.weaponsSelected', attackerId: boy, targetId: w, kind: 'fight' }).some((o) => o.ployId === 'fk.p.savage-ambush')).toBe(false)
    const bare = place(rolledWindow, w, 8, 8)
    expect(offersFor(bare, 'A', 'fight.weaponsSelected', { window: 'fight.weaponsSelected', attackerId: boy, targetId: w, kind: 'fight' }).some((o) => o.ployId === 'fk.p.savage-ambush')).toBe(false)

    // ---- Slip Away: Fall Back costs 1 AP for the activation
    const eng = engaged(s, w, boy)
    const started = take(take(eng, w).state, 'engage').state
    const fb = (st: GameState) => st.pending!.options!.find((o) => o.id === 'fallBack')!.data!.cost
    const withSlip = playUntil(take(started, 'fk.p.slip-away').state, dice(), (st) => st.pending?.kind === 'firefight.action')
    expect(fb(withSlip)).toBe(1)
    expect(fb(playUntil(started, dice(), (st) => st.pending?.kind === 'firefight.action'))).toBe(2)

    // ---- Poach: contesting a marker is enough for SECURE
    const m = s.markers.find((k) => k.kind === 'objective')!
    const duel = edit(place(place(s, w, m.pos.x + 0.9, m.pos.z), boy, m.pos.x - 1.5, m.pos.z), (st) => {
      st.turningPoint = 2
    })
    const act = (st: GameState) => abilityOffers(st, st.operatives[w]!, st.firefight.activation).map((o) => o.abilityId)
    const poachStart = take(take(duel, w).state, 'engage').state
    const without = playUntil(poachStart, dice(), (st) => st.pending?.kind === 'firefight.action')
    expect(act(without)).not.toContain('core.a.secure')
    const poached = take(poachStart, 'fk.p.poach').state
    expect(act(poached)).toContain('core.a.secure')

    // ---- Vengeance: Relentless against the enemy that took a kinsman, and the ploy waits until that enemy falls
    const v = open()
    const vw = A(v, 'warrior')
    const vboy = B(v, 'boy')
    const doomed = edit(place(place(v, vw, 0, 0), vboy, 4, 0), (st) => {
      st.operatives[vw]!.wounds = 1
    })
    const sh = take(take(activateOp(bTurn(doomed, A(v, 'cut-skin')), vboy), 'shoot').state, 'kom.w.slugga').state
    const win = playUntil(take(sh, vw, dice(6, 6, 6, 6)).state, dice(), inWindow('operative.incapacitated'))
    expect(optionIds(win)).toEqual([`fk.p.vengeance-for-the-kinband:${vboy}`])
    const taken = take(win, `fk.p.vengeance-for-the-kinband:${vboy}`).state
    expect(hasToken(taken, vboy, 'fk.vengeance', 'A')).toBe(true)
    const tracker = A(v, 'tracker')
    const relentless = (st: GameState, id: string) => effectiveRules(st, st.operatives[id]!, st.data.weapons['fk.w.kroot-rifle']!, 'shoot', vboy).some((r) => r.rule === 'relentless')
    expect(relentless(taken, tracker)).toBe(true)
    expect(effectiveRules(taken, taken.operatives[tracker]!, taken.data.weapons['fk.w.kroot-rifle']!, 'shoot', B(v, 'grot')).some((r) => r.rule === 'relentless')).toBe(false)
    // while that enemy is in the killzone the ploy is refused for another fall; after it falls it is offered again
    const grot = B(v, 'grot')
    const again = (st: GameState, killer: string) =>
      offersFor(edit(st, (x) => { x.removal = { ids: [tracker], hooked: [], killers: { [tracker]: killer } } }), 'A', 'operative.incapacitated', { window: 'operative.incapacitated', subjectId: tracker }).some((o) => o.ployId === 'fk.p.vengeance-for-the-kinband')
    expect(again(taken, grot)).toBe(false)
    const after = edit(taken, (st) => {
      st.operatives[vboy]!.status = 'removed'
      st.operatives[vboy]!.tokens = []
    })
    expect(again(after, grot)).toBe(true)
  })
})
