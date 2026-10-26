// Transient UI state shared by the DOM overlay and the 3D interaction layer: selection, hover, the deploy
// pick, the move path being planned, open panels. Never holds engine truth; resets when a decision changes.
import { create } from 'zustand'
import type { Waypoint } from '@/engine'

export interface Pt {
  x: number
  z: number
  y: number
}

export type DrawerId = 'feed' | 'log' | 'mission' | 'settings' | 'card'

interface UiState {
  selectedOp: string | null
  hoverOp: string | null
  hoverZone: string | null
  /** an option id (re-roll dice highlight) or a spot id (objective / choice spot ring) hovered in the prompt or on the board */
  hoverOption: string | null
  hoverSpot: string | null
  deployOp: string | null
  waypoints: Waypoint[]
  jumpNext: boolean
  hover: Pt | null
  /** verdict of the current hover position for deploy: ok flag + engine reason */
  hoverNote: { ok: boolean; text: string } | null
  drawer: DrawerId | null
  panels: { feed: boolean; log: boolean; mission: boolean }
  cameraPreset: { id: 'home' | 'top'; nonce: number } | null
  set(p: Partial<UiState>): void
  togglePanel(k: 'feed' | 'log' | 'mission'): void
  toggleDrawer(id: DrawerId): void
  resetPath(): void
  requestCamera(id: 'home' | 'top'): void
}

export const useUi = create<UiState>((set) => ({
  selectedOp: null,
  hoverOp: null,
  hoverZone: null,
  hoverOption: null,
  hoverSpot: null,
  deployOp: null,
  waypoints: [],
  jumpNext: false,
  hover: null,
  hoverNote: null,
  drawer: null,
  panels: { feed: true, log: false, mission: false },
  cameraPreset: null,
  set: (p) => set(p),
  togglePanel: (k) => set((s) => ({ panels: { ...s.panels, [k]: !s.panels[k] } })),
  toggleDrawer: (id) => set((s) => ({ drawer: s.drawer === id ? null : id })),
  resetPath: () => set({ waypoints: [], jumpNext: false }),
  requestCamera: (id) => set((s) => ({ cameraPreset: { id, nonce: (s.cameraPreset?.nonce ?? 0) + 1 } })),
}))
