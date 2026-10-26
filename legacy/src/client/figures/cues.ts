// Rigid whole-body cues (docs/spec/30-figures.md section 4): idle breathe, walk bob, shoot recoil, melee lunge,
// hit flinch, death (slump, burn down, knocked back, topple). The maths and the trigger store live in cueCore.ts
// (no store imports, so the presentation director can trigger them at its beats); this module re-exports them and
// feeds the same store from the event log once the presentation cursor passes an event, as the fallback for
// anything the director did not already play at its beat.
import { useGame } from '../store/game'
import { usePresentedStore } from '../presentation/presentedStore'
import { requestRepaint } from '../presentation/animStore'
import { setCueRepaint, triggerCue, type CueKind } from './cueCore'
import type { GameEvent } from '@/engine'

export * from './cueCore'
setCueRepaint(requestRepaint)

/** Which cue (if any) an engine event triggers on which operative. */
export function cueOf(ev: GameEvent): { id: string; kind: CueKind } | null {
  switch (ev.type) {
    case 'ShootStarted':
      return { id: ev.operativeId, kind: 'shoot' }
    case 'FightStarted':
    case 'Struck':
      return { id: ev.operativeId, kind: 'melee' }
    case 'DamageInflicted':
      return { id: ev.operativeId, kind: 'hit' }
    case 'OperativeIncapacitated':
      return { id: ev.operativeId, kind: 'death' }
    default:
      return null
  }
}

let installed = false
let lastSeq = -1
/** Idempotent: starts turning presented events into cues. Safe to call from every figure. */
export function installCueFeed(): void {
  if (installed) return
  installed = true
  lastSeq = usePresentedStore.getState().presentedSeq
  usePresentedStore.subscribe((s) => {
    if (s.presentedSeq < lastSeq) {
      lastSeq = s.presentedSeq
      return
    }
    if (s.presentedSeq === lastSeq) return
    const from = lastSeq
    lastSeq = s.presentedSeq
    const now = performance.now()
    for (const ev of useGame.getState().events) {
      if (ev.seq <= from || ev.seq > s.presentedSeq) continue
      const c = cueOf(ev)
      if (c) triggerCue(c.id, c.kind, now)
    }
  })
}
