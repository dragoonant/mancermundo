// Prompt label builders: each decision kind gets readable, engine-sourced words. Unit cases on synthetic options,
// then real games (random bot on both seats) pushed through `promptSummary` and the per-kind builders at every
// decision, so a shape the engine really produces can never render as "undefined" or crash a prompt.
import { describe, expect, it } from 'vitest'
import type { DecisionOption, GameState, PendingDecision } from '@/engine'
import {
  abilityActions,
  abilityChoiceOption,
  blockOption,
  coverSaveInfo,
  explainConditions,
  fightHint,
  fightOption,
  fightTargetCard,
  fightView,
  guardOption,
  markerActionLabel,
  passLabel,
  ployCard,
  promptSummary,
  rerollOption,
  targetBadge,
  targetCard,
  unavailablePloys,
  unlistedTargets,
  weaponCard,
} from '@/client/game/promptLabels'
import { playGame } from './support'

function opt(type: string, id: string, payload: Record<string, unknown>, data?: Record<string, unknown>, labelKey = 'x'): DecisionOption {
  return { id, labelKey, action: { type, seat: 'A', decisionId: 'd:1', payload } as DecisionOption['action'], ...(data ? { data } : {}) }
}

describe('weapon cards', () => {
  it('shows Atk, Hit and Dmg from the option data and names the rules', () => {
    const c = weaponCard(opt('shoot.weapon', 'aod.w.bolt-rifle', { weaponId: 'aod.w.bolt-rifle' }, { name: 'Bolt rifle', atk: 4, hit: 3, dmg: { normal: 3, crit: 4 }, rules: [{ rule: 'core.wr.accurate', x: 1 }], targets: 2 }))
    expect(c.name).toBe('Bolt rifle')
    expect(c.stats).toBe('A4 · 3+ · 3/4')
    expect(c.rules[0]!.name).toMatch(/accurate 1/i)
    expect(c.rules[0]!.text.length).toBeGreaterThan(10)
    expect(c.targets).toBe(2)
  })

  it('degrades to the weapon id when the engine sends no data', () => {
    const c = weaponCard(opt('shoot.weapon', 'kom.w.slugga', { weaponId: 'kom.w.slugga' }))
    expect(c.name).toBe('Slugga')
    expect(c.stats).toContain('?')
  })
})

describe('target badges', () => {
  it('maps the engine verdict fields to one badge each', () => {
    expect(targetBadge({}).kind).toBe('valid')
    expect(targetBadge({ inCover: true }).kind).toBe('cover')
    expect(targetBadge({ inCover: true, improvedCover: true }).kind).toBe('improved')
    expect(targetBadge({ obscured: true }).kind).toBe('obscured')
    expect(targetBadge({ inCover: true, obscured: true, forcedChoice: true }).kind).toBe('choice')
  })

  it('words the odds from the option data', () => {
    const c = targetCard(opt('shoot.target', 'B2', { targetId: 'B2' }, { distance: 7.25, inCover: true, expectedDamage: 2.345, killProbability: 0.183 }), null)
    expect(c.line).toBe('7.3″ · expected damage 2.3 · kill 18%')
    expect(c.badge.label).toBe('in cover')
  })

  it('shows wounds and distance for a fight target', () => {
    const c = fightTargetCard(opt('fight.target', 'B1', { targetId: 'B1' }, { wounds: 3, maxWounds: 8, distance: 0.6 }), null)
    expect(c.line).toBe('3/8 wounds left · 0.6″ away')
  })
})

describe('defence prompts', () => {
  it('explains the retained cover die with the engine odds', () => {
    const c = coverSaveInfo({ collected: 3, need: 4, improved: false }, null)
    expect(c.successChance).toBeCloseTo(0.5, 5)
    expect(c.explain).toMatch(/guaranteed/)
    expect(c.explain).toMatch(/50%/)
    expect(coverSaveInfo({ collected: 2, need: 5, improved: true }, null).explain).toMatch(/critical/)
  })

  it('puts the damage on every block alternative', () => {
    const auto = blockOption(opt('shoot.block', 'auto', { mode: 'auto' }, { damage: 3, unblockedNormal: 1, unblockedCrit: 0 }))
    expect(auto.isAuto).toBe(true)
    expect(auto.detail).toContain('takes 3 damage')
    const alt = blockOption(opt('shoot.block', 'leave:0n1c', { unblocked: [0, 1] }, { damage: 4, unblockedNormal: 0, unblockedCrit: 1 }))
    expect(alt.label).toBe('Leave 0 normal and 1 critical unblocked')
    expect(alt.damage).toBe(4)
  })
})

describe('re-rolls', () => {
  it('words a free re-roll and a command re-roll with its CP cost', () => {
    const free = rerollOption(opt('dice.reroll', 'x', { grant: 'balanced', dice: [2] }, { source: 'core.wr.balanced', value: 2 }), null)
    expect(free.label).toMatch(/Re-roll the 2/)
    expect(free.cost).toBe(0)
    expect(free.dice).toEqual([2])
    const cmd = rerollOption(opt('dice.commandReroll', 'command:1', { command: true, dice: [1] }, { value: 3, cost: 1 }), null)
    expect(cmd.label).toBe('Command Re-roll the 3 (1 CP)')
    expect(cmd.cost).toBe(1)
    expect(cmd.command).toBe(true)
  })
})

