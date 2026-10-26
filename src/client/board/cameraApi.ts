// Camera hooks for e2e tests and dev tools (window.__ms.camera). Filled in by CameraRig while mounted.
export interface CameraApi {
  /** world point (inches) -> page pixel */
  project(x: number, y: number, z: number): { x: number; y: number }
  lookAt(x: number, z: number, distance: number): void
  get(): { x: number; z: number; distance: number }
  repaint(): void
}

export const cameraApi: { current: CameraApi | null } = { current: null }

/** Wake the demand-driven render loop (no-op before the canvas exists). */
export function repaintBoard(): void {
  cameraApi.current?.repaint()
}
