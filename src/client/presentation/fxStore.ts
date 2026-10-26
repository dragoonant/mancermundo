// Transient board effects (tracers, impact flashes, floating numbers, control rings) and the per-beat display
// overrides that let the board show a result at its beat instead of at the end of the whole step:
// presented wounds and presented marker control. Only the director writes them; the director clears the
// overrides when the step's cursor advance makes the display state catch up.
import { create } from 'zustand'
import type { Seat } from '@/engine'
import type { WeaponFlavour } from '../weaponFlavour'

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
  flavour: WeaponFlavour | null
  text: string
  size: number
}

interface FxState {
  list: Fx[]
  /** operative id -> wounds to show until the display state catches up */
  wounds: Record<string, number>
  /** objective marker id -> controller to show until the display state catches up */
  control: Record<string, Seat | null>
}

let nextId = 1
export const useFx = create<FxState>(() => ({ list: [], wounds: {}, control: {} }))

export function spawnFx(fx: Partial<Fx> & Pick<Fx, 'kind' | 'to'>): void {
  const full: Fx = {
    id: nextId++,
    t0: performance.now(),
    dur: 500,
    from: fx.to,
    color: '#ffffff',
    flavour: null,
    text: '',
    size: 1,
    ...fx,
  }
  useFx.setState((s) => ({ list: [...s.list.slice(-24), full] }))
  setTimeout(() => useFx.setState((s) => ({ list: s.list.filter((f) => f.id !== full.id) })), full.dur + 120)
}

export function setWoundOverride(id: string, wounds: number): void {
  useFx.setState((s) => ({ wounds: { ...s.wounds, [id]: wounds } }))
}

export function setControlOverride(markerId: string, controller: Seat | null): void {
  useFx.setState((s) => ({ control: { ...s.control, [markerId]: controller } }))
}

export function clearOverrides(): void {
  const s = useFx.getState()
  if (Object.keys(s.wounds).length || Object.keys(s.control).length) useFx.setState({ wounds: {}, control: {} })
}

export function clearFx(): void {
  useFx.setState({ list: [], wounds: {}, control: {} })
}
