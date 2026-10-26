// Deployment camera: a bot's Setup-phase deploy makes the camera visit the figure and return to the player's view.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GameEvent, GameState } from '@/engine'
import { cameraApi, type CameraApi, type CameraView } from '@/client/board/cameraApi'
import { deployBeats, returnView, viewsDiffer, zoneFocus } from '@/client/presentation/deployCamera'
import { enqueueBatch, resetDirector, setDirectorBotSeats, setDirectorPerspective } from '@/client/presentation/director'
import { waitForPresentationIdle } from '@/client/presentation/idleStore'
import { pushSnapshot, resetPresentation, usePresentedStore } from '@/client/presentation/presentedStore'
import { useSettings } from '@/client/presentation/settings'

const deployed = (seq: number, seat: 'A' | 'B', x: number, z: number) =>
  ({ seq, turningPoint: 0, phase: 'setup', seat, type: 'OperativeDeployed', operativeId: `${seat}${seq}`, pos: { x, y: 0, z } }) as unknown as GameEvent
const stateOf = (seq: number, phase = 'setup') =>
  ({
    seq,
    phase,
    operatives: {},
    players: { A: { dropZoneId: 'zA' }, B: { dropZoneId: 'zB' } },
    map: { dropZones: [{ id: 'zA', polygon: [{ x: -15, z: 5 }, { x: 15, z: 5 }, { x: 15, z: 11 }, { x: -15, z: 11 }] }, { id: 'zB', polygon: [{ x: -15, z: -11 }, { x: 15, z: -11 }, { x: 15, z: -5 }, { x: -15, z: -5 }] }] },
  }) as unknown as GameState
const ctx = { perspective: 'A', botSeats: ['B'], factor: 1 } as const

describe('deploy camera decisions', () => {
  it('DEPLOYCAM-001 a bot deploy in setup is a visit; the player own deploy only records the view', () => {
    const events = [deployed(1, 'B', 3, -8), deployed(2, 'A', 0, 8)]
    expect(deployBeats(events, 'setup', ctx)).toEqual([
      { index: 0, beat: { kind: 'visit', x: 3, z: -8 } },
      { index: 1, beat: { kind: 'record' } },
    ])
  })

  it('DEPLOYCAM-002 the return view is the last deploy view, else the player drop zone, else where the camera was', () => {
    const last: CameraView = { position: [1, 20, 20], target: [1, 0, 8] }
    const zoneView: CameraView = { position: [0, 25, 26], target: [0, 0, 8] }
    const before: CameraView = { position: [0, 25, 21], target: [0, 0, 1] }
    expect(returnView(last, zoneView, before)).toBe(last)
    expect(returnView(null, zoneView, before)).toBe(zoneView)
    expect(returnView(null, null, before)).toBe(before)
    const zf = zoneFocus(stateOf(1), 'A')!
    expect(zf.x).toBe(0)
    expect(zf.z).toBe(8)
    expect(zf.distance).toBeGreaterThanOrEqual(16)
    expect(zoneFocus({ ...stateOf(1), players: { A: { dropZoneId: null }, B: { dropZoneId: null } } } as unknown as GameState, 'A')).toBeNull()
    expect(viewsDiffer(last, { position: [1, 20, 20.01], target: [1, 0, 8] })).toBe(false)
    expect(viewsDiffer(last, { position: [4, 20, 20], target: [1, 0, 8] })).toBe(true)
  })

  it('DEPLOYCAM-003 hot-seat, bot-vs-bot, instant speed and non-setup deploys never move the camera', () => {
    const events = [deployed(1, 'B', 3, -8), deployed(2, 'A', 0, 8)]
    expect(deployBeats(events, 'setup', { ...ctx, botSeats: [] })).toEqual([])
    expect(deployBeats(events, 'setup', { ...ctx, perspective: null })).toEqual([])
    expect(deployBeats(events, 'setup', { ...ctx, factor: 0 })).toEqual([])
    expect(deployBeats(events, 'firefight', ctx)).toEqual([])
    expect(deployBeats([deployed(2, 'A', 0, 8)], 'setup', ctx).every((b) => b.beat.kind === 'record')).toBe(true)
  })
})

describe('director deploy camera', () => {
  const calls: string[] = []
  let pose: CameraView
  const fake: CameraApi = {
    project: () => ({ x: 0, y: 0 }),
    lookAt: () => {},
    get: () => ({ x: 0, z: 0, distance: 20 }),
    repaint: () => {},
    snapshot: () => ({ position: [...pose.position], target: [...pose.target] }),
    focusView: (x, z, d) => ({ position: [x, d, z + d], target: [x, 0, z] }),
    flyTo: async (view) => {
      calls.push(`fly:${view.target[0]},${view.target[2]}:cursor${usePresentedStore.getState().presentedSeq}`)
      pose = view
      return true
    },
  }

  beforeEach(() => {
    resetDirector()
    resetPresentation(0, stateOf(0))
    calls.length = 0
    pose = { position: [0, 25, 21], target: [0, 0, 1] }
    cameraApi.current = fake
    useSettings.getState().setAnimSpeed('fast')
    setDirectorPerspective('A')
    setDirectorBotSeats(['B'])
  })
  afterEach(() => {
    cameraApi.current = null
    setDirectorBotSeats([])
  })

  const play = async (seq: number, events: GameEvent[]) => {
    pushSnapshot(seq, stateOf(seq))
    enqueueBatch({ seq, state: stateOf(seq), events })
    await waitForPresentationIdle(4000)
  }

  it('DEPLOYCAM-004 a bot deploy flies to the figure (cursor already advanced), then back to the last player deploy view', async () => {
    pose = { position: [2, 18, 24], target: [2, 0, 9] }
    await play(1, [deployed(1, 'A', 2, 9)])
    expect(calls).toEqual([])
    pose = { position: [0, 25, 21], target: [0, 0, 1] } // the player looked elsewhere afterwards
    await play(2, [deployed(2, 'B', 4, -8), deployed(3, 'B', -5, -7)])
    // two visits, one return; the figure is on screen (cursor 2) from the first arrival
    expect(calls).toEqual(['fly:4,-8:cursor1', 'fly:-5,-7:cursor2', 'fly:2,9:cursor2'])
    expect(usePresentedStore.getState().presentedSeq).toBe(2)
  })

  it('DEPLOYCAM-005 with no player deploy yet the camera returns to the player drop zone', async () => {
    await play(1, [deployed(1, 'B', 4, -8)])
    expect(calls).toEqual(['fly:4,-8:cursor0', 'fly:0,8:cursor1'])
  })

  it('DEPLOYCAM-006 instant speed leaves the camera alone', async () => {
    useSettings.getState().setAnimSpeed('instant')
    await play(1, [deployed(1, 'B', 4, -8)])
    expect(calls).toEqual([])
  })
})
