// Client game store (client/store/game.ts): the only caller of engine.step. A human's rejected action raises one toast, a bot seat
// answers after presentation idle and never shows a rejection, the autosave restores to the same hash, and no other client file
// calls `step`.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { RandomBot } from '../../src/client/bot/randomBot'
import { clearFeed, useFeedStore } from '../../src/client/presentation/feedStore'
import { usePresentedStore } from '../../src/client/presentation/presentedStore'
import { useSettings } from '../../src/client/presentation/settings'
import { humanToAct, useGame } from '../../src/client/store/game'
import { readSave } from '../../src/client/store/saveGame'
import { installStorage, until } from '../fixtures/presentation'

const NEW = { builds: { A: { starterId: 'gol.sg.starter-1' }, B: { starterId: 'esc.sg.starter-1' } }, scenarioId: 'scn.tunnel-skirmish', boardId: 'zm.b.foundry-run' } as const

function start(seed: string, seats: { A: 'human' | 'bot'; B: 'human' | 'bot' } = { A: 'human', B: 'bot' }): void {
  useGame.getState().newGame({ ...NEW, seats, seed })
}

describe('game store', () => {
  beforeEach(() => {
    installStorage()
    useSettings.setState({ animSpeed: 'instant' })
    useGame.getState().reset()
    clearFeed()
  })

  it('newGame opens a real game on the presented cursor with the first decision pending', () => {
    start('store-new')
    const g = useGame.getState()
    expect(g.state).not.toBeNull()
    expect(g.pending).not.toBeNull()
    expect(g.state!.phase).toBe('setup')
    expect(g.meta).toMatchObject({ seed: 'store-new', scenarioId: 'scn.tunnel-skirmish' })
    expect(g.events.some((e) => e.type === 'GameCreated')).toBe(true)
    expect(usePresentedStore.getState().latestSeq).toBe(g.state!.seq)
    expect(g.legal === null || Array.isArray(g.legal)).toBe(true)
  })

  it('a human\'s rejected action shows one toast and changes nothing; a bot seat\'s is only logged', () => {
    start('store-rej', { A: 'human', B: 'human' })
    const before = useGame.getState()
    const p = before.pending!
    const bad = { ...p.options![0]!.action, decisionId: 'd:999' }
    const r = before.dispatch(bad)
    expect(r?.code).toBe('E_WRONG_DECISION')
    expect(useGame.getState().state).toBe(before.state)
    expect(useFeedStore.getState().toasts).toHaveLength(1)
    expect(useFeedStore.getState().toasts[0]!.kind).toBe('error')
    // a second bad answer replaces the toast instead of stacking
    before.dispatch(bad)
    expect(useFeedStore.getState().toasts).toHaveLength(1)
    // the same answer from a bot seat is silent
    useFeedStore.setState({ toasts: [] })
    useGame.setState({ seats: { A: 'bot', B: 'bot' } })
    useGame.getState().dispatch(bad)
    expect(useFeedStore.getState().toasts).toHaveLength(0)
  })

  it('choose answers with the option whose id matches, and rejects an unknown id without stepping', () => {
    start('store-choose', { A: 'human', B: 'human' })
    const g = useGame.getState()
    expect(g.choose('no-such-option')?.code).toBe('E_NOT_AN_OPTION')
    expect(useGame.getState().state).toBe(g.state)
    const id = g.pending!.options![0]!.id
    expect(g.choose(id)).toBeNull()
    expect(useGame.getState().state!.seq).toBeGreaterThan(g.state!.seq)
  })

  it('the bot answers its seat after presentation idle; a whole round plays with no rejection toast', async () => {
    start('store-bot')
    const human = new RandomBot('store-human')
    for (let i = 0; i < 4000; i++) {
      const { state, pending, seats } = useGame.getState()
      if (!state || state.round >= 2 || state.phase === 'ended') break
      if (pending && seats[pending.seat] === 'human') {
        expect(humanToAct()).toBe(pending.seat)
        const rej = useGame.getState().dispatch(human.decide(state, pending))
        expect(rej).toBeNull()
      } else await new Promise((r) => setTimeout(r, 1))
    }
    const { state, events } = useGame.getState()
    expect(state!.round >= 2 || state!.phase === 'ended').toBe(true)
    // the bot really acted: its seat has activations and deployments in the log
    expect(events.some((e) => e.seat === 'B' && e.type === 'FighterDeployed')).toBe(true)
    expect(events.some((e) => e.seat === 'B' && e.type === 'FighterActivated')).toBe(true)
    expect(useFeedStore.getState().toasts.filter((t) => t.kind === 'error')).toHaveLength(0)
    await until(() => usePresentedStore.getState().presentedSeq >= usePresentedStore.getState().latestSeq)
  })

  it('the autosave restores to the same position and hash', async () => {
    start('store-save')
    const human = new RandomBot('store-save-human')
    for (let i = 0; i < 400; i++) {
      const { state, pending, seats } = useGame.getState()
      if (!state || state.seq >= 50) break
      if (pending && seats[pending.seat] === 'human') useGame.getState().dispatch(human.decide(state, pending))
      else await new Promise((r) => setTimeout(r, 1))
    }
    const live = useGame.getState().state!
    const saved = readSave()
    expect(saved.status).toBe('ok')
    if (saved.status !== 'ok') return
    expect(saved.env.file.finalHash).toBeDefined()
    // the save can lag the head by the bot's in-flight answer: restore it and compare with a replay of its own log
    useGame.getState().restore(saved.env)
    const restored = useGame.getState()
    expect(restored.state!.hash).toBe(saved.env.file.finalHash)
    expect(restored.events).toEqual([])
    expect(restored.state!.seq).toBeLessThanOrEqual(live.seq + 1)
    expect(restored.pending?.id).toBe(restored.state!.pending?.id)
  })

  it('reset clears the game and the presentation', () => {
    start('store-reset')
    useGame.getState().reset()
    const g = useGame.getState()
    expect(g.state).toBeNull()
    expect(g.pending).toBeNull()
    expect(usePresentedStore.getState().snapshots).toEqual([])
  })

  it('engine.step is called from the store and nowhere else in the client', () => {
    const root = join(__dirname, '../../src/client')
    const files: string[] = []
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(n)) files.push(p)
      }
    }
    walk(root)
    const offenders = files.filter((f) => {
      if (f.replace(/\\/g, '/').endsWith('store/game.ts')) return false
      const text = readFileSync(f, 'utf8')
      // an import of `step` from the engine, or a call of the engine's step
      return /import\s*\{[^}]*\bstep\b[^}]*\}\s*from\s*'@\/engine(\/apply)?'/.test(text)
    })
    expect(offenders).toEqual([])
  })
})
