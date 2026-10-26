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
import { catchUpPresented, setPresentedSeq } from './presentedStore'
import { speedFactor, useSettings } from './settings'

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

async function playEvent(ev: GameEvent, state: GameState, gen: number): Promise<void> {
  const f = speedFactor(useSettings.getState().animSpeed)
  let text = describeEvent(ev, state)
  const wait = (ms: number) => sleep(Math.round(ms * f))
  const fx = f > 0
  if (fx) playEventSounds((id, o) => audio.play(id, o), [ev], soundContext(state))

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
      if (fx && mode !== 'fight' && who && target && ev.weaponId) {
        // the muzzle flash fires on the same beat as the weapon sound (eventSounds.ts): one tracer per attack die
        const info = vfx.volley(who, target, ev.weaponId, ev.kinds.map(diceKind), shot?.secondary ?? false, shot?.inCover ?? false)
        faceToward(who, target, 700 + 1000 * info.duration)
        triggerCue(who.id, 'shoot', performance.now(), 'beat')
        // hold the dice until the first shots have landed
        await wait(1000 * Math.min(info.duration, info.first + (info.duration - info.first) * 0.5) + 40)
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
      if (fx && def && ev.blockedNormal + ev.blockedCrit > 0) vfx.shield(def, ev.blockedNormal + ev.blockedCrit, shot?.inCover ?? false)
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

async function playBatch(b: Batch, gen: number): Promise<void> {
  for (const ev of b.events) {
    if (gen !== generation) return
    // Move events keep the old position on screen while they play; every other event is shown as it plays.
    await playEvent(ev, b.state, gen)
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
  running = false
  mode = null
  fight = null
  shot = null
  lastHit.clear()
  strikeIndex = 0
  strikeHandled = false
  clearCues()
  resetFx()
  clearAnnouncement()
  clearFx()
  trayClear()
  setPresentationIdle(true)
}
