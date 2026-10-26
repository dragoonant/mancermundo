import { describe, expect, it } from 'vitest'
import { hasLos, hiddenFromRanged, inVisionArc } from '@/engine/los'
import { cover, inArc, losLine } from '@/engine/query'
import { barricadePair, bundleWith, corridorWithDoor, makeBoard } from '../fixtures/boards'
import { edit, place, startGame } from '../fixtures/helpers'

const r = 0.492 // a 25 mm base

/** A3 looking down +z from (0, y) and B3 at the given spot, on a board with the given extras. */
function duel(spec: Parameters<typeof makeBoard>[0], a: { x: number; z: number; facing?: number }, b: { x: number; z: number; posture?: 'pinned' }, extra: Parameters<typeof place>[1] = {}) {
  const board = makeBoard({ id: 'test.vis', ...spec })
  const base = startGame({ bundle: bundleWith(board), setup: { boardId: board.id } }).state
  return place(base, { A3: { ...a }, B3: { ...b }, ...extra })
}

describe('VIS: vision arc, line of sight and cover', () => {
  it('VIS-001 a target whose base is entirely outside the 90 degree arc cannot be seen; any part inside is enough', () => {
    const at = (deg: number, dist: number) => ({ x: Math.sin((deg * Math.PI) / 180) * dist, z: -10 + Math.cos((deg * Math.PI) / 180) * dist })
    // 60 degrees off the facing: wholly outside
    const out = duel({}, { x: 0, z: -10, facing: 0 }, at(60, 6))
    expect(inVisionArc(out.fighters.A3!, out.fighters.B3!)).toBe(false)
    expect(inArc(out, 'A3', 'B3')).toBe(false)
    // 47 degrees at 5 inches: the centre is outside the 45 degree wedge but the base reaches into it
    const edge = duel({}, { x: 0, z: -10, facing: 0 }, at(47, 5))
    expect(inVisionArc(edge.fighters.A3!, edge.fighters.B3!)).toBe(true)
    // straight ahead, and exactly on the wedge line
    expect(inVisionArc(edge.fighters.A3!, place(edge, { B3: at(0, 8) }).fighters.B3!)).toBe(true)
    expect(inVisionArc(edge.fighters.A3!, place(edge, { B3: at(45, 8) }).fighters.B3!)).toBe(true)
    // behind
    expect(inVisionArc(edge.fighters.A3!, place(edge, { B3: at(180, 8) }).fighters.B3!)).toBe(false)
    // turning changes the answer
    const turned = place(out, { A3: { x: 0, z: -10, facing: (60 * Math.PI) / 180 } })
    expect(inVisionArc(turned.fighters.A3!, turned.fighters.B3!)).toBe(true)
  })

  it('VIS-001 Pinned and Seriously Injured fighters have no vision arc', () => {
    const s = duel({}, { x: 0, z: -10, facing: 0 }, { x: 0, z: -6 })
    const lying = place(s, { A3: { x: 0, z: -10, posture: 'pinned' } })
    expect(inVisionArc(lying.fighters.A3!, lying.fighters.B3!)).toBe(false)
  })

  it('VIS-002 a line crossing a closed door gives no line of sight; opening the door restores it', () => {
    const board = corridorWithDoor()
    const base = startGame({ bundle: bundleWith(board), setup: { boardId: board.id } }).state
    const s = place(base, { A3: { x: 0, z: -3, facing: 0 }, B3: { x: 0, z: 3 } })
    expect(hasLos(s, s.fighters.A3!, s.fighters.B3!)).toBe(false)
    const ll = losLine(s, 'A3', 'B3')
    expect(ll.los).toBe(false)
    expect(ll.lines).toHaveLength(17)
    expect(new Set(ll.lines.map((l) => l.blocked))).toEqual(new Set(['door']))
    const open = edit(s, (d) => {
      d.board.doors.door1!.state = 'open'
    })
    expect(hasLos(open, open.fighters.A3!, open.fighters.B3!)).toBe(true)
    expect(losLine(open, 'A3', 'B3').los).toBe(true)
    // a wall blocks too: the same two fighters offset behind the wall
    const behind = place(open, { B3: { x: 6, z: 3 } })
    expect(hasLos(behind, behind.fighters.A3!, behind.fighters.B3!)).toBe(false)
    expect(new Set(losLine(behind, 'A3', 'B3').lines.map((l) => l.blocked))).toContain('wall')
  })

  it('smoke blocks line of sight into, out of and through it', () => {
    const base = duel({}, { x: 0, z: -10, facing: 0 }, { x: 0, z: -4 })
    expect(hasLos(base, base.fighters.A3!, base.fighters.B3!)).toBe(true)
    for (const centre of [{ x: 0, z: -7 }, { x: 0, z: -4 }, { x: 0, z: -10 }]) {
      const smoky = edit(base, (d) => {
        d.board.smoke.push({ id: 's1', pos: centre, radius: 2.5, placedRound: 1 })
      })
      expect(hasLos(smoky, smoky.fighters.A3!, smoky.fighters.B3!), `smoke at z=${centre.z}`).toBe(false)
    }
  })

  it('VIS-003 every traced line clear is the open, half or more clear is partial cover, less than half is full cover', () => {
    const target = { x: 0, z: 0 }
    const attacker = { x: 0, z: -8, facing: 0 }
    const open = duel({}, attacker, target)
    expect(cover(open, 'A3', 'B3')).toMatchObject({ cover: 'none', clear: 9, total: 9 })
    // a post halfway between them hides the middle lines: 3 of 9 blocked
    const post = duel({ obstacles: [{ id: 'post', kind: 'crates', rect: [-0.1, -4.2, 0.1, -3.8] }] }, attacker, target)
    const partial = cover(post, 'A3', 'B3')
    expect(partial.cover).toBe('partial')
    expect(partial.clear).toBe(6)
    expect(partial.lines.filter((l) => l.blocked === 'obstacle')).toHaveLength(3)
    const wall = duel({ obstacles: [{ id: 'crate', kind: 'crates', rect: [-1, -4.2, 1, -3.8] }] }, attacker, target)
    expect(cover(wall, 'A3', 'B3')).toMatchObject({ cover: 'full', clear: 0 })
    // exactly half would be partial: 9 samples never split evenly, so 5 clear (more than half) is the boundary case
    const four = duel({ obstacles: [{ id: 'p4', kind: 'crates', rect: [-0.16, -4.2, 0.16, -3.8] }] }, attacker, target)
    expect(cover(four, 'A3', 'B3').clear).toBe(4)
    expect(cover(four, 'A3', 'B3').cover).toBe('full')
  })

  it('VIS-004 an obstacle within 1 inch of the shooter and a friend in base contact with the shooter are ignored for cover', () => {
    const attacker = { x: 0, z: -8, facing: 0 }
    const target = { x: 0, z: 0 }
    const nearCrate = duel({ obstacles: [{ id: 'near', kind: 'crates', rect: [-1.5, -7.6, 1.5, -7.4] }] }, attacker, target)
    expect(cover(nearCrate, 'A3', 'B3').cover).toBe('none')
    // the same crate 2 inches away is cover
    const farCrate = duel({ obstacles: [{ id: 'far', kind: 'crates', rect: [-1.5, -5.6, 1.5, -5.4] }] }, attacker, target)
    expect(cover(farCrate, 'A3', 'B3').cover).toBe('full')
    // a friend touching the shooter and in the way is ignored; one 2 inches ahead is not
    const touching = duel({}, attacker, target, { A4: { x: 0, z: -8 + 2 * r + 0.01 } })
    expect(cover(touching, 'A3', 'B3').cover).toBe('none')
    const ahead = duel({}, attacker, target, { A4: { x: 0, z: -5 } })
    expect(['partial', 'full']).toContain(cover(ahead, 'A3', 'B3').cover)
    // a Prone fighter in the way never blocks
    const prone = duel({}, attacker, target, { A4: { x: 0, z: -5, posture: 'pinned' } })
    expect(cover(prone, 'A3', 'B3').cover).toBe('none')
    // an enemy in the way does
    const enemy = duel({}, attacker, target, { B4: { x: 0, z: -5 } })
    expect(enemy.fighters.B4!.posture).toBe('standing')
    expect(['partial', 'full']).toContain(cover(enemy, 'A3', 'B3').cover)
  })

  it('VIS-005 a Pinned fighter in partial cover cannot be targeted by a ranged attack; the same fighter in the open can', () => {
    const attacker = { x: 0, z: -8, facing: 0 }
    const post = duel({ obstacles: [{ id: 'post', kind: 'crates', rect: [-0.1, -4.2, 0.1, -3.8] }] }, attacker, { x: 0, z: 0, posture: 'pinned' })
    const c = cover(post, 'A3', 'B3')
    expect(c.cover).toBe('partial')
    expect(hiddenFromRanged(post.fighters.B3!, c.cover)).toBe(true)
    const open = duel({}, attacker, { x: 0, z: 0, posture: 'pinned' })
    expect(hiddenFromRanged(open.fighters.B3!, cover(open, 'A3', 'B3').cover)).toBe(false)
    // a Standing fighter in cover is still a legal target
    const standing = duel({ obstacles: [{ id: 'post', kind: 'crates', rect: [-0.1, -4.2, 0.1, -3.8] }] }, attacker, { x: 0, z: 0 })
    expect(hiddenFromRanged(standing.fighters.B3!, cover(standing, 'A3', 'B3').cover)).toBe(false)
  })

  it('a barricade is cover from either side', () => {
    const board = barricadePair()
    const base = startGame({ bundle: bundleWith(board), setup: { boardId: board.id } }).state
    const s = place(base, { A3: { x: 0, z: -5, facing: 0 }, B3: { x: 0, z: 2.5 } })
    expect(cover(s, 'A3', 'B3').cover).not.toBe('none')
    expect(cover(s, 'B3', 'A3').cover).not.toBe('none')
  })
})
