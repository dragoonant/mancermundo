// The client side of the four batch B teams (Legionaries, Hand of the Archon, Hunter Clade, Hearthkyn Salvagers):
// defaults from the team data, token looks and wording, shared keyword wording, the oval base turn preview, FLY
// availability and tainted objectives.
import { describe, expect, it } from 'vitest'
import { createGame, type GameState, type PendingDecision } from '@/engine'
import { defaultLoadoutFor, enumerateLoadoutChoices, resolveLoadoutChoice } from '@/engine/bundle'
import { markUsedBattle } from '@/engine/effects'
import { isTainted } from '@/engine/teams/legionaries'
import { buildGameSetup, dataBundle, engineBundle, flattenRoster } from '@/client/game/adapter'
import { buildProblems, defaultBuild, defaultRoster, equipmentLimitOf, resolveLayout, resolveMission } from '@/client/game/defaults'
import { lookupTerm } from '@/client/game/glossary'
import { describeEvent } from '@/client/game/labels'
import { bearingTo, canFlyNow, facingTowardEnemy, previewMove, turnedBy } from '@/client/interaction/controller'
import { baseOfCard } from '@/client/figures/OvalBase'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { STAND_INS } from '@/client/teams'
import { tokenDef } from '@/client/ui/tokenDefs'
import { tokenTip } from '@/client/ui/tokenInfo'

const BATCH_B = ['legionaries', 'hand-of-the-archon', 'hunter-clade', 'hearthkyn-salvagers'] as const

describe('batch B: defaults', () => {
  it('BB-C-001 the default build uses the team data (roster, loadouts, picks, equipment) and is legal', () => {
    const b = dataBundle()
    const mission = b.missions[resolveMission(b, 'secure').id]!
    for (const t of BATCH_B) {
      const team = b.teams[t]!
      const build = defaultBuild(b, team)
      expect(flattenRoster(team, build.roster), t).toEqual(team.defaults!.roster)
      expect(build.equipment.length, t).toBeGreaterThan(0)
      for (const e of build.equipment) expect(team.defaults!.equipment, `${t} ${e}`).toContain(e)
      expect(buildProblems(b, build, equipmentLimitOf(b, build, mission.equipmentLimit)), t).toEqual([])
      expect(Object.keys(defaultRoster(b, team)), t).toEqual(team.selection.slots.map((s) => s.id))
    }
    // data picks and loadout answers win over the first-allowed ones
    const lg = defaultBuild(b, b.teams.legionaries!)
    expect(lg.picks!.map((p) => p.mark)).toEqual(b.teams.legionaries!.defaults!.operativePicks!.map((p) => p.mark))
    const ha = defaultBuild(b, b.teams['hand-of-the-archon']!)
    expect(ha.loadouts[0]).toEqual(b.teams['hand-of-the-archon']!.defaults!.loadouts![0])
  })
})

describe('batch B: tokens and wording', () => {
  it('BB-C-002 every batch B token kind has its own name, glyph and glossary tooltip', () => {
    const kinds = ['ha.pain', 'ha.poison', 'ha.drug', 'ha.omen', 'ha.mark', 'ha.brutal-display', 'lg.unleash', 'lg.warded', 'hc.spot', 'hc.doctrine', 'hc.omnissiah', 'hk.grudge', 'hk.system-jam', 'hk.spot']
    const labels = new Set<string>()
    for (const k of kinds) {
      const d = tokenDef(k)
      expect(d.label, k).not.toMatch(/\./)
      expect(labels.has(d.label), `${k} label unique`).toBe(false)
      labels.add(d.label)
      expect(lookupTerm(d.term), `${k} -> ${d.term}`).not.toBeNull()
      expect(tokenTip({ kind: k, owner: 'A', count: 2 }).title, k).toContain('x2')
    }
    // Hand of the Archon venom is not the Plague Marine poison
    expect(tokenDef('ha.poison').term).not.toBe(tokenDef('pm.poison').term)
    expect(lookupTerm('Venom token')!.body).toMatch(/D3/)
    // data-driven detail lines
    expect(tokenTip({ kind: 'ha.drug', owner: 'A', count: 1, data: { drug: 'painbringer' } }).body).toMatch(/Painbringer/)
    expect(tokenTip({ kind: 'hc.doctrine', owner: 'A', count: 1, data: { mode: 'bulwark' } }).body).toMatch(/Imperative: Bulwark/)
    const ev = { seq: 1, type: 'TokenChanged', operativeId: 'A1', kind: 'ha.pain', owner: 'A', count: 1, delta: 1, reason: 'x' }
    expect(describeEvent(ev as never, null)).toMatch(/Pain token/)
  })

  it('BB-C-003 shared keywords read for both teams that carry them, and the verifier wording fixes hold', () => {
    for (const k of ['CHAOS', 'HERETIC ASTARTES', 'PSYKER', 'HEAVY GUNNER', 'ICON BEARER']) {
      const e = lookupTerm(k, 'keyword')
      expect(e, k).not.toBeNull()
      expect(e!.body, k).toMatch(/Plague Marine/)
      expect(e!.body, k).toMatch(/Legionar/)
    }
    expect(lookupTerm('NURGLE')!.body).toMatch(/5\+/)
    expect(lookupTerm('DIKTAT')!.body).toMatch(/within 6 inches/)
    expect(lookupTerm('RANGER')!.body).toMatch(/counteracting/)
    expect(lookupTerm('DOZR')!.body).toMatch(/Normal Dmg of 4 or more/)
  })

  it('BB-C-004 every batch B datacard has a body GLB, or is listed as a stand-in until it does', () => {
    const b = dataBundle()
    const manifestBodies = (JSON.parse(readFileSync(resolve(process.cwd(), 'public/assets/models/manifest.json'), 'utf8')) as { bodies: Record<string, unknown> }).bodies
    for (const t of BATCH_B) {
      const cards = Object.values(b.byId).filter((r) => (r as { team?: string }).team === t && 'figure' in (r as object)) as unknown as { figure: { archetype: string } }[]
      expect(cards.length, t).toBeGreaterThan(5)
      for (const c of cards) expect(!!manifestBodies[c.figure.archetype] || STAND_INS.has(c.figure.archetype), `${t} ${c.figure.archetype}`).toBe(true)
    }
  })
})

