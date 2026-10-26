// Cinematic shooting camera: the over-the-shoulder and close-up views, which volleys earn a close-up, and what the
// director does with the camera around a Shoot action (fly in, close in on a hit, fly back once, leave it when the
// player takes over, do nothing when switched off or at instant speed).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GameEvent, GameState, MapDef } from '@/engine'
import { cameraApi, type CameraApi, type CameraView } from '@/client/board/cameraApi'
import { enqueueBatch, resetDirector } from '@/client/presentation/director'
import { planLandings } from '@/client/presentation/heldVolley'
import { waitForPresentationIdle } from '@/client/presentation/idleStore'
import { pushSnapshot, resetPresentation } from '@/client/presentation/presentedStore'
import { useSettings } from '@/client/presentation/settings'
import { cinematicOn, closeupView, landingBeat, lensBlockedTop, shoulderView, shoulderViewClear, volleyBeat, type Body } from '@/client/presentation/shotCamera'
import { useShotStore } from '@/client/presentation/shotStore'
import { clearCues } from '@/client/figures/cueCore'
import { clearFx } from '@/client/presentation/fxStore'
import { resetFx } from '@/client/vfx/api'

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - b[i]!))
const shooter: Body = { x: 0, y: 0, z: 0, height: 2 }
const target: Body = { x: 0, y: 0, z: 10, height: 2 }

describe('shot camera views', () => {
  it('SHOTCAM-001 the shoulder view sits behind the shooter, beside and above the head, looking at the target chest', () => {
    const v = shoulderView(shooter, target)
    // opposite the target (target is +Z, so the lens is at -Z), 5" back, 1.5" to one side, 1.5" above a 2" head
    expect(v.position[2]).toBeLessThan(-4.5)
    expect(Math.abs(v.position[0])).toBeGreaterThan(1.3)
    expect(Math.abs(v.position[0])).toBeLessThan(1.7)
    expect(v.position[1]).toBeGreaterThan(3.2)
    expect(v.position[1]).toBeLessThan(4)
    expect(v.target).toEqual([0, 1, 10])
    // the shooter is in front of the lens: the view direction and the lens-to-shooter direction nearly agree
    const look = [v.target[0] - v.position[0], v.target[2] - v.position[2]]
    const toShooter = [shooter.x - v.position[0], shooter.z - v.position[2]]
    const cos = (look[0]! * toShooter[0]! + look[1]! * toShooter[1]!) / (Math.hypot(...look) * Math.hypot(...toShooter))
    expect(cos).toBeGreaterThan(0.9)
    // the other shoulder mirrors it; a diagonal shot keeps the lens behind the shooter
    expect(shoulderView(shooter, target, { side: -1 }).position[0]).toBeCloseTo(-v.position[0], 6)
    const diag = shoulderView(shooter, { ...target, x: 8, z: 8 })
    expect((diag.position[0] - shooter.x) * 8 + (diag.position[2] - shooter.z) * 8).toBeLessThan(0)
    // the close-up is about 7.5" from the target, on the shooter's side, looking down at about 37 degrees
    const c = closeupView(shooter, target)
    expect(dist(c.position, [target.x, 1, target.z])).toBeGreaterThan(7)
    expect(dist(c.position, [target.x, 1, target.z])).toBeLessThan(8)
    expect(c.position[2]).toBeLessThan(target.z)
    const pitch = (Math.atan2(c.position[1] - 1, dist([c.position[0], c.position[2]], [target.x, target.z])) * 180) / Math.PI
    expect(pitch).toBeGreaterThan(35)
    expect(pitch).toBeLessThan(40)
    expect(c.target[0]).toBe(target.x)
    // a figure with no height is taken as 2" tall
    expect(shoulderView({ ...shooter, height: 0 }, target).position[1]).toBeCloseTo(v.position[1], 6)
  })

  it('SHOTCAM-002 the other shoulder or a raised lens clears a wall; a close-up only follows a die that got through', () => {
    const wall = (x0: number, x1: number): MapDef =>
      ({
        id: 'm',
        size: { x: 30, z: 22 },
        dropZones: [],
        features: [{ id: 'f', parts: [{ id: 'p', footprint: [{ x: x0, z: -6 }, { x: x1, z: -6 }, { x: x1, z: -3 }, { x: x0, z: -3 }], height: 5, traits: ['heavy'] }] }],
      }) as unknown as MapDef
    const right = shoulderView(shooter, target)
    const left = shoulderView(shooter, target, { side: -1 })
    // a wall where the right-hand lens would be: the director picks the left shoulder
    const onRight = wall(right.position[0] - 0.4, right.position[0] + 0.4)
    expect(lensBlockedTop(onRight, right, [0, 2, 0])).toBe(5)
    expect(shoulderViewClear(onRight, shooter, target).position[0]).toBeCloseTo(left.position[0], 6)
    // walls on both shoulders: the lens rises over the top
    const both = wall(-3, 3)
    expect(shoulderViewClear(both, shooter, target).position[1]).toBeGreaterThan(5)
    expect(shoulderViewClear(undefined, shooter, target)).toEqual(right)
    // landings: only an unblocked die earns the close-up
    expect(landingBeat('damage')).toBe('closeup')
    expect(landingBeat('blocked')).toBe('none')
    expect(landingBeat('miss')).toBe('none')
    const blocked = planLandings(['normal', 'fail'], { blockedNormal: 1, blockedCrit: 0, unblockedNormal: 0, unblockedCrit: 0 }, [])
    expect(volleyBeat(blocked)).toBe('shoulder-hold')
    const through = planLandings(['normal', 'fail'], { blockedNormal: 0, blockedCrit: 0, unblockedNormal: 1, unblockedCrit: 0 }, [{ kind: 'damage', operativeId: 'B1' }])
    expect(volleyBeat(through)).toBe('closeup')
    expect(volleyBeat(planLandings(['fail', 'fail'], null, []))).toBe('shoulder-hold')
    // off, instant speed or no camera: no cinematic
    expect(cinematicOn(true, 1, true)).toBe(true)
    expect(cinematicOn(false, 1, true)).toBe(false)
    expect(cinematicOn(true, 0, true)).toBe(false)
    expect(cinematicOn(true, 1, false)).toBe(false)
  })
})

