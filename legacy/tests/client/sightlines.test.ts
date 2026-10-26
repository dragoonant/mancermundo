// Sight-line evaluation (client/interaction/sightlines.ts) on the scenario fixtures: composed purely from engine
// queries (targetInfo / validTargets / expectedDamage), evaluated for a hypothetical position of one operative.
import { describe, expect, it } from 'vitest'
import { createGame, type GameState } from '@/engine'
import { buildScenario } from '@/client/dev/scenarios'
import { buildGameSetup, dataBundle, engineBundle } from '@/client/game/adapter'
import { fullBuild, resolveLayout, resolveMission, resolveTeam } from '@/client/game/defaults'
import { evaluateSight, evaluateThreat, hypothetical, measure, sightFor, threatFor } from '@/client/interaction/sightlines'
import { sightView } from '@/client/interaction/sightData'
import { expectedDamage } from '@/engine/query'

function base(name: string): GameState {
  const b = dataBundle()
  const setup = buildGameSetup(b, fullBuild(b, resolveTeam(b, 'aod')), fullBuild(b, resolveTeam(b, 'kom')), {
    layoutId: resolveLayout(b, '01').id,
    missionId: resolveMission(b, 'secure').id,
    mapId: 'prelim-1',
    auto: true,
  })
  return buildScenario(name, createGame(setup, `scenario-${name}`, engineBundle()).state)
}

const subject = (s: GameState, id: string, at = s.operatives[id]!.pos, performed: string[] = []) => ({ opId: id, at, performed })

describe('sightlines: the operative view', () => {
  const s = base('shoot-cover')
  const ev = evaluateSight(s, subject(s, 'A6'))
  const byId = new Map(ev.entries.map((e) => [e.id, e]))

  it('a concealed enemy in cover is visible but not a valid target', () => {
    const hidden = byId.get('B3')!
    expect(hidden.order).toBe('conceal')
    expect(hidden.visible).toBe(true)
    expect(hidden.inCover).toBe(true)
    expect(hidden.valid).toBe(false)
    expect(hidden.status).toBe('blocked')
    expect(hidden.reason).toMatch(/concealed in cover/)
    expect(hidden.expected).toBeNull()
  })

  it('engaged enemies are valid; cover and clear shots are told apart', () => {
    const cover = byId.get('B2')!
    const open = byId.get('B11')!
    expect(cover.valid && cover.inCover).toBe(true)
    expect(cover.status).toBe('cover')
    expect(open.valid && !open.inCover && !open.obscured).toBe(true)
    expect(open.status).toBe('valid')
    expect(ev.entries.find((e) => e.status === 'unseen')?.visible).toBe(false)
  })

  it('expected damage is the engine number for the best usable ranged profile, sorted high to low', () => {
    const open = byId.get('B11')!
    expect(open.weaponId).toBeTruthy()
    expect(open.expected).toBeCloseTo(expectedDamage(s, 'A6', open.weaponId!, 'B11').mean, 9)
    // no other usable profile does better
    for (const w of ev.weapons) expect(expectedDamage(s, 'A6', w, 'B11').mean).toBeLessThanOrEqual(open.expected! + 1e-9)
    const nums = ev.entries.map((e) => e.expected ?? -1)
    expect(nums).toEqual([...nums].sort((a, b) => b - a))
    // cover costs damage: the Boy in cover is a worse target than the Grot in the open
    expect(open.expected!).toBeGreaterThan(byId.get('B2')!.expected!)
  })

  it('evaluates a hypothetical end point without touching the real state', () => {
    const before = JSON.stringify(s.operatives.A6!.pos)
    const far = evaluateSight(s, subject(s, 'A6', { x: -13, y: 0, z: -10 }))
    expect(JSON.stringify(s.operatives.A6!.pos)).toBe(before)
    expect(hypothetical(s, 'A6', { x: 1, y: 0, z: 1 }).operatives.A6!.pos).toEqual({ x: 1, y: 0, z: 1 })
    expect(far.entries.filter((e) => e.valid).length).toBeLessThan(ev.entries.filter((e) => e.valid).length)
    expect(far.at).toEqual({ x: -13, y: 0, z: -10 })
  })

  it('memoises per state and position', () => {
    const a = sightFor(s, subject(s, 'A6'))
    expect(sightFor(s, subject(s, 'A6'))).toBe(a)
    expect(sightFor(s, subject(s, 'A6', { x: -7, y: 0, z: 5.2 }))).not.toBe(a)
  })

  it('Vantage: the upper floor sees the Boy below, and the number is the engine one with Accurate', () => {
    const v = base('vantage')
    const e = evaluateSight(v, subject(v, 'A6')).entries.find((x) => x.id === 'B2')!
    expect(v.operatives.A6!.pos.y).toBe(3)
    expect(e.valid).toBe(true)
    expect(e.expected).toBeCloseTo(expectedDamage(v, 'A6', e.weaponId!, 'B2').mean, 9)
    expect(e.from.y).toBeGreaterThan(3)
  })
})

