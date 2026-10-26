// hand-of-the-archon engine tests, named by checklist id (docs/spec/12-rules-test-checklist.md, TEAM-HA-nnn).
// Hand of the Archon is seat A against the default Kommandos; the map is open ground unless a test says otherwise.
// Every ploy window is passed unless a test takes one (the shared drivers would pick the first offered option).
import { describe, expect, it } from 'vitest'
import { step, view } from '@/engine'
import { abilityOffers, maxRepeats } from '@/engine/abilities'
import { act } from '@/engine/actions'
import { attackStats, defenceStats, effectiveRules, inflict, parseRules, validTargets, weaponDamage } from '@/engine/attack-common'
import { actionCost } from '@/engine/firefight'
import { removeNow } from '@/engine/effects'
import { runHook } from '@/engine/hooks'
import { updateControl } from '@/engine/markers'
import { offersFor, usePloy } from '@/engine/ploys'
import { markerControl } from '@/engine/query'
import { ScriptedRng } from '@/engine/rng'
import { shootableWeapons } from '@/engine/shoot'
import { effectiveApl, effectiveMove } from '@/engine/state'
import { BRUTAL, DRUG, MARK, OMEN, PAIN, POISON, TEAM_ID, drugOf, gainPain, painOf, riflesApply } from '@/engine/teams/hand-of-the-archon'
import { readyChoiceDone } from '@/engine/strategy'
import { providerActionForbidden } from '@/engine/team-rules'
import { tokenCount } from '@/engine/tokens'
import type { GameState } from '@/engine/types'
import { loadBundle, loadoutCapProblems, validateRoster } from '../../../src/data'
import { evs, pick, play } from '../../fixtures/attack'
import { defaultAnswer } from '../../fixtures/helpers'
import { activateOp, edit, expectOk, hasOption, newRealGame, passIt, realBundle, roster, take, withCtx } from '../../fixtures/real'
import { A, B, MATCH, dice, noPloys, openHa, openWithGambits, pass, put, startHa, toWindow } from './hand-of-the-archon.hooks'

const data = loadBundle()
const team = data.teams[TEAM_ID]!
const cards = realBundle.datacards

/** Give an operative Pain tokens (owner A). */
const pain = (s: GameState, id: string, n = 1): GameState =>
  edit(s, (st) => {
    st.operatives[id]!.tokens = [...(st.operatives[id]!.tokens ?? []).filter((t) => t.kind !== PAIN), { kind: PAIN, owner: 'A', count: n, since: 0 }]
  })

/** End the activation, passing any ploy window first. */
function endIt(s: GameState): GameState {
  let t = s
  while (t.pending?.kind === 'ploy.firefight') t = passIt(t).state
  return take(t, 'end').state
}

/** Activate and shoot once with scripted dice; the sequence ends at the next firefight.action. */
function shoot(s: GameState, shooter: string, weapon: string, target: string, ...roll: number[]) {
  const rng = dice(...roll)
  let t = take(activateOp(s, shooter), 'shoot', rng).state
  t = take(t, weapon, rng).state
  return play(take(t, target, rng).state, rng, noPloys)
}

