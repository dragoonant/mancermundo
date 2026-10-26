// Client-only state of the sight-line tools: whether the overlay is on, the threat toggle and the measure tool.
// Nothing here is engine truth and nothing here is ever sent to the engine.
import { create } from 'zustand'
import type { MeasurePt } from './sightlines'

interface SightStore {
  /** the sight overlay (lines, badges, panel) */
  on: boolean
  /** null = automatic (on while a move is staged); true / false once the player pressed T or the button */
  threatPref: boolean | null
  measureOn: boolean
  mA: MeasurePt | null
  mB: MeasurePt | null
  setOn(v: boolean): void
  toggleThreat(effective: boolean): void
  toggleMeasure(): void
  /** a click while measuring: first point, second point, then a third click starts over */
  measureClick(p: MeasurePt): void
  clearMeasure(): void
}

export const useSight = create<SightStore>((set, get) => ({
  on: true,
  threatPref: null,
  measureOn: false,
  mA: null,
  mB: null,
  setOn: (v) => set({ on: v }),
  toggleThreat: (effective) => set({ threatPref: !effective }),
  toggleMeasure: () => set((s) => (s.measureOn ? { measureOn: false, mA: null, mB: null } : { measureOn: true })),
  measureClick: (p) => {
    const { mA, mB } = get()
    if (!mA || mB) set({ mA: p, mB: null })
    else set({ mB: p })
  },
  clearMeasure: () => set({ mA: null, mB: null }),
}))
