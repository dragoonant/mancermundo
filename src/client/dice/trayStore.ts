// Dice tray state. Only the presentation director writes it (so a roll shows when its beat plays, never early). One row per
// attack step - hit, wound, save, Injury dice, Firepower dice, Ammo test, scatter - appended as the step's events play; a new
// Shoot or Fight clears the tray, and it folds away on its own a few seconds after the last row.
import { create } from 'zustand'
import type { Seat } from '@/engine'

export type RowKind = 'hit' | 'wound' | 'save' | 'injury' | 'firepower' | 'ammo' | 'scatter' | 'parry'
export type DieShape = 'pips' | 'firepower' | 'injury'
/** pass / fail of the test the row shows, or info for a plain result (Firepower, scatter) */
export type Tone = 'pass' | 'fail' | 'info'

export interface TrayDie {
  shape: DieShape
  /** the D6 result (pips); null for a face-named die */
  value: number | null
  /** engine face name for Firepower (`hit2`, `hit1+ammo`) and Injury (`fleshWound`...) dice */
  face: string | null
  /** did this die succeed (pips only); null when the die does not pass or fail */
  ok: boolean | null
}

export interface TrayRow {
  id: number
  kind: RowKind
  seat: Seat | null
  /** "Hit roll", "Wound roll", "Save"... */
  label: string
  /** who it concerns, already named */
  who: string
  need: number | null
  dice: TrayDie[]
  /** the one-line outcome the engine reported ("Hit", "Saved", "Seriously injured") */
  verdict: string
  tone: Tone
  /** scatter: the direction in degrees (engine bearing, 0 = +z) */
  arrow?: number
}

export interface TrayState {
  title: string
  rows: TrayRow[]
  /** bumps on every change so the tray can restart small animations */
  rev: number
}

export const TRAY_ROW_LIMIT = 7
/** How long the tray stays after its last row (ms). */
export const TRAY_LINGER_MS = 7000

const EMPTY: TrayState = { title: '', rows: [], rev: 0 }

export const useTray = create<TrayState>(() => ({ ...EMPTY }))

let nextId = 1
let timer: ReturnType<typeof setTimeout> | null = null

function arm(): void {
  if (timer !== null) clearTimeout(timer)
  timer = typeof setTimeout === 'undefined' ? null : setTimeout(trayClear, TRAY_LINGER_MS)
}

export function trayBegin(title: string): void {
  useTray.setState((s) => ({ title, rows: [], rev: s.rev + 1 }))
  arm()
}

export function trayClear(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
  useTray.setState((s) => (s.rows.length === 0 && !s.title ? s : { ...EMPTY, rev: s.rev + 1 }))
}

export function trayRow(row: Omit<TrayRow, 'id'>): void {
  useTray.setState((s) => ({ ...s, rows: [...s.rows, { ...row, id: nextId++ }].slice(-TRAY_ROW_LIMIT), rev: s.rev + 1 }))
  arm()
}
