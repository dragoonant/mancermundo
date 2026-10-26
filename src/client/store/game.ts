// Client game store (docs/spec/50-client.md): the ONLY caller of engine.step. Owns the live GameState, the pending decision and
// the legal actions; answers bot seats with the random bot once the presentation is idle (with a watchdog so a stuck decision can
// never leave the UI waiting); pushes every accepted step through the presentation director and the presented-seq cursor so
// results never show early.
import { create } from 'zustand'
import {
  createGame,
  legalActions,
  load as engineLoad,
  save as engineSave,
  step,
  suggest,
  type Action,
  type GameEvent,
  type GameState,
  type PendingDecision,
  type Rejection,
  type SaveFile,
  type Seat,
} from '@/engine'
import { buildGameSetup, engineBundle, type SeatBuild } from '../game/adapter'
import { rejectionText } from '../game/labels'
import { RandomBot } from '../bot/randomBot'
import { clearAnims } from '../presentation/animStore'
import { enqueueBatch, resetDirector, setDirectorBotSeats, setDirectorPerspective } from '../presentation/director'
import { clearFeed, clearToasts, pushToast } from '../presentation/feedStore'
import { waitForPresentationIdle } from '../presentation/idleStore'
import { isAnnouncementHolding } from '../presentation/announceStore'
import { pushSnapshot, resetPresentation, usePresentedStore } from '../presentation/presentedStore'
import { speedFactor, useSettings } from '../presentation/settings'
import type { SeatMode } from '../params'
import { clearSave, SAVE_ENVELOPE_VERSION, SAVE_KIND, writeSave, type SaveEnvelope } from './saveGame'

export interface GameMeta {
  seed: string
  scenarioId: string
  boardId: string
  builds: Record<Seat, SeatBuild>
}

export interface NewGameOptions {
  builds: Record<Seat, SeatBuild>
  seats: Record<Seat, SeatMode>
  seed: string
  scenarioId: string
  boardId: string
  /** rewrite the freshly created game before it is shown (dev fixtures); events of the skipped steps are not replayed */
  prepare?: (state: GameState) => GameState
}

interface GameStore {
  state: GameState | null
  pending: PendingDecision | null
  legal: Action[] | null
  meta: GameMeta | null
  seats: Record<Seat, SeatMode>
  /** every event of the battle in order (end screen, tests); bounded */
  events: GameEvent[]
  rejection: { code: string; reason: string; nonce: number } | null
  newGame(opts: NewGameOptions): void
  /** Open a saved game exactly where it stopped, with no replay of its dice or banners. Throws (and changes nothing) when the save cannot be restored exactly. */
  restore(env: SaveEnvelope): void
  /** Answer the pending decision. A rejection of a bot seat's action is only logged; a human's shows one toast. */
  dispatch(action: Action): Rejection | null
  /** answer the pending decision with the option whose id matches */
  choose(optionId: string): Rejection | null
  pass(): Rejection | null
  exportSave(): SaveFile | null
  reset(): void
}

const EVENT_LIMIT = 6000
const BOT_DELAY_MS = 250
const PRESENTATION_IDLE_TIMEOUT_MS = 3000
const NO_PROGRESS_MS = 5000
const WATCHDOG_POLL_MS = 1000

let generation = 0
let bots: Record<Seat, RandomBot> | null = null
/** false for games rewritten after creation (dev fixtures): their log does not replay, so they are never saved */
let savable = true
let botTimer: ReturnType<typeof setTimeout> | null = null
let watchdog: ReturnType<typeof setInterval> | null = null
let watchId: string | null = null
let watchSince = 0
let rejectionNonce = 0

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()
}

function perspectiveOf(seats: Record<Seat, SeatMode>): Seat | null {
  return seats.A === 'human' ? 'A' : seats.B === 'human' ? 'B' : null
}

function botSeatsOf(seats: Record<Seat, SeatMode>): Seat[] {
  return (['A', 'B'] as const).filter((s) => seats[s] === 'bot')
}

