// Presentation director: turns each accepted step's events into timed beats (feed lines, dice log, banners, move tweens,
// tracers, impact flashes, wound overrides, the deployment and shot cameras) and only then advances the presented-seq cursor, so
// no result shows before it is played. 'instant' speed skips every pause, banner, effect and camera flight. Batches queue FIFO;
// the idle flag is true when the queue is empty. The dice tray is fed from the same loop (dice/trayEvents.ts); sounds play from it too (audio/eventSounds.ts); the vfx beats join it the same way.
import type { GameEvent, GameState, Seat } from '@/engine'
import { playEventSounds, shotSound } from '../audio/eventSounds'
import { audio } from '../audio/instance'
import { cameraApi, type CameraView } from '../board/cameraApi'
import { trayClear } from '../dice/trayStore'
import { trayEvent } from '../dice/trayEvents'
import { describeEvent, diceOf, gangName } from '../game/labels'
import { clearAnnouncement, holdAnnouncement } from './announceStore'
import { endMoveAnim, requestRepaint, startMoveAnim } from './animStore'
import { deployBeats, deployTimes, DEPLOY_FOCUS_DISTANCE, returnView, viewsDiffer, zoneFocus } from './deployCamera'
import { pushDice, pushFeed } from './feedStore'
import { clearFx, clearOverrides, setWoundOverride, spawnFx } from './fxStore'
import { planLandings } from './heldVolley'
import { addMark, clearMarks } from './markStore'
import { setPresentationIdle } from './idleStore'
import { catchUpPresented, setPresentedSeq } from './presentedStore'
import { speedFactor, useSettings } from './settings'
import { cinematicOn, closeupViewClear, shotTimes, shoulderViewClear, volleyBeat, type Body } from './shotCamera'
import { d6TestPasses } from '@/engine/dice'
import * as vfx from '../vfx/api'
import { vfxOf } from '../vfx/families'

export interface Batch {
  /** the seq of the last event of the step (the cursor value once played) */
  seq: number
  events: GameEvent[]
  /** the state AFTER the step (names, positions of everybody the events mention) */
  state: GameState
}

const queue: Batch[] = []
let running = false
let generation = 0

/** The seat the player watches from (null when nobody plays, e.g. bot vs bot): drives the deployment camera. */
let perspective: Seat | null = null
export function setDirectorPerspective(seat: Seat | null): void {
  perspective = seat
}
let botSeats: Seat[] = []
export function setDirectorBotSeats(seats: readonly Seat[]): void {
  botSeats = [...seats]
}
let lastPlayerView: CameraView | null = null

const factor = (): number => speedFactor(useSettings.getState().animSpeed)

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()
}

/** Base pause (ms at normal speed) per event type; the pause is a beat in which the event's effects play. */
export function beatMs(ev: GameEvent): number {
  switch (ev.type) {
    case 'PriorityDecided':
      return 1300
    case 'RoundStarted':
      return 900
    case 'DiceRolled':
      return 650
    case 'HitRolled':
    case 'FightHitRolled':
      return 420
    case 'WoundRolled':
    case 'SaveRolled':
      return 320
    case 'DamageInflicted':
      return 520
    case 'InjuryRolled':
      return 750
    case 'FighterOutOfAction':
      return 800
    case 'FighterPinned':
      return 500
    case 'NerveTest':
    case 'BottleTest':
    case 'FleeTest':
    case 'RallyTest':
      return 600
    case 'FirepowerRolled':
      return 650
    case 'DoorChanged':
      return 420
    case 'PointsScored':
      return 400
    case 'FighterActivated':
      return 240
    case 'FighterDeployed':
      return 220
    case 'GameEnded':
      return 900
    default:
      return 0
  }
}

/** Walking pace: ms per inch at normal speed, clamped so a short step is still seen and a long one is not tedious. */
export function moveDurationMs(length: number): number {
  return Math.min(1700, Math.max(260, length * 150))
}

const bodyOf = (state: GameState, id: string): Body | null => {
  const f = state.fighters[id]
  return f ? { x: f.pos.x, y: 0, z: f.pos.z, height: 1.9 } : null
}

