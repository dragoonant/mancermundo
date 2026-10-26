// Presentation director: turns each accepted step's events into timed beats (feed lines, dice log, dice tray,
// banners, move tweens, tracers, impact flashes, wound bars, control rings, toasts, sounds) and only then
// advances the presented-seq cursor, so no result shows before it is played. 'instant' speed skips every pause,
// banner, effect and sound. Batches queue FIFO; the idle flag is true when empty.
import type { GameEvent, GameState, Operative, Seat } from '@/engine'
import { audio } from '../audio/instance'
import { playEventSounds, type SoundContext } from '../audio/eventSounds'
import { trayAttack, trayBegin, trayClear, trayDefence, trayFightBlock, trayNote, trayReroll, trayShootBlock, trayShootStrikes, trayStrike } from '../dice/trayStore'
import { describeEvent, humanize, opName, SEAT_NAME, weaponName } from '../game/labels'
import { aimCue, clearCues, setDeathStyle, triggerCue } from '../figures/cueCore'
import { toneFor } from '../vfx/api'
import * as vfx from '../vfx/api'
import { resetFx } from '../vfx/api'
import { vfxOf, type VfxFamily } from '../vfx/families'
import { endMoveAnim, requestRepaint, startMoveAnim } from './animStore'
import { holdAnnouncement, clearAnnouncement } from './announceStore'
import { pushDice, pushFeed, pushToast } from './feedStore'
import { clearFx, clearOverrides, setControlOverride, setWoundOverride, spawnFx } from './fxStore'
import { setPresentationIdle } from './idleStore'
import { cameraApi, type CameraView } from '../board/cameraApi'
import { deployBeats, deployTimes, DEPLOY_FOCUS_DISTANCE, returnView, viewsDiffer, zoneFocus } from './deployCamera'
import { catchUpPresented, setPresentedSeq, usePresentedStore } from './presentedStore'
import { setShotShooter } from './shotStore'
import { cinematicOn, closeupViewClear, shotTimes, shoulderViewClear, volleyBeat, type Body } from './shotCamera'
import { speedFactor, useSettings } from './settings'
import { finalKinds, heldItemOf, holdVerdict, planLandings, rerollKinds, type DieKind } from './heldVolley'

export interface Batch {
  seq: number
  events: GameEvent[]
  /** state after the step: used for operative names and positions */
  state: GameState
}

const queue: Batch[] = []
let running = false
let generation = 0

/** The seat whose point of view victory / defeat is told from. The store sets it when a game starts. */
let perspective: Seat | null = null
export function setDirectorPerspective(seat: Seat | null): void {
  perspective = seat
}

/** Seats played by a bot (the CameraRig keeps this current from the store; the director must not import the store). */
let botSeats: Seat[] = []
export function setDirectorBotSeats(seats: readonly Seat[]): void {
  botSeats = [...seats]
}

/** The camera pose the player had when they last deployed an operative this game (where a bot-deploy visit returns to). */
let lastPlayerView: CameraView | null = null

/** What the attack in progress is (the same dice events serve Shoot and Fight). */
let mode: SoundContext['mode'] = null
let fight: SoundContext['fight'] = null

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()
}

/** DiceRolled events of the attack sequences are shown by the dice tray (through Attack/DefenceDiceRolled), not as roll banners. */
const TRAY_PURPOSE = /^(shoot|fight)\.(attack|defence)(\.|$)/

/** Base pause (ms at normal speed) per event type; the pause is a beat in which the event's effects play. */
function beatMs(ev: GameEvent): number {
  switch (ev.type) {
    case 'DiceRolled':
      return TRAY_PURPOSE.test(ev.purpose) ? 0 : 900
    case 'AttackDiceRolled':
    case 'DefenceDiceRolled':
      return 750
    case 'DiceRerolled':
      return 650
    case 'DamageInflicted':
      return 600
    case 'OperativeIncapacitated':
      return 800
    case 'DiceBlocked':
      return 550
    case 'Struck':
    case 'Blocked':
      return 480
    case 'FightStarted':
      return 450
    case 'VpScored':
      return 550
    case 'KillGradeChanged':
      return 350
    case 'TargetSelected':
      return 420
    case 'CoverSaveRetained':
    case 'AttackRetained':
      return 260
    case 'InitiativeDecided':
      return 600
    case 'DropZoneChosen':
    case 'OperativeDeployed':
      return 260
    case 'OperativeActivated':
    case 'OrderSet':
      return 220
    case 'ActionDeclared':
      return 200
    case 'CpChanged':
    case 'GambitUsed':
    case 'GambitPassed':
    case 'PloyUsed':
      return 240
    case 'OperativeExpended':
      return 160
    case 'ControlChanged':
      return 420
    case 'MarkerPickedUp':
    case 'MarkerPlaced':
    case 'MissionActionPerformed':
      return 300
    default:
      return 0
  }
}