export const useGame = create<GameStore>((set, get) => {
  function apply(state: GameState, events: GameEvent[], pending: PendingDecision | null): void {
    const prevEvents = get().events
    const all = prevEvents.length + events.length > EVENT_LIMIT ? [...prevEvents.slice(-(EVENT_LIMIT / 2)), ...events] : [...prevEvents, ...events]
    set({ state, pending, legal: pending ? legalActions(state, pending) : [], events: all })
    pushSnapshot(state.seq, state)
    enqueueBatch({ seq: state.seq, events, state })
    autosave(state)
    scheduleBot()
  }

  /** Write the save after an accepted action (cleared once the game has ended). One serialisation, errors swallowed. */
  function autosave(state: GameState): void {
    if (!savable) return
    try {
      if (state.phase === 'ended') {
        clearSave()
        return
      }
      const { meta, seats } = get()
      if (!meta) return
      const env: SaveEnvelope = {
        kind: SAVE_KIND,
        v: SAVE_ENVELOPE_VERSION,
        savedAt: Date.now(),
        meta: { seats: { ...seats }, seed: meta.seed, scenarioId: meta.scenarioId, boardId: meta.boardId, builds: meta.builds, round: state.round, phase: state.phase },
        file: engineSave(state),
      }
      writeSave(env)
    } catch (e) {
      console.debug('[save] autosave skipped', e)
    }
  }

  function scheduleBot(): void {
    const { pending, seats, state } = get()
    if (!pending || !state || state.phase === 'ended' || seats[pending.seat] !== 'bot') return
    const id = pending.id
    const gen = generation
    if (botTimer) clearTimeout(botTimer)
    botTimer = setTimeout(() => {
      botTimer = null
      void runBot(id, gen)
    }, 0)
  }

  /** Answer the pending decision for a bot seat. Tries the bot, then every legal action, then the engine's suggestion, then pass. */
  function answerForBot(expectedId: string): void {
    const { state, pending } = get()
    if (!state || !pending || pending.id !== expectedId) return
    const candidates: Action[] = []
    try {
      candidates.push(bots![pending.seat].decide(state, pending))
    } catch (e) {
      console.warn('[bot] decide failed', e)
    }
    for (const a of legalActions(state, pending) ?? []) candidates.push(a)
    const s = suggest(state, pending)
    if (s) candidates.push(s)
    if (pending.canPass) candidates.push({ type: 'pass', seat: pending.seat, decisionId: pending.id, payload: {} })
    for (const a of candidates) {
      const r = step(state, a)
      if (!r.rejection) {
        apply(r.state, r.events, r.pending)
        return
      }
      // a bot's rejected guess is never shown to the player: log it and try the next candidate
      console.debug(`[bot] ${pending.kind} rejected: ${r.rejection.code} ${r.rejection.reason}`)
    }
    // last resort so a stuck bot can never freeze the battle: it resigns
    console.error(`[bot] no accepted answer for ${pending.kind}; resigning seat ${pending.seat}`)
    const r = step(state, { type: 'resign', seat: pending.seat, decisionId: pending.id, payload: {} })
    if (!r.rejection) apply(r.state, r.events, r.pending)
  }

  async function runBot(expectedId: string, gen: number): Promise<void> {
    const backlog = Math.max(0, usePresentedStore.getState().latestSeq - usePresentedStore.getState().presentedSeq)
    await waitForPresentationIdle(PRESENTATION_IDLE_TIMEOUT_MS + backlog * 150)
    await sleep(Math.round(BOT_DELAY_MS * speedFactor(useSettings.getState().animSpeed)))
    if (gen !== generation) return
    answerForBot(expectedId)
  }

  function startWatchdog(): void {
    if (watchdog) return
    watchdog = setInterval(() => {
      const { pending, seats, state } = get()
      if (!pending || !state || state.phase === 'ended') {
        watchId = null
        return
      }
      if (pending.id !== watchId) {
        watchId = pending.id
        watchSince = Date.now()
        return
      }
      if (isAnnouncementHolding()) {
        watchSince = Date.now()
        return
      }
      if (seats[pending.seat] === 'bot' && Date.now() - watchSince >= NO_PROGRESS_MS) {
        console.warn(`[bot] watchdog answering ${pending.kind}`)
        watchSince = Date.now()
        answerForBot(pending.id)
      }
    }, WATCHDOG_POLL_MS)
  }

  return {
    state: null,
    pending: null,
    legal: null,
    meta: null,
    seats: { A: 'human', B: 'bot' },
    events: [],
    rejection: null,

    newGame(opts) {
      generation++
      if (botTimer) clearTimeout(botTimer)
      resetDirector()
      clearAnims()
      clearFeed()
      setDirectorPerspective(perspectiveOf(opts.seats))
      setDirectorBotSeats(botSeatsOf(opts.seats))
      const setup = buildGameSetup(opts.builds, { scenarioId: opts.scenarioId, boardId: opts.boardId })
      let r = createGame(setup, opts.seed, engineBundle())
      if (opts.prepare) {
        const prepared = opts.prepare(r.state)
        r = { state: prepared, pending: prepared.pending, events: [] }
      }
      bots = { A: new RandomBot(`${opts.seed}:A`), B: new RandomBot(`${opts.seed}:B`) }
      savable = !opts.prepare
      set({ state: null, pending: null, legal: null, events: [], rejection: null, seats: { ...opts.seats }, meta: { seed: opts.seed, scenarioId: opts.scenarioId, boardId: opts.boardId, builds: opts.builds } })
      resetPresentation(r.state.seq, r.state)
      set({ state: r.state, pending: r.pending, legal: r.pending ? legalActions(r.state, r.pending) : [], events: [...r.events] })
      enqueueBatch({ seq: r.state.seq, events: r.events, state: r.state })
      autosave(r.state)
      startWatchdog()
      scheduleBot()
    },

    restore(env) {
      // replay first: if it is rejected or the hash differs this throws before anything on screen or in the store changes
      const r = engineLoad(env.file, engineBundle())
      const { meta: m } = env
      generation++
      if (botTimer) clearTimeout(botTimer)
      resetDirector()
      clearAnims()
      clearFeed()
      setDirectorPerspective(perspectiveOf(m.seats))
      setDirectorBotSeats(botSeatsOf(m.seats))
      bots = { A: new RandomBot(`${m.seed}:A`), B: new RandomBot(`${m.seed}:B`) }
      savable = true
      resetPresentation(r.state.seq, r.state)
      set({
        state: r.state,
        pending: r.pending,
        legal: r.pending ? legalActions(r.state, r.pending) : [],
        events: [],
        rejection: null,
        seats: { ...m.seats },
        meta: { seed: m.seed, scenarioId: m.scenarioId, boardId: m.boardId, builds: m.builds },
      })
      // an empty batch: the board opens on the current position; no dice, shots or banners are replayed
      enqueueBatch({ seq: r.state.seq, events: [], state: r.state })
      startWatchdog()
      scheduleBot()
    },

    dispatch(action) {
      const state = get().state
      if (!state) return null
      const r = step(state, action)
      if (r.rejection) {
        if (get().seats[action.seat] === 'bot') {
          // bots guess; their rejections are logged only, never shown
          console.debug(`[bot] ${action.type} rejected: ${r.rejection.code} ${r.rejection.reason}`)
          return r.rejection
        }
        rejectionNonce++
        set({ rejection: { code: r.rejection.code, reason: r.rejection.reason, nonce: rejectionNonce } })
        // at most one rejection toast per human action: the newest replaces the previous one
        clearToasts()
        pushToast(rejectionText(r.rejection), r.rejection.code === 'E_TODO' ? 'warn' : 'error')
        return r.rejection
      }
      apply(r.state, r.events, r.pending)
      return null
    },

    choose(optionId) {
      const { pending, dispatch } = get()
      if (!pending) return null
      if (optionId === 'pass') return dispatch({ type: 'pass', seat: pending.seat, decisionId: pending.id, payload: {} })
      const opt = pending.options?.find((o) => o.id === optionId)
      if (!opt) return { code: 'E_NOT_AN_OPTION', reason: `no option ${optionId}` }
      return dispatch(opt.action)
    },

    pass() {
      return get().choose('pass')
    },

    exportSave() {
      const s = get().state
      return s ? engineSave(s) : null
    },

    reset() {
      generation++
      if (botTimer) clearTimeout(botTimer)
      resetDirector()
      clearAnims()
      clearFeed()
      resetPresentation(-1, null)
      set({ state: null, pending: null, legal: null, meta: null, events: [], rejection: null })
    },
  }
})

/** Seat whose decision is pending and who is a human (the UI may act for it). */
export function humanToAct(): Seat | null {
  const { pending, seats, state } = useGame.getState()
  return pending && state?.phase !== 'ended' && seats[pending.seat] === 'human' ? pending.seat : null
}
