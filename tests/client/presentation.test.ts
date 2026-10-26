// Presentation (client/presentation/*): the presented-seq cursor only advances after a batch has played, the idle flag follows the
// queue, 'instant' skips pauses, the feed gets the events' lines in order, and the pure helpers (move tween, deploy camera,
// volley landings, shot camera, feed text) behave.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameEvent } from '@/engine'
import { animPosition, clearAnims, startMoveAnim } from '../../src/client/presentation/animStore'
import { useAnnouncementStore } from '../../src/client/presentation/announceStore'
import { deployBeats, deployTimes, returnView, viewsDiffer, zoneFocus } from '../../src/client/presentation/deployCamera'
import { beatMs, enqueueBatch, moveDurationMs, resetDirector, setDirectorBotSeats, setDirectorPerspective } from '../../src/client/presentation/director'
import { clearFeed, groupFeed, useFeedStore } from '../../src/client/presentation/feedStore'
import { planLandings } from '../../src/client/presentation/heldVolley'
import { isPresentationIdle, waitForPresentationIdle } from '../../src/client/presentation/idleStore'
import { pickDisplaySnapshot, pushSnapshot, resetPresentation, usePresentedStore } from '../../src/client/presentation/presentedStore'
import { useSettings } from '../../src/client/presentation/settings'
import { closeupView, shoulderView, volleyBeat } from '../../src/client/presentation/shotCamera'
import { describeEvent } from '../../src/client/game/labels'
import { batchOf, installStorage, newRealGame, playGame } from '../fixtures/presentation'

const ev = <T extends GameEvent['type']>(type: T, rest: Omit<Extract<GameEvent, { type: T }>, 'type' | 'seq' | 'round' | 'phase' | 'seat'>, seq = 1, seat: 'A' | 'B' | null = 'A'): GameEvent =>
  ({ type, seq, round: 1, phase: 'action', seat, ...rest }) as GameEvent

describe('presented cursor and snapshots', () => {
  it('the display state is the last snapshot at or before the cursor', () => {
    const g = newRealGame('cursor')
    resetPresentation(g.state.seq, g.state)
    const later = { ...g.state, seq: g.state.seq + 5 }
    pushSnapshot(later.seq, later)
    const s = usePresentedStore.getState()
    expect(s.latestSeq).toBe(later.seq)
    expect(pickDisplaySnapshot(s.snapshots, s.presentedSeq)).toBe(g.state)
    expect(pickDisplaySnapshot(s.snapshots, later.seq)).toBe(later)
    expect(pickDisplaySnapshot([], 3)).toBeNull()
  })
})