// ---------------------------------------------------------------- effects

const SEAT_RING: Record<Seat, string> = { A: '#4fb0ff', B: '#ff6a4f' }

/** The shot in progress (set at TargetSelected, read by the dice-blocked and damage beats). */
interface ShotCtx {
  shooterId: string
  targetId: string
  weaponId: string
  secondary: boolean
  inCover: boolean
}
let shot: ShotCtx | null = null
/** Who last hurt each operative and with what family: a kill picks its death animation from it. */
const lastHit = new Map<string, { family: VfxFamily; from: { x: number; z: number } | null }>()
let strikeIndex = 0
let strikeHandled = false
const diceKind = (k: 'fail' | 'normal' | 'crit' | undefined): 'fail' | 'normal' | 'crit' => k ?? 'normal'

const CRIT_COLOR = '#ff9a2a'
const HIT_COLOR = '#ff5a4f'

/** Turn `op` toward `at` for `holdMs` (the engine only turns a figure when it moves, so attackers would fire sideways). */
function faceToward(op: Operative, at: Operative, holdMs: number): void {
  const bearing = Math.atan2(at.pos.x - op.pos.x, at.pos.z - op.pos.z)
  let yaw = bearing - op.facing
  while (yaw > Math.PI) yaw -= Math.PI * 2
  while (yaw < -Math.PI) yaw += Math.PI * 2
  aimCue(op.id, yaw, holdMs)
}

const above = (op: Operative): [number, number, number] => [op.pos.x, op.pos.y + op.height + 0.4, op.pos.z]

/** The weapon an operative is using in the fight in progress. */
function fightWeapon(id: string): string | null {
  if (!fight) return null
  return id === fight.attackerId ? fight.attackerWeapon : id === fight.defenderId ? fight.defenderWeapon : null
}

function lookup(state: GameState, id: string | null | undefined): Operative | null {
  return (id && state.operatives?.[id]) || null
}

function soundContext(state: GameState): SoundContext {
  return { state, perspective, mode, fight }
}

// ---------------------------------------------------------------- one event

/** Events whose feed line is a dice batch (attack, defence, plain rolls, re-rolls, blocks): the feed groups consecutive ones. */
function isDiceLine(ev: GameEvent): boolean {
  return ev.type === 'DiceRolled' || ev.type === 'AttackDiceRolled' || ev.type === 'DefenceDiceRolled' || ev.type === 'DiceRerolled' || ev.type === 'DiceBlocked'
}

