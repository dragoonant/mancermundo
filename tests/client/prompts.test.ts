// Prompts (client/game/labels.ts and client/interaction/controller.ts): every decision a real game raises has a title, every option a
// readable label and engine facts, the continuous decisions get the engine's verdict (deploy spot, move route) and nothing leaks
// "undefined". Option labels name what they do; the numbers come from the option data, never from the client.
import { describe, expect, it } from 'vitest'
import { act, step, suggest, validate, type DecisionOption, type GameState, type PendingDecision } from '@/engine'
import { RandomBot } from '../../src/client/bot/randomBot'
import { deployFacing, deployFighterFor, doorOptions, optionForFighter, previewDeploy, routeTo, turnedBy } from '../../src/client/interaction/controller'
import { decisionHelp, decisionTitle, facingName, humanize, optionDoor, optionFacts, optionFighter, optionLabel, rejectionText, withheldText } from '../../src/client/game/labels'
import { newRealGame } from '../fixtures/presentation'

const CLEAN = /undefined|\[object|NaN|null/

/** Walk a real game with the random bot, calling `visit` on every pending decision. */
function walk(seed: string, visit: (state: GameState, pending: PendingDecision) => void, maxSteps = 700): GameState {
  const g = newRealGame(seed)
  const bots = { A: new RandomBot(`${seed}:A`), B: new RandomBot(`${seed}:B`) }
  let state = g.state
  let pending = g.pending
  for (let i = 0; pending && i < maxSteps && state.phase !== 'ended'; i++) {
    visit(state, pending)
    const r = step(state, bots[pending.seat].decide(state, pending))
    if (r.rejection) throw new Error(r.rejection.reason)
    state = r.state
    pending = r.pending
  }
  return state
}

describe('labels for every decision of a real game', () => {
  it('titles, helps, option labels and facts are present and clean', () => {
    const kinds = new Set<string>()
    walk('prompts-all', (state, pending) => {
      kinds.add(pending.kind)
      const title = decisionTitle(pending, state)
      expect(title.length, pending.kind).toBeGreaterThan(2)
      expect(title).not.toMatch(CLEAN)
      expect(decisionHelp(pending)).not.toMatch(CLEAN)
      for (const o of pending.options ?? []) {
        const label = optionLabel(o, state)
        expect(label.length, `${pending.kind} ${o.id}`).toBeGreaterThan(0)
        expect(label, `${pending.kind} ${o.id}`).not.toMatch(CLEAN)
        for (const f of optionFacts(o)) expect(f, `${pending.kind} ${o.id}`).not.toMatch(CLEAN)
      }
    })
    // the set-up, activation, group, action and move decisions all appeared
    for (const k of ['setup.role', 'setup.deploy', 'action.activate', 'action.choose', 'move.path']) expect(kinds.has(k), k).toBe(true)
  })

  it('action options are named by the engine\'s action catalogue, with the allowance or odds beside them', () => {
    let seen = false
    walk('prompts-choose', (state, pending) => {
      if (pending.kind !== 'action.choose' || seen) return
      seen = true
      const labels = Object.fromEntries((pending.options ?? []).map((o) => [o.id, optionLabel(o, state)]))
      expect(labels.move).toBe(state.data.actions.move!.name)
      expect(labels.end).toBe('End activation')
      const move = pending.options!.find((o) => o.id === 'move')!
      expect(optionFacts(move)).toEqual([`up to ${(move.data as { maxInches: number }).maxInches}"`])
      const turns = (pending.options ?? []).filter((o) => o.id.startsWith('turn:'))
      expect(turns.length).toBeGreaterThan(8)
      expect(turns.some((o) => optionLabel(o, state).startsWith('Face '))).toBe(true)
    })
    expect(seen).toBe(true)
  })

  it('fighter options name the fighter, and a click on that fighter finds the option', () => {
    let seen = false
    walk('prompts-activate', (state, pending) => {
      if (pending.kind !== 'action.activate' || seen) return
      seen = true
      const o = pending.options![0]!
      const id = optionFighter(o)!
      expect(optionLabel(o, state)).toBe(state.fighters[id]!.name)
      expect(optionForFighter(pending, id)).toBe(o)
      expect(optionForFighter(pending, 'nobody')).toBeNull()
    })
    expect(seen).toBe(true)
  })
})

describe('continuous decisions get the engine\'s verdict', () => {
  it('deploy: the engine\'s own spot is accepted, a spot off the board is refused with a reason', () => {
    const g = newRealGame('prompts-deploy')
    let { state, pending } = g
    while (pending && pending.kind !== 'setup.deploy') {
      const r = step(state, suggest(state, pending) ?? pending.options![0]!.action)
      state = r.state
      pending = r.pending
    }
    expect(pending?.kind).toBe('setup.deploy')
    const p = pending!
    const id = deployFighterFor(p, null)!
    expect(p.constraints!.fighterIds).toContain(id)
    expect(deployFighterFor(p, 'nobody')).toBe(id)
    const spot = suggest(state, p)!
    if (spot.type !== 'setup.deploy') throw new Error('suggest returned another action')
    const facing = deployFacing(p, null)
    expect(previewDeploy(state, p, spot.payload.fighterId, { x: spot.payload.x, z: spot.payload.z }, facing).ok).toBe(true)
    const off = previewDeploy(state, p, id, { x: 90, z: 90 }, facing)
    expect(off.ok).toBe(false)
    expect(off.text.length).toBeGreaterThan(5)
    expect(deployFacing(p, 1.5)).toBe(1.5)
    expect(turnedBy(Math.PI, Math.PI / 4)).toBeCloseTo(-3 * (Math.PI / 4), 2)
  })

  it('move: the route to a point is the engine\'s, costed and within the allowance; a wall point has no route', () => {
    let checked = 0
    walk(
      'prompts-move',
      (state, pending) => {
        if (pending.kind !== 'move.path' || checked >= 3) return
        const c = pending.constraints!
        const f = state.fighters[c.fighterId!]!
        const ahead = { x: f.pos.x + Math.sin(f.facing) * 3, z: f.pos.z + Math.cos(f.facing) * 3 }
        const route = routeTo(state, pending, ahead)
        if (route.ok) {
          checked++
          expect(route.cost).toBeLessThanOrEqual(c.maxInches! + 0.01)
          expect(route.left).toBeCloseTo(c.maxInches! - route.cost, 2)
          // the engine accepts exactly the waypoints the preview drew
          expect(validate(state, act.path(pending, route.waypoints))).toBeNull()
        }
        const wall = routeTo(state, pending, { x: 200, z: 200 })
        expect(wall.ok).toBe(false)
        expect(wall.reason).toMatch(/\w/)
      },
      900,
    )
    expect(checked).toBeGreaterThan(0)
  })

  it('doors: the options of a decision that name a door are found by door id', () => {
    const open: DecisionOption = { id: 'operateDoor:t0.d1', labelKey: 'action.choose.operateDoor', action: { type: 'action.choose', seat: 'A', decisionId: 'd:1', payload: { action: 'operateDoor', doorId: 't0.d1' } }, data: { to: 'open' } }
    const other: DecisionOption = { id: 'move', labelKey: 'action.choose.move', action: { type: 'action.choose', seat: 'A', decisionId: 'd:1', payload: { action: 'move' } } }
    const pending = { id: 'd:1', seat: 'A', kind: 'action.choose', window: 'action.declared', context: {}, options: [open, other], canPass: false } as PendingDecision
    expect(doorOptions(pending, 't0.d1')).toEqual([open])
    expect(doorOptions(pending, 't9.d9')).toEqual([])
    expect(optionDoor(open)).toBe('t0.d1')
    expect(optionDoor(other)).toBeNull()
    expect(optionLabel(open, null)).toBe('Open door')
    expect(optionFacts({ ...open, data: { chance: 0.5 } })).toEqual(['50% to succeed'])
  })
})

describe('words', () => {
  it('humanizes ids, names compass facings and rejection codes, and explains withheld actions', () => {
    expect(humanize('action.choose.takeCover')).toBe('Take cover')
    expect(humanize('seriously-injured')).toBe('Seriously injured')
    expect(facingName(0)).toBe('South')
    expect(facingName(Math.PI)).toBe('North')
    expect(facingName(Math.PI / 2)).toBe('East')
    expect(rejectionText({ code: 'E_ONE_INCH', reason: 'within 1" of b2' })).toBe('Too close to an enemy: within 1" of b2')
    expect(rejectionText({ code: 'E_TODO', reason: '' })).toBe('Not in this build yet')
    for (const r of ['later', 'noTarget', 'noActions', 'needsTwo', 'repeat', 'noTurn']) expect(withheldText(r)).not.toBe(r)
  })
})
