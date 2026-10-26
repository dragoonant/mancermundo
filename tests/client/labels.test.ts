// Label building: known kinds read well, unknown decision kinds and option keys degrade to a generic
// option list instead of crashing, and events the client has never seen still produce a feed line.
import { describe, expect, it } from 'vitest'
import type { DecisionOption, GameEvent } from '@/engine'
import { contextFacts, decisionInfo, describeEvent, humanize, optionLabel, rejectionText } from '@/client/game/labels'

function opt(partial: Partial<DecisionOption> & { type: string; payload?: unknown }): DecisionOption {
  return {
    id: partial.id ?? 'x',
    labelKey: partial.labelKey ?? 'some.key',
    action: { type: partial.type, seat: 'A', decisionId: 'd:1', payload: partial.payload ?? {} } as DecisionOption['action'],
    ...(partial.data ? { data: partial.data } : {}),
  }
}

const ALL_KINDS = ['setup.initiative', 'setup.decideInitiative', 'setup.dropZone', 'setup.deploy', 'setup.equipMarker', 'setup.objective', 'strategy.initiative', 'strategy.decideInitiative', 'strategy.gambit', 'firefight.activate', 'firefight.order', 'firefight.action', 'move.path', 'shoot.weapon', 'shoot.target', 'shoot.coverSave', 'shoot.block', 'fight.target', 'fight.weapon', 'fight.resolve', 'dice.reroll', 'dice.commandReroll', 'weapon.choice', 'ploy.firefight', 'guard.interrupt', 'marker.pickUp', 'marker.place', 'mission.action', 'ability.choice', 'confirm'] as const

describe('every prompt names what it decides', () => {
  it('has a title and a hint for every decision kind, and a why-it-matters line for cover save, block and re-roll', () => {
    for (const k of ALL_KINDS) {
      const i = decisionInfo(k)
      expect(i.title.length, k).toBeGreaterThan(3)
      expect(i.hint.length, k).toBeGreaterThan(10)
      expect(`${i.title} ${i.hint}`, k).not.toMatch(/undefined|NaN|object Object/)
    }
    for (const k of ['shoot.coverSave', 'shoot.block', 'dice.reroll', 'dice.commandReroll']) expect(decisionInfo(k).why?.length ?? 0, k).toBeGreaterThan(30)
  })
})

describe('labels', () => {
  it('humanizes ids and keys', () => {
    expect(humanize('action.fallBack')).toBe('Fall back')
    expect(humanize('core.wr.seek-light')).toBe('Seek light')
  })

  it('names what each known decision kind decides', () => {
    expect(decisionInfo('setup.deploy').title).toMatch(/deploy/i)
    expect(decisionInfo('move.path').hint).toMatch(/inch/i)
    expect(decisionInfo('firefight.order').title).toMatch(/order/i)
  })

  it('renders a decision kind it has never seen with a generic title and hint', () => {
    const info = decisionInfo('quantum.entangle')
    expect(info.title).toBe('Entangle')
    expect(info.hint).toMatch(/options/i)
  })

  it('labels action options with their AP cost and gambits with CP', () => {
    expect(optionLabel(opt({ type: 'firefight.action', payload: { action: 'fallBack' }, data: { cost: 2 } }), null)).toBe('Fall Back (2 AP)')
    expect(optionLabel(opt({ type: 'firefight.action', payload: { action: 'end' } }), null)).toBe('End activation')
    expect(optionLabel(opt({ type: 'strategy.gambit', payload: { gambitId: 'g1' }, data: { name: 'Smoke', cost: 1 } }), null)).toBe('Smoke (1 CP)')
  })

  it('falls back to the engine data name, then a humanized label key', () => {
    expect(optionLabel(opt({ type: 'confirm', labelKey: 'x.y', data: { name: 'Boom' } }), null)).toBe('Boom')
    expect(optionLabel(opt({ type: 'ability.choice', labelKey: 'ability.pickTarget', id: 'o1' }), null)).toBe('Pick target')
  })

  it('turns pending.context into readable facts without throwing on odd values', () => {
    const facts = contextFacts({ hitOdds: 0.5, targets: ['A1', 'B2'], nested: { a: 1 }, nothing: null, off: false, operativeId: 'A1', big: 'x'.repeat(400) }, null)
    expect(facts.map((f) => f.key)).toEqual(['Hit odds', 'Targets', 'Nested', 'Operative', 'Big'])
    expect(facts[4]!.value.length).toBeLessThanOrEqual(160)
  })

  it('describes known and unknown events', () => {
    const base = { seq: 3, turningPoint: 1, phase: 'firefight', seat: 'A' } as const
    expect(describeEvent({ ...base, type: 'CpChanged', delta: 1, cp: 3, reason: 'strategy' } as GameEvent, null)).toContain('+1 CP')
    expect(describeEvent({ ...base, type: 'DiceRolled', purpose: 'strategy.initiative', dice: [4], final: true } as GameEvent, null)).toContain('4')
    expect(describeEvent({ ...base, type: 'DamageInflicted', operativeId: 'B3', sourceId: 'A1', amount: 4, source: 'normal', wounds: 6 } as GameEvent, null)).toBe('B3 takes 4 damage (Normal), 6 wounds left.')
    expect(describeEvent({ ...base, type: 'ApSpent', operativeId: 'A1', amount: 1, total: 1 } as GameEvent, null)).toBeNull()
    const unknown = describeEvent({ ...base, type: 'QuantumTunnelled', operativeId: 'B3', damage: 5 } as unknown as GameEvent, null)
    expect(unknown).toContain('Quantum tunnelled')
    expect(unknown).toContain('B3')
  })

  it('marks not-yet-implemented rules clearly in rejection text', () => {
    expect(rejectionText({ code: 'E_TODO', reason: 'shoot is not implemented' })).toMatch(/^Not implemented yet/)
    expect(rejectionText({ code: 'E_NO_AP', reason: 'needs 1 AP' })).toBe('needs 1 AP')
  })
})

describe('end screen scoring', () => {
  it('sums VP by source from VpScored events (amount awarded, not the running total)', async () => {
    const { vpBySource } = await import('@/client/ui/EndScreen')
    const base = { turningPoint: 2, phase: 'firefight' } as const
    const events = [
      { ...base, seq: 1, seat: 'A', type: 'VpScored', amount: 2, vp: 2, ruleId: 'secure-any' },
      { ...base, seq: 2, seat: 'A', type: 'VpScored', amount: 1, vp: 3, ruleId: 'kill-grade-up' },
      { ...base, seq: 3, seat: 'A', type: 'VpScored', amount: 2, vp: 5, ruleId: 'secure-any' },
      { ...base, seq: 4, seat: 'B', type: 'VpScored', amount: 3, vp: 3, ruleId: 'secure-more' },
      { ...base, seq: 5, seat: 'B', type: 'CpChanged', delta: 1, cp: 2, reason: 'x' },
    ] as unknown as GameEvent[]
    const vp = vpBySource(events)
    expect(vp.A).toEqual([
      { source: 'secure-any', vp: 4 },
      { source: 'kill-grade-up', vp: 1 },
    ])
    expect(vp.B).toEqual([{ source: 'secure-more', vp: 3 }])
  })
})