describe('conditions and labels', () => {
  it('explains mission action conditions in plain sentences', () => {
    expect(explainConditions({ notInEnemyControlRange: true, turningPoint: { min: 2 } })).toEqual(['Not inside an enemy control range.', 'Not before turning point 2.'])
    expect(explainConditions({ activationExcludes: ['fall-back', 'charge'] })[0]).toMatch(/Fall back or Charge/)
    expect(explainConditions(undefined)).toEqual([])
  })

  it('names the pass button by what passing does', () => {
    expect(passLabel('dice.reroll')).toBe('Keep the dice')
    expect(passLabel('guard.interrupt')).toBe('Decline')
    expect(passLabel('shoot.target')).toBe('Cancel the shot')
    expect(passLabel('strategy.gambit')).toBe('Pass')
  })

  it('labels marker and spot options', () => {
    expect(markerActionLabel(opt('firefight.action', 'marker:pickUp:m1', { action: 'marker:pickUp', markerId: 'obj-1' }))).toBe('Pick up Obj 1')
    const c = abilityChoiceOption(opt('ability.choice', '1.5,2.5', { option: '1.5,2.5' }, { x: 1.5, z: 2.5 }))
    expect(c.spot).toEqual({ x: 1.5, z: 2.5 })
    expect(abilityChoiceOption(opt('ability.choice', 'dash-first', { option: 'dash-first' })).label).toBe('Dash first, then shoot')
    const g = guardOption(opt('guard.interrupt', 'A1:shoot', { operativeId: 'A1', action: 'shoot' }, { pointBlank: true }), null)
    expect(g.detail).toMatch(/Point blank/)
  })
})

// ---------------------------------------------------------------- real games

const BAD = /undefined|NaN|\[object|null/

describe('every decision of real games renders words', () => {
  it('builds a summary for every decision kind the engine raises, with no undefined or NaN', () => {
    const kinds = new Map<string, number>()
    const extra = { fightBest: 0, fightResolves: 0, unlisted: 0, shootTargets: 0, coverReasons: 0, abilityBars: 0, ploys: 0, gambitsOff: 0 }
    const check = (state: GameState, pending: PendingDecision) => {
      kinds.set(pending.kind, (kinds.get(pending.kind) ?? 0) + 1)
      const s = promptSummary(state, pending)
      expect(s.title.length, pending.kind).toBeGreaterThan(0)
      expect(s.hint.length, pending.kind).toBeGreaterThan(0)
      for (const line of [s.title, s.hint, ...s.lines]) expect(line, `${pending.kind}: ${line}`).not.toMatch(BAD)
      if (pending.kind === 'shoot.target' && pending.context.secondary !== true) {
        extra.shootTargets++
        for (const u of unlistedTargets(state, pending)) {
          extra.unlisted++
          expect(u.reason.length).toBeGreaterThan(3)
          expect(u.badge.kind).toBe('unseen')
        }
        for (const o of pending.options ?? []) {
          const c = targetCard(o, state)
          expect(c.expectedDamage, 'engine odds on every candidate').not.toBeNull()
          expect(c.killProbability).not.toBeNull()
        }
      }
      if (pending.kind === 'fight.resolve') {
        extra.fightResolves++
        const view = fightView(state, pending)
        const hint = fightHint(state, pending)
        expect(view).not.toBeNull()
        expect(hint).not.toBeNull()
        const infos = (pending.options ?? []).map((o) => fightOption(o, view, hint))
        if (infos.some((i) => i.best)) extra.fightBest++
        for (const i of infos) expect(i.effect).not.toMatch(BAD)
      }
      if (pending.kind === 'shoot.coverSave') {
        extra.coverReasons++
        expect(coverSaveInfo(pending.context, state).explain).not.toMatch(BAD)
      }
      if (pending.kind === 'firefight.action') {
        const a = abilityActions(state, pending)
        if (a.length > 0) extra.abilityBars++
        for (const x of a) {
          expect(x.name.length).toBeGreaterThan(0)
          if (x.offers.length === 0) expect(x.reason, `${x.name} has a reason when not offered`).toBeTruthy()
        }
      }
      if (pending.kind === 'ploy.firefight' || pending.kind === 'strategy.gambit') {
        for (const o of pending.options ?? []) {
          const c = ployCard(o, state, pending.seat)
          expect(c.name.length).toBeGreaterThan(0)
          if (c.text) extra.ploys++
        }
        extra.gambitsOff += unavailablePloys(state, pending).length
      }
    }
    for (const seed of ['prompt-1', 'prompt-2', 'prompt-3']) {
      playGame({ seed, maxSteps: 2200 }, ({ state, pending }) => check(state, pending))
    }
    const seen = [...kinds.keys()]
    for (const k of ['shoot.weapon', 'shoot.target', 'fight.target', 'strategy.gambit', 'firefight.action', 'firefight.activate', 'setup.deploy']) {
      expect(seen, `a real game raises ${k}`).toContain(k)
    }
    expect(seen.some((k) => k === 'shoot.coverSave' || k === 'shoot.block')).toBe(true)
    expect(extra.shootTargets).toBeGreaterThan(0)
    expect(extra.abilityBars).toBeGreaterThan(0)
    if (extra.fightResolves > 0) expect(extra.fightBest).toBeGreaterThan(0)
  }, 240000)

  it('placement decisions get words when the human places markers (manual set-up)', () => {
    const kinds = new Set<string>()
    playGame({ seed: 'prompt-manual', manual: true, maxSteps: 120 }, ({ state, pending }) => {
      if (pending.kind !== 'setup.objective' && pending.kind !== 'setup.equipMarker') return
      kinds.add(pending.kind)
      const s = promptSummary(state, pending)
      expect(s.hint).not.toMatch(BAD)
      expect(s.hint.length).toBeGreaterThan(10)
    })
    expect(kinds.has('setup.objective')).toBe(true)
  }, 60000)
})