async function playEvent(ev: GameEvent, state: GameState, gen: number, opts: { landing?: boolean } = {}): Promise<void> {
  const f = speedFactor(useSettings.getState().animSpeed)
  // HIDING is open information: the opponent's set-aside operatives get their feed line like any other event
  let text = describeEvent(ev, state)
  // a held shot's landing is one beat of the volley, which paces itself: no pause of its own
  const wait = (ms: number) => (opts.landing ? Promise.resolve() : sleep(Math.round(ms * f)))
  const fx = f > 0
  // A shot's weapon sound waits for the volley, and its save sound for the tracer that lands on a blocked die.
  const heldShot = fx && ((ev.type === 'AttackDiceRolled' && mode !== 'fight' && !!ev.weaponId && !!lookup(state, ev.operativeId) && !!lookup(state, ev.targetId)) || (ev.type === 'DiceBlocked' && heldVolley !== null))
  if (fx && !heldShot) playEventSounds((id, o) => audio.play(id, o), [ev], soundContext(state))

  switch (ev.type) {
    case 'DiceRolled': {
      if (TRAY_PURPOSE.test(ev.purpose)) {
        text = null
        break
      }
      pushDice(ev.seq, ev.seat, ev.purpose, ev.dice)
      if (fx) {
        await holdAnnouncement({
          title: `${ev.seat ? SEAT_NAME[ev.seat] : 'Roll'}: ${humanize(ev.purpose)}`,
          subtitle: '',
          seat: ev.seat,
          dice: ev.dice,
          durationMs: Math.round(beatMs(ev) * f),
        })
      }
      break
    }
    case 'ShootStarted':
      mode = 'shoot'
      fight = null
      break
    case 'TargetSelected': {
      mode = 'shoot'
      const shooter = lookup(state, ev.operativeId)
      const target = lookup(state, ev.targetId)
      shot = { shooterId: ev.operativeId, targetId: ev.targetId, weaponId: ev.weaponId, secondary: ev.secondary, inCover: ev.inCover }
      trayBegin('shoot', `${opName(state, ev.operativeId)} shoots ${opName(state, ev.targetId)} with ${weaponName(state, ev.weaponId)}`)
      if (fx) {
        // the aiming reticle closes in on the target
        if (shooter && target) vfx.ring(target.pos.x, target.pos.y, target.pos.z, '#ff6a5f', 1.7, 0.42, true)
      }
      await wait(beatMs(ev))
      break
    }
    case 'AttackDiceRolled': {
      const who = lookup(state, ev.operativeId)
      const target = lookup(state, ev.targetId)
      pushDice(ev.seq, ev.seat, 'attack', ev.dice, ev.kinds)
      // Dice first: the shooter fires only once the whole exchange has been rolled (fireHeldVolley).
      if (heldShot && who && target && ev.weaponId) {
        heldVolley = {
          shooterId: ev.operativeId,
          targetId: ev.targetId,
          weaponId: ev.weaponId,
          secondary: shot?.secondary ?? false,
          inCover: shot?.inCover ?? false,
          atk: ev,
          state,
          kinds: ev.kinds.map(diceKind),
          need: ev.need,
          lethal: ev.lethal,
          retained: null,
          block: null,
          windowOpen: false,
          held: [],
        }
      }
      trayAttack(
        { operativeId: ev.operativeId, seat: ev.seat, label: opName(state, ev.operativeId), need: ev.need, lethal: ev.lethal, dice: ev.dice, kinds: ev.kinds },
        mode === 'fight' ? 'fight' : 'shoot',
        mode === 'fight' ? `${opName(state, ev.operativeId)} fights` : 'Shoot',
      )
      await wait(beatMs(ev))
      break
    }
    case 'DefenceDiceRolled': {
      pushDice(ev.seq, ev.seat, 'defence', ev.dice, ev.kinds)
      trayDefence({ operativeId: ev.targetId, seat: ev.seat, label: opName(state, ev.targetId), need: ev.need, lethal: null, dice: ev.dice, kinds: ev.kinds })
      await wait(beatMs(ev))
      break
    }
    case 'DiceRerolled':
      trayReroll(ev.side, ev.indexes, ev.after)
      trayNote(`${opName(state, ev.operativeId)} re-rolls ${ev.indexes.length} (${ev.source === 'command' ? 'Command Re-roll' : humanize(ev.source)})`)
      await wait(beatMs(ev))
      break
    case 'CoverSaveRetained':
      trayNote(`${opName(state, ev.targetId)} keeps ${ev.normal + ev.crit} cover save${ev.normal + ev.crit === 1 ? '' : 's'} without rolling`)
      await wait(beatMs(ev))
      break
    case 'DiceBlocked': {
      trayShootBlock(ev.blockedNormal, ev.blockedCrit)
      const def = lookup(state, ev.targetId)
      // saved dice: a shimmer of cover (or armour) on the defender, with the hit-armour sound
      // (with a held volley the shimmer plays on the tracer that lands on each blocked die instead)
      if (fx && def && !heldVolley && ev.blockedNormal + ev.blockedCrit > 0) vfx.shield(def, ev.blockedNormal + ev.blockedCrit, shot?.inCover ?? false)
      trayNote(ev.unblockedNormal + ev.unblockedCrit === 0 ? 'Everything is blocked.' : `${ev.unblockedNormal} normal and ${ev.unblockedCrit} critical get through.`)
      await wait(beatMs(ev))
      break
    }
    case 'DamageInflicted': {
      const target = lookup(state, ev.operativeId)
      const src = lookup(state, ev.sourceId)
      setWoundOverride(ev.operativeId, ev.wounds)
      if (mode === 'shoot') trayShootStrikes()
      if (fx) {
        if (target) {
          const isStrike = ev.source.startsWith('strike')
          const crit = ev.source === 'crit' || ev.source === 'strike-crit'
          const weaponId = isStrike || mode === 'fight' ? fightWeapon(ev.sourceId) : shot?.weaponId ?? null
          const fam = vfxOf(weaponId).family
          const from = src ? { x: src.pos.x, z: src.pos.z } : null
          lastHit.set(target.id, { family: fam, from })
          if (isStrike && src) {
            // a blow lands: sweep or crunch, the red mark, sparks (the Struck beat that follows only marks the tray)
            vfx.strike(src, target, weaponId, crit, strikeIndex++)
            strikeHandled = true
            faceToward(src, target, 650)
            faceToward(target, src, 650)
            triggerCue(src.id, 'melee', performance.now(), 'beat')
          } else if (ev.source === 'devastating') vfx.devastate(target)
          else if (ev.source === 'hot') vfx.hotFlash(target)
          vfx.flesh(target, from, ev.amount, crit || ev.source === 'devastating', toneFor(state, target.id))
          triggerCue(target.id, 'hit', performance.now(), 'beat')
          spawnFx({ kind: 'text', to: above(target), color: crit ? CRIT_COLOR : HIT_COLOR, text: `-${ev.amount}`, dur: 1150, size: crit ? 1.35 : 1 })
          if (crit) spawnFx({ kind: 'text', to: [target.pos.x, target.pos.y + target.height + 1.05, target.pos.z], color: CRIT_COLOR, text: 'CRIT', dur: 1250, size: 1.2 })
          else if (ev.source === 'devastating') spawnFx({ kind: 'text', to: [target.pos.x, target.pos.y + target.height + 1.05, target.pos.z], color: '#ff5a2a', text: 'DEVASTATING', dur: 1250, size: 0.85 })
        }
        await wait(beatMs(ev))
      }
      break
    }
    case 'OperativeInjured': {
      const target = lookup(state, ev.operativeId)
      if (fx && target) vfx.wound(target)
      break
    }
    case 'OperativeIncapacitated': {
      const target = lookup(state, ev.operativeId)
      setWoundOverride(ev.operativeId, 0)
      if (fx) {
        if (target) {
          // dies the way it was hurt: slump from bullets, burn down from flame, thrown back by blasts, topple from blades
          const lh = lastHit.get(target.id)
          const plan = vfx.death(target, lh?.family ?? null, lh?.from ?? null, toneFor(state, target.id))
          setDeathStyle(target.id, plan)
          triggerCue(target.id, 'death', performance.now(), 'beat')
          vfx.ring(target.pos.x, target.pos.y, target.pos.z, '#ff3b2f', 2.4, 0.7)
        }
        pushToast(`${opName(state, ev.operativeId)} is down`, 'info', 2600)
        await wait(beatMs(ev))
      }
      break
    }
    case 'FightStarted': {
      mode = 'fight'
      fight = { attackerId: ev.operativeId, attackerWeapon: ev.attackerWeapon, defenderId: ev.targetId, defenderWeapon: ev.defenderWeapon }
      strikeIndex = 0
      strikeHandled = false
      trayBegin('fight', `${opName(state, ev.operativeId)} fights ${opName(state, ev.targetId)}`)
      if (fx) {
        const a = lookup(state, ev.operativeId)
        const d = lookup(state, ev.targetId)
        if (a && d) {
          vfx.ring((a.pos.x + d.pos.x) / 2, d.pos.y, (a.pos.z + d.pos.z) / 2, '#ffd45a', 2.2, 0.5)
          vfx.fightIntro(a, d, ev.attackerWeapon, ev.defenderWeapon)
          faceToward(a, d, 1200)
          faceToward(d, a, 1200)
        }
        await wait(beatMs(ev))
      }
      break
    }
    case 'Struck': {
      const target = lookup(state, ev.targetId)
      const striker = lookup(state, ev.operativeId)
      trayStrike(ev.operativeId, ev.die)
      if (fx) {
        // the blow normally played at its DamageInflicted beat; a blow that dealt nothing still shows
        if (!strikeHandled && target && striker) {
          vfx.strike(striker, target, fightWeapon(ev.operativeId), ev.die === 'crit', strikeIndex++)
          triggerCue(striker.id, 'melee', performance.now(), 'beat')
        }
        strikeHandled = false
        // the chainsword's hit sound plays on this beat: spray its sparks with it
        if (target && vfxOf(fightWeapon(ev.operativeId)).variant === 'chain') vfx.chainBurst(target)
        await wait(beatMs(ev))
      }
      break
    }
    case 'Blocked':
      trayFightBlock(ev.operativeId, ev.die, ev.against)
      if (fx) {
        const blocker = lookup(state, ev.operativeId)
        if (blocker) {
          const otherId = fight ? (ev.operativeId === fight.attackerId ? fight.defenderId : fight.attackerId) : null
          vfx.parry(blocker, lookup(state, otherId), ev.die === 'crit')
        }
        await wait(beatMs(ev))
      }
      break
    case 'MineTriggered': {
      const victim = lookup(state, ev.operativeId)
      if (fx && victim) {
        vfx.blastAt(victim, 0.9)
        await wait(450)
      }
      break
    }
    case 'ShootEnded':
    case 'FightEnded':
      mode = null
      fight = null
      shot = null
      strikeHandled = false
      break
    case 'OperativeActivated':
      // the last attack stays in the tray until the next one starts
      await wait(beatMs(ev))
      break
    case 'TurningPointStarted':
      trayClear()
      if (fx) await holdAnnouncement({ title: `Turning point ${ev.number}`, subtitle: '', seat: null, durationMs: Math.round(1000 * f) })
      break
    case 'PhaseStarted':
      if (fx && ev.name !== 'setup') await holdAnnouncement({ title: `${humanize(ev.name)} phase`, subtitle: '', seat: null, durationMs: Math.round(1000 * f) })
      break
    case 'VpScored':
      if (fx) {
        pushToast(`${ev.seat ? SEAT_NAME[ev.seat] : 'A seat'} scores ${ev.amount} VP: ${humanize(ev.ruleId)}`, 'info', 3200)
        await wait(beatMs(ev))
      }
      break
    case 'KillGradeChanged':
      if (fx) {
        pushToast(`${ev.seat ? SEAT_NAME[ev.seat] : 'A seat'} reaches kill grade ${ev.grade} (${ev.kills} down)`, 'info', 3200)
        await wait(beatMs(ev))
      }
      break
    case 'ControlChanged': {
      setControlOverride(ev.markerId, ev.controller)
      const m = state.markers?.find((k) => k.id === ev.markerId)
      if (fx) {
        if (m) vfx.ring(m.pos.x, 0.1, m.pos.z, ev.controller ? SEAT_RING[ev.controller] : '#e8e8f2', 3, 0.8)
        await wait(beatMs(ev))
      }
      break
    }
    case 'OperativeTransformed': {
      // Mutation: the figure swaps to the new datacard's body when the cursor reaches this beat; a violet pulse and a shudder cover the change
      const changed = lookup(state, ev.operativeId)
      if (fx && changed) {
        vfx.ring(changed.pos.x, changed.pos.y + 0.1, changed.pos.z, '#b44bff', 2.4, 0.7)
        vfx.ring(changed.pos.x, changed.pos.y + 0.1, changed.pos.z, '#ff7ad9', 1.4, 0.5, true)
        triggerCue(changed.id, 'hit', performance.now(), 'beat')
        pushToast(`${opName(state, ev.operativeId)} mutates`, 'info', 2400)
        await wait(700)
      }
      break
    }
    case 'OperativeMoved': {
      const dur = Math.round(Math.min(1800, 300 + 160 * Math.max(1, ev.cost)) * f)
      if (dur > 0) {
        startMoveAnim(ev.operativeId, ev.segments, dur)
        await sleep(dur + 40)
      }
      break
    }
    default:
      await wait(beatMs(ev))
  }
  if (gen !== generation) return
  if (text) pushFeed(ev.seq, ev.seat, text, isDiceLine(ev))
  requestRepaint()
}

