import { describe, expect, it } from 'vitest'
import { act, query, step } from '@/engine'
import { coverFrom } from '@/engine/los'
import { dice, shootingGame } from '../fixtures/attack'
import { activate, edit, eventsOf, must, take } from '../fixtures/helpers'
import type { GameState } from '@/engine'

function shoot(s: GameState): GameState {
  const r = must(take(s, { action: 'shoot' }))
  return r.state
}

describe('BLAST: blasts, scatter and templates (R-9)', () => {
  it('BLAST-001 targeting a floor point with a Blast applies -2 to hit; a Smoke blast does not', () => {
    const s = shootingGame({ spots: { A3: { x: 0, z: -6, facing: 0 }, B3: { x: 5, z: 10 } }, loadouts: { A3: { weapons: ['test.w.launcher', 'atk.w.smoke'] } }, active: 'A3' })
    const point = { x: 0, z: 4 }
    const frag = query.blastPreview(s, 'A3', 'test.w.launcher', 'std', point)
    const smoke = query.blastPreview(s, 'A3', 'atk.w.smoke', 'std', point)
    expect(frag.need).toBe(6) // BS 4+, Long accuracy 0, -2 at a point
    expect(smoke.need).toBe(4)
    // through the decisions: weapon, point, aim
    let r = must(take(s, { action: 'shoot' }))
    r = must(take(r.state, { weaponId: 'test.w.launcher', profileId: 'std' }))
    r = must(take(r.state, { point: true }))
    expect(r.pending!.kind).toBe('shoot.aim')
    r = must(step(r.state, act.aim(r.pending!, point), dice(6, 2)))
    expect(eventsOf(r.events, 'TargetDeclared')[0]!.modifiers).toContainEqual({ label: 'blastAtPoint', value: -2 })
    expect(eventsOf(r.events, 'BlastPlaced')[0]).toMatchObject({ centre: point, radius: 1.5 })
  })

  it('BLAST-002 a missed blast scatters D6 inches in the scatter direction and stops where its centre meets a wall', () => {
    const s = shoot(shootingGame({ board: 'test.door', spots: { A3: { x: -6, z: -8, facing: 0 }, B3: { x: -6, z: -3 } }, loadouts: { A3: { weapons: ['test.w.launcher'] } }, active: 'A3' }))
    // miss (1), Firepower 2, scatter face 2 (arrow), direction 0 degrees (+z, toward the wall at z = 0), distance 6
    const r = must(take(s, { targetId: 'B3' }, dice(1, 2, 2, 0, 6)))
    const sc = eventsOf(r.events, 'BlastScattered')[0]!
    expect(sc).toMatchObject({ from: { x: -6, z: -3 }, distance: 6, direction: 0 })
    expect(sc.to.x).toBeCloseTo(-6, 6)
    expect(sc.to.z).toBeGreaterThan(-0.36)
    expect(sc.to.z).toBeLessThan(-0.25) // the wall face
    expect(eventsOf(r.events, 'BlastPlaced')[0]!.centre).toEqual(sc.to)
  })

  it('BLAST-003 scatter "Hit" plus a 1: a further 1 centres the blast on the shooter; 2-6 is a dud', () => {
    const s = shoot(shootingGame({ spots: { A3: { x: 0, z: -8, facing: 0 }, B3: { x: 0, z: -3 } }, loadouts: { A3: { weapons: ['test.w.launcher'] } }, active: 'A3' }))
    // miss, Firepower 2, scatter face 5 (Hit), direction 90, distance 1, misfire 1: on the shooter, who is hit (wound 1 fails)
    const on = must(take(s, { targetId: 'B3' }, dice(1, 2, 5, 90, 1, 1, 1)))
    expect(eventsOf(on.events, 'BlastScattered')[0]).toMatchObject({ misfire: true })
    expect(eventsOf(on.events, 'BlastPlaced')[0]!.centre).toEqual({ x: 0, z: -8 })
    expect(eventsOf(on.events, 'WoundRolled')[0]).toMatchObject({ targetId: 'A3' })
    expect(on.state.fighters.A3!.posture).toBe('pinned')
    const dud = must(take(s, { targetId: 'B3' }, dice(1, 2, 6, 90, 1, 4)))
    expect(eventsOf(dud.events, 'BlastScattered')[0]).toMatchObject({ misfire: true })
    expect(eventsOf(dud.events, 'BlastPlaced')).toHaveLength(0)
    expect(eventsOf(dud.events, 'WoundRolled')).toHaveLength(0)
  })

  it('BLAST-004 every fighter under the marker is hit except those with a wall between them and the centre; friends are hit too', () => {
    const s = shoot(
      shootingGame({
        board: 'test.door',
        spots: { A3: { x: 3, z: -8, facing: 0 }, B3: { x: 3, z: -1.2 }, A4: { x: 4.5, z: -1.6 }, B4: { x: 3, z: 0.8 } },
        loadouts: { A3: { weapons: ['atk.w.blast5'] } },
        active: 'A3',
      }),
    )
    // hit 6; B3 and A4 under the 5" marker (wounds 1, 1); B4 is under it too but behind the wall
    const r = must(take(s, { targetId: 'B3' }, dice(6, 1, 1)))
    expect(eventsOf(r.events, 'FighterPinned').map((e) => e.fighterId)).toEqual(['B3', 'A4'])
    expect(eventsOf(r.events, 'WoundRolled').map((e) => e.targetId)).toEqual(['B3', 'A4'])
    expect(r.state.fighters.B4!.posture).toBe('standing')
  })

  it('BLAST-005 a template hits every fighter under it with no hit roll and ignores target priority; fighters behind a wall are not hit', () => {
    const s = shoot(
      shootingGame({
        board: 'test.door',
        spots: { A4: { x: 3, z: -6, facing: 0 }, B2: { x: 5.2, z: -4.2 }, B3: { x: 3, z: -3 }, B4: { x: 3, z: 1.2 } },
        loadouts: { A4: { weapons: ['test.w.flamer'] } },
        active: 'A4',
      }),
    )
    expect(s.pending!.kind).toBe('shoot.aim')
    // B2 is the closest enemy but not under the template; Firepower 2, then B3's wound roll
    const preview = query.templatePreview(s, 'A4', 'test.w.flamer', 'std', { x: 3, z: 0 })
    expect(preview).toMatchObject({ problem: null, enemies: ['B3'] })
    const r = must(step(s, act.aim(s.pending!, { x: 3, z: 0 }), dice(2, 1)))
    expect(eventsOf(r.events, 'HitRolled')).toHaveLength(0)
    expect(eventsOf(r.events, 'TemplatePlaced')).toHaveLength(1)
    expect(eventsOf(r.events, 'WoundRolled').map((e) => e.targetId)).toEqual(['B3'])
    expect(r.state.fighters.B4!.posture).toBe('standing')
    // a direction that sticks out of the 90 degree arc is refused
    expect(step(s, act.aim(s.pending!, { x: 9, z: -5 })).rejection?.code).toBe('E_NOT_VISIBLE')
  })

  it('BLAST-006 a target in partial cover from the blast centre gets +1 to its save; an unarmoured target saves on 6 (7+ improved by 1)', () => {
    const s = shoot(
      shootingGame({
        board: 'test.barricade',
        spots: { A3: { x: 0.5, z: -8, facing: 0 }, B3: { x: 0.5, z: -1.5 }, B4: { x: 2.2, z: 0.6 } },
        loadouts: { A3: { weapons: ['atk.w.blast5'] }, B4: { wargear: [] } },
        active: 'A3',
      }),
    )
    expect(coverFrom(s, { x: 0.5, z: -1.5 }, s.fighters.B4!, undefined, ['B3']).cover).toBe('partial')
    // hit 6; B3 wound 1 fails; B4 wound 6, save 6 against 6+
    const r = must(take(s, { targetId: 'B3' }, dice(6, 1, 6, 6)))
    expect(eventsOf(r.events, 'SaveRolled')[0]).toMatchObject({ targetId: 'B4', need: 6, saved: true, item: null })
    expect(query.saveChance(s, 'B4', 0, { vs: 'blast', coverBonus: 1 })).toMatchObject({ need: 6 })
    expect(query.saveChance(s, 'B4', 0).need).toBeNull()
  })
})