// ---------------------------------------------------------------- the director around a shot

const ev = (seq: number, body: Record<string, unknown>) => ({ seq, turningPoint: 1, phase: 'firefight', seat: 'A', ...body }) as unknown as GameEvent
function opState(): GameState {
  const op = (id: string, seat: 'A' | 'B', x: number, z: number, datacardId: string) => ({
    id,
    seat,
    datacardId,
    pos: { x, y: 0, z },
    facing: 0,
    baseRadius: 0.5,
    height: 1.2,
    wounds: 6,
    maxWounds: 12,
    status: 'active',
    flags: { injured: false },
  })
  return {
    seq: 3,
    operatives: { A1: op('A1', 'A', -4, 0, 'aod.intercessor-gunner'), B1: op('B1', 'B', 4, 0, 'kom.boy'), B2: op('B2', 'B', 4, 5, 'kom.boy') },
    data: { datacards: {}, weapons: {} },
  } as unknown as GameState
}
const W = 'aod.w.auto-bolt-rifle'
const volley = (seq: number, targetId: string, hit: boolean, secondary = false): GameEvent[] => [
  ev(seq, { type: 'TargetSelected', operativeId: 'A1', targetId, weaponId: W, secondary, distance: 8, inCover: false, obscured: false, improvedCover: false }),
  ev(seq, { type: 'AttackDiceRolled', operativeId: 'A1', targetId, weaponId: W, dice: [4, 2], kinds: ['normal', 'fail'], need: 3, lethal: null }),
  ev(seq, { type: 'DiceBlocked', targetId, blockedNormal: hit ? 0 : 1, blockedCrit: 0, unblockedNormal: hit ? 1 : 0, unblockedCrit: 0 }),
  ...(hit ? [ev(seq, { type: 'DamageInflicted', operativeId: targetId, sourceId: 'A1', amount: 2, source: 'normal', wounds: 4 })] : []),
]
const shoot = (seq: number, volleys: GameEvent[][]): GameEvent[] => [
  ev(seq, { type: 'ShootStarted', operativeId: 'A1', weaponId: W }),
  ...volleys.flat(),
  ev(seq, { type: 'ShootEnded', operativeId: 'A1', weaponId: W }),
]

