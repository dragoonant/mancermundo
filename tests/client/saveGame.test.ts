// Save game (client/store/saveGame.ts): the envelope round-trips an engine save, a damaged or outdated save is recognised, storage
// errors never throw, and the Continue card summary reads the gang names from the data.
import { beforeEach, describe, expect, it } from 'vitest'
import { save as engineSave } from '@/engine'
import { SAVE_ENVELOPE_VERSION, SAVE_KEY, SAVE_KIND, clearSave, envelopeProblem, hasSave, progressText, readSave, relativeTime, summarize, writeSave, type SaveEnvelope } from '../../src/client/store/saveGame'
import { installStorage, playGame } from '../fixtures/presentation'

function envelope(): SaveEnvelope {
  const played = playGame('save-fixture', (s) => s.seq >= 40)
  return {
    kind: SAVE_KIND,
    v: SAVE_ENVELOPE_VERSION,
    savedAt: 1_700_000_000_000,
    meta: {
      seats: { A: 'human', B: 'bot' },
      seed: 'save-fixture',
      scenarioId: 'scn.tunnel-skirmish',
      boardId: played.state.origin.setup.boardId,
      builds: { A: { starterId: 'gol.sg.starter-1' }, B: { starterId: 'esc.sg.starter-1' } },
      round: played.state.round,
      phase: played.state.phase,
    },
    file: engineSave(played.state),
  }
}

describe('saveGame', () => {
  beforeEach(() => {
    installStorage()
  })

  it('writes, reads back and clears one save', () => {
    expect(readSave()).toEqual({ status: 'none' })
    const env = envelope()
    expect(writeSave(env)).toBe(true)
    expect(hasSave()).toBe(true)
    const r = readSave()
    expect(r.status).toBe('ok')
    if (r.status === 'ok') expect(r.env.file.finalHash).toBe(env.file.finalHash)
    clearSave()
    expect(hasSave()).toBe(false)
  })

  it('a save that is not JSON, not ours or from another version is bad', () => {
    localStorage.setItem(SAVE_KEY, '{nope')
    expect(readSave()).toEqual({ status: 'bad', reason: 'unreadable' })
    localStorage.setItem(SAVE_KEY, JSON.stringify({ kind: 'something-else' }))
    expect(readSave()).toEqual({ status: 'bad', reason: 'unreadable' })
    expect(envelopeProblem({ ...envelope(), v: 99 })).toBe('outdated')
  })

  it('a save naming a scenario or gang that no longer exists is outdated, not unreadable', () => {
    const env = envelope()
    expect(envelopeProblem(env)).toBeNull()
    expect(envelopeProblem({ ...env, meta: { ...env.meta, scenarioId: 'scn.gone' } })).toBe('outdated')
    expect(envelopeProblem({ ...env, meta: { ...env.meta, builds: { A: { starterId: 'nobody' }, B: env.meta.builds.B } } })).toBe('outdated')
    expect(envelopeProblem({ ...env, meta: { ...env.meta, seats: { A: 'robot', B: 'bot' } } })).toBe('unreadable')
  })

  it('storage that throws is swallowed', () => {
    ;(globalThis as unknown as { localStorage: unknown }).localStorage = {
      getItem() {
        throw new Error('blocked')
      },
      setItem() {
        throw new Error('quota')
      },
      removeItem() {
        throw new Error('blocked')
      },
    }
    expect(writeSave(envelope())).toBe(false)
    expect(readSave()).toEqual({ status: 'none' })
    expect(hasSave()).toBe(false)
    expect(() => clearSave()).not.toThrow()
  })

  it('summarises for the Continue card', () => {
    const s = summarize(envelope())
    expect(s.gangA).toBe('Furnace Crew')
    expect(s.gangB).toBe('Lasgun Line')
    expect(s.mode).toBe('vs bot')
    expect(progressText(0, 'setup')).toBe('Setting up the battle')
    expect(progressText(2, 'action')).toBe('Round 2, Action phase')
    expect(relativeTime(0, 10_000)).toBe('just now')
    expect(relativeTime(0, 3 * 3600 * 1000)).toBe('3 hours ago')
  })
})