// ---------------------------------------------------------------- the held shooting volley
//
// A shot plays its dice first (reticle, attack dice, re-rolls, cover, defence dice, the block). Only then does the
// shooter fire, one tracer per attack die; a blocked success shimmers when its tracer lands, an unblocked one plays
// its damage, and the target's wound or fall lands with the shot that caused it. The target's damage events wait in
// the volley until then (see heldVolley.ts for who gets what and when the volley fires).

type AttackDice = Extract<GameEvent, { type: 'AttackDiceRolled' }>
type BlockEvent = Extract<GameEvent, { type: 'DiceBlocked' }>

interface HeldVolley {
  shooterId: string
  targetId: string
  weaponId: string
  secondary: boolean
  inCover: boolean
  atk: AttackDice
  /** state of the batch the attack dice were rolled in (positions of shooter and target) */
  state: GameState
  kinds: DieKind[]
  need: number
  lethal: number | null
  retained: { normal: number; crit: number } | null
  block: { ev: BlockEvent; state: GameState } | null
  /** the target's defence has been reached: its damage events wait for the volley */
  windowOpen: boolean
  held: { ev: GameEvent; state: GameState }[]
}

let heldVolley: HeldVolley | null = null

// ---------------------------------------------------------------- the shot camera
//
// While a Shoot action fires, the camera leaves the player's view for an over-the-shoulder shot behind the shooter,
// closes on the target when a die gets through, and flies back once the action is over (ShootEnded, or the end of
// the batch if the action is cut short by a decision). One cinematic spans every volley of the action, so a weapon
// with secondary targets returns once. The camera rig drops it the moment the player touches the camera.