function effectAt(state: GameState, id: string, kind: 'impact' | 'text', color: string, text: string): void {
  if (factor() <= 0) return
  const fighter = state.fighters[id]
  if (!fighter) return
  spawnFx({ kind, to: [fighter.pos.x, 1.4, fighter.pos.z], color, text, dur: kind === 'text' ? 1100 : 450 })
  requestRepaint()
}

const isDiceLine = (ev: GameEvent): boolean => ev.type === 'DiceRolled' || ev.type === 'HitRolled' || ev.type === 'WoundRolled' || ev.type === 'SaveRolled'

/** The weapon (and profile) of the attack a batch resolves, for the kill style of a casualty. */
function attackWeapon(b: Batch): { id: string; profileId: string | null } | null {
  for (const e of b.events) {
    if (e.type === 'ShootStarted') return { id: e.weaponId, profileId: e.profileId }
    if (e.type === 'FightStarted' && e.weapons[0]) return { id: e.weapons[0], profileId: null }
  }
  return null
}

async function playEvent(ev: GameEvent, b: Batch): Promise<void> {
  const f = factor()
  const state = b.state
  const line = describeEvent(ev, state)
  if (line) pushFeed(ev.seq, ev.seat, line, isDiceLine(ev))
  const dice = diceOf(ev)
  if (dice && ev.type === 'DiceRolled') pushDice(ev.seq, ev.seat, dice.purpose, dice.dice, dice.faces)
  trayEvent(ev, state)
  if (f > 0) playEventSounds((id, opts) => audio.play(id, opts), [ev], { state, perspective })
  const beat = Math.round(beatMs(ev) * f)
  switch (ev.type) {
    case 'FighterMoved': {
      if (f > 0 && ev.path.length >= 2) {
        const ms = Math.round(moveDurationMs(ev.length) * f)
        startMoveAnim(ev.fighterId, ev.path, ms)
        await sleep(ms)
      }
      break
    }
    case 'RoundStarted':
      if (f > 0) await holdAnnouncement({ title: `Round ${ev.round}`, subtitle: 'Priority, then the Action phase', seat: null, durationMs: beat })
      break
    case 'PriorityDecided':
      if (f > 0) {
        await holdAnnouncement({
          title: `${gangName(state, ev.holder)} has Priority`,
          subtitle: ev.tieRule ? 'Tied roll: the tie rule decides' : 'Higher roll takes it',
          seat: ev.holder,
          dice: [ev.rolls.A, ev.rolls.B],
          kinds: ['normal', 'normal'],
          durationMs: beat,
        })
      }
      break
    case 'GameEnded':
      if (f > 0) await holdAnnouncement({ title: ev.result.winner === 'draw' ? 'A draw' : `${gangName(state, ev.result.winner)} wins`, subtitle: 'The battle is over', seat: ev.result.winner === 'draw' ? null : ev.result.winner, durationMs: beat })
      break
    case 'DamageInflicted':
      setWoundOverride(ev.targetId, ev.wounds)
      effectAt(state, ev.targetId, 'impact', '#ff5a4f', `-${ev.amount}`)
      await sleep(beat)
      break
    case 'WoundRolled':
      if (!ev.wounded) effectAt(state, ev.targetId, 'text', '#d8d6cf', 'No wound')
      await sleep(beat)
      break
    case 'SaveRolled':
      if (ev.saved) effectAt(state, ev.targetId, 'text', '#9fe3ff', 'Saved')
      await sleep(beat)
      break
    case 'FighterPinned':
      effectAt(state, ev.fighterId, 'text', '#f5d95a', 'Pinned')
      await sleep(beat)
      break
    case 'FighterOutOfAction': {
      effectAt(state, ev.fighterId, 'text', '#ff6a5f', 'Out of action')
      const down = f > 0 ? vfx.bodyOf(state, ev.fighterId) : null
      if (down) {
        const weapon = attackWeapon(b)
        vfx.death(down, weapon ? vfxOf(state, weapon.id, weapon.profileId).family : null, ev.by ? vfx.bodyOf(state, ev.by) : null)
        requestRepaint()
      }
      await sleep(beat)
      break
    }
    case 'CaughtFire': {
      const burning = f > 0 ? vfx.bodyOf(state, ev.targetId) : null
      if (burning) {
        vfx.ignite(burning)
        requestRepaint()
      }
      await sleep(beat)
      break
    }
    case 'TemplatePlaced':
      if (f > 0) addMark({ kind: 'template', polygon: ev.polygon })
      await sleep(beat)
      break
    case 'BlastPlaced':
      if (f > 0) addMark({ kind: 'blast', centre: ev.centre, radius: ev.radius })
      // a blast aimed at a fighter is drawn by the volley; one on the floor (a point aim, a scenario explosion) is drawn here
      if (f > 0 && !b.events.some((e) => e.type === 'TargetDeclared' && e.targetId)) {
        vfx.blastAt(ev.centre.x, 0, ev.centre.z, Math.max(0.7, ev.radius * 0.3))
        requestRepaint()
      }
      await sleep(beat)
      break
    case 'FightStarted': {
      const a = f > 0 ? vfx.bodyOf(state, ev.attackerId) : null
      const d = f > 0 && ev.targets[0] ? vfx.bodyOf(state, ev.targets[0]) : null
      if (a && d) {
        vfx.fightIntro(state, a, d, ev.weapons[0] ?? null, null)
        requestRepaint()
      }
      await sleep(beat)
      break
    }
    case 'FightHitRolled': {
      const started = b.events.find((e) => e.type === 'FightStarted')
      const a = f > 0 && started?.type === 'FightStarted' ? vfx.bodyOf(state, started.attackerId) : null
      const d = f > 0 ? vfx.bodyOf(state, ev.targetId) : null
      if (a && d) {
        ev.dice.forEach((roll, i) => {
          if (!d6TestPasses(roll, ev.need)) return
          setTimeout(() => {
            vfx.strike(state, a, d, { id: ev.weaponId === 'unarmed' ? null : ev.weaponId }, roll === 6, i)
            requestRepaint()
          }, Math.round(i * 170 * f))
        })
      }
      await sleep(beat)
      break
    }
    case 'Parried': {
      const blocker = f > 0 ? vfx.bodyOf(state, ev.by) : null
      const started = b.events.find((e) => e.type === 'FightStarted')
      if (blocker) {
        vfx.parry(blocker, started?.type === 'FightStarted' ? vfx.bodyOf(state, started.attackerId) : null, false)
        requestRepaint()
      }
      await sleep(beat)
      break
    }
    case 'DoorChanged':
      requestRepaint()
      await sleep(beat)
      break
    default:
      await sleep(beat)
  }
}