describe('BLAST: Rapid Fire Blasts ([ND] Rapid Fire)', () => {
  it('BLAST-007 a Rapid Fire Blast that misses places one marker per bullet hole, each scattering on its own from the target', () => {
    const base = shootingGame({ spots: { A3: { x: 0, z: -8, facing: 0 }, B3: { x: 0, z: 4 } }, loadouts: { A3: { weapons: ['atk.w.blast5'] } } })
    const s = shoot(
      activate(
        edit(base, (d) => {
          const w = d.data.weapons['atk.w.blast5']!
          const p = w.profiles[0]!
          d.data = { ...d.data, weapons: { ...d.data.weapons, 'atk.w.blast5': { ...w, profiles: [{ ...p, ammo: 6, traits: [...p.traits, { trait: 'core.t.rapid-fire', x: 1 }] }] } } }
        }),
        'A3',
      ).state,
    )
    // miss (1); Firepower 6 (three holes); three scatters: arrow 90 degrees 3", arrow 180 degrees 3", arrow 270 degrees 3"
    const r = must(take(s, { targetId: 'B3' }, dice(1, 6, 2, 90, 3, 2, 180, 3, 2, 270, 3)))
    const sc = eventsOf(r.events, 'BlastScattered')
    expect(sc.map((e) => e.direction)).toEqual([90, 180, 270])
    expect(sc.every((e) => e.from.x === 0 && e.from.z === 4)).toBe(true)
    const placed = eventsOf(r.events, 'BlastPlaced').map((e) => e.centre)
    expect(placed).toHaveLength(3)
    expect(placed[0]!.x).toBeCloseTo(3, 2)
    expect(placed[1]!.z).toBeCloseTo(1, 2)
    expect(placed[2]!.x).toBeCloseTo(-3, 2)
  })
})
