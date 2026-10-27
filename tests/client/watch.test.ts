// Watch AI vs AI: the pacing of the bot loop in store/game.ts (pause, step, speed, pause on attacks), the pure pacing rules, the
// ?watch=1 alias, the decision card's view model and the one flag that hides every panel.
import { beforeEach, describe, expect, it } from 'vitest'
import { dataBundle } from '../../src/client/game/adapter'
import { describeBotDecision } from '../../src/client/game/botDecision'
import { parseParams } from '../../src/client/params'
import { clearFeed } from '../../src/client/presentation/feedStore'
import { useSettings, speedFactor } from '../../src/client/presentation/settings'
import { useGame } from '../../src/client/store/game'
import { botDelayMs, cardHoldMs, isAttackKind, isWatching, startsAttackSequence } from '../../src/client/store/pacing'
import { readSave } from '../../src/client/store/saveGame'
import { useUi } from '../../src/client/ui/uiStore'
import { installStorage } from '../fixtures/presentation'

const NEW = { builds: { A: { starterId: 'gol.sg.starter-1' }, B: { starterId: 'esc.sg.starter-1' } }, scenarioId: 'scn.tunnel-skirmish', boardId: 'zm.b.foundry-run' } as const
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(cond: () => boolean, ms = 20_000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for the condition')
    await wait(2)
  }
}

/** A watched game that starts paused (the pause lands before the bot loop's first timer fires). */
function watchPaused(seed: string): void {
  useGame.getState().newGame({ ...NEW, seats: { A: 'bot', B: 'bot' }, seed })
  useGame.getState().setPaused(true)
}

describe('watch pacing (store/game.ts)', () => {
  beforeEach(() => {
    installStorage()
    useSettings.setState({ animSpeed: 'instant' })
    useGame.getState().reset()
    useGame.setState({ pauseOnAttacks: false, follow: true })
    clearFeed()
  })

  it('pause stops the bot answers, and the decision card holds the answer it will give', async () => {
    watchPaused('watch-pause')
    await until(() => useGame.getState().deciding !== null)
    const before = useGame.getState().pending!.id
    await wait(120)
    const g = useGame.getState()
    expect(g.botAnswers).toBe(0)
    expect(g.pending!.id).toBe(before)
    expect(g.deciding).toMatchObject({ id: before, applied: false })
    expect(g.deciding!.action.decisionId).toBe(before)
    // play resumes the game
    g.setPaused(false)
    await until(() => useGame.getState().botAnswers >= 5)
    expect(useGame.getState().pending?.id).not.toBe(before)
  })

  it('step answers exactly one decision and the game stays paused; Step does nothing while running', async () => {
    watchPaused('watch-step')
    await until(() => useGame.getState().deciding !== null)
    useGame.getState().stepOnce()
    await until(() => useGame.getState().botAnswers === 1)
    await wait(150)
    expect(useGame.getState().botAnswers).toBe(1)
    expect(useGame.getState().paused).toBe(true)
    useGame.getState().stepOnce()
    useGame.getState().stepOnce() // two requests in a row still let only one decision through
    await until(() => useGame.getState().botAnswers >= 2)
    await wait(150)
    expect(useGame.getState().botAnswers).toBe(2)
    // a Step while running is ignored (it must not bank a go-ahead for the next pause)
    useGame.getState().setPaused(false)
    useGame.getState().stepOnce()
    await until(() => useGame.getState().botAnswers >= 10)
  })

  it('a paused game never trips the watchdog', async () => {
    watchPaused('watch-dog')
    await until(() => useGame.getState().deciding !== null)
    const id = useGame.getState().pending!.id
    await wait(6500) // the watchdog answers a stalled bot after 5 seconds without progress
    expect(useGame.getState().botAnswers).toBe(0)
    expect(useGame.getState().pending!.id).toBe(id)
  }, 15_000)

  it('pause on attacks stops the game when a shooting or fight sequence starts', async () => {
    useGame.getState().setPauseOnAttacks(true)
    useGame.getState().newGame({ ...NEW, seats: { A: 'bot', B: 'bot' }, seed: 'watch-attack' })
    await until(() => useGame.getState().paused, 30_000)
    const g = useGame.getState()
    expect(g.pauseReason).toBe('attack')
    expect(isAttackKind(g.pending!.kind)).toBe(true)
    // it stopped before the attack was answered, so no attack decision has been applied yet
    const answers = g.botAnswers
    await wait(120)
    expect(useGame.getState().botAnswers).toBe(answers)
    // stepping goes through the sequence one decision at a time without pausing again for the same attack
    useGame.getState().stepOnce()
    await until(() => useGame.getState().botAnswers === answers + 1)
    expect(useGame.getState().paused).toBe(true)
  }, 40_000)

  it('a watched game never touches the saved battle', async () => {
    useGame.getState().newGame({ ...NEW, seats: { A: 'bot', B: 'bot' }, seed: 'watch-save' })
    await until(() => useGame.getState().botAnswers >= 5)
    expect(readSave().status).toBe('none')
  })

  it('a new game starts running and forgets the pause', () => {
    watchPaused('watch-a')
    expect(useGame.getState().paused).toBe(true)
    useGame.getState().newGame({ ...NEW, seats: { A: 'bot', B: 'bot' }, seed: 'watch-b' })
    expect(useGame.getState()).toMatchObject({ paused: false, pauseReason: null, deciding: null, botAnswers: 0 })
  })
})

