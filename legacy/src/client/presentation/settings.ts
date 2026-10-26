// Presentation / UI settings: animation speed and graphics level. Persisted per browser in localStorage
// (every access guarded: private windows and node tests have no storage).
import { create } from 'zustand'
import { currentParams, type AnimSpeed } from '../params'

export type { AnimSpeed }

const KEY = 'mancermundo.settings.v1'

interface Persisted {
  animSpeed: AnimSpeed
  lowGraphics: boolean
  /** the camera goes behind the shooter, then closes on the target, then back to the player's view */
  cinematicShots: boolean
}

function load(): Persisted {
  const base: Persisted = { animSpeed: 'normal', lowGraphics: false, cinematicShots: true }
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    if (raw) Object.assign(base, JSON.parse(raw))
  } catch {
    /* storage unavailable */
  }
  const fromUrl = currentParams().speed
  if (fromUrl) base.animSpeed = fromUrl
  return base
}

interface SettingsState extends Persisted {
  setAnimSpeed(s: AnimSpeed): void
  setLowGraphics(v: boolean): void
  setCinematicShots(v: boolean): void
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  setAnimSpeed: (animSpeed) => {
    set({ animSpeed })
    persist(get())
  },
  setLowGraphics: (lowGraphics) => {
    set({ lowGraphics })
    persist(get())
  },
  setCinematicShots: (cinematicShots) => {
    set({ cinematicShots })
    persist(get())
  },
}))

function persist(s: Persisted): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify({ animSpeed: s.animSpeed, lowGraphics: s.lowGraphics, cinematicShots: s.cinematicShots }))
  } catch {
    /* ignore */
  }
}

/** Multiplier applied to every presentation pause. 'instant' = 0 (no waiting at all). */
export function speedFactor(speed: AnimSpeed = useSettings.getState().animSpeed): number {
  return speed === 'instant' ? 0 : speed === 'fast' ? 0.35 : 1
}