/** A real game of `team` (seat A) against Angels of Death with `tweak` applied to the setup. */
function gameWith(team: string, tweak: (setup: ReturnType<typeof buildGameSetup>) => void): GameState {
  const b = dataBundle()
  const setup = buildGameSetup(b, defaultBuild(b, b.teams[team]!), defaultBuild(b, b.teams['angels-of-death']!), { layoutId: resolveLayout(b, '01').id, missionId: resolveMission(b, 'secure').id, auto: true })
  tweak(setup)
  return createGame(setup, `bb-${team}`, engineBundle()).state
}

const movePending = (opId: string): PendingDecision => ({ kind: 'move.path', seat: 'A', id: 'm', constraints: { operativeId: opId, kind: 'reposition', maxInches: 6 }, context: {} }) as unknown as PendingDecision

describe('batch B: oval base, FLY and tainted objectives', () => {
  it('BB-C-005 an oval base is drawn with the engine half-axis and the turn preview prices the arc', () => {
    const b = dataBundle()
    const card = b.byId['hc.skitarii-ranger-gunner'] as unknown as { base: number; ovalBase: { long: number; short: number; weapons: string[] } }
    const o = baseOfCard(card, ['hc.w.transuranic-arquebus-mobile'])
    expect(o.baseRadius).toBeCloseTo(35 / 25.4 / 2, 3)
    expect(o.ovalHalfAxis).toBeCloseTo(25 / 25.4 / 2, 3)
    expect(baseOfCard(card, ['hc.w.arc-rifle']).ovalHalfAxis).toBeUndefined()
    expect(turnedBy(Math.PI - 0.1, 0.3)).toBeLessThan(0)
    expect(bearingTo({ x: 0, z: 0 }, { x: 1, z: 0 })).toBeCloseTo(Math.PI / 2, 5)

    const state = gameWith('hunter-clade', (s) => {
      const arquebus = enumerateLoadoutChoices(engineBundle(), 'hc.skitarii-ranger-gunner').find((c) => resolveLoadoutChoice(engineBundle(), 'hc.skitarii-ranger-gunner', c).weaponIds.includes('hc.w.transuranic-arquebus-mobile'))!
      for (const e of s.rosters.A) if (e.datacardId === 'hc.skitarii-ranger-gunner') e.loadout = resolveLoadoutChoice(engineBundle(), 'hc.skitarii-ranger-gunner', arquebus)
    })
    const gunner = Object.values(state.operatives).find((x) => x.seat === 'A' && x.ovalHalfAxis)
    expect(gunner, 'the gunner has an oval base').toBeDefined()
    // set it down in open ground, then turn it a quarter turn without a path
    const spot = { ...gunner!, pos: { x: 0, y: 0, z: 0 }, facing: 0 }
    const free = { ...state, operatives: { ...state.operatives, [gunner!.id]: spot } } as GameState
    const turn = previewMove(free, movePending(gunner!.id), [], Math.PI / 2)
    if (turn.plan) {
      expect(turn.plan.facing).toBeCloseTo(Math.PI / 2, 2)
      expect(turn.plan.cost).toBeGreaterThan(0)
    } else expect(turn.rejection, 'a blocked turn names its reason').not.toBeNull()
    // no facing and no path: nothing to plan
    expect(previewMove(free, movePending(gunner!.id), [], null).plan).toBeNull()
    const foes = { operatives: { e: { seat: 'B', status: 'active', wounds: 2, pos: { x: 3, y: 0, z: 0 } } } } as unknown as GameState
    expect(facingTowardEnemy(foes, { seat: 'A' }, { x: 0, z: 0 })).toBeCloseTo(Math.PI / 2, 3)
  })

  it('BB-C-006 FLY is offered to a Jump Pack Warrior only', () => {
    const state = gameWith('hearthkyn-salvagers', (s) => {
      s.rosters.A = [...s.rosters.A.filter((e) => e.datacardId !== 'hk.lokatr'), { datacardId: 'hk.jump-pack-warrior', loadout: defaultLoadoutFor(engineBundle(), 'hk.jump-pack-warrior') }]
    })
    const jp = Object.values(state.operatives).find((x) => x.seat === 'A' && x.datacardId === 'hk.jump-pack-warrior')!
    const plain = Object.values(state.operatives).find((x) => x.seat === 'A' && x.datacardId === 'hk.warrior')!
    expect(canFlyNow(state, movePending(jp.id))).toBe(true)
    expect(canFlyNow(state, movePending(plain.id))).toBe(false)
  })

  it('BB-C-007 a tainted objective is read from the engine ledger', () => {
    const state = gameWith('legionaries', () => undefined)
    expect(isTainted(state, 'obj-1')).toBe(false)
    markUsedBattle(state, 'A', 'lg.tainted:obj-1')
    expect(isTainted(state, 'obj-1')).toBe(true)
    expect(isTainted(state, 'obj-2')).toBe(false)
    expect(lookupTerm('Tainted objective')!.body).toMatch(/command point/)
  })
})