describe('director', () => {
  beforeEach(() => {
    installStorage()
    useSettings.setState({ animSpeed: 'instant' })
    resetDirector()
    clearFeed()
    clearAnims()
  })
  afterEach(() => {
    vi.useRealTimers()
    resetDirector()
  })

  it('instant speed plays a batch at once: feed lines in event order, cursor at the batch, idle again', async () => {
    const played = playGame('director', (s) => s.seq >= 60)
    const first = played.steps.slice(0, 12)
    resetPresentation(played.created.state.seq, played.created.state)
    for (const st of first) {
      pushSnapshot(st.state.seq, st.state)
      enqueueBatch(batchOf(st.state, st.events))
    }
    await waitForPresentationIdle(2000)
    expect(isPresentationIdle()).toBe(true)
    const last = first[first.length - 1]!.state.seq
    expect(usePresentedStore.getState().presentedSeq).toBe(last)
    const feed = useFeedStore.getState().feed
    expect(feed.length).toBeGreaterThan(0)
    // feed entries are in seq order: nothing shown out of order
    expect(feed.map((f) => f.seq)).toEqual([...feed.map((f) => f.seq)].sort((a, b) => a - b))
    expect(useAnnouncementStore.getState().current).toBeNull()
  })

  it('a normal-speed batch holds the cursor until its beats have played, then releases it', async () => {
    vi.useFakeTimers()
    useSettings.setState({ animSpeed: 'normal' })
    const g = newRealGame('hold')
    resetPresentation(g.state.seq - 1, g.state)
    const next = { ...g.state, seq: g.state.seq + 1 }
    pushSnapshot(next.seq, next)
    enqueueBatch({ seq: next.seq, state: next, events: [ev('PriorityDecided', { holder: 'A', rolls: { A: 6, B: 2 }, tieRule: false }, next.seq)] })
    await vi.advanceTimersByTimeAsync(10)
    // the Priority banner is on screen and the cursor has not moved
    expect(useAnnouncementStore.getState().current?.title).toContain('Priority')
    expect(usePresentedStore.getState().presentedSeq).toBe(g.state.seq - 1)
    expect(isPresentationIdle()).toBe(false)
    await vi.advanceTimersByTimeAsync(beatMs(ev('PriorityDecided', { holder: 'A', rolls: { A: 1, B: 1 }, tieRule: false })) + 200)
    expect(usePresentedStore.getState().presentedSeq).toBe(next.seq)
    expect(isPresentationIdle()).toBe(true)
    expect(useAnnouncementStore.getState().current).toBeNull()
  })

  it('a move event starts the walking tween on the engine path and releases it with the cursor', async () => {
    vi.useFakeTimers()
    useSettings.setState({ animSpeed: 'normal' })
    const g = newRealGame('walk')
    const path = [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 3 }]
    resetPresentation(g.state.seq - 1, g.state)
    pushSnapshot(g.state.seq, g.state)
    enqueueBatch({ seq: g.state.seq, state: g.state, events: [ev('FighterMoved', { fighterId: 'a1', kind: 'move', from: { x: 0, y: 0, z: 0 }, to: { x: 2, y: 0, z: 3 }, path, length: 5, maxInches: 5 }, g.state.seq)] })
    await vi.advanceTimersByTimeAsync(5)
    const mid = animPosition('a1', performance.now() + moveDurationMs(5) / 2)
    expect(mid).not.toBeNull()
    await vi.advanceTimersByTimeAsync(moveDurationMs(5) + 50)
    expect(animPosition('a1')).toBeNull()
    expect(usePresentedStore.getState().presentedSeq).toBe(g.state.seq)
  })

  it('reset drops the queue and leaves the presentation idle', async () => {
    vi.useFakeTimers()
    useSettings.setState({ animSpeed: 'normal' })
    const g = newRealGame('reset')
    enqueueBatch({ seq: g.state.seq, state: g.state, events: [ev('RoundStarted', { round: 1 }, g.state.seq)] })
    expect(isPresentationIdle()).toBe(false)
    resetDirector()
    expect(isPresentationIdle()).toBe(true)
    expect(useAnnouncementStore.getState().current).toBeNull()
  })

  it('pauses scale with the event: dice and injuries take longer than bookkeeping', () => {
    expect(beatMs(ev('InjuryRolled', { targetId: 'a1', faces: [], applied: '' }))).toBeGreaterThan(beatMs(ev('WoundRolled', { targetId: 'a1', roll: 3, need: 4, wounded: false })))
    expect(beatMs(ev('EngagementChanged', { fighterId: 'a1', engagedWith: [] }))).toBe(0)
    expect(moveDurationMs(0.1)).toBeGreaterThanOrEqual(200)
    expect(moveDurationMs(1000)).toBeLessThanOrEqual(2000)
  })
})

describe('move tween', () => {
  it('walks the polyline at an even pace and ends on the last point', () => {
    clearAnims()
    startMoveAnim('f', [{ x: 0, z: 0 }, { x: 4, z: 0 }], 1000)
    const t0 = performance.now()
    const mid = animPosition('f', t0 + 500)!
    expect(mid.x).toBeGreaterThan(1.5)
    expect(mid.x).toBeLessThan(2.5)
    expect(mid.heading).toBeCloseTo(Math.PI / 2, 3)
    const end = animPosition('f', t0 + 5000)!
    expect(end.x).toBeCloseTo(4, 3)
    clearAnims()
    expect(animPosition('f')).toBeNull()
  })
})

describe('deploy camera', () => {
  it('only a human against a bot gets deploy beats: record the own deploy, visit the bot one', () => {
    const events = [ev('FighterDeployed', { fighterId: 'a1', pos: { x: 1, y: 0, z: 2 }, facing: 0 }, 1, 'A'), ev('FighterDeployed', { fighterId: 'b1', pos: { x: 3, y: 0, z: 4 }, facing: 0 }, 2, 'B')]
    const ctx = { perspective: 'A' as const, botSeats: ['B' as const], factor: 1 }
    expect(deployBeats(events, 'setup', ctx)).toEqual([
      { index: 0, beat: { kind: 'record' } },
      { index: 1, beat: { kind: 'visit', x: 3, z: 4 } },
    ])
    expect(deployBeats(events, 'setup', { ...ctx, factor: 0 })).toEqual([])
    expect(deployBeats(events, 'action', ctx)).toEqual([])
    expect(deployBeats(events, 'setup', { ...ctx, botSeats: [] })).toEqual([])
    expect(deployBeats(events, 'setup', { ...ctx, perspective: null })).toEqual([])
  })

  it('frames the deployment strip once the half is chosen, and the return view prefers the player\'s own', () => {
    const g = playGame('zone', (s) => s.phase !== 'setup')
    expect(zoneFocus(g.state, 'A')).not.toBeNull()
    expect(zoneFocus(g.state, null)).toBeNull()
    expect(returnView('mine', 'zone', 'before')).toBe('mine')
    expect(returnView(null, 'zone', 'before')).toBe('zone')
    expect(viewsDiffer({ position: [0, 1, 2], target: [0, 0, 0] }, { position: [0, 1, 2.01], target: [0, 0, 0] })).toBe(false)
    expect(viewsDiffer({ position: [0, 1, 2], target: [0, 0, 0] }, { position: [3, 1, 2], target: [0, 0, 0] })).toBe(true)
    expect(deployTimes(0)).toEqual({ fly: 0, hold: 0 })
  })

  it('bot seats are fed to the director through the setters', () => {
    expect(() => {
      setDirectorPerspective('A')
      setDirectorBotSeats(['B'])
    }).not.toThrow()
  })
})

