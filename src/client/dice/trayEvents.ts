// Engine events -> dice-tray rows. Pure apart from the tray store writes: every number and face comes off the event, nothing is
// rolled or recomputed here (the per-die pass mark of a fight hit roll uses the engine's own characteristic test).
import type { GameEvent, GameState } from '@/engine'
import { d6TestPasses } from '@/engine/dice'
import { fighterName, humanize, weaponName } from '../game/labels'
import { trayBegin, trayRow, type TrayDie } from './trayStore'

const pips = (rolls: readonly number[], ok: (roll: number, i: number) => boolean | null): TrayDie[] => rolls.map((value, i) => ({ shape: 'pips', value, face: null, ok: ok(value, i) }))
const faced = (shape: 'firepower' | 'injury', faces: readonly string[]): TrayDie[] => faces.map((face) => ({ shape, value: null, face, ok: null }))

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** Apply one event to the tray (no-op for events the tray does not show). */
export function trayEvent(ev: GameEvent, state: GameState): void {
  const name = (id: string | null | undefined): string => fighterName(state, id)
  switch (ev.type) {
    case 'ShootStarted':
      trayBegin(`${name(ev.fighterId)} shoots: ${weaponName(state, ev.weaponId)}`)
      break
    case 'FightStarted':
      trayBegin(`${name(ev.attackerId)} fights ${ev.targets.map(name).join(', ')}`)
      break
    case 'HitRolled': {
      const last = ev.dice.length - 1
      trayRow({
        kind: 'hit',
        seat: ev.seat,
        // no dice at all: the shot hits automatically (a door, a point on the floor)
        label: ev.dice.length === 0 ? 'Hit (automatic)' : ev.improbable ? 'Hit roll (6 first)' : 'Hit roll',
        who: ev.targetId ? name(ev.targetId) : '',
        need: ev.dice.length === 0 ? null : ev.need,
        dice: pips(ev.dice, (d, i) => (i === last ? ev.hit : d === 6)),
        verdict: ev.hit ? 'Hit' : 'Miss',
        tone: ev.hit ? 'pass' : 'fail',
      })
      break
    }
    case 'StrayShot':
      trayRow({ kind: 'hit', seat: ev.seat, label: 'Stray shot', who: name(ev.candidateId), need: null, dice: pips([ev.roll], () => ev.hit), verdict: ev.hit ? 'Hit' : 'Misses', tone: ev.hit ? 'pass' : 'fail' })
      break
    case 'FightHitRolled': {
      const hits = ev.dice.filter((d) => d6TestPasses(d, ev.need)).length
      trayRow({
        kind: 'hit',
        seat: ev.seat,
        label: `Hit roll, ${weaponName(state, ev.weaponId)}`,
        who: name(ev.targetId),
        need: ev.need,
        dice: pips(ev.dice, (d) => d6TestPasses(d, ev.need)),
        verdict: plural(hits, 'hit'),
        tone: hits > 0 ? 'pass' : 'fail',
      })
      break
    }
    case 'Parried':
      trayRow({ kind: 'parry', seat: ev.seat, label: 'Parry: re-roll', who: name(ev.by), need: null, dice: pips(ev.rerolled, () => null), verdict: 'Hit re-rolled', tone: 'info' })
      break
    case 'FirepowerRolled':
      trayRow({
        kind: 'firepower',
        seat: ev.seat,
        label: 'Firepower dice',
        who: name(ev.fighterId),
        need: null,
        dice: faced('firepower', ev.faces),
        verdict: `${plural(ev.hits, 'hit')}${ev.ammoSymbols > 0 ? `, ${plural(ev.ammoSymbols, 'Ammo symbol')}` : ''}`,
        tone: 'info',
      })
      break
    case 'AmmoTest': {
      const unstable = ev.result.startsWith('unstable')
      trayRow({
        kind: 'ammo',
        seat: ev.seat,
        label: unstable ? 'Unstable' : 'Ammo test',
        who: weaponName(state, ev.weaponId),
        need: unstable ? null : ev.need,
        dice: pips([ev.roll], () => ev.passed),
        verdict: unstable ? (ev.passed ? 'Holds' : 'Blows up') : ev.passed ? 'Passed' : 'Out of ammo',
        tone: ev.passed ? 'pass' : 'fail',
      })
      break
    }
    case 'WoundRolled':
      trayRow({ kind: 'wound', seat: ev.seat, label: 'Wound roll', who: name(ev.targetId), need: ev.need, dice: pips([ev.roll], () => ev.wounded), verdict: ev.wounded ? 'Wounds' : 'No wound', tone: ev.wounded ? 'pass' : 'fail' })
      break
    case 'SaveRolled':
      trayRow({ kind: 'save', seat: ev.seat, label: ev.item ? `Save, ${humanize(ev.item).toLowerCase()}` : 'Save', who: name(ev.targetId), need: ev.need, dice: pips([ev.roll], () => ev.saved), verdict: ev.saved ? 'Saved' : 'Save fails', tone: ev.saved ? 'pass' : 'fail' })
      break
    case 'InjuryRolled':
      trayRow({ kind: 'injury', seat: ev.seat, label: 'Injury dice', who: name(ev.targetId), need: null, dice: faced('injury', ev.faces), verdict: humanize(ev.applied || ev.faces[0] || ''), tone: 'info' })
      break
    case 'BlastScattered':
      trayRow({
        kind: 'scatter',
        seat: ev.seat,
        label: ev.misfire ? 'Scatter: misfire' : 'Scatter',
        who: '',
        need: null,
        dice: [],
        verdict: ev.misfire ? 'Back on the shooter' : `${Math.round(ev.distance * 10) / 10}"`,
        tone: 'info',
        arrow: ev.direction,
      })
      break
    default:
      break
  }
}