/** The volley of a Shoot step: the shot camera behind the shooter, the weapon's effects (muzzle flash, a tracer per hit), a close-up when something got through. */
async function fireVolley(b: Batch, shooterId: string, gen: number): Promise<void> {
  const plan = planLandings(b.events)
  const targetId = plan.shots.find((s) => s.targetId)?.targetId ?? null
  const f = factor()
  const shooter = bodyOf(b.state, shooterId)
  const target = targetId ? bodyOf(b.state, targetId) : null
  if (!shooter || !target || !targetId || f <= 0) return
  const cam = cameraApi.current
  const t = shotTimes(f)
  const cine = cinematicOn(useSettings.getState().cinematicShots, f, !!cam)
  const back = cam && cine ? cam.snapshot() : null
  if (cam && cine) await cam.flyTo(shoulderViewClear(shooter, target), t.shoulder)
  if (gen !== generation) return
  const started = b.events.find((e) => e.type === 'ShootStarted')
  const declared = b.events.find((e) => e.type === 'TargetDeclared')
  const from = vfx.bodyOf(b.state, shooterId)
  const to = vfx.bodyOf(b.state, targetId)
  if (started && started.type === 'ShootStarted' && from && to) {
    const inCover = declared?.type === 'TargetDeclared' && declared.cover !== 'none'
    const times = vfx.volley(b.state, from, to, { id: started.weaponId, profileId: started.profileId }, plan.shots.map((s) => (s.outcome === 'miss' ? 'fail' : 'normal')), false, inCover, (die) => {
      const outcome = plan.shots[die]?.outcome
      if (outcome === 'damage') vfx.flesh(to, from, 1, false)
      else if (outcome === 'blocked') vfx.shield(to, 1, inCover)
      requestRepaint()
    })
    requestRepaint()
    await sleep(Math.round((times.duration + 0.2) * 1000 * Math.max(f, 0.5)))
  }
  if (cam && cine) {
    if (volleyBeat(plan) === 'closeup') {
      await cam.flyTo(closeupViewClear(shooter, target), t.closeup)
      await sleep(t.hold)
    } else await sleep(t.beat)
    if (back) await cam.flyTo(back, t.back)
  }
}

