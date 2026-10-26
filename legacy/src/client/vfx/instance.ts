// The one effects engine of the page, plus the quality switch and a small debug hook (window.__vfx) used by
// the e2e specs and the gallery to pause the engine mid-effect for screenshots.
import { useSettings } from '../presentation/settings'
import { FxEngine } from './engine'

export const LOW_QUALITY = 0.4

/** True when the page asked for reduced effects: ?fx=low, or the Low graphics setting. */
export function lowFx(): boolean {
  try {
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('fx') === 'low') return true
  } catch {
    /* no location (node) */
  }
  try {
    return useSettings.getState().lowGraphics
  } catch {
    return false
  }
}

export const fx = new FxEngine({ quality: lowFx() ? LOW_QUALITY : 1 })

/** Re-read the quality setting; called before every spawn (cheap). */
export function syncQuality(): void {
  fx.quality = lowFx() ? LOW_QUALITY : 1
}

export interface VfxDebug {
  stats(): ReturnType<FxEngine['stats']> & { live: number; frozen: boolean; clock: number; cpu: { avg: number; peak: number; frames: number; peakDraw: number } }
  freeze(): void
  resume(): void
  /** freeze `ms` after the next effect is spawned */
  freezeAfterNextSpawn(ms: number): void
  /** freeze `ms` after the next projectile is launched */
  freezeAfterNextProjectile(ms: number): void
  /** freeze `ms` after the next explosion starts */
  freezeAfterNextExplosion(ms: number): void
  frozen(): boolean
  resetCpu(): void
  /** bumps every time anything is spawned */
  spawned(): number
  /** atlas frames of the live particles per layer (which effects are on screen right now) */
  frames(): { add: number[]; norm: number[]; flatAdd: number[]; flatNorm: number[] }
}

declare global {
  interface Window {
    __vfx?: VfxDebug
  }
}

let spawned = 0
export const noteSpawn = (): void => {
  spawned++
}

if (typeof window !== 'undefined') {
  window.__vfx = {
    stats: () => ({ ...fx.stats(), live: fx.liveCount(), frozen: fx.frozen, clock: fx.clock, cpu: fx.cpu() }),
    resetCpu: () => fx.resetCpu(),
    freeze: () => fx.freeze(),
    resume: () => fx.resume(),
    freezeAfterNextSpawn: (ms) => fx.freezeAfterNextSpawn(ms),
    freezeAfterNextProjectile: (ms) => fx.freezeAfterNextProjectile(ms),
    freezeAfterNextExplosion: (ms) => fx.freezeAfterNextExplosion(ms),
    frozen: () => fx.frozen,
    spawned: () => spawned,
    frames: () => {
      return { add: fx.visibleFrames('add'), norm: fx.visibleFrames('norm'), flatAdd: fx.visibleFrames('flatAdd'), flatNorm: fx.visibleFrames('flatNorm') }
    },
  }
}