interface Cine {
  /** the player's view, taken when the cinematic began */
  saved: CameraView
}
let cine: Cine | null = null
/** The player took the camera during this Shoot action: no new cinematic until the action is over. */
let cineDeclined = false

/**
 * The camera beats stretch a batch past the presented cursor's stall guard (PRESENTED_STALL_MS), which would show the
 * result and the next prompt mid-flight. Re-arming it from the cursor's own value restarts the guard without moving
 * the cursor, so each camera beat gets a fresh window and a real stall is still caught.
 */
const petStall = (): void => setPresentedSeq(usePresentedStore.getState().presentedSeq)

const bodyOf = (op: Operative): Body => ({ x: op.pos.x, y: op.pos.y, z: op.pos.z, height: op.height })

/** The cinematic is still ours: not ended, and the player has not taken the camera. */
function cineAlive(): boolean {
  if (!cine) return false
  const cam = cameraApi.current
  if (!cam || cam.cinematicActive?.() === false) {
    cine = null
    cineDeclined = true
    setShotShooter(null)
    cam?.cinematic?.(false)
    return false
  }
  return true
}

/** Flies the cinematic camera; a cancelled flight (the player moved the camera) drops the rest of the cinematic. */
async function cineFly(view: CameraView, ms: number): Promise<boolean> {
  const cam = cameraApi.current
  if (!cam || !cineAlive()) return false
  const arrived = await cam.flyTo(view, ms)
  petStall()
  if (!arrived) {
    cine = null
    cineDeclined = true
    setShotShooter(null)
    cam.cinematic?.(false)
    return false
  }
  return cineAlive()
}