async function deployTrip(b: Batch, visits: { x: number; z: number }[], gen: number): Promise<void> {
  const cam = cameraApi.current
  if (!cam || visits.length === 0) return
  const t = deployTimes(factor())
  const zf = zoneFocus(b.state, perspective)
  const back = returnView(lastPlayerView, zf ? cam.focusView(zf.x, zf.z, zf.distance) : null, cam.snapshot())
  let shown = false
  for (const v of visits) {
    if (gen !== generation) return
    if (!(await cam.flyTo(cam.focusView(v.x, v.z, DEPLOY_FOCUS_DISTANCE), t.fly))) return
    if (!shown) {
      shown = true
      setPresentedSeq(b.seq)
      requestRepaint()
    }
    const arrived = cam.snapshot()
    await sleep(t.hold)
    if (gen !== generation || viewsDiffer(arrived, cam.snapshot())) return
  }
  if (gen === generation) await cam.flyTo(back, t.fly)
}

/** The weapon of a Shoot step sounds once, when its volley fires (or at the end of the step when no volley is shown). */
function playShotSound(b: Batch): void {
  const started = b.events.find((e) => e.type === 'ShootStarted')
  if (!started || started.type !== 'ShootStarted' || factor() <= 0) return
  const s = shotSound(b.state, started.weaponId, started.profileId)
  audio.play(s.id, s.opts)
}

async function playBatch(b: Batch, gen: number): Promise<void> {
  const beats = deployBeats(b.events, b.state.phase, { perspective, botSeats, factor: factor() })
  const visits: { x: number; z: number }[] = []
  let volleyDone = false
  for (const [i, ev] of b.events.entries()) {
    if (gen !== generation) return
    await playEvent(ev, b)
    // the volley fires once the dice of the shot are on screen (the Firepower roll, else the first hit roll)
    if (!volleyDone && (ev.type === 'FirepowerRolled' || ev.type === 'HitRolled')) {
      const started = b.events.find((e) => e.type === 'ShootStarted')
      if (started && started.type === 'ShootStarted') {
        volleyDone = true
        playShotSound(b)
        try {
          await fireVolley(b, started.fighterId, gen)
        } catch (err) {
          console.warn('[presentation] volley failed', err)
        }
      }
    }
    const beat = beats.find((x) => x.index === i)?.beat
    if (beat?.kind === 'record') lastPlayerView = cameraApi.current?.snapshot() ?? lastPlayerView
    else if (beat?.kind === 'visit') visits.push({ x: beat.x, z: beat.z })
  }
  if (!volleyDone) playShotSound(b)
  if (visits.length > 0 && gen === generation) {
    try {
      await deployTrip(b, visits, gen)
    } catch (err) {
      console.warn('[presentation] deploy camera failed', err)
    }
  }
}

async function run(): Promise<void> {
  if (running) return
  running = true
  const gen = generation
  try {
    while (queue.length > 0 && gen === generation) {
      const b = queue.shift()!
      await playBatch(b, gen)
      if (gen !== generation) break
      setPresentedSeq(b.seq)
      // the display state now has this step's wounds: the beat overrides are no longer needed
      clearOverrides()
      // the tween ends on the new position, so releasing it after the cursor moves cannot flash the old one
      for (const ev of b.events) if (ev.type === 'FighterMoved') endMoveAnim(ev.fighterId)
      requestRepaint()
    }
  } finally {
    if (gen === generation) {
      running = false
      if (queue.length === 0) {
        catchUpPresented()
        clearOverrides()
        setPresentationIdle(true)
      } else void run()
    }
  }
}

/** Queue one step's events. The store calls this once per accepted action (and once for createGame). */
export function enqueueBatch(batch: Batch): void {
  queue.push(batch)
  setPresentationIdle(false)
  void run()
}

/** New game / abandon: drop everything queued and let the running loop stop. */
export function resetDirector(): void {
  generation++
  queue.length = 0
  running = false
  lastPlayerView = null
  clearAnnouncement()
  clearFx()
  vfx.resetFx()
  clearMarks()
  trayClear()
  setPresentationIdle(true)
}
