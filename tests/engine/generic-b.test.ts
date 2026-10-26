// M9 batch B engine prep: the generic capabilities Legionaries, Hand of the Archon, Hunter Clade and Hearthkyn
// Salvagers build on (docs/spec/12-rules-test-checklist.md, GEN-039 onwards). Throwaway providers and hooks are
// removed after each test, so nothing leaks.
import { afterEach, describe, expect, it } from 'vitest'
import { act } from '@/engine/actions'
import { step } from '@/engine'
import type { EngineBundle } from '@/engine/bundle'
import { createGame } from '@/engine/setup'
import { discCentres, footprintGap2D, footprintOf, rotationCost } from '@/engine/footprint'
import { bodyOf, distanceBetween, enemiesInControlRange } from '@/engine/measure'
import { planMove } from '@/engine/movement'
import { placementProblem } from '@/engine/terrain'
import { registerTeamRules, unregisterTeamRules, type TeamRuleProvider } from '@/engine/team-rules'
import type { GameState } from '@/engine/types'
import { hasKeyword } from '@/engine/conditions'
import { equipmentLimitFor } from '@/engine/equipment'
import { pickAlternatives, setOperativePick } from '@/engine/operative-picks'
import { view } from '@/engine'
import { capAwareLoadouts, defaultOperativePicks, loadoutCapProblems, loadBundle, teamCapProblems, validateOperativePicks, validateRoster, type DatacardData, type TeamData } from '../../src/data'
import { withCtx } from '../fixtures/real'
import { expectOk } from '../fixtures/helpers'
import { activateOp, edit, openReal, opOf, realBundle, realSetupWith, take } from '../fixtures/real'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})
export function provide(p: Omit<TeamRuleProvider, 'id'>): void {
  registerTeamRules({ id: 'test.provider-b', ...p })
  cleanups.push(() => unregisterTeamRules('test.provider-b'))
}

// 60x35mm oval: short-axis radius 0.689", centre to end disc 0.492", half the long axis 1.181"
const R = 35 / 25.4 / 2
const HALF = (60 - 35) / 25.4 / 2
const LONG = 60 / 25.4 / 2

/** Open map, A to activate; A's Intercessor Warrior made oval (long axis along +Z) at the origin. */
function ovalOpen(): { s: GameState; w: string; boy: string; grot: string } {
  const base = openReal()
  const w = opOf(base, 'A', 'aod.intercessor-warrior')
  const s = edit(base, (st) => {
    const o = st.operatives[w]!
    o.pos = { x: 0, y: 0, z: 0 }
    o.facing = 0
    o.baseRadius = R
    o.ovalHalfAxis = HALF
  })
  return { s, w, boy: opOf(s, 'B', 'kom.boy'), grot: opOf(s, 'B', 'kom.grot') }
}