/** Back to the player's view, then the camera limits return. Safe when no cinematic runs. */
async function cineEnd(gen: number): Promise<void> {
  const c = cine
  cineDeclined = false
  if (!c) return
  cine = null
  setShotShooter(null) // the shooter's markers return as the camera heads back
  const cam = cameraApi.current
  if (!cam) return
  try {
    if (gen === generation && cam.cinematicActive?.() !== false) {
      petStall()
      await cam.flyTo(c.saved, shotTimes(speedFactor(useSettings.getState().animSpeed)).back)
    }
  } finally {
    cam.cinematic?.(false)
  }
}

function cineReset(): void {
  if (cine) cameraApi.current?.cinematic?.(false)
  setShotShooter(null)
  cine = null
  cineDeclined = false
}

/** Longest the director waits for a volley's tracers to land before playing what is left. */
const VOLLEY_WAIT_MAX_MS = 3800
/** Pause after the last landing, before whatever comes next. */
const VOLLEY_SETTLE_MS = 550

/** Records what a dice-phase event changes in the held volley (final attack dice, retention, the block). */
function noteDice(h: HeldVolley, ev: GameEvent, state: GameState): void {
  if (ev.type === 'DiceRerolled' && ev.side === 'attack' && ev.operativeId === h.shooterId) h.kinds = rerollKinds(h.kinds, ev.indexes, ev.after, h.need, h.lethal)
  else if (ev.type === 'AttackRetained' && ev.operativeId === h.shooterId) h.retained = { normal: ev.normal, crit: ev.crit }
  else if (ev.type === 'DefenceDiceRolled' && ev.targetId === h.targetId) h.windowOpen = true
  else if (ev.type === 'DiceBlocked' && ev.targetId === h.targetId) {
    h.block = { ev, state }
    h.windowOpen = true
  }
}

/**
 * Fires the held volley: the shooter turns and fires (cue + weapon sound), one tracer per attack die (misses fly and
 * miss), and each landing plays when its tracer arrives. Resolves once every shot has landed or the wait cap runs
 * out; whatever has not landed by then plays at once. The held events are taken up front, so a failure below can
 * never leave events stuck.
 */