describe('volleys and the shot camera', () => {
  it('one tracer per Firepower hit, paired in order with the saves and wounds that followed', () => {
    const events: GameEvent[] = [
      ev('ShootStarted', { fighterId: 'a1', weaponId: 'w', profileId: 'p', mode: 'shoot' }),
      ev('TargetDeclared', { fighterId: 'a1', targetId: 'b1', distance: 5, band: 'short', cover: 'none', need: 4, modifiers: [] }),
      ev('FirepowerRolled', { fighterId: 'a1', faces: ['hit1', 'hit2'], hits: 3, ammoSymbols: 0 }),
      ev('SaveRolled', { targetId: 'b1', roll: 5, need: 5, saved: true, item: null }),
      ev('WoundRolled', { targetId: 'b1', roll: 6, need: 4, wounded: true }),
      ev('DamageInflicted', { targetId: 'b1', amount: 1, wounds: 1 }),
    ]
    const plan = planLandings(events)
    expect(plan.shots.map((s) => s.outcome)).toEqual(['blocked', 'damage', 'miss'])
    expect(plan.shots.every((s) => s.targetId === 'b1')).toBe(true)
    expect(volleyBeat(plan)).toBe('closeup')
    expect(volleyBeat({ shots: [{ targetId: 'b1', outcome: 'miss' }], orphanItems: [] })).toBe('shoulder-hold')
    expect(planLandings([ev('FighterMoved', { fighterId: 'a1', kind: 'move', from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 0 }, path: [], length: 1, maxInches: 5 })]).shots).toEqual([])
  })

  it('the shoulder view sits behind the shooter looking at the target; the close-up looks down on it', () => {
    const shooter = { x: 0, y: 0, z: 0, height: 2 }
    const target = { x: 0, y: 0, z: 10, height: 2 }
    const sh = shoulderView(shooter, target)
    expect(sh.position[2]).toBeLessThan(0)
    expect(sh.target).toEqual([0, 1, 10])
    const cu = closeupView(shooter, target)
    expect(cu.position[1]).toBeGreaterThan(cu.target[1])
    expect(Math.hypot(cu.position[0] - 0, cu.position[2] - 10)).toBeGreaterThan(3)
  })
})

describe('feed text', () => {
  it('names fighters and gangs from the state, and keeps bookkeeping events out of the feed', () => {
    const g = newRealGame('text', true)
    const f = Object.values(g.state.fighters)[0]!
    expect(describeEvent(ev('FighterDeployed', { fighterId: f.id, pos: { x: 0, y: 0, z: 0 }, facing: 0 }), g.state)).toBe(`${f.name} deploys.`)
    expect(describeEvent(ev('DecisionRequested', { decisionId: 'd:1', kind: 'action.activate', window: 'action.phaseStart' }), g.state)).toBeNull()
    expect(describeEvent(ev('DoorChanged', { doorId: 't0.d1', state: 'open', locked: false }), g.state)).toBe('Door t0.d1 is open.')
    expect(describeEvent(ev('PriorityDecided', { holder: 'B', rolls: { A: 2, B: 5 }, tieRule: false }), g.state)).toContain(g.state.players.B.gangName)
    // every event of a real round has a line or is deliberately silent, and no line leaks "undefined" or an object
    const played = playGame('text-round')
    for (const st of played.steps) for (const e of st.events) {
      const line = describeEvent(e, st.state)
      if (line !== null) expect(line, e.type).not.toMatch(/undefined|\[object|NaN/)
    }
  })

  it('groups consecutive dice lines', () => {
    const groups = groupFeed([
      { id: 1, seq: 1, seat: 'A', text: 'x' },
      { id: 2, seq: 2, seat: 'A', text: 'hit', dice: true },
      { id: 3, seq: 2, seat: 'A', text: 'wound', dice: true },
      { id: 4, seq: 3, seat: 'B', text: 'y' },
    ])
    expect(groups.map((g) => g.length)).toEqual([1, 2, 1])
  })
})