describe('GEN batch B generic capabilities', () => {
  it('GEN-039 an oval base is three discs on its long axis; distances run from its ends and sides, round bases unchanged', () => {
    const { s, w, boy } = ovalOpen()
    const op = s.operatives[w]!
    expect(discCentres(footprintOf(op))).toHaveLength(3)
    const b = s.operatives[boy]!
    const ahead = edit(s, (st) => (st.operatives[boy]!.pos = { x: 0, y: 0, z: 3 }))
    const beside = edit(s, (st) => (st.operatives[boy]!.pos = { x: 3, y: 0, z: 0 }))
    expect(distanceBetween(bodyOf(ahead.operatives[w]!), bodyOf(ahead.operatives[boy]!))).toBeCloseTo(3 - LONG - b.baseRadius, 3)
    expect(distanceBetween(bodyOf(beside.operatives[w]!), bodyOf(beside.operatives[boy]!))).toBeCloseTo(3 - R - b.baseRadius, 3)
    // a round base has one disc and the plain disc gap
    expect(discCentres(footprintOf(b))).toHaveLength(1)
    expect(footprintGap2D(footprintOf(b), { pos: { x: b.pos.x + 5, z: b.pos.z }, baseRadius: b.baseRadius })).toBeCloseTo(5 - 2 * b.baseRadius, 6)
  })

  it('GEN-040 control range reaches 1" from the end of the long axis but not 1" past the side at the same centre distance', () => {
    const { s, w, boy } = ovalOpen()
    const r = s.operatives[boy]!.baseRadius
    const gap = 0.9
    const end = edit(s, (st) => (st.operatives[boy]!.pos = { x: 0, y: 0, z: LONG + r + gap }))
    expect(enemiesInControlRange(end, end.operatives[w]!, 'A').map((o) => o.id)).toContain(boy)
    const side = edit(s, (st) => (st.operatives[boy]!.pos = { x: LONG + r + gap, y: 0, z: 0 }))
    expect(enemiesInControlRange(side, side.operatives[w]!, 'A').map((o) => o.id)).not.toContain(boy)
    // and placing another base over the oval's end is an overlap
    const op = s.operatives[w]!
    const spot = { id: boy, pos: { x: 0, y: 0, z: LONG + r - 0.2 }, radius: r, height: 1 }
    expect(placementProblem(s, spot)?.code).toBe('E_OVERLAP')
    expect(placementProblem(s, { ...spot, pos: { x: R + r + 0.05, y: 0, z: 0 } })).toBeNull()
    void op
  })

  it('GEN-041 an oval base keeps its facing while it moves and pays the arc its end sweeps when it turns (FAQ)', () => {
    const { s, w } = ovalOpen()
    const op = s.operatives[w]!
    const slide = planMove(s, op, 'reposition', [{ x: 2, z: 0 }])
    expect(slide.ok && slide.facing).toBe(0)
    const quarter = rotationCost(footprintOf(op), 0, Math.PI / 2)
    expect(quarter).toBeCloseTo((LONG * Math.PI) / 2, 6)
    const turned = planMove(s, op, 'reposition', [{ x: 3, z: 0 }], false, undefined, undefined, Math.PI / 2)
    expect(turned.ok).toBe(true)
    if (turned.ok) {
      // the turn is its own increment, rounded up (1.86" -> 2")
      expect(turned.cost).toBe(3 + Math.ceil(quarter))
      expect(turned.facing).toBeCloseTo(Math.PI / 2, 3)
      expect(turned.breakdown.rotation).toBe(2)
    }
    expect(planMove(s, op, 'reposition', [{ x: 5, z: 0 }], false, undefined, undefined, Math.PI / 2).ok).toBe(false)
    // through the decision: the facing rides on the path payload
    const at = activateOp(s, w)
    const moving = take(at, 'reposition').state
    const r = expectOk(step(moving, act.pathFacing(moving.pending!, [{ x: 1, z: 0 }], Math.PI / 2)))
    expect(r.state.operatives[w]!.facing).toBeCloseTo(Math.PI / 2, 3)
    expect(r.state.operatives[w]!.movedThisActivation).toBe(1 + Math.ceil(quarter))
    // turning on the spot is a move of its own
    const spot = planMove(s, op, 'reposition', [{ x: 0, z: 0 }], false, undefined, undefined, Math.PI)
    expect(spot.ok && spot.cost).toBe(Math.ceil(LONG * Math.PI))
    expect(planMove(s, op, 'reposition', [{ x: 0, z: 0 }]).ok).toBe(false)
  })

  it('GEN-042 a round base turns for free and ignores the facing; an oval base only for loadouts with its weapon (data)', () => {
    const base = openReal()
    const boy = opOf(base, 'B', 'kom.boy')
    const s = edit(base, (st) => (st.operatives[boy]!.pos = { x: 0, y: 0, z: 0 }))
    const op = s.operatives[boy]!
    const p = planMove(s, op, 'reposition', [{ x: 2, z: 0 }], false, undefined, undefined, Math.PI)
    expect(p.ok && p.cost).toBe(2)
    expect(p.ok && p.facing).toBeCloseTo(Math.PI / 2, 6)
    // data: ovalBase with `weapons` applies to the loadout that carries one of them
    const card = realBundle.datacards['aod.intercessor-warrior']!
    const withOval: EngineBundle = { ...realBundle, datacards: { ...realBundle.datacards, [card.id]: { ...card, ovalBase: { long: 60, short: 35, weapons: ['aod.w.bolt-rifle'] } } } }
    const setup = realSetupWith()
    const idx = setup.rosters.A.findIndex((e) => e.datacardId === card.id)
    expect(idx).toBeGreaterThanOrEqual(0)
    const plain = createGame(setup, 'oval', withOval).state.operatives[`A${idx + 1}`]!
    expect(plain.ovalHalfAxis).toBeUndefined()
    setup.rosters.A[idx] = { datacardId: card.id, loadout: { weaponIds: ['aod.w.bolt-rifle'] } }
    const oval = createGame(setup, 'oval', withOval).state.operatives[`A${idx + 1}`]!
    expect(oval.baseRadius).toBeCloseTo(R, 3)
    expect(oval.ovalHalfAxis).toBeCloseTo(HALF, 3)
  })

  it('GEN-043 an operative keyword pick is a real keyword, public, defaulted when missing, rejected when barred, and can change', () => {
    const team = realBundle.teams['angels-of-death']!
    const choice = { id: 'mark', label: 'Mark', keywords: ['KHORNE', 'NURGLE'], exclude: [{ datacards: ['aod.intercessor-warrior'], keywords: ['KHORNE'] }] }
    const bundle: EngineBundle = { ...realBundle, teams: { ...realBundle.teams, [team.id]: { ...team, operativeChoices: [choice] } } }
    const setup = realSetupWith()
    const w = setup.rosters.A.findIndex((e) => e.datacardId === 'aod.intercessor-warrior')
    const cap = setup.rosters.A.findIndex((e) => e.datacardId !== 'aod.intercessor-warrior')
    setup.rosters.A[cap] = { ...setup.rosters.A[cap]!, picks: { mark: 'KHORNE' } }
    const s = createGame(setup, 'picks', bundle).state
    const capOp = s.operatives[`A${cap + 1}`]!
    const wOp = s.operatives[`A${w + 1}`]!
    expect(hasKeyword(s, capOp, 'KHORNE')).toBe(true)
    // missing pick: first allowed keyword (KHORNE is barred for the warrior)
    expect(wOp.picks).toEqual({ mark: 'NURGLE' })
    expect(view(s, 'B').operatives[wOp.id]!.picks).toEqual({ mark: 'NURGLE' })
    expect(pickAlternatives(s, wOp, 'mark')).toEqual([])
    const r = withCtx(s, (ctx) => {
      expect(setOperativePick(ctx, capOp.id, 'mark', 'NURGLE', 'test')).toBe(true)
      expect(setOperativePick(ctx, wOp.id, 'mark', 'KHORNE', 'test')).toBe(false)
    })
    expect(hasKeyword(r.state, r.state.operatives[capOp.id]!, 'NURGLE')).toBe(true)
    expect(r.events.filter((e) => e.type === 'OperativePickChanged')).toHaveLength(1)
    setup.rosters.A[w] = { ...setup.rosters.A[w]!, picks: { mark: 'KHORNE' } }
    expect(() => createGame(setup, 'picks', bundle)).toThrow(/cannot take KHORNE/)
  })

  it('GEN-044 data: operative picks validate per datacard with exclusions and defaults', () => {
    const db = loadBundle()
    const t = { ...db.teams['angels-of-death']!, operativeChoices: [{ id: 'mark', label: 'Mark', keywords: ['KHORNE', 'NURGLE'], exclude: [{ datacards: ['aod.intercessor-warrior'], keywords: ['KHORNE'] }] }] } as TeamData
    const warrior = db.byId['aod.intercessor-warrior'] as DatacardData
    expect(defaultOperativePicks(t, warrior)).toEqual({ mark: 'NURGLE' })
    expect(validateOperativePicks(t, warrior, { mark: 'NURGLE' })).toEqual([])
    expect(validateOperativePicks(t, warrior, { mark: 'KHORNE' })[0]).toMatch(/cannot be KHORNE/)
    expect(validateOperativePicks(t, warrior, {})[0]).toMatch(/not chosen/)
  })

  it('GEN-045 a team cap counts a keyword over every slot; loadout caps count carried weapons across the roster', () => {
    const db = loadBundle()
    const base = db.teams['angels-of-death']!
    const roster = Object.fromEntries(base.selection.slots.map((sl) => [sl.id, [] as string[]]))
    const ids = base.defaults!.roster!
    // put the default operatives back into their slots
    for (const id of ids) {
      const sl = base.selection.slots.find((x) => x.from.includes(id))!
      roster[sl.id]!.push(id)
    }
    const byId = db.byId as Record<string, DatacardData>
    expect(validateRoster(base, roster, byId).ok).toBe(true)
    const capped = { ...base, selection: { ...base.selection, caps: [{ label: 'ANGEL OF DEATH', keyword: 'ANGEL OF DEATH', max: 2 }] } } as TeamData
    expect(teamCapProblems(capped, ids, byId)[0]).toMatch(/at most 2 ANGEL OF DEATH/)
    expect(validateRoster(capped, roster, byId).ok).toBe(false)
    // loadout caps: two warriors may not both carry the bolt rifle
    const warrior = byId['aod.intercessor-warrior']!
    const lc = { ...base, selection: { ...base.selection, loadoutCaps: [{ weapons: ['aod.w.auto-bolt-rifle', 'aod.w.bolt-rifle'], max: 1, each: true }] } } as TeamData
    expect(loadoutCapProblems(lc, [['aod.w.bolt-rifle'], ['aod.w.bolt-rifle']])).toHaveLength(1)
    expect(loadoutCapProblems(lc, [['aod.w.bolt-rifle'], ['aod.w.auto-bolt-rifle']])).toEqual([])
    const picked = capAwareLoadouts(lc, [warrior, warrior, warrior], db.weaponGroups)
    const flat = picked.map((c) => Object.values(c).flat())
    expect(new Set(flat.map((x) => x.join())).size).toBe(3)
  })

  it('GEN-046 the equipment limit grows with a rostered datacard that grants extra equipment', () => {
    expect(equipmentLimitFor({ a: {}, b: { extraEquipment: 1 } }, ['a', 'a'])).toBe(4)
    expect(equipmentLimitFor({ a: {}, b: { extraEquipment: 1 } }, ['a', 'b'])).toBe(5)
    const card = realBundle.datacards['aod.intercessor-warrior']!
    const bundle: EngineBundle = { ...realBundle, datacards: { ...realBundle.datacards, [card.id]: { ...card, extraEquipment: 1 } } }
    const setup = realSetupWith({ equipmentA: ['core.e.ladders', 'core.e.portable-barricade', 'core.e.razor-wire', 'core.e.comms-device', 'core.e.mines'] })
    expect(() => createGame(setup, 'eq', realBundle)).toThrow(/more than 4/)
    expect(() => createGame(setup, 'eq', bundle)).not.toThrow()
  })
})