describe('TEAM-HA Hand of the Archon', () => {
  it('TEAM-HA-000 TEAM-HA-001 TEAM-HA-002 the team is playable; Archsybarite plus eight picks (Agents repeat) validates; the darklight cap counts both slots', () => {
    expect(TEAM_ID).toBe('hand-of-the-archon')
    expect(team.playable).toBe(true)
    const ok = { leader: ['ha.archsybarite'], main: ['ha.agent', 'ha.agent', 'ha.agent', 'ha.agent', 'ha.elixicant', 'ha.flayer', 'ha.gunner', 'ha.skysplinter-assassin'] }
    expect(validateRoster(team, ok, cards as never).ok).toBe(true)
    expect(validateRoster(team, { ...ok, main: [...ok.main.slice(0, 7), 'ha.agent'] }, cards as never).ok).toBe(true)
    expect(validateRoster(team, { ...ok, main: ['ha.gunner', 'ha.gunner', ...ok.main.slice(2)] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, main: [...ok.main, 'ha.agent'] }, cards as never).ok).toBe(false)
    expect(validateRoster(team, { ...ok, leader: ['kom.boss-nob'] }, cards as never).ok).toBe(false)
    const carried = (...w: string[][]) => w
    const bp = ['ha.w.blast-pistol', 'ha.w.venom-blade']
    const blaster = ['ha.w.blaster', 'ha.w.array-of-blades']
    const lance = ['ha.w.dark-lance', 'ha.w.array-of-blades']
    const cannon = ['ha.w.splinter-cannon-focused', 'ha.w.splinter-cannon-sweeping', 'ha.w.array-of-blades']
    expect(loadoutCapProblems(team, carried(bp, blaster), data.weaponGroups)).toEqual([])
    expect(loadoutCapProblems(team, carried(bp, blaster, lance), data.weaponGroups)).toHaveLength(1)
    expect(loadoutCapProblems(team, carried(bp, blaster, cannon), data.weaponGroups)).toEqual([])
    expect(Object.values(startHa().operatives).filter((o) => o.seat === 'A')).toHaveLength(9)
  })

  it('TEAM-HA-003 Cunning: passing first in the Gambit step gives 1 CP; a team strategy ploy first spoils it; a mission gambit first does not', () => {
    // the default start passes every gambit: A was first to pass, so Cunning paid out (2 start + 1 TP1 + 1)
    const s = startHa()
    expect(s.players.A.cp).toBe(s.players.B.cp + 1)
    // the hook directly: a team ploy used first, then a pass
    const g = edit(s, (st) => {
      st.strategy.gambit.order = [{ seat: 'A', gambitId: 'ha.p.blade-artists' }]
      st.ledger.A.tp = st.ledger.A.tp.filter((k) => k !== 'ha.cunning')
    })
    const before = g.players.A.cp
    expect(withCtx(g, (ctx) => runHook('gambit.passed', { seat: 'A', state: ctx.state, engine: ctx, data: { explicit: true, usedThisStep: ctx.state.strategy.gambit.order!, passes: 0 } })).state.players.A.cp).toBe(before)
    // a mission-pack gambit (no team) used first does not spoil it
    const m = edit(g, (st) => {
      st.data = { ...st.data, ploys: { ...(st.data.ploys ?? {}), 'mission.p.test': { id: 'mission.p.test', name: 'T', type: 'strategy', cost: 1, window: 'strategy.gambit', effect: { cp: 0 }, text: 't', source: 's' } } }
      st.strategy.gambit.order = [{ seat: 'A', gambitId: 'mission.p.test' }]
    })
    expect(withCtx(m, (ctx) => runHook('gambit.passed', { seat: 'A', state: ctx.state, engine: ctx, data: { explicit: true, usedThisStep: ctx.state.strategy.gambit.order!, passes: 0 } })).state.players.A.cp).toBe(before + 1)
    // a second pass in the same step never pays again
    const again = withCtx(m, (ctx) => {
      runHook('gambit.passed', { seat: 'A', state: ctx.state, engine: ctx, data: { explicit: true, usedThisStep: [], passes: 0 } })
      runHook('gambit.passed', { seat: 'A', state: ctx.state, engine: ctx, data: { explicit: true, usedThisStep: [], passes: 0 } })
    })
    expect(again.state.players.A.cp).toBe(before + 1)
  })

  it('TEAM-HA-004 Torturous Vision: a free Pain token as the Archsybarite picks a target, once per activation, never with a token, never counteracting', () => {
    const s0 = openHa()
    const arch = A(s0, 'archsybarite')
    const boy = B(s0, 'boy')
    const s = put(s0, { [arch]: [0, 0], [boy]: [5, 0] })
    const rng = dice()
    let t = take(take(activateOp(s, arch), 'shoot', rng).state, 'ha.w.blast-pistol', rng).state
    t = take(t, boy, rng).state
    expect(t.pending).toMatchObject({ kind: 'ploy.firefight', window: 'shoot.targetSelected' })
    expect(hasOption(t, 'ha.tv')).toBe(true)
    // not while counteracting, not with a token, not for anyone else
    const info = { window: 'shoot.targetSelected', subjectId: arch, attackerId: arch, targetId: boy, kind: 'shoot' }
    const asCounter = edit(t, (st) => {
      st.firefight.activation!.counteract = true
    })
    expect(offersFor(asCounter, 'A', 'shoot.targetSelected', info).some((o) => o.ployId === 'ha.tv')).toBe(false)
    expect(offersFor(pain(t, arch), 'A', 'shoot.targetSelected', info).some((o) => o.ployId === 'ha.tv')).toBe(false)
    const used = take(t, 'ha.tv').state
    expect(painOf(used, arch)).toBe(1)
    expect(used.firefight.activation!.used).toContain('ha.tv')
    expect(offersFor(used, 'A', 'shoot.targetSelected', info).some((o) => o.ployId === 'ha.tv')).toBe(false)
  })

  it('TEAM-HA-005 Sadistic Competition: the first Pain gain of a turning point also gives an Agent without a token one; a second gain gives nothing', () => {
    const s0 = openHa({ rosterA: roster(['ha.archsybarite', 'ha.agent', 'ha.agent', 'ha.crimson-duellist', 'ha.disciple-of-yaelindra', 'ha.elixicant', 'ha.flayer', 'ha.gunner', 'ha.skysplinter-assassin']) })
    const agents = Object.values(s0.operatives).filter((o) => o.seat === 'A' && o.datacardId === 'ha.agent').map((o) => o.id)
    const duel = A(s0, 'crimson-duellist')
    const s = put(s0, { [duel]: [0, 0], [agents[0]!]: [8, 0], [agents[1]!]: [3, 0] })
    const r = withCtx(s, (ctx) => {
      gainPain(ctx, duel, 1, 'test')
      gainPain(ctx, duel, 1, 'test')
    })
    expect(painOf(r.state, duel)).toBe(2)
    // the closest Agent without a token gains one, once per turning point
    expect(painOf(r.state, agents[1]!)).toBe(1)
    expect(painOf(r.state, agents[0]!)).toBe(0)
    // an Agent that gains its own token passes one to the other Agent
    const own = withCtx(s, (ctx) => {
      gainPain(ctx, agents[0]!, 1, 'test')
    })
    expect(painOf(own.state, agents[0]!)).toBe(1)
    expect(painOf(own.state, agents[1]!)).toBe(1)
  })

  it('TEAM-HA-006 Brutal Display: after a kill in its control range the Duellist cows a second enemy until the next turning point (it contests but never controls, no mission actions)', () => {
    const s0 = openHa()
    const duel = A(s0, 'crimson-duellist')
    const boy = B(s0, 'boy')
    const grot = B(s0, 'grot')
    const comms = B(s0, 'comms-boy')
    const s = edit(put(s0, { [duel]: [0, 0], [boy]: [1.4, 0], [grot]: [4, 3], [comms]: [12, 6] }), (st) => {
      st.operatives[boy]!.wounds = 1
    })
    const rng = dice(6, 6, 6, 6, 1, 1, 1, 1)
    let t = take(take(activateOp(s, duel), 'fight', rng).state, boy, rng).state
    const take_ = (p: { window: string; options?: { id: string }[] }) => p.window === 'operative.killed' && !!p.options?.some((o) => o.id === `ha.bd:${grot}`)
    t = play(t, rng, { 'ploy.firefight': (p) => (take_(p) ? pick(p, `ha.bd:${grot}`) : pass(p)) }, ['firefight.action']).state
    expect(t.operatives[boy]!.status).toBe('removed')
    expect(tokenCount(t, grot, BRUTAL)).toBe(1)
    expect(tokenCount(t, comms, BRUTAL)).toBe(0)
    // the cowed enemy adds nothing to marker control and cannot Pick Up Marker or perform a mission action
    const m = t.markers.find((k) => k.kind === 'objective')!
    // (the Grot never contests markers, so the control check uses a cowed Nob: same token, same rule)
    const nob = B(t, 'boss-nob')
    const cowed = edit(t, (st) => {
      st.operatives[nob]!.tokens = [...(st.operatives[nob]!.tokens ?? []), { ...st.operatives[grot]!.tokens!.find((k) => k.kind === BRUTAL)! }]
    })
    const near = put(cowed, { [nob]: [m.pos.x + 0.9, m.pos.z], [duel]: [m.pos.x - 10, m.pos.z - 6] })
    expect(markerControl(near, m).contesting.B).toEqual([nob])
    expect(markerControl(near, m).apl.B).toBe(0)
    expect(markerControl(near, m).controller).toBeNull()
    // it still contests: alone against an Agent it only denies the marker (APL 3 held to a tie with 2), and beside an
    // unmarked friend its APL still counts, so the friend controls (3 + 2 against 2)
    const agent = A(t, 'agent')
    const denied = put(near, { [agent]: [m.pos.x - 0.9, m.pos.z] })
    expect(markerControl(denied, m).apl).toEqual({ A: 2, B: 2 })
    expect(markerControl(denied, m).controller).toBeNull()
    const helped = put(denied, { [comms]: [m.pos.x, m.pos.z + 0.9] })
    expect(markerControl(helped, m).apl.B).toBe(5)
    expect(markerControl(helped, m).controller).toBe('B')
    expect(providerActionForbidden(t, t.operatives[grot]!, 'marker:pickUp')).toMatch(/Brutal Display/)
    expect(providerActionForbidden(t, t.operatives[grot]!, 'ability:core.a.secure')).toMatch(/Brutal Display/)
    expect(providerActionForbidden(t, t.operatives[grot]!, 'dash')).toBeNull()
    // once per turning point, and the token goes at the end of the turning point
    expect(t.ledger.A.tp).toContain('ha.brutal-display')
    expect(t.operatives[grot]!.tokens!.find((k) => k.kind === BRUTAL)!.expires).toEqual(['turningPointEnd'])
  })

  it('TEAM-HA-007 Crimson Duellist fights twice; Tangle: one block cancels two normals (a crit block any two), a normal block never takes a crit', () => {
    const s0 = openHa()
    const duel = A(s0, 'crimson-duellist')
    const boy = B(s0, 'boy')
    const s = put(s0, { [duel]: [0, 0], [boy]: [1.4, 0] })
    expect(maxRepeats(s, s.operatives[duel]!, 'fight', ['fight'])).toBe(2)
    expect(maxRepeats(s, s.operatives[duel]!, 'fight', ['fight', 'fight'])).toBe(2)
    expect(maxRepeats(s, s.operatives[A(s, 'agent')]!, 'fight', ['fight'])).toBe(1)
    const stopAt = (...d: number[]) => {
      const rng = dice(...d)
      return play(take(take(activateOp(s, duel), 'fight', rng).state, boy, rng).state, rng, noPloys, ['fight.resolve']).state
    }
    // one crit (6) against two normals: the crit block takes both; options list the double block
    const two = stopAt(6, 1, 1, 1, 4, 4, 1, 1)
    expect(two.pending!.kind).toBe('fight.resolve')
    const ids = two.pending!.options!.map((o) => o.id)
    expect(ids.some((id) => id.startsWith('block2:'))).toBe(true)
    const blocked = take(two, ids.find((id) => id.startsWith('block2:'))!)
    expect(evs(blocked.events, 'Blocked')).toHaveLength(2)
    // a normal against one crit and one normal: it can block the normal only, and there is no double block
    const one = stopAt(3, 1, 1, 1, 6, 4, 1, 1)
    const oneIds = one.pending!.options!.map((o) => o.id)
    expect(oneIds.filter((id) => id.startsWith('block:'))).toEqual(['block:0->1'])
    expect(oneIds.some((id) => id.startsWith('block2:'))).toBe(false)
  })

  it('TEAM-HA-008 Stinger: the kill bursts D3 into every operative that sees it within 2 inches (friends too), and each one it downs bursts in turn', () => {
    const s0 = openHa()
    const dis = A(s0, 'disciple-of-yaelindra')
    const friend = A(s0, 'agent')
    const boy = B(s0, 'boy')
    const nob = B(s0, 'boss-nob')
    const grot = B(s0, 'grot')
    const s = edit(put(s0, { [dis]: [0, 0], [boy]: [5, 0], [friend]: [5, -2.5], [nob]: [5, 2.5], [grot]: [6.9, 1.2] }), (st) => {
      st.operatives[boy]!.wounds = 1
      st.operatives[grot]!.wounds = 2
    })
    // attack 6 1 1 1, defence 1 1 1, then bursts in id order: friend 5 (D3 3), nob 2 (1), grot 4 (2, downed), then the nob again 6 (3)
    const r = shoot(s, dis, 'ha.w.stinger-pistol', boy, 6, 1, 1, 1, 1, 1, 1, 5, 2, 4, 6)
    expect(r.state.operatives[boy]!.status).toBe('removed')
    expect(r.state.operatives[grot]!.status).toBe('removed')
    expect(r.state.operatives[friend]!.wounds).toBe(r.state.operatives[friend]!.maxWounds - 3)
    expect(r.state.operatives[nob]!.wounds).toBe(r.state.operatives[nob]!.maxWounds - 1 - 3)
  })

  it('TEAM-HA-009 Torment grenade: everyone within 1 inch of the target tests; 3+ is D3 damage and one Poison token; a holder takes D3 when activated, not when counteracting', () => {
    const s0 = openHa()
    const dis = A(s0, 'disciple-of-yaelindra')
    const friend = A(s0, 'agent')
    const boy = B(s0, 'boy')
    const grot = B(s0, 'grot')
    const far = B(s0, 'comms-boy')
    const s = put(s0, { [dis]: [0, 0], [boy]: [4, 0], [friend]: [3.5, -0.8], [grot]: [4.5, 0.8], [far]: [4, 2.5] })
    // tests in order: the target (Save 5+ adds 1) 4 -> 5, then 3 damage via D3 6; the friend (Save 4+ adds 1) 1 -> 2 fails; the Grot 2 -> 3 passes, D3 2 -> 1 damage
    const t = take(activateOp(s, dis), `ability:ha.a.torment-grenade:${boy}`, dice(4, 6, 1, 2, 2)).state
    expect(t.operatives[boy]!.wounds).toBe(t.operatives[boy]!.maxWounds - 3)
    expect(t.operatives[grot]!.wounds).toBe(t.operatives[grot]!.maxWounds - 1)
    expect(tokenCount(t, boy, POISON, 'A')).toBe(1)
    expect(tokenCount(t, grot, POISON, 'A')).toBe(1)
    expect(tokenCount(t, friend, POISON)).toBe(0)
    expect(tokenCount(t, far, POISON)).toBe(0)
    expect(t.operatives[friend]!.wounds).toBe(t.operatives[friend]!.maxWounds)
    // the holder takes D3 (here 2) when it is activated (the Pain-less friendly Poison kind is its own, not Plague Marines')
    const b = activateOp(endIt(t), boy, 'engage', dice(3))
    expect(b.operatives[boy]!.wounds).toBe(t.operatives[boy]!.wounds - 2)
    // a counteraction is not an activation: no Poison damage
    const spent = endIt(
      edit(t, (st) => {
        for (const o of Object.values(st.operatives)) if (o.seat === 'B') {
          o.ready = false
          o.order = 'engage'
        }
      }),
    )
    const c = take(spent, `counteract:${boy}`, dice(3)).state
    expect(c.operatives[boy]!.wounds).toBe(t.operatives[boy]!.wounds)
  })

  it('TEAM-HA-010 TEAM-HA-011 TEAM-HA-012 Power from Pain: 1 token for newly injuring or for a kill, 2 for a Wounds 12+ kill, one gain per action; any action, public, cleared on removal', () => {
    const s0 = openHa()
    const agent = A(s0, 'agent')
    const gunner = A(s0, 'gunner')
    const nob = B(s0, 'boss-nob')
    const boy = B(s0, 'boy')
    const grot = B(s0, 'grot')
    const base = put(s0, { [agent]: [0, 0], [gunner]: [0, 3], [nob]: [5, 0], [boy]: [6.5, 4], [grot]: [7.8, 4] })
    const rifle = (id: string, wounds: number) => shoot(edit(base, (st) => (st.operatives[id]!.wounds = wounds)), agent, 'ha.w.splinter-rifle', id, 3, 1, 1, 1, 1, 1)
    // one normal retained from the roll plus the Accurate one: 2 + 2 damage
    const injured = rifle(nob, 8)
    expect(injured.state.operatives[nob]!.wounds).toBe(4)
    expect(painOf(injured.state, agent)).toBe(1)
    // an enemy that was already injured before the action gives nothing
    expect(painOf(rifle(nob, 6).state, agent)).toBe(0)
    // a kill: Wounds 14 gives two tokens, Wounds 10 gives one
    const kill14 = rifle(nob, 4)
    expect(kill14.state.operatives[nob]!.status).toBe('removed')
    expect(painOf(kill14.state, agent)).toBe(2)
    expect(painOf(rifle(boy, 4).state, agent)).toBe(1)
    // a Torrent: one enemy downed and another newly injured is still one token
    const torrent = (() => {
      const st = edit(base, (x) => {
        x.operatives[boy]!.wounds = 4
        x.operatives[gunner]!.weapons = ['ha.w.array-of-blades', 'ha.w.shredder']
      })
      const rng = dice(3, 1, 1, 1, 1, 1, 1, 3, 1, 1, 1, 1, 1, 1)
      let t = take(take(activateOp(put(st, { [boy]: [5, 0], [grot]: [6.5, 0], [nob]: [10, 8] }), gunner), 'shoot', rng).state, 'ha.w.shredder', rng).state
      t = take(t, boy, rng).state
      return play(t, rng, { ...noPloys, 'shoot.target': (p) => (p.options!.some((o) => o.id === `add:${grot}`) ? pick(p, `add:${grot}`) : pick(p, 'done')) })
    })()
    expect(torrent.state.operatives[boy]!.status).toBe('removed')
    expect(torrent.state.operatives[grot]!.wounds).toBe(1)
    expect(painOf(torrent.state, gunner)).toBe(1)
    // gained after any action, free and counteractions included: the ledger pays out whatever kind of action ended
    const seeded = edit(base, (st) => {
      st.ledger.A.uses[`ha.pfp:${agent}`] = 1
    })
    const counter = withCtx(seeded, (ctx) => {
      runHook('action.ended', { seat: 'A', state: ctx.state, engine: ctx, operativeId: agent, data: { action: 'fight', counteract: true, free: true, activeSeat: 'B' } })
    })
    expect(painOf(counter.state, agent)).toBe(1)
    expect(counter.state.ledger.A.uses[`ha.pfp:${agent}`]).toBeUndefined()
    // public to both seats, gone with the holder
    for (const seat of ['A', 'B'] as const) expect(view(counter.state, seat).operatives[agent]!.tokens!.some((t) => t.kind === PAIN && t.count === 1)).toBe(true)
    const dead = withCtx(
      edit(counter.state, (st) => (st.operatives[agent]!.wounds = 0)),
      (ctx) => {
        removeNow(ctx, agent)
        updateControl(ctx)
      },
    )
    expect(tokenCount(dead.state, agent, PAIN)).toBe(0)
  })

  it('TEAM-HA-013 TEAM-HA-014 Dark Animus (+1 APL until the next activation starts) and Accelerated Rejuvenation (D3+1 wounds): one invigoration per activation', () => {
    const s0 = openHa()
    const agent = A(s0, 'agent')
    const base = edit(put(s0, { [agent]: [0, 0] }), (st) => {
      st.operatives[agent]!.wounds = 3
    })
    const s = pain(base, agent, 3)
    const atWindow = (rng = dice()) => take(take(s, agent, rng).state, 'engage', rng).state
    // Dark Animus: one more AP now, a token spent, and Rejuvenation is gone for this activation
    let t = atWindow()
    expect(t.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.activationStart' })
    expect(hasOption(t, 'ha.inv.animus')).toBe(true)
    expect(hasOption(t, 'ha.inv.rejuvenation')).toBe(true)
    t = take(t, 'ha.inv.animus').state
    expect(effectiveApl(t.operatives[agent]!)).toBe(3)
    expect(painOf(t, agent)).toBe(2)
    expect(hasOption(t, 'ha.inv.rejuvenation')).toBe(false)
    const acting = passIt(t).state
    expect(acting.pending!.kind).toBe('firefight.action')
    expect(acting.pending!.context.apRemaining).toBe(3)
    // after an action nothing more is offered (the limit is per activation)
    const after = take(acting, 'guard').state
    expect(after.pending?.kind === 'ploy.firefight' ? after.pending.options!.map((o) => o.id).filter((id) => id.startsWith('ha.inv')) : []).toEqual([])
    // it lasts through the end of the activation and goes when the operative's next activation starts, before any action
    const ended = endIt(after)
    expect(effectiveApl(ended.operatives[agent]!)).toBe(3)
    const next = withCtx(ended, (ctx) => {
      runHook('activation.start', { seat: 'A', state: ctx.state, engine: ctx, operativeId: agent, data: { previousOrder: 'engage', order: 'engage' } })
    }).state
    expect(effectiveApl(next.operatives[agent]!)).toBe(2)
    expect(next.effects.some((e) => e.kind === 'ha.darkAnimus')).toBe(false)
    // Accelerated Rejuvenation: D3+1 (roll 5 -> D3 3 -> 4), capped at starting wounds
    const r = take(atWindow(), 'ha.inv.rejuvenation', dice(5)).state
    expect(r.operatives[agent]!.wounds).toBe(7)
    expect(painOf(r, agent)).toBe(2)
    expect(hasOption(r, 'ha.inv.animus')).toBe(false)
    const capped = take(atWindow(dice()), 'ha.inv.rejuvenation', dice(6)).state
    expect(capped.operatives[agent]!.wounds).toBe(7)
    // nothing to spend, nothing offered
    expect(offersFor(pain(base, agent, 0), 'A', 'firefight.activationStart', { window: 'firefight.activationStart', subjectId: agent }).some((o) => o.ployId.startsWith('ha.inv'))).toBe(false)
  })

  it('TEAM-HA-015 Vitalised Surge: after a Charge-then-Fight kill a free Dash is offered (paid with the token the kill earned); 2 inches while counteracting; not from an enemy control range', () => {
    const s0 = openHa()
    const agent = A(s0, 'agent')
    const boy = B(s0, 'boy')
    const nob = B(s0, 'boss-nob')
    const base = edit(put(s0, { [agent]: [0, 0], [boy]: [5, 0] }), (st) => {
      st.operatives[boy]!.wounds = 1
    })
    const toAction = (s: GameState): GameState => {
      let t = s
      while (t.pending?.kind === 'ploy.firefight') t = passIt(t).state
      return t
    }
    const surge = (p: { window: string; options?: { id: string }[] }) => p.window === 'operative.killed' && !!p.options?.some((o) => o.id === 'ha.inv.surge')
    const run = (state: GameState, charge: boolean) => {
      let t = activateOp(state, agent)
      if (charge) {
        t = take(t, 'charge').state
        t = expectOk(step(t, act.path(t.pending!, [{ x: 3.7, z: 0 }]))).state
        t = toAction(t)
      }
      const rng = dice(6, 6, 6, 1, 1, 1, 1)
      t = take(take(t, 'fight', rng).state, boy, rng).state
      const offered: boolean[] = []
      const r = play(t, rng, { 'ploy.firefight': (p) => (offered.push(surge(p)), surge(p) ? pick(p, 'ha.inv.surge') : pass(p)) }, ['move.path', 'firefight.action'])
      return { ...r, offered: offered.some(Boolean) }
    }
    const r = run(base, true)
    expect(r.state.operatives[boy]!.status).toBe('removed')
    expect(r.offered).toBe(true)
    expect(r.state.pending).toMatchObject({ kind: 'move.path' })
    expect(r.state.pending!.constraints!.kind).toBe('dash')
    expect(painOf(r.state, agent)).toBe(0)
    // the Dash after a Charge is legal only through the surge: the activation did Charge and Fight
    expect(r.state.firefight.stack!.at(-1)!.performed).toEqual(['charge'])
    // counteracting: the Dash is capped at 2 inches
    const adjacent = put(base, { [boy]: [1.4, 0] })
    expect(run(adjacent, false).state.pending).toMatchObject({ kind: 'move.path' })
    const asCounter = (() => {
      let t = activateOp(adjacent, agent)
      t = edit(t, (st) => {
        st.firefight.activation!.counteract = true
      })
      const rng = dice(6, 6, 6, 1, 1, 1, 1)
      t = take(take(t, 'fight', rng).state, boy, rng).state
      return play(t, rng, { 'ploy.firefight': (p) => (surge(p) ? pick(p, 'ha.inv.surge') : pass(p)) }, ['move.path', 'firefight.action']).state
    })()
    expect(asCounter.pending!.constraints!.maxInches).toBeLessThanOrEqual(2)
    // still in another enemy's control range after the kill: no Surge
    const crowded = run(put(adjacent, { [nob]: [0, 1.4] }), false)
    expect(crowded.offered).toBe(false)
  })

  it('TEAM-HA-016 Stimulated Senses: after a roll, re-roll every die showing one result for a token; allowed on top of another invigoration, but only once', () => {
    const s0 = openHa()
    const agent = A(s0, 'agent')
    const nob = B(s0, 'boss-nob')
    const s = pain(put(s0, { [agent]: [0, 0], [nob]: [5, 0] }), agent, 3)
    const rng = dice(1, 1, 1, 6, 6, 6)
    // Dark Animus first, then the shot
    let t = take(take(take(s, agent, rng).state, 'engage', rng).state, 'ha.inv.animus', rng).state
    t = take(passIt(t, rng).state, 'shoot', rng).state
    t = take(take(t, 'ha.w.splinter-rifle', rng).state, nob, rng).state
    expect(t.pending).toMatchObject({ kind: 'ploy.firefight', window: 'shoot.beforeAttackRerolls' })
    const info = { window: 'shoot.beforeAttackRerolls', subjectId: agent, attackerId: agent, targetId: nob, kind: 'shoot' }
    expect(painOf(t, agent)).toBe(2)
    t = take(t, 'ha.inv.senses', rng).state
    expect(painOf(t, agent)).toBe(1)
    expect(t.pending).toMatchObject({ kind: 'dice.reroll' })
    // not again in this activation, and the grant is a re-roll of one result
    expect(offersFor(t, 'A', 'shoot.beforeAttackRerolls', info).some((o) => o.ployId === 'ha.inv.senses')).toBe(false)
    const r = take(t, 'ha.ss:v1', rng)
    expect(evs(r.events, 'DiceRerolled')[0]).toMatchObject({ source: 'ha.ss', before: [1, 1, 1], after: [6, 6, 6] })
    const done = play(r.state, rng, noPloys)
    // three crits and the retained normal against a Save 5+ that rolled 1s
    expect(done.state.operatives[nob]!.wounds).toBe(done.state.operatives[nob]!.maxWounds - 3 * 4 - 2)
  })

  it('TEAM-HA-017 TEAM-HA-018 Combat Drugs: the pick goes to every operative (only with an Elixicant); Painbringer, Adrenalight and Hypex do what they say', () => {
    const choose = (drug: string, rosterA?: ReturnType<typeof roster>) => openHa({ teamChoices: { A: { 'combat-drug': drug }, B: {} }, ...(rosterA ? { rosterA } : {}) })
    const hypex = choose('ha.a.hypex')
    const mine = Object.values(hypex.operatives).filter((o) => o.seat === 'A')
    expect(mine.every((o) => drugOf(hypex, o.id) === 'hypex')).toBe(true)
    expect(mine.every((o) => o.tokens!.filter((t) => t.kind === DRUG).length === 1)).toBe(true)
    // without an Elixicant the pick is ignored
    const noElixicant = choose('ha.a.hypex', roster(['ha.archsybarite', 'ha.agent', 'ha.agent', 'ha.agent', 'ha.agent', 'ha.agent', 'ha.agent', 'ha.agent', 'ha.agent']))
    expect(Object.values(noElixicant.operatives).filter((o) => o.seat === 'A' && drugOf(noElixicant, o.id) !== null)).toEqual([])
    // Painbringer: a die of 3 or more is cut by 1 on a 6 only
    const pb = choose('ha.a.painbringer')
    const agent = A(pb, 'agent')
    const boy = B(pb, 'boy')
    const hit = (amount: number, source: string, d: number[]) => {
      const r = withCtx(pb, (ctx) => void inflict(ctx, { targetId: agent, attackerId: boy, weaponId: 'kom.w.slugga', amount, source }), dice(...d))
      return r.state.operatives[agent]!.maxWounds - r.state.operatives[agent]!.wounds
    }
    expect(hit(3, 'normal', [6])).toBe(2)
    expect(hit(3, 'normal', [5])).toBe(3)
    expect(hit(2, 'crit', [6])).toBe(2)
    expect(hit(4, 'direct', [6])).toBe(4)
    // Adrenalight: in the Ready step the owner may pick one holder to gain a Pain token; the offers list the fewest
    // tokens first, ties to the Archsybarite (the AI takes the first)
    const adr = edit(choose('ha.a.adrenalight'), (st) => {
      for (const o of Object.values(st.operatives)) o.tokens = (o.tokens ?? []).filter((t) => t.kind !== PAIN)
      st.ledger.A.tp = []
    })
    const ready = (st: GameState) => {
      const at = edit(st, (x) => {
        x.phase = 'strategy'
        x.initiative = 'A'
        x.ledger.A.tp = []
        x.strategy = { step: 'ready', rolls: {}, gambit: { turn: 'A', passes: 0, used: { A: [], B: [] } }, readyChoices: ['A', 'B'] }
      })
      return withCtx(at, (ctx) => {
        runHook('turningPoint.start', { seat: 'A', state: ctx.state, engine: ctx, data: { turningPoint: 2 } })
        readyChoiceDone(ctx)
      }).state
    }
    const asked = ready(adr)
    expect(asked.pending).toMatchObject({ kind: 'ability.choice', seat: 'A', context: { readyStep: true } })
    expect(asked.pending!.options![0]!.data?.operativeId).toBe(A(adr, 'archsybarite'))
    const one = take(asked, 'ready:0').state
    const total = (st: GameState) => Object.values(st.operatives).filter((o) => o.seat === 'A').reduce((n, o) => n + painOf(st, o.id), 0)
    expect(painOf(one, A(adr, 'archsybarite'))).toBe(1)
    // Sadistic Competition also gives the Agent a token (once per turning point)
    expect(painOf(one, A(adr, 'agent'))).toBe(1)
    expect(total(one)).toBe(2)
    // one pick per Ready step: the Gambit step is next
    expect(one.strategy.step).toBe('gambit')
    // the next Ready step lists a holder with the fewest tokens (lowest id) first
    const two = take(ready(one), 'ready:0').state
    expect(painOf(two, A(adr, 'crimson-duellist'))).toBe(1)
    expect(total(two)).toBe(3)
    // any holder may be picked, and passing picks none
    const other = asked.pending!.options![3]!
    expect(painOf(take(asked, other.id).state, String(other.data?.operativeId))).toBe(1)
    expect(total(passIt(asked).state)).toBe(0)
    // Hypex: an injured operative keeps its Move (its Hit still worsens); Painbringer's loses 2"
    const hurt = (st: GameState) => edit(st, (x) => (x.operatives[A(st, 'agent')]!.wounds = 3))
    const hy = hurt(hypex)
    const pbh = hurt(pb)
    const ag = A(hy, 'agent')
    expect(effectiveMove(hy.operatives[ag]!, hy)).toBe(7)
    expect(effectiveMove(pbh.operatives[ag]!, pbh)).toBe(5)
    expect(attackStats(hy, ag, 'ha.w.array-of-blades', B(hy, 'boy'), { kind: 'fight' }).need).toBe(4)
  })

  it('TEAM-HA-019 Administer Drug: heal a friend within 3" by up to 2D3 or swap only its drug; the Elixicant may pick itself; not from an enemy control range', () => {
    const s0 = openHa()
    const elix = A(s0, 'elixicant')
    const agent = A(s0, 'agent')
    const far = A(s0, 'gunner')
    const boy = B(s0, 'boy')
    const s = edit(put(s0, { [elix]: [0, 0], [agent]: [2, 0], [far]: [8, 0] }), (st) => {
      st.operatives[agent]!.wounds = 3
    })
    const t = activateOp(s, elix)
    const ids = t.pending!.options!.map((o) => o.id)
    expect(ids).toEqual(expect.arrayContaining([`ability:ha.a.administer-drug:${agent}:heal`, `ability:ha.a.administer-drug:${agent}:hypex`, `ability:ha.a.administer-drug:${elix}:hypex`]))
    expect(ids).not.toContain(`ability:ha.a.administer-drug:${elix}:heal`)
    expect(ids.some((id) => id.includes(far))).toBe(false)
    const healed = take(t, `ability:ha.a.administer-drug:${agent}:heal`, dice(6, 6)).state
    expect(healed.operatives[agent]!.wounds).toBe(8)
    const swapped = take(t, `ability:ha.a.administer-drug:${agent}:hypex`).state
    expect(drugOf(swapped, agent)).toBe('hypex')
    expect(drugOf(swapped, elix)).toBe('painbringer')
    const self = take(t, `ability:ha.a.administer-drug:${elix}:adrenalight`).state
    expect(drugOf(self, elix)).toBe('adrenalight')
    // in an enemy control range the action is gone
    const engaged = activateOp(put(s, { [boy]: [-1.4, 0] }), elix)
    expect(engaged.pending!.options!.some((o) => o.id.startsWith('ability:ha.a.administer-drug'))).toBe(false)
  })

  it('TEAM-HA-020 Insensible to Pain trims Dmg of 3+ (not Devastating); Flay: the first crit strike lets you give a friend within 6" a Pain token', () => {
    const s0 = openHa()
    const flayer = A(s0, 'flayer')
    const agent = A(s0, 'agent')
    const far = A(s0, 'gunner')
    const boy = B(s0, 'boy')
    const lance = weaponDamage(s0, boy, 'ha.w.dark-lance', flayer, 'shoot')
    expect(lance).toEqual({ normal: 5, crit: 6 })
    expect(weaponDamage(s0, boy, 'ha.w.splinter-rifle', flayer, 'shoot')).toEqual({ normal: 2, crit: 3 })
    expect(weaponDamage(s0, boy, 'ha.w.dark-lance', agent, 'shoot')).toEqual({ normal: 6, crit: 7 })
    const r = withCtx(s0, (ctx) => void inflict(ctx, { targetId: flayer, attackerId: boy, weaponId: 'ha.w.shardcarbine', amount: 2, source: 'devastating' }))
    expect(r.state.operatives[flayer]!.wounds).toBe(r.state.operatives[flayer]!.maxWounds - 2)
    // Flay: two crits against a sturdy Boy; the pick comes at the end of the sequence
    const s = edit(put(s0, { [flayer]: [0, 0], [boy]: [1.4, 0], [agent]: [0, 3], [far]: [10, 0] }), (st) => {
      st.operatives[boy]!.wounds = st.operatives[boy]!.maxWounds = 30
    })
    const rng = dice(6, 6, 1, 1, 1, 1, 1, 1)
    const t = take(take(activateOp(s, flayer), 'fight', rng).state, boy, rng).state
    const flay = (p: { window: string; options?: { id: string }[] }) => p.window === 'fight.resolved' && !!p.options?.some((o) => o.id.startsWith('ha.flay:'))
    let offered: string[] = []
    const out = play(t, rng, {
      'ploy.firefight': (p) => {
        if (!flay(p)) return pass(p)
        offered = p.options!.map((o) => o.id)
        return pick(p, `ha.flay:${agent}`)
      },
    })
    expect(offered.sort()).toEqual([`ha.flay:${agent}`, `ha.flay:${flayer}`].sort())
    expect(painOf(out.state, agent)).toBe(1)
    // the Flayer did injure/hurt the Boy, so it also earned its own token from Power from Pain only if the Boy became injured (it did not)
    expect(painOf(out.state, flayer)).toBe(0)
  })

  it('TEAM-HA-021 Merciless Hunter: two Shoots with exactly one razorwing; two Shoots forbid MARK and MARK forbids the second Shoot', () => {
    const s0 = openHa()
    const sk = A(s0, 'skysplinter-assassin')
    const boy = B(s0, 'boy')
    const s = activateOp(put(s0, { [sk]: [0, 0], [boy]: [5, 0] }), sk)
    const op = s.operatives[sk]!
    expect(maxRepeats(s, op, 'shoot', ['shoot'])).toBe(2)
    expect(maxRepeats(s, op, 'shoot', ['shoot', 'shoot'])).toBe(2)
    expect(maxRepeats(s, op, 'shoot', ['shoot', 'ability:ha.a.mark'])).toBe(1)
    expect(maxRepeats(s, s.operatives[A(s, 'agent')]!, 'shoot', ['shoot'])).toBe(1)
    const second = (used: string[]) => {
      const t = edit(s, (st) => {
        st.firefight.activation!.performed = ['shoot']
        st.firefight.activation!.weaponsUsed = used
      })
      return shootableWeapons(t, t.operatives[sk]!, ['shoot']).map((w) => w.weaponId)
    }
    expect(second(['ha.w.razorwing'])).toEqual(['ha.w.shardcarbine'])
    expect(second(['ha.w.shardcarbine'])).toEqual(['ha.w.razorwing'])
    const marks = (performed: string[]) => {
      const t = edit(s, (st) => (st.firefight.activation!.performed = performed))
      return abilityOffers(t, t.operatives[sk]!, t.firefight.activation).filter((o) => o.abilityId === 'ha.a.mark')
    }
    expect(marks([]).length).toBeGreaterThan(0)
    expect(marks(['shoot']).length).toBeGreaterThan(0)
    expect(marks(['shoot', 'shoot'])).toEqual([])
  })

  it('TEAM-HA-022 Omen: picked once as the Firefight phase begins; an enemy pick re-rolls its 6s at once (no second re-roll); a friendly pick offers only its 1s', () => {
    // the pick: a free option when the first Firefight phase begins, public once taken
    let g = newRealGame(MATCH, 'omen').state
    const rolls = new ScriptedRng([6, 1, 6, 1])
    for (let i = 0; i < 800 && g.pending && !(g.pending.kind === 'ploy.firefight' && g.pending.window === 'firefight.start' && g.pending.seat === 'A'); i++) {
      g = expectOk(step(g, g.pending.kind === 'ploy.firefight' ? act.pass(g.pending) : defaultAnswer(g), rolls)).state
    }
    expect(g.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.start' })
    const ids = g.pending!.options!.map((o) => o.id)
    expect(ids).toContain(`ha.omen:${B(g, 'boy')}`)
    expect(ids).toContain(`ha.omen:${A(g, 'agent')}`)
    expect(ids).not.toContain(`ha.omen:${A(g, 'skysplinter-assassin')}`)
    const picked = take(g, `ha.omen:${B(g, 'boy')}`).state
    expect(tokenCount(picked, B(g, 'boy'), OMEN, 'A')).toBe(1)
    expect(picked.ledger.A.battle).toContain('ha.omen')
    expect(picked.pending?.options?.some((o) => o.id.startsWith('ha.omen:')) ?? false).toBe(false)
    // enemy pick: its 6s are re-rolled before anything else, once
    const s0 = openHa()
    const agent = A(s0, 'agent')
    const boy = B(s0, 'boy')
    const omen = (id: string, owner: 'A' | 'B') => (st: GameState) => void (st.operatives[id]!.tokens = [{ kind: OMEN, owner, count: 1, since: 0 }])
    const s = edit(put(s0, { [agent]: [0, 0], [boy]: [5, 0] }), omen(boy, 'A'))
    const r = shoot(s, agent, 'ha.w.splinter-rifle', boy, 1, 1, 1, 6, 6, 1, 2, 3)
    const forced = evs(r.events, 'DiceRerolled').filter((e) => e.source === 'ha.a.omen')
    expect(forced).toHaveLength(1)
    expect(forced[0]).toMatchObject({ side: 'defence', operativeId: boy, indexes: [0, 1], before: [6, 6], after: [2, 3] })
    // friendly pick: re-roll offers are limited to dice showing 1
    const f = edit(put(s0, { [agent]: [0, 0], [boy]: [5, 0] }), omen(agent, 'A'))
    const rng = dice(1, 3, 1)
    let t = take(take(activateOp(f, agent, 'engage', rng), 'shoot', rng).state, 'ha.w.splinter-rifle', rng).state
    t = take(t, boy, rng).state
    expect(t.pending).toMatchObject({ kind: 'dice.reroll' })
    const rolled = t.attack!.seq!.atk.dice.map((d) => d.value)
    for (const o of t.pending!.options!) for (const i of (o.action.payload as { dice: number[] }).dice) expect(rolled[i]).toBe(1)
  })

  it('TEAM-HA-023 MARK: a marked Conceal enemy in Light cover becomes a valid target for the Assassin and cannot be obscured; nobody else gains anything', () => {
    const s0 = openHa()
    const sk = A(s0, 'skysplinter-assassin')
    const agent = A(s0, 'agent')
    const boy = B(s0, 'boy')
    const wall = { id: 'ha-light', parts: [{ id: 'ha-light.a', footprint: [{ x: 4.3, z: -2 }, { x: 4.6, z: -2 }, { x: 4.6, z: 2 }, { x: 4.3, z: 2 }], height: 1, traits: ['light' as const] }] }
    const s = edit(put(s0, { [sk]: [0, 0], [agent]: [0, 2], [boy]: [5, 0] }), (st) => {
      st.map = { ...st.map, features: [wall] }
      st.operatives[boy]!.order = 'conceal'
    })
    const targets = (st: GameState, id: string, w: string) => validTargets(st, st.operatives[id]!, w).map((t) => t.id)
    expect(targets(s, sk, 'ha.w.shardcarbine')).not.toContain(boy)
    const t = take(activateOp(s, sk), `ability:ha.a.mark:${boy}`).state
    expect(tokenCount(t, boy, MARK, 'A')).toBe(1)
    expect(t.operatives[boy]!.tokens!.find((k) => k.kind === MARK)).toMatchObject({ sourceId: sk, expires: ['turningPointEnd'] })
    expect(targets(t, sk, 'ha.w.shardcarbine')).toContain(boy)
    expect(targets(t, agent, 'ha.w.splinter-rifle')).not.toContain(boy)
    // Seek Light for the marked enemy only, and the marked enemy is never obscured against the Assassin
    expect(effectiveRules(t, t.operatives[sk]!, t.data.weapons['ha.w.shardcarbine']!, 'shoot', boy).some((r) => r.rule === 'seek-light')).toBe(true)
    expect(effectiveRules(t, t.operatives[sk]!, t.data.weapons['ha.w.shardcarbine']!, 'shoot', B(t, 'grot')).some((r) => r.rule === 'seek-light')).toBe(false)
    const status = (shooter: string) => {
      const d = { obscured: true, inCover: false }
      runHook('target.status', { seat: 'A', state: t, operativeId: shooter, targetId: boy, data: d })
      return d.obscured
    }
    expect(status(sk)).toBe(false)
    expect(status(agent)).toBe(true)
  })

  it('TEAM-HA-024 Rifles: Accurate 1 on a splinter rifle unless the activation already did Charge, Fall Back or Reposition; never while counteracting', () => {
    const s0 = openHa()
    const agent = A(s0, 'agent')
    const boy = B(s0, 'boy')
    const s = activateOp(put(s0, { [agent]: [0, 0], [boy]: [5, 0] }), agent)
    const acc = (st: GameState, w = 'ha.w.splinter-rifle') => effectiveRules(st, st.operatives[agent]!, st.data.weapons[w]!, 'shoot', boy).filter((r) => r.rule === 'accurate').length
    expect(acc(s)).toBe(1)
    for (const a of ['reposition', 'charge', 'fallBack']) expect(acc(edit(s, (st) => (st.firefight.activation!.performed = [a])))).toBe(0)
    expect(acc(edit(s, (st) => (st.firefight.activation!.performed = ['shoot', 'dash'])))).toBe(1)
    expect(acc(edit(s, (st) => (st.firefight.activation!.counteract = true)))).toBe(0)
    // only the splinter rifle
    expect(riflesApply(s, s.operatives[agent]!)).toBe(true)
    expect(effectiveRules(s, s.operatives[A(s, 'archsybarite')]!, s.data.weapons['ha.w.splinter-pistol']!, 'shoot', boy).some((r) => r.rule === 'accurate')).toBe(false)
  })

  it('TEAM-HA-025 Blade Artists (melee Rending), Merciless Sadists (Balanced against the wounded) and Wicked Blades (array of blades Atk 4)', () => {
    const s = openWithGambits(['ha.p.blade-artists', 'ha.p.merciless-sadists'], { equipmentA: ['ha.e.wicked-blades'] })
    const agent = A(s, 'agent')
    const boy = B(s, 'boy')
    const rules = (st: GameState, w: string, kind: 'shoot' | 'fight', foe: string) => effectiveRules(st, st.operatives[agent]!, st.data.weapons[w]!, kind, foe).map((r) => r.rule)
    expect(rules(s, 'ha.w.array-of-blades', 'fight', boy)).toContain('rending')
    expect(rules(s, 'ha.w.splinter-rifle', 'shoot', boy)).not.toContain('rending')
    // Balanced only against an enemy below its starting wounds
    expect(rules(s, 'ha.w.splinter-rifle', 'shoot', boy)).not.toContain('balanced')
    const hurt = edit(s, (st) => (st.operatives[boy]!.wounds = 9))
    expect(rules(hurt, 'ha.w.splinter-rifle', 'shoot', boy)).toContain('balanced')
    expect(rules(hurt, 'ha.w.array-of-blades', 'fight', boy)).toContain('balanced')
    // Wicked Blades is an equipment option of the team: Atk 3 becomes 4
    expect(attackStats(s, agent, 'ha.w.array-of-blades', boy, { kind: 'fight' }).atk).toBe(4)
    const plain = openHa()
    expect(attackStats(plain, agent, 'ha.w.array-of-blades', boy, { kind: 'fight' }).atk).toBe(3)
    expect(s.players.A.cp).toBeLessThan(plain.players.A.cp)
  })

  it('TEAM-HA-026 From Darkness, Death offers (only as the operative activates) enemies that cannot target the operative and turns a normal into a crit at the first sequence; Denizens of Night re-rolls one defence die at range under cover', () => {
    const wall = { id: 'ha-light', parts: [{ id: 'ha-light.a', footprint: [{ x: 0.9, z: -2 }, { x: 1.2, z: -2 }, { x: 1.2, z: 2 }, { x: 0.9, z: 2 }], height: 1, traits: ['light' as const] }] }
    const s0 = openWithGambits(['ha.p.from-darkness-death', 'ha.p.denizens-of-night'])
    const agent = A(s0, 'agent')
    const boy = B(s0, 'boy')
    const nob = B(s0, 'boss-nob')
    // the Agent hides behind Light cover on Conceal; the Boy has no line round the wall, the Nob (to the north) does
    const s = edit(put(s0, { [agent]: [0, 0], [boy]: [6, 0], [nob]: [0, 8] }), (st) => {
      st.map = { ...st.map, features: [wall] }
      st.operatives[agent]!.order = 'conceal'
      st.operatives[boy]!.order = 'engage'
    })
    const rng = dice(3, 1, 1, 1, 1, 1)
    // activate the Agent and pick the enemy at the activation window
    const w = take(take(s, agent, rng).state, 'engage', rng).state
    expect(w.pending).toMatchObject({ kind: 'ploy.firefight', window: 'firefight.activationStart' })
    const fdd = w.pending!.options!.map((o) => o.id).filter((id) => id.startsWith('ha.fdd:'))
    expect(fdd).toContain(`ha.fdd:${boy}`)
    expect(fdd).not.toContain(`ha.fdd:${nob}`)
    // only as it is activated: never offered after one of its actions
    const fddAt = (win: string) => offersFor(w, 'A', win, { window: win, subjectId: agent }).filter((o) => o.id.startsWith('ha.fdd:')).length
    expect(fddAt('firefight.activationStart')).toBeGreaterThan(0)
    expect(fddAt('firefight.actionEnded')).toBe(0)
    let u = take(w, `ha.fdd:${boy}`, rng).state
    u = passIt(u, rng).state
    // the first sequence against the Boy: a choice to retain one normal as a crit
    u = take(take(u, 'shoot', rng).state, 'ha.w.splinter-rifle', rng).state
    u = take(u, boy, rng).state
    const out = play(u, rng, { ...noPloys, 'weapon.choice': (p) => pick(p, 'crit') }, ['firefight.action'])
    const retained = evs(out.events, 'AttackRetained')[0]!
    expect(retained).toMatchObject({ normal: 1, crit: 1 })
    expect(out.state.effects.some((e) => e.kind === 'ha.fdd')).toBe(false)
    // Denizens of Night: the shooter is more than 2" away and Light terrain stands between
    const d = edit(s, (st) => {
      st.effects.push({ id: 'e-den', source: 'ha.p.denizens-of-night', seat: 'A', kind: 'ployFlag', expires: 'turningPoint' })
      st.operatives[agent]!.order = 'engage'
    })
    const grants = (st: GameState) => defenceStats(st, agent, boy, 'kom.w.slugga', parseRules([]), false).grants.map((g) => g.id)
    expect(grants(d)).toContain('ha.denizens')
    expect(grants(put(d, { [boy]: [1.8, 0] }))).not.toContain('ha.denizens')
    expect(grants(edit(d, (st) => (st.map = { ...st.map, features: [] })))).not.toContain('ha.denizens')
    expect(grants(edit(d, (st) => (st.effects = [])))).not.toContain('ha.denizens')
  })

  it('TEAM-HA-027 TEAM-HA-028 Cruel Deception (Fall Back for 1 AP this activation), Heinous Arrogance (skip an activation), Devious Scheme (the next use of a taxed ploy costs 1 more, once)', () => {
    const s0 = openHa()
    const agent = A(s0, 'agent')
    const s = put(s0, { [agent]: [0, 0], [B(s0, 'boy')]: [1.4, 0] })
    let t = take(take(s, agent).state, 'engage').state
    expect(actionCost(t, t.operatives[agent]!, 'fallBack', t.firefight.activation)).toBe(2)
    t = take(t, 'ha.p.cruel-deception').state
    expect(t.players.A.cp).toBe(s.players.A.cp - 1)
    expect(actionCost(t, t.operatives[agent]!, 'fallBack', t.firefight.activation)).toBe(1)
    // it lasts for the activation only
    const ended = endIt(t)
    expect(actionCost(ended, ended.operatives[agent]!, 'fallBack', null)).toBe(2)
    // Heinous Arrogance: offered before the activation choice; using it passes the turn for 1 CP
    const g = toWindow('firefight.beforeActivation')
    expect(g.pending!.options!.map((o) => o.id)).toContain('ha.p.heinous-arrogance')
    const skipped = take(g, 'ha.p.heinous-arrogance').state
    expect(skipped.pending).toMatchObject({ kind: 'firefight.activate', seat: 'B' })
    expect(skipped.players.A.cp).toBe(g.players.A.cp - 1)
    expect(Object.values(skipped.operatives).filter((o) => o.seat === 'A' && o.ready)).toHaveLength(9)
    // Devious Scheme: after B pays for a firefight ploy; the next use costs 1 more, then it ends
    const boy = B(s0, 'boy')
    const ploy = 'kom.p.shake-it-off'
    const info = { window: 'firefight.activationStart', subjectId: boy, counteracting: false }
    const b0 = openHa()
    const offer = offersFor(b0, 'B', 'firefight.activationStart', info).find((o) => o.ployId === ploy)!
    expect(offer.cost).toBe(1)
    const used = withCtx(b0, (ctx) => usePloy(ctx, 'B', offer, info)).state
    const oppInfo = { window: 'ploy.opponentUsed', ployId: ploy, usedBy: 'B' }
    const scheme = offersFor(used, 'A', 'ploy.opponentUsed', oppInfo).find((o) => o.ployId === 'ha.p.devious-scheme')!
    expect(scheme.param).toBe(ploy)
    const taxed = withCtx(used, (ctx) => usePloy(ctx, 'A', scheme, oppInfo)).state
    expect(offersFor(taxed, 'A', 'ploy.opponentUsed', oppInfo).some((o) => o.ployId === 'ha.p.devious-scheme')).toBe(false)
    const again = edit(taxed, (st) => (st.ledger.B.tp = []))
    const info2 = { ...info, subjectId: B(s0, 'grot') }
    const dearer = offersFor(again, 'B', 'firefight.activationStart', info2).find((o) => o.ployId === ploy)!
    expect(dearer.cost).toBe(2)
    const paid = withCtx(again, (ctx) => usePloy(ctx, 'B', dearer, info2)).state
    expect(paid.effects.some((e) => e.kind === 'ha.deviousScheme')).toBe(false)
    const third = edit(paid, (st) => {
      st.ledger.B.tp = []
      st.players.B.cp = 3
    })
    expect(offersFor(third, 'B', 'firefight.activationStart', { ...info, subjectId: B(s0, 'comms-boy') }).find((o) => o.ployId === ploy)!.cost).toBe(1)
    // a ploy that cost nothing cannot be taxed
    const free = edit(used, (st) => (st.ledger.B.uses[`ha.paid:${ploy}`] = 0))
    expect(offersFor(free, 'A', 'ploy.opponentUsed', oppInfo).some((o) => o.ployId === 'ha.p.devious-scheme')).toBe(false)
  })

  it('TEAM-HA-029 Prey on the Wounded: after the attack roll against a wounded enemy, re-roll any attack dice for 1 CP; not against an unwounded one', () => {
    const s0 = openHa()
    const agent = A(s0, 'agent')
    const boy = B(s0, 'boy')
    const run = (wounds: number) => {
      const s = edit(put(s0, { [agent]: [0, 0], [boy]: [5, 0] }), (st) => (st.operatives[boy]!.wounds = wounds))
      const rng = dice(1, 1, 1, 6, 6, 6)
      let t = take(take(activateOp(s, agent, 'engage', rng), 'shoot', rng).state, 'ha.w.splinter-rifle', rng).state
      return take(t, boy, rng)
    }
    const full = run(10)
    expect(full.state.pending?.kind === 'ploy.firefight' ? full.state.pending.options!.map((o) => o.id) : []).not.toContain('ha.p.prey-on-the-wounded')
    const wounded = run(6)
    expect(wounded.state.pending).toMatchObject({ kind: 'ploy.firefight', window: 'shoot.beforeAttackRerolls' })
    const cp = wounded.state.players.A.cp
    const r = take(wounded.state, 'ha.p.prey-on-the-wounded', dice(6, 6, 6))
    expect(r.state.players.A.cp).toBe(cp - 1)
    expect(r.state.pending).toMatchObject({ kind: 'dice.reroll' })
    const ids = r.state.pending!.options!.map((o) => o.id)
    expect(ids).toContain('ha.prey:fails')
    const done = take(r.state, 'ha.prey:fails', dice(6, 6, 6))
    expect(evs(done.events, 'DiceRerolled')[0]).toMatchObject({ source: 'ha.prey', before: [1, 1, 1], after: [6, 6, 6] })
  })

  it('TEAM-HA-030 Chain Snare stops a Fall Back on any 4+ (no AP, locked for the turning point; a miss keeps it); Toxin Coating and Refined Poison are free, twice per turning point', () => {
    // Chain Snare: the Boy has more Wounds than the Agent, so one die
    const s0 = openHa({ equipmentA: ['ha.e.chain-snare', 'ha.e.toxin-coating', 'ha.e.refined-poison'] })
    const agent = A(s0, 'agent')
    const boy = B(s0, 'boy')
    const arch = A(s0, 'archsybarite')
    const engaged = put(s0, { [agent]: [0, 0], [boy]: [1.4, 0] })
    const bTurn = (st: GameState): GameState => activateOp(endIt(activateOp(st, arch)), boy)
    const miss = take(bTurn(engaged), 'fallBack', dice(3)).state
    expect(miss.pending).toMatchObject({ kind: 'move.path' })
    expect(miss.ledger.A.tp).not.toContain('ha.e.chain-snare')
    const hit = take(bTurn(engaged), 'fallBack', dice(4)).state
    expect(hit.pending).toMatchObject({ kind: 'firefight.action' })
    expect(hit.firefight.activation!.apSpent).toBe(0)
    expect(hit.firefight.activation!.barred).toContain('fallBack')
    expect(hasOption(hit, 'fallBack')).toBe(false)
    expect(hit.ledger.A.tp).toContain('ha.e.chain-snare')
    // used up for the turning point: the next Fall Back goes ahead
    const again = { action: 'fallBack', counteract: false, free: false, activeSeat: 'B' as const, cancel: false, bar: false }
    withCtx(hit, (ctx) => void runHook('action.declared', { seat: 'B', state: ctx.state, engine: ctx, operativeId: boy, action: 'fallBack', data: again as never }))
    expect(again.cancel).toBe(false)
    // Toxin Coating: Lethal 5+ for one fight sequence, twice per turning point
    const duel = A(s0, 'crimson-duellist')
    const f = put(s0, { [duel]: [0, 0], [boy]: [1.4, 0] })
    const win = take(take(activateOp(f, duel), 'fight').state, boy).state
    expect(win.pending).toMatchObject({ kind: 'ploy.firefight', window: 'fight.weaponsSelected' })
    expect(win.pending!.options!.map((o) => o.id)).toContain('ha.e.toxin-coating')
    const coated = take(win, 'ha.e.toxin-coating').state
    expect(effectiveRules(coated, coated.operatives[duel]!, coated.data.weapons['ha.w.razorflail']!, 'fight', boy).some((r) => r.rule === 'lethal' && r.target === 5)).toBe(true)
    const spent = edit(win, (st) => void (st.ledger.A.tp = ['ha.e.toxin-coating#1', 'ha.e.toxin-coating#2']))
    expect(offersFor(spent, 'A', 'fight.weaponsSelected', { window: 'fight.weaponsSelected', subjectId: duel, attackerId: duel, targetId: boy, kind: 'fight' }).some((o) => o.ployId === 'ha.e.toxin-coating')).toBe(false)
    // Refined Poison: +1 Normal Dmg for the whole action, then back to normal
    const sh = take(take(take(activateOp(put(s0, { [agent]: [0, 0], [boy]: [5, 0] }), agent), 'shoot').state, 'ha.w.splinter-rifle').state, boy).state
    expect(sh.pending).toMatchObject({ kind: 'ploy.firefight', window: 'shoot.targetSelected' })
    expect(weaponDamage(sh, agent, 'ha.w.splinter-rifle', boy, 'shoot')).toEqual({ normal: 2, crit: 4 })
    const refined = take(sh, 'ha.e.refined-poison').state
    expect(weaponDamage(refined, agent, 'ha.w.splinter-rifle', boy, 'shoot')).toEqual({ normal: 3, crit: 4 })
    const over = play(refined, dice(), noPloys).state
    expect(weaponDamage(over, agent, 'ha.w.splinter-rifle', boy, 'shoot')).toEqual({ normal: 2, crit: 4 })
    expect(weaponDamage(refined, agent, 'ha.w.shardcarbine', boy, 'shoot')).toEqual({ normal: 2, crit: 2 })
  })
})
