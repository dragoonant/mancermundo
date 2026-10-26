// Transient UI state shared by the DOM overlay and the 3D interaction layer: selection, hover, the deploy pick, the hovered board
// point and its verdict, open panels. Never holds engine truth; resets when a decision changes.
import { create } from 'zustand'

export interface Pt {
  x: number
  z: number
}

export type CameraRequest = 'home' | 'top' | 'left' | 'right'

interface UiState {
  /** the fighter whose card is shown */
  selected: string | null
  hoverFighter: string | null
  hoverDoor: string | null
  /** an option id hovered in the prompt (highlights the fighter or door it names) */
  hoverOption: string | null
  /** deployment: the fighter picked to place next, and the facing (radians) it is set up with; null keeps the engine's default */
  deployFighter: string | null
  facing: number | null
  /** a door the player clicked that has more than one action: the prompt shows its options first */
  focusDoor: string | null
  /** the board point under the pointer */
  hover: Pt | null
  /** the verdict of the current hover position for the pending continuous decision */
  hoverNote: { ok: boolean; text: string } | null
  feedOpen: boolean
  /** the scenario panel (objective, how to win, score) is open */
  scenarioOpen: boolean
  /** phone layout: the fighter card is open as a sheet (it is a small button otherwise) */
  cardOpen: boolean
  cameraPreset: { id: CameraRequest; nonce: number } | null
  set(p: Partial<UiState>): void
  resetDecision(): void
  requestCamera(id: CameraRequest): void
}

export const useUi = create<UiState>((set) => ({
  selected: null,
  hoverFighter: null,
  hoverDoor: null,
  hoverOption: null,
  deployFighter: null,
  facing: null,
  focusDoor: null,
  hover: null,
  hoverNote: null,
  feedOpen: true,
  scenarioOpen: false,
  cardOpen: false,
  cameraPreset: null,
  set: (p) => set(p),
  resetDecision: () => set({ facing: null, focusDoor: null, hover: null, hoverNote: null, hoverOption: null }),
  requestCamera: (id) => set((s) => ({ cameraPreset: { id, nonce: (s.cameraPreset?.nonce ?? 0) + 1 } })),
}))
