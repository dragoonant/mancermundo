// S5c view-models: the odds the prompts show are the engine's own numbers, the fighter card lines carry full weapon profiles, the
// gang picker data adds up, the briefing covers every scenario, the end screen's casualty and points data match the engine's log,
// and the session menu flow keeps seats consistent. Pure logic: no DOM.
import { describe, expect, it } from 'vitest'
import { query, step, type GameState } from '@/engine'
import { dataBundle } from '../../src/client/game/adapter'
import { buildFixture, FIXTURES } from '../../src/client/dev/scenarios'
import { gangSummary } from '../../src/client/game/gangs'
import { decisionInfo } from '../../src/client/game/promptLabels'
import { bottleOdds, fightOdds, nerveOdds, pct, profileLines, shotOdds, shotSummary, statText, STAT_KEYS } from '../../src/client/game/odds'
import { briefingFor, ROUND_LINES, scenarioProgress } from '../../src/client/game/scenario'
import { parseParams } from '../../src/client/params'
import { describeSeats, seatsFor } from '../../src/client/store/session'
import { pointsBySource, resultHeadline } from '../../src/client/ui/EndScreen'
import { trayEntries } from '../../src/client/ui/CasualtyTray'
import { newRealGame, playGame } from '../fixtures/presentation'

const CLEAN = /undefined|\[object|NaN|null/

describe('shot odds', () => {
  const shoot = (() => {
    const g = newRealGame('s5c-shoot')
    return buildFixture('shoot', g.state)
  })()

  it('the shoot fixture reaches a target prompt for seat A', () => {
    expect(shoot).not.toBeNull()
    expect(shoot!.state.pending!.kind).toBe('shoot.target')
    expect(shoot!.state.pending!.seat).toBe('A')
    expect(shoot!.select).toBe(String(shoot!.state.pending!.context.fighterId))
  })

  it('every fighter target carries the engine\'s chances and a clean summary', () => {
    const s = shoot!.state
    const p = s.pending!
    let seen = 0
    for (const o of p.options!) {
      const id = (o.action.payload as { targetId?: string }).targetId
      if (!id) continue
      const odds = shotOdds(s, p, o)!
      expect(odds, id).not.toBeNull()
      const d = o.data as { chance: number; need: number; band: string; cover: string; distance: number }
      expect(odds.pHit).toBeCloseTo(d.chance, 6)
      expect(odds.hitNeed).toBe(d.need)
      expect(odds.band).toBe(d.band)
      expect(odds.cover).toBe(d.cover)
      const ctx = p.context as { fighterId: string; weaponId: string; profileId: string }
      const eo = query.expectedOutcome(s, ctx.fighterId, ctx.weaponId, ctx.profileId, id)
      expect(odds.pWound).toBeCloseTo(eo.pWoundPerHit, 6)
      expect(odds.pOutOfAction).toBeCloseTo(eo.pOutOfAction, 6)
      expect(odds.pSeriouslyInjured).toBeCloseTo(eo.pSeriouslyInjured, 6)
      expect(odds.woundNeed).toBeGreaterThanOrEqual(2)
      expect(odds.woundNeed).toBeLessThanOrEqual(6)
      expect(shotSummary(odds)).not.toMatch(CLEAN)
      seen++
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('a door option has no fighter odds (null), and a pending without a shooter gives null', () => {
    const s = shoot!.state
    const p = s.pending!
    const door = { ...p.options![0]!, action: { ...p.options![0]!.action, payload: { doorId: 'x' } } } as typeof p.options extends (infer T)[] | undefined ? T : never
    expect(shotOdds(s, p, door)).toBeNull()
    expect(shotOdds(s, { ...p, context: {} }, p.options![0]!)).toBeNull()
  })

  it('titles, hints and why-lines are written for the shoot kinds', () => {
    const s = shoot!.state
    const info = decisionInfo(s.pending!, s)
    expect(info.title).toBe('Choose a target')
    expect(info.hint.length).toBeGreaterThan(20)
    expect(info.why).toMatch(/pin|cover|range/i)
    expect(info.hint + info.why).not.toMatch(CLEAN)
  })
})

describe('fighter card data', () => {
  it('lists every weapon profile of a fighter with a full, clean line', () => {
    const { state } = newRealGame('s5c-card')
    let profiles = 0
    for (const f of Object.values(state.fighters)) {
      const lines = profileLines(state, f.id)
      expect(lines.length, f.name).toBeGreaterThanOrEqual(f.weapons.length)
      for (const l of lines) {
        profiles++
        for (const v of [l.weaponName, l.range, l.acc, l.strength, l.ap, l.damage, l.ammo]) {
          expect(String(v).length).toBeGreaterThan(0)
          expect(String(v)).not.toMatch(CLEAN)
        }
        for (const t of l.traits) expect(state.data.traits[t.trait], t.trait).toBeDefined()
      }
    }
    expect(profiles).toBeGreaterThan(20)
    // a melee weapon is "Engaged" at range; strength follows the wielder (S+1 for an axe)
    const leader = Object.values(state.fighters).find((f) => f.role === 'leader' && f.seat === 'A')!
    const chain = profileLines(state, leader.id).find((l) => l.weaponId === 'core.w.chainaxe')!
    expect(chain.range).toContain('Engaged')
    expect(chain.strength).toBe(String(query.stat(state, leader.id, 'S') + 1))
  })

  it('prints characteristics the way profiles do', () => {
    expect(STAT_KEYS).toHaveLength(12)
    expect(statText('M', 4)).toBe('4"')
    expect(statText('BS', 3)).toBe('3+')
    expect(statText('S', 4)).toBe('4')
    expect(pct(0.3333)).toBe('33%')
    expect(pct(null)).toBe('-')
  })

  it('an unknown fighter gives null odds, never throws', () => {
    const { state } = newRealGame('s5c-null')
    const f = Object.values(state.fighters)[0]!
    for (const v of [fightOdds(state, 'nobody', [], []), nerveOdds(state, 'nobody')]) expect(v).toBeNull()
    expect(nerveOdds(state, f.id)).not.toBeNull()
    const dressed = buildFixture('card', state)!.state
    const b = bottleOdds(dressed, 'A')!
    expect(b.down).toBe(0)
    expect(b.crew).toBeGreaterThan(0)
  })
})

describe('gangs and briefings', () => {
  it('the four starter gangs list every fighter with costs that add up to the printed price', () => {
    const ids = Object.keys(dataBundle().starterGangs)
    expect(ids).toHaveLength(4)
    for (const id of ids) {
      const g = gangSummary(id)!
      expect(g.fighters.length).toBeGreaterThanOrEqual(8)
      expect(g.cost).toBeLessThanOrEqual(g.credits)
      expect(g.cost).toBeGreaterThan(g.credits - 25)
      for (const f of g.fighters) {
        expect(f.cost).toBeGreaterThan(0)
        expect(f.weapons.length).toBeGreaterThan(0)
        expect(Object.keys(f.stats)).toHaveLength(12)
      }
    }
    expect(gangSummary('nobody')).toBeNull()
  })

  it('every scenario has a briefing with an objective, a way to win and the five round lines', () => {
    for (const s of Object.values(dataBundle().scenarios)) {
      const b = briefingFor(s)
      expect(b.objective.length, s.id).toBeGreaterThan(40)
      expect(b.howToWin.length, s.id).toBeGreaterThan(20)
      expect(b.deployment.length, s.id).toBeGreaterThan(0)
      expect(b.scoring.length, s.id).toBeGreaterThan(0)
      expect(b.rounds).toHaveLength(5)
      expect(b.rounds).toBe(ROUND_LINES)
      for (const l of [...b.crew, ...b.deployment, ...b.scoring, b.howToWin]) expect(l, s.id).not.toMatch(CLEAN)
    }
    const tunnel = briefingFor(dataBundle().scenarios['scn.tunnel-skirmish']!)
    expect(tunnel.scoring.join(' ')).toMatch(/3 for a leader/)
    expect(tunnel.crew.join(' ')).toMatch(/10 fighters/)
  })

  it('the scenario progress reads points from the state', () => {
    const { state } = newRealGame('s5c-prog')
    const p = scenarioProgress(state)
    expect(p.points).toEqual({ A: 0, B: 0 })
    expect(p.lockedWinner).toBeNull()
  })
})

describe('end screen data', () => {
  const ended: GameState = (() => {
    const g = newRealGame('s5c-end')
    return buildFixture('end', g.state)!.state
  })()

  it('the end fixture plays a battle to its end', () => {
    expect(ended.phase).toBe('ended')
    expect(ended.result).not.toBeNull()
  })

  it('the headline names the winner, the scenario, how it ended and the rounds', () => {
    const h = resultHeadline(ended)
    expect(h.title).toMatch(/wins|draw/i)
    expect(h.sub).toContain('Tunnel Skirmish')
    expect(h.sub).toMatch(/round/)
    expect(h.title + h.sub).not.toMatch(CLEAN)
  })

  it('casualties per gang come from the engine\'s log and agree with where the fighters are', () => {
    const entries = trayEntries(ended)
    for (const e of entries) {
      const f = ended.fighters[e.fighterId]!
      expect(f.location === 'outOfAction' || f.location === 'fled' || f.posture === 'seriouslyInjured').toBe(true)
      expect(e.round).toBeGreaterThan(0)
    }
    const down = Object.values(ended.fighters).filter((f) => f.location === 'outOfAction' || f.location === 'fled' || (f.location === 'board' && f.posture === 'seriouslyInjured'))
    expect(entries.length).toBe(down.length)
  })

  it('points by source add up to what the engine scored', () => {
    const played = playGame('s5c-points', (s) => s.round >= 6, 4000)
    const events = played.steps.flatMap((x) => x.events)
    const by = pointsBySource(events)
    for (const seat of ['A', 'B'] as const) {
      const total = by[seat].reduce((a, l) => a + l.points, 0)
      const scored = events.filter((e) => e.type === 'PointsScored' && e.seat === seat).reduce((a, e) => a + (e.type === 'PointsScored' ? e.amount : 0), 0)
      expect(total).toBe(scored)
    }
  })
})

describe('menu flow and addresses', () => {
  it('opponent and seat choices map to seat modes and back', () => {
    expect(seatsFor('bot', 'A')).toEqual({ A: 'human', B: 'bot' })
    expect(seatsFor('bot', 'B')).toEqual({ A: 'bot', B: 'human' })
    expect(seatsFor('hotseat', 'B')).toEqual({ A: 'human', B: 'human' })
    expect(describeSeats({ A: 'human', B: 'human' })).toEqual({ opponent: 'hotseat', humanSeat: 'A' })
    expect(describeSeats({ A: 'bot', B: 'human' })).toEqual({ opponent: 'bot', humanSeat: 'B' })
  })

  it('?fixture is read from the address and every named fixture is known', () => {
    expect(parseParams('?test=1&fixture=shoot').fixture).toBe('shoot')
    expect(parseParams('').fixture).toBeNull()
    expect(FIXTURES).toContain('end')
    expect(buildFixture('nonsense', newRealGame('s5c-x').state)).toBeNull()
  })

  it('a fixture never changes the state it was given', () => {
    const g = newRealGame('s5c-pure')
    const before = JSON.stringify(g.state)
    buildFixture('card', g.state)
    expect(JSON.stringify(g.state)).toBe(before)
    // and the card fixture's state is one the engine still steps from
    const f = buildFixture('card', g.state)!
    expect(f.state.pending).not.toBeNull()
    const r = step(f.state, f.state.pending!.options![0]!.action)
    expect(r.rejection).toBeUndefined()
  })
})