describe('pacing rules', () => {
  it('speed changes the delays: slow > normal > fast > instant, and nothing waits at instant', () => {
    expect(speedFactor('slow')).toBeGreaterThan(speedFactor('normal'))
    expect(botDelayMs('slow')).toBeGreaterThan(botDelayMs('normal'))
    expect(botDelayMs('normal')).toBeGreaterThan(botDelayMs('fast'))
    expect(botDelayMs('instant')).toBe(0)
    expect(cardHoldMs('slow')).toBeGreaterThan(cardHoldMs('normal'))
    expect(cardHoldMs('normal')).toBeGreaterThan(cardHoldMs('fast'))
    expect(cardHoldMs('fast')).toBeGreaterThan(0)
    expect(cardHoldMs('instant')).toBe(0)
  })

  it('an attack sequence starts at its first attack decision only', () => {
    expect(startsAttackSequence('action.choose', 'shoot.weapon')).toBe(true)
    expect(startsAttackSequence(null, 'fight.weapons')).toBe(true)
    expect(startsAttackSequence('shoot.weapon', 'shoot.target')).toBe(false)
    expect(startsAttackSequence('action.choose', 'move.path')).toBe(false)
  })

  it('watching means no human seat', () => {
    expect(isWatching({ A: 'bot', B: 'bot' })).toBe(true)
    expect(isWatching({ A: 'human', B: 'bot' })).toBe(false)
    expect(isWatching({ A: 'human', B: 'human' })).toBe(false)
  })
})

describe('?watch=1', () => {
  it('is an alias for seats=bot,bot; an explicit seats wins; slow is a speed', () => {
    expect(parseParams('?test=1&watch=1').seats).toEqual(['bot', 'bot'])
    expect(parseParams('?test=1&watch=1&seats=human,bot').seats).toEqual(['human', 'bot'])
    expect(parseParams('?test=1&watch=0').seats).toEqual(['human', 'bot'])
    expect(parseParams('?speed=slow').speed).toBe('slow')
  })
})

describe('the decision card', () => {
  it('words a bot decision from the label helpers: title, the chosen option and its facts', async () => {
    watchPaused('watch-card')
    await until(() => useGame.getState().deciding !== null)
    const d = useGame.getState().deciding!
    const v = describeBotDecision(d.state, d.pending, d.action)
    expect(v.title.length).toBeGreaterThan(0)
    expect(v.chosen.length).toBeGreaterThan(0)
    expect(v.optionCount).toBe(d.pending.options?.length ?? 0)
    expect(dataBundle()).toBeTruthy()
    useGame.getState().reset()
  })

  it('a shot decision carries the engine odds of the chosen target', async () => {
    useGame.getState().setPauseOnAttacks(true)
    useGame.getState().newGame({ ...NEW, seats: { A: 'bot', B: 'bot' }, seed: 'watch-odds' })
    await until(() => useGame.getState().paused, 30_000)
    // step to the first target choice (or give up after a few decisions: a fight has no target list)
    for (let i = 0; i < 6 && useGame.getState().pending?.kind !== 'shoot.target'; i++) {
      const n = useGame.getState().botAnswers
      useGame.getState().stepOnce()
      await until(() => useGame.getState().botAnswers > n)
    }
    const g = useGame.getState()
    if (g.pending?.kind === 'shoot.target') {
      await until(() => useGame.getState().deciding?.pending.kind === 'shoot.target')
      const d = useGame.getState().deciding!
      const v = describeBotDecision(d.state, d.pending, d.action)
      const hit = v.odds[0]?.lines.find((l) => l.label === 'Hit')
      if (d.action.type === 'shoot.target' && d.action.payload.targetId) expect(hit?.value).toMatch(/%/)
    }
  }, 40_000)
})

describe('hiding the panels', () => {
  it('one flag in the ui store hides every panel and toggles back', () => {
    useUi.setState({ uiHidden: false })
    useUi.getState().toggleUi()
    expect(useUi.getState().uiHidden).toBe(true)
    useUi.getState().toggleUi()
    expect(useUi.getState().uiHidden).toBe(false)
    useUi.getState().setUiHidden(true)
    expect(useUi.getState().uiHidden).toBe(true)
    useUi.getState().setUiHidden(false)
  })
})