async function fireHeldVolley(gen: number): Promise<void> {
  const h = heldVolley
  if (!h) return
  heldVolley = null
  const held = h.held
  h.held = []
  const f = speedFactor(useSettings.getState().animSpeed)
  const play = (id: Parameters<typeof audio.play>[0], o?: Parameters<typeof audio.play>[1]) => audio.play(id, o)
  const kinds = finalKinds(h.kinds, h.retained)
  const items = held.map((x) => heldItemOf(x.ev as { type: string; operativeId?: string })!)
  const plan = planLandings(kinds, h.block?.ev ?? null, items)
  const running: Promise<void>[] = []
  const landed = new Set<number>()

  const playItem = (idx: number): void => {
    const x = held[idx]!
    running.push(
      playEvent(x.ev, x.state, gen, { landing: true }).catch((err) => console.warn('[presentation] failed to play landing', x.ev.type, err)),
    )
  }
  const shimmer = (n: number): void => {
    if (f <= 0 || n <= 0 || !h.block || gen !== generation) return
    try {
      const def = lookup(h.block.state, h.targetId)
      if (def) vfx.shield(def, n, h.inCover)
      playEventSounds((id, o) => audio.play(id, o), [{ ...h.block.ev, blockedNormal: n, blockedCrit: 0 }], soundContext(h.block.state))
    } catch (err) {
      console.warn('[presentation] failed to play save shimmer', err)
    }
  }
  const who = lookup(h.state, h.shooterId)
  const target = lookup(h.state, h.targetId)
  const camOn = !!who && !!target && plan.shots.length > 0 && !cineDeclined && cinematicOn(useSettings.getState().cinematicShots, f, !!cameraApi.current)
  const times = shotTimes(f)
  let closeup: Promise<boolean> | null = null
  /** the first die that gets through sends the camera in on the target */
  const startCloseup = (): void => {
    if (closeup || !who || !target || !camOn || gen !== generation || !cineAlive()) return
    closeup = cineFly(closeupViewClear(h.state.map, bodyOf(who), bodyOf(target)), times.closeup).catch(() => false)
  }
  const land = (die: number): void => {
    if (landed.has(die) || gen !== generation) return
    landed.add(die)
    const s = plan.shots[die]
    if (!s) return
    if (s.outcome === 'blocked') shimmer(1)
    else if (s.outcome === 'damage') {
      s.items.forEach(playItem)
      startCloseup()
    }
  }

  let volleyed = false
  if (camOn && who && target && gen === generation) {
    // over the shoulder first; the shooter turns to the target while the camera swings round behind
    try {
      const cam = cameraApi.current!
      if (!cine) {
        cine = { saved: cam.snapshot() }
        cam.cinematic?.(true)
      }
      petStall()
      setShotShooter(who.id)
      faceToward(who, target, times.shoulder + 700)
      await cineFly(shoulderViewClear(h.state.map, bodyOf(who), bodyOf(target)), times.shoulder)
    } catch (err) {
      console.warn('[presentation] failed to frame the shot', err)
    }
  }
  if (f > 0 && who && target && plan.shots.length > 0 && gen === generation) {
    try {
      let remaining = plan.shots.length
      let allLanded: () => void = () => {}
      const done = new Promise<void>((resolve) => { allLanded = resolve })
      playEventSounds(play, [h.atk], { ...soundContext(h.state), mode: 'shoot' })
      const info = vfx.volley(who, target, h.weaponId, kinds, h.secondary, h.inCover, (die) => {
        land(die)
        if (--remaining === 0) allLanded()
      })
      // the close-up starts early enough to arrive as the first damaging tracer lands, so the hit and the fall are both seen
      const firstHit = plan.shots.find((x) => x.outcome === 'damage')
      if (camOn && firstHit) setTimeout(startCloseup, Math.max(0, Math.round((info.impacts[firstHit.die] ?? info.first) * 1000) - times.closeup))
      faceToward(who, target, 700 + 1000 * info.duration)
      triggerCue(who.id, 'shoot', performance.now(), 'beat')
      volleyed = true
      await Promise.race([done, sleep(Math.round(VOLLEY_WAIT_MAX_MS * f))])
    } catch (err) {
      console.warn('[presentation] failed to fire volley', err)
    }
  }
  // Whatever has not landed yet (no tracer for it, the vfx layer not running, the wait ran out) plays now.
  plan.shots.forEach((s) => land(s.die))
  shimmer(plan.orphanBlocked)
  plan.orphanItems.forEach(playItem)
  if (volleyBeat(plan) === 'closeup') startCloseup() // damage that no tracer carried
  await Promise.all(running)
  if (volleyed && gen === generation) {
    if (items.some((it) => it.kind === 'down')) await sleep(Math.round(450 * f))
    await sleep(Math.round(VOLLEY_SETTLE_MS * f))
  }
  if (camOn && gen === generation) {
    try {
      // something got through: stay on the target long enough to read the wound or the fall; nothing did: a short beat on the shoulder view
      if (closeup) {
        if (await closeup) {
          petStall()
          await sleep(times.hold)
        }
      } else await sleep(times.beat)
      petStall()
      cineAlive() // notices a player who moved the camera during the hold
    } catch (err) {
      console.warn('[presentation] shot camera hold failed', err)
    }
  }
}

