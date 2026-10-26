// Dice tray: rows come from engine events only (hit, wound, save, Injury dice, Firepower dice, Ammo test, scatter, fight hits),
// the Firepower and Injury dice carry the engine's own face names, a new attack clears the tray, and a real game fills it.
import { beforeEach, describe, expect, it } from 'vitest'
import type { GameEvent, GameState } from '@/engine'
import { trayEvent } from '@/client/dice/trayEvents'
import { TRAY_ROW_LIMIT, trayClear, useTray } from '@/client/dice/trayStore'
import { playGame } from '../fixtures/presentation'

const base = { seq: 3, round: 1, phase: 'action', seat: 'A' } as const
const ev = (body: Record<string, unknown>) => ({ ...base, ...body }) as unknown as GameEvent
const state = {
  fighters: { a1: { name: 'Bruiser' }, b1: { name: 'Lady Kaela' } },
  data: { weapons: { 'esc.w.autogun': { name: 'Autogun' } } },
} as unknown as GameState

const rows = () => useTray.getState().rows

describe('dice tray', () => {
  beforeEach(() => trayClear())

  it('a Shoot titles the tray and each roll adds a row read straight off the event', () => {
    trayEvent(ev({ type: 'ShootStarted', fighterId: 'a1', weaponId: 'esc.w.autogun', profileId: 'std', mode: 'normal' }), state)
    expect(useTray.getState().title).toBe('Bruiser shoots: Autogun')
    trayEvent(ev({ type: 'FirepowerRolled', fighterId: 'a1', faces: ['hit1+ammo', 'hit3', 'hit2'], hits: 6, ammoSymbols: 1 }), state)
    trayEvent(ev({ type: 'AmmoTest', fighterId: 'a1', weaponId: 'esc.w.autogun', roll: 2, need: 4, passed: false, result: 'failed' }), state)
    trayEvent(ev({ type: 'HitRolled', fighterId: 'a1', targetId: 'b1', dice: [5], need: 4, hit: true }), state)
    trayEvent(ev({ type: 'WoundRolled', targetId: 'b1', roll: 3, need: 4, wounded: false }), state)
    trayEvent(ev({ type: 'SaveRolled', targetId: 'b1', roll: 5, need: 5, saved: true, item: 'flak-armour' }), state)
    trayEvent(ev({ type: 'InjuryRolled', targetId: 'b1', faces: ['fleshWound', 'outOfAction'], applied: 'outOfAction' }), state)
    expect(rows().map((r) => r.kind)).toEqual(['firepower', 'ammo', 'hit', 'wound', 'save', 'injury'])
    const [fp, ammo, hit, wound, save, injury] = rows()
    expect(fp!.dice.map((d) => d.face)).toEqual(['hit1+ammo', 'hit3', 'hit2'])
    expect(fp!.dice.every((d) => d.shape === 'firepower')).toBe(true)
    expect(fp!.verdict).toBe('6 hits, 1 Ammo symbol')
    expect(ammo).toMatchObject({ verdict: 'Out of ammo', tone: 'fail', need: 4 })
    expect(hit).toMatchObject({ who: 'Lady Kaela', need: 4, verdict: 'Hit', tone: 'pass' })
    expect(hit!.dice).toEqual([{ shape: 'pips', value: 5, face: null, ok: true }])
    expect(wound).toMatchObject({ verdict: 'No wound', tone: 'fail' })
    expect(save).toMatchObject({ verdict: 'Saved', tone: 'pass' })
    expect(injury!.dice.map((d) => d.face)).toEqual(['fleshWound', 'outOfAction'])
    expect(injury!.verdict).toBe('Out of action')
  })

  it('a fight roll marks each die with the engine test, and a blast scatter keeps its bearing', () => {
    trayEvent(ev({ type: 'FightStarted', attackerId: 'a1', targets: ['b1'], weapons: [], dice: 3, charge: false }), state)
    expect(useTray.getState().title).toBe('Bruiser fights Lady Kaela')
    trayEvent(ev({ type: 'FightHitRolled', weaponId: 'unarmed', targetId: 'b1', dice: [1, 3, 6], need: 4, modifiers: [] }), state)
    expect(rows()[0]!.dice.map((d) => d.ok)).toEqual([false, false, true])
    expect(rows()[0]!.verdict).toBe('1 hit')
    trayEvent(ev({ type: 'BlastScattered', from: { x: 0, z: 0 }, to: { x: 1, z: 1 }, distance: 3, direction: 135 }), state)
    expect(rows()[1]).toMatchObject({ kind: 'scatter', arrow: 135, verdict: '3"' })
  })

  it('a new attack clears the tray, the row list is capped, and unrelated events do nothing', () => {
    trayEvent(ev({ type: 'WoundRolled', targetId: 'b1', roll: 6, need: 4, wounded: true }), state)
    trayEvent(ev({ type: 'FighterMoved', fighterId: 'a1', kind: 'move', from: {}, to: {}, path: [], length: 1, maxInches: 5 }), state)
    expect(rows()).toHaveLength(1)
    trayEvent(ev({ type: 'FightStarted', attackerId: 'a1', targets: ['b1'], weapons: [], dice: 1, charge: false }), state)
    expect(rows()).toHaveLength(0)
    for (let i = 0; i < TRAY_ROW_LIMIT + 3; i++) trayEvent(ev({ type: 'WoundRolled', targetId: 'b1', roll: 4, need: 4, wounded: true }), state)
    expect(rows()).toHaveLength(TRAY_ROW_LIMIT)
  })

  it('a real game fills the tray with Firepower, Injury and pip dice from the engine', () => {
    const kinds = new Set<string>()
    const faces = new Set<string>()
    const played = playGame('tray-1', (s) => s.round >= 3, 2500)
    for (const st of played.steps) {
      for (const e of st.events) {
        trayEvent(e, st.state)
        for (const r of rows()) {
          kinds.add(r.kind)
          for (const d of r.dice) if (d.face) faces.add(d.face)
        }
      }
    }
    expect(kinds.has('hit')).toBe(true)
    expect(kinds.has('wound')).toBe(true)
    expect([...faces].every((f) => /^(hit[123](\+ammo)?|fleshWound|seriouslyInjured|outOfAction)$/.test(f))).toBe(true)
    expect([...faces].some((f) => f.startsWith('hit'))).toBe(true)
  }, 120000)
})