describe('director shot camera', () => {
  const calls: string[] = []
  const home: CameraView = { position: [0, 25, 21], target: [0, 0, 1] }
  let pose: CameraView
  let active = false
  let cancelAt: number | null = null
  let flights = 0
  const hidden: string[] = []
  const fake: CameraApi = {
    project: () => ({ x: 0, y: 0 }),
    lookAt: () => {},
    get: () => ({ x: 0, z: 0, distance: 20 }),
    repaint: () => {},
    snapshot: () => ({ position: [...pose.position], target: [...pose.target] }),
    focusView: (x, z, d) => ({ position: [x, d, z + d], target: [x, 0, z] }),
    cinematic: (on) => {
      calls.push(on ? 'cine:on' : 'cine:off')
      active = on
    },
    cinematicActive: () => active,
    flyTo: async (view) => {
      flights++
      const name = view.position[1] > 10 ? 'saved' : Math.hypot(view.position[0] - view.target[0], view.position[2] - view.target[2]) < 7 ? 'closeup' : 'shoulder'
      if (cancelAt === flights) {
        active = false // the player grabbed the camera mid-flight
        calls.push(`${name}:cancelled`)
        return false
      }
      calls.push(name)
      hidden.push(`${name}:${useShotStore.getState().hideMarkersOf}`)
      pose = view
      return true
    },
  }

  beforeEach(() => {
    resetDirector()
    resetFx()
    clearFx()
    clearCues()
    resetPresentation(0, opState())
    calls.length = 0
    hidden.length = 0
    flights = 0
    cancelAt = null
    active = false
    pose = { position: [...home.position], target: [...home.target] }
    cameraApi.current = fake
    useSettings.getState().setAnimSpeed('fast')
    useSettings.getState().setCinematicShots(true)
  })
  afterEach(() => {
    cameraApi.current = null
    useSettings.getState().setCinematicShots(true)
  })

  const play = async (events: GameEvent[]) => {
    const state = opState()
    pushSnapshot(3, state)
    enqueueBatch({ seq: 3, state, events })
    await waitForPresentationIdle(12000)
  }

  it('SHOTCAM-003 a hit: shoulder view, close-up on the target, then back to exactly the saved view', async () => {
    await play(shoot(3, [volley(3, 'B1', true)]))
    expect(calls).toEqual(['cine:on', 'shoulder', 'closeup', 'saved', 'cine:off'])
    expect(pose).toEqual(home)
    // the shooter's overhead markers are hidden for the shoulder and close-up, and back when the camera heads home
    expect(hidden).toEqual(['shoulder:A1', 'closeup:A1', 'saved:null'])
  }, 15000)

  it('SHOTCAM-004 everything blocked: the shoulder view holds, no close-up; two volleys in one action return once', async () => {
    await play(shoot(3, [volley(3, 'B1', false)]))
    expect(calls).toEqual(['cine:on', 'shoulder', 'saved', 'cine:off'])
    calls.length = 0
    await play(shoot(3, [volley(3, 'B1', true), volley(3, 'B2', true, true)]))
    expect(calls).toEqual(['cine:on', 'shoulder', 'closeup', 'shoulder', 'closeup', 'saved', 'cine:off'])
  }, 25000)

  it('SHOTCAM-005 the player taking the camera drops the rest of the cinematic: no more flights, no return', async () => {
    cancelAt = 2 // the close-up flight is cancelled
    await play(shoot(3, [volley(3, 'B1', true), volley(3, 'B2', true, true)]))
    expect(calls).toEqual(['cine:on', 'shoulder', 'closeup:cancelled', 'cine:off'])
    expect(pose.position[1]).toBeLessThan(10) // never flew back
  }, 25000)

  it('SHOTCAM-006 switched off or instant speed: the camera is never touched', async () => {
    useSettings.getState().setCinematicShots(false)
    await play(shoot(3, [volley(3, 'B1', true)]))
    expect(calls).toEqual([])
    useSettings.getState().setCinematicShots(true)
    useSettings.getState().setAnimSpeed('instant')
    await play(shoot(3, [volley(3, 'B1', true)]))
    expect(calls).toEqual([])
    expect(pose).toEqual(home)
  }, 15000)
})
