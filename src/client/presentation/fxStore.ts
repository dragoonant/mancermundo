// Transient board effects (tracers, impact flashes, floating numbers, rings) and the per-beat display overrides that let the
// board show a result at its beat instead of at the end of the whole step: the wounds a fighter shows until the display state
// catches up. Only the director writes them; the director clears the overrides when the cursor advance makes the display state
// catch up. The renderers for the effects are S5b; the minimal layer in interaction/Overlays.tsx draws them meanwhile.
import { create } from 'zustand'

export type FxKind = 'tracer' | 'impact' | 'text' | 'ring'

export interface Fx {
  id: number
  kind: FxKind
  /** performance.now() at spawn */
  t0: number
  dur: number
  from: [number, number, number]
  to: [number, number, number]
  color: string
  text: string
  size: number
}

interface FxState {
  list: Fx[]
  /** fighter id -> wounds to show until the display state catches up */
  wounds: Record<string, number>
}

let nextId = 1
export const useFx = create<FxState>(() => ({ list: [], wounds: {} }))

export function spawnFx(fx: Partial<Fx> & Pick<Fx, 'kind' | 'to'>): void {
  const full: Fx = { id: nextId++, t0: performance.now(), dur: 500, from: fx.to, color: '#ffffff', text: '', size: 1, ...fx }
  useFx.setState((s) => ({ list: [...s.list.slice(-24), full] }))
  setTimeout(() => useFx.setState((s) => ({ list: s.list.filter((f) => f.id !== full.id) })), full.dur + 120)
}

export function setWoundOverride(id: string, wounds: number): void {
  useFx.setState((s) => ({ wounds: { ...s.wounds, [id]: wounds } }))
}

export function clearOverrides(): void {
  if (Object.keys(useFx.getState().wounds).length) useFx.setState({ wounds: {} })
}

export function clearFx(): void {
  useFx.setState({ list: [], wounds: {} })
}