async function safeFire(gen: number): Promise<void> {
  try {
    await fireHeldVolley(gen)
  } catch (err) {
    console.warn('[presentation] failed to fire held volley', err)
  }
}

/**
 * A bot deployed in the Setup phase: fly to each new figure, hold so it is seen landing, then fly back once to the
 * player's last deploy view (or their drop zone). The presented cursor moves as the camera arrives, so the figure
 * appears under the camera. Any player camera input ends the trip at once (flyTo reports it, or the pose differs
 * after the hold), leaving the camera wherever the player put it.
 */
async function deployTrip(b: Batch, visits: { x: number; z: number }[], gen: number): Promise<void> {
  const cam = cameraApi.current
  if (!cam || visits.length === 0) return
  const t = deployTimes(speedFactor(useSettings.getState().animSpeed))
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

/** Plays one batch; the shot camera, if this batch started it, always goes back to the player's view before control returns. */
async function playBatch(b: Batch, gen: number): Promise<void> {
  try {
    await playBatchBody(b, gen)
  } finally {
    try {
      await cineEnd(gen)
    } catch (err) {
      console.warn('[presentation] shot camera return failed', err)
    }
  }
}

async function playBatchBody(b: Batch, gen: number): Promise<void> {
  const beats = deployBeats(b.events, b.state.phase, { perspective, botSeats, factor: speedFactor(useSettings.getState().animSpeed) })
  const visits: { x: number; z: number }[] = []
  for (const [i, ev] of b.events.entries()) {
    if (gen !== generation) return
    if (heldVolley) {
      const h = heldVolley
      if (ev.type === 'AttackDiceRolled') await safeFire(gen) // a shot that never closed
      else {
        const e = ev as { type: string; operativeId?: string; purpose?: string }
        const verdict = holdVerdict({ targetId: h.targetId, windowOpen: h.windowOpen, outcomeKnown: h.block !== null }, e)
        if (verdict === 'fire-first') await safeFire(gen)
        else if (verdict === 'hold') {
          h.held.push({ ev, state: b.state })
          continue
        } else noteDice(h, ev, b.state)
      }
      if (gen !== generation) return
    }
    // Move events keep the old position on screen while they play; every other event is shown as it plays.
    await playEvent(ev, b.state, gen)
    if (ev.type === 'ShootEnded') await cineEnd(gen) // the whole action is over: back to the player's view, once
    const beat = beats.find((x) => x.index === i)?.beat
    if (beat?.kind === 'record') lastPlayerView = cameraApi.current?.snapshot() ?? lastPlayerView
    else if (beat?.kind === 'visit') visits.push({ x: beat.x, z: beat.z })
  }
  // The batch ended with the target's damage held: a decision is waiting on it, so the volley fires now.
  if (heldVolley && heldVolley.held.length > 0 && gen === generation) await safeFire(gen)
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
      // the display state now has this step's wounds and control: the beat overrides are no longer needed
      clearOverrides()
      // the tween ends on the new position, so releasing it after the cursor moves cannot flash the old one
      for (const ev of b.events) if (ev.type === 'OperativeMoved') endMoveAnim(ev.operativeId)
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
  heldVolley = null
  cineReset()
  running = false
  mode = null
  fight = null
  shot = null
  lastHit.clear()
  lastPlayerView = null
  strikeIndex = 0
  strikeHandled = false
  clearCues()
  resetFx()
  clearAnnouncement()
  clearFx()
  trayClear()
  setPresentationIdle(true)
}
