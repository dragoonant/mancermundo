import { describe, expect, it } from 'vitest'
import { act, step, type GameState } from '@/engine'
import { checkCodeParams, hookFireCount, registeredCodeHooks, resetFireCounts } from '@/engine/code-hooks'
import { checkBattleEnd } from '@/engine/scenarios'
import { freeSpaceTest, initialDoors } from '@/engine/board'
import { withinPath } from '@/engine/measure'
import { validateAll } from '@/data/validate'
import { dice } from '../fixtures/attack'
import { edit, must, take } from '../fixtures/helpers'
import { battle, draft, RICHES, seatWith, SMASH } from '../fixtures/scenario'

// Every `{ "code": ... }` the scenario data uses is registered with a params validator and fires in a real game (20 section 11).

const SCENARIO_HOOKS = ['horrorsInTheDark', 'smashAndGrabCaskets', 'smashAndGrabVictory']

describe('code hooks: scenario hooks (S4)', () => {
  it('every code name the scenario data uses is registered, with a params validator that takes none', () => {
    const res = validateAll({ registeredCodes: new Set(registeredCodeHooks()), allowPendingCodes: true })
    const used = res.hooks.filter((h) => h.usedBy.some((id) => id.startsWith('scn.'))).map((h) => h.name)
    expect(used.sort()).toEqual(['horrorsInTheDark', 'smashAndGrabVictory'])
    for (const name of SCENARIO_HOOKS) {
      expect(registeredCodeHooks()).toContain(name)
      expect(checkCodeParams(name, undefined)).toBeNull()
      expect(checkCodeParams(name, { x: 1 })).toMatch(/no params/)
    }
    expect(res.errors.filter((e) => /scn\./.test(e))).toEqual([])
  })

  it('horrorsInTheDark fires when a fighter activates alone in the dark in Forgotten Riches', () => {
    resetFireCounts()
    const s0 = battle({ scenarioId: RICHES })
    const seat = s0.pending!.seat
    const lone = Object.values(s0.fighters).find((f) => f.seat === seat && f.role === 'ganger' && f.location === 'board')!.id
    const def = s0.board.def
    const free = freeSpaceTest(def, initialDoors(def), 0.7)
    const others = Object.values(s0.fighters).filter((f) => f.location === 'board' && f.id !== lone)
    let at: { x: number; z: number } | null = null
    for (let x = def.bounds.minX + 1; x <= def.bounds.maxX - 1 && !at; x += 1.5) {
      for (let z = def.bounds.minZ + 1; z <= def.bounds.maxZ - 1 && !at; z += 1.5) {
        const d = { pos: { x, z }, baseRadius: 0.5 }
        if (free({ x, z }) && !others.some((o) => withinPath(s0, d, o, 8))) at = { x, z }
      }
    }
    expect(at).not.toBeNull()
    expect(hookFireCount('horrorsInTheDark')).toBe(0)
    const s = edit(s0, (d) => {
      d.fighters[lone]!.pos = { x: at!.x, y: 0, z: at!.z }
    })
    must(take(s, { fighterId: lone }, dice(6)))
    expect(hookFireCount('horrorsInTheDark')).toBe(1)
  })

  it('smashAndGrabCaskets fires when a casket is cracked in Smash & Grab, smashAndGrabVictory when the third locks the win and when the battle is decided', () => {
    resetFireCounts()
    const s0 = battle({ scenarioId: SMASH })
    const att = seatWith(s0, 'attacker')
    const id = Object.values(s0.fighters).find((f) => f.seat === att && f.role === 'ganger' && f.location === 'board')!.id
    const casketId = Object.keys(s0.board.caskets)[0]!
    const c = s0.board.caskets[casketId]!
    const s = edit(s0, (d) => {
      d.fighters[id]!.pos = { x: c.pos.x + 1.2, y: 0, z: c.pos.z }
      d.scenario.caskets.opened = 2
    })
    let r = must(take(s, { fighterId: id }))
    if (r.pending!.kind === 'action.group') r = must(step(r.state, act.groupDone(r.pending!)))
    expect(hookFireCount('smashAndGrabCaskets')).toBe(0)
    const open = must(step(r.state, r.pending!.options!.find((o) => o.id === `smashCasket:${casketId}`)!.action, dice(6, 4)))
    expect(hookFireCount('smashAndGrabCaskets')).toBe(1)
    expect(hookFireCount('smashAndGrabVictory')).toBe(1) // the third casket locked the win
    expect(open.state.scenario.locked).not.toBeNull()
    // the battle end consults the victory rule too
    const before = hookFireCount('smashAndGrabVictory')
    const end = draft(
      edit(open.state as GameState, (d) => {
        for (const f of Object.values(d.fighters)) if (f.seat !== att && f.location === 'board') f.posture = 'seriouslyInjured'
      }),
    )
    expect(checkBattleEnd(end.ctx)).toBe(true)
    expect(hookFireCount('smashAndGrabVictory')).toBe(before + 1)
  })

  it('the query numbers do not count as the rules firing', () => {
    resetFireCounts()
    const s = battle({ scenarioId: SMASH })
    // query.scenarioView projects the winner without firing the victory hook
    // (imported lazily to keep the file focused on the hooks)
    return import('@/engine').then(({ query }) => {
      query.scenarioView(s)
      expect(hookFireCount('smashAndGrabVictory')).toBe(0)
    })
  })
})
