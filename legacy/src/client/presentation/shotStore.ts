// Which operative's overhead markers (order, AP, wounds) are hidden while the shot camera sits behind it: they would
// hang right in front of the lens. The director is the only writer; the figure reads it.
import { create } from 'zustand'

export const useShotStore = create<{ hideMarkersOf: string | null }>(() => ({ hideMarkersOf: null }))

export function setShotShooter(id: string | null): void {
  if (useShotStore.getState().hideMarkersOf !== id) useShotStore.setState({ hideMarkersOf: id })
}