describe('sightlines: the threat view', () => {
  const s = base('shoot-cover')

  it('Conceal in cover shuts out shooters that Engage cannot; Conceal never adds one', () => {
    // north of the light rubble heap on the centreline, with the Boys that shoot from the south side of it: on Conceal only shooters that ignore the cover can fire
    const at = { x: 0, y: 0, z: 3.5 }
    const moved = hypothetical(s, 'A6', at)
    const t = evaluateThreat(moved, subject(moved, 'A6', at))
    const ce = new Set(t.conceal.entries.map((e) => e.id))
    for (const id of ce) expect(t.engage.entries.some((e) => e.id === id)).toBe(true)
    expect(t.conceal.total).toBeLessThanOrEqual(t.engage.total + 1e-9)
    expect(t.engage.entries.length).toBeGreaterThan(0)
    expect(t.engage.entries.length).toBeGreaterThan(t.conceal.entries.length)
    // sorted by expected damage, each number the engine own
    const nums = t.engage.entries.map((e) => e.expected)
    expect(nums).toEqual([...nums].sort((a, b) => b - a))
    expect(t.engage.total).toBeCloseTo(nums.reduce((a, b) => a + b, 0), 9)
    expect(threatFor(moved, subject(moved, 'A6', at))).toBe(threatFor(moved, subject(moved, 'A6', at)))
  })
})

describe('sightlines: who is looked at', () => {
  const s = base('shoot-cover')
  it('no subject outside the Firefight or without a selection; the selected operative at its own spot', () => {
    expect(sightView(null, null, false, [], 'A6')).toBeNull()
    expect(sightView(s, null, false, [], null)).toBeNull()
    const v = sightView(s, null, false, [], 'A6')!
    expect(v.opId).toBe('A6')
    expect(v.after).toBeNull()
    expect(v.now.at).toEqual(s.operatives.A6!.pos)
  })
})

describe('sightlines: measure', () => {
  const s = base('shoot-cover')
  it('two points: straight-line inches and the rounded-up increment', () => {
    const r = measure(s, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4.2 })
    expect(r.kind).toBe('points')
    expect(r.inches).toBeCloseTo(5.162, 2)
    expect(r.rounded).toBe(6)
    expect(r.within1).toBe(false)
    expect(measure(s, { x: 0, y: 0, z: 0 }, { x: 0.6, y: 0, z: 0 }).within1).toBe(true)
  })

  it('two operatives: base-edge distance and sight both ways', () => {
    const a = s.operatives.A6!
    const b = s.operatives.B2!
    const r = measure(s, { ...a.pos, opId: 'A6' }, { ...b.pos, opId: 'B2' })
    expect(r.kind).toBe('ops')
    expect(r.inches).toBeCloseTo(Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) - a.baseRadius - b.baseRadius, 2)
    expect(r.inControlRange).toBe(false)
    expect(r.aSeesB).toMatchObject({ visible: true, inCover: true })
    expect(r.bSeesA?.visible).toBe(true)
    const hidden = measure(s, { ...a.pos, opId: 'A6' }, { ...s.operatives.B3!.pos, opId: 'B3' })
    expect(hidden.aSeesB).toMatchObject({ visible: true, inCover: true })
  })

  it('an operative and a point: distance from the base edge', () => {
    const a = s.operatives.A6!
    const r = measure(s, { ...a.pos, opId: 'A6' }, { x: a.pos.x + 3, y: 0, z: a.pos.z })
    expect(r.kind).toBe('op-point')
    expect(r.inches).toBeCloseTo(3 - a.baseRadius, 3)
    expect(r.pointVisible).not.toBeNull()
  })
})
